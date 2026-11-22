/**
 * Caps: the season scoreboard (a football cap is an appearance). The copy shown wherever they
 * appear is rules.json caps.copy (CAPS_COPY).
 *
 * Earned only from verified on-chain actions (a buy that passed every check in buys.ts), at fixed
 * small values, with a hard cap per wallet per gameweek:
 *   1.00  played the gameweek (a qualifying verified buy of $5 or more in it)
 *   0.50  that gameweek's buy still held ($5 or more) at D+7
 *   0.25  per credited scout referral (scouts.ts), at most 4 a gameweek
 *   2.50  hard cap per wallet per gameweek
 * Season-level, outside the weekly cap (season.ts): 0.50 once for founding a club where 2 or more
 * members played in one gameweek, and the social quests (at most 0.25 a season, only for a wallet
 * with a verified buy in the season). Nothing for sign-ups or joins, nothing for history before launch.
 *
 * The ledger is append-only: one doc per award, keyed so an award job can run any number of times
 * and award each thing once. A removed award (a social claim that failed a spot-check) is a second,
 * negative doc that names the one it voids. Totals are sums of the ledger. Each doc carries its
 * season, so a season's allocation is the sum of its docs, less excluded wallets, with provisional
 * wallets (seasonWallets) decided at the snapshot.
 */
// the values live in web/lib/rules.json, which the site and the docs build read too
import rules from '../../web/lib/rules.json';
import { SEASON, gameweekById } from './calendar';
import type { ClubsContext } from './context';
import { loadLedger } from './ledger';
import { SCOUT_COL, type ScoutCreditDoc, holdsUsdAt } from './scouts';
import { AlreadyExistsError } from './store/docstore';
import { COL, type BuyDoc, type ExclusionDoc } from './types';
import { DAY, normAddr } from './util';
import { SEASON_COL, seasonOfGw, type SeasonId, type SeasonWalletDoc } from './seasondefs';

export const CAPS = {
  played: rules.caps.played,
  heldD7: rules.caps.heldD7,
  scout: rules.caps.scout,
  scoutPerGw: rules.caps.scoutPerGw,
  perGw: rules.caps.perGw,
} as const;
export const CAPS_COPY: string = rules.caps.copy;
export const CAPS_COL = 'caps';

export type SocialReason = 'social:follow' | 'social:like_repost' | 'social:post';
export type CapReason = 'played' | 'held_d7' | 'scout' | 'founder' | SocialReason;
/** The reasons that count toward the per-gameweek maximum. */
export const WEEKLY_REASONS: ReadonlySet<CapReason> = new Set<CapReason>(['played', 'held_d7', 'scout']);
export interface CapDoc {
  id: string;
  wallet: string;
  /** The gameweek it was earned in (for founder and social: the gameweek it was given in). */
  gw: string;
  reason: CapReason;
  /** Negative only on a void doc. */
  amount: number;
  /** The buy's tx hash, the referred wallet (scout), the club id (founder) or the quest (social). */
  sourceRef: string;
  at: number;
  /** The season it counts toward (older docs: derived from gw). */
  season?: SeasonId | null;
  /** The wallet was held as provisional when this was given (seasonWallets decides). */
  provisional?: boolean;
  /** On a void doc: the id of the award it removes. */
  voids?: string;
}

/** The season a ledger doc counts toward. */
export const capSeason = (c: Pick<CapDoc, 'season' | 'gw'>): SeasonId | null => c.season ?? seasonOfGw(c.gw);

/**
 * The ledger key. Played and held-at-D+7 are once per wallet per gameweek whatever buy earned them
 * (wallet__gw__reason); a scout cap is once per credited friend (…__friend).
 */
export const capId = (wallet: string, gw: string, reason: CapReason, sourceRef: string) =>
  reason === 'scout'
    ? `${wallet}__${gw}__${reason}__${sourceRef.toLowerCase()}`
    : WEEKLY_REASONS.has(reason)
      ? `${wallet}__${gw}__${reason}`
      : `${wallet}__${seasonOfGw(gw) ?? gw}__${reason}`; // founder and social: once a season
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Append one award, unless it is already there or the gameweek's cap is reached. Returns the amount added. */
async function award(ctx: ClubsContext, existing: CapDoc[], c: Omit<CapDoc, 'id' | 'at' | 'amount' | 'season'> & { amount: number }): Promise<number> {
  const id = capId(c.wallet, c.gw, c.reason, c.sourceRef);
  if (existing.some((e) => e.id === id)) return 0;
  const used = existing.filter((e) => e.gw === c.gw && WEEKLY_REASONS.has(e.reason)).reduce((s, e) => s + e.amount, 0);
  const amount = round2(Math.min(c.amount, CAPS.perGw - used));
  if (amount <= 0) return 0;
  const doc: CapDoc = { id, wallet: c.wallet, gw: c.gw, reason: c.reason, amount, sourceRef: c.sourceRef.toLowerCase(), at: ctx.now(), season: seasonOfGw(c.gw), ...(c.provisional ? { provisional: true } : {}) };
  try {
    await ctx.store.create<CapDoc>(CAPS_COL, id, doc);
  } catch (e) {
    if (e instanceof AlreadyExistsError) return 0;
    throw e;
  }
  existing.push(doc);
  return amount;
}

/**
 * Award every Cap earned so far in the season's gameweeks that have started: played (once its buy
 * is recorded), held at D+7 (once D+7 has passed), scout credits (once decided). Idempotent. The
 * settle job and the scouts job both call it.
 */
