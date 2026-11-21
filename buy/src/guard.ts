/**
 * Buy guard: amountOutMin = mark x (1 - 1.5%), in RAW token units.
 *
 * Units (docs.base.org list-tokenized-stocks + on-chain check, Nov 22 2026):
 *   feed / nav / TWAP mark  = USD per whole raw token        (total return = underlying price x multiplier)
 *   underlying USD / share  = mark / multiplier
 *   UI shares bought        = usdIn / (mark / multiplier)    (what the user "owns" in shares)
 *   raw units               = fromUIAmount(UI shares) = UI shares / multiplier  ==  usdIn / mark
 * SNDKc (x8): $10 at mark $649.44 -> 0.1232 UI shares -> 0.0154 raw tokens = 1,539,788 raw units (8 decimals).
 * Getting this wrong by the multiplier makes the guard 8x too loose (toothless) or 8x too tight (always reverts);
 * `checkMarkUnits` compares the mark with the live DEX price to catch exactly that.
 */
import { type Address, type PublicClient } from 'viem';
import { evaluateCorporateActions, fetchActionStatuses, actionUuid, type AnnouncementLog, type CorporateActionState } from './actions';
import { GUARD_BPS } from './constants';
import {
  getReferenceMark,
  readTokenInfo,
  usdValueOfInput,
  type ReferenceMark,
  type TokenInfo,
} from './market';

export const WAD = 10n ** 18n;

/** Local ERC-8056 fromUIAmount: raw = ui * WAD / multiplier (floor), matching the B20 precompile. */
export function fromUIAmountLocal(ui: bigint, multiplierWad: bigint): bigint {
  return (ui * WAD) / multiplierWad;
}
export function toUIAmountLocal(raw: bigint, multiplierWad: bigint): bigint {
  return (raw * multiplierWad) / WAD;
}

export interface GuardMath {
  usdPerShare8: bigint; // underlying USD per UI share (8 dp)
  uiShares: bigint; // UI shares in token decimals
  fairRaw: bigint; // raw units at the mark
  amountOutMin: bigint; // raw units after the guard
}

/** Pure guard conversion. usdIn6 = input value in micro-USD; mark8 = USD per whole raw token (8 dp). */
export function computeGuardMinOut(p: {
  usdIn6: bigint;
  mark8: bigint;
  decimals: number;
  multiplierWad: bigint;
  guardBps?: number;
}): GuardMath {
  const { usdIn6, mark8, decimals, multiplierWad } = p;
  const bps = BigInt(p.guardBps ?? GUARD_BPS);
  if (mark8 <= 0n) throw new Error('mark must be positive');
  if (multiplierWad <= 0n) throw new Error('multiplier must be positive');
  const scale = 10n ** BigInt(decimals);
  const usdPerShare8 = (mark8 * WAD) / multiplierWad;
  // uiShares = usdIn / usdPerShare, carried with WAD extra precision to avoid double rounding
  const uiSharesWad = (usdIn6 * scale * 100n * WAD * multiplierWad) / (mark8 * WAD); // usdIn6*100 -> 8 dp
  const uiShares = uiSharesWad / WAD;
  const fairRaw = fromUIAmountLocal(uiSharesWad, multiplierWad) / WAD;
  const amountOutMin = (fairRaw * (10_000n - bps)) / 10_000n;
  return { usdPerShare8, uiShares, fairRaw, amountOutMin };
}

export type UnitCheck = { ok: true; ratio: number } | { ok: false; ratio: number; reason: string };

/**
 * The mark (USD per raw token) must agree with the DEX price per raw token. If it is off by ~the multiplier
 * the reference is per-share (or double-applied) and the guard would be toothless / always revert.
 */
export function checkMarkUnits(p: { mark8: bigint; dexUsdPerToken8: bigint; multiplierWad: bigint; toleranceBps?: number }): UnitCheck {
  const ratio = Number(p.mark8) / Number(p.dexUsdPerToken8);
  const mult = Number(p.multiplierWad) / 1e18;
  const tol = (p.toleranceBps ?? 1000) / 10_000;
  if (Math.abs(ratio - 1) <= tol) return { ok: true, ratio };
  if (mult !== 1 && (Math.abs(ratio / mult - 1) <= tol || Math.abs(ratio * mult - 1) <= tol)) {
    return { ok: false, ratio, reason: `reference price is off by the x${mult} multiplier (per-share vs per-token units)` };
  }
  return { ok: false, ratio, reason: `reference price is ${((ratio - 1) * 100).toFixed(1)}% away from the DEX price` };
}

export interface GuardResult extends GuardMath {
  token: Address;
  decimals: number;
  multiplierWad: bigint;
  mark: ReferenceMark;
  usdIn6: bigint;
  usdInSource: 'usdc' | 'chainlink-eth' | 'aggregator';
  quotedOut: bigint;
  /** quotedOut >= amountOutMin: the aggregator's route clears the guard. */
  quoteOk: boolean;
  /** (quotedOut / fairRaw - 1) in bps; negative = paying above the mark. */
  quoteVsMarkBps: number;
  reopenGapRisk: boolean;
  unitCheck: UnitCheck;
}

