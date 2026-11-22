/**
 * /stats numbers. Exclusion-list wallets are removed everywhere; Bench seats are reported separately
 * from Playing members; only user-signed buys count (never our own attestations).
 */
import { LAUNCH_AT, SEASON } from './calendar';
import { type CohortSubject, heldAt, rate } from './cohort';
import type { ClubsContext } from './context';
import { loadLedger, type WalletLedger } from './ledger';
import { COL, type BuyDoc, type BuyRejectDoc, type CallupDoc, type ClubDoc, type ExclusionDoc, type MemberDoc } from './types';
import { DAY, round } from './util';

export interface RetentionCell {
  day: number;
  eligible: number;
  held: number;
  rate: number | null;
}

export interface StatsSnapshot {
  asOf: number;
  uniqueSigners: number;
  attributedTx: number;
  submittedTx: number;
  pctAttributed: number | null;
  attributedVia: { tx: number; userop: number };
  usdRouted: number;
  qualifyingBuys: number;
  belowMinBuys: number;
  washBuys: number;
  seats: { bench: number; playing: number; walletsBench: number; walletsPlaying: number };
  clubs: { private: number; pickup: number; stock: number; playingClubs: number };
  retention: RetentionCell[];
  /** GW0 Playing joiners only (pre-registered cohort for D+7). */
  gw0Retention: RetentionCell[];
  repeatBuy: { gw: string; nextGw: string; buyers: number; repeat: number; rate: number | null }[];
  twoPlus: { buyers: number; twoPlus: number; share: number | null };
  callups: number;
  exclusions: ExclusionDoc[];
  labels: string[];
}

export function subjectFromLedger(l: WalletLedger): CohortSubject | null {
  const first = l.qualifying[0];
  if (!first) return null;
  return { wallet: l.wallet, token: first.token, t0: first.blockTime, firstRaw: BigInt(first.rawAmount), firstUsd: first.usdIn ?? 0, flows: l.flows };
}

export function retentionTable(subjects: CohortSubject[], now: number, days = [1, 3, 7]): RetentionCell[] {
  return days.map((d) => {
    const el = subjects.filter((s) => s.t0 + d * DAY <= now);
    const held = el.filter((s) => heldAt(s, d)).length;
    return { day: d, eligible: el.length, held, rate: el.length ? round(held / el.length, 4) : null };
  });
}

