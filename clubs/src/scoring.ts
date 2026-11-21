/**
 * Lineups, member and club gameweek scores, Matchday cards, fixtures settlement and tables.
 *
 * - A member PLAYS a gameweek only with a qualifying buy (>= $10) inside that gameweek's buy window.
 * - Member GW return = time-weighted % return of their Tropa lots over (GW buy window start, cut],
 *   FIFO, valued at the token mark (Chainlink round at the cut, else stored DEX marks).
 * - Club GW score = median playing-member return. Stock clubs get no score (Supporters table only).
 * Returns are status only: no prize ever depends on them.
 */
import { type Gameweek, SEASON, currentGameweek, gameweekById, latestMatchdayCut, lastSettledGameweek } from './calendar';
import { clubMembers, getClub, listClubs } from './clubs';
import { type ClubsContext, need } from './context';
import {
  BONUS_PARTICIPATION_PCT,
  type LeagueRow,
  type PreseasonRow,
  type SupportersRow,
  leagueTable,
  pairFixtures,
  preseasonTable,
  settleFixture,
  supportersTable,
} from './fixtures';
import { type WalletLedger, loadLedger } from './ledger';
import { tropaTwr } from './lots';
import { paydayStreak } from './streaks';
import { AlreadyExistsError, queryIn } from './store/docstore';
import { COL, type ClubDoc, type FixtureDoc, type GwClubResultDoc, type LineupEntry, type MemberDoc } from './types';
import { median, round, shortAddr } from './util';

export interface MemberGw {
  wallet: string;
  played: boolean;
  buysInGw: number;
  usdInGw: number;
  returnPct: number | null;
  staleTokens: string[];
}

export function playedIn(ledger: WalletLedger, gw: Gameweek, cut: number, token?: string | null) {
  return ledger.qualifying.filter((b) => b.blockTime > gw.buyFrom && b.blockTime <= cut && (!token || b.token === token));
}

export async function memberGameweek(ctx: ClubsContext, wallet: string, gw: Gameweek, cut = gw.cutAt, opts: { token?: string | null; withReturn?: boolean; ledger?: WalletLedger } = {}): Promise<MemberGw> {
  const ledger = opts.ledger ?? (await loadLedger(ctx, wallet));
  const buys = playedIn(ledger, gw, cut, opts.token);
  const played = buys.length > 0;
  let returnPct: number | null = null;
  let staleTokens: string[] = [];
  if (played && opts.withReturn !== false) {
    const prices = need(ctx.prices, 'price source');
    const r = await tropaTwr({
      flows: ledger.flows,
      prior: ledger.prior,
      start: gw.buyFrom,
      end: cut,
      markAt: async (token, t) => (await prices.markAt(token, t))?.usd ?? null,
    });
    returnPct = r.returnPct == null ? null : round(r.returnPct, 4);
    staleTokens = r.staleTokens;
  }
  return { wallet: ledger.wallet, played, buysInGw: buys.length, usdInGw: round(buys.reduce((s, b) => s + (b.usdIn ?? 0), 0), 2), returnPct, staleTokens };
}

