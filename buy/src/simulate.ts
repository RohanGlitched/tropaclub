/**
 * Full approve + swap simulation on Base mainnet via eth_simulateV1 with state overrides.
 * Nothing is signed or broadcast; the taker is a random throwaway address with no key.
 * mainnet.base.org executes the B20 precompiles inside eth_simulateV1 (red team, confirmed again Nov 22 2026).
 *
 * Funding: USDC FiatToken v2.2 packs balance (bits 0..254) and the blacklist flag (bit 255) in mapping slot 9,
 * so we write `balance` (flag clear) at keccak256(abi.encode(taker, 9)).
 */
import {
  type Address,
  type Hex,
  type PublicClient,
  createPublicClient,
  decodeEventLog,
  decodeFunctionData,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  fallback,
  getAddress,
  http,
  keccak256,
  toHex,
} from 'viem';
import { base } from 'viem/chains';
import { buildBuyCalls, type Call } from './calls';
import {
  DEFAULT_RPC_URLS,
  DEFAULT_SIMULATE_RPC_URLS,
  POLICY_REGISTRY,
  POLICY_SCOPES,
  USDC,
  USDC_BALANCE_SLOT,
  b20Abi,
  kyberRouterAbi,
  policyRegistryAbi,
  type PolicyScopeName,
} from './constants';
import { guardMinOut, type GuardResult } from './guard';
import { buildSwap, getQuote, isNative, resolveToken, type BuiltSwap, type Provider, type Quote, type SourcePref } from './quote';
import { decodeRevert, type DecodedRevert } from './revert';
import { TROPA_SUFFIX, parseSuffix } from './suffix';

export function createBaseClient(urls: readonly string[] = DEFAULT_RPC_URLS): PublicClient {
  return createPublicClient({ chain: base, transport: fallback(urls.map((u) => http(u, { retryCount: 2, timeout: 20_000 }))), batch: { multicall: true } }) as PublicClient;
}

export function randomThrowawayAddress(): Address {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return getAddress(`0x${keccak256(toHex(bytes)).slice(-40)}`);
}

export function usdcBalanceSlot(holder: Address): Hex {
  return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [holder, USDC_BALANCE_SLOT]));
}

export interface SimCallResult {
  label: string;
  status: 'success' | 'reverted';
  gasUsed: bigint;
  returnData: Hex;
  revert?: DecodedRevert;
  logs: { address: Address; topics: Hex[]; data: Hex }[];
}

export interface PolicyCheck {
  address: Address;
  role: string;
  scope: PolicyScopeName;
  policyId: bigint;
  authorized: boolean;
}

export interface SimulateBuyResult {
  ok: boolean;
  /** One plain sentence when !ok. */
  reason?: string;
  taker: Address;
  quote: Quote;
  guard: GuardResult;
  swap?: BuiltSwap;
  calls: Call[];
  results: SimCallResult[];
  /** Raw units of buyToken received by the taker. */
  amountOut: bigint;
  amountOutMin: bigint;
  gas: { approve: bigint; swap: bigint; total: bigint };
  revert?: DecodedRevert;
  suffixOnEveryCall: boolean;
  policy: { passes: boolean; checks: PolicyCheck[] };
  venues: string[];
}

export interface SimulateBuyParams {
  sellToken: Address | 'USDC' | 'ETH';
  buyToken: Address;
  sellAmount: bigint;
  taker?: Address;
  providers?: Provider[];
  sources?: SourcePref;
  /** Client that runs eth_simulateV1 (default mainnet.base.org first). */
  simClient?: PublicClient;
  /** Client for ordinary reads (default publicnode first). */
  client?: PublicClient;
  nowSec?: number;
  /** Test hooks */
  skipApprove?: boolean;
  overrideMinOut?: bigint;
  suffix?: Hex;
}

type RpcSimCall = { status: Hex; gasUsed: Hex; returnData: Hex; logs?: { address: Address; topics: Hex[]; data: Hex }[]; error?: { code: number; message: string; data?: Hex } };

