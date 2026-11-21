// Chronological replay of Transfer logs into State (same semantics as research-scripts/analyze1.py).
import { ZERO } from './config.ts';
import type { Log } from './fetcher.ts';
import { newPair, type State, type PairRec, type BucketRec, F_SWAP_IN, F_MINT_IN, F_XFER_IN, F_XFER_NONDIST } from './state.ts';
import { coversGap, weekIdx, hourIdx, dayIdx } from './time.ts';

export interface ReplayCtx {
  pools: Set<string>;
  distributors: Set<string>;
  ts: (block: number) => number;
  // price per raw-token unit for cost basis at a given day (daily avg), falling back to current DEX price
  priceAt: (tidx: number, day: number) => number | null;
  outOfOrder?: boolean; // per-token catch-up replays run after other tokens: use min() for global first-buy
}

function pair(s: State, t: number, a: string): PairRec {
  const m = s.pairs[t];
  let p = m.get(a);
  if (!p) { p = newPair(); m.set(a, p); }
  return p;
}

// Close out the open week when a transfer lands in a later week.
function rollWeek(p: PairRec, w: number) {
  if (p.cw === w) return;
  if (p.cw >= 0 && p.cn > 0) {
    p.sk = p.lp === p.cw - 1 ? p.sk + 1 : 1;
    p.lp = p.cw;
  }
  p.cw = w; p.cn = 0;
}

// streakWeeks at time `now`: consecutive ISO weeks with positive net inflow, ending this week or last week.
export function streakAt(p: PairRec, now: number): number {
  const W = weekIdx(now);
  let lp = p.lp, sk = p.sk;
  if (p.cw >= 0 && p.cn > 0) { sk = lp === p.cw - 1 ? sk + 1 : 1; lp = p.cw; }
  return lp >= W - 1 ? sk : 0;
}

function bucket(s: State, ts: number, a: string): BucketRec {
  const h = hourIdx(ts);
  let m = s.hours.get(h);
  if (!m) { m = new Map(); s.hours.set(h, m); }
  let r = m.get(a);
  if (!r) { r = { n: 0, b: {} }; m.set(a, r); }
  return r;
}

export function applyLogs(s: State, logs: Log[], ctx: ReplayCtx): { negatives: number } {
  const { pools, distributors } = ctx;
  let negatives = 0;
  let i = 0;
  while (i < logs.length) {
    // one transaction = consecutive logs with the same (block, txIndex)
    let j = i + 1;
    while (j < logs.length && logs[j].b === logs[i].b && logs[j].ti === logs[i].ti) j++;
    const ts = ctx.ts(logs[i].b);
    const w = weekIdx(ts);
    // group by token inside the tx
    const byTok = new Map<number, Log[]>();
    for (let k = i; k < j; k++) {
      const l = logs[k];
      let g = byTok.get(l.t);
      if (!g) { g = []; byTok.set(l.t, g); }
      g.push(l);
    }
    for (const [t, fl] of byTok) {
      let pin = 0, pout = 0;
      for (const l of fl) { if (pools.has(l.to)) pin += l.v; if (pools.has(l.f)) pout += l.v; }
      const swap = pin > 0 || pout > 0;
      const net = new Map<string, number>();
      for (const l of fl) {
        if (l.v === 0) continue; // zero-value spam transfers carry no ownership change
        s.transfers++;
        if (l.f !== ZERO) {
          const p = pair(s, t, l.f);
          rollWeek(p, w);
          p.bal -= l.v; p.cn -= l.v;
          if (p.bal < 0) negatives++;
          if (p.bal <= 0 && p.rs) { if (!p.gap && coversGap(p.rs, ts)) p.gap = 1; p.rs = 0; }
          if (!pools.has(l.f)) net.set(l.f, (net.get(l.f) || 0) - l.v);
        }
        if (l.to !== ZERO) {
          const p = pair(s, t, l.to);
          rollWeek(p, w);
          if (!p.fi || (ctx.outOfOrder && ts < p.fi)) p.fi = p.fi ? Math.min(p.fi, ts) : ts;
          const was = p.bal;
          p.bal += l.v; p.cn += l.v;
          if (was <= 0 && p.bal > 0) p.rs = ts;
          if (!pools.has(l.to)) {
            net.set(l.to, (net.get(l.to) || 0) + l.v);
            let fl2 = s.flags.get(l.to) || 0;
            if (swap) fl2 |= F_SWAP_IN;
            else if (l.f === ZERO) fl2 |= F_MINT_IN;
            else { fl2 |= F_XFER_IN; if (!distributors.has(l.f)) fl2 |= F_XFER_NONDIST; }
            s.flags.set(l.to, fl2);
          }
        }
      }
      if (!swap || !net.size) continue;
      if (pout > pin) {
        let best = '', q = 0;
        for (const [a, v] of net) if (v > q) { q = v; best = a; }
        if (q > 0) {
          const r = bucket(s, ts, best);
          r.n++;
          const px = ctx.priceAt(t, dayIdx(ts));
          r.b[t] = (r.b[t] || 0) + (px ? +(q / 1e8 * px).toFixed(2) : 0);
          const p = pair(s, t, best);
          if (!p.fdb || p.fdb > ts) p.fdb = ts;
          if (px) { p.bq += q; p.bc += q / 1e8 * px; }
          const fb = s.firstBuyAny.get(best);
          if (fb === undefined || fb > ts) s.firstBuyAny.set(best, ts);
        }
      } else if (pin > pout) {
        let worst = '', q = 0;
        for (const [a, v] of net) if (v < q) { q = v; worst = a; }
        if (q < 0) bucket(s, ts, worst).n++;
      }
    }
    i = j;
  }
  return { negatives };
}

// Fold hour buckets older than `keepHours` into day buckets.
export function compactBuckets(s: State, nowTs: number, keepHours = 9 * 24) {
  const cut = hourIdx(nowTs) - keepHours;
  for (const [h, m] of s.hours) {
    if (h >= cut) continue;
    const d = Math.floor(h / 24);
    let dm = s.days.get(d);
    if (!dm) { dm = new Map(); s.days.set(d, dm); }
    for (const [a, r] of m) {
      let x = dm.get(a);
      if (!x) { x = { n: 0, b: {} }; dm.set(a, x); }
      x.n += r.n;
      for (const k in r.b) x.b[k] = +((x.b[k] || 0) + r.b[k]).toFixed(2);
    }
    s.hours.delete(h);
  }
}
