/**
 * Season 1 (the $TROPA airdrop qualifier): the season-level Caps and the numbers /season shows.
 *
 *   - Provisional wallets: a wallet first seen (first inbound value or transaction) less than 24 h
 *     before its first verified buy is held as provisional; its Caps are decided at the snapshot.
 *   - Founder Cap: 0.50 once per founder, for a private club where 2 or more members played in the
 *     same Season 1 gameweek. Members funded by the founder, sharing the founder's first funder, or
 *     sharing a first funder with each other count once.
 *   - Social quests: self-reported, one claim per wallet per quest, a handle bound to one wallet,
 *     given only once the wallet has a verified Season 1 buy (pending until then), at most 0.25 a
 *     season, removed by a void doc when a spot-check rejects the claim.
 *   - Stats: totals and the count of each exclusion reason (never addresses).
 *
 * Every award goes through the append-only Caps ledger (caps.ts), keyed once per wallet per season.
 */
import { CAPS_COL, capId, capSeason, capsTable, type CapDoc, type CapReason, type SocialReason } from './caps';
import { gameweekForBuy } from './calendar';
import type { ClubsContext } from './context';
import { loadLedger, type WalletLedger } from './ledger';
import { SCOUT_COL, funderOf, type ScoutCreditDoc } from './scouts';
import { SEASON1, SEASON_COL, seasonOfGw, type ProvisionalReason, type SeasonId, type SeasonWalletDoc } from './seasondefs';
import { AlreadyExistsError } from './store/docstore';
import { COL, type BuyDoc, type BuyRejectDoc, type BuyRejectReason, type ClubDoc, type ExclusionDoc, type MemberDoc } from './types';
import { ClubsError, normAddr } from './util';

export { SEASON1, SEASON_COL, seasonOfGw, type SeasonId, type SeasonWalletDoc, type ProvisionalReason } from './seasondefs';

const round2 = (n: number) => Math.round(n * 100) / 100;
const swId = (season: SeasonId, wallet: string) => `${season}__${wallet}`;

async function appendCap(ctx: ClubsContext, doc: CapDoc): Promise<boolean> {
  try {
    await ctx.store.create<CapDoc>(CAPS_COL, doc.id, doc);
    return true;
  } catch (e) {
    if (e instanceof AlreadyExistsError) return false;
    throw e;
  }
}

/** The Season 1 gameweek a time falls in, for founder and social docs (the first before it, the last after it). */
function s1GwAt(t: number): string {
  const g = gameweekForBuy(t)?.id;
  if (g && seasonOfGw(g) === 'S1') return g;
  return t < SEASON1.startAt ? SEASON1.gameweeks[0]! : SEASON1.gameweeks[SEASON1.gameweeks.length - 1]!;
}

// ------------------------------------------------------------------------------------------------
// Provisional (wallet age)

/**
 * Is this wallet held as provisional for Season 1? Decided once from its age: first seen less than
 * 24 h before its first verified buy (new_wallet), or nothing found to date it (age_unknown). A
 * check that cannot be made now (age_unchecked) holds it provisional and is retried on the next run.
 * A decision made at the snapshot (kept or dropped) is final.
 */
