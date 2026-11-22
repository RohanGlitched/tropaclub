/** Season 1: provisional wallets, the founder Cap, social quests, the funder and age checks, and the public numbers. */
import { describe, expect, it } from 'vitest';
import { CAPS_COL, type CapDoc } from '../src/caps';
import { RpcFundingResolver, type FundingChain } from '../src/funding';
import { StaticPriceSource } from '../src/prices';
import { SEASON1, SEASON_COL, type SeasonWalletDoc, cleanHandle } from '../src/season';
import { MemoryDocStore } from '../src/store/memory';
import { COL, type BuyDoc } from '../src/types';
import { DAY } from '../src/util';
import { Clock, FakeChain, TOK, addr, hash, makeService } from './helpers';
import type { WalletAge } from '../src/funding';

const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const PRICE = 10 / 0.07650616;
const T0 = at('2026-11-24T15:00:00Z'); // GW0, Season 1 open

function world(o: { funders?: Record<string, string | null>; ages?: Record<string, WalletAge> } = {}) {
  const store = new MemoryDocStore();
  const chain = new FakeChain();
  const clock = new Clock(T0 - 3600);
  const prices = new StaticPriceSource({ [TOK.NVDAc]: [[T0 - 7200, PRICE]] }, 90 * DAY);
  const { svc } = makeService({ store, chain, clock, prices, funders: o.funders, ages: o.ages });
  let n = 1;
  const buy = async (wallet: string, t: number, clubId: string | null = null) => {
    const h = hash(0x8000 + n++);
    chain.addBuy({ hash: h, wallet, token: TOK.NVDAc, raw: 7_650_616n, usdc: 10_000_000n, block: BigInt(61_000_000 + n), time: t });
    const r = await svc.recordBuy({ txHash: h, wallet, clubId, country: 'BR' });
    if (!r.ok) throw new Error(`buy not recorded: ${r.reason}`);
    return h;
  };
  const total = async (w: string) => Math.round((await store.query<CapDoc>(CAPS_COL, { where: [['wallet', '==', w]] })).reduce((s, c) => s + c.amount, 0) * 100) / 100;
  return { store, chain, clock, svc, buy, total };
}

const A = addr(0xa01);
const B = addr(0xa02);
const C = addr(0xa03);

describe('season 1: founder Cap', () => {
  it('0.50 once, when 2 members of the founder’s club played in one gameweek; on top of the weekly max', async () => {
    const { svc, clock, buy, store, total } = world({ funders: { [A]: addr(0xf1), [B]: addr(0xf2) } });
    const { club, inviteCode } = await svc.createClub({ name: 'Friday Five', createdBy: A });
    await svc.joinClub({ wallet: B, inviteCode });
    clock.set(T0 + 60);
    await buy(A, T0, club.id);
    clock.set(T0 + 120);
    let r = await svc.awardCaps();
    expect(r).toMatchObject({ founder: 0 }); // one member played: not yet
    await buy(B, T0 + 100, club.id);
    clock.set(T0 + 200);
    r = await svc.awardCaps();
    expect(r).toMatchObject({ founder: 1 });
    expect(await store.get<CapDoc>(CAPS_COL, `${A}__S1__founder`)).toMatchObject({ amount: SEASON1.founderCaps, reason: 'founder', sourceRef: club.id, season: 'S1' });
    expect(await svc.awardCaps()).toMatchObject({ founder: 0 }); // idempotent
    expect(await total(A)).toBe(1.5); // played 1 + founder 0.5
  });

  it('does not count a member the founder funded, or one sharing the founder’s first funder', async () => {
    const F = addr(0xf9);
    const { svc, clock, buy } = world({ funders: { [A]: F, [B]: A, [C]: F } });
    const { club, inviteCode } = await svc.createClub({ name: 'Friday Five', createdBy: A });
    await svc.joinClub({ wallet: B, inviteCode });
    await svc.joinClub({ wallet: C, inviteCode });
    clock.set(T0 + 60);
    for (const w of [A, B, C]) await buy(w, T0 + 10, club.id);
    clock.set(T0 + 200);
    expect(await svc.awardCaps()).toMatchObject({ founder: 0 });
  });
});

