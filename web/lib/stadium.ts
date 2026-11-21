// The Ground: deterministic stadium geometry. Pure, no DOM. Needs only the seat count.
// Logical space is landscape, origin at the centre spot.

export const A = 262; // pitch surround half-width
export const B = 170; // pitch surround half-height
export const RC = 64; // surround corner radius
export const PITCH_A = 236;
export const PITCH_B = 153;
const O0 = 12; // first row offset from the surround
const TMAX = 204; // deepest stand
const SMAX = 7; // largest seat pitch; smaller clubs lose rows instead
const ROW_K = 1.25; // row depth = ROW_K * seat pitch
const LH = 2 * (A - RC);
const LV = 2 * (B - RC);
// 16 blocks clockwise from the north-west: 4 north, NE corner, 2 east, SE corner, 4 south, SW corner, 2 west, NW corner
const SEGS: { kind: 'h' | 'v' | 'c'; blocks: number }[] = [
  { kind: 'h', blocks: 4 },
  { kind: 'c', blocks: 1 },
  { kind: 'v', blocks: 2 },
  { kind: 'c', blocks: 1 },
  { kind: 'h', blocks: 4 },
  { kind: 'c', blocks: 1 },
  { kind: 'v', blocks: 2 },
  { kind: 'c', blocks: 1 },
];

export interface Layout {
  n: number;
  x: Float32Array;
  y: Float32Array;
  ang: Float32Array; // outward facing angle of the seat
  block: Uint16Array; // 101..116, 201..216
  row: Uint8Array; // 1-based within the tier
  seat: Uint16Array; // 1-based within the block row
  depth: Float32Array; // 0 pitchside .. 1 back row
  s: number; // seat pitch in logical units
  rows: number;
  lowerRows: number;
  halfW: number; // outer extent
  halfH: number;
  blocks: { no: number; x: number; y: number }[];
}

