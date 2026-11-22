// Server-side data access. Live files come from the indexer's public bucket; any file
// that is missing, slow or malformed falls back to the sample generator, per file.
import 'server-only';
import { rawGet } from './rawget';
import type { IndexFile, MoverRow, MoversFile, MoversWindow, NotableLine, StatsFile, TokenSummary, WalletShard, WalletSummary } from '@shared/types';
import { shortName } from '@/lib/clubs';
import { mockIndex, mockStats, mockShard, mockSeats, mockExamples } from '@/mock/generate';

export type Source = 'live' | 'mock';
export interface Sourced<T> {
  data: T;
  source: Source;
}

const BASE = (process.env.DATA_BASE_URL || 'https://storage.googleapis.com/tropaclub-data/public').replace(/\/$/, '');
const MODE: Source = process.env.DATA_SOURCE === 'mock' ? 'mock' : 'live';
export const dataBaseUrl = BASE;

// Per-instance memo on top of Next's fetch cache. A hit lasts 5 minutes, a miss 1 minute,
// so a missing or slow file costs one round trip a minute, not one per request.
const memo = new Map<string, { at: number; ttl: number; p: Promise<unknown | null> }>();
/** Last good body and ETag per file: a 304 keeps the body, so a check costs almost nothing. */
const lastGood = new Map<string, { etag: string | null; body: unknown }>();

/**
 * The indexer rewrites its files about every 6 hours and pages must show a new count within a
 * minute or two. So a file is checked at most once a minute (ttlSec), past every cache on the way:
 * not Next's fetch at all (rawGet: inside a cached page's background render an uncached fetch
 * throws, and a cached one would keep a copy per minute), and not Google's edge cache for public objects, which honours
 * the files' max-age=300 per URL (a per-minute query string). The ETag makes an unchanged file a
 * cheap 304. On any failure the last good copy is served.
 */
function fetchJson(path: string, ttlSec = 60, timeoutMs = 4000): Promise<unknown | null> {
  if (MODE === 'mock') return Promise.resolve(null);
  const now = Date.now();
  const hit = memo.get(path);
  if (hit && now - hit.at < hit.ttl) return hit.p;
  const entry = { at: now, ttl: Math.min(ttlSec, 60) * 1000, p: Promise.resolve<unknown | null>(null) };
  entry.p = (async () => {
    const prev = lastGood.get(path);
    try {
      const res = await rawGet(`${BASE}/${path}?m=${Math.floor(now / 60_000)}`, { timeoutMs, etag: prev?.etag });
      if (res.status === 304 && prev) return prev.body;
      if (res.status >= 200 && res.status < 300) {
        const body = JSON.parse(res.text) as unknown;
        if (lastGood.size > 400) lastGood.clear();
        lastGood.set(path, { etag: res.etag, body });
        return body;
      }
    } catch {
      /* fall through */
    }
    if (prev) return prev.body;
    entry.ttl = 30_000;
    return null;
  })();
  if (memo.size > 400) memo.clear();
  memo.set(path, entry);
  return entry.p;
}

const num = (v: unknown, d = 0): number => (typeof v === 'number' && isFinite(v) ? v : d);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);

