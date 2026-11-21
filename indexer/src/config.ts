// Tropa Club indexer configuration. Everything here is public chain data; no secrets.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CACHE_DIR = process.env.CACHE_DIR || path.join(ROOT, 'cache');
export const OUT_DIR = process.env.OUT_DIR || path.join(ROOT, 'out', 'public');
export const DATA_DIR = path.join(ROOT, 'data');

export const BUCKET = process.env.BUCKET || 'tropaclub-data';
export const STATE_PREFIX = 'indexer-state/';
export const PUBLIC_PREFIX = 'public/';
export const CACHE_CONTROL = 'public, max-age=300';

// Block of the first B20 mint (Aug 12 2026 04:35 UTC). Nothing earlier carries stock-token transfers.
export const START_BLOCK = 49_860_000;
// Stay a little behind head so we never index a block that could still reorg.
export const HEAD_LAG_BLOCKS = 150;

export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const ZERO = '0x0000000000000000000000000000000000000000';
export const UNI_V4_POOL_MANAGER = '0x498581ff718922c3f8e6a244956af099b2652b2b';

export interface Provider {
  name: string;
  url: string;
  maxAddr: number;    // max addresses per eth_getLogs
  maxRange: number;   // max blocks per eth_getLogs
  minBlock: number;   // earliest block the endpoint serves (pruned / archive limits)
  conc: number;       // concurrent requests (keep polite)
}

// Measured Nov 22 2026:
// - publicnode: <=10 addresses, <=50k blocks, no archive before ~51.0M.
// - bloXroute: any address count, <=20k results, pruned below 52.5M (returned 0 logs right at the edge, so we start later).
// - Tenderly public gateway: <=1000 blocks without a key, full history.
export const PROVIDERS: Provider[] = [
  { name: 'publicnode', url: 'https://base-rpc.publicnode.com', maxAddr: 10, maxRange: 50_000, minBlock: 51_050_000, conc: 4 },
  { name: 'blxr', url: 'https://base.rpc.blxrbdn.com', maxAddr: 1000, maxRange: 1_000_000, minBlock: 52_700_000, conc: 3 },
  { name: 'tenderly', url: 'https://base.gateway.tenderly.co', maxAddr: 1000, maxRange: 1000, minBlock: 0, conc: 3 },
];
// Point calls (eth_call / eth_getCode / blocks) go here first.
export const CALL_PROVIDERS = ['publicnode', 'blxr', 'tenderly'];

// ---------- classification thresholds (same rules as research-scripts/analyze2.py) ----------
export const REAL_MIN_USD = 10;       // real fan: >= $10 at current DEX price
export const DUST_MAX_USD = 1;        // informational: "dust" in research meant < $1; seats below $10 that are not real are 'dust'
export const BOT_SWAPS_PER_WEEK = 50; // addresses with > 50 swap events in a 7-day window are bots
export const MIN_PAIR_LIQ_USD = 1000; // DEX price comes from the deepest pair with >= $1k liquidity (token as base)

// Sanity checks
export const SUPPLY_TOLERANCE = 0.01;
export const NVDA_REAL_RANGE: [number, number] = [1400, 1900];

// Chainlink feeds that exist on Base (RESEARCH.md); used for hasReferenceMark.
export const CHAINLINK_SYMBOLS = new Set(['AAPLc', 'AMZNc', 'GOOGLc', 'METAc', 'MSFTc', 'MSTRc', 'NVDAc', 'SNDKc', 'SPCXc', 'TSLAc']);
