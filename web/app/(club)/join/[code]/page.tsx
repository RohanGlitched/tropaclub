import type { Metadata } from 'next';
import Link from 'next/link';
import { InviteCodeForm, JoinButton } from '@/components/club/Actions';
import { Crest } from '@/components/ds/Pennant';
import { crestOf, tryClubs } from '@/lib/server/clubs';
import { fmtInt } from '@/lib/format';

export const metadata: Metadata = { title: 'You are invited to a club', robots: { index: false, follow: false } };

export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = raw.trim().toUpperCase();
  const valid = /^[A-Z0-9]{4,16}$/.test(code);
  const club = valid ? await tryClubs((svc) => svc.resolveInvite(code)) : null;

  if (!club) {
    return (
      <main id="main">
        <section className="wrap page-head empty">
          <h1>That invite does not open a club</h1>
          <p className="lede">The link may be mistyped or cut short. Ask your friend to send it again, or paste the code below.</p>
          <InviteCodeForm />
          <p className="closing-links"><Link href="/clubs">All about clubs</Link></p>
        </section>
      </main>
    );
  }
  const full = club.memberCount >= club.maxMembers;
  return (
    <main id="main">
      <section className="wrap page-head empty">
        <div className="club-title">
          <Crest recipe={crestOf(club)} width={64} raise title={`Crest of ${club.name}`} />
          <div>
            <h1>You are invited to {club.name}</h1>
            <p className="ground-line"><span className="num">{fmtInt(club.memberCount)}</span> {club.memberCount === 1 ? 'member' : 'members'}, <span className="num">{fmtInt(club.playingCount)}</span> playing</p>
          </div>
        </div>
        <p className="lede">
          {club.name} is a Tropa Club: friends who each put $10 a week into stock tokens from their own wallets. Taking a seat on the Bench is free and needs no buy.
        </p>
        <div className="join-go">
          {full ? <p className="notice">This club is full. Ask the founder to make room, or found your own.</p> : <JoinButton inviteCode={code} />}
          <Link className="btn" href={`/club/${club.id}`}>Look around first</Link>
        </div>
        <ul className="ticks">
          <li>Connecting shares only your wallet address. One free signature proves it is yours.</li>
          <li>Stock tokens track the share price. They are not shares. Nothing here is advice.</li>
          <li>Buying is not offered to US persons.</li>
        </ul>
      </section>
    </main>
  );
}