export async function simulateCalls(
  simClient: PublicClient,
  from: Address,
  calls: { to: Address; data: Hex; value: bigint }[],
  stateOverrides: Record<string, { balance?: Hex; stateDiff?: Record<Hex, Hex> }>,
): Promise<RpcSimCall[]> {
  const res = (await simClient.request({
    method: 'eth_simulateV1' as any,
    params: [
      {
        blockStateCalls: [
          {
            stateOverrides,
            calls: calls.map((c) => ({ from, to: c.to, data: c.data, value: toHex(c.value) })),
          },
        ],
        validation: false,
        traceTransfers: false,
      },
      'latest',
    ] as any,
  })) as { calls: RpcSimCall[] }[];
  return res[0]!.calls;
}

export async function simulateBuy(p: SimulateBuyParams): Promise<SimulateBuyResult> {
  const client = p.client ?? createBaseClient();
  const simClient = p.simClient ?? createBaseClient(DEFAULT_SIMULATE_RPC_URLS);
  const taker = p.taker ?? randomThrowawayAddress();
  const sellToken = resolveToken(p.sellToken);
  const native = isNative(sellToken);
  if (!native && sellToken.toLowerCase() !== USDC.toLowerCase()) throw new Error('simulateBuy funds USDC or ETH only');

  const quote = await getQuote({ sellToken, buyToken: p.buyToken, sellAmount: p.sellAmount, taker, providers: p.providers, sources: p.sources });
  const guard = await guardMinOut(
    { token: p.buyToken, quotedOut: quote.amountOut, sellToken, sellAmount: p.sellAmount },
    { client, nowSec: p.nowSec, sellAmountUsd: quote.amountInUsd },
  );
  const empty = { approve: 0n, swap: 0n, total: 0n };
  const base_ = { taker, quote, guard, calls: [] as Call[], results: [] as SimCallResult[], amountOut: 0n, amountOutMin: guard.amountOutMin, gas: empty, suffixOnEveryCall: false, policy: { passes: false, checks: [] as PolicyCheck[] }, venues: quote.venues };
  if (!guard.unitCheck.ok) return { ...base_, ok: false, reason: `Guard units check failed: ${guard.unitCheck.reason}.` };
  if (!guard.quoteOk && p.overrideMinOut === undefined)
    return { ...base_, ok: false, reason: `The best route pays ${(guard.quoteVsMarkBps / 100).toFixed(2)}% vs the reference price, worse than the 1.5% guard, so the buy is held.` };

  const swap = await buildSwap(quote, { amountOutMin: guard.amountOutMin, recipient: taker });
  let swapData = swap.data;
  if (p.overrideMinOut !== undefined) swapData = withKyberMinOut(swap.data, p.overrideMinOut);
  let calls = buildBuyCalls({ quote, swap: { ...swap, data: swapData }, suffix: p.suffix ?? TROPA_SUFFIX });
  if (p.skipApprove) calls = calls.filter((c) => !c.label.startsWith('Approve'));

  const balanceCall = { to: p.buyToken, data: encodeFunctionData({ abi: b20Abi, functionName: 'balanceOf', args: [taker] }), value: 0n };
  const overrides: Record<string, { balance?: Hex; stateDiff?: Record<Hex, Hex> }> = {
    [taker]: { balance: toHex(10n ** 18n + (native ? p.sellAmount : 0n)) },
  };
  if (!native) overrides[USDC] = { stateDiff: { [usdcBalanceSlot(taker)]: toHex(p.sellAmount, { size: 32 }) } };

  const raw = await simulateCalls(simClient, taker, [...calls, balanceCall], overrides);
  const results: SimCallResult[] = calls.map((c, i) => {
    const r = raw[i]!;
    const status = r.status === '0x1' ? 'success' : 'reverted';
    return {
      label: c.label,
      status,
      gasUsed: BigInt(r.gasUsed),
      returnData: r.returnData,
      revert: status === 'reverted' ? decodeRevert(r.error?.data ?? r.returnData, r.error?.message) : undefined,
      logs: r.logs ?? [],
    };
  });
  const balRes = raw[calls.length]!;
  const amountOut = balRes.status === '0x1' ? (decodeFunctionResult({ abi: b20Abi, functionName: 'balanceOf', data: balRes.returnData }) as bigint) : 0n;
  const approveGas = results.find((r) => r.label.startsWith('Approve'))?.gasUsed ?? 0n;
  const swapRes = results.find((r) => r.label.startsWith('Buy'))!;
  const gas = { approve: approveGas, swap: swapRes.gasUsed, total: approveGas + swapRes.gasUsed };
  const suffixOnEveryCall = calls.every((c) => parseSuffix(c.data)?.codes.includes('bc_vdp89s9b') || (p.suffix && c.data.endsWith(p.suffix.slice(2))));

  const policy = await checkRoutePolicies(client, p.buyToken, taker, swapRes.logs, swapData);
  const failed = results.find((r) => r.status === 'reverted');
  const minOut = p.overrideMinOut ?? guard.amountOutMin;
  const ok = !failed && amountOut >= minOut && policy.passes;
  return {
    ...base_,
    ok,
    reason: failed?.revert?.sentence ?? (amountOut < minOut ? 'The simulated fill came in under the guard minimum.' : !policy.passes ? 'A compliance policy would block this route.' : undefined),
    swap,
    calls,
    results,
    amountOut,
    amountOutMin: minOut,
    gas,
    revert: failed?.revert,
    suffixOnEveryCall,
    policy,
  };
}

