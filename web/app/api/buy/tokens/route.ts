import { guarded, ok } from '@/lib/server/api';
import { listBuyTokensWith } from '@/lib/server/buy';

export const dynamic = 'force-dynamic';

// The stocks that can be bought right now. ?token=0x… makes sure that one is in the list.
export const GET = (req: Request) =>
  guarded(async () => ok({ tokens: await listBuyTokensWith(new URL(req.url).searchParams.get('token')) }, 'public, max-age=60, s-maxage=120, stale-while-revalidate=600'));
