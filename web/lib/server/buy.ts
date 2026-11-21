// The server half of the buy sheet: which tokens can be bought, and a guarded quote turned into
// wallet calls. Nothing here signs or sends; the visitor's wallet does that.
import 'server-only';
import { erc20Abi, formatUnits, type Address } from 'viem';
import {
  ETH_USD_FEED,
  GuardError,
  NATIVE_ETH,
  STOCK_FEEDS,
  USDC,
  aggregatorV3Abi,
  buildBuyCalls,
  buildSwap,
  getQuote,
  guardMinOut,
  isBuyable,
  type BuyableResult,
} from '@tropaclub/buy';
import { baseClient, within } from './chain';
import { getIndex } from './data';

export type Pay = 'USDC' | 'ETH';
export const PRESETS = [10, 25, 50] as const;

export interface BuyToken {
  address: string;
  symbol: string;
  name: string;
  buyable: boolean;
  /** One plain sentence when it cannot be bought right now. */
  reason: string | null;
  /** Has a live reference price feed. Tokens without one are guarded by the pool average instead. */
  referencePrice: boolean;
  reopenGapRisk: boolean;
}

const memo = new Map<string, { at: number; ttl: number; p: Promise<unknown> }>();
function cached<T>(k: string, ttlMs: number, make: () => Promise<T>): Promise<T> {
  const hit = memo.get(k);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.p as Promise<T>;
  const entry = { at: Date.now(), ttl: ttlMs, p: make() };
  entry.p.catch(() => memo.delete(k));
  if (memo.size > 800) memo.clear();
  memo.set(k, entry);
  return entry.p as Promise<T>;
}

const checkBuyable = (token: string): Promise<BuyableResult> =>
  cached(`ok:${token.toLowerCase()}`, 60_000, () => within(isBuyable(token as Address, { client: baseClient() }), 20_000, 'token check'));

/** The stocks offered in the buy sheet: only tokens that pass isBuyable, checked a few at a time. */
export function listBuyTokens(): Promise<BuyToken[]> {
  return cached('tokens', 5 * 60_000, async () => {
    const { data } = await getIndex();
    const fed = new Set(Object.keys(STOCK_FEEDS).map((a) => a.toLowerCase()));
    const pool = data.tokens.filter((t) => /^0x[0-9a-fA-F]{40}$/.test(t.address) && (t.priceUsd != null || fed.has(t.address.toLowerCase())));
    const pick = [...pool.filter((t) => fed.has(t.address.toLowerCase())), ...pool.filter((t) => !fed.has(t.address.toLowerCase())).slice(0, 14)];
    const out: BuyToken[] = [];
    for (let i = 0; i < pick.length; i += 6) {
      const batch = await Promise.all(
        pick.slice(i, i + 6).map(async (t): Promise<BuyToken> => {
          const base = { address: t.address.toLowerCase(), symbol: t.symbol, name: t.name, referencePrice: fed.has(t.address.toLowerCase()) };
          try {
            const r = await checkBuyable(t.address);
            return { ...base, buyable: r.buyable, reason: r.buyable ? null : r.reason ?? 'Buys are on hold for this stock.', reopenGapRisk: r.reopenGapRisk };
          } catch {
            return { ...base, buyable: false, reason: 'This stock could not be checked just now. Try again in a minute.', reopenGapRisk: false };
          }
        }),
      );
      out.push(...batch);
    }
    return out;
  });
}

export interface QuoteOk {
  ok: true;
  token: string;
  symbol: string;
  pay: Pay;
  usd: number;
  /** Calls for the wallet, in order. Every call already ends in the Builder Code suffix. */
  calls: { to: string; data: string; value: string; label: string }[];
  shares: string; // quoted, as a decimal string of shares
  minShares: string; // the least the router may deliver before the buy is stopped
  pricePerShareUsd: number;
  paying: string; // "10 USDC" / "0.00321 ETH"
  markSource: 'chainlink' | 'nav' | 'twap';
  referencePrice: boolean;
  reopenGapRisk: boolean;
  venues: string[];
  expiresAt: number; // ms
}
export interface QuoteHold {
  ok: false;
  /** One plain sentence. */
  message: string;
  retry: boolean;
}

const hold = (message: string, retry = true): QuoteHold => ({ ok: false, message, retry });

export function quoteBuy(p: { token: string; pay: Pay; usd: number; taker: string }): Promise<QuoteOk | QuoteHold> {
  const key = `q:${p.token.toLowerCase()}:${p.pay}:${p.usd}:${p.taker.toLowerCase()}`;
  return cached(key, 12_000, () => within(makeQuote(p), 30_000, 'quote').catch((e) => hold(friendly(e))));
}

