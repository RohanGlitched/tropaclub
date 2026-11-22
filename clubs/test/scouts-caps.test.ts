/** Scouts (credit for a friend who really became a fan) and Caps (the season scoreboard). Cosmetic only. */
import { describe, expect, it } from 'vitest';
import { CAPS, CAPS_COL, type CapDoc, capId } from '../src/caps';
import { StaticPriceSource } from '../src/prices';
import { SCOUT_COL, type ScoutCreditDoc } from '../src/scouts';
import { MemoryDocStore } from '../src/store/memory';
import { COL, type BuyDoc, type TransferDoc } from '../src/types';
import { DAY } from '../src/util';
import { Clock, FakeChain, TOK, addr, hash, makeService } from './helpers';

const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const PRICE = 10 / 0.07650616; // $130.71 a token
const T0 = at('2026-11-24T15:00:00Z'); // GW0, market open

function world(funders: Record<string, string | null> = {}) {
  const store = new MemoryDocStore();
  const chain = new FakeChain();
  const clock = new Clock(T0 - 3600);
  const prices = new StaticPriceSource({ [TOK.NVDAc]: [[T0 - 7200, PRICE]] }, 90 * DAY);
  const { svc } = makeService({ store, chain, clock, prices, funders });
  let n = 1;
  /** A verified $10 buy of NVDAc at time t. */
  const buy = async (wallet: string, t: number) => {
    const h = hash(0x5000 + n++);
    chain.addBuy({ hash: h, wallet, token: TOK.NVDAc, raw: 7_650_616n, usdc: 10_000_000n, block: BigInt(60_000_000 + n), time: t });
    const r = await svc.recordBuy({ txHash: h, wallet, clubId: null, country: 'BR' });
    if (!r.ok) throw new Error(`buy not recorded: ${r.reason}`);
    return h;
  };
  /** Join S's club through the scout link (the referral is stored at the join). */
  const arrive = async (wallet: string, code: string, invite: string) => {
    await svc.joinClub({ wallet, inviteCode: invite });
    return svc.recordReferral({ wallet, code, via: 'club' });
  };
  return { store, chain, clock, svc, buy, arrive };
}

const S = addr(0x5c0);

