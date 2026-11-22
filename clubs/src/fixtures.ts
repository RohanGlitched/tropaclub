/**
 * Fixtures (from GW1), results and tables. Pure functions.
 *
 * - Eligible: private and pick-up clubs with >= 3 members at scheduling time. Stock clubs never play
 *   fixtures; they are ranked in the Supporters table on participation and streaks only.
 * - Pairing: by size band, deterministic seeded shuffle (seed = gameweek id + band). An odd club out
 *   moves up to the next band; the last one left gets a bye.
 * - Result: by turnout, never by returns. 3 points if more of your club played than theirs: the
 *   share of members with a verified buy of $5 or more that gameweek. Turnouts within 1 percentage
 *   point are level: the club with more members still holding at D+7 from the previous gameweek
 *   takes the 3 points, and if that is level too it is a draw, 1 point each. +1 bonus for a turnout
 *   of 80% or more. If nobody played for either club the fixture is void (0 points each).
 * - Returns decide no fixture and no table, anywhere.
 */
import type { ClubDoc, FixtureDoc, GwClubResultDoc } from './types';
import { seededShuffle } from './util';

/** Turnouts this close (percentage points) are level; the D+7 tie-break, then a draw. */
export const DRAW_EPSILON_PCT = 1;
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

/** One side of a fixture: its turnout and the D+7 tie-break count. */
export type FixtureSide = Pick<GwClubResultDoc, 'participationPct' | 'played'> & { heldD7Prev?: number };

export function decide(home: FixtureSide | null, away: FixtureSide | null): 'home' | 'away' | 'draw' | 'void' {
  const hp = home?.played ?? 0;
  const ap = away?.played ?? 0;
  if (hp === 0 && ap === 0) return 'void';
  const d = (home?.participationPct ?? 0) - (away?.participationPct ?? 0);
  if (Math.abs(d) > DRAW_EPSILON_PCT) return d > 0 ? 'home' : 'away';
  const t = (home?.heldD7Prev ?? 0) - (away?.heldD7Prev ?? 0);
  return t > 0 ? 'home' : t < 0 ? 'away' : 'draw';
}

export function settleFixture(
  f: FixtureDoc,
  home: FixtureSide | null,
  away: FixtureSide | null,
  at: number,
): FixtureDoc {
  const hb = (home?.participationPct ?? 0) >= BONUS_PARTICIPATION_PCT;
  const ab = (away?.participationPct ?? 0) >= BONUS_PARTICIPATION_PCT;
  if (!f.away) {
    return { ...f, homeScore: home?.participationPct ?? null, result: 'bye', homePoints: hb ? POINTS.bonus : 0, homeBonus: hb, settled: true, settledAt: at };
  }
  const r = decide(home, away);
  const base = (side: 'home' | 'away') => (r === 'draw' ? POINTS.draw : r === side ? POINTS.win : POINTS.loss);
  return {
    ...f,
    // the fixture's "score" is each club's turnout (percent of members who played)
    homeScore: home?.participationPct ?? null,
    awayScore: away?.participationPct ?? null,
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
  /** Sum of own turnouts minus opponents' (percentage points). */
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
  played: number;
  members: number;
  participationPct: number;
  position: number;
}

/** GW0 (preseason) table: ranked on turnout, then members who played, then name. Never on returns. */
export function preseasonTable(results: GwClubResultDoc[], clubs: Map<string, Pick<ClubDoc, 'name' | 'crestSeed' | 'kind'>>): PreseasonRow[] {
  const rows = results
    .filter((r) => r.kind !== 'stock' && r.members >= MIN_FIXTURE_MEMBERS)
    .map((r) => ({ clubId: r.clubId, name: clubs.get(r.clubId)?.name ?? r.clubId, crestSeed: clubs.get(r.clubId)?.crestSeed ?? '', played: r.played, members: r.members, participationPct: r.participationPct, position: 0 }));
  rows.sort((a, b) => b.participationPct - a.participationPct || b.played - a.played || (a.name < b.name ? -1 : 1));
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
