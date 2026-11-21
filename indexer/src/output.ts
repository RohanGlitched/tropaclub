// Classification, per-seat metrics, rankings and the public data files (shared/types.ts).
import type { TokenSummary, IndexFile, Seat, SeatKind, TokenSeatsFile, WalletSummary, WalletTokenEntry, StatsFile, BestStatKey } from '../../shared/types.ts';
import { REAL_MIN_USD, BOT_SWAPS_PER_WEEK, CHAINLINK_SYMBOLS } from './config.ts';
import { K_CONTRACT, F_SWAP_IN, F_MINT_IN, F_XFER_IN, F_XFER_NONDIST, type State, type PairRec, type BucketRec } from './state.ts';
import { streakAt } from './replay.ts';
import { isSink } from './sinks.ts';
export { isSink };
import { coversGap, DAY, weekIdx, weekStartTs, hourIdx } from './time.ts';
import type { ApiToken } from './tokens.ts';

export interface PriceInfo { price: number | null; source: 'dex' | 'reference' | null }

export interface Outputs {
  index: IndexFile;
  seats: TokenSeatsFile[];
  wallets: Map<string, WalletSummary>;
  stats: StatsFile;
  perToken: { symbol: string; holders: number; real: number; dust: number; farmer: number; contract: number; pool: number; supplyRaw: number }[];
}

export const isFarmer = (flags: number | undefined) =>
  !!flags && !(flags & F_SWAP_IN) && !(flags & F_MINT_IN) && !!(flags & F_XFER_IN) && !(flags & F_XFER_NONDIST);

const r2 = (x: number) => Math.round(x * 100) / 100;
const r1 = (x: number) => Math.round(x * 10) / 10;
function median(a: number[]): number | null {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
// count of values <= x in ascending array
function upper(a: number[], x: number): number { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] <= x) lo = m + 1; else hi = m; } return lo; }
// count of values < x
function lower(a: number[], x: number): number { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < x) lo = m + 1; else hi = m; } return lo; }
const topPct = (better: number, n: number) => Math.max(0.1, Math.ceil((better / n) * 1000) / 10);

const LABELS: Record<BestStatKey, string> = {
  longestHold: 'Longest holders',
  earliest: 'Earliest buyers',
  entryVsMedian: 'Best entry price',
  streak: 'Weekly buy streak',
  heldThroughGap: 'Held through the weekend gap',
};

export function walletKind(s: State, pools: Set<string>, a: string): 'pool' | 'contract' | 'wallet' {
  if (pools.has(a)) return 'pool';
  if (isSink(a)) return 'contract';
  const k = s.codes.get(a);
  if (k === undefined) throw new Error(`missing code kind for ${a}`);
  return k === K_CONTRACT ? 'contract' : 'wallet';
}

