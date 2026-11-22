import type { WalletTokenEntry, TokenSummary } from '@shared/types';
import { seatLabel, type SeatLabel } from './stadium';

/** Bars for a barcode cut from the address bytes: each hex digit becomes a bar and a gap. */
export function barcode(address: string): { x: number; w: number }[] {
  const hex = address.toLowerCase().replace(/^0x/, '').padEnd(40, '0').slice(0, 40);
  const bars: { x: number; w: number }[] = [];
  let x = 0;
  for (const w of [2, 1, 1]) {
    bars.push({ x, w });
    x += w + 1;
  }
  for (const ch of hex) {
    const v = parseInt(ch, 16) || 0;
    const w = 1 + (v & 3);
    const g = 1 + (v >> 2);
    bars.push({ x, w });
    x += w + g;
  }
  for (const w of [1, 1, 2]) {
    bars.push({ x, w });
    x += w + 1;
  }
  return bars;
}
export const barcodeWidth = (bars: { x: number; w: number }[]) => (bars.length ? bars[bars.length - 1].x + bars[bars.length - 1].w : 0);

function addrHash(a: string): number {
  let h = 2166136261;
  for (let i = 0; i < a.length; i++) {
    h ^= a.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Seat index in the ground. Real fans sit by rank. A ghost's exact index needs the seat file; without it the address picks a ghost seat. */
export function seatIndexFor(
  address: string,
  entry: Pick<WalletTokenEntry, 'rank' | 'kind'>,
  token: Pick<TokenSummary, 'holdersTotal' | 'realFans'>,
): number {
  const total = Math.max(1, token.holdersTotal);
  if (entry.rank != null && entry.rank >= 1) return Math.min(entry.rank - 1, total - 1);
  const ghosts = Math.max(1, total - token.realFans);
  return Math.min(total - 1, token.realFans + (addrHash(address.toLowerCase()) % ghosts));
}

export function ticketSeat(address: string, entry: WalletTokenEntry, token: Pick<TokenSummary, 'holdersTotal' | 'realFans'>): SeatLabel | null {
  return seatLabel(token.holdersTotal, seatIndexFor(address, entry, token));
}

/** One plain sentence for the best stat. pct is "top pct%" among real holders. */
export function statSentence(b: WalletTokenEntry['bestStat']): string {
  if (!b) return 'A real holder in this ground';
  const beat = Math.max(1, Math.min(99, Math.round(100 - b.pct)));
  switch (b.key) {
    case 'longestHold':
      return beat >= 99 ? 'Longest holder in the ground' : `Held longer than ${beat}% of real holders`;
    case 'earliest':
      return beat >= 99 ? 'First to arrive in the ground' : `Arrived before ${beat}% of real holders`;
    case 'entryVsMedian':
      return `Entry price lower than ${beat}% of real holders`;
    case 'streak':
      return `Longer weekly streak than ${beat}% of real holders`;
    case 'heldThroughGap':
      return 'Held through the weekend gap';
    default:
      return b.label || 'A real holder in this ground';
  }
}

export const KIND_LABEL: Record<string, string> = {
  real: 'Real holder',
  dust: 'Under $10',
  farmer: 'Airdrop-only',
  contract: 'Contract',
  pool: 'Exchange pool',
};
