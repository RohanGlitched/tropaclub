// A wallet's cost-basis statement, built without a paid history API.
//
// The slow way is to scan every block since the first stock token for every token. Instead:
//   1. the indexer's wallet file says which tokens this wallet holds and when it was first seen,
//      so only those tokens and only that block range are scanned;
//   2. the range is read in parallel chunks of eth_getLogs;
//   3. each token's multiplier history (splits, stock dividends) is read once and kept for six hours.
// A statement is kept for ten minutes per wallet. Building runs as a job: the page polls for it.
import 'server-only';
import { parseAbiItem } from 'viem';
import {
  ANNOUNCEMENT_TOPIC,
  B20_START_BLOCK,
  COL,
  RpcHistorySource,
  UI_MULTIPLIER_CANCELLED_TOPIC,
  UI_MULTIPLIER_UPDATED_TOPIC,
  buildStatement,
  decodeMultiplierLogs,
  type BuyDoc,
  type ChainReader,
  type MultiplierEvent,
  type Statement,
  type TransferLog,
} from '@tropaclub/clubs';
import { baseClient } from './chain';
import { getClubs } from './clubs';
import { getIndex, getWallet } from './data';

const CHUNK = 50_000n;
const PARALLEL = 8;
const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

export interface Job {
  startedAt: number;
  step: string;
  done: number;
  total: number;
  result: Promise<Statement | 'empty'>;
  state: 'running' | 'ready' | 'empty' | 'failed';
  value?: Statement;
}
const jobs = new Map<string, Job>();
const TTL = 10 * 60_000;

/** Run tasks a few at a time, in order. */
async function pool<T>(tasks: (() => Promise<T>)[], size: number, tick?: () => void): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        out[i] = await tasks[i]();
        tick?.();
      }
    }),
  );
  return out;
}

function ranges(from: bigint, to: bigint): [bigint, bigint][] {
  const r: [bigint, bigint][] = [];
  for (let s = from; s <= to; s += CHUNK) r.push([s, s + CHUNK - 1n > to ? to : s + CHUNK - 1n]);
  return r;
}

const multiplierMemo = new Map<string, { at: number; p: Promise<MultiplierEvent[]> }>();
function multiplierEvents(token: string, head: bigint): Promise<MultiplierEvent[]> {
  const k = token.toLowerCase();
  const hit = multiplierMemo.get(k);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.p;
  const client = baseClient();
  const p = (async () => {
    const parts = await pool(
      ranges(BigInt(B20_START_BLOCK), head).map(([fromBlock, toBlock]) => () =>
        client.request({
          method: 'eth_getLogs',
          params: [{ address: k as `0x${string}`, topics: [[UI_MULTIPLIER_UPDATED_TOPIC, UI_MULTIPLIER_CANCELLED_TOPIC, ANNOUNCEMENT_TOPIC]], fromBlock: `0x${fromBlock.toString(16)}`, toBlock: `0x${toBlock.toString(16)}` }],
        }),
      ),
      PARALLEL,
    );
    return decodeMultiplierLogs(
      parts.flat().map((l) => ({ address: l.address, topics: l.topics as string[], data: l.data, blockNumber: Number(l.blockNumber), logIndex: Number(l.logIndex), txHash: l.transactionHash as string })),
    );
  })();
  p.catch(() => multiplierMemo.delete(k));
  multiplierMemo.set(k, { at: Date.now(), p });
  return p;
}