function cleanToken(raw: unknown): TokenSummary | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.symbol !== 'string' || !r.symbol) return null;
  const gh = (r.ghosts && typeof r.ghosts === 'object' ? r.ghosts : {}) as Record<string, unknown>;
  const holdersTotal = Math.max(0, Math.round(num(r.holdersTotal)));
  const realFans = Math.max(0, Math.min(holdersTotal, Math.round(num(r.realFans))));
  return {
    address: (typeof r.address === 'string' ? r.address : '0x') as `0x${string}`,
    symbol: r.symbol,
    // short display name everywhere ("NVIDIA", not "NVIDIA Corporation")
    name: shortName(typeof r.name === 'string' && r.name ? r.name : r.symbol.replace(/c$/, ''), r.symbol),
    logo: typeof r.logo === 'string' ? r.logo : undefined,
    priceUsd: numOrNull(r.priceUsd),
    navUsd: numOrNull(r.navUsd),
    multiplier: num(r.multiplier, 1),
    holdersTotal,
    realFans,
    ghosts: { dust: Math.max(0, num(gh.dust)), farmerOnly: Math.max(0, num(gh.farmerOnly)), contracts: Math.max(0, num(gh.contracts)) },
    attendancePct: holdersTotal > 0 ? (realFans / holdersTotal) * 100 : 0,
    top10SharePct: num(r.top10SharePct, NaN),
    top10ShareExPoolsPct: num(r.top10ShareExPoolsPct, NaN),
    weeklyBuyers: Math.max(0, num(r.weeklyBuyers)),
    newBuyers7d: Math.max(0, num(r.newBuyers7d)),
    medianWeeklyBuyUsd: numOrNull(r.medianWeeklyBuyUsd),
    hasReferenceMark: r.hasReferenceMark === true,
    priceSource: r.priceSource === 'dex' || r.priceSource === 'reference' ? r.priceSource : null,
  };
}

export async function getIndex(): Promise<Sourced<IndexFile>> {
  const raw = (await fetchJson('index.json')) as Record<string, unknown> | null;
  if (raw && Array.isArray(raw.tokens)) {
    const tokens = raw.tokens.map(cleanToken).filter((t): t is TokenSummary => !!t && t.holdersTotal > 0);
    if (tokens.length) {
      tokens.sort((a, b) => b.realFans - a.realFans || b.holdersTotal - a.holdersTotal);
      return { source: 'live', data: { asOf: typeof raw.asOf === 'string' ? raw.asOf : new Date().toISOString(), block: num(raw.block), tokens } };
    }
  }
  return { source: 'mock', data: mockIndex() };
}

export async function getStats(): Promise<Sourced<StatsFile>> {
  const raw = (await fetchJson('stats.json')) as Record<string, unknown> | null;
  if (raw && typeof raw.realWallets === 'number' && typeof raw.holdersTotal === 'number') {
    const weeks = Array.isArray(raw.weeklyBuyers) ? raw.weeklyBuyers : [];
    return {
      source: 'live',
      data: {
        asOf: typeof raw.asOf === 'string' ? raw.asOf : '',
        holdersTotal: num(raw.holdersTotal),
        realWallets: num(raw.realWallets),
        realWallets100: num(raw.realWallets100),
        tokensMinted: num(raw.tokensMinted),
        totalValueUsd: num(raw.totalValueUsd),
        weeklyBuyers: weeks
          .filter((w): w is Record<string, unknown> => !!w && typeof w === 'object')
          .map((w) => ({ weekStart: String(w.weekStart ?? ''), buyers: num(w.buyers), newBuyers: num(w.newBuyers), medianBuyUsd: num(w.medianBuyUsd) }))
          .filter((w) => w.weekStart && w.buyers > 0),
      },
    };
  }
  return { source: 'mock', data: mockStats() };
}

export async function getToken(symbol: string): Promise<{ token: TokenSummary | null; index: Sourced<IndexFile> }> {
  const index = await getIndex();
  const want = symbol.toLowerCase();
  const token = index.data.tokens.find((t) => t.symbol.toLowerCase() === want) ?? index.data.tokens.find((t) => t.symbol.toLowerCase() === `${want}c`) ?? null;
  return { token, index };
}

/** Wallet lookup follows the index: if the index is sample data, so is the wallet. */
export async function getWallet(address: string): Promise<Sourced<WalletSummary | null>> {
  const a = address.toLowerCase();
  const index = await getIndex();
  if (index.source === 'live') {
    const shard = (await fetchJson(`wallets/${a.slice(2, 4)}.json`)) as WalletShard | null;
    if (shard && typeof shard === 'object') {
      const w = shard[a] as WalletSummary | undefined;
      if (!w || !Array.isArray(w.tokens)) return { source: 'live', data: null };
      return {
        source: 'live',
        data: {
          totalUsd: num(w.totalUsd),
          firstSeen: numOrNull(w.firstSeen),
          tokens: w.tokens
            .filter((t) => t && typeof t.symbol === 'string')
            .map((t) => ({ symbol: t.symbol, usd: num(t.usd), kind: t.kind ?? 'dust', rank: numOrNull(t.rank), of: num(t.of), bestStat: t.bestStat && typeof t.bestStat.pct === 'number' ? t.bestStat : null })),
        },
      };
    }
    // The live index exists but this shard does not yet: say "not found" rather than invent a wallet.
    return { source: 'live', data: null };
  }
  const { mockWallet } = await import('@/mock/generate');
  return { source: 'mock', data: mockWallet(a) };
}

