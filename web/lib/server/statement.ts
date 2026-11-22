// A wallet's cost-basis statement, built without a paid history API.
//
// First choice: the indexer's published history (history/<xx>.json and corporate-actions.json).
// It is one small file, so the statement opens at once. Its prices are day averages, so DEX buys
// are costed "at the day's price" and marked estimated (see lib/statement-history.ts).
//   - a wallet the indexer marks tooActive (over 1,000 transfers) has no entries: its statement is
//     not itemised, and the page shows what it holds now instead. Never zeros.
//   - a wallet that is not in the published history (under $1, or newer than the last run), or
//     whose history does not add up to what the index says it holds, is read from the chain:
//
//   1. The indexer's wallet file says which tokens this wallet holds, so only those are read.
//   2. Transfers are read with eth_getLogs in chunks of 50,000 blocks and at most 10 addresses,
//      three requests at a time (public nodes refuse bursts).
//   3. Keyless public nodes do not serve the very oldest blocks ("archive requests"). The oldest
//      block they do serve is found first, and reading starts there. Whatever the wallet already
//      held at that point is listed as one opening lot with basis unknown, worked out from its
//      balance today minus every later movement. Nothing is guessed, and a wallet that holds
//      tokens can never come out as zeros. With BASE_RPC_URL set to a node that serves all
//      history, reading starts at the first stock-token block and there is no opening lot.
//   4. Each token's multiplier history (splits, stock dividends) is read once and kept six hours.
// A statement is kept for ten minutes per wallet. Building runs as a job: the page polls for it.
import 'server-only';
import { createPublicClient, erc20Abi, http, parseAbiItem, type PublicClient } from 'viem';
import { base } from 'viem/chains';
import { DEFAULT_RPC_URLS } from '@tropaclub/buy';
import {
  ANNOUNCEMENT_TOPIC,
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
import type { CorporateActionsFile, WalletHistory, WalletHistoryShard } from '@shared/types';
import { assertMatchesHoldings, historyFromBlock, openingBalances } from '@/lib/statement-check';
import { labelDayPrices, multipliersFromFile, netRaw, splitSymbols, transfersFromHistory, walletFromShards } from '@/lib/statement-history';
import { baseClient } from './chain';
import { getClubs } from './clubs';
import { dataBaseUrl, getIndex, getWallet } from './data';

const CHUNK = 50_000n;
/** Marks the opening lot: tokens held before the readable history begins. Not a real sender. */
const OPENING_FROM = '0x000000000000000000000000000000000000dead';
// Public nodes refuse bursts (HTTP 403 at six requests in parallel), so at most three log requests
// are in flight at once across the whole server, and a refused one is retried after a pause.
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

export interface Job {
  startedAt: number;
  step: string;
  done: number;
  total: number;
  result: Promise<Statement | 'empty' | 'holdings'>;
  state: 'running' | 'ready' | 'empty' | 'holdings' | 'failed';
  value?: Statement;
  /** Where the history came from: the indexer's published files, or read from the chain. */
  source?: 'index' | 'chain';
  /** For a wallet with too many transfers to itemise: what it holds at the last count. */
  holdings?: { symbol: string; usd: number }[];
  /** The count the prices come from (the index's as-of time). */
  countedAt?: string;
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
        out[i] = await limited(tasks[i]);
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
  const client = logClient();
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
  const client = logClient();
  const time = async (n: bigint) => Number((await limited(() => client.getBlock({ blockNumber: n }))).timestamp);
  if ((await time(lo)) >= t) return lo;
  while (hi - lo > 2_000n) {
    const mid = (lo + hi) / 2n;
    if ((await time(mid)) >= t) hi = mid;
    else lo = mid;
  }
  return lo;
}

// Logs are read from one node only (BASE_RPC_URL if set, else the first public one), with no
// fallback: when a node says a range is too old, that answer is used, not retried elsewhere.
let logC: PublicClient | null = null;
function logClient(): PublicClient {
  return (logC ??= createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL || DEFAULT_RPC_URLS[0], { retryCount: 0, timeout: 20_000 }) }) as PublicClient);
}

const tooOld = (e: unknown) => /archive|pruned|missing trie|history.*(not|un)available|older than/i.test(String((e as { details?: string; message?: string })?.details ?? '') + String((e as Error)?.message ?? ''));

