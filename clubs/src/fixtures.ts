/**
 * Fixtures (from GW1), results and tables. Pure functions.
 *
 * - Eligible: private and pick-up clubs with >= 3 members at scheduling time. Stock clubs never play
 *   fixtures; they are ranked in the Supporters table on participation and streaks only.
 * - Pairing: by size band, deterministic seeded shuffle (seed = gameweek id + band). An odd club out
 *   moves up to the next band; the last one left gets a bye.
 * - Result: higher median playing-member return wins. |diff| < 0.05 percentage points is a draw.
 *   Win 3, draw 1, loss 0, +1 bonus when >= 80% of members played. A club nobody played for scores
 *   null and loses to any club that has a score; two null clubs = void (0 points each).
 */
import type { ClubDoc, FixtureDoc, GwClubResultDoc } from './types';
import { seededShuffle } from './util';

export const DRAW_EPSILON_PCT = 0.05;
export const BONUS_PARTICIPATION_PCT = 80;
export const MIN_FIXTURE_MEMBERS = 3;
export const POINTS = { win: 3, draw: 1, loss: 0, bonus: 1 } as const;

export const SIZE_BANDS = [
  { id: '3-5', min: 3, max: 5 },
  { id: '6-10', min: 6, max: 10 },
  { id: '11-20', min: 11, max: 20 },
  { id: '21+', min: 21, max: Infinity },
] as const;

export function sizeBand(members: number): string | null {
  return SIZE_BANDS.find((b) => members >= b.min && members <= b.max)?.id ?? null;
}

export const fixtureId = (gw: string, home: string, away: string | null) => `${gw}__${home}__${away ?? 'bye'}`;

export function pairFixtures(gw: string, clubs: Pick<ClubDoc, 'id' | 'kind' | 'memberCount'>[]): FixtureDoc[] {
  const eligible = clubs
    .filter((c) => (c.kind === 'private' || c.kind === 'pickup') && c.memberCount >= MIN_FIXTURE_MEMBERS)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const out: FixtureDoc[] = [];
  let carry: (typeof eligible)[number] | null = null;
  for (const band of SIZE_BANDS) {
    const inBand = eligible.filter((c) => sizeBand(c.memberCount) === band.id);
    const pool = seededShuffle(inBand, `${gw}:${band.id}`);
    if (carry) pool.unshift(carry);
    carry = null;
    for (let i = 0; i + 1 < pool.length; i += 2) out.push(newFixture(gw, band.id, pool[i]!.id, pool[i + 1]!.id));
    if (pool.length % 2) carry = pool[pool.length - 1]!;
  }
  if (carry) out.push(newFixture(gw, sizeBand(carry.memberCount) ?? 'bye', carry.id, null));
  return out;
}

function newFixture(gw: string, band: string, home: string, away: string | null): FixtureDoc {
  return {
    id: fixtureId(gw, home, away),
    gw,
    band,
    home,
    away,
    homeScore: null,
    awayScore: null,
    result: away ? 'pending' : 'bye',
    homePoints: 0,
    awayPoints: 0,
    homeBonus: false,
    awayBonus: false,
    settled: false,
    settledAt: null,
  };
}

export function decide(home: number | null, away: number | null): 'home' | 'away' | 'draw' | 'void' {
  if (home == null && away == null) return 'void';
  if (home == null) return 'away';
  if (away == null) return 'home';
  const d = home - away;
  if (Math.abs(d) < DRAW_EPSILON_PCT) return 'draw';
  return d > 0 ? 'home' : 'away';
}

export function settleFixture(
  f: FixtureDoc,
  home: Pick<GwClubResultDoc, 'score' | 'participationPct'> | null,
  away: Pick<GwClubResultDoc, 'score' | 'participationPct'> | null,
  at: number,
): FixtureDoc {
  const hb = (home?.participationPct ?? 0) >= BONUS_PARTICIPATION_PCT;
  const ab = (away?.participationPct ?? 0) >= BONUS_PARTICIPATION_PCT;
  if (!f.away) {
    return { ...f, homeScore: home?.score ?? null, result: 'bye', homePoints: hb ? POINTS.bonus : 0, homeBonus: hb, settled: true, settledAt: at };
  }
  const r = decide(home?.score ?? null, away?.score ?? null);
  const base = (side: 'home' | 'away') => (r === 'draw' ? POINTS.draw : r === side ? POINTS.win : POINTS.loss);
  return {
    ...f,
    homeScore: home?.score ?? null,
    awayScore: away?.score ?? null,
    result: r,
    homePoints: base('home') + (hb ? POINTS.bonus : 0),
    awayPoints: base('away') + (ab ? POINTS.bonus : 0),
    homeBonus: hb,
    awayBonus: ab,
    settled: true,
    settledAt: at,
  };
}

