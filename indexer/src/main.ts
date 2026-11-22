// Tropa Club indexer entry point: load state -> replay new Transfer logs -> classify -> checks -> write + upload.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA_DIR, OUT_DIR, CACHE_DIR, START_BLOCK, HEAD_LAG_BLOCKS, PUBLIC_PREFIX, CACHE_CONTROL, STATE_PREFIX, STATE_BUCKET } from './config.ts';
import { loadApiTokens, loadPairs, poolSet, dexPrices, referencePrices, loadDailyPrices, yahooDaily, type ApiToken } from './tokens.ts';
import { loadState, saveLocal, mirrorState, readStateFile, type State } from './state.ts';
import { buildHistory, writeHistory, buildCorporateActions, historyWallets, historyCounterparties } from './history.ts';
import { updateChainlink, updatePoolAndRef, makeMarker, CHAINLINK_FEEDS } from './marks.ts';
import { compactBuckets, type ReplayCtx } from './replay.ts';
import { headBlock, rpcStats } from './rpc.ts';
import { replayRange, makeTs, el } from './window.ts';
import { AttCollector, HOURLY_KEEP, capture, finalize, livePricer, pruneHourly, mergeBackfill, buildAttendanceHistory, serializeAttendance, buildMovers } from './attendance.ts';
import { ensureCodes } from './codes.ts';
import { buildOutputs, addressesNeedingCodes, type PriceInfo } from './output.ts';
import { runChecks, printCounts, checkAttendance } from './checks.ts';
import { uploadMany, download } from './gcs.ts';
import { dayIdx } from './time.ts';

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

