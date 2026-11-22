import { describe, expect, it } from 'vitest';
import { encodeFunctionData, type Address, type Hex } from 'viem';
import { KYBER_EXECUTORS, KYBER_ROUTER, NATIVE_ETH, USDC, ZERO_ADDRESS, kyberRouterAbi } from '../../src/constants';
import { AERODROME_SOURCES, assertAerodromeRoute, assertKyberSwap, buildSwap, decodeKyberSwap, getQuote, type Quote } from '../../src/quote';
import { appendSuffix } from '../../src/suffix';

const TAKER = '0x000000000000000000000000000000000000dEaD' as const;
const NVDA = '0xb20000000000000000000078ee7ce2fE4908108C' as const;
const EXECUTOR = KYBER_EXECUTORS[0]!;
const STRANGER = '0x1111111111111111111111111111111111111111' as Address;
const POOL = '0x4444444444444444444444444444444444444444';
const quote = { sellToken: USDC, buyToken: NVDA, sellAmount: 10_000_000n, taker: TAKER } as const;

/** Real-shaped MetaAggregationRouterV2.swap calldata, as KyberSwap's /route/build returns it. */
function swapCalldata(o: Partial<{
  callTarget: Address; approveTarget: Address; srcToken: Address; dstToken: Address; srcReceivers: Address[]; srcAmounts: bigint[];
  feeReceivers: Address[]; feeAmounts: bigint[]; dstReceiver: Address; amount: bigint; minReturnAmount: bigint;
}> = {}): Hex {
  const amount = o.amount ?? 10_000_000n;
  return encodeFunctionData({
    abi: kyberRouterAbi,
    functionName: 'swap',
    args: [
      {
        callTarget: o.callTarget ?? EXECUTOR,
        approveTarget: o.approveTarget ?? ZERO_ADDRESS,
        targetData: '0x1234abcd',
        desc: {
          srcToken: o.srcToken ?? USDC,
          dstToken: o.dstToken ?? NVDA,
          srcReceivers: o.srcReceivers ?? [EXECUTOR],
          srcAmounts: o.srcAmounts ?? [amount],
          feeReceivers: o.feeReceivers ?? [],
          feeAmounts: o.feeAmounts ?? [],
          dstReceiver: o.dstReceiver ?? TAKER,
          amount,
          minReturnAmount: o.minReturnAmount ?? 99n,
          flags: 0n,
          permit: '0x',
        },
        clientData: '0x',
      },
    ],
  });
}
const check = (data: Hex, extra: Partial<Parameters<typeof assertKyberSwap>[0]> = {}) =>
  assertKyberSwap({ router: KYBER_ROUTER, data, value: 0n, quote, recipient: TAKER, amountOutMin: 99n, ...extra });

const aeroRoute = (exchanges: string[][] = [['aero-cl']]) => exchanges.map((hop) => hop.map((exchange) => ({ pool: POOL, tokenIn: USDC, tokenOut: NVDA, exchange })));
const routeSummary = (route = aeroRoute()) => ({ amountIn: '10000000', amountOut: '100', amountInUsd: '10', amountOutUsd: '10', gas: '200000', route });
const kyberQuote = (route = aeroRoute()): Quote => ({ provider: 'kyberswap', ...quote, amountOut: 100n, router: KYBER_ROUTER, venues: ['aero-cl'], raw: routeSummary(route), taker: TAKER });

