// Which hosts this app answers API calls for. Used by the middleware and by the region gate.
//
// The site is served by Firebase Hosting, which forwards to Cloud Run and puts the public host in
// x-forwarded-host. Firebase Hosting overwrites client-supplied x-forwarded-for, fastly-client-ip and
// x-country-code (checked against the live site), so those are only believed on that path. The bare
// *.run.app URL is not an allowed host: its API answers 403 and its geo headers are ignored.
// No environment access at module scope beyond SITE_URL, so this file is safe in the middleware.

const site = (() => {
  try {
    return new URL(process.env.SITE_URL || 'https://tropaclub.xyz').host.toLowerCase();
  } catch {
    return 'tropaclub.xyz';
  }
})();
const extra = (process.env.ALLOWED_HOSTS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
const ALLOWED = new Set([site, site.startsWith('www.') ? site.slice(4) : `www.${site}`, 'tropaclub.xyz', 'www.tropaclub.xyz', ...extra]);

type HeaderBag = { get(name: string): string | null };

/** The public host the visitor asked for. */
export function publicHost(h: HeaderBag): string {
  return (h.get('x-forwarded-host') || h.get('host') || '').split(',')[0].trim().toLowerCase();
}

/** A developer's machine: the Host header itself is localhost (Cloud Run can never receive that Host). */
const isLocal = (h: HeaderBag) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test((h.get('host') || '').toLowerCase());

/** True when the request arrived for one of our own hosts. */
export function allowedHost(h: HeaderBag): boolean {
  return ALLOWED.has(publicHost(h)) || isLocal(h);
}

/** True only for the canonical site (search engines should index nothing else). */
export function canonicalHost(h: HeaderBag): boolean {
  const host = publicHost(h);
  return host === site || isLocal(h);
}
