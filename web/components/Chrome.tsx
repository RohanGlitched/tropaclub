import Link from 'next/link';
import type { ReactNode } from 'react';
import { Lockup, Mark } from './ds/Logo';
import ThemeToggle from './ThemeToggle';
import RegionGate from './RegionGate';
import { fmtDate } from '@/lib/format';
import { DOCS_URL, TAGLINE, X_URL } from '@/lib/site';
import type { Source } from '@/lib/server/data';

export function SiteHeader({ source, ground = '/ground/NVDAc', end, sampleClubs = false }: { source: Source; ground?: string; end?: ReactNode; sampleClubs?: boolean }) {
  return (
    <>
      <header className="site-header">
        <div className="wrap site-header-in">
          <Link href="/" className="brand" aria-label="Tropa Club home">
            <span className="brand-lockup"><Lockup height={26} /></span>
            <span className="brand-mark"><Mark size={28} /></span>
          </Link>
          <nav aria-label="Main">
            <Link href="/attendance">Attendance</Link>
            <Link href={ground}>The Ground</Link>
            <Link href="/clubs">Clubs</Link>
            <Link href="/league" className="nav-wide nav-mid">League</Link>
            <Link href="/about" className="nav-wide">About</Link>
            <a href={DOCS_URL} className="nav-wide">Docs</a>
          </nav>
          <div className="site-header-end">
            {end ?? <Link href="/#find" className="btn btn-accent btn-sm header-cta">Find your seat</Link>}
            <ThemeToggle />
          </div>
        </div>
      </header>
      {(source === 'mock' || sampleClubs) && (
        <p className="sample" role="note">
          <span className="wrap">
            <b>Sample data.</b>{' '}
            {source === 'mock' ? 'Seven clubs show the counts measured on 21 Nov 2026. The other clubs and all wallets are simulated until the indexer’s first run is published.' : ''}
            {sampleClubs ? ' Clubs, members and Matchday scores on this page are made up for preview.' : ''}
          </span>
        </p>
      )}
      <RegionGate />
    </>
  );
}

const XGlyph = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
    <path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

type FootLink = { label: string; href: string; ext?: boolean };
const COLUMNS: { title: string; links: FootLink[] }[] = [
  {
    title: 'Product',
    links: [
      { label: 'The Ground', href: '/ground/NVDAc' },
      { label: 'The Attendance', href: '/attendance' },
      { label: 'Clubs', href: '/clubs' },
      { label: 'League', href: '/league' },
      { label: 'Stats', href: '/stats' },
    ],
  },
  {
    title: 'Learn',
    links: [
      { label: 'How it works', href: '/about' },
      { label: 'Docs', href: DOCS_URL, ext: true },
      { label: 'Real holders method', href: `${DOCS_URL}/the-ground`, ext: true },
      { label: 'Data feed', href: `${DOCS_URL}/data-feed`, ext: true },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'For partners', href: `${DOCS_URL}/for-partners`, ext: true },
      { label: 'Contact', href: X_URL, ext: true },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Compliance and limits', href: `${DOCS_URL}/compliance`, ext: true },
      { label: 'Privacy', href: '/about#privacy' },
    ],
  },
];

export function SiteFooter({ source, asOf, ground }: { source: Source; asOf?: string; block?: number; ground?: string }) {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="foot-top">
          <div className="foot-brand">
            <Link href="/" aria-label="Tropa Club home" className="foot-logo"><Lockup height={30} /></Link>
            <p>{TAGLINE}</p>
          </div>
          <div className="foot-actions">
            <Link href="/#find" className="btn btn-accent">Find your seat</Link>
            <a href={X_URL} rel="noopener" className="foot-x"><XGlyph /><span>@tropaclubxyz</span></a>
          </div>
        </div>
        <nav className="foot-cols" aria-label="Footer">
          {COLUMNS.map((c) => (
            <div key={c.title} className="foot-col">
              <h2>{c.title}</h2>
              <ul>
                {c.links.map((l) => (
                  <li key={l.label}>
                    {l.ext ? <a href={l.href} rel="noopener">{l.label}</a> : <Link href={l.label === 'The Ground' && ground ? ground : l.href}>{l.label}</Link>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="foot-bar">
          <p className="foot-copy"><Mark size={16} /> <span>© 2026 Tropa Club</span></p>
          <p>Stock tokens track the share price; they are not shares. Not available to US persons.</p>
          <p>
            {asOf ? <>Data as of <time dateTime={asOf}>{fmtDate(asOf, true)}</time>{source === 'mock' ? ' (sample)' : ''}</> : 'Data refreshed daily'}
          </p>
          <p><a href="https://db-ip.com" rel="noopener">IP geolocation by DB-IP</a> (CC BY 4.0)</p>
        </div>
      </div>
    </footer>
  );
}
