import { isSocialQuest } from '@tropaclub/clubs';
import { fail, guarded, ok, rateLimited, readJson } from '@/lib/server/api';
import { getClubs } from '@/lib/server/clubs';
import { seasonPostId } from '@/lib/server/season';
import { sessionWallet } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

// Record a self-reported social quest for the signed-in wallet. Once per quest; the Caps are given
// once the wallet has a verified Season 1 buy, and are removed if a spot-check cannot confirm it.
export const POST = (req: Request) =>
  guarded(async () => {
    const wallet = await sessionWallet();
    if (!wallet) return fail(401, 'Sign in with your wallet to claim a quest.');
    if (rateLimited('season-claim', req, 10)) return fail(429, 'Too many requests. Wait a minute.');
    const body = await readJson<{ quest?: unknown }>(req);
    if (!isSocialQuest(body?.quest)) return fail(400, 'Unknown quest.');
    const clubs = await getClubs();
    const claim = await clubs.claimSocial(wallet, body.quest, { postId: seasonPostId() });
    return ok({ quest: claim.quest, claimedAt: claim.claimedAt, status: claim.status });
  });
