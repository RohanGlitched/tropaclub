/**
 * Market calendar + reference marks for Coinbase B20 stock tokens.
 *
 * Feed semantics (docs.base.org/build-on-base/integrate-defi/list-tokenized-stocks, "Price Feeds"):
 *  - Chainlink "Coinbase <TICKER>" feeds publish underlying price x multiplier ("total return"), 8 decimals.
 *    => the feed answer is USD per ONE WHOLE RAW TOKEN (10^decimals raw units), not per share.
 *    Verified Nov 22 2026: SNDK feed 649.44 with multiplier 8; KyberSwap fills $10 -> 0.01549 SNDKc ($645/token).
 *  - Feeds run 24/5, update on 0.5% deviation or a 24 h heartbeat, hold the last value nights/weekends/holidays
 *    and freeze during corporate actions (OracleRegistry pause flag).
 *  - Coinbase API nav_price is the same Chainlink-based value with nav_price_updated_at.
 */
import { type Address, type PublicClient, getAddress } from 'viem';
import {
  COINBASE_STOCKS_API,
  ETH_USD_FEED,
  NATIVE_ETH,
  ORACLE_REGISTRY,
  SLIPSTREAM_FACTORIES,
  SLIPSTREAM_TICK_SPACINGS,
  STOCK_FEEDS,
  USDC,
  WETH,
  aggregatorV3Abi,
  b20Abi,
  clFactoryAbi,
  clPoolAbi,
  oracleRegistryAbi,
} from './constants';

// ---------------------------------------------------------------- calendar

/** NYSE full-day closures (ET dates). */
export const NYSE_HOLIDAYS = new Set([
  '2026-11-26', // Thanksgiving
  '2026-12-25',
  '2027-01-01',
  '2027-01-18',
  '2027-02-15',
  '2027-03-26',
]);
/** Early closes: regular session ends 13:00 ET, extended 17:00 ET. */
export const NYSE_HALF_DAYS = new Set(['2026-11-27', '2026-12-24']);

export type MarketPhase = 'regular' | 'extended' | 'overnight' | 'closed';

interface EtParts {
  date: string; // YYYY-MM-DD
  weekday: number; // 0 Sun .. 6 Sat
  minutes: number; // minutes since ET midnight
}

const etFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  weekday: 'short',
  hourCycle: 'h23',
});
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function etParts(nowSec: number): EtParts {
  const p = Object.fromEntries(etFmt.formatToParts(new Date(nowSec * 1000)).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    weekday: WD[p.weekday as string] ?? 0,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

function nextDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Phase of the 24/5 US equity session the Chainlink feeds follow:
 * overnight 20:00-04:00 ET, extended 04:00-09:30 and 16:00-20:00, regular 09:30-16:00, Sun 20:00 ET to Fri 20:00 ET.
 */
export function marketPhase(nowSec: number): MarketPhase {
  const { date, weekday, minutes } = etParts(nowSec);
  const holiday = NYSE_HOLIDAYS.has(date);
  const nextIsClosed = NYSE_HOLIDAYS.has(nextDate(date)) || weekday === 5 || weekday === 6;
  if (weekday === 6) return 'closed';
  if (weekday === 0) return minutes >= 20 * 60 && !NYSE_HOLIDAYS.has(nextDate(date)) ? 'overnight' : 'closed';
  if (holiday) return minutes >= 20 * 60 && !nextIsClosed ? 'overnight' : 'closed';
  const half = NYSE_HALF_DAYS.has(date);
  const regularEnd = half ? 13 * 60 : 16 * 60;
  const extendedEnd = half ? 17 * 60 : 20 * 60;
  if (minutes < 4 * 60) return 'overnight';
  if (minutes < 9 * 60 + 30) return 'extended';
  if (minutes < regularEnd) return 'regular';
  if (minutes < extendedEnd) return 'extended';
  // after the evening close: overnight session for the next trading day, unless that day is closed
  return nextIsClosed ? 'closed' : 'overnight';
}

/** Feeds update during every phase except 'closed'. */
export function isFeedSessionOpen(nowSec: number): boolean {
  return marketPhase(nowSec) !== 'closed';
}

/** Feed heartbeat is 24 h; allow 15 min of slack. */
export const FEED_MAX_AGE_SEC = 24 * 3600 + 15 * 60;

/** A Chainlink/NAV value is "fresh" only while the session is open and within the heartbeat. */
export function isMarkFresh(updatedAtSec: number, nowSec: number, maxAgeSec = FEED_MAX_AGE_SEC): boolean {
  return isFeedSessionOpen(nowSec) && nowSec - updatedAtSec <= maxAgeSec && updatedAtSec <= nowSec + 60;
}

// ---------------------------------------------------------------- reads

export interface TokenInfo {
  address: Address;
  symbol: string;
  decimals: number;
  multiplierWad: bigint; // uiMultiplier(), 1e18 = 1.0
  pendingMultiplierWad: bigint; // newUIMultiplier()
  effectiveAt: number; // effectiveAt() of the pending/last scheduled update
  registryMultiplierWad: bigint;
  registryPaused: boolean;
  transferPaused: boolean;
}

export async function readTokenInfo(client: PublicClient, token: Address): Promise<TokenInfo> {
  const address = getAddress(token);
  const c = { address, abi: b20Abi } as const;
  const [symbol, decimals, m, nm, eff, reg, tp] = await Promise.all([
    client.readContract({ ...c, functionName: 'symbol' }),
    client.readContract({ ...c, functionName: 'decimals' }),
    client.readContract({ ...c, functionName: 'uiMultiplier' }),
    client.readContract({ ...c, functionName: 'newUIMultiplier' }),
    client.readContract({ ...c, functionName: 'effectiveAt' }),
    client.readContract({ address: ORACLE_REGISTRY, abi: oracleRegistryAbi, functionName: 'getOracleParams', args: [address] }),
    client.readContract({ ...c, functionName: 'isPaused', args: [0] }).catch(() => false), // PausableFeature.TRANSFER
  ]);
  return {
    address,
    symbol,
    decimals,
    multiplierWad: m,
    pendingMultiplierWad: nm,
    effectiveAt: Number(eff),
    registryMultiplierWad: reg[0],
    registryPaused: reg[1],
    transferPaused: tp,
  };
}

export interface FeedRead {
  feed: Address;
  description: string;
  answer8: bigint; // USD per whole raw token, 8 decimals
  updatedAt: number;
}

export async function readStockFeed(client: PublicClient, token: Address): Promise<FeedRead | null> {
  const entry = STOCK_FEEDS[token.toLowerCase()];
  if (!entry) return null;
  const [round, decimals, description] = await Promise.all([
    client.readContract({ address: entry.feed, abi: aggregatorV3Abi, functionName: 'latestRoundData' }),
    client.readContract({ address: entry.feed, abi: aggregatorV3Abi, functionName: 'decimals' }),
    client.readContract({ address: entry.feed, abi: aggregatorV3Abi, functionName: 'description' }),
  ]);
  // Feed must be the one for this token ("Coinbase SNDK" <-> SNDKc) and must be 8 decimals.
  const ticker = entry.symbol.replace(/c$/, '');
  if (description.trim() !== `Coinbase ${ticker}`) throw new Error(`feed ${entry.feed} is "${description}", expected Coinbase ${ticker}`);
  if (decimals !== 8) throw new Error(`feed ${entry.feed} has ${decimals} decimals, expected 8`);
  return { feed: entry.feed, description, answer8: round[1] > 0n ? round[1] : 0n, updatedAt: Number(round[3]) };
}

export interface NavRecord {
  symbol: string;
  address: Address;
  multiplier: number;
  navPrice: number | null;
  navUpdatedAt: number | null;
}

let navCache: { at: number; map: Map<string, NavRecord> } | null = null;

/** Coinbase Tokenized Stocks API (no key). Cached 60 s per process. */
export async function fetchNavMap(fetchImpl: typeof fetch = fetch, ttlMs = 60_000): Promise<Map<string, NavRecord>> {
  if (navCache && Date.now() - navCache.at < ttlMs) return navCache.map;
  const map = new Map<string, NavRecord>();
  let pageToken: string | undefined;
  for (let i = 0; i < 20; i++) {
    const url = COINBASE_STOCKS_API + (pageToken ? `?page_token=${encodeURIComponent(pageToken)}` : '');
    const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`Coinbase stocks API ${res.status}`);
    const j = (await res.json()) as { tokens: any[]; next_page_token?: string };
    for (const t of j.tokens) {
      map.set(String(t.contract_address).toLowerCase(), {
        symbol: t.symbol,
        address: getAddress(t.contract_address),
        multiplier: Number(t.multiplier ?? 1),
        navPrice: typeof t.nav_price === 'number' ? t.nav_price : null,
        navUpdatedAt: t.nav_price_updated_at ? Math.floor(Date.parse(t.nav_price_updated_at) / 1000) : null,
      });
    }
    pageToken = j.next_page_token || undefined;
    if (!pageToken) break;
  }
  navCache = { at: Date.now(), map };
  return map;
}

export function usdTo8(x: number): bigint {
  return BigInt(Math.round(x * 1e8));
}

export interface TwapRead {
  pool: Address;
  windowSec: number;
  answer8: bigint; // USD per whole raw token
}

/** Pick the deepest USDC Slipstream pool (by USDC held) for the token. */
export async function findUsdcPool(client: PublicClient, token: Address): Promise<Address | null> {
  const candidates = SLIPSTREAM_FACTORIES.flatMap((factory) =>
    SLIPSTREAM_TICK_SPACINGS.map((ts) => ({ factory, ts })),
  );
  const pools = await Promise.all(
    candidates.map(({ factory, ts }) =>
      client
        .readContract({ address: factory, abi: clFactoryAbi, functionName: 'getPool', args: [token, USDC, ts] })
        .catch(() => null),
    ),
  );
  const live = [...new Set(pools.filter((p): p is Address => !!p && BigInt(p) !== 0n))];
  if (live.length === 0) return null;
  const bals = await Promise.all(
    live.map((p) => client.readContract({ address: USDC, abi: b20Abi, functionName: 'balanceOf', args: [p] }).catch(() => 0n)),
  );
  let best = 0;
  for (let i = 1; i < live.length; i++) if (bals[i]! > bals[best]!) best = i;
  return bals[best]! > 0n ? live[best]! : null;
}

/** 30-minute TWAP (falls back to 10 / 5 minutes if the oracle buffer is short). */
export async function readPoolTwap(
  client: PublicClient,
  token: Address,
  tokenDecimals: number,
  pool?: Address | null,
): Promise<TwapRead | null> {
  const p = pool ?? (await findUsdcPool(client, token));
  if (!p) return null;
  const [t0] = await Promise.all([client.readContract({ address: p, abi: clPoolAbi, functionName: 'token0' })]);
  const stockIsToken0 = t0.toLowerCase() === token.toLowerCase();
  for (const windowSec of [1800, 600, 300]) {
    try {
      const [ticks] = await client.readContract({ address: p, abi: clPoolAbi, functionName: 'observe', args: [[windowSec, 0]] });
      const avgTick = Number(ticks[1]! - ticks[0]!) / windowSec;
      // price = token1 raw per token0 raw
      const p1per0 = Math.pow(1.0001, avgTick);
      const usdcDec = 6;
      const usdPerToken = stockIsToken0
        ? p1per0 * 10 ** (tokenDecimals - usdcDec)
        : (1 / p1per0) * 10 ** (tokenDecimals - usdcDec);
      if (!Number.isFinite(usdPerToken) || usdPerToken <= 0) return null;
      return { pool: p, windowSec, answer8: usdTo8(usdPerToken) };
    } catch {
      // try a shorter window
    }
  }
  return null;
}

// ---------------------------------------------------------------- mark

export type MarkSource = 'chainlink' | 'nav' | 'twap';

export interface ReferenceMark {
  source: MarkSource;
  /** USD per whole raw token (10^decimals raw units), 8 decimals. Already includes the multiplier (total return). */
  usdPerToken8: bigint;
  updatedAt: number;
  phase: MarketPhase;
  /** Feed/NAV is frozen (weekend, holiday, overnight gap with no update): DEX price can jump at the next open. */
  reopenGapRisk: boolean;
  /** Last official value (frozen feed / NAV), kept for drift checks when the mark comes from the pool. */
  lastClose8: bigint | null;
  lastCloseAt: number | null;
  twapPool?: Address;
  notes: string[];
}

export interface MarkInputs {
  feed: FeedRead | null;
  nav: NavRecord | null;
  twap: TwapRead | null;
  nowSec: number;
}

/** Pure selection: fresh Chainlink, else fresh NAV, else pool TWAP. */
export function selectMark({ feed, nav, twap, nowSec }: MarkInputs): ReferenceMark | null {
  const phase = marketPhase(nowSec);
  const notes: string[] = [];
  const lastClose8 = feed && feed.answer8 > 0n ? feed.answer8 : nav?.navPrice ? usdTo8(nav.navPrice) : null;
  const lastCloseAt = feed && feed.answer8 > 0n ? feed.updatedAt : nav?.navUpdatedAt ?? null;

  if (feed && feed.answer8 > 0n) {
    if (isMarkFresh(feed.updatedAt, nowSec)) {
      return { source: 'chainlink', usdPerToken8: feed.answer8, updatedAt: feed.updatedAt, phase, reopenGapRisk: false, lastClose8, lastCloseAt, notes };
    }
    notes.push(`chainlink feed frozen since ${new Date(feed.updatedAt * 1000).toISOString()} (phase ${phase})`);
  } else {
    notes.push('no chainlink feed for this token');
  }
  if (nav?.navPrice && nav.navUpdatedAt) {
    if (isMarkFresh(nav.navUpdatedAt, nowSec)) {
      return { source: 'nav', usdPerToken8: usdTo8(nav.navPrice), updatedAt: nav.navUpdatedAt, phase, reopenGapRisk: false, lastClose8, lastCloseAt, notes };
    }
    notes.push(`coinbase nav_price stale since ${new Date(nav.navUpdatedAt * 1000).toISOString()}`);
  } else {
    notes.push('no coinbase nav_price');
  }
  if (twap && twap.answer8 > 0n) {
    return {
      source: 'twap',
      usdPerToken8: twap.answer8,
      updatedAt: nowSec,
      phase,
      reopenGapRisk: true,
      lastClose8,
      lastCloseAt,
      twapPool: twap.pool,
      notes: [...notes, `using ${twap.windowSec / 60}-min pool TWAP ${twap.pool}`],
    };
  }
  return null;
}

export async function getReferenceMark(
  client: PublicClient,
  token: Address,
  opts: { nowSec?: number; decimals?: number; fetchImpl?: typeof fetch } = {},
): Promise<ReferenceMark | null> {
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const decimals = opts.decimals ?? (await client.readContract({ address: token, abi: b20Abi, functionName: 'decimals' }));
  const [feed, navMap] = await Promise.all([
    readStockFeed(client, token).catch(() => null),
    fetchNavMap(opts.fetchImpl).catch(() => new Map<string, NavRecord>()),
  ]);
  const nav = navMap.get(token.toLowerCase()) ?? null;
  const needTwap = !(feed && isMarkFresh(feed.updatedAt, nowSec)) && !(nav?.navUpdatedAt && isMarkFresh(nav.navUpdatedAt, nowSec));
  const twap = needTwap ? await readPoolTwap(client, token, decimals).catch(() => null) : null;
  return selectMark({ feed, nav, twap, nowSec });
}

/** USD value of an input amount (6-decimal micro-USD). USDC = $1; ETH/WETH via Chainlink ETH/USD. */
export async function usdValueOfInput(
  client: PublicClient,
  sellToken: Address,
  sellAmount: bigint,
  fallbackUsd?: number,
): Promise<{ usd6: bigint; source: 'usdc' | 'chainlink-eth' | 'aggregator' }> {
  const t = sellToken.toLowerCase();
  if (t === USDC.toLowerCase()) return { usd6: sellAmount, source: 'usdc' };
  if (t === NATIVE_ETH.toLowerCase() || t === WETH.toLowerCase()) {
    const r = await client.readContract({ address: ETH_USD_FEED, abi: aggregatorV3Abi, functionName: 'latestRoundData' });
    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec - Number(r[3]) > 2 * 3600) throw new Error('ETH/USD feed stale');
    // sellAmount (1e18) * price (1e8) / 1e20 = 1e6
    return { usd6: (sellAmount * r[1]) / 10n ** 20n, source: 'chainlink-eth' };
  }
  if (fallbackUsd === undefined) throw new Error('cannot value input token without an aggregator USD estimate');
  return { usd6: BigInt(Math.floor(fallbackUsd * 1e6)), source: 'aggregator' };
}
