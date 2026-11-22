// Turns the indexer's published wallet history into what the statement engine reads. Pure, so it
// can be unit-tested. The server side (fetching, caching, fallbacks) is in lib/server/statement.ts.
//
// What the published history is, and is not:
//   - every stock-token transfer of a wallet, in raw token units (8 decimals). Raw units are NOT
//     adjusted for splits or stock dividends: the engine applies the multiplier timeline from
//     corporate-actions.json itself.
//   - a price per entry that is the DAY's average, not what the wallet paid. No payment legs are
//     indexed. So a DEX buy is costed "at the day's price" and marked estimated; only a buy made
//     through Tropa Club (its dollars were recorded) has an exact cost.
import type { CorporateActionsFile, HistoryEntry, WalletHistory, WalletHistoryShard, WalletHistorySplitIndex } from '@shared/types';
import type { HistTransfer, MultiplierEvent, Statement } from '@tropaclub/clubs';
import { fmtDate } from './format';

const ZERO = '0x0000000000000000000000000000000000000000';
/** Stand-in counterparty for a labelled kind that carries no address. Never shown. */
const KIND_ADDRESS: Record<string, string> = {
  pool: '0x00000000000000000000000000000000000000a1',
  router: '0x00000000000000000000000000000000000000a2',
  distributor: '0x00000000000000000000000000000000000000a3',
};

export const DAY_PRICE_NOTE =
  'Buys and sells on an exchange (DEX) are priced at that day’s price, not the exact price paid, and are marked “est.” with where the price came from: a Chainlink close, a pool average, the last close or a reference price. Buys made through Tropa Club use the dollars recorded at the time.';

const isSplitIndex = (v: unknown): v is WalletHistorySplitIndex => !!v && typeof v === 'object' && (v as { split?: unknown }).split === true && Array.isArray((v as { symbols?: unknown }).symbols);

/** The token files to fetch when a shard was split by token, else null. */
export function splitSymbols(shard: unknown): string[] | null {
  return isSplitIndex(shard) ? shard.symbols.filter((s) => typeof s === 'string' && /^[A-Za-z0-9._-]{1,20}$/.test(s)) : null;
}

/** One wallet's history out of a shard, or out of the per-token parts of a split shard. */
export function walletFromShards(parts: (WalletHistoryShard | null | undefined)[], wallet: string): WalletHistory | null {
  const w = wallet.toLowerCase();
  let found: WalletHistory | null = null;
  for (const part of parts) {
    const h = part?.[w];
    if (!h || typeof h !== 'object') continue;
    found ??= { tokens: [] };
    if (h.tooActive) found.tooActive = true;
    for (const t of Array.isArray(h.tokens) ? h.tokens : []) found.tokens.push(t);
  }
  return found;
}

const validEntry = (e: HistoryEntry) =>
  !!e && Number.isFinite(e.block) && Number.isFinite(e.ts) && Number.isFinite(e.logIndex) && (e.dir === 'in' || e.dir === 'out') && typeof e.raw === 'string' && /^\d+$/.test(e.raw) && typeof e.txHash === 'string';

export interface IndexedHistory {
  transfers: HistTransfer[];
  /** Day price per raw whole token, by `${token}|${unix seconds}`. */
  marks: Map<string, number>;
  symbols: Map<string, string>;
  /** Where each entry's day price came from, by `${token}|${txHash}` (the indexer's priceSource). */
  priceSources: Map<string, PriceSourceKind>;
}

export type PriceSourceKind = NonNullable<HistoryEntry['priceSource']>;
/** The small label shown next to an estimated basis or proceeds, by the price's source. */
export const PRICE_SOURCE_LABEL: Record<PriceSourceKind, string> = {
  chainlink: 'est. at Chainlink close',
  pool: 'est. at pool average',
  carry: 'est. at last close',
  reference: 'est. at reference price',
};

