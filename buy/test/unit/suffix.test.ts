import { describe, expect, it } from 'vitest';
import { toHex } from 'viem';
import { ERC8021_MARKER, TROPA_SUFFIX, appendSuffix, encodeBuilderSuffix, hasBuilderCode, parseSuffix } from '../../src/suffix';

describe('ERC-8021 builder suffix', () => {
  it('matches the ERC-8021 spec schema-0 test vector', () => {
    // eip.tools/eip/8021: txData 0xdddddddd + codes ["baseapp"]
    expect(appendSuffix('0xdddddddd', encodeBuilderSuffix(['baseapp']))).toBe(
      '0xdddddddd62617365617070070080218021802180218021802180218021',
    );
  });

  it('matches the Base docs example (bc_b7k3p9da)', () => {
    // docs.base.org/base-chain/builder-codes/app-developers
    expect(encodeBuilderSuffix(['bc_b7k3p9da'])).toBe('0x62635f62376b33703964610b0080218021802180218021802180218021');
  });

  it('matches the multi-code vector (ox reference tests)', () => {
    expect(encodeBuilderSuffix(['baseapp', 'morpho'])).toBe('0x626173656170702c6d6f7270686f0e0080218021802180218021802180218021');
  });

  it('encodes the Tropa Club code bc_vdp89s9b', () => {
    const expected = `${toHex('bc_vdp89s9b')}0b00${ERC8021_MARKER.slice(2)}`;
    expect(TROPA_SUFFIX).toBe(expected);
    expect(TROPA_SUFFIX).toBe('0x62635f76647038397339620b0080218021802180218021802180218021');
    expect((TROPA_SUFFIX.length - 2) / 2).toBe(11 + 1 + 1 + 16);
  });

  it('round-trips and detects the code at the end of calldata', () => {
    const data = appendSuffix('0xa9059cbb' + '00'.repeat(64) as `0x${string}`);
    expect(parseSuffix(data)).toEqual({ schemaId: 0, codes: ['bc_vdp89s9b'] });
    expect(hasBuilderCode(data)).toBe(true);
    expect(hasBuilderCode('0xa9059cbb')).toBe(false);
  });

  it('is idempotent', () => {
    const once = appendSuffix('0x1234');
    expect(appendSuffix(once)).toBe(once);
  });

  it('rejects an unknown schema id (spec vector) and bad codes', () => {
    expect(parseSuffix('0xddddddddff80218021802180218021802180218021')).toBeNull();
    expect(() => encodeBuilderSuffix(['a,b'])).toThrow();
    expect(() => encodeBuilderSuffix(['has space'])).toThrow();
    expect(() => encodeBuilderSuffix([])).toThrow();
  });

  it('suffix inside calldata but not at the end is not attribution', () => {
    const inner = appendSuffix('0x1234');
    expect(parseSuffix(`${inner}${'00'.repeat(30)}` as `0x${string}`)).toBeNull();
  });
});
