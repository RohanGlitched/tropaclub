// Work-stealing eth_getLogs fetcher across several public RPCs with adaptive range/address splitting.
// Completeness: every (address, block) of a window is covered by exactly one successful request.
import { PROVIDERS, TRANSFER_TOPIC, CORP_TOPICS, type Provider } from './config.ts';
import type { CorpLog } from './state.ts';
import { rpcOn, RpcError, sleep } from './rpc.ts';

export interface Log { b: number; ti: number; li: number; t: number; f: string; to: string; v: number; h: string }

interface Unit { addrs: string[]; from: number; to: number; tries: number }

const hex = (n: number) => '0x' + n.toString(16);
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

export const fetchStats = { requests: 0, splits: 0, retries: 0, logs: 0 };
const providerPenalty = new Map<string, number>(); // provider -> time until which it backs off

export async function fetchWindow(addrs: string[], tokenIdx: Map<string, number>, a: number, b: number, unitSpan: number): Promise<{ logs: Log[]; corp: CorpLog[] }> {
  const queue: Unit[] = [];
  for (let s = a; s <= b; s += unitSpan) queue.push({ addrs, from: s, to: Math.min(b, s + unitSpan - 1), tries: 0 });
  const out: Log[] = [];
  const corp: CorpLog[] = [];
  let inflight = 0;
  let fatal: Error | null = null;

  const take = (p: Provider): Unit | null => {
    const i = queue.findIndex((u) => u.from >= p.minBlock);
    if (i < 0) return null;
    let u = queue.splice(i, 1)[0];
    if (u.addrs.length > p.maxAddr) {
      for (let k = p.maxAddr; k < u.addrs.length; k += p.maxAddr) queue.unshift({ ...u, addrs: u.addrs.slice(k, k + p.maxAddr) });
      u = { ...u, addrs: u.addrs.slice(0, p.maxAddr) };
    }
    if (u.to - u.from + 1 > p.maxRange) {
      queue.unshift({ ...u, from: u.from + p.maxRange });
      u = { ...u, to: u.from + p.maxRange - 1 };
    }
    return u;
  };

  const parse = (raw: any[]) => {
    for (const l of raw) {
      if (!l.topics || l.removed) continue;
      if (l.topics[0] !== TRANSFER_TOPIC) {
        if (CORP_TOPICS.includes(l.topics[0])) corp.push({ address: l.address.toLowerCase(), topics: l.topics, data: l.data, b: parseInt(l.blockNumber, 16), li: parseInt(l.logIndex, 16), h: l.transactionHash.toLowerCase() });
        continue;
      }
      if (l.topics.length !== 3) continue;
      const t = tokenIdx.get(l.address.toLowerCase());
      if (t === undefined) continue;
      const d = l.data && l.data !== '0x' ? BigInt(l.data) : 0n;
      if (d > MAX_SAFE) throw new Error(`value exceeds 2^53 in ${l.transactionHash}`);
      out.push({ b: parseInt(l.blockNumber, 16), ti: parseInt(l.transactionIndex, 16), li: parseInt(l.logIndex, 16), t, f: '0x' + l.topics[1].slice(26).toLowerCase(), to: '0x' + l.topics[2].slice(26).toLowerCase(), v: Number(d), h: l.transactionHash.toLowerCase() });
    }
  };

  async function worker(p: Provider) {
    while (!fatal) {
      const pen = providerPenalty.get(p.name) || 0;
      if (pen > Date.now()) { await sleep(Math.min(2000, pen - Date.now())); continue; }
      const u = take(p);
      if (!u) {
        if (inflight === 0 && !queue.some((q) => true)) return;
        if (inflight === 0 && !queue.some((q) => PROVIDERS.some((pp) => q.from >= pp.minBlock))) { fatal = new Error(`no provider serves block ${queue[0].from}`); return; }
        await sleep(100);
        continue;
      }
      inflight++;
      try {
        fetchStats.requests++;
        const res = await rpcOn(p, 'eth_getLogs', [{ address: u.addrs, topics: [[TRANSFER_TOPIC, ...CORP_TOPICS]], fromBlock: hex(u.from), toBlock: hex(u.to) }], 60_000);
        if (!Array.isArray(res)) throw new RpcError(`${p.name} getLogs non-array`, p.name, 'other');
        parse(res);
        fetchStats.logs += res.length;
      } catch (e: any) {
        const kind: string = e instanceof RpcError ? e.kind : 'other';
        if (kind === 'range' && u.to > u.from) {
          fetchStats.splits++;
          const m = Math.floor((u.from + u.to) / 2);
          queue.unshift({ ...u, from: m + 1, tries: 0 }, { ...u, to: m, tries: 0 });
        } else if (kind === 'range' && u.addrs.length > 1) {
          fetchStats.splits++;
          const h = Math.ceil(u.addrs.length / 2);
          queue.unshift({ ...u, addrs: u.addrs.slice(0, h) }, { ...u, addrs: u.addrs.slice(h) });
        } else {
          fetchStats.retries++;
          u.tries++;
          if (u.tries > 12) { fatal = new Error(`giving up on ${u.from}-${u.to}: ${e?.message}`); }
          else queue.push(u);
          providerPenalty.set(p.name, Date.now() + (kind === 'rate' ? 5000 : 1500) * Math.min(u.tries, 4));
          if (process.env.DBG) console.error('retry', p.name, u.from, u.to, String(e?.message).slice(0, 160));
        }
      } finally { inflight--; }
    }
  }

  await Promise.all(PROVIDERS.flatMap((p) => Array.from({ length: p.conc }, () => worker(p))));
  if (fatal) throw fatal;
  out.sort((x, y) => x.b - y.b || x.li - y.li);
  // drop exact duplicates (same block + logIndex), should never happen
  let w = 0;
  for (let i = 0; i < out.length; i++) if (i === 0 || out[i].b !== out[w - 1].b || out[i].li !== out[w - 1].li) out[w++] = out[i];
  out.length = w;
  corp.sort((x, y) => x.b - y.b || x.li - y.li);
  return { logs: out, corp };
}
