import { describe, expect, it } from 'vitest';
import type { CorporateActionsFile, HistoryEntry, WalletHistory, WalletHistoryShard } from '../../shared/types';
import { buildStatement } from '../../clubs/src/statement';
import { DAY_PRICE_NOTE, labelDayPrices, multipliersFromFile, netRaw, splitSymbols, transfersFromHistory, walletFromShards } from '../lib/statement-history';
import { assertMatchesHoldings } from '../lib/statement-check';

const WALLET = '0xfdcd2ddee853c940a2ce2e082a05744619b24689';
const NVDA = '0xb20000000000000000000078ee7ce2fe4908108c';
const SNDK = '0xb200000000000000000000397293cb8cda9a10c5';
const NOW = 1795300000; // 22 Nov 2026

// the reported wallet's entry, exactly as published in history/fd.json
const NVDA_BUY: HistoryEntry = { block: 50407417, ts: 1787604181, logIndex: 361, dir: 'in', raw: '18204497', counterpartyKind: 'router', txHash: '0x55cdceceb662eb5dd16819acc77c9b4da279b112825bbdcf50113effc099ccb0', priceUsd: 208.5921 };
const reported: WalletHistory = { tokens: [{ symbol: 'NVDAc', address: NVDA, entries: [NVDA_BUY] }] };

// the SNDKc 8-for-1 split, exactly as published in corporate-actions.json
const ACTIONS: CorporateActionsFile = {
  asOf: '2026-11-22T00:29:43.000Z',
  block: 60585040,
  tokens: [
    { symbol: 'NVDAc', address: NVDA, multiplierNow: 1, multiplierEvents: [], announcements: [] },
    {
      symbol: 'SNDKc',
      address: SNDK,
      multiplierNow: 8,
      multiplierEvents: [{ token: SNDK, kind: 'updated', oldWad: '1000000000000000000', newWad: '8000000000000000000', effectiveAt: 1795150800, blockNumber: 59674150, logIndex: 12, txHash: '0x3f1dbf9658e3fc8f6d38d57793c7d864fe58647c9aae2fbf6c88eb25b67bdf65', ts: 1795125205, announcement: '8-for-1 Stock Split' }],
      announcements: [],
    },
  ],
};

const e = (o: Partial<HistoryEntry> & Pick<HistoryEntry, 'block' | 'ts' | 'dir' | 'raw' | 'counterpartyKind'>): HistoryEntry => ({ logIndex: 1, txHash: `0x${o.block.toString(16).padStart(64, '0')}`, priceUsd: null, ...o });

async function statementOf(h: WalletHistory, live: Record<string, number>, tropa?: Map<string, number>) {
  const { transfers, marks, symbols, priceSources } = transfersFromHistory(h);
  const all = multipliersFromFile(ACTIONS);
  return labelDayPrices(
    await buildStatement({
      wallet: WALLET,
      transfers,
      multipliers: Object.fromEntries([...new Set(transfers.map((t) => t.token))].map((t) => [t, all[t] ?? []])),
      markAt: async (token, t) => marks.get(`${token}|${t}`) ?? live[token] ?? null,
      now: NOW,
      symbols,
      tropaBuys: tropa,
    }),
    priceSources,
  );
}

