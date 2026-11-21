/**
 * Price sources. Unit everywhere: USD per WHOLE RAW TOKEN (10^8 raw units).
 *
 * That is the Chainlink "Coinbase <TICKER>" total-return unit (underlying price x ERC-8056 uiMultiplier) and
 * the DEX unit, so raw quantity x mark is the position value with no multiplier adjustment, through splits
 * and stock dividends alike. A per-SHARE price (e.g. an equity quote) must go through perShareToPerRaw().
 */
import { STOCK_FEEDS } from '@tropaclub/buy';
import { type PublicClient, getAddress, parseAbi } from 'viem';
import type { DocStore } from './store/docstore';
import { COL, type MarkDoc } from './types';
import { DAY, HOUR } from './util';

export interface PriceMark {
  usd: number;
  at: number;
  source: string;
}

export interface PriceSource {
  /** Latest mark at or before t (within the source's tolerance), else null. */
  markAt(token: string, t: number): Promise<PriceMark | null>;
}

export const perShareToPerRaw = (usdPerShare: number, multiplier: number) => usdPerShare * multiplier;
export const perRawToPerShare = (usdPerRaw: number, multiplier: number) => usdPerRaw / multiplier;

/** Step series in memory (tests, demo seeds, or a pre-loaded snapshot). */
export class StaticPriceSource implements PriceSource {
  private series = new Map<string, [number, number][]>();
  constructor(
    series: Record<string, [t: number, usd: number][]> = {},
    private maxAgeSec = 30 * DAY,
    private label = 'static',
  ) {
    for (const [k, v] of Object.entries(series)) this.series.set(k.toLowerCase(), [...v].sort((a, b) => a[0] - b[0]));
  }
  add(token: string, t: number, usd: number) {
    const s = this.series.get(token.toLowerCase()) ?? [];
    s.push([t, usd]);
    s.sort((a, b) => a[0] - b[0]);
    this.series.set(token.toLowerCase(), s);
  }
  async markAt(token: string, t: number): Promise<PriceMark | null> {
    const s = this.series.get(token.toLowerCase());
    if (!s) return null;
    let hit: [number, number] | null = null;
    for (const p of s) if (p[0] <= t) hit = p;
    if (!hit || t - hit[0] > this.maxAgeSec) return null;
    return { usd: hit[1], at: hit[0], source: this.label };
  }
}

/** Marks captured into Firestore (`marks`) at every matchday close and at every recorded buy. */
export class StoreMarkSource implements PriceSource {
  private cache = new Map<string, { at: number; rows: MarkDoc[] }>();
  constructor(
    private store: DocStore,
    private maxAgeSec = 4 * DAY,
    private cacheMs = 60_000,
  ) {}
  async markAt(token: string, t: number): Promise<PriceMark | null> {
    const k = token.toLowerCase();
    let c = this.cache.get(k);
    if (!c || Date.now() - c.at > this.cacheMs) {
      // marks written from single buys (older versions did this) are never trusted
      const rows = (await this.store.query<MarkDoc>(COL.marks, { where: [['token', '==', k]] })).filter((r) => r.source !== 'buy');
      rows.sort((a, b) => a.t - b.t);
      c = { at: Date.now(), rows };
      this.cache.set(k, c);
    }
    let hit: MarkDoc | null = null;
    for (const r of c.rows) if (r.t <= t) hit = r;
    if (!hit || t - hit.t > this.maxAgeSec) return null;
    return { usd: hit.usd, at: hit.t, source: `stored:${hit.source}` };
  }
  invalidate() {
    this.cache.clear();
  }
}

