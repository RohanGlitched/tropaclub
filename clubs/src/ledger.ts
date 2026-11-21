/** Loads a wallet's recorded buys and stock-token movements from the store as FIFO flows. */
import type { ClubsContext } from './context';
import { type Flow, washBuys } from './lots';
import { COL, type BuyDoc, type ExclusionDoc, type TransferDoc } from './types';

export interface WalletLedger {
  wallet: string;
  buys: BuyDoc[];
  transfers: TransferDoc[];
  flows: Flow[];
  prior: Record<string, { raw: bigint; at: number }>;
  /** Buys that count: attributed, >= min USD, wallet not excluded, and not in a wash pattern (re-checked). */
  qualifying: BuyDoc[];
  wash: Set<string>;
  excluded: boolean;
}

export async function isExcluded(ctx: ClubsContext, wallet: string): Promise<boolean> {
  return !!(await ctx.store.get<ExclusionDoc>(COL.exclusions, wallet.toLowerCase()));
}

export async function loadLedger(ctx: ClubsContext, wallet: string): Promise<WalletLedger> {
  const w = wallet.toLowerCase();
  const [buys, transfers, excluded] = await Promise.all([
    ctx.store.query<BuyDoc>(COL.buys, { where: [['wallet', '==', w]] }),
    ctx.store.query<TransferDoc>(COL.transfers, { where: [['wallet', '==', w]] }),
    isExcluded(ctx, w),
  ]);
  buys.sort((a, b) => a.blockTime - b.blockTime);
  const price = new Map(buys.map((b) => [b.txHash, b.priceAtBuy]));
  const flows: Flow[] = transfers.map((t) => ({
    t: t.blockTime,
    token: t.token,
    dir: t.dir,
    raw: BigInt(t.raw),
    tropa: t.tropa,
    txHash: t.txHash,
    logIndex: t.logIndex,
    priceAtBuy: t.tropa ? price.get(t.txHash) ?? null : null,
  }));
  const prior: WalletLedger['prior'] = {};
  for (const b of buys) {
    if (prior[b.token] || b.priorBalanceRaw == null) continue;
    prior[b.token] = { raw: BigInt(b.priorBalanceRaw), at: b.blockTime - 1 };
  }
  // Movements before the first Tropa buy of a token are already inside priorBalanceRaw.
  const firstBuyAt = new Map<string, number>();
  for (const b of buys) if (!firstBuyAt.has(b.token)) firstBuyAt.set(b.token, b.blockTime);
  const scoped = flows.filter((f) => {
    const fb = firstBuyAt.get(f.token);
    return fb !== undefined && (f.t > fb || (f.t === fb && (f.tropa || f.dir === 'out')));
  });
  const attributed = buys.filter((b) => b.attributed);
  const wash = washBuys(
    attributed.map((b) => ({ txHash: b.txHash, token: b.token, t: b.blockTime })),
    transfers.filter((t) => t.dir === 'out').map((t) => ({ token: t.token, t: t.blockTime, txHash: t.txHash })),
  );
  const qualifying = buys.filter(
    (b) => b.attributed && !excluded && !b.excluded && !b.wash && !wash.has(b.txHash) && (b.usdIn ?? 0) >= ctx.config.minBuyUsd,
  );
  return { wallet: w, buys, transfers, flows: scoped, prior, qualifying, wash, excluded };
}
