import { fail, guarded, ok, rateLimited, readJson } from '@/lib/server/api';
import { startSession, verifyChallenge } from '@/lib/server/session';
import { isAddress } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const POST = (req: Request) =>
  guarded(async () => {
    const body = await readJson<{ address?: string; token?: string; message?: string; signature?: string }>(req);
    const address = String(body?.address ?? '');
    if (!isAddress(address) || !body?.token || !body.message || !/^0x[0-9a-fA-F]+$/.test(String(body.signature ?? ''))) return fail(400, 'Sign-in request is incomplete');
    if (rateLimited('auth', req, 30)) return fail(429, 'Too many sign-in attempts. Wait a minute.');
    if (!(await verifyChallenge({ address, token: body.token, message: String(body.message), signature: String(body.signature) }))) return fail(401, 'That signature did not match the wallet. Try signing in again.');
    await startSession(address);
    return ok({ wallet: address.toLowerCase() });
  });
