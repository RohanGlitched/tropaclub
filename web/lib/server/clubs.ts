// The clubs engine (@tropaclub/clubs), wired once per server instance.
//   Cloud Run (or the Firestore emulator): Firestore, real clock, Base RPC.
//   Anywhere else: an in-memory store seeded with sample clubs on a fixed demo clock, so every
//   screen can be seen before launch. The UI says "Sample clubs" whenever this mode is on.
import 'server-only';
import {
  COL,
  ChainlinkHistorySource,
  ClubsError,
  CompositePriceSource,
  MemoryDocStore,
  StaticPriceSource,
  StoreMarkSource,
  createClubsService,
  createProductionClubs,
  createViemChainReader,
  crestFromSeed,
  refreshSeats,
  type BuyDoc,
  type ClubDoc,
  type ClubsService,
  type CrestRecipe,
  type TransferDoc,
} from '@tropaclub/clubs';
import { baseClient } from './chain';
import { getIndex } from './data';
import { SITE_URL } from '@/lib/site';
import { clubName, kitFor, type Kit } from '@/lib/clubs';

export type { ClubsService };
/** Server-only collection of attributed approval transactions (counted apart from swaps on /stats). */
export const APPROVALS = 'approvals';
export { ClubsError };

const useFirestore = process.env.CLUBS_STORE ? process.env.CLUBS_STORE === 'firestore' : !!(process.env.K_SERVICE || process.env.FIRESTORE_EMULATOR_HOST);
/** True when clubs are the in-memory sample set (local development, previews). */
export const clubsSample = !useFirestore;

const g = globalThis as unknown as { __tropaClubs?: Promise<ClubsService> };

export function getClubs(): Promise<ClubsService> {
  if (!g.__tropaClubs) {
    g.__tropaClubs = (useFirestore ? production() : demo()).catch((e) => {
      g.__tropaClubs = undefined;
      throw e;
    });
  }
  return g.__tropaClubs;
}

async function production(): Promise<ClubsService> {
  const svc = await createProductionClubs();
  return svc;
}

/** Stock clubs exist for every priced token: created on first use, idempotent. */
let stockEnsuredAt = 0;
export async function ensureStockClubs(svc: ClubsService): Promise<void> {
  if (Date.now() - stockEnsuredAt < 10 * 60_000) return;
  stockEnsuredAt = Date.now();
  const { data } = await getIndex();
  // every stock has a club, all of them
  const tokens = data.tokens.filter((t) => /^0x[0-9a-fA-F]{40}$/.test(t.address));
  await Promise.all(
    tokens.map(async (t) => {
      try {
        const club = await svc.ensureStockClub({ symbol: t.symbol, token: t.address, name: t.name });
        // clubs made before names were shortened ("NVIDIA Corporation FC") are renamed in place
        const want = clubName(t.name, t.symbol);
        if (club.name !== want) await svc.ctx.store.update(COL.clubs, club.id, { name: want });
      } catch {
        /* next pass */
      }
    }),
  );
}

/** A club's crest. Stock clubs wear the same kit as their ground; other clubs get theirs from the seed. */
export function crestOf(club: { crestSeed?: string | null; kind?: string; stockSymbol?: string | null }): CrestRecipe | Kit {
  if (club.stockSymbol) return kitFor(club.stockSymbol);
  return crestFromSeed(club.crestSeed || 'tropa');
}

/**
 * What a wallet has earned by buying through Tropa Club: for each token, the latest gameweek it
 * played with that token ("Played GW0"), and its payday streak badge. Empty if the clubhouse is slow.
 */
export async function playedStamps(wallet: string, ms = 2500): Promise<{ byToken: Map<string, string>; badge: string | null }> {
  const none = { byToken: new Map<string, string>(), badge: null as string | null };
  const r = await tryClubs(async (svc) => {
    const w = wallet.toLowerCase();
    const buys = (await svc.ctx.store.query<BuyDoc>(COL.buys, { where: [['wallet', '==', w]] })).filter((b) => b.qualifies && b.attributed && !b.wash && !b.excluded && b.gw);
    if (!buys.length) return none;
    const byToken = new Map<string, string>();
    for (const b of buys.sort((x, y) => x.blockTime - y.blockTime)) byToken.set(b.token.toLowerCase(), `Played ${b.gw}`);
    const streak = await svc.getStreak(w).catch(() => null);
    return { byToken, badge: streak?.badge?.replace(' · ', ', ') ?? null };
  }, ms);
  return r ?? none;
}

/** Run a clubs call for a page: a failure becomes null so the page can show a calm state. */
export async function tryClubs<T>(run: (svc: ClubsService) => Promise<T>, ms = 20_000): Promise<T | null> {
  try {
    const svc = await getClubs();
    return await Promise.race([run(svc), new Promise<never>((_, rej) => setTimeout(() => rej(new Error('clubs timed out')), ms))]);
  } catch (e) {
    console.warn('[clubs]', (e as Error).message?.slice(0, 160));
    return null;
  }
}

// ---------------------------------------------------------------- sample clubs

const DEMO_NOW = Math.floor(Date.parse(process.env.CLUBS_DEMO_NOW || '2026-11-25T20:00:00Z') / 1000);
const demoWallet = (n: number) => {
  const h = (k: number) => ((Math.imul(n * 7 + k, 2654435761) >>> 0).toString(16).padStart(8, '0'));
  return `0x${h(1)}${h(2)}${h(3)}${h(4)}${h(5)}`;
};
const demoHash = (n: number) => `0x${n.toString(16).padStart(8, '0')}${'7e57'.repeat(14)}`;

