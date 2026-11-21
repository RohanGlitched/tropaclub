/**
 * Quotes and swap calldata.
 *
 * Primary: KyberSwap Aggregator API v1 (Base), keyless with `x-client-id` (checked Nov 22 2026: 200 without a key).
 *   GET  /base/api/v1/routes        -> routeSummary (routes B20 stocks through Aerodrome Slipstream "aero-cl")
 *   POST /base/api/v1/route/build   -> { data, routerAddress, amountOut, transactionValue }
 *   Router 0x6131B5fae19EA4f9D964eAc0408E4408b66337b5 (MetaAggregationRouterV2.swap, selector 0xe21fd0e9).
 * Fallback: LI.FI /v1/quote (keyless, rate-limited; adds a feeCollection step, routes via OKX etc.).
 * 1inch and 0x both return 401 without an API key, so they are not used.
 */
import { type Address, type Hex, decodeFunctionData, getAddress, isAddress } from 'viem';
import { KYBER_API, KYBER_CLIENT_ID, LIFI_API, NATIVE_ETH, USDC, WETH, kyberRouterAbi } from './constants';

export type Provider = 'kyberswap' | 'lifi';

export interface Quote {
  provider: Provider;
  sellToken: Address;
  buyToken: Address;
  sellAmount: bigint;
  amountOut: bigint;
  amountInUsd?: number;
  amountOutUsd?: number;
  /** Router to approve and call. */
  router: Address;
  gasEstimate?: bigint;
  /** Venues in the route, e.g. ["aero-cl"]. */
  venues: string[];
  /** Opaque provider payload needed to build the tx. */
  raw: unknown;
  taker: Address;
}

export interface BuiltSwap {
  to: Address;
  data: Hex;
  value: bigint;
  amountOut: bigint;
  /** Minimum the router enforces, decoded from calldata when possible. */
  minReturnAmount: bigint | null;
  dstReceiver: Address | null;
  provider: Provider;
}

export function resolveToken(t: string): Address {
  const u = t.toUpperCase();
  if (u === 'ETH') return NATIVE_ETH;
  if (u === 'USDC') return USDC;
  if (u === 'WETH') return WETH;
  if (!isAddress(t)) throw new Error(`unknown token ${t}`);
  return getAddress(t);
}

export function isNative(t: Address): boolean {
  return t.toLowerCase() === NATIVE_ETH.toLowerCase();
}

const kyberHeaders = { 'x-client-id': KYBER_CLIENT_ID, accept: 'application/json' };

/** KyberSwap source ids for Aerodrome Slipstream on Base (observed in routes, Nov 2026). */
export const AERODROME_SOURCES = ['aero-cl', 'aerodrome-cl-3'] as const;

export type SourcePref = 'aerodrome' | 'best' | readonly string[];

async function kyberQuote(sellToken: Address, buyToken: Address, sellAmount: bigint, taker: Address, fetchImpl: typeof fetch, sources?: readonly string[]): Promise<Quote> {
  const inc = sources?.length ? `&includedSources=${sources.join(',')}` : '';
  const url = `${KYBER_API}/routes?tokenIn=${sellToken}&tokenOut=${buyToken}&amountIn=${sellAmount}&gasInclude=true&origin=${taker}${inc}`;
  const res = await fetchImpl(url, { headers: kyberHeaders });
  const j = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || j.code !== 0 || !j.data?.routeSummary) throw new Error(`KyberSwap routes ${res.status}: ${j.message ?? 'no route'}`);
  const rs = j.data.routeSummary;
  const venues = [...new Set((rs.route as any[][]).flat().map((h) => String(h.exchange)))];
  return {
    provider: 'kyberswap',
    sellToken,
    buyToken,
    sellAmount,
    amountOut: BigInt(rs.amountOut),
    amountInUsd: Number(rs.amountInUsd),
    amountOutUsd: Number(rs.amountOutUsd),
    router: getAddress(j.data.routerAddress),
    gasEstimate: rs.gas ? BigInt(rs.gas) : undefined,
    venues,
    raw: rs,
    taker,
  };
}

async function lifiQuote(
  sellToken: Address,
  buyToken: Address,
  sellAmount: bigint,
  taker: Address,
  fetchImpl: typeof fetch,
  slippage = 0.015,
): Promise<Quote & { lifiTx: { to: Address; data: Hex; value: bigint }; toAmountMin: bigint }> {
  const u = new URL(`${LIFI_API}/quote`);
  const from = isNative(sellToken) ? '0x0000000000000000000000000000000000000000' : sellToken;
  Object.entries({ fromChain: '8453', toChain: '8453', fromToken: from, toToken: buyToken, fromAmount: sellAmount.toString(), fromAddress: taker, integrator: 'tropaclub', slippage: String(slippage) }).forEach(([k, v]) => u.searchParams.set(k, v));
  const res = await fetchImpl(u, { headers: { accept: 'application/json' } });
  const j = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || !j.transactionRequest) throw new Error(`LI.FI quote ${res.status}: ${j.message ?? 'no route'}`);
  return {
    provider: 'lifi',
    sellToken,
    buyToken,
    sellAmount,
    amountOut: BigInt(j.estimate.toAmount),
    amountInUsd: Number(j.estimate.fromAmountUSD ?? NaN),
    amountOutUsd: Number(j.estimate.toAmountUSD ?? NaN),
    router: getAddress(j.estimate.approvalAddress ?? j.transactionRequest.to),
    gasEstimate: j.estimate.gasCosts?.[0]?.estimate ? BigInt(j.estimate.gasCosts[0].estimate) : undefined,
    venues: (j.includedSteps ?? []).map((s: any) => String(s.tool)),
    raw: j,
    taker,
    lifiTx: { to: getAddress(j.transactionRequest.to), data: j.transactionRequest.data, value: BigInt(j.transactionRequest.value ?? 0) },
    toAmountMin: BigInt(j.estimate.toAmountMin),
  };
}

