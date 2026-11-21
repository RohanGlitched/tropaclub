import { fail, guarded, ok, rateLimited, readJson } from '@/lib/server/api';
import { newChallenge } from '@/lib/server/session';
import { isAddress } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const POST = (req: Request) =>
  guarded(async () => {
    const body = await readJson<{ address?: string }>(req);
    const address = String(body?.address ?? '');
    if (!isAddress(address)) return fail(400, 'Not a wallet address');
    if (rateLimited('auth', req, 30)) return fail(429, 'Too many sign-in attempts. Wait a minute.');
    return ok(newChallenge(address));
  });
