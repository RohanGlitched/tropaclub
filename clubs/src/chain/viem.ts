/**
 * viem ChainReader for Base mainnet. Attribution goes through @tropaclub/buy's verifyAttribution.
 * RPC: BASE_RPC_URL (keyed Alchemy/QuickNode free tier) first, then the public fallbacks from the buy package.
 */
import { DEFAULT_RPC_URLS, ETH_USD_FEED, SLIPSTREAM_FACTORIES, aggregatorV3Abi, b20Abi, verifyAttribution } from '@tropaclub/buy';
import { BaseError, ContractFunctionRevertedError, ContractFunctionZeroDataError, type PublicClient, createPublicClient, fallback, getAddress, http, parseAbi, parseAbiItem } from 'viem';
import { base } from 'viem/chains';
import type { AttributionLite, ChainReader, ReceiptLite, TransferLog, TxLite } from './types';

const slipstreamPoolAbi = parseAbi([
  'function factory() view returns (address)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function tickSpacing() view returns (int24)',
]);
const slipstreamFactoryAbi = parseAbi(['function getPool(address tokenA, address tokenB, int24 tickSpacing) view returns (address)']);
const FACTORIES = new Set(SLIPSTREAM_FACTORIES.map((f) => f.toLowerCase()));

const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

/**
 * Keyless public Base RPCs, tried in this order (BASE_RPC_URL first if it is ever set). No keyed
 * account exists, so one node being slow or rate-limited must never decide a buy.
 */
export const PUBLIC_BASE_RPCS = ['https://mainnet.base.org', 'https://base-rpc.publicnode.com', 'https://base.llamarpc.com', 'https://base.drpc.org', 'https://1rpc.io/base'] as const;

export function baseRpcUrls(extra: readonly string[] = []): string[] {
  return [...new Set([process.env.BASE_RPC_URL, ...extra, ...PUBLIC_BASE_RPCS, ...DEFAULT_RPC_URLS].filter((u): u is string => !!u))];
}

/** A client over every public node: fixed order (rank: false), retries and a timeout per node. */
export function createBaseClient(rpcUrls?: string[]): PublicClient {
  const urls = rpcUrls ?? baseRpcUrls();
  return createPublicClient({
    chain: base,
    transport: fallback(
      urls.map((u) => http(u, { retryCount: 1, retryDelay: 300, timeout: 12_000 })),
      { rank: false, retryCount: 2, retryDelay: 500 },
    ),
  }) as PublicClient;
}

/** Did this read fail because the contract answered (reverted, or there is no contract), not the network? */
export const contractAnswered = (e: unknown) =>
  e instanceof BaseError && !!e.walk((x) => x instanceof ContractFunctionRevertedError || x instanceof ContractFunctionZeroDataError);

export interface ViemChainReaderOptions {
  client?: PublicClient;
  /** Max blocks per eth_getLogs (publicnode: 50k). */
  logChunk?: bigint;
  /** Max token addresses per eth_getLogs (publicnode: 10). */
  maxAddresses?: number;
  /** Max wallet topics per eth_getLogs. */
  maxTopicAddresses?: number;
}

