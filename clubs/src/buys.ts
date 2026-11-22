/**
 * Verified buys. The client posts a tx hash after the wallet confirms; the server verifies:
 *   1. not seen before (doc id = tx hash, atomic create),
 *   2. receipt exists and succeeded,
 *   3. ERC-8021 suffix with our Builder Code (@tropaclub/buy verifyAttribution: tx input or UserOp callData),
 *   4. signer (tx.from, or the 4337 account) is the member's wallet,
 *   5. the receipt shows our swap (chain/swap.ts): the pinned KyberSwap router logged Swapped for this
 *      wallet, the payment left the wallet, and the wallet's stock balance rose by what the router returned,
 *   6. the stock came out of a real Aerodrome pool in that receipt (factory-checked on chain, and known
 *      to the indexer),
 *   7. USD in is what the router logged as spent (USDC, or ETH/WETH x ETH/USD), and the price that implies
 *      is within 10% of the mark at that block in NYSE regular hours, 20% outside them (fillCheck). Outside
 *      that the buy is refused and logged to buyRejects. The quote shown before signing runs the same check,
 *      so nobody signs a buy that would be refused,
 *   8. the buy's cost basis for club returns is that MARK, never the fill,
 *   9. wash rule (buy -> sell -> buy of the same token within 24 h scores 0, both buys).
 * The Builder Code alone proves nothing: anyone can append it to a batch that passes $5 one way and a
 * share the other between their own wallets. Nothing is recorded, scored or counted without 5 to 8.
 * A qualifying buy (attributed, >= $5, not wash, wallet not excluded) promotes the seat to playing.
 * A buy that cannot be checked yet (no usable mark, no ETH price, a pool check that did not answer) is
 * kept in pendingBuys, and every sweep tries it again until it is decided (or 30 days pass).
 * A nightly/hourly sweep (sweepTransfers) catches missed attributed buys and records member outflows.
 */
import { ensureWallet, memberId, walletClubs } from './clubs';
import { type ClubsContext, need } from './context';
import { gameweekForBuy } from './calendar';
import { buyGate } from './geo';
import { isExcluded, loadLedger } from './ledger';
import { WASH_WINDOW_SEC, washBuys } from './lots';
import { parseTransfers, receiptOk } from './chain/receipt';
import { fillCheck, poolCandidates, routerSwaps, verifyRouterBuy } from './chain/swap';
import { AlreadyExistsError, inc } from './store/docstore';
import {
  COL,
  type BuyDoc,
  type BuyRejectDoc,
  type BuyRejectReason,
  type GeoLogDoc,
  type MarkDoc,
  type MemberDoc,
  type PendingBuyDoc,
  type SyncStateDoc,
  type TransferDoc,
  type UsdSource,
} from './types';
import { normAddr, normHash, round } from './util';

export type RecordBuyResult =
  | { ok: true; buy: BuyDoc; promoted: boolean; seats: { clubId: string; seat: MemberDoc['seat'] }[] }
  | { ok: false; reason: BuyRejectReason; message: string; retryable?: boolean };

const MESSAGES: Record<BuyRejectReason, string> = {
  duplicate: 'This buy is already recorded.',
  not_found: 'Transaction not found yet. Try again once it confirms.',
  reverted: 'That transaction failed onchain.',
  not_attributed: "That transaction wasn't made through Tropa Club (no Tropa Builder Code).",
  not_from_wallet: "That transaction wasn't signed by this wallet.",
  no_stock_received: 'No stock token reached this wallet in that transaction.',
  not_router_swap: "That transaction isn't a Tropa Club buy: it has no swap by this wallet on the router we use.",
  payment_mismatch: "That transaction's payment doesn't match its swap, so it isn't counted.",
  not_from_pool: "The stock in that transaction didn't come from a known Aerodrome pool, so it isn't counted.",
  price_off_mark: "That buy's price was too far from the market price at the time (more than 10% in market hours, 20% outside them), so it isn't counted.",
  cannot_verify_now: 'The buy went through, but it could not be checked just now. It will be checked again automatically, so nothing is lost.',
  not_member: 'Join the club before recording a buy for it.',
  region_blocked: 'Buying is not available in your region.',
};