/** Re-encode KyberSwap calldata with a different minReturnAmount (test hook for the slippage revert path). */
export function withKyberMinOut(data: Hex, minReturnAmount: bigint): Hex {
  const dec = decodeKyberSwapFull(data);
  if (!dec) throw new Error('not KyberSwap calldata');
  dec.desc.minReturnAmount = minReturnAmount;
  return encodeFunctionData({ abi: kyberRouterAbi, functionName: 'swap', args: [dec as any] });
}

function decodeKyberSwapFull(data: Hex): any | null {
  try {
    const { args } = decodeFunctionData({ abi: kyberRouterAbi, data });
    return { ...(args[0] as any), desc: { ...(args[0] as any).desc } };
  } catch {
    return null;
  }
}

/**
 * Check every address that moved the stock token in the simulated swap against the token's policies:
 * Transfer.from -> sender + executor scopes (pools/executors call transfer themselves), Transfer.to -> receiver scope,
 * plus the KyberSwap executor (callTarget) under all three.
 */
export async function checkRoutePolicies(
  client: PublicClient,
  token: Address,
  taker: Address,
  logs: { address: Address; topics: Hex[]; data: Hex }[],
  swapData?: Hex,
): Promise<{ passes: boolean; checks: PolicyCheck[] }> {
  const want: { address: Address; role: string; scope: PolicyScopeName }[] = [];
  for (const l of logs) {
    if (l.address.toLowerCase() !== token.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: b20Abi, data: l.data, topics: l.topics as any });
      if (ev.eventName !== 'Transfer') continue;
      const { from, to } = ev.args as { from: Address; to: Address };
      want.push({ address: from, role: 'transfer.from', scope: 'TRANSFER_SENDER_POLICY' });
      want.push({ address: from, role: 'transfer.from (msg.sender)', scope: 'TRANSFER_EXECUTOR_POLICY' });
      want.push({ address: to, role: to.toLowerCase() === taker.toLowerCase() ? 'buyer' : 'transfer.to', scope: 'TRANSFER_RECEIVER_POLICY' });
    } catch {
      /* not a Transfer */
    }
  }
  if (swapData) {
    const full = decodeKyberSwapFull(swapData);
    if (full?.callTarget) for (const scope of Object.keys(POLICY_SCOPES) as PolicyScopeName[]) want.push({ address: getAddress(full.callTarget), role: 'kyber executor', scope });
  }
  want.push({ address: taker, role: 'buyer', scope: 'TRANSFER_RECEIVER_POLICY' });
  const uniq = [...new Map(want.map((w) => [`${w.address.toLowerCase()}:${w.scope}`, w])).values()];
  const ids = Object.fromEntries(
    await Promise.all(
      (Object.keys(POLICY_SCOPES) as PolicyScopeName[]).map(async (s) => [s, await client.readContract({ address: token, abi: b20Abi, functionName: 'policyId', args: [POLICY_SCOPES[s]] })] as const),
    ),
  ) as Record<PolicyScopeName, bigint>;
  const checks: PolicyCheck[] = await Promise.all(
    uniq.map(async (w) => {
      const policyId = ids[w.scope];
      const authorized = policyId === 0n ? true : await client.readContract({ address: POLICY_REGISTRY, abi: policyRegistryAbi, functionName: 'isAuthorized', args: [policyId, w.address] });
      return { ...w, policyId, authorized };
    }),
  );
  const sawTransfer = want.some((w) => w.role.startsWith('transfer') || w.role === 'buyer');
  return { passes: sawTransfer && checks.every((c) => c.authorized), checks };
}

