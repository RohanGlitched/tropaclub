// Cosmetic honours on a wallet's ticket: the scout badge, the Founders' Pennant and the Caps line.
// None of them is money or a token. Read with a short timeout, so a slow clubhouse only hides them.
import 'server-only';
import { COL, publicName, type CapsRow, type MemberDoc, type ScoutRow } from '@tropaclub/clubs';
import { tryClubs } from './clubs';
import { shortAddr } from '@/lib/format';

export interface Honours {
  /** "Scout" or "Captain's armband", from credited mates. */
  scout: string | null;
  /** On the Founders' Pennant list. */
  founders: boolean;
  /** Season Caps total and rank, or null when the wallet has none yet. */
  caps: { caps: number; rank: number; of: number } | null;
}
export const NO_HONOURS: Honours = { scout: null, founders: false, caps: null };

export async function walletHonours(wallet: string, ms = 2500): Promise<Honours> {
  const w = wallet.toLowerCase();
  const r = await tryClubs(async (svc) => {
    const [scout, founders, caps] = await Promise.all([
      svc.scoutBadgeOf(w).catch(() => null),
      svc.hasFoundersPennant(w).catch(() => false),
      svc.capsOf(w).catch(() => null),
    ]);
    return { scout, founders, caps };
  }, ms);
  return r ?? NO_HONOURS;
}

/** The stamps printed on a ticket and its share picture, in order. */
export const honourStamps = (h: Pick<Honours, 'scout' | 'founders'>): string[] => [...(h.scout ? [h.scout] : []), ...(h.founders ? ['Founders’ Pennant'] : [])];


export const ordinal = (n: number) => {
  const t = n % 100;
  const s = t >= 11 && t <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${n.toLocaleString('en-US')}${s}`;
};
/** "4.75 Caps, 12th of 340" */
export const capsLine = (c: { caps: number; rank: number; of: number }) => `${c.caps.toFixed(2)} Caps, ${ordinal(c.rank)} of ${c.of.toLocaleString('en-US')}`;

/**
 * Public names for board rows: the nickname from the wallet's first club seat if it set one,
 * else a short address. The full address is never shown. (No basename lookup: that would be a
 * reverse-resolver call per row, and the site only has a forward resolver.)
 */
export async function boardNames(wallets: string[], ms = 4000): Promise<Map<string, string>> {
  const out = new Map(wallets.map((w) => [w, shortAddr(w)]));
  const fresh = wallets.filter((w) => {
    const hit = nameMemo.get(w);
    if (hit && Date.now() - hit.at < NAME_TTL_MS) {
      out.set(w, hit.name);
      return false;
    }
    return true;
  });
  if (!fresh.length) return out;
  await tryClubs(async (svc) => {
    await Promise.all(
      fresh.map(async (w) => {
        const seats = await svc.ctx.store.query<MemberDoc>(COL.members, { where: [['wallet', '==', w]] }).catch(() => [] as MemberDoc[]);
        const first = seats.sort((a, b) => a.joinedAt - b.joinedAt)[0];
        const nick = first?.nickname ? publicName(first.nickname) : '';
        const name = nick || shortAddr(w);
        out.set(w, name);
        if (nameMemo.size > 5000) nameMemo.clear();
        nameMemo.set(w, { at: Date.now(), name });
      }),
    );
  }, ms);
  return out;
}
const nameMemo = new Map<string, { at: number; name: string }>();
const NAME_TTL_MS = 60_000;

/**
 * The Caps and Top scouts tables, kept for 60 s per instance. The scouts table checks every
 * credited mate's holding, so it is not recomputed on every page view. Null if the clubhouse is slow.
 */
const BOARD_TTL_MS = 60_000;
const boards = new Map<string, { at: number; p: Promise<unknown> }>();
function cachedBoard<T>(key: string, run: () => Promise<T | null>): Promise<T | null> {
  const hit = boards.get(key);
  if (hit && Date.now() - hit.at < BOARD_TTL_MS) return hit.p as Promise<T | null>;
  const p = run().then((v) => {
    if (v == null) boards.delete(key); // a failure is not kept
    return v;
  });
  boards.set(key, { at: Date.now(), p });
  return p;
}
export const capsBoard = (ms = 8000) => cachedBoard<CapsRow[]>('caps', () => tryClubs((svc) => svc.capsTable(), ms));
export const scoutsBoard = (ms = 8000) => cachedBoard<ScoutRow[]>('scouts', () => tryClubs((svc) => svc.scoutTable(), ms));
