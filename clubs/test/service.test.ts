/**
 * End-to-end season walk-through against every store under test (memory always; the Firestore emulator
 * too when FIRESTORE_EMULATOR_HOST is set, e.g. `npm run test:emulator`).
 */
import { TROPA_SUFFIX } from '@tropaclub/buy';
import { describe, expect, it } from 'vitest';
import { StaticHistorySource } from '../src/history';
import { StaticPriceSource } from '../src/prices';
import { COL, type BuyDoc, type ClubDoc, type MemberDoc, type QueueDoc } from '../src/types';
import { DAY, HOUR } from '../src/util';
import { Clock, FakeChain, TOK, addr, hash, makeService, storesUnderTest } from './helpers';

const at = (s: string) => Date.parse(s) / 1000;
const T0 = at('2026-11-20T00:00:00Z');
const blockAt = (t: number) => BigInt(50_000_000 + Math.floor((t - T0) / 2));

const A = addr(0xa1);
const B = addr(0xb2);
const C = addr(0xc3);
const D = addr(0xd4);
const E = addr(0xe5);
const F = addr(0xf6);
const X = addr(0x99); // outsider

// A buy's cost basis is the mark at its block (never its fill), and a fill more than 3% from the
// mark is refused. The intraday marks just before each buy equal its fill, so the arithmetic below
// reads the same either way.
const prices = () =>
  new StaticPriceSource({
    [TOK.NVDAc]: [
      [at('2026-11-24T14:59:00Z'), 10 / 0.07650616],
      [at('2026-11-25T13:59:00Z'), 12 / 0.09],
      [at('2026-12-01T14:59:00Z'), 15 / 0.11111111],
      [at('2026-12-02T15:29:00Z'), 10 / 0.07352941],
      [at('2026-11-24T21:00:00Z'), 131.5],
      [at('2026-11-25T21:00:00Z'), 133],
      [at('2026-11-27T18:00:00Z'), 134],
      [at('2026-12-01T21:00:00Z'), 135],
      [at('2026-12-04T21:00:00Z'), 137],
    ],
    [TOK.TSLAc]: [
      [at('2026-11-24T15:59:00Z'), 20 / 0.045],
      [at('2026-12-02T14:59:00Z'), 25 / 0.055],
      [at('2026-11-24T21:00:00Z'), 450],
      [at('2026-11-25T21:00:00Z'), 440],
      [at('2026-11-27T18:00:00Z'), 455],
      [at('2026-12-04T21:00:00Z'), 460],
    ],
  });

const stores = await storesUnderTest();

