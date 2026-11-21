import { fail, guarded } from '@/lib/server/api';
import { within } from '@/lib/server/chain';
import { getClubs } from '@/lib/server/clubs';
import { sessionWallet } from '@/lib/server/session';
import { isAddress } from '@/lib/format';

export const dynamic = 'force-dynamic';

// CSV of a wallet's statement. Owner only: the signed-in wallet must be the wallet asked for.
export const GET = (_req: Request, ctx: { params: Promise<{ address: string }> }) =>
  guarded(async () => {
    const { address } = await ctx.params;
    if (!isAddress(address)) return fail(400, 'Not a wallet address');
    const wallet = await sessionWallet();
    if (wallet !== address.toLowerCase()) return fail(403, 'Sign in with this wallet to download its statement.');
    const csv = await within((await getClubs()).getStatementCsv(address), 60_000, 'statement');
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="tropa-statement-${address.slice(0, 10)}.csv"`,
        'Cache-Control': 'private, no-store',
      },
    });
  });
