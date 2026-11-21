/**
 * ERC-8021 transaction attribution (Builder Codes).
 *
 * Schema 0 layout, appended to calldata and parsed backwards from the end:
 *   txData || codes (ASCII, comma-delimited) || codesLength (1 byte) || schemaId (1 byte, 0x00) || ercMarker (16 bytes, 0x8021 x 8)
 *
 * Sources: ERC-8021 spec (eip.tools/eip/8021, test vector `0xdddddddd62617365617070070080218021802180218021802180218021`),
 * docs.base.org/base-chain/builder-codes/app-developers (`Attribution.toDataSuffix` from `ox/erc8021`;
 * example `bc_b7k3p9da` -> `0x62635f62376b33703964610b0080218021802180218021802180218021`).
 * We delegate to ox's reference implementation and only add validation and helpers.
 */
import { Attribution } from 'ox/erc8021';
import { concat, type Hex } from 'viem';
import { TROPA_BUILDER_CODE } from './constants';

export const ERC8021_MARKER = '0x80218021802180218021802180218021' as const;

export function encodeBuilderSuffix(codes: readonly string[] = [TROPA_BUILDER_CODE]): Hex {
  if (codes.length === 0) throw new Error('encodeBuilderSuffix: at least one code is required');
  for (const code of codes) {
    if (!/^[\x21-\x7e]+$/.test(code) || code.includes(',')) {
      throw new Error(`encodeBuilderSuffix: code "${code}" must be printable ASCII without commas`);
    }
  }
  const joinedLength = codes.join(',').length;
  if (joinedLength > 255) throw new Error('encodeBuilderSuffix: codes exceed 255 bytes');
  return Attribution.toDataSuffix({ codes }) as Hex;
}

/** Suffix for every Tropa Club transaction (buys now, attestations later). */
export const TROPA_SUFFIX: Hex = encodeBuilderSuffix([TROPA_BUILDER_CODE]);

/** Append a suffix once (idempotent). */
export function appendSuffix(data: Hex | undefined, suffix: Hex = TROPA_SUFFIX): Hex {
  const d = (data ?? '0x').toLowerCase() as Hex;
  if (d.endsWith(suffix.slice(2).toLowerCase())) return d;
  return concat([d, suffix]);
}

export interface ParsedAttribution {
  schemaId: number;
  codes: string[];
}

/** Parse an ERC-8021 suffix at the very end of `data`; null if absent or malformed. */
export function parseSuffix(data: Hex): ParsedAttribution | null {
  try {
    const a = Attribution.fromData(data);
    if (!a) return null;
    if ('codes' in a && a.codes) return { schemaId: a.id ?? 0, codes: [...a.codes] };
    // Schema 2 (CBOR): surface app/wallet/service codes as a flat list.
    const s2 = a as { appCode?: string; walletCode?: string; serviceCodes?: readonly string[]; id?: number };
    const codes = [s2.appCode, s2.walletCode, ...(s2.serviceCodes ?? [])].filter((x): x is string => !!x);
    return { schemaId: s2.id ?? 2, codes };
  } catch {
    return null;
  }
}

export function hasBuilderCode(data: Hex, code: string = TROPA_BUILDER_CODE): boolean {
  return parseSuffix(data)?.codes.includes(code) ?? false;
}