async function reject(ctx: ClubsContext, txHash: string, wallet: string, reason: BuyRejectReason, attributed: boolean | null, persist = true, detail?: string): Promise<RecordBuyResult> {
  if (persist) await ctx.store.set<BuyRejectDoc>(COL.buyRejects, txHash, { txHash, wallet, reason, attributed, at: ctx.now(), ...(detail ? { detail: detail.slice(0, 300) } : {}) });
  return { ok: false, reason, message: MESSAGES[reason], retryable: reason === 'not_found' || reason === 'cannot_verify_now' };
}

/**
 * Which of these addresses are real Aerodrome pools: factory-checked on chain, and known to the
 * indexer. null when a check could not be made right now (the buyer is asked to try again).
 */
async function verifiedPools(ctx: ClubsContext, candidates: string[], token: { address: string; symbol: string | null }): Promise<Set<string> | null> {
  const chain = ctx.chain;
  const out = new Set<string>();
  if (!chain?.isAerodromePool) return out;
  let unknown = false;
  // a route never has more than a few pools; the largest senders come first
  for (const a of candidates.slice(0, 8)) {
    let real: boolean | null;
    try {
      real = await chain.isAerodromePool(a);
      if (real && ctx.poolCheck) real = await ctx.poolCheck(a, token);
    } catch {
      real = null;
    }
    if (real === null) unknown = true;
    else if (real) out.add(a);
  }
  return unknown ? null : out;
}

/** How long a buy that cannot be checked is retried by the sweep. */
export const PENDING_BUY_TTL_SEC = 30 * 86_400;

/** Keep a buy that could not be checked yet, so the sweep tries it again. Nothing about it is decided. */
async function retryLater(ctx: ClubsContext, txHash: string, wallet: string, clubId: string | null, why: string): Promise<RecordBuyResult> {
  const prev = await ctx.store.get<PendingBuyDoc>(COL.pendingBuys, txHash);
  const now = ctx.now();
  await ctx.store.set<PendingBuyDoc>(COL.pendingBuys, txHash, { txHash, wallet, clubId: clubId ?? prev?.clubId ?? null, firstAt: prev?.firstAt ?? now, lastAt: now, attempts: (prev?.attempts ?? 0) + 1, why });
  return reject(ctx, txHash, wallet, 'cannot_verify_now', true, false);
}

export async function logGeoDecision(ctx: ClubsContext, d: Omit<GeoLogDoc, 'at'>): Promise<void> {
  const at = ctx.now();
  await ctx.store.set<GeoLogDoc>(COL.geoLog, `${at}_${Math.random().toString(36).slice(2, 10)}`, { at, ...d });
}

