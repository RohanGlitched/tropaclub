// One slow statement must never hold up anyone else: pool and contract addresses get their holdings
// with no RPC at all, at most two statements read the chain at once, a statement that needs more
// than its share of reads gets "busy", and clearing the jobs aborts the ones still running.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const NVDA = '0xb20000000000000000000078ee7ce2fe4908108c';
const wallets: Record<string, { tokens: { symbol: string; usd: number; kind: string }[]; firstSeen: number | null } | null> = {};

vi.mock('../lib/server/data', () => ({
  dataBaseUrl: 'https://data.test',
  getIndex: async () => ({ source: 'live', data: { asOf: '2026-11-22T00:00:00Z', block: 60_600_000, tokens: [{ symbol: 'NVDAc', address: NVDA, priceUsd: 131, multiplier: 1 }] } }),
  getWallet: async (a: string) => ({ source: 'live', data: wallets[a.toLowerCase()] ?? null }),
}));

vi.mock('../lib/server/clubs', async () => {
  const { MemoryDocStore } = await import('@tropaclub/clubs');
  const svc = { ctx: { store: new MemoryDocStore() } };
  return { getClubs: async () => svc };
});

const POOL = '0x880db7dda4407d99508574e680d067d1164b3cfe';
const CONTRACT = '0x00000000000000000000000000000000000c0de1';
const w = (n: number) => `0x${n.toString(16).padStart(40, '0')}`;

type Call = { url: string; method?: string; signal?: AbortSignal };
let calls: Call[] = [];
/** How the fake RPC answers: 'hang' keeps every request open until it is aborted. */
let rpcMode: 'hang' | 'answer' = 'answer';

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', async (url: string, init?: { body?: string; signal?: AbortSignal }) => {
    const call: Call = { url: String(url), signal: init?.signal ?? undefined };
    calls.push(call);
    if (String(url).startsWith('https://data.test')) return new Response('missing', { status: 404 });
    const body = JSON.parse(init?.body ?? '{}') as { id: number; method: string };
    call.method = body.method;
    if (rpcMode === 'hang')
      return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    const result = body.method === 'eth_blockNumber' ? '0x39cb0a0' : body.method === 'eth_getLogs' ? [] : null;
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), { status: 200 });
  });
});
afterEach(() => vi.unstubAllGlobals());

const rpcCalls = () => calls.filter((c) => !c.url.startsWith('https://data.test'));
const settle = () => new Promise((r) => setTimeout(r, 20));

describe('statement jobs', () => {
  // the first import loads the clubs engine, which takes a few seconds
  beforeAll(async () => {
    await import('../lib/server/statement');
  }, 60_000);

  it('a pool or a contract gets its holdings from the index, with no RPC', async () => {
    const { statementStatus } = await import('../lib/server/statement');
    wallets[POOL] = { tokens: [{ symbol: 'NVDAc', usd: 540_166.88, kind: 'pool' }], firstSeen: 1_792_593_795 };
    wallets[CONTRACT] = { tokens: [{ symbol: 'NVDAc', usd: 12, kind: 'contract' }], firstSeen: 1_792_593_795 };
    const p = await statementStatus(POOL, 1000);
    expect(p).toMatchObject({ state: 'holdings', holdingsReason: 'pool', holdings: [{ symbol: 'NVDAc', usd: 540_166.88 }], reads: 0 });
    const c = await statementStatus(CONTRACT, 1000);
    expect(c).toMatchObject({ state: 'holdings', holdingsReason: 'contract' });
    expect(rpcCalls()).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('a third statement reading the chain gets "busy" with its holdings; clearing aborts the others', async () => {
    const { clearStatementJobs, statementLoad, statementStatus } = await import('../lib/server/statement');
    rpcMode = 'hang';
    for (const n of [1, 2, 3]) wallets[w(n)] = { tokens: [{ symbol: 'NVDAc', usd: 20 + n, kind: 'real' }], firstSeen: null };
    const a = await statementStatus(w(1), 30);
    const b = await statementStatus(w(2), 30);
    expect([a.state, b.state]).toEqual(['running', 'running']);
    expect(statementLoad().chainJobs).toBe(2);
    const c = await statementStatus(w(3), 1000);
    expect(c).toMatchObject({ state: 'busy', holdingsReason: 'busy', holdings: [{ symbol: 'NVDAc', usd: 23 }] });

    const signals = rpcCalls().map((x) => x.signal!);
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((s) => !s.aborted)).toBe(true);
    clearStatementJobs();
    await settle();
    expect(signals.every((s) => s.aborted)).toBe(true);
    expect([a.state, b.state]).toEqual(['failed', 'failed']);
    expect(statementLoad()).toMatchObject({ chainJobs: 0, jobs: 0 });
    rpcMode = 'answer';
  });

  it('a statement that would need more than its share of reads gets "busy" before reading the logs', async () => {
    const { MAX_READS_PER_JOB, statementStatus } = await import('../lib/server/statement');
    // no first-seen time: the whole stock-token history, hundreds of 50,000-block reads
    wallets[w(9)] = { tokens: [{ symbol: 'NVDAc', usd: 30, kind: 'real' }], firstSeen: null };
    const j = await statementStatus(w(9), 5000);
    expect(j).toMatchObject({ state: 'busy', holdingsReason: 'busy', holdings: [{ symbol: 'NVDAc', usd: 30 }] });
    expect(j.reads).toBeLessThan(MAX_READS_PER_JOB);
    expect(rpcCalls().filter((c) => c.method === 'eth_getLogs').length).toBeLessThanOrEqual(1);
  });
});
