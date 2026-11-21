// Two rules that keep a statement honest. Pure, so they can be unit-tested.

/** First block that can hold a stock-token transfer (first mint, 12 Aug 2026). */
export const HISTORY_START_BLOCK = 49_860_000n;

/**
 * The block to read a wallet's history from: always the first stock-token block.
 *
 * An earlier version guessed a later block from the wallet's "first seen" time at two seconds a
 * block. Base makes blocks much faster than that, so the guess landed weeks too late, the buys
 * were never read, and the statement showed zeros for a wallet that plainly holds tokens. Block
 * numbers are never estimated from time now. (Where a public node will not serve the oldest
 * blocks, the server finds the oldest block it does serve and adds an opening lot: see
 * openingBalances and lib/server/statement.ts.)
 */
export function historyFromBlock(): bigint {
  return HISTORY_START_BLOCK;
}

export class HistoryIncomplete extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HistoryIncomplete';
  }
}

/**
 * The index says what the wallet holds now. A statement that disagrees is wrong, not empty:
 * if the wallet holds a token worth something and the statement has no open lot of it, the
 * history was not fully read. Throw, so the page says "could not read" instead of printing zeros.
 */
export function assertMatchesHoldings(held: { token: string; symbol: string; usd: number }[], openLots: { token: string }[]): void {
  const open = new Set(openLots.map((l) => l.token.toLowerCase()));
  const missing = held.filter((h) => h.usd >= 0.01 && !open.has(h.token.toLowerCase()));
  if (missing.length) throw new HistoryIncomplete(`history incomplete: the index shows ${missing.map((m) => m.symbol).join(', ')} held, but no open lot was found`);
}

/**
 * What a wallet held before the first block that could be read: its balance now, minus everything
 * that came in since, plus everything that went out since. Tokens with nothing left over are omitted.
 */
export function openingBalances(now: Map<string, bigint>, since: { token: string; dir: 'in' | 'out'; raw: bigint }[]): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const [token, bal] of now) {
    let open = bal;
    for (const t of since) if (t.token.toLowerCase() === token.toLowerCase()) open += t.dir === 'in' ? -t.raw : t.raw;
    if (open > 0n) out.set(token.toLowerCase(), open);
  }
  return out;
}