export async function provisionalOf(ctx: ClubsContext, wallet: string, firstBuyAt: number): Promise<boolean> {
  const w = normAddr(wallet);
  const id = swId('S1', w);
  const doc = await ctx.store.get<SeasonWalletDoc>(SEASON_COL.wallets, id);
  const now = ctx.now();
  const firstAt = doc?.firstBuyAt != null ? Math.min(doc.firstBuyAt, firstBuyAt) : firstBuyAt;
  if (doc?.decision) return doc.decision === 'dropped';
  const judge = (bornAt: number | null, older: boolean): { provisional: boolean; reason: ProvisionalReason | null } =>
    older ? { provisional: false, reason: null } : bornAt == null ? { provisional: true, reason: 'age_unknown' } : firstAt - bornAt < SEASON1.provisionalSec ? { provisional: true, reason: 'new_wallet' } : { provisional: false, reason: null };

  let next: SeasonWalletDoc;
  const base = { id, wallet: w, season: 'S1' as const, firstBuyAt: firstAt, decision: null, decidedAt: null, decisionNote: null, updatedAt: now };
  if (doc && doc.ageCheckedAt && doc.provisionalReason !== 'age_unchecked') {
    const j = judge(doc.bornAt, doc.olderThanWindow);
    if (doc.firstBuyAt === firstAt && doc.provisional === j.provisional) return j.provisional;
    next = { ...doc, firstBuyAt: firstAt, provisional: j.provisional, provisionalReason: j.reason, updatedAt: now };
  } else if (!ctx.funding?.firstSeen) {
    // no way to date wallets in this setup (tests, sample data): nobody is held
    next = { ...base, bornAt: null, olderThanWindow: true, ageCheckedAt: now, provisional: false, provisionalReason: null };
  } else {
    try {
      const age = await ctx.funding.firstSeen(w);
      const j = judge(age.at, age.olderThanWindow);
      next = { ...base, bornAt: age.at, olderThanWindow: age.olderThanWindow, ageCheckedAt: now, provisional: j.provisional, provisionalReason: j.reason };
    } catch {
      next = { ...base, bornAt: null, olderThanWindow: false, ageCheckedAt: null, provisional: true, provisionalReason: 'age_unchecked' };
    }
  }
  await ctx.store.set<SeasonWalletDoc>(SEASON_COL.wallets, id, next);
  return next.provisional;
}

/** Snapshot decision for a provisional wallet (server only, from the admin script). */
export async function decideProvisional(ctx: ClubsContext, wallet: string, decision: 'kept' | 'dropped', note?: string): Promise<void> {
  const w = normAddr(wallet);
  const id = swId('S1', w);
  const doc = await ctx.store.get<SeasonWalletDoc>(SEASON_COL.wallets, id);
  if (!doc) throw new ClubsError('not_found', 'That wallet has no Season 1 record.', 404);
  await ctx.store.update(SEASON_COL.wallets, id, { decision, decidedAt: ctx.now(), decisionNote: note ?? null, updatedAt: ctx.now() });
}

// ------------------------------------------------------------------------------------------------
// Founder Cap

/**
 * 0.50 once per founder, for a private club of theirs where 2 or more members played (a qualifying
 * verified buy) in the same Season 1 gameweek. A member funded by the founder or sharing the
 * founder's first funder is not counted, and members sharing a first funder count once. A funder
 * check that cannot be made now leaves the club for the next run. Idempotent.
 */
export async function awardFounderCaps(ctx: ClubsContext, ex: Set<string>, ledgers = new Map<string, WalletLedger>()): Promise<{ awarded: number; caps: number }> {
  const now = ctx.now();
  const gws = SEASON1.gameweeks.filter((g) => seasonOfGw(g) === 'S1');
  const clubs = (await ctx.store.query<ClubDoc>(COL.clubs, { where: [['kind', '==', 'private']] })).filter((c) => c.createdBy && !ex.has(c.createdBy));
  const byFounder = new Map<string, ClubDoc[]>();
  for (const c of clubs) (byFounder.get(c.createdBy!) ?? byFounder.set(c.createdBy!, []).get(c.createdBy!)!).push(c);
  const ledger = async (w: string) => ledgers.get(w) ?? ledgers.set(w, await loadLedger(ctx, w)).get(w)!;
  let awarded = 0;
  for (const [founder, mine] of [...byFounder].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const id = capId(founder, gws[0]!, 'founder', '');
    if (await ctx.store.get<CapDoc>(CAPS_COL, id)) continue;
    let fFounder: string | null;
    try {
      fFounder = await funderOf(ctx, founder);
    } catch {
      continue;
    }
    found: for (const club of mine.sort((a, b) => a.createdAt - b.createdAt)) {
      const members = (await ctx.store.query<MemberDoc>(COL.members, { where: [['clubId', '==', club.id]] })).filter((m) => !ex.has(m.wallet));
      for (const gw of gws) {
        const played: string[] = [];
        for (const m of members) if ((await ledger(m.wallet)).qualifying.some((b) => b.gw === gw)) played.push(m.wallet);
        if (played.length < 2) continue;
        const funders = new Set<string>();
        let count = 0;
        try {
          for (const w of played) {
            if (w === founder) {
              count++;
              if (fFounder) funders.add(fFounder);
              continue;
            }
            const f = await funderOf(ctx, w);
            if (f && (f === founder || f === fFounder || funders.has(f))) continue;
            if (f) funders.add(f);
            count++;
          }
        } catch {
          continue found; // cannot tell now: next run
        }
        if (count < 2) continue;
        const ok = await appendCap(ctx, { id, wallet: founder, gw, reason: 'founder', amount: SEASON1.founderCaps, sourceRef: club.id, at: now, season: 'S1' });
        if (ok) awarded++;
        break found;
      }
    }
  }
  return { awarded, caps: round2(awarded * SEASON1.founderCaps) };
}

