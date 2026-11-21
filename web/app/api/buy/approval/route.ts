import { verifyAttribution } from '@tropaclub/buy';
import { fail, guarded, ok, rateLimited, readJson } from '@/lib/server/api';
import { baseClient, within } from '@/lib/server/chain';
import { APPROVALS, getClubs } from '@/lib/server/clubs';
import { isAddress } from '@/lib/format';

export const dynamic = 'force-dynamic';

// Some wallets send the approval and the buy as two transactions. Both carry the Builder Code.
// The approval is recorded here so the stats page can count approvals apart from swaps.
export const POST = (req: Request) =>
  guarded(async () => {
    const body = await readJson<{ txHash?: string; wallet?: string }>(req);
    const txHash = String(body?.txHash ?? '').toLowerCase();
    const wallet = String(body?.wallet ?? '').toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(txHash) || !isAddress(wallet)) return fail(400, 'Send the transaction hash and the wallet.');
    if (rateLimited('record', req, 30)) return fail(429, 'Too many requests. Wait a minute.');
    const a = await within(verifyAttribution(txHash as `0x${string}`, { client: baseClient() }), 20_000, 'attribution check').catch(() => null);
    if (!a?.attributed || a.from?.toLowerCase() !== wallet) return ok({ recorded: false });
    const svc = await getClubs();
    await svc.ctx.store.set(APPROVALS, txHash, { txHash, wallet, via: a.via, at: svc.ctx.now() });
    return ok({ recorded: true });
  });
