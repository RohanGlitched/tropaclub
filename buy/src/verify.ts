/**
 * Server-side attribution check: does our ERC-8021 suffix end a field the buyer's wallet controls?
 *
 * Credited places:
 *   (a) the end of the tx input (EOA buys);
 *   (b) the end of a UserOperation's callData inside EntryPoint handleOps / handleAggregatedOps
 *       (v0.6 UserOperation, v0.7 / v0.8 PackedUserOperation), matched to the receipt's UserOperationEvent;
 *   (c) the end of an inner call's data once the smart account call is decoded: execute(address,uint256,bytes),
 *       executeBatch((address,uint256,bytes)[]) (Coinbase Smart Wallet), executeBatch(address[],uint256[],bytes[]),
 *       executeBatch(address[],bytes[]), ERC-7579 / ERC-7821 execute(bytes32,bytes) in single and batch mode,
 *       and a few common variants. Only in userOp callData of a tx sent to a known EntryPoint, or in an
 *       EIP-7702 account calling itself (tx.to == tx.from); and only an inner call to the pinned KyberSwap
 *       router, or approve(router, ...) on the payment token (USDC or WETH). A suffixed inner call to any
 *       other contract credits nothing.
 *
 * Base Account's dataSuffix capability is documented both ways (suffix on each call, or on userOp.callData),
 * so both are credited. Suffix bytes anywhere else (the middle of an input, a call relayed into someone
 * else's account, a call to some other contract) are not credited.
 */
import { type Address, type Hex, type PublicClient, decodeAbiParameters, decodeEventLog, decodeFunctionData, getAddress, parseAbi, slice, toFunctionSelector } from 'viem';
import { ENTRYPOINTS, KYBER_ROUTER, TROPA_BUILDER_CODE, USDC, WETH, entryPointAbi } from './constants';
import { ERC8021_MARKER, parseSuffix } from './suffix';

export interface UserOpAttribution {
  sender: Address;
  nonce: bigint;
  codes: string[];
  attributed: boolean;
  /** Where our code was found: the end of userOp.callData, or the end of a decoded inner call. */
  where?: 'callData' | 'innerCall';
}

export interface AttributionResult {
  attributed: boolean;
  codes: string[];
  via: 'tx' | 'userop' | 'none';
  /** Which field ended in the suffix: the tx input, the userOp callData, or a decoded inner call. */
  match?: 'input' | 'callData' | 'innerCall';
  /** Suffix bytes were found inside the input but not at the end of a credited field. */
  innerOnly?: boolean;
  userOps?: UserOpAttribution[];
  /** The signer: tx.from for a plain tx, the userOp sender for ERC-4337. */
  from?: Address;
}

export function attributionFromData(data: Hex, code: string = TROPA_BUILDER_CODE): { attributed: boolean; codes: string[] } {
  const parsed = parseSuffix(data);
  const codes = parsed?.codes ?? [];
  return { attributed: codes.includes(code), codes };
}

// ---------------------------------------------------------------- EntryPoint bundles

const bundleAbi = parseAbi([
  'struct UserOperationV6 { address sender; uint256 nonce; bytes initCode; bytes callData; uint256 callGasLimit; uint256 verificationGasLimit; uint256 preVerificationGas; uint256 maxFeePerGas; uint256 maxPriorityFeePerGas; bytes paymasterAndData; bytes signature; }',
  'struct PackedUserOperation { address sender; uint256 nonce; bytes initCode; bytes callData; bytes32 accountGasLimits; uint256 preVerificationGas; bytes32 gasFees; bytes paymasterAndData; bytes signature; }',
  'struct UserOpsPerAggregatorV6 { UserOperationV6[] userOps; address aggregator; bytes signature; }',
  'struct UserOpsPerAggregator { PackedUserOperation[] userOps; address aggregator; bytes signature; }',
  'function handleOps(UserOperationV6[] ops, address beneficiary)',
  'function handleOps(PackedUserOperation[] ops, address beneficiary)',
  'function handleAggregatedOps(UserOpsPerAggregatorV6[] opsPerAggregator, address beneficiary)',
  'function handleAggregatedOps(UserOpsPerAggregator[] opsPerAggregator, address beneficiary)',
]);