describe('the reported wallet, from the published history', () => {
  it('has one open NVDAc lot, costed at the day’s price and marked estimated: never zeros', async () => {
    const s = await statementOf(reported, { [NVDA]: 131.2 });
    expect(s.lots).toHaveLength(1);
    const lot = s.lots[0];
    expect(lot.symbol).toBe('NVDAc');
    expect(lot.shares).toBeCloseTo(0.18204497, 8);
    expect(lot.basisUsd).toBeCloseTo(0.18204497 * 208.5921, 2); // $37.97
    expect(lot.basisStatus).toBe('estimated');
    expect(lot.origin).toBe('buy_estimated');
    expect(new Date(lot.acquiredAt * 1000).toISOString().slice(0, 10)).toBe('2026-08-24');
    expect(s.totals.marketValueUsd).toBeCloseTo(0.18204497 * 131.2, 2);
    expect(s.totals.costBasisOpenUsd).toBeGreaterThan(1);
    expect(s.lines[0].type).toBe('buy');
    expect(s.lines[0].note).toBe('bought on a DEX: cost estimated at the day’s price');
    expect(s.warnings[0]).toBe(DAY_PRICE_NOTE);
    expect(() => assertMatchesHoldings([{ token: NVDA, symbol: 'NVDAc', usd: 23.88 }], s.lots)).not.toThrow();
  });
  it('says where an estimated price came from when the indexer names its source', async () => {
    const withSource = (src: NonNullable<HistoryEntry['priceSource']>): WalletHistory => ({ ...reported, tokens: reported.tokens.map((t) => ({ ...t, entries: t.entries.map((x) => ({ ...x, priceSource: src })) })) });
    const labels = { chainlink: 'est. at Chainlink close', pool: 'est. at pool average', carry: 'est. at last close', reference: 'est. at reference price' } as const;
    for (const [src, label] of Object.entries(labels) as [keyof typeof labels, string][]) {
      const s = await statementOf(withSource(src), { [NVDA]: 131.2 });
      expect(s.lines[0].note).toBe(`bought on a DEX: cost estimated at the day’s price · ${label}`);
      // the price itself is unchanged: raw / 1e8 x the day's priceUsd
      expect(s.lots[0].basisUsd).toBeCloseTo(0.18204497 * 208.5921, 2);
    }
  });
  it('uses the recorded dollars, not the day’s price, when the buy was made through Tropa Club', async () => {
    const s = await statementOf(reported, { [NVDA]: 131.2 }, new Map([[NVDA_BUY.txHash, 40]]));
    expect(s.lots[0].basisUsd).toBe(40);
    expect(s.lots[0].basisStatus).toBe('known');
    expect(s.lines[0].note).toBe('bought through Tropa Club');
    expect(s.warnings).not.toContain(DAY_PRICE_NOTE);
  });
});

describe('how each kind of movement reads', () => {
  const h: WalletHistory = {
    tokens: [
      {
        symbol: 'NVDAc',
        address: NVDA,
        entries: [
          e({ block: 10, ts: 1000, dir: 'in', raw: '100000000', counterpartyKind: 'pool', priceUsd: 100 }),
          e({ block: 11, ts: 1100, dir: 'in', raw: '50000000', counterpartyKind: 'distributor', priceUsd: 100 }),
          e({ block: 12, ts: 1200, dir: 'in', raw: '50000000', counterpartyKind: 'wallet', counterparty: '0x00000000000000000000000000000000000000Bb', priceUsd: 100 }),
          e({ block: 13, ts: 1300, dir: 'in', raw: '10000000', counterpartyKind: 'mint', priceUsd: 100 }),
          e({ block: 14, ts: 1400, dir: 'out', raw: '50000000', counterpartyKind: 'router', priceUsd: 120 }),
          e({ block: 15, ts: 1500, dir: 'out', raw: '10000000', counterpartyKind: 'contract', counterparty: '0x00000000000000000000000000000000000000cc', priceUsd: 120 }),
          e({ block: 16, ts: 1600, dir: 'out', raw: '10000000', counterpartyKind: 'burn', priceUsd: 120 }),
        ],
      },
    ],
  };
  it('maps pool and router to trades, the rest to transfers, mints and burns', async () => {
    const s = await statementOf(h, { [NVDA]: 130 });
    expect(s.lines.map((l) => l.type)).toEqual(['buy', 'transfer_in', 'transfer_in', 'mint', 'sell', 'transfer_out', 'redeem']);
    expect(s.lines[0].costUsd).toBe(100);
    expect(s.lines[1].basisStatus).toBe('unknown'); // a gift has no cost to read
    // FIFO: the sale takes half of the first lot ($50 of basis), sold at the day's $120
    expect(s.lines[4].proceedsUsd).toBe(60);
    expect(s.lines[4].realizedUsd).toBe(10);
    expect(s.lines[4].note).toBe('sold on a DEX: proceeds estimated at the day’s price');
  });
  it('adds up to the balance, and a history that goes below zero is detectable', () => {
    expect(netRaw(transfersFromHistory(h).transfers).get(NVDA)).toBe(140000000n);
    const broken: WalletHistory = { tokens: [{ symbol: 'NVDAc', address: NVDA, entries: [e({ block: 5, ts: 500, dir: 'out', raw: '5', counterpartyKind: 'pool' })] }] };
    expect(netRaw(transfersFromHistory(broken).transfers).get(NVDA)).toBe(-5n);
  });
  it('a buy with no day price has an unknown cost, not a zero one', async () => {
    const s = await statementOf({ tokens: [{ symbol: 'NVDAc', address: NVDA, entries: [e({ block: 10, ts: 1000, dir: 'in', raw: '100000000', counterpartyKind: 'pool', priceUsd: null })] }] }, {});
    expect(s.lots[0].basisUsd).toBeNull();
    expect(s.lots[0].basisStatus).toBe('unknown');
  });
  it('keeps the published order when two blocks share a second', () => {
    const two: WalletHistory = {
      tokens: [{ symbol: 'NVDAc', address: NVDA, entries: [e({ block: 20, ts: 2000, logIndex: 900, dir: 'in', raw: '7', counterpartyKind: 'pool' }), e({ block: 21, ts: 2000, logIndex: 3, dir: 'out', raw: '7', counterpartyKind: 'pool' })] }],
    };
    const t = transfersFromHistory(two).transfers;
    expect(t.map((x) => x.dir)).toEqual(['in', 'out']);
    expect(t[0].logIndex).toBeLessThan(t[1].logIndex);
  });
  it('refuses a malformed entry instead of building from part of a history', () => {
    const bad = { tokens: [{ symbol: 'NVDAc', address: NVDA, entries: [{ ...NVDA_BUY, raw: '1.5' }] }] } as WalletHistory;
    expect(() => transfersFromHistory(bad)).toThrow(/malformed/);
  });
});

