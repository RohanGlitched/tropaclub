// Public wallet history shards (history/<xx>.json) and corporate-actions.json, built from the replay state.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import type { HistoryEntry, WalletHistory, WalletHistoryShard, WalletHistorySplitIndex, CounterpartyKind, CorporateActionsFile, MultiplierEventJson, AnnouncementJson } from '../../shared/types.ts';
import { HIST_MIN_USD, HIST_SHARD_SPLIT_BYTES, PUBLIC_PREFIX, UIM_UPDATED_TOPIC, UIM_CANCELLED_TOPIC, ANNOUNCEMENT_TOPIC, END_ANNOUNCEMENT_TOPIC } from './config.ts';
import { K_CONTRACT, type State } from './state.ts';
import { walletKind, type Outputs, type PriceInfo } from './output.ts';
import { dayIdx } from './time.ts';
import type { ApiToken } from './tokens.ts';

const CP: Record<string, CounterpartyKind> = { p: 'pool', r: 'router', d: 'distributor', m: 'mint', b: 'burn' };

// Wallets whose history is published: wallet-kind, holding >= $1 of any token or a real fan anywhere.
export function historyWallets(s: State, out: Outputs, pools: Set<string>, exclude: Set<string>): string[] {
  const res: string[] = [];
  for (const [a, w] of out.wallets) {
    if (exclude.has(a)) continue; // labelled routers / distributors are not tracked
    if (!w.tokens.some((t) => t.usd >= HIST_MIN_USD || t.kind === 'real')) continue;
    if (walletKind(s, pools, a) !== 'wallet') continue;
    res.push(a);
  }
  return res;
}

// Counterparty addresses that need a code kind (wallet vs contract) before publishing.
export function historyCounterparties(s: State, wallets: string[]): Set<string> {
  const need = new Set<string>();
  for (const a of wallets) for (const e of s.hist.get(a) || []) {
    const cp = e.split(',')[4];
    if (cp.length === 42 && !s.codes.has(cp)) need.add(cp);
  }
  return need;
}

export interface HistoryBuild { files: Map<string, string>; wallets: number; tooActive: number; entries: number }

export function buildHistory(s: State, wallets: string[], prices: Map<string, PriceInfo>, ts: (b: number) => number, nowTs: number): HistoryBuild {
  const today = dayIdx(nowTs);
  const shards = new Map<string, WalletHistoryShard>();
  for (let i = 0; i < 256; i++) shards.set(i.toString(16).padStart(2, '0'), {});
  let entriesN = 0, tooActive = 0;
  for (const a of wallets) {
    const shard = shards.get(a.slice(2, 4))!;
    if (s.histHeavy.has(a)) { shard[a] = { tokens: [], tooActive: true }; tooActive++; continue; }
    const byTok = new Map<number, HistoryEntry[]>();
    for (const e of s.hist.get(a) || []) {
      const [b, li, t, sv, cp, h] = e.split(',');
      const block = +b, tidx = +t;
      const tsec = ts(block);
      const tok = s.tokens[tidx];
      const day = dayIdx(tsec);
      let px: number | null = s.dailyPx[tok.address]?.[day] ?? null;
      if (px === null && day >= today - 2) px = prices.get(tok.address)?.price ?? null;
      let kind: CounterpartyKind, cpAddr: string | undefined;
      if (cp.length === 42) { kind = s.codes.get(cp) === K_CONTRACT ? 'contract' : 'wallet'; cpAddr = cp; }
      else kind = CP[cp];
      const he: HistoryEntry = { block, ts: tsec, logIndex: +li, dir: sv[0] === '+' ? 'in' : 'out', raw: sv.slice(1), counterpartyKind: kind, txHash: '0x' + Buffer.from(h, 'base64url').toString('hex'), priceUsd: px === null ? null : Math.round(px * 1e4) / 1e4 };
      if (cpAddr) he.counterparty = cpAddr;
      let arr = byTok.get(tidx);
      if (!arr) { arr = []; byTok.set(tidx, arr); }
      arr.push(he);
      entriesN++;
    }
    const w: WalletHistory = { tokens: [] };
    for (const [tidx, arr] of [...byTok].sort((x, y) => (s.tokens[x[0]].symbol < s.tokens[y[0]].symbol ? -1 : 1))) {
      arr.sort((x, y) => x.block - y.block || x.logIndex - y.logIndex);
      w.tokens.push({ symbol: s.tokens[tidx].symbol, address: s.tokens[tidx].address, entries: arr });
    }
    shard[a] = w;
  }
  // serialize; split oversized shards by token
  const files = new Map<string, string>(); // relative path under history/ -> JSON
  for (const [k, shard] of shards) {
    const json = JSON.stringify(shard);
    if (zlib.gzipSync(json).length <= HIST_SHARD_SPLIT_BYTES) { files.set(`${k}.json`, json); continue; }
    const bySym = new Map<string, WalletHistoryShard>();
    for (const [a, w] of Object.entries(shard)) {
      if (w.tooActive) { for (const m of bySym.values()) m[a] = w; continue; }
      for (const t of w.tokens) {
        let m = bySym.get(t.symbol);
        if (!m) { m = {}; bySym.set(t.symbol, m); }
        (m[a] ||= { tokens: [] }).tokens.push(t);
      }
    }
    const idx: WalletHistorySplitIndex = { split: true, symbols: [...bySym.keys()].sort() };
    files.set(`${k}.json`, JSON.stringify(idx));
    for (const [sym, m] of bySym) files.set(`${k}/${sym}.json`, JSON.stringify(m));
  }
  return { files, wallets: wallets.length, tooActive, entries: entriesN };
}

