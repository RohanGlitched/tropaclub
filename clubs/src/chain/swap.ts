/**
 * What makes a transaction a real Tropa Club buy, read from its receipt alone. Pure: no network.
 *
 * Carrying our Builder Code proves nothing about what a transaction did: anyone can append the
 * suffix to a batch that moves $5 of USDC one way and a share of stock the other, between two of
 * their own wallets. A buy counts only when the receipt shows the swap we build:
 *
 *   1. the pinned KyberSwap router itself logged Swapped(sender, srcToken, dstToken, dstReceiver,
 *      spentAmount, returnAmount). A log's address cannot be forged, and the router takes
 *      spentAmount from `sender` before it logs. The transaction may be sent to an ERC-4337
 *      EntryPoint or a smart wallet: only the log matters, not tx.to.
 *   2. sender and dstReceiver are the buyer, dstToken is a stock token, and srcToken is USDC, WETH
 *      or native ETH.
 *   3. the USDC (or WETH) is seen leaving the buyer toward the router: to the router itself or to
 *      KyberSwap's pinned executor, which the router hands the payment to. Money the buyer sends
 *      anywhere else in the same batch pays for nothing.
 *   4. the stock reaches the buyer from the router side (router or executor) or straight from a
 *      verified Aerodrome pool, and the buyer's balance of it rises by at least returnAmount that
 *      way. Tokens arriving by any other transfer in the batch count for nothing.
 *   5. the stock came out of verified Aerodrome pools in this receipt, at least returnAmount of it.
 *      Which addresses are real pools needs the chain, so poolCandidates() lists the addresses to
 *      check and the caller passes the verified ones back in.
 *
 * The router logs Swapped for any executor a caller names, including one that hands over the
 * caller's own tokens at a made-up price. That is why 4 and 5 pin where the stock came from, and
 * why the caller also compares the fill with the mark at that block (fillCheck, used by buys.ts):
 * the receipt proves the shape of the trade, the mark bounds the price.
 *
 * Checked against real router buys on Base (Nov 2026): in 71 of 71, USDC went buyer -> executor,
 * the executor paid the pool, the pool paid the executor, and the executor paid the buyer.
 */
import { TRANSFER_TOPIC, USDC_ADDRESS, WETH_ADDRESS, isStockToken, type RawLog } from './types';
import { type ParsedTransfer, parseTransfers } from './receipt';
import { inRegularSession } from '../calendar';

/** KyberSwap MetaAggregationRouterV2 on Base: the only contract a Tropa Club buy is sent to. */
export const KYBER_ROUTER_ADDRESS = '0x6131b5fae19ea4f9d964eac0408e4408b66337b5';
/**
 * KyberSwap's executor on Base: the router passes the payment to it and it passes the stock on.
 * Every router buy of a stock token seen on Base in Nov 2026 went through this one address.
 */
export const KYBER_EXECUTORS: readonly string[] = ['0x8f10b468b06c6fd214b65f87778827f7d113f996'];
/** keccak256("Swapped(address,address,address,address,uint256,uint256)"), none of them indexed. */
export const KYBER_SWAPPED_TOPIC = '0xd6d4f5681c246c9f42c203e287975af1601f8df8035a9251f79aab5c8f09e2f8';
/** KyberSwap's stand-in address for native ETH. */
export const NATIVE_ETH_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

/**
 * How far a fill may be from the mark at its block. The cost basis is always the mark, so an
 * off-mark fill cannot inflate a return; the limit is only there to turn away a pool that someone
 * pushed far off the market. Outside NYSE regular hours the Chainlink mark is the last close and
 * pools drift from it (9% has been seen on MSTRc), so the limit is wider then.
 */
