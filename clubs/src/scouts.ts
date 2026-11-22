/**
 * Scouts: personal invite links, and credit for a friend who really became a fan. Cosmetic only:
 * no prizes, no cash, no tokens. "No prizes, no cash, just your name on the board."
 *
 *   - Every member has one scout code: tropaclub.xyz/j/<code>.
 *   - A new wallet that arrives through it (and has no verified buy and no other club yet) is stored
 *     as referred by that scout, once, first touch, never changed. Self-referral is impossible.
 *   - The credit counts only when the referred wallet makes its first verified Tropa buy after the
 *     referral (every check in buys.ts), and still holds at least $5 of that token at D+7.
 *     Sign-ups and joins earn nothing.
 *   - No credit when the referred wallet was funded by the scout, or both share a first funder
 *     (first inbound USDC/WETH sender in the last 30 days; exchanges and bridges are "no signal").
 *   - At most 20 credits per scout per gameweek (the gameweek of the friend's first buy).
 *   - A "Scout" stamp at 1 credited mate, a "Captain's armband" at 3. The Top scouts table ranks
 *     scouts by credited mates still holding $5 or more.
 *   - The "First 1,000" stamp goes on the ticket of the first 1,000 wallets whose first verified buy
 *     was still held ($5 or more) at D+7.
 */
// the values live in web/lib/rules.json, which the site and the docs build read too
import rules from '../../web/lib/rules.json';
import { gameweekForBuy } from './calendar';
import type { ClubsContext } from './context';
import { loadLedger } from './ledger';
import { AlreadyExistsError } from './store/docstore';
import { COL, type BuyDoc, type ExclusionDoc, type MemberDoc, type WalletDoc } from './types';
import { DAY, normAddr, randomCode } from './util';

export const SCOUT_COPY: string = rules.scouts.copy;
export const SCOUT_HOLD_USD: number = rules.scouts.holdUsd;
export const SCOUT_CREDITS_PER_GW: number = rules.scouts.creditsPerGw;
export const SCOUT_BADGE_AT: number = rules.scouts.scoutAt;
export const CAPTAIN_BADGE_AT: number = rules.scouts.captainAt;
export const FOUNDERS_PENNANT_LIMIT: number = rules.scouts.foundersLimit;
/** A first funder is looked for in this window before the check. */
export const FUNDER_WINDOW_SEC = 30 * DAY;

export interface ScoutCodeDoc {
  code: string;
  wallet: string;
  createdAt: number;
}
export interface ReferralDoc {
  /** The referred wallet (also the doc id). */
  wallet: string;
  referrer: string;
  code: string;
  at: number;
  via: 'club' | 'pickup' | 'create';
}
export type ScoutCreditStatus = 'credited' | 'not_held' | 'sybil' | 'cap';
export interface ScoutCreditDoc {
  /** The referred wallet (also the doc id): one decision per referral, never revisited. */
  referred: string;
  referrer: string;
  status: ScoutCreditStatus;
  reason: string | null;
  buyTx: string;
  buyAt: number;
  token: string;
  gw: string;
  decidedAt: number;
}

export const SCOUT_COL = { codes: 'scoutCodes', referrals: 'referrals', credits: 'scoutCredits', boards: 'boards' } as const;

const firstVerifiedBuy = (buys: BuyDoc[], after = 0) =>
  buys.filter((b) => b.verified === true && b.attributed && b.blockTime > after).sort((a, b) => a.blockTime - b.blockTime)[0] ?? null;

/** This wallet's scout code, made on first use. */
export async function scoutCode(ctx: ClubsContext, wallet: string): Promise<string> {
  const w = normAddr(wallet);
  const have = (await ctx.store.query<ScoutCodeDoc>(SCOUT_COL.codes, { where: [['wallet', '==', w]] }))[0];
  if (have) return have.code;
  for (let i = 0; i < 6; i++) {
    const code = randomCode(8).toLowerCase();
    try {
      await ctx.store.create<ScoutCodeDoc>(SCOUT_COL.codes, code, { code, wallet: w, createdAt: ctx.now() });
      return code;
    } catch (e) {
      if (!(e instanceof AlreadyExistsError)) throw e;
    }
  }
  throw new Error('could not allocate a scout code');
}

