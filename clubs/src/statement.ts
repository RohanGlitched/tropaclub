/**
 * Cost basis & P&L statement for any wallet. FIFO · USD · records, not tax advice.
 *
 * Units: lots are tracked in RAW token units (B20, 8 decimals). Under ERC-8056 a corporate action changes
 * the uiMultiplier, not raw balances; shares = raw x multiplier. Marks are USD per whole raw token.
 *
 * Multiplier changes are classified by RATIO FIRST (SPEC v3.2 #2); an Announcement description only
 * confirms the call:
 * - whole-number ratio >= 2 (or a whole-number reverse ratio) -> split: basis reallocated over the new
 *   share count, total basis unchanged, no income;
 * - increase under 5% -> stock dividend: the new shares become an income line and a new lot at fair value
 *   (mark at effectiveAt). In raw terms, each open lot gives up raw x (new - old) / new to the dividend lot;
 * - anything else -> "unclassified (shown both ways)": primary view as a split, alternate totals as a dividend.
 * Lots are dated at effectiveAt; UIMultiplierUpdateCancelled removes the matching scheduled change; changes
 * not yet effective are listed as pending. Transferred-in lots have "basis unknown".
 */
import type { HistTransfer, MultiplierEvent } from './history';

export const STATEMENT_LABEL = 'FIFO · USD · records, not tax advice';
export const WAD = 10n ** 18n;
const ZERO = '0x0000000000000000000000000000000000000000';

export type ActionClass = 'split' | 'dividend' | 'unclassified' | 'none';

export function classifyMultiplierChange(oldWad: bigint, newWad: bigint, announcement?: string): { cls: ActionClass; ratio: number; label: string; confirmed: boolean | null } {
  const ratio = Number((newWad * 10n ** 12n) / (oldWad || 1n)) / 1e12;
  const ann = announcement?.toLowerCase() ?? '';
  const says = /split/.test(ann) ? 'split' : /dividend|distribution/.test(ann) ? 'dividend' : null;
  const confirm = (c: ActionClass) => (says ? says === c : null);
  if (newWad === oldWad) return { cls: 'none', ratio: 1, label: 'no change', confirmed: null };
  if (newWad > oldWad && newWad % oldWad === 0n && newWad / oldWad >= 2n) {
    const k = Number(newWad / oldWad);
    return { cls: 'split', ratio, label: `${k}-for-1 split`, confirmed: confirm('split') };
  }
  if (newWad < oldWad && oldWad % newWad === 0n && oldWad / newWad >= 2n) {
    const k = Number(oldWad / newWad);
    return { cls: 'split', ratio, label: `1-for-${k} reverse split`, confirmed: confirm('split') };
  }
  if (ratio > 1 && ratio < 1.05) return { cls: 'dividend', ratio, label: `stock dividend +${((ratio - 1) * 100).toFixed(4)}%`, confirmed: confirm('dividend') };
  return { cls: 'unclassified', ratio, label: `unclassified ×${ratio.toFixed(6)} (shown both ways)`, confirmed: null };
}

export interface EffectiveChange {
  token: string;
  oldWad: bigint;
  newWad: bigint;
  effectiveAt: number;
  txHash: string;
  announcement?: string;
}

/** Apply cancellations; split into effective (<= now) and pending (> now) changes. */
export function effectiveChanges(events: MultiplierEvent[], now: number): { effective: EffectiveChange[]; pending: EffectiveChange[]; cancelled: EffectiveChange[] } {
  const scheduled: EffectiveChange[] = [];
  const cancelled: EffectiveChange[] = [];
  for (const e of [...events].sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex)) {
    if (e.kind === 'updated') scheduled.push({ token: e.token, oldWad: e.oldWad, newWad: e.newWad, effectiveAt: e.effectiveAt, txHash: e.txHash, announcement: e.announcement });
    else {
      for (let i = scheduled.length - 1; i >= 0; i--) {
        const s = scheduled[i]!;
        if (s.newWad === e.newWad && s.effectiveAt === e.effectiveAt) {
          cancelled.push(s);
          scheduled.splice(i, 1);
          break;
        }
      }
    }
  }
  scheduled.sort((a, b) => a.effectiveAt - b.effectiveAt);
  return { effective: scheduled.filter((s) => s.effectiveAt <= now), pending: scheduled.filter((s) => s.effectiveAt > now), cancelled };
}

