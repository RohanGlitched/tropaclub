/**
 * Funding source = the first inbound USDC or ETH sender of a wallet. Pick-up clubs never seat two
 * wallets with the same funding source (cheap sybil guard).
 *
 * Exchange hot wallets and bridges fund thousands of unrelated people, so a funder with a very high
 * nonce, or one on the configured common-funder list, is treated as "no signal" (null).
 */
import { USDC_ADDRESS } from './chain/types';

export interface FundingSourceResolver {
  /** Lowercase funder address, or null when unknown / not a meaningful signal. */
  firstFunder(wallet: string): Promise<string | null>;
  /**
   * When the wallet first showed up: the time of its first inbound value (native ETH, USDC or WETH)
   * or first transaction. olderThanWindow: it was already active before the resolver's window, so
   * it is not new. at null and olderThanWindow false: nothing found (treated as unknown).
   * Throws when the chain cannot be read now.
   */
  firstSeen?(wallet: string): Promise<WalletAge>;
}

export interface WalletAge {
  at: number | null;
  olderThanWindow: boolean;
}

export class StaticFundingResolver implements FundingSourceResolver {
  constructor(
    private map: Record<string, string | null> = {},
    private ages: Record<string, WalletAge> = {},
  ) {}
  async firstFunder(wallet: string) {
    return this.map[wallet.toLowerCase()] ?? null;
  }
  async firstSeen(wallet: string): Promise<WalletAge> {
    return this.ages[wallet.toLowerCase()] ?? { at: null, olderThanWindow: true };
  }
}

interface EtherscanRow {
  from: string;
  to: string;
  value: string;
  timeStamp: string;
  isError?: string;
}

/** Etherscan V2 (chainid 8453). ETHERSCAN_API_KEY from Secret Manager; free tier is enough. */
export class EtherscanFundingResolver implements FundingSourceResolver {
  constructor(
    private opts: { apiKey?: string; commonFunders?: string[]; exchangeNonce?: number; fetchImpl?: typeof fetch; baseUrl?: string } = {},
  ) {}
  private async call<T>(params: Record<string, string>): Promise<T | null> {
    const key = this.opts.apiKey ?? process.env.ETHERSCAN_API_KEY;
    if (!key) return null;
    const u = new URL(this.opts.baseUrl ?? 'https://api.etherscan.io/v2/api');
    u.search = new URLSearchParams({ chainid: '8453', ...params, apikey: key }).toString();
    const r = await (this.opts.fetchImpl ?? fetch)(u);
    if (!r.ok) return null;
    const j = (await r.json()) as { status?: string; result?: T };
    return (j.result ?? null) as T | null;
  }
  async firstFunder(wallet: string): Promise<string | null> {
    const w = wallet.toLowerCase();
    const page = { page: '1', offset: '25', sort: 'asc', startblock: '0', endblock: '999999999', address: w };
    const [normal, internal, usdc] = await Promise.all([
      this.call<EtherscanRow[]>({ module: 'account', action: 'txlist', ...page }),
      this.call<EtherscanRow[]>({ module: 'account', action: 'txlistinternal', ...page }),
      this.call<EtherscanRow[]>({ module: 'account', action: 'tokentx', contractaddress: USDC_ADDRESS, ...page }),
    ]);
    const cands: { from: string; t: number }[] = [];
    for (const rows of [normal, internal]) {
      if (!Array.isArray(rows)) continue;
      const hit = rows.find((r) => r.to?.toLowerCase() === w && BigInt(r.value || '0') > 0n && r.isError !== '1');
      if (hit) cands.push({ from: hit.from.toLowerCase(), t: Number(hit.timeStamp) });
    }
    if (Array.isArray(usdc)) {
      const hit = usdc.find((r) => r.to?.toLowerCase() === w && BigInt(r.value || '0') > 0n);
      if (hit) cands.push({ from: hit.from.toLowerCase(), t: Number(hit.timeStamp) });
    }
    cands.sort((a, b) => a.t - b.t);
    const funder = cands[0]?.from ?? null;
    if (!funder) return null;
    return this.screen(funder);
  }
  private async screen(funder: string): Promise<string | null> {
    if ((this.opts.commonFunders ?? []).map((x) => x.toLowerCase()).includes(funder)) return null;
    const nonceHex = await this.call<string>({ module: 'proxy', action: 'eth_getTransactionCount', address: funder, tag: 'latest' });
    if (typeof nonceHex === 'string' && /^0x[0-9a-f]+$/i.test(nonceHex) && Number(BigInt(nonceHex)) >= (this.opts.exchangeNonce ?? 5_000)) return null;
    return funder;
  }
  /** The earliest transaction of any kind that touches the wallet (sent, received, internal, token). */
  async firstSeen(wallet: string): Promise<WalletAge> {
    const w = wallet.toLowerCase();
    const page = { page: '1', offset: '1', sort: 'asc', startblock: '0', endblock: '999999999', address: w };
    const lists = await Promise.all([
      this.call<EtherscanRow[]>({ module: 'account', action: 'txlist', ...page }),
      this.call<EtherscanRow[]>({ module: 'account', action: 'txlistinternal', ...page }),
      this.call<EtherscanRow[]>({ module: 'account', action: 'tokentx', ...page }),
    ]);
    if (lists.every((l) => l == null)) throw new Error('explorer unavailable');
    const ts = lists.flatMap((l) => (Array.isArray(l) ? l.map((r) => Number(r.timeStamp)).filter((t) => t > 0) : []));
    return { at: ts.length ? Math.min(...ts) : null, olderThanWindow: false };
  }
}