// Write history files; returns [local, object] pairs for files whose content changed since the last publish.
export function writeHistory(s: State, outDir: string, files: Map<string, string>): { changed: [string, string][]; totalBytes: number; totalGz: number; maxGz: number } {
  const dir = path.join(outDir, 'history');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const changed: [string, string][] = [];
  let totalBytes = 0, totalGz = 0, maxGz = 0;
  const next: Record<string, string> = {};
  for (const [rel, json] of files) {
    const l = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(l), { recursive: true });
    fs.writeFileSync(l, json);
    const gz = zlib.gzipSync(json).length;
    totalBytes += json.length; totalGz += gz; maxGz = Math.max(maxGz, gz);
    const h = crypto.createHash('sha1').update(json).digest('hex');
    next[rel] = h;
    if (s.histShardHash[rel] !== h) changed.push([l, `${PUBLIC_PREFIX}history/${rel}`]);
  }
  s.histShardHash = next;
  return { changed, totalBytes, totalGz, maxGz };
}

// ---------------- corporate actions ----------------
const word = (data: string, i: number) => BigInt('0x' + data.slice(2 + i * 64, 2 + (i + 1) * 64));
function abiString(data: string, argIndex: number): string {
  const off = Number(word(data, argIndex)) * 2;
  const len = Number(BigInt('0x' + data.slice(2 + off, 2 + off + 64)));
  return Buffer.from(data.slice(2 + off + 64, 2 + off + 64 + len * 2), 'hex').toString('utf8');
}

export function buildCorporateActions(s: State, meta: Map<string, ApiToken>, ts: (b: number) => number, asOf: string, block: number): CorporateActionsFile {
  const annByTx = new Map<string, string>();
  const anns: AnnouncementJson[] = [];
  const mults: MultiplierEventJson[] = [];
  const seen = new Set<string>();
  const logs = [...s.corp].sort((x, y) => x.b - y.b || x.li - y.li).filter((l) => { const k = `${l.b}:${l.li}`; return seen.has(k) ? false : (seen.add(k), true); });
  for (const l of logs) {
    try {
      if (l.topics[0] === ANNOUNCEMENT_TOPIC) {
        const a: AnnouncementJson = { token: l.address, kind: 'Announcement', id: abiString(l.data, 0), description: abiString(l.data, 1), uri: abiString(l.data, 2) || undefined, caller: l.topics[1] ? '0x' + l.topics[1].slice(26) : undefined, blockNumber: l.b, logIndex: l.li, txHash: l.h, ts: ts(l.b) };
        anns.push(a);
        if (a.description) annByTx.set(`${l.h}:${l.address}`, a.description);
      } else if (l.topics[0] === END_ANNOUNCEMENT_TOPIC) {
        anns.push({ token: l.address, kind: 'EndAnnouncement', id: abiString(l.data, 0), blockNumber: l.b, logIndex: l.li, txHash: l.h, ts: ts(l.b) });
      }
    } catch (e: any) { console.warn(`corp: could not decode announcement ${l.h}: ${e?.message}`); }
  }
  for (const l of logs) {
    if (l.topics[0] === UIM_UPDATED_TOPIC) {
      const ev: MultiplierEventJson = { token: l.address, kind: 'updated', oldWad: word(l.data, 0).toString(), newWad: word(l.data, 1).toString(), effectiveAt: Number(word(l.data, 2)), blockNumber: l.b, logIndex: l.li, txHash: l.h, ts: ts(l.b) };
      const d = annByTx.get(`${l.h}:${l.address}`);
      if (d) ev.announcement = d;
      mults.push(ev);
    } else if (l.topics[0] === UIM_CANCELLED_TOPIC) {
      mults.push({ token: l.address, kind: 'cancelled', oldWad: '0', newWad: word(l.data, 0).toString(), effectiveAt: Number(word(l.data, 1)), blockNumber: l.b, logIndex: l.li, txHash: l.h, ts: ts(l.b) });
    }
  }
  const tokens = s.tokens.map((tk) => ({
    symbol: tk.symbol, address: tk.address, multiplierNow: meta.get(tk.address)?.multiplier ?? 1,
    multiplierEvents: mults.filter((m) => m.token === tk.address),
    announcements: anns.filter((a) => a.token === tk.address),
  }));
  return { asOf, block, tokens };
}
