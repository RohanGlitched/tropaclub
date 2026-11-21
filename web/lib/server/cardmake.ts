// Renders a ticket's share pictures and stores them. One render per file at a time: a second
// request for the same picture waits for the first instead of drawing it again.
import 'server-only';
import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import type { TokenSummary, WalletTokenEntry } from '@shared/types';
import { cardFonts, ticketCard } from './card';
import { cardName, findCard, saveCard, storedCardUrl } from './cardstore';

type Variant = 'landscape' | 'portrait';
export interface CardInput {
  address: string;
  entry: WalletTokenEntry;
  token: TokenSummary;
  asOf: string;
  /** "Played GW0": set when the wallet bought this token through Tropa Club in that gameweek. */
  stamp?: string | null;
  /** Payday streak badge, shown under the stamp. */
  badge?: string | null;
}

const inFlight = new Map<string, Promise<string>>();
/** Names this instance has seen stored, with their URL. Saves a HEAD request per page view. */
const known = new Map<string, { url: string; at: number }>();
const KNOWN_TTL = 6 * 3600_000;

function remember(name: string, url: string) {
  if (known.size > 5000) known.clear();
  known.set(name, { url, at: Date.now() });
}

async function render(input: CardInput, variant: Variant): Promise<string> {
  const name = cardName(input.address, input.token.symbol, variant, input.stamp);
  const size = variant === 'landscape' ? { width: 1200, height: 630 } : { width: 1080, height: 1350 };
  const img = new ImageResponse(await ticketCard(input, variant), { ...size, fonts: await cardFonts() });
  // Share pictures are JPEGs under 300 KB so every chat app previews them.
  const png = Buffer.from(await img.arrayBuffer());
  let quality = 86;
  let jpeg = await sharp(png).jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' }).toBuffer();
  while (jpeg.length > 290_000 && quality > 50) {
    quality -= 8;
    jpeg = await sharp(png).jpeg({ quality, mozjpeg: true }).toBuffer();
  }
  const url = await saveCard(name, jpeg);
  remember(name, url);
  return url;
}

/** The stored picture's URL, drawing and storing it first if there is no recent one. */
export function ensureCard(input: CardInput, variant: Variant): Promise<string> {
  const name = cardName(input.address, input.token.symbol, variant, input.stamp);
  const hit = known.get(name);
  if (hit && Date.now() - hit.at < KNOWN_TTL) return Promise.resolve(hit.url);
  let p = inFlight.get(name);
  if (!p) {
    p = (async () => {
      const have = await findCard(name);
      if (have) {
        remember(name, have);
        return have;
      }
      return render(input, variant);
    })().finally(() => inFlight.delete(name));
    inFlight.set(name, p);
  }
  return p;
}

/**
 * For og:image on a ticket page. Returns the stored picture if there is one. If not, starts
 * drawing it in the background and waits a short moment, so the first crawler usually gets
 * the real picture and every later one certainly does.
 */
export async function ogCardUrl(input: CardInput, waitMs = 2500): Promise<string | null> {
  const name = cardName(input.address, input.token.symbol, 'landscape', input.stamp);
  const hit = known.get(name);
  if (hit && Date.now() - hit.at < KNOWN_TTL) return hit.url;
  if (!inFlight.has(name)) {
    const stored = await storedCardUrl(name);
    if (stored) {
      remember(name, stored);
      return stored;
    }
  }
  const making = ensureCard(input, 'landscape').catch((e) => {
    console.warn('[cards] background render failed:', (e as Error).message?.slice(0, 120));
    return null;
  });
  return Promise.race([making, new Promise<null>((r) => setTimeout(() => r(null), waitMs))]);
}
