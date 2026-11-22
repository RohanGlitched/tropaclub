/**
 * Quotes and swap calldata.
 *
 * Primary: KyberSwap Aggregator API v1 (Base), keyless with `x-client-id` (checked Nov 22 2026: 200 without a key).
 *   GET  /base/api/v1/routes        -> routeSummary (routes B20 stocks through Aerodrome Slipstream "aero-cl")
 *   POST /base/api/v1/route/build   -> { data, routerAddress, amountOut, transactionValue }
 *   Router 0x6131B5fae19EA4f9D964eAc0408E4408b66337b5 (MetaAggregationRouterV2.swap, selector 0xe21fd0e9).
 * No fallback aggregator: a route that cannot be decoded and checked is never used.
 * 1inch and 0x both return 401 without an API key, so they are not used.
 */
import { type Address, type Hex, decodeFunctionData, getAddress, isAddress } from 'viem';
import { KYBER_API, KYBER_CLIENT_ID, KYBER_EXECUTORS, KYBER_ROUTER, NATIVE_ETH, USDC, WETH, ZERO_ADDRESS, kyberRouterAbi } from './constants';

export type Provider = 'kyberswap';

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

/**
 * 'aerodrome' (default): every Aerodrome Slipstream source. A list narrows it to some of them; a list
 * naming anything that is not an Aerodrome source is refused. There is no "best route" option: the
 * clubs engine only counts stock that came out of verified Aerodrome pools.
 */
export type SourcePref = 'aerodrome' | readonly string[];

const isAerodromeSource = (s: string) => (AERODROME_SOURCES as readonly string[]).includes(s);

/** The Aerodrome sources a quote may use; throws for anything else. */
export function aerodromeSources(pref: SourcePref = 'aerodrome'): readonly string[] {
  if (pref === 'aerodrome') return AERODROME_SOURCES;
  if (!Array.isArray(pref) || !pref.length) throw new Error('sources must be "aerodrome" or a list of Aerodrome sources');
  const bad = pref.filter((s) => !isAerodromeSource(s));
  if (bad.length) throw new Error(`only Aerodrome sources are quoted (${AERODROME_SOURCES.join(', ')}), not ${bad.join(', ')}`);
  return pref;
}

/** Every hop of a KyberSwap routeSummary.route, flattened; throws if the route has no hops. */
export function routeHops(route: unknown): { exchange: string; pool?: string }[] {
  if (!Array.isArray(route) || !route.length || !route.every((r) => Array.isArray(r) && r.length)) throw new Error('KyberSwap returned a route with no hops');
  return (route as any[][]).flat().map((h) => ({ exchange: String(h?.exchange ?? ''), pool: h?.pool ? String(h.pool) : undefined }));
}

/** Throws unless every hop of the route trades on one of `allowed` (Aerodrome sources only). Returns the venues. */
export function assertAerodromeRoute(route: unknown, allowed: readonly string[] = AERODROME_SOURCES): string[] {
  const hops = routeHops(route);
  const off = hops.filter((h) => !allowed.includes(h.exchange) || !isAerodromeSource(h.exchange));
  if (off.length) throw new Error(`KyberSwap route uses non-Aerodrome venues (${[...new Set(off.map((h) => h.exchange || 'unknown'))].join(', ')}), so it is refused`);
  return [...new Set(hops.map((h) => h.exchange))];
}