export interface GuardOptions {
  client: PublicClient;
  nowSec?: number;
  guardBps?: number;
  /** Aggregator's USD estimate of the input (only used for non-USDC/ETH inputs). */
  sellAmountUsd?: number;
  info?: TokenInfo;
  mark?: ReferenceMark | null;
}

export async function guardMinOut(
  p: { token: Address; quotedOut: bigint; sellToken: Address; sellAmount: bigint },
  opts: GuardOptions,
): Promise<GuardResult> {
  const { client } = opts;
  const info = opts.info ?? (await readTokenInfo(client, p.token));
  const mark = opts.mark !== undefined ? opts.mark : await getReferenceMark(client, p.token, { nowSec: opts.nowSec, decimals: info.decimals });
  if (!mark) throw new GuardError('NO_MARK', `no reference price for ${info.symbol}`);
  const { usd6, source } = await usdValueOfInput(client, p.sellToken, p.sellAmount, opts.sellAmountUsd);
  const math = computeGuardMinOut({ usdIn6: usd6, mark8: mark.usdPerToken8, decimals: info.decimals, multiplierWad: info.multiplierWad, guardBps: opts.guardBps });

  // Unit sanity: compare the mark with the price implied by the live quote.
  const dexUsdPerToken8 = p.quotedOut > 0n ? (usd6 * 100n * 10n ** BigInt(info.decimals)) / p.quotedOut : 0n;
  const unitCheck: UnitCheck = dexUsdPerToken8 > 0n
    ? checkMarkUnits({ mark8: mark.usdPerToken8, dexUsdPerToken8, multiplierWad: info.multiplierWad })
    : { ok: false, ratio: NaN, reason: 'empty quote' };

  const quoteVsMarkBps = math.fairRaw > 0n ? Number(((p.quotedOut - math.fairRaw) * 10_000n) / math.fairRaw) : 0;
  return {
    ...math,
    token: info.address,
    decimals: info.decimals,
    multiplierWad: info.multiplierWad,
    mark,
    usdIn6: usd6,
    usdInSource: source,
    quotedOut: p.quotedOut,
    quoteOk: p.quotedOut >= math.amountOutMin,
    quoteVsMarkBps,
    reopenGapRisk: mark.reopenGapRisk,
    unitCheck,
  };
}

export class GuardError extends Error {
  constructor(public code: 'NO_MARK' | 'NOT_BUYABLE' | 'QUOTE_BELOW_GUARD' | 'UNITS', message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------- isBuyable

export interface BuyableResult {
  buyable: boolean;
  /** One plain sentence when not buyable. */
  reason?: string;
  reasons: string[];
  symbol: string;
  mark: ReferenceMark | null;
  reopenGapRisk: boolean;
  corporateActions: CorporateActionState;
  info: TokenInfo;
}

export interface BuyableOptions {
  client: PublicClient;
  nowSec?: number;
  /** Announcement logs for this token (from the indexer or AnnouncementWatcher). Without them only on-chain state is checked. */
  announcements?: AnnouncementLog[];
  /** Look up Coinbase corporate-action status for announced UUIDs (default true). */
  checkActionApi?: boolean;
  /** Max drift between the pool TWAP and the last official close while the feed is frozen (default 7.5%). */
  maxFrozenDriftBps?: number;
  fetchImpl?: typeof fetch;
}

export async function isBuyable(token: Address, opts: BuyableOptions): Promise<BuyableResult> {
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const info = await readTokenInfo(opts.client, token);
  const reasons: string[] = [];

  if (info.registryPaused) reasons.push(`${info.symbol} is paused in Coinbase's oracle registry (corporate action in progress)`);
  if (info.transferPaused) reasons.push(`${info.symbol} transfers are paused by the issuer`);
  if (info.registryMultiplierWad !== info.multiplierWad)
    reasons.push(`${info.symbol} multiplier differs between the token and the oracle registry (mid-update)`);

  const logs = (opts.announcements ?? []).filter((l) => l.token.toLowerCase() === token.toLowerCase());
  let apiStatus: Record<string, string | undefined> = {};
  if (logs.length && opts.checkActionApi !== false) {
    const uuids = [...new Set(logs.filter((l) => l.kind === 'Announcement').map((l) => actionUuid(l)))];
    apiStatus = await fetchActionStatuses(uuids, opts.fetchImpl);
  }
  const corporateActions = evaluateCorporateActions(logs, info, nowSec, apiStatus);
  reasons.push(...corporateActions.reasons);

  const mark = await getReferenceMark(opts.client, token, { nowSec, decimals: info.decimals, fetchImpl: opts.fetchImpl });
  if (!mark) reasons.push(`${info.symbol} has no reference price (no Chainlink feed, no Coinbase NAV, no USDC pool)`);
  else if (mark.source === 'twap' && mark.lastClose8) {
    const drift = Math.abs(Number(mark.usdPerToken8) / Number(mark.lastClose8) - 1) * 10_000;
    if (drift > (opts.maxFrozenDriftBps ?? 750))
      reasons.push(`${info.symbol} trades ${(drift / 100).toFixed(1)}% away from its last close while the market is shut`);
  }

  return {
    buyable: reasons.length === 0,
    reason: reasons.length ? capitalize(reasons[0]!) + '.' : undefined,
    reasons,
    symbol: info.symbol,
    mark,
    reopenGapRisk: mark?.reopenGapRisk ?? false,
    corporateActions,
    info,
  };
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

