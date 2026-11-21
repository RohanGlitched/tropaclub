import { describe, expect, it } from 'vitest';
import { decide, leagueTable, pairFixtures, preseasonTable, settleFixture, sizeBand, supportersTable } from '../src/fixtures';
import type { ClubDoc, GwClubResultDoc } from '../src/types';

const club = (id: string, memberCount: number, kind: ClubDoc['kind'] = 'private') => ({ id, kind, memberCount });
const res = (clubId: string, score: number | null, participationPct: number, kind: ClubDoc['kind'] = 'private', members = 5): GwClubResultDoc => ({
  id: `GW1__${clubId}`,
  gw: 'GW1',
  clubId,
  kind,
  members,
  played: Math.round((participationPct / 100) * members),
  participationPct,
  score,
  bonus: participationPct >= 80,
  topScorer: null,
  lineup: [],
  activeStreaks: 2,
  cutAt: 0,
  final: true,
  computedAt: 0,
});

describe('fixtures', () => {
  it('bands clubs by size', () => {
    expect([2, 3, 5, 6, 10, 11, 20, 21, 400].map(sizeBand)).toEqual([null, '3-5', '3-5', '6-10', '6-10', '11-20', '11-20', '21+', '21+']);
  });

  it('pairs private + pick-up clubs within bands, deterministically, skipping stock and small clubs', () => {
    const clubs = [club('a', 3), club('b', 4), club('c', 5, 'pickup'), club('d', 5), club('e', 7), club('f', 8), club('s', 900, 'stock'), club('tiny', 2)];
    const fx1 = pairFixtures('GW1', clubs);
    const fx2 = pairFixtures('GW1', [...clubs].reverse());
    expect(fx1).toEqual(fx2);
    const ids = fx1.flatMap((f) => [f.home, f.away]);
    expect(ids).not.toContain('s');
    expect(ids).not.toContain('tiny');
    expect(fx1).toHaveLength(3);
    expect(fx1.every((f) => f.away)).toBe(true);
    const small = new Set(['a', 'b', 'c', 'd']);
    for (const f of fx1) expect(small.has(f.home)).toBe(small.has(f.away!));
    // a different gameweek reshuffles
    const other = pairFixtures('GW2', clubs).map((f) => [f.home, f.away].sort().join('-')).sort();
    expect(other.length).toBe(3);
  });

  it('moves an odd club up to the next band and gives the last one a bye', () => {
    const fx = pairFixtures('GW1', [club('a', 3), club('b', 3), club('c', 3), club('d', 7), club('e', 30)]);
    expect(fx).toHaveLength(3);
    const bye = fx.filter((f) => !f.away);
    expect(bye).toHaveLength(1);
    expect(bye[0]!.result).toBe('bye');
  });

  it('decides win / draw (|diff| < 0.05 pp) / loss, and no-shows lose', () => {
    expect(decide(1.2, 1.16)).toBe('draw');
    expect(decide(1.2, 1.15)).toBe('home');
    expect(decide(-0.5, 0.1)).toBe('away');
    expect(decide(null, -3)).toBe('away');
    expect(decide(null, null)).toBe('void');
  });

  it('awards 3/1/0 plus a bonus point for >= 80% participation', () => {
    const [f] = pairFixtures('GW1', [club('a', 5), club('b', 5)]);
    const s = settleFixture(f!, res(f!.home, 2.0, 80), res(f!.away!, 1.0, 60), 1);
    expect(s).toMatchObject({ result: 'home', homePoints: 4, awayPoints: 0, homeBonus: true, awayBonus: false, settled: true });
    const d = settleFixture(f!, res(f!.home, 1.0, 100), res(f!.away!, 1.04, 100), 1);
    expect(d).toMatchObject({ result: 'draw', homePoints: 2, awayPoints: 2 });
  });

  it('ranks the league on points, then diff', () => {
    const clubs = new Map([
      ['a', { id: 'a', name: 'Alpha', crestSeed: 'x', kind: 'private' as const }],
      ['b', { id: 'b', name: 'Bravo', crestSeed: 'y', kind: 'private' as const }],
      ['c', { id: 'c', name: 'Charlie', crestSeed: 'z', kind: 'pickup' as const }],
      ['d', { id: 'd', name: 'Delta', crestSeed: 'w', kind: 'private' as const }],
    ]);
    const mk = (gw: string, h: string, a: string, hs: number, as: number, hp = 80, ap = 50) => {
      const [f] = pairFixtures(gw, [club(h, 5), club(a, 5)]);
      const home = f!.home === h ? res(h, hs, hp) : res(a, as, ap);
      const away = f!.home === h ? res(a, as, ap) : res(h, hs, hp);
      return settleFixture(f!, home, away, 1);
    };
    // a: W (+bonus) then L (+bonus) = 5 pts, diff +2; c: D (+bonus) then W = 5 pts, diff +0.98
    const t = leagueTable([mk('GW1', 'a', 'b', 4, 1), mk('GW1', 'c', 'd', 0.5, 0.52), mk('GW2', 'a', 'c', -1, 0), mk('GW2', 'b', 'd', 3, 1)], clubs);
    expect(t.map((r) => r.clubId)).toEqual(['a', 'c', 'b', 'd']);
    expect(t[0]).toMatchObject({ played: 2, won: 1, lost: 1, points: 5, bonus: 2 });
    expect(t[0]!.form).toEqual(['W', 'L']);
  });

  it('preseason table ranks GW0 clubs on median return; supporters table on participation + streaks only', () => {
    const clubs = new Map([
      ['a', { name: 'Alpha', crestSeed: '', kind: 'private' as const, stockSymbol: null }],
      ['b', { name: 'Bravo', crestSeed: '', kind: 'private' as const, stockSymbol: null }],
      ['n', { name: 'NVIDIA FC', crestSeed: '', kind: 'stock' as const, stockSymbol: 'NVDAc' }],
      ['t', { name: 'Tesla FC', crestSeed: '', kind: 'stock' as const, stockSymbol: 'TSLAc' }],
    ]);
    const p = preseasonTable([res('a', 1, 60), res('b', 2, 40), res('n', null, 90, 'stock', 100)], clubs);
    expect(p.map((r) => r.clubId)).toEqual(['b', 'a']);
    const s = supportersTable([res('n', null, 30, 'stock', 100), { ...res('t', null, 45, 'stock', 20), activeStreaks: 10 }, res('a', 9, 100)], clubs);
    expect(s.map((r) => r.clubId)).toEqual(['t', 'n']);
    expect(s[0]).toMatchObject({ streakPct: 50, position: 1 });
    expect(Object.keys(s[0]!)).not.toContain('score');
  });
});
