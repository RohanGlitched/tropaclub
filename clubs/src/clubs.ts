/** Clubs and seats: create, join (bench seat, free), leave, nicknames, lookups. */
import type { ClubsContext } from './context';
import { newCrestSeed, stockClubId, stockClubName } from './crest';
import { AlreadyExistsError, inc } from './store/docstore';
import { COL, type ClubDoc, type ClubKind, type ClubSecretDoc, type InviteDoc, type MemberDoc, type WalletDoc } from './types';
import { ClubsError, newId, normAddr, randomCode } from './util';

export const memberId = (clubId: string, wallet: string) => `${clubId}__${wallet.toLowerCase()}`;

export function validateClubName(name: string): string {
  const n = name.replace(/\s+/g, ' ').trim();
  if (n.length < 2 || n.length > 40) throw new ClubsError('bad_name', 'Club names are 2 to 40 characters.');
  if (/https?:|www\.|\.(com|xyz|io|gg)\b|@/i.test(n)) throw new ClubsError('bad_name', 'Club names cannot contain links or handles.');
  return n;
}

export function validateNickname(nick: string | null | undefined): string | null {
  if (nick == null) return null;
  const n = nick.replace(/\s+/g, ' ').trim();
  if (!n) return null;
  if (n.length > 20) throw new ClubsError('bad_nickname', 'Nicknames are up to 20 characters.');
  if (/https?:|www\.|@/i.test(n)) throw new ClubsError('bad_nickname', 'Nicknames cannot contain links or handles.');
  return n;
}

export async function ensureWallet(ctx: ClubsContext, wallet: string): Promise<WalletDoc> {
  const w = await ctx.store.get<WalletDoc>(COL.wallets, wallet);
  if (w) return w;
  const doc: WalletDoc = { wallet, createdAt: ctx.now(), firstQualifyingBuyAt: null, qualifyingBuys: 0 };
  try {
    await ctx.store.create(COL.wallets, wallet, doc);
  } catch (e) {
    if (!(e instanceof AlreadyExistsError)) throw e;
  }
  return (await ctx.store.get<WalletDoc>(COL.wallets, wallet)) ?? doc;
}

async function newInvite(ctx: ClubsContext, clubId: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = randomCode(8);
    try {
      await ctx.store.create<InviteDoc>(COL.invites, code, { code, clubId, createdAt: ctx.now() });
      return code;
    } catch (e) {
      if (!(e instanceof AlreadyExistsError)) throw e;
    }
  }
  throw new ClubsError('invite_failed', 'could not allocate an invite code', 500);
}

export async function insertClub(
  ctx: ClubsContext,
  c: Omit<ClubDoc, 'memberCount' | 'playingCount' | 'createdAt' | 'crestSeed'> & { crestSeed?: string },
  secret: Omit<ClubSecretDoc, 'clubId' | 'inviteCode'> = { matchKey: null, matchRegion: null, matchStage: null },
): Promise<{ club: ClubDoc; inviteCode: string }> {
  const club: ClubDoc = { ...c, crestSeed: c.crestSeed ?? newCrestSeed(), createdAt: ctx.now(), memberCount: 0, playingCount: 0 };
  await ctx.store.create(COL.clubs, club.id, club);
  const inviteCode = await newInvite(ctx, club.id);
  await ctx.store.set<ClubSecretDoc>(COL.clubSecrets, club.id, { clubId: club.id, inviteCode, ...secret });
  return { club, inviteCode };
}

