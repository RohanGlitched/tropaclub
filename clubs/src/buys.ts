/**
 * Verified buys. The client posts a tx hash after the wallet confirms; the server verifies:
 *   1. not seen before (doc id = tx hash, atomic create),
 *   2. receipt exists and succeeded,
 *   3. ERC-8021 suffix with our Builder Code (@tropaclub/buy verifyAttribution: tx input or UserOp callData),
 *   4. signer (tx.from, or the 4337 account) is the member's wallet,
 *   5. a stock token Transfer to the wallet in the receipt (token + raw amount),
 *   6. USD in: net USDC out of the wallet, else WETH x ETH/USD, else tx ETH value x ETH/USD, else mark x qty,
 *   7. wash rule (buy -> sell -> buy of the same token within 24 h scores 0, both buys).
 * A qualifying buy (attributed, >= $5, not wash, wallet not excluded) promotes the seat to playing.
 * A nightly/hourly sweep (sweepTransfers) catches missed attributed buys and records member outflows.
 */
import { ensureWallet, memberId, walletClubs } from './clubs';
import { type ClubsContext, need } from './context';
import { gameweekForBuy } from './calendar';
import { buyGate } from './geo';
import { isExcluded, loadLedger } from './ledger';
import { WASH_WINDOW_SEC, washBuys } from './lots';
import { legUsd, parseTransfers, paymentLeg, receiptOk, stockLegs } from './chain/receipt';
import { AlreadyExistsError, inc } from './store/docstore';
import {
  COL,
  type BuyDoc,
  type BuyRejectDoc,
  type BuyRejectReason,
  type GeoLogDoc,
  type MarkDoc,
  type MemberDoc,
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
  not_member: 'Join the club before recording a buy for it.',
  region_blocked: 'Buying is not available in your region.',
};

async function reject(ctx: ClubsContext, txHash: string, wallet: string, reason: BuyRejectReason, attributed: boolean | null, persist = true): Promise<RecordBuyResult> {
  if (persist) await ctx.store.set<BuyRejectDoc>(COL.buyRejects, txHash, { txHash, wallet, reason, attributed, at: ctx.now() });
  return { ok: false, reason, message: MESSAGES[reason], retryable: reason === 'not_found' };
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

  const transfers = parseTransfers(receipt.logs);
  const legs = stockLegs(transfers, wallet, new Set(ctx.config.tokens.keys()));
  const leg = legs[0];
  if (!leg) return reject(ctx, txHash, wallet, 'no_stock_received', true);

  const blockNumber = receipt.blockNumber;
  const blockTime = await chain.getBlockTime(blockNumber);
  const tokens = Number(leg.raw) / 1e8;
  const notes: string[] = [];
  if (legs.length > 1) notes.push(`multi-token receipt: scored ${leg.token}, ignored ${legs.length - 1} other leg(s)`);

  let usdIn: number | null = null;
  let usdSource: UsdSource | null = null;
  const pay = paymentLeg(transfers, wallet, tx);
  if (pay) {
    usdIn = legUsd(pay, pay.source === 'usdc' ? null : await chain.ethUsd(blockNumber));
    usdSource = usdIn != null ? pay.source : null;
  }
  if (usdIn == null && ctx.prices) {
    const m = await ctx.prices.markAt(leg.token, blockTime);
    if (m) {
      usdIn = m.usd * tokens;
      usdSource = 'mark';
      notes.push(`USD in estimated from ${m.source} mark`);
    }
  }
  const priceAtBuy = usdIn != null && tokens > 0 ? usdIn / tokens : null;

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
    symbol: ctx.config.tokens.get(leg.token) ?? null,
    rawAmount: leg.raw.toString(),
    usdIn: usdIn == null ? null : round(usdIn, 6),
    usdSource,
    priceAtBuy: priceAtBuy == null ? null : round(priceAtBuy, 8),
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
  for (const li of leg.logIndexes) {
    const t = transfers.find((x) => x.logIndex === li)!;
    await upsertTransfer(ctx, { wallet, token: leg.token, dir: 'in', raw: t.value, blockNumber: Number(blockNumber), blockTime, txHash, logIndex: li, counterparty: t.from, tropa: true });
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
): Promise<{ fromBlock: number; toBlock: number; inbound: number; outbound: number; recorded: number }> {
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
  return { fromBlock: Number(from), toBlock: Number(to), inbound, outbound, recorded };
}