const roundAbi = parseAbi([
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function getRoundData(uint80 _roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
]);

/**
 * Chainlink "Coinbase <TICKER>" feeds: the last round with updatedAt <= t, by binary search over the
 * current phase's aggregator round ids (~15 eth_calls). Feeds hold the last value nights, weekends and
 * holidays, which is exactly the "mark at the cut" we want.
 */
export class ChainlinkHistorySource implements PriceSource {
  private memo = new Map<string, PriceMark | null>();
  constructor(
    private client: PublicClient,
    private feeds: Record<string, { feed: string }> = STOCK_FEEDS,
    private maxAgeSec = 4 * DAY,
  ) {}
  async markAt(token: string, t: number): Promise<PriceMark | null> {
    const entry = this.feeds[token.toLowerCase()];
    if (!entry) return null;
    const key = `${token.toLowerCase()}:${t}`;
    if (this.memo.has(key)) return this.memo.get(key)!;
    const feed = getAddress(entry.feed);
    const read = (roundId: bigint) => this.client.readContract({ address: feed, abi: roundAbi, functionName: 'getRoundData', args: [roundId] });
    const latest = await this.client.readContract({ address: feed, abi: roundAbi, functionName: 'latestRoundData' });
    let result: PriceMark | null = null;
    if (Number(latest[3]) <= t) {
      result = { usd: Number(latest[1]) / 1e8, at: Number(latest[3]), source: 'chainlink' };
    } else {
      const phase = latest[0] >> 64n;
      let lo = 1n;
      let hi = latest[0] & 0xffffffffffffffffn;
      let best: readonly [bigint, bigint, bigint, bigint, bigint] | null = null;
      while (lo <= hi) {
        const mid = (lo + hi) / 2n;
        const r = await read((phase << 64n) | mid).catch(() => null);
        if (!r || Number(r[3]) === 0) {
          lo = mid + 1n;
          continue;
        }
        if (Number(r[3]) <= t) {
          best = r;
          lo = mid + 1n;
        } else hi = mid - 1n;
      }
      if (best) result = { usd: Number(best[1]) / 1e8, at: Number(best[3]), source: 'chainlink' };
    }
    if (result && t - result.at > this.maxAgeSec) result = null;
    this.memo.set(key, result);
    return result;
  }
}

/**
 * Indexer files: current DEX price from public index.json (for t within `liveWindowSec` of now) and
 * optional daily average prices (indexer state `dailyPx`: token -> unix day -> USD per token).
 */
export class IndexerPriceSource implements PriceSource {
  private index: { at: number; prices: Map<string, number> } | null = null;
  constructor(
    private opts: {
      indexUrl?: string;
      dailyPx?: Record<string, Record<number, number>>;
      liveWindowSec?: number;
      fetchImpl?: typeof fetch;
      now?: () => number;
    } = {},
  ) {}
  private async live(): Promise<Map<string, number>> {
    if (this.index && Date.now() - this.index.at < 5 * 60_000) return this.index.prices;
    const url = this.opts.indexUrl ?? `${process.env.DATA_BASE_URL ?? 'https://storage.googleapis.com/tropaclub-data/public'}/index.json`;
    const res = await (this.opts.fetchImpl ?? fetch)(url);
    if (!res.ok) throw new Error(`index.json ${res.status}`);
    const j = (await res.json()) as { tokens: { address: string; priceUsd: number | null }[] };
    const prices = new Map<string, number>();
    for (const t of j.tokens) if (t.priceUsd) prices.set(t.address.toLowerCase(), t.priceUsd);
    this.index = { at: Date.now(), prices };
    return prices;
  }
  async markAt(token: string, t: number): Promise<PriceMark | null> {
    const k = token.toLowerCase();
    const now = (this.opts.now ?? (() => Math.floor(Date.now() / 1000)))();
    if (t >= now - (this.opts.liveWindowSec ?? 2 * HOUR)) {
      const p = await this.live().catch(() => null);
      const v = p?.get(k);
      if (v) return { usd: v, at: now, source: 'indexer:dex' };
    }
    const days = this.opts.dailyPx?.[k];
    if (days) {
      const d = Math.floor(t / DAY);
      for (let x = d; x >= d - 3; x--) if (days[x]) return { usd: days[x]!, at: x * DAY, source: 'indexer:daily' };
    }
    return null;
  }
}

export class CompositePriceSource implements PriceSource {
  constructor(private sources: PriceSource[]) {}
  async markAt(token: string, t: number): Promise<PriceMark | null> {
    for (const s of this.sources) {
      const m = await s.markAt(token, t).catch(() => null);
      if (m && Number.isFinite(m.usd) && m.usd > 0) return m;
    }
    return null;
  }
}

/** Cron helper: capture a mark per token at a cut (called after every matchday close). */
export async function captureMarks(store: DocStore, source: PriceSource, tokens: string[], t: number): Promise<MarkDoc[]> {
  const out: MarkDoc[] = [];
  for (const token of tokens) {
    const m = await source.markAt(token, t);
    if (!m) continue;
    const doc: MarkDoc = { id: `${token.toLowerCase()}_${t}`, token: token.toLowerCase(), t, usd: m.usd, source: m.source };
    await store.set(COL.marks, doc.id, doc);
    out.push(doc);
  }
  return out;
}