/**
 * History entries as engine transfers. No payment legs exist, so the kind of counterparty decides
 * how a movement reads:
 *   in  from a pool or router   -> a buy, cost estimated at the day's price
 *   in  from a mint             -> minted (basis unknown)
 *   in  from anything else      -> received (basis unknown): a gift, a transfer, an unlabelled contract
 *   out to a pool or router     -> a sale, proceeds estimated at the day's price
 *   out to a burn               -> redeemed
 *   out to anything else        -> sent
 * Throws on a malformed entry: a statement is never built from part of a history.
 */
export function transfersFromHistory(h: WalletHistory): IndexedHistory {
  const marks = new Map<string, number>();
  const symbols = new Map<string, string>();
  const priceSources = new Map<string, PriceSourceKind>();
  const rows: { token: string; e: HistoryEntry }[] = [];
  for (const t of h.tokens) {
    const token = String(t.address).toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(token)) throw new Error(`history: bad token address for ${t.symbol}`);
    symbols.set(token, t.symbol);
    for (const e of t.entries) {
      if (!validEntry(e)) throw new Error(`history: malformed entry for ${t.symbol}`);
      rows.push({ token, e });
    }
  }
  rows.sort((a, b) => a.e.block - b.e.block || a.e.logIndex - b.e.logIndex);
  const transfers = rows.map(({ token, e }, i): HistTransfer => {
    const traded = e.counterpartyKind === 'pool' || e.counterpartyKind === 'router';
    if (typeof e.priceUsd === 'number' && isFinite(e.priceUsd) && e.priceUsd > 0) marks.set(`${token}|${e.ts}`, e.priceUsd);
    if (e.priceSource && e.priceSource in PRICE_SOURCE_LABEL) priceSources.set(`${token}|${e.txHash.toLowerCase()}`, e.priceSource);
    return {
      token,
      dir: e.dir,
      raw: BigInt(e.raw),
      t: e.ts,
      blockNumber: e.block,
      txHash: e.txHash.toLowerCase(),
      // position in the whole history: two blocks can share a second, and the engine orders by time then this
      logIndex: i,
      counterparty: e.counterpartyKind === 'mint' || e.counterpartyKind === 'burn' ? ZERO : (e.counterparty ?? KIND_ADDRESS[e.counterpartyKind] ?? KIND_ADDRESS.distributor).toLowerCase(),
      legs: { paidUsd: null, receivedUsd: null, otherOut: traded && e.dir === 'in', otherIn: traded && e.dir === 'out' },
    };
  });
  return { transfers, marks, symbols, priceSources };
}

/** corporate-actions.json as the engine's multiplier events, by lowercase token address. */
export function multipliersFromFile(file: CorporateActionsFile): Record<string, MultiplierEvent[]> {
  const out: Record<string, MultiplierEvent[]> = {};
  for (const t of file.tokens) {
    const token = String(t.address).toLowerCase();
    out[token] = (t.multiplierEvents ?? []).map((m) => {
      if ((m.kind !== 'updated' && m.kind !== 'cancelled') || !/^\d+$/.test(m.oldWad) || !/^\d+$/.test(m.newWad)) throw new Error(`corporate actions: malformed multiplier event for ${t.symbol}`);
      return { token, kind: m.kind, oldWad: BigInt(m.oldWad), newWad: BigInt(m.newWad), effectiveAt: m.effectiveAt, blockNumber: m.blockNumber, logIndex: m.logIndex, txHash: m.txHash, announcement: m.announcement };
    });
  }
  return out;
}

/** Net raw balance per token that a history adds up to. Negative means the history is incomplete. */
export function netRaw(transfers: HistTransfer[]): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const t of transfers) out.set(t.token, (out.get(t.token) ?? 0n) + (t.dir === 'in' ? t.raw : -t.raw));
  return out;
}

/**
 * Say what the estimates are: the engine's wording assumes payment legs were read, and here they
 * were not. With the indexer's price sources, each estimate also says where its price came from.
 */
