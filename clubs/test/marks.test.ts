/**
 * Marks cannot be poisoned by a crafted buy. Anyone can send a transaction that carries our public
 * Builder Code and pays a fortune for one raw unit; its fill price must never become a shared mark.
 */
import { describe, expect, it } from 'vitest';
import { StoreMarkSource } from '../src/prices';
import { MemoryDocStore } from '../src/store/memory';
import { COL, type MarkDoc } from '../src/types';
import { Clock, FakeChain, TOK, addr, hash, makeService } from './helpers';

const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);

describe('marks', () => {
  it('a recorded buy writes no mark, however absurd its price', async () => {
    const store = new MemoryDocStore();
    const chain = new FakeChain();
    const clock = new Clock(at('2026-11-24T15:05:00Z'));
    const { svc } = makeService({ store, chain, clock });
    const W = addr(77);
    svc.ctx.config.tokens.set(TOK.NVDAc, 'NVDAc');
    const tx = hash(4242);
    // 1,000,000 USDC in, one raw unit out: an implied price of $100 trillion a token
    chain.addBuy({ hash: tx, wallet: W, token: TOK.NVDAc, raw: 1n, usdc: 1_000_000_000_000n, block: 60_000_100n, time: at('2026-11-24T15:00:00Z') });
    const r = await svc.recordBuy({ txHash: tx, wallet: W, clubId: null, country: 'BR' });
    expect(r.ok).toBe(true);
    expect(await store.query<MarkDoc>(COL.marks)).toEqual([]);
    expect(await new StoreMarkSource(store).markAt(TOK.NVDAc, at('2026-11-24T16:00:00Z'))).toBeNull();
  });

  it('marks left by older versions with source "buy" are ignored', async () => {
    const store = new MemoryDocStore();
    const t = at('2026-11-24T15:00:00Z');
    await store.set<MarkDoc>(COL.marks, 'a', { id: 'a', token: TOK.NVDAc, t: t - 3600, usd: 130, source: 'close' });
    await store.set<MarkDoc>(COL.marks, 'b', { id: 'b', token: TOK.NVDAc, t, usd: 1e14, source: 'buy' });
    const m = await new StoreMarkSource(store).markAt(TOK.NVDAc, t + 60);
    expect(m?.usd).toBe(130);
  });
});
