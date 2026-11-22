// A wallet's cost-basis statement, built without a paid history API.
//
// First choice: the indexer's published history (history/<xx>.json and corporate-actions.json).
// It is one small file, so the statement opens at once. Its prices are day averages, so DEX buys
// are costed "at the day's price" and marked estimated (see lib/statement-history.ts).
//   - a pool or contract address (what the index says it is in wallets/<xx>.json) is not a
//     person's wallet: its statement is what it holds now, from that same file, with no RPC at all.
//   - a wallet the indexer marks tooActive (over 1,000 transfers) has no entries: its statement is
//     not itemised, and the page shows what it holds now instead. Never zeros.
//   - a wallet that is not in the published history (under $1, or newer than the last run), or
//     whose history does not add up to what the index says it holds, is read from the chain:
//
//   1. The indexer's wallet file says which tokens this wallet holds, so only those are read.
//   2. Transfers are read with eth_getLogs in chunks of 50,000 blocks and at most 10 addresses.
//   3. Keyless public nodes do not serve the very oldest blocks ("archive requests"). The oldest
//      block they do serve is found first, and reading starts there. Whatever the wallet already
//      held at that point is listed as one opening lot with basis unknown, worked out from its
//      balance today minus every later movement. Nothing is guessed, and a wallet that holds
//      tokens can never come out as zeros. With BASE_RPC_URL set to a node that serves all
//      history, reading starts at the first stock-token block and there is no opening lot.
//   4. Each token's multiplier history (splits, stock dividends) is read once and kept six hours.
//
// Chain reads are rationed so one slow statement can never hold up anyone else:
//   - at most 2 statements read the chain at once; a third gets status "busy" and its holdings,
//   - a statement may make about 120 reads; one that needs more gets "busy" and its holdings,
//   - every statement read goes through its own RPC client and a limiter of 3 requests in flight,
//     never through the clubs engine's client, so buy checks are never queued behind statements,
//   - a job that is dropped (jobs evicted, or replaced after its TTL) is aborted, and its requests
//     with it.
// A statement is kept for ten minutes per wallet. Building runs as a job: the page polls for it.
import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createPublicClient, custom, erc20Abi, parseAbiItem, type PublicClient } from 'viem';
import { base } from 'viem/chains';
import { DEFAULT_RPC_URLS } from '@tropaclub/buy';
import {
  ANNOUNCEMENT_TOPIC,
  COL,
  ChainlinkHistorySource,
  CompositePriceSource,
  IndexerPriceSource,
  RpcHistorySource,
  StoreMarkSource,
  UI_MULTIPLIER_CANCELLED_TOPIC,
  UI_MULTIPLIER_UPDATED_TOPIC,
  buildStatement,
  createViemChainReader,
  decodeMultiplierLogs,
  type BuyDoc,
  type ChainReader,
  type MultiplierEvent,
  type PriceSource,
  type Statement,
  type TransferLog,
} from '@tropaclub/clubs';
import type { CorporateActionsFile, WalletHistory, WalletHistoryShard } from '@shared/types';
import { assertMatchesHoldings, historyFromBlock, openingBalances } from '@/lib/statement-check';
import { labelDayPrices, multipliersFromFile, netRaw, splitSymbols, transfersFromHistory, walletFromShards } from '@/lib/statement-history';
import { getClubs } from './clubs';
import { dataBaseUrl, getIndex, getWallet } from './data';

const CHUNK = 50_000n;
/** Marks the opening lot: tokens held before the readable history begins. Not a real sender. */
const OPENING_FROM = '0x000000000000000000000000000000000000dead';
/** Statements reading the chain at the same time, across the whole instance. */
export const MAX_CHAIN_JOBS = 2;
/** RPC reads one statement may make. */
export const MAX_READS_PER_JOB = 120;
// Public nodes refuse bursts (HTTP 403 at six requests in parallel), so at most three statement
// requests are in flight at once across the whole server, and a refused one is retried after a pause.
const PARALLEL = 3;
let inFlight = 0;
const waiting: (() => void)[] = [];
async function limited<T>(run: () => Promise<T>, final?: (e: unknown) => boolean): Promise<T> {
  if (inFlight >= PARALLEL) await new Promise<void>((r) => waiting.push(r));
  inFlight++;
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        return await run();
      } catch (e) {
        if (attempt >= 3 || final?.(e)) throw e;
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      }
    }
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}
const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