// ------------------------------------------------------------------------------------------------
// Social quests

export type SocialQuest = 'follow' | 'like_repost' | 'post';
export const SOCIAL_QUESTS: Record<SocialQuest, { reason: SocialReason; caps: number }> = {
  follow: { reason: 'social:follow', caps: SEASON1.social.follow },
  like_repost: { reason: 'social:like_repost', caps: SEASON1.social.likeRepost },
  post: { reason: 'social:post', caps: SEASON1.social.post },
};
export const isSocialQuest = (q: unknown): q is SocialQuest => q === 'follow' || q === 'like_repost' || q === 'post';

export interface SocialProfileDoc {
  wallet: string;
  handle: string;
  setAt: number;
  /** Set by the first claim: the handle can no longer change. */
  locked: boolean;
}
export interface XHandleDoc {
  handle: string;
  wallet: string;
  at: number;
}
export type SocialClaimStatus = 'claimed' | 'verified' | 'rejected';
export interface SocialClaimDoc {
  id: string; // `${wallet}__${quest}`
  wallet: string;
  handle: string;
  quest: SocialQuest;
  season: SeasonId;
  claimedAt: number;
  /** The Season 1 post the like/repost was for. */
  postId: string | null;
  /** claimed (self-reported), verified or rejected (server-only spot-check override). */
  status: SocialClaimStatus;
  reviewedAt: number | null;
  reviewNote: string | null;
}

