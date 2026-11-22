/**
 * viem ChainReader for Base mainnet. Attribution goes through @tropaclub/buy's verifyAttribution.
 * RPC: BASE_RPC_URL (keyed Alchemy/QuickNode free tier) first, then the public fallbacks from the buy package.
 */
import { DEFAULT_RPC_URLS, ETH_USD_FEED, SLIPSTREAM_FACTORIES, aggregatorV3Abi, b20Abi, verifyAttribution } from '@tropaclub/buy';
import { type PublicClient, createPublicClient, fallback, getAddress, http, parseAbi, parseAbiItem } from 'viem';
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

export function createBaseClient(rpcUrls?: string[]): PublicClient {
  const urls = rpcUrls ?? [process.env.BASE_RPC_URL, ...DEFAULT_RPC_URLS].filter((u): u is string => !!u);
  return createPublicClient({
    chain: base,
    transport: fallback(urls.map((u) => http(u, { retryCount: 2, timeout: 20_000 }))),
  }) as PublicClient;
}

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
      const hit = pools.get(a);
      // a pool stays a pool; a "no" is asked again after ten minutes
      if (hit && (hit.ok || Date.now() - hit.at < 10 * 60_000)) return hit.ok;
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
        // an address with no code, or one that is not a pool, reverts or returns nothing: that is a "no".
        // A network error is not an answer, so it is passed on and the buy is tried again.
        if (!/revert|returned no data|ContractFunctionExecutionError|ContractFunctionZeroDataError|AbiDecoding/i.test(`${(e as Error).name} ${(e as Error).message}`)) throw e;
      }
      if (pools.size > 500) pools.clear();
      pools.set(a, { at: Date.now(), ok });
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
