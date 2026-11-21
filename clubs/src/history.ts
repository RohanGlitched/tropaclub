/**
 * Full B20 history for any wallet (statement, cohorts): stock-token transfers with the payment /
 * proceeds legs of the same tx, plus ERC-8056 multiplier events per token.
 *
 * Implementations:
 * - EtherscanHistorySource: Etherscan V2 (chainid 8453) tokentx + txlist + logs. One or two calls per
 *   wallet. Needs ETHERSCAN_API_KEY (free tier).
 * - RpcHistorySource: ChainReader.getTransferLogs + receipts. No key; many getLogs calls on public RPC,
 *   so bound it with fromBlock or use a keyed RPC (BASE_RPC_URL).
 * - StaticHistorySource: tests and fixtures.
 */
import { b20Abi } from '@tropaclub/buy';
import { decodeEventLog, encodeEventTopics, getAddress } from 'viem';
import { legUsd, parseTransfers, paymentLeg, proceedsLeg } from './chain/receipt';
import { type ChainReader, USDC_ADDRESS, WETH_ADDRESS, isStockToken } from './chain/types';

export interface TxLegs {
  /** USD the wallet paid in this tx (USDC / WETH / ETH value), null if no visible payment. */
  paidUsd: number | null;
  /** USD the wallet received in this tx (USDC / WETH), null if none visible. */
  receivedUsd: number | null;
  /** The wallet sent some other (non-stock, non-USDC/WETH) token in the same tx: a swap paid in another token. */
  otherOut: boolean;
  /** The wallet received some other token in the same tx: a sale into another token. */
  otherIn: boolean;
}

export interface HistTransfer {
  token: string;
  dir: 'in' | 'out';
  raw: bigint;
  t: number;
  blockNumber: number;
  txHash: string;
  logIndex: number;
  counterparty: string;
  legs: TxLegs;
}

export interface MultiplierEvent {
  token: string;
  kind: 'updated' | 'cancelled';
  /** WAD (1e18 = 1.0). For 'cancelled': oldWad is unused. */
  oldWad: bigint;
  newWad: bigint;
  effectiveAt: number;
  blockNumber: number;
  logIndex: number;
  txHash: string;
  /** Paired Announcement description, if any (confirms the call only). */
  announcement?: string;
}

export interface WalletHistorySource {
  stockTransfers(wallet: string, opts?: { fromBlock?: number }): Promise<HistTransfer[]>;
  multiplierEvents(token: string): Promise<MultiplierEvent[]>;
}

export class StaticHistorySource implements WalletHistorySource {
  constructor(
    private transfers: Record<string, HistTransfer[]> = {},
    private multipliers: Record<string, MultiplierEvent[]> = {},
  ) {}
  async stockTransfers(wallet: string) {
    return this.transfers[wallet.toLowerCase()] ?? [];
  }
  async multiplierEvents(token: string) {
    return this.multipliers[token.toLowerCase()] ?? [];
  }
}

export const UI_MULTIPLIER_UPDATED_TOPIC = encodeEventTopics({ abi: b20Abi, eventName: 'UIMultiplierUpdated' })[0]!;
export const UI_MULTIPLIER_CANCELLED_TOPIC = encodeEventTopics({ abi: b20Abi, eventName: 'UIMultiplierUpdateCancelled' })[0]!;
export const ANNOUNCEMENT_TOPIC = encodeEventTopics({ abi: b20Abi, eventName: 'Announcement' })[0]!;

/** Decode UIMultiplierUpdated / UIMultiplierUpdateCancelled / Announcement raw logs into events. */
export function decodeMultiplierLogs(
  logs: { address: string; topics: string[]; data: string; blockNumber: number; logIndex: number; txHash: string; timeStamp?: number }[],
): MultiplierEvent[] {
  const out: MultiplierEvent[] = [];
  const ann = new Map<string, string>();
  for (const l of logs) {
    if (l.topics[0]?.toLowerCase() !== ANNOUNCEMENT_TOPIC.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: b20Abi, data: l.data as `0x${string}`, topics: l.topics as [`0x${string}`] });
      ann.set(l.txHash.toLowerCase(), String((ev.args as { description?: string }).description ?? ''));
    } catch {
      /* ignore */
    }
  }
  for (const l of logs) {
    const t0 = l.topics[0]?.toLowerCase();
    if (t0 !== UI_MULTIPLIER_UPDATED_TOPIC.toLowerCase() && t0 !== UI_MULTIPLIER_CANCELLED_TOPIC.toLowerCase()) continue;
    const ev = decodeEventLog({ abi: b20Abi, data: l.data as `0x${string}`, topics: l.topics as [`0x${string}`] });
    const a = ev.args as Record<string, bigint>;
    if (ev.eventName === 'UIMultiplierUpdated')
      out.push({ token: l.address.toLowerCase(), kind: 'updated', oldWad: a.oldMultiplier!, newWad: a.newMultiplier!, effectiveAt: Number(a.effectiveAtTimestamp), blockNumber: l.blockNumber, logIndex: l.logIndex, txHash: l.txHash, announcement: ann.get(l.txHash.toLowerCase()) });
    else
      out.push({ token: l.address.toLowerCase(), kind: 'cancelled', oldWad: 0n, newWad: a.cancelledMultiplier!, effectiveAt: Number(a.cancelledEffectiveAt), blockNumber: l.blockNumber, logIndex: l.logIndex, txHash: l.txHash });
  }
  return out.sort((x, y) => x.blockNumber - y.blockNumber || x.logIndex - y.logIndex);
}

