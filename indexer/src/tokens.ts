// Token list (Coinbase API), DEX pools + prices (DexScreener), daily price history (GeckoTerminal).
import fs from 'node:fs';
import path from 'node:path';
import { CACHE_DIR, MIN_PAIR_LIQ_USD, UNI_V4_POOL_MANAGER } from './config.ts';
import { sleep } from './rpc.ts';

export interface ApiToken {
  address: string; symbol: string; name: string; logo?: string; decimals: number;
  totalSupply: number | null; multiplier: number; navUsd: number | null; firstMint: string | null;
}

async function getJson(url: string, tries = 5): Promise<any> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'tropa-indexer/1.0' }, signal: AbortSignal.timeout(30_000) });
      if (r.status === 429) { await sleep(5000 * (i + 1)); last = new Error('429 ' + url); continue; }
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await r.json();
    } catch (e) { last = e; await sleep(1500 * (i + 1)); }
  }
  throw last;
}

export async function loadApiTokens(): Promise<ApiToken[]> {
  const out: ApiToken[] = [];
  let tok = '';
  for (let page = 0; page < 50; page++) {
    const j = await getJson('https://api.coinbase.com/v1/tokenized-stocks' + (tok ? `?page_token=${encodeURIComponent(tok)}` : ''));
    for (const t of j.tokens || []) {
      out.push({
        address: String(t.contract_address).toLowerCase(), symbol: t.symbol, name: t.name, logo: t.icon_url || undefined,
        decimals: t.decimals ?? 8, totalSupply: t.total_supply ?? null, multiplier: Number(t.multiplier ?? 1),
        navUsd: t.nav_price != null ? Number(t.nav_price) : null, firstMint: t.first_mint_date || null,
      });
    }
    tok = j.next_page_token;
    if (!tok || !(j.tokens || []).length) break;
  }
  const seen = new Set<string>();
  const uniq = out.filter((t) => (seen.has(t.address) ? false : (seen.add(t.address), true)));
  if (uniq.length < 300) throw new Error(`token API returned only ${uniq.length} tokens`);
  return uniq;
}

export interface Pair { pairAddress: string; dexId: string; base: string; quote: string; priceUsd: number | null; liqUsd: number; labels?: string[] }

export async function loadPairs(tokens: string[]): Promise<Pair[]> {
  const seen = new Map<string, Pair>();
  for (const a of tokens) {
    const r = await getJson(`https://api.dexscreener.com/token-pairs/v1/base/${a}`);
    for (const p of r || []) {
      seen.set(p.pairAddress.toLowerCase(), {
        pairAddress: p.pairAddress.toLowerCase(), dexId: p.dexId, base: p.baseToken.address.toLowerCase(), quote: p.quoteToken.address.toLowerCase(),
        priceUsd: p.priceUsd ? Number(p.priceUsd) : null, liqUsd: p.liquidity?.usd ?? 0, labels: p.labels,
      });
    }
    await sleep(250);
  }
  const pairs = [...seen.values()];
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, 'dexscreener_pairs.json'), JSON.stringify(pairs));
  return pairs;
}

export function poolSet(pairs: Pair[]): Set<string> {
  const s = new Set(pairs.filter((p) => p.pairAddress.length === 42).map((p) => p.pairAddress));
  s.add(UNI_V4_POOL_MANAGER);
  return s;
}

// DEX price per raw token unit (already embeds the multiplier): deepest pair with the token as base and >= $1k liquidity.
export function dexPrices(pairs: Pair[]): Map<string, { price: number; pair: string; liq: number }> {
  const m = new Map<string, { price: number; pair: string; liq: number }>();
  for (const p of pairs) {
    if (!p.priceUsd || p.liqUsd < MIN_PAIR_LIQ_USD) continue;
    const cur = m.get(p.base);
    if (!cur || p.liqUsd > cur.liq) m.set(p.base, { price: p.priceUsd, pair: p.pairAddress, liq: p.liqUsd });
  }
  return m;
}

// Fallback for tokens with no DEX pair >= $1k liquidity: underlying stock's last price (Yahoo chart API, keyless) x multiplier.
export async function referencePrices(tokens: ApiToken[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const t of tokens) {
    const ticker = t.symbol.replace(/c$/, '').replace('.', '-');
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1d`, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15_000) });
      const j: any = await r.json();
      const px = j?.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (typeof px === 'number' && px > 0) out.set(t.address, px * (t.multiplier || 1));
      else if (t.navUsd) out.set(t.address, t.navUsd);
    } catch {
      if (t.navUsd) out.set(t.address, t.navUsd);
    }
    await sleep(300);
  }
  return out;
}

// Daily close of the underlying stock (Yahoo chart API) x current multiplier, forward-filled over weekends/holidays,
// for days START..today. Fills cost-basis days that the DEX OHLCV does not cover (deepest pools are often newer than the token).
export async function yahooDaily(tokens: ApiToken[], startDay: number, endDay: number): Promise<Map<string, Map<number, number>>> {
  const out = new Map<string, Map<number, number>>();
  for (const t of tokens) {
    const ticker = t.symbol.replace(/c$/, '').replace('.', '-');
    try {
      const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d`, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20_000) });
      const j: any = await r.json();
      const res = j?.chart?.result?.[0];
      const ts: number[] = res?.timestamp || [];
      const cl: (number | null)[] = res?.indicators?.quote?.[0]?.close || [];
      const byDay = new Map<number, number>();
      ts.forEach((x, i) => { const c = cl[i]; if (c && c > 0) byDay.set(Math.floor(x / 86400), c * (t.multiplier || 1)); });
      if (!byDay.size) continue;
      const m = new Map<number, number>();
      let last: number | null = null;
      const first = Math.min(...byDay.keys());
      for (let d = Math.min(startDay, first); d <= endDay; d++) {
        if (byDay.has(d)) last = byDay.get(d)!;
        if (last !== null && d >= startDay) m.set(d, last);
      }
      out.set(t.address, m);
    } catch (e: any) {
      console.warn(`yahoo daily failed for ${t.symbol}: ${e?.message}`);
    }
    await sleep(300);
  }
  return out;
}

// Daily average price (o+h+l+c)/4 of the deepest pool, keyed by UTC day index. Used for v1 cost basis.
export async function loadDailyPrices(prices: Map<string, { pair: string }>): Promise<Map<string, Map<number, number>>> {
  const out = new Map<string, Map<number, number>>();
  for (const [tok, { pair }] of prices) {
    try {
      const j = await getJson(`https://api.geckoterminal.com/api/v2/networks/base/pools/${pair}/ohlcv/day?limit=1000&currency=usd&token=${tok}`, 4);
      const list: number[][] = j?.data?.attributes?.ohlcv_list || [];
      const m = new Map<number, number>();
      for (const [t, o, h, l, c] of list) if (o > 0 && c > 0) m.set(Math.floor(t / 86400), (o + h + l + c) / 4);
      out.set(tok, m);
    } catch (e: any) {
      console.warn(`ohlcv failed for ${tok}: ${e?.message}`);
    }
    await sleep(2200); // GeckoTerminal public limit ~30/min
  }
  return out;
}
