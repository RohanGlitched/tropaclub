// Refreshes lib/google-ranges.json from Google's two published lists. Run by "npm run build" (prebuild).
//   goog.json  = every address Google announces
//   cloud.json = the part of those that Google Cloud customers can use (VMs, load balancers, ...)
// Firebase Hosting reaches Cloud Run from Google's own proxies: addresses in goog.json that are
// NOT in cloud.json. Both snapshots are kept so the subtraction is done where it is used.
// If either list cannot be fetched or looks wrong, the bundled snapshot is kept and the build goes on.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../lib/google-ranges.json', import.meta.url));
const GOOG = 'https://www.gstatic.com/ipranges/goog.json';
const CLOUD = 'https://www.gstatic.com/ipranges/cloud.json';
const cidr = (c) => typeof c === 'string' && /^[0-9a-f:.]+\/\d{1,3}$/i.test(c);

async function load(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const j = await res.json();
  if (!Array.isArray(j.prefixes)) throw new Error(`${url}: unexpected shape`);
  const v4 = [...new Set(j.prefixes.map((p) => p.ipv4Prefix).filter(Boolean))];
  const v6 = [...new Set(j.prefixes.map((p) => p.ipv6Prefix).filter(Boolean))];
  if (v4.length < 20 || v6.length < 5 || ![...v4, ...v6].every(cidr)) throw new Error(`${url}: unexpected contents`);
  return { v4, v6 };
}

try {
  const [goog, cloud] = await Promise.all([load(GOOG), load(CLOUD)]);
  const next = { source: [GOOG, CLOUD], fetchedAt: new Date().toISOString().slice(0, 10), goog, cloud };
  let prev = null;
  try {
    prev = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    /* first run */
  }
  if (!prev || JSON.stringify([prev.goog, prev.cloud]) !== JSON.stringify([next.goog, next.cloud])) {
    writeFileSync(file, JSON.stringify(next, null, 1) + '\n');
    console.log(`[google-ranges] updated: goog ${goog.v4.length}+${goog.v6.length}, cloud ${cloud.v4.length}+${cloud.v6.length}`);
  } else console.log('[google-ranges] unchanged');
} catch (e) {
  console.warn(`[google-ranges] keeping the bundled snapshot (${e.message})`);
}