function hash32(a: number): number {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function tiers(rows: number, s: number) {
  const d = s * ROW_K;
  const two = rows >= 10;
  const lower = two ? Math.round(rows * 0.4) : rows;
  const gap = two ? 2.6 * d : 0;
  return { d, lower, gap };
}

function maxRows(s: number): number {
  const d = s * ROW_K;
  let r = Math.floor((TMAX - O0) / d) + 1;
  if (r >= 10) r = Math.floor((TMAX - O0 - 2.6 * d) / d) + 1;
  return Math.max(1, r);
}

function rowCounts(s: number, o: number): number[] {
  const aisle = Math.max(s * 1.3, 5);
  const out: number[] = [];
  for (const seg of SEGS) {
    const len = seg.kind === 'h' ? LH : seg.kind === 'v' ? LV : (Math.PI / 2) * (RC + o);
    const per = Math.max(0, Math.floor((len / seg.blocks - aisle) / s));
    for (let i = 0; i < seg.blocks; i++) out.push(per);
  }
  return out;
}

function capacity(s: number, rows: number): number {
  const { d, lower, gap } = tiers(rows, s);
  let c = 0;
  for (let j = 0; j < rows; j++) {
    const o = O0 + j * d + (j >= lower ? gap : 0);
    for (const k of rowCounts(s, o)) c += k;
  }
  return c;
}

const cache = new Map<number, Layout>();

export function buildLayout(count: number): Layout {
  const n = Math.max(1, Math.min(60000, Math.floor(count) || 1));
  const hit = cache.get(n);
  if (hit) return hit;

  // 1. solve seat pitch and rows
  let s = SMAX;
  let rows = 1;
  if (capacity(SMAX, maxRows(SMAX)) >= n) {
    while (capacity(SMAX, rows) < n) rows++;
  } else {
    while (s > 1.2 && capacity(s, maxRows(s)) < n) s *= 0.992;
    rows = maxRows(s);
    while (rows > 1 && capacity(s, rows - 1) >= n) rows--;
  }
  const { d, lower, gap } = tiers(rows, s);
  const aisle = Math.max(s * 1.3, 5);

  // 2. generate slots
  type Slot = { x: number; y: number; ang: number; block: number; row: number; seat: number; j: number; score: number };
  const byRow: Slot[][] = [];
  let total = 0;
  for (let j = 0; j < rows; j++) {
    const o = O0 + j * d + (j >= lower ? gap : 0);
    const tier = j >= lower ? 200 : 100;
    const rowNo = j >= lower ? j - lower + 1 : j + 1;
    const rowSlots: Slot[] = [];
    let bi = 0;
    SEGS.forEach((seg, si) => {
      const len = seg.kind === 'h' ? LH : seg.kind === 'v' ? LV : (Math.PI / 2) * (RC + o);
      const bl = len / seg.blocks;
      const per = Math.max(0, Math.floor((bl - aisle) / s));
      for (let b = 0; b < seg.blocks; b++) {
        const start = b * bl + (bl - per * s) / 2 + s / 2;
        for (let k = 0; k < per; k++) {
          const t = start + k * s; // distance along the segment
          let x = 0;
          let y = 0;
          let ang = 0;
          if (si === 0) {
            x = -(A - RC) + t;
            y = -(B + o);
            ang = -Math.PI / 2;
          } else if (si === 2) {
            x = A + o;
            y = -(B - RC) + t;
            ang = 0;
          } else if (si === 4) {
            x = A - RC - t;
            y = B + o;
            ang = Math.PI / 2;
          } else if (si === 6) {
            x = -(A + o);
            y = B - RC - t;
            ang = Math.PI;
          } else {
            const r = RC + o;
            const a0 = si === 1 ? -Math.PI / 2 : si === 3 ? 0 : si === 5 ? Math.PI / 2 : Math.PI;
            const th = a0 + t / r;
            const cx = si === 1 || si === 3 ? A - RC : -(A - RC);
            const cy = si === 3 || si === 5 ? B - RC : -(B - RC);
            x = cx + Math.cos(th) * r;
            y = cy + Math.sin(th) * r;
            ang = th;
          }
          const blockNo = tier + bi + b + 1;
          const central = seg.kind === 'h' ? 1 - Math.abs(x) / A : seg.kind === 'v' ? 0.15 : 0;
          const noise = hash32(blockNo * 7919 + rowNo * 104729 + (k + 1) * 31);
          const score = (j / Math.max(rows, 3)) * 0.42 + noise - central * 0.1;
          rowSlots.push({ x, y, ang, block: blockNo, row: rowNo, seat: k + 1, j, score });
        }
      }
      bi += seg.blocks;
    });
    byRow.push(rowSlots);
    total += rowSlots.length;
  }

  // 3. drop the surplus from the back rows, evenly
  let excess = total - n;
  for (let j = rows - 1; j >= 0 && excess > 0; j--) {
    const m = byRow[j].length;
    if (m === 0) continue;
    if (excess >= m && j > 0) {
      excess -= m;
      byRow[j] = [];
      continue;
    }
    const e = Math.min(excess, m);
    byRow[j] = byRow[j].filter((_, k) => Math.floor(((k + 1) * e) / m) === Math.floor((k * e) / m));
    excess -= e;
  }
  const slots = byRow.flat();
  slots.sort((p, q) => p.score - q.score);
  const m = slots.length;

  const L: Layout = {
    n: m,
    x: new Float32Array(m),
    y: new Float32Array(m),
    ang: new Float32Array(m),
    block: new Uint16Array(m),
    row: new Uint8Array(m),
    seat: new Uint16Array(m),
    depth: new Float32Array(m),
    s,
    rows,
    lowerRows: lower,
    halfW: 0,
    halfH: 0,
    blocks: [],
  };
  const acc = new Map<number, { x: number; y: number; c: number }>();
  let maxO = 0;
  for (let i = 0; i < m; i++) {
    const p = slots[i];
    L.x[i] = p.x;
    L.y[i] = p.y;
    L.ang[i] = p.ang;
    L.block[i] = p.block;
    L.row[i] = p.row;
    L.seat[i] = p.seat;
    L.depth[i] = rows > 1 ? p.j / (rows - 1) : 0;
    const o = O0 + p.j * d + (p.j >= lower ? gap : 0);
    if (o > maxO) maxO = o;
    const a = acc.get(p.block) ?? { x: 0, y: 0, c: 0 };
    a.x += p.x;
    a.y += p.y;
    a.c++;
    acc.set(p.block, a);
  }
  L.halfW = A + maxO + s;
  L.halfH = B + maxO + s;
  L.blocks = [...acc.entries()].map(([no, a]) => ({ no, x: a.x / a.c, y: a.y / a.c }));
  if (cache.size > 24) cache.delete(cache.keys().next().value as number);
  cache.set(n, L);
  return L;
}

export type KitPattern = 'solid' | 'hoops' | 'halves' | 'sash' | 'chevron' | 'quarters';

/** 0 = kit primary, 1 = kit secondary, for the tifo the crowd forms. */
export function tifo(pattern: KitPattern, L: Layout, i: number): 0 | 1 {
  const u = L.x[i] / L.halfW;
  const v = L.y[i] / L.halfH;
  switch (pattern) {
    case 'hoops':
      return (Math.floor(L.depth[i] * 5.999) % 2) as 0 | 1;
    case 'halves':
      return u < 0 ? 0 : 1;
    case 'quarters':
      return u < 0 === v < 0 ? 0 : 1;
    case 'sash':
      return Math.abs(u * 0.9 + v) < 0.34 ? 1 : 0;
    case 'chevron':
      return Math.abs(v + 0.35 - Math.abs(u) * 0.9) < 0.26 ? 1 : 0;
    default:
      return 0;
  }
}

export interface SeatLabel {
  block: number;
  row: number;
  seat: number;
  stand: string;
  x: number; // -1..1 across the ground
  y: number;
}

const STANDS = ['North Stand', 'North Stand', 'North Stand', 'North Stand', 'North-east corner', 'East Stand', 'East Stand', 'South-east corner',
  'South Stand', 'South Stand', 'South Stand', 'South Stand', 'South-west corner', 'West Stand', 'West Stand', 'North-west corner'];

export function seatLabel(total: number, index: number): SeatLabel | null {
  const L = buildLayout(total);
  if (index < 0 || index >= L.n) return null;
  const idx = (L.block[index] % 100) - 1;
  return { block: L.block[index], row: L.row[index], seat: L.seat[index], stand: STANDS[idx] ?? 'Stand', x: L.x[index] / L.halfW, y: L.y[index] / L.halfH };
}