describe('scouts', () => {
  it('stores the referral once, first touch; never for the scout itself or a wallet that already bought', async () => {
    const { svc, clock, buy, arrive } = world();
    const code = await svc.scoutCode(S);
    expect(await svc.scoutCode(S)).toBe(code);
    const { inviteCode } = await svc.createClub({ name: 'Scout Club', createdBy: S });
    const R = addr(0x101);
    expect(await arrive(R, code, inviteCode)).toMatchObject({ ok: true, referral: { wallet: R, referrer: S } });
    const other = await svc.scoutCode(addr(0x999));
    expect(await svc.recordReferral({ wallet: R, code: other, via: 'club' })).toMatchObject({ ok: false, reason: 'already_referred' });
    expect(await svc.recordReferral({ wallet: S, code, via: 'club' })).toMatchObject({ ok: false, reason: 'self' });
    expect(await svc.recordReferral({ wallet: addr(0x102), code: 'nosuchcode', via: 'club' })).toMatchObject({ ok: false, reason: 'unknown_code' });
    clock.set(T0 + 60);
    const B = addr(0x103);
    await buy(B, T0);
    expect(await svc.recordReferral({ wallet: B, code, via: 'pickup' })).toMatchObject({ ok: false, reason: 'not_new' });
  });

  it('credits only a first verified buy still held at D+7; nothing for joining', async () => {
    const { svc, clock, buy, arrive, store } = world();
    const code = await svc.scoutCode(S);
    const { inviteCode } = await svc.createClub({ name: 'Scout Club', createdBy: S });
    const joinedOnly = addr(0x201);
    const holder = addr(0x202);
    const seller = addr(0x203);
    for (const w of [joinedOnly, holder, seller]) await arrive(w, code, inviteCode);
    clock.set(T0 + 60);
    await buy(holder, T0);
    const sold = await buy(seller, T0 + 600);
    // the seller sends it all away on day 3
    await store.set<TransferDoc>(COL.transfers, `${sold}_out`, { id: `${sold}_out`, wallet: seller, token: TOK.NVDAc, dir: 'out', raw: '7650616', blockNumber: 60_100_000, blockTime: T0 + 3 * DAY, txHash: hash(0x6001), logIndex: 0, counterparty: addr(0xdead), tropa: false });

    clock.set(T0 + 6 * DAY);
    expect(await svc.decideScoutCredits()).toEqual({ decided: 0, credited: 0 }); // before D+7 nothing is decided
    clock.set(T0 + 8 * DAY);
    expect(await svc.decideScoutCredits()).toEqual({ decided: 2, credited: 1 });
    expect(await store.get<ScoutCreditDoc>(SCOUT_COL.credits, holder)).toMatchObject({ status: 'credited', referrer: S, gw: 'GW0' });
    expect(await store.get<ScoutCreditDoc>(SCOUT_COL.credits, seller)).toMatchObject({ status: 'not_held' });
    expect(await store.get(SCOUT_COL.credits, joinedOnly)).toBeNull();
    expect(await svc.decideScoutCredits()).toEqual({ decided: 0, credited: 0 }); // idempotent
    expect(await svc.scoutBadgeOf(S)).toBe('Scout');
    expect(await svc.scoutTable()).toEqual([{ wallet: S, credited: 1, stillHolding: 1, badge: 'Scout' }]);
  });

  it('no credit when the scout funded the friend, or both share a first funder', async () => {
    const F = addr(0xf00);
    const byScout = addr(0x301);
    const sameFunder = addr(0x302);
    const clean = addr(0x303);
    const { svc, clock, buy, arrive, store } = world({ [byScout]: S, [sameFunder]: F, [S]: F, [clean]: addr(0xf01) });
    const code = await svc.scoutCode(S);
    const { inviteCode } = await svc.createClub({ name: 'Scout Club', createdBy: S });
    for (const w of [byScout, sameFunder, clean]) await arrive(w, code, inviteCode);
    clock.set(T0 + 60);
    for (const w of [byScout, sameFunder, clean]) await buy(w, T0);
    clock.set(T0 + 8 * DAY);
    await svc.decideScoutCredits();
    expect(await store.get<ScoutCreditDoc>(SCOUT_COL.credits, byScout)).toMatchObject({ status: 'sybil', reason: 'funded by the scout' });
    expect(await store.get<ScoutCreditDoc>(SCOUT_COL.credits, sameFunder)).toMatchObject({ status: 'sybil', reason: 'same first funder as the scout' });
    expect(await store.get<ScoutCreditDoc>(SCOUT_COL.credits, clean)).toMatchObject({ status: 'credited' });
  });

  it('credits at most 20 mates per scout per gameweek; three make a Captain', async () => {
    const { svc, clock, buy, store } = world();
    const code = await svc.scoutCode(S);
    const mates = Array.from({ length: 21 }, (_, i) => addr(0x400 + i));
    for (const w of mates) {
      const { inviteCode } = await svc.createClub({ name: `Club ${w.slice(-3)}`, createdBy: w });
      void inviteCode;
      await svc.recordReferral({ wallet: w, code, via: 'create' });
    }
    clock.set(T0 + 60);
    for (const [i, w] of mates.entries()) await buy(w, T0 + i * 60);
    clock.set(T0 + 8 * DAY);
    expect(await svc.decideScoutCredits()).toEqual({ decided: 21, credited: 20 });
    expect(await store.get<ScoutCreditDoc>(SCOUT_COL.credits, mates[20]!)).toMatchObject({ status: 'cap' });
    expect(await svc.scoutBadgeOf(S)).toBe("Captain's armband");
  });
});