export function labelDayPrices(s: Statement, priceSources?: Map<string, PriceSourceKind>): Statement {
  let estimated = false;
  const label = (l: Statement['lines'][number]) => {
    const src = l.txHash ? priceSources?.get(`${l.token.toLowerCase()}|${l.txHash.toLowerCase()}`) : undefined;
    return src ? ` · ${PRICE_SOURCE_LABEL[src]}` : '';
  };
  for (const l of s.lines) {
    if (l.note.startsWith('paid in another token: cost estimated at the mark')) {
      l.note = `bought on a DEX: cost estimated at the day’s price${label(l)}`;
      estimated = true;
    } else if (l.note.startsWith('sold for another token: proceeds estimated at the mark')) {
      l.note = `${l.note.replace('sold for another token: proceeds estimated at the mark', 'sold on a DEX: proceeds estimated at the day’s price')}${label(l)}`;
      estimated = true;
    }
  }
  if (estimated && !s.warnings.includes(DAY_PRICE_NOTE)) s.warnings.unshift(DAY_PRICE_NOTE);
  return s;
}

/** The statement's own label ("FIFO · USD · records, not tax advice"), in words. */
export const STATEMENT_LABEL_TEXT = 'First in, first out. In US dollars. A record, not tax advice.';

/**
 * A statement line's note in plain words, for the page only (the stored statement and its CSV keep
 * the engine's wording). Field names such as "effectiveAt" never reach the page: a date does.
 * `t` is the line's time in unix seconds.
 */
export function readableNote(note: string, t: number): string {
  return note
    .replace('new lot at fair value (mark at effectiveAt)', `added at that day’s value (${fmtDate(t)})`)
    .replace(/shares ×([\d.]+), basis reallocated over the new share count \(total basis unchanged\)/, 'share equivalent ×$1; your total cost doesn’t change')
    .replace('paid in another token: cost estimated at the mark', 'bought with another token: cost estimated at the market price then')
    .replace('sold for another token: proceeds estimated at the mark', 'sold for another token: proceeds estimated at the market price then')
    .replace(' · confirmed by announcement', '. Confirmed by the issuer’s announcement')
    .replace(/, ratio wins$/, ', so the token’s own ratio is used');
}

/**
 * Where "Worth now" comes from, per held token: the index's live price for the count (the
 * statement values today's lots at that price; see web/lib/server/statement.ts), labelled by the
 * index's priceSource. null means the index had no price, so the statement fell back to its own
 * marks (Chainlink first, then a recorded price).
 */
export type NowPriceSource = 'dex' | 'reference' | null;
const NOW_LABEL: Record<'dex' | 'reference' | 'none', string> = {
  dex: 'exchange pool price on Base',
  reference: 'reference price (the share’s last price times the token’s multiplier)',
  none: 'Chainlink price, or the last recorded price',
};

/** "Priced at the exchange pool price on Base (NVDAc, TSLAc), as counted 22 Nov 2026, 06:18 UTC." */
export function worthNowSource(symbols: string[], sources: Record<string, NowPriceSource>, countedAt: string | number | null | undefined): string | null {
  const held = [...new Set(symbols)];
  if (!held.length) return null;
  const groups = new Map<keyof typeof NOW_LABEL, string[]>();
  for (const sym of held) {
    const k = sym in sources ? (sources[sym] ?? 'none') : 'none';
    groups.set(k, [...(groups.get(k) ?? []), sym]);
  }
  const single = groups.size === 1;
  const parts = [...groups].map(([k, syms]) => (single ? NOW_LABEL[k] : `${NOW_LABEL[k]} (${syms.join(', ')})`));
  const when = countedAt != null ? fmtDate(countedAt, true) : null;
  return `Priced at the ${parts.join('; ')}${when && when !== '—' ? `, as counted ${when}` : ''}.`;
}