export type HoldingsReason = 'too_active' | 'pool' | 'contract' | 'busy';

export interface Job {
  startedAt: number;
  step: string;
  done: number;
  total: number;
  result: Promise<Statement | 'empty' | 'holdings' | 'busy'>;
  state: 'running' | 'ready' | 'empty' | 'holdings' | 'busy' | 'failed';
  value?: Statement;
  /** Where the history came from: the indexer's published files, or read from the chain. */
  source?: 'index' | 'chain';
  /** For a wallet whose lots are not worked out here: what it holds at the last count. */
  holdings?: { symbol: string; usd: number }[];
  /** Why holdings are shown instead of lots. */
  holdingsReason?: HoldingsReason;
  /** The count the prices come from (the index's as-of time). */
  countedAt?: string;
  /** RPC reads made so far. */
  reads: number;
  abort: AbortController;
}
const jobs = new Map<string, Job>();
const TTL = 10 * 60_000;
/** A "busy" answer is given again for this long, then the statement is tried afresh. */
const BUSY_TTL = 20_000;

// ---------------------------------------------------------------------------------------------
// The statement RPC client. Every request it makes is counted against the job it runs for (found
// through AsyncLocalStorage, so nothing has to be passed down), stops when that job is aborted,
// and waits its turn in the limiter above.
interface JobCtl {
  job: Job;
  signal: AbortSignal;
  overBudget: boolean;
}
const current = new AsyncLocalStorage<JobCtl>();
class StatementBusy extends Error {
  constructor() {
    super('statement read budget used up');
    this.name = 'StatementBusy';
  }
}
let rpcId = 0;
const rpcUrl = () => process.env.BASE_RPC_URL || DEFAULT_RPC_URLS[0];
const stopped = (e: unknown) => {
  const ctl = current.getStore();
  return !!ctl && (ctl.signal.aborted || ctl.overBudget || (e as Error)?.name === 'AbortError');
};
const tooOld = (e: unknown) => /archive|pruned|missing trie|history.*(not|un)available|older than/i.test(String((e as { details?: string; message?: string })?.details ?? '') + String((e as Error)?.message ?? ''));

