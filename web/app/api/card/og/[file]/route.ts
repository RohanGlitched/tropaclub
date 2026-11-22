import { NextResponse } from 'next/server';
import { clientIp, rateLimited } from '@/lib/server/api';
import { getIndex, getWallet } from '@/lib/server/data';
import { ensureCard } from '@/lib/server/cardmake';
import { cardName, findCard, readLocalCard, storedCardUrl } from '@/lib/server/cardstore';
import { playedStamps } from '@/lib/server/clubs';
import { isAddress } from '@/lib/format';
import { SITE_URL } from '@/lib/site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// og:image for /ticket/<address>: the wallet's primary ticket, drawn on demand by the same renderer
// as Share and stored in the public bucket (cards/<address>-<SYMBOL>-v4[...].jpg). After the
// first request the stored copy is served. The page links here with ?v=<count time + stamp>, so a
// new count or a new "Played" stamp is a new URL, and each URL can be cached for a long time.
// Drawing is rationed: two at a time per instance and a few per minute per caller; past that the
// last stored picture (or the default one) is answered, with a short cache, and nothing is drawn.
const LONG = 'public, max-age=86400, s-maxage=604800';
const SHORT = 'public, max-age=300, s-maxage=300';
const MAX_DRAWING = 2;
let drawing = 0;

const fallback = () => NextResponse.redirect(`${SITE_URL}/og-default.png`, { status: 302, headers: { 'Cache-Control': SHORT } });

async function bytesOf(url: string, name: string): Promise<Uint8Array | null> {
  if (url.startsWith('/api/card/file/')) {
    const b = await readLocalCard(name);
    return b ? new Uint8Array(b) : null;
  }
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

const jpeg = (b: Uint8Array, cache: string) => new Response(new Blob([b as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' }), { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' } });

export async function GET(req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const address = file.replace(/\.jpe?g$/i, '').toLowerCase();
  if (!isAddress(address)) return NextResponse.json({ error: 'Not a wallet address' }, { status: 404 });

  const [{ data: index }, { data: wallet }] = await Promise.all([getIndex(), getWallet(address)]);
  const bySymbol = new Map(index.tokens.map((t) => [t.symbol, t]));
  // the primary ticket: the same order as the ticket page (best real-fan rank for the ground's size)
  const top = (wallet?.tokens ?? []).filter((e) => e.rank != null && bySymbol.has(e.symbol)).sort((a, b) => a.rank! / Math.max(1, a.of) - b.rank! / Math.max(1, b.of))[0];
  if (!top) return fallback();
  const token = bySymbol.get(top.symbol)!;
  const played = await playedStamps(address, 1500);
  const input = { address, entry: top, token, asOf: index.asOf, stamp: played.byToken.get(token.address.toLowerCase()) ?? null, badge: played.badge };
  const name = cardName(address, token.symbol, 'landscape', input.stamp);

  // a recent stored copy: no drawing at all
  const fresh = await findCard(name);
  if (fresh) {
    const b = await bytesOf(fresh, name);
    if (b) return jpeg(b, LONG);
  }
  // drawing is rationed; an older stored copy is better than none while it is
  if (drawing >= MAX_DRAWING || rateLimited('og-card', req, 6)) {
    console.info(`[cards] og render deferred for ${address.slice(0, 10)} (${drawing} drawing, caller ${clientIp(req).slice(0, 12)})`);
    const stale = await storedCardUrl(name).catch(() => null);
    const b = stale ? await bytesOf(stale, name) : null;
    return b ? jpeg(b, SHORT) : fallback();
  }
  drawing++;
  try {
    const url = await ensureCard(input, 'landscape');
    const b = await bytesOf(url, name);
    return b ? jpeg(b, LONG) : fallback();
  } catch (e) {
    console.warn('[cards] og render failed:', (e as Error).message?.slice(0, 120));
    return fallback();
  } finally {
    drawing--;
  }
}
