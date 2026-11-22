// Day marks for history entries: USD per whole raw token (1e8 raw units) on a UTC day.
//
// Units: every source here is "USD per raw whole token", i.e. share price x uiMultiplier in force at that time.
//   - Chainlink "Coinbase <TICKER>" total-return feeds report exactly that (checked on SNDKc across its 8-for-1
//     split: ~$800 per raw token before, ~$650 per raw token = 8 shares x ~$81 after).
//   - DEX pool prices are per raw token by construction.
//   - Yahoo closes are split-adjusted per-share prices; converted as close x M_now / (dividend bumps after that day).
//
// Rule per (token, day):
//   Chainlink feed exists and updated that UTC day (sampled at 22:00 UTC)  -> 'chainlink'
//   feed exists but frozen (weekend / holiday): pool daily average if within +-15% of the last answer -> 'pool',
//     otherwise the last answer -> 'carry'
//   no feed: pool if within +-15% of the Yahoo reference (or no reference) -> 'pool', else Yahoo -> 'reference'
import { batch, call, sleep } from './rpc.ts';
import { DAY, dayIdx } from './time.ts';
import type { State } from './state.ts';
import type { ApiToken } from './tokens.ts';
import { yahooDaily, loadDailyPrices } from './tokens.ts';

export type MarkSource = 'chainlink' | 'pool' | 'carry' | 'reference';
export const MARK_BAND = 0.15;
const SAMPLE_HOUR = 22;

// Chainlink "Coinbase <TICKER>" feeds on Base, keyed by B20 token (same list as buy/src/constants.ts STOCK_FEEDS).
export const CHAINLINK_FEEDS: Record<string, string> = {
  '0xb200000000000000000000c2e324d24d7eecd1fb': '0x787f13dEa48Db0897CbCDD985de77809D837F988', // AAPLc
  '0xb200000000000000000000d9192b6b456483c2e8': '0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295', // AMZNc
  '0xb2000000000000000000002d0ba3164cc74f58b7': '0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2', // GOOGLc
  '0xb2000000000000000000008bc8786b856e61707c': '0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D', // METAc
  '0xb200000000000000000000ab99cfa739e253872b': '0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c', // MSFTc
  '0xb2000000000000000000004884b426556b92883d': '0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a', // MSTRc
  '0xb20000000000000000000078ee7ce2fe4908108c': '0x04689a41629776563E6822F76f2e57D148d28513', // NVDAc
  '0xb200000000000000000000397293cb8cda9a10c5': '0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA', // SNDKc
  '0xb2000000000000000000007b9fcbd005511acbd5': '0x6A634B235903C4ad6376892180d6fF8612e3Fa68', // SPCXc
  '0xb2000000000000000000001e800a7f5189430cd0': '0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4', // TSLAc
};

function blockAtFn(s: State): (t: number) => number {
  const pts = [...s.grid].sort((x, y) => x[0] - y[0]);
  return (t: number) => {
    let lo = 0, hi = pts.length - 1;
    if (t <= pts[0][1]) return pts[0][0];
    if (t >= pts[hi][1]) return pts[hi][0];
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m][1] <= t) lo = m; else hi = m; }
    const [b0, t0] = pts[lo], [b1, t1] = pts[hi];
    return Math.floor(b0 + ((b1 - b0) * (t - t0)) / Math.max(1, t1 - t0));
  };
}

// Fetch latestRoundData at 22:00 UTC of each day (or the cursor block for today) for every feed. Incremental.
export async function updateChainlink(s: State, startDay: number): Promise<number> {
  const blockAt = blockAtFn(s);
  const today = dayIdx(s.cursorTs);
  const reqs: { tok: string; day: number; block: number }[] = [];
  for (const [tok, feed] of Object.entries(CHAINLINK_FEEDS)) {
    const have = (s.cl[tok] ||= {});
    for (let d = startDay; d <= today; d++) {
      const t = d * DAY + SAMPLE_HOUR * 3600;
      if (have[d] && t <= s.cursorTs - 3600 && have[d][2] === 1) continue; // final sample already stored
      const block = t >= s.cursorTs ? s.cursor : blockAt(t);
      reqs.push({ tok, day: d, block });
      void feed;
    }
  }
  const old = reqs.filter((r) => r.block < 51_050_000), recent = reqs.filter((r) => r.block >= 51_050_000);
  for (const grp of [old, recent]) {
    if (!grp.length) continue;
    const params = (r: { tok: string; block: number }) => [{ to: CHAINLINK_FEEDS[r.tok], data: '0xfeaf968c' }, '0x' + r.block.toString(16)];
    let res: (string | null)[];
    if (grp === old) {
      // only the Tenderly gateway serves these archive blocks, and it rate-limits batches: go one by one, slowly
      res = [];
      for (const r of grp) {
        try { res.push(await call('eth_call', params(r), r.block)); } catch { res.push(undefined as any); } // error: retry next run
        await sleep(250);
      }
    } else {
      res = await batch(grp.map((r) => ({ method: 'eth_call', params: params(r) })), { block: grp[0].block, size: 25, conc: 3, allowItemErrors: true });
      // items the non-archive endpoints refused (state older than their window): retry one by one, rotating to Tenderly
      for (let i = 0; i < grp.length; i++) {
        if (res[i] !== null) continue;
        try { res[i] = await call('eth_call', params(grp[i]), grp[i].block); } catch { res[i] = undefined as any; }
        await sleep(250);
      }
    }
    grp.forEach((r, i) => {
      const l = res[i];
      if (l === undefined) return; // RPC error, not an empty answer
      const final = r.day * DAY + SAMPLE_HOUR * 3600 <= s.cursorTs - 3600 ? 1 : 0;
      // feed not deployed / no answer yet at that block: remember the miss so it is not re-queried every run
      if (!l || l.length < 2 + 64 * 5) { s.cl[r.tok][r.day] = [0, 0, final]; return; }
      const w = (k: number) => BigInt('0x' + l.slice(2 + 64 * k, 66 + 64 * k));
      const ans = Number(w(1)) / 1e8, upd = Number(w(3));
      if (ans <= 0) { s.cl[r.tok][r.day] = [0, 0, final]; return; }
      s.cl[r.tok][r.day] = [ans, upd, final];
    });
  }
  return reqs.length;
}

