import { fail, ok } from '@/lib/server/api';
import { getSocialState, seasonPostId } from '@/lib/server/season';
import { sessionWallet } from '@/lib/server/session';

export const dynamic = 'force-dynamic';

// The signed-in wallet's X handle and social quests, and the Season 1 post id for the intent links.
export async function GET() {
  const wallet = await sessionWallet();
  if (!wallet) return ok({ signedIn: false, postId: seasonPostId() });
  const state = await getSocialState(wallet);
  if (!state) return fail(503, 'Quests are not available right now. Try again in a minute.');
  return ok({ signedIn: true, wallet, postId: seasonPostId(), ...state });
}
