import { fail, guarded, ok, rateLimited, readJson } from '@/lib/server/api';
import { getClubs } from '@/lib/server/clubs';
import { countryOf } from '@/lib/server/geo';
import { sessionWallet } from '@/lib/server/session';
import { isAddress } from '@/lib/format';

export const dynamic = 'force-dynamic';

// Call up a benched teammate: one per teammate per gameweek. Returns the share message and links.
export const POST = (req: Request) =>
  guarded(async () => {
    const wallet = await sessionWallet();
    if (!wallet) return fail(401, 'Sign in with your wallet to call up a teammate.');
    if (rateLimited('callup', req, 20)) return fail(429, 'Too many call-ups at once. Wait a minute.');
    const body = await readJson<{ clubId?: string; to?: string }>(req);
    if (!body?.clubId || !isAddress(String(body.to ?? ''))) return fail(400, 'Pick a teammate to call up.');
    const share = await (await getClubs()).sendCallup({ clubId: body.clubId, from: wallet, to: String(body.to), country: await countryOf(req.headers) });
    return ok({ ...share, x: `https://x.com/intent/post?text=${encodeURIComponent(share.text)}&url=${encodeURIComponent(share.url)}` });
  });
