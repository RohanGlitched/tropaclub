import { describe, expect, it } from 'vitest';
import { KYBER_ROUTER, USDC } from '../../src/constants';
import { assertKyberSwap, buildSwap, type Quote } from '../../src/quote';

const TAKER = '0x000000000000000000000000000000000000dEaD' as const;
const NVDA = '0xb20000000000000000000078ee7ce2fE4908108C' as const;
const quote = { sellToken: USDC, buyToken: NVDA, sellAmount: 10_000_000n } as const;

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
    const q = { provider: 'kyberswap', ...quote, amountOut: 100n, router: KYBER_ROUTER, venues: [], raw: {}, taker: TAKER } as unknown as Quote;
    const reply = (data: unknown) => (async () => new Response(JSON.stringify({ code: 0, data }), { status: 200 })) as unknown as typeof fetch;
    await expect(buildSwap(q, { amountOutMin: 99n, fetchImpl: reply({ data: '0xdeadbeef', routerAddress: '0x2222222222222222222222222222222222222222', amountOut: '100' }) })).rejects.toThrow(/unexpected router/);
    await expect(buildSwap(q, { amountOutMin: 99n, fetchImpl: reply({ data: '0xdeadbeef', routerAddress: KYBER_ROUTER, amountOut: '100' }) })).rejects.toThrow(/could not be decoded/);
  });
});
