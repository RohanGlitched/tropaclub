// Sign-In With Ethereum (EIP-4361). One free signature proves the wallet is the visitor's; the
// server then keeps a signed, httpOnly cookie. Signatures are checked on Base through the public
// client, so smart wallets (ERC-1271, and ERC-6492 before deployment) work as well as plain ones.
// The cookie is named __session because Firebase Hosting forwards only that cookie to Cloud Run.
import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { getAddress } from 'viem';
import { createSiweMessage } from 'viem/siwe';
import { AlreadyExistsError } from '@tropaclub/clubs';
import { baseClient, within } from './chain';
import { getClubs } from './clubs';
import { isAddress } from '@/lib/format';
import { SITE_URL } from '@/lib/site';

const COOKIE = '__session';
const WEEK = 7 * 24 * 3600;
let fallbackSecret: string | null = null;
function key(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  if (!fallbackSecret) {
    fallbackSecret = randomBytes(32).toString('hex');
    console.warn('[session] SESSION_SECRET is not set: sign-ins last only until this instance restarts');
  }
  return fallbackSecret;
}
const sign = (value: string) => createHmac('sha256', key()).update(value).digest('base64url');
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// The SIWE domain and URI are fixed to the site's own address. They are never read from request headers.
const SITE = new URL(SITE_URL);
const NONCES = 'siweNonces';

/** A short-lived, stateless challenge: the token carries the nonce and is signed by the server. */
export function newChallenge(address: string) {
  const nonce = randomBytes(12).toString('hex');
  const issuedAt = new Date();
  const exp = Math.floor(issuedAt.getTime() / 1000) + 600;
  const message = createSiweMessage({
    address: getAddress(address),
    chainId: 8453,
    domain: SITE.host,
    nonce,
    uri: SITE.origin,
    version: '1',
    statement: 'Sign in to Tropa Club. This only proves the wallet is yours. It is free and moves no funds.',
    issuedAt,
    expirationTime: new Date(exp * 1000),
  });
  const body = `${address.toLowerCase()}|${nonce}|${exp}`;
  return { message, token: `${Buffer.from(body).toString('base64url')}.${sign(body)}` };
}

export async function verifyChallenge(p: { address: string; token: string; message: string; signature: string }): Promise<boolean> {
  const [b64, mac] = p.token.split('.');
  if (!b64 || !mac) return false;
  const body = Buffer.from(b64, 'base64url').toString();
  if (!same(sign(body), mac)) return false;
  const [addr, nonce, exp] = body.split('|');
  if (!addr || !nonce || addr !== p.address.toLowerCase() || Number(exp) < Date.now() / 1000) return false;
  try {
    const good = await within(
      baseClient().verifySiweMessage({ message: p.message, signature: p.signature as `0x${string}`, address: getAddress(addr), domain: SITE.host, nonce }),
      15000,
      'signature check',
    );
    if (!good) return false;
    // Each nonce works once. The first verify writes it; a replay finds it already there.
    // (Firestore: a TTL policy on `expiresAt` clears old ones.) If the store cannot be reached, sign-in fails closed.
    const svc = await getClubs();
    await svc.ctx.store.create(NONCES, nonce, { nonce, wallet: addr, usedAt: Math.floor(Date.now() / 1000), expiresAt: new Date((Number(exp) + 3600) * 1000) });
    return true;
  } catch (e) {
    if (!(e instanceof AlreadyExistsError)) console.warn('[session] sign-in not completed:', (e as Error).message?.slice(0, 120));
    return false;
  }
}

export async function startSession(address: string): Promise<void> {
  const exp = Math.floor(Date.now() / 1000) + WEEK;
  const body = `${address.toLowerCase()}.${exp}`;
  (await cookies()).set(COOKIE, `${body}.${sign(body)}`, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: WEEK });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** The signed-in wallet, lowercase, or null. */
export async function sessionWallet(): Promise<string | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const [addr, exp, mac] = raw.split('.');
  if (!addr || !exp || !mac || !isAddress(addr)) return null;
  if (!same(sign(`${addr}.${exp}`), mac) || Number(exp) < Date.now() / 1000) return null;
  return addr.toLowerCase();
}