async function statementRpc(method: string, params: unknown): Promise<unknown> {
  const ctl = current.getStore();
  if (ctl) {
    if (ctl.signal.aborted) throw new DOMException('statement aborted', 'AbortError');
    if (ctl.job.reads >= MAX_READS_PER_JOB) {
      ctl.overBudget = true;
      throw new StatementBusy();
    }
    ctl.job.reads++;
  }
  return limited(
    async () => {
      const signal = ctl ? AbortSignal.any([ctl.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000);
      const res = await fetch(rpcUrl(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }), signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} from the statement RPC`);
      const j = (await res.json()) as { result?: unknown; error?: { code: number; message: string; data?: unknown } };
      // viem maps { code, message } onto its own RPC errors, with the message kept as `details`
      if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data });
      return j.result;
    },
    (e) => tooOld(e) || stopped(e),
  );
}

let stmtClient: PublicClient | null = null;
function statementClient(): PublicClient {
  return (stmtClient ??= createPublicClient({ chain: base, transport: custom({ request: ({ method, params }) => statementRpc(method, params) }, { retryCount: 0 }) }) as PublicClient);
}
let stmtChain: ChainReader | null = null;
/** A chain reader of the statement's own: never the clubs engine's, which checks buys. */
const statementChain = () => (stmtChain ??= createViemChainReader({ client: statementClient() }));
let stmtPrices: PriceSource | null = null;
async function statementPrices(): Promise<PriceSource> {
  if (stmtPrices) return stmtPrices;
  const svc = await getClubs();
  stmtPrices = new CompositePriceSource([new ChainlinkHistorySource(statementClient()), new StoreMarkSource(svc.ctx.store), new IndexerPriceSource()]);
  return stmtPrices;
}

/** Run tasks a few at a time, in order. (Each request still waits for the limiter.) */
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
function multiplierEvents(token: string, from: bigint, head: bigint): Promise<MultiplierEvent[]> {
  const k = token.toLowerCase();
  const hit = multiplierMemo.get(k);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.p;
  const client = statementClient();
  const p = (async () => {
    const kept = await cacheGet<MultiplierEvent[]>(`mult_${k}`, 6 * 3600_000);
    if (kept) return kept;
    const parts = await pool(
      ranges(from, head).map(([fromBlock, toBlock]) => () =>
        client.request({
          method: 'eth_getLogs',
          params: [{ address: k as `0x${string}`, topics: [[UI_MULTIPLIER_UPDATED_TOPIC, UI_MULTIPLIER_CANCELLED_TOPIC, ANNOUNCEMENT_TOPIC]], fromBlock: `0x${fromBlock.toString(16)}`, toBlock: `0x${toBlock.toString(16)}` }],
        }),
      ),
      PARALLEL,
    );
    const events = decodeMultiplierLogs(
      parts.flat().map((l) => ({ address: l.address, topics: l.topics as string[], data: l.data, blockNumber: Number(l.blockNumber), logIndex: Number(l.logIndex), txHash: l.transactionHash as string })),
    );
    void cachePut(`mult_${k}`, events);
    return events;
  })();
  p.catch(() => multiplierMemo.delete(k));
  multiplierMemo.set(k, { at: Date.now(), p });
  return p;
}

// Finished work is also kept in the clubs store (Firestore in production), so another instance or
// a later visit does not read the chain again. bigint values are written as {"$n": "123"}.
const CACHE = 'statementCache';
const pack = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? { $n: x.toString() } : x));
const unpack = <T,>(s: string) => JSON.parse(s, (_k, x) => (x && typeof x === 'object' && typeof x.$n === 'string' && Object.keys(x).length === 1 ? BigInt(x.$n) : x)) as T;
async function cacheGet<T>(id: string, maxAgeMs: number): Promise<T | null> {
  try {
    const d = await (await getClubs()).ctx.store.get<{ at: number; json: string }>(CACHE, id);
    return d && Date.now() - d.at < maxAgeMs ? unpack<T>(d.json) : null;
  } catch {
    return null;
  }
}
async function cachePut(id: string, value: unknown): Promise<void> {
  try {
    const json = pack(value);
    if (json.length < 600_000) await (await getClubs()).ctx.store.set(CACHE, id, { at: Date.now(), json });
  } catch {
    /* the cache is a convenience */
  }
}

/** First block at or after a time, by binary search on block timestamps (never by assuming a block time). */
async function blockAtTime(t: number, lo: bigint, hi: bigint): Promise<bigint> {
  const client = statementClient();
  const time = async (n: bigint) => Number((await client.getBlock({ blockNumber: n })).timestamp);
  if ((await time(lo)) >= t) return lo;
  while (hi - lo > 2_000n) {
    const mid = (lo + hi) / 2n;
    if ((await time(mid)) >= t) hi = mid;
    else lo = mid;
  }
  return lo;
}

/** The oldest block this node will serve logs for, at or after `start`. Kept for ten minutes. */
let readable: { at: number; block: bigint } | null = null;
async function readableFrom(start: bigint, head: bigint, token: string): Promise<bigint> {
  if (readable && Date.now() - readable.at < 10 * 60_000) return readable.block;
  const client = statementClient();
  const chunks = ranges(start, head);
  const ok = async (i: number) => {
    try {
      await client.getLogs({ address: token as `0x${string}`, event: transferEvent, args: { to: ['0x000000000000000000000000000000000000dEaD'] }, fromBlock: chunks[i][0], toBlock: chunks[i][1] });
      return true;
    } catch (e) {
      if (tooOld(e)) return false;
      throw e;
    }
  };
  let lo = 0;
  if (!(await ok(0))) {
    // binary search for the first chunk the node serves
    let hi = chunks.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (await ok(mid)) hi = mid;
      else lo = mid;
    }
    lo = hi;
  }
  readable = { at: Date.now(), block: chunks[lo][0] };
  return readable.block;
}

// The indexer's files are gzip with max-age=300. Kept here for five minutes (a miss for one), so a
// burst of statements for one shard costs one download.
const files = new Map<string, { at: number; ttl: number; p: Promise<unknown | null> }>();
function publicJson(path: string): Promise<unknown | null> {
  const hit = files.get(path);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.p;
  const entry = { at: Date.now(), ttl: 5 * 60_000, p: Promise.resolve<unknown | null>(null) };
  entry.p = (async () => {
    try {
      const res = await fetch(`${dataBaseUrl}/${path}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (res.ok) return await res.json();
    } catch {
      /* fall through */
    }
    entry.ttl = 60_000;
    return null;
  })();
  if (files.size > 300) files.clear();
  files.set(path, entry);
  return entry.p;
}