/** Seat file as a web Response body, streamed from the bucket or generated. */
export async function getSeatsResponse(symbol: string): Promise<{ body: BodyInit; source: Source } | null> {
  const { token, index } = await getToken(symbol);
  if (!token) return null;
  if (index.source === 'live') {
    try {
      const res = await fetch(`${BASE}/tokens/${encodeURIComponent(token.symbol)}.json`, { cache: 'no-store', signal: AbortSignal.timeout(12000) });
      if (res.ok && res.body) return { body: res.body, source: 'live' };
    } catch {
      /* fall through */
    }
    return null;
  }
  const file = mockSeats(token.symbol);
  return file ? { body: JSON.stringify(file), source: 'mock' } : null;
}

// Real fans of one club, in rank order (rank = index + 1), as bare addresses. The seat file can be
// several megabytes, so only this compact list is kept, for 15 minutes.
const realMemo = new Map<string, { at: number; p: Promise<string[] | null> }>();
export function getRealSeats(symbol: string): Promise<string[] | null> {
  const hit = realMemo.get(symbol);
  if (hit && Date.now() - hit.at < 15 * 60_000) return hit.p;
  const p = (async () => {
    if (MODE === 'mock') return null;
    try {
      // (outside Next's fetch: this runs inside cached page renders too, see rawget.ts)
      const res = await rawGet(`${BASE}/tokens/${encodeURIComponent(symbol)}.json`, { timeoutMs: 12000 });
      if (res.status !== 200) return null;
      const file = JSON.parse(res.text) as { seats?: { a?: string; k?: string }[] };
      const out: string[] = [];
      for (const x of file.seats ?? []) {
        if (x.k !== 'real') break; // real fans come first
        out.push(typeof x.a === 'string' ? x.a : '');
      }
      return out;
    } catch {
      return null;
    }
  })();
  p.then((v) => v == null && realMemo.delete(symbol));
  if (realMemo.size > 120) realMemo.clear();
  realMemo.set(symbol, { at: Date.now(), p });
  return p;
}

/** The fans sitting either side of a rank, or null if the seat list is slow or missing. */
export async function getNeighbours(symbol: string, rank: number, ms = 2500): Promise<{ rank: number; address: string }[] | null> {
  const list = await Promise.race([getRealSeats(symbol), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
  if (!list) return null;
  return [rank - 2, rank - 1, rank + 1, rank + 2]
    .filter((r) => r >= 1 && r <= list.length && /^0x[0-9a-f]{40}$/.test(list[r - 1]))
    .map((r) => ({ rank: r, address: list[r - 1] }));
}

/** A few real fans for the "try a fan" chips: taken from the busiest club's seat list when data is live. */
export async function getExamples(): Promise<string[]> {
  const index = await getIndex();
  if (index.source === 'mock') return mockExamples();
  const real = ((await getRealSeats(index.data.tokens[0].symbol)) ?? []).filter((a) => /^0x[0-9a-f]{40}$/.test(a) && !/^0x0{20}|dead$/i.test(a));
  if (real.length < 3) return [];
  // one early fan, one from the middle, one recent: spread across the ground
  return [real[Math.floor(real.length * 0.04)], real[Math.floor(real.length * 0.45)], real[Math.floor(real.length * 0.85)]];
}

// ---------------------------------------------------------------------------------------------
// Time series and movers. Both are live-only: a missing or malformed file returns null and the
// widget that uses it is hidden. There is no sample fallback, so no invented history is shown.
// ---------------------------------------------------------------------------------------------

const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isIso = (v: unknown): v is string => typeof v === 'string' && !isNaN(Date.parse(v));
const count = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) && v >= 0 ? Math.round(v) : null);