describe('season 1: social quests', () => {
  it('binds one handle per wallet and one wallet per handle, fixed after the first claim', async () => {
    const { svc, clock } = world();
    expect(cleanHandle('@Tropa_Fan')).toBe('tropa_fan');
    expect(cleanHandle('https://x.com/Tropa_Fan?s=20')).toBe('tropa_fan');
    expect(cleanHandle('not a handle')).toBeNull();
    expect(cleanHandle('a_very_long_handle_name')).toBeNull();
    clock.set(T0 + 60);
    await expect(svc.setXHandle(A, 'bad handle!')).rejects.toThrow(/isn’t an X handle/);
    expect(await svc.setXHandle(A, '@Fan_One')).toEqual({ handle: 'fan_one' });
    await expect(svc.setXHandle(B, 'fan_one')).rejects.toThrow(/another wallet/);
    expect(await svc.setXHandle(A, 'fan_two')).toEqual({ handle: 'fan_two' }); // free to change before a claim
    expect(await svc.setXHandle(B, 'fan_one')).toEqual({ handle: 'fan_one' }); // the old one is released
    await svc.claimSocial(A, 'follow');
    await expect(svc.setXHandle(A, 'fan_three')).rejects.toThrow(/can’t be changed/);
  });

  it('holds claims as pending until a verified Season 1 buy, caps them at 0.25, and voids a rejected one', async () => {
    const { svc, clock, buy, store, total } = world();
    clock.set(SEASON1.startAt - 600);
    await svc.setXHandle(A, 'fan_one');
    await expect(svc.claimSocial(A, 'follow')).rejects.toThrow(/open with Season 1/);
    clock.set(T0 + 60);
    await expect(svc.claimSocial(A, 'like_repost')).rejects.toThrow(/post isn’t up yet/);
    await svc.claimSocial(A, 'follow');
    await svc.claimSocial(A, 'follow'); // once
    await svc.claimSocial(A, 'like_repost', { postId: '2120000000000000000' });
    await svc.claimSocial(A, 'post');
    await svc.awardCaps();
    expect(await total(A)).toBe(0); // no buy yet: pending
    let s = await svc.socialOf(A);
    expect(s.quests.map((q) => q.status)).toEqual(['pending', 'pending', 'pending']);
    expect(s.pendingCaps).toBe(0.25);

    await buy(A, T0 + 100);
    clock.set(T0 + 200);
    expect(await svc.awardCaps()).toMatchObject({ social: 3 });
    expect(await total(A)).toBe(1.25); // played 1 + social 0.25
    s = await svc.socialOf(A);
    expect(s).toMatchObject({ handle: 'fan_one', locked: true, countedCaps: 0.25, pendingCaps: 0 });
    const row = (await svc.capsTable()).find((r) => r.wallet === A)!;
    expect(row).toMatchObject({ caps: 1.25, social: 0.25 });

    await svc.reviewSocial(A, 'follow', 'rejected', 'not following');
    expect(await svc.awardCaps()).toMatchObject({ voided: 1 });
    expect(await svc.awardCaps()).toMatchObject({ voided: 0 });
    expect(await total(A)).toBe(1.15);
    expect((await svc.socialOf(A)).quests.find((q) => q.quest === 'follow')!.status).toBe('removed');
    expect(await store.get<CapDoc>(CAPS_COL, `${A}__S1__social:follow__void`)).toMatchObject({ amount: -0.1, voids: `${A}__S1__social:follow` });
    expect((await svc.listSocialClaims('rejected')).map((c) => c.wallet)).toEqual([A]);
  });
});

