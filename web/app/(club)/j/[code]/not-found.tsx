import Link from 'next/link';
import { Crumbs } from '@/components/nav/Wayfinding';

export const metadata = { title: 'Invite link not found', robots: { index: false, follow: false } };

// /j/<code> for a code that does not exist: a real 404, with the invite wording.
export default function InviteNotFound() {
  return (
    <main id="main">
      <section className="wrap page-head empty">
        <Crumbs trail={[{ label: 'Clubs', href: '/clubs' }, { label: 'Invite not found' }]} />
        <div className="gate-shut" aria-hidden="true">
          {Array.from({ length: 28 }, (_, i) => <i key={i} className={i === 17 ? 'gone' : undefined} />)}
        </div>
        <h1>This invite link isn&rsquo;t valid</h1>
        <p className="lede">The link may be mistyped or cut short. Ask your friend to send it again, or have a look around: clubs are free to join.</p>
        <p className="closing-links"><Link className="btn" href="/clubs">All about clubs</Link><Link href="/clubs#start">Start a club</Link></p>
      </section>
    </main>
  );
}