export interface HistoryPoint {
  /** YYYY-MM-DD, UTC */
  day: string;
  /** null: no count exists for that day (a gap, never a zero) */
  real: number | null;
  holders: number | null;
}

export interface WeekChange {
  now: number;
  then: number;
  diff: number;
  /** null when there were no real holders 7 days earlier */
  pct: number | null;
  thenDay: string;
}

export interface GroundHistory {
  symbol: string;
  asOf: string;
  /** From the first day with any holder; the last point is today so far when partial is true. */
  points: HistoryPoint[];
  partial: boolean;
  /** Days inside the range with no count. */
  gaps: number;
  week: WeekChange | null;
}

/**
 * One series, checked against the file's day list and cut to start at the ground's first day.
 * Returns null unless the arrays line up and there are at least two days to draw.
 */
export function shapeHistory(raw: unknown, daysRaw: unknown, missingRaw: unknown, asOf: string, partial: boolean): GroundHistory | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray(daysRaw) || !daysRaw.length || !daysRaw.every(isDay)) return null;
  const s = raw as Record<string, unknown>;
  const days = daysRaw as string[];
  if (typeof s.symbol !== 'string' || !Array.isArray(s.realFans) || !Array.isArray(s.holdersTotal)) return null;
  if (s.realFans.length !== days.length || s.holdersTotal.length !== days.length) return null;
  const missing = new Set(Array.isArray(missingRaw) ? missingRaw.filter(isDay) : []);
  const realArr = s.realFans as unknown[];
  const holdArr = s.holdersTotal as unknown[];
  const all: HistoryPoint[] = days.map((day, i) => {
    if (missing.has(day)) return { day, real: null, holders: null };
    const holders = count(holdArr[i]);
    const real = count(realArr[i]);
    return { day, holders, real: real == null || holders == null ? real : Math.min(real, holders) };
  });
  const launch = isDay(s.launchDay) ? days.indexOf(s.launchDay) : -1;
  const start = launch >= 0 ? launch : all.findIndex((p) => (p.holders ?? 0) > 0);
  if (start < 0) return null;
  const points = all.slice(start);
  if (points.length < 2 || !points.some((p) => (p.real ?? 0) > 0)) return null;
  return {
    symbol: s.symbol,
    asOf,
    points,
    partial,
    gaps: points.filter((p) => p.real == null).length,
    week: weekChange(all),
  };
}

/** Real holders on the last day against the same count 7 days earlier (before launch counts as 0). */
export function weekChange(points: HistoryPoint[]): WeekChange | null {
  if (points.length < 8) return null;
  const last = points[points.length - 1];
  const prev = points[points.length - 8];
  if (last.real == null || prev.real == null) return null;
  const diff = last.real - prev.real;
  return { now: last.real, then: prev.real, diff, pct: prev.real > 0 ? Math.round((diff / prev.real) * 1000) / 10 : null, thenDay: prev.day };
}

/** The history of one ground, from attendance-history.json or, when split, its own file. */
export async function getGroundHistory(symbol: string): Promise<GroundHistory | null> {
  try {
    let top = (await fetchJson('attendance-history.json')) as Record<string, unknown> | null;
    if (!top || (!Array.isArray(top.tokens) && top.split !== true)) top = (await fetchJson('attendance-history/index.json')) as Record<string, unknown> | null;
    if (!top || !isIso(top.asOf)) return null;
    const partial = top.todayPartial !== false;
    if (Array.isArray(top.tokens)) {
      const series = top.tokens.find((t) => !!t && typeof t === 'object' && (t as { symbol?: unknown }).symbol === symbol);
      return series ? shapeHistory(series, top.days, top.missingDays, top.asOf, partial) : null;
    }
    if (top.split === true && Array.isArray(top.symbols) && top.symbols.includes(symbol)) {
      const series = await fetchJson(`attendance-history/${encodeURIComponent(symbol)}.json`);
      return shapeHistory(series, top.days, top.missingDays, top.asOf, partial);
    }
  } catch {
    /* hidden, never an error page */
  }
  return null;
}