export function multiplierAt(changes: EffectiveChange[], t: number): bigint {
  let m = changes[0]?.oldWad ?? WAD;
  for (const c of changes) if (c.effectiveAt <= t) m = c.newWad;
  return m;
}

export type LotOrigin = 'buy' | 'buy_estimated' | 'dividend' | 'transfer_in' | 'mint';

export interface StatementLot {
  id: string;
  token: string;
  symbol: string;
  origin: LotOrigin;
  acquiredAt: number;
  raw: bigint;
  shares: number;
  basisUsd: number | null;
  basisPerShareUsd: number | null;
  marketValueUsd: number | null;
  unrealizedUsd: number | null;
  basisStatus: 'known' | 'estimated' | 'unknown';
  txHash: string | null;
}

export type LineType = 'buy' | 'transfer_in' | 'mint' | 'sell' | 'transfer_out' | 'redeem' | 'split' | 'dividend' | 'unclassified' | 'pending_action';

export interface StatementLine {
  t: number;
  date: string;
  type: LineType;
  token: string;
  symbol: string;
  raw: bigint;
  shares: number;
  costUsd: number | null;
  proceedsUsd: number | null;
  incomeUsd: number | null;
  realizedUsd: number | null;
  basisStatus: 'known' | 'estimated' | 'unknown' | 'n/a';
  txHash: string | null;
  note: string;
}

export interface StatementTotals {
  costBasisOpenUsd: number;
  marketValueUsd: number;
  basisUnknownMarketValueUsd: number;
  unrealizedUsd: number;
  realizedUsd: number;
  incomeUsd: number;
}

export interface Statement {
  wallet: string;
  asOf: number;
  label: string;
  method: { lots: 'FIFO'; currency: 'USD'; unclassifiedPrimaryAs: 'split' | 'dividend' };
  lots: StatementLot[];
  lines: StatementLine[];
  totals: StatementTotals;
  byToken: { token: string; symbol: string; multiplierNow: number; totals: StatementTotals }[];
  /** Present when an unclassified change exists: totals with the other treatment. */
  alternate: { treatUnclassifiedAs: 'split' | 'dividend'; totals: StatementTotals } | null;
  warnings: string[];
}

export interface StatementInput {
  wallet: string;
  transfers: HistTransfer[];
  multipliers: Record<string, MultiplierEvent[]>;
  markAt: (token: string, t: number) => Promise<number | null>;
  now: number;
  symbols?: Map<string, string>;
  /** Exact USD in for buys recorded through Tropa Club (tx hash -> usdIn). */
  tropaBuys?: Map<string, number>;
  treatUnclassifiedAs?: 'split' | 'dividend';
}

interface Lot {
  id: string;
  origin: LotOrigin;
  acquiredAt: number;
  raw: bigint;
  basisUsd: number | null;
  estimated: boolean;
  txHash: string | null;
}

const iso = (t: number) => new Date(t * 1000).toISOString();
const r2 = (x: number | null) => (x == null ? null : Math.round(x * 100) / 100);
const tokensOf = (raw: bigint) => Number(raw) / 1e8;
const sharesOf = (raw: bigint, m: bigint) => (Number(raw) / 1e8) * (Number((m * 10n ** 9n) / WAD) / 1e9);