describe('raw amounts are not multiplier-adjusted: the split comes from corporate-actions.json', () => {
  it('SNDKc 8-for-1: one raw token bought before the split is eight shares after it, with the same basis', async () => {
    const h: WalletHistory = { tokens: [{ symbol: 'SNDKc', address: SNDK, entries: [e({ block: 55000000, ts: 1794000000, dir: 'in', raw: '100000000', counterpartyKind: 'pool', priceUsd: 1600 })] }] };
    const s = await statementOf(h, { [SNDK]: 1680 });
    expect(s.lines.map((l) => l.type)).toEqual(['buy', 'split']);
    expect(s.lines[0].shares).toBe(1);
    expect(s.lots[0].shares).toBe(8);
    expect(s.lots[0].basisUsd).toBe(1600);
    expect(s.lots[0].basisPerShareUsd).toBe(200);
    expect(s.totals.marketValueUsd).toBe(1680);
    expect(s.totals.incomeUsd).toBe(0);
  });
  it('reads wad strings as exact integers', () => {
    const m = multipliersFromFile(ACTIONS);
    expect(m[SNDK][0].newWad).toBe(8n * 10n ** 18n);
    expect(m[NVDA]).toEqual([]);
    const bad = { ...ACTIONS, tokens: [{ ...ACTIONS.tokens[1], multiplierEvents: [{ ...ACTIONS.tokens[1].multiplierEvents[0], newWad: '8e18' }] }] } as CorporateActionsFile;
    expect(() => multipliersFromFile(bad)).toThrow(/malformed/);
  });
});

describe('shards', () => {
  it('finds a wallet in a plain shard, in any letter case, and says null when it is not published', () => {
    const shard: WalletHistoryShard = { [WALLET]: reported };
    expect(splitSymbols(shard)).toBeNull();
    expect(walletFromShards([shard], WALLET.toUpperCase().replace('0X', '0x'))?.tokens).toHaveLength(1);
    expect(walletFromShards([shard], '0xfd00000000000000000000000000000000000001')).toBeNull();
  });
  it('passes on tooActive, which has no entries', () => {
    const h = walletFromShards([{ [WALLET]: { tokens: [], tooActive: true } }], WALLET);
    expect(h?.tooActive).toBe(true);
    expect(h?.tokens).toEqual([]);
  });
  it('merges the per-token parts of a split shard', () => {
    expect(splitSymbols({ split: true, symbols: ['NVDAc', 'SNDKc', '../x'] })).toEqual(['NVDAc', 'SNDKc']);
    const parts: WalletHistoryShard[] = [
      { [WALLET]: reported },
      { [WALLET]: { tokens: [{ symbol: 'SNDKc', address: SNDK, entries: [e({ block: 9, ts: 900, dir: 'in', raw: '1', counterpartyKind: 'pool' })] }] } },
      {},
    ];
    expect(walletFromShards(parts, WALLET)?.tokens.map((t) => t.symbol)).toEqual(['NVDAc', 'SNDKc']);
  });
});
