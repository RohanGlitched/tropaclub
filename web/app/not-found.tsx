import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/Chrome';
import SeatSearchBox from '@/components/SeatSearchBox';
import { getIndex } from '@/lib/server/data';
import { groundPath } from '@/lib/clubs';
import { Crumbs } from '@/components/nav/Wayfinding';
import { groundName } from '@/lib/site';

export const metadata = { title: 'Page not found' };

export default async function NotFound() {
  const { data, source } = await getIndex();
  const ground = groundPath(data.tokens[0].symbol);
  return (
    <>
      <SiteHeader source={source} ground={ground} />
      <main id="main">
        <section className="wrap page-head empty">
          <Crumbs trail={[{ label: 'Page not found' }]} />
          <div className="gate-shut" aria-hidden="true">
            {Array.from({ length: 28 }, (_, i) => <i key={i} className={i === 17 ? 'gone' : undefined} />)}
          </div>
          <h1>Block 404. There is no seat here.</h1>
          <p className="lede"><strong>Page not found.</strong> This page doesn&rsquo;t exist. It may have moved, or the link has a typo.</p>
          <p className="closing-links">
            <Link href="/">Home</Link>
            <Link href="/attendance">Stock rankings</Link>
            <Link href={ground}>{groundName(data.tokens[0].name, data.tokens[0].symbol)}</Link>
            <Link href="/about">How it works</Link>
          </p>
          <SeatSearchBox label="Or check a wallet" button="Check wallet" />
        </section>
      </main>
      <SiteFooter source={source} asOf={data.asOf} ground={ground} />
    </>
  );
}