/** The oldest block this node will serve logs for, at or after `start`. Kept for ten minutes. */
let readable: { at: number; block: bigint } | null = null;
async function readableFrom(start: bigint, head: bigint, token: string): Promise<bigint> {
  if (readable && Date.now() - readable.at < 10 * 60_000) return readable.block;
  const client = logClient();
  const chunks = ranges(start, head);
  const ok = async (i: number) => {
    try {
      await limited(() => client.getLogs({ address: token as `0x${string}`, event: transferEvent, args: { to: ['0x000000000000000000000000000000000000dEaD'] }, fromBlock: chunks[i][0], toBlock: chunks[i][1] }), tooOld);
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
  const { transfers, marks, symbols } = transfersFromHistory(history);
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
  const prices = svc.ctx.prices;
  // A past mark that is not in the wallet's own history is the value of a stock dividend on its
  // day. That is the same for every wallet, so it is looked up once and kept.
  const pastMark = (token: string, t: number): Promise<number | null> => {
    const k = `${token}|${t}`;
    let p = pastMarks.get(k);
    if (!p) {
      p = prices ? prices.markAt(token, t).then((m) => m?.usd ?? null, () => null) : Promise.resolve(null);
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
    tropaBuys: new Map(mine.filter((b) => b.usdIn != null).map((b) => [b.txHash.toLowerCase(), b.usdIn!])),
  });
  assertMatchesHoldings(held, statement.lots);
  return labelDayPrices(statement);
}

async function build(wallet: string, job: Job): Promise<Statement | 'empty' | 'holdings'> {
  const [index, held] = await Promise.all([getIndex(), getWallet(wallet)]);
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
    console.warn('[statement] published history not used, reading the chain:', (e as Error).message?.slice(0, 200));
    return null;
  });
  if (published === 'holdings') {
    job.countedAt = index.data.asOf;
    job.source = 'index';
    job.holdings = (held.data?.tokens ?? []).filter((t) => t.usd >= 0.01).map((t) => ({ symbol: t.symbol, usd: t.usd })).sort((a, b) => b.usd - a.usd);
    console.info(`[statement] ${wallet.slice(0, 10)} too active to itemise: holdings shown`);
    return 'holdings';
  }
  if (published) {
    job.countedAt = index.data.asOf;
    job.source = 'index';
    console.info(`[statement] ${wallet.slice(0, 10)} from the published history in ${Date.now() - started} ms`);
    void cachePut(`w2_${wallet}`, { statement: published, countedAt: index.data.asOf, source: 'index' });
    return published;
  }
  console.info(`[statement] ${wallet.slice(0, 10)} is not in the published history: reading the chain`);
  job.source = 'chain';

  const svc = await getClubs();
  const chain = svc.ctx.chain;
  const prices = svc.ctx.prices;
  if (!chain || !prices) throw new Error('chain reader or price source is not configured');
  const client = logClient();
  const head = await client.getBlockNumber();
  job.step = 'Finding how far back the public node reads';
  const firstBlock = historyFromBlock();
  const readableStart = await readableFrom(firstBlock, head, tokens[0]);
  const partial = readableStart > firstBlock;
  // The index knows when this wallet first held any stock token. Nothing can be older than that,
  // so reading starts a day before it. The block is found by its timestamp, not by guessing a pace.
  const first = held.data?.firstSeen ?? null;
  const fromBlock = first ? await blockAtTime(first - 86_400, readableStart, head).catch(() => readableStart) : readableStart;

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
  // a token whose multiplier is exactly 1 has never had a split or stock dividend: nothing to read
  const flat = new Set(index.data.tokens.filter((t) => t.multiplier === 1).map((t) => t.address.toLowerCase()));
  const history = new RpcHistorySource({ ...chain, getTransferLogs }, { tokens, fromBlock, multiplierLogs: (t) => (flat.has(t.toLowerCase()) ? Promise.resolve([]) : multiplierEvents(t, readableStart, head)) });

  const read = await history.stockTransfers(wallet);
  // What the wallet already held where reading starts: today's balance minus every movement since.
  const balances = new Map<string, bigint>(await Promise.all(tokens.map(async (t) => [t, await baseClient().readContract({ address: t as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [wallet as `0x${string}`] })] as const)));
  const opening = openingBalances(balances, read);
  const startTime = partial || fromBlock > readableStart ? await baseClient().getBlock({ blockNumber: fromBlock }).then((b) => Number(b.timestamp)).catch(() => (read[0]?.t ?? Math.floor(Date.now() / 1000)) - 1) : 0;
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
    // today's value comes from the index; past marks from the engine's price sources
    markAt: async (token, t) => (now - t < 6 * 3600 ? live.get(token) ?? null : null) ?? (await prices.markAt(token, t))?.usd ?? live.get(token) ?? null,
    now,
    symbols: new Map(index.data.tokens.map((t) => [t.address.toLowerCase(), t.symbol])),
    tropaBuys: new Map(mine.filter((b) => b.usdIn != null).map((b) => [b.txHash, b.usdIn!])),
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

/** Start (or find) the job that builds this wallet's statement. */
export function statementJob(address: string): Job {
  const w = address.toLowerCase();
  const hit = jobs.get(w);
  if (hit && hit.state !== 'failed' && Date.now() - hit.startedAt < TTL) return hit;
  const job: Job = { startedAt: Date.now(), step: 'Looking up what this wallet holds', done: 0, total: 0, state: 'running', result: Promise.resolve('empty') };
  job.result = build(w, job).then(
    (v) => {
      job.state = v === 'empty' || v === 'holdings' ? v : 'ready';
      if (v !== 'empty' && v !== 'holdings') job.value = v;
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