/** Club result for a gameweek as of `cut` (a matchday close, or the GW cut for the final). */
export async function computeClubGameweek(ctx: ClubsContext, club: ClubDoc, gw: Gameweek, cut: number): Promise<GwClubResultDoc> {
  const members = (await clubMembers(ctx, club.id)).filter((m) => m.joinedAt <= cut);
  const lineup: (LineupEntry & { wallet: string })[] = [];
  let activeStreaks = 0;
  for (const m of members) {
    const ledger = await loadLedger(ctx, m.wallet);
    const token = club.kind === 'stock' ? club.stockToken : null;
    const mg = await memberGameweek(ctx, m.wallet, gw, cut, { token, withReturn: club.kind !== 'stock', ledger });
    const streak = paydayStreak(
      ledger.qualifying.filter((b) => !token || b.token === token).map((b) => b.blockTime),
      cut,
    );
    if (streak.alive) activeStreaks++;
    lineup.push({ wallet: m.wallet, who: shortAddr(m.wallet), nickname: m.nickname, seat: m.seat, played: mg.played, returnPct: mg.returnPct, streak: streak.paydays });
  }
  const playing = lineup.filter((l) => l.played);
  const returns = playing.map((l) => l.returnPct).filter((x): x is number => x != null);
  const score = club.kind === 'stock' ? null : median(returns);
  const participationPct = members.length ? round((playing.length / members.length) * 100, 1) : 0;
  const top = club.kind === 'stock' ? null : [...playing].filter((l) => l.returnPct != null).sort((a, b) => b.returnPct! - a.returnPct!)[0];
  lineup.sort((a, b) => Number(b.played) - Number(a.played) || (b.returnPct ?? -Infinity) - (a.returnPct ?? -Infinity) || (a.who < b.who ? -1 : 1));
  return {
    id: `${gw.id}__${club.id}`,
    gw: gw.id,
    clubId: club.id,
    kind: club.kind,
    members: members.length,
    played: playing.length,
    participationPct,
    score: score == null ? null : round(score, 4),
    bonus: participationPct >= BONUS_PARTICIPATION_PCT,
    topScorer: top ? { who: top.who, nickname: top.nickname, returnPct: top.returnPct! } : null,
    lineup: lineup.map(({ wallet: _w, ...rest }) => rest),
    activeStreaks,
    cutAt: cut,
    final: cut >= gw.cutAt,
    computedAt: ctx.now(),
  };
}

/** Cron after every matchday close: recompute and store every club's GW-to-date result. */
export async function refreshMatchday(ctx: ClubsContext, at = ctx.now()): Promise<{ gw: string; cut: number; clubs: number } | null> {
  let gw = currentGameweek(at);
  let day = gw ? latestMatchdayCut(gw, at) : null;
  if (!gw || !day) {
    // between the GW cut and the next buy window, or before the first close of this GW
    const last = lastSettledGameweek(at);
    if (!gw && last) {
      gw = last;
      day = last.tradingDays[last.tradingDays.length - 1]!;
    }
    if (!gw || !day) return null;
  }
  const clubs = await listClubs(ctx);
  for (const c of clubs) {
    const r = await computeClubGameweek(ctx, c, gw, day.closeAt);
    await ctx.store.set(COL.gwResults, r.id, r);
  }
  return { gw: gw.id, cut: day.closeAt, clubs: clubs.length };
}

/** Monday (or any time before the cut): pair this gameweek's fixtures. GW0 is preseason: no fixtures. */
export async function scheduleFixtures(ctx: ClubsContext, gwId: string): Promise<FixtureDoc[]> {
  const gw = gameweekById(gwId);
  if (gw.preseason) return [];
  const existing = await ctx.store.query<FixtureDoc>(COL.fixtures, { where: [['gw', '==', gwId]] });
  if (existing.length) return existing;
  const clubs = (await listClubs(ctx)).filter((c) => c.kind !== 'stock');
  const fx = pairFixtures(gwId, clubs);
  for (const f of fx) {
    try {
      await ctx.store.create(COL.fixtures, f.id, f);
    } catch (e) {
      if (!(e instanceof AlreadyExistsError)) throw e;
    }
  }
  return fx;
}

/** After the GW cut: final club results, fixture results, and the stored tables. Idempotent. */
export async function settleGameweek(ctx: ClubsContext, gwId: string): Promise<{ results: GwClubResultDoc[]; fixtures: FixtureDoc[] }> {
  const gw = gameweekById(gwId);
  if (ctx.now() < gw.cutAt) throw new Error(`${gwId} has not reached its cut yet`);
  const clubs = await listClubs(ctx);
  const results: GwClubResultDoc[] = [];
  for (const c of clubs) {
    const r = await computeClubGameweek(ctx, c, gw, gw.cutAt);
    await ctx.store.set(COL.gwResults, r.id, r);
    results.push(r);
  }
  const byClub = new Map(results.map((r) => [r.clubId, r]));
  const fixtures = await ctx.store.query<FixtureDoc>(COL.fixtures, { where: [['gw', '==', gwId]] });
  const settled: FixtureDoc[] = [];
  for (const f of fixtures) {
    const s = settleFixture(f, byClub.get(f.home) ?? null, f.away ? byClub.get(f.away) ?? null : null, ctx.now());
    await ctx.store.set(COL.fixtures, s.id, s);
    settled.push(s);
  }
  await writeTables(ctx, gwId);
  return { results, fixtures: settled };
}

