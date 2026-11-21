import { fail, ok } from '@/lib/server/api';
import { getWallet } from '@/lib/server/data';
import { isAddress } from '@/lib/format';

export async function GET(_req: Request, ctx: { params: Promise<{ address: string }> }) {
  const { address } = await ctx.params;
  if (!isAddress(address)) return fail(400, 'Not a wallet address');
  const w = await getWallet(address);
  return ok({ wallet: w.data, source: w.source }, 'public, max-age=60, s-maxage=300');
}
