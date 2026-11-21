// eth_getCode wallet classification (same as research-scripts/getcode.js + analyze2.py `kind`).
import crypto from 'node:crypto';
import { batch } from './rpc.ts';
import { K_EOA, K_7702, K_SMART, K_CONTRACT, type State } from './state.ts';

export async function ensureCodes(s: State, addrs: Iterable<string>, smartHashes: Set<string>, block: number): Promise<number> {
  const todo = [...new Set(addrs)].filter((a) => !s.codes.has(a));
  if (!todo.length) return 0;
  const hexBlock = '0x' + block.toString(16);
  const res = await batch(todo.map((a) => ({ method: 'eth_getCode', params: [a, hexBlock] })), { block, size: 50, conc: 4 });
  todo.forEach((a, i) => {
    const c = String(res[i]).slice(2);
    let k = K_CONTRACT;
    if (c.length === 0) k = K_EOA;
    else if (c.startsWith('ef0100')) k = K_7702;
    else if (smartHashes.has(crypto.createHash('sha1').update(c).digest('hex').slice(0, 12))) k = K_SMART;
    s.codes.set(a, k);
  });
  return todo.length;
}

// Counterfactual smart wallets and fresh EOAs can gain code later; re-check EOAs that still hold value occasionally.
export async function recheckEoas(s: State, addrs: string[], smartHashes: Set<string>, block: number) {
  for (const a of addrs) if (s.codes.get(a) === K_EOA) s.codes.delete(a);
  await ensureCodes(s, addrs, smartHashes, block);
}
