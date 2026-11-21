import { ImageResponse } from 'next/og';
import { revalidatePath } from 'next/cache';
import sharp from 'sharp';
import { fail, ok, rateLimited, readJson } from '@/lib/server/api';
import { getIndex, getWallet } from '@/lib/server/data';
import { cardFonts, ticketCard } from '@/lib/server/card';
import { cardName, findCard, saveCard } from '@/lib/server/cardstore';
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

  const names = { landscape: cardName(address, symbol, 'landscape'), portrait: cardName(address, symbol, 'portrait') };
  const [haveL, haveP] = await Promise.all([findCard(names.landscape), findCard(names.portrait)]);
  if (haveL && haveP) return ok({ landscape: haveL, portrait: haveP, reused: true });

  try {
    const fonts = await cardFonts();
    const input = { address, entry, token, asOf: index.asOf };
    const render = async (variant: 'landscape' | 'portrait') => {
      const size = variant === 'landscape' ? { width: 1200, height: 630 } : { width: 1080, height: 1350 };
      const img = new ImageResponse(await ticketCard(input, variant), { ...size, fonts });
      // Share pictures are JPEGs under 300 KB so every chat app previews them.
      const png = Buffer.from(await img.arrayBuffer());
      let quality = 86;
      let jpeg = await sharp(png).jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer();
      while (jpeg.length > 290_000 && quality > 50) {
        quality -= 8;
        jpeg = await sharp(png).jpeg({ quality, mozjpeg: true }).toBuffer();
      }
      return saveCard(names[variant], jpeg);
    };
    const [landscape, portrait] = await Promise.all([render('landscape'), render('portrait')]);
    // the ticket page's og:image now has a stored file to point at
    revalidatePath(`/ticket/${address}`);
    return ok({ landscape, portrait, reused: false });
  } catch (e) {
    console.error('[cards] render failed', (e as Error).message);
    return fail(500, 'The picture could not be made');
  }
}
