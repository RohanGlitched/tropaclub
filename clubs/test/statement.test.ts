import { describe, expect, it } from 'vitest';
import fixture from './fixtures/multipliers-2026-11-22.json';
import type { HistTransfer, MultiplierEvent } from '../src/history';
import { STATEMENT_LABEL, WAD, buildStatement, classifyMultiplierChange, effectiveChanges, multiplierAt, statementCsv } from '../src/statement';
import { TOK, addr, hash } from './helpers';

const t = (s: string) => Date.parse(s) / 1000;
const W = addr(0xabc);
const OTHER = addr(0xdef);
const POOL = addr(0xaa);

let seq = 1;
const xfer = (o: Partial<HistTransfer> & Pick<HistTransfer, 'token' | 'dir' | 'raw' | 't'>): HistTransfer => ({
  blockNumber: 1,
  txHash: hash(seq++),
  logIndex: 0,
  counterparty: POOL,
  legs: { paidUsd: null, receivedUsd: null, otherOut: false, otherIn: false },
  ...o,
});
const upd = (token: string, oldWad: bigint, newWad: bigint, effectiveAt: number, blockNumber = 10, announcement?: string): MultiplierEvent => ({
  token,
  kind: 'updated',
  oldWad,
  newWad,
  effectiveAt,
  blockNumber,
  logIndex: 0,
  txHash: hash(9000 + blockNumber),
  announcement,
});
const wadOf = (m: number) => BigInt(Math.round(m * 1e6)) * 10n ** 12n;

describe('ratio-first classification', () => {
  it('splits, reverse splits, dividends and the rest', () => {
    expect(classifyMultiplierChange(WAD, 8n * WAD)).toMatchObject({ cls: 'split', label: '8-for-1 split' });
    expect(classifyMultiplierChange(8n * WAD, WAD)).toMatchObject({ cls: 'split', label: '1-for-8 reverse split' });
    expect(classifyMultiplierChange(WAD, 1_020_000_000_000_000_000n).cls).toBe('dividend');
    expect(classifyMultiplierChange(WAD, 1_049_999_000_000_000_000n).cls).toBe('dividend');
    expect(classifyMultiplierChange(WAD, 1_050_000_000_000_000_000n).cls).toBe('unclassified');
    expect(classifyMultiplierChange(WAD, 1_500_000_000_000_000_000n).cls).toBe('unclassified'); // 3-for-2 is not whole
    expect(classifyMultiplierChange(WAD, 990_000_000_000_000_000n).cls).toBe('unclassified');
  });
  it('uses the announcement only to confirm; ratio wins on conflict', () => {
    expect(classifyMultiplierChange(WAD, 8n * WAD, '8-for-1 Stock Split').confirmed).toBe(true);
    const c = classifyMultiplierChange(WAD, 1_020_000_000_000_000_000n, 'Stock Split');
    expect(c).toMatchObject({ cls: 'dividend', confirmed: false });
  });
  it('classifies all 12 live tokens with a multiplier above 1 (Coinbase API, Nov 22)', () => {
    expect(fixture.tokens).toHaveLength(12);
    for (const tk of fixture.tokens) {
      const newWad = tk.multiplier === 8 ? 8n * WAD : BigInt(Math.round(tk.multiplier * 1e15)) * 1000n;
      expect(classifyMultiplierChange(WAD, newWad).cls, tk.symbol).toBe(tk.expect);
    }
  });
});

describe('effective changes', () => {
  it('honours UIMultiplierUpdateCancelled and keeps future changes pending', () => {
    const tk = TOK.TSLAc;
    const ev: MultiplierEvent[] = [
      upd(tk, WAD, wadOf(1.01), t('2026-11-10T00:00:00Z'), 1),
      { ...upd(tk, 0n, wadOf(1.01), t('2026-11-10T00:00:00Z'), 2), kind: 'cancelled' },
      upd(tk, WAD, wadOf(1.002), t('2026-11-12T00:00:00Z'), 3),
      upd(tk, wadOf(1.002), wadOf(1.004), t('2026-12-10T00:00:00Z'), 4),
    ];
    const r = effectiveChanges(ev, t('2026-11-22T00:00:00Z'));
    expect(r.cancelled).toHaveLength(1);
    expect(r.effective.map((c) => c.newWad)).toEqual([wadOf(1.002)]);
    expect(r.pending.map((c) => c.newWad)).toEqual([wadOf(1.004)]);
    expect(multiplierAt(r.effective, t('2026-11-11T00:00:00Z'))).toBe(WAD);
    expect(multiplierAt(r.effective, t('2026-11-13T00:00:00Z'))).toBe(wadOf(1.002));
  });
});