interface EsTokenTx {
  hash: string;
  blockNumber: string;
  timeStamp: string;
  from: string;
  to: string;
  value: string;
  contractAddress: string;
  logIndex?: string;
  transactionIndex?: string;
}
interface EsTx {
  hash: string;
  from: string;
  to: string;
  value: string;
  isError?: string;
}
interface EsLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  timeStamp: string;
  logIndex: string;
  transactionHash: string;
}

/** First B20 mint (Aug 12 2026); nothing earlier carries stock-token transfers. */
export const B20_START_BLOCK = 49_860_000;

export class EtherscanHistorySource implements WalletHistorySource {
  private mcache = new Map<string, MultiplierEvent[]>();
  constructor(
    private opts: { apiKey?: string; fetchImpl?: typeof fetch; baseUrl?: string; ethUsd?: (blockNumber: number) => Promise<number | null> } = {},
  ) {}
  private async call<T>(params: Record<string, string>): Promise<T[]> {
    const key = this.opts.apiKey ?? process.env.ETHERSCAN_API_KEY;
    if (!key) throw new Error('ETHERSCAN_API_KEY is not set');
    const out: T[] = [];
    for (let page = 1; page <= 10; page++) {
      const u = new URL(this.opts.baseUrl ?? 'https://api.etherscan.io/v2/api');
      u.search = new URLSearchParams({ chainid: '8453', ...params, page: String(page), offset: '1000', apikey: key }).toString();
      const r = await (this.opts.fetchImpl ?? fetch)(u);
      if (!r.ok) throw new Error(`etherscan ${r.status}`);
      const j = (await r.json()) as { status: string; message: string; result: T[] | string };
      if (!Array.isArray(j.result)) {
        if (/no (transactions|records) found/i.test(String(j.message) + String(j.result))) break;
        throw new Error(`etherscan: ${j.message} ${String(j.result).slice(0, 120)}`);
      }
      out.push(...j.result);
      if (j.result.length < 1000) break;
    }
    return out;
  }

  async stockTransfers(wallet: string, opts: { fromBlock?: number } = {}): Promise<HistTransfer[]> {
    const w = wallet.toLowerCase();
    const range = { startblock: String(opts.fromBlock ?? B20_START_BLOCK), endblock: '999999999', sort: 'asc', address: w };
    const [tok, txs] = await Promise.all([
      this.call<EsTokenTx>({ module: 'account', action: 'tokentx', ...range }),
      this.call<EsTx>({ module: 'account', action: 'txlist', ...range }),
    ]);
    const ethValue = new Map(txs.filter((t) => t.from.toLowerCase() === w && t.isError !== '1').map((t) => [t.hash.toLowerCase(), BigInt(t.value || '0')]));
    const byHash = new Map<string, EsTokenTx[]>();
    for (const t of tok) byHash.set(t.hash.toLowerCase(), [...(byHash.get(t.hash.toLowerCase()) ?? []), t]);
    const out: HistTransfer[] = [];
    for (const [hash, rows] of byHash) {
      const stock = rows.filter((r) => isStockToken(r.contractAddress));
      if (!stock.length) continue;
      const net = (addr: string, dir: 1 | -1) =>
        rows
          .filter((r) => r.contractAddress.toLowerCase() === addr)
          .reduce((s, r) => s + (r.to.toLowerCase() === w ? 1n : r.from.toLowerCase() === w ? -1n : 0n) * BigInt(r.value) * BigInt(dir), 0n);
      const usdcOut = net(USDC_ADDRESS, -1);
      const wethOut = net(WETH_ADDRESS, -1);
      const blockNumber = Number(rows[0]!.blockNumber);
      const ethUsd = this.opts.ethUsd ? await this.opts.ethUsd(blockNumber) : null;
      const eth = ethValue.get(hash) ?? 0n;
      const paidUsd = usdcOut > 0n ? Number(usdcOut) / 1e6 : wethOut > 0n && ethUsd ? (Number(wethOut) / 1e18) * ethUsd : eth > 0n && ethUsd ? (Number(eth) / 1e18) * ethUsd : null;
      const usdcIn = net(USDC_ADDRESS, 1);
      const wethIn = net(WETH_ADDRESS, 1);
      const receivedUsd = usdcIn > 0n ? Number(usdcIn) / 1e6 : wethIn > 0n && ethUsd ? (Number(wethIn) / 1e18) * ethUsd : null;
      const others = rows.filter((r) => !isStockToken(r.contractAddress) && ![USDC_ADDRESS, WETH_ADDRESS].includes(r.contractAddress.toLowerCase()));
      const legs: TxLegs = {
        paidUsd,
        receivedUsd,
        otherOut: others.some((r) => r.from.toLowerCase() === w),
        otherIn: others.some((r) => r.to.toLowerCase() === w),
      };
      for (const r of stock) {
        const dir = r.to.toLowerCase() === w ? 'in' : r.from.toLowerCase() === w ? 'out' : null;
        if (!dir || r.to.toLowerCase() === r.from.toLowerCase()) continue;
        out.push({
          token: r.contractAddress.toLowerCase(),
          dir,
          raw: BigInt(r.value),
          t: Number(r.timeStamp),
          blockNumber,
          txHash: hash,
          logIndex: Number(r.logIndex ?? 0),
          counterparty: (dir === 'in' ? r.from : r.to).toLowerCase(),
          legs,
        });
      }
    }
    return out.sort((a, b) => a.t - b.t || a.logIndex - b.logIndex);
  }

