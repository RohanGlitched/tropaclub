/**
 * "Is this address a pool the indexer knows?" The indexer labels every holder of a stock token, and
 * a DEX pool is labelled 'pool' in wallets/<first two hex>.json. A pool somebody deployed an hour
 * ago to trade with themselves is not there yet.
 *
 * Answers true or false when the file was read, and null when it could not be: the caller then
 * asks the buyer to try again instead of turning a real buy away.
 */
export type PoolCheck = (pool: string, token: { address: string; symbol: string | null }) => Promise<boolean | null>;

type Shard = Record<string, { tokens?: { symbol?: string; kind?: string }[] }>;

export function indexerPoolCheck(opts: { baseUrl?: string; fetchImpl?: typeof fetch; cacheMs?: number } = {}): PoolCheck {
  const base = (opts.baseUrl ?? process.env.DATA_BASE_URL ?? 'https://storage.googleapis.com/tropaclub-data/public').replace(/\/$/, '');
  const cache = new Map<string, { at: number; shard: Shard }>();
  return async (pool, token) => {
    const a = pool.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(a) || !token.symbol) return null;
    const xx = a.slice(2, 4);
    let hit = cache.get(xx);
    if (!hit || Date.now() - hit.at > (opts.cacheMs ?? 5 * 60_000)) {
      try {
        const res = await (opts.fetchImpl ?? fetch)(`${base}/wallets/${xx}.json`, { signal: AbortSignal.timeout(6000) });
        if (!res.ok) return null;
        const shard = (await res.json()) as Shard;
        if (!shard || typeof shard !== 'object') return null;
        hit = { at: Date.now(), shard };
        if (cache.size > 300) cache.clear();
        cache.set(xx, hit);
      } catch {
        return null;
      }
    }
    return !!hit.shard[a]?.tokens?.some((t) => t.symbol === token.symbol && t.kind === 'pool');
  };
}