export function buildOutputs(s: State, meta: Map<string, ApiToken>, prices: Map<string, PriceInfo>, pools: Set<string>, nowTs: number, block: number): Outputs {
  const asOf = new Date(nowTs * 1000).toISOString();
  const summaries: TokenSummary[] = [];
  const seatsFiles: TokenSeatsFile[] = [];
  const perToken: Outputs['perToken'] = [];
  const walletEntries = new Map<string, WalletTokenEntry[]>();
  const usdByWallet = new Map<string, number>();
  let totalValue = 0;

  // ---- rolling 7-day buyer activity from hour buckets ----
  const nowH = hourIdx(nowTs);
  const win: Map<string, BucketRec>[] = [];
  for (const [h, m] of s.hours) if (h > nowH - 168 && h <= nowH) win.push(m);
  const n7 = new Map<string, number>();
  for (const m of win) for (const [a, r] of m) n7.set(a, (n7.get(a) || 0) + r.n);

  s.tokens.forEach((tk, t) => {
    const m = meta.get(tk.address);
    const pi = prices.get(tk.address) || { price: null, source: null };
    const px = pi.price;
    const holders: [string, PairRec][] = [];
    let supplyRaw = 0;
    for (const [a, p] of s.pairs[t]) if (p.bal > 0) { holders.push([a, p]); supplyRaw += p.bal; }
    if (!holders.length) return;
    totalValue += px ? (supplyRaw / 1e8) * px : 0;

    interface Row { a: string; p: PairRec; k: SeatKind; usd: number; hd: number; sk: number; gap: boolean; entry: number | null }
    const rows: Row[] = holders.map(([a, p]) => {
      const usd = px ? (p.bal / 1e8) * px : 0;
      const wk = walletKind(s, pools, a);
      let k: SeatKind;
      if (wk === 'pool') k = 'pool';
      else if (wk === 'contract') k = 'contract';
      else if (isFarmer(s.flags.get(a))) k = 'farmer';
      else if (usd >= REAL_MIN_USD) k = 'real';
      else k = 'dust';
      return { a, p, k, usd, hd: Math.floor((nowTs - p.rs) / DAY), sk: streakAt(p, nowTs), gap: !!p.gap || coversGap(p.rs, nowTs), entry: p.bq > 0 ? (p.bc / p.bq) * 1e8 : null };
    });
    const real = rows.filter((r) => r.k === 'real');
    real.sort((x, y) => y.hd - x.hd || x.p.fi - y.p.fi || x.p.rs - y.p.rs || (x.a < y.a ? -1 : 1));
    const KORD: Record<SeatKind, number> = { real: 0, dust: 1, farmer: 2, contract: 3, pool: 4 };
    const ghosts = rows.filter((r) => r.k !== 'real').sort((x, y) => KORD[x.k] - KORD[y.k] || y.usd - x.usd || (x.a < y.a ? -1 : 1));
    const medEntry = median(real.filter((r) => r.entry !== null).map((r) => r.entry!));
    const evm = (r: Row) => (process.env.NO_ENTRY !== '1' && r.entry !== null && medEntry ? r1((r.entry / medEntry - 1) * 100) : null);

    const seat = (r: Row): Seat => ({ a: r.a, k: r.k, usd: r2(r.usd), firstBuy: r.p.fi || null, holdDays: Math.max(0, r.hd), streakWeeks: r.sk, entryVsMedianPct: evm(r), heldThroughGap: r.gap });
    seatsFiles.push({ asOf, symbol: tk.symbol, seats: [...real.map(seat), ...ghosts.map(seat)] });

    // percentile arrays among real fans
    const N = real.length;
    const fiAsc = real.map((r) => r.p.fi).sort((x, y) => x - y);
    const hdAsc = real.map((r) => r.hd).sort((x, y) => x - y);
    const skAsc = real.map((r) => r.sk).sort((x, y) => x - y);
    const evAsc = real.map((r) => evm(r)).filter((x): x is number => x !== null).sort((x, y) => x - y);
    const gapCount = real.filter((r) => r.gap).length;
    const rankOf = new Map(real.map((r, i) => [r.a, i + 1]));

    for (const r of rows) {
      let best: WalletTokenEntry['bestStat'] = null;
      if (r.k === 'real' && N > 0) {
        const cands: { key: BestStatKey; pct: number }[] = [
          { key: 'longestHold', pct: topPct(N - lower(hdAsc, r.hd), N) },
          { key: 'earliest', pct: topPct(upper(fiAsc, r.p.fi), N) },
        ];
        const e = evm(r);
        if (e !== null) cands.push({ key: 'entryVsMedian', pct: topPct(upper(evAsc, e), N) });
        if (r.sk > 0) cands.push({ key: 'streak', pct: topPct(N - lower(skAsc, r.sk), N) });
        if (r.gap) cands.push({ key: 'heldThroughGap', pct: topPct(gapCount, N) });
        const b = cands.reduce((x, y) => (y.pct < x.pct ? y : x));
        best = { key: b.key, label: LABELS[b.key], pct: b.pct };
      }
      const entry: WalletTokenEntry = { symbol: tk.symbol, usd: r2(r.usd), kind: r.k, rank: rankOf.get(r.a) ?? null, of: N, bestStat: best };
      let arr = walletEntries.get(r.a);
      if (!arr) { arr = []; walletEntries.set(r.a, arr); }
      arr.push(entry);
      usdByWallet.set(r.a, (usdByWallet.get(r.a) || 0) + r.usd);
    }

    // concentration
    const balsDesc = holders.map(([, p]) => p.bal).sort((x, y) => y - x);
    const balsExPools = holders.filter(([a]) => !pools.has(a)).map(([, p]) => p.bal).sort((x, y) => y - x);
    const sum10 = (a: number[]) => a.slice(0, 10).reduce((x, y) => x + y, 0);

    // weekly buyers for this token (rolling 7d, bots > 50 swaps excluded, wallets only)
    const buyUsd = new Map<string, number>();
    for (const mm of win) for (const [a, rec] of mm) if (rec.b[t] !== undefined) buyUsd.set(a, (buyUsd.get(a) || 0) + rec.b[t]);
    const buyers = [...buyUsd.keys()].filter((a) => (n7.get(a) || 0) <= BOT_SWAPS_PER_WEEK && walletKind(s, pools, a) === 'wallet');
    const newBuyers = buyers.filter((a) => { const p = s.pairs[t].get(a); return !!p && p.fdb >= nowTs - 7 * DAY; });

    const counts = { real: N, dust: 0, farmer: 0, contract: 0, pool: 0 };
    for (const r of rows) if (r.k !== 'real') counts[r.k]++;
    perToken.push({ symbol: tk.symbol, holders: rows.length, ...counts, supplyRaw });
    summaries.push({
      address: tk.address as `0x${string}`, symbol: tk.symbol, name: m?.name || tk.symbol, logo: m?.logo,
      priceUsd: px !== null ? r2(px) : null, navUsd: m?.navUsd ?? null, multiplier: m?.multiplier ?? 1,
      holdersTotal: rows.length, realFans: N,
      ghosts: { dust: counts.dust, farmerOnly: counts.farmer, contracts: counts.contract + counts.pool },
      attendancePct: r1((N / rows.length) * 100),
      top10SharePct: r1((sum10(balsDesc) / supplyRaw) * 100),
      top10ShareExPoolsPct: r1((sum10(balsExPools) / supplyRaw) * 100),
      weeklyBuyers: buyers.length, newBuyers7d: newBuyers.length,
      medianWeeklyBuyUsd: (() => { const v = median(buyers.map((a) => buyUsd.get(a)!)); return v === null ? null : r2(v); })(),
      hasReferenceMark: CHAINLINK_SYMBOLS.has(tk.symbol) || m?.navUsd != null,
      priceSource: pi.source,
    });
  });
  summaries.sort((x, y) => y.realFans - x.realFans || y.holdersTotal - x.holdersTotal);

  // ---- wallets ----
  const firstSeen = new Map<string, number>();
  for (const m of s.pairs) for (const [a, p] of m) if (p.fi && walletEntries.has(a)) { const f = firstSeen.get(a); if (!f || p.fi < f) firstSeen.set(a, p.fi); }
  const wallets = new Map<string, WalletSummary>();
  for (const [a, entries] of walletEntries) {
    entries.sort((x, y) => y.usd - x.usd);
    wallets.set(a, { tokens: entries, totalUsd: r2(usdByWallet.get(a) || 0), firstSeen: firstSeen.get(a) ?? null });
  }

  // ---- global stats ----
  let real10 = 0, real100 = 0;
  for (const [a, usd] of usdByWallet) {
    if (usd < REAL_MIN_USD) continue;
    if (walletKind(s, pools, a) !== 'wallet' || isFarmer(s.flags.get(a))) continue;
    real10++;
    if (usd >= 100) real100++;
  }
  // weekly series by ISO week from day + hour buckets
  const weekly = new Map<number, Map<string, { n: number; usd: number; bought: boolean }>>();
  const add = (dayStartTs: number, m: Map<string, BucketRec>) => {
    const w = weekIdx(dayStartTs);
    let wm = weekly.get(w);
    if (!wm) { wm = new Map(); weekly.set(w, wm); }
    for (const [a, r] of m) {
      let x = wm.get(a);
      if (!x) { x = { n: 0, usd: 0, bought: false }; wm.set(a, x); }
      x.n += r.n;
      for (const k in r.b) { x.usd += r.b[k]; x.bought = true; }
    }
  };
  for (const [d, m] of s.days) add(d * DAY, m);
  for (const [h, m] of s.hours) add(h * 3600, m);
  const series: StatsFile['weeklyBuyers'] = [];
  for (const w of [...weekly.keys()].sort((x, y) => x - y)) {
    const wm = weekly.get(w)!;
    const ws = weekStartTs(w), we = ws + 7 * DAY;
    const keep = [...wm].filter(([a, x]) => x.bought && x.n <= BOT_SWAPS_PER_WEEK && walletKind(s, pools, a) === 'wallet');
    const nb = keep.filter(([a]) => { const f = s.firstBuyAny.get(a); return f !== undefined && f >= ws && f < we; }).length;
    series.push({ weekStart: new Date(ws * 1000).toISOString().slice(0, 10), buyers: keep.length, newBuyers: nb, medianBuyUsd: r2(median(keep.map(([, x]) => x.usd)) ?? 0) });
  }

  const stats: StatsFile = {
    asOf, holdersTotal: wallets.size, realWallets: real10, realWallets100: real100, weeklyBuyers: series,
    tokensMinted: summaries.length, totalValueUsd: Math.round(totalValue),
  };
  return { index: { asOf, block, tokens: summaries }, seats: seatsFiles, wallets, stats, perToken };
}

// Every address that needs a code kind before buildOutputs can run.
export function addressesNeedingCodes(s: State, pools: Set<string>): Set<string> {
  const need = new Set<string>();
  for (const m of s.pairs) for (const [a, p] of m) if (p.bal > 0 && !pools.has(a)) need.add(a);
  for (const mm of [s.hours, s.days]) for (const m of mm.values()) for (const [a, r] of m) if (Object.keys(r.b).length && !pools.has(a)) need.add(a);
  return need;
}
