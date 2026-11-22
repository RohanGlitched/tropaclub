// Draws public/og-default.png (the share picture used when nothing better can be drawn) from the
// live count, with the same renderer as the site's own share picture.
//   npx tsx --tsconfig scripts/tsconfig.og.json scripts/make-og-default.mts
// If the index cannot be read, the existing file is kept.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ImageResponse } from 'next/og';
import sharp from 'sharp';
import { cardFonts, defaultCard } from '../lib/server/card';

const out = fileURLToPath(new URL('../public/og-default.png', import.meta.url));
const BASE = (process.env.DATA_BASE_URL || 'https://storage.googleapis.com/tropaclub-data/public').replace(/\/$/, '');

const res = await fetch(`${BASE}/index.json`, { signal: AbortSignal.timeout(15000) });
if (!res.ok) throw new Error(`index.json: HTTP ${res.status}`);
const idx = (await res.json()) as { tokens: { symbol: string; name?: string; holdersTotal: number; realFans: number }[] };
const top = [...idx.tokens].sort((a, b) => b.realFans - a.realFans)[0];
if (!top) throw new Error('index.json has no tokens');
const token = { ...top, name: top.name || top.symbol.replace(/c$/, '') } as never;
const img = new ImageResponse(await defaultCard(token), { width: 1200, height: 630, fonts: await cardFonts() });
const png = await sharp(Buffer.from(await img.arrayBuffer())).png({ compressionLevel: 9 }).toBuffer();
writeFileSync(out, png);
console.log(`og-default.png: ${top.symbol} ${top.holdersTotal} wallets, ${top.realFans} real holders (${png.length} bytes)`);
