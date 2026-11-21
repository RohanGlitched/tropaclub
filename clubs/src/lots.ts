/**
 * Tropa lots: FIFO over a wallet's stock-token movements, time-weighted return of the Tropa-bought
 * lots, and the wash rule. Pure functions; callers load flows from Firestore (`transfers`, `buys`).
 *
 * FIFO head: the wallet's balance before its first Tropa buy of a token is an "outside" lot, so an
 * outflow sells older outside holdings first (FIFO), then Tropa lots. Other inbound transfers also
 * become outside lots. Only Tropa lots are scored.
 */
import { DAY, HOUR } from './util';

export interface Flow {
  t: number;
  token: string;
  dir: 'in' | 'out';
  raw: bigint;
  tropa: boolean;
  txHash: string;
  logIndex: number;
  /** Tropa inbound legs: USD per whole raw token paid. */
  priceAtBuy?: number | null;
}

export interface Lot {
  token: string;
  raw: bigint;
  origRaw: bigint;
  acquiredAt: number;
  tropa: boolean;
  txHash: string | null;
  priceAtBuy: number | null;
}

export const sortFlows = (fs: Flow[]) =>
  [...fs].sort((a, b) => a.t - b.t || (a.txHash === b.txHash ? a.logIndex - b.logIndex : a.txHash < b.txHash ? -1 : 1));

export class FifoBook {
  readonly lots = new Map<string, Lot[]>();
  /** Outflow raw that found no lot to consume (history before our window). */
  unmatchedOut = new Map<string, bigint>();

  constructor(prior: Record<string, { raw: bigint; at: number }> = {}) {
    for (const [token, p] of Object.entries(prior))
      if (p.raw > 0n) this.lots.set(token, [{ token, raw: p.raw, origRaw: p.raw, acquiredAt: p.at, tropa: false, txHash: null, priceAtBuy: null }]);
  }

  apply(f: Flow): Lot[] {
    const q = this.lots.get(f.token) ?? [];
    this.lots.set(f.token, q);
    if (f.dir === 'in') {
      const lot: Lot = { token: f.token, raw: f.raw, origRaw: f.raw, acquiredAt: f.t, tropa: f.tropa, txHash: f.txHash, priceAtBuy: f.priceAtBuy ?? null };
      q.push(lot);
      return [lot];
    }
    let left = f.raw;
    const touched: Lot[] = [];
    while (left > 0n && q.length) {
      const head = q[0]!;
      const take = head.raw < left ? head.raw : left;
      head.raw -= take;
      left -= take;
      touched.push({ ...head, raw: take });
      if (head.raw === 0n) q.shift();
    }
    if (left > 0n) this.unmatchedOut.set(f.token, (this.unmatchedOut.get(f.token) ?? 0n) + left);
    return touched;
  }

  tropaRaw(token: string): bigint {
    return (this.lots.get(token) ?? []).filter((l) => l.tropa).reduce((s, l) => s + l.raw, 0n);
  }
  totalRaw(token: string): bigint {
    return (this.lots.get(token) ?? []).reduce((s, l) => s + l.raw, 0n);
  }
  tokens(): string[] {
    return [...this.lots.keys()];
  }
}

export type MarkFn = (token: string, t: number) => Promise<number | null>;

export interface TwrResult {
  /** Time-weighted return in percent; null if no Tropa lot was held in the window. */
  returnPct: number | null;
  startValue: number;
  endValue: number;
  subperiods: number;
  /** Tokens valued with a stale fallback (last known price) at some step. */
  staleTokens: string[];
}

/**
 * Time-weighted return of the Tropa lots over (start, end]. Sub-periods break at every flow; the
 * portfolio is valued just before and just after each flow, so new money never counts as return.
 * A Tropa buy's own fill price is the mark for that token at that instant.
 */
