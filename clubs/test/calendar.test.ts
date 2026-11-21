import { describe, expect, it } from 'vitest';
import {
  LAUNCH_AT,
  SEASON,
  closeOf,
  etToUtc,
  gameweekById,
  gameweekForBuy,
  isTradingDay,
  lastSettledGameweek,
  latestMatchdayCut,
  matchdayOf,
  nextCut,
} from '../src/calendar';

const utc = (s: string) => Date.parse(s) / 1000;

describe('NYSE season calendar', () => {
  it('has GW0 (preseason) Nov 24-27 and GW1 Nov 30 - Dec 4', () => {
    const g0 = gameweekById('GW0');
    expect(g0.preseason).toBe(true);
    expect(g0.tradingDays.map((d) => d.date)).toEqual(['2026-11-24', '2026-11-25', '2026-11-27']);
    expect(g0.buyFrom).toBe(utc('2026-11-24T05:00:00Z')); // Tue 00:00 ET launch
    expect(g0.cutAt).toBe(utc('2026-11-27T18:00:00Z')); // Fri half day, 13:00 ET
    const g1 = gameweekById('GW1');
    expect(g1.preseason).toBe(false);
    expect(g1.tradingDays.map((d) => d.date)).toEqual(['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04']);
    expect(g1.openAt).toBe(utc('2026-11-30T14:30:00Z'));
    expect(g1.cutAt).toBe(utc('2026-12-04T21:00:00Z'));
    expect(g1.buyFrom).toBe(g0.cutAt);
    expect(g1.label).toBe('GW1 · Nov 30 – Dec 4');
  });

  it('closes Thanksgiving, Christmas, New Year and MLK day; half days close 13:00 ET', () => {
    expect(isTradingDay('2026-11-26')).toBe(false);
    expect(isTradingDay('2026-12-25')).toBe(false);
    expect(isTradingDay('2027-01-01')).toBe(false);
    expect(isTradingDay('2027-01-18')).toBe(false);
    expect(isTradingDay('2026-11-28')).toBe(false); // Saturday
    expect(closeOf('2026-12-24')).toBe(utc('2026-12-24T18:00:00Z'));
    expect(closeOf('2026-12-23')).toBe(utc('2026-12-23T21:00:00Z'));
    expect(() => closeOf('2026-11-26')).toThrow();
  });

  it('builds ten gameweeks through Jan 29 2027 with holiday-shortened weeks', () => {
    expect(SEASON.map((g) => g.id)).toEqual(['GW0', 'GW1', 'GW2', 'GW3', 'GW4', 'GW5', 'GW6', 'GW7', 'GW8', 'GW9']);
    const g4 = gameweekById('GW4');
    expect(g4.tradingDays.map((d) => d.date)).toEqual(['2026-12-21', '2026-12-22', '2026-12-23', '2026-12-24']);
    expect(g4.cutAt).toBe(utc('2026-12-24T18:00:00Z'));
    const g5 = gameweekById('GW5');
    expect(g5.tradingDays.at(-1)!.date).toBe('2026-12-31');
    expect(g5.cutAt).toBe(utc('2026-12-31T21:00:00Z'));
    expect(gameweekById('GW8').tradingDays[0]!.date).toBe('2027-01-19');
    // windows are contiguous
    for (let i = 1; i < SEASON.length; i++) expect(SEASON[i]!.buyFrom).toBe(SEASON[i - 1]!.cutAt);
  });

  it('assigns buys to the gameweek window (weekend buys count for the next gameweek)', () => {
    expect(gameweekForBuy(LAUNCH_AT - 1)).toBeNull();
    expect(gameweekForBuy(LAUNCH_AT + 60)!.id).toBe('GW0');
    expect(gameweekForBuy(utc('2026-11-27T18:00:00Z'))!.id).toBe('GW0'); // exactly at the cut
    expect(gameweekForBuy(utc('2026-11-27T18:00:01Z'))!.id).toBe('GW1');
    expect(gameweekForBuy(utc('2026-11-29T12:00:00Z'))!.id).toBe('GW1'); // Sunday
    expect(gameweekForBuy(utc('2027-02-10T12:00:00Z'))).toBeNull();
  });

  it('finds matchday cuts and next close', () => {
    const g0 = gameweekById('GW0');
    expect(latestMatchdayCut(g0, utc('2026-11-24T20:59:00Z'))).toBeNull();
    expect(latestMatchdayCut(g0, utc('2026-11-24T21:00:00Z'))!.date).toBe('2026-11-24');
    expect(latestMatchdayCut(g0, utc('2026-11-26T15:00:00Z'))!.date).toBe('2026-11-25'); // Thanksgiving: no close
    expect(matchdayOf('2026-11-27').day.halfDay).toBe(true);
    expect(nextCut(utc('2026-11-25T22:00:00Z'))!.day.date).toBe('2026-11-27');
    expect(lastSettledGameweek(utc('2026-11-28T00:00:00Z'))!.id).toBe('GW0');
    expect(etToUtc('2026-11-24', 0, 0)).toBe(utc('2026-11-24T05:00:00Z'));
    expect(etToUtc('2027-03-15', 16, 0)).toBe(utc('2027-03-15T20:00:00Z')); // DST
  });
});
