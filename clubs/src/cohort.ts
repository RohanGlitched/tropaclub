/**
 * Control cohort (pre-registered in COHORT-METHOD.md; descriptive, not causal; joiners self-select).
 *
 * Treated: GW0 Playing joiners (first qualifying Tropa buy Nov 24 - Nov 27 13:00 ET), excluding Bench
 * seats and exclusion-list wallets.
 * Baseline (a): organic first-time buyers of $10-50 the same week, same token (indexer data), matched
 *   on token and first-buy size (nearest |ln(usd ratio)|, up to 3 controls per joiner, no replacement).
 * Baseline (b): cashback-campaign recipients (Merkl distributor claimants) who first bought that week.
 * Outcome: held at D+7 = balance(t0+7d) - balance(t0-) >= 50% of the first buy's raw amount.
 * Statistic: D+7 hold-rate ratio (treated / control) with a 95% percentile bootstrap CI (10,000 resamples,
 * fixed seed), both groups resampled independently.
 */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { toEventSelector } from 'viem';
import type { HistTransfer } from './history';
import { type Flow, netRawBetween } from './lots';
import { DAY, seededRandom } from './util';

export const COHORT_LABEL = 'descriptive, not causal; joiners self-select';
export const HOLD_FRACTION = 0.5;

export interface CohortSubject {
  wallet: string;
  token: string;
  t0: number;
  firstRaw: bigint;
  firstUsd: number;
  flows: Flow[];
}

/** Held at t0 + days: net position change since just before the first buy >= 50% of that buy. */
export function heldAt(s: CohortSubject, days: number): boolean {
  const net = netRawBetween(s.flows, s.token, s.t0 - 1, s.t0 + days * DAY);
  return net * 2n >= s.firstRaw;
}

export function holdOutcomes(subjects: CohortSubject[], days: number, now: number): boolean[] {
  return subjects.filter((s) => s.t0 + days * DAY <= now).map((s) => heldAt(s, days));
}

export function rate(xs: boolean[]): number | null {
  return xs.length ? xs.filter(Boolean).length / xs.length : null;
}

export interface MatchResult {
  pairs: { treated: string; controls: string[] }[];
  controls: CohortSubject[];
  unmatched: string[];
}

/** Nearest-neighbour on |ln(usdC / usdT)|, same token, without replacement; deterministic order. */
export function matchControls(
  treated: Pick<CohortSubject, 'wallet' | 'token' | 'firstUsd' | 't0'>[],
  pool: CohortSubject[],
  opts: { perTreated?: number; maxLogRatio?: number } = {},
): MatchResult {
  const k = opts.perTreated ?? 3;
  const maxLr = opts.maxLogRatio ?? Math.log(1.5);
  const used = new Set<string>();
  const pairs: MatchResult['pairs'] = [];
  const controls: CohortSubject[] = [];
  const unmatched: string[] = [];
  const order = [...treated].sort((a, b) => a.t0 - b.t0 || (a.wallet < b.wallet ? -1 : 1));
  const treatedWallets = new Set(treated.map((t) => t.wallet));
  for (const t of order) {
    const cands = pool
      .filter((c) => c.token === t.token && !used.has(c.wallet) && !treatedWallets.has(c.wallet))
      .map((c) => ({ c, d: Math.abs(Math.log(c.firstUsd / t.firstUsd)), dt: Math.abs(c.t0 - t.t0) }))
      .filter((x) => x.d <= maxLr)
      .sort((a, b) => a.d - b.d || a.dt - b.dt || (a.c.wallet < b.c.wallet ? -1 : 1))
      .slice(0, k);
    if (!cands.length) unmatched.push(t.wallet);
    for (const x of cands) {
      used.add(x.c.wallet);
      controls.push(x.c);
    }
    pairs.push({ treated: t.wallet, controls: cands.map((x) => x.c.wallet) });
  }
  return { pairs, controls, unmatched };
}

export interface RatioCI {
  nT: number;
  nC: number;
  rateT: number | null;
  rateC: number | null;
  ratio: number | null;
  lo: number | null;
  hi: number | null;
  iters: number;
  label: string;
}

