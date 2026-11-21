/**
 * Pick-up clubs: opt-in automatic matching of solo joiners.
 *
 * - Match by country first; after 24 h in the queue widen to the region; after 48 h, global.
 * - A pick-up club is formed only when 3 can be seated together (it plays at 3) and fills to 5.
 * - Clubs get a region name ("Andes Rovers") and a generated crest; a member's country is never shown
 *   or stored: the queue keeps HMAC(salt, country) only, and deletes the entry once seated.
 * - Never two wallets sharing a funding source (first USDC/ETH inbound sender) in one club.
 */
import { ensureWallet, insertClub, joinClub, walletClubs } from './clubs';
import type { ClubsContext } from './context';
import { newCrestSeed, pickupClubName } from './crest';
import { GLOBAL_REGION, regionOf } from './geo';
import { queryIn } from './store/docstore';
import { COL, type ClubDoc, type ClubSecretDoc, type MemberDoc, type QueueDoc, type WalletDoc } from './types';
import { ClubsError, HOUR, hmac, newId, normAddr } from './util';

export const WIDEN_TO_REGION_SEC = 24 * HOUR;
export const WIDEN_TO_GLOBAL_SEC = 48 * HOUR;
type Stage = 'country' | 'region' | 'global';
const STAGE_RANK: Record<Stage, number> = { country: 0, region: 1, global: 2 };

export function queueStage(q: Pick<QueueDoc, 'queuedAt'>, now: number): Stage {
  const age = now - q.queuedAt;
  return age >= WIDEN_TO_GLOBAL_SEC ? 'global' : age >= WIDEN_TO_REGION_SEC ? 'region' : 'country';
}

async function fundingOf(ctx: ClubsContext, wallet: string): Promise<string | null> {
  const w = await ensureWallet(ctx, wallet);
  if (w.fundingSource !== undefined) return w.fundingSource ?? null;
  const f = ctx.funding ? await ctx.funding.firstFunder(wallet).catch(() => null) : null;
  await ctx.store.update(COL.wallets, wallet, { fundingSource: f, fundingCheckedAt: ctx.now() });
  return f;
}

/** Opt in to pick-up matching. `country` comes from the request edge header and is hashed, never stored. */
export async function optInPickup(ctx: ClubsContext, input: { wallet: string; country: string | null }): Promise<{ queued: boolean; seated: ClubDoc | null }> {
  const wallet = normAddr(input.wallet);
  const mine = await walletClubs(ctx, wallet);
  const pick = mine.find((x) => x.club.kind === 'pickup');
  if (pick) return { queued: false, seated: pick.club };
  if (mine.some((x) => x.member.optOutMatching)) throw new ClubsError('opted_out', 'This wallet opted out of matching.');
  const country = input.country?.toUpperCase() ?? null;
  const doc: QueueDoc = {
    wallet,
    countryKey: country ? hmac(ctx.config.matchSalt, country) : 'unknown',
    region: regionOf(country),
    queuedAt: ctx.now(),
    fundingSource: await fundingOf(ctx, wallet),
  };
  const existing = await ctx.store.get<QueueDoc>(COL.matchQueue, wallet);
  if (!existing) await ctx.store.set(COL.matchQueue, wallet, doc);
  await matchPickups(ctx);
  const seated = (await walletClubs(ctx, wallet)).find((x) => x.club.kind === 'pickup')?.club ?? null;
  return { queued: !seated, seated };
}

export async function leavePickupQueue(ctx: ClubsContext, wallet: string): Promise<void> {
  await ctx.store.delete(COL.matchQueue, normAddr(wallet));
}

interface OpenClub {
  club: ClubDoc;
  secret: ClubSecretDoc;
  funders: Set<string>;
}

function compatible(q: QueueDoc, stage: Stage, key: { matchKey: string | null; matchRegion: string | null }, level: Stage): boolean {
  if (STAGE_RANK[stage] < STAGE_RANK[level]) return false;
  if (level === 'country') return q.countryKey !== 'unknown' && key.matchKey === q.countryKey;
  if (level === 'region') return q.region !== GLOBAL_REGION && key.matchRegion === q.region;
  return true;
}