async function demo(): Promise<ClubsService> {
  const store = new MemoryDocStore();
  const client = baseClient();
  const { data } = await getIndex();
  const priced = data.tokens.filter((t) => t.priceUsd != null).slice(0, 8);
  const tokens = new Map(data.tokens.map((t) => [t.address.toLowerCase(), t.symbol]));
  const tue = Math.floor(Date.parse('2026-11-24T15:10:00Z') / 1000);
  const tueClose = Math.floor(Date.parse('2026-11-24T21:00:00Z') / 1000);
  // members take their seats on Tuesday morning, before the first close; then the clock moves to the demo time
  let clock = tue - 3600;
  const marks = new StaticPriceSource({}, 30 * 86400, 'sample');
  priced.forEach((t, i) => {
    const p = t.priceUsd ?? 100;
    marks.add(t.address, tue - 4 * 86400, p);
    marks.add(t.address, tueClose, p * (1 + [0.012, -0.006, 0.004, 0.019, -0.011, 0.007, 0.002, -0.003][i % 8]));
  });
  const svc = createClubsService({
    store,
    chain: createViemChainReader({ client }),
    prices: new CompositePriceSource([marks, new StoreMarkSource(store), new ChainlinkHistorySource(client)]),
    now: () => clock,
    config: { tokens, siteUrl: SITE_URL },
  });

  for (const t of priced) await svc.ensureStockClub({ symbol: t.symbol, token: t.address, name: t.name });

  // CLUBS_DEMO=empty: the launch-day state. Stock clubs only, no members, the real clock.
  if (process.env.CLUBS_DEMO === 'empty') {
    clock = Math.floor(Date.now() / 1000);
    const tick = setInterval(() => (clock = Math.floor(Date.now() / 1000)), 1000);
    tick.unref?.();
    return svc;
  }

  let n = 0;
  const buy = async (wallet: string, tokenIdx: number, usd: number, at: number, clubId: string | null) => {
    const t = priced[tokenIdx % priced.length];
    const price = t.priceUsd ?? 100;
    const txHash = demoHash(++n);
    const raw = BigInt(Math.round((usd / price) * 1e8));
    const doc: BuyDoc = {
      txHash, wallet, clubId, token: t.address.toLowerCase(), symbol: t.symbol, rawAmount: raw.toString(), usdIn: usd, usdSource: 'usdc', priceAtBuy: price,
      blockNumber: 60_500_000 + n, blockTime: at, attributed: true, codes: ['bc_vdp89s9b'], via: 'tx', qualifies: usd >= 10, wash: false, excluded: false,
      priorBalanceRaw: '0', gw: 'GW0', recordedAt: at + 30, source: 'client', notes: ['sample'],
    };
    await store.set(COL.buys, txHash, doc);
    const tr: TransferDoc = { id: `${txHash}_0`, wallet, token: doc.token, dir: 'in', raw: raw.toString(), blockNumber: doc.blockNumber, blockTime: at, txHash, logIndex: 0, counterparty: '0x6131b5fae19ea4f9d964eac0408e4408b66337b5', tropa: true };
    await store.set(COL.transfers, tr.id, tr);
  };

  const squads: { name: string; members: [nick: string, plays: number | null, usd?: number][] }[] = [
    { name: 'Sunday League Tropa', members: [['Ana', 0, 10], ['Kofi', 1, 25], ['Mei', 2, 10], ['Diego', 0, 10], ['Sam', null]] },
    { name: 'Payday Rovers', members: [['Bia', 3, 10], ['Tunde', 1, 50], ['Lia', null], ['Omar', null]] },
    { name: 'Group Chat United', members: [['Jo', 4, 10], ['Rafa', 2, 10], ['Nia', 5, 25]] },
    { name: 'Tenner Athletic', members: [['Ines', 0, 10], ['Yaw', 6, 10], ['Carla', 1, 10], ['Ben', null], ['Zed', 3, 10], ['Pilar', 2, 10]] },
  ];
  let w = 0;
  for (const s of squads) {
    const wallets = s.members.map(() => demoWallet(++w));
    const made = await svc.createClub({ name: s.name, createdBy: wallets[0], nickname: s.members[0][0] });
    for (let i = 1; i < wallets.length; i++) await svc.joinClub({ wallet: wallets[i], inviteCode: made.inviteCode, nickname: s.members[i][0] });
    for (let i = 0; i < wallets.length; i++) {
      const [, plays, usd] = s.members[i];
      if (plays != null) await buy(wallets[i], plays, usd ?? 10, tue + i * 900, made.club.id);
      await refreshSeats(svc.ctx, wallets[i]);
    }
  }
  // a few supporters in the stock clubs
  for (let i = 0; i < 14; i++) {
    const wallet = demoWallet(++w);
    const idx = i % Math.min(4, priced.length);
    const clubId = `stock-${priced[idx].symbol.toLowerCase()}`;
    await svc.joinClub({ wallet, clubId });
    if (i % 3 !== 2) await buy(wallet, idx, 10, tue + i * 600, clubId);
    await refreshSeats(svc.ctx, wallet);
  }
  clock = DEMO_NOW;
  // CLUBS_DEMO_BUYER=0x…: local preview of the "Played GW0" stamp on a real wallet's ticket
  const buyer = process.env.CLUBS_DEMO_BUYER?.toLowerCase();
  if (buyer && /^0x[0-9a-f]{40}$/.test(buyer)) await buy(buyer, 0, 10, tue + 120, null);
  await svc.refreshMatchday(DEMO_NOW).catch((e) => console.warn('[clubs] sample matchday not computed:', (e as Error).message));
  return svc;
}
