// The scout code a visitor arrived with (tropaclub.xyz/j/<code>, or ?s=<code> on any shared link).
// Kept in a first-party cookie, first touch only, and sent with the first club join, pick-up seat or
// new club. Firebase Hosting forwards no cookie but __session to the server, so the browser sends
// the code itself; the server stores the referral once per wallet and never changes it.
export const SCOUT_COOKIE = 'tc_scout';
const VALID = /^[0-9a-z]{6,12}$/;

export function readScout(): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(/(?:^|; )tc_scout=([0-9a-z]{6,12})(?:;|$)/);
  return m ? m[1]! : null;
}

/** Remember the code in this URL, unless one is already remembered (first touch wins). */
export function captureScout(loc: { pathname: string; search: string }): void {
  if (readScout()) return;
  const fromPath = loc.pathname.match(/^\/j\/([0-9a-zA-Z]{6,12})\/?$/)?.[1];
  const fromQuery = new URLSearchParams(loc.search).get('s');
  const code = (fromPath ?? fromQuery ?? '').toLowerCase();
  if (!VALID.test(code)) return;
  document.cookie = `${SCOUT_COOKIE}=${code}; Path=/; Max-Age=${30 * 86400}; SameSite=Lax; Secure`;
}
