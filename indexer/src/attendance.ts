// Attendance time series (attendance-history.json) and movers (movers.json), from boundary snapshots of the replay.
//
// A snapshot is taken while replaying, at hour boundaries: the state after every log with block time < H.
// Midnight snapshots (H = 00:00 UTC) are kept forever as the end-of-day row of the day before; other hours are kept
// for ~9 days (24 h movers baselines). Seats are classified exactly like output.ts buildOutputs: pool -> contract ->
// farmer-only -> real (>= REAL_MIN_USD) -> dust. Price-free parts are captured during the replay; real/dust needs the
// day mark, so it is decided after the replay when marks and code kinds are up to date.
import zlib from 'node:zlib';
import type {
  AttendanceHistoryFile, AttendanceHistoryIndex, AttendanceSeries, AttendancePriceSource, MoversFile, MoversWindow, MoverRow, NotableLine,
} from '../../shared/types.ts';
import { REAL_MIN_USD, BOT_SWAPS_PER_WEEK } from './config.ts';
import { K_CONTRACT, type State, type AttSnap, type AttRow, type AttStore } from './state.ts';
import { isFarmer, type Outputs, type PriceInfo } from './output.ts';
import { isSink } from './sinks.ts';
import { DAY, dayIdx } from './time.ts';
import type { Marker } from './marks.ts';
import type { BoundaryHook } from './window.ts';

export const HOURLY_KEEP = 9 * DAY;
export const PCT_MIN_BASE = 10;
export const SPLIT_GZ_BYTES = 2_000_000;

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
const iso = (ts: number) => new Date(ts * 1000).toISOString();
const ymd = (day: number) => new Date(day * DAY * 1000).toISOString().slice(0, 10);

// ---------------- capture (price-free) ----------------
interface RawTok { pool: number; contract: number; farmer: number; cand: number[]; unk: { a: string; bal: number; farm: boolean }[] }
export interface RawCap { H: number; block: number; uniq: number; tk: (RawTok | null)[] }

export function capture(s: State, pools: Set<string>, H: number, block: number): RawCap {
  const holders = new Set<string>();
  const tk: (RawTok | null)[] = s.tokens.map((_, t) => {
    const r: RawTok = { pool: 0, contract: 0, farmer: 0, cand: [], unk: [] };
    let n = 0;
    for (const [a, p] of s.pairs[t]) {
      if (p.bal <= 0) continue;
      n++; holders.add(a);
      if (pools.has(a)) { r.pool++; continue; }
      if (isSink(a)) { r.contract++; continue; }
      const farm = isFarmer(s.flags.get(a));
      const k = s.codes.get(a);
      if (k === undefined) { r.unk.push({ a, bal: p.bal, farm }); continue; }
      if (k === K_CONTRACT) r.contract++;
      else if (farm) r.farmer++;
      else r.cand.push(p.bal);
    }
    return n ? r : null;
  });
  return { H, block, uniq: holders.size, tk };
}

export type Pricer = (tok: string) => { px: number; src: AttendancePriceSource } | null;

export function finalize(s: State, cap: RawCap, price: Pricer): AttSnap {
  const out: Record<string, AttRow> = {};
  cap.tk.forEach((r, t) => {
    if (!r) return;
    const tok = s.tokens[t].address;
    let contract = r.contract, farmer = r.farmer;
    const cand = [...r.cand];
    for (const u of r.unk) {
      const k = s.codes.get(u.a);
      if (k === undefined) throw new Error(`attendance: missing code kind for ${u.a}`);
      if (k === K_CONTRACT) contract++;
      else if (u.farm) farmer++;
      else cand.push(u.bal);
    }
    const pr = price(tok);
    const px = pr ? pr.px : null;
    let real = 0;
    if (px) for (const bal of cand) if ((bal / 1e8) * px >= REAL_MIN_USD) real++;
    const holders = r.pool + contract + farmer + cand.length;
    out[tok] = [holders, real, cand.length - real, farmer, contract + r.pool, px === null ? null : px, pr ? pr.src : null];
  });
  return { ts: cap.H, block: cap.block, uniq: cap.uniq, tk: out };
}

// Day mark for the day that ends at (or contains) H, carried from up to 30 earlier days when that day has none.
export function markPricer(marker: Marker, day: number): Pricer {
  return (tok) => {
    for (let d = day; d >= day - 30; d--) {
      const m = marker.mark(tok, d);
      if (m) return { px: r4(m.px), src: d === day ? m.src : 'carry' };
    }
    return null;
  };
}

