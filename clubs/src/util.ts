import { createHmac, randomBytes } from 'node:crypto';

export const nowSec = () => Math.floor(Date.now() / 1000);
export const HOUR = 3600;
export const DAY = 86_400;

export function normAddr(a: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new ClubsError('bad_address', `not an address: ${a}`);
  return a.toLowerCase();
}
export const isAddr = (a: unknown): a is string => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
export const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
export function normHash(h: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(h)) throw new ClubsError('bad_tx_hash', `not a tx hash: ${h}`);
  return h.toLowerCase();
}

export class ClubsError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = 'ClubsError';
  }
}

/** 32-bit FNV-1a. */
export function fnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic PRNG (mulberry32). */
export function seededRandom(seed: string | number): () => number {
  let a = typeof seed === 'number' ? seed >>> 0 : fnv1a(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(arr: readonly T[], seed: string): T[] {
  const out = [...arr];
  const rnd = seededRandom(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

// Crockford base32 without I, L, O, U.
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function randomCode(len = 8): string {
  const bytes = randomBytes(len);
  let s = '';
  for (let i = 0; i < len; i++) s += B32[bytes[i]! % 32];
  return s;
}
export const newId = (prefix: string) => `${prefix}_${randomCode(12).toLowerCase()}`;
export const randomHex = (bytes = 16) => randomBytes(bytes).toString('hex');

export function hmac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex').slice(0, 32);
}

export const round = (x: number, dp = 4) => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};

/** Raw B20 units (8 decimals) to whole tokens as a float, for USD math only. */
export const RAW_PER_TOKEN = 100_000_000n;
export const rawToTokens = (raw: bigint) => Number(raw) / 1e8;
