// Region gate, server side. Buying and call-ups are hidden for the United States and its
// territories (contest rules). Every read-only page is open everywhere.
//
// Which headers are believed depends on how the request arrived (see lib/hosts.ts):
//   through Firebase Hosting (our own host, and the connecting peer is a Google proxy address): its x-country-code if present, else the visitor IP
//     it reports (fastly-client-ip, or the first x-forwarded-for entry). Hosting overwrites all
//     three, so a visitor cannot forge them on that path.
//   any other way (the bare Cloud Run URL): no header is believed. The country comes from the last
//     x-forwarded-for entry, which Google's front end appends itself and the client cannot choose.
// IPs are looked up in the DB-IP Country Lite database (CC BY 4.0, credited in the footer).
import 'server-only';
import path from 'node:path';
import { headers } from 'next/headers';
import type { CountryResponse, Reader } from 'maxmind';
import { allowedHost } from '@/lib/hosts';

export const US_AND_TERRITORIES = new Set(['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM']);
type HeaderBag = { get(name: string): string | null };

let readerP: Promise<Reader<CountryResponse> | null> | null = null;
function reader() {
  return (readerP ??= (async () => {
    const file = process.env.GEO_DB_PATH || path.join(process.cwd(), '..', 'geo', 'dbip-country-lite.mmdb');
    try {
      const { open } = await import('maxmind');
      return await open<CountryResponse>(file);
    } catch (e) {
      console.warn(`[geo] country database not loaded from ${file}: ${(e as Error).message?.slice(0, 100)}`);
      return null;
    }
  })());
}

const xff = (h: HeaderBag) => (h.get('x-forwarded-for') || '').split(',').map((s) => s.trim()).filter(Boolean);

export function clientIp(h: HeaderBag): string | null {
  const chain = xff(h);
  if (allowedHost(h)) return (h.get('fastly-client-ip') || chain[0] || '').trim() || null;
  return chain[chain.length - 1] || null;
}

/** ISO country of the request, or null when it cannot be told. */
export async function countryOf(h: HeaderBag): Promise<string | null> {
  if (allowedHost(h)) {
    const c = h.get('x-country-code')?.trim().toUpperCase();
    if (c && /^[A-Z]{2}$/.test(c) && c !== 'ZZ' && c !== 'XX' && c !== 'T1') return c;
  }
  const ip = clientIp(h);
  if (!ip) return null;
  try {
    const code = (await reader())?.get(ip)?.country?.iso_code;
    return code && /^[A-Z]{2}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

export const gateOff = () => process.env.REGION_GATE === 'off';
export const isUs = (country: string | null) => !gateOff() && !!country && US_AND_TERRITORIES.has(country);

export interface Region {
  country: string | null;
  /** Buying and call-ups are hidden. */
  us: boolean;
  /** Country unknown. (Every buyer ticks "I am not a US person" in any case.) */
  unknown: boolean;
}

export async function regionOf(h: HeaderBag): Promise<Region> {
  const country = await countryOf(h);
  return { country, us: isUs(country), unknown: !gateOff() && !country };
}

/** For server components. */
export async function requestRegion(): Promise<Region> {
  return regionOf(await headers());
}
