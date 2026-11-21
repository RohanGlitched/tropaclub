// One Base mainnet read client for the whole server: keyless public RPCs with fallback.
import 'server-only';
import type { PublicClient } from 'viem';
import { createBaseClient, DEFAULT_RPC_URLS } from '@tropaclub/buy';

let client: PublicClient | null = null;

export function baseClient(): PublicClient {
  if (!client) {
    const first = process.env.BASE_RPC_URL ? [process.env.BASE_RPC_URL] : [];
    client = createBaseClient([...first, ...DEFAULT_RPC_URLS]);
  }
  return client;
}

/** Run a promise with a deadline, so one slow RPC cannot hang a page. */
export function within<T>(p: Promise<T>, ms: number, what = 'request'): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);
}
