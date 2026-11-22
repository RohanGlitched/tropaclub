// Compact replay state: everything needed to continue the replay incrementally and to compute outputs.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { CACHE_DIR, STATE_PREFIX, STATE_BUCKET } from './config.ts';
import { download, uploadMany } from './gcs.ts';

export const STATE_VERSION = 2;

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

// Raw corporate-action logs emitted by the B20 tokens (UIMultiplierUpdated / ...Cancelled / Announcement / EndAnnouncement).
export interface CorpLog { address: string; topics: string[]; data: string; b: number; li: number; h: string }

export interface TrackedToken { address: string; symbol: string; fromBlock: number }

// Attendance snapshots (attendance.ts). Per token address: [holders, real, dust, farmer, contracts(+pools), priceUsd, priceSource].
export type AttRow = [number, number, number, number, number, number | null, string | null];
export interface AttSnap { ts: number; block: number; uniq: number; tk: Record<string, AttRow> }
export interface AttStore {
  daily: Record<number, AttSnap>;  // day index -> state at the end-of-day block (last block before 00:00 UTC of day+1)
  hourly: Record<number, AttSnap>; // hour boundary (unix s) -> state at the last block before it; last ~9 days only
  backfill: number;                // cursor of the merged one-time backfill (0 = not merged yet)
}
export const emptyAtt = (): AttStore => ({ daily: {}, hourly: {}, backfill: 0 });

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
  // ---- wallet history (persisted in a second file, history.json.gz) ----
  // addr -> entries "block,logIndex,tokenIdx,signedRaw,cp,txHashBase64url"; cp = p|r|d|m|b or the counterparty address
  hist: Map<string, string[]>;
  histHeavy: Set<string>;      // addresses that passed HIST_CAP entries (bots); history dropped
  corp: CorpLog[];
  histShardHash: Record<string, string>; // published shard -> content hash (upload only changed shards)
  // ---- day marks (marks.ts) ----
  cl: Record<string, Record<number, [number, number, number]>>; // token -> day -> [answer per raw token, updatedAt, final]
  poolPx: Record<string, Record<number, number>>;   // GeckoTerminal deepest-pool daily average
  poolLive: Record<string, Record<number, number>>; // live DEX price seen by a run on that day
  refPx: Record<string, Record<number, number>>;    // Yahoo split-adjusted close per share (forward-filled)
  refDay: number;
  att: AttStore;
}

export function emptyState(): State {
  return { version: STATE_VERSION, cursor: 0, cursorTs: 0, tokens: [], pairs: [], flags: new Map(), firstBuyAny: new Map(), codes: new Map(), hours: new Map(), days: new Map(), pools: [], grid: new Map(), dailyPx: {}, yahooFilled: [], transfers: 0, updatedAt: '', hist: new Map(), histHeavy: new Set(), corp: [], histShardHash: {}, cl: {}, poolPx: {}, poolLive: {}, refPx: {}, refDay: 0, att: emptyAtt() };
}

const FILE = 'state.json.gz';
const HFILE = 'history.json.gz';
const localPath = () => path.join(CACHE_DIR, FILE);
const histPath = () => path.join(CACHE_DIR, HFILE);

// History file: gzip members of text lines. Line 1 = JSON header, then "addr<TAB>entry|entry|...".
// Written in chunks (never one giant string), parsed from a Buffer line by line.
function writeHist(s: State, file: string): number {
  const fd = fs.openSync(file, 'w');
  let bytes = 0;
  const put = (txt: string) => { const gz = zlib.gzipSync(Buffer.from(txt), { level: 6 }); fs.writeSync(fd, gz); bytes += gz.length; };
  put(JSON.stringify({ cursor: s.cursor, heavy: [...s.histHeavy] }) + '\n');
  let buf: string[] = [], len = 0;
  for (const [a, es] of s.hist) {
    const line = a + '\t' + es.join('|') + '\n';
    buf.push(line); len += line.length;
    if (len > 8_000_000) { put(buf.join('')); buf = []; len = 0; }
  }
  if (buf.length) put(buf.join(''));
  fs.closeSync(fd);
  return bytes;
}
function loadHistInto(s: State, gz: Buffer) {
  const raw = zlib.gunzipSync(gz);
  let pos = raw.indexOf(10);
  const head = JSON.parse(raw.subarray(0, pos).toString());
  if (head.cursor !== s.cursor) throw new Error(`history cursor ${head.cursor} != state cursor ${s.cursor}`);
  s.histHeavy = new Set(head.heavy);
  s.hist = new Map();
  pos++;
  while (pos < raw.length) {
    let nl = raw.indexOf(10, pos);
    if (nl < 0) nl = raw.length;
    const line = raw.subarray(pos, nl).toString();
    const tab = line.indexOf('\t');
    if (tab > 0) { const j = line.slice(tab + 1); s.hist.set(line.slice(0, tab), j ? j.split('|') : []); }
    pos = nl + 1;
  }
}

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
    pools: s.pools, grid: [...s.grid], dailyPx: s.dailyPx, yahooFilled: s.yahooFilled, transfers: s.transfers, corp: s.corp, histShardHash: s.histShardHash, cl: s.cl, poolPx: s.poolPx, poolLive: s.poolLive, refPx: s.refPx, refDay: s.refDay, att: s.att, updatedAt: new Date().toISOString(),
  };
  return zlib.gzipSync(Buffer.from(JSON.stringify(obj)), { level: 6 });
}