export function bootstrapRatio(t: boolean[], c: boolean[], opts: { iters?: number; seed?: string } = {}): RatioCI {
  const iters = opts.iters ?? 10_000;
  const rT = rate(t);
  const rC = rate(c);
  const base = { nT: t.length, nC: c.length, rateT: rT, rateC: rC, iters, label: COHORT_LABEL };
  if (rT == null || rC == null || rC === 0) return { ...base, ratio: null, lo: null, hi: null };
  const rnd = seededRandom(opts.seed ?? 'tropa-cohort-v1');
  const draws: number[] = [];
  const resample = (xs: boolean[]) => {
    let k = 0;
    for (let i = 0; i < xs.length; i++) if (xs[Math.floor(rnd() * xs.length)]) k++;
    return k / xs.length;
  };
  for (let i = 0; i < iters; i++) {
    const a = resample(t);
    const b = resample(c);
    if (b > 0) draws.push(a / b);
  }
  draws.sort((x, y) => x - y);
  const q = (p: number) => draws[Math.min(draws.length - 1, Math.max(0, Math.floor(p * draws.length)))]!;
  return { ...base, ratio: rT / rC, lo: draws.length ? q(0.025) : null, hi: draws.length ? q(0.975) : null };
}

/**
 * Build a subject from a wallet's full history: its FIRST-EVER stock-token inbound must be a buy inside
 * [from, to), of $minUsd-$maxUsd. Returns null otherwise (not first-time, transfer-in, out of range).
 */
export async function subjectFromHistory(
  wallet: string,
  transfers: HistTransfer[],
  window: { from: number; to: number; token?: string },
  opts: { minUsd?: number; maxUsd?: number; markAt?: (token: string, t: number) => Promise<number | null> } = {},
): Promise<CohortSubject | null> {
  const ins = transfers.filter((t) => t.dir === 'in').sort((a, b) => a.t - b.t || a.logIndex - b.logIndex);
  const first = ins[0];
  if (!first || first.t < window.from || first.t >= window.to) return null;
  if (window.token && first.token !== window.token) return null;
  const sameTx = ins.filter((t) => t.txHash === first.txHash && t.token === first.token);
  const raw = sameTx.reduce((s, t) => s + t.raw, 0n);
  let usd = first.legs.paidUsd;
  if (usd == null && first.legs.otherOut && opts.markAt) {
    const m = await opts.markAt(first.token, first.t);
    usd = m == null ? null : (Number(raw) / 1e8) * m;
  }
  if (usd == null) return null; // transfer-in or airdrop: not an organic buy
  if (usd < (opts.minUsd ?? 10) || usd > (opts.maxUsd ?? 50)) return null;
  const flows: Flow[] = transfers
    .filter((t) => t.token === first.token)
    .map((t) => ({ t: t.t, token: t.token, dir: t.dir, raw: t.raw, tropa: false, txHash: t.txHash, logIndex: t.logIndex }));
  return { wallet: wallet.toLowerCase(), token: first.token, t0: first.t, firstRaw: raw, firstUsd: usd, flows };
}

// ------------------------------------------------------------------ indexer state (organic candidates)

export interface IndexerStateLite {
  tokens: { address: string; symbol: string }[];
  /** per token: rows [addr, bal, fi, rs, gap, fdb, ...] */
  pairs: (string | number)[][][];
  firstBuyAny: Map<string, number>;
  codes: Map<string, number>;
  flags: Map<string, number>;
  /** Swap-event buckets: [hourIndex | dayIndex, [[addr, swaps, buys], ...]][] (indexer state `hours` / `days`). */
  hours?: [number, [string, number, unknown][]][];
  days?: [number, [string, number, unknown][]][];
}

/** Read the indexer's state.json.gz (gs://tropaclub-data/indexer-state/state.json.gz, copied locally). */
export function loadIndexerState(path: string): IndexerStateLite {
  const o = JSON.parse(zlib.gunzipSync(fs.readFileSync(path)).toString());
  return { tokens: o.tokens, pairs: o.pairs, firstBuyAny: new Map(o.firstBuyAny), codes: new Map(o.codes), flags: new Map(o.flags), hours: o.hours, days: o.days };
}

/** Bots: more than `max` swap events (any token) in the 7 days from the window start (indexer rule: > 50). */
export function botWallets(s: IndexerStateLite, window: { from: number; to: number }, max = 50): Set<string> {
  const end = window.from + 7 * DAY;
  const n = new Map<string, number>();
  const add = (start: number, rows: [string, number, unknown][]) => {
    if (start < window.from || start >= end) return;
    for (const [a, swaps] of rows) n.set(a, (n.get(a) ?? 0) + swaps);
  };
  for (const [h, rows] of s.hours ?? []) add(h * 3600, rows);
  for (const [d, rows] of s.days ?? []) add(d * DAY, rows);
  return new Set([...n].filter(([, c]) => c > max).map(([a]) => a));
}

const K_CONTRACT = 3;
const F_SWAP_IN = 1,
  F_MINT_IN = 2,
  F_XFER_IN = 4,
  F_XFER_NONDIST = 8;
