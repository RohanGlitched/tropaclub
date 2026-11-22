import { fail, ok } from '@/lib/server/api';
import { getSeasonStats } from '@/lib/server/season';

export const dynamic = 'force-dynamic';

// Season 1 numbers: Caps issued, wallets with Caps, provisional wallets and the count of each
// exclusion reason (never addresses). Public, cached a minute.
export async function GET() {
  const stats = await getSeasonStats();
  if (!stats) return fail(503, 'The Season 1 numbers are not available right now. Try again in a minute.');
  return ok(stats, 'public, max-age=30, s-maxage=60, stale-while-revalidate=120');
}
