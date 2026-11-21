/**
 * EAS crest attestations on Base: the Founders' Pennant (GW0 Playing joiners still holding at D+7) and
 * champion pennants (gameweek and season). No money in any pennant.
 *
 * - EAS predeploy 0x4200000000000000000000000000000000000021, SchemaRegistry 0x...0020.
 * - Every calldata ends in the Tropa ERC-8021 suffix (from @tropaclub/buy). /stats never counts these txs.
 * - Nothing here sends a tx. createAttestationSender() reads TROPA_ATTESTER_KEY (Secret Manager, added
 *   later by the lead) and refuses unless TROPA_ATTEST_SEND=1.
 */
import { TROPA_SUFFIX, appendSuffix } from '@tropaclub/buy';
import { type Hex, encodeAbiParameters, encodeFunctionData, encodePacked, keccak256, parseAbi, parseAbiParameters, toHex } from 'viem';
import { SEASON, gameweekById } from './calendar';
import { walletClubs } from './clubs';
import type { ClubsContext } from './context';
import { getLeagueTable } from './scoring';
import { heldAt } from './cohort';
import { loadLedger } from './ledger';
import { subjectFromLedger } from './stats';
import { AlreadyExistsError } from './store/docstore';
import { COL, type AttestationDoc, type BuyDoc, type ClubDoc, type ExclusionDoc, type GwClubResultDoc, type MemberDoc, type PennantKind } from './types';
import { DAY } from './util';

export const EAS_ADDRESS = '0x4200000000000000000000000000000000000021' as const;
export const SCHEMA_REGISTRY_ADDRESS = '0x4200000000000000000000000000000000000020' as const;
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
export const ZERO_BYTES32 = `0x${'0'.repeat(64)}` as Hex;

export const PENNANT_SCHEMA = 'string pennant,string kind,string club,bytes32 clubId,string gameweek,uint64 earnedAt,string note';
export const PENNANT_SCHEMA_REVOCABLE = true;

export const easAbi = parseAbi([
  'struct AttestationRequestData { address recipient; uint64 expirationTime; bool revocable; bytes32 refUID; bytes data; uint256 value; }',
  'struct AttestationRequest { bytes32 schema; AttestationRequestData data; }',
  'struct MultiAttestationRequest { bytes32 schema; AttestationRequestData[] data; }',
  'function attest(AttestationRequest request) payable returns (bytes32)',
  'function multiAttest(MultiAttestationRequest[] multiRequests) payable returns (bytes32[])',
]);
export const schemaRegistryAbi = parseAbi(['function register(string schema, address resolver, bool revocable) returns (bytes32)']);

/** keccak256(abi.encodePacked(schema, resolver, revocable)), as SchemaRegistry computes it. */
export function schemaUid(schema = PENNANT_SCHEMA, resolver: Hex = ZERO_ADDRESS, revocable = PENNANT_SCHEMA_REVOCABLE): Hex {
  return keccak256(encodePacked(['string', 'address', 'bool'], [schema, resolver, revocable]));
}
export const PENNANT_SCHEMA_UID = schemaUid();

/** One-time schema registration tx (to SchemaRegistry), suffixed. */
export function buildRegisterSchemaTx(): { to: Hex; data: Hex; value: bigint } {
  const data = encodeFunctionData({ abi: schemaRegistryAbi, functionName: 'register', args: [PENNANT_SCHEMA, ZERO_ADDRESS, PENNANT_SCHEMA_REVOCABLE] });
  return { to: SCHEMA_REGISTRY_ADDRESS, data: appendSuffix(data, TROPA_SUFFIX), value: 0n };
}

export interface PennantData {
  pennant: string; // "Founders' Pennant", "GW1 Champions", "Season 0 Champions"
  kind: PennantKind;
  club: string;
  clubId: string;
  gameweek: string; // "GW0" / "S0"
  earnedAt: number;
  note: string;
}

export const clubIdBytes32 = (clubId: string) => keccak256(toHex(clubId));