/** "@Name", "name", "x.com/name" or "https://twitter.com/name" -> "name"; null when not a valid handle. */
export function cleanHandle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  const m = s.match(/^(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/([^/?#\s]+)\/?(?:[?#].*)?$/i);
  if (m) s = m[1]!;
  s = s.replace(/^@/, '');
  return /^[A-Za-z0-9_]{1,15}$/.test(s) ? s.toLowerCase() : null;
}

function inSeason(ctx: ClubsContext): void {
  const now = ctx.now();
  if (now < SEASON1.startAt) throw new ClubsError('season_not_open', 'Social quests open with Season 1, on Tue Nov 24 at 14:30 UTC.', 409);
  if (now >= SEASON1.endAt) throw new ClubsError('season_over', 'Season 1 has ended: social quests are closed.', 409);
}

/** Link an X handle to a signed-in wallet. One handle per wallet, one wallet per handle, fixed after the first claim. */
export async function setXHandle(ctx: ClubsContext, wallet: string, raw: unknown): Promise<{ handle: string }> {
  const w = normAddr(wallet);
  const handle = cleanHandle(raw);
  if (!handle) throw new ClubsError('bad_handle', 'That isn’t an X handle: 1 to 15 letters, numbers or underscores.');
  const prof = await ctx.store.get<SocialProfileDoc>(SEASON_COL.profiles, w);
  if (prof?.handle === handle) return { handle };
  if (prof?.locked) throw new ClubsError('handle_locked', 'Your X handle can’t be changed after your first social claim.', 409);
  try {
    await ctx.store.create<XHandleDoc>(SEASON_COL.handles, handle, { handle, wallet: w, at: ctx.now() });
  } catch (e) {
    if (!(e instanceof AlreadyExistsError)) throw e;
    const owner = await ctx.store.get<XHandleDoc>(SEASON_COL.handles, handle);
    if (owner && owner.wallet !== w) throw new ClubsError('handle_taken', 'That X handle is already linked to another wallet.', 409);
  }
  if (prof?.handle) {
    const old = await ctx.store.get<XHandleDoc>(SEASON_COL.handles, prof.handle);
    if (old?.wallet === w) await ctx.store.delete(SEASON_COL.handles, prof.handle);
  }
  await ctx.store.set<SocialProfileDoc>(SEASON_COL.profiles, w, { wallet: w, handle, setAt: ctx.now(), locked: false });
  return { handle };
}

/** Record a self-reported quest. Once per wallet per quest; locks the handle. */
export async function claimSocial(ctx: ClubsContext, wallet: string, quest: SocialQuest, opts: { postId?: string | null } = {}): Promise<SocialClaimDoc> {
  const w = normAddr(wallet);
  if (!isSocialQuest(quest)) throw new ClubsError('bad_quest', 'Unknown quest.');
  inSeason(ctx);
  const prof = await ctx.store.get<SocialProfileDoc>(SEASON_COL.profiles, w);
  if (!prof?.handle) throw new ClubsError('no_handle', 'Add your X handle first.');
  const postId = quest === 'like_repost' ? (opts.postId ?? null) : null;
  if (quest === 'like_repost' && !postId) throw new ClubsError('no_post', 'The Season 1 post isn’t up yet. Check back soon.', 409);
  const id = `${w}__${quest}`;
  const doc: SocialClaimDoc = { id, wallet: w, handle: prof.handle, quest, season: 'S1', claimedAt: ctx.now(), postId, status: 'claimed', reviewedAt: null, reviewNote: null };
  try {
    await ctx.store.create<SocialClaimDoc>(SEASON_COL.social, id, doc);
  } catch (e) {
    if (!(e instanceof AlreadyExistsError)) throw e;
    return (await ctx.store.get<SocialClaimDoc>(SEASON_COL.social, id)) ?? doc;
  }
  if (!prof.locked) await ctx.store.update(SEASON_COL.profiles, w, { locked: true });
  return doc;
}

/** Server-only spot-check override: social:verified or social:rejected. A rejected claim's Caps are voided on the next award run. */
export async function reviewSocial(ctx: ClubsContext, wallet: string, quest: SocialQuest, status: 'verified' | 'rejected', note?: string): Promise<void> {
  const id = `${normAddr(wallet)}__${quest}`;
  if (!(await ctx.store.get<SocialClaimDoc>(SEASON_COL.social, id))) throw new ClubsError('not_found', 'No such claim.', 404);
  await ctx.store.update(SEASON_COL.social, id, { status, reviewedAt: ctx.now(), reviewNote: note ?? null });
}

/** Every claim, oldest first (the admin spot-check list). */
export async function listSocialClaims(ctx: ClubsContext, status?: SocialClaimStatus): Promise<SocialClaimDoc[]> {
  const all = await ctx.store.query<SocialClaimDoc>(SEASON_COL.social, status ? { where: [['status', '==', status]] } : undefined);
  return all.sort((a, b) => a.claimedAt - b.claimedAt);
}

const hasSeasonBuy = (l: WalletLedger) => l.qualifying.some((b) => !!b.gw && seasonOfGw(b.gw) === 'S1');

/**
 * Move social claims into the ledger for wallets with a verified Season 1 buy (pending until then),
 * at most 0.25 a season; void the Caps of a claim a spot-check rejected. Idempotent.
 */
export async function awardSocialCaps(ctx: ClubsContext, ex: Set<string>, ledgers = new Map<string, WalletLedger>()): Promise<{ awarded: number; voided: number }> {
  const claims = await listSocialClaims(ctx);
  const caps = (await ctx.store.query<CapDoc>(CAPS_COL)).filter((c) => c.reason.startsWith('social:'));
  const byId = new Map(caps.map((c) => [c.id, c]));
  const ledger = async (w: string) => ledgers.get(w) ?? ledgers.set(w, await loadLedger(ctx, w)).get(w)!;
  const gw = s1GwAt(ctx.now());
  let awarded = 0;
  let voided = 0;
  for (const c of claims) {
    const q = SOCIAL_QUESTS[c.quest];
    if (!q) continue;
    const id = capId(c.wallet, gw, q.reason, c.quest);
    const given = byId.get(id);
    if (c.status === 'rejected') {
      if (given && given.amount > 0 && !byId.has(`${id}__void`)) {
        const v: CapDoc = { id: `${id}__void`, wallet: c.wallet, gw: given.gw, reason: q.reason, amount: -given.amount, sourceRef: c.quest, at: ctx.now(), season: 'S1', voids: id };
        if (await appendCap(ctx, v)) (voided++, byId.set(v.id, v));
      }
      continue;
    }
    if (given || ex.has(c.wallet)) continue;
    if (!hasSeasonBuy(await ledger(c.wallet))) continue; // pending until the first verified Season 1 buy
    const used = [...byId.values()].filter((x) => x.wallet === c.wallet && capSeason(x) === 'S1').reduce((s, x) => s + x.amount, 0);
    const amount = round2(Math.min(q.caps, SEASON1.social.max - used));
    if (amount <= 0) continue;
    const doc: CapDoc = { id, wallet: c.wallet, gw, reason: q.reason, amount, sourceRef: c.quest, at: ctx.now(), season: 'S1' };
    if (await appendCap(ctx, doc)) (awarded++, byId.set(id, doc));
  }
  return { awarded, voided };
}

/** The founder and social awards, after the weekly ones (the scouts and settle jobs call this through the service). */
export async function awardSeasonCaps(ctx: ClubsContext): Promise<{ founder: number; social: number; voided: number }> {
  const ex = new Set((await ctx.store.query<ExclusionDoc>(COL.exclusions)).map((e) => e.wallet));
  const ledgers = new Map<string, WalletLedger>();
  const f = await awardFounderCaps(ctx, ex, ledgers);
  const s = await awardSocialCaps(ctx, ex, ledgers);
  return { founder: f.awarded, social: s.awarded, voided: s.voided };
}

// ------------------------------------------------------------------------------------------------
// What /season shows

export interface SocialState {
  handle: string | null;
  locked: boolean;
  quests: { quest: SocialQuest; caps: number; status: 'open' | 'pending' | 'counted' | 'removed'; claimedAt: number | null }[];
  /** Claimed, not yet in the ledger (no verified Season 1 buy yet), not removed. */
  pendingCaps: number;
  countedCaps: number;
}

/** A wallet's social quests. Never shown to anyone but the signed-in wallet (the handle is private). */
export async function socialOf(ctx: ClubsContext, wallet: string): Promise<SocialState> {
  const w = normAddr(wallet);
  const [prof, claims, caps] = await Promise.all([
    ctx.store.get<SocialProfileDoc>(SEASON_COL.profiles, w),
    ctx.store.query<SocialClaimDoc>(SEASON_COL.social, { where: [['wallet', '==', w]] }),
    ctx.store.query<CapDoc>(CAPS_COL, { where: [['wallet', '==', w]] }),
  ]);
  const social = caps.filter((c) => c.reason.startsWith('social:'));
  const net = (quest: SocialQuest) => round2(social.filter((c) => c.sourceRef === quest).reduce((s, c) => s + c.amount, 0));
  let pending = 0;
  const quests = (Object.keys(SOCIAL_QUESTS) as SocialQuest[]).map((quest) => {
    const c = claims.find((x) => x.quest === quest);
    const counted = net(quest);
    const status: SocialState['quests'][number]['status'] = !c ? 'open' : c.status === 'rejected' ? 'removed' : counted > 0 ? 'counted' : 'pending';
    if (status === 'pending') pending += SOCIAL_QUESTS[quest].caps;
    return { quest, caps: SOCIAL_QUESTS[quest].caps, status, claimedAt: c?.claimedAt ?? null };
  });
  const countedCaps = round2(social.reduce((s, c) => s + c.amount, 0));
  return { handle: prof?.handle ?? null, locked: !!prof?.locked, quests, pendingCaps: round2(Math.min(pending, Math.max(0, SEASON1.social.max - countedCaps))), countedCaps };
}

export interface SeasonStanding {
  wallet: string;
  /** Season 1 total in the ledger (social included). */
  caps: number;
  rank: number | null;
  of: number;
  breakdown: { played: number; held_d7: number; scout: number; founder: number; social: number };
  provisional: boolean;
  provisionalReason: ProvisionalReason | null;
  excluded: boolean;
  hasSeasonBuy: boolean;
}

/** One wallet's Season 1 total, rank and where its Caps came from. Public (no handle in it). */
export async function seasonStanding(ctx: ClubsContext, wallet: string): Promise<SeasonStanding> {
  const w = normAddr(wallet);
  const [table, caps, sw, exDoc, ledger] = await Promise.all([
    capsTable(ctx, { season: 'S1' }),
    ctx.store.query<CapDoc>(CAPS_COL, { where: [['wallet', '==', w]] }),
    ctx.store.get<SeasonWalletDoc>(SEASON_COL.wallets, swId('S1', w)),
    ctx.store.query<ExclusionDoc>(COL.exclusions, { where: [['wallet', '==', w]] }),
    loadLedger(ctx, w),
  ]);
  const breakdown = { played: 0, held_d7: 0, scout: 0, founder: 0, social: 0 };
  for (const c of caps) {
    if (capSeason(c) !== 'S1') continue;
    const k = (c.reason.startsWith('social:') ? 'social' : c.reason) as keyof typeof breakdown;
    breakdown[k] = round2(breakdown[k] + c.amount);
  }
  const row = table.find((r) => r.wallet === w);
  const excluded = exDoc.length > 0;
  return {
    wallet: w,
    caps: excluded ? 0 : round2(Object.values(breakdown).reduce((s, n) => s + n, 0)),
    rank: row?.rank ?? null,
    of: table.length,
    breakdown,
    provisional: !!sw?.provisional && sw.decision !== 'kept',
    provisionalReason: sw?.provisional ? sw.provisionalReason : null,
    excluded,
    hasSeasonBuy: hasSeasonBuy(ledger),
  };
}

export interface SeasonStats {
  season: SeasonId;
  startAt: number;
  endAt: number;
  capsIssued: number;
  wallets: number;
  provisionalWallets: number;
  provisionalCaps: number;
  founderCaps: number;
  socialCaps: number;
  socialPending: number;
  /** Counts only, never addresses. */
  excluded: { key: string; label: string; count: number }[];
  updatedAt: number;
}

const UNVERIFIED: ReadonlySet<BuyRejectReason> = new Set(['not_from_wallet', 'no_stock_received', 'not_router_swap', 'payment_mismatch', 'not_from_pool', 'price_off_mark']);
const NOT_OURS: ReadonlySet<BuyRejectReason> = new Set(['not_attributed', 'not_quoted']);

/** The public numbers of Season 1. */
export async function seasonStats(ctx: ClubsContext): Promise<SeasonStats> {
  const inWindow = (t: number) => t >= SEASON1.startAt && t < SEASON1.endAt + 14 * 86400;
  const [table, caps, exclusions, credits, rejects, buys, claims, sw] = await Promise.all([
    capsTable(ctx, { season: 'S1' }),
    ctx.store.query<CapDoc>(CAPS_COL),
    ctx.store.query<ExclusionDoc>(COL.exclusions),
    ctx.store.query<ScoutCreditDoc>(SCOUT_COL.credits),
    ctx.store.query<BuyRejectDoc>(COL.buyRejects),
    ctx.store.query<BuyDoc>(COL.buys),
    ctx.store.query<SocialClaimDoc>(SEASON_COL.social),
    ctx.store.query<SeasonWalletDoc>(SEASON_COL.wallets, { where: [['season', '==', 'S1']] }),
  ]);
  const ex = new Set(exclusions.map((e) => e.wallet));
  const s1 = caps.filter((c) => capSeason(c) === 'S1' && !ex.has(c.wallet));
  const sum = (xs: CapDoc[]) => round2(xs.reduce((s, c) => s + c.amount, 0));
  const inLedger = new Set(s1.filter((c) => c.reason.startsWith('social:') && c.amount > 0).map((c) => `${c.wallet}__${c.sourceRef}`));
  const prov = table.filter((r) => r.provisional);
  const r = rejects.filter((x) => inWindow(x.at));
  const count = (pred: (x: BuyRejectDoc) => boolean) => r.filter(pred).length;
  const excluded = [
    { key: 'team', label: 'Team, test and contest wallets', count: ex.size },
    { key: 'scout_funder', label: 'Friends not credited: funded by their scout, or sharing a first funder with the scout or another friend', count: credits.filter((c) => c.status === 'sybil').length },
    { key: 'unverified', label: 'Buys that did not verify', count: count((x) => UNVERIFIED.has(x.reason)) },
    { key: 'not_ours', label: 'Buys not made through Tropa Club', count: count((x) => NOT_OURS.has(x.reason)) },
    { key: 'region', label: 'Buys refused in blocked regions', count: count((x) => x.reason === 'region_blocked') },
    { key: 'wash', label: 'Buys in a wash pattern', count: buys.filter((b) => b.wash === true && inWindow(b.blockTime)).length },
    { key: 'social_removed', label: 'Social claims removed after a spot-check', count: claims.filter((c) => c.status === 'rejected').length },
    { key: 'provisional', label: 'New wallets held as provisional until the snapshot', count: prov.length },
    { key: 'dropped', label: 'Provisional wallets dropped at the snapshot', count: sw.filter((d) => d.decision === 'dropped').length },
  ];
  return {
    season: 'S1',
    startAt: SEASON1.startAt,
    endAt: SEASON1.endAt,
    capsIssued: round2(table.reduce((s, x) => s + x.caps, 0)),
    wallets: table.length,
    provisionalWallets: prov.length,
    provisionalCaps: round2(prov.reduce((s, x) => s + x.caps, 0)),
    founderCaps: s1.filter((c) => c.reason === 'founder').length,
    socialCaps: sum(s1.filter((c) => c.reason.startsWith('social:'))),
    socialPending: claims.filter((c) => c.status !== 'rejected' && !ex.has(c.wallet) && !inLedger.has(`${c.wallet}__${c.quest}`)).length,
    excluded,
    updatedAt: ctx.now(),
  };
}

/**
 * The allocation table as it stands (server only): each wallet's Season 1 Caps and whether it counts.
 * At the snapshot, provisional wallets are decided first; then share = caps / total of counting caps.
 */
export async function seasonAllocation(ctx: ClubsContext): Promise<{ wallet: string; caps: number; status: 'counts' | 'provisional'; share: number }[]> {
  const table = await capsTable(ctx, { season: 'S1' });
  const total = table.filter((r) => !r.provisional).reduce((s, r) => s + r.caps, 0);
  return table.map((r) => ({ wallet: r.wallet, caps: r.caps, status: r.provisional ? 'provisional' : 'counts', share: !r.provisional && total > 0 ? r.caps / total : 0 }));
}

export type { CapReason };