function deserialize(buf: Buffer, allowOld = false): State {
  const o = JSON.parse(zlib.gunzipSync(buf).toString());
  if (o.version !== STATE_VERSION && !allowOld) throw new Error(`state version ${o.version} != ${STATE_VERSION}`);
  const bk = (arr: any[]) => new Map<number, Map<string, BucketRec>>(arr.map(([k, v]: any) => [k, new Map(v.map(([a, n, b]: any) => [a, { n, b }]))]));
  return {
    version: o.version, cursor: o.cursor, cursorTs: o.cursorTs, tokens: o.tokens,
    pairs: o.pairs.map((rows: any[]) => new Map(rows.map((r: any[]) => [r[0], { bal: r[1], fi: r[2], rs: r[3], gap: r[4], fdb: r[5], cw: r[6], cn: r[7], lp: r[8], sk: r[9], bq: r[10], bc: r[11] }]))),
    flags: new Map(o.flags), firstBuyAny: new Map(o.firstBuyAny), codes: new Map(o.codes), hours: bk(o.hours), days: bk(o.days),
    pools: o.pools, grid: new Map(o.grid), dailyPx: o.dailyPx || {}, yahooFilled: o.yahooFilled || [], transfers: o.transfers || 0, updatedAt: o.updatedAt,
    hist: new Map(), histHeavy: new Set(), corp: o.corp || [], histShardHash: o.histShardHash || {},
    cl: o.cl || {}, poolPx: o.poolPx || {}, poolLive: o.poolLive || {}, refPx: o.refPx || {}, refDay: o.refDay || 0, att: o.att || emptyAtt(),
  };
}

// For seeding a rebuild from an older state (codes, prices); version is not checked.
export function readStateFile(file: string): State { return deserialize(fs.readFileSync(file), true); }

function withHist(s: State, file: string): State {
  if (!fs.existsSync(file)) throw new Error(`state at ${s.cursor} has no ${HFILE}; rebuild needed`);
  loadHistInto(s, fs.readFileSync(file));
  return s;
}

export async function loadState(): Promise<State> {
  const lp = localPath(), hp = histPath();
  if (process.env.NO_GCS_STATE !== '1' && (process.env.STATE_FROM_GCS === '1' || !fs.existsSync(lp))) {
    try {
      const got = await download(STATE_PREFIX + FILE, lp + '.dl', STATE_BUCKET);
      if (got) {
        const remote = deserialize(fs.readFileSync(lp + '.dl'));
        const local = fs.existsSync(lp) ? deserialize(fs.readFileSync(lp)) : null;
        if (!local || remote.cursor >= local.cursor) {
          if (!(await download(STATE_PREFIX + HFILE, hp + '.dl', STATE_BUCKET))) throw new Error('remote history missing');
          fs.renameSync(lp + '.dl', lp);
          fs.renameSync(hp + '.dl', hp);
          console.log(`state: loaded from gs at block ${remote.cursor}`);
          return withHist(remote, hp);
        }
        fs.rmSync(lp + '.dl', { force: true });
        console.log(`state: local (${local.cursor}) is newer than gs (${remote.cursor})`);
        return withHist(local, hp);
      }
    } catch (e: any) {
      if (process.env.CLOUD_RUN_JOB) throw e; // never silently start over in the cloud
      console.warn('state: GCS load failed:', e?.message);
    }
  }
  if (fs.existsSync(lp)) { const s = deserialize(fs.readFileSync(lp)); console.log(`state: loaded local at block ${s.cursor}`); return withHist(s, hp); }
  console.log('state: none, starting fresh');
  return emptyState();
}

export function saveLocal(s: State): number {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const buf = serialize(s);
  fs.writeFileSync(localPath() + '.tmp', buf);
  const hbytes = writeHist(s, histPath() + '.tmp');
  fs.renameSync(localPath() + '.tmp', localPath());
  fs.renameSync(histPath() + '.tmp', histPath());
  return buf.length + hbytes;
}

export async function mirrorState(): Promise<void> {
  // history first: a reader that sees the new state file must also find the matching history file
  await uploadMany([[histPath(), STATE_PREFIX + HFILE]], { contentType: 'application/gzip', cacheControl: 'no-store', bucket: STATE_BUCKET });
  await uploadMany([[localPath(), STATE_PREFIX + FILE]], { contentType: 'application/gzip', cacheControl: 'no-store', bucket: STATE_BUCKET });
}
