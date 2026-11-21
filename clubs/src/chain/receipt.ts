/** Pure receipt parsing: ERC-20/B20 Transfer logs, the stock leg and the payment leg of a buy. */
import { TRANSFER_TOPIC, USDC_ADDRESS, WETH_ADDRESS, isStockToken, type RawLog, type ReceiptLite, type TxLite } from './types';
import type { UsdSource } from '../types';

export interface ParsedTransfer {
  token: string;
  from: string;
  to: string;
  value: bigint;
  logIndex: number;
}

const topicAddr = (t: string) => `0x${t.slice(-40)}`.toLowerCase();

export function parseTransfers(logs: RawLog[]): ParsedTransfer[] {
  const out: ParsedTransfer[] = [];
  for (const l of logs) {
    if (l.topics.length !== 3 || l.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;
    out.push({
      token: l.address.toLowerCase(),
      from: topicAddr(l.topics[1]!),
      to: topicAddr(l.topics[2]!),
      value: BigInt(l.data === '0x' ? 0 : l.data),
      logIndex: l.logIndex,
    });
  }
  return out;
}

export interface StockLeg {
  token: string;
  raw: bigint;
  logIndexes: number[];
}

/** Net stock tokens received by `wallet` in the receipt, largest token first. */
export function stockLegs(transfers: ParsedTransfer[], wallet: string, knownTokens?: ReadonlySet<string>): StockLeg[] {
  const w = wallet.toLowerCase();
  const by = new Map<string, StockLeg>();
  for (const t of transfers) {
    const stock = knownTokens ? knownTokens.has(t.token) || isStockToken(t.token) : isStockToken(t.token);
    if (!stock || t.from === t.to) continue;
    const sign = t.to === w ? 1n : t.from === w ? -1n : 0n;
    if (!sign) continue;
    const leg = by.get(t.token) ?? { token: t.token, raw: 0n, logIndexes: [] };
    leg.raw += sign * t.value;
    if (sign > 0n) leg.logIndexes.push(t.logIndex);
    by.set(t.token, leg);
  }
  return [...by.values()].filter((l) => l.raw > 0n).sort((a, b) => (b.raw > a.raw ? 1 : -1));
}

export interface PaymentLeg {
  source: UsdSource;
  /** USDC micro-units (6 dp) or wei. */
  amount: bigint;
}

/** What the wallet paid: net USDC out, else WETH out, else native ETH value of the tx itself. */
export function paymentLeg(transfers: ParsedTransfer[], wallet: string, tx: TxLite | null): PaymentLeg | null {
  const w = wallet.toLowerCase();
  const net = (token: string) =>
    transfers.filter((t) => t.token === token).reduce((s, t) => s + (t.from === w ? t.value : 0n) - (t.to === w ? t.value : 0n), 0n);
  const usdc = net(USDC_ADDRESS);
  if (usdc > 0n) return { source: 'usdc', amount: usdc };
  const weth = net(WETH_ADDRESS);
  if (weth > 0n) return { source: 'weth', amount: weth };
  if (tx && tx.from.toLowerCase() === w && tx.value > 0n) return { source: 'eth', amount: tx.value };
  return null;
}

/** Proceeds of a sale: net USDC / WETH received by the wallet in the same tx (null if none visible). */
export function proceedsLeg(transfers: ParsedTransfer[], wallet: string): PaymentLeg | null {
  const w = wallet.toLowerCase();
  const net = (token: string) =>
    transfers.filter((t) => t.token === token).reduce((s, t) => s + (t.to === w ? t.value : 0n) - (t.from === w ? t.value : 0n), 0n);
  const usdc = net(USDC_ADDRESS);
  if (usdc > 0n) return { source: 'usdc', amount: usdc };
  const weth = net(WETH_ADDRESS);
  if (weth > 0n) return { source: 'weth', amount: weth };
  return null;
}

export function legUsd(leg: PaymentLeg, ethUsd: number | null): number | null {
  if (leg.source === 'usdc') return Number(leg.amount) / 1e6;
  if (ethUsd == null) return null;
  return (Number(leg.amount) / 1e18) * ethUsd;
}

export const receiptOk = (r: ReceiptLite | null): r is ReceiptLite => !!r && r.status === 'success';
