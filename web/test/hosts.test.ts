import { describe, expect, it } from 'vitest';
import { ipInRanges, parseCidr, parseV4, parseV6, type Cidr } from '../lib/cidr';
import { allowedHost, canonicalHost, isGoogleProxy, publicHost, viaHosting } from '../lib/hosts';

const R = (...c: string[]) => c.map(parseCidr).filter((x): x is Cidr => !!x);
const H = (o: Record<string, string>) => ({ get: (n: string) => o[n.toLowerCase()] ?? null });

describe('CIDR matcher', () => {
  it('parses IPv4 and rejects junk', () => {
    expect(parseV4('151.101.1.1')).toBe(0x97650101n);
    for (const bad of ['256.1.1.1', '1.2.3', '1.2.3.4.5', 'a.b.c.d', '', '1.2.3.4/8']) expect(parseV4(bad)).toBeNull();
  });
  it('parses IPv6 forms', () => {
    expect(parseV6('::1')).toBe(1n);
    expect(parseV6('2a04:4e42::1')).toBe((0x2a04n << 112n) | (0x4e42n << 96n) | 1n);
    expect(parseV6('2a04:4e42:0:0:0:0:0:1')).toBe(parseV6('2a04:4e42::1'));
    expect(parseV6('::ffff:151.101.1.1')).toBe((0xffffn << 32n) | 0x97650101n);
    for (const bad of ['1::2::3', '2a04:4e42', 'g::1', '1:2:3:4:5:6:7:8:9', '12345::']) expect(parseV6(bad)).toBeNull();
  });
  it('matches IPv4 ranges at their edges', () => {
    const r = R('151.101.0.0/16', '103.244.50.0/24', '167.82.128.0/20');
    expect(ipInRanges('151.101.0.0', r)).toBe(true);
    expect(ipInRanges('151.101.255.255', r)).toBe(true);
    expect(ipInRanges('151.100.255.255', r)).toBe(false);
    expect(ipInRanges('151.102.0.0', r)).toBe(false);
    expect(ipInRanges('103.244.50.200', r)).toBe(true);
    expect(ipInRanges('103.244.51.0', r)).toBe(false);
    expect(ipInRanges('167.82.143.255', r)).toBe(true);
    expect(ipInRanges('167.82.144.0', r)).toBe(false);
  });
  it('matches IPv6 ranges, including an odd prefix length', () => {
    const r = R('2a04:4e42::/31');
    expect(ipInRanges('2a04:4e42::1', r)).toBe(true);
    expect(ipInRanges('2a04:4e43:ffff::1', r)).toBe(true);
    expect(ipInRanges('2a04:4e44::1', r)).toBe(false);
    expect(ipInRanges('2a04:4e41:ffff:ffff::', r)).toBe(false);
  });
  it('treats an IPv4-mapped IPv6 address as IPv4, and never crosses families', () => {
    const r = R('151.101.0.0/16', '2a04:4e40::/32');
    expect(ipInRanges('::ffff:151.101.2.3', r)).toBe(true);
    expect(ipInRanges('::ffff:8.8.8.8', r)).toBe(false);
    expect(ipInRanges('2a04:4e40::9', r)).toBe(true);
    expect(ipInRanges('8.8.8.8', r)).toBe(false);
  });
  it('handles /0, /32, a bare address, and garbage', () => {
    expect(ipInRanges('9.9.9.9', R('0.0.0.0/0'))).toBe(true);
    expect(ipInRanges('9.9.9.9', R('9.9.9.9/32'))).toBe(true);
    expect(ipInRanges('9.9.9.8', R('9.9.9.9'))).toBe(false);
    expect(ipInRanges('not an ip', R('0.0.0.0/0'))).toBe(false);
    expect(ipInRanges('', R('0.0.0.0/0'))).toBe(false);
    expect(parseCidr('1.2.3.4/33')).toBeNull();
    expect(parseCidr('::/129')).toBeNull();
  });
});

describe('via Hosting', () => {
  // the peers Cloud Run logged for real Hosting requests
  const PROXY = '66.249.82.166';
  const PROXY2 = '74.125.212.3';
  const CLOUD_VM = '34.117.1.1'; // in cloud.json: a customer's VM or load balancer
  const HOME = '49.36.0.1';
  it('trusts Google proxy addresses and nothing a customer or a stranger can send from', () => {
    for (const ip of [PROXY, '66.249.82.67', PROXY2, `::ffff:${PROXY}`]) expect(isGoogleProxy(ip)).toBe(true);
    for (const ip of [CLOUD_VM, '35.190.0.1', '2600:1900:8000::1', HOME, '203.0.113.9', '151.101.1.57', '8.8.4.300', '', null]) expect(isGoogleProxy(ip)).toBe(false);
  });
  it('believes forwarding headers only when the last x-forwarded-for entry is a Google proxy', () => {
    for (const peer of [PROXY, PROXY2]) {
      const real = H({ host: 'tropa-web-abc.a.run.app', 'x-forwarded-host': 'tropaclub.xyz', 'x-forwarded-for': `${HOME}, ${peer}` });
      expect(viaHosting(real)).toBe(true);
      expect(publicHost(real)).toBe('tropaclub.xyz');
      expect(allowedHost(real)).toBe(true);
      expect(canonicalHost(real)).toBe(true);
    }
  });
  it('rejects a direct run.app request that forges every header', () => {
    // the attacker writes a proxy address first; Cloud Run appends the attacker's own address last
    for (const attacker of [HOME, CLOUD_VM]) {
      const forged = H({ host: 'tropa-web-abc.a.run.app', 'x-forwarded-host': 'tropaclub.xyz', 'x-country-code': 'BR', 'fastly-client-ip': '200.1.1.1', 'x-forwarded-for': `${PROXY}, ${attacker}` });
      expect(viaHosting(forged)).toBe(false);
      expect(publicHost(forged)).toBe('tropa-web-abc.a.run.app');
      expect(allowedHost(forged)).toBe(false);
      expect(canonicalHost(forged)).toBe(false);
    }
  });
  it('keeps the Host rule: no x-forwarded-for, another Hosting site, or the bare run.app host are refused', () => {
    expect(allowedHost(H({ host: 'tropa-web-abc.a.run.app', 'x-forwarded-host': 'tropaclub.xyz' }))).toBe(false);
    expect(allowedHost(H({ host: 'tropa-web-abc.a.run.app', 'x-forwarded-host': 'someone-else.web.app', 'x-forwarded-for': `1.1.1.1, ${PROXY}` }))).toBe(false);
    expect(allowedHost(H({ host: 'tropa-web-abc.a.run.app', 'x-forwarded-for': `1.1.1.1, ${PROXY}` }))).toBe(false);
  });
  it('allows a developer machine by its Host header', () => {
    expect(allowedHost(H({ host: 'localhost:3055' }))).toBe(true);
    expect(allowedHost(H({ host: 'localhost.evil.example' }))).toBe(false);
  });
});
