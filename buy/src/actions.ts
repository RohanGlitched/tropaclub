/**
 * Corporate-action state per token.
 *
 * On-chain shape (observed on SNDKc's 8-for-1 split, Nov 2026):
 *   Oct 30: announce(id "<uuid>:pre", "Stock Split")      -> Announcement + EndAnnouncement in one tx (notice only)
 *   Nov 19: announce(id "<uuid>", "8-for-1 Stock Split")  -> Announcement + UIMultiplierUpdated(1e18 -> 8e18, effectiveAt Nov 20 05:00Z) + EndAnnouncement
 *   Coinbase API /corporate-actions/<uuid>: status ANNOUNCED -> APPLIED.
 * So an "open" action is any of:
 *   - an Announcement with no EndAnnouncement for the same id (bracket left open),
 *   - a ":pre" notice whose final announcement has not landed yet,
 *   - Coinbase API status CORPORATE_ACTION_STATUS_ANNOUNCED,
 *   - a scheduled multiplier change not yet effective (newUIMultiplier != uiMultiplier and effectiveAt in the future),
 *     which also catches multiplier changes made without any Announcement (Red B1).
 */
import { type Address, type Hex, type PublicClient, getAddress } from 'viem';
import { COINBASE_STOCKS_API, b20Abi } from './constants';
import type { TokenInfo } from './market';

export interface AnnouncementLog {
  token: Address;
  kind: 'Announcement' | 'EndAnnouncement';
  id: string;
  description?: string;
  uri?: string;
  blockNumber: bigint;
  txHash: Hex;
}

export interface CorporateActionState {
  open: boolean;
  reasons: string[];
  actions: { uuid: string; description?: string; status?: string; pre: boolean; final: boolean; bracketClosed: boolean }[];
}

export function actionUuid(a: { id: string; uri?: string }): string {
  const fromUri = a.uri?.split('/').pop();
  if (fromUri && /^[0-9a-f-]{36}$/i.test(fromUri)) return fromUri.toLowerCase();
  return a.id.replace(/(:pre|-\d+)$/i, '').toLowerCase();
}

/** Pure evaluation from logs + token state + optional API statuses. */
export function evaluateCorporateActions(
  logs: AnnouncementLog[],
  info: Pick<TokenInfo, 'multiplierWad' | 'pendingMultiplierWad' | 'effectiveAt' | 'symbol'>,
  nowSec: number,
  apiStatus: Record<string, string | undefined> = {},
): CorporateActionState {
  const reasons: string[] = [];
  const ends = new Map<string, number>();
  for (const l of logs) if (l.kind === 'EndAnnouncement') ends.set(l.id, (ends.get(l.id) ?? 0) + 1);

  const byUuid = new Map<string, CorporateActionState['actions'][number]>();
  for (const l of logs) {
    if (l.kind !== 'Announcement') continue;
    const uuid = actionUuid(l);
    const pre = /:pre$/i.test(l.id);
    const cur = byUuid.get(uuid) ?? { uuid, pre: false, final: false, bracketClosed: true, description: undefined, status: apiStatus[uuid] };
    if (pre) cur.pre = true;
    else cur.final = true;
    if (!pre || !cur.description) cur.description = l.description;
    const remaining = ends.get(l.id) ?? 0;
    if (remaining > 0) ends.set(l.id, remaining - 1);
    else cur.bracketClosed = false;
    byUuid.set(uuid, cur);
  }

  for (const a of byUuid.values()) {
    if (!a.bracketClosed) reasons.push(`announcement "${a.description ?? a.uuid}" is still open (no EndAnnouncement)`);
    if (a.status === 'CORPORATE_ACTION_STATUS_ANNOUNCED') reasons.push(`corporate action "${a.description ?? a.uuid}" is announced and not yet applied`);
    else if (!a.status && a.pre && !a.final) reasons.push(`corporate action "${a.description ?? a.uuid}" has a pre-notice but no final announcement yet`);
  }

  if (info.effectiveAt > nowSec && info.pendingMultiplierWad !== info.multiplierWad) {
    const ratio = Number((info.pendingMultiplierWad * 1_000_000n) / (info.multiplierWad || 1n)) / 1e6;
    reasons.push(
      `${info.symbol} multiplier changes x${ratio} at ${new Date(info.effectiveAt * 1000).toISOString()} (scheduled, not yet effective)`,
    );
  }
  return { open: reasons.length > 0, reasons, actions: [...byUuid.values()] };
}

