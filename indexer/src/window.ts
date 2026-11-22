// Windowed replay driver: fetch Transfer logs window by window and apply them to State, with block timestamps
// from a sparse grid. Optional hook: called at hour boundaries with the state as of the last block before it.
import { START_BLOCK } from './config.ts';
import type { State, CorpLog } from './state.ts';
import { saveLocal, mirrorState } from './state.ts';
import { fetchWindow, fetchStats, type Log } from './fetcher.ts';
import { applyLogs, compactBuckets, type ReplayCtx } from './replay.ts';
import { batch } from './rpc.ts';

const T0 = Date.now();
export const el = () => `${((Date.now() - T0) / 1000).toFixed(0)}s`;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const GRID = 10_000;
const TARGET_WINDOW_LOGS = 250_000;
const TARGET_UNIT_LOGS = 6_000;

// ---------- block timestamps: samples every 10k blocks + window ends, linear in between ----------
export async function ensureGrid(s: State, a: number, b: number) {
  const want: number[] = [];
  for (let g = Math.floor(a / GRID) * GRID; g <= b; g += GRID) if (!s.grid.has(g)) want.push(g);
  if (!s.grid.has(b)) want.push(b);
  const lo = want.filter((x) => x < 51_050_000), hi = want.filter((x) => x >= 51_050_000);
  for (const grp of [lo, hi]) {
    if (!grp.length) continue;
    const res = await batch(grp.map((n) => ({ method: 'eth_getBlockByNumber', params: ['0x' + n.toString(16), false] })), { block: grp[0], size: 20, conc: 2 });
    grp.forEach((n, i) => s.grid.set(n, parseInt(res[i].timestamp, 16)));
  }
}
export function makeTs(s: State): (b: number) => number {
  const keys = [...s.grid.keys()].sort((x, y) => x - y);
  const vals = keys.map((k) => s.grid.get(k)!);
  return (b: number) => {
    let lo = 0, hi = keys.length - 1;
    if (b <= keys[0]) return vals[0];
    if (b >= keys[hi]) return vals[hi];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (keys[m] <= b) lo = m; else hi = m; }
    return Math.round(vals[lo] + ((vals[hi] - vals[lo]) * (b - keys[lo])) / (keys[hi] - keys[lo]));
  };
}

export interface BoundaryHook {
  wanted: (H: number) => boolean;            // which hour boundaries (unix s, multiple of 3600) to snapshot
  at: (H: number, block: number) => void;    // state now reflects every log with block time < H; block = last such block
  pending: () => number;                     // snapshots not yet persisted (checkpoints are skipped while > 0)
}

export async function replayRange(s: State, addrs: string[], tokenIdx: Map<string, number>, from: number, to: number, ctxBase: Omit<ReplayCtx, 'ts'>, label: string, hook?: BoundaryHook) {
  if (from > to) return;
  let density = 0.5;
  let lastSave = Date.now(), lastMirror = Date.now();
  const start = (a: number) => {
    const b = Math.min(to, a + clamp(Math.round(TARGET_WINDOW_LOGS / Math.max(density, 0.005)), 2_000, 400_000) - 1);
    const unit = clamp(Math.round(TARGET_UNIT_LOGS / Math.max(density, 0.005)), 200, 50_000);
    return Promise.all([fetchWindow(addrs, tokenIdx, a, b, unit), ensureGrid(s, a, b)]).then(([r]) => ({ a, b, logs: r.logs, corp: r.corp }));
  };
  let pending: Promise<{ a: number; b: number; logs: Log[]; corp: CorpLog[] }> | null = start(from);
  let negTotal = 0;
  while (pending) {
    const { a, b, logs, corp }: { a: number; b: number; logs: Log[]; corp: CorpLog[] } = await pending;
    density = 0.5 * density + 0.5 * (logs.length / (b - a + 1));
    pending = b < to ? start(b + 1) : null; // prefetch next window while applying this one
    const ts = makeTs(s);
    const ctx = { ...ctxBase, ts };
    let negatives = 0, k0 = 0;
    if (hook) {
      // apply up to each wanted hour boundary inside (ts(a-1), ts(b)], snapshot, continue
      const t0 = ts(a - 1), t1 = ts(b);
      for (let H = Math.floor(t0 / 3600) * 3600 + 3600; H <= t1; H += 3600) {
        if (!hook.wanted(H)) continue;
        let k = k0;
        while (k < logs.length && ts(logs[k].b) < H) k++;
        if (k > k0) negatives += applyLogs(s, logs.slice(k0, k), ctx).negatives;
        k0 = k;
        let lo = a - 1, hi = b; // largest block with ts < H
        while (lo < hi) { const m = Math.ceil((lo + hi) / 2); if (ts(m) < H) lo = m; else hi = m - 1; }
        hook.at(H, lo);
      }
    }
    negatives += applyLogs(s, k0 ? logs.slice(k0) : logs, ctx).negatives;
    if (corp.length) s.corp.push(...corp);
    negTotal += negatives;
    if (label === 'main') { s.cursor = b; s.cursorTs = ts(b); }
    console.log(`[${el()}] ${label} ${a}-${b} (${new Date(ts(b) * 1000).toISOString().slice(0, 16)}) logs ${logs.length} total ${s.transfers} req ${fetchStats.requests} splits ${fetchStats.splits} retries ${fetchStats.retries}${negatives ? ' NEG ' + negatives : ''}`);
    // checkpoints are skipped while boundary snapshots are held in memory, so a saved cursor never passes a lost snapshot
    if (label === 'main' && Date.now() - lastSave > 10 * 60_000 && !(hook && hook.pending() > 0)) {
      if (pending) await pending.then(() => {}, () => {}); // keep prefetch result; save after it settles is not required
      compactBuckets(s, s.cursorTs);
      const sz = saveLocal(s);
      console.log(`[${el()}] checkpoint saved (${(sz / 1e6).toFixed(1)} MB) at ${s.cursor}`);
      lastSave = Date.now();
      if (Date.now() - lastMirror > 30 * 60_000 && process.env.SKIP_UPLOAD !== '1' && process.env.SKIP_MIRROR !== '1' && from !== START_BLOCK) { await mirrorState(); lastMirror = Date.now(); }
    }
  }
  if (negTotal) console.warn(`${label}: ${negTotal} transient negative balance events`);
}
