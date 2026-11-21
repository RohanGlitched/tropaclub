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