/** Run the matcher (on every opt-in and from cron every 15 min). */
export async function matchPickups(ctx: ClubsContext): Promise<{ seated: number; clubsFormed: number }> {
  const now = ctx.now();
  const queue = (await ctx.store.query<QueueDoc>(COL.matchQueue)).sort((a, b) => a.queuedAt - b.queuedAt || (a.wallet < b.wallet ? -1 : 1));
  if (!queue.length) return { seated: 0, clubsFormed: 0 };
  let seated = 0;
  let clubsFormed = 0;
  const done = new Set<string>();

  // 1) Fill existing pick-up clubs with free seats.
  const pickups = (await ctx.store.query<ClubDoc>(COL.clubs, { where: [['kind', '==', 'pickup']] })).filter((c) => c.memberCount < c.maxMembers);
  const open: OpenClub[] = [];
  for (const club of pickups) {
    const secret = await ctx.store.get<ClubSecretDoc>(COL.clubSecrets, club.id);
    if (!secret) continue;
    const members = await ctx.store.query<MemberDoc>(COL.members, { where: [['clubId', '==', club.id]] });
    const wallets = await queryIn<WalletDoc>(ctx.store, COL.wallets, 'wallet', members.map((m) => m.wallet));
    open.push({ club, secret, funders: new Set(wallets.map((w) => w.fundingSource).filter((x): x is string => !!x)) });
  }
  for (const level of ['country', 'region', 'global'] as Stage[]) {
    for (const q of queue) {
      if (done.has(q.wallet)) continue;
      const stage = queueStage(q, now);
      const target = open.find(
        (o) =>
          o.club.memberCount < o.club.maxMembers &&
          compatible(q, stage, { matchKey: o.secret.matchKey, matchRegion: o.secret.matchRegion }, level) &&
          (!q.fundingSource || !o.funders.has(q.fundingSource)),
      );
      if (!target) continue;
      await seat(ctx, target.club, q);
      target.club.memberCount++;
      if (q.fundingSource) target.funders.add(q.fundingSource);
      done.add(q.wallet);
      seated++;
    }
  }

  // 2) Form new clubs where >= 3 compatible wallets wait.
  for (const level of ['country', 'region', 'global'] as Stage[]) {
    const groups = new Map<string, QueueDoc[]>();
    for (const q of queue) {
      if (done.has(q.wallet)) continue;
      const stage = queueStage(q, now);
      if (STAGE_RANK[stage] < STAGE_RANK[level]) continue;
      const key = level === 'country' ? q.countryKey : level === 'region' ? q.region : GLOBAL_REGION;
      if ((level === 'country' && key === 'unknown') || (level === 'region' && key === GLOBAL_REGION)) continue;
      groups.set(key, [...(groups.get(key) ?? []), q]);
    }
    for (const [key, members] of groups) {
      let pool = members.filter((q) => !done.has(q.wallet));
      while (pool.length >= ctx.config.pickupPlaysAt) {
        const picked: QueueDoc[] = [];
        const funders = new Set<string>();
        for (const q of pool) {
          if (picked.length >= ctx.config.pickupSize) break;
          if (q.fundingSource && funders.has(q.fundingSource)) continue;
          picked.push(q);
          if (q.fundingSource) funders.add(q.fundingSource);
        }
        if (picked.length < ctx.config.pickupPlaysAt) break;
        const region = level === 'global' ? GLOBAL_REGION : picked[0]!.region;
        const seed = newCrestSeed();
        const { club } = await insertClub(
          ctx,
          {
            id: newId('pick'),
            name: await uniqueName(ctx, pickupClubName(region, seed)),
            kind: 'pickup',
            createdBy: null,
            regionLabel: region,
            stockSymbol: null,
            stockToken: null,
            maxMembers: ctx.config.pickupSize,
            status: 'forming',
            crestSeed: seed,
          },
          { matchKey: level === 'country' ? key : null, matchRegion: level === 'global' ? null : region, matchStage: level },
        );
        clubsFormed++;
        for (const q of picked) {
          await seat(ctx, (await ctx.store.get<ClubDoc>(COL.clubs, club.id))!, q);
          done.add(q.wallet);
          seated++;
        }
        pool = pool.filter((q) => !done.has(q.wallet));
      }
    }
  }
  return { seated, clubsFormed };
}

async function seat(ctx: ClubsContext, club: ClubDoc, q: QueueDoc) {
  const secret = await ctx.store.get<ClubSecretDoc>(COL.clubSecrets, club.id);
  await joinClub(ctx, { wallet: q.wallet, inviteCode: secret!.inviteCode });
  await ctx.store.delete(COL.matchQueue, q.wallet);
}

async function uniqueName(ctx: ClubsContext, base: string): Promise<string> {
  const taken = new Set((await ctx.store.query<ClubDoc>(COL.clubs, { where: [['kind', '==', 'pickup']] })).map((c) => c.name));
  if (!taken.has(base)) return base;
  const roman = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
  for (const r of roman) if (!taken.has(`${base} ${r}`)) return `${base} ${r}`;
  return `${base} ${taken.size}`;
}
