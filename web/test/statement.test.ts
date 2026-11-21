import { describe, expect, it } from 'vitest';
import { HISTORY_START_BLOCK, HistoryIncomplete, assertMatchesHoldings, historyFromBlock, openingBalances } from '../lib/statement-check';

// Regression: 0xfdcd…4689 is real fan 56 at NVDAc (about $24 held, first seen 24 Aug 2026), but
// its statement showed $0.00 everywhere and "no open lots". The block range was guessed at two
// seconds a block and started weeks after the wallet's buys.
const WALLET = '0xfdcd2ddee853c940a2ce2e082a05744619b24689';
const NVDA = '0xb20000000000000000000078ee7ce2fe4908108c';

describe('statement history range', () => {
  it('starts at the first stock-token block, whatever the wallet’s first-seen time', () => {
    expect(historyFromBlock()).toBe(HISTORY_START_BLOCK);
    // the old guess for this wallet: head 60,547,902 minus (1795299956 - 1787604181) / 2 seconds
    const oldGuess = 60_547_902n - BigInt(Math.ceil((1795299956 - 1787604181) / 2)) - 20_000n;
    // at the real pace (10.69 million blocks in 101 days) the wallet's first buy sits near block 51 million
    const firstBuyBlock = HISTORY_START_BLOCK + BigInt(Math.round(((1787604181 - 1786492800) / (1795299956 - 1786492800)) * Number(60_547_902n - HISTORY_START_BLOCK)));
    expect(oldGuess).toBeGreaterThan(firstBuyBlock); // the bug: the scan began after the buy
    expect(historyFromBlock()).toBeLessThanOrEqual(firstBuyBlock);
  });
});

describe('a statement must agree with the index', () => {
  const held = [{ token: NVDA, symbol: 'NVDAc', usd: 23.88 }];
  it('rejects the exact broken result: tokens held, no open lots', () => {
    expect(() => assertMatchesHoldings(held, [])).toThrow(HistoryIncomplete);
    expect(() => assertMatchesHoldings(held, [])).toThrow(/NVDAc/);
  });
  it('accepts a statement with an open lot of each held token, in any letter case', () => {
    expect(() => assertMatchesHoldings(held, [{ token: NVDA.toUpperCase().replace('0X', '0x') }])).not.toThrow();
  });
  it('ignores dust worth under a cent and wallets that hold nothing', () => {
    expect(() => assertMatchesHoldings([{ token: NVDA, symbol: 'NVDAc', usd: 0.004 }], [])).not.toThrow();
    expect(() => assertMatchesHoldings([], [])).not.toThrow();
  });
});

describe('opening lot when the oldest blocks cannot be read', () => {
  it('is today’s balance minus what came in since, plus what went out since', () => {
    // holds 18,204,497 raw now; since the readable start it bought 5,000,000 and sold 1,000,000
    const open = openingBalances(new Map([[NVDA, 18_204_497n]]), [
      { token: NVDA, dir: 'in', raw: 5_000_000n },
      { token: NVDA.toUpperCase().replace('0X', '0x'), dir: 'out', raw: 1_000_000n },
    ]);
    expect(open.get(NVDA)).toBe(14_204_497n);
  });
  it('the reported wallet: every buy is older than the readable window, so the whole balance is the opening lot', () => {
    expect(openingBalances(new Map([[NVDA, 18_204_497n]]), []).get(NVDA)).toBe(18_204_497n);
  });
  it('adds nothing when the read history explains the whole balance', () => {
    expect(openingBalances(new Map([[NVDA, 5_000_000n]]), [{ token: NVDA, dir: 'in', raw: 5_000_000n }]).size).toBe(0);
  });
});

// Live check against a running server:  STATEMENT_URL=http://localhost:3055 npx vitest run test/statement.test.ts
describe.skipIf(!process.env.STATEMENT_URL)('live: the reported wallet', () => {
  it.each([WALLET, process.env.STATEMENT_WALLET_2].filter(Boolean) as string[])('%s has an open NVDAc lot and a market value above zero', async (wallet) => {
    let j: { status: string; statement?: { lots: { symbol: string; marketValueUsd: number | null }[]; totals: { marketValueUsd: number } } } = { status: 'pending' };
    for (let i = 0; i < 90 && j.status === 'pending'; i++) j = await (await fetch(`${process.env.STATEMENT_URL}/api/statement/${wallet}`)).json();
    expect(j.status).toBe('ready');
    expect(j.statement!.lots.some((l) => l.symbol === 'NVDAc')).toBe(true);
    expect(j.statement!.totals.marketValueUsd).toBeGreaterThan(1);
  }, 480_000);
});