function friendly(e: unknown): string {
  if (e instanceof GuardError) {
    if (e.code === 'NO_MARK') return 'There is no reference price for this stock right now, so buys are on hold.';
    if (e.code === 'QUOTE_BELOW_GUARD') return 'The best price on offer is outside the 1.5% guard right now. Try again in a minute.';
    return 'The price check did not pass, so the buy is on hold.';
  }
  const m = String((e as Error)?.message ?? e);
  if (/timed out/i.test(m)) return 'The quote took too long to arrive. Try again.';
  if (/stale/i.test(m)) return 'The ETH price feed is stale right now. Pay with USDC, or try again shortly.';
  if (/route|no quote|liquidity|not found/i.test(m)) return 'No route was found for this amount right now. Try another amount or try again shortly.';
  return 'The quote could not be made just now. Try again.';
}

async function makeQuote(p: { token: string; pay: Pay; usd: number; taker: string }): Promise<QuoteOk | QuoteHold> {
  const client = baseClient();
  const token = p.token as Address;
  const taker = p.taker as Address;
  const ok = await checkBuyable(p.token);
  if (!ok.buyable) return hold(ok.reason ?? 'Buys are on hold for this stock.', false);

  let sellAmount: bigint;
  if (p.pay === 'USDC') sellAmount = BigInt(p.usd) * 1_000_000n;
  else {
    const r = await client.readContract({ address: ETH_USD_FEED, abi: aggregatorV3Abi, functionName: 'latestRoundData' });
    if (r[1] <= 0n) return hold('The ETH price feed did not answer. Pay with USDC, or try again shortly.');
    sellAmount = (BigInt(p.usd) * 10n ** 26n) / r[1]; // usd * 1e18 * 1e8 / price(1e8)
  }
  const sellToken = p.pay === 'USDC' ? USDC : NATIVE_ETH;

  // the wallet must hold what it pays with: say so before anything is signed
  const balance = p.pay === 'USDC' ? await client.readContract({ address: USDC, abi: erc20Abi, functionName: 'balanceOf', args: [taker] }) : await client.getBalance({ address: taker });
  if (balance < sellAmount) {
    const have = p.pay === 'USDC' ? `${Number(formatUnits(balance, 6)).toFixed(2)} USDC` : `${Number(formatUnits(balance, 18)).toFixed(5)} ETH`;
    return hold(`This wallet holds ${have} on Base, which is less than the $${p.usd} this buy needs${p.pay === 'ETH' ? ' plus network fees' : ''}.`, false);
  }

  const quote = await getQuote({ sellToken: p.pay, buyToken: token, sellAmount, taker });
  const guard = await guardMinOut({ token, quotedOut: quote.amountOut, sellToken, sellAmount }, { client, info: ok.info, mark: ok.mark });
  if (!guard.unitCheck.ok) return hold('The price check did not pass, so the buy is on hold.');
  if (!guard.quoteOk) return hold('The best price on offer is outside the 1.5% guard right now. Try again in a minute.');
  const swap = await buildSwap(quote, { amountOutMin: guard.amountOutMin });
  const allowance = p.pay === 'USDC' ? await client.readContract({ address: USDC, abi: erc20Abi, functionName: 'allowance', args: [taker, swap.to] }) : 0n;
  const calls = buildBuyCalls({ quote, swap, currentAllowance: allowance, sellSymbol: p.pay, buySymbol: ok.symbol });

  const mult = Number((guard.multiplierWad * 1_000_000n) / 10n ** 18n) / 1e6;
  const toShares = (raw: bigint) => (Number(formatUnits(raw, guard.decimals)) * mult).toFixed(6);
  return {
    ok: true,
    token: p.token.toLowerCase(),
    symbol: ok.symbol,
    pay: p.pay,
    usd: p.usd,
    calls: calls.map((c) => ({ to: c.to, data: c.data, value: `0x${c.value.toString(16)}`, label: c.label })),
    shares: toShares(quote.amountOut),
    minShares: toShares(guard.amountOutMin),
    pricePerShareUsd: Number(guard.usdPerShare8) / 1e8,
    paying: p.pay === 'USDC' ? `${p.usd} USDC` : `${Number(formatUnits(sellAmount, 18)).toFixed(5)} ETH`,
    markSource: guard.mark.source,
    referencePrice: p.token.toLowerCase() in STOCK_FEEDS,
    reopenGapRisk: guard.reopenGapRisk,
    venues: quote.venues,
    expiresAt: Date.now() + 25_000,
  };
}