export const MAX_FILL_DEVIATION_SESSION = 0.1;
export const MAX_FILL_DEVIATION_OFF_HOURS = 0.2;
export const maxFillDeviation = (tSec: number) => (inRegularSession(tSec) ? MAX_FILL_DEVIATION_SESSION : MAX_FILL_DEVIATION_OFF_HOURS);
/** How far a fill is from the mark, as a fraction (0.02 = the buyer paid 2% over the mark). */
export const fillDeviation = (fillUsdPerToken: number, markUsdPerToken: number) => fillUsdPerToken / markUsdPerToken - 1;
/** The fill rule, shared by recordBuy and the quote shown before signing. */
export function fillCheck(fillUsdPerToken: number, markUsdPerToken: number, tSec: number): { ok: boolean; off: number; limit: number } {
  const off = fillDeviation(fillUsdPerToken, markUsdPerToken);
  const limit = maxFillDeviation(tSec);
  return { ok: Number.isFinite(off) && Math.abs(off) <= limit, off, limit };
}

export interface RouterSwap {
  sender: string;
  srcToken: string;
  dstToken: string;
  dstReceiver: string;
  spentAmount: bigint;
  returnAmount: bigint;
  logIndex: number;
}

/** Swapped events logged by the pinned router (and by nothing else) in a receipt. */
export function routerSwaps(logs: RawLog[]): RouterSwap[] {
  const out: RouterSwap[] = [];
  for (const l of logs) {
    if (l.address.toLowerCase() !== KYBER_ROUTER_ADDRESS || l.topics.length !== 1 || l.topics[0]?.toLowerCase() !== KYBER_SWAPPED_TOPIC) continue;
    const d = l.data.startsWith('0x') ? l.data.slice(2) : l.data;
    if (d.length !== 64 * 6 || !/^[0-9a-fA-F]+$/.test(d)) continue;
    const word = (i: number) => d.slice(i * 64, (i + 1) * 64);
    const address = (i: number) => `0x${word(i).slice(24)}`.toLowerCase();
    out.push({ sender: address(0), srcToken: address(1), dstToken: address(2), dstReceiver: address(3), spentAmount: BigInt(`0x${word(4)}`), returnAmount: BigInt(`0x${word(5)}`), logIndex: l.logIndex });
  }
  return out;
}

export type SwapRejectReason = 'not_router_swap' | 'payment_mismatch' | 'no_stock_received' | 'not_from_pool';

export interface VerifiedSwap {
  ok: true;
  token: string;
  /** Raw stock tokens bought: the router's returnAmount. */
  raw: bigint;
  paidWith: 'usdc' | 'weth' | 'eth';
  /** USDC micro-units or wei, as logged by the router. */
  spent: bigint;
  /** Log indexes of the stock transfers that reached the buyer from the router side or a verified pool. */
  logIndexes: number[];
  /** Stock that left verified pools in this receipt. */
  fromPools: bigint;
  /** Other router swaps to the buyer in the same receipt that were not scored. */
  ignoredSwaps: number;
}
export type SwapCheck = VerifiedSwap | { ok: false; reason: SwapRejectReason; detail: string };

interface Shape {
  w: string;
  swap: RouterSwap;
  ignored: number;
  transfers: ParsedTransfer[];
  routerSide: Set<string>;
}

function shape(logs: RawLog[], wallet: string, knownTokens: ReadonlySet<string> | undefined, executors: readonly string[]): Shape | { ok: false; reason: SwapRejectReason; detail: string } {
  const w = wallet.toLowerCase();
  const stock = (a: string) => (knownTokens ? knownTokens.has(a) || isStockToken(a) : isStockToken(a));
  const all = routerSwaps(logs);
  const mine = all.filter((s) => s.sender === w && s.dstReceiver === w && stock(s.dstToken) && s.returnAmount > 0n && s.spentAmount > 0n);
  if (!mine.length) {
    const why = !all.length ? 'no Swapped log from the KyberSwap router' : 'the router swap in this transaction was not made by, or delivered to, this wallet for a stock token';
    return { ok: false, reason: 'not_router_swap', detail: why };
  }
  const transfers = parseTransfers(logs.filter((l) => l.topics[0]?.toLowerCase() === TRANSFER_TOPIC));
  const routerSide = new Set([KYBER_ROUTER_ADDRESS, ...executors.map((e) => e.toLowerCase())]);
  return { w, swap: mine[0]!, ignored: mine.length - 1, transfers, routerSide };
}