export async function buildStatement(input: StatementInput): Promise<Statement> {
  const primaryAs = input.treatUnclassifiedAs ?? 'split';
  const primary = await buildOnce(input, primaryAs);
  if (!primary.hasUnclassified) return primary.statement;
  const alt = await buildOnce(input, primaryAs === 'split' ? 'dividend' : 'split');
  return { ...primary.statement, alternate: { treatUnclassifiedAs: primaryAs === 'split' ? 'dividend' : 'split', totals: alt.statement.totals } };
}

async function buildOnce(input: StatementInput, unclassifiedAs: 'split' | 'dividend'): Promise<{ statement: Statement; hasUnclassified: boolean }> {
  const wallet = input.wallet.toLowerCase();
  const warnings: string[] = [];
  const lines: StatementLine[] = [];
  const outLots: StatementLot[] = [];
  const byToken: Statement['byToken'] = [];
  const grand: StatementTotals = { costBasisOpenUsd: 0, marketValueUsd: 0, basisUnknownMarketValueUsd: 0, unrealizedUsd: 0, realizedUsd: 0, incomeUsd: 0 };
  let hasUnclassified = false;
  const tokens = [...new Set(input.transfers.map((t) => t.token))].sort();

  // Aggregate legs per (tx, token, dir): routers often deliver in several Transfer logs.
  type Agg = { token: string; dir: 'in' | 'out'; raw: bigint; t: number; txHash: string; logIndex: number; counterparty: string; legs: HistTransfer['legs'] };
  const aggs = new Map<string, Agg>();
  for (const t of input.transfers) {
    const k = `${t.txHash}|${t.token}|${t.dir}`;
    const a = aggs.get(k);
    if (a) a.raw += t.raw;
    else aggs.set(k, { ...t });
  }
  // Tokens per tx (to split a single payment over several stock tokens by mark value).
  const perTx = new Map<string, Agg[]>();
  for (const a of aggs.values()) perTx.set(`${a.txHash}|${a.dir}`, [...(perTx.get(`${a.txHash}|${a.dir}`) ?? []), a]);
  const share = async (a: Agg): Promise<number> => {
    const group = perTx.get(`${a.txHash}|${a.dir}`)!;
    if (group.length === 1) return 1;
    const vals = await Promise.all(group.map(async (g) => tokensOf(g.raw) * ((await input.markAt(g.token, g.t)) ?? 0)));
    const total = vals.reduce((s, v) => s + v, 0);
    return total > 0 ? vals[group.indexOf(a)]! / total : 1 / group.length;
  };

  for (const token of tokens) {
    const symbol = input.symbols?.get(token) ?? token.slice(0, 10);
    const { effective, pending, cancelled } = effectiveChanges(input.multipliers[token] ?? [], input.now);
    const mNow = multiplierAt(effective, input.now);
    const tot: StatementTotals = { costBasisOpenUsd: 0, marketValueUsd: 0, basisUnknownMarketValueUsd: 0, unrealizedUsd: 0, realizedUsd: 0, incomeUsd: 0 };
    const lots: Lot[] = [];
    let lotSeq = 0;
    const line = (l: Omit<StatementLine, 'date' | 'token' | 'symbol'>) => lines.push({ ...l, date: iso(l.t), token, symbol });

    type Ev = { t: number; order: number; kind: 'change'; c: EffectiveChange } | { t: number; order: number; kind: 'flow'; a: Agg };
    const evs: Ev[] = [
      ...effective.map((c) => ({ t: c.effectiveAt, order: 0, kind: 'change' as const, c })),
      ...[...aggs.values()].filter((a) => a.token === token).map((a) => ({ t: a.t, order: 1, kind: 'flow' as const, a })),
    ].sort((x, y) => x.t - y.t || x.order - y.order || (x.kind === 'flow' && y.kind === 'flow' ? x.a.logIndex - y.a.logIndex : 0));

    for (const ev of evs) {
      if (ev.kind === 'change') {
        const c = ev.c;
        const k = classifyMultiplierChange(c.oldWad, c.newWad, c.announcement);
        const openRaw = lots.reduce((s, l) => s + l.raw, 0n);
        const confirmNote = k.confirmed === false ? ` · announcement says otherwise ("${c.announcement}"), ratio wins` : k.confirmed ? ' · confirmed by announcement' : '';
        if (k.cls === 'none') continue;
        if (k.cls === 'unclassified') hasUnclassified = true;
        const asDividend = k.cls === 'dividend' || (k.cls === 'unclassified' && unclassifiedAs === 'dividend' && c.newWad > c.oldWad);
        if (!asDividend) {
          line({
            t: c.effectiveAt,
            type: k.cls === 'unclassified' ? 'unclassified' : 'split',
            raw: openRaw,
            shares: sharesOf(openRaw, c.newWad),
            costUsd: null,
            proceedsUsd: null,
            incomeUsd: null,
            realizedUsd: null,
            basisStatus: 'n/a',
            txHash: c.txHash,
            note: `${k.label}: shares ×${k.ratio.toFixed(6).replace(/\.?0+$/, '')}, basis reallocated over the new share count (total basis unchanged)${k.cls === 'unclassified' ? ' · primary view treats it as a split' : ''}${confirmNote}`,
          });
          continue;
        }
        let divRaw = 0n;
        for (const l of lots) {
          const d = (l.raw * (c.newWad - c.oldWad)) / c.newWad;
          l.raw -= d;
          divRaw += d;
        }
        if (divRaw === 0n) {
          line({ t: c.effectiveAt, type: k.cls === 'unclassified' ? 'unclassified' : 'dividend', raw: 0n, shares: 0, costUsd: null, proceedsUsd: null, incomeUsd: 0, realizedUsd: null, basisStatus: 'n/a', txHash: c.txHash, note: `${k.label}: no open position` });
          continue;
        }
        const mark = await input.markAt(token, c.effectiveAt);
        const fv = mark == null ? null : tokensOf(divRaw) * mark;
        if (fv == null) warnings.push(`${symbol}: no mark at ${iso(c.effectiveAt)} for the stock dividend; income value unknown`);
        lots.push({ id: `${token}-${++lotSeq}`, origin: 'dividend', acquiredAt: c.effectiveAt, raw: divRaw, basisUsd: fv, estimated: false, txHash: c.txHash });
        if (fv != null) tot.incomeUsd += fv;
        line({
          t: c.effectiveAt,
          type: k.cls === 'unclassified' ? 'unclassified' : 'dividend',
          raw: divRaw,
          shares: sharesOf(divRaw, c.newWad),
          costUsd: r2(fv),
          proceedsUsd: null,
          incomeUsd: r2(fv),
          realizedUsd: null,
          basisStatus: fv == null ? 'unknown' : 'known',
          txHash: c.txHash,
          note: `${k.label}: new lot at fair value (mark at effectiveAt)${k.cls === 'unclassified' ? ' · alternate view treats it as a dividend' : ''}${confirmNote}`,
        });
        continue;
      }

      const a = ev.a;
      const m = multiplierAt(effective, a.t);
      if (a.dir === 'in') {
        let origin: LotOrigin;
        let basis: number | null = null;
        let estimated = false;
        const tropa = input.tropaBuys?.get(a.txHash);
        if (tropa != null) {
          origin = 'buy';
          basis = tropa * (await share(a));
        } else if (a.legs.paidUsd != null) {
          origin = 'buy';
          basis = a.legs.paidUsd * (await share(a));
        } else if (a.legs.otherOut) {
          origin = 'buy_estimated';
          const mk = await input.markAt(token, a.t);
          basis = mk == null ? null : tokensOf(a.raw) * mk;
          estimated = basis != null;
        } else origin = a.counterparty === ZERO ? 'mint' : 'transfer_in';
        lots.push({ id: `${token}-${++lotSeq}`, origin, acquiredAt: a.t, raw: a.raw, basisUsd: basis, estimated, txHash: a.txHash });
        line({
          t: a.t,
          type: origin === 'buy' || origin === 'buy_estimated' ? 'buy' : origin,
          raw: a.raw,
          shares: sharesOf(a.raw, m),
          costUsd: r2(basis),
          proceedsUsd: null,
          incomeUsd: null,
          realizedUsd: null,
          basisStatus: basis == null ? 'unknown' : estimated ? 'estimated' : 'known',
          txHash: a.txHash,
          note:
            origin === 'transfer_in'
              ? 'transferred in: basis unknown'
              : origin === 'mint'
                ? 'minted to this wallet: basis unknown'
                : estimated
                  ? 'paid in another token: cost estimated at the mark'
                  : tropa != null
                    ? 'bought through Tropa Club'
                    : 'bought',
        });
        continue;
      }

      // Outflow: FIFO.
      let kind: 'sell' | 'transfer_out' | 'redeem';
      let proceeds: number | null = null;
      let proceedsEstimated = false;
      if (a.legs.receivedUsd != null) {
        kind = 'sell';
        proceeds = a.legs.receivedUsd * (await share(a));
      } else if (a.legs.otherIn) {
        kind = 'sell';
        const mk = await input.markAt(token, a.t);
        proceeds = mk == null ? null : tokensOf(a.raw) * mk;
        proceedsEstimated = proceeds != null;
      } else kind = a.counterparty === ZERO ? 'redeem' : 'transfer_out';

      let left = a.raw;
      let basisTaken = 0;
      let basisKnown = true;
      while (left > 0n && lots.length) {
        const head = lots[0]!;
        const take = head.raw < left ? head.raw : left;
        const frac = Number(take) / Number(head.raw);
        const pieceBasis = head.basisUsd == null ? null : head.basisUsd * frac;
        if (pieceBasis == null) basisKnown = false;
        else basisTaken += pieceBasis;
        if (head.basisUsd != null) head.basisUsd -= pieceBasis!;
        head.raw -= take;
        left -= take;
        if (head.raw === 0n) lots.shift();
      }
      if (left > 0n) {
        basisKnown = false;
        warnings.push(`${symbol}: ${tokensOf(left)} tokens left the wallet with no matching lot (history before the window?)`);
      }
      const realized = kind === 'sell' && proceeds != null && basisKnown ? proceeds - basisTaken : null;
      if (realized != null) tot.realizedUsd += realized;
      line({
        t: a.t,
        type: kind,
        raw: a.raw,
        shares: sharesOf(a.raw, m),
        costUsd: basisKnown ? r2(basisTaken) : null,
        proceedsUsd: r2(proceeds),
        incomeUsd: null,
        realizedUsd: r2(realized),
        basisStatus: basisKnown ? 'known' : 'unknown',
        txHash: a.txHash,
        note:
          kind === 'transfer_out'
            ? 'transferred out: basis leaves with the tokens, no gain or loss recorded'
            : kind === 'redeem'
              ? 'burned / redeemed: proceeds not visible onchain'
              : `${proceedsEstimated ? 'sold for another token: proceeds estimated at the mark' : 'sold'}${basisKnown ? '' : ' · part of the basis is unknown'}`,
      });
    }

    for (const p of pending)
      line({ t: p.effectiveAt, type: 'pending_action', raw: 0n, shares: 0, costUsd: null, proceedsUsd: null, incomeUsd: null, realizedUsd: null, basisStatus: 'n/a', txHash: p.txHash, note: `scheduled ${classifyMultiplierChange(p.oldWad, p.newWad).label}, not yet effective` });
    for (const c of cancelled)
      line({ t: c.effectiveAt, type: 'pending_action', raw: 0n, shares: 0, costUsd: null, proceedsUsd: null, incomeUsd: null, realizedUsd: null, basisStatus: 'n/a', txHash: c.txHash, note: `cancelled ${classifyMultiplierChange(c.oldWad, c.newWad).label} (UIMultiplierUpdateCancelled): ignored` });

    const markNow = await input.markAt(token, input.now);
    if (markNow == null && lots.length) warnings.push(`${symbol}: no current mark; market value unknown`);
    for (const l of lots) {
      if (l.raw === 0n) continue;
      const shares = sharesOf(l.raw, mNow);
      const mv = markNow == null ? null : tokensOf(l.raw) * markNow;
      const status = l.basisUsd == null ? 'unknown' : l.estimated ? 'estimated' : 'known';
      if (mv != null) {
        tot.marketValueUsd += mv;
        if (l.basisUsd == null) tot.basisUnknownMarketValueUsd += mv;
        else tot.unrealizedUsd += mv - l.basisUsd;
      }
      if (l.basisUsd != null) tot.costBasisOpenUsd += l.basisUsd;
      outLots.push({
        id: l.id,
        token,
        symbol,
        origin: l.origin,
        acquiredAt: l.acquiredAt,
        raw: l.raw,
        shares,
        basisUsd: r2(l.basisUsd),
        basisPerShareUsd: l.basisUsd == null || shares === 0 ? null : Math.round((l.basisUsd / shares) * 1e6) / 1e6,
        marketValueUsd: r2(mv),
        unrealizedUsd: mv == null || l.basisUsd == null ? null : r2(mv - l.basisUsd),
        basisStatus: status,
        txHash: l.txHash,
      });
    }
    const rounded = roundTotals(tot);
    byToken.push({ token, symbol, multiplierNow: Number((mNow * 10n ** 9n) / WAD) / 1e9, totals: rounded });
    for (const k of Object.keys(grand) as (keyof StatementTotals)[]) grand[k] += tot[k];
  }
  lines.sort((a, b) => a.t - b.t || (a.token < b.token ? -1 : 1));
  if (outLots.some((l) => l.basisStatus === 'unknown')) warnings.push('Some lots were transferred in or minted: basis unknown (shown, not counted in P&L).');
  return {
    statement: {
      wallet,
      asOf: input.now,
      label: STATEMENT_LABEL,
      method: { lots: 'FIFO', currency: 'USD', unclassifiedPrimaryAs: unclassifiedAs },
      lots: outLots,
      lines,
      totals: roundTotals(grand),
      byToken,
      alternate: null,
      warnings: [...new Set(warnings)],
    },
    hasUnclassified,
  };
}

