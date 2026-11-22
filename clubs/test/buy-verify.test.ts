/**
 * A buy counts only when its receipt shows our swap: the pinned KyberSwap router's Swapped log, the
 * payment going from the buyer toward the router, the stock coming out of a real Aerodrome pool to
 * the buyer, at a price within 3% of the mark. The Builder Code alone proves nothing.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { KYBER_ROUTER_ADDRESS, poolCandidates, verifyRouterBuy } from '../src/chain/swap';
import { USDC_ADDRESS, type RawLog } from '../src/chain/types';
import { loadLedger } from '../src/ledger';
import { StaticPriceSource } from '../src/prices';
import { MemoryDocStore } from '../src/store/memory';
import { COL, type BuyDoc, type BuyRejectDoc, type TransferDoc } from '../src/types';
import { Clock, ENTRYPOINT, EXECUTOR, FakeChain, POOL, TOK, addr, hash, makeService, swappedLog, transferLog } from './helpers';

const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

/** A real router buy of SPCXc on Base (block 60,596,465): 58.117933 USDC in, 0.44436138 SPCXc out. */
const genuine = JSON.parse(readFileSync(new URL('./fixtures/router-buy-spcxc.json', import.meta.url), 'utf8')) as {
  txHash: string;
  from: string;
  token: string;
  pool: string;
  blockNumber: number;
  logs: RawLog[];
};
const BUYER = genuine.from.toLowerCase();

function setup(o: { mark?: number; markToken?: string; t?: number } = {}) {
  const store = new MemoryDocStore();
  const chain = new FakeChain();
  const t = o.t ?? at('2026-11-24T15:00:00Z');
  const clock = new Clock(t + 300);
  const token = o.markToken ?? TOK.NVDAc;
  const prices = new StaticPriceSource({ [token]: [[t - 600, o.mark ?? 131]] });
  const { svc } = makeService({ store, chain, clock, prices });
  return { store, chain, svc, t };
}

describe('genuine router buy (real receipt)', () => {
  it('passes the receipt check once its pool is verified', () => {
    expect(poolCandidates(genuine.logs, BUYER)).toEqual([genuine.pool]);
    const r = verifyRouterBuy(genuine.logs, BUYER, { pools: new Set([genuine.pool]) });
    expect(r).toMatchObject({ ok: true, token: genuine.token, raw: 44_436_138n, spent: 58_117_933n, paidWith: 'usdc', logIndexes: [47], fromPools: 44_436_138n });
  });

  it('fails when the pool is not verified', () => {
    expect(verifyRouterBuy(genuine.logs, BUYER)).toMatchObject({ ok: false, reason: 'not_from_pool' });
  });

  it('is recorded, from a smart wallet via the EntryPoint, with the mark as its cost basis', async () => {
    const { store, chain, svc, t } = setup({ markToken: genuine.token, mark: 131 });
    svc.ctx.config.tokens.set(genuine.token, 'SPCXc');
    chain.pools.add(genuine.pool);
    chain.addRaw({ hash: genuine.txHash, wallet: BUYER, logs: genuine.logs, block: BigInt(genuine.blockNumber), time: t, to: ENTRYPOINT, via: 'userop' });
    const r = await svc.recordBuy({ txHash: genuine.txHash, wallet: BUYER, clubId: null, country: 'BR' });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.reason);
    const fill = 58.117933 / 0.44436138;
    expect(r.buy).toMatchObject({ verified: true, usdIn: 58.117933, usdSource: 'usdc', priceAtBuy: 131, markSource: 'static', qualifies: true, via: 'userop', rawAmount: '44436138' });
    expect(r.buy.fillPrice).toBeCloseTo(fill, 4);
    const lots = await store.query<TransferDoc>(COL.transfers);
    expect(lots.map((l) => [l.logIndex, l.tropa])).toEqual([[47, true]]);
    // club returns start from the mark at the buy's block, not from the fill
    const ledger = await loadLedger(svc.ctx, BUYER);
    expect(ledger.flows.map((f) => f.priceAtBuy)).toEqual([131]);
    expect(ledger.qualifying.map((b) => b.txHash)).toEqual([genuine.txHash]);
    const stats = await svc.getStats();
    expect(stats.attributedTx).toBe(1);
    expect(stats.usdRouted).toBeCloseTo(58.12, 2);
  });

  it('is refused when the fill is more than 3% from the mark at that block', async () => {
    const { store, chain, svc, t } = setup({ markToken: genuine.token, mark: 140 });
    svc.ctx.config.tokens.set(genuine.token, 'SPCXc');
    chain.pools.add(genuine.pool);
    chain.addRaw({ hash: genuine.txHash, wallet: BUYER, logs: genuine.logs, block: BigInt(genuine.blockNumber), time: t });
    expect(await svc.recordBuy({ txHash: genuine.txHash, wallet: BUYER, clubId: null, country: 'BR' })).toMatchObject({ ok: false, reason: 'price_off_mark' });
    const rej = await store.get<BuyRejectDoc>(COL.buyRejects, genuine.txHash);
    expect(rej).toMatchObject({ reason: 'price_off_mark', attributed: true });
    expect(rej!.detail).toMatch(/-6\.6%/);
    expect(await store.query<BuyDoc>(COL.buys)).toEqual([]);
  });

  it('asks to try again, and records nothing, when no mark is available', async () => {
    const { store, chain, svc, t } = setup({ markToken: TOK.TSLAc });
    svc.ctx.config.tokens.set(genuine.token, 'SPCXc');
    chain.pools.add(genuine.pool);
    chain.addRaw({ hash: genuine.txHash, wallet: BUYER, logs: genuine.logs, block: BigInt(genuine.blockNumber), time: t });
    expect(await svc.recordBuy({ txHash: genuine.txHash, wallet: BUYER, clubId: null, country: 'BR' })).toMatchObject({ ok: false, reason: 'cannot_verify_now', retryable: true });
    expect(await store.query<BuyDoc>(COL.buys)).toEqual([]);
  });
});

