import { fail, guarded, ok, rateLimited } from '@/lib/server/api';
import { getClubs } from '@/lib/server/clubs';
import { countryOf } from '@/lib/server/geo';
import { sessionWallet } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

// Ask to be matched into a pick-up club of five. The country is used once for matching and never stored.
export const POST = (req: Request) =>
  guarded(async () => {
    const wallet = await sessionWallet();
    if (!wallet) return fail(401, 'Sign in with your wallet to join a pick-up club.');
    if (rateLimited('clubs', req, 12)) return fail(429, 'Too many requests. Wait a minute.');
    const clubs = await getClubs();
    const r = await clubs.optInPickup({ wallet, country: await countryOf(req.headers) });
    return ok({ queued: r.queued, club: r.seated ? { id: r.seated.id, name: r.seated.name } : null });
  });

export const DELETE = () =>
  guarded(async () => {
    const wallet = await sessionWallet();
    if (!wallet) return fail(401, 'Sign in first.');
    await (await getClubs()).leavePickupQueue(wallet);
    return ok({ queued: false });
  });
