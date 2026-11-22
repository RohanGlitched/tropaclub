import Link from 'next/link';
import type { ReactNode } from 'react';
import MyTicketLink from './MyTicketLink';
import MapCard from './MapCard';

export interface Crumb { label: ReactNode; href?: string }

/** "You are here": Home › … › this page. The last crumb is the current page; the note is dropped on phones. */
export function Crumbs({ trail, note }: { trail: Crumb[]; note?: ReactNode }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      <ol>
        <li><Link href="/">Home</Link></li>
        {trail.map((c, i) => (
          <li key={i}>
            {c.href && i < trail.length - 1 ? <Link href={c.href}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
          </li>
        ))}
      </ol>
      {note && <span className="crumbs-note">{note}</span>}
    </nav>
  );
}

/** A destination in the Next strip. `mine: 'ticket'` points at the signed-in wallet's ticket when it is known. */
export type NextItem = { title: string; sub: string; href: string; mine?: undefined } | { title: string; sub: string; mine: 'ticket'; href?: undefined };

/** The logical next page, near the bottom of each page. */
export function NextStrip({ items }: { items: NextItem[] }) {
  return (
    <nav className="next-strip" aria-label="Where next">
      <div className="wrap next-in">
        <p className="next-label" aria-hidden="true">Next</p>
        <ul>
          {items.map((it) => (
            <li key={it.title}>
              {it.mine ? (
                <MyTicketLink className="next-go" title={it.title} sub={it.sub} />
              ) : (
                <Link className="next-go" href={it.href} prefetch={false}>
                  <span className="next-title">{it.title}</span>
                  <span className="next-sub">{it.sub}</span>
                  <span className="next-arrow" aria-hidden="true">→</span>
                </Link>
              )}
            </li>
          ))}
          <li>
            <MapCard />
          </li>
        </ul>
      </div>
    </nav>
  );
}
