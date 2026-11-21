/**
 * approve + swap calls with the ERC-8021 suffix, and the wallet send strategy.
 *
 * Why per-call suffixes as well as the 5792 capability: attribution is read from the END of the tx input
 * (or the UserOp callData). A wallet that honours `capabilities.dataSuffix` appends it to the outer
 * calldata. MetaMask's EIP-7702 batches do not keep an outer suffix (red team), so unless the wallet
 * advertises dataSuffix support we send sequential eth_sendTransaction calls, each ending in the suffix.
 */
import { type Address, type Hex, encodeFunctionData, erc20Abi, maxUint256, toHex } from 'viem';
import { BASE_CHAIN_HEX, BASE_CHAIN_ID } from './constants';
import type { BuiltSwap, Quote } from './quote';
import { isNative } from './quote';
import { TROPA_SUFFIX, appendSuffix } from './suffix';

export interface Call {
  to: Address;
  data: Hex;
  value: bigint;
  /** Human label for the UI ("Approve USDC", "Buy NVDAc"). */
  label: string;
}

export interface BuildBuyCallsParams {
  quote: Quote;
  swap: BuiltSwap;
  /** Current allowance of sellToken -> router; pass to skip a redundant approve. */
  currentAllowance?: bigint;
  /** Approve exactly the sell amount (default) or unlimited. */
  approveMode?: 'exact' | 'unlimited';
  suffix?: Hex;
  buySymbol?: string;
  sellSymbol?: string;
}

export function buildBuyCalls(p: BuildBuyCallsParams): Call[] {
  const suffix = p.suffix ?? TROPA_SUFFIX;
  const calls: Call[] = [];
  const native = isNative(p.quote.sellToken);
  const spender = p.swap.to; // router == approval target for KyberSwap
  if (!native && (p.currentAllowance ?? 0n) < p.quote.sellAmount) {
    const amount = p.approveMode === 'unlimited' ? maxUint256 : p.quote.sellAmount;
    calls.push({
      to: p.quote.sellToken,
      data: appendSuffix(encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] }), suffix),
      value: 0n,
      label: `Approve ${p.sellSymbol ?? 'token'}`,
    });
  }
  calls.push({
    to: p.swap.to,
    data: appendSuffix(p.swap.data, suffix),
    value: native ? p.swap.value || p.quote.sellAmount : p.swap.value,
    label: `Buy ${p.buySymbol ?? 'stock'}`,
  });
  return calls;
}

// ---------------------------------------------------------------- send strategy

/** wallet_getCapabilities result: { [chainIdHex]: { atomic?: {status}, dataSuffix?: {supported}|{status}, ... } } */
export type WalletCapabilities = Record<string, Record<string, any> | undefined>;

export interface SendPlanSendCalls {
  kind: 'sendCalls';
  reason: string;
  request: {
    method: 'wallet_sendCalls';
    params: [
      {
        version: '2.0.0';
        chainId: typeof BASE_CHAIN_HEX;
        from: Address;
        atomicRequired: boolean;
        calls: { to: Address; data: Hex; value: Hex }[];
        capabilities: { dataSuffix: { value: Hex; optional: boolean } };
      },
    ];
  };
}

export interface SendPlanSequential {
  kind: 'sequential';
  reason: string;
  /** Send in order; wait for each receipt before the next. */
  requests: { method: 'eth_sendTransaction'; params: [{ from: Address; to: Address; data: Hex; value: Hex; chainId: Hex }] }[];
}

export type SendPlan = SendPlanSendCalls | SendPlanSequential;

function capSupported(c: any): boolean {
  if (!c) return false;
  if (c.supported === true) return true;
  return c.status === 'supported' || c.status === 'ready';
}

export function walletSupportsDataSuffix(caps: WalletCapabilities | undefined | null, chainIdHex: string = BASE_CHAIN_HEX): boolean {
  if (!caps) return false;
  const forChain = caps[chainIdHex] ?? caps[chainIdHex.toLowerCase()] ?? caps[String(BASE_CHAIN_ID)];
  const global = caps['0x0'];
  return capSupported(forChain?.dataSuffix) || capSupported(global?.dataSuffix);
}

export function walletSupportsAtomic(caps: WalletCapabilities | undefined | null, chainIdHex: string = BASE_CHAIN_HEX): boolean {
  if (!caps) return false;
  const forChain = caps[chainIdHex] ?? caps['0x0'];
  return capSupported(forChain?.atomic) || forChain?.atomicBatch?.supported === true;
}

/**
 * Decide how to send. sendCalls only when the wallet explicitly supports `dataSuffix` on Base
 * (otherwise a 7702 batch can drop the outer suffix). Every call keeps its own suffix either way,
 * so the per-tx data still ends in the suffix for sequential sends and for 4337 wallets that
 * forward a single call's data unchanged.
 */
export function planSend(
  calls: Call[],
  from: Address,
  capabilities: WalletCapabilities | undefined | null,
  opts: { suffix?: Hex; forceSequential?: boolean } = {},
): SendPlan {
  const suffix = opts.suffix ?? TROPA_SUFFIX;
  const suffixOk = walletSupportsDataSuffix(capabilities);
  if (!opts.forceSequential && suffixOk) {
    return {
      kind: 'sendCalls',
      reason: 'wallet advertises the ERC-5792 dataSuffix capability on Base',
      request: {
        method: 'wallet_sendCalls',
        params: [
          {
            version: '2.0.0',
            chainId: BASE_CHAIN_HEX,
            from,
            atomicRequired: walletSupportsAtomic(capabilities),
            calls: calls.map((c) => ({ to: c.to, data: appendSuffix(c.data, suffix), value: toHex(c.value) })),
            capabilities: { dataSuffix: { value: suffix, optional: false } },
          },
        ],
      },
    };
  }
  return {
    kind: 'sequential',
    reason: opts.forceSequential
      ? 'sequential forced'
      : capabilities
        ? 'wallet does not advertise dataSuffix on Base; sending each call as its own suffixed transaction'
        : 'wallet has no wallet_getCapabilities; sending each call as its own suffixed transaction',
    requests: calls.map((c) => ({
      method: 'eth_sendTransaction' as const,
      params: [{ from, to: c.to, data: appendSuffix(c.data, suffix), value: toHex(c.value), chainId: BASE_CHAIN_HEX }] as [
        { from: Address; to: Address; data: Hex; value: Hex; chainId: Hex },
      ],
    })),
  };
}
