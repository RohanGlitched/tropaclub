/**
 * approve + swap calls with the ERC-8021 suffix, and the wallet send strategy.
 *
 * Attribution is read from the END of the tx input, of the UserOp callData, or of a decoded inner call
 * (see verify.ts). The send strategy (planSend):
 *   1. the wallet advertises ERC-5792 `dataSuffix` on Base -> wallet_sendCalls with the capability and
 *      calls WITHOUT our own suffix, so the wallet tags once (Base's guidance);
 *   2. a contract account (code at the address, or an EIP-7702 delegation 0xef0100...) without dataSuffix
 *      -> wallet_sendCalls with the suffix on each inner call, since only the wallet can tag userOp.callData;
 *      if the wallet has no wallet_sendCalls either, the plan is `blocked` and the UI does not let it sign;
 *   3. an EOA without dataSuffix -> sequential eth_sendTransaction, each ending in the suffix
 *      (MetaMask's EIP-7702 batches do not keep an outer suffix, red team).
 */
import { type Address, type Hex, encodeFunctionData, erc20Abi, maxUint256, toHex } from 'viem';
import { BASE_CHAIN_HEX, BASE_CHAIN_ID } from './constants';
import type { BuiltSwap, Quote } from './quote';
import { isNative } from './quote';
import { TROPA_SUFFIX, appendSuffix, stripSuffix } from './suffix';

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

/** Shown, word for word, when a contract wallet can neither tag the buy itself nor take wallet_sendCalls. */
export const WALLET_CANT_TAG_MESSAGE = "This wallet can't tag buys for your club yet. Use Coinbase Smart Wallet or a regular wallet.";

export interface SendCallsParams {
  version: '2.0.0';
  chainId: typeof BASE_CHAIN_HEX;
  from: Address;
  atomicRequired: boolean;
  calls: { to: Address; data: Hex; value: Hex }[];
  /** Present only when the wallet advertises dataSuffix: then the calls carry no suffix of ours. */
  capabilities?: { dataSuffix: { value: Hex; optional: boolean } };
}

export interface SendPlanSendCalls {
  kind: 'sendCalls';
  reason: string;
  /** Who adds the suffix: the wallet (dataSuffix capability), or us, on each inner call. */
  tagging: 'wallet' | 'calls';
  request: { method: 'wallet_sendCalls'; params: [SendCallsParams] };
}

export interface SendPlanSequential {
  kind: 'sequential';
  reason: string;
  tagging: 'calls';
  /** Send in order; wait for each receipt before the next. */
  requests: { method: 'eth_sendTransaction'; params: [{ from: Address; to: Address; data: Hex; value: Hex; chainId: Hex }] }[];
}

/** This wallet cannot carry the Builder Code for this account: the UI shows `message` and offers nothing to sign. */
export interface SendPlanBlocked {
  kind: 'blocked';
  reason: string;
  message: typeof WALLET_CANT_TAG_MESSAGE;
}

export type SendPlan = SendPlanSendCalls | SendPlanSequential | SendPlanBlocked;

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

/** A wallet that answers wallet_getCapabilities implements ERC-5792, so it takes wallet_sendCalls. */
export function walletSupportsSendCalls(caps: WalletCapabilities | undefined | null): boolean {
  return !!caps && typeof caps === 'object' && !Array.isArray(caps);
}

export type AccountKind = 'eoa' | 'delegated' | 'contract';

/**
 * Classify an address from its eth_getCode result. viem returns undefined for no code; '0x' means the same.
 * An EIP-7702 delegated EOA carries the designator 0xef0100 || address.
 */
export function accountKind(code: Hex | null | undefined): AccountKind {
  const c = (code ?? '0x').toLowerCase();
  if (/^0x0*$/.test(c)) return 'eoa';
  if (c.startsWith('0xef0100')) return 'delegated';
  return 'contract';
}

export interface PlanSendOptions {
  suffix?: Hex;
  forceSequential?: boolean;
  /**
   * eth_getCode at `from` (BuySheet reads it). Undefined, null or '0x' = no code, so the account is treated
   * as an EOA; that is also the fallback when the code could not be read.
   */
  code?: Hex | null;
}

/** Decide how to send. Pure: the caller passes the wallet_getCapabilities and eth_getCode results. */
export function planSend(calls: Call[], from: Address, capabilities: WalletCapabilities | undefined | null, opts: PlanSendOptions = {}): SendPlan {
  const suffix = opts.suffix ?? TROPA_SUFFIX;
  const kind = accountKind(opts.code);
  const sendCalls = (tagging: 'wallet' | 'calls', reason: string): SendPlanSendCalls => ({
    kind: 'sendCalls',
    reason,
    tagging,
    request: {
      method: 'wallet_sendCalls',
      params: [
        {
          version: '2.0.0',
          chainId: BASE_CHAIN_HEX,
          from,
          atomicRequired: walletSupportsAtomic(capabilities),
          calls: calls.map((c) => ({ to: c.to, data: tagging === 'wallet' ? stripSuffix(c.data, suffix) : appendSuffix(c.data, suffix), value: toHex(c.value) })),
          ...(tagging === 'wallet' ? { capabilities: { dataSuffix: { value: suffix, optional: false } } } : {}),
        },
      ],
    },
  });

  if (!opts.forceSequential) {
    if (walletSupportsDataSuffix(capabilities)) return sendCalls('wallet', 'wallet advertises the ERC-5792 dataSuffix capability on Base; the wallet adds the suffix once');
    if (kind !== 'eoa') {
      const what = kind === 'delegated' ? 'EIP-7702 delegated account' : 'contract account';
      if (walletSupportsSendCalls(capabilities)) return sendCalls('calls', `${what} without dataSuffix; wallet_sendCalls with the suffix on each inner call`);
      return { kind: 'blocked', reason: `${what} without dataSuffix or wallet_sendCalls; its buys cannot carry the Builder Code`, message: WALLET_CANT_TAG_MESSAGE };
    }
  }
  return {
    kind: 'sequential',
    reason: opts.forceSequential
      ? 'sequential forced'
      : capabilities
        ? 'wallet does not advertise dataSuffix on Base; sending each call as its own suffixed transaction'
        : 'wallet has no wallet_getCapabilities; sending each call as its own suffixed transaction',
    tagging: 'calls',
    requests: calls.map((c) => ({
      method: 'eth_sendTransaction' as const,
      params: [{ from, to: c.to, data: appendSuffix(c.data, suffix), value: toHex(c.value), chainId: BASE_CHAIN_HEX }] as [
        { from: Address; to: Address; data: Hex; value: Hex; chainId: Hex },
      ],
    })),
  };
}