async function build(wallet: string, job: Job): Promise<Statement | 'empty'> {
  const [index, held] = await Promise.all([getIndex(), getWallet(wallet)]);
  const bySymbol = new Map(index.data.tokens.map((t) => [t.symbol, t]));
  const tokens = (held.data?.tokens ?? []).map((t) => bySymbol.get(t.symbol)?.address.toLowerCase()).filter((a): a is string => !!a && /^0x[0-9a-f]{40}$/.test(a));
  if (!tokens.length) return 'empty';

  const svc = await getClubs();
  const chain = svc.ctx.chain;
  const prices = svc.ctx.prices;
  if (!chain || !prices) throw new Error('chain reader or price source is not configured');
  const client = baseClient();
  const head = await client.getBlockNumber();
  // Base makes a block every 2 seconds: start a little before the wallet was first seen.
  const first = held.data?.firstSeen ?? null;
  const back = first ? BigInt(Math.ceil((Date.now() / 1000 - first) / 2) + 20_000) : head;
  const fromBlock = head - back > BigInt(B20_START_BLOCK) ? head - back : BigInt(B20_START_BLOCK);

  const span = ranges(fromBlock, head);
  job.step = 'Reading this wallet’s transfers from Base';
  job.total = span.length * 2 * Math.ceil(tokens.length / 10);
  job.done = 0;
  const getTransferLogs: ChainReader['getTransferLogs'] = async (q) => {
    const side = q.from?.length ? { from: q.from as `0x${string}`[] } : { to: (q.to ?? []) as `0x${string}`[] };
    // public nodes accept at most 10 addresses and 50,000 blocks per eth_getLogs
    const groups: string[][] = [];
    for (let i = 0; i < q.tokens.length; i += 10) groups.push(q.tokens.slice(i, i + 10));
    const parts = await pool(
      groups.flatMap((g) => ranges(q.fromBlock, q.toBlock).map(([s, e]) => () => client.getLogs({ address: g as `0x${string}`[], event: transferEvent, args: side, fromBlock: s, toBlock: e }))),
      PARALLEL,
      () => job.done++,
    );
    return parts.flat().map(
      (l): TransferLog => ({ token: l.address.toLowerCase(), from: String(l.args.from).toLowerCase(), to: String(l.args.to).toLowerCase(), value: l.args.value as bigint, blockNumber: l.blockNumber, txHash: l.transactionHash.toLowerCase(), logIndex: l.logIndex }),
    );
  };
  const history = new RpcHistorySource({ ...chain, getTransferLogs }, { tokens, fromBlock, multiplierLogs: (t) => multiplierEvents(t, head) });

  const transfers = await history.stockTransfers(wallet);
  job.step = 'Reading splits and stock dividends';
  const seen = [...new Set(transfers.map((t) => t.token))];
  const multipliers = Object.fromEntries(await Promise.all(seen.map(async (t) => [t, await history.multiplierEvents(t)] as const)));
  job.step = 'Pricing each lot';
  const mine = await svc.ctx.store.query<BuyDoc>(COL.buys, { where: [['wallet', '==', wallet]] }).catch(() => [] as BuyDoc[]);
  const now = Math.floor(Date.now() / 1000);
  const live = new Map(index.data.tokens.map((t) => [t.address.toLowerCase(), t.priceUsd]));
  return buildStatement({
    wallet,
    transfers,
    multipliers,
    // today's value comes from the index; past marks from the engine's price sources
    markAt: async (token, t) => (now - t < 6 * 3600 ? live.get(token) ?? null : null) ?? (await prices.markAt(token, t))?.usd ?? live.get(token) ?? null,
    now,
    symbols: new Map(index.data.tokens.map((t) => [t.address.toLowerCase(), t.symbol])),
    tropaBuys: new Map(mine.filter((b) => b.usdIn != null).map((b) => [b.txHash, b.usdIn!])),
  });
}

/** Start (or find) the job that builds this wallet's statement. */
export function statementJob(address: string): Job {
  const w = address.toLowerCase();
  const hit = jobs.get(w);
  if (hit && hit.state !== 'failed' && Date.now() - hit.startedAt < TTL) return hit;
  const job: Job = { startedAt: Date.now(), step: 'Looking up what this wallet holds', done: 0, total: 0, state: 'running', result: Promise.resolve('empty') };
  job.result = build(w, job).then(
    (v) => {
      job.state = v === 'empty' ? 'empty' : 'ready';
      if (v !== 'empty') job.value = v;
      return v;
    },
    (e) => {
      job.state = 'failed';
      console.warn('[statement]', (e as Error).message?.slice(0, 200));
      throw e;
    },
  );
  job.result.catch(() => {});
  if (jobs.size > 200) jobs.clear();
  jobs.set(w, job);
  return job;
}

/** Wait up to `ms` for the job, then report where it stands. */
export async function statementStatus(address: string, ms: number): Promise<Job> {
  const job = statementJob(address);
  if (job.state === 'running') await Promise.race([job.result.catch(() => null), new Promise((r) => setTimeout(r, ms))]);
  return job;
}