type RawOp = { sender: Address; nonce: bigint; callData: Hex };

/** UserOperations in a handleOps / handleAggregatedOps call (EntryPoint v0.6, v0.7, v0.8); null if the input is neither. */
export function extractUserOps(input: Hex): RawOp[] | null {
  try {
    const { functionName, args } = decodeFunctionData({ abi: bundleAbi, data: input });
    const raw: any[] =
      functionName === 'handleOps' ? (args[0] as any[]) : functionName === 'handleAggregatedOps' ? (args[0] as any[]).flatMap((g) => g.userOps as any[]) : [];
    return raw.map((op) => ({ sender: getAddress(op.sender), nonce: op.nonce, callData: op.callData }));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- smart account calls

const accountAbi = parseAbi([
  'function execute(address target, uint256 value, bytes data)', // SimpleAccount, Coinbase Smart Wallet, Light Account, Kernel v2
  'function executeCall(address target, uint256 value, bytes data)',
  'function execute_ncC(address target, uint256 value, bytes data)', // Biconomy v2
  'function executeUserOp(address to, uint256 value, bytes data, uint8 operation)', // Safe 4337 module
  'function executeUserOpWithErrorString(address to, uint256 value, bytes data, uint8 operation)',
  'function executeBatch((address target, uint256 value, bytes data)[] calls)', // Coinbase Smart Wallet
  'function executeBatch(address[] dest, uint256[] value, bytes[] func)', // SimpleAccount v0.7, Light Account
  'function executeBatch(address[] dest, bytes[] func)', // SimpleAccount v0.6, Light Account
  'function executeBatch_y6U(address[] dest, uint256[] value, bytes[] func)', // Biconomy v2
  'function execute((address to, uint256 value, bytes data)[] calls)', // 7702 batch executors
  'function execute(bytes32 mode, bytes executionCalldata)', // ERC-7579 / ERC-7821
  'function executeFromExecutor(bytes32 mode, bytes executionCalldata)', // ERC-7579
]);
type Shape = 'single' | 'batchTuples' | 'batchArrays3' | 'batchArrays2' | 'mode';
const SHAPES = new Map<string, Shape>();
for (const item of accountAbi) {
  const sig = item.inputs.map((i) => i.type).join(',');
  const shape: Shape =
    sig === 'bytes32,bytes'
      ? 'mode'
      : sig === 'tuple[]'
        ? 'batchTuples'
        : sig === 'address[],uint256[],bytes[]'
          ? 'batchArrays3'
          : sig === 'address[],bytes[]'
            ? 'batchArrays2'
            : 'single';
  SHAPES.set(toFunctionSelector(item).toLowerCase(), shape);
}
/** EntryPoint v0.7+ calls account.executeUserOp(userOp, hash) when callData starts with this selector; the rest is the real call. */
const EXECUTE_USEROP_SELECTOR = '0x8dd7712f';
const executionsParam = [{ type: 'tuple[]', components: [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes' }] }] as const;
const MAX_DEPTH = 3;

export interface InnerCall {
  /** The contract the account calls (for an ERC-7579 delegatecall, the delegate). */
  target: Address;
  data: Hex;
}

/**
 * Inner calls of a smart account call, with their targets, flattened. A nested account call is
 * followed only when it targets the account itself (`self`), when `self` is given: a call into some
 * other account runs as that account, not the buyer. Without `self`, every nested call is followed.
 */
export function innerCalls(data: Hex, self?: Address, depth = 0): InnerCall[] {
  if (depth >= MAX_DEPTH || data.length < 10) return [];
  let d = data.toLowerCase() as Hex;
  if (d.startsWith(EXECUTE_USEROP_SELECTOR)) d = `0x${d.slice(10)}` as Hex;
  const shape = SHAPES.get(d.slice(0, 10));
  if (!shape) return [];
  let found: InnerCall[] = [];
  try {
    const { args } = decodeFunctionData({ abi: accountAbi, data: d }) as { args: readonly any[] };
    const call = (target: unknown, cd: unknown): InnerCall => ({ target: getAddress(target as string), data: cd as Hex });
    if (shape === 'single') found = [call(args[0], args[2])];
    else if (shape === 'batchTuples') found = (args[0] as any[]).map((c) => call(c.target ?? c.to ?? c[0], c.data ?? c[2]));
    else if (shape === 'batchArrays3') found = (args[2] as Hex[]).map((cd, i) => call((args[0] as Address[])[i], cd));
    else if (shape === 'batchArrays2') found = (args[1] as Hex[]).map((cd, i) => call((args[0] as Address[])[i], cd));
    else found = modeExecutions(args[0] as Hex, args[1] as Hex);
  } catch {
    return [];
  }
  const s = self?.toLowerCase();
  return found.flatMap((c) => [c, ...(!s || c.target.toLowerCase() === s ? innerCalls(c.data, self, depth + 1) : [])]);
}

/** Inner call data of a smart account call, flattened (nested account calls included, up to a small depth). */
export function innerCallDatas(data: Hex, depth = 0): Hex[] {
  return innerCalls(data, undefined, depth).map((c) => c.data);
}

const APPROVE_SELECTOR = '0x095ea7b3';
const PAYMENT_TOKENS = new Set([USDC.toLowerCase(), WETH.toLowerCase()]);

/** An inner call whose suffix credits a buy: a call to the pinned router, or approve(router, ...) on USDC / WETH. */
export function isCreditableInnerCall(c: InnerCall): boolean {
  const target = c.target.toLowerCase();
  if (target === KYBER_ROUTER.toLowerCase()) return true;
  if (!PAYMENT_TOKENS.has(target)) return false;
  const d = c.data.toLowerCase();
  if (!d.startsWith(APPROVE_SELECTOR) || d.length < 10 + 64 * 2) return false;
  const spenderWord = d.slice(10, 74);
  return spenderWord.slice(0, 24) === '0'.repeat(24) && `0x${spenderWord.slice(24)}` === KYBER_ROUTER.toLowerCase();
}

/** ERC-7579 / ERC-7821 executions (target and call data) by call type (first byte of the mode). */
function modeExecutions(mode: Hex, exec: Hex): InnerCall[] {
  const callType = mode.slice(2, 4).toLowerCase();
  const bytes = (exec.length - 2) / 2;
  const head = (n: number): InnerCall => ({ target: getAddress(slice(exec, 0, 20)), data: slice(exec, n) });
  if (callType === '00') return bytes >= 52 ? [head(52)] : []; // single: target(20) || value(32) || callData
  if (callType === 'ff') return bytes >= 20 ? [head(20)] : []; // delegatecall: target(20) || callData
  if (callType === '01') {
    // batch: abi.encode(Execution[]) (7579), or abi.encode(Call[], opData) (7821): the first word points at the calls either way
    try {
      return (decodeAbiParameters(executionsParam, exec)[0] as readonly (readonly [Address, bigint, Hex])[]).map((c) => ({ target: getAddress(c[0]), data: c[2] }));
    } catch {
      // 7821 batch of batches: abi.encode(bytes[]), each an encoded batch
      try {
        return (decodeAbiParameters([{ type: 'bytes[]' }], exec)[0] as readonly Hex[]).flatMap((b) => modeExecutions(mode, b));
      } catch {
        return [];
      }
    }
  }
  return [];
}

/**
 * Our code at the end of `callData`, or at the end of one of its decoded inner calls to the router
 * (or approve(router) on USDC / WETH). `self` is the account making the calls (userOp sender, or the
 * 7702 EOA); `inner: false` credits the end of `callData` only. Codes on other inner calls are still
 * reported in `codes`, but never credit.
 */
export function attributionFromAccountCall(
  callData: Hex,
  code: string = TROPA_BUILDER_CODE,
  opts: { self?: Address; inner?: boolean } = {},
): { attributed: boolean; codes: string[]; where?: 'callData' | 'innerCall' } {
  const end = attributionFromData(callData, code);
  if (end.attributed) return { ...end, where: 'callData' };
  const inner = innerCalls(callData, opts.self).map((c) => ({ ...attributionFromData(c.data, code), creditable: isCreditableInnerCall(c) }));
  const codes = [...new Set([...end.codes, ...inner.flatMap((i) => i.codes)])];
  if (opts.inner !== false && inner.some((i) => i.attributed && i.creditable)) return { attributed: true, codes, where: 'innerCall' };
  return { attributed: false, codes };
}

// ---------------------------------------------------------------- verify

const hasMarker = (input: Hex) => input.toLowerCase().includes(ERC8021_MARKER.slice(2));

export async function verifyAttribution(
  txHash: Hex,
  opts: {
    client: PublicClient;
    code?: string;
    /** The wallet the buy is recorded for. For a bundle, only this sender's userOps can credit it. */
    buyer?: string;
  },
): Promise<AttributionResult> {
  const code = opts.code ?? TROPA_BUILDER_CODE;
  const tx = await opts.client.getTransaction({ hash: txHash });
  const input = tx.input;
  const direct = attributionFromData(input, code);

  // ERC-4337: decode handleOps / handleAggregatedOps (EntryPoint v0.6 / v0.7 / v0.8) and match the UserOperationEvent(s).
  const ops = extractUserOps(input);
  if (ops && ops.length) {
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

    if (toEp || events.length) {
      const matched = events.length
        ? ops.filter((o) => events.some((e) => e.sender.toLowerCase() === o.sender.toLowerCase() && e.nonce === o.nonce))
        : ops;
      // inner calls credit only when the tx went straight to a known EntryPoint, which is what ran these ops
      const userOps: UserOpAttribution[] = matched.map((o) => ({ sender: o.sender, nonce: o.nonce, ...attributionFromAccountCall(o.callData, code, { self: o.sender, inner: !!toEp }) }));
      const buyer = opts.buyer?.toLowerCase();
      const mine = buyer ? userOps.filter((u) => u.sender.toLowerCase() === buyer) : userOps;

      const credited = mine.find((u) => u.attributed);
      if (credited) return { attributed: true, codes: credited.codes, via: 'userop', match: credited.where, userOps, from: credited.sender };
      // the bundler tagged handleOps itself: report it as before (the signer check then sees the bundler, not the buyer)
      if (direct.attributed) return { ...direct, via: 'tx', match: 'input', userOps, from: tx.from };
      const tagged = mine.find((u) => u.codes.length);
      if (tagged) return { attributed: false, codes: tagged.codes, via: 'userop', userOps, from: tagged.sender };
      if (direct.codes.length) return { ...direct, via: 'tx', match: 'input', userOps, from: tx.from };
      return { attributed: false, codes: [], via: 'none', userOps, innerOnly: hasMarker(input), from: mine.length === 1 ? mine[0]!.sender : tx.from };
    }
  }

  if (direct.attributed) return { ...direct, via: 'tx', match: 'input', from: tx.from };

  // EIP-7702: an account sending a batch to itself. Its own decoded inner calls count; a call relayed into someone else's account does not.
  if (tx.to && tx.to.toLowerCase() === tx.from.toLowerCase()) {
    const self = attributionFromAccountCall(input, code, { self: tx.from });
    if (self.attributed) return { attributed: true, codes: self.codes, via: 'tx', match: self.where === 'callData' ? 'input' : 'innerCall', from: tx.from };
  }

  if (direct.codes.length) return { ...direct, via: 'tx', match: 'input', from: tx.from };
  return { attributed: false, codes: [], via: 'none', innerOnly: hasMarker(input), from: tx.from };
}
