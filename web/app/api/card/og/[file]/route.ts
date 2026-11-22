import { NextResponse } from 'next/server';
import { clientIp, rateLimited } from '@/lib/server/api';
import { getIndex, getWallet } from '@/lib/server/data';
import { ensureCard, ensureHomeCard, tryDraw } from '@/lib/server/cardmake';
import { cardName, findCard, storedCardUrl } from '@/lib/server/cardstore';
import { playedStamps } from '@/lib/server/clubs';
import { isAddress } from '@/lib/format';
import { SITE_URL } from '@/lib/site';
import { homeOgVersion, ticketOgVersion } from '@/lib/og';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Share pictures for links:
//   /api/card/og/<address>.jpg?v=...  the wallet's primary ticket (/ticket/<address>)
//   /api/card/og/home.jpg?v=...       the site's own picture, with the live count (every other page)
// Each is drawn on demand by the same renderer as Share, stored in the public bucket, and answered
// with a 302 to the stored file, never proxied. `v` is the count time (plus the "Played" stamp on a
// ticket): a request with any other `v` is sent to the current URL, so each URL means one picture
// and can be cached for a long time. Drawing is rationed (cardmake.tryDraw, shared with POST
// /api/card, plus a few per minute per caller); past that the last stored picture, or the static
// default, is answered with a short cache.
const LONG = 'public, max-age=86400, s-maxage=604800';
const SHORT = 'public, max-age=300, s-maxage=300';

const go = (url: string, cache: string) => NextResponse.redirect(new URL(url, SITE_URL), { status: 302, headers: { 'Cache-Control': cache } });
const fallback = () => go('/og-default.png', SHORT);

export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const asked = new URL(req.url).searchParams.get('v');
  const { data: index } = await getIndex();

  if (file === 'home.jpg') {
    const v = homeOgVersion(index.asOf);
    if (asked !== v) return go(`/api/card/og/home.jpg?v=${encodeURIComponent(v)}`, SHORT);
    const top = [...index.tokens].sort((a, b) => b.realFans - a.realFans)[0];
    if (!top) return fallback();
    const release = rateLimited('og-card', req, 6) ? null : tryDraw();
    if (!release) return fallback();
    try {
      return go(await ensureHomeCard(top, index.asOf), LONG);
    } catch (e) {
      console.warn('[cards] home render failed:', (e as Error).message?.slice(0, 120));
      return fallback();
    } finally {
      release();
    }
  }

  const address = file.replace(/\.jpe?g$/i, '').toLowerCase();
  if (!isAddress(address)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { data: wallet } = await getWallet(address);
  const bySymbol = new Map(index.tokens.map((t) => [t.symbol, t]));
  // the primary ticket: the same order as the ticket page (best real-fan rank for the ground's size)
  const top = (wallet?.tokens ?? []).filter((e) => e.rank != null && bySymbol.has(e.symbol)).sort((a, b) => a.rank! / Math.max(1, a.of) - b.rank! / Math.max(1, b.of))[0];
  if (!top) return fallback();
  const token = bySymbol.get(top.symbol)!;
  const played = await playedStamps(address, 1500);
  const stamp = played.byToken.get(token.address.toLowerCase()) ?? null;
  const v = ticketOgVersion(index.asOf, stamp);
  if (asked !== v) return go(`/api/card/og/${address}.jpg?v=${encodeURIComponent(v)}`, SHORT);
  const input = { address, entry: top, token, asOf: index.asOf, stamp, badge: played.badge };
  const name = cardName(address, token.symbol, 'landscape', stamp);

  // a recent stored copy: no drawing at all
  const fresh = await findCard(name);
  if (fresh) return go(fresh, LONG);
  // drawing is rationed; an older stored copy is better than none meanwhile
  const release = rateLimited('og-card', req, 6) ? null : tryDraw();
  if (!release) {
    console.info(`[cards] og render deferred for ${address.slice(0, 10)} (caller ${clientIp(req).slice(0, 12)})`);
    const stale = await storedCardUrl(name).catch(() => null);
    return stale ? go(stale, SHORT) : fallback();
  }
  try {
    return go(await ensureCard(input, 'landscape'), LONG);
  } catch (e) {
    console.warn('[cards] og render failed:', (e as Error).message?.slice(0, 120));
    return fallback();
  } finally {
    release();
  }
}
