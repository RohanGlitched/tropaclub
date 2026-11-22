/**
 * The service API the Next.js app calls from its API routes (server only).
 *
 *   const clubs = await createProductionClubs();          // Firestore + Base RPC + marks + history
 *   const { club, inviteUrl } = await clubs.createClub({ name, createdBy: wallet });
 *
 * Every method validates input and throws ClubsError (code, message, status) for user errors.
 */
import { buyGate, countryFromHeaders, type GeoPolicy } from './geo';
import { captureMarks, ChainlinkHistorySource, CompositePriceSource, IndexerPriceSource, type PriceSource, StoreMarkSource } from './prices';
import { type ClubsConfig, type ClubsContext, defaultConfig, makeContext, need } from './context';
import * as clubs from './clubs';
import * as buys from './buys';
import * as pickup from './pickup';
import * as scoring from './scoring';
import * as callups from './callups';
import * as stats from './stats';
import * as scouts from './scouts';
import * as caps from './caps';
import * as eas from './eas';
import { buildStatement, statementCsv, type Statement } from './statement';
import { paydayStreak } from './streaks';
import { loadLedger } from './ledger';
import { currentGameweek, latestMatchdayCut, SEASON } from './calendar';
import { COL, type BuyDoc, type ClubDoc, type MemberDoc } from './types';
import type { DocStore } from './store/docstore';
import type { ChainReader } from './chain/types';
import type { WalletHistorySource } from './history';
import type { FundingSourceResolver } from './funding';
import { ClubsError, normAddr, shortAddr } from './util';

export interface ClubsDeps {
  store: DocStore;
  chain?: ChainReader;
  prices?: PriceSource;
  history?: WalletHistorySource;
  funding?: FundingSourceResolver;
  poolCheck?: import('./chain/pools').PoolCheck;
  geo?: GeoPolicy;
  now?: () => number;
  config?: Partial<ClubsConfig>;
}

export interface ClubPage {
  club: ClubDoc;
  members: { who: string; nickname: string | null; seat: MemberDoc['seat']; joinedAt: number; streakBadge: string | null; isViewer: boolean; wallet?: string }[];
  gameweek: { id: string; label: string; preseason: boolean; cutAt: number } | null;
  matchday: scoring.MatchdayCard | null;
  viewer: {
    member: boolean;
    seat: MemberDoc['seat'] | null;
    playedThisGw: boolean;
    invite: { code: string; url: string } | null;
    /** Benched teammates the viewer can still call up this gameweek (empty where call-ups are hidden). */
    canCallUp: string[];
  } | null;
  /** Buy CTA and call-ups are hidden where buying is blocked. */
  buyVisible: boolean;
  callupsVisible: boolean;
  labels: string[];
}