// Live prices from the run (exactly what index.json uses).
export function livePricer(prices: Map<string, PriceInfo>): Pricer {
  return (tok) => { const p = prices.get(tok); return p && p.price !== null ? { px: p.price, src: 'live' } : null; };
}

// ---------------- collector used during a replay ----------------
export class AttCollector {
  caps: RawCap[] = [];
  constructor(private s: State, private pools: Set<string>, private hourlyFrom: number) {}
  hook(): BoundaryHook {
    return {
      wanted: (H) => H % DAY === 0 || H >= this.hourlyFrom,
      at: (H, block) => { this.caps.push(capture(this.s, this.pools, H, block)); },
      pending: () => this.caps.length,
    };
  }
  unknownAddrs(): Set<string> {
    const need = new Set<string>();
    for (const c of this.caps) for (const r of c.tk) if (r) for (const u of r.unk) need.add(u.a);
    return need;
  }
  // Classify every held snapshot with its day mark and store it.
  commit(att: AttStore, marker: Marker): { daily: number; hourly: number } {
    let daily = 0, hourly = 0;
    for (const c of this.caps) {
      const day = dayIdx(c.H - 1);
      const snap = finalize(this.s, c, markPricer(marker, day));
      if (c.H % DAY === 0) { att.daily[day] = snap; daily++; }
      else { att.hourly[c.H] = snap; hourly++; }
    }
    this.caps = [];
    return { daily, hourly };
  }
}

export function pruneHourly(att: AttStore, nowTs: number) {
  for (const k of Object.keys(att.hourly)) if (+k < nowTs - HOURLY_KEEP) delete att.hourly[+k];
}

export function mergeBackfill(att: AttStore, bf: { cursor: number; daily: Record<number, AttSnap>; hourly: Record<number, AttSnap> }): { daily: number; hourly: number } {
  let daily = 0, hourly = 0;
  for (const [k, v] of Object.entries(bf.daily)) if (!att.daily[+k]) { att.daily[+k] = v; daily++; }
  for (const [k, v] of Object.entries(bf.hourly)) if (!att.hourly[+k]) { att.hourly[+k] = v; hourly++; }
  att.backfill = bf.cursor;
  return { daily, hourly };
}

// ---------------- new buyers per day ----------------
// A wallet (EOA / 7702 / smart wallet) counts on the UTC day of its first DEX buy, unless it had more than
// BOT_SWAPS_PER_WEEK swap events in the 7 days ending that day (same bot rule as index.json weeklyBuyers).
function buyerTools(s: State, pools: Set<string>) {
  const dayN = new Map<number, Map<string, number>>();
  const addN = (d: number, a: string, n: number) => { let m = dayN.get(d); if (!m) { m = new Map(); dayN.set(d, m); } m.set(a, (m.get(a) || 0) + n); };
  for (const [d, m] of s.days) for (const [a, r] of m) addN(d, a, r.n);
  for (const [h, m] of s.hours) for (const [a, r] of m) addN(Math.floor(h / 24), a, r.n);
  const botCache = new Map<string, boolean>();
  const isBot = (a: string, d: number) => {
    const key = a + d;
    let v = botCache.get(key);
    if (v === undefined) {
      let n = 0;
      for (let k = d - 6; k <= d; k++) n += dayN.get(k)?.get(a) || 0;
      v = n > BOT_SWAPS_PER_WEEK;
      botCache.set(key, v);
    }
    return v;
  };
  const isWallet = (a: string) => !pools.has(a) && !isSink(a) && s.codes.has(a) && s.codes.get(a) !== K_CONTRACT;
  return { isBot, isWallet };
}

export function newBuyersByDay(s: State, pools: Set<string>): { perTok: Map<number, number>[]; total: Map<number, number> } {
  const { isBot, isWallet } = buyerTools(s, pools);
  const perTok = s.tokens.map((_, t) => {
    const m = new Map<number, number>();
    for (const [a, p] of s.pairs[t]) {
      if (!p.fdb) continue;
      const d = dayIdx(p.fdb);
      if (!isWallet(a) || isBot(a, d)) continue;
      m.set(d, (m.get(d) || 0) + 1);
    }
    return m;
  });
  const total = new Map<number, number>();
  for (const [a, fb] of s.firstBuyAny) {
    const d = dayIdx(fb);
    if (!isWallet(a) || isBot(a, d)) continue;
    total.set(d, (total.get(d) || 0) + 1);
  }
  return { perTok, total };
}

