import { guarded, ok } from '@/lib/server/api';
import { endSession, sessionWallet } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

export const GET = () => guarded(async () => ok({ wallet: await sessionWallet() }));
export const DELETE = () =>
  guarded(async () => {
    await endSession();
    return ok({ wallet: null });
  });