describe('caps', () => {
  it('awards played and held at D+7 once, from verified buys only; the job can run again and again', async () => {
    const { svc, clock, buy, store } = world();
    const P = addr(0x501);
    clock.set(T0 + 60);
    const tx = await buy(P, T0);
    // an unverified record (an older version, or a forged one) earns nothing
    const U = addr(0x502);
    await store.set<BuyDoc>(COL.buys, hash(0x7777), { ...(await store.get<BuyDoc>(COL.buys, tx))!, txHash: hash(0x7777), wallet: U, verified: false });

    clock.set(T0 + 2 * DAY);
    expect(await svc.awardCaps()).toEqual({ awarded: 1, caps: CAPS.played });
    clock.set(T0 + 8 * DAY);
    expect(await svc.awardCaps()).toEqual({ awarded: 1, caps: CAPS.heldD7 });
    expect(await svc.awardCaps()).toEqual({ awarded: 0, caps: 0 });
    const ledger = await store.query<CapDoc>(CAPS_COL);
    expect(ledger.map((c) => [c.wallet, c.gw, c.reason, c.amount]).sort()).toEqual([
      [P, 'GW0', 'held_d7', 0.5],
      [P, 'GW0', 'played', 1],
    ]);
    expect(ledger.every((c) => c.id === capId(c.wallet, c.gw, c.reason, c.sourceRef))).toBe(true);
    expect(await svc.capsOf(P)).toEqual({ caps: 1.5, rank: 1, of: 1 });
    expect(await svc.capsOf(U)).toBeNull();
  });

  it('caps scout awards at 4 a gameweek and every wallet at 2.5 a gameweek', async () => {
    const { svc, clock, buy, store } = world();
    const code = await svc.scoutCode(S);
    const mates = Array.from({ length: 6 }, (_, i) => addr(0x600 + i));
    for (const w of mates) {
      await svc.createClub({ name: `Club ${w.slice(-3)}`, createdBy: w });
      await svc.recordReferral({ wallet: w, code, via: 'create' });
    }
    clock.set(T0 + 60);
    await buy(S, T0);
    for (const [i, w] of mates.entries()) await buy(w, T0 + (i + 1) * 60);
    clock.set(T0 + 8 * DAY);
    await svc.decideScoutCredits();
    await svc.awardCaps();
    const mine = await store.query<CapDoc>(CAPS_COL, { where: [['wallet', '==', S]] });
    expect(mine.filter((c) => c.reason === 'scout')).toHaveLength(CAPS.scoutPerGw);
    expect(mine.reduce((s, c) => s + c.amount, 0)).toBe(CAPS.perGw); // 1 + 0.5 + 4 x 0.25
    await svc.awardCaps();
    expect(await store.query<CapDoc>(CAPS_COL, { where: [['wallet', '==', S]] })).toHaveLength(mine.length);
  });

  it('never goes over 2.5 in a gameweek, whatever is already in the ledger', async () => {
    const { svc, clock, buy, store } = world();
    const P = addr(0x701);
    clock.set(T0 + 60);
    await buy(P, T0);
    await store.set<CapDoc>(CAPS_COL, 'x', { id: capId(P, 'GW0', 'scout', addr(0x1)), wallet: P, gw: 'GW0', reason: 'scout', amount: 2.1, sourceRef: addr(0x1), at: T0 });
    clock.set(T0 + 8 * DAY);
    await svc.awardCaps();
    const total = (await store.query<CapDoc>(CAPS_COL, { where: [['wallet', '==', P]] })).reduce((s, c) => s + c.amount, 0);
    expect(Math.round(total * 100) / 100).toBe(2.5);
  });

  it('ranks the season table by Caps, then by the earliest first verified buy', async () => {
    const { svc, clock, buy } = world();
    const early = addr(0x801);
    const late = addr(0x802);
    clock.set(T0 + 60);
    await buy(late, T0 + 120);
    await buy(early, T0);
    clock.set(T0 + 2 * DAY);
    await svc.awardCaps();
    expect((await svc.capsTable()).map((r) => [r.wallet, r.caps, r.rank])).toEqual([
      [early, 1, 1],
      [late, 1, 2],
    ]);
  });
});
