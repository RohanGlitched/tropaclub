/**
 * Firestore data model (default database, project project-5523359e-5941-4df4-998).
 *
 * Conventions:
 * - Wallet and token addresses are stored lowercase.
 * - Times are unix seconds (UTC).
 * - Raw token amounts are decimal strings (B20 tokens have 8 decimals; bigint does not survive Firestore).
 * - A member's country is NEVER stored. Pick-up matching keeps only a salted hash of it in the
 *   server-only queue, and the queue entry is deleted when the wallet is seated.
 */

export type ClubKind = 'private' | 'pickup' | 'stock';
export type SeatKind = 'bench' | 'playing';

export const COL = {
  clubs: 'clubs', // public read (no invite code inside)
  clubSecrets: 'clubSecrets', // server only: invite code, pick-up matching key
  invites: 'invites', // server only: code -> clubId
  members: 'members', // server only (wallet <-> group-chat link)
  wallets: 'wallets', // server only: funding source, counters
  buys: 'buys', // server only, doc id = tx hash (dedupe)
  buyRejects: 'buyRejects', // server only: rejected submissions (for % attributed)
  transfers: 'transfers', // server only: member stock-token movements (sweep + buys)
  callups: 'callups', // server only
  attestations: 'attestations', // server only until sent
  exclusions: 'exclusions', // PUBLIC: founder/test/contest wallets
  marks: 'marks', // public: USD marks captured at closes and buys
  gwResults: 'gwResults', // public aggregates: club score per gameweek
  fixtures: 'fixtures', // public aggregates
  tables: 'tables', // public aggregates: league + supporters tables
  matchQueue: 'matchQueue', // server only: pick-up opt-ins (salted country hash)
  geoLog: 'geoLog', // server only: buy-gate decisions (no wallet, no IP)
  syncState: 'syncState', // server only: sweep cursors
  pendingBuys: 'pendingBuys', // server only: real buys that could not be checked yet; retried by the sweep
  quotes: 'quotes', // server only: quotes the site issued (wallet, token, time), so the sweep counts only buys we quoted
} as const;
export type CollectionName = (typeof COL)[keyof typeof COL];

export interface ClubDoc {
  id: string;
  name: string;
  kind: ClubKind;
  crestSeed: string;
  createdBy: string | null; // wallet, null for system clubs (stock, pick-up)
  createdAt: number;
  /** Region label shown on pick-up clubs ("Latin America"). Never a member's country. */
  regionLabel: string | null;
  stockSymbol: string | null; // stock clubs only
  stockToken: string | null; // stock clubs only
  memberCount: number;
  playingCount: number;
  maxMembers: number;
  status: 'open' | 'forming' | 'full';
  /**
   * Set by the server only (setClubHidden), never from a request: the club is left off every
   * public list. Its members still see it.
   */
  hidden?: boolean;
  hiddenReason?: string | null;
  hiddenAt?: number | null;
}

export interface ClubSecretDoc {
  clubId: string;
  inviteCode: string;
  /** Pick-up clubs: salted country hash (stage 'country') or null, plus the region used to match. */
  matchKey: string | null;
  matchRegion: string | null;
  matchStage: 'country' | 'region' | 'global' | null;
}

export interface InviteDoc {
  code: string;
  clubId: string;
  createdAt: number;
}

export interface MemberDoc {
  id: string; // `${clubId}__${wallet}`
  clubId: string;
  wallet: string;
  seat: SeatKind;
  joinedAt: number;
  optOutMatching: boolean;
  nickname: string | null;
  firstPlayingAt: number | null;
}

export interface WalletDoc {
  wallet: string;
  createdAt: number;
  /** First inbound USDC/ETH sender. undefined = not checked yet, null = none found. */
  fundingSource?: string | null;
  fundingCheckedAt?: number | null;
  firstQualifyingBuyAt: number | null;
  qualifyingBuys: number;
}

export type UsdSource = 'usdc' | 'weth' | 'eth' | 'mark';

export interface BuyDoc {
  txHash: string; // doc id
  wallet: string;
  clubId: string | null;
  token: string;
  symbol: string | null;
  rawAmount: string;
  usdIn: number | null;
  usdSource: UsdSource | null;
  /**
   * USD per whole raw token (10^8 raw units) that club returns start from: the MARK at the buy's
   * block, never the fill. A fill is something a buyer can arrange; the mark is not.
   */
  priceAtBuy: number | null;
  /** USD per whole raw token the buyer actually paid (usdIn / tokens). Within 3% of the mark, or the buy was refused. */
  fillPrice?: number | null;
  /** Where the mark came from, e.g. "chainlink". */
  markSource?: string | null;
  /**
   * The receipt showed our swap: the pinned router's Swapped log for this wallet, payment leaving
   * the wallet, the stock coming out of a real Aerodrome pool, at a price within 3% of the mark.
   * Only such buys are recorded; a record without it never counts.
   */
  verified?: boolean;
  blockNumber: number;
  blockTime: number;
  attributed: boolean;
  codes: string[];
  via: 'tx' | 'userop' | 'none';
  /** Counts for lineup / seat / streak: attributed, >= $5, not wash, wallet not excluded. */
  qualifies: boolean;
  wash: boolean;
  excluded: boolean;
  /** Wallet's balance of this token just before its first Tropa buy of it (outside lot at the head of FIFO). */
  priorBalanceRaw: string | null;
  gw: string | null;
  recordedAt: number;
  source: 'client' | 'sweep';
  notes: string[];
  /** The buyer's own "I am not a US person" tick, when the buy came through the buy sheet. */
  notUsCertified?: boolean;
}

