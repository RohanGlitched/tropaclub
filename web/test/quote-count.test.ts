// The buy sheet runs recordBuy's price rule on the quote, so nobody signs a buy their club would
// then refuse: within 10% of the mark in NYSE regular hours, 20% outside them.
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const NVDA = '0xb20000000000000000000078ee7ce2fe4908108c';

vi.mock('../lib/server/clubs', async () => {
  const { StaticPriceSource } = await import('@tropaclub/clubs');
  const prices = new StaticPriceSource({ [NVDA]: [[Date.parse('2026-11-20T21:00:00Z') / 1000, 131]] });
  return { getClubs: async () => ({ ctx: { prices } }) };
});

const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const SESSION = at('2026-11-24T15:00:00Z'); // Tue 10:00 ET
const SATURDAY = at('2026-11-28T15:00:00Z');
/** Raw tokens (1e8 per whole token) that $usd buys at a given price per token. */
const out = (usd: number, price: number) => BigInt(Math.round((usd / price) * 1e8));

describe('quote: would the club count this buy?', () => {
  let check: typeof import('../lib/server/buy').clubCountCheck;
  beforeAll(async () => {
    check = (await import('../lib/server/buy')).clubCountCheck;
  }, 60_000);

  it('passes a quote near the mark', async () => {
    expect(await check(NVDA, 10, [out(10, 133), out(10, 135)], SESSION)).toBeNull();
  });

  it('blocks a quote 15% off the mark in market hours, with the reason', async () => {
    const msg = await check(NVDA, 10, [out(10, 131 * 0.85)], SESSION);
    expect(msg).toBe("The pool price is 15% away from the market price right now, so this buy wouldn't count for your club. Try again in a few minutes.");
  });

  it('allows 15% at the weekend but blocks 25%', async () => {
    expect(await check(NVDA, 10, [out(10, 131 * 0.85)], SATURDAY)).toBeNull();
    expect(await check(NVDA, 10, [out(10, 131 * 0.75)], SATURDAY)).toBe("The pool price is 25% away from the market price right now, so this buy wouldn't count for your club. Try again during market hours.");
  });

  it('checks the minimum the router enforces too, and the stricter limit just before the open', async () => {
    // the quote is fine, but the guaranteed minimum would be 12% off in market hours
    expect(await check(NVDA, 10, [out(10, 131), out(10, 131 * 1.12)], SESSION)).toMatch(/12% away/);
    // 09:29 ET: 15% off passes now, but the open is a minute away, so it is blocked
    expect(await check(NVDA, 10, [out(10, 131 * 0.85)], at('2026-11-24T14:29:00Z'))).toMatch(/15% away/);
  });

  it('does not block when there is no mark: the buy is kept and checked later', async () => {
    expect(await check('0xb2000000000000000000001e800a7f5189430cd0', 10, [1n], SESSION)).toBeNull();
  });
});
