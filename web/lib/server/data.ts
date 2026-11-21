// Server-side data access. Live files come from the indexer's public bucket; any file
// that is missing, slow or malformed falls back to the sample generator, per file.
import 'server-only';
import type { IndexFile, StatsFile, TokenSummary, WalletShard, WalletSummary } from '@shared/types';
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

function fetchJson(path: string, revalidate = 300, timeoutMs = 4000, big = false): Promise<unknown | null> {
  if (MODE === 'mock') return Promise.resolve(null);
  const now = Date.now();
  const hit = memo.get(path);
  if (hit && now - hit.at < hit.ttl) return hit.p;
  const entry = { at: now, ttl: revalidate * 1000, p: Promise.resolve<unknown | null>(null) };
  entry.p = (async () => {
    try {
      // files over 2 MB cannot go in Next's data cache; the memo above is their only cache
      const res = await fetch(`${BASE}/${path}`, { ...(big ? { cache: 'no-store' as const } : { next: { revalidate } }), signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return await res.json();
    } catch {
      /* fall through */
    }
    entry.ttl = 60_000;
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

/** A few real fans for the "try a fan" chips: taken from the busiest club's seat list when data is live. */
export async function getExamples(): Promise<string[]> {
  const index = await getIndex();
  if (index.source === 'mock') return mockExamples();
  const top = index.data.tokens[0];
  const file = (await fetchJson(`tokens/${encodeURIComponent(top.symbol)}.json`, 900, 12000, true)) as { seats?: { a?: string; k?: string; usd?: number; holdDays?: number }[] } | null;
  const real = (file?.seats ?? []).filter(
    (x) => x.k === 'real' && typeof x.a === 'string' && /^0x[0-9a-f]{40}$/.test(x.a) && !/^0x0{20}|dead$/i.test(x.a) && (x.usd ?? 0) >= 10 && (x.usd ?? 0) <= 5000,
  );
  if (real.length < 3) return [];
  // one early fan, one from the middle, one recent: spread across the ground
  return [real[Math.floor(real.length * 0.04)], real[Math.floor(real.length * 0.45)], real[Math.floor(real.length * 0.85)]].map((x) => x.a!);
}

export { mockShard };
