import { verifyAttribution } from '@tropaclub/buy';
import { fail, guarded, ok, rateLimited, readJson } from '@/lib/server/api';
import { baseClient, within } from '@/lib/server/chain';
import { getClubs } from '@/lib/server/clubs';
import { regionOf } from '@/lib/server/geo';
import { sessionWallet } from '@/lib/server/session';
import { isAddress } from '@/lib/format';

export const dynamic = 'force-dynamic';

// After a buy confirms: check our Builder Code on the transaction, then record it for the club.
// Only the signed-in wallet can record its own buy. The engine then checks the transaction was signed by it.
export const POST = (req: Request) =>
  guarded(async () => {
    const body = await readJson<{ txHash?: string; wallet?: string; clubId?: string | null; notUsPerson?: boolean }>(req);
    const txHash = String(body?.txHash ?? '');
    const wallet = String(body?.wallet ?? '');
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash) || !isAddress(wallet)) return fail(400, 'Send the transaction hash and the wallet.');
    if (rateLimited('record', req, 30)) return fail(429, 'Too many requests. Wait a minute.');
    const signedIn = await sessionWallet();
    if (!signedIn) return fail(401, 'Sign in with your wallet to record this buy.');
    if (signedIn !== wallet.toLowerCase()) return fail(403, 'You are signed in as a different wallet.');
    if (body?.notUsPerson !== true) return fail(400, 'Confirm that you are not a US person.');
    const attribution = await within(verifyAttribution(txHash as `0x${string}`, { client: baseClient(), buyer: wallet.toLowerCase() }), 20_000, 'attribution check').catch(() => null);
    const clubs = await getClubs();
    const region = await regionOf(req.headers);
    // Every buyer ticks "I am not a US person" before the first buy. The answer is stored on the buy record.
    const certified = body?.notUsPerson === true;
    const result = await clubs.recordBuy({ txHash, wallet, clubId: body?.clubId ?? null, country: region.country, selfCertifiedUsPerson: !certified, certifiedNotUsPerson: certified, source: 'client' });
    return ok({
      attributed: attribution?.attributed ?? null,
      via: attribution?.via ?? null,
      recorded: result.ok,
      message: result.ok ? null : result.message,
      retryable: result.ok ? false : !!result.retryable,
      promoted: result.ok ? result.promoted : false,
      qualifies: result.ok ? result.buy.qualifies : false,
    });
  });