export interface QuoteParams {
  sellToken: Address | 'ETH' | 'USDC' | string;
  buyToken: Address | string;
  sellAmount: bigint;
  taker: Address;
  providers?: Provider[];
  /**
   * 'aerodrome' (default): route only through Aerodrome Slipstream (where >95% of B20 liquidity and venue
   * campaigns sit), falling back to the best route if Aerodrome has none. 'best': any KyberSwap source.
   */
  sources?: SourcePref;
  fetchImpl?: typeof fetch;
}

export async function getQuote(p: QuoteParams): Promise<Quote> {
  const sellToken = resolveToken(p.sellToken);
  const buyToken = resolveToken(p.buyToken);
  const f = p.fetchImpl ?? fetch;
  const errors: string[] = [];
  for (const prov of p.providers ?? ['kyberswap', 'lifi']) {
    try {
      if (prov === 'kyberswap') {
        const pref = p.sources ?? 'aerodrome';
        const list = pref === 'aerodrome' ? AERODROME_SOURCES : pref === 'best' ? undefined : pref;
        if (list) {
          try {
            return await kyberQuote(sellToken, buyToken, p.sellAmount, p.taker, f, list);
          } catch (e) {
            errors.push(`kyberswap(${list.join(',')}): ${(e as Error).message}`);
          }
        }
        return await kyberQuote(sellToken, buyToken, p.sellAmount, p.taker, f);
      }
      if (prov === 'lifi') return await lifiQuote(sellToken, buyToken, p.sellAmount, p.taker, f);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  throw new Error(`no quote: ${errors.join(' | ')}`);
}

/** Decode KyberSwap MetaAggregationRouterV2.swap calldata (suffix-tolerant). */
export function decodeKyberSwap(data: Hex): { minReturnAmount: bigint; dstReceiver: Address; amount: bigint; srcToken: Address; dstToken: Address } | null {
  try {
    const { args } = decodeFunctionData({ abi: kyberRouterAbi, data });
    const d = (args[0] as any).desc;
    return { minReturnAmount: d.minReturnAmount, dstReceiver: getAddress(d.dstReceiver), amount: d.amount, srcToken: getAddress(d.srcToken), dstToken: getAddress(d.dstToken) };
  } catch {
    return null;
  }
}

/**
 * Build swap calldata whose enforced minimum is >= amountOutMin (our guard), recipient = taker.
 * KyberSwap takes slippage in integer bps relative to the quoted amountOut, so we floor the bps
 * that maps the quote onto the guard: router min = quoted*(1 - bps/1e4) >= amountOutMin.
 */
export async function buildSwap(
  quote: Quote,
  p: { amountOutMin: bigint; recipient?: Address; deadlineSec?: number; fetchImpl?: typeof fetch },
): Promise<BuiltSwap> {
  const f = p.fetchImpl ?? fetch;
  const recipient = p.recipient ?? quote.taker;
  if (quote.amountOut < p.amountOutMin) throw new Error('quote is below the guard minimum');
  const bps = Number(((quote.amountOut - p.amountOutMin) * 10_000n) / quote.amountOut);
  if (quote.provider === 'kyberswap') {
    const body = {
      routeSummary: quote.raw,
      sender: quote.taker,
      recipient,
      origin: quote.taker,
      slippageTolerance: Math.min(bps, 2000),
      deadline: p.deadlineSec ?? Math.floor(Date.now() / 1000) + 20 * 60,
      source: KYBER_CLIENT_ID,
      enableGasEstimation: false,
    };
    const res = await f(`${KYBER_API}/route/build`, { method: 'POST', headers: { ...kyberHeaders, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = (await res.json().catch(() => ({}))) as any;
    if (!res.ok || j.code !== 0 || !j.data?.data) throw new Error(`KyberSwap build ${res.status}: ${j.message ?? 'failed'}`);
    const data = j.data.data as Hex;
    const dec = decodeKyberSwap(data);
    if (dec && dec.minReturnAmount < p.amountOutMin) throw new Error(`KyberSwap min ${dec.minReturnAmount} below guard ${p.amountOutMin}`);
    if (dec && dec.dstReceiver.toLowerCase() !== recipient.toLowerCase()) throw new Error('KyberSwap calldata pays a different receiver');
    return {
      to: getAddress(j.data.routerAddress),
      data,
      value: BigInt(j.data.transactionValue ?? 0),
      amountOut: BigInt(j.data.amountOut),
      minReturnAmount: dec?.minReturnAmount ?? null,
      dstReceiver: dec?.dstReceiver ?? null,
      provider: 'kyberswap',
    };
  }
  // LI.FI: re-quote with the slippage that maps onto the guard (min enforced is toAmountMin).
  const slippage = Math.max(bps, 1) / 10_000;
  const q = await lifiQuote(quote.sellToken, quote.buyToken, quote.sellAmount, quote.taker, f, slippage);
  if (q.toAmountMin < p.amountOutMin) throw new Error(`LI.FI min ${q.toAmountMin} below guard ${p.amountOutMin}`);
  return { to: q.lifiTx.to, data: q.lifiTx.data, value: q.lifiTx.value, amountOut: q.amountOut, minReturnAmount: q.toAmountMin, dstReceiver: recipient, provider: 'lifi' };
}
