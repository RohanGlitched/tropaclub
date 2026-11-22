/**
 * Season 1 admin (server side only, with your own gcloud credentials; nothing here is reachable
 * from the site). Run from clubs/:
 *
 *   npx tsx scripts/season-admin.ts claims [claimed|verified|rejected]   the spot-check list (CSV)
 *   npx tsx scripts/season-admin.ts social <wallet> <follow|like_repost|post> <verified|rejected> [note]
 *   npx tsx scripts/season-admin.ts provisional                           provisional wallets (CSV)
 *   npx tsx scripts/season-admin.ts decide <wallet> <kept|dropped> [note]
 *   npx tsx scripts/season-admin.ts stats                                  the public numbers
 *   npx tsx scripts/season-admin.ts allocation                             caps and share per wallet (CSV)
 *
 * A rejected social claim's Caps are voided by the next Caps run (the hourly scouts job).
 */
import { createClubsService } from '../src/service';
import { createFirestoreStore } from '../src/store/firestore';
import { SEASON_COL, isSocialQuest, type SeasonWalletDoc } from '../src/season';

const [cmd, ...args] = process.argv.slice(2);
const svc = createClubsService({ store: createFirestoreStore() });
const iso = (t: number | null) => (t ? new Date(t * 1000).toISOString() : '');
const csv = (rows: (string | number | null)[][]) => rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');

async function main() {
  switch (cmd) {
    case 'claims': {
      const status = args[0] as 'claimed' | 'verified' | 'rejected' | undefined;
      const rows = await svc.listSocialClaims(status);
      console.log(csv([['wallet', 'handle', 'quest', 'claimedAt', 'status', 'postId', 'profile', 'reviewNote'], ...rows.map((c) => [c.wallet, c.handle, c.quest, iso(c.claimedAt), c.status, c.postId, `https://x.com/${c.handle}`, c.reviewNote])]));
      return;
    }
    case 'social': {
      const [wallet, quest, status, ...note] = args;
      if (!wallet || !isSocialQuest(quest) || (status !== 'verified' && status !== 'rejected')) throw new Error('usage: social <wallet> <follow|like_repost|post> <verified|rejected> [note]');
      await svc.reviewSocial(wallet, quest, status, note.join(' ') || undefined);
      console.log(`social:${status} ${wallet} ${quest}`);
      return;
    }
    case 'provisional': {
      const store = createFirestoreStore();
      const rows = (await store.query<SeasonWalletDoc>(SEASON_COL.wallets, { where: [['provisional', '==', true]] })).sort((a, b) => (a.firstBuyAt ?? 0) - (b.firstBuyAt ?? 0));
      console.log(csv([['wallet', 'reason', 'bornAt', 'firstBuyAt', 'decision', 'note'], ...rows.map((d) => [d.wallet, d.provisionalReason, iso(d.bornAt), iso(d.firstBuyAt), d.decision, d.decisionNote])]));
      return;
    }
    case 'decide': {
      const [wallet, decision, ...note] = args;
      if (!wallet || (decision !== 'kept' && decision !== 'dropped')) throw new Error('usage: decide <wallet> <kept|dropped> [note]');
      await svc.decideProvisional(wallet, decision, note.join(' ') || undefined);
      console.log(`${decision} ${wallet}`);
      return;
    }
    case 'stats':
      console.log(JSON.stringify(await svc.seasonStats(), null, 2));
      return;
    case 'allocation': {
      const rows = await svc.seasonAllocation();
      console.log(csv([['wallet', 'caps', 'status', 'share'], ...rows.map((r) => [r.wallet, r.caps, r.status, r.share.toFixed(8)])]));
      return;
    }
    default:
      throw new Error('commands: claims, social, provisional, decide, stats, allocation');
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
