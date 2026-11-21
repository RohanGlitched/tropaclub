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