describe('forged buys', () => {
  const B = addr(0xb0b); // the "buyer", a smart wallet
  const A = addr(0xa11ce); // the buyer's other wallet
  const SHARE = 100_000_000n; // one whole NVDAc

  it('the red-team batch: USDC.transfer(A, $5) + NVDAc.transferFrom(A, B, 1 share), with the Builder Code', async () => {
    const { store, chain, svc, t } = setup({ mark: 131 });
    const h = hash(0xf00d);
    chain.addRaw({
      hash: h,
      wallet: B,
      block: 60_100_000n,
      time: t,
      to: ENTRYPOINT,
      via: 'userop',
      logs: [transferLog(USDC_ADDRESS, B, A, 5_000_000n, 0), transferLog(TOK.NVDAc, A, B, SHARE, 1)],
    });
    expect(await svc.recordBuy({ txHash: h, wallet: B, clubId: null, country: 'BR' })).toMatchObject({ ok: false, reason: 'not_router_swap' });
    expect(await store.get<BuyRejectDoc>(COL.buyRejects, h)).toMatchObject({ reason: 'not_router_swap', attributed: true, detail: 'no Swapped log from the KyberSwap router' });
    expect(await store.query<BuyDoc>(COL.buys)).toEqual([]);
    const stats = await svc.getStats();
    expect(stats.attributedTx).toBe(0);
    expect(stats.usdRouted).toBe(0);
  });

  it('a Swapped log emitted by any contract but the router is ignored', () => {
    const logs = [
      transferLog(USDC_ADDRESS, B, A, 5_000_000n, 0),
      transferLog(TOK.NVDAc, A, B, SHARE, 1),
      swappedLog({ sender: B, srcToken: USDC_ADDRESS, dstToken: TOK.NVDAc, dstReceiver: B, spent: 5_000_000n, returned: SHARE, logIndex: 2, emitter: addr(0xbad) }),
    ];
    expect(verifyRouterBuy(logs, B, { pools: new Set([POOL]) })).toMatchObject({ ok: false, reason: 'not_router_swap' });
  });

  it('a real router call whose payment goes to the buyer\'s own wallet is refused', () => {
    // the caller names its own srcReceiver and executor: the router logs Swapped all the same
    const logs = [
      transferLog(USDC_ADDRESS, B, A, 5_000_000n, 0),
      transferLog(TOK.NVDAc, A, B, SHARE, 1),
      swappedLog({ sender: B, srcToken: USDC_ADDRESS, dstToken: TOK.NVDAc, dstReceiver: B, spent: 5_000_000n, returned: SHARE, logIndex: 2 }),
    ];
    expect(verifyRouterBuy(logs, B, { pools: new Set([POOL]) })).toMatchObject({ ok: false, reason: 'payment_mismatch' });
  });

  it('stock handed over by the buyer\'s own wallet, not a pool, is refused', async () => {
    const { store, chain, svc, t } = setup({ mark: 131 });
    const h = hash(0xf00e);
    chain.addRaw({
      hash: h,
      wallet: B,
      block: 60_100_001n,
      time: t,
      logs: [
        transferLog(USDC_ADDRESS, B, EXECUTOR, 131_000_000n, 0),
        transferLog(USDC_ADDRESS, EXECUTOR, A, 131_000_000n, 1),
        transferLog(TOK.NVDAc, A, EXECUTOR, SHARE, 2),
        transferLog(TOK.NVDAc, EXECUTOR, B, SHARE, 3),
        swappedLog({ sender: B, srcToken: USDC_ADDRESS, dstToken: TOK.NVDAc, dstReceiver: B, spent: 131_000_000n, returned: SHARE, logIndex: 4 }),
      ],
    });
    expect(await svc.recordBuy({ txHash: h, wallet: B, clubId: null, country: 'BR' })).toMatchObject({ ok: false, reason: 'not_from_pool' });
    expect((await store.get<BuyRejectDoc>(COL.buyRejects, h))!.detail).toContain(A);
  });

  it('a real pool swap at a made-up price is refused and logged', async () => {
    const { store, chain, svc } = setup({ mark: 131 });
    const h = hash(0xf00f);
    // $5 for a whole share, through the executor and a real pool: the shape is right, the price is not
    chain.addBuy({ hash: h, wallet: B, token: TOK.NVDAc, raw: SHARE, usdc: 5_000_000n, block: 60_100_002n, time: at('2026-11-24T15:00:00Z') });
    expect(await svc.recordBuy({ txHash: h, wallet: B, clubId: null, country: 'BR' })).toMatchObject({ ok: false, reason: 'price_off_mark' });
    const rej = await store.get<BuyRejectDoc>(COL.buyRejects, h);
    expect(rej).toMatchObject({ reason: 'price_off_mark', attributed: true });
    expect(rej!.detail).toMatch(/fill \$5\.0000 vs static mark \$131\.0000 \(-96\.2%\)/);
    expect((await svc.getStats()).attributedTx).toBe(0);
  });

  it('extra stock slipped into a genuine buy is not a Tropa lot', async () => {
    const { store, chain, svc, t } = setup({ markToken: genuine.token, mark: 131 });
    svc.ctx.config.tokens.set(genuine.token, 'SPCXc');
    chain.pools.add(genuine.pool);
    const logs = [...genuine.logs, transferLog(genuine.token, A, BUYER, 9_000_000_000n, 99)];
    chain.addRaw({ hash: genuine.txHash, wallet: BUYER, logs, block: BigInt(genuine.blockNumber), time: t });
    const r = await svc.recordBuy({ txHash: genuine.txHash, wallet: BUYER, clubId: null, country: 'BR' });
    expect(r).toMatchObject({ ok: true, buy: { rawAmount: '44436138', usdIn: 58.117933 } });
    const lots = (await store.query<TransferDoc>(COL.transfers)).sort((a, b) => a.logIndex - b.logIndex);
    expect(lots.map((l) => [l.logIndex, l.tropa])).toEqual([[47, true], [99, false]]);
  });

  it('the router address is the one the buy package sends to', () => {
    expect(KYBER_ROUTER_ADDRESS).toBe('0x6131B5fae19EA4f9D964eAc0408E4408b66337b5'.toLowerCase());
  });
});