export async function recordBuy(
  ctx: ClubsContext,
  input: {
    txHash: string;
    wallet: string;
    clubId: string | null;
    /** From countryFromHeaders(req.headers); never stored against the wallet. */
    country?: string | null;
    selfCertifiedUsPerson?: boolean;
    /** The buyer ticked "I am not a US person" before this buy. Stored on the buy record. */
    certifiedNotUsPerson?: boolean;
    source?: 'client' | 'sweep';
  },
): Promise<RecordBuyResult> {
  const chain = need(ctx.chain, 'chain reader');
  const txHash = normHash(input.txHash);
  const wallet = normAddr(input.wallet);
  const source = input.source ?? 'client';

  // Everything is checked before anything is written: a made-up hash or a blocked region leaves no trace.
  const gate = source === 'client' ? buyGate(ctx.geo, input.country ?? null, { selfCertifiedUsPerson: input.selfCertifiedUsPerson }) : null;
  if (gate && !gate.allowed) return reject(ctx, txHash, wallet, 'region_blocked', null, false);
  // A club is optional: a buy with no club still counts for the wallet. A named club must be one the wallet is in.
  if (source === 'client' && input.clubId && !(await ctx.store.get<MemberDoc>(COL.members, memberId(input.clubId, wallet))))
    return reject(ctx, txHash, wallet, 'not_member', null, false);
  if (await ctx.store.get<BuyDoc>(COL.buys, txHash)) return reject(ctx, txHash, wallet, 'duplicate', true, false);

  const receipt = await chain.getReceipt(txHash);
  if (!receipt) return reject(ctx, txHash, wallet, 'not_found', null, false);
  // first write: only for a transaction that exists on Base
  if (gate) await logGeoDecision(ctx, { country: gate.country, decision: 'allow', reason: gate.reason, surface: 'record_buy' });
  if (!receiptOk(receipt)) return reject(ctx, txHash, wallet, 'reverted', null);

  const attribution = await chain.verifyAttribution(txHash);
  if (!attribution.attributed) return reject(ctx, txHash, wallet, 'not_attributed', false);

  const tx = await chain.getTransaction(txHash);
  const signer = (attribution.from ?? tx?.from ?? receipt.from).toLowerCase();
  if (signer !== wallet) return reject(ctx, txHash, wallet, 'not_from_wallet', true);

  // The receipt must show our swap. Everything scored below comes from the router's own log.
  const transfers = parseTransfers(receipt.logs);
  const knownTokens = new Set(ctx.config.tokens.keys());
  const shapeOnly = verifyRouterBuy(receipt.logs, wallet, { knownTokens, executors: ctx.config.kyberExecutors });
  // not_from_pool (and a short delivery) can only be decided once the pools are checked below
  if (!shapeOnly.ok && shapeOnly.reason !== 'not_from_pool' && shapeOnly.reason !== 'no_stock_received') return reject(ctx, txHash, wallet, shapeOnly.reason, true, true, shapeOnly.detail);
  const candidates = poolCandidates(receipt.logs, wallet, knownTokens, ctx.config.kyberExecutors);
  const dst = routerSwaps(receipt.logs).find((x) => x.sender === wallet && x.dstReceiver === wallet)?.dstToken ?? '';
  const pools = await verifiedPools(ctx, candidates, { address: dst, symbol: ctx.config.tokens.get(dst) ?? null });
  if (pools === null) return retryLater(ctx, txHash, wallet, input.clubId, 'a pool check did not answer');
  const swap = verifyRouterBuy(receipt.logs, wallet, { knownTokens, pools, executors: ctx.config.kyberExecutors });
  if (!swap.ok) {
    const detail = swap.reason === 'not_from_pool' ? `${swap.detail}; senders: ${candidates.slice(0, 4).join(', ') || 'none'}` : swap.detail;
    return reject(ctx, txHash, wallet, swap.reason, true, true, detail);
  }
  const leg = { token: swap.token, raw: swap.raw, logIndexes: swap.logIndexes };
  const symbol = ctx.config.tokens.get(leg.token) ?? null;

  const blockNumber = receipt.blockNumber;
  const blockTime = await chain.getBlockTime(blockNumber);
  const tokens = Number(leg.raw) / 1e8;
  const notes: string[] = [];
  if (swap.ignoredSwaps) notes.push(`${swap.ignoredSwaps} other router swap(s) in this transaction were not scored`);

  let usdIn: number | null;
  const usdSource: UsdSource = swap.paidWith;
  if (swap.paidWith === 'usdc') usdIn = Number(swap.spent) / 1e6;
  else {
    const ethUsd = await chain.ethUsd(blockNumber);
    usdIn = ethUsd == null ? null : (Number(swap.spent) / 1e18) * ethUsd;
  }
  // The price check. Without a mark, or an ETH price, nothing can be compared yet: the sweep tries again.
  const mark = ctx.prices ? await ctx.prices.markAt(leg.token, blockTime) : null;
  if (!(tokens > 0)) return reject(ctx, txHash, wallet, 'no_stock_received', true, true, 'the router returned nothing');
  if (usdIn == null) return retryLater(ctx, txHash, wallet, input.clubId, 'no ETH price for that block');
  if (!mark || !(mark.usd > 0)) return retryLater(ctx, txHash, wallet, input.clubId, 'no usable mark for that block');
  const fillPrice = usdIn / tokens;
  const check = fillCheck(fillPrice, mark.usd, blockTime);
  if (!check.ok)
    return reject(ctx, txHash, wallet, 'price_off_mark', true, true, `fill $${fillPrice.toFixed(4)} vs ${mark.source} mark $${mark.usd.toFixed(4)} (${(check.off * 100).toFixed(1)}%, limit ${(check.limit * 100).toFixed(0)}%)`);
  // Club returns start from the mark, never from the fill.
  const priceAtBuy: number | null = mark.usd;

  // Prior balance (head of FIFO) on the wallet's first Tropa buy of this token.
  const ledger = await loadLedger(ctx, wallet);
  const sameToken = ledger.buys.filter((b) => b.token === leg.token);
  let priorBalanceRaw: string | null = null;
  if (!sameToken.length) {
    const bal = await chain.balanceOf(leg.token, wallet, blockNumber - 1n);
    priorBalanceRaw = bal == null ? '0' : bal.toString();
    if (bal == null) notes.push('prior balance unavailable; assumed 0');
  }

  // Wash: earlier buys of the token inside 24 h, and any outflow between them.
  const recent = sameToken.filter((b) => b.attributed && blockTime - b.blockTime <= WASH_WINDOW_SEC);
  const outs = ledger.transfers.filter((t) => t.dir === 'out' && t.token === leg.token).map((t) => ({ token: t.token, t: t.blockTime, txHash: t.txHash }));
  if (recent.length && chain.getTransferLogs) {
    const from = BigInt(Math.min(...recent.map((b) => b.blockNumber)));
    const logs = await chain.getTransferLogs({ tokens: [leg.token], from: [wallet], fromBlock: from, toBlock: blockNumber }).catch(() => []);
    for (const l of logs) {
      const t = await chain.getBlockTime(l.blockNumber);
      outs.push({ token: l.token, t, txHash: l.txHash });
      await upsertTransfer(ctx, { wallet, token: l.token, dir: 'out', raw: l.value, blockNumber: Number(l.blockNumber), blockTime: t, txHash: l.txHash, logIndex: l.logIndex, counterparty: l.to, tropa: false });
    }
  }
  const washSet = washBuys([...recent.map((b) => ({ txHash: b.txHash, token: b.token, t: b.blockTime })), { txHash, token: leg.token, t: blockTime }], outs);
  const wash = washSet.has(txHash);

  const excluded = await isExcluded(ctx, wallet);
  const qualifies = !wash && !excluded && usdIn != null && usdIn >= ctx.config.minBuyUsd;
  if (usdIn != null && usdIn < ctx.config.minBuyUsd) notes.push(`below the $${ctx.config.minBuyUsd} minimum`);
  if (wash) notes.push('wash pattern (buy-sell-buy inside 24 h): scores 0');
  if (excluded) notes.push('wallet is on the public exclusion list');

  const clubId = input.clubId ?? (await walletClubs(ctx, wallet))[0]?.club.id ?? null;
  const buy: BuyDoc = {
    txHash,
    wallet,
    clubId,
    token: leg.token,
    symbol,
    rawAmount: leg.raw.toString(),
    usdIn: usdIn == null ? null : round(usdIn, 6),
    usdSource,
    priceAtBuy: priceAtBuy == null ? null : round(priceAtBuy, 8),
    fillPrice: round(fillPrice, 8),
    markSource: mark.source,
    verified: true,
    blockNumber: Number(blockNumber),
    blockTime,
    attributed: true,
    codes: attribution.codes,
    via: attribution.via,
    qualifies,
    wash,
    excluded,
    priorBalanceRaw,
    gw: gameweekForBuy(blockTime)?.id ?? null,
    recordedAt: ctx.now(),
    source,
    notes,
    ...(input.certifiedNotUsPerson === undefined ? {} : { notUsCertified: input.certifiedNotUsPerson }),
  };
  try {
    await ctx.store.create(COL.buys, txHash, buy);
  } catch (e) {
    if (e instanceof AlreadyExistsError) return reject(ctx, txHash, wallet, 'duplicate', true, false);
    throw e;
  }
  await ctx.store.delete(COL.pendingBuys, txHash).catch(() => {});
  // Only what the router returned, delivered by the router side or a verified pool, is a Tropa lot.
  // Anything else that arrived in the same transaction is stored as an ordinary transfer in.
  const allowed = new Set(leg.logIndexes);
  let left = leg.raw;
  for (const t of transfers.filter((x) => x.token === leg.token && x.to === wallet && x.from !== wallet)) {
    const ours = allowed.has(t.logIndex) && left > 0n && t.value <= left;
    if (ours) left -= t.value;
    await upsertTransfer(ctx, { wallet, token: leg.token, dir: 'in', raw: t.value, blockNumber: Number(blockNumber), blockTime, txHash, logIndex: t.logIndex, counterparty: t.from, tropa: ours });
  }
  // A buy's own fill price is never stored as a shared mark: anyone can craft a transaction with an
  // absurd price. Marks come from the close captures and the Chainlink feeds only.
  // Earlier buys caught by this one's wash pattern lose their score too.
  for (const h of washSet) if (h !== txHash) await ctx.store.update(COL.buys, h, { wash: true, qualifies: false });

  await ensureWallet(ctx, wallet);
  if (qualifies) {
    const w = (await ctx.store.get<{ firstQualifyingBuyAt: number | null }>(COL.wallets, wallet))!;
    await ctx.store.update(COL.wallets, wallet, {
      qualifyingBuys: inc(1),
      firstQualifyingBuyAt: w.firstQualifyingBuyAt == null || blockTime < w.firstQualifyingBuyAt ? blockTime : w.firstQualifyingBuyAt,
    });
  }
  const { seats, promoted } = await refreshSeats(ctx, wallet);
  return { ok: true, buy, promoted, seats };
}