/** A fetch stand-in that records URLs and answers routes / build. */
function kyberApi(routes: unknown, build?: unknown) {
  const urls: string[] = [];
  const f = (async (url: string) => {
    urls.push(String(url));
    const body = String(url).includes('/route/build') ? build : routes;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, urls };
}

describe('buildSwap fails closed', () => {
  it('rejects calldata it cannot decode', () => {
    expect(() => assertKyberSwap({ router: KYBER_ROUTER, data: '0xdeadbeef', value: 0n, quote, recipient: TAKER, amountOutMin: 1n })).toThrow(/could not be decoded/);
  });
  it('rejects any router but the pinned one, before looking at the calldata', () => {
    expect(() => assertKyberSwap({ router: '0x1111111111111111111111111111111111111111', data: '0xdeadbeef', value: 0n, quote, recipient: TAKER, amountOutMin: 1n })).toThrow(/unexpected router/);
  });
  it('does not build from a provider whose calldata is not checked', async () => {
    const q = { provider: 'lifi', ...quote, amountOut: 100n, router: KYBER_ROUTER, venues: [], raw: {}, taker: TAKER } as unknown as Quote;
    await expect(buildSwap(q, { amountOutMin: 99n })).rejects.toThrow(/only built through KyberSwap/);
  });
  it('rejects a build response that names another router or carries junk data', async () => {
    const q = kyberQuote();
    const reply = (data: unknown) => (async () => new Response(JSON.stringify({ code: 0, data }), { status: 200 })) as unknown as typeof fetch;
    await expect(buildSwap(q, { amountOutMin: 99n, fetchImpl: reply({ data: '0xdeadbeef', routerAddress: '0x2222222222222222222222222222222222222222', amountOut: '100' }) })).rejects.toThrow(/unexpected router/);
    await expect(buildSwap(q, { amountOutMin: 99n, fetchImpl: reply({ data: '0xdeadbeef', routerAddress: KYBER_ROUTER, amountOut: '100' }) })).rejects.toThrow(/could not be decoded/);
  });
});

describe('quotes are Aerodrome only', () => {
  it('asks KyberSwap for Aerodrome sources only and returns an all-Aerodrome route', async () => {
    const api = kyberApi({ code: 0, data: { routeSummary: routeSummary(aeroRoute([['aero-cl', 'aerodrome-cl-3']])), routerAddress: KYBER_ROUTER } });
    const q = await getQuote({ sellToken: 'USDC', buyToken: NVDA, sellAmount: 10_000_000n, taker: TAKER, fetchImpl: api.f });
    expect(q.venues).toEqual(['aero-cl', 'aerodrome-cl-3']);
    expect(api.urls).toHaveLength(1);
    expect(api.urls[0]).toContain(`includedSources=${AERODROME_SOURCES.join(',')}`);
  });

  it('no Aerodrome route: the quote fails, with no second "best route" request', async () => {
    const api = kyberApi({ code: 4008, message: 'route not found' });
    await expect(getQuote({ sellToken: 'USDC', buyToken: NVDA, sellAmount: 10_000_000n, taker: TAKER, fetchImpl: api.f })).rejects.toThrow(/no Aerodrome route/);
    expect(api.urls).toHaveLength(1);
    expect(api.urls[0]).toContain('includedSources=');
  });

  it('a route with any non-Aerodrome hop is refused', async () => {
    const api = kyberApi({ code: 0, data: { routeSummary: routeSummary(aeroRoute([['aero-cl'], ['aero-cl', 'uniswap-v3']])), routerAddress: KYBER_ROUTER } });
    await expect(getQuote({ sellToken: 'USDC', buyToken: NVDA, sellAmount: 10_000_000n, taker: TAKER, fetchImpl: api.f })).rejects.toThrow(/non-Aerodrome venues \(uniswap-v3\)/);
  });

  it('an empty route is refused', () => {
    expect(() => assertAerodromeRoute([])).toThrow(/no hops/);
    expect(() => assertAerodromeRoute([[]])).toThrow(/no hops/);
    expect(() => assertAerodromeRoute(undefined)).toThrow(/no hops/);
  });

  it('a quote naming another router is refused', async () => {
    const api = kyberApi({ code: 0, data: { routeSummary: routeSummary(), routerAddress: STRANGER } });
    await expect(getQuote({ sellToken: 'USDC', buyToken: NVDA, sellAmount: 10_000_000n, taker: TAKER, fetchImpl: api.f })).rejects.toThrow(/unexpected router/);
  });

  it('source lists outside Aerodrome (and the old "best") are refused before any request', async () => {
    for (const sources of [['uniswap-v3'], ['aero-cl', 'uniswap-v3'], 'best' as never, [] as string[]]) {
      const api = kyberApi({});
      await expect(getQuote({ sellToken: 'USDC', buyToken: NVDA, sellAmount: 10_000_000n, taker: TAKER, fetchImpl: api.f, sources })).rejects.toThrow(/Aerodrome/);
      expect(api.urls).toHaveLength(0);
    }
  });

  it('buildSwap re-checks the route of the quote it is given', async () => {
    const api = kyberApi({}, { code: 0, data: { data: swapCalldata(), routerAddress: KYBER_ROUTER, amountOut: '100' } });
    await expect(buildSwap(kyberQuote(aeroRoute([['uniswap-v3']])), { amountOutMin: 99n, fetchImpl: api.f })).rejects.toThrow(/non-Aerodrome/);
    expect(api.urls).toHaveLength(0);
  });
});

describe('swap calldata pays only the router side', () => {
  it('happy path: pinned executor, executor as the only payment receiver, taker gets the stock', () => {
    const dec = check(swapCalldata());
    expect(dec.callTarget.toLowerCase()).toBe(EXECUTOR);
    expect(dec.srcReceivers.map((a) => a.toLowerCase())).toEqual([EXECUTOR]);
    expect(dec.dstReceiver).toBe(TAKER);
  });

  it('happy path through buildSwap, with the suffix-tolerant decode', async () => {
    const data = swapCalldata();
    const api = kyberApi({}, { code: 0, data: { data, routerAddress: KYBER_ROUTER, amountOut: '100', transactionValue: '0' } });
    const built = await buildSwap(kyberQuote(), { amountOutMin: 99n, fetchImpl: api.f });
    expect(built).toMatchObject({ to: KYBER_ROUTER, data, value: 0n, minReturnAmount: 99n, dstReceiver: TAKER });
    expect(decodeKyberSwap(appendSuffix(data))?.callTarget.toLowerCase()).toBe(EXECUTOR);
  });

  it('the router itself as receiver is fine; native ETH needs value = amount', () => {
    expect(() => check(swapCalldata({ srcReceivers: [KYBER_ROUTER] }))).not.toThrow();
    const eth = { ...quote, sellToken: NATIVE_ETH, sellAmount: 4n * 10n ** 15n };
    const data = swapCalldata({ srcToken: NATIVE_ETH, amount: eth.sellAmount, srcReceivers: [EXECUTOR], srcAmounts: [eth.sellAmount] });
    expect(() => check(data, { quote: eth, value: eth.sellAmount })).not.toThrow();
    expect(() => check(data, { quote: eth, value: 0n })).toThrow(/transaction value/);
  });

  it('refuses an executor (callTarget) that is not pinned', () => {
    expect(() => check(swapCalldata({ callTarget: STRANGER }))).toThrow(/unknown executor/);
  });

  it('accepts an extra executor passed by the caller (env list), for callTarget and receivers', () => {
    const data = swapCalldata({ callTarget: STRANGER, srcReceivers: [STRANGER] });
    expect(() => check(data, { executors: [STRANGER.toLowerCase()] })).not.toThrow();
  });

  it('refuses a payment receiver (srcReceivers) outside the router side', () => {
    expect(() => check(swapCalldata({ srcReceivers: [STRANGER] }))).toThrow(/unknown receiver/);
    expect(() => check(swapCalldata({ srcReceivers: [EXECUTOR, STRANGER], srcAmounts: [5_000_000n, 5_000_000n] }))).toThrow(/unknown receiver/);
  });

  it('refuses a payment that does not send the whole amount to the router side', () => {
    expect(() => check(swapCalldata({ srcAmounts: [9_000_000n] }))).toThrow(/not the full/);
    expect(() => check(swapCalldata({ srcReceivers: [], srcAmounts: [] }))).toThrow(/no payment receiver/);
    expect(() => check(swapCalldata({ srcReceivers: [EXECUTOR], srcAmounts: [] }))).toThrow(/do not line up/);
  });

  it('refuses a fee or an unknown approveTarget', () => {
    expect(() => check(swapCalldata({ feeReceivers: [STRANGER], feeAmounts: [1n] }))).toThrow(/takes a fee/);
    expect(() => check(swapCalldata({ approveTarget: STRANGER }))).toThrow(/unknown spender/);
  });

  it('refuses a dstReceiver other than the taker', () => {
    expect(() => check(swapCalldata({ dstReceiver: STRANGER }))).toThrow(/different receiver/);
    // naming someone else as recipient does not get around it
    expect(() => check(swapCalldata({ dstReceiver: STRANGER }), { recipient: STRANGER })).toThrow(/must pay the taker/);
  });

  it('buildSwap refuses a recipient other than the taker before asking KyberSwap', async () => {
    const api = kyberApi({}, {});
    await expect(buildSwap(kyberQuote(), { amountOutMin: 99n, recipient: STRANGER, fetchImpl: api.f })).rejects.toThrow(/recipient must be the taker/);
    expect(api.urls).toHaveLength(0);
  });

  it('refuses srcToken / dstToken / amount that differ from the quote', () => {
    expect(() => check(swapCalldata({ srcToken: NATIVE_ETH }))).toThrow(/spends a different token/);
    expect(() => check(swapCalldata({ dstToken: '0xb2000000000000000000001e800a7f5189430cD0' }))).toThrow(/buys a different token/);
    expect(() => check(swapCalldata({ amount: 9n, srcAmounts: [9n] }))).toThrow(/different amount/);
  });

  it('refuses a minimum below the guard', () => {
    expect(() => check(swapCalldata({ minReturnAmount: 98n }))).toThrow(/below guard/);
  });

  it('buildSwap refuses a build response whose calldata pays a stranger', async () => {
    const api = kyberApi({}, { code: 0, data: { data: swapCalldata({ callTarget: STRANGER, srcReceivers: [STRANGER] }), routerAddress: KYBER_ROUTER, amountOut: '100' } });
    await expect(buildSwap(kyberQuote(), { amountOutMin: 99n, fetchImpl: api.f })).rejects.toThrow(/unknown executor/);
  });

  it('the executor list matches the one the clubs engine pins', () => {
    expect(KYBER_EXECUTORS).toEqual(['0x8f10b468b06c6fd214b65f87778827f7d113f996']);
  });
});