function cleanMover(raw: unknown): MoverRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.symbol !== 'string' || !r.symbol) return null;
  const realFansNow = count(r.realFansNow);
  const realFansThen = count(r.realFansThen);
  if (realFansNow == null || realFansThen == null) return null;
  return {
    symbol: r.symbol,
    name: typeof r.name === 'string' && r.name ? r.name : r.symbol,
    realFansNow,
    realFansThen,
    change: realFansNow - realFansThen,
    changePct: numOrNull(r.changePct),
    newRealFans: count(r.newRealFans) ?? 0,
    holdersNow: count(r.holdersNow) ?? 0,
    attendancePctNow: num(r.attendancePctNow),
  };
}

function cleanWindow(raw: unknown): MoversWindow | null {
  if (!raw || typeof raw !== 'object') return null;
  const w = raw as Record<string, unknown>;
  if ((w.window !== '24h' && w.window !== '7d') || !isIso(w.from) || !isIso(w.to)) return null;
  const rows = (v: unknown) => (Array.isArray(v) ? v.map(cleanMover).filter((r): r is MoverRow => !!r) : []);
  const pctMinBase = Math.max(1, num(w.pctMinBase, 10));
  const t = (w.totals && typeof w.totals === 'object' ? w.totals : {}) as Record<string, unknown>;
  return {
    window: w.window,
    from: w.from,
    to: w.to,
    hours: num(w.hours),
    baselineBlock: num(w.baselineBlock),
    byChange: rows(w.byChange),
    // the baseline rule is applied here as well, so a row under it can never reach the % list
    byChangePct: rows(w.byChangePct).filter((r) => r.changePct != null && r.realFansThen >= pctMinBase),
    pctMinBase,
    byNewRealFans: rows(w.byNewRealFans).filter((r) => r.newRealFans > 0),
    totals: {
      realFansNow: num(t.realFansNow), realFansThen: num(t.realFansThen), realFansChange: num(t.realFansChange),
      holdersNow: num(t.holdersNow), holdersThen: num(t.holdersThen), holdersChange: num(t.holdersChange),
      uniqueHoldersNow: num(t.uniqueHoldersNow), uniqueHoldersThen: num(t.uniqueHoldersThen),
      newWallets: num(t.newWallets), newBuyerWallets: num(t.newBuyerWallets),
    },
  };
}

/** movers.json, checked. Null when nothing in it is usable. */
export function cleanMovers(raw: unknown): MoversFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (!isIso(m.asOf)) return null;
  const windows = Array.isArray(m.windows) ? m.windows.map(cleanWindow).filter((w): w is MoversWindow => !!w) : [];
  const notable: NotableLine[] = [];
  for (const n of Array.isArray(m.notable) ? m.notable : []) {
    if (!n || typeof n !== 'object') continue;
    const r = n as Record<string, unknown>;
    if (typeof r.key !== 'string' || typeof r.text !== 'string' || !r.text.trim()) continue;
    if (r.window !== '24h' && r.window !== '7d' && r.window !== 'now') continue;
    notable.push({ key: r.key, window: r.window, symbol: typeof r.symbol === 'string' && r.symbol ? r.symbol : undefined, value: num(r.value), text: r.text.trim() });
  }
  if (!windows.length && !notable.length) return null;
  return { asOf: m.asOf, block: num(m.block), windows, notable };
}

export async function getMovers(): Promise<MoversFile | null> {
  try {
    return cleanMovers(await fetchJson('movers.json'));
  } catch {
    return null;
  }
}

/** The one line for the home page: new wallets this week first, then the 7-day total, then any 7-day line. */
export function pickHomeNotable(m: MoversFile | null): NotableLine | null {
  if (!m) return null;
  for (const key of ['new-wallets-7d', 'total-7d', 'top-new-7d', 'top-gain-7d']) {
    const hit = m.notable.find((n) => n.key === key);
    if (hit) return hit;
  }
  return m.notable.find((n) => n.window === '7d') ?? null;
}

export { mockShard };
