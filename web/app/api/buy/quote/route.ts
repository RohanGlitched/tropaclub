import { fail, guarded, ok, rateLimited, readJson } from '@/lib/server/api';
import { PRESETS, quoteBuy, type Pay } from '@/lib/server/buy';
import { regionOf } from '@/lib/server/geo';
import { isAddress } from '@/lib/format';
import { sessionWallet } from '@/lib/server/session';
import { PAUSED_MESSAGE, buyOpenAt as buyOpenAtIso, buyPaused, buyState, utcWhenYear } from '@/lib/site';

export const dynamic = 'force-dynamic';

export const POST = (req: Request) =>
  guarded(async () => {
    if ((await regionOf(req.headers)).blocked) return fail(403, "Buying isn't available in your region.");
    // the kill switch first: nothing new is quoted while it is on (buys already made still record)
    if (buyPaused()) return ok({ ok: false, message: PAUSED_MESSAGE, retry: false, paused: true });
    if (buyState() === 'before') return ok({ ok: false, message: `Buying opens ${utcWhenYear(buyOpenAtIso())}.`, retry: false });
    const body = await readJson<{ token?: string; pay?: string; usd?: number; taker?: string; notUsPerson?: boolean; fresh?: boolean }>(req);
    if (body?.notUsPerson !== true) return fail(400, 'Confirm that you are not a US person to see a quote.');
    const token = String(body?.token ?? '');
    const taker = String(body?.taker ?? '');
    const usd = Number(body?.usd);
    const pay: Pay = body?.pay === 'ETH' ? 'ETH' : 'USDC';
    if (!isAddress(token) || !isAddress(taker) || !(PRESETS as readonly number[]).includes(usd)) return fail(400, 'Pick a stock and an amount of $10, $25 or $50.');
    if (rateLimited('quote', req, 40)) return fail(429, 'Too many quotes at once. Wait a minute.');
    // "Get a new quote" asks for a fresh one: the short quote cache is skipped
    // a quote is remembered (so the sweep may count the buy it leads to) only for the signed-in wallet
    const signedIn = await sessionWallet().catch(() => null);
    return ok(await quoteBuy({ token, pay, usd, taker, remember: signedIn === taker.toLowerCase() }, { fresh: body?.fresh === true }));
  });