/** This wallet's published history, or null if it is not published (or the files cannot be read). */
async function publishedHistory(wallet: string): Promise<WalletHistory | null> {
  const xx = wallet.slice(2, 4);
  const shard = await publicJson(`history/${xx}.json`);
  if (!shard || typeof shard !== 'object') return null;
  const symbols = splitSymbols(shard);
  if (!symbols) return walletFromShards([shard as WalletHistoryShard], wallet);
  // split by token: every part is needed, a missing one would leave a hole in the history
  const parts = await Promise.all(symbols.map((sym) => publicJson(`history/${xx}/${encodeURIComponent(sym)}.json`)));
  if (parts.some((p) => !p || typeof p !== 'object')) throw new Error(`history shard ${xx} is split and a part could not be read`);
  return walletFromShards(parts as WalletHistoryShard[], wallet);
}

const pastMarks = new Map<string, Promise<number | null>>();
type Held = { token: string; symbol: string; usd: number }[];

/**
 * The statement from the indexer's published history. Returns null when this wallet is not
 * published, 'holdings' when it is too active to itemise, and throws when the files are there but
 * do not add up: the caller then reads the chain instead.
 */
async function fromIndex(wallet: string, index: Awaited<ReturnType<typeof getIndex>>, held: Held): Promise<Statement | 'holdings' | null> {
  if (index.source !== 'live') return null;
  const history = await publishedHistory(wallet);
  if (!history) return null;
  if (history.tooActive) return 'holdings';
  const { transfers, marks, symbols, priceSources } = transfersFromHistory(history);
  if (!transfers.length) return null;
  for (const [token, net] of netRaw(transfers)) if (net < 0n) throw new Error(`published history of ${symbols.get(token) ?? token} goes below zero`);
  const actions = (await publicJson('corporate-actions.json')) as CorporateActionsFile | null;
  if (!actions || !Array.isArray(actions.tokens)) throw new Error('corporate-actions.json could not be read');
  const all = multipliersFromFile(actions);
  const seen = [...new Set(transfers.map((t) => t.token))];
  // a token the corporate-actions file does not list has an unknown multiplier history: do not guess
  const missing = seen.filter((t) => !(t in all));
  if (missing.length) throw new Error(`corporate-actions.json does not list ${missing.map((t) => symbols.get(t) ?? t).join(', ')}`);
  const svc = await getClubs();
  const prices = await statementPrices();
  // A past mark that is not in the wallet's own history is the value of a stock dividend on its
  // day. That is the same for every wallet, so it is looked up once and kept.
  const pastMark = (token: string, t: number): Promise<number | null> => {
    const k = `${token}|${t}`;
    let p = pastMarks.get(k);
    if (!p) {
      p = prices.markAt(token, t).then((m) => m?.usd ?? null, () => null);
      if (pastMarks.size > 2000) pastMarks.clear();
      pastMarks.set(k, p);
      void p.then((v) => v == null && pastMarks.delete(k));
    }
    return p;
  };
  const mine = await svc.ctx.store.query<BuyDoc>(COL.buys, { where: [['wallet', '==', wallet]] }).catch(() => [] as BuyDoc[]);
  const now = Math.floor(Date.now() / 1000);
  const live = new Map(index.data.tokens.map((t) => [t.address.toLowerCase(), t.priceUsd]));
  const statement = await buildStatement({
    wallet,
    transfers,
    multipliers: Object.fromEntries(seen.map((t) => [t, all[t]])),
    // a movement is priced at its own day mark; today's value comes from the index
    markAt: async (token, t) =>
      marks.get(`${token}|${t}`) ?? (now - t < 6 * 3600 ? live.get(token) ?? null : null) ?? (await pastMark(token, t)) ?? live.get(token) ?? null,
    now,
    symbols: new Map([...index.data.tokens.map((t) => [t.address.toLowerCase(), t.symbol] as const), ...symbols]),
    tropaBuys: new Map(mine.filter((b) => b.verified === true && b.usdIn != null).map((b) => [b.txHash.toLowerCase(), b.usdIn!])),
  });
  assertMatchesHoldings(held, statement.lots);
  return labelDayPrices(statement, priceSources);
}