describe('statement: SNDKc 8-for-1 split', () => {
  const SPLIT_AT = t('2026-11-20T05:00:00Z');
  const marks: Record<string, number> = { [TOK.SNDKc]: 650 };
  const input = () => ({
    wallet: W,
    transfers: [
      xfer({ token: TOK.SNDKc, dir: 'in', raw: 10_000_000n, t: t('2026-11-10T15:00:00Z'), legs: { paidUsd: 64.9, receivedUsd: null, otherOut: false, otherIn: false } }),
      xfer({ token: TOK.SNDKc, dir: 'in', raw: 1_000_000n, t: t('2026-11-21T10:00:00Z'), counterparty: OTHER }),
      xfer({ token: TOK.SNDKc, dir: 'out', raw: 5_000_000n, t: t('2026-11-22T10:00:00Z'), legs: { paidUsd: null, receivedUsd: 33, otherOut: false, otherIn: false } }),
    ],
    multipliers: { [TOK.SNDKc]: [upd(TOK.SNDKc, WAD, 8n * WAD, SPLIT_AT, 10, '8-for-1 Stock Split')] },
    markAt: async (token: string) => marks[token] ?? null,
    now: t('2026-11-23T00:00:00Z'),
    symbols: new Map([[TOK.SNDKc, 'SNDKc']]),
  });

  it('reallocates basis over 8x the shares, keeps total basis, records no income', async () => {
    const s = await buildStatement(input());
    expect(s.label).toBe(STATEMENT_LABEL);
    expect(s.label).toBe('FIFO · USD · records, not tax advice');
    const split = s.lines.find((l) => l.type === 'split')!;
    expect(split.note).toContain('8-for-1 split');
    expect(split.note).toContain('confirmed by announcement');
    expect(split.shares).toBeCloseTo(0.8, 10); // 0.1 raw tokens x 8
    expect(s.totals.incomeUsd).toBe(0);
    const buy = s.lines.find((l) => l.type === 'buy')!;
    expect(buy.shares).toBeCloseTo(0.1, 10); // pre-split multiplier 1
  });

  it('sells FIFO from the bought lot and leaves the transferred-in lot with basis unknown', async () => {
    const s = await buildStatement(input());
    const sell = s.lines.find((l) => l.type === 'sell')!;
    expect(sell.costUsd).toBeCloseTo(32.45, 2);
    expect(sell.realizedUsd).toBeCloseTo(0.55, 2);
    expect(sell.shares).toBeCloseTo(0.4, 10); // 0.05 raw tokens x 8 after the split
    const bought = s.lots.find((l) => l.origin === 'buy')!;
    expect(bought.raw).toBe(5_000_000n);
    expect(bought.shares).toBeCloseTo(0.4, 10);
    expect(bought.basisUsd).toBeCloseTo(32.45, 2);
    expect(bought.basisPerShareUsd).toBeCloseTo(81.125, 4); // $649 per share pre-split / 8
    expect(bought.marketValueUsd).toBeCloseTo(32.5, 2);
    const transferred = s.lots.find((l) => l.origin === 'transfer_in')!;
    expect(transferred).toMatchObject({ basisStatus: 'unknown', basisUsd: null });
    expect(s.totals).toMatchObject({ costBasisOpenUsd: 32.45, marketValueUsd: 39, basisUnknownMarketValueUsd: 6.5, unrealizedUsd: 0.05, realizedUsd: 0.55, incomeUsd: 0 });
    expect(s.warnings.join(' ')).toContain('basis unknown');
    expect(s.alternate).toBeNull();
  });

  it('exports CSV with the label', async () => {
    const csv = statementCsv(await buildStatement(input()));
    const rows = csv.trim().split('\n');
    expect(rows[0]).toContain('FIFO · USD · records, not tax advice');
    expect(rows[1]).toBe('date,type,symbol,token,raw_units,shares,cost_usd,proceeds_usd,income_usd,realized_pnl_usd,basis,tx,note');
    expect(rows.filter((r) => r.includes(',split,'))).toHaveLength(1);
    expect(rows.filter((r) => r.includes('open_lot:'))).toHaveLength(2);
  });
});