export async function awardCaps(
  ctx: ClubsContext,
  opts: { gws?: string[]; provisionalOf?: (wallet: string, firstBuyAt: number) => Promise<boolean> } = {},
): Promise<{ awarded: number; caps: number }> {
  const now = ctx.now();
  const gws = new Set(opts.gws ?? SEASON.filter((g) => g.buyFrom < now).map((g) => g.id));
  const ex = new Set((await ctx.store.query<ExclusionDoc>(COL.exclusions)).map((e) => e.wallet));
  const buys = (await ctx.store.query<BuyDoc>(COL.buys)).filter((b) => b.verified === true && b.gw && gws.has(b.gw) && !ex.has(b.wallet));
  const credits = (await ctx.store.query<ScoutCreditDoc>(SCOUT_COL.credits, { where: [['status', '==', 'credited']] })).filter((c) => gws.has(c.gw) && !ex.has(c.referrer));
  const wallets = [...new Set([...buys.map((b) => b.wallet), ...credits.map((c) => c.referrer)])].sort();
  let awarded = 0;
  let total = 0;
  for (const w of wallets) {
    const existing = await ctx.store.query<CapDoc>(CAPS_COL, { where: [['wallet', '==', w]] });
    const ledger = await loadLedger(ctx, w);
    // qualifying = verified, attributed, >= $5, not wash, not excluded (re-checked by the ledger)
    const q = ledger.qualifying.filter((b) => b.gw && gws.has(b.gw)).sort((a, b) => a.blockTime - b.blockTime);
    // a wallet created just before its first buy is held as provisional (season.ts), decided at the snapshot
    const provisional = q[0] && opts.provisionalOf ? await opts.provisionalOf(w, q[0].blockTime).catch(() => true) : false;
    for (const gw of [...gws].sort((a, b) => gameweekById(a).index - gameweekById(b).index)) {
      const first = q.find((b) => b.gw === gw);
      if (first) {
        const a1 = await award(ctx, existing, { wallet: w, gw, reason: 'played', sourceRef: first.txHash, amount: CAPS.played, provisional });
        if (a1) (awarded++, (total += a1));
        if (first.blockTime + 7 * DAY <= now && (await holdsUsdAt(ctx, w, first.token, first.blockTime + 7 * DAY, 5, first.priceAtBuy))) {
          const a2 = await award(ctx, existing, { wallet: w, gw, reason: 'held_d7', sourceRef: first.txHash, amount: CAPS.heldD7, provisional });
          if (a2) (awarded++, (total += a2));
        }
      }
      const mine = credits.filter((c) => c.referrer === w && c.gw === gw).sort((a, b) => a.decidedAt - b.decidedAt || (a.referred < b.referred ? -1 : 1));
      let scoutsThisGw = existing.filter((e) => e.gw === gw && e.reason === 'scout').length;
      for (const c of mine) {
        if (scoutsThisGw >= CAPS.scoutPerGw) break;
        const a3 = await award(ctx, existing, { wallet: w, gw, reason: 'scout', sourceRef: c.referred, amount: CAPS.scout, provisional });
        if (a3) {
          awarded++;
          total += a3;
          scoutsThisGw++;
        }
      }
    }
  }
  return { awarded, caps: round2(total) };
}

export interface CapsRow {
  wallet: string;
  /** Season total, social Caps included. */
  caps: number;
  /** The social part of it. */
  social: number;
  /** Held as provisional until the snapshot (a new wallet, or its age could not be checked yet). */
  provisional: boolean;
  rank: number;
  firstBuyAt: number | null;
}

/** The season table (Season 1 unless named): total Caps, ties broken by the earliest first verified buy. */
export async function capsTable(ctx: ClubsContext, opts: { season?: SeasonId } = {}): Promise<CapsRow[]> {
  const season = opts.season ?? 'S1';
  const [caps, buys, exclusions, sw] = await Promise.all([
    ctx.store.query<CapDoc>(CAPS_COL),
    ctx.store.query<BuyDoc>(COL.buys),
    ctx.store.query<ExclusionDoc>(COL.exclusions),
    ctx.store.query<SeasonWalletDoc>(SEASON_COL.wallets, { where: [['season', '==', season]] }),
  ]);
  const ex = new Set(exclusions.map((e) => e.wallet));
  const totals = new Map<string, number>();
  const social = new Map<string, number>();
  for (const c of caps) {
    if (ex.has(c.wallet) || capSeason(c) !== season) continue;
    totals.set(c.wallet, round2((totals.get(c.wallet) ?? 0) + c.amount));
    if (c.reason.startsWith('social:')) social.set(c.wallet, round2((social.get(c.wallet) ?? 0) + c.amount));
  }
  const prov = new Set(sw.filter((d) => d.provisional && d.decision !== 'kept').map((d) => d.wallet));
  const first = new Map<string, number>();
  for (const b of buys) if (b.verified === true && (!first.has(b.wallet) || b.blockTime < first.get(b.wallet)!)) first.set(b.wallet, b.blockTime);
  const rows = [...totals]
    .filter(([, n]) => n > 0)
    .map(([wallet, n]) => ({ wallet, caps: n, social: social.get(wallet) ?? 0, provisional: prov.has(wallet), firstBuyAt: first.get(wallet) ?? null }))
    .sort((a, b) => b.caps - a.caps || (a.firstBuyAt ?? Infinity) - (b.firstBuyAt ?? Infinity) || (a.wallet < b.wallet ? -1 : 1));
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

/** One wallet's total and rank, or null when it has no Caps yet. */
export async function capsOf(ctx: ClubsContext, wallet: string): Promise<{ caps: number; rank: number; of: number } | null> {
  const w = normAddr(wallet);
  const table = await capsTable(ctx);
  const row = table.find((r) => r.wallet === w);
  return row ? { caps: row.caps, rank: row.rank, of: table.length } : null;
}