let chainJobs = 0;

async function build(wallet: string, job: Job): Promise<Statement | 'empty' | 'holdings' | 'busy'> {
  const [index, held] = await Promise.all([getIndex(), getWallet(wallet)]);
  const holdings = (reason: HoldingsReason): 'holdings' | 'busy' => {
    job.countedAt = index.data.asOf;
    job.source = 'index';
    job.holdingsReason = reason;
    job.holdings = (held.data?.tokens ?? []).filter((t) => t.usd >= 0.01).map((t) => ({ symbol: t.symbol, usd: t.usd })).sort((a, b) => b.usd - a.usd);
    return reason === 'busy' ? 'busy' : 'holdings';
  };
  // A pool or a contract is not a person's wallet: what it holds now, from the index, and no RPC.
  const kinds = new Set((held.data?.tokens ?? []).map((t) => t.kind));
  if (kinds.has('pool')) return holdings('pool');
  if (kinds.has('contract')) return holdings('contract');

  const kept = await cacheGet<{ statement: Statement; countedAt: string; source?: 'index' | 'chain' }>(`w2_${wallet}`, 60 * 60_000);
  if (kept && kept.countedAt === index.data.asOf) {
    job.countedAt = kept.countedAt;
    job.source = kept.source;
    return kept.statement;
  }
  const bySymbol = new Map(index.data.tokens.map((t) => [t.symbol, t]));
  const tokens = (held.data?.tokens ?? []).map((t) => bySymbol.get(t.symbol)?.address.toLowerCase()).filter((a): a is string => !!a && /^0x[0-9a-f]{40}$/.test(a));
  if (!tokens.length) return 'empty';
  const heldNow: Held = (held.data?.tokens ?? []).map((t) => ({ token: bySymbol.get(t.symbol)?.address ?? '', symbol: t.symbol, usd: t.usd })).filter((t) => t.token);

  job.step = 'Reading this wallet’s history';
  const started = Date.now();
  const published = await fromIndex(wallet, index, heldNow).catch((e) => {
    if (job.abort.signal.aborted) throw e;
    console.warn('[statement] published history not used, reading the chain:', (e as Error).message?.slice(0, 200));
    return null;
  });
  if (published === 'holdings') {
    console.info(`[statement] ${wallet.slice(0, 10)} too active to itemise: holdings shown`);
    return holdings('too_active');
  }
  if (published) {
    job.countedAt = index.data.asOf;
    job.source = 'index';
    console.info(`[statement] ${wallet.slice(0, 10)} from the published history in ${Date.now() - started} ms`);
    void cachePut(`w2_${wallet}`, { statement: published, countedAt: index.data.asOf, source: 'index' });
    return published;
  }

  // The chain. At most MAX_CHAIN_JOBS at once: anyone after that sees what the wallet holds now.
  if (chainJobs >= MAX_CHAIN_JOBS) {
    console.info(`[statement] ${wallet.slice(0, 10)} busy: ${chainJobs} statements are reading the chain`);
    return holdings('busy');
  }
  chainJobs++;
  try {
    return await fromChain(wallet, job, index, held, tokens, heldNow);
  } catch (e) {
    if (job.abort.signal.aborted) throw e;
    if (e instanceof StatementBusy || (e as Error)?.name === 'StatementBusy' || current.getStore()?.overBudget) {
      console.info(`[statement] ${wallet.slice(0, 10)} busy: over ${MAX_READS_PER_JOB} reads`);
      return holdings('busy');
    }
    throw e;
  } finally {
    chainJobs--;
  }
}

