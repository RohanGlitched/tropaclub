'use client';

import { openPanel } from '@/lib/nav-store';
import { preloadPanels } from './NavHost';

/** The last card of every Next strip: opens the stadium map of the whole site. */
export default function MapCard() {
  return (
    <button type="button" className="next-go next-map" onClick={(e) => openPanel('map', e.currentTarget)} onPointerEnter={() => preloadPanels('map')} onFocus={() => preloadPanels('map')} aria-haspopup="dialog">
      <span className="next-title">See the whole site</span>
      <span className="next-sub">The stadium map: every page on one plan</span>
      <span className="next-arrow next-pennant" aria-hidden="true">
        <svg viewBox="0 0 42 53" width="18" height="23" focusable="false">
          <path d="M1 1H41V51L21 34L1 51Z" fill="none" stroke="currentColor" strokeWidth="4" strokeLinejoin="round" />
          <path d="M1 14H41V26H1Z" fill="currentColor" />
        </svg>
      </span>
    </button>
  );
}
