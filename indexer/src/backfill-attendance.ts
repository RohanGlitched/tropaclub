// One-time attendance backfill: replay every Transfer log from the first mint to the current state cursor in a
// separate, throwaway state, snapshotting at each 00:00 UTC (and every hour of the last ~9 days), then classify the
// snapshots with the published day marks and write gs://<state bucket>/indexer-state/attendance-backfill.json.gz.
// The production state is only read. main.ts merges the file on its next run.
// Usage (from indexer/): npx tsx src/backfill-attendance.ts   (SKIP_UPLOAD=1 to keep the file local)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { DATA_DIR, CACHE_DIR, START_BLOCK, STATE_PREFIX, STATE_BUCKET } from './config.ts';
import { loadState, emptyState } from './state.ts';
import { loadApiTokens, type ApiToken } from './tokens.ts';
import { buildCorporateActions } from './history.ts';
import { makeMarker } from './marks.ts';
import { ensureCodes } from './codes.ts';
import { uploadMany } from './gcs.ts';
import { replayRange, makeTs, el } from './window.ts';
import { AttCollector, HOURLY_KEEP } from './attendance.ts';

async function main() {
  const labels = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'labels.json'), 'utf8'));
  const distributors = new Set<string>(labels.distributors.map((a: string) => a.toLowerCase()));
  const smartHashes = new Set<string>(labels.smart_wallet_code_hashes);
  const routers = new Set<string>((labels.routers || []).map((a: string) => a.toLowerCase()));

  const P = await loadState(); // production state (read only)
  if (!P.cursor) throw new Error('no production state');
  const end = Number(process.env.END_BLOCK || P.cursor);
  console.log(`[${el()}] production state at ${P.cursor} (${new Date(P.cursorTs * 1000).toISOString()}); backfill ${START_BLOCK}-${end}`);

  // throwaway replay state: same token order, pools, codes and timestamp grid as production
  const F = emptyState();
  F.tokens = P.tokens.map((t) => ({ ...t }));
  F.pairs = P.tokens.map(() => new Map());
  F.codes = P.codes;
  F.pools = P.pools;
  for (const [b, t] of P.grid) if (b <= end) F.grid.set(b, t);
  const pools = new Set(P.pools);
  const tokenIdx = new Map(F.tokens.map((t, i) => [t.address, i]));

  const att = new AttCollector(F, pools, Math.floor(Date.now() / 1000) - HOURLY_KEEP);
  await replayRange(F, F.tokens.map((t) => t.address), tokenIdx, START_BLOCK, end, {
    pools, distributors, routers, noHist: true,
    priceAt: (t, day) => P.dailyPx[F.tokens[t].address]?.[day] ?? null,
  }, 'backfill', att.hook());
  console.log(`[${el()}] replay done; ${att.caps.length} snapshots held`);

  // the throwaway replay must land exactly on the production balances
  if (end === P.cursor) {
    let bad = 0;
    F.tokens.forEach((tk, t) => {
      const a = F.pairs[t], b = P.pairs[t];
      for (const [addr, p] of b) if ((a.get(addr)?.bal || 0) !== p.bal) { bad++; if (bad <= 5) console.error(`balance mismatch ${tk.symbol} ${addr}: ${a.get(addr)?.bal} != ${p.bal}`); }
      for (const [addr, p] of a) if (p.bal && !b.has(addr)) { bad++; if (bad <= 5) console.error(`extra holder ${tk.symbol} ${addr}`); }
    });
    if (bad) throw new Error(`${bad} balances differ from the production state; backfill not written`);
    console.log(`[${el()}] balances equal the production state for all ${F.tokens.length} tokens`);
  }

  const unk = att.unknownAddrs();
  const nNew = await ensureCodes(F, unk, smartHashes, P.cursor);
  console.log(`[${el()}] getCode: ${nNew} historical holders`);

  const api = await loadApiTokens();
  const meta = new Map<string, ApiToken>(api.map((t) => [t.address, t]));
  const corp = buildCorporateActions(P, meta, makeTs(P), new Date().toISOString(), P.cursor);
  const marker = makeMarker(P, meta, corp.tokens.flatMap((t) => t.multiplierEvents));
  const store = { daily: {}, hourly: {}, backfill: 0 } as typeof P.att;
  const c = att.commit(store, marker);
  const file = { cursor: end, createdAt: new Date().toISOString(), daily: store.daily, hourly: store.hourly };
  const local = path.join(CACHE_DIR, 'attendance-backfill.json.gz');
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(local, zlib.gzipSync(JSON.stringify(file)));
  const days = Object.keys(store.daily).map(Number).sort((x, y) => x - y);
  const d0 = new Date(days[0] * 86400_000).toISOString().slice(0, 10), d1 = new Date(days[days.length - 1] * 86400_000).toISOString().slice(0, 10);
  console.log(`[${el()}] ${c.daily} end-of-day snapshots (${d0}..${d1}) + ${c.hourly} hourly -> ${local} (${(fs.statSync(local).size / 1e3).toFixed(0)} KB)`);
  const nv = P.tokens.findIndex((t) => t.symbol === 'NVDAc');
  if (nv >= 0) for (const d of days.slice(-5)) { const r = store.daily[d].tk[P.tokens[nv].address]; console.log(`  NVDAc end of ${new Date(d * 86400_000).toISOString().slice(0, 10)}: holders ${r[0]} real ${r[1]} dust ${r[2]} farmer ${r[3]} contracts ${r[4]} px ${r[5]} ${r[6]}`); }
  if (process.env.SKIP_UPLOAD === '1') { console.log('SKIP_UPLOAD=1: not uploading'); return; }
  await uploadMany([[local, STATE_PREFIX + 'attendance-backfill.json.gz']], { contentType: 'application/gzip', cacheControl: 'no-store', bucket: STATE_BUCKET });
  console.log(`[${el()}] uploaded to gs://${STATE_BUCKET}/${STATE_PREFIX}attendance-backfill.json.gz`);
}

main().catch((e) => { console.error('FATAL', e?.stack || e); process.exit(1); });