async function fromChain(
  wallet: string,
  job: Job,
  index: Awaited<ReturnType<typeof getIndex>>,
  held: Awaited<ReturnType<typeof getWallet>>,
  tokens: string[],
  heldNow: Held,
): Promise<Statement> {
  console.info(`[statement] ${wallet.slice(0, 10)} is not in the published history: reading the chain`);
  job.source = 'chain';
  const svc = await getClubs();
  const chain = statementChain();
  const prices = await statementPrices();
  const client = statementClient();
  const head = await client.getBlockNumber();
  job.step = 'Finding how far back the public node reads';
  const firstBlock = historyFromBlock();
  const readableStart = await readableFrom(firstBlock, head, tokens[0]);
  const partial = readableStart > firstBlock;
  // The index knows when this wallet first held any stock token. Nothing can be older than that,
  // so reading starts a day before it. The block is found by its timestamp, not by guessing a pace.
  const first = held.data?.firstSeen ?? null;
  const fromBlock = first ? await blockAtTime(first - 86_400, readableStart, head).catch((e) => (stopped(e) ? Promise.reject(e) : readableStart)) : readableStart;

  const span = ranges(fromBlock, head);
  job.step = 'Reading this wallet’s transfers from Base';
  job.total = span.length * 2 * Math.ceil(tokens.length / 10);
  job.done = 0;
  // the log reads alone, plus one balance per token: if that is over the budget, do not start
  if (job.reads + job.total + tokens.length > MAX_READS_PER_JOB) throw new StatementBusy();
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
  // a token whose multiplier is exactly 1 has never had a split or stock dividend: nothing to read
  const flat = new Set(index.data.tokens.filter((t) => t.multiplier === 1).map((t) => t.address.toLowerCase()));
  const history = new RpcHistorySource({ ...chain, getTransferLogs }, { tokens, fromBlock, multiplierLogs: (t) => (flat.has(t.toLowerCase()) ? Promise.resolve([]) : multiplierEvents(t, readableStart, head)) });

  const read = await history.stockTransfers(wallet);
  // What the wallet already held where reading starts: today's balance minus every movement since.
  const balances = new Map<string, bigint>(await Promise.all(tokens.map(async (t) => [t, await client.readContract({ address: t as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [wallet as `0x${string}`] })] as const)));
  const opening = openingBalances(balances, read);
  const startTime = partial || fromBlock > readableStart ? await client.getBlock({ blockNumber: fromBlock }).then((b) => Number(b.timestamp)).catch(() => (read[0]?.t ?? Math.floor(Date.now() / 1000)) - 1) : 0;
  const transfers = [
    ...[...opening].map(([token, raw], i) => ({ token, dir: 'in' as const, raw, t: Math.min(startTime, (read[0]?.t ?? startTime) - 1), blockNumber: Number(fromBlock), txHash: `0x${'0'.repeat(63)}${i}`, logIndex: i, counterparty: OPENING_FROM, legs: { paidUsd: null, receivedUsd: null, otherOut: false, otherIn: false } })),
    ...read,
  ];
  job.step = 'Reading splits and stock dividends';
  const seen = [...new Set(transfers.map((t) => t.token))];
  const multipliers = Object.fromEntries(await Promise.all(seen.map(async (t) => [t, await history.multiplierEvents(t)] as const)));
  job.step = 'Pricing each lot';
  const mine = await svc.ctx.store.query<BuyDoc>(COL.buys, { where: [['wallet', '==', wallet]] }).catch(() => [] as BuyDoc[]);
  const now = Math.floor(Date.now() / 1000);
  const live = new Map(index.data.tokens.map((t) => [t.address.toLowerCase(), t.priceUsd]));
  const statement = await buildStatement({
    wallet,
    transfers,
    multipliers,
    // today's value comes from the index; past marks from the statement's own price sources
    markAt: async (token, t) => (now - t < 6 * 3600 ? live.get(token) ?? null : null) ?? (await prices.markAt(token, t))?.usd ?? live.get(token) ?? null,
    now,
    symbols: new Map(index.data.tokens.map((t) => [t.address.toLowerCase(), t.symbol])),
    tropaBuys: new Map(mine.filter((b) => b.verified === true && b.usdIn != null).map((b) => [b.txHash, b.usdIn!])),
  });
  // The index says this wallet holds these tokens. A statement without them is a failed read, not an empty one.
  assertMatchesHoldings(heldNow, statement.lots);
  if (opening.size) {
    const since = new Date(startTime * 1000).toISOString().slice(0, 10);
    statement.warnings.unshift(
      `Tokens this wallet already held on ${since} are listed as one opening lot with basis unknown. Free public Base nodes do not serve blocks older than that, so what those tokens cost cannot be read. Everything since then is exact.`,
    );
  }
  job.countedAt = index.data.asOf;
  void cachePut(`w2_${wallet}`, { statement, countedAt: index.data.asOf, source: 'chain' });
  return statement;
}

