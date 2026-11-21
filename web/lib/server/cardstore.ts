// Where share pictures live. On Cloud Run: the public bucket (ADC). Locally, or if the bucket
// cannot be reached: web/.cards, served by /api/card/file/[name].
import 'server-only';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BUCKET = process.env.CARDS_BUCKET || 'tropaclub-data';
const PREFIX = (process.env.CARDS_PREFIX || 'public/cards').replace(/^\/|\/$/g, '');
const FORCE_LOCAL = process.env.CARDS_LOCAL === '1';
const LOCAL_DIR = path.join(process.cwd(), '.cards');

/** v3: tickets can carry a "Played GW0" stamp. A stamped ticket is a different file, so a new stamp shows at once. */
export const cardName = (address: string, symbol: string, variant: 'landscape' | 'portrait', stamp?: string | null) =>
  `${address.toLowerCase()}-${symbol.replace(/[^A-Za-z0-9.]/g, '')}-v3${stamp ? `-${stamp.replace(/[^A-Za-z0-9]/g, '').toLowerCase().slice(0, 12)}` : ''}${variant === 'portrait' ? '-portrait' : ''}.jpg`;
export const publicCardUrl = (name: string) => `https://storage.googleapis.com/${BUCKET}/${PREFIX}/${encodeURIComponent(name)}`;
export const localCardUrl = (name: string) => `/api/card/file/${encodeURIComponent(name)}`;
export const isCardName = (name: string) => /^0x[0-9a-f]{40}-[A-Za-z0-9.]{1,12}-v3(-[a-z0-9]{1,12})?(-portrait)?\.jpg$/.test(name);

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

let gcsBroken = 0; // time of the last failure; skip the bucket for a while after one

export async function saveCard(name: string, jpeg: Buffer): Promise<string> {
  if (!FORCE_LOCAL && Date.now() - gcsBroken > 10 * 60_000) {
    try {
      const { Storage } = await import('@google-cloud/storage');
      const file = new Storage().bucket(BUCKET).file(`${PREFIX}/${name}`);
      await withTimeout(file.save(jpeg, { resumable: false, contentType: 'image/jpeg', metadata: { cacheControl: 'public, max-age=300' } }), 9000);
      return publicCardUrl(name);
    } catch (e) {
      gcsBroken = Date.now();
      console.warn(`[cards] bucket write failed (${(e as Error).message?.slice(0, 120)}); writing to ${LOCAL_DIR} instead`);
    }
  }
  await mkdir(LOCAL_DIR, { recursive: true });
  await writeFile(path.join(LOCAL_DIR, name), jpeg);
  console.info(`[cards] wrote ${name} to ${LOCAL_DIR}`);
  return localCardUrl(name);
}

/** Recent enough to reuse? Returns the URL, or null. */
export async function findCard(name: string, maxAgeMs = 6 * 3600_000): Promise<string | null> {
  try {
    const s = await stat(path.join(LOCAL_DIR, name));
    if (Date.now() - s.mtimeMs < maxAgeMs) return localCardUrl(name);
  } catch {
    /* not local */
  }
  if (FORCE_LOCAL) return null;
  try {
    const res = await fetch(publicCardUrl(name), { method: 'HEAD', signal: AbortSignal.timeout(2500), cache: 'no-store' });
    if (!res.ok) return null;
    const lm = Date.parse(res.headers.get('last-modified') || '');
    return isFinite(lm) && Date.now() - lm > maxAgeMs ? null : publicCardUrl(name);
  } catch {
    return null;
  }
}

/** For og:image: does a stored picture exist? Cached, short timeout, never renders. */
export async function storedCardUrl(name: string): Promise<string | null> {
  try {
    await stat(path.join(LOCAL_DIR, name));
    return localCardUrl(name);
  } catch {
    /* not local */
  }
  if (FORCE_LOCAL) return null;
  try {
    const res = await fetch(publicCardUrl(name), { method: 'HEAD', signal: AbortSignal.timeout(1500), next: { revalidate: 300 } });
    return res.ok ? publicCardUrl(name) : null;
  } catch {
    return null;
  }
}

export async function readLocalCard(name: string): Promise<Buffer | null> {
  try {
    return await readFile(path.join(LOCAL_DIR, name));
  } catch {
    return null;
  }
}
