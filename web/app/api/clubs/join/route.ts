import { fail, guarded, ok, rateLimited, readJson } from '@/lib/server/api';
import { getClubs } from '@/lib/server/clubs';
import { maybeRefer } from '@/lib/server/referral';
import { sessionWallet } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

// Join a club: a free Bench seat. Private and pick-up clubs need the invite code; stock clubs are open.
export const POST = (req: Request) =>
  guarded(async () => {
    const wallet = await sessionWallet();
    if (!wallet) return fail(401, 'Sign in with your wallet to join a club.');
    if (rateLimited('clubs', req, 20)) return fail(429, 'Too many requests. Wait a minute.');
    const body = await readJson<{ inviteCode?: string; clubId?: string; nickname?: string | null; scout?: string | null }>(req);
    const clubs = await getClubs();
    const r = await clubs.joinClub({ wallet, inviteCode: body?.inviteCode || undefined, clubId: body?.clubId || undefined, nickname: body?.nickname ?? null });
    if (!r.alreadyMember) await maybeRefer(clubs, wallet, body?.scout, 'club');
    return ok({ clubId: r.club.id, name: r.club.name, alreadyMember: r.alreadyMember });
  });