export interface LeagueRow {
  clubId: string;
  name: string;
  crestSeed: string;
  kind: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  byes: number;
  bonus: number;
  points: number;
  /** Sum of own GW scores minus opponents' (percentage points). */
  diff: number;
  form: ('W' | 'D' | 'L' | 'B')[];
  position: number;
}

export function leagueTable(fixtures: FixtureDoc[], clubs: Map<string, Pick<ClubDoc, 'id' | 'name' | 'crestSeed' | 'kind'>>): LeagueRow[] {
  const rows = new Map<string, LeagueRow>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) {
      const c = clubs.get(id);
      r = { clubId: id, name: c?.name ?? id, crestSeed: c?.crestSeed ?? '', kind: c?.kind ?? 'private', played: 0, won: 0, drawn: 0, lost: 0, byes: 0, bonus: 0, points: 0, diff: 0, form: [], position: 0 };
      rows.set(id, r);
    }
    return r;
  };
  const settled = fixtures.filter((f) => f.settled).sort((a, b) => Number(a.gw.slice(2)) - Number(b.gw.slice(2)));
  for (const f of settled) {
    const h = row(f.home);
    if (!f.away) {
      h.byes++;
      h.points += f.homePoints;
      h.bonus += f.homeBonus ? 1 : 0;
      h.form.push('B');
      continue;
    }
    const a = row(f.away);
    for (const [me, side] of [
      [h, 'home'],
      [a, 'away'],
    ] as const) {
      me.played++;
      me.points += side === 'home' ? f.homePoints : f.awayPoints;
      me.bonus += (side === 'home' ? f.homeBonus : f.awayBonus) ? 1 : 0;
      const mine = side === 'home' ? f.homeScore : f.awayScore;
      const theirs = side === 'home' ? f.awayScore : f.homeScore;
      me.diff += (mine ?? 0) - (theirs ?? 0);
      if (f.result === 'draw' || f.result === 'void') {
        me.drawn += f.result === 'draw' ? 1 : 0;
        me.form.push(f.result === 'draw' ? 'D' : 'L');
        if (f.result === 'void') me.lost++;
      } else if (f.result === side) {
        me.won++;
        me.form.push('W');
      } else {
        me.lost++;
        me.form.push('L');
      }
    }
  }
  const out = [...rows.values()].sort((x, y) => y.points - x.points || y.diff - x.diff || y.won - x.won || (x.name < y.name ? -1 : 1));
  out.forEach((r, i) => {
    r.position = i + 1;
    r.diff = Math.round(r.diff * 1000) / 1000;
    r.form = r.form.slice(-5);
  });
  return out;
}

export interface PreseasonRow {
  clubId: string;
  name: string;
  crestSeed: string;
  score: number | null;
  played: number;
  members: number;
  participationPct: number;
  position: number;
}

/** GW0 (preseason) table: ranked on median return, then participation. Status only. */
export function preseasonTable(results: GwClubResultDoc[], clubs: Map<string, Pick<ClubDoc, 'name' | 'crestSeed' | 'kind'>>): PreseasonRow[] {
  const rows = results
    .filter((r) => r.kind !== 'stock' && r.members >= MIN_FIXTURE_MEMBERS)
    .map((r) => ({ clubId: r.clubId, name: clubs.get(r.clubId)?.name ?? r.clubId, crestSeed: clubs.get(r.clubId)?.crestSeed ?? '', score: r.score, played: r.played, members: r.members, participationPct: r.participationPct, position: 0 }));
  rows.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || b.participationPct - a.participationPct || (a.name < b.name ? -1 : 1));
  rows.forEach((r, i) => (r.position = i + 1));
  return rows;
}

export interface SupportersRow {
  clubId: string;
  name: string;
  crestSeed: string;
  stockSymbol: string | null;
  members: number;
  played: number;
  participationPct: number;
  activeStreaks: number;
  streakPct: number;
  position: number;
}

/** Stock clubs: participation first, then share of members on an active payday streak. No returns. */
export function supportersTable(results: GwClubResultDoc[], clubs: Map<string, Pick<ClubDoc, 'name' | 'crestSeed' | 'kind' | 'stockSymbol'>>): SupportersRow[] {
  const rows = results
    .filter((r) => r.kind === 'stock' && r.members > 0)
    .map((r) => ({
      clubId: r.clubId,
      name: clubs.get(r.clubId)?.name ?? r.clubId,
      crestSeed: clubs.get(r.clubId)?.crestSeed ?? '',
      stockSymbol: clubs.get(r.clubId)?.stockSymbol ?? null,
      members: r.members,
      played: r.played,
      participationPct: r.participationPct,
      activeStreaks: r.activeStreaks,
      streakPct: Math.round((r.activeStreaks / r.members) * 1000) / 10,
      position: 0,
    }));
  rows.sort((a, b) => b.participationPct - a.participationPct || b.streakPct - a.streakPct || b.members - a.members || (a.name < b.name ? -1 : 1));
  rows.forEach((r, i) => (r.position = i + 1));
  return rows;
}
