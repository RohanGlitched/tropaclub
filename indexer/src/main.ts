// Tropa Club indexer entry point: load state -> replay new Transfer logs -> classify -> checks -> write + upload.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, OUT_DIR, START_BLOCK, HEAD_LAG_BLOCKS, PUBLIC_PREFIX, CACHE_CONTROL } from './config.ts';
import { loadApiTokens, loadPairs, poolSet, dexPrices, referencePrices, loadDailyPrices, yahooDaily, type ApiToken } from './tokens.ts';
import { loadState, saveLocal, mirrorState, readStateFile, type State } from './state.ts';
import { fetchWindow, fetchStats, type Log } from './fetcher.ts';
import type { CorpLog } from './state.ts';
import { buildHistory, writeHistory, buildCorporateActions, historyWallets, historyCounterparties } from './history.ts';
import { applyLogs, compactBuckets, type ReplayCtx } from './replay.ts';
import { batch, headBlock, rpcStats } from './rpc.ts';
import { ensureCodes } from './codes.ts';
import { buildOutputs, addressesNeedingCodes, type PriceInfo } from './output.ts';
import { runChecks, printCounts } from './checks.ts';
import { uploadMany } from './gcs.ts';
import { dayIdx } from './time.ts';

const T0 = Date.now();
const el = () => `${((Date.now() - T0) / 1000).toFixed(0)}s`;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const GRID = 10_000;
const TARGET_WINDOW_LOGS = 250_000;
const TARGET_UNIT_LOGS = 6_000;

