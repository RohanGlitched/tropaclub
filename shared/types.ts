// Data contracts shared by indexer (writer) and web (reader).
// Files live in the public bucket: https://storage.googleapis.com/tropaclub-data/public/...

export type SeatKind = 'real' | 'dust' | 'farmer' | 'contract' | 'pool';

export interface TokenSummary {
  address: `0x${string}`;
  symbol: string;            // e.g. "NVDAc"
  name: string;              // e.g. "NVIDIA"
  logo?: string;
  priceUsd: number | null;   // DEX price used for $ values
  navUsd: number | null;     // Coinbase API nav_price if present
  multiplier: number;        // ERC-8056 uiMultiplier
  holdersTotal: number;      // nonzero balances ("tickets sold")
  realFans: number;          // >= $10, EOA/smart wallet, not farmer-only ("fans in the ground")
  ghosts: { dust: number; farmerOnly: number; contracts: number };
  attendancePct: number;     // realFans / holdersTotal * 100
  top10SharePct: number;
  top10ShareExPoolsPct: number;
  weeklyBuyers: number;      // last 7d distinct buyer wallets (bots >50 swaps excluded)
  newBuyers7d: number;
  medianWeeklyBuyUsd: number | null;
  hasReferenceMark: boolean; // Chainlink feed or nav_price exists
  // Added by the indexer (optional, additive): where priceUsd came from.
  // 'dex' = deepest DEX pair with >= $1k liquidity; 'reference' = no such pair, underlying stock's last
  // price x multiplier (Yahoo chart API, else nav_price); null = unpriced (all seats usd 0).
  priceSource?: 'dex' | 'reference' | null;
}

export interface IndexFile {
  asOf: string;              // ISO time of the snapshot
  block: number;             // last indexed Base block
  tokens: TokenSummary[];    // sorted by realFans desc
}

export interface Seat {
  a: string;                 // lowercase address
  k: SeatKind;
  usd: number;               // current value at priceUsd
  firstBuy: number | null;   // unix seconds of first inbound transfer
  holdDays: number;          // days of current unbroken nonzero holding
  streakWeeks: number;       // consecutive ISO weeks with a net buy (0 if none)
  entryVsMedianPct: number | null; // avg entry price vs median real-fan entry, % (negative = cheaper)
  heldThroughGap: boolean;   // held across at least one weekend reopen gap
}

export interface TokenSeatsFile {
  asOf: string;
  symbol: string;
  seats: Seat[];             // real fans first in rank order (rank = index+1), then ghosts
}

export type BestStatKey = 'earliest' | 'longestHold' | 'entryVsMedian' | 'heldThroughGap' | 'streak';

export interface WalletTokenEntry {
  symbol: string;
  usd: number;
  kind: SeatKind;
  rank: number | null;       // rank among real fans (null if ghost)
  of: number;                // realFans for that token
  bestStat: { key: BestStatKey; label: string; pct: number } | null; // "top pct%" among real fans
}

export interface WalletSummary {
  tokens: WalletTokenEntry[];
  totalUsd: number;
  firstSeen: number | null;
}

// wallets/<first two hex chars after 0x>.json
export type WalletShard = Record<string, WalletSummary>;

export interface StatsFile {
  asOf: string;
  holdersTotal: number;      // unique nonzero wallets across all tokens
  realWallets: number;       // unique real wallets >= $10 across tokens
  realWallets100: number;
  weeklyBuyers: { weekStart: string; buyers: number; newBuyers: number; medianBuyUsd: number }[];
  tokensMinted: number;
  totalValueUsd: number;
}

// ---------------------------------------------------------------------------------------------
// Wallet B20 transfer history (indexer replay), for the statement page.
// history/<first two hex chars after 0x>.json  -> WalletHistoryShard
// If a shard would exceed ~2 MB gzipped it is split by token:
// history/<xx>.json -> WalletHistorySplitIndex, and history/<xx>/<symbol>.json -> WalletHistoryShard
// holding only that token's entries for the shard's wallets.
// Published wallets: EOA / 7702 / smart wallets holding >= $1 of any stock token now, plus every real fan.
// ---------------------------------------------------------------------------------------------

