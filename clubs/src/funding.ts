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
}

export class StaticFundingResolver implements FundingSourceResolver {
  constructor(private map: Record<string, string | null> = {}) {}
  async firstFunder(wallet: string) {
    return this.map[wallet.toLowerCase()] ?? null;
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
    if ((this.opts.commonFunders ?? []).map((x) => x.toLowerCase()).includes(funder)) return null;
    const nonceHex = await this.call<string>({ module: 'proxy', action: 'eth_getTransactionCount', address: funder, tag: 'latest' });
    if (typeof nonceHex === 'string' && /^0x[0-9a-f]+$/i.test(nonceHex) && Number(BigInt(nonceHex)) >= (this.opts.exchangeNonce ?? 5_000)) return null;
    return funder;
  }
}

/**
 * Funding source from the chain, for when no explorer key is set: the earliest sender of USDC or
 * WETH to the wallet in the last `windowBlocks` blocks (30 days by default). A sender with a very
 * high nonce (an exchange or bridge hot wallet) is "no signal" (null). Throws when the chain
 * cannot be read, so the caller decides later instead of on a guess.
 */
export class RpcFundingResolver implements FundingSourceResolver {
  constructor(
    private chain: Pick<import('./chain/types').ChainReader, 'blockNumber' | 'getTransferLogs'> & { nonceOf?: (a: string) => Promise<number | null> },
    private opts: { windowBlocks?: bigint; exchangeNonce?: number; commonFunders?: string[] } = {},
  ) {}
  async firstFunder(wallet: string): Promise<string | null> {
    if (!this.chain.getTransferLogs) return null;
    const w = wallet.toLowerCase();
    const head = await this.chain.blockNumber();
    const from = head - (this.opts.windowBlocks ?? 1_296_000n);
    const logs = await this.chain.getTransferLogs({ tokens: [USDC_ADDRESS, '0x4200000000000000000000000000000000000006'], to: [w], fromBlock: from > 0n ? from : 0n, toBlock: head });
    const first = logs.filter((l) => l.from !== w && l.from !== '0x0000000000000000000000000000000000000000').sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : a.logIndex - b.logIndex))[0];
    if (!first) return null;
    const funder = first.from.toLowerCase();
    if ((this.opts.commonFunders ?? []).map((x) => x.toLowerCase()).includes(funder)) return null;
    const nonce = this.chain.nonceOf ? await this.chain.nonceOf(funder).catch(() => null) : null;
    if (nonce != null && nonce >= (this.opts.exchangeNonce ?? 5_000)) return null;
    return funder;
  }
}
