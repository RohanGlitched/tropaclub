/** What the clubs engine needs from Base. The viem implementation lives in ./viem.ts; tests use fakes. */

export interface RawLog {
  address: string;
  topics: string[];
  data: string;
  logIndex: number;
}

export interface ReceiptLite {
  status: 'success' | 'reverted';
  blockNumber: bigint;
  from: string;
  to: string | null;
  logs: RawLog[];
}

export interface TxLite {
  from: string;
  to: string | null;
  value: bigint;
  input: string;
  blockNumber: bigint | null;
}

export interface AttributionLite {
  attributed: boolean;
  codes: string[];
  via: 'tx' | 'userop' | 'none';
  /** Signer: tx.from, or the ERC-4337 account (UserOperationEvent sender). */
  from?: string;
}

export interface TransferLog {
  token: string;
  from: string;
  to: string;
  value: bigint;
  blockNumber: bigint;
  txHash: string;
  logIndex: number;
}

export interface ChainReader {
  /** @tropaclub/buy verifyAttribution (ERC-8021 suffix on tx input or UserOp callData). */
  verifyAttribution(txHash: string, buyer?: string): Promise<AttributionLite>;
  getReceipt(txHash: string): Promise<ReceiptLite | null>;
  getTransaction(txHash: string): Promise<TxLite | null>;
  getBlockTime(blockNumber: bigint): Promise<number>;
  blockNumber(): Promise<bigint>;
  /** Chainlink ETH/USD (USD per ETH) at or near a block; null if unavailable. */
  ethUsd(blockNumber?: bigint): Promise<number | null>;
  /** balanceOf at a block (needs state for that block; recent blocks only on free RPCs). */
  balanceOf(token: string, wallet: string, blockNumber?: bigint): Promise<bigint | null>;
  /**
   * Is this address a real Aerodrome Slipstream pool: made by one of the known factories, which
   * also names it as the pool for its own token pair and tick spacing? Absent on a reader that
   * cannot tell, and then no buy can be verified.
   */
  isAerodromePool?(address: string): Promise<boolean>;
  /** Transfer logs of the given tokens filtered by from/to wallets (OR within each list). */
  getTransferLogs?(q: { tokens: string[]; from?: string[]; to?: string[]; fromBlock: bigint; toBlock: bigint }): Promise<TransferLog[]>;
}

export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
export const USDC_ADDRESS = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
export const WETH_ADDRESS = '0x4200000000000000000000000000000000000006';

/** Coinbase B20 stock tokens live at 0xb2 followed by 20 zero nibbles. */
export const isStockToken = (addr: string) => /^0xb2[0]{20}[0-9a-f]{18}$/i.test(addr);