// ---------------- attendance-history.json ----------------
export function buildAttendanceHistory(s: State, out: Outputs, now: AttSnap, pools: Set<string>): { file: AttendanceHistoryFile; missing: string[] } {
  const today = dayIdx(s.cursorTs);
  const dailyDays = Object.keys(s.att.daily).map(Number);
  const first = dailyDays.length ? Math.min(...dailyDays) : today;
  const days: number[] = [];
  for (let d = first; d <= today; d++) days.push(d);
  const snaps = days.map((d) => (d === today ? now : s.att.daily[d] ?? null));
  const missing = days.filter((_, i) => !snaps[i]).map(ymd);
  const nb = newBuyersByDay(s, pools);

  const nameOf = new Map(out.index.tokens.map((t) => [t.address as string, t.name]));
  const order = new Map(out.index.tokens.map((t, i) => [t.address as string, i]));
  const present = s.tokens.map((tk, t) => ({ tk, t })).filter(({ tk }) => snaps.some((sn) => sn && sn.tk[tk.address]));
  present.sort((x, y) => (order.get(x.tk.address) ?? 1e9) - (order.get(y.tk.address) ?? 1e9) || (x.tk.symbol < y.tk.symbol ? -1 : 1));

  const tokens: AttendanceSeries[] = present.map(({ tk, t }) => {
    const col = (i: number) => snaps.map((sn) => (sn ? (sn.tk[tk.address]?.[i] as number | undefined) ?? 0 : null));
    const holders = col(0), real = col(1);
    const li = holders.findIndex((h) => !!h);
    return {
      symbol: tk.symbol, address: tk.address, name: nameOf.get(tk.address) || tk.symbol,
      launchDay: li >= 0 ? ymd(days[li]) : null,
      holdersTotal: holders, realFans: real,
      attendancePct: holders.map((h, i) => (h ? r1((real[i]! / h) * 100) : null)),
      dust: col(2), farmerOnly: col(3), contracts: col(4),
      newBuyers: days.map((d) => nb.perTok[t].get(d) || 0),
      priceUsd: snaps.map((sn, i) => { const p = sn?.tk[tk.address]?.[5] ?? null; return p === null ? null : days[i] === today ? r2(p as number) : r4(p as number); }),
      priceSource: snaps.map((sn) => (sn?.tk[tk.address]?.[6] as AttendancePriceSource | undefined) ?? null),
    };
  });
  const sumCol = (i: number) => snaps.map((sn) => (sn ? Object.values(sn.tk).reduce((x, r) => x + (r[i] as number), 0) : null));
  const file: AttendanceHistoryFile = {
    asOf: out.index.asOf, block: out.index.block, days: days.map(ymd), todayPartial: true, missingDays: missing,
    totals: { holdersTotal: sumCol(0), realFans: sumCol(1), uniqueHolders: snaps.map((sn) => (sn ? sn.uniq : null)), newBuyers: days.map((d) => nb.total.get(d) || 0) },
    tokens,
  };
  return { file, missing };
}

// One file when small enough, else attendance-history/index.json + attendance-history/<symbol>.json.
export function serializeAttendance(file: AttendanceHistoryFile): { files: Map<string, string>; gzBytes: number; split: boolean } {
  const json = JSON.stringify(file);
  const gz = zlib.gzipSync(json).length;
  const files = new Map<string, string>();
  if (gz <= SPLIT_GZ_BYTES) { files.set('attendance-history.json', json); return { files, gzBytes: gz, split: false }; }
  const idx: AttendanceHistoryIndex = { asOf: file.asOf, block: file.block, split: true, days: file.days, missingDays: file.missingDays, totals: file.totals, symbols: file.tokens.map((t) => t.symbol) };
  files.set('attendance-history/index.json', JSON.stringify(idx));
  let total = 0;
  for (const t of file.tokens) { const j = JSON.stringify(t); files.set(`attendance-history/${t.symbol}.json`, j); total += zlib.gzipSync(j).length; }
  return { files, gzBytes: total, split: true };
}