export async function upsertTransfer(ctx: ClubsContext, t: Omit<TransferDoc, 'id' | 'raw'> & { raw: bigint }): Promise<void> {
  const id = `${t.txHash}_${t.logIndex}`;
  const existing = await ctx.store.get<TransferDoc>(COL.transfers, id);
  const doc: TransferDoc = { ...t, id, raw: t.raw.toString(), tropa: t.tropa || !!existing?.tropa };
  await ctx.store.set(COL.transfers, id, doc);
}

/**
 * Recompute every seat of the wallet from its qualifying buys. Stock clubs count buys of their own
 * token only; private and pick-up clubs count any stock token.
 */
export async function refreshSeats(ctx: ClubsContext, wallet: string): Promise<{ seats: { clubId: string; seat: MemberDoc['seat'] }[]; promoted: boolean }> {
  const ledger = await loadLedger(ctx, wallet);
  const memberships = await walletClubs(ctx, wallet);
  let promoted = false;
  const seats: { clubId: string; seat: MemberDoc['seat'] }[] = [];
  for (const { member, club } of memberships) {
    const eligible = ledger.qualifying.filter((b) => club.kind !== 'stock' || b.token === club.stockToken);
    const seat = eligible.length ? 'playing' : 'bench';
    const firstPlayingAt = eligible.length ? Math.min(...eligible.map((b) => b.blockTime)) : null;
    if (seat !== member.seat || firstPlayingAt !== member.firstPlayingAt) {
      await ctx.store.update(COL.members, member.id, { seat, firstPlayingAt });
      if (seat !== member.seat) {
        await ctx.store.update(COL.clubs, club.id, { playingCount: inc(seat === 'playing' ? 1 : -1) });
        if (seat === 'playing') promoted = true;
      }
    }
    seats.push({ clubId: club.id, seat });
  }
  return { seats, promoted };
}