export async function scoutOfCode(ctx: ClubsContext, code: string): Promise<string | null> {
  if (!/^[0-9a-z]{6,12}$/.test(code)) return null;
  return (await ctx.store.get<ScoutCodeDoc>(SCOUT_COL.codes, code))?.wallet ?? null;
}

export type ReferralResult = { ok: true; referral: ReferralDoc } | { ok: false; reason: 'unknown_code' | 'self' | 'not_new' | 'already_referred' };

/**
 * Store who brought this wallet, once (first touch, never changed). Called when a signed-in wallet
 * that arrived through a scout link joins a club, takes a pick-up seat or founds a club.
 */
export async function recordReferral(ctx: ClubsContext, input: { wallet: string; code: string; via: ReferralDoc['via'] }): Promise<ReferralResult> {
  const wallet = normAddr(input.wallet);
  const code = String(input.code ?? '').toLowerCase();
  const referrer = await scoutOfCode(ctx, code);
  if (!referrer) return { ok: false, reason: 'unknown_code' };
  if (referrer === wallet) return { ok: false, reason: 'self' };
  if (await ctx.store.get<ReferralDoc>(SCOUT_COL.referrals, wallet)) return { ok: false, reason: 'already_referred' };
  // a new wallet: no verified buy yet, and no club other than the one it is joining now
  const [buys, seats] = await Promise.all([
    ctx.store.query<BuyDoc>(COL.buys, { where: [['wallet', '==', wallet]] }),
    ctx.store.query<MemberDoc>(COL.members, { where: [['wallet', '==', wallet]] }),
  ]);
  if (buys.some((b) => b.verified === true) || seats.length > 1) return { ok: false, reason: 'not_new' };
  const referral: ReferralDoc = { wallet, referrer, code, at: ctx.now(), via: input.via };
  try {
    await ctx.store.create<ReferralDoc>(SCOUT_COL.referrals, wallet, referral);
  } catch (e) {
    if (e instanceof AlreadyExistsError) return { ok: false, reason: 'already_referred' };
    throw e;
  }
  return { ok: true, referral };
}

/** Raw tokens of `token` the wallet held at time t, from its recorded movements. */
export function heldRawAt(buys: BuyDoc[], transfers: { token: string; dir: 'in' | 'out'; raw: string; blockTime: number }[], token: string, t: number): bigint {
  const first = buys.filter((b) => b.token === token && b.priorBalanceRaw != null).sort((a, b) => a.blockTime - b.blockTime)[0];
  let raw = first ? BigInt(first.priorBalanceRaw!) : 0n;
  for (const x of transfers) if (x.token === token && x.blockTime <= t) raw += x.dir === 'in' ? BigInt(x.raw) : -BigInt(x.raw);
  return raw < 0n ? 0n : raw;
}

/** Does the wallet hold at least `usd` of the token at time t? (Mark at t, else the buy's own price.) */
export async function holdsUsdAt(ctx: ClubsContext, wallet: string, token: string, t: number, usd = SCOUT_HOLD_USD, fallbackPrice?: number | null): Promise<boolean> {
  const ledger = await loadLedger(ctx, wallet);
  const raw = heldRawAt(ledger.buys, ledger.transfers, token, t);
  if (raw <= 0n) return false;
  const mark = (ctx.prices ? await ctx.prices.markAt(token, t).catch(() => null) : null)?.usd ?? fallbackPrice ?? null;
  return mark != null && (Number(raw) / 1e8) * mark >= usd;
}

