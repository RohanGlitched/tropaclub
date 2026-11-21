import { ImageResponse } from 'next/og';
import { getIndex } from '@/lib/server/data';
import { cardFonts, defaultCard } from '@/lib/server/card';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Source of public/og-default.png. Pages never point crawlers here: fetch it once and commit the file.
export async function GET() {
  const { data } = await getIndex();
  const token = data.tokens[0];
  return new ImageResponse(await defaultCard(token), { width: 1200, height: 630, fonts: await cardFonts(), headers: { 'Cache-Control': 'public, max-age=3600' } });
}
