// The sign-in cookie's value, without any I/O (lib/server/session.ts does the cookie and the store).
//
//   <wallet>.<expires>.<version>.<mac>    mac = HMAC(<wallet>.<expires>.<version>)
//
// `version` is the wallet's session version in Firestore when the cookie was issued. Signing out
// raises it, so every cookie issued before that stops working, on every device, even a copied one.
// A cookie from before versions existed (<wallet>.<expires>.<mac>) counts as version 0.

export interface SessionToken {
  wallet: string;
  exp: number;
  version: number;
}

export function encodeSession(t: SessionToken, sign: (body: string) => string): string {
  const body = `${t.wallet.toLowerCase()}.${t.exp}.${t.version}`;
  return `${body}.${sign(body)}`;
}

/** The token if the value is well formed, correctly signed and not expired; null otherwise. */
export function parseSession(raw: string | undefined | null, check: (body: string, mac: string) => boolean, nowSec: number): SessionToken | null {
  if (!raw) return null;
  const parts = raw.split('.');
  let wallet: string, exp: string, version: string, mac: string, body: string;
  if (parts.length === 4) {
    [wallet, exp, version, mac] = parts as [string, string, string, string];
    body = `${wallet}.${exp}.${version}`;
  } else if (parts.length === 3) {
    [wallet, exp, mac] = parts as [string, string, string];
    version = '0';
    body = `${wallet}.${exp}`;
  } else return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet) || !/^\d{1,12}$/.test(exp) || !/^\d{1,9}$/.test(version) || !mac) return null;
  if (!check(body, mac)) return null;
  if (Number(exp) < nowSec) return null;
  return { wallet: wallet.toLowerCase(), exp: Number(exp), version: Number(version) };
}
