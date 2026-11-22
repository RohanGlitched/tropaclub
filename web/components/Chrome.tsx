import Link from 'next/link';
import type { ReactNode } from 'react';
import { Lockup, Mark } from './ds/Logo';
import ThemeToggle from './ThemeToggle';
import RegionGate from './RegionGate';
import { HeaderNav, HeaderTools } from './nav/HeaderNav';
import NavHost from './nav/NavHost';
import HeaderWallet from './nav/HeaderWallet';
import Floating from './nav/Floating';
import { fmtDate } from '@/lib/format';
import { DOCS_URL, TAGLINE, X_URL } from '@/lib/site';
import { jumpTokens, type JumpToken } from '@/lib/nav';
import { getIndex, type Source } from '@/lib/server/data';

/**
 * The header. `tokens` (every ground, compact) feeds quick jump; `wallet` is the signed-in wallet
 * when the page knows it (club pages), so the map and "your ticket" links can point at it.
 */
export async function SiteHeader({ source, ground = '/ground/NVDAc', end, sampleClubs = false, tokens, wallet }: { source: Source; ground?: string; end?: ReactNode; sampleClubs?: boolean; tokens?: JumpToken[]; wallet?: string | null }) {
  const list = tokens ?? jumpTokens((await getIndex()).data.tokens);
  return (
    <>
      <header className="site-header">
        <div className="wrap site-header-in">
          <Link href="/" className="brand" aria-label="Tropa Club home">
            <span className="brand-lockup"><Lockup height={26} /></span>
            <span className="brand-mark"><Mark size={28} /></span>
          </Link>
          <HeaderNav
            links={[
              { label: 'Stock rankings', href: '/attendance', section: 'attendance' },
              { label: 'Grounds', href: ground, section: 'ground' },
              { label: 'Clubs', href: '/clubs', section: 'clubs' },
              { label: 'League', href: '/league', section: 'league', className: 'nav-wide nav-mid' },
              { label: 'How it works', href: '/about', section: 'about', className: 'nav-wide' },
              { label: 'Docs', href: DOCS_URL, section: 'docs', className: 'nav-wide', ext: true },
            ]}
          />
          <div className="site-header-end">
            <HeaderTools />
            {end ?? <HeaderWallet />}
            <ThemeToggle />
          </div>
        </div>
      </header>
      <NavHost tokens={list} ground={ground} wallet={wallet} />
      {(source === 'mock' || sampleClubs) && (
        <p className="sample" role="note">
          <span className="wrap">
            <b>Sample data.</b>{' '}
            {source === 'mock' ? 'Seven stock tokens show the counts measured on 21 Nov 2026. The other tokens and all wallets are simulated until the indexer’s first run is published.' : ''}
            {sampleClubs ? ' Clubs, members and Matchday cards on this page are made up for preview.' : ''}
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
      { label: 'Grounds', href: '/ground/NVDAc' },
      { label: 'Stock rankings', href: '/attendance' },
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
      { label: 'Contact', href: '/about#contact' },
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

function Footer({ source, asOf, ground }: { source: Source; asOf?: string; block?: number; ground?: string }) {
  return (
    <footer className="site-footer">
      <div className="wrap">
        <div className="foot-top">
          <div className="foot-brand">
            <Link href="/" aria-label="Tropa Club home" className="foot-logo"><Lockup height={30} /></Link>
            <p>{TAGLINE}</p>
            <p>Tropa Club is a free site for Coinbase’s stock tokens on Base. It never holds your money.</p>
          </div>
          <div className="foot-actions">
            <Link href="/#find" className="btn btn-accent">Check my wallet</Link>
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
                    {l.ext ? <a href={l.href} rel="noopener">{l.label}</a> : <Link href={l.label === 'Grounds' && ground ? ground : l.href}>{l.label}</Link>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="foot-bar">
          <p className="foot-copy"><Mark size={16} /> <span>© 2026 Tropa Club</span></p>
          <p>Stock tokens track the share price; they are not shares. Buying through Tropa Club: not available to US persons or in sanctioned regions. Past results don’t predict future results. Nothing here is advice.</p>
          <p>
            {asOf ? <>Data as of <time dateTime={asOf}>{fmtDate(asOf, true)}</time>{source === 'mock' ? ' (sample)' : ''}</> : 'Data recounted every 6 hours'}
          </p>
          <p><a href="https://db-ip.com" rel="noopener">IP geolocation by DB-IP</a> (CC BY 4.0)</p>
        </div>
      </div>
    </footer>
  );
}

/** The footer, then the phone bottom bar and the back-to-top button (fixed, so their place in the page does not matter). */
export function SiteFooter(props: { source: Source; asOf?: string; block?: number; ground?: string }) {
  return (
    <>
      <Footer {...props} />
      <Floating ground={props.ground ?? '/ground/NVDAc'} />
    </>
  );
}
