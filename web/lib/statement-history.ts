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

const ZERO = '0x0000000000000000000000000000000000000000';
/** Stand-in counterparty for a labelled kind that carries no address. Never shown. */
const KIND_ADDRESS: Record<string, string> = {
  pool: '0x00000000000000000000000000000000000000a1',
  router: '0x00000000000000000000000000000000000000a2',
  distributor: '0x00000000000000000000000000000000000000a3',
};

export const DAY_PRICE_NOTE =
  'Buys and sells on a DEX are priced at that day’s average price, not the exact price paid, and are marked “est.”. Buys made through Tropa Club use the dollars recorded at the time.';

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
}

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
  return { transfers, marks, symbols };
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

/** Say what the estimates are: the engine's wording assumes payment legs were read, and here they were not. */
export function labelDayPrices(s: Statement): Statement {
  let estimated = false;
  for (const l of s.lines) {
    if (l.note.startsWith('paid in another token: cost estimated at the mark')) {
      l.note = 'bought on a DEX: cost estimated at the day’s price';
      estimated = true;
    } else if (l.note.startsWith('sold for another token: proceeds estimated at the mark')) {
      l.note = l.note.replace('sold for another token: proceeds estimated at the mark', 'sold on a DEX: proceeds estimated at the day’s price');
      estimated = true;
    }
  }
  if (estimated && !s.warnings.includes(DAY_PRICE_NOTE)) s.warnings.unshift(DAY_PRICE_NOTE);
  return s;
}
