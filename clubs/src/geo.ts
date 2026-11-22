/**
 * Geo: buy-gate policy and the country -> region map used by pick-up matching.
 *
 * The buy flow is blocked for:
 *   - the US and its territories (hackathon eligibility: projects that enable trading for US users
 *     are ineligible; buyers also self-certify they are not US persons),
 *   - countries under comprehensive OFAC sanctions (CU, IR, KP, SY), plus RU and BY: Coinbase
 *     restricts stock tokens there,
 *   - Tor exit traffic (country code T1),
 *   - a country that cannot be told: blocked for buying (never for browsing).
 * GEO_BLOCKED="NG,..." adds codes to that list; it cannot remove any. Tests pass an explicit list.
 * Country comes from the edge header only, and is never stored against a wallet.
 */

export const US_AND_TERRITORIES = ['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM'] as const;
/** Comprehensive OFAC sanctions, plus Russia and Belarus. */
export const SANCTIONED_COUNTRIES = ['CU', 'IR', 'KP', 'SY', 'RU', 'BY'] as const;
/** The pseudo-country edges and DB-IP use for Tor exit nodes. */
export const TOR_EXIT_COUNTRY = 'T1';
export const ALWAYS_BLOCKED: readonly string[] = [...US_AND_TERRITORIES, ...SANCTIONED_COUNTRIES, TOR_EXIT_COUNTRY];

export interface GeoPolicy {
  blocked: ReadonlySet<string>;
  /** What to do when no country header is present (local dev, misconfigured edge). */
  unknown: 'allow' | 'block';
}

export function createGeoPolicy(opts: { blocked?: readonly string[]; unknown?: 'allow' | 'block' } = {}): GeoPolicy {
  const fromEnv = process.env.GEO_BLOCKED?.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const unknownEnv = process.env.GEO_UNKNOWN === 'block' ? 'block' : process.env.GEO_UNKNOWN === 'allow' ? 'allow' : undefined;
  return {
    blocked: new Set((opts.blocked ?? [...ALWAYS_BLOCKED, ...(fromEnv ?? [])]).map((c) => c.toUpperCase())),
    unknown: opts.unknown ?? unknownEnv ?? 'block',
  };
}

/** Headers set by Google Cloud LB / App Engine, Cloudflare, Vercel, or our own edge (x-country-code). */
export const COUNTRY_HEADERS = ['x-country-code', 'x-appengine-country', 'x-client-geo-country', 'cf-ipcountry', 'x-vercel-ip-country'] as const;

type HeaderBag = { get(name: string): string | null } | Record<string, string | string[] | undefined>;

export function countryFromHeaders(h: HeaderBag): string | null {
  for (const name of COUNTRY_HEADERS) {
    let v: string | null | undefined;
    if (typeof (h as { get?: unknown }).get === 'function') v = (h as { get(n: string): string | null }).get(name);
    else {
      const raw = (h as Record<string, string | string[] | undefined>)[name];
      v = Array.isArray(raw) ? raw[0] : raw;
    }
    const c = v?.trim().toUpperCase();
    // ZZ / XX = unknown. T1 = Tor exit: kept, so the gate blocks it.
    if (c && /^[A-Z][A-Z0-9]$/.test(c) && c !== 'ZZ' && c !== 'XX') return c;
  }
  return null;
}

export interface GateDecision {
  allowed: boolean;
  country: string | null;
  reason: 'ok' | 'blocked_country' | 'unknown_country' | 'self_certified_us';
}

/**
 * Buy gate. `selfCertifiedUsPerson` is the user's own answer to "Are you a US person?" (true blocks).
 * Call-ups and every buy call-to-action use the same gate (hidden where blocked).
 */
/**
 * REGION_GATE=off turns the country part of the gate off, for local development only: it is
 * ignored when NODE_ENV is production or the code runs on Cloud Run (K_SERVICE is set).
 */
export const regionGateOff = () => process.env.REGION_GATE === 'off' && process.env.NODE_ENV !== 'production' && !process.env.K_SERVICE;

export function buyGate(policy: GeoPolicy, country: string | null, opts: { selfCertifiedUsPerson?: boolean } = {}): GateDecision {
  if (opts.selfCertifiedUsPerson) return { allowed: false, country, reason: 'self_certified_us' };
  if (regionGateOff()) return { allowed: true, country, reason: 'ok' };
  if (!country) return { allowed: policy.unknown === 'allow', country, reason: policy.unknown === 'allow' ? 'ok' : 'unknown_country' };
  if (policy.blocked.has(country)) return { allowed: false, country, reason: 'blocked_country' };
  return { allowed: true, country, reason: 'ok' };
}

// ---------------------------------------------------------------- regions (pick-up matching only)

export type Region =
  | 'Latin America'
  | 'North America'
  | 'Europe'
  | 'Middle East & North Africa'
  | 'Sub-Saharan Africa'
  | 'South Asia'
  | 'Southeast Asia'
  | 'East Asia'
  | 'Oceania'
  | 'Central Asia';

const R: Record<Region, string> = {
  'Latin America':
    'AR BO BR CL CO CR CU DO EC SV GT HN MX NI PA PY PE UY VE BZ GY SR JM TT HT BS BB LC VC GD AG DM KN AW CW BQ SX MF BL GP MQ GF KY TC VG AI MS',
  'North America': 'US CA PR GU VI AS MP UM BM GL PM',
  Europe:
    'AD AL AT BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GI GR HR HU IE IM IS IT JE GG LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SK SM UA VA XK AX',
  'Middle East & North Africa': 'AE BH DZ EG IL IQ IR JO KW LB LY MA OM PS QA SA SY TN TR YE EH',
  'Sub-Saharan Africa':
    'AO BF BI BJ BW CD CF CG CI CM CV DJ ER ET GA GH GM GN GQ GW KE KM LR LS MG ML MR MU MW MZ NA NE NG RW SC SD SL SN SO SS ST SZ TD TG TZ UG ZA ZM ZW RE YT SH',
  'South Asia': 'AF BD BT IN LK MV NP PK',
  'Southeast Asia': 'BN ID KH LA MM MY PH SG TH TL VN',
  'East Asia': 'CN HK JP KP KR MN MO TW',
  Oceania: 'AU FJ KI MH FM NR NZ PW PG WS SB TO TV VU NC PF CK NU',
  'Central Asia': 'KZ KG TJ TM UZ AM AZ GE',
};
const COUNTRY_REGION = new Map<string, Region>();
for (const [region, codes] of Object.entries(R) as [Region, string][]) for (const c of codes.split(' ')) COUNTRY_REGION.set(c, region);

export const GLOBAL_REGION = 'Global';
export function regionOf(country: string | null | undefined): Region | typeof GLOBAL_REGION {
  return (country && COUNTRY_REGION.get(country.toUpperCase())) || GLOBAL_REGION;
}