/**
 * Addresses the caller must check on chain before calling verifyRouterBuy: every address the
 * bought stock left in this receipt, other than the buyer and the router side. Largest first.
 */
export function poolCandidates(logs: RawLog[], wallet: string, knownTokens?: ReadonlySet<string>, executors: readonly string[] = KYBER_EXECUTORS): string[] {
  const s = shape(logs, wallet, knownTokens, executors);
  if (!('swap' in s)) return [];
  const by = new Map<string, bigint>();
  for (const t of s.transfers) {
    if (t.token !== s.swap.dstToken || t.from === s.w || t.from === t.to || s.routerSide.has(t.from)) continue;
    by.set(t.from, (by.get(t.from) ?? 0n) + t.value);
  }
  return [...by].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0)).map(([a]) => a);
}

/**
 * The full check. `pools` are the addresses (from poolCandidates) the caller verified on chain as
 * Aerodrome pools; anything else is treated as not a pool.
 */
export function verifyRouterBuy(
  logs: RawLog[],
  wallet: string,
  opts: { knownTokens?: ReadonlySet<string>; pools?: ReadonlySet<string>; executors?: readonly string[] } = {},
): SwapCheck {
  const s = shape(logs, wallet, opts.knownTokens, opts.executors ?? KYBER_EXECUTORS);
  if (!('swap' in s)) return s;
  const { w, swap, transfers, routerSide } = s;
  const pools = new Set([...(opts.pools ?? [])].map((p) => p.toLowerCase()));

  let paidWith: 'usdc' | 'weth' | 'eth';
  if (swap.srcToken === USDC_ADDRESS) paidWith = 'usdc';
  else if (swap.srcToken === WETH_ADDRESS) paidWith = 'weth';
  else if (swap.srcToken === NATIVE_ETH_ADDRESS) paidWith = 'eth';
  else return { ok: false, reason: 'payment_mismatch', detail: `paid in ${swap.srcToken}, not USDC or ETH` };
  if (paidWith !== 'eth') {
    // the buyer's own tokens must be seen going toward the router: to the router or its executor
    const out = transfers.filter((t) => t.token === swap.srcToken && t.from === w && routerSide.has(t.to)).reduce((sum, t) => sum + t.value, 0n);
    if (out < swap.spentAmount) return { ok: false, reason: 'payment_mismatch', detail: `the router logged ${swap.spentAmount} spent, but only ${out} went from this wallet to the router` };
  }
  // Native ETH has no Transfer log. The router itself takes msg.value from `sender`, which is the buyer.

  const from = (t: ParsedTransfer) => routerSide.has(t.from) || pools.has(t.from);
  const inbound = transfers.filter((t) => t.token === swap.dstToken && t.to === w && t.from !== w && from(t));
  const outbound = transfers.filter((t) => t.token === swap.dstToken && t.from === w && t.to !== w);
  const net = inbound.reduce((sum, t) => sum + t.value, 0n) - outbound.reduce((sum, t) => sum + t.value, 0n);
  if (net < swap.returnAmount)
    return { ok: false, reason: 'no_stock_received', detail: `the router logged ${swap.returnAmount} returned, but only ${net} reached this wallet from the router or a pool` };

  const fromPools = transfers.filter((t) => t.token === swap.dstToken && pools.has(t.from) && t.to !== t.from).reduce((sum, t) => sum + t.value, 0n);
  // 0.1% of slack for rounding inside a route
  if (fromPools * 1000n < swap.returnAmount * 999n)
    return { ok: false, reason: 'not_from_pool', detail: `the router returned ${swap.returnAmount}, but only ${fromPools} came out of known Aerodrome pools` };

  return {
    ok: true,
    token: swap.dstToken,
    raw: swap.returnAmount,
    paidWith,
    spent: swap.spentAmount,
    logIndexes: inbound.map((t) => t.logIndex),
    fromPools,
    ignoredSwaps: s.ignored,
  };
}
