// Sample data generator. Follows shared/types.ts and the measured Nov 21 numbers
// (ONCHAIN-RESULTS.json) for the seven clubs that were counted by hand. Everything
// else is simulated. Deterministic: the same input always gives the same output.

import type { IndexFile, Seat, SeatKind, StatsFile, TokenSeatsFile, TokenSummary, WalletShard, WalletSummary, BestStatKey } from '@shared/types';
import TOKENS from './tokens.json';

const AS_OF = '2026-11-21T16:25:00.000Z';
const AS_OF_SEC = Date.parse(AS_OF) / 1000;
const BLOCK = 60439800;
const MINT0 = Date.UTC(2026, 7, 12) / 1000;
const UNIVERSE = 39746;
const REAL_POOL = 4968;

// symbol: [price, holders, real, dust, farmerOnly, contracts, top10, top10ExPools, weeklyBuyers, newBuyers7d, medianBuy]
const MEASURED: Record<string, number[]> = {
  NVDAc: [130.22, 17685, 1613, 8432, 6288, 1352, 76.59, 57.66, 2412, 931, 9.4],
  GOOGLc: [272.1, 11667, 1059, 4950, 4887, 771, 86.38, 71.25, 1688, 652, 10.2],
  SPCXc: [130.52, 9763, 899, 4767, 3447, 650, 71.54, 54.86, 1503, 580, 8.1],
  METAc: [569.9, 6641, 633, 3293, 2199, 516, 89.08, 76.39, 874, 337, 11.0],
  TSLAc: [353.77, 8324, 484, 3481, 3912, 447, 80.59, 69.0, 1126, 434, 6.3],
  MSTRc: [80.062, 3749, 483, 2851, 33, 382, 72.95, 34.72, 641, 247, 12.5],
  ANTc: [89.29, 843, 286, 426, 6, 125, 89.76, 51.61, 212, 82, 21.0],
};
const UNPRICED = new Set(
  'APPc PFEc SOUNc MRKc HTZc LRCXc MPc RIVNc SOFIc DJTc WENc PYPLc BIRDc QCOMc RBLXc CRMc RDDTc CBRSc VSTc PMc WDCc JNJc PTONc LULUc DUOLc VRTc UNHc NVAXc QUBTc AMCc GTLBc BACc CMGc ANETc RKLBc BMNRc CRWVc CAKEc'.split(' '),
);

