import { describe, expect, it } from 'vitest';
import { FifoBook, type Flow, tropaTwr, washBuys } from '../src/lots';
import { paydayStreak } from '../src/streaks';
import { DAY, HOUR } from '../src/util';

const T = 'tok';
const U = 'tok2';
const f = (t: number, dir: 'in' | 'out', raw: bigint, tropa = false, priceAtBuy?: number, token = T, txHash = `h${t}${dir}`): Flow => ({ t, token, dir, raw, tropa, txHash, logIndex: 0, priceAtBuy });

describe('FIFO book', () => {
  it('sells the outside (pre-Tropa) lot first', () => {
    const b = new FifoBook({ [T]: { raw: 100n, at: 0 } });
    b.apply(f(10, 'in', 50n, true, 1));
    b.apply(f(20, 'out', 120n));
    expect(b.totalRaw(T)).toBe(30n);
    expect(b.tropaRaw(T)).toBe(30n);
  });
  it('tracks unmatched outflows', () => {
    const b = new FifoBook();
    b.apply(f(1, 'out', 5n));
    expect(b.unmatchedOut.get(T)).toBe(5n);
  });
});

describe('time-weighted return of Tropa lots', () => {
  const prices = (series: Record<string, [number, number][]>) => async (token: string, t: number) => {
    let v: number | null = null;
    for (const [pt, p] of series[token] ?? []) if (pt <= t) v = p;
    return v;
  };

  it('one buy: return from fill price to the cut mark', async () => {
    const r = await tropaTwr({ flows: [f(100, 'in', 100_000_000n, true, 100)], start: 0, end: 1000, markAt: prices({ [T]: [[500, 110]] }) });
    expect(r.returnPct).toBeCloseTo(10, 8);
  });

  it('new money is not return: a second buy after a rise', async () => {
    // buy 1 token at 100; price 120 at t=200 when buying 1 more at 120; end 132 -> +20% then +10% = +32%
    const flows = [f(100, 'in', 100_000_000n, true, 100), f(200, 'in', 100_000_000n, true, 120)];
    const r = await tropaTwr({ flows, start: 0, end: 1000, markAt: prices({ [T]: [[100, 100], [200, 120], [900, 132]] }) });
    expect(r.returnPct).toBeCloseTo(32, 8);
    expect(r.subperiods).toBe(2);
  });

  it('two tokens, valued at their own marks; outside lots not scored', async () => {
    const flows = [f(100, 'in', 100_000_000n, true, 100, T, 'a'), f(150, 'in', 200_000_000n, true, 50, U, 'b'), f(160, 'in', 100_000_000n, false, undefined, T, 'c')];
    const r = await tropaTwr({ flows, start: 0, end: 1000, markAt: prices({ [T]: [[100, 100], [150, 100], [900, 90]], [U]: [[150, 50], [900, 60]] }) });
    // after both buys: 100 (T) + 100 (U) = 200 -> end 90 + 120 = 210 -> +5%
    expect(r.returnPct).toBeCloseTo(5, 8);
  });

  it('a sell inside the window splits the sub-period', async () => {
    const flows = [f(100, 'in', 200_000_000n, true, 100), f(300, 'out', 100_000_000n)];
    const r = await tropaTwr({ flows, start: 0, end: 1000, markAt: prices({ [T]: [[100, 100], [300, 110], [900, 99]] }) });
    // 200 -> 220 (+10%), then 110 -> 99 (-10%) => 0.99 - 1 = -1%
    expect(r.returnPct).toBeCloseTo(-1, 8);
  });

  it('lots held from the previous gameweek start at the previous cut mark', async () => {
    const flows = [f(100, 'in', 100_000_000n, true, 100), f(2000, 'in', 100_000_000n, true, 105)];
    const r = await tropaTwr({ flows, start: 1000, end: 3000, markAt: prices({ [T]: [[1000, 104], [2000, 105], [2900, 107.1]] }) });
    // 104 -> 105, then 210 -> 214.2: (105/104)*(214.2/210) - 1
    expect(r.returnPct).toBeCloseTo(((105 / 104) * (214.2 / 210) - 1) * 100, 8);
  });

  it('returns null when no Tropa lot was held', async () => {
    const r = await tropaTwr({ flows: [f(100, 'in', 5n, false)], start: 0, end: 1000, markAt: async () => 1 });
    expect(r.returnPct).toBeNull();
  });

  it('falls back to the last known price and flags the token stale', async () => {
    const r = await tropaTwr({ flows: [f(100, 'in', 100_000_000n, true, 100)], start: 0, end: 1000, markAt: async () => null });
    expect(r.returnPct).toBe(0);
    expect(r.staleTokens).toEqual([T]);
  });
});

describe('wash rule', () => {
  it('buy -> sell -> buy inside 24 h scores 0 for both buys', () => {
    const w = washBuys(
      [
        { txHash: 'b1', token: T, t: 0 },
        { txHash: 'b2', token: T, t: 10 * HOUR },
      ],
      [{ token: T, t: 5 * HOUR, txHash: 's1' }],
    );
    expect([...w].sort()).toEqual(['b1', 'b2']);
  });
  it('outside 24 h, other tokens, or no sell in between are not wash', () => {
    expect(washBuys([{ txHash: 'b1', token: T, t: 0 }, { txHash: 'b2', token: T, t: 25 * HOUR }], [{ token: T, t: HOUR }]).size).toBe(0);
    expect(washBuys([{ txHash: 'b1', token: T, t: 0 }, { txHash: 'b2', token: T, t: HOUR }], [{ token: U, t: 0.5 * HOUR }]).size).toBe(0);
    expect(washBuys([{ txHash: 'b1', token: T, t: 0 }, { txHash: 'b2', token: T, t: HOUR }], [{ token: T, t: 2 * HOUR }]).size).toBe(0);
  });
});

describe('payday streak (badge only)', () => {
  const d0 = Date.parse('2026-11-24T15:00:00Z') / 1000;
  it('is alive with one buy in every rolling 14 days', () => {
    const s = paydayStreak([d0, d0 + 13 * DAY, d0 + 26 * DAY], d0 + 30 * DAY);
    expect(s).toMatchObject({ alive: true, paydays: 3, since: d0, skipsUsed: [] });
    expect(s.badge).toBe('Payday streak · 3');
  });
  it('survives one missed fortnight with the monthly free skip', () => {
    const s = paydayStreak([d0, d0 + 20 * DAY], d0 + 22 * DAY);
    expect(s.alive).toBe(true);
    expect(s.paydays).toBe(2);
    expect(s.skipsUsed).toEqual(['2026-12']);
  });
  it('only one skip per month: a second miss in the same month breaks it', () => {
    const t = Date.parse('2027-01-01T12:00:00Z') / 1000;
    const s = paydayStreak([t, t + 15 * DAY, t + 30 * DAY], t + 31 * DAY);
    // first gap uses the January skip; the second gap's deadline is also in January -> run restarts
    expect(s.paydays).toBe(1);
    expect(s.since).toBe(t + 30 * DAY);
  });
  it('breaks after 28 days with no buy', () => {
    const s = paydayStreak([d0], d0 + 29 * DAY);
    expect(s.alive).toBe(false);
    expect(s.badge).toBeNull();
  });
  it('counts same-day buys once', () => {
    expect(paydayStreak([d0, d0 + 60, d0 + 120], d0 + DAY).paydays).toBe(1);
  });
});
