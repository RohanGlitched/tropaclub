// Stock tokens that track a private company (pre-IPO). The one list: ground pages, the stock
// rankings and quick jump all read it, and show PRE_IPO_TAG plus a line on where the price comes from.
//
// Empty on purpose (checked Nov 22 2026). RESEARCH.md listed ANTc, SPCXc and CBRSc as private
// companies, but all three now trade on Nasdaq: Anthropic (ANT) since Nov 19 2026, SpaceX (SPCX)
// since Jun 12 2026 and Cerebras (CBRS) since May 14 2026 (Yahoo chart API, firstTradeDate), and
// the Coinbase tokenized-stocks API describes no token as private or pre-IPO. Tagging them would be
// false. Add a symbol here (e.g. 'ANTc') only for a token whose company has no public listing.
import type { TokenSummary } from '@shared/types';

export const PRE_IPO: ReadonlySet<string> = new Set<string>([]);

export const PRE_IPO_TAG = 'Tracks a private company (pre-IPO)';

export const isPreIpo = (symbol: string | null | undefined) => !!symbol && PRE_IPO.has(symbol);

/**
 * Where a pre-IPO token's price comes from, in one line, as the index reports it. A private
 * company has no stock-exchange close, so the price is the token's own pool price on Base unless
 * the index says it used a reference price.
 */
export function preIpoPriceNote(t: Pick<TokenSummary, 'symbol' | 'priceUsd' | 'priceSource'>): string {
  if (t.priceUsd == null) return `The company has no public share price, and ${t.symbol} has no liquid pool yet, so it has no price here.`;
  if (t.priceSource === 'reference') return `The company has no public share price or stock-exchange close. ${t.symbol} has no active pool, so the price here is a reference value and only approximate.`;
  return `The company has no public share price or stock-exchange close. The price here is ${t.symbol}’s own trading price in its deepest exchange pool on Base.`;
}