/** Create a private club; the creator takes the first (bench) seat. */
export async function createClub(
  ctx: ClubsContext,
  input: { name: string; createdBy: string; nickname?: string | null },
): Promise<{ club: ClubDoc; inviteCode: string; inviteUrl: string; member: MemberDoc }> {
  const createdBy = normAddr(input.createdBy);
  const name = validateClubName(input.name);
  const mine = await ctx.store.query<ClubDoc>(COL.clubs, { where: [['createdBy', '==', createdBy]] });
  if (mine.filter((c) => c.kind === 'private').length >= 5) throw new ClubsError('too_many_clubs', 'A wallet can start up to 5 private clubs.');
  const { club, inviteCode } = await insertClub(ctx, {
    id: newId('club'),
    name,
    kind: 'private',
    createdBy,
    regionLabel: null,
    stockSymbol: null,
    stockToken: null,
    maxMembers: ctx.config.maxPrivateMembers,
    status: 'open',
  });
  const member = await seatMember(ctx, club, createdBy, { nickname: input.nickname ?? null });
  return { club: (await getClub(ctx, club.id))!, inviteCode, inviteUrl: inviteUrl(ctx, inviteCode), member };
}

/** Public stock club (NVIDIA FC). Idempotent. */
export async function ensureStockClub(ctx: ClubsContext, input: { symbol: string; token: string; name: string }): Promise<ClubDoc> {
  const id = stockClubId(input.symbol);
  const existing = await getClub(ctx, id);
  if (existing) return existing;
  try {
    const { club } = await insertClub(ctx, {
      id,
      name: stockClubName(input.name),
      kind: 'stock',
      createdBy: null,
      regionLabel: null,
      stockSymbol: input.symbol,
      stockToken: input.token.toLowerCase(),
      maxMembers: 1_000_000,
      status: 'open',
    });
    return club;
  } catch (e) {
    if (e instanceof AlreadyExistsError) return (await getClub(ctx, id))!;
    throw e;
  }
}

export const inviteUrl = (ctx: ClubsContext, code: string) => `${ctx.config.siteUrl}/join/${code}`;

export async function resolveInvite(ctx: ClubsContext, code: string): Promise<ClubDoc | null> {
  const inv = await ctx.store.get<InviteDoc>(COL.invites, code.trim().toUpperCase());
  return inv ? getClub(ctx, inv.clubId) : null;
}

async function seatMember(ctx: ClubsContext, club: ClubDoc, wallet: string, opts: { nickname?: string | null; optOutMatching?: boolean }): Promise<MemberDoc> {
  const id = memberId(club.id, wallet);
  const existing = await ctx.store.get<MemberDoc>(COL.members, id);
  if (existing) return existing;
  if (club.memberCount >= club.maxMembers) throw new ClubsError('club_full', 'This club is full.');
  await ensureWallet(ctx, wallet);
  const m: MemberDoc = {
    id,
    clubId: club.id,
    wallet,
    seat: 'bench',
    joinedAt: ctx.now(),
    optOutMatching: opts.optOutMatching ?? false,
    nickname: validateNickname(opts.nickname),
    firstPlayingAt: null,
  };
  try {
    await ctx.store.create(COL.members, id, m);
  } catch (e) {
    if (e instanceof AlreadyExistsError) return (await ctx.store.get<MemberDoc>(COL.members, id))!;
    throw e;
  }
  const count = club.memberCount + 1;
  await ctx.store.update(COL.clubs, club.id, {
    memberCount: inc(1),
    status: club.kind === 'pickup' ? (count >= club.maxMembers ? 'full' : count >= ctx.config.pickupPlaysAt ? 'open' : 'forming') : club.status,
  });
  return m;
}

/**
 * Join a club: a free bench seat, no buy needed.
 * Private clubs need the invite code; stock clubs are open; pick-up clubs are seated by the matcher
 * (or with an invite code from a member).
 */
export async function joinClub(
  ctx: ClubsContext,
  input: { wallet: string; clubId?: string; inviteCode?: string; nickname?: string | null; optOutMatching?: boolean },
): Promise<{ club: ClubDoc; member: MemberDoc; alreadyMember: boolean }> {
  const wallet = normAddr(input.wallet);
  let club: ClubDoc | null = null;
  if (input.inviteCode) club = await resolveInvite(ctx, input.inviteCode);
  else if (input.clubId) {
    club = await getClub(ctx, input.clubId);
    if (club && club.kind !== 'stock') throw new ClubsError('invite_required', 'This club is joined with an invite link.', 403);
  }
  if (!club) throw new ClubsError('club_not_found', 'Club not found.', 404);
  const before = await ctx.store.get<MemberDoc>(COL.members, memberId(club.id, wallet));
  const mine = before ? [] : await ctx.store.query<MemberDoc>(COL.members, { where: [['wallet', '==', wallet]] });
  if (mine.length >= 12) throw new ClubsError('too_many_clubs', 'A wallet can sit in up to 12 clubs.');
  const member = await seatMember(ctx, club, wallet, input);
  return { club: (await getClub(ctx, club.id))!, member, alreadyMember: !!before };
}

