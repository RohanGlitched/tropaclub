import { fail, guarded, ok, rateLimited, readJson } from '@/lib/server/api';
import { PRESETS, quoteBuy, type Pay } from '@/lib/server/buy';
import { regionOf } from '@/lib/server/geo';
import { isAddress } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const POST = (req: Request) =>
  guarded(async () => {
    if ((await regionOf(req.headers)).us) return fail(403, 'Not available to US persons.');
    const body = await readJson<{ token?: string; pay?: string; usd?: number; taker?: string }>(req);
    const token = String(body?.token ?? '');
    const taker = String(body?.taker ?? '');
    const usd = Number(body?.usd);
    const pay: Pay = body?.pay === 'ETH' ? 'ETH' : 'USDC';
    if (!isAddress(token) || !isAddress(taker) || !(PRESETS as readonly number[]).includes(usd)) return fail(400, 'Pick a stock and an amount of $10, $25 or $50.');
    if (rateLimited('quote', req, 40)) return fail(429, 'Too many quotes at once. Wait a minute.');
    return ok(await quoteBuy({ token, pay, usd, taker }));
  });