export function createViemChainReader(opts: ViemChainReaderOptions = {}): ChainReader {
  const client = opts.client ?? createBaseClient();
  const chunk = opts.logChunk ?? BigInt(process.env.TRANSFER_LOG_CHUNK ?? 50_000);
  const maxAddr = opts.maxAddresses ?? 10;
  const maxTopics = opts.maxTopicAddresses ?? 50;
  const blockTimes = new Map<bigint, number>();
  const pools = new Map<string, { at: number; ok: boolean }>();

  return {
    async verifyAttribution(txHash: string, buyer?: string): Promise<AttributionLite> {
      const r = await verifyAttribution(txHash as `0x${string}`, { client: client as never, buyer });
      return { attributed: r.attributed, codes: r.codes, via: r.via, from: r.from?.toLowerCase() };
    },
    async getReceipt(txHash: string): Promise<ReceiptLite | null> {
      try {
        const r = await client.getTransactionReceipt({ hash: txHash as `0x${string}` });
        return {
          status: r.status,
          blockNumber: r.blockNumber,
          from: r.from.toLowerCase(),
          to: r.to?.toLowerCase() ?? null,
          logs: r.logs.map((l) => ({ address: l.address.toLowerCase(), topics: [...l.topics], data: l.data, logIndex: l.logIndex })),
        };
      } catch (e) {
        if (/not be found|not found/i.test(String((e as Error).message))) return null;
        throw e;
      }
    },
    async getTransaction(txHash: string): Promise<TxLite | null> {
      try {
        const t = await client.getTransaction({ hash: txHash as `0x${string}` });
        return { from: t.from.toLowerCase(), to: t.to?.toLowerCase() ?? null, value: t.value, input: t.input, blockNumber: t.blockNumber };
      } catch (e) {
        if (/not be found|not found/i.test(String((e as Error).message))) return null;
        throw e;
      }
    },
    async getBlockTime(blockNumber: bigint): Promise<number> {
      const c = blockTimes.get(blockNumber);
      if (c !== undefined) return c;
      const b = await client.getBlock({ blockNumber });
      const t = Number(b.timestamp);
      blockTimes.set(blockNumber, t);
      return t;
    },
    blockNumber: () => client.getBlockNumber(),
    async ethUsd(blockNumber?: bigint): Promise<number | null> {
      const read = (bn?: bigint) =>
        client.readContract({ address: ETH_USD_FEED, abi: aggregatorV3Abi, functionName: 'latestRoundData', blockNumber: bn });
      try {
        const r = await read(blockNumber).catch(() => read());
        return Number(r[1]) / 1e8;
      } catch {
        return null;
      }
    },
    async balanceOf(token: string, wallet: string, blockNumber?: bigint): Promise<bigint | null> {
      try {
        return await client.readContract({
          address: getAddress(token),
          abi: b20Abi,
          functionName: 'balanceOf',
          args: [getAddress(wallet)],
          blockNumber,
        });
      } catch {
        return null;
      }
    },
    async isAerodromePool(address: string): Promise<boolean> {
      const a = address.toLowerCase();
      // only a "yes" is kept: a pool stays a pool. A "no" is asked again every time.
      if (pools.get(a)?.ok) return true;
      let ok = false;
      try {
        const pool = getAddress(a);
        const [factory, token0, token1, tickSpacing] = await Promise.all([
          client.readContract({ address: pool, abi: slipstreamPoolAbi, functionName: 'factory' }),
          client.readContract({ address: pool, abi: slipstreamPoolAbi, functionName: 'token0' }),
          client.readContract({ address: pool, abi: slipstreamPoolAbi, functionName: 'token1' }),
          client.readContract({ address: pool, abi: slipstreamPoolAbi, functionName: 'tickSpacing' }),
        ]);
        if (FACTORIES.has(factory.toLowerCase())) {
          // anything can answer factory(): the factory itself must name this address as the pool
          const named = await client.readContract({ address: getAddress(factory), abi: slipstreamFactoryAbi, functionName: 'getPool', args: [token0, token1, tickSpacing] });
          ok = named.toLowerCase() === a;
        }
      } catch (e) {
        // An address with no code, or a contract that is not a pool, reverts or returns no data: that
        // is a real "no". Anything else (HTTP error, timeout, rate limit) is not an answer: it is
        // passed on, and the buy is kept and tried again later.
        if (!contractAnswered(e)) throw e;
      }
      if (ok) {
        if (pools.size > 500) pools.clear();
        pools.set(a, { at: Date.now(), ok });
      }
      return ok;
    },
    async getTransferLogs(q): Promise<TransferLog[]> {
      const out: TransferLog[] = [];
      const tokenGroups: string[][] = [];
      for (let i = 0; i < q.tokens.length; i += maxAddr) tokenGroups.push(q.tokens.slice(i, i + maxAddr));
      const side = q.from?.length ? { key: 'from' as const, list: q.from } : { key: 'to' as const, list: q.to ?? [] };
      const walletGroups: string[][] = [];
      for (let i = 0; i < side.list.length; i += maxTopics) walletGroups.push(side.list.slice(i, i + maxTopics));
      if (!walletGroups.length) return out;
      for (const tg of tokenGroups)
        for (const wg of walletGroups)
          for (let s = q.fromBlock; s <= q.toBlock; s += chunk) {
            const e = s + chunk - 1n > q.toBlock ? q.toBlock : s + chunk - 1n;
            const logs = await client.getLogs({
              address: tg.map((t) => getAddress(t)),
              event: transferEvent,
              args: { [side.key]: wg.map((w) => getAddress(w)) } as never,
              fromBlock: s,
              toBlock: e,
            });
            for (const l of logs)
              out.push({
                token: l.address.toLowerCase(),
                from: (l.args.from as string).toLowerCase(),
                to: (l.args.to as string).toLowerCase(),
                value: l.args.value as bigint,
                blockNumber: l.blockNumber,
                txHash: l.transactionHash.toLowerCase(),
                logIndex: l.logIndex,
              });
          }
      return out;
    },
  };
}
