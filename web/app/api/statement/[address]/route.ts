import { fail, guarded, ok, rateLimited } from '@/lib/server/api';
import { statementStatus } from '@/lib/server/statement';
import { isAddress } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// The statement page polls this. A statement is built as a job; each call waits a few seconds
// for it and then says where it stands, so no request hangs.
export const GET = (req: Request, ctx: { params: Promise<{ address: string }> }) =>
  guarded(async () => {
    const { address } = await ctx.params;
    if (!isAddress(address)) return fail(400, 'Not a wallet address');
    if (rateLimited('statement', req, 60)) return fail(429, 'Too many requests. Wait a minute.');
    const job = await statementStatus(address, 5000);
    const seconds = Math.round((Date.now() - job.startedAt) / 1000);
    if (job.state === 'ready' && job.value) {
      // raw token amounts are bigints: send them as strings
      const statement = JSON.parse(JSON.stringify(job.value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
      return ok({ status: 'ready', statement, countedAt: job.countedAt ?? null, source: job.source ?? null });
    }
    if (job.state === 'empty') return ok({ status: 'empty' });
    if (job.state === 'holdings') return ok({ status: 'holdings', reason: job.holdingsReason ?? 'too_active', holdings: job.holdings ?? [], countedAt: job.countedAt ?? null });
    // too many statements are reading the chain, or this one needs more reads than one may make
    if (job.state === 'busy') return ok({ status: 'busy', holdings: job.holdings ?? [], countedAt: job.countedAt ?? null });
    if (job.state === 'failed') return ok({ status: 'failed' });
    return ok({ status: 'pending', step: job.step, done: job.done, total: job.total, seconds });
  });
