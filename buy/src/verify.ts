/**
 * Server-side attribution check: is our ERC-8021 suffix at the end of the tx input, or, for ERC-4337,
 * at the end of the UserOperation callData (matched to the receipt's UserOperationEvent by sender+nonce)?
 */
import { type Address, type Hex, type PublicClient, decodeEventLog, decodeFunctionData, getAddress } from 'viem';
import { ENTRYPOINTS, TROPA_BUILDER_CODE, entryPointAbi } from './constants';
import { ERC8021_MARKER, parseSuffix } from './suffix';

export interface AttributionResult {
  attributed: boolean;
  codes: string[];
  via: 'tx' | 'userop' | 'none';
  /** Suffix bytes were found inside the input but not at the end of the attributed field (e.g. an inner call of a 7702 batch). */
  innerOnly?: boolean;
  userOps?: { sender: Address; nonce: bigint; codes: string[]; attributed: boolean }[];
  from?: Address;
}

export function attributionFromData(data: Hex, code: string = TROPA_BUILDER_CODE): { attributed: boolean; codes: string[] } {
  const parsed = parseSuffix(data);
  const codes = parsed?.codes ?? [];
  return { attributed: codes.includes(code), codes };
}

function extractUserOps(input: Hex): { sender: Address; nonce: bigint; callData: Hex }[] | null {
  try {
    const { functionName, args } = decodeFunctionData({ abi: entryPointAbi, data: input });
    if (functionName !== 'handleOps') return null;
    return (args[0] as any[]).map((op) => ({ sender: getAddress(op.sender), nonce: op.nonce, callData: op.callData }));
  } catch {
    return null;
  }
}

export async function verifyAttribution(
  txHash: Hex,
  opts: { client: PublicClient; code?: string },
): Promise<AttributionResult> {
  const code = opts.code ?? TROPA_BUILDER_CODE;
  const tx = await opts.client.getTransaction({ hash: txHash });
  const input = tx.input;
  const direct = attributionFromData(input, code);
  if (direct.codes.length) return { ...direct, via: 'tx', from: tx.from };

  // ERC-4337: decode handleOps (EntryPoint v0.6 / v0.7 / v0.8) and match the UserOperationEvent(s).
  const toEp = tx.to ? ENTRYPOINTS[tx.to.toLowerCase()] : undefined;
  const receipt = await opts.client.getTransactionReceipt({ hash: txHash });
  const events = receipt.logs
    .filter((l) => ENTRYPOINTS[l.address.toLowerCase()])
    .map((l) => {
      try {
        const ev = decodeEventLog({ abi: entryPointAbi, data: l.data, topics: l.topics });
        return ev.eventName === 'UserOperationEvent' ? (ev.args as { sender: Address; nonce: bigint; success: boolean }) : null;
      } catch {
        return null;
      }
    })
    .filter((x): x is { sender: Address; nonce: bigint; success: boolean } => !!x);

  const ops = toEp || events.length ? extractUserOps(input) : null;
  if (ops && ops.length) {
    const matched = events.length
      ? ops.filter((o) => events.some((e) => e.sender.toLowerCase() === o.sender.toLowerCase() && e.nonce === o.nonce))
      : ops;
    const userOps = matched.map((o) => ({ sender: o.sender, nonce: o.nonce, ...attributionFromData(o.callData, code) }));
    const hit = userOps.find((u) => u.attributed) ?? userOps.find((u) => u.codes.length);
    if (hit) return { attributed: hit.attributed, codes: hit.codes, via: 'userop', userOps, from: hit.sender };
    return { attributed: false, codes: [], via: 'none', userOps, innerOnly: input.toLowerCase().includes(ERC8021_MARKER.slice(2)), from: tx.from };
  }

  return {
    attributed: false,
    codes: [],
    via: 'none',
    innerOnly: input.toLowerCase().includes(ERC8021_MARKER.slice(2)),
    from: tx.from,
  };
}
