// The buy-check side's Base read client (quotes, attribution, sign-in): every keyless public node,
// in a fixed order with retries and timeouts, BASE_RPC_URL first if it is ever set. Statements use
// a client of their own (lib/server/statement.ts), so they can never queue in front of a buy check.
import 'server-only';
import type { PublicClient } from 'viem';
import { baseRpcUrls, createBaseClient } from '@tropaclub/clubs';

let client: PublicClient | null = null;

export function baseClient(): PublicClient {
  return (client ??= createBaseClient(baseRpcUrls()));
}

/** Run a promise with a deadline, so one slow RPC cannot hang a page. */
export function within<T>(p: Promise<T>, ms: number, what = 'request'): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${what} timed out`)), ms))]);
}
