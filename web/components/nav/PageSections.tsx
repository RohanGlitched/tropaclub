'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';

export interface PageSection {
  id: string;
  label: string;
  /** Hidden where clubs are not offered (the region gate), like the section itself. */
  clubsOnly?: boolean;
}

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Scroll to a section, put its id in the address bar, and move focus there for keyboard users. */
export function goToSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
  try {
    history.replaceState(history.state, '', `#${id}`);
  } catch {
    /* some embedded browsers refuse: the scroll still happens */
  }
  if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
  el.focus({ preventScroll: true });
}

/**
 * "On this page": a sticky rail beside the content on wide screens, a sticky row of chips under the
 * header on tablets and phones. Both list the same sections; the one you are reading is marked, and a
 * thin line shows how far down the page you are. One component, fed by each page.
 */
export default function PageSections({ sections, label = 'On this page' }: { sections: PageSection[]; label?: string }) {
  const [active, setActive] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const chips = useRef<HTMLDivElement>(null);
  const ids = sections.map((s) => s.id).join(' ');

  // The current section: the last one whose top has passed a line a third of the way down the
  // screen. The observer only says when something crossed that line; the rectangles decide.
  useEffect(() => {
    const els = ids.split(' ').map((id) => document.getElementById(id)).filter((e): e is HTMLElement => !!e && e.offsetParent !== null);
    if (!els.length) return;
    let raf = 0;
    const pick = () => {
      raf = 0;
      const line = Math.min(window.innerHeight * 0.33, 260);
      let cur: string | null = null;
      for (const el of els) if (el.getBoundingClientRect().top <= line) cur = el.id;
      // at the very bottom, the last section is the current one even if it is short
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) cur = els[els.length - 1].id;
      setActive(cur);
    };
    const later = () => {
      if (!raf) raf = requestAnimationFrame(pick);
    };
    const io = new IntersectionObserver(later, { rootMargin: '-33% 0px -60% 0px', threshold: [0, 1] });
    els.forEach((el) => io.observe(el));
    // the bottom of the page crosses no line, so a scroll listener catches the last section
    window.addEventListener('scroll', later, { passive: true });
    pick();
    return () => {
      io.disconnect();
      window.removeEventListener('scroll', later);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ids]);

  // How far down the page: one CSS variable, written outside React so scrolling never re-renders.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let raf = 0;
    const tick = () => {
      raf = 0;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      el.style.setProperty('--psec-p', p.toFixed(4));
    };
    const on = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    tick();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on, { passive: true });
    return () => {
      window.removeEventListener('scroll', on);
      window.removeEventListener('resize', on);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // The active chip slides into view inside its own row (never scrolls the page).
  useEffect(() => {
    const row = chips.current;
    if (!row || !active || row.offsetParent === null) return;
    const chip = row.querySelector<HTMLElement>(`[data-id="${CSS.escape(active)}"]`);
    if (!chip) return;
    const left = chip.offsetLeft - 16;
    const right = chip.offsetLeft + chip.offsetWidth + 16;
    if (left < row.scrollLeft || right > row.scrollLeft + row.clientWidth) {
      row.scrollTo({ left: Math.max(0, left), behavior: reduced() ? 'auto' : 'smooth' });
    }
  }, [active]);

  const onClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    setActive(id);
    goToSection(id);
  };

  const toTop = () => {
    window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' });
    try {
      history.replaceState(history.state, '', location.pathname + location.search);
    } catch {
      /* ignore */
    }
  };

  const link = (s: PageSection, cls: string) => (
    <a
      key={s.id}
      href={`#${s.id}`}
      data-id={s.id}
      className={`${cls}${s.clubsOnly ? ' clubs-only' : ''}`}
      aria-current={active === s.id ? 'location' : undefined}
      onClick={(e) => onClick(e, s.id)}
    >
      {s.label}
    </a>
  );

  return (
    <div className="psec" ref={root}>
      <nav className="psec-bar" aria-label={label}>
        <div className="psec-chips" ref={chips}>
          {sections.map((s) => link(s, 'psec-chip'))}
        </div>
        <span className="psec-line" aria-hidden="true" />
      </nav>
      <div className="psec-col">
        <nav className="psec-rail" aria-label={label}>
          <p className="psec-title" aria-hidden="true">{label}</p>
          <div className="psec-list">
            <span className="psec-track" aria-hidden="true" />
            {sections.map((s) => link(s, 'psec-item'))}
          </div>
          <button type="button" className="psec-top" onClick={toTop}>
            <Icon name="up" size={16} />
            <span>Back to top</span>
          </button>
        </nav>
      </div>
    </div>
  );
}
