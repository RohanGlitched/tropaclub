import 'server-only';
import { InviteBox } from './Actions';
import { tryClubs } from '@/lib/server/clubs';

/** A club's invite box with the member's own scout code on the link (?s=<code>), so a friend who joins counts toward Top scouts. */
export default async function ScoutInviteBox({ url, club, wallet }: { url: string; club: string; wallet: string | null }) {
  const code = wallet ? await tryClubs((svc) => svc.scoutCode(wallet), 2500) : null;
  const withCode = code ? `${url}${url.includes('?') ? '&' : '?'}s=${encodeURIComponent(code)}` : url;
  return <InviteBox url={withCode} club={club} />;
}