// ---------- block timestamps: samples every 10k blocks + window ends, linear in between ----------
async function ensureGrid(s: State, a: number, b: number) {
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
function makeTs(s: State): (b: number) => number {
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

async function replayRange(s: State, addrs: string[], tokenIdx: Map<string, number>, from: number, to: number, ctxBase: Omit<ReplayCtx, 'ts'>, label: string) {
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
    const { negatives } = applyLogs(s, logs, { ...ctxBase, ts });
    if (corp.length) s.corp.push(...corp);
    negTotal += negatives;
    if (label === 'main') { s.cursor = b; s.cursorTs = ts(b); }
    console.log(`[${el()}] ${label} ${a}-${b} (${new Date(ts(b) * 1000).toISOString().slice(0, 16)}) logs ${logs.length} total ${s.transfers} req ${fetchStats.requests} splits ${fetchStats.splits} retries ${fetchStats.retries}${negatives ? ' NEG ' + negatives : ''}`);
    if (label === 'main' && Date.now() - lastSave > 10 * 60_000) {
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

function writeOutputs(out: ReturnType<typeof buildOutputs>): { tokens: [string, string][]; wallets: [string, string][]; top: [string, string][] } {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT_DIR, 'tokens'), { recursive: true });
  fs.mkdirSync(path.join(OUT_DIR, 'wallets'), { recursive: true });
  const tokens: [string, string][] = [], wallets: [string, string][] = [];
  for (const f of out.seats) {
    const l = path.join(OUT_DIR, 'tokens', `${f.symbol}.json`);
    fs.writeFileSync(l, JSON.stringify(f));
    tokens.push([l, `${PUBLIC_PREFIX}tokens/${f.symbol}.json`]);
  }
  const shards = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < 256; i++) shards.set(i.toString(16).padStart(2, '0'), {});
  for (const [a, w] of out.wallets) shards.get(a.slice(2, 4))![a] = w;
  for (const [k, v] of shards) {
    const l = path.join(OUT_DIR, 'wallets', `${k}.json`);
    fs.writeFileSync(l, JSON.stringify(v));
    wallets.push([l, `${PUBLIC_PREFIX}wallets/${k}.json`]);
  }
  const top: [string, string][] = [];
  for (const [name, obj] of [['stats.json', out.stats], ['index.json', out.index]] as const) {
    const l = path.join(OUT_DIR, name);
    fs.writeFileSync(l, JSON.stringify(obj));
    top.push([l, PUBLIC_PREFIX + name]);
  }
  return { tokens, wallets, top };
}

async function main() {
  const labels = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'labels.json'), 'utf8'));
  const distributors = new Set<string>(labels.distributors.map((a: string) => a.toLowerCase()));
  const smartHashes = new Set<string>(labels.smart_wallet_code_hashes);
  const routers = new Set<string>((labels.routers || []).map((a: string) => a.toLowerCase()));

  const s = await loadState();
  if (!s.cursor && process.env.CLOUD_RUN_JOB && process.env.ALLOW_FRESH !== '1') {
    throw new Error('no indexer state in GCS; refusing a full backfill in Cloud Run (run it locally, or set ALLOW_FRESH=1)');
  }
  if (!s.cursor && process.env.SEED_STATE) {
    // reuse wallet code kinds + GeckoTerminal daily prices from an earlier state (saves ~20 min of RPC/API calls)
    const seed = readStateFile(process.env.SEED_STATE);
    s.codes = seed.codes;
    s.dailyPx = seed.dailyPx;
    s.yahooFilled = seed.yahooFilled || [];
    s.pools = seed.pools; // keep every pool ever seen so swap classification matches earlier runs
    console.log(`seeded ${s.codes.size} code kinds and ${Object.keys(s.dailyPx).length} daily price series from ${process.env.SEED_STATE}`);
  }
  const api = await loadApiTokens();
  const minted = api.filter((t) => (t.totalSupply ?? 0) > 0 || t.firstMint);
  const meta = new Map<string, ApiToken>(api.map((t) => [t.address, t]));
  console.log(`[${el()}] API: ${api.length} tokens, ${minted.length} minted`);

  // pools + prices
  const pairs = await loadPairs(minted.map((t) => t.address));
  const pools = poolSet(pairs);
  for (const p of s.pools) pools.add(p);
  s.pools = [...pools];
  const mintedSet = new Set(minted.map((t) => t.address));
  const dex = dexPrices(pairs);
  const prices = new Map<string, PriceInfo>();
  for (const t of minted) { const d = dex.get(t.address); if (d) prices.set(t.address, { price: d.price, source: 'dex' }); }
  const refs = await referencePrices(minted.filter((t) => !prices.has(t.address)));
  for (const [a, px] of refs) prices.set(a, { price: px, source: 'reference' });
  console.log(`[${el()}] pools ${pools.size}, DEX-priced ${[...prices.values()].filter((p) => p.source === 'dex').length}, reference-priced ${refs.size}, unpriced ${minted.length - prices.size}`);

  const rawHead = await headBlock();
  const head = Number(process.env.END_BLOCK || rawHead - HEAD_LAG_BLOCKS);
  console.log(`[${el()}] head ${rawHead}, indexing to ${head}, state cursor ${s.cursor || '(fresh)'}`);

  // tokens: keep existing order; append any newly minted ones
  const known = new Set(s.tokens.map((t) => t.address));
  const fresh = minted.filter((t) => !known.has(t.address));
  for (const t of fresh) { s.tokens.push({ address: t.address, symbol: t.symbol, fromBlock: START_BLOCK }); s.pairs.push(new Map()); }
  for (const tk of s.tokens) { const m = meta.get(tk.address); if (m) tk.symbol = m.symbol; }
  const tokenIdx = new Map(s.tokens.map((t, i) => [t.address, i]));

  // daily prices for cost basis (only for tokens we have not loaded yet)
  const needPx = new Map([...dex].filter(([a]) => mintedSet.has(a) && !s.dailyPx[a]).map(([a, v]) => [a, { pair: v.pair }]));
  if (needPx.size && process.env.SKIP_OHLCV !== '1') {
    console.log(`[${el()}] loading daily prices for ${needPx.size} tokens (GeckoTerminal)`);
    const dp = await loadDailyPrices(needPx);
    for (const [a, m] of dp) s.dailyPx[a] = Object.fromEntries(m);
  }
  const today = dayIdx(Date.now() / 1000);
  const needY = minted.filter((t) => !s.yahooFilled.includes(t.address));
  if (needY.length) {
    const startDay = dayIdx(Date.UTC(2026, 7, 10) / 1000);
    const yd = await yahooDaily(needY, startDay, today);
    let filled = 0;
    for (const t of needY) {
      const m = yd.get(t.address);
      if (!m) continue;
      const cur = (s.dailyPx[t.address] ||= {});
      for (const [d, v] of m) if (!cur[d]) { cur[d] = v; filled++; }
      s.yahooFilled.push(t.address);
    }
    console.log(`[${el()}] Yahoo daily closes filled ${filled} token-days for ${yd.size}/${needY.length} tokens`);
  }
  const ctxBase: Omit<ReplayCtx, 'ts'> = {
    pools, distributors, routers,
    priceAt: (t, day) => {
      const a = s.tokens[t].address;
      const v = s.dailyPx[a]?.[day];
      if (v) return v;
      const cur = prices.get(a);
      return cur && cur.source === 'dex' && day >= today - 2 ? cur.price : null;
    },
  };

  // catch-up replay for tokens that appeared after the state was started
  if (s.cursor && fresh.length) {
    console.log(`[${el()}] catch-up for ${fresh.length} new tokens: ${fresh.map((t) => t.symbol).join(', ')}`);
    await replayRange(s, fresh.map((t) => t.address), tokenIdx, START_BLOCK, s.cursor, { ...ctxBase, outOfOrder: true }, 'catchup');
  }

  // main incremental replay
  const from = s.cursor ? s.cursor + 1 : START_BLOCK;
  await replayRange(s, s.tokens.map((t) => t.address), tokenIdx, from, head, ctxBase, 'main');
  if (!s.cursorTs) throw new Error('no cursor timestamp');
  compactBuckets(s, s.cursorTs);
  const sz = saveLocal(s);
  console.log(`[${el()}] replay done at block ${s.cursor}; state ${(sz / 1e6).toFixed(1)} MB; ${s.transfers} transfers applied; rpc calls ${rpcStats()}`);

  // wallet kinds
  const need = addressesNeedingCodes(s, pools);
  const nNew = await ensureCodes(s, need, smartHashes, s.cursor);
  console.log(`[${el()}] getCode: ${nNew} new addresses (${s.codes.size} known)`);
  saveLocal(s);

  const out = buildOutputs(s, meta, prices, pools, s.cursorTs, s.cursor);
  printCounts(out);
  const errors = await runChecks(s, out, meta, s.cursor);
  if (errors.length) {
    for (const e of errors) console.error('CHECK FAILED:', e);
    throw new Error(`${errors.length} sanity checks failed; nothing published`);
  }
  console.log(`[${el()}] all checks passed`);

  // ---- wallet history + corporate actions ----
  const tsOf = makeTs(s);
  const hw = historyWallets(s, out, pools, new Set([...routers, ...distributors]));
  const nCp = await ensureCodes(s, historyCounterparties(s, hw), smartHashes, s.cursor);
  // every published wallet's history must sum to its replayed balance, token by token
  let histBad = 0;
  for (const a of hw) {
    if (s.histHeavy.has(a)) continue;
    const net = new Map<number, number>();
    for (const e of s.hist.get(a) || []) { const p = e.split(','); net.set(+p[2], (net.get(+p[2]) || 0) + Number(p[3])); }
    s.tokens.forEach((_, t) => { const bal = s.pairs[t].get(a)?.bal || 0; if ((net.get(t) || 0) !== bal) { histBad++; if (histBad <= 5) console.error(`history mismatch ${a} ${s.tokens[t].symbol}: ${net.get(t) || 0} != ${bal}`); } });
  }
  if (histBad) throw new Error(`${histBad} wallet-token histories do not sum to the balance; nothing published`);
  const hb = buildHistory(s, hw, prices, tsOf, s.cursorTs);
  const corpFile = buildCorporateActions(s, meta, tsOf, out.index.asOf, s.cursor);
  const files = writeOutputs(out);
  const hres = writeHistory(s, OUT_DIR, hb.files);
  const corpLocal = path.join(OUT_DIR, 'corporate-actions.json');
  fs.writeFileSync(corpLocal, JSON.stringify(corpFile));
  const nMult = corpFile.tokens.reduce((x, t) => x + t.multiplierEvents.length, 0), nAnn = corpFile.tokens.reduce((x, t) => x + t.announcements.length, 0);
  console.log(`[${el()}] history: ${hb.wallets} wallets (${hb.tooActive} too active), ${hb.entries} entries, ${hb.files.size} files, ${(hres.totalBytes / 1e6).toFixed(1)} MB raw / ${(hres.totalGz / 1e6).toFixed(1)} MB gz (max shard ${(hres.maxGz / 1e3).toFixed(0)} KB gz), ${hres.changed.length} changed; ${nCp} new counterparty codes; balances reconcile`);
  console.log(`[${el()}] corporate actions: ${nMult} multiplier events, ${nAnn} announcements`);
  if (process.env.SKIP_UPLOAD === '1') { console.log('SKIP_UPLOAD=1: not uploading'); return; }
  const opts = { cacheControl: CACHE_CONTROL, contentType: 'application/json', gzip: true };
  await uploadMany(files.tokens, opts);
  await uploadMany(files.wallets, opts);
  await uploadMany(hres.changed, opts);
  await uploadMany([[corpLocal, PUBLIC_PREFIX + 'corporate-actions.json']], opts);
  await uploadMany(files.top, opts); // index + stats last, so they never point at missing files
  console.log(`[${el()}] uploaded ${files.tokens.length + files.wallets.length + hres.changed.length + 1 + files.top.length} files to gs://.../${PUBLIC_PREFIX}`);
  saveLocal(s); // persists published-shard hashes + counterparty codes
  if (process.env.SKIP_MIRROR === '1') { console.log('SKIP_MIRROR=1: state not mirrored'); return; }
  await mirrorState();
  console.log(`[${el()}] state mirrored; done`);
}

main().catch((e) => { console.error('FATAL', e?.stack || e); process.exit(1); });
