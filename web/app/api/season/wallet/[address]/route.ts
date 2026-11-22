import { isAddress } from '@/lib/format';
import { fail, ok, rateLimited } from '@/lib/server/api';
import { getSeasonStanding } from '@/lib/server/season';

export const dynamic = 'force-dynamic';

// One wallet's Season 1 Caps, rank and where they came from. Public, like the league table: no handle.
export async function GET(req: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) return fail(400, 'That is not a wallet address.');
  if (rateLimited('season-wallet', req, 30)) return fail(429, 'Too many requests. Wait a minute.');
  const s = await getSeasonStanding(address);
  if (!s) return fail(503, 'Caps are not available right now. Try again in a minute.');
  return ok(s, 'public, max-age=30, s-maxage=60');
}