/** First funder of a wallet (cached on its wallet doc for a day). Throws when it cannot be told now. */
async function funderOf(ctx: ClubsContext, wallet: string): Promise<string | null> {
  const doc = await ctx.store.get<WalletDoc>(COL.wallets, wallet);
  if (doc && doc.fundingSource !== undefined && doc.fundingCheckedAt && ctx.now() - doc.fundingCheckedAt < DAY) return doc.fundingSource ?? null;
  if (!ctx.funding) return null;
  const f = (await ctx.funding.firstFunder(wallet))?.toLowerCase() ?? null;
  if (doc) await ctx.store.update(COL.wallets, wallet, { fundingSource: f, fundingCheckedAt: ctx.now() }).catch(() => {});
  return f;
}

/**
 * Decide every referral whose friend's first verified buy is at least 7 days old. Each referral is
 * decided once (credited, not_held, sybil or cap); a check that cannot be made now is left for the
 * next run. Idempotent.
 */
export async function decideScoutCredits(ctx: ClubsContext): Promise<{ decided: number; credited: number }> {
  const now = ctx.now();
  const [referrals, decided, exclusions] = await Promise.all([
    ctx.store.query<ReferralDoc>(SCOUT_COL.referrals),
    ctx.store.query<ScoutCreditDoc>(SCOUT_COL.credits),
    ctx.store.query<ExclusionDoc>(COL.exclusions),
  ]);
  const done = new Set(decided.map((d) => d.referred));
  const ex = new Set(exclusions.map((e) => e.wallet));
  const perScoutGw = new Map<string, number>();
  for (const d of decided) if (d.status === 'credited') perScoutGw.set(`${d.referrer}|${d.gw}`, (perScoutGw.get(`${d.referrer}|${d.gw}`) ?? 0) + 1);

  const candidates: { r: ReferralDoc; buy: BuyDoc }[] = [];
  for (const r of referrals) {
    if (done.has(r.wallet)) continue;
    const buys = await ctx.store.query<BuyDoc>(COL.buys, { where: [['wallet', '==', r.wallet]] });
    const buy = firstVerifiedBuy(buys, r.at);
    if (!buy || buy.blockTime + 7 * DAY > now) continue;
    candidates.push({ r, buy });
  }
  // earliest buys first, so the per-gameweek cap is applied in the order credits were earned
  candidates.sort((a, b) => a.buy.blockTime - b.buy.blockTime || (a.r.wallet < b.r.wallet ? -1 : 1));

  let n = 0;
  let credited = 0;
  for (const { r, buy } of candidates) {
    const gw = gameweekForBuy(buy.blockTime)?.id ?? 'S0';
    let status: ScoutCreditStatus;
    let reason: string | null = null;
    if (ex.has(r.wallet) || ex.has(r.referrer) || buy.excluded || buy.wash) {
      status = 'not_held';
      reason = buy.wash ? 'wash pattern' : 'on the exclusion list';
    } else if (!(await holdsUsdAt(ctx, r.wallet, buy.token, buy.blockTime + 7 * DAY, SCOUT_HOLD_USD, buy.priceAtBuy))) {
      status = 'not_held';
      reason = `held under $${SCOUT_HOLD_USD} at D+7`;
    } else {
      let fRef: string | null;
      let fScout: string | null;
      try {
        [fRef, fScout] = await Promise.all([funderOf(ctx, r.wallet), funderOf(ctx, r.referrer)]);
      } catch {
        continue; // cannot tell now: decided on a later run
      }
      if (fRef && fRef === r.referrer) {
        status = 'sybil';
        reason = 'funded by the scout';
      } else if (fRef && fScout && fRef === fScout) {
        status = 'sybil';
        reason = 'same first funder as the scout';
      } else if ((perScoutGw.get(`${r.referrer}|${gw}`) ?? 0) >= SCOUT_CREDITS_PER_GW) {
        status = 'cap';
        reason = `${SCOUT_CREDITS_PER_GW} credits this gameweek already`;
      } else status = 'credited';
    }
    const doc: ScoutCreditDoc = { referred: r.wallet, referrer: r.referrer, status, reason, buyTx: buy.txHash, buyAt: buy.blockTime, token: buy.token, gw, decidedAt: now };
    try {
      await ctx.store.create<ScoutCreditDoc>(SCOUT_COL.credits, r.wallet, doc);
    } catch (e) {
      if (e instanceof AlreadyExistsError) continue;
      throw e;
    }
    n++;
    if (status === 'credited') {
      credited++;
      perScoutGw.set(`${r.referrer}|${gw}`, (perScoutGw.get(`${r.referrer}|${gw}`) ?? 0) + 1);
    }
  }
  return { decided: n, credited };
}