/**
 * Sweep member stock-token movements from the chain (cron, hourly during the contest):
 * inbound attributed txs not yet recorded are recorded (source 'sweep'); everything else is stored as
 * a transfer so FIFO, wash and hold checks see sells and transfers-out.
 */
export async function sweepTransfers(
  ctx: ClubsContext,
  opts: { fromBlock?: bigint; toBlock?: bigint; tokens?: string[]; maxBlocks?: bigint } = {},
): Promise<{ fromBlock: number; toBlock: number; inbound: number; outbound: number; recorded: number; retried: number }> {
  const chain = need(ctx.chain, 'chain reader');
  if (!chain.getTransferLogs) throw new Error('chain reader has no getTransferLogs');
  const members = await ctx.store.query<MemberDoc>(COL.members);
  const wallets = [...new Set(members.map((m) => m.wallet))];
  const tokens = opts.tokens ?? [...ctx.config.tokens.keys()];
  const cursor = await ctx.store.get<SyncStateDoc>(COL.syncState, 'transfers');
  const head = opts.toBlock ?? (await chain.blockNumber()) - 30n;
  const from = opts.fromBlock ?? (cursor ? BigInt(cursor.lastBlock + 1) : head - 18_000n);
  const to = opts.maxBlocks && head - from > opts.maxBlocks ? from + opts.maxBlocks : head;
  let inbound = 0;
  let outbound = 0;
  let recorded = 0;
  // Buys that could not be checked before (no mark yet, a check that did not answer): try them again.
  // A transaction that is real is never dropped just because its mark came late.
  let retried = 0;
  for (const p of (await ctx.store.query<PendingBuyDoc>(COL.pendingBuys)).sort((x, y) => x.firstAt - y.firstAt).slice(0, 50)) {
    retried++;
    const r = await recordBuy(ctx, { txHash: p.txHash, wallet: p.wallet, clubId: p.clubId, source: 'sweep' });
    if (r.ok) recorded++;
    else if (r.reason !== 'cannot_verify_now') await ctx.store.delete(COL.pendingBuys, p.txHash).catch(() => {});
    else if (ctx.now() - p.firstAt > PENDING_BUY_TTL_SEC) {
      await ctx.store.delete(COL.pendingBuys, p.txHash).catch(() => {});
      await ctx.store.set<BuyRejectDoc>(COL.buyRejects, p.txHash, { txHash: p.txHash, wallet: p.wallet, reason: 'cannot_verify_now', attributed: true, at: ctx.now(), detail: `could not be checked for 30 days: ${p.why}` });
    }
  }
  if (wallets.length && tokens.length && from <= to) {
    const ins = await chain.getTransferLogs({ tokens, to: wallets, fromBlock: from, toBlock: to });
    const outs = await chain.getTransferLogs({ tokens, from: wallets, fromBlock: from, toBlock: to });
    const seenTx = new Set<string>();
    for (const l of ins) {
      inbound++;
      if (!(await ctx.store.get<BuyDoc>(COL.buys, l.txHash)) && !seenTx.has(l.txHash)) {
        seenTx.add(l.txHash);
        const att = await chain.verifyAttribution(l.txHash).catch(() => null);
        if (att?.attributed) {
          const r = await recordBuy(ctx, { txHash: l.txHash, wallet: l.to, clubId: null, source: 'sweep' });
          if (r.ok) {
            recorded++;
            continue;
          }
        }
      }
      if (await ctx.store.get<BuyDoc>(COL.buys, l.txHash)) continue;
      const t = await chain.getBlockTime(l.blockNumber);
      await upsertTransfer(ctx, { wallet: l.to, token: l.token, dir: 'in', raw: l.value, blockNumber: Number(l.blockNumber), blockTime: t, txHash: l.txHash, logIndex: l.logIndex, counterparty: l.from, tropa: false });
    }
    for (const l of outs) {
      outbound++;
      const t = await chain.getBlockTime(l.blockNumber);
      await upsertTransfer(ctx, { wallet: l.from, token: l.token, dir: 'out', raw: l.value, blockNumber: Number(l.blockNumber), blockTime: t, txHash: l.txHash, logIndex: l.logIndex, counterparty: l.to, tropa: false });
    }
    for (const w of new Set(outs.map((o) => o.from))) await refreshSeats(ctx, w);
  }
  await ctx.store.set<SyncStateDoc>(COL.syncState, 'transfers', { id: 'transfers', lastBlock: Number(to), updatedAt: ctx.now() });
  return { fromBlock: Number(from), toBlock: Number(to), inbound, outbound, recorded, retried };
}
