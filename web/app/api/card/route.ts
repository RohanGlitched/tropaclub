import { fail, ok, rateLimited, readJson } from '@/lib/server/api';
import { getIndex, getWallet } from '@/lib/server/data';
import { ensureCard } from '@/lib/server/cardmake';
import { playedStamps } from '@/lib/server/clubs';
import { isAddress } from '@/lib/format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Makes the share pictures for one ticket when the visitor taps Share, and stores them as plain files.
// Crawlers never reach this: og:image points at the stored file, or at the static default.
export async function POST(req: Request) {
  const body = await readJson<{ address?: string; symbol?: string }>(req);
  if (!body) return fail(400, 'Send JSON with address and symbol');
  const address = String(body.address || '').toLowerCase();
  const symbol = String(body.symbol || '');
  if (!isAddress(address) || !/^[A-Za-z0-9.]{1,12}$/.test(symbol)) return fail(400, 'Bad address or club');
  if (rateLimited('card', req, 12)) return fail(429, 'Too many pictures at once. Wait a minute.');

  const [{ data: index }, { data: wallet }] = await Promise.all([getIndex(), getWallet(address)]);
  const token = index.tokens.find((t) => t.symbol === symbol);
  const entry = wallet?.tokens.find((t) => t.symbol === symbol);
  if (!token || !entry || entry.rank == null) return fail(404, 'This wallet has no real-fan seat at that club');

  try {
    const played = await playedStamps(address);
    const input = { address, entry, token, asOf: index.asOf, stamp: played.byToken.get(token.address.toLowerCase()) ?? null, badge: played.badge };
    const [landscape, portrait] = await Promise.all([ensureCard(input, 'landscape'), ensureCard(input, 'portrait')]);
    return ok({ landscape, portrait });
  } catch (e) {
    console.error('[cards] render failed', (e as Error).message);
    return fail(500, 'The picture could not be made');
  }
}
