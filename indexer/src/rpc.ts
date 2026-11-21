// Minimal JSON-RPC client over public Base endpoints (read-only).
import { PROVIDERS, CALL_PROVIDERS, type Provider } from './config.ts';

export class RpcError extends Error {
  constructor(msg: string, public provider: string, public kind: 'range' | 'rate' | 'other') { super(msg); }
}

let rpcCalls = 0;
export const rpcStats = () => rpcCalls;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export { sleep };

function classify(msg: string): 'range' | 'rate' | 'other' {
  if (/max results|too many|exceed|range|limit is|response size|10000|20000|timeout|aborted|abort/i.test(msg) && !/request limit reached|rate/i.test(msg)) return 'range';
  if (/429|rate|too many requests|request limit|capacity|busy/i.test(msg)) return 'rate';
  return 'other';
}

export async function rpcRaw(p: Provider, body: unknown, timeoutMs = 90_000): Promise<any> {
  rpcCalls++;
  let r: Response;
  try {
    r = await fetch(p.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'tropa-indexer/1.0' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e: any) {
    const m = String(e?.message || e);
    throw new RpcError(`${p.name} fetch: ${m}`, p.name, /abort|timeout/i.test(m) ? 'range' : 'other');
  }
  const txt = await r.text();
  let j: any;
  try { j = JSON.parse(txt); } catch {
    throw new RpcError(`${p.name} non-json ${r.status} ${txt.slice(0, 120)}`, p.name, r.status === 429 ? 'rate' : 'other');
  }
  return j;
}

export async function rpcOn(p: Provider, method: string, params: unknown[], timeoutMs?: number): Promise<any> {
  const j = await rpcRaw(p, { jsonrpc: '2.0', id: 1, method, params }, timeoutMs);
  if (j.error) {
    const m = JSON.stringify(j.error).slice(0, 300);
    throw new RpcError(`${p.name} ${method}: ${m}`, p.name, classify(m));
  }
  return j.result;
}

const byName = (n: string) => PROVIDERS.find((p) => p.name === n)!;

// Point call with failover across providers. `block` (if numeric) restricts to providers that serve it.
export async function call(method: string, params: unknown[], block?: number): Promise<any> {
  const order = CALL_PROVIDERS.map(byName).filter((p) => block === undefined || block >= p.minBlock);
  let last: unknown;
  for (let att = 0; att < 8; att++) {
    const p = order[att % order.length];
    try { return await rpcOn(p, method, params, 60_000); } catch (e) { last = e; await sleep(500 * (att + 1)); }
  }
  throw last;
}

// Batched calls. Returns results in input order; throws if any item errors after retries.
export async function batch(reqs: { method: string; params: unknown[] }[], opts: { block?: number; size?: number; conc?: number } = {}): Promise<any[]> {
  const size = opts.size ?? 50, conc = opts.conc ?? 3;
  const order = CALL_PROVIDERS.map(byName).filter((p) => opts.block === undefined || opts.block >= p.minBlock);
  const out: any[] = new Array(reqs.length);
  const chunks: number[] = [];
  for (let i = 0; i < reqs.length; i += size) chunks.push(i);
  let ci = 0;
  async function worker() {
    while (ci < chunks.length) {
      const start = chunks[ci++];
      const part = reqs.slice(start, start + size);
      let ok = false, last: unknown;
      for (let att = 0; att < 8 && !ok; att++) {
        const p = order[att % order.length];
        try {
          const j = await rpcRaw(p, part.map((r, k) => ({ jsonrpc: '2.0', id: k, method: r.method, params: r.params })), 60_000);
          if (!Array.isArray(j)) throw new Error(`${p.name} batch non-array ${JSON.stringify(j).slice(0, 200)}`);
          const res: any[] = new Array(part.length);
          for (const x of j) {
            if (x.error || x.result === undefined) throw new Error(`${p.name} batch item error ${JSON.stringify(x.error).slice(0, 200)}`);
            res[x.id] = x.result;
          }
          if (res.some((v) => v === undefined)) throw new Error(`${p.name} batch missing ids`);
          for (let k = 0; k < part.length; k++) out[start + k] = res[k];
          ok = true;
        } catch (e) { last = e; await sleep(700 * (att + 1)); }
      }
      if (!ok) throw last;
    }
  }
  await Promise.all(Array.from({ length: conc }, worker));
  return out;
}

export async function headBlock(): Promise<number> {
  const results = await Promise.allSettled(PROVIDERS.filter((p) => p.name !== 'tenderly').map((p) => rpcOn(p, 'eth_blockNumber', [], 20_000)));
  const nums = results.filter((r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled').map((r) => parseInt(r.value, 16));
  if (!nums.length) return parseInt(await call('eth_blockNumber', []), 16);
  return Math.min(...nums); // the slowest provider defines a head every provider can serve
}