  async multiplierEvents(token: string): Promise<MultiplierEvent[]> {
    const k = token.toLowerCase();
    if (this.mcache.has(k)) return this.mcache.get(k)!;
    const base = { module: 'logs', action: 'getLogs', address: k, fromBlock: String(B20_START_BLOCK), toBlock: 'latest' };
    const [u, c, a] = await Promise.all([
      this.call<EsLog>({ ...base, topic0: UI_MULTIPLIER_UPDATED_TOPIC }),
      this.call<EsLog>({ ...base, topic0: UI_MULTIPLIER_CANCELLED_TOPIC }),
      this.call<EsLog>({ ...base, topic0: ANNOUNCEMENT_TOPIC }),
    ]);
    const ev = decodeMultiplierLogs(
      [...u, ...c, ...a].map((l) => ({ address: l.address, topics: l.topics, data: l.data, blockNumber: Number(l.blockNumber), logIndex: Number(l.logIndex), txHash: l.transactionHash })),
    );
    this.mcache.set(k, ev);
    return ev;
  }
}

/** RPC-only history (bounded by fromBlock). Reads receipts for each tx to find payment legs. */
export class RpcHistorySource implements WalletHistorySource {
  constructor(
    private chain: ChainReader,
    private opts: { tokens: string[]; fromBlock?: bigint; multiplierLogs?: (token: string) => Promise<MultiplierEvent[]> },
  ) {}
  async stockTransfers(wallet: string, o: { fromBlock?: number } = {}): Promise<HistTransfer[]> {
    if (!this.chain.getTransferLogs) throw new Error('chain reader has no getTransferLogs');
    const w = wallet.toLowerCase();
    const head = await this.chain.blockNumber();
    const fromBlock = o.fromBlock !== undefined ? BigInt(o.fromBlock) : this.opts.fromBlock ?? BigInt(B20_START_BLOCK);
    const q = { tokens: this.opts.tokens, fromBlock, toBlock: head };
    const logs = [...(await this.chain.getTransferLogs({ ...q, to: [w] })), ...(await this.chain.getTransferLogs({ ...q, from: [w] }))];
    const out: HistTransfer[] = [];
    const legCache = new Map<string, TxLegs>();
    for (const l of logs) {
      let legs = legCache.get(l.txHash);
      if (!legs) {
        const [rc, tx] = await Promise.all([this.chain.getReceipt(l.txHash), this.chain.getTransaction(l.txHash)]);
        const ts = rc ? parseTransfers(rc.logs) : [];
        const ethUsd = await this.chain.ethUsd(l.blockNumber);
        const pay = paymentLeg(ts, w, tx);
        const got = proceedsLeg(ts, w);
        const others = ts.filter((t) => !isStockToken(t.token) && t.token !== USDC_ADDRESS && t.token !== WETH_ADDRESS);
        legs = {
          paidUsd: pay ? legUsd(pay, ethUsd) : null,
          receivedUsd: got ? legUsd(got, ethUsd) : null,
          otherOut: others.some((t) => t.from === w),
          otherIn: others.some((t) => t.to === w),
        };
        legCache.set(l.txHash, legs);
      }
      const dir = l.to === w ? 'in' : 'out';
      out.push({ token: l.token, dir, raw: l.value, t: await this.chain.getBlockTime(l.blockNumber), blockNumber: Number(l.blockNumber), txHash: l.txHash, logIndex: l.logIndex, counterparty: dir === 'in' ? l.from : l.to, legs });
    }
    return out.sort((a, b) => a.t - b.t || a.logIndex - b.logIndex);
  }
  async multiplierEvents(token: string): Promise<MultiplierEvent[]> {
    return this.opts.multiplierLogs ? this.opts.multiplierLogs(getAddress(token).toLowerCase()) : [];
  }
}