export interface ScoutRow {
  wallet: string;
  credited: number;
  stillHolding: number;
  badge: string | null;
}

export const scoutBadge = (credited: number) => (credited >= CAPTAIN_BADGE_AT ? "Captain's armband" : credited >= SCOUT_BADGE_AT ? 'Scout' : null);

/** Top scouts: credited mates still holding $5 or more now, then credited mates, then first credit. */
export async function scoutTable(ctx: ClubsContext): Promise<ScoutRow[]> {
  const credits = (await ctx.store.query<ScoutCreditDoc>(SCOUT_COL.credits, { where: [['status', '==', 'credited']] })).sort((a, b) => a.decidedAt - b.decidedAt);
  const by = new Map<string, { credited: number; holding: number; first: number }>();
  const now = ctx.now();
  for (const c of credits) {
    const row = by.get(c.referrer) ?? { credited: 0, holding: 0, first: c.decidedAt };
    row.credited++;
    if (await holdsUsdAt(ctx, c.referred, c.token, now)) row.holding++;
    by.set(c.referrer, row);
  }
  return [...by]
    .sort((a, b) => b[1].holding - a[1].holding || b[1].credited - a[1].credited || a[1].first - b[1].first)
    .map(([wallet, r]) => ({ wallet, credited: r.credited, stillHolding: r.holding, badge: scoutBadge(r.credited) }));
}

/** One wallet's scout badge (from its credited mates). */
export async function scoutBadgeOf(ctx: ClubsContext, wallet: string): Promise<string | null> {
  const n = (await ctx.store.query<ScoutCreditDoc>(SCOUT_COL.credits, { where: [['referrer', '==', normAddr(wallet)]] })).filter((c) => c.status === 'credited').length;
  return scoutBadge(n);
}

/**
 * The "First 1,000" list (a ticket stamp, apart from the GW0 Founders' Pennant crest): the first 1,000 wallets whose first verified buy was still held
 * ($5 or more) at D+7, in order of that buy. Stored as one board doc by the job, read by tickets.
 */
export async function refreshFoundersPennants(ctx: ClubsContext): Promise<string[]> {
  const now = ctx.now();
  const ex = new Set((await ctx.store.query<ExclusionDoc>(COL.exclusions)).map((e) => e.wallet));
  const buys = (await ctx.store.query<BuyDoc>(COL.buys)).filter((b) => b.verified === true && b.attributed && !b.excluded);
  const first = new Map<string, BuyDoc>();
  for (const b of buys.sort((a, b) => a.blockTime - b.blockTime)) if (!first.has(b.wallet)) first.set(b.wallet, b);
  const prev = (await ctx.store.get<{ wallets: string[] }>(SCOUT_COL.boards, 'founders'))?.wallets ?? [];
  const out = [...prev];
  const have = new Set(prev);
  for (const [w, b] of [...first].sort((a, b) => a[1].blockTime - b[1].blockTime)) {
    if (out.length >= FOUNDERS_PENNANT_LIMIT) break;
    if (have.has(w) || ex.has(w) || b.blockTime + 7 * DAY > now) continue;
    if (await holdsUsdAt(ctx, w, b.token, b.blockTime + 7 * DAY, SCOUT_HOLD_USD, b.priceAtBuy)) {
      out.push(w);
      have.add(w);
    }
  }
  await ctx.store.set(SCOUT_COL.boards, 'founders', { id: 'founders', wallets: out, updatedAt: now });
  return out;
}