export type CounterpartyKind =
  | 'pool'        // DEX pool (DexScreener-listed pair or the Uniswap v4 PoolManager)
  | 'router'      // labelled aggregator/router (research-scripts/labels.json)
  | 'distributor' // labelled airdrop/"gifted stock" distributor
  | 'wallet'      // EOA / 7702-delegated EOA / smart wallet
  | 'contract'    // any other contract
  | 'mint'        // from 0x0
  | 'burn';       // to 0x0 or a burn/sink address (0x…dead)

export interface HistoryEntry {
  block: number;
  ts: number;               // unix seconds (block time)
  logIndex: number;         // order inside the block
  dir: 'in' | 'out';
  raw: string;              // raw token amount (8 decimals, NOT multiplier-adjusted), decimal string
  counterpartyKind: CounterpartyKind;
  counterparty?: string;    // lowercase address, only for 'wallet' and 'contract'
  txHash: string;
  // Day mark: USD per raw whole token on that UTC day, so USD value = Number(raw) / 1e8 x priceUsd.
  // "Per raw whole token" already includes the uiMultiplier in force that day (1 raw token = multiplier shares),
  // so per-share price = priceUsd / multiplierAt(ts) and shares = raw / 1e8 x multiplierAt(ts).
  // It is a day mark, not the price this transfer paid (no USDC legs are indexed). null if unknown.
  priceUsd: number | null;
  // Where the mark came from: 'chainlink' = Coinbase Chainlink feed answer at 22:00 UTC (feed updated that day);
  // 'pool' = DEX pool daily average (only on days the feed is frozen and within +-15% of its last answer, or for
  // tokens without a feed when within +-15% of the Yahoo reference); 'carry' = last Chainlink answer carried over a
  // weekend/holiday; 'reference' = no feed and no usable pool: underlying's Yahoo close converted to per-raw-token.
  priceSource?: 'chainlink' | 'pool' | 'carry' | 'reference';
}

export interface WalletHistoryToken {
  symbol: string;
  address: string;
  entries: HistoryEntry[];  // ascending (block, logIndex)
}

export interface WalletHistory {
  tokens: WalletHistoryToken[];
  // true for bot-like wallets with more than 1000 indexed stock-token transfers; tokens is then empty.
  tooActive?: boolean;
}

export type WalletHistoryShard = Record<string, WalletHistory>;

export interface WalletHistorySplitIndex {
  split: true;
  symbols: string[];        // fetch history/<xx>/<symbol>.json for each and merge per wallet
}

// corporate-actions.json: ERC-8056 multiplier changes and Announcement brackets per token, from the replay.
export interface MultiplierEventJson {
  token: string;            // lowercase token address
  kind: 'updated' | 'cancelled';
  oldWad: string;           // 1e18 = 1.0, decimal string; '0' for 'cancelled'
  newWad: string;           // for 'cancelled': the multiplier that was cancelled
  effectiveAt: number;      // unix seconds (for 'cancelled': the effectiveAt that was cancelled)
  blockNumber: number;
  logIndex: number;
  txHash: string;
  ts: number;               // block time of the log
  announcement?: string;    // description of an Announcement in the same tx, if any
}

export interface AnnouncementJson {
  token: string;
  kind: 'Announcement' | 'EndAnnouncement';
  id: string;               // e.g. "<uuid>" or "<uuid>:pre"
  description?: string;
  uri?: string;
  caller?: string;
  blockNumber: number;
  logIndex: number;
  txHash: string;
  ts: number;
}

export interface CorporateActionsFile {
  asOf: string;
  block: number;
  tokens: {
    symbol: string;
    address: string;
    multiplierNow: number;  // Coinbase API multiplier at asOf
    multiplierEvents: MultiplierEventJson[];
    announcements: AnnouncementJson[];
  }[];
}