export function createClubsService(deps: ClubsDeps) {
  const ctx: ClubsContext = makeContext({
    store: deps.store,
    chain: deps.chain,
    prices: deps.prices,
    history: deps.history,
    funding: deps.funding,
    poolCheck: deps.poolCheck,
    ...(deps.geo ? { geo: deps.geo } : {}),
    ...(deps.now ? { now: deps.now } : {}),
    config: defaultConfig(deps.config),
  });

  async function getClubPage(clubId: string, opts: { viewer?: string | null; country?: string | null; live?: boolean } = {}): Promise<ClubPage> {
    const club = await clubs.getClub(ctx, clubId);
    if (!club) throw new ClubsError('club_not_found', 'Club not found.', 404);
    const viewer = opts.viewer ? normAddr(opts.viewer) : null;
    const ms = await clubs.clubMembers(ctx, club.id);
    const me = viewer ? ms.find((m) => m.wallet === viewer) ?? null : null;
    const now = ctx.now();
    const gw = currentGameweek(now);
    const token = club.kind === 'stock' ? club.stockToken : null;
    const ledgers = new Map(await Promise.all(ms.map(async (m) => [m.wallet, await loadLedger(ctx, m.wallet)] as const)));
    const members = ms.map((m) => {
      const l = ledgers.get(m.wallet)!;
      const s = paydayStreak(l.qualifying.filter((b) => !token || b.token === token).map((b) => b.blockTime), now);
      return { who: shortAddr(m.wallet), nickname: m.nickname, seat: m.seat, joinedAt: m.joinedAt, streakBadge: s.badge, isViewer: m.wallet === viewer, ...(me ? { wallet: m.wallet } : {}) };
    });
    const gate = buyGate(ctx.geo, opts.country ?? null);
    let viewerInfo: ClubPage['viewer'] = null;
    if (viewer) {
      const played = gw && me ? scoring.playedIn(ledgers.get(viewer)!, gw, now, token).length > 0 : false;
      let canCallUp: string[] = [];
      if (me && played && gate.allowed && gw) {
        const sent = new Set(
          (await ctx.store.query<{ to: string; from: string }>(COL.callups, { where: [['clubId', '==', club.id], ['gw', '==', gw.id]] })).filter((c) => c.from === viewer).map((c) => c.to),
        );
        canCallUp = ms.filter((m) => m.wallet !== viewer && !sent.has(m.wallet) && !scoring.playedIn(ledgers.get(m.wallet)!, gw, now, token).length).map((m) => m.wallet);
      }
      viewerInfo = {
        member: !!me,
        seat: me?.seat ?? null,
        playedThisGw: played,
        invite: me && club.kind !== 'stock' ? await clubs.getInvite(ctx, { clubId: club.id, wallet: viewer }) : null,
        canCallUp,
      };
    }
    const matchday = gw || SEASON[0]!.buyFrom < now ? await scoring.getMatchdayCard(ctx, club.id, now, { live: opts.live }).catch(() => null) : null;
    return {
      club,
      members,
      gameweek: gw ? { id: gw.id, label: gw.label, preseason: gw.preseason, cutAt: gw.cutAt } : null,
      matchday,
      viewer: viewerInfo,
      buyVisible: gate.allowed,
      callupsVisible: gate.allowed,
      labels: ['Returns are status only · no prize depends on them', 'Buys here don’t earn third-party cashback'],
    };
  }

  async function getStatement(wallet: string): Promise<Statement> {
    const history = need(ctx.history, 'wallet history source');
    const prices = need(ctx.prices, 'price source');
    const w = normAddr(wallet);
    const transfers = await history.stockTransfers(w);
    const tokens = [...new Set(transfers.map((t) => t.token))];
    const multipliers = Object.fromEntries(await Promise.all(tokens.map(async (t) => [t, await history.multiplierEvents(t)] as const)));
    const mine = await ctx.store.query<BuyDoc>(COL.buys, { where: [['wallet', '==', w]] });
    return buildStatement({
      wallet: w,
      transfers,
      multipliers,
      markAt: async (token, t) => (await prices.markAt(token, t))?.usd ?? null,
      now: ctx.now(),
      symbols: ctx.config.tokens,
      tropaBuys: new Map(mine.filter((b) => b.verified === true && b.usdIn != null).map((b) => [b.txHash, b.usdIn!])),
    });
  }

  /** Cron at each close: store the mark of every token a member holds through Tropa (feeds the scorer). */
  async function captureCutMarks(at = ctx.now(), source?: PriceSource): Promise<number> {
    const gw = currentGameweek(at) ?? SEASON[0]!;
    const day = latestMatchdayCut(gw, at);
    const t = day?.closeAt ?? at;
    // every known token, not only those already bought: a token with no Chainlink feed then has a
    // stored mark from each close, which buys checked later fall back to
    const tokens = [...new Set([...ctx.config.tokens.keys(), ...(await ctx.store.query<BuyDoc>(COL.buys)).map((b) => b.token)])];
    return (await captureMarks(ctx.store, source ?? need(ctx.prices, 'price source'), tokens, t)).length;
  }

  return {
    ctx,
    // geo
    countryFromHeaders,
    buyGate: (country: string | null, o?: { selfCertifiedUsPerson?: boolean }) => buyGate(ctx.geo, country, o),
    // clubs + seats
    createClub: (i: Parameters<typeof clubs.createClub>[1]) => clubs.createClub(ctx, i),
    ensureStockClub: (i: Parameters<typeof clubs.ensureStockClub>[1]) => clubs.ensureStockClub(ctx, i),
    joinClub: (i: Parameters<typeof clubs.joinClub>[1]) => clubs.joinClub(ctx, i),
    leaveClub: (i: Parameters<typeof clubs.leaveClub>[1]) => clubs.leaveClub(ctx, i),
    setNickname: (i: Parameters<typeof clubs.setNickname>[1]) => clubs.setNickname(ctx, i),
    setMatchingOptOut: (i: Parameters<typeof clubs.setMatchingOptOut>[1]) => clubs.setMatchingOptOut(ctx, i),
    resolveInvite: (code: string) => clubs.resolveInvite(ctx, code),
    getInvite: (i: Parameters<typeof clubs.getInvite>[1]) => clubs.getInvite(ctx, i),
    getClub: (id: string) => clubs.getClub(ctx, id),
    listClubs: (kind?: ClubDoc['kind']) => clubs.listClubs(ctx, kind),
    /** Server-side only (no API route): hide a club from every public list. */
    setClubHidden: (clubId: string, hidden: boolean, reason?: string) => clubs.setClubHidden(ctx, clubId, hidden, reason),
    walletClubs: (wallet: string) => clubs.walletClubs(ctx, wallet),
    getClubPage,
    // buys
    recordBuy: (i: Parameters<typeof buys.recordBuy>[1]) => buys.recordBuy(ctx, i),
    recordQuote: (q: Parameters<typeof buys.recordQuote>[1]) => buys.recordQuote(ctx, q),
    // scouts and Caps (cosmetic: no prizes, no cash)
    scoutCode: (wallet: string) => scouts.scoutCode(ctx, wallet),
    scoutOfCode: (code: string) => scouts.scoutOfCode(ctx, code),
    recordReferral: (i: Parameters<typeof scouts.recordReferral>[1]) => scouts.recordReferral(ctx, i),
    decideScoutCredits: () => scouts.decideScoutCredits(ctx),
    scoutTable: () => scouts.scoutTable(ctx),
    scoutBadgeOf: (wallet: string) => scouts.scoutBadgeOf(ctx, wallet),
    refreshFoundersPennants: () => scouts.refreshFoundersPennants(ctx),
    hasFoundersPennant: async (wallet: string) => ((await ctx.store.get<{ wallets: string[] }>(scouts.SCOUT_COL.boards, 'founders'))?.wallets ?? []).includes(normAddr(wallet)),
    awardCaps: (o?: Parameters<typeof caps.awardCaps>[1]) => caps.awardCaps(ctx, o),
    capsTable: () => caps.capsTable(ctx),
    capsOf: (wallet: string) => caps.capsOf(ctx, wallet),
    sweepTransfers: (o?: Parameters<typeof buys.sweepTransfers>[1]) => buys.sweepTransfers(ctx, o),
    // pick-up clubs
    optInPickup: (i: Parameters<typeof pickup.optInPickup>[1]) => pickup.optInPickup(ctx, i),
    leavePickupQueue: (wallet: string) => pickup.leavePickupQueue(ctx, wallet),
    matchPickups: () => pickup.matchPickups(ctx),
    // matchday, fixtures, tables
    getMatchdayCard: (clubId: string, at?: number, o?: { live?: boolean }) => scoring.getMatchdayCard(ctx, clubId, at, o),
    refreshMatchday: (at?: number) => scoring.refreshMatchday(ctx, at),
    captureCutMarks,
    scheduleFixtures: (gwId: string) => scoring.scheduleFixtures(ctx, gwId),
    settleGameweek: (gwId: string) => scoring.settleGameweek(ctx, gwId),
    getFixtures: (gwId: string) => scoring.getFixtures(ctx, gwId),
    getLeagueTable: () => scoring.getLeagueTable(ctx),
    getPreseasonTable: () => scoring.getPreseasonTable(ctx),
    getSupportersTable: (gwId?: string) => scoring.getSupportersTable(ctx, gwId),
    // streaks
    getStreak: async (wallet: string, opts: { token?: string } = {}) => {
      const l = await loadLedger(ctx, normAddr(wallet));
      return paydayStreak(l.qualifying.filter((b) => !opts.token || b.token === opts.token.toLowerCase()).map((b) => b.blockTime), ctx.now());
    },
    // call-ups
    sendCallup: (i: Parameters<typeof callups.sendCallup>[1]) => callups.sendCallup(ctx, i),
    listCallups: (clubId: string, gwId?: string) => callups.listCallups(ctx, clubId, gwId),
    callupsVisible: (country: string | null) => callups.callupsVisible(ctx, country),
    // stats
    getStats: (o?: { now?: number }) => stats.computeStats(ctx, o),
    addExclusion: (i: Parameters<typeof stats.addExclusion>[1]) => stats.addExclusion(ctx, i),
    listExclusions: () => stats.listExclusions(ctx),
    // statement
    getStatement,
    getStatementCsv: async (wallet: string) => statementCsv(await getStatement(wallet)),
    // pennants (EAS calldata only; nothing is sent)
    planFoundersPennants: () => eas.planFoundersPennants(ctx),
    planChampionPennants: (scope: string) => eas.planChampionPennants(ctx, scope),
    listAttestations: (status?: 'pending' | 'sent' | 'failed') => eas.listAttestations(ctx, status),
  };
}