// Pool (GeckoTerminal deepest pair) and Yahoo reference series, kept separately. Yahoo refreshes at most daily.
export async function updatePoolAndRef(s: State, minted: ApiToken[], dex: Map<string, { pair: string }>, startDay: number, liveDex: Map<string, number>) {
  const today = dayIdx(s.cursorTs);
  const needPool = new Map([...dex].filter(([a]) => minted.some((t) => t.address === a) && !s.poolPx[a]));
  if (needPool.size && process.env.SKIP_OHLCV !== '1') {
    console.log(`marks: GeckoTerminal daily pool prices for ${needPool.size} tokens`);
    const dp = await loadDailyPrices(needPool);
    for (const [a, m] of dp) s.poolPx[a] = Object.fromEntries(m);
  }
  // the live DEX price stands in for today's pool mark (GeckoTerminal is fetched once per token)
  for (const [a, px] of liveDex) (s.poolLive[a] ||= {})[today] = px;
  if (s.refDay !== today) {
    const yd = await yahooDaily(minted.map((t) => ({ ...t, multiplier: 1 })), startDay, today);
    for (const [a, m] of yd) s.refPx[a] = Object.fromEntries(m);
    s.refDay = today;
    console.log(`marks: Yahoo reference closes for ${yd.size}/${minted.length} tokens`);
  }
}

// Multiplier timeline from UIMultiplierUpdated events (effectiveAt), for converting Yahoo closes.
interface MultEv { at: number; ratio: number; split: boolean }
function multEvents(s: State, decoded: { token: string; kind: string; oldWad: string; newWad: string; effectiveAt: number; announcement?: string }[]): Map<string, MultEv[]> {
  const m = new Map<string, MultEv[]>();
  for (const e of decoded) {
    if (e.kind !== 'updated') continue;
    const ratio = Number(BigInt(e.newWad) * 1_000_000n / (BigInt(e.oldWad) || 1n)) / 1e6;
    const split = /split/i.test(e.announcement || '') || ratio >= 1.9;
    (m.get(e.token) || m.set(e.token, []).get(e.token)!).push({ at: e.effectiveAt, ratio, split });
  }
  void s;
  return m;
}

export interface Marker { mark: (tok: string, day: number) => { px: number; src: MarkSource } | null }

export function makeMarker(s: State, meta: Map<string, ApiToken>, corpDecoded: Parameters<typeof multEvents>[1]): Marker {
  const mev = multEvents(s, corpDecoded);
  const cache = new Map<string, { px: number; src: MarkSource } | null>();
  const refAt = (tok: string, day: number): number | null => {
    const close = s.refPx[tok]?.[day];
    if (!close) return null;
    const mNow = meta.get(tok)?.multiplier ?? 1;
    let divAfter = 1;
    for (const e of mev.get(tok) || []) if (!e.split && e.at > day * DAY + SAMPLE_HOUR * 3600) divAfter *= e.ratio;
    return (close * mNow) / divAfter;
  };
  const lastCl = (tok: string, day: number): [number, number] | null => {
    const cl = s.cl[tok];
    if (!cl) return null;
    for (let d = day; d >= day - 10; d--) if (cl[d] && cl[d][0] > 0) return [cl[d][0], cl[d][1]];
    return null;
  };
  const mark = (tok: string, day: number) => {
    const k = tok + ':' + day;
    if (cache.has(k)) return cache.get(k)!;
    let r: { px: number; src: MarkSource } | null = null;
    const pool = s.poolPx[tok]?.[day] ?? s.poolLive[tok]?.[day] ?? null;
    const cl = CHAINLINK_FEEDS[tok] ? lastCl(tok, day) : null;
    if (cl) {
      const [ans, upd] = cl;
      if (upd >= day * DAY) r = { px: ans, src: 'chainlink' };
      else if (pool && Math.abs(pool / ans - 1) <= MARK_BAND) r = { px: pool, src: 'pool' };
      else r = { px: ans, src: 'carry' };
    } else {
      const ref = refAt(tok, day);
      if (pool && (!ref || Math.abs(pool / ref - 1) <= MARK_BAND)) r = { px: pool, src: 'pool' };
      else if (ref) r = { px: ref, src: 'reference' };
    }
    cache.set(k, r);
    return r;
  };
  return { mark };
}