describe.each(stores)('clubs engine on $name store', ({ make }) => {
  it('runs GW0 and GW1: join, verified buys, lineup, call-ups, fixtures, tables, stats, pennants, statement', async () => {
    const store = await make();
    const clock = new Clock(at('2026-11-24T14:00:00Z'));
    const chain = new FakeChain();
    let n = 1;
    const buy = (wallet: string, token: string, raw: bigint, usd: number, time: string, o: Partial<Parameters<FakeChain['addBuy']>[0]> = {}) => {
      const t = at(time);
      const h = hash(n++);
      chain.addBuy({ hash: h, wallet, token, raw, usdc: BigInt(Math.round(usd * 1e6)), block: blockAt(t), time: t, ...o });
      return h;
    };
    const history = new StaticHistorySource();
    const { svc } = makeService({ store, chain, prices: prices(), clock, history });

    // ---------------------------------------------------------------- create + join (bench seats)
    const { club: lagos, inviteCode, inviteUrl } = await svc.createClub({ name: '  Lagos   Value FC ', createdBy: A, nickname: 'Ada' });
    expect(lagos).toMatchObject({ name: 'Lagos Value FC', kind: 'private', memberCount: 1, playingCount: 0 });
    expect(JSON.stringify(lagos)).not.toContain(inviteCode); // the public club doc never carries the code
    expect(inviteUrl).toBe(`https://tropaclub.xyz/join/${inviteCode}`);
    await svc.joinClub({ wallet: B, inviteCode: inviteCode.toLowerCase(), nickname: 'Bo' });
    await svc.joinClub({ wallet: C, inviteCode });
    const again = await svc.joinClub({ wallet: C, inviteCode });
    expect(again.alreadyMember).toBe(true);
    await expect(svc.joinClub({ wallet: X, clubId: lagos.id })).rejects.toMatchObject({ code: 'invite_required' });
    await expect(svc.joinClub({ wallet: X, inviteCode: 'NOPE0000' })).rejects.toMatchObject({ code: 'club_not_found' });
    await expect(svc.createClub({ name: 'join www.scam.xyz', createdBy: X })).rejects.toMatchObject({ code: 'bad_name' });
    const nvClub = await svc.ensureStockClub({ symbol: 'NVDAc', token: TOK.NVDAc, name: 'NVIDIA' });
    expect(nvClub).toMatchObject({ id: 'stock-nvdac', name: 'NVIDIA FC', kind: 'stock' });
    expect((await svc.ensureStockClub({ symbol: 'NVDAc', token: TOK.NVDAc, name: 'NVIDIA' })).id).toBe(nvClub.id);
    await svc.joinClub({ wallet: A, clubId: nvClub.id });
    expect((await svc.getClub(lagos.id))!.memberCount).toBe(3);

    // ---------------------------------------------------------------- record buys
    clock.set(at('2026-11-24T15:05:00Z'));
    const tx1 = buy(A, TOK.NVDAc, 7_650_616n, 10, '2026-11-24T15:00:00Z');
    const r1 = await svc.recordBuy({ txHash: tx1, wallet: A, clubId: lagos.id, country: 'BR' });
    expect(r1.ok).toBe(true);
    if (!r1.ok) throw new Error();
    expect(r1.promoted).toBe(true);
    expect(r1.buy).toMatchObject({ usdIn: 10, usdSource: 'usdc', qualifies: true, gw: 'GW0', attributed: true, via: 'tx', symbol: 'NVDAc', priorBalanceRaw: '0' });
    expect(r1.buy.priceAtBuy).toBeCloseTo(10 / 0.07650616, 4);
    expect(r1.seats.sort((a, b) => (a.clubId < b.clubId ? -1 : 1))).toEqual([
      { clubId: lagos.id, seat: 'playing' },
      { clubId: nvClub.id, seat: 'playing' },
    ]);
    expect(await svc.recordBuy({ txHash: tx1, wallet: A, clubId: lagos.id })).toMatchObject({ ok: false, reason: 'duplicate' });

    const tx2 = buy(B, TOK.NVDAc, 7_650_616n, 10, '2026-11-24T15:20:00Z', { attributed: false });
    expect(await svc.recordBuy({ txHash: tx2, wallet: B, clubId: lagos.id })).toMatchObject({ ok: false, reason: 'not_attributed' });
    const tx3 = buy(B, TOK.NVDAc, 7_650_616n, 10, '2026-11-24T15:25:00Z', { signer: C });
    expect(await svc.recordBuy({ txHash: tx3, wallet: B, clubId: lagos.id })).toMatchObject({ ok: false, reason: 'not_from_wallet' });
    expect(await svc.recordBuy({ txHash: hash(999), wallet: B, clubId: lagos.id })).toMatchObject({ ok: false, reason: 'not_found', retryable: true });
    const txR = buy(B, TOK.NVDAc, 7_650_616n, 10, '2026-11-24T15:26:00Z', { reverted: true });
    expect(await svc.recordBuy({ txHash: txR, wallet: B, clubId: lagos.id })).toMatchObject({ ok: false, reason: 'reverted' });
    expect(await svc.recordBuy({ txHash: hash(n + 50), wallet: B, clubId: lagos.id, country: 'US' })).toMatchObject({ ok: false, reason: 'region_blocked' });
    expect(await svc.recordBuy({ txHash: hash(n + 51), wallet: B, clubId: lagos.id, country: 'PR' })).toMatchObject({ ok: false, reason: 'region_blocked' });
    expect(await svc.recordBuy({ txHash: hash(n + 52), wallet: X, clubId: lagos.id })).toMatchObject({ ok: false, reason: 'not_member' });

    const tx4 = buy(B, TOK.NVDAc, 3_060_246n, 4, '2026-11-24T15:30:00Z');
    const r4 = await svc.recordBuy({ txHash: tx4, wallet: B, clubId: lagos.id });
    expect(r4).toMatchObject({ ok: true, promoted: false, buy: { qualifies: false, usdIn: 4 } });

    const tx5 = buy(C, TOK.TSLAc, 4_500_000n, 20, '2026-11-24T16:00:00Z', { via: 'userop', splitLegs: true });
    const r5 = await svc.recordBuy({ txHash: tx5, wallet: C, clubId: lagos.id });
    expect(r5).toMatchObject({ ok: true, promoted: true, buy: { via: 'userop', rawAmount: '4500000', qualifies: true } });

    // wash: buy -> sell -> buy inside 24 h scores 0 for both buys
    clock.set(at('2026-11-25T21:00:00Z'));
    const tx6 = buy(B, TOK.NVDAc, 9_000_000n, 12, '2026-11-25T14:00:00Z');
    expect(await svc.recordBuy({ txHash: tx6, wallet: B, clubId: lagos.id })).toMatchObject({ ok: true, promoted: true });
    chain.addSell({ hash: hash(500), wallet: B, token: TOK.NVDAc, raw: 9_000_000n, block: blockAt(at('2026-11-25T16:00:00Z')), time: at('2026-11-25T16:00:00Z') });
    const tx7 = buy(B, TOK.NVDAc, 9_000_000n, 12, '2026-11-25T20:00:00Z');
    const r7 = await svc.recordBuy({ txHash: tx7, wallet: B, clubId: lagos.id });
    expect(r7).toMatchObject({ ok: true, buy: { wash: true, qualifies: false } });
    expect((await store.get<BuyDoc>(COL.buys, tx6))!.wash).toBe(true);
    const bSeat = await store.get<MemberDoc>(COL.members, `${lagos.id}__${B}`);
    expect(bSeat!.seat).toBe('bench');
    expect((await svc.getClub(lagos.id))!.playingCount).toBe(2);

    // ---------------------------------------------------------------- matchday card (Wed close)
    clock.set(at('2026-11-25T22:00:00Z'));
    const card = await svc.getMatchdayCard(lagos.id);
    expect(card.gw.id).toBe('GW0');
    expect(card.cut!.date).toBe('2026-11-25');
    expect(card).toMatchObject({ members: 3, played: 2, benched: 1, bonus: false, fixture: { status: 'preseason' } });
    const pA = 10 / 0.07650616;
    const rA = (133 / pA - 1) * 100;
    const rC = (440 / (20 / 0.045) - 1) * 100;
    expect(card.score!).toBeCloseTo((rA + rC) / 2, 3);
    expect(card.topScorer).toMatchObject({ nickname: 'Ada' });
    expect(card.topScorer!.returnPct).toBeCloseTo(rA, 3);
    expect(card.lineup.map((l) => [l.nickname ?? l.who, l.played])).toEqual([
      ['Ada', true],
      [card.lineup[1]!.who, true],
      ['Bo', false],
    ]);
    expect(JSON.stringify(card)).not.toContain(A); // public card: short addresses only
    expect(card.labels.join(' ')).toContain('status only');

    // ---------------------------------------------------------------- call-ups
    const share = await svc.sendCallup({ clubId: lagos.id, from: A, to: B, country: 'BR' });
    expect(share.text).toContain('Ada called you up for Lagos Value FC');
    expect(share.text).toContain('80% bonus');
    expect(share.whatsapp).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(share.telegram).toMatch(/^https:\/\/t\.me\/share\/url\?url=/);
    await expect(svc.sendCallup({ clubId: lagos.id, from: A, to: B, country: 'BR' })).rejects.toMatchObject({ code: 'already_called_up' });
    await expect(svc.sendCallup({ clubId: lagos.id, from: B, to: C, country: 'BR' })).rejects.toMatchObject({ code: 'not_playing' });
    await expect(svc.sendCallup({ clubId: lagos.id, from: A, to: C, country: 'BR' })).rejects.toMatchObject({ code: 'already_playing' });
    await expect(svc.sendCallup({ clubId: lagos.id, from: C, to: B, country: 'US' })).rejects.toMatchObject({ code: 'region_blocked' });
    expect(svc.callupsVisible('US')).toBe(false);
    expect(await svc.listCallups(lagos.id)).toEqual([{ to: expect.stringMatching(/^0x0000/), count: 1 }]);

    // ---------------------------------------------------------------- club page (viewer, region)
    const page = await svc.getClubPage(lagos.id, { viewer: C, country: 'PH' });
    expect(page.viewer).toMatchObject({ member: true, seat: 'playing', playedThisGw: true });
    expect(page.viewer!.invite!.code).toBe(inviteCode);
    expect(page.viewer!.canCallUp).toEqual([B]);
    expect(page.members.every((m) => m.wallet)).toBe(true);
    const outsider = await svc.getClubPage(lagos.id, { viewer: X, country: 'US' });
    expect(outsider).toMatchObject({ buyVisible: false, callupsVisible: false, viewer: { member: false, invite: null, canCallUp: [] } });
    expect(outsider.members.every((m) => m.wallet === undefined)).toBe(true);

    // ---------------------------------------------------------------- GW0 final (preseason table + supporters)
    clock.set(at('2026-11-27T19:00:00Z'));
    expect(await svc.scheduleFixtures('GW0')).toEqual([]);
    const s0 = await svc.settleGameweek('GW0');
    const lagos0 = s0.results.find((r) => r.clubId === lagos.id)!;
    const fA = (134 / pA - 1) * 100;
    const fC = (455 / (20 / 0.045) - 1) * 100;
    expect(lagos0).toMatchObject({ final: true, played: 2, members: 3, participationPct: 66.7 });
    expect(lagos0.score!).toBeCloseTo((fA + fC) / 2, 3);
    const pre = await svc.getPreseasonTable();
    expect(pre.map((r) => r.clubId)).toEqual([lagos.id]);
    const sup = await svc.getSupportersTable('GW0');
    expect(sup.rows).toEqual([expect.objectContaining({ clubId: nvClub.id, members: 1, played: 1, participationPct: 100, activeStreaks: 1 })]);

    // ---------------------------------------------------------------- weekend: C sells everything (found by the sweep)
    const sellT = at('2026-11-28T10:00:00Z');
    chain.addSell({ hash: hash(600), wallet: C, token: TOK.TSLAc, raw: 4_500_000n, block: blockAt(sellT), time: sellT });

    // second private club for GW1
    clock.set(at('2026-11-29T12:00:00Z'));
    const { club: berlin, inviteCode: bc } = await svc.createClub({ name: 'Berlin Bulls', createdBy: D });
    await svc.joinClub({ wallet: E, inviteCode: bc });
    await svc.joinClub({ wallet: F, inviteCode: bc });

    clock.set(at('2026-11-30T10:00:00Z'));
    const fx = await svc.scheduleFixtures('GW1');
    expect(fx).toHaveLength(1);
    expect([fx[0]!.home, fx[0]!.away].sort()).toEqual([berlin.id, lagos.id].sort());
    expect(await svc.scheduleFixtures('GW1')).toHaveLength(1); // idempotent

    // A's GW1 buy is never posted by the client: the sweep finds it, and records it because the site quoted it
    await svc.recordQuote({ wallet: A, token: TOK.NVDAc, usd: 15, at: at('2026-12-01T14:58:00Z') });
    const tx8 = buy(A, TOK.NVDAc, 11_111_111n, 15, '2026-12-01T15:00:00Z');
    clock.set(at('2026-12-01T16:30:00Z'));
    const tx9 = buy(D, TOK.NVDAc, 7_407_407n, 10, '2026-12-01T16:00:00Z');
    expect((await svc.recordBuy({ txHash: tx9, wallet: D, clubId: berlin.id })).ok).toBe(true);
    const sw = await svc.sweepTransfers({ fromBlock: blockAt(at('2026-11-28T00:00:00Z')), toBlock: blockAt(at('2026-12-01T16:30:00Z')) });
    expect(sw).toMatchObject({ recorded: 1, outbound: 1 });
    expect((await store.get<BuyDoc>(COL.buys, tx8))).toMatchObject({ source: 'sweep', clubId: lagos.id, qualifies: true, gw: 'GW1' });

    // Founders' Pennant (D+7 holders of GW0): A held, C sold on Nov 28
    clock.set(at('2026-12-02T16:30:00Z'));
    const pennants = await svc.planFoundersPennants();
    expect(pennants.map((p) => p.recipient)).toEqual([A]);
    expect(pennants[0]!.calldata.endsWith(TROPA_SUFFIX.slice(2))).toBe(true);
    expect(pennants[0]!.to).toBe('0x4200000000000000000000000000000000000021');
    expect(await svc.planFoundersPennants()).toEqual([]); // idempotent

    const tx10 = buy(E, TOK.TSLAc, 5_500_000n, 25, '2026-12-02T15:00:00Z');
    const tx11 = buy(F, TOK.NVDAc, 7_352_941n, 10, '2026-12-02T15:30:00Z');
    expect((await svc.recordBuy({ txHash: tx10, wallet: E, clubId: berlin.id })).ok).toBe(true);
    expect((await svc.recordBuy({ txHash: tx11, wallet: F, clubId: berlin.id })).ok).toBe(true);

    // ---------------------------------------------------------------- GW1 final: fixture result + league table
    clock.set(at('2026-12-04T22:00:00Z'));
    const s1 = await svc.settleGameweek('GW1');
    const L = s1.results.find((r) => r.clubId === lagos.id)!;
    const Bb = s1.results.find((r) => r.clubId === berlin.id)!;
    expect(L.played).toBe(1);
    expect(L.score!).toBeCloseTo((137 / 134 - 1) * 100, 3); // TWR: prior lot from the GW0 cut + new money at its fill price
    expect(Bb).toMatchObject({ played: 3, participationPct: 100, bonus: true });
    expect(Bb.score!).toBeCloseTo((460 / (25 / 0.055) - 1) * 100, 3);
    const f1 = s1.fixtures[0]!;
    // by turnout, not returns: Berlin had 3 of 3 playing, Lagos 1 of 3 (Lagos's return was higher)
    const lagosHome = f1.home === lagos.id;
    expect(lagosHome ? f1.homePoints : f1.awayPoints).toBe(0);
    expect(lagosHome ? f1.awayPoints : f1.homePoints).toBe(4); // more played + the 80% turnout bonus
    const table = await svc.getLeagueTable();
    expect(table.rows.map((r) => [r.clubId, r.points])).toEqual([
      [berlin.id, 4],
      [lagos.id, 0],
    ]);
    const card1 = await svc.getMatchdayCard(berlin.id);
    expect(card1.fixture).toMatchObject({ status: 'won', opponent: { id: lagos.id }, opponentScore: L.participationPct });
    expect(card1.final).toBe(true);
    const champs = await svc.planChampionPennants('GW1');
    expect(champs.map((p) => p.recipient).sort()).toEqual([D, E, F].sort());

    // ---------------------------------------------------------------- stats (exclusion list applied)
    await svc.addExclusion({ wallet: F, label: 'test', reason: 'founder test wallet' });
    clock.set(at('2026-12-05T00:00:00Z'));
    const st = await svc.getStats();
    expect(st).toMatchObject({ uniqueSigners: 5, attributedTx: 8, submittedTx: 9, usdRouted: 108, qualifyingBuys: 5, belowMinBuys: 1, washBuys: 2 });
    expect(st.pctAttributed).toBeCloseTo(88.89, 2);
    expect(st.retention).toEqual([
      { day: 1, eligible: 4, held: 4, rate: 1 },
      { day: 3, eligible: 3, held: 3, rate: 1 },
      { day: 7, eligible: 2, held: 1, rate: 0.5 },
    ]);
    expect(st.gw0Retention.find((r) => r.day === 7)).toEqual({ day: 7, eligible: 2, held: 1, rate: 0.5 });
    expect(st.repeatBuy[0]).toEqual({ gw: 'GW0', nextGw: 'GW1', buyers: 2, repeat: 1, rate: 0.5 });
    expect(st.twoPlus).toEqual({ buyers: 4, twoPlus: 1, share: 0.25 });
    expect(st.seats).toMatchObject({ bench: 1, playing: 5, walletsPlaying: 4 });
    expect(st.exclusions.map((e) => e.wallet)).toEqual([F]);
    expect(st.attributedVia).toEqual({ tx: 7, userop: 1 });

    // ---------------------------------------------------------------- streak + statement
    const streak = await svc.getStreak(A);
    expect(streak).toMatchObject({ alive: true, paydays: 2 });
    const histA = new StaticHistorySource({
      [A]: [
        { token: TOK.NVDAc, dir: 'in', raw: 7_650_616n, t: at('2026-11-24T15:00:00Z'), blockNumber: 1, txHash: tx1, logIndex: 1, counterparty: addr(0xaa), legs: { paidUsd: 10, receivedUsd: null, otherOut: false, otherIn: false } },
        { token: TOK.NVDAc, dir: 'in', raw: 11_111_111n, t: at('2026-12-01T15:00:00Z'), blockNumber: 2, txHash: tx8, logIndex: 1, counterparty: addr(0xaa), legs: { paidUsd: null, receivedUsd: null, otherOut: false, otherIn: false } },
      ],
    });
    const { svc: svc2 } = makeService({ store, chain, prices: prices(), clock, history: histA });
    const stmt = await svc2.getStatement(A);
    expect(stmt.totals.costBasisOpenUsd).toBe(25); // tx8 basis comes from the recorded Tropa usdIn
    expect(stmt.totals.marketValueUsd).toBeCloseTo((7_650_616 + 11_111_111) / 1e8 * 137, 2);
    expect(await svc2.getStatementCsv(A)).toContain('bought through Tropa Club');
  });

  it('pick-up clubs: country first, region after 24 h, never two wallets sharing a funder, never the country', async () => {
    const store = await make();
    const clock = new Clock(at('2026-11-24T10:00:00Z'));
    const P = [1, 2, 3, 4, 5, 6].map((i) => addr(0x7000 + i));
    const { svc } = makeService({ store, clock, funders: { [P[0]!]: addr(0x51), [P[1]!]: addr(0x52), [P[2]!]: addr(0x51), [P[3]!]: addr(0x54) } });

    expect(await svc.optInPickup({ wallet: P[0]!, country: 'BR' })).toMatchObject({ queued: true, seated: null });
    await svc.optInPickup({ wallet: P[1]!, country: 'BR' });
    await svc.optInPickup({ wallet: P[2]!, country: 'BR' }); // shares P0's funding source
    await svc.optInPickup({ wallet: P[3]!, country: 'AR' });
    // three Brazilians wait, but two share a funder: no club yet
    expect(await svc.listClubs('pickup')).toEqual([]);
    const q = await store.get<QueueDoc>(COL.matchQueue, P[0]!);
    expect(q!.countryKey).not.toContain('BR');
    expect(JSON.stringify(q)).not.toMatch(/"BR"|Brazil/);
    expect(q!.region).toBe('Latin America');

    clock.add(25 * HOUR);
    const m = await svc.matchPickups();
    expect(m).toEqual({ seated: 3, clubsFormed: 1 });
    const [club] = await svc.listClubs('pickup');
    expect(club!).toMatchObject({ kind: 'pickup', regionLabel: 'Latin America', memberCount: 3, status: 'open', maxMembers: 5 });
    expect(club!.name).not.toMatch(/Brazil|Argentin|BR|AR\b/);
    const members = await store.query<MemberDoc>(COL.members, { where: [['clubId', '==', club!.id]] });
    expect(members.map((x) => x.wallet).sort()).toEqual([P[0], P[1], P[3]].sort());
    expect(JSON.stringify(members)).not.toMatch(/country|"BR"|"AR"/i);
    expect(await store.get(COL.matchQueue, P[0]!)).toBeNull();
    expect(await store.get(COL.matchQueue, P[2]!)).not.toBeNull(); // still waiting: funder conflict

    // a new joiner from the same region fills an open seat once their own wait widens to region
    await svc.optInPickup({ wallet: P[4]!, country: 'CO' });
    expect((await svc.getClub(club!.id))!.memberCount).toBe(3);
    clock.add(25 * HOUR);
    await svc.matchPickups();
    expect((await svc.getClub(club!.id))!.memberCount).toBe(4);
    // P2 (funder conflict) never joins that club, even at the global stage
    clock.add(30 * HOUR);
    await svc.matchPickups();
    expect(await store.get<MemberDoc>(COL.members, `${club!.id}__${P[2]!}`)).toBeNull();

    // opting out is respected
    const { club: priv, inviteCode } = await svc.createClub({ name: 'Solo Saver', createdBy: P[5]! });
    await svc.setMatchingOptOut({ wallet: P[5]!, clubId: priv.id, optOut: true });
    await expect(svc.optInPickup({ wallet: P[5]!, country: 'BR' })).rejects.toMatchObject({ code: 'opted_out' });
    expect(inviteCode).toMatch(/^[0-9A-Z]{8}$/);
    const all = await store.query<ClubDoc>(COL.clubs);
    expect(all.every((c) => !('inviteCode' in c))).toBe(true);
  });
});

describe('seed guard', () => {
  it('refuses to seed outside the emulator', async () => {
    const { assertEmulatorOnly } = await import('../scripts/seed-guard');
    const prev = process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    expect(() => assertEmulatorOnly('demo-tropaclub')).toThrow(/emulator/);
    process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
    expect(() => assertEmulatorOnly('project-5523359e-5941-4df4-998')).toThrow(/demo-/);
    expect(() => assertEmulatorOnly('demo-tropaclub')).not.toThrow();
    if (prev === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
    else process.env.FIRESTORE_EMULATOR_HOST = prev;
  });
});

void DAY;