export async function tropaTwr(opts: {
  flows: Flow[];
  prior?: Record<string, { raw: bigint; at: number }>;
  start: number;
  end: number;
  markAt: MarkFn;
}): Promise<TwrResult> {
  const flows = sortFlows(opts.flows);
  const book = new FifoBook(opts.prior);
  const lastKnown = new Map<string, number>();
  const stale = new Set<string>();
  const markCache = new Map<string, number | null>();

  const mark = async (token: string, t: number): Promise<number | null> => {
    const k = `${token}:${t}`;
    if (!markCache.has(k)) markCache.set(k, await opts.markAt(token, t));
    const m = markCache.get(k)!;
    if (m != null) {
      lastKnown.set(token, m);
      return m;
    }
    const lk = lastKnown.get(token);
    if (lk != null) stale.add(token);
    return lk ?? null;
  };

  const value = async (t: number, override?: { token: string; usd: number }) => {
    let v = 0;
    for (const token of book.tokens()) {
      const raw = book.tropaRaw(token);
      if (raw === 0n) continue;
      const m = override && override.token === token ? override.usd : await mark(token, t);
      if (m == null) {
        stale.add(token);
        continue;
      }
      v += (Number(raw) / 1e8) * m;
    }
    return v;
  };

  let i = 0;
  for (; i < flows.length && flows[i]!.t <= opts.start; i++) {
    const f = flows[i]!;
    if (f.tropa && f.priceAtBuy) lastKnown.set(f.token, f.priceAtBuy);
    book.apply(f);
  }
  const startValue = await value(opts.start);
  let prevAfter = startValue;
  let growth = 1;
  let held = startValue > 0;
  let sub = 0;
  for (; i < flows.length && flows[i]!.t <= opts.end; i++) {
    const f = flows[i]!;
    const override = f.tropa && f.dir === 'in' && f.priceAtBuy ? { token: f.token, usd: f.priceAtBuy } : undefined;
    if (override) lastKnown.set(f.token, override.usd);
    const before = await value(f.t, override);
    if (prevAfter > 0) {
      growth *= before / prevAfter;
      sub++;
    }
    book.apply(f);
    prevAfter = await value(f.t, override);
    if (prevAfter > 0) held = true;
  }
  const endValue = await value(opts.end);
  if (prevAfter > 0) {
    growth *= endValue / prevAfter;
    sub++;
  }
  return { returnPct: held ? (growth - 1) * 100 : null, startValue, endValue, subperiods: sub, staleTokens: [...stale] };
}

export const WASH_WINDOW_SEC = 24 * HOUR;

/**
 * Wash rule: buy -> sell -> buy of the same token within 24 h. Both buys in the pattern score 0.
 * `outs` are the wallet's outbound transfers of the token (any destination).
 */
export function washBuys(
  buys: { txHash: string; token: string; t: number }[],
  outs: { token: string; t: number; txHash?: string }[],
  windowSec = WASH_WINDOW_SEC,
): Set<string> {
  const wash = new Set<string>();
  const byToken = new Map<string, { txHash: string; t: number }[]>();
  for (const b of buys) byToken.set(b.token, [...(byToken.get(b.token) ?? []), b]);
  for (const [token, bs] of byToken) {
    bs.sort((a, b) => a.t - b.t);
    const os = outs.filter((o) => o.token === token);
    for (let a = 0; a < bs.length; a++)
      for (let b = a + 1; b < bs.length && bs[b]!.t - bs[a]!.t <= windowSec; b++) {
        const x = bs[a]!;
        const y = bs[b]!;
        if (os.some((o) => o.t >= x.t && o.t <= y.t && o.txHash !== x.txHash && o.txHash !== y.txHash)) {
          wash.add(x.txHash);
          wash.add(y.txHash);
        }
      }
  }
  return wash;
}

/** Net change of the wallet's balance of a token between two times, from flows. */
export function netRawBetween(flows: Flow[], token: string, from: number, to: number): bigint {
  let s = 0n;
  for (const f of flows) if (f.token === token && f.t > from && f.t <= to) s += f.dir === 'in' ? f.raw : -f.raw;
  return s;
}

export const D = (n: number) => n * DAY;
