import { fail, guarded } from '@/lib/server/api';
import { statementCsv } from '@tropaclub/clubs';
import { statementStatus } from '@/lib/server/statement';
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
    const job = await statementStatus(address, 50_000);
    if (job.state === 'holdings') return fail(404, job.holdingsReason === 'pool' || job.holdingsReason === 'contract' ? 'This address is a contract, not a wallet, so there is no statement to download.' : 'This wallet has too many transfers to itemise, so there is no statement to download.');
    if (job.state === 'busy') return fail(503, 'Statements are busy just now. Try again in a minute.');
    if (job.state !== 'ready' || !job.value) return fail(job.state === 'empty' ? 404 : 503, job.state === 'empty' ? 'This wallet holds no stock tokens, so there is nothing to download.' : 'The statement is still being read from the chain. Try again in a minute.');
    const csv = statementCsv(job.value);
    return new Response(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="tropa-statement-${address.slice(0, 10)}.csv"`,
        'Cache-Control': 'private, no-store',
      },
    });
  });
