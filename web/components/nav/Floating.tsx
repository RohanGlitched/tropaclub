'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { sectionOf } from '@/lib/nav';
import { anyDialogOpen, openPanel } from '@/lib/nav-store';
import { Icon, type Glyph } from './icons';
import { preloadPanels } from './NavHost';

/** True while a dialog is open, or (on touch screens) while the on-screen keyboard is up. */
function useChromeHidden(): boolean {
  const [dialog, setDialog] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const mo = new MutationObserver(() => setDialog(anyDialogOpen()));
    mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
    setDialog(anyDialogOpen());

    const coarse = window.matchMedia('(pointer: coarse)');
    const vv = window.visualViewport;
    let typing = false;
    let shrunk = false;
    const update = () => setKeyboard(typing || shrunk);
    // pinch zoom also shrinks the visual viewport, so compare at scale 1
    const onResize = () => {
      shrunk = !!vv && window.innerHeight - vv.height * vv.scale > 140;
      update();
    };
    const field = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !/^(button|checkbox|radio|submit|reset|range|color|file)$/i.test((t as HTMLInputElement).type)));
    const onIn = (e: FocusEvent) => {
      if (!coarse.matches) return;
      typing = field(e.target);
      update();
    };
    const onOut = (e: FocusEvent) => {
      if (!field(e.relatedTarget)) {
        typing = false;
        update();
      }
    };
    vv?.addEventListener('resize', onResize);
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => {
      mo.disconnect();
      vv?.removeEventListener('resize', onResize);
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    };
  }, []);
  return dialog || keyboard;
}

const TABS: { label: string; glyph: Glyph; href: (g: string) => string; section: string }[] = [
  { label: 'Home', glyph: 'home', href: () => '/', section: 'home' },
  { label: 'Grounds', glyph: 'seat', href: (g) => g, section: 'ground' },
  { label: 'Clubs', glyph: 'clubs', href: () => '/clubs', section: 'clubs' },
  { label: 'League', glyph: 'league', href: () => '/league', section: 'league' },
];

const R = 21;
const C = 2 * Math.PI * R;

/** Phones: a fixed bar with the four main destinations and the map. Plus the back-to-top button everywhere. */
export default function Floating({ ground }: { ground: string }) {
  const here = sectionOf(usePathname());
  const hidden = useChromeHidden();
  const ring = useRef<SVGCircleElement>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    let raf = 0;
    let shown = false;
    const tick = () => {
      raf = 0;
      const y = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
      if (ring.current) ring.current.style.strokeDashoffset = String(C * (1 - p));
      const next = y > window.innerHeight * 1.5;
      if (next !== shown) {
        shown = next;
        setShow(next);
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    tick();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  const toTop = () => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const main = document.getElementById('main');
    const focus = () => {
      if (!main) return;
      if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
      main.focus({ preventScroll: true });
    };
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    if (reduce) return focus();
    if ('onscrollend' in window) {
      const t = setTimeout(focus, 1500);
      window.addEventListener('scrollend', () => { clearTimeout(t); focus(); }, { once: true });
    } else setTimeout(focus, 600);
  };

  return (
    <>
      <button type="button" className="totop" data-show={show && !hidden ? '' : undefined} onClick={toTop} aria-label="Back to top">
        <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" focusable="false">
          <circle cx="24" cy="24" r={R} className="totop-track" />
          <circle ref={ring} cx="24" cy="24" r={R} className="totop-ring" strokeDasharray={C} strokeDashoffset={C} transform="rotate(-90 24 24)" />
        </svg>
        <Icon name="up" size={18} />
      </button>
      <nav className="bbar" aria-label="Quick links" data-hidden={hidden ? '' : undefined}>
        <ul>
          {TABS.map((t) => (
            <li key={t.label}>
              <Link href={t.href(ground)} aria-current={here === t.section ? 'page' : undefined}>
                <Icon name={t.glyph} />
                <span>{t.label}</span>
              </Link>
            </li>
          ))}
          <li>
            <button type="button" onClick={(e) => openPanel('map', e.currentTarget)} onPointerDown={() => preloadPanels('map')} aria-haspopup="dialog" aria-label="Map of the site">
              <Icon name="map" />
              <span aria-hidden="true">Map</span>
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