function rnd(seed: number): number {
  let a = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function strHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

const addrCache = new Map<number, string>();
function addr(i: number): string {
  let a = addrCache.get(i);
  if (!a) {
    a = '0x';
    for (let k = 0; k < 5; k++) a += Math.floor(rnd(i * 5 + k + 99) * 4294967296).toString(16).padStart(8, '0');
    addrCache.set(i, a);
  }
  return a;
}

function summaries(): TokenSummary[] {
  const out: TokenSummary[] = [];
  for (const row of TOKENS as (string | number)[][]) {
    const symbol = String(row[0]);
    const name = String(row[1]);
    const h = strHash(symbol);
    const m = MEASURED[symbol];
    let t: TokenSummary;
    if (m) {
      t = {
        address: row[2] as `0x${string}`, symbol, name, priceUsd: m[0], navUsd: +(m[0] * 0.995).toFixed(2), multiplier: Number(row[3]) || 1,
        holdersTotal: m[1], realFans: m[2], ghosts: { dust: m[3], farmerOnly: m[4], contracts: m[5] },
        attendancePct: (m[2] / m[1]) * 100, top10SharePct: m[6], top10ShareExPoolsPct: m[7],
        weeklyBuyers: m[8], newBuyers7d: m[9], medianWeeklyBuyUsd: m[10], hasReferenceMark: true,
      };
    } else if (UNPRICED.has(symbol)) {
      const holders = 12 + Math.floor(rnd(h) * rnd(h + 1) * 420);
      const contracts = Math.min(holders - 1, 2 + Math.floor(rnd(h + 2) * 9));
      t = {
        address: row[2] as `0x${string}`, symbol, name, priceUsd: null, navUsd: null, multiplier: Number(row[3]) || 1,
        holdersTotal: holders, realFans: 0, ghosts: { dust: holders - contracts, farmerOnly: 0, contracts },
        attendancePct: 0, top10SharePct: 90 + rnd(h + 3) * 9, top10ShareExPoolsPct: 60 + rnd(h + 4) * 30,
        weeklyBuyers: Math.floor(rnd(h + 5) * 12), newBuyers7d: Math.floor(rnd(h + 6) * 5), medianWeeklyBuyUsd: null, hasReferenceMark: false,
      };
    } else {
      const holders = 160 + Math.floor(Math.pow(rnd(h), 2.2) * 3100);
      const real = Math.max(6, Math.floor(holders * (0.05 + rnd(h + 1) * 0.2)));
      const contracts = Math.floor(holders * (0.04 + rnd(h + 2) * 0.06));
      const farmer = Math.floor((holders - real - contracts) * rnd(h + 3) * 0.55);
      const wb = Math.floor(real * (0.5 + rnd(h + 5)));
      t = {
        address: row[2] as `0x${string}`, symbol, name, priceUsd: +(18 + rnd(h + 7) * 520).toFixed(2), navUsd: null, multiplier: Number(row[3]) || 1,
        holdersTotal: holders, realFans: real, ghosts: { dust: holders - real - contracts - farmer, farmerOnly: farmer, contracts },
        attendancePct: (real / holders) * 100, top10SharePct: 70 + rnd(h + 8) * 22, top10ShareExPoolsPct: 34 + rnd(h + 9) * 40,
        weeklyBuyers: wb, newBuyers7d: Math.floor(wb * (0.3 + rnd(h + 6) * 0.2)), medianWeeklyBuyUsd: +(4 + rnd(h + 4) * 14).toFixed(2), hasReferenceMark: rnd(h + 10) > 0.6,
      };
    }
    out.push(t);
  }
  return out.sort((a, b) => b.realFans - a.realFans || b.holdersTotal - a.holdersTotal);
}

type Store = { index?: IndexFile; seats: Map<string, TokenSeatsFile>; wallets?: Map<string, WalletSummary> };
const g = globalThis as unknown as { __tropaMock?: Store };
const store: Store = (g.__tropaMock ??= { seats: new Map() });

export function mockIndex(): IndexFile {
  return (store.index ??= { asOf: AS_OF, block: BLOCK, tokens: summaries() });
}

export function mockStats(): StatsFile {
  return {
    asOf: AS_OF,
    holdersTotal: 39746,
    realWallets: 4968,
    realWallets100: 2117,
    weeklyBuyers: [
      { weekStart: '2026-10-24', buyers: 5021, newBuyers: 2213, medianBuyUsd: 6.3 },
      { weekStart: '2026-10-31', buyers: 6365, newBuyers: 2446, medianBuyUsd: 5.82 },
      { weekStart: '2026-11-07', buyers: 6346, newBuyers: 2187, medianBuyUsd: 5.23 },
      { weekStart: '2026-11-14', buyers: 7317, newBuyers: 2824, medianBuyUsd: 10.01 },
    ],
    tokensMinted: 90,
    totalValueUsd: 61400000,
  };
}

export function mockSeats(symbol: string): TokenSeatsFile | null {
  const hit = store.seats.get(symbol);
  if (hit) return hit;
  const t = mockIndex().tokens.find((x) => x.symbol === symbol);
  if (!t) return null;
  const h = strHash(symbol);
  const mint = MEASURED[symbol] ? MINT0 : MINT0 + Math.floor(rnd(h + 20) * 60) * 86400;
  const span = AS_OF_SEC - mint;

  const pick = (count: number, start: number, size: number, salt: number): number[] => {
    const n = Math.min(count, size);
    let step = 1 + Math.floor(rnd(h + salt) * (size - 1));
    while (gcd(step, size) !== 1) step++;
    const off = Math.floor(rnd(h + salt + 1) * size);
    const res: number[] = [];
    for (let i = 0; i < n; i++) res.push(start + ((off + i * step) % size));
    return res;
  };

  const real: Seat[] = pick(t.realFans, 0, REAL_POOL, 31).map((wi, i) => {
    const s = h + i * 13;
    const firstBuy = Math.floor(mint + Math.pow(rnd(s + 1), 0.8) * span * 0.985);
    const full = (AS_OF_SEC - firstBuy) / 86400;
    const holdDays = Math.max(0, Math.floor(rnd(s + 2) < 0.72 ? full : full * rnd(s + 3)));
    return {
      a: addr(wi), k: 'real' as SeatKind,
      usd: +(10 * Math.exp(rnd(s + 4) * rnd(s + 5) * 6.2)).toFixed(2),
      firstBuy, holdDays,
      streakWeeks: Math.floor(Math.pow(rnd(s + 6), 3) * 9),
      entryVsMedianPct: +((rnd(s + 7) - 0.5) * 38).toFixed(1),
      heldThroughGap: holdDays >= 3 && rnd(s + 8) < 0.93,
    };
  });
  real.sort((p, q) => q.holdDays - p.holdDays || (p.firstBuy ?? 0) - (q.firstBuy ?? 0));

  const ghostCount = t.holdersTotal - t.realFans;
  const ghostIdx = pick(ghostCount, REAL_POOL, UNIVERSE - REAL_POOL, 41);
  const ghosts: Seat[] = ghostIdx.map((wi, i) => {
    const s = h + 500000 + i * 11;
    const k: SeatKind = i < t.ghosts.contracts ? (i < Math.min(7, t.ghosts.contracts) ? 'pool' : 'contract') : i < t.ghosts.contracts + t.ghosts.farmerOnly ? 'farmer' : 'dust';
    const firstBuy = Math.floor(mint + rnd(s + 1) * span * 0.99);
    const usd = k === 'dust' ? rnd(s + 2) * rnd(s + 3) * 9.9 : k === 'farmer' ? 0.4 + rnd(s + 2) * 7.5 : 40 * Math.exp(rnd(s + 2) * 9);
    return {
      a: addr(wi), k, usd: +usd.toFixed(2), firstBuy,
      holdDays: Math.floor((AS_OF_SEC - firstBuy) / 86400), streakWeeks: 0, entryVsMedianPct: null, heldThroughGap: false,
    };
  });

  const file: TokenSeatsFile = { asOf: AS_OF, symbol, seats: real.concat(ghosts) };
  store.seats.set(symbol, file);
  return file;
}

function topPct(position: number, of: number): number {
  return Math.max(1, Math.min(100, Math.ceil(((position + 1) / Math.max(1, of)) * 100)));
}

function walletMap(): Map<string, WalletSummary> {
  if (store.wallets) return store.wallets;
  const map = new Map<string, WalletSummary>();
  for (const t of mockIndex().tokens) {
    const file = mockSeats(t.symbol);
    if (!file) continue;
    const real = file.seats.slice(0, t.realFans);
    const order = (cmp: (a: Seat, b: Seat) => number) => {
      const pos = new Map<string, number>();
      [...real].sort(cmp).forEach((s, i) => pos.set(s.a, i));
      return pos;
    };
    const byEarly = order((a, b) => (a.firstBuy ?? 0) - (b.firstBuy ?? 0));
    const byEntry = order((a, b) => (a.entryVsMedianPct ?? 0) - (b.entryVsMedianPct ?? 0));
    const byStreak = order((a, b) => b.streakWeeks - a.streakWeeks);
    file.seats.forEach((s, i) => {
      const w = map.get(s.a) ?? { tokens: [], totalUsd: 0, firstSeen: null };
      let bestStat: { key: BestStatKey; label: string; pct: number } | null = null;
      const isReal = i < t.realFans;
      if (isReal) {
        const cands: { key: BestStatKey; label: string; pct: number }[] = [
          { key: 'longestHold', label: `Held ${s.holdDays} days without selling out`, pct: topPct(i, t.realFans) },
          { key: 'earliest', label: 'Among the earliest buyers', pct: topPct(byEarly.get(s.a) ?? i, t.realFans) },
          { key: 'entryVsMedian', label: 'Entry price below the real-fan median', pct: topPct(byEntry.get(s.a) ?? i, t.realFans) },
        ];
        if (s.streakWeeks >= 2) cands.push({ key: 'streak', label: `${s.streakWeeks} weeks in a row with a buy`, pct: topPct(byStreak.get(s.a) ?? i, t.realFans) });
        bestStat = cands.sort((a, b) => a.pct - b.pct)[0];
      }
      w.tokens.push({ symbol: t.symbol, usd: s.usd, kind: s.k, rank: isReal ? i + 1 : null, of: t.realFans, bestStat });
      w.totalUsd = +(w.totalUsd + s.usd).toFixed(2);
      if (s.firstBuy != null && (w.firstSeen == null || s.firstBuy < w.firstSeen)) w.firstSeen = s.firstBuy;
      map.set(s.a, w);
    });
  }
  store.wallets = map;
  return map;
}

export function mockWallet(address: string): WalletSummary | null {
  return walletMap().get(address.toLowerCase()) ?? null;
}

export function mockShard(prefix: string): WalletShard {
  const out: WalletShard = {};
  for (const [a, w] of walletMap()) if (a.slice(2, 4) === prefix) out[a] = w;
  return out;
}

/** A few real-fan wallets to offer as examples next to the search field. */
export function mockExamples(symbol = 'NVDAc', count = 3): string[] {
  const f = mockSeats(symbol);
  if (!f) return [];
  return [f.seats[130], f.seats[11], f.seats[702]].filter(Boolean).slice(0, count).map((s) => s.a);
}
