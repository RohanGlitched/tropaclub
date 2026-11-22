import { fail, guarded, ok, rateLimited, readJson } from '@/lib/server/api';
import { getClubs } from '@/lib/server/clubs';
import { sessionWallet } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

// Link an X handle to the signed-in wallet: once, one handle per wallet and one wallet per handle,
// fixed after the first social claim.
export const POST = (req: Request) =>
  guarded(async () => {
    const wallet = await sessionWallet();
    if (!wallet) return fail(401, 'Sign in with your wallet to add your X handle.');
    if (rateLimited('season-handle', req, 10)) return fail(429, 'Too many requests. Wait a minute.');
    const body = await readJson<{ handle?: unknown }>(req);
    const clubs = await getClubs();
    return ok(await clubs.setXHandle(wallet, body?.handle));
  });
