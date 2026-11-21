import { describe, expect, it } from 'vitest';
import { buyGate, countryFromHeaders, createGeoPolicy, regionOf } from '../src/geo';
import { legUsd, parseTransfers, paymentLeg, proceedsLeg, stockLegs } from '../src/chain/receipt';
import { USDC_ADDRESS, WETH_ADDRESS, isStockToken } from '../src/chain/types';
import { POOL, TOK, addr, transferLog } from './helpers';

describe('geo', () => {
  const policy = createGeoPolicy({ unknown: 'allow' });
  it('blocks the US and its territories only (owner decision)', () => {
    for (const c of ['US', 'PR', 'GU', 'VI', 'AS', 'MP', 'UM']) expect(buyGate(policy, c).allowed).toBe(false);
    for (const c of ['IN', 'GB', 'CA', 'NG', 'BR', 'PH', 'AR', 'DE']) expect(buyGate(policy, c).allowed).toBe(true);
  });
  it('is pluggable: more countries can be added later', () => {
    const p = createGeoPolicy({ blocked: ['US', 'PR', 'NG'], unknown: 'block' });
    expect(buyGate(p, 'NG').reason).toBe('blocked_country');
    expect(buyGate(p, null).allowed).toBe(false);
    expect(buyGate(policy, null).allowed).toBe(true);
  });
  it('self-certified US persons are blocked anywhere', () => {
    expect(buyGate(policy, 'BR', { selfCertifiedUsPerson: true })).toMatchObject({ allowed: false, reason: 'self_certified_us' });
  });
  it('reads the country from edge headers (Headers or plain object), ignoring unknown codes', () => {
    expect(countryFromHeaders(new Headers({ 'x-appengine-country': 'br' }))).toBe('BR');
    expect(countryFromHeaders({ 'cf-ipcountry': 'XX', 'x-vercel-ip-country': 'ph' })).toBe('PH');
    expect(countryFromHeaders({ 'cf-ipcountry': 'T1' })).toBeNull();
    expect(countryFromHeaders({})).toBeNull();
  });
  it('maps countries to regions for matching', () => {
    expect(regionOf('BR')).toBe('Latin America');
    expect(regionOf('NG')).toBe('Sub-Saharan Africa');
    expect(regionOf('PH')).toBe('Southeast Asia');
    expect(regionOf('ZZ')).toBe('Global');
    expect(regionOf(null)).toBe('Global');
  });
});

describe('receipt parsing', () => {
  const w = addr(0x111);
  it('recognises B20 stock token addresses', () => {
    expect(isStockToken(TOK.NVDAc)).toBe(true);
    expect(isStockToken('0xB20000000000000000000017BB66E9301E913A99')).toBe(true);
    expect(isStockToken(USDC_ADDRESS)).toBe(false);
  });
  it('finds the stock leg (summing split router legs) and the USDC payment', () => {
    const logs = [
      transferLog(USDC_ADDRESS, w, POOL, 10_000_000n, 0),
      transferLog(TOK.NVDAc, POOL, w, 4_000_000n, 1),
      transferLog(TOK.NVDAc, POOL, w, 3_650_616n, 2),
    ];
    const ts = parseTransfers(logs);
    expect(stockLegs(ts, w)).toEqual([{ token: TOK.NVDAc, raw: 7_650_616n, logIndexes: [1, 2] }]);
    const pay = paymentLeg(ts, w, null)!;
    expect(pay).toEqual({ source: 'usdc', amount: 10_000_000n });
    expect(legUsd(pay, null)).toBe(10);
  });
  it('nets USDC refunds, falls back to WETH and then native ETH value', () => {
    const ts = parseTransfers([transferLog(USDC_ADDRESS, w, POOL, 10_500_000n, 0), transferLog(USDC_ADDRESS, POOL, w, 500_000n, 1)]);
    expect(paymentLeg(ts, w, null)!.amount).toBe(10_000_000n);
    const weth = parseTransfers([transferLog(WETH_ADDRESS, w, POOL, 10n ** 16n, 0)]);
    expect(legUsd(paymentLeg(weth, w, null)!, 3000)).toBeCloseTo(30);
    const eth = paymentLeg([], w, { from: w, to: POOL, value: 2n * 10n ** 15n, input: '0x', blockNumber: 1n })!;
    expect(eth.source).toBe('eth');
    expect(legUsd(eth, 3000)).toBeCloseTo(6);
    expect(paymentLeg([], w, null)).toBeNull();
  });
  it('finds sale proceeds', () => {
    const ts = parseTransfers([transferLog(TOK.NVDAc, w, POOL, 100n, 0), transferLog(USDC_ADDRESS, POOL, w, 12_340_000n, 1)]);
    expect(legUsd(proceedsLeg(ts, w)!, null)).toBeCloseTo(12.34);
  });
});
