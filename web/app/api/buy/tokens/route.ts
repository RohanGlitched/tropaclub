import { guarded, ok } from '@/lib/server/api';
import { listBuyTokens } from '@/lib/server/buy';

export const dynamic = 'force-dynamic';

export const GET = () => guarded(async () => ok({ tokens: await listBuyTokens() }, 'public, max-age=60, s-maxage=120'));
