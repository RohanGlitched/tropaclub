import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSiweMessage } from 'viem/siwe';
import { GUARD_BPS, KYBER_ROUTER, SLIPSTREAM_FACTORIES } from '../../buy/src/constants';
import { BUILDER, BUY_ROUTER, GUARD_PCT, SIWE_CHAIN_ID, SIWE_STATEMENT, SLIPSTREAM_FACTORY_LIST, siwePreview } from '../lib/site';
import { PRE_IPO, isPreIpo, preIpoPriceNote } from '../lib/preipo';
import { worthNowSource } from '../lib/statement-history';

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

// The trust pages copy a few facts so that pages without wallet code can show them. They must not drift.
describe('facts shown before connecting', () => {
  it('pins the same router, pool factories and guard as the buy engine', () => {
    expect(BUY_ROUTER).toBe(KYBER_ROUTER);
    expect([...SLIPSTREAM_FACTORY_LIST]).toEqual([...SLIPSTREAM_FACTORIES]);
    expect(GUARD_PCT * 100).toBe(GUARD_BPS);
  });

  it('previews the sign-in message the server builds', () => {
    const session = readFileSync(path.join(here, '../lib/server/session.ts'), 'utf8');
    expect(session).toContain(`statement: '${SIWE_STATEMENT}'`);
    expect(session).toContain(`chainId: ${SIWE_CHAIN_ID}`);
    const real = createSiweMessage({
      address: '0x0000000000000000000000000000000000000001',
      chainId: SIWE_CHAIN_ID,
      domain: 'tropaclub.xyz',
      nonce: 'abcdef123456',
      uri: 'https://tropaclub.xyz',
      version: '1',
      statement: SIWE_STATEMENT,
      issuedAt: new Date('2026-11-24T14:30:00Z'),
      expirationTime: new Date('2026-11-24T14:40:00Z'),
    }).split('\n');
    const shown = siwePreview('https://tropaclub.xyz').split('\n');
    expect(shown).toHaveLength(real.length);
    // same lines, field for field; only the values that differ per sign-in are placeholders
    shown.forEach((line, i) => {
      if (line.includes('<')) expect(line.split(':')[0]).toBe(i === 1 ? '<your wallet address>' : real[i].split(':')[0]);
      else expect(line).toBe(real[i]);
    });
  });

  it('shows no builder name or email until one is filled in', () => {
    for (const v of [BUILDER.name, BUILDER.email]) expect(v === null || (typeof v === 'string' && v.trim().length > 0)).toBe(true);
  });
});

describe('pre-IPO list', () => {
  it('is one set and its price note follows the index', () => {
    expect(isPreIpo('NVDAc')).toBe(false);
    for (const s of PRE_IPO) expect(isPreIpo(s)).toBe(true);
    expect(preIpoPriceNote({ symbol: 'XYZc', priceUsd: 10, priceSource: 'dex' })).toMatch(/pool on Base/);
    expect(preIpoPriceNote({ symbol: 'XYZc', priceUsd: 10, priceSource: 'reference' })).toMatch(/reference value/);
    expect(preIpoPriceNote({ symbol: 'XYZc', priceUsd: null, priceSource: null })).toMatch(/no price/);
  });
});

describe('worth-now price source', () => {
  it('names one source plainly and several by token', () => {
    expect(worthNowSource(['NVDAc', 'NVDAc'], { NVDAc: 'dex' }, '2026-11-22T06:18:00.000Z')).toBe('Priced at the exchange pool price on Base, as counted 22 Nov 2026, 06:18 UTC.');
    const mixed = worthNowSource(['NVDAc', 'RBLXc', 'ZZZc'], { NVDAc: 'dex', RBLXc: 'reference' }, '2026-11-22T06:18:00.000Z')!;
    expect(mixed).toContain('exchange pool price on Base (NVDAc)');
    expect(mixed).toContain('(RBLXc)');
    expect(mixed).toContain('Chainlink price, or the last recorded price (ZZZc)');
    expect(worthNowSource([], {}, null)).toBeNull();
  });
});