async function clubMap(ctx: ClubsContext) {
  return new Map((await listClubs(ctx)).map((c) => [c.id, c]));
}

export async function writeTables(ctx: ClubsContext, gwId: string): Promise<void> {
  const clubs = await clubMap(ctx);
  const gw = gameweekById(gwId);
  const results = await ctx.store.query<GwClubResultDoc>(COL.gwResults, { where: [['gw', '==', gwId]] });
  if (gw.preseason) await ctx.store.set(COL.tables, `preseason-${gwId}`, { id: `preseason-${gwId}`, gw: gwId, rows: preseasonTable(results, clubs), updatedAt: ctx.now() });
  await ctx.store.set(COL.tables, `supporters-${gwId}`, { id: `supporters-${gwId}`, gw: gwId, rows: supportersTable(results, clubs), updatedAt: ctx.now() });
  const fixtures = await ctx.store.query<FixtureDoc>(COL.fixtures, { where: [['settled', '==', true]] });
  await ctx.store.set(COL.tables, 'league-S0', { id: 'league-S0', throughGw: gwId, rows: leagueTable(fixtures, clubs), updatedAt: ctx.now() });
}

export async function getLeagueTable(ctx: ClubsContext): Promise<{ throughGw: string | null; rows: LeagueRow[] }> {
  const t = await ctx.store.get<{ throughGw: string; rows: LeagueRow[] }>(COL.tables, 'league-S0');
  if (t) return t;
  const fixtures = await ctx.store.query<FixtureDoc>(COL.fixtures, { where: [['settled', '==', true]] });
  return { throughGw: null, rows: leagueTable(fixtures, await clubMap(ctx)) };
}

export async function getPreseasonTable(ctx: ClubsContext): Promise<PreseasonRow[]> {
  const results = await ctx.store.query<GwClubResultDoc>(COL.gwResults, { where: [['gw', '==', 'GW0']] });
  return preseasonTable(results, await clubMap(ctx));
}

/** Supporters table for stock clubs (participation + streaks only). Defaults to the current gameweek. */
export async function getSupportersTable(ctx: ClubsContext, gwId?: string): Promise<{ gw: string; rows: SupportersRow[] }> {
  const gw = gwId ?? currentGameweek(ctx.now())?.id ?? lastSettledGameweek(ctx.now())?.id ?? 'GW0';
  const results = await ctx.store.query<GwClubResultDoc>(COL.gwResults, { where: [['gw', '==', gw]] });
  return { gw, rows: supportersTable(results, await clubMap(ctx)) };
}

export interface MatchdayCard {
  club: Pick<ClubDoc, 'id' | 'name' | 'kind' | 'crestSeed' | 'regionLabel' | 'stockSymbol'>;
  gw: { id: string; label: string; preseason: boolean; cutAt: number };
  /** The close this card is cut at (null = live, before the gameweek's first close). */
  cut: { date: string; closeAt: number; halfDay: boolean } | null;
  final: boolean;
  members: number;
  played: number;
  benched: number;
  participationPct: number;
  bonus: boolean;
  score: number | null;
  topScorer: GwClubResultDoc['topScorer'];
  lineup: LineupEntry[];
  fixture: {
    opponent: Pick<ClubDoc, 'id' | 'name' | 'crestSeed'> | null;
    opponentScore: number | null;
    status: 'preseason' | 'bye' | 'leading' | 'trailing' | 'level' | 'won' | 'lost' | 'drawn' | 'none';
  };
  closesAt: number;
  labels: string[];
}

