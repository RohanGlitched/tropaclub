import { fail, guarded, ok, rateLimited, readJson } from '@/lib/server/api';
import { crestOf, getClubs } from '@/lib/server/clubs';
import { maybeRefer } from '@/lib/server/referral';
import { sessionWallet } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

// Start a private club. The signed-in wallet takes the first Bench seat.
export const POST = (req: Request) =>
  guarded(async () => {
    const wallet = await sessionWallet();
    if (!wallet) return fail(401, 'Sign in with your wallet to start a club.');
    if (rateLimited('clubs', req, 12)) return fail(429, 'Too many requests. Wait a minute.');
    const body = await readJson<{ name?: string; nickname?: string | null; scout?: string | null }>(req);
    const clubs = await getClubs();
    const made = await clubs.createClub({ name: String(body?.name ?? ''), createdBy: wallet, nickname: body?.nickname ?? null });
    await maybeRefer(clubs, wallet, body?.scout, 'create');
    return ok({ club: { id: made.club.id, name: made.club.name, crest: crestOf(made.club) }, inviteUrl: made.inviteUrl, inviteCode: made.inviteCode });
  });
