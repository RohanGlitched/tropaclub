import { KYBER_ROUTER, USDC, WETH, verifyAttribution } from '@tropaclub/buy';
import { fail, guarded, ok, rateLimited, readJson } from '@/lib/server/api';
import { baseClient, within } from '@/lib/server/chain';
import { APPROVALS, getClubs } from '@/lib/server/clubs';
import { isAddress } from '@/lib/format';

export const dynamic = 'force-dynamic';

const APPROVAL_TOPIC = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';
const topicAddr = (t: string | undefined) => (t ? `0x${t.slice(-40)}`.toLowerCase() : '');
const PAY_TOKENS = new Set([USDC.toLowerCase(), WETH.toLowerCase()]);
const ROUTER = KYBER_ROUTER.toLowerCase();

// Some wallets send the approval and the buy as two transactions. Both carry the Builder Code.
// The approval is recorded here so the stats page can count approvals apart from swaps. It counts
// only if the receipt shows this wallet approving USDC (or WETH) to the pinned KyberSwap router.
export const POST = (req: Request) =>
  guarded(async () => {
    const body = await readJson<{ txHash?: string; wallet?: string }>(req);
    const txHash = String(body?.txHash ?? '').toLowerCase();
    const wallet = String(body?.wallet ?? '').toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(txHash) || !isAddress(wallet)) return fail(400, 'Send the transaction hash and the wallet.');
    if (rateLimited('record', req, 30)) return fail(429, 'Too many requests. Wait a minute.');
    const a = await within(verifyAttribution(txHash as `0x${string}`, { client: baseClient(), buyer: wallet.toLowerCase() }), 20_000, 'attribution check').catch(() => null);
    if (!a?.attributed || a.from?.toLowerCase() !== wallet) return ok({ recorded: false });
    const receipt = await within(baseClient().getTransactionReceipt({ hash: txHash as `0x${string}` }), 20_000, 'receipt').catch(() => null);
    const toRouter =
      receipt?.status === 'success' &&
      receipt.logs.some((l) => PAY_TOKENS.has(l.address.toLowerCase()) && l.topics[0]?.toLowerCase() === APPROVAL_TOPIC && topicAddr(l.topics[1]) === wallet && topicAddr(l.topics[2]) === ROUTER);
    if (!toRouter) return ok({ recorded: false });
    const svc = await getClubs();
    await svc.ctx.store.set(APPROVALS, txHash, { txHash, wallet, via: a.via, spender: ROUTER, at: svc.ctx.now() });
    return ok({ recorded: true });
  });