// ---------------- movers.json ----------------
function baselineSnap(att: AttStore, target: number): AttSnap | null {
  let best: AttSnap | null = null;
  for (const m of [att.daily, att.hourly]) for (const sn of Object.values(m)) if (sn.ts <= target && (!best || sn.ts > best.ts)) best = sn;
  return best;
}

const fmt = (n: number) => Math.abs(n).toLocaleString('en-US');
const pl = (n: number, one: string, many: string) => (Math.abs(n) === 1 ? one : many);
const span = (w: '24h' | '7d') => (w === '24h' ? 'in the last 24 hours' : 'in the last 7 days');
function names(syms: string[]): string {
  if (syms.length === 1) return syms[0];
  if (syms.length === 2) return `${syms[0]} and ${syms[1]}`;
  return `${syms.slice(0, -1).join(', ')} and ${syms[syms.length - 1]}`;
}
// Leaders tied on the value: "X gained" / "X and Y each gained" (up to 3 names, else skipped).
function leaders(rows: MoverRow[], val: (r: MoverRow) => number): MoverRow[] | null {
  if (!rows.length) return null;
  const v = val(rows[0]);
  const tied = rows.filter((r) => val(r) === v);
  return tied.length <= 3 ? tied : null;
}

export function buildMovers(s: State, out: Outputs, now: AttSnap, pools: Set<string>): MoversFile {
  const { isBot, isWallet } = buyerTools(s, pools);
  const nameOf = new Map(out.index.tokens.map((t) => [t.address as string, t.name]));
  const symOf = new Map(s.tokens.map((t) => [t.address, t.symbol]));
  const seatsBySym = new Map(out.seats.map((f) => [f.symbol, f.seats]));
  const windows: MoversWindow[] = [];
  const all: Record<string, MoverRow[]> = {};
  for (const [w, secs] of [['24h', 24 * 3600], ['7d', 7 * DAY]] as const) {
    const base = baselineSnap(s.att, s.cursorTs - secs);
    if (!base) continue;
    const toks = new Set([...Object.keys(now.tk), ...Object.keys(base.tk)]);
    const rows: MoverRow[] = [];
    for (const tok of toks) {
      const n = now.tk[tok], b = base.tk[tok];
      const sym = symOf.get(tok) || tok;
      const rn = n ? n[1] : 0, rb = b ? b[1] : 0;
      const newReal = (seatsBySym.get(sym) || []).filter((x) => x.k === 'real' && x.firstBuy !== null && x.firstBuy > base.ts).length;
      rows.push({
        symbol: sym, name: nameOf.get(tok) || sym, realFansNow: rn, realFansThen: rb, change: rn - rb,
        changePct: rb ? r1(((rn - rb) / rb) * 100) : null, newRealFans: newReal,
        holdersNow: n ? n[0] : 0, attendancePctNow: n && n[0] ? r1((n[1] / n[0]) * 100) : 0,
      });
    }
    const bySym = (x: MoverRow, y: MoverRow) => (x.symbol < y.symbol ? -1 : 1);
    const byChange = [...rows].sort((x, y) => y.change - x.change || y.realFansNow - x.realFansNow || bySym(x, y));
    const byChangePct = rows.filter((r) => r.realFansThen >= PCT_MIN_BASE).sort((x, y) => y.changePct! - x.changePct! || y.change - x.change || bySym(x, y));
    const byNew = [...rows].sort((x, y) => y.newRealFans - x.newRealFans || y.change - x.change || bySym(x, y));
    all[w] = rows;
    const sum = (sn: AttSnap, i: number) => Object.values(sn.tk).reduce((x, r) => x + (r[i] as number), 0);
    let newWallets = 0, newBuyerWallets = 0;
    for (const [a, ws] of out.wallets) if (ws.firstSeen !== null && ws.firstSeen > base.ts && isWallet(a)) newWallets++;
    for (const [a, fb] of s.firstBuyAny) if (fb > base.ts && isWallet(a) && !isBot(a, dayIdx(fb))) newBuyerWallets++;
    windows.push({
      window: w, from: iso(base.ts), to: out.index.asOf, hours: r1((s.cursorTs - base.ts) / 3600), baselineBlock: base.block,
      byChange: byChange.slice(0, 10), byChangePct: byChangePct.slice(0, 10), pctMinBase: PCT_MIN_BASE, byNewRealFans: byNew.slice(0, 10),
      totals: {
        realFansNow: sum(now, 1), realFansThen: sum(base, 1), realFansChange: sum(now, 1) - sum(base, 1),
        holdersNow: sum(now, 0), holdersThen: sum(base, 0), holdersChange: sum(now, 0) - sum(base, 0),
        uniqueHoldersNow: now.uniq, uniqueHoldersThen: base.uniq, newWallets, newBuyerWallets,
      },
    });
  }
  return { asOf: out.index.asOf, block: out.index.block, windows, notable: notableLines(windows, all, out) };
}

