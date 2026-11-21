// Compact replay state: everything needed to continue the replay incrementally and to compute outputs.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { CACHE_DIR, STATE_PREFIX } from './config.ts';
import { download, uploadMany } from './gcs.ts';

export const STATE_VERSION = 1;

// Per (token, wallet). Raw amounts are token base units (8 decimals); all < 2^53.
export interface PairRec {
  bal: number;   // current raw balance
  fi: number;    // first inbound transfer (unix s)
  rs: number;    // start of current nonzero run (0 when balance is 0) -> "last-zero time"
  gap: number;   // 1 if a finished run spanned a full weekend gap
  fdb: number;   // first DEX buy (unix s), 0 if never
  cw: number;    // ISO week index of the open week
  cn: number;    // net raw inflow in the open week
  lp: number;    // last finished week with positive net inflow (-1 none)
  sk: number;    // streak length of consecutive positive weeks ending at lp
  bq: number;    // raw qty of DEX buys that had a price
  bc: number;    // USD cost of those buys (daily average DEX price at buy time)
}
export const newPair = (): PairRec => ({ bal: 0, fi: 0, rs: 0, gap: 0, fdb: 0, cw: -1, cn: 0, lp: -1, sk: 0, bq: 0, bc: 0 });

// Per wallet per time bucket: swap events (any token) and USD bought per token.
export interface BucketRec { n: number; b: Record<number, number> }

// Address flags for the farmer test (global across tokens, like analyze1.py `inb`).
export const F_SWAP_IN = 1, F_MINT_IN = 2, F_XFER_IN = 4, F_XFER_NONDIST = 8;
// Code kinds from eth_getCode
export const K_EOA = 0, K_7702 = 1, K_SMART = 2, K_CONTRACT = 3;

export interface TrackedToken { address: string; symbol: string; fromBlock: number }

export interface State {
  version: number;
  cursor: number;              // last fully applied block
  cursorTs: number;
  tokens: TrackedToken[];      // index = token idx used everywhere
  pairs: Map<string, PairRec>[];
  flags: Map<string, number>;
  firstBuyAny: Map<string, number>;
  codes: Map<string, number>;
  hours: Map<number, Map<string, BucketRec>>; // recent hour buckets (last ~8 days)
  days: Map<number, Map<string, BucketRec>>;  // older day buckets
  pools: string[];
  grid: Map<number, number>;   // block -> timestamp samples
  dailyPx: Record<string, Record<number, number>>; // token -> day -> avg price (GeckoTerminal deepest pool, gaps from Yahoo)
  yahooFilled: string[];       // tokens whose dailyPx gaps were filled from Yahoo
  transfers: number;
  updatedAt: string;
}

export function emptyState(): State {
  return { version: STATE_VERSION, cursor: 0, cursorTs: 0, tokens: [], pairs: [], flags: new Map(), firstBuyAny: new Map(), codes: new Map(), hours: new Map(), days: new Map(), pools: [], grid: new Map(), dailyPx: {}, yahooFilled: [], transfers: 0, updatedAt: '' };
}

const FILE = 'state.json.gz';
const localPath = () => path.join(CACHE_DIR, FILE);

function serialize(s: State): Buffer {
  const pairs = s.pairs.map((m) => {
    const rows: (string | number)[][] = [];
    for (const [a, p] of m) rows.push([a, p.bal, p.fi, p.rs, p.gap, p.fdb, p.cw, p.cn, p.lp, p.sk, p.bq, +p.bc.toFixed(4)]);
    return rows;
  });
  const bk = (m: Map<number, Map<string, BucketRec>>) => [...m].map(([k, v]) => [k, [...v].map(([a, r]) => [a, r.n, r.b])]);
  const obj = {
    version: s.version, cursor: s.cursor, cursorTs: s.cursorTs, tokens: s.tokens, pairs,
    flags: [...s.flags], firstBuyAny: [...s.firstBuyAny], codes: [...s.codes], hours: bk(s.hours), days: bk(s.days),
    pools: s.pools, grid: [...s.grid], dailyPx: s.dailyPx, yahooFilled: s.yahooFilled, transfers: s.transfers, updatedAt: new Date().toISOString(),
  };
  return zlib.gzipSync(Buffer.from(JSON.stringify(obj)), { level: 6 });
}

function deserialize(buf: Buffer): State {
  const o = JSON.parse(zlib.gunzipSync(buf).toString());
  if (o.version !== STATE_VERSION) throw new Error(`state version ${o.version} != ${STATE_VERSION}`);
  const bk = (arr: any[]) => new Map<number, Map<string, BucketRec>>(arr.map(([k, v]: any) => [k, new Map(v.map(([a, n, b]: any) => [a, { n, b }]))]));
  return {
    version: o.version, cursor: o.cursor, cursorTs: o.cursorTs, tokens: o.tokens,
    pairs: o.pairs.map((rows: any[]) => new Map(rows.map((r: any[]) => [r[0], { bal: r[1], fi: r[2], rs: r[3], gap: r[4], fdb: r[5], cw: r[6], cn: r[7], lp: r[8], sk: r[9], bq: r[10], bc: r[11] }]))),
    flags: new Map(o.flags), firstBuyAny: new Map(o.firstBuyAny), codes: new Map(o.codes), hours: bk(o.hours), days: bk(o.days),
    pools: o.pools, grid: new Map(o.grid), dailyPx: o.dailyPx || {}, yahooFilled: o.yahooFilled || [], transfers: o.transfers || 0, updatedAt: o.updatedAt,
  };
}

export function readStateFile(file: string): State { return deserialize(fs.readFileSync(file)); }

export async function loadState(): Promise<State> {
  const lp = localPath();
  if (process.env.NO_GCS_STATE !== '1' && (process.env.STATE_FROM_GCS === '1' || !fs.existsSync(lp))) {
    try {
      const got = await download(STATE_PREFIX + FILE, lp + '.dl');
      if (got) {
        const remote = deserialize(fs.readFileSync(lp + '.dl'));
        const local = fs.existsSync(lp) ? deserialize(fs.readFileSync(lp)) : null;
        fs.renameSync(lp + '.dl', lp);
        if (!local || remote.cursor >= local.cursor) { console.log(`state: loaded from gs at block ${remote.cursor}`); return remote; }
        return local;
      }
    } catch (e: any) { console.warn('state: GCS load failed:', e?.message); }
  }
  if (fs.existsSync(lp)) { const s = deserialize(fs.readFileSync(lp)); console.log(`state: loaded local at block ${s.cursor}`); return s; }
  console.log('state: none, starting fresh');
  return emptyState();
}

export function saveLocal(s: State): number {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const buf = serialize(s);
  fs.writeFileSync(localPath() + '.tmp', buf);
  fs.renameSync(localPath() + '.tmp', localPath());
  return buf.length;
}

export async function mirrorState(): Promise<void> {
  await uploadMany([[localPath(), STATE_PREFIX + FILE]], { contentType: 'application/gzip', cacheControl: 'no-store' });
}
