// Which requests this app believes, and which hosts its API answers for. Used by the middleware
// and by the region gate. No Node-only imports: this file runs in the middleware.
//
// The site is served by Firebase Hosting, which forwards to Cloud Run from Google's own proxies
// (seen in the Cloud Run logs: 66.249.82.x, 74.125.212.x), not from its CDN's addresses. Cloud
// Run's front end appends the address of whoever connected to it as the LAST x-forwarded-for
// entry. A client cannot choose that entry. So:
//   via Hosting  = the last x-forwarded-for entry is one of Google's own addresses: inside
//                  goog.json and NOT inside cloud.json (lib/google-ranges.json, both refreshed at
//                  build time). cloud.json is what Google Cloud customers can rent, so a VM or a
//                  load balancer in someone's project does not pass.
// Only then are x-forwarded-host, x-country-code and fastly-client-ip read. The Host rule still
// applies on top: the forwarded host must be one of ours. Any other request, such as one sent
// straight to the *.run.app URL with forged headers, is treated as coming from an unknown host:
// its API calls get 403 and none of its forwarding headers are read.
//
// HOSTING_PEER_CHECK: "enforce" (default), "log" (believe the headers, but log peers that are not
// Google proxies: use this to check the rule on a new revision), or "off". In "enforce" the
// first few refused peers are logged too, so a wrong rule shows up in the logs at once.
import ranges from './google-ranges.json';
import { ipInRanges, parseCidr, type Cidr } from './cidr';

const cidrs = (list: string[]) => list.map(parseCidr).filter((c): c is Cidr => !!c);
const GOOG = cidrs([...ranges.goog.v4, ...ranges.goog.v6]);
const CLOUD = cidrs([...ranges.cloud.v4, ...ranges.cloud.v6]);
const MODE = process.env.HOSTING_PEER_CHECK === 'log' ? 'log' : process.env.HOSTING_PEER_CHECK === 'off' ? 'off' : 'enforce';

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

/** The address that connected to Cloud Run's front end: the last x-forwarded-for entry. */
export function peerIp(h: HeaderBag): string | null {
  const chain = (h.get('x-forwarded-for') || '').split(',').map((s) => s.trim()).filter(Boolean);
  return chain[chain.length - 1] || null;
}

/** One of Google's own addresses (goog.json), and not one a Google Cloud customer can use (cloud.json). */
export const isGoogleProxy = (ip: string | null) => !!ip && ipInRanges(ip, GOOG) && !ipInRanges(ip, CLOUD);

const warned = new Set<string>();
function note(peer: string | null, what: string) {
  const key = String(peer).split(/[.:]/).slice(0, 3).join('.');
  if (warned.size >= 50 || warned.has(key)) return;
  warned.add(key);
  console.warn(`[hosts] peer ${peer} is not a Google proxy address (HOSTING_PEER_CHECK=${MODE}, ${what})`);
}
/** Did this request come through Firebase Hosting? */
export function viaHosting(h: HeaderBag): boolean {
  if (MODE === 'off') return true;
  const peer = peerIp(h);
  if (isGoogleProxy(peer)) return true;
  if (MODE === 'log') {
    note(peer, 'request believed anyway');
    return true;
  }
  // only worth a log line when the request claims to be for one of our hosts
  if (h.get('x-forwarded-host')) note(peer, 'forwarding headers ignored');
  return false;
}

/** A developer's machine: the Host header itself is localhost (Cloud Run never receives that Host). */
const isLocal = (h: HeaderBag) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test((h.get('host') || '').toLowerCase());

/** The public host the visitor asked for. x-forwarded-host is read only on the Hosting path. */
export function publicHost(h: HeaderBag): string {
  const fwd = viaHosting(h) ? h.get('x-forwarded-host') : null;
  return (fwd || h.get('host') || '').split(',')[0].trim().toLowerCase();
}

/** True when the request arrived for one of our own hosts, through Hosting (or on a developer's machine). */
export function allowedHost(h: HeaderBag): boolean {
  if (isLocal(h)) return true;
  return viaHosting(h) && ALLOWED.has(publicHost(h));
}

/** True only for the canonical site (search engines should index nothing else). */
export function canonicalHost(h: HeaderBag): boolean {
  if (isLocal(h)) return true;
  return viaHosting(h) && publicHost(h) === site;
}
