// Region gate, server side. Buying and call-ups are hidden for the United States and its
// territories (contest rules). Every read-only page is open everywhere.
//
// Cloud Run behind Firebase Hosting receives no country header, so the country comes from the
// visitor's IP (first entry of x-forwarded-for) looked up in the DB-IP Country Lite database
// (CC BY 4.0, credited in the footer). A country header, if one ever arrives, wins.
import 'server-only';
import path from 'node:path';
import { headers } from 'next/headers';
import type { CountryResponse, Reader } from 'maxmind';

export const US_AND_TERRITORIES = new Set(['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM']);
const COUNTRY_HEADERS = ['x-country-code', 'x-appengine-country', 'x-client-geo-country', 'cf-ipcountry', 'x-vercel-ip-country'];
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

export function clientIp(h: HeaderBag): string | null {
  const ip = (h.get('fastly-client-ip') || h.get('x-forwarded-for')?.split(',')[0] || '').trim();
  return ip || null;
}

/** ISO country of the request, or null when it cannot be told. */
export async function countryOf(h: HeaderBag): Promise<string | null> {
  for (const name of COUNTRY_HEADERS) {
    const c = h.get(name)?.trim().toUpperCase();
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
  /** Country unknown: buying is allowed after the visitor ticks "I am not a US person". */
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
