/** Dependencies shared by every service function. createClubsService() builds one of these. */
import type { ChainReader } from './chain/types';
import type { FundingSourceResolver } from './funding';
import { type GeoPolicy, createGeoPolicy } from './geo';
import type { WalletHistorySource } from './history';
import type { PriceSource } from './prices';
import type { DocStore } from './store/docstore';
import { ClubsError, nowSec } from './util';

export interface ClubsConfig {
  siteUrl: string;
  /** Minimum USD for a buy to count (seat, lineup, streak). */
  minBuyUsd: number;
  /** HMAC salt for the pick-up queue's country key (env PICKUP_MATCH_SALT). */
  matchSalt: string;
  /** Known stock tokens (lowercase address -> symbol), e.g. from the indexer's index.json. */
  tokens: Map<string, string>;
  maxPrivateMembers: number;
  pickupSize: number;
  pickupPlaysAt: number;
}

export interface ClubsContext {
  store: DocStore;
  chain?: ChainReader;
  prices?: PriceSource;
  history?: WalletHistorySource;
  funding?: FundingSourceResolver;
  geo: GeoPolicy;
  now: () => number;
  config: ClubsConfig;
}

export function defaultConfig(over: Partial<ClubsConfig> = {}): ClubsConfig {
  return {
    siteUrl: (process.env.SITE_URL ?? 'https://tropaclub.xyz').replace(/\/$/, ''),
    // $5 puts a member in the Playing lineup for the gameweek. (The index's "real fan" line stays at $10 held.)
    minBuyUsd: 5,
    matchSalt: process.env.PICKUP_MATCH_SALT ?? 'dev-only-salt',
    tokens: new Map(),
    maxPrivateMembers: 50,
    pickupSize: 5,
    pickupPlaysAt: 3,
    ...over,
  };
}

export function makeContext(p: Partial<ClubsContext> & { store: DocStore }): ClubsContext {
  return { geo: createGeoPolicy(), now: nowSec, config: defaultConfig(), ...p };
}

export function need<T>(v: T | undefined, what: string): T {
  if (!v) throw new ClubsError('not_configured', `${what} is not configured`, 500);
  return v;
}
