// Store who brought a wallet, once, after its first club join, pick-up seat or new club. A bad or
// missing code, self-referral, or a wallet that is not new simply records nothing.
import 'server-only';
import type { ClubsService } from './clubs';

export async function maybeRefer(svc: ClubsService, wallet: string, code: unknown, via: 'club' | 'pickup' | 'create'): Promise<void> {
  if (typeof code !== 'string' || !/^[0-9a-z]{6,12}$/.test(code)) return;
  try {
    await svc.recordReferral({ wallet, code, via });
  } catch (e) {
    console.warn('[scouts] referral not recorded:', (e as Error).message?.slice(0, 120));
  }
}