describe('statement: NVDAc stock dividend', () => {
  const DIV_AT = t('2026-11-15T05:00:00Z');
  const NEW = 1_000_537_939_576_369_400n; // 1.0005379395763694
  const base = (extra: HistTransfer[] = []) => ({
    wallet: W,
    transfers: [xfer({ token: TOK.NVDAc, dir: 'in', raw: 100_000_000n, t: t('2026-11-02T15:00:00Z'), legs: { paidUsd: 130, receivedUsd: null, otherOut: false, otherIn: false } }), ...extra],
    multipliers: { [TOK.NVDAc]: [upd(TOK.NVDAc, WAD, NEW, DIV_AT)] },
    markAt: async (_token: string, at: number) => (at >= t('2026-11-22T00:00:00Z') ? 135 : 131),
    now: t('2026-11-23T00:00:00Z'),
    symbols: new Map([[TOK.NVDAc, 'NVDAc']]),
  });
  const divRaw = (100_000_000n * (NEW - WAD)) / NEW;

  it('books an income line and a new lot at fair value; the original lot keeps its basis', async () => {
    const s = await buildStatement(base());
    const div = s.lines.find((l) => l.type === 'dividend')!;
    expect(div.raw).toBe(divRaw);
    expect(div.incomeUsd).toBeCloseTo((Number(divRaw) / 1e8) * 131, 2);
    expect(div.shares).toBeCloseTo(0.000537939576, 6); // the new shares
    const orig = s.lots.find((l) => l.origin === 'buy')!;
    const dl = s.lots.find((l) => l.origin === 'dividend')!;
    expect(orig.raw + dl.raw).toBe(100_000_000n);
    expect(orig.basisUsd).toBe(130);
    expect(orig.shares).toBeCloseTo(1, 6); // the original share count is unchanged
    expect(dl.acquiredAt).toBe(DIV_AT);
    expect(s.totals.incomeUsd).toBeCloseTo((Number(divRaw) / 1e8) * 131, 2);
    expect(s.totals.marketValueUsd).toBeCloseTo(135, 2);
    expect(s.totals.costBasisOpenUsd).toBeCloseTo(130 + (Number(divRaw) / 1e8) * 131, 2);
  });

  it('a later sale consumes the original lot first (FIFO)', async () => {
    const s = await buildStatement(base([xfer({ token: TOK.NVDAc, dir: 'out', raw: 50_000_000n, t: t('2026-11-20T15:00:00Z'), legs: { paidUsd: null, receivedUsd: 66, otherOut: false, otherIn: false } })]));
    const sell = s.lines.find((l) => l.type === 'sell')!;
    const origRaw = 100_000_000n - divRaw;
    expect(sell.costUsd).toBeCloseTo((130 * 50_000_000) / Number(origRaw), 2);
    expect(s.lots.find((l) => l.origin === 'dividend')!.raw).toBe(divRaw);
  });
});

describe('statement: unclassified change is shown both ways (PMc)', () => {
  it('primary view as a split, alternate totals as a dividend', async () => {
    const PM = '0xb2000000000000000000008fc2a8c23cf5937b66';
    const s = await buildStatement({
      wallet: W,
      transfers: [xfer({ token: PM, dir: 'in', raw: 100_000_000n, t: t('2026-10-01T15:00:00Z'), legs: { paidUsd: 100, receivedUsd: null, otherOut: false, otherIn: false } })],
      multipliers: { [PM]: [upd(PM, WAD, 1_558_821_201_905_387_000n, t('2026-10-20T05:00:00Z'))] },
      markAt: async () => 150,
      now: t('2026-11-23T00:00:00Z'),
    });
    expect(s.lines.find((l) => l.type === 'unclassified')!.note).toContain('shown both ways');
    expect(s.totals.incomeUsd).toBe(0);
    expect(s.alternate?.treatUnclassifiedAs).toBe('dividend');
    expect(s.alternate!.totals.incomeUsd).toBeGreaterThan(50);
    expect(s.alternate!.totals.marketValueUsd).toBe(s.totals.marketValueUsd);
  });

  it('a cancelled change is ignored and a scheduled one is listed as pending', async () => {
    const tk = TOK.TSLAc;
    const s = await buildStatement({
      wallet: W,
      transfers: [xfer({ token: tk, dir: 'in', raw: 100_000_000n, t: t('2026-11-01T15:00:00Z'), legs: { paidUsd: 400, receivedUsd: null, otherOut: false, otherIn: false } })],
      multipliers: {
        [tk]: [upd(tk, WAD, wadOf(1.01), t('2026-11-10T00:00:00Z'), 1), { ...upd(tk, 0n, wadOf(1.01), t('2026-11-10T00:00:00Z'), 2), kind: 'cancelled' }, upd(tk, WAD, wadOf(1.003), t('2026-12-10T00:00:00Z'), 3)],
      },
      markAt: async () => 410,
      now: t('2026-11-23T00:00:00Z'),
    });
    expect(s.totals.incomeUsd).toBe(0);
    expect(s.lines.filter((l) => l.type === 'pending_action').map((l) => l.note.split(' ')[0])).toEqual(['cancelled', 'scheduled']);
  });

  it('uses the exact Tropa usdIn and estimates cost when paid in another token', async () => {
    const tk = TOK.NVDAc;
    const a = xfer({ token: tk, dir: 'in', raw: 10_000_000n, t: t('2026-11-25T15:00:00Z') });
    const b = xfer({ token: tk, dir: 'in', raw: 10_000_000n, t: t('2026-11-26T15:00:00Z'), legs: { paidUsd: null, receivedUsd: null, otherOut: true, otherIn: false } });
    const s = await buildStatement({ wallet: W, transfers: [a, b], multipliers: {}, markAt: async () => 130, now: t('2026-11-27T00:00:00Z'), tropaBuys: new Map([[a.txHash, 13.07]]) });
    const buys = s.lines.filter((l) => l.type === 'buy');
    expect(buys[0]).toMatchObject({ costUsd: 13.07, basisStatus: 'known', note: 'bought through Tropa Club' });
    expect(buys[1]).toMatchObject({ costUsd: 13, basisStatus: 'estimated' });
  });
});
