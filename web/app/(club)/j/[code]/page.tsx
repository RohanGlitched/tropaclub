import type { Metadata } from 'next';
import Link from 'next/link';
import { tryClubs } from '@/lib/server/clubs';
import { boardNames } from '@/lib/server/honours';
import { REGION_LINE, SCOUT_COPY } from '@/lib/site';

// A scout's personal invite link. The referral cookie is set by middleware; this page only says who sent it.
export const metadata: Metadata = { title: 'You are invited to Tropa Club', description: 'Tropa Club shows who really holds each stock token, and helps your group chat each buy about $10 a week from your own wallets.', robots: { index: false, follow: false } };

export default async function ScoutInvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = decodeURIComponent(raw).trim().toLowerCase();
  const scout = /^[0-9a-z]{6,12}$/.test(code) ? await tryClubs((svc) => svc.scoutOfCode(code), 4000) : null;

  if (!scout) {
    return (
      <main id="main">
        <section className="wrap page-head empty">
          <h1>This invite link isn&rsquo;t valid</h1>
          <p className="lede">The link may be mistyped or cut short. Ask your friend to send it again, or have a look around: clubs are free to join.</p>
          <p className="closing-links"><Link className="btn" href="/clubs">All about clubs</Link></p>
        </section>
      </main>
    );
  }
  const name = (await boardNames([scout], 2500)).get(scout)!;
  return (
    <main id="main">
      <section className="wrap page-head empty">
        <h1><span className={name.startsWith('0x') ? 'num addr' : undefined}>{name}</span> invited you to Tropa Club</h1>
        <p className="lede">
          Tropa Club shows who really holds each stock token, and helps your group chat each buy about $10 a week from your own wallets. There is no shared pot and no fee. Joining a club is free and needs no buy.
        </p>
        <div className="join-go">
          <Link className="btn btn-accent" href="/clubs#start">Start a club</Link>
          <Link className="btn" href="/clubs#join">Get matched into a club</Link>
        </div>
        <p className="muted">A club invite link from a friend works too: open it and join.</p>
        <ul className="ticks">
          <li>{SCOUT_COPY}</li>
          <li>Connecting shares only your wallet address. One free signature proves it is yours. It moves no funds.</li>
          <li>Buying: {REGION_LINE}</li>
        </ul>
      </section>
    </main>
  );
}