/** Scan Announcement/EndAnnouncement logs in chunks (publicnode caps getLogs at 50k blocks and needs an address). */
export async function fetchAnnouncementLogs(
  client: PublicClient,
  tokens: Address[],
  opts: { fromBlock: bigint; toBlock?: bigint; chunk?: bigint; concurrency?: number; maxAddresses?: number },
): Promise<AnnouncementLog[]> {
  const toBlock = opts.toBlock ?? (await client.getBlockNumber());
  const chunk = opts.chunk ?? 50_000n;
  const conc = opts.concurrency ?? 6;
  // publicnode: <= 50k blocks and <= 10 addresses per request
  const maxA = opts.maxAddresses ?? 10;
  const groups: Address[][] = [];
  for (let i = 0; i < tokens.length; i += maxA) groups.push(tokens.slice(i, i + maxA));
  const ranges: [bigint, bigint, Address[]][] = [];
  for (const g of groups)
    for (let s = opts.fromBlock; s <= toBlock; s += chunk) ranges.push([s, s + chunk - 1n > toBlock ? toBlock : s + chunk - 1n, g]);
  const events = b20Abi.filter((x) => x.type === 'event' && (x.name === 'Announcement' || x.name === 'EndAnnouncement'));
  const out: AnnouncementLog[] = [];
  for (let i = 0; i < ranges.length; i += conc) {
    const batch = await Promise.all(
      ranges.slice(i, i + conc).map(async ([fromBlock, to, address]) => {
        for (let attempt = 0; ; attempt++) {
          try {
            return await client.getLogs({ address, events, fromBlock, toBlock: to });
          } catch (e) {
            if (attempt >= 3) throw e;
            await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          }
        }
      }),
    );
    for (const logs of batch)
      for (const l of logs as any[]) {
        out.push({
          token: getAddress(l.address),
          kind: l.eventName,
          id: l.args.id,
          description: l.args.description,
          uri: l.args.uri,
          blockNumber: l.blockNumber,
          txHash: l.transactionHash,
        });
      }
  }
  return out;
}

export async function fetchActionStatuses(uuids: string[], fetchImpl: typeof fetch = fetch): Promise<Record<string, string | undefined>> {
  const out: Record<string, string | undefined> = {};
  await Promise.all(
    uuids.map(async (u) => {
      try {
        const r = await fetchImpl(`${COINBASE_STOCKS_API}/corporate-actions/${u}`);
        if (r.ok) out[u] = ((await r.json()) as { status?: string }).status;
      } catch {
        /* leave undefined: falls back to on-chain bracket logic */
      }
    }),
  );
  return out;
}

/**
 * Server-side cache: one log scan over all tracked tokens, then incremental refreshes.
 * The indexer can feed full-history announcements instead (pass them to isBuyable as `announcements`).
 */
export class AnnouncementWatcher {
  private logs: AnnouncementLog[] = [];
  private lastBlock: bigint | null = null;
  constructor(
    private client: PublicClient,
    private tokens: Address[],
    private lookbackBlocks = 7n * 86_400n * 5n, // 7 days at 200 ms blocks
  ) {}

  async refresh(): Promise<AnnouncementLog[]> {
    const head = await this.client.getBlockNumber();
    const from = this.lastBlock === null ? head - this.lookbackBlocks : this.lastBlock + 1n;
    if (from <= head) {
      const fresh = await fetchAnnouncementLogs(this.client, this.tokens, { fromBlock: from, toBlock: head });
      this.logs.push(...fresh);
    }
    this.lastBlock = head;
    return this.logs;
  }

  forToken(token: Address): AnnouncementLog[] {
    const t = token.toLowerCase();
    return this.logs.filter((l) => l.token.toLowerCase() === t);
  }
}