export type ClubsService = ReturnType<typeof createClubsService>;

/** Token map (address -> symbol) from the indexer's public index.json. */
export async function loadTokenMap(indexUrl?: string, fetchImpl: typeof fetch = fetch): Promise<Map<string, string>> {
  const url = indexUrl ?? `${process.env.DATA_BASE_URL ?? 'https://storage.googleapis.com/tropaclub-data/public'}/index.json`;
  const r = await fetchImpl(url);
  if (!r.ok) throw new Error(`index.json ${r.status}`);
  const j = (await r.json()) as { tokens: { address: string; symbol: string }[] };
  return new Map(j.tokens.map((t) => [t.address.toLowerCase(), t.symbol]));
}

/**
 * Production wiring (Cloud Run): Firestore default DB, Base RPC (BASE_RPC_URL first), marks
 * (Chainlink rounds -> stored marks -> indexer DEX price), Etherscan history/funding if
 * ETHERSCAN_API_KEY is set, else RPC history.
 */
export async function createProductionClubs(opts: { indexUrl?: string } = {}): Promise<ClubsService> {
  if (!process.env.PICKUP_MATCH_SALT) throw new Error('PICKUP_MATCH_SALT must be set (Secret Manager) before clubs go live');
  const [{ createFirestoreStore }, { createViemChainReader, createBaseClient }, hist, fund] = await Promise.all([
    import('./store/firestore'),
    import('./chain/viem'),
    import('./history'),
    import('./funding'),
  ]);
  const store = createFirestoreStore();
  const client = createBaseClient();
  const chain = createViemChainReader({ client });
  const tokens = await loadTokenMap(opts.indexUrl).catch(() => new Map<string, string>());
  const prices = new CompositePriceSource([new ChainlinkHistorySource(client), new StoreMarkSource(store), new IndexerPriceSource({ indexUrl: opts.indexUrl })]);
  const hasEs = !!process.env.ETHERSCAN_API_KEY;
  const history = hasEs
    ? new hist.EtherscanHistorySource({ ethUsd: (bn) => chain.ethUsd(BigInt(bn)) })
    : new hist.RpcHistorySource(chain, { tokens: [...tokens.keys()] });
  // no explorer key: the first USDC/WETH sender in the last 30 days, read from the chain
  const funding = hasEs
    ? new fund.EtherscanFundingResolver()
    : new fund.RpcFundingResolver({ blockNumber: () => chain.blockNumber(), getTransferLogs: chain.getTransferLogs, nonceOf: async (a) => client.getTransactionCount({ address: a as `0x${string}` }) });
  const { indexerPoolCheck } = await import('./chain/pools');
  return createClubsService({ store, chain, prices, history, funding, poolCheck: indexerPoolCheck(), config: { tokens } });
}