export async function leaveClub(ctx: ClubsContext, input: { wallet: string; clubId: string }): Promise<void> {
  const wallet = normAddr(input.wallet);
  const id = memberId(input.clubId, wallet);
  const m = await ctx.store.get<MemberDoc>(COL.members, id);
  if (!m) return;
  await ctx.store.delete(COL.members, id);
  await ctx.store.update(COL.clubs, input.clubId, { memberCount: inc(-1), playingCount: inc(m.seat === 'playing' ? -1 : 0) });
}

export async function setNickname(ctx: ClubsContext, input: { wallet: string; clubId: string; nickname: string | null }): Promise<MemberDoc> {
  const id = memberId(input.clubId, normAddr(input.wallet));
  const m = await ctx.store.get<MemberDoc>(COL.members, id);
  if (!m) throw new ClubsError('not_member', 'Not a member of this club.', 404);
  await ctx.store.update(COL.members, id, { nickname: validateNickname(input.nickname) });
  return (await ctx.store.get<MemberDoc>(COL.members, id))!;
}

export async function setMatchingOptOut(ctx: ClubsContext, input: { wallet: string; clubId: string; optOut: boolean }): Promise<void> {
  const id = memberId(input.clubId, normAddr(input.wallet));
  if (!(await ctx.store.get<MemberDoc>(COL.members, id))) throw new ClubsError('not_member', 'Not a member of this club.', 404);
  await ctx.store.update(COL.members, id, { optOutMatching: input.optOut });
}

export const getClub = (ctx: ClubsContext, id: string) => ctx.store.get<ClubDoc>(COL.clubs, id);

export async function listClubs(ctx: ClubsContext, kind?: ClubKind): Promise<ClubDoc[]> {
  const rows = await ctx.store.query<ClubDoc>(COL.clubs, kind ? { where: [['kind', '==', kind]] } : {});
  return rows.sort((a, b) => b.memberCount - a.memberCount || (a.name < b.name ? -1 : 1));
}

export async function clubMembers(ctx: ClubsContext, clubId: string): Promise<MemberDoc[]> {
  const rows = await ctx.store.query<MemberDoc>(COL.members, { where: [['clubId', '==', clubId]] });
  return rows.sort((a, b) => a.joinedAt - b.joinedAt || (a.wallet < b.wallet ? -1 : 1));
}

export async function walletClubs(ctx: ClubsContext, wallet: string): Promise<{ member: MemberDoc; club: ClubDoc }[]> {
  const ms = await ctx.store.query<MemberDoc>(COL.members, { where: [['wallet', '==', normAddr(wallet)]] });
  const clubs = await ctx.store.getMany<ClubDoc>(COL.clubs, ms.map((m) => m.clubId));
  return ms.map((member, i) => ({ member, club: clubs[i]! })).filter((x) => !!x.club);
}

/** Invite code, only for members (the club doc itself never carries it). */
export async function getInvite(ctx: ClubsContext, input: { clubId: string; wallet: string }): Promise<{ code: string; url: string }> {
  const m = await ctx.store.get<MemberDoc>(COL.members, memberId(input.clubId, normAddr(input.wallet)));
  if (!m) throw new ClubsError('not_member', 'Only members can see the invite link.', 403);
  const s = await ctx.store.get<ClubSecretDoc>(COL.clubSecrets, input.clubId);
  if (!s) throw new ClubsError('club_not_found', 'Club not found.', 404);
  return { code: s.inviteCode, url: inviteUrl(ctx, s.inviteCode) };
}