/** Matchday card for a club: lineup (played / benched), median, top scorer, fixture. */
export async function getMatchdayCard(ctx: ClubsContext, clubId: string, at = ctx.now(), opts: { live?: boolean } = {}): Promise<MatchdayCard> {
  const club = await getClub(ctx, clubId);
  if (!club) throw new Error('club not found');
  let gw = currentGameweek(at) ?? lastSettledGameweek(at) ?? SEASON[0]!;
  let day = latestMatchdayCut(gw, at);
  // Weekend after a cut (until the next Monday open): show the last gameweek's final whistle.
  const last = lastSettledGameweek(at);
  if (!day && last && last.id !== gw.id && at < gw.openAt) {
    gw = last;
    day = last.tradingDays[last.tradingDays.length - 1]!;
  }
  const cut = day?.closeAt ?? Math.min(at, gw.cutAt);
  const id = `${gw.id}__${club.id}`;
  let r = opts.live ? null : await ctx.store.get<GwClubResultDoc>(COL.gwResults, id);
  if (!r || r.cutAt !== cut) r = await computeClubGameweek(ctx, club, gw, cut);

  let fixture: MatchdayCard['fixture'] = { opponent: null, opponentScore: null, status: gw.preseason ? 'preseason' : 'none' };
  if (!gw.preseason && club.kind !== 'stock') {
    const fx = (await ctx.store.query<FixtureDoc>(COL.fixtures, { where: [['gw', '==', gw.id]] })).find((f) => f.home === club.id || f.away === club.id);
    if (fx) {
      const oppId = fx.home === club.id ? fx.away : fx.home;
      if (!oppId) fixture = { opponent: null, opponentScore: null, status: 'bye' };
      else {
        const opp = await getClub(ctx, oppId);
        let or = await ctx.store.get<GwClubResultDoc>(COL.gwResults, `${gw.id}__${oppId}`);
        if (opp && (!or || or.cutAt !== cut)) or = await computeClubGameweek(ctx, opp, gw, cut);
        const mine = r.score;
        const theirs = or?.score ?? null;
        const d = mine == null && theirs == null ? 0 : (mine ?? -Infinity) - (theirs ?? -Infinity);
        const final = cut >= gw.cutAt;
        const status = Math.abs(d) < 0.05 || (mine == null && theirs == null) ? (final ? 'drawn' : 'level') : d > 0 ? (final ? 'won' : 'leading') : final ? 'lost' : 'trailing';
        fixture = { opponent: opp ? { id: opp.id, name: opp.name, crestSeed: opp.crestSeed } : null, opponentScore: theirs, status };
      }
    }
  }
  return {
    club: { id: club.id, name: club.name, kind: club.kind, crestSeed: club.crestSeed, regionLabel: club.regionLabel, stockSymbol: club.stockSymbol },
    gw: { id: gw.id, label: gw.label, preseason: gw.preseason, cutAt: gw.cutAt },
    cut: day ? { date: day.date, closeAt: day.closeAt, halfDay: day.halfDay } : null,
    final: cut >= gw.cutAt,
    members: r.members,
    played: r.played,
    benched: r.members - r.played,
    participationPct: r.participationPct,
    bonus: r.bonus,
    score: r.score,
    topScorer: r.topScorer,
    lineup: r.lineup,
    fixture,
    closesAt: gw.tradingDays.find((d) => d.closeAt > at)?.closeAt ?? gw.cutAt,
    labels: ['Returns are status only · no prize depends on them', 'past performance · not advice'],
  };
}

/** Fixtures for a gameweek with club names (fixtures page). */
export async function getFixtures(ctx: ClubsContext, gwId: string) {
  const fx = await ctx.store.query<FixtureDoc>(COL.fixtures, { where: [['gw', '==', gwId]] });
  const ids = [...new Set(fx.flatMap((f) => [f.home, f.away].filter((x): x is string => !!x)))];
  const clubs = new Map((await queryIn<ClubDoc>(ctx.store, COL.clubs, 'id', ids)).map((c) => [c.id, c]));
  return fx
    .sort((a, b) => (a.band < b.band ? -1 : a.band > b.band ? 1 : a.id < b.id ? -1 : 1))
    .map((f) => ({ ...f, homeName: clubs.get(f.home)?.name ?? f.home, awayName: f.away ? clubs.get(f.away)?.name ?? f.away : null }));
}

export type { MemberDoc };