export async function computeStats(ctx: ClubsContext, opts: { now?: number } = {}): Promise<StatsSnapshot> {
  const now = opts.now ?? ctx.now();
  const [buys, rejects, members, clubs, exclusions, callups] = await Promise.all([
    ctx.store.query<BuyDoc>(COL.buys),
    ctx.store.query<BuyRejectDoc>(COL.buyRejects),
    ctx.store.query<MemberDoc>(COL.members),
    ctx.store.query<ClubDoc>(COL.clubs),
    ctx.store.query<ExclusionDoc>(COL.exclusions),
    ctx.store.query<CallupDoc>(COL.callups),
  ]);
  const ex = new Set(exclusions.map((e) => e.wallet));
  const ours = buys.filter((b) => !ex.has(b.wallet) && b.blockTime <= now);
  // only buys whose receipt showed our swap at a market price are counted anywhere on the stats page
  const attributed = ours.filter((b) => b.attributed && b.verified === true);
  const notAttributed = rejects.filter((r) => r.reason === 'not_attributed' && !ex.has(r.wallet)).length;
  const wallets = [...new Set(attributed.map((b) => b.wallet))];

  const ledgers = await Promise.all(wallets.map((w) => loadLedger(ctx, w)));
  const qualifying = ledgers.flatMap((l) => l.qualifying);
  const subjects = ledgers.map(subjectFromLedger).filter((s): s is CohortSubject => !!s);
  const gw0 = SEASON[0]!;
  const gw0Subjects = subjects.filter((s) => s.t0 > gw0.buyFrom && s.t0 <= gw0.cutAt);

  const repeatBuy: StatsSnapshot['repeatBuy'] = [];
  for (let i = 0; i + 1 < SEASON.length; i++) {
    const g = SEASON[i]!;
    const n = SEASON[i + 1]!;
    if (n.cutAt > now) break;
    const inG = new Set(qualifying.filter((b) => b.blockTime > g.buyFrom && b.blockTime <= g.cutAt).map((b) => b.wallet));
    const inN = new Set(qualifying.filter((b) => b.blockTime > n.buyFrom && b.blockTime <= n.cutAt).map((b) => b.wallet));
    const rep = [...inG].filter((w) => inN.has(w)).length;
    repeatBuy.push({ gw: g.id, nextGw: n.id, buyers: inG.size, repeat: rep, rate: inG.size ? round(rep / inG.size, 4) : null });
  }

  const perWallet = new Map<string, number>();
  for (const b of qualifying) if (b.blockTime >= LAUNCH_AT) perWallet.set(b.wallet, (perWallet.get(b.wallet) ?? 0) + 1);
  const twoPlus = [...perWallet.values()].filter((n) => n >= 2).length;

  const live = members.filter((m) => !ex.has(m.wallet));
  const bench = live.filter((m) => m.seat === 'bench');
  const playing = live.filter((m) => m.seat === 'playing');
  return {
    asOf: now,
    uniqueSigners: wallets.length,
    attributedTx: attributed.length,
    submittedTx: attributed.length + notAttributed,
    pctAttributed: attributed.length + notAttributed ? round((attributed.length / (attributed.length + notAttributed)) * 100, 2) : null,
    attributedVia: { tx: attributed.filter((b) => b.via === 'tx').length, userop: attributed.filter((b) => b.via === 'userop').length },
    usdRouted: round(attributed.reduce((s, b) => s + (b.usdIn ?? 0), 0), 2),
    qualifyingBuys: qualifying.length,
    belowMinBuys: attributed.filter((b) => (b.usdIn ?? 0) < ctx.config.minBuyUsd).length,
    washBuys: ledgers.reduce((s, l) => s + l.wash.size, 0),
    seats: {
      bench: bench.length,
      playing: playing.length,
      walletsBench: new Set(bench.map((m) => m.wallet)).size,
      walletsPlaying: new Set(playing.map((m) => m.wallet)).size,
    },
    clubs: {
      private: clubs.filter((c) => c.kind === 'private').length,
      pickup: clubs.filter((c) => c.kind === 'pickup').length,
      stock: clubs.filter((c) => c.kind === 'stock' && c.memberCount > 0).length,
      playingClubs: clubs.filter((c) => c.kind !== 'stock' && c.memberCount >= 3).length,
    },
    retention: retentionTable(subjects, now),
    gw0Retention: retentionTable(gw0Subjects, now),
    repeatBuy,
    twoPlus: { buyers: perWallet.size, twoPlus, share: rate([...perWallet.values()].map((n) => n >= 2)) },
    callups: callups.length,
    exclusions: exclusions.sort((a, b) => a.addedAt - b.addedAt),
    labels: [
      'Exclusion-list wallets removed from every number',
      'Held = position since the first buy still >= 50% of that buy',
      'Bench seats reported separately from Playing members',
      'Only user-signed buys counted; our attestations never count',
    ],
  };
}

export async function addExclusion(ctx: ClubsContext, input: { wallet: string; label: string; reason: string }): Promise<ExclusionDoc> {
  const doc: ExclusionDoc = { wallet: input.wallet.toLowerCase(), label: input.label, reason: input.reason, addedAt: ctx.now() };
  await ctx.store.set(COL.exclusions, doc.wallet, doc);
  return doc;
}

export const listExclusions = (ctx: ClubsContext) => ctx.store.query<ExclusionDoc>(COL.exclusions);