/** Abort a job that is still running (its requests stop with it). */
function abortJob(job: Job, why: string): void {
  if (job.state === 'running' && !job.abort.signal.aborted) job.abort.abort(new Error(why));
}

/** Drop finished and expired jobs; if there are still too many, abort and drop the rest. */
function pruneJobs(max = 200): void {
  if (jobs.size <= max) return;
  const now = Date.now();
  for (const [w, j] of jobs) {
    if (j.state !== 'running' || now - j.startedAt > TTL) {
      abortJob(j, 'statement job expired');
      jobs.delete(w);
    }
  }
  if (jobs.size <= max) return;
  for (const j of jobs.values()) abortJob(j, 'statement jobs evicted');
  jobs.clear();
}

/** Abort every running statement and forget them all. */
export function clearStatementJobs(): void {
  for (const j of jobs.values()) abortJob(j, 'statement jobs cleared');
  jobs.clear();
}

/** Start (or find) the job that builds this wallet's statement. */
export function statementJob(address: string): Job {
  const w = address.toLowerCase();
  const hit = jobs.get(w);
  if (hit) {
    const age = Date.now() - hit.startedAt;
    const reusable = hit.state === 'busy' ? age < BUSY_TTL : hit.state !== 'failed' && age < TTL;
    if (reusable) return hit;
    abortJob(hit, 'statement job replaced');
  }
  const abort = new AbortController();
  const job: Job = { startedAt: Date.now(), step: 'Looking up what this wallet holds', done: 0, total: 0, state: 'running', result: Promise.resolve('empty'), reads: 0, abort };
  const ctl: JobCtl = { job, signal: abort.signal, overBudget: false };
  job.result = current.run(ctl, () => build(w, job)).then(
    (v) => {
      job.state = v === 'empty' || v === 'holdings' || v === 'busy' ? v : 'ready';
      if (v !== 'empty' && v !== 'holdings' && v !== 'busy') job.value = v;
      return v;
    },
    (e) => {
      job.state = 'failed';
      console.warn('[statement]', abort.signal.aborted ? 'aborted' : (e as Error).message?.slice(0, 200));
      throw e;
    },
  );
  job.result.catch(() => {});
  jobs.set(w, job);
  pruneJobs();
  return job;
}

/** Wait up to `ms` for the job, then report where it stands. */
export async function statementStatus(address: string, ms: number): Promise<Job> {
  const job = statementJob(address);
  if (job.state === 'running') await Promise.race([job.result.catch(() => null), new Promise((r) => setTimeout(r, ms))]);
  return job;
}

/** For tests and diagnostics: how many statements are reading the chain now. */
export const statementLoad = () => ({ chainJobs, jobs: jobs.size, inFlight });