describe('season 1: provisional wallets', () => {
  it('holds a wallet first seen under 24 h before its first buy; an older one counts', async () => {
    const { svc, clock, buy, store } = world({ ages: { [A]: { at: T0 - 3600, olderThanWindow: false }, [B]: { at: T0 - 3 * DAY, olderThanWindow: false } } });
    clock.set(T0 + 60);
    await buy(A, T0);
    await buy(B, T0 + 10);
    await buy(C, T0 + 20); // no age entry: older than the window
    clock.set(T0 + 120);
    await svc.awardCaps();
    const t = await svc.capsTable();
    expect(Object.fromEntries(t.map((r) => [r.wallet, r.provisional]))).toEqual({ [A]: true, [B]: false, [C]: false });
    expect(await store.get<SeasonWalletDoc>(SEASON_COL.wallets, `S1__${A}`)).toMatchObject({ provisional: true, provisionalReason: 'new_wallet', bornAt: T0 - 3600 });
    expect((await store.query<CapDoc>(CAPS_COL, { where: [['wallet', '==', A]] }))[0]).toMatchObject({ provisional: true });
    await svc.decideProvisional(A, 'kept', 'real person');
    expect((await svc.capsTable()).find((r) => r.wallet === A)!.provisional).toBe(false);

    const stats = await svc.seasonStats();
    expect(stats).toMatchObject({ capsIssued: 3, wallets: 3, provisionalWallets: 0 });
    expect(stats.excluded.map((e) => e.key)).toContain('scout_funder');
    expect(JSON.stringify(stats)).not.toContain(A.slice(2)); // counts only, never addresses
    const st = await svc.seasonStanding(B);
    expect(st).toMatchObject({ caps: 1, breakdown: { played: 1 }, provisional: false, hasSeasonBuy: true });
    expect(st.rank).toBeGreaterThan(0);
  });

  it('a verified buy record that is not ours earns nothing for the founder or social awards either', async () => {
    const { svc, clock, store } = world();
    await store.set<BuyDoc>(COL.buys, hash(0x9999), { txHash: hash(0x9999), wallet: A, verified: false } as unknown as BuyDoc);
    clock.set(T0 + 60);
    await svc.setXHandle(A, 'fan_one');
    await svc.claimSocial(A, 'follow');
    await svc.awardCaps();
    expect((await svc.socialOf(A)).pendingCaps).toBe(0.1);
  });
});

describe('funding from the chain: native ETH and age', () => {
  const W = addr(0xb01);
  const X = addr(0xb02);
  const Y = addr(0xb03);
  /** A chain where W first gets `ethFrom`'s ETH at block `ethAt` (plain or internal), and USDC from Y at `usdcAt`. */
  function chainWith(o: { ethAt: bigint | null; ethFrom?: string; internal?: boolean; usdcAt?: bigint; activeBeforeWindow?: boolean }): FundingChain {
    const head = 2_000_000n;
    return {
      blockNumber: async () => head,
      getTransferLogs: async (q) => (o.usdcAt != null && q.fromBlock <= o.usdcAt ? [{ token: q.tokens[0]!, from: Y, to: W, value: 5n, blockNumber: o.usdcAt, txHash: hash(1), logIndex: 3 }] : []),
      nonceOf: async () => 3,
      balanceAt: async (_a, b) => (o.activeBeforeWindow || (o.ethAt != null && b >= o.ethAt) ? 10n ** 15n : 0n),
      nonceAt: async () => 0,
      blockTransfers: async (b) => (b === o.ethAt && !o.internal ? [{ from: o.ethFrom ?? X, to: W, value: 10n ** 15n }] : []),
      blockTime: async (b) => Number(b) * 2,
    };
  }

  it('finds the first native ETH sender by binary search and dates the wallet from it', async () => {
    const r = new RpcFundingResolver(chainWith({ ethAt: 1_234_567n, usdcAt: 1_500_000n }));
    expect(await r.firstFunder(W)).toBe(X);
    expect(await r.firstSeen(W)).toEqual({ at: 1_234_567 * 2, olderThanWindow: false });
  });

  it('takes the USDC sender when it came first, and gives no ETH sender for ETH from a contract', async () => {
    expect(await new RpcFundingResolver(chainWith({ ethAt: 1_600_000n, usdcAt: 1_500_000n })).firstFunder(W)).toBe(Y);
    const internal = new RpcFundingResolver(chainWith({ ethAt: 1_000_000n, internal: true }));
    expect(await internal.firstFunder(W)).toBeNull();
    expect((await internal.firstSeen(W)).at).toBe(2_000_000);
  });

  it('a wallet already active before the window is not new', async () => {
    const r = new RpcFundingResolver(chainWith({ ethAt: null, activeBeforeWindow: true }));
    expect(await r.firstSeen(W)).toEqual({ at: null, olderThanWindow: true });
  });
});