async function kyberQuote(sellToken: Address, buyToken: Address, sellAmount: bigint, taker: Address, fetchImpl: typeof fetch, sources: readonly string[]): Promise<Quote> {
  const url = `${KYBER_API}/routes?tokenIn=${sellToken}&tokenOut=${buyToken}&amountIn=${sellAmount}&gasInclude=true&origin=${taker}&includedSources=${sources.join(',')}`;
  const res = await fetchImpl(url, { headers: kyberHeaders });
  const j = (await res.json().catch(() => ({}))) as any;
  if (!res.ok || j.code !== 0 || !j.data?.routeSummary) throw new Error(`KyberSwap has no Aerodrome route (${res.status}: ${j.message ?? 'no route'})`);
  const rs = j.data.routeSummary;
  const venues = assertAerodromeRoute(rs.route, sources);
  if (String(j.data.routerAddress ?? '').toLowerCase() !== KYBER_ROUTER.toLowerCase()) throw new Error(`KyberSwap quoted an unexpected router ${j.data.routerAddress}`);
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

export interface QuoteParams {
  sellToken: Address | 'ETH' | 'USDC' | string;
  buyToken: Address | string;
  sellAmount: bigint;
  taker: Address;
  providers?: Provider[];
  /**
   * 'aerodrome' (default): route only through Aerodrome Slipstream (where >95% of B20 liquidity and venue
   * campaigns sit). There is no fallback: if Aerodrome has no route, there is no quote.
   */
  sources?: SourcePref;
  fetchImpl?: typeof fetch;
}

export async function getQuote(p: QuoteParams): Promise<Quote> {
  const sellToken = resolveToken(p.sellToken);
  const buyToken = resolveToken(p.buyToken);
  const f = p.fetchImpl ?? fetch;
  const errors: string[] = [];
  // KyberSwap only: its router is pinned and its calldata is decoded and checked.
  for (const prov of p.providers ?? ['kyberswap']) {
    try {
      if (prov === 'kyberswap') {
        // Aerodrome only, no fallback: a route through any other venue would not count as a club buy
        return await kyberQuote(sellToken, buyToken, p.sellAmount, p.taker, f, aerodromeSources(p.sources));
      }
      // any other provider is ignored: a quote that buildSwap would refuse is never returned
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  throw new Error(`no quote: ${errors.join(' | ')}`);
}

export interface DecodedKyberSwap {
  callTarget: Address;
  approveTarget: Address;
  srcToken: Address;
  dstToken: Address;
  srcReceivers: Address[];
  srcAmounts: bigint[];
  feeReceivers: Address[];
  dstReceiver: Address;
  amount: bigint;
  minReturnAmount: bigint;
  flags: bigint;
}

/** Decode KyberSwap MetaAggregationRouterV2.swap calldata (suffix-tolerant). */
export function decodeKyberSwap(data: Hex): DecodedKyberSwap | null {
  try {
    const { functionName, args } = decodeFunctionData({ abi: kyberRouterAbi, data });
    if (functionName !== 'swap') return null;
    const e = args[0] as any;
    const d = e.desc;
    return {
      callTarget: getAddress(e.callTarget),
      approveTarget: getAddress(e.approveTarget),
      srcToken: getAddress(d.srcToken),
      dstToken: getAddress(d.dstToken),
      srcReceivers: (d.srcReceivers as string[]).map((a) => getAddress(a)),
      srcAmounts: [...(d.srcAmounts as bigint[])],
      feeReceivers: (d.feeReceivers as string[]).map((a) => getAddress(a)),
      dstReceiver: getAddress(d.dstReceiver),
      amount: d.amount,
      minReturnAmount: d.minReturnAmount,
      flags: d.flags,
    };
  } catch {
    return null;
  }
}

/** The router plus the pinned KyberSwap executors (and any extra ones passed in), lowercased. */
export function kyberRouterSide(extraExecutors: readonly string[] = []): Set<string> {
  return new Set([KYBER_ROUTER, ...KYBER_EXECUTORS, ...extraExecutors].map((a) => a.toLowerCase()));
}

/**
 * Build swap calldata whose enforced minimum is >= amountOutMin (our guard), recipient = taker.
 * KyberSwap takes slippage in integer bps relative to the quoted amountOut, so we floor the bps
 * that maps the quote onto the guard: router min = quoted*(1 - bps/1e4) >= amountOutMin.
 * `executors` adds to the pinned KYBER_EXECUTORS (e.g. an env list shared with the clubs engine).
 */
export async function buildSwap(
  quote: Quote,
  p: { amountOutMin: bigint; recipient?: Address; deadlineSec?: number; fetchImpl?: typeof fetch; executors?: readonly string[] },
): Promise<BuiltSwap> {
  const f = p.fetchImpl ?? fetch;
  // the clubs engine counts a buy only when the router's sender and dstReceiver are both the buyer
  if (p.recipient && p.recipient.toLowerCase() !== quote.taker.toLowerCase()) throw new Error('the stock must be delivered to the wallet that pays for it (recipient must be the taker)');
  const recipient = quote.taker;
  if (quote.amountOut < p.amountOutMin) throw new Error('quote is below the guard minimum');
  const bps = Number(((quote.amountOut - p.amountOutMin) * 10_000n) / quote.amountOut);
  if (quote.provider === 'kyberswap') {
    // re-check the route before building: a Quote object can be put together by anyone
    assertAerodromeRoute((quote.raw as any)?.route);
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
    const value = BigInt(j.data.transactionValue ?? 0);
    const dec = assertKyberSwap({ router: String(j.data.routerAddress ?? ''), data, value, quote, recipient, amountOutMin: p.amountOutMin, executors: p.executors });
    return { to: KYBER_ROUTER, data, value, amountOut: BigInt(j.data.amountOut), minReturnAmount: dec.minReturnAmount, dstReceiver: dec.dstReceiver, provider: 'kyberswap' };
  }
  // Fail closed: only KyberSwap calldata is decoded and checked, so nothing else is ever built.
  throw new Error(`swaps are only built through KyberSwap (got a ${quote.provider} quote)`);
}

/**
 * Every field of the router call is checked before it reaches a wallet. Throws unless the call goes to
 * the pinned KyberSwap router, decodes, spends exactly the quoted token and amount, buys the quoted
 * token, pays the taker and enforces at least the guard minimum; and unless the payment can only go
 * where the clubs engine (clubs/src/chain/swap.ts) looks for it: the executor (callTarget), any
 * approveTarget and every srcReceiver are the router or a pinned KyberSwap executor, the receivers
 * take the whole amount, and no fee is taken. Returns the decoded call.
 */
export function assertKyberSwap(c: {
  router: string;
  data: Hex;
  value: bigint;
  quote: Pick<Quote, 'sellToken' | 'buyToken' | 'sellAmount'> & { taker?: Address };
  recipient: Address;
  amountOutMin: bigint;
  /** Extra executors on top of KYBER_EXECUTORS. */
  executors?: readonly string[];
}): DecodedKyberSwap {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (!same(c.router, KYBER_ROUTER)) throw new Error(`KyberSwap returned an unexpected router ${c.router}`);
  const dec = decodeKyberSwap(c.data);
  if (!dec) throw new Error('KyberSwap calldata could not be decoded, so it cannot be checked');
  if (!same(dec.srcToken, c.quote.sellToken)) throw new Error('KyberSwap calldata spends a different token');
  if (!same(dec.dstToken, c.quote.buyToken)) throw new Error('KyberSwap calldata buys a different token');
  if (dec.amount !== c.quote.sellAmount) throw new Error('KyberSwap calldata spends a different amount');
  if (c.quote.taker && !same(c.recipient, c.quote.taker)) throw new Error('KyberSwap calldata must pay the taker');
  if (!same(dec.dstReceiver, c.recipient)) throw new Error('KyberSwap calldata pays a different receiver');
  if (dec.minReturnAmount < c.amountOutMin) throw new Error(`KyberSwap min ${dec.minReturnAmount} below guard ${c.amountOutMin}`);
  const native = isNative(c.quote.sellToken as Address);
  if (c.value !== (native ? c.quote.sellAmount : 0n)) throw new Error('KyberSwap transaction value does not match the amount paid');

  // where the money goes: only to the router side, which is all the clubs engine credits
  const side = kyberRouterSide(c.executors);
  if (!side.has(dec.callTarget.toLowerCase())) throw new Error(`KyberSwap calldata names an unknown executor ${dec.callTarget}`);
  if (!same(dec.approveTarget, ZERO_ADDRESS) && !side.has(dec.approveTarget.toLowerCase())) throw new Error(`KyberSwap calldata approves an unknown spender ${dec.approveTarget}`);
  if (dec.feeReceivers.length) throw new Error('KyberSwap calldata takes a fee, which the club would not count as paid toward the stock');
  if (dec.srcReceivers.length !== dec.srcAmounts.length) throw new Error('KyberSwap calldata payment receivers and amounts do not line up');
  const stranger = dec.srcReceivers.find((r) => !side.has(r.toLowerCase()));
  if (stranger) throw new Error(`KyberSwap calldata pays an unknown receiver ${stranger}`);
  if (!native) {
    if (!dec.srcReceivers.length) throw new Error('KyberSwap calldata names no payment receiver');
    const paid = dec.srcAmounts.reduce((a, b) => a + b, 0n);
    if (paid !== dec.amount) throw new Error(`KyberSwap calldata pays ${paid} to the router side, not the full ${dec.amount}`);
  }
  return dec;
}