export type BuyRejectReason =
  | 'duplicate'
  | 'not_found'
  | 'reverted'
  | 'not_attributed'
  | 'not_from_wallet'
  | 'no_stock_received'
  | 'not_router_swap'
  | 'payment_mismatch'
  | 'not_from_pool'
  | 'price_off_mark'
  | 'cannot_verify_now'
  | 'not_quoted'
  | 'not_member'
  | 'region_blocked';

export interface BuyRejectDoc {
  txHash: string;
  wallet: string;
  reason: BuyRejectReason;
  attributed: boolean | null;
  at: number;
  /** What exactly failed, for whoever reads the log. */
  detail?: string;
}

/** A buy that went through on chain but could not be checked yet (no usable mark, for one). */
export interface PendingBuyDoc {
  txHash: string;
  wallet: string;
  clubId: string | null;
  firstAt: number;
  lastAt: number;
  attempts: number;
  why: string;
  /** 'client': the buyer recorded it through the site (region gate and US self-certification passed). */
  source?: 'client' | 'sweep';
  /** Not tried again before this time (backoff). */
  nextAt?: number;
}

/** A quote the site issued after the region gate and the not-a-US-person answer. */
export interface QuoteDoc {
  id: string;
  wallet: string;
  token: string;
  at: number;
  usd: number;
}

export interface TransferDoc {
  id: string; // `${txHash}_${logIndex}`
  wallet: string;
  token: string;
  dir: 'in' | 'out';
  raw: string;
  blockNumber: number;
  blockTime: number;
  txHash: string;
  logIndex: number;
  counterparty: string;
  /** Inbound leg of a recorded Tropa buy. */
  tropa: boolean;
}

export interface CallupDoc {
  id: string;
  clubId: string;
  gw: string;
  from: string;
  to: string;
  createdAt: number;
}

export type PennantKind = 'founders' | 'champion';

export interface AttestationDoc {
  id: string;
  kind: PennantKind;
  recipient: string;
  clubId: string | null;
  gw: string | null;
  schemaUid: string;
  data: string;
  to: string; // EAS predeploy
  calldata: string; // attest(...) + ERC-8021 suffix
  status: 'pending' | 'sent' | 'failed';
  txHash: string | null;
  createdAt: number;
}

export interface ExclusionDoc {
  wallet: string;
  label: string; // "founder", "test", "contest entrant"
  reason: string;
  addedAt: number;
}

export interface MarkDoc {
  id: string; // `${token}_${t}`
  token: string;
  t: number;
  usd: number; // USD per whole raw token
  source: string;
}

/** Public docs show a short address ("0x12ab…cd34") or nickname, never the full wallet. */
export interface TopScorer {
  who: string;
  nickname: string | null;
  returnPct: number;
}

export interface LineupEntry {
  who: string;
  nickname: string | null;
  seat: SeatKind;
  /** Bought >= $5 inside this gameweek's buy window (up to the cut). */
  played: boolean;
  /** GW-to-date time-weighted return of Tropa lots in percent (playing members only; status, never a prize). */
  returnPct: number | null;
  streak: number;
}

export interface GwClubResultDoc {
  id: string; // `${gw}__${clubId}`
  gw: string;
  clubId: string;
  kind: ClubKind;
  members: number;
  played: number;
  participationPct: number;
  /** Median playing-member return in percent, null when nobody played. */
  score: number | null;
  bonus: boolean;
  topScorer: TopScorer | null;
  lineup: LineupEntry[];
  /** Active payday streaks among members (Supporters table input). */
  activeStreaks: number;
  cutAt: number;
  /** True once the gameweek's final cut has been scored. */
  final: boolean;
  computedAt: number;
}

export interface FixtureDoc {
  id: string; // `${gw}__${home}__${away|bye}`
  gw: string;
  band: string;
  home: string;
  away: string | null; // null = bye
  homeScore: number | null;
  awayScore: number | null;
  result: 'home' | 'away' | 'draw' | 'pending' | 'bye' | 'void';
  homePoints: number;
  awayPoints: number;
  homeBonus: boolean;
  awayBonus: boolean;
  settled: boolean;
  settledAt: number | null;
}

export interface QueueDoc {
  wallet: string;
  /** HMAC(salt, country). The country itself is never stored. */
  countryKey: string;
  region: string;
  queuedAt: number;
  fundingSource: string | null;
}

export interface GeoLogDoc {
  at: number;
  country: string | null;
  decision: 'allow' | 'block';
  reason: string;
  surface: string;
}

export interface SyncStateDoc {
  id: string;
  lastBlock: number;
  updatedAt: number;
}