export function encodePennantData(p: PennantData): Hex {
  return encodeAbiParameters(parseAbiParameters(PENNANT_SCHEMA), [p.pennant, p.kind, p.club, clubIdBytes32(p.clubId), p.gameweek, BigInt(p.earnedAt), p.note]);
}

export function buildAttestTx(recipient: string, data: Hex, schema: Hex = PENNANT_SCHEMA_UID): { to: Hex; data: Hex; value: bigint } {
  const call = encodeFunctionData({
    abi: easAbi,
    functionName: 'attest',
    args: [{ schema, data: { recipient: recipient as Hex, expirationTime: 0n, revocable: PENNANT_SCHEMA_REVOCABLE, refUID: ZERO_BYTES32, data, value: 0n } }],
  });
  return { to: EAS_ADDRESS, data: appendSuffix(call, TROPA_SUFFIX), value: 0n };
}

/** Batch many pennants in one tx (multiAttest), suffixed. */
export function buildMultiAttestTx(items: { recipient: string; data: Hex }[], schema: Hex = PENNANT_SCHEMA_UID): { to: Hex; data: Hex; value: bigint } {
  const call = encodeFunctionData({
    abi: easAbi,
    functionName: 'multiAttest',
    args: [[{ schema, data: items.map((i) => ({ recipient: i.recipient as Hex, expirationTime: 0n, revocable: PENNANT_SCHEMA_REVOCABLE, refUID: ZERO_BYTES32, data: i.data, value: 0n })) }]],
  });
  return { to: EAS_ADDRESS, data: appendSuffix(call, TROPA_SUFFIX), value: 0n };
}

async function queue(ctx: ClubsContext, kind: PennantKind, scope: string, recipient: string, p: PennantData): Promise<AttestationDoc | null> {
  const data = encodePennantData(p);
  const tx = buildAttestTx(recipient, data);
  const doc: AttestationDoc = {
    id: `${kind}__${scope}__${recipient}`,
    kind,
    recipient,
    clubId: p.clubId,
    gw: p.gameweek,
    schemaUid: PENNANT_SCHEMA_UID,
    data,
    to: tx.to,
    calldata: tx.data,
    status: 'pending',
    txHash: null,
    createdAt: ctx.now(),
  };
  try {
    await ctx.store.create(COL.attestations, doc.id, doc);
    return doc;
  } catch (e) {
    if (e instanceof AlreadyExistsError) return null;
    throw e;
  }
}

async function primaryClub(ctx: ClubsContext, wallet: string): Promise<ClubDoc | null> {
  const cs = await walletClubs(ctx, wallet);
  return (cs.find((c) => c.club.kind === 'private') ?? cs.find((c) => c.club.kind === 'pickup') ?? cs[0])?.club ?? null;
}

/** Founders' Pennant: GW0 Playing joiners still holding at D+7 (same hold rule as the cohort). */
export async function planFoundersPennants(ctx: ClubsContext): Promise<AttestationDoc[]> {
  const now = ctx.now();
  const gw0 = SEASON[0]!;
  const ex = new Set((await ctx.store.query<ExclusionDoc>(COL.exclusions)).map((e) => e.wallet));
  const buys = await ctx.store.query<BuyDoc>(COL.buys, { where: [['gw', '==', 'GW0']] });
  const out: AttestationDoc[] = [];
  for (const w of [...new Set(buys.map((b) => b.wallet))].sort()) {
    if (ex.has(w)) continue;
    const s = subjectFromLedger(await loadLedger(ctx, w));
    if (!s || s.t0 <= gw0.buyFrom || s.t0 > gw0.cutAt || s.t0 + 7 * DAY > now || !heldAt(s, 7)) continue;
    const club = await primaryClub(ctx, w);
    const d = await queue(ctx, 'founders', 'S0', w, {
      pennant: "Founders' Pennant",
      kind: 'founders',
      club: club?.name ?? 'Tropa Club',
      clubId: club?.id ?? 'none',
      gameweek: 'GW0',
      earnedAt: s.t0 + 7 * DAY,
      note: 'Played GW0 and still held at D+7. A crest, no money in it.',
    });
    if (d) out.push(d);
  }
  return out;
}

