import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { shapeHistory, weekChange, cleanMovers, pickHomeNotable } = await import('../lib/server/data');

const days = ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'];
const AS_OF = '2026-11-22T09:53:45.000Z';

describe('attendance history shaping', () => {
  const series = {
    symbol: 'NVDAc',
    launchDay: '2026-11-12',
    realFans: [10, 12, 14, 20, 22, 25, 26, 28, 30, 31, 40],
    holdersTotal: [100, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200],
  };

  it('keeps missing days as gaps, never zeros', () => {
    const h = shapeHistory(series, days, ['2026-11-17'], AS_OF, true)!;
    expect(h.points).toHaveLength(11);
    expect(h.points[5]).toEqual({ day: '2026-11-17', real: null, holders: null });
    expect(h.gaps).toBe(1);
    expect(h.partial).toBe(true);
  });

  it('starts at the launch day and compares today with 7 days earlier', () => {
    const late = { symbol: 'ANTc', launchDay: '2026-11-19', realFans: [0, 0, 0, 0, 0, 0, 0, 99, 258, 308, 321], holdersTotal: [0, 0, 0, 0, 0, 0, 0, 369, 758, 910, 956] };
    const h = shapeHistory(late, days, [], AS_OF, true)!;
    expect(h.points.map((p) => p.day)).toEqual(['2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']);
    // before launch counts as zero: a signed gain, no % (nothing to divide by)
    expect(h.week).toEqual({ now: 321, then: 0, diff: 321, pct: null, thenDay: '2026-11-15' });
    const n = shapeHistory(series, days, [], AS_OF, true)!;
    expect(n.week).toEqual({ now: 40, then: 20, diff: 20, pct: 100, thenDay: '2026-11-15' });
  });

  it('returns null on bad data instead of throwing', () => {
    expect(shapeHistory(null, days, [], AS_OF, true)).toBeNull();
    expect(shapeHistory({ ...series, realFans: [1, 2] }, days, [], AS_OF, true)).toBeNull();
    expect(shapeHistory(series, ['yesterday'], [], AS_OF, true)).toBeNull();
    expect(shapeHistory({ ...series, realFans: series.realFans.map(() => 0) }, days, [], AS_OF, true)).toBeNull();
    // junk values become gaps; real fans can never exceed holders
    const h = shapeHistory({ ...series, realFans: [10, 'x', -3, 999, ...series.realFans.slice(4)] }, days, [], AS_OF, true)!;
    expect(h.points.slice(0, 4).map((p) => p.real)).toEqual([10, null, null, 130]);
  });

  it('gives no week change when either end has no count', () => {
    const pts = days.map((day, i) => ({ day, real: i === 3 ? null : i, holders: 10 }));
    expect(weekChange(pts)).toBeNull();
    expect(weekChange(pts.slice(0, 5))).toBeNull();
  });
});

describe('movers', () => {
  const row = (symbol: string, then: number, now: number, extra: Record<string, unknown> = {}) => ({
    symbol, name: `${symbol} Inc.`, realFansNow: now, realFansThen: then, change: now - then, changePct: then ? ((now - then) / then) * 100 : null, newRealFans: now - then + 5, holdersNow: now * 10, attendancePctNow: 10, ...extra,
  });
  const file = {
    asOf: AS_OF,
    block: 1,
    windows: [
      {
        window: '7d', from: '2026-11-15T09:00:00.000Z', to: AS_OF, hours: 168.9, baselineBlock: 1, pctMinBase: 10,
        byChange: [row('ANTc', 0, 321)],
        byChangePct: [row('TTWOc', 30, 96), row('TINYc', 2, 50), row('NULLc', 0, 9)],
        byNewRealFans: [row('NVDAc', 1433, 1645), { symbol: 42 }, row('ZEROc', 5, 5, { newRealFans: 0 })],
        totals: { realFansNow: 8746 },
      },
      { window: '30d', from: 'x', to: 'y' },
    ],
    notable: [
      { key: 'total-7d', window: '7d', value: 671, text: 'Across all 90 grounds there are 8,746 real holder seats, up 671 in the last 7 days.' },
      { key: 'new-wallets-7d', window: '7d', value: 1770, text: '1,770 wallets received their first stock token in the last 7 days and still hold it.' },
      { key: 'bad', window: 'year', value: 1, text: 'nope' },
      { key: 'empty', window: '7d', value: 1, text: '  ' },
    ],
  };

  it('keeps only valid windows, rows and lines, and enforces the % baseline', () => {
    const m = cleanMovers(file)!;
    expect(m.windows).toHaveLength(1);
    const w = m.windows[0];
    expect(w.byChangePct.map((r) => r.symbol)).toEqual(['TTWOc']);
    expect(w.byNewRealFans.map((r) => r.symbol)).toEqual(['NVDAc']);
    expect(w.totals.realFansNow).toBe(8746);
    expect(w.totals.newWallets).toBe(0);
    expect(m.notable.map((n) => n.key)).toEqual(['total-7d', 'new-wallets-7d']);
  });

  it('picks the new-wallets line for the home page, then falls back', () => {
    expect(pickHomeNotable(cleanMovers(file))!.key).toBe('new-wallets-7d');
    expect(pickHomeNotable(cleanMovers({ ...file, notable: file.notable.slice(0, 1) }))!.key).toBe('total-7d');
    expect(pickHomeNotable(null)).toBeNull();
  });

  it('returns null for a missing or malformed file', () => {
    expect(cleanMovers(null)).toBeNull();
    expect(cleanMovers({ asOf: 'soon', windows: [] })).toBeNull();
    expect(cleanMovers({ asOf: AS_OF, windows: [], notable: [] })).toBeNull();
  });
});
