// Refreshes public/og-default.png at every build ("prebuild"): the site's live share picture
// (/api/card/og/home.jpg, the current count) is fetched and saved as the fallback picture.
// To redraw it from this checkout's renderer instead: npm run og:default.
// If anything fails, the bundled file is kept and the build goes on.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const out = fileURLToPath(new URL('../public/og-default.png', import.meta.url));
// Only a picture of this checkout's design is taken: the live site may still run the previous one.
const design = readFileSync(fileURLToPath(new URL('../lib/server/cardstore.ts', import.meta.url)), 'utf8').match(/home-v(\d+)-/)?.[1];
try {
  if (!design) throw new Error('could not read the share picture design version');
  const res = await fetch('https://tropaclub.xyz/api/card/og/home.jpg', { redirect: 'follow', signal: AbortSignal.timeout(20000) });
  if (!res.url.includes(`/home-v${design}-`)) throw new Error(`the live picture is another design (${res.url.split('/').pop()})`);
  if (!res.ok || !/image\//.test(res.headers.get('content-type') ?? '')) throw new Error(`HTTP ${res.status} ${res.headers.get('content-type')}`);
  const meta = await sharp(Buffer.from(await res.clone().arrayBuffer())).metadata();
  if (meta.width !== 1200 || meta.height !== 630) throw new Error(`unexpected size ${meta.width}x${meta.height}`);
  const png = await sharp(Buffer.from(await res.arrayBuffer())).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(out, png);
  console.log(`[og-default] refreshed from the live share picture (${png.length} bytes)`);
} catch (e) {
  console.warn(`[og-default] kept the bundled file: ${e.message}`);
}
