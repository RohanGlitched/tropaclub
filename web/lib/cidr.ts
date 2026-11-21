// IP-in-CIDR matching for IPv4 and IPv6, with no dependencies (it runs in the middleware).

/** An IPv4 address as a 32-bit number, or null. */
export function parseV4(ip: string): bigint | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  let n = 0n;
  for (let i = 1; i <= 4; i++) {
    const o = Number(m[i]);
    if (o > 255) return null;
    n = (n << 8n) | BigInt(o);
  }
  return n;
}

/** An IPv6 address as a 128-bit number, or null. Accepts "::" and a dotted IPv4 tail. */
export function parseV6(ip: string): bigint | null {
  let s = ip.trim().toLowerCase();
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  if (!s.includes(':')) return null;
  // a dotted tail (::ffff:1.2.3.4) becomes two hex groups
  const dot = s.lastIndexOf(':');
  const tail = s.slice(dot + 1);
  if (tail.includes('.')) {
    const v4 = parseV4(tail);
    if (v4 == null) return null;
    s = `${s.slice(0, dot + 1)}${(v4 >> 16n).toString(16)}:${(v4 & 0xffffn).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = halves.length === 2 ? [...head, ...Array<string>(missing).fill('0'), ...rest] : head;
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}

export interface Cidr {
  v: 4 | 6;
  base: bigint;
  bits: number;
}

export function parseCidr(c: string): Cidr | null {
  const [addr, len] = c.trim().split('/');
  const v4 = parseV4(addr);
  const v: 4 | 6 = v4 != null ? 4 : 6;
  const base = v4 ?? parseV6(addr);
  if (base == null) return null;
  const max = v === 4 ? 32 : 128;
  const bits = len === undefined ? max : Number(len);
  if (!Number.isInteger(bits) || bits < 0 || bits > max) return null;
  return { v, base, bits };
}

const V4_MAPPED = 0xffffn << 32n; // ::ffff:0:0/96

/** Is `ip` inside any of the ranges? An IPv4-mapped IPv6 address (::ffff:a.b.c.d) is matched as IPv4. */
export function ipInRanges(ip: string, ranges: readonly Cidr[]): boolean {
  let v: 4 | 6 = 4;
  let n = parseV4(ip.trim());
  if (n == null) {
    n = parseV6(ip);
    if (n == null) return false;
    v = 6;
    if (n >> 32n === V4_MAPPED >> 32n) {
      n &= 0xffffffffn;
      v = 4;
    }
  }
  for (const r of ranges) {
    if (r.v !== v) continue;
    const shift = BigInt((v === 4 ? 32 : 128) - r.bits);
    if (n >> shift === r.base >> shift) return true;
  }
  return false;
}