function roundTotals(t: StatementTotals): StatementTotals {
  return Object.fromEntries(Object.entries(t).map(([k, v]) => [k, Math.round(v * 100) / 100])) as unknown as StatementTotals;
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV export (owner only: the web route must check the connected wallet signed in). */
export function statementCsv(s: Statement): string {
  const head = ['date', 'type', 'symbol', 'token', 'raw_units', 'shares', 'cost_usd', 'proceeds_usd', 'income_usd', 'realized_pnl_usd', 'basis', 'tx', 'note'];
  const rows = s.lines.map((l) =>
    [l.date, l.type, l.symbol, l.token, l.raw.toString(), l.shares.toFixed(8), l.costUsd, l.proceedsUsd, l.incomeUsd, l.realizedUsd, l.basisStatus, l.txHash, l.note].map(csvCell).join(','),
  );
  const lots = s.lots.map((l) =>
    [new Date(l.acquiredAt * 1000).toISOString(), `open_lot:${l.origin}`, l.symbol, l.token, l.raw.toString(), l.shares.toFixed(8), l.basisUsd, '', '', l.unrealizedUsd, l.basisStatus, l.txHash, `market value ${l.marketValueUsd ?? 'unknown'}`].map(csvCell).join(','),
  );
  return [`# Tropa Club statement for ${s.wallet} as of ${new Date(s.asOf * 1000).toISOString()} · ${s.label}`, head.join(','), ...rows, ...lots].join('\n') + '\n';
}