/** Champion pennants: the top club of a settled gameweek (`gwId`), or the season league leader ('S0'). */
export async function planChampionPennants(ctx: ClubsContext, scope: string): Promise<AttestationDoc[]> {
  const out: AttestationDoc[] = [];
  if (scope === 'S0') {
    const table = await getLeagueTable(ctx);
    const top = table.rows[0];
    if (!top) return out;
    const members = await ctx.store.query<MemberDoc>(COL.members, { where: [['clubId', '==', top.clubId]] });
    for (const m of members.filter((x) => x.seat === 'playing')) {
      const d = await queue(ctx, 'champion', 'S0', m.wallet, { pennant: 'Season 0 Champions', kind: 'champion', club: top.name, clubId: top.clubId, gameweek: 'S0', earnedAt: ctx.now(), note: 'Top of the Season 0 league table. Status only, no money in it.' });
      if (d) out.push(d);
    }
    return out;
  }
  const gw = gameweekById(scope);
  if (ctx.now() < gw.cutAt) throw new Error(`${scope} is not settled yet`);
  const results = (await ctx.store.query<GwClubResultDoc>(COL.gwResults, { where: [['gw', '==', scope]] })).filter((r) => r.final && r.kind !== 'stock' && r.members >= 3 && r.score != null);
  results.sort((a, b) => b.score! - a.score! || b.participationPct - a.participationPct || (a.clubId < b.clubId ? -1 : 1));
  const champ = results[0];
  if (!champ) return out;
  const club = (await ctx.store.get<ClubDoc>(COL.clubs, champ.clubId))!;
  const members = await ctx.store.query<MemberDoc>(COL.members, { where: [['clubId', '==', champ.clubId]] });
  for (const m of members) {
    const l = await loadLedger(ctx, m.wallet);
    if (!l.qualifying.some((b) => b.blockTime > gw.buyFrom && b.blockTime <= gw.cutAt)) continue;
    const d = await queue(ctx, 'champion', scope, m.wallet, { pennant: `${scope} Champions`, kind: 'champion', club: club.name, clubId: club.id, gameweek: scope, earnedAt: gw.cutAt, note: 'Best club median of the gameweek. Status only, no money in it.' });
    if (d) out.push(d);
  }
  return out;
}

export const listAttestations = (ctx: ClubsContext, status: AttestationDoc['status'] = 'pending') =>
  ctx.store.query<AttestationDoc>(COL.attestations, { where: [['status', '==', status]] });

/**
 * Server signer for later (the lead adds TROPA_ATTESTER_KEY to Secret Manager). Refuses to exist
 * unless TROPA_ATTEST_SEND=1, so nothing can be sent by accident. Never logs the key.
 */
export async function createAttestationSender(opts: { rpcUrl?: string } = {}) {
  if (process.env.TROPA_ATTEST_SEND !== '1') throw new Error('attestation sending is disabled (set TROPA_ATTEST_SEND=1)');
  const key = process.env.TROPA_ATTESTER_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('TROPA_ATTESTER_KEY is missing or malformed');
  const [{ privateKeyToAccount }, { createWalletClient, http }, { base }] = await Promise.all([import('viem/accounts'), import('viem'), import('viem/chains')]);
  const account = privateKeyToAccount(key as Hex);
  const wallet = createWalletClient({ account, chain: base, transport: http(opts.rpcUrl ?? process.env.BASE_RPC_URL ?? 'https://mainnet.base.org') });
  return {
    address: account.address,
    async send(doc: AttestationDoc): Promise<Hex> {
      return wallet.sendTransaction({ to: doc.to as Hex, data: doc.calldata as Hex, value: 0n });
    },
  };
}