const isFarmer = (f: number | undefined) => !!f && !(f & F_SWAP_IN) && !(f & F_MINT_IN) && !!(f & F_XFER_IN) && !(f & F_XFER_NONDIST);

/**
 * Organic first-time buyers in [from, to): first DEX buy of the token in the window AND first stock buy
 * of any token in the window; wallets only (no contracts), not farmer-only. Exact first-buy size and
 * holds come from subjectFromHistory() on each candidate.
 */
export function organicCandidates(s: IndexerStateLite, window: { from: number; to: number }, exclude: Set<string> = new Set()): { wallet: string; token: string }[] {
  const out: { wallet: string; token: string }[] = [];
  const bots = botWallets(s, window);
  s.tokens.forEach((tk, i) => {
    for (const row of s.pairs[i] ?? []) {
      const a = String(row[0]);
      const fdb = Number(row[5]);
      if (!fdb || fdb < window.from || fdb >= window.to) continue;
      const any = s.firstBuyAny.get(a);
      if (any === undefined || any < window.from || any >= window.to) continue;
      if (s.codes.get(a) === K_CONTRACT || isFarmer(s.flags.get(a)) || exclude.has(a) || bots.has(a)) continue;
      out.push({ wallet: a, token: tk.address.toLowerCase() });
    }
  });
  return out;
}

// ------------------------------------------------------------------ cashback recipients (baseline b)

export interface CashbackRecipientSource {
  /** Wallets that received a cashback / incentive payout for stock-token trading in the window. */
  recipients(window: { from: number; to: number }): Promise<string[]>;
}

export class StaticCashbackSource implements CashbackRecipientSource {
  constructor(private wallets: string[]) {}
  async recipients() {
    return this.wallets.map((w) => w.toLowerCase());
  }
}

/**
 * Merkl distributor claimants (to be verified Nov 23 before the method freezes: distributor address and
 * event signature, and which campaigns target stock tokens). `getLogs` is any raw log fetcher.
 */
export const MERKL_DISTRIBUTOR = '0x3ef3d8ba38ebe18db133cec108f4d14ce00dd9ae';
export const MERKL_CLAIMED_TOPIC = toEventSelector('Claimed(address,address,uint256)');

export class MerklClaimsSource implements CashbackRecipientSource {
  constructor(
    private getLogs: (q: { address: string; topic0: string; fromTime: number; toTime: number }) => Promise<{ topics: string[] }[]>,
    private opts: { rewardTokens?: Set<string>; claimWindowDays?: number } = {},
  ) {}
  async recipients(window: { from: number; to: number }): Promise<string[]> {
    const logs = await this.getLogs({ address: MERKL_DISTRIBUTOR, topic0: MERKL_CLAIMED_TOPIC, fromTime: window.from, toTime: window.to + (this.opts.claimWindowDays ?? 14) * DAY });
    const out = new Set<string>();
    for (const l of logs) {
      const user = `0x${l.topics[1]!.slice(-40)}`.toLowerCase();
      const token = l.topics[2] ? `0x${l.topics[2].slice(-40)}`.toLowerCase() : null;
      if (this.opts.rewardTokens && token && !this.opts.rewardTokens.has(token)) continue;
      out.add(user);
    }
    return [...out];
  }
}

export interface CohortReport {
  method: 'COHORT-METHOD.md v1 (pre-registered Nov 23 2026)';
  label: string;
  window: { from: number; to: number };
  days: number;
  treated: { n: number; holdRate: number | null };
  organic: RatioCI & { matched: number; unmatchedTreated: number };
  cashback: RatioCI | null;
}

export function cohortReport(args: {
  window: { from: number; to: number };
  treated: CohortSubject[];
  organicPool: CohortSubject[];
  cashback?: CohortSubject[];
  now: number;
  days?: number;
}): CohortReport {
  const days = args.days ?? 7;
  const eligible = args.treated.filter((s) => s.t0 + days * DAY <= args.now);
  const m = matchControls(eligible, args.organicPool);
  const tOut = holdOutcomes(eligible, days, args.now);
  const cOut = holdOutcomes(m.controls, days, args.now);
  const organic = bootstrapRatio(tOut, cOut);
  const cashback = args.cashback ? bootstrapRatio(tOut, holdOutcomes(args.cashback, days, args.now), { seed: 'tropa-cohort-v1-cashback' }) : null;
  return {
    method: 'COHORT-METHOD.md v1 (pre-registered Nov 23 2026)',
    label: COHORT_LABEL,
    window: args.window,
    days,
    treated: { n: tOut.length, holdRate: rate(tOut) },
    organic: { ...organic, matched: m.controls.length, unmatchedTreated: m.unmatched.length },
    cashback,
  };
}
