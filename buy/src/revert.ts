/** Decode a revert (B20 custom errors, Error(string), Panic) into one plain sentence for the UI. */
import { type Hex, decodeErrorResult, formatUnits, parseAbi } from 'viem';
import { POLICY_SCOPES, b20ErrorsAbi } from './constants';

export type RevertKind =
  | 'policy'
  | 'paused'
  | 'allowance'
  | 'balance'
  | 'slippage'
  | 'blacklisted'
  | 'expired'
  | 'receiver'
  | 'unknown';

export interface DecodedRevert {
  kind: RevertKind;
  sentence: string;
  errorName?: string;
  raw?: Hex;
  detail?: string;
}

const genericAbi = parseAbi(['error Error(string)', 'error Panic(uint256)']);
const scopeNames: Record<string, string> = Object.fromEntries(
  Object.entries(POLICY_SCOPES).map(([k, v]) => [v.toLowerCase(), k]),
);
const scopeWho: Record<string, string> = {
  TRANSFER_SENDER_POLICY: 'the sender',
  TRANSFER_RECEIVER_POLICY: 'the receiving wallet',
  TRANSFER_EXECUTOR_POLICY: 'the contract moving the tokens',
};
const PAUSE_FEATURES = ['transfers', 'minting', 'burning', 'seizing'];

const SLIPPAGE_RE = /return amount is not enough|too little received|insufficient output|min(imum)?[ _-]?(return|out|amount)|slippage|amountoutmin|price ?impact|INSUFFICIENT_OUTPUT/i;

function fromString(msg: string, raw?: Hex): DecodedRevert {
  const m = msg.toLowerCase();
  if (SLIPPAGE_RE.test(msg))
    return { kind: 'slippage', sentence: 'The price moved and you would get fewer shares than the 1.5% guard allows, so the buy was stopped before any money moved.', errorName: 'Error', raw, detail: msg };
  if (m.includes('transfer_from_failed') || m.includes('transferfrom failed') || m.trim() === 'stf')
    return { kind: 'allowance', sentence: 'The router could not take your payment token: it is not approved yet (or the balance is short), so approve first, then buy.', errorName: 'Error', raw, detail: msg };
  if (m.includes('exceeds allowance') || m.includes('insufficient allowance') || m.includes('allowance'))
    return { kind: 'allowance', sentence: 'The swap router is not approved to spend enough of your token yet; approve first, then buy.', errorName: 'Error', raw, detail: msg };
  if (m.includes('exceeds balance') || m.includes('insufficient balance'))
    return { kind: 'balance', sentence: 'Your wallet does not hold enough of the token you are paying with.', errorName: 'Error', raw, detail: msg };
  if (m.includes('blacklisted'))
    return { kind: 'blacklisted', sentence: 'USDC has blocked one of the addresses in this swap, so it cannot go through.', errorName: 'Error', raw, detail: msg };
  if (m.includes('paused'))
    return { kind: 'paused', sentence: 'One of the tokens in this swap is paused right now, so buys are on hold.', errorName: 'Error', raw, detail: msg };
  if (m.includes('expired') || m.includes('deadline'))
    return { kind: 'expired', sentence: 'The quote expired before the transaction ran; get a fresh quote and try again.', errorName: 'Error', raw, detail: msg };
  return { kind: 'unknown', sentence: `The swap failed on-chain: "${msg}".`, errorName: 'Error', raw, detail: msg };
}

export function decodeRevert(raw: Hex | undefined | null, message?: string): DecodedRevert {
  if (raw && raw.length >= 10) {
    try {
      const e = decodeErrorResult({ abi: b20ErrorsAbi, data: raw }) as { errorName: string; args: readonly unknown[] };
      switch (e.errorName) {
        case 'PolicyForbids': {
          const [scope, id] = e.args as [Hex, bigint];
          const name = scopeNames[scope.toLowerCase()] ?? scope;
          return {
            kind: 'policy',
            sentence: `The stock token's compliance policy blocked this transfer: ${scopeWho[name] ?? 'an address in the route'} is not allowed (policy ${id}).`,
            errorName: e.errorName,
            raw,
            detail: name,
          };
        }
        case 'ContractPaused': {
          const [f] = e.args as [number];
          return { kind: 'paused', sentence: `The issuer has paused ${PAUSE_FEATURES[f] ?? 'this feature'} on this stock token, so buys are on hold.`, errorName: e.errorName, raw };
        }
        case 'InsufficientAllowance':
        case 'ERC20InsufficientAllowance': {
          const [, have, need] = e.args as [string, bigint, bigint];
          return { kind: 'allowance', sentence: 'The swap router is not approved to spend enough of your token yet; approve first, then buy.', errorName: e.errorName, raw, detail: `allowance ${have}, needed ${need}` };
        }
        case 'InsufficientBalance':
        case 'ERC20InsufficientBalance': {
          const [, have, need] = e.args as [string, bigint, bigint];
          return { kind: 'balance', sentence: 'Your wallet does not hold enough of the token you are paying with.', errorName: e.errorName, raw, detail: `balance ${have}, needed ${need}` };
        }
        case 'Error':
          return fromString(String((e.args as [string])[0]), raw);
        case 'Panic':
          return { kind: 'unknown', sentence: `The swap failed on-chain (panic 0x${((e.args as [bigint])[0]).toString(16)}).`, errorName: 'Panic', raw };
        case 'InvalidReceiver':
          return { kind: 'receiver', sentence: 'The swap tried to send tokens to an address B20 tokens cannot receive.', errorName: e.errorName, raw };
        default:
          return { kind: 'unknown', sentence: `The swap failed on-chain (${e.errorName}).`, errorName: e.errorName, raw };
      }
    } catch {
      /* not a B20 error */
    }
    try {
      const e = decodeErrorResult({ abi: genericAbi, data: raw });
      if (e.errorName === 'Error') return fromString(String(e.args[0]), raw);
      if (e.errorName === 'Panic') return { kind: 'unknown', sentence: `The swap failed on-chain (panic 0x${(e.args[0] as bigint).toString(16)}).`, errorName: 'Panic', raw };
    } catch {
      /* unknown selector */
    }
  }
  if (message) return fromString(message.replace(/^execution reverted:?\s*/i, ''), raw ?? undefined);
  return { kind: 'unknown', sentence: `The swap failed on-chain with an unrecognised error${raw && raw !== '0x' ? ` (${raw.slice(0, 10)})` : ''}.`, raw: raw ?? undefined };
}

export function formatRaw(raw: bigint, decimals: number): string {
  return formatUnits(raw, decimals);
}
