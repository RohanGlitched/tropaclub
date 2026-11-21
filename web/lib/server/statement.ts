// A wallet's cost-basis statement, cached for ten minutes per wallet: building one reads the
// wallet's whole stock-token history from the chain, which is slow on public RPCs.
import 'server-only';
import { buildStatement, type HistTransfer, type Statement } from '@tropaclub/clubs';
import { getClubs } from './clubs';
import { getIndex } from './data';
import { within } from './chain';

const cache = new Map<string, { at: number; p: Promise<Statement> }>();
const TTL = 10 * 60_000;

export async function loadStatement(wallet: string, ms = 45_000): Promise<Statement | null> {
  const w = wallet.toLowerCase();
  const hit = cache.get(w);
  let p = hit && Date.now() - hit.at < TTL ? hit.p : null;
  if (!p) {
    p = getClubs().then((svc) => svc.getStatement(w));
    p.catch(() => cache.delete(w));
    if (cache.size > 300) cache.clear();
    cache.set(w, { at: Date.now(), p });
  }
  try {
    return await within(p, ms, 'statement');
  } catch (e) {
    console.warn('[statement]', (e as Error).message?.slice(0, 140));
    return null;
  }
}

/** A made-up statement that shows every kind of line. Used as the specimen on the statement page. */
export async function specimenStatement(): Promise<Statement> {
  const { data } = await getIndex();
  const a = data.tokens.find((t) => t.priceUsd != null) ?? data.tokens[0];
  const b = data.tokens.filter((t) => t.priceUsd != null)[1] ?? a;
  const pa = a.priceUsd ?? 130;
  const pb = b.priceUsd ?? 270;
  const day = (iso: string) => Math.floor(Date.parse(iso) / 1000);
  const legs = (paid: number | null, received: number | null) => ({ paidUsd: paid, receivedUsd: received, otherOut: false, otherIn: false });
  const raw = (usd: number, price: number) => BigInt(Math.round((usd / price) * 1e8));
  const tx = (n: number) => `0x${n.toString(16).padStart(4, '0')}${'5bec'.repeat(15)}`;
  const A = a.address.toLowerCase();
  const B = b.address.toLowerCase();
  const transfers: HistTransfer[] = [
    { token: A, dir: 'in', raw: raw(50, pa * 0.92), t: day('2026-09-10T15:00:00Z'), blockNumber: 51_000_000, txHash: tx(1), logIndex: 1, counterparty: '0x6131b5fae19ea4f9d964eac0408e4408b66337b5', legs: legs(50, null) },
    { token: A, dir: 'in', raw: raw(25, pa * 0.97), t: day('2026-10-08T15:00:00Z'), blockNumber: 53_000_000, txHash: tx(2), logIndex: 1, counterparty: '0x6131b5fae19ea4f9d964eac0408e4408b66337b5', legs: legs(25, null) },
    { token: B, dir: 'in', raw: raw(40, pb), t: day('2026-10-20T12:00:00Z'), blockNumber: 54_000_000, txHash: tx(3), logIndex: 1, counterparty: '0x0000000000000000000000000000000000f41e4d', legs: legs(null, null) },
    { token: A, dir: 'out', raw: raw(30, pa * 0.92), t: day('2026-11-05T16:00:00Z'), blockNumber: 56_000_000, txHash: tx(4), logIndex: 1, counterparty: '0x6131b5fae19ea4f9d964eac0408e4408b66337b5', legs: legs(null, 33.4) },
    { token: A, dir: 'in', raw: raw(10, pa), t: day('2026-11-18T15:00:00Z'), blockNumber: 59_000_000, txHash: tx(5), logIndex: 1, counterparty: '0x6131b5fae19ea4f9d964eac0408e4408b66337b5', legs: legs(10, null) },
  ];
  return buildStatement({
    wallet: '0x7a3f9c2e41b85d06e9a1c4f27b3d8e5a60c9f1d4',
    transfers,
    multipliers: {},
    markAt: async (token) => (token === A ? pa : pb),
    now: day('2026-11-21T16:25:00Z'),
    symbols: new Map([[A, a.symbol], [B, b.symbol]]),
  });
}
