'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { sectionOf, type Section } from '@/lib/nav';
import { openPanel } from '@/lib/nav-store';
import { Icon } from './icons';
import { preloadPanels } from './NavHost';

export interface HeaderLink { label: string; href: string; section: Section; className?: string; ext?: boolean }

/** The main header links, with the current section marked (aria-current plus a visible bar). */
export function HeaderNav({ links }: { links: HeaderLink[] }) {
  const here = sectionOf(usePathname());
  return (
    <nav aria-label="Main">
      {links.map((l) =>
        l.ext ? (
          <a key={l.label} href={l.href} className={l.className} rel="noopener">{l.label}</a>
        ) : (
          <Link key={l.label} href={l.href} className={l.className} aria-current={here === l.section ? 'page' : undefined}>{l.label}</Link>
        ),
      )}
    </nav>
  );
}

/** Quick jump and the stadium map, in the header. Text on wide screens, icons on phones. */
export function HeaderTools() {
  // "Ctrl K" for everyone at first paint; Apple keyboards get "⌘K" once the browser says so
  const [keys, setKeys] = useState('Ctrl K');
  useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    if (/mac|iphone|ipad|ipod/i.test(nav.userAgentData?.platform || nav.platform || nav.userAgent)) setKeys('⌘K');
  }, []);
  return (
    <>
      <button type="button" className="nav-tool nav-tool-jump" onClick={(e) => openPanel('jump', e.currentTarget)} onPointerEnter={() => preloadPanels('jump')} onFocus={() => preloadPanels('jump')} aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K /" aria-label="Jump to a page, ground or wallet">
        <Icon name="search" />
        <span className="nav-tool-text" aria-hidden="true">Jump to</span>
        <kbd className="nav-tool-kbd" aria-hidden="true" suppressHydrationWarning>{keys}</kbd>
      </button>
      <button type="button" className="nav-tool nav-tool-map" onClick={(e) => openPanel('map', e.currentTarget)} onPointerEnter={() => preloadPanels('map')} onFocus={() => preloadPanels('map')} aria-haspopup="dialog" aria-label="Stadium map of the site">
        <svg className="nav-tool-pennant" viewBox="0 0 42 53" width="15" height="19" aria-hidden="true" focusable="false">
          <path d="M1 1H41V51L21 34L1 51Z" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
          <path d="M1 14H41V26H1Z" fill="currentColor" />
        </svg>
        <span className="nav-tool-text" aria-hidden="true">Map</span>
      </button>
    </>
  );
}