function notableLines(windows: MoversWindow[], all: Record<string, MoverRow[]>, out: Outputs): NotableLine[] {
  const lines: NotableLine[] = [];
  const win = (w: '24h' | '7d') => windows.find((x) => x.window === w);
  for (const w of ['7d', '24h'] as const) {
    const W = win(w);
    if (!W) continue;
    const gain = leaders(W.byChange, (r) => r.change);
    if (gain && gain[0].change > 0) {
      const n = gain[0].change;
      lines.push({ key: `top-gain-${w}`, window: w, symbol: gain[0].symbol, value: n,
        text: `${names(gain.map((r) => r.symbol))} ${gain.length > 1 ? 'each ' : ''}gained ${fmt(n)} real ${pl(n, 'holder', 'holders')} ${span(w)}, the most of any ground.` });
    }
    const nw = leaders(W.byNewRealFans, (r) => r.newRealFans);
    if (nw && nw[0].newRealFans > 0) {
      const n = nw[0].newRealFans;
      lines.push({ key: `top-new-${w}`, window: w, symbol: nw[0].symbol, value: n,
        text: `${names(nw.map((r) => r.symbol))} ${nw.length > 1 ? 'each ' : ''}added ${fmt(n)} new real ${pl(n, 'holder', 'holders')} ${span(w)}, the most of any ground.` });
    }
    const pct = W.byChangePct[0];
    if (pct && pct.changePct !== null && pct.changePct > 0 && (W.byChangePct[1]?.changePct ?? -1) !== pct.changePct) {
      lines.push({ key: `top-pct-${w}`, window: w, symbol: pct.symbol, value: pct.changePct,
        text: `${pct.symbol} real holders rose ${pct.changePct}% ${span(w)}, from ${fmt(pct.realFansThen)} to ${fmt(pct.realFansNow)}, the largest rise among grounds that had at least ${W.pctMinBase} real holders.` });
    }
    const drops = [...all[w]].sort((x, y) => x.change - y.change || (x.symbol < y.symbol ? -1 : 1));
    const drop = leaders(drops, (r) => r.change);
    if (drop && drop[0].change < 0) {
      const n = -drop[0].change;
      lines.push({ key: `top-drop-${w}`, window: w, symbol: drop[0].symbol, value: -n,
        text: `${names(drop.map((r) => r.symbol))} ${drop.length > 1 ? 'each ' : ''}lost ${fmt(n)} real ${pl(n, 'holder', 'holders')} ${span(w)}, the largest drop of any ground.` });
    }
    const t = W.totals;
    const grounds = out.index.tokens.length;
    lines.push({ key: `total-${w}`, window: w, value: t.realFansChange,
      text: `Across all ${grounds} grounds there are ${fmt(t.realFansNow)} real holder seats, ${t.realFansChange >= 0 ? 'up' : 'down'} ${fmt(t.realFansChange)} ${span(w)}.` });
    if (t.newWallets > 0) lines.push({ key: `new-wallets-${w}`, window: w, value: t.newWallets,
      text: `${fmt(t.newWallets)} ${pl(t.newWallets, 'wallet', 'wallets')} received ${pl(t.newWallets, 'its', 'their')} first stock token ${span(w)} and still ${pl(t.newWallets, 'holds', 'hold')} it.` });
  }
  const big = out.index.tokens.filter((x) => x.holdersTotal >= 100).sort((x, y) => y.attendancePct - x.attendancePct || y.realFans - x.realFans);
  if (big.length && (big[1]?.attendancePct ?? -1) !== big[0].attendancePct) {
    const b = big[0];
    lines.push({ key: 'top-attendance-now', window: 'now', symbol: b.symbol, value: b.attendancePct,
      text: `${b.symbol} has the highest attendance among grounds with at least 100 holders: ${b.attendancePct}% of its ${fmt(b.holdersTotal)} holders are real.` });
  }
  return lines;
}