/** What the chain resolver reads. The last four are optional; without them only USDC/WETH count. */
export interface FundingChain extends Pick<import('./chain/types').ChainReader, 'blockNumber' | 'getTransferLogs'> {
  nonceOf?: (a: string) => Promise<number | null>;
  /** Native ETH balance at a block (wei). */
  balanceAt?: (a: string, block: bigint) => Promise<bigint>;
  /** Transaction count at a block. */
  nonceAt?: (a: string, block: bigint) => Promise<number>;
  /** The plain value transfers in a block: from, to, value. */
  blockTransfers?: (block: bigint) => Promise<{ from: string; to: string | null; value: bigint }[]>;
  blockTime?: (block: bigint) => Promise<number>;
}

interface Probe {
  funder: string | null;
  age: WalletAge;
}

/**
 * Funding source and age from the chain, for when no explorer key is set, inside the last
 * `windowBlocks` blocks (30 days by default):
 *   - the earliest sender of USDC or WETH to the wallet (transfer logs), and
 *   - the first native ETH: the first block where the wallet has a balance or has sent a
 *     transaction, found by binary search (an account that has been funded or used stays so), and
 *     the sender of the plain ETH transfer to it in that block. ETH that arrived through a contract
 *     (an internal transfer) has no plain sender there and gives no funder, only the age.
 * The earlier of the two is the funder. A sender with a very high nonce (an exchange or bridge hot
 * wallet) is "no signal" (null). Throws when the chain cannot be read, so the caller decides later
 * instead of on a guess.
 */
export class RpcFundingResolver implements FundingSourceResolver {
  private memo = new Map<string, { at: number; p: Promise<Probe> }>();
  constructor(
    private chain: FundingChain,
    private opts: { windowBlocks?: bigint; exchangeNonce?: number; commonFunders?: string[] } = {},
  ) {}
  async firstFunder(wallet: string): Promise<string | null> {
    return (await this.probe(wallet)).funder;
  }
  async firstSeen(wallet: string): Promise<WalletAge> {
    return (await this.probe(wallet)).age;
  }
  private probe(wallet: string): Promise<Probe> {
    const w = wallet.toLowerCase();
    const hit = this.memo.get(w);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
    const p = this.read(w);
    p.catch(() => this.memo.delete(w));
    if (this.memo.size > 2000) this.memo.clear();
    this.memo.set(w, { at: Date.now(), p });
    return p;
  }
  private async read(w: string): Promise<Probe> {
    const c = this.chain;
    const head = await c.blockNumber();
    const win = this.opts.windowBlocks ?? 1_296_000n;
    const start = head > win ? head - win : 0n;
    const cands: { from: string | null; block: bigint; order: number }[] = [];

    if (c.getTransferLogs) {
      const logs = await c.getTransferLogs({ tokens: [USDC_ADDRESS, '0x4200000000000000000000000000000000000006'], to: [w], fromBlock: start, toBlock: head });
      const first = logs
        .filter((l) => l.from !== w && l.from !== '0x0000000000000000000000000000000000000000')
        .sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : a.logIndex - b.logIndex))[0];
      if (first) cands.push({ from: first.from.toLowerCase(), block: first.blockNumber, order: first.logIndex });
    }

    let older = false;
    if (c.balanceAt && c.nonceAt) {
      const balanceAt = c.balanceAt;
      const nonceAt = c.nonceAt;
      const active = async (b: bigint) => {
        const [bal, n] = await Promise.all([balanceAt(w, b), nonceAt(w, b)]);
        return bal > 0n || n > 0;
      };
      if (await active(start)) older = true;
      else if (await active(head)) {
        let lo = start; // not active yet
        let hi = head; // active
        while (hi - lo > 1n) {
          const mid = (lo + hi) / 2n;
          if (await active(mid)) hi = mid;
          else lo = mid;
        }
        let from: string | null = null;
        if (c.blockTransfers && (await balanceAt(w, hi)) > 0n) {
          const tx = (await c.blockTransfers(hi)).find((t) => t.to?.toLowerCase() === w && t.value > 0n && t.from.toLowerCase() !== w);
          from = tx ? tx.from.toLowerCase() : null;
        }
        cands.push({ from, block: hi, order: -1 });
      }
    }

    cands.sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : a.order - b.order));
    const firstBlock = cands[0]?.block ?? null;
    const at = !older && firstBlock != null && c.blockTime ? await c.blockTime(firstBlock) : null;
    const raw = cands.find((x) => x.from)?.from ?? null;
    return { funder: raw ? await this.screen(raw) : null, age: { at, olderThanWindow: older } };
  }
  private async screen(funder: string): Promise<string | null> {
    if ((this.opts.commonFunders ?? []).map((x) => x.toLowerCase()).includes(funder)) return null;
    const nonce = this.chain.nonceOf ? await this.chain.nonceOf(funder).catch(() => null) : null;
    if (nonce != null && nonce >= (this.opts.exchangeNonce ?? 5_000)) return null;
    return funder;
  }
}