// Largest gaps between the old published marks (state.dailyPx) / new marks and the Chainlink answer of the day.
function markReport(s: State, marker: ReturnType<typeof makeMarker>, startDay: number) {
  const rows: { sym: string; day: string; cl: number; old: number | null; nw: number | null; src: string }[] = [];
  const today = dayIdx(s.cursorTs);
  for (const tok of Object.keys(CHAINLINK_FEEDS)) {
    const sym = s.tokens.find((t) => t.address === tok)?.symbol || tok;
    for (let d = startDay; d <= today; d++) {
      const c = s.cl[tok]?.[d];
      if (!c || !c[0]) continue;
      const mk = marker.mark(tok, d);
      rows.push({ sym, day: new Date(d * 86400_000).toISOString().slice(0, 10), cl: c[0], old: s.dailyPx[tok]?.[d] ?? null, nw: mk?.px ?? null, src: mk?.src ?? '-' });
    }
  }
  const gap = (x: number | null, c: number) => (x === null ? -1 : Math.abs(x / c - 1));
  const show = (key: 'old' | 'nw') => [...rows].sort((a, b) => gap(b[key], b.cl) - gap(a[key], a.cl)).slice(0, 10)
    .map((r) => `${r.sym} ${r.day} cl=${r.cl.toFixed(2)} ${key}=${r[key]?.toFixed(2)} gap=${(gap(r[key], r.cl) * 100).toFixed(1)}%${key === 'nw' ? ' src=' + r.src : ''}`);
  console.log('MARK REPORT before (published dailyPx vs Chainlink):\n  ' + show('old').join('\n  '));
  console.log('MARK REPORT after (new marks vs Chainlink):\n  ' + show('nw').join('\n  '));
  const srcCount: Record<string, number> = {};
  for (const r of rows) srcCount[r.src] = (srcCount[r.src] || 0) + 1;
  console.log('MARK REPORT sources on feed tokens:', JSON.stringify(srcCount));
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
  if (!s.att.backfill && s.cursor) {
    // one-time attendance backfill (backfill-attendance.ts), merged into the state on the first run that finds it
    const bl = path.join(CACHE_DIR, 'attendance-backfill.json.gz');
    if (await download(STATE_PREFIX + 'attendance-backfill.json.gz', bl, STATE_BUCKET)) {
      const bf = JSON.parse(zlib.gunzipSync(fs.readFileSync(bl)).toString());
      if (bf.cursor > s.cursor) throw new Error(`attendance backfill cursor ${bf.cursor} is past the state cursor ${s.cursor}`);
      const m = mergeBackfill(s.att, bf);
      console.log(`attendance: merged backfill at ${bf.cursor}: ${m.daily} days, ${m.hourly} hourly snapshots`);
    } else console.warn('attendance: no backfill file in the state bucket yet');
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
  const att = new AttCollector(s, pools, Math.floor(Date.now() / 1000) - HOURLY_KEEP);
  await replayRange(s, s.tokens.map((t) => t.address), tokenIdx, from, head, ctxBase, 'main', att.hook());
  if (!s.cursorTs) throw new Error('no cursor timestamp');
  compactBuckets(s, s.cursorTs);
  // while boundary snapshots are only in memory, never save a cursor past them (they are committed with the marks below)
  const sz = att.caps.length ? 0 : saveLocal(s);
  console.log(`[${el()}] replay done at block ${s.cursor}; state ${att.caps.length ? `not saved (${att.caps.length} snapshots pending)` : (sz / 1e6).toFixed(1) + ' MB'}; ${s.transfers} transfers applied; rpc calls ${rpcStats()}`);

  // wallet kinds
  const need = addressesNeedingCodes(s, pools);
  for (const a of att.unknownAddrs()) need.add(a); // holders at a boundary snapshot that have since left
  const nNew = await ensureCodes(s, need, smartHashes, s.cursor);
  console.log(`[${el()}] getCode: ${nNew} new addresses (${s.codes.size} known)`);
  if (!att.caps.length) saveLocal(s);

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
  const corpFile = buildCorporateActions(s, meta, tsOf, out.index.asOf, s.cursor);
  // day marks: Chainlink first, pool only when the feed is frozen and within the band, Yahoo for feedless tokens
  const markStart = dayIdx(Date.UTC(2026, 7, 12) / 1000);
  const nCl = await updateChainlink(s, markStart);
  const liveDex = new Map([...prices].filter(([, p]) => p.source === 'dex' && p.price).map(([a, p]) => [a, p.price!]));
  await updatePoolAndRef(s, minted, dex, markStart, liveDex);
  const marker = makeMarker(s, meta, corpFile.tokens.flatMap((t) => t.multiplierEvents));
  const tAtt = Date.now();
  const committed = att.commit(s.att, marker);
  pruneHourly(s.att, s.cursorTs);
  saveLocal(s); // keep fetched marks and committed snapshots even if this run does not publish
  console.log(`[${el()}] marks: ${nCl} Chainlink samples fetched`);
  if (process.env.MARK_REPORT === '1') markReport(s, marker, markStart);
  // ---- attendance history + movers ----
  const nowSnap = finalize(s, capture(s, pools, s.cursorTs, s.cursor), livePricer(prices));
  const ah = buildAttendanceHistory(s, out, nowSnap, pools);
  const attErr = checkAttendance(ah.file, out);
  if (attErr.length) {
    for (const e of attErr) console.error('CHECK FAILED:', e);
    throw new Error(`${attErr.length} attendance checks failed; nothing published`);
  }
  const movers = buildMovers(s, out, nowSnap, pools);
  const attSer = serializeAttendance(ah.file);
  console.log(`[${el()}] attendance: ${committed.daily} end-of-day + ${committed.hourly} hourly snapshots taken; ${ah.file.days.length} days x ${ah.file.tokens.length} tokens, ${(attSer.gzBytes / 1e3).toFixed(0)} KB gz${attSer.split ? ' (split)' : ''}, missing days ${ah.missing.length ? ah.missing.join(',') : 'none'}; today matches index.json; movers ${movers.windows.map((w) => `${w.window}=${w.hours}h`).join(' ')}, ${movers.notable.length} notable lines (${Date.now() - tAtt} ms)`);
  for (const n of movers.notable) console.log('  notable:', n.text);
  const hb = buildHistory(s, hw, marker, tsOf);
  const files = writeOutputs(out);
  const hres = writeHistory(s, OUT_DIR, hb.files);
  const corpLocal = path.join(OUT_DIR, 'corporate-actions.json');
  fs.writeFileSync(corpLocal, JSON.stringify(corpFile));
  const attFiles: [string, string][] = [];
  for (const [rel, json] of [...attSer.files, ['movers.json', JSON.stringify(movers)] as [string, string]]) {
    const l = path.join(OUT_DIR, ...rel.split('/'));
    fs.mkdirSync(path.dirname(l), { recursive: true });
    fs.writeFileSync(l, json);
    attFiles.push([l, PUBLIC_PREFIX + rel]);
  }
  const nMult = corpFile.tokens.reduce((x, t) => x + t.multiplierEvents.length, 0), nAnn = corpFile.tokens.reduce((x, t) => x + t.announcements.length, 0);
  console.log(`[${el()}] history: ${hb.wallets} wallets (${hb.tooActive} too active), ${hb.entries} entries, ${hb.files.size} files, ${(hres.totalBytes / 1e6).toFixed(1)} MB raw / ${(hres.totalGz / 1e6).toFixed(1)} MB gz (max shard ${(hres.maxGz / 1e3).toFixed(0)} KB gz), ${hres.changed.length} changed; ${nCp} new counterparty codes; balances reconcile`);
  console.log(`[${el()}] corporate actions: ${nMult} multiplier events, ${nAnn} announcements`);
  if (process.env.SKIP_UPLOAD === '1') { console.log('SKIP_UPLOAD=1: not uploading'); return; }
  const opts = { cacheControl: CACHE_CONTROL, contentType: 'application/json', gzip: true };
  await uploadMany(files.tokens, opts);
  await uploadMany(files.wallets, opts);
  await uploadMany(hres.changed, opts);
  await uploadMany([[corpLocal, PUBLIC_PREFIX + 'corporate-actions.json']], opts);
  await uploadMany(attFiles, opts);
  await uploadMany(files.top, opts); // index + stats last, so they never point at missing files
  console.log(`[${el()}] uploaded ${files.tokens.length + files.wallets.length + hres.changed.length + 1 + attFiles.length + files.top.length} files to gs://.../${PUBLIC_PREFIX}`);
  saveLocal(s); // persists published-shard hashes + counterparty codes
  if (process.env.SKIP_MIRROR === '1') { console.log('SKIP_MIRROR=1: state not mirrored'); return; }
  await mirrorState();
  console.log(`[${el()}] state mirrored; done`);
}

main().catch((e) => { console.error('FATAL', e?.stack || e); process.exit(1); });
