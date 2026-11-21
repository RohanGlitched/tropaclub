'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

export interface MenuLink {
  label: string;
  href: string;
  ext?: boolean;
  note?: string;
}

/** Phone navigation: a Menu button that opens a full-height sheet with every destination. */
export default function MobileMenu({ links }: { links: MenuLink[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <>
      <button type="button" className="menu-btn" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open}>
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M2 5h16M2 10h16M2 15h16" stroke="currentColor" strokeWidth="2" /></svg>
        <span>Menu</span>
      </button>
      <dialog ref={ref} className="menu-sheet" aria-label="Menu" onClose={() => setOpen(false)} onClick={(e) => e.target === ref.current && setOpen(false)}>
        <div className="menu-in">
          <div className="menu-head">
            <span>Menu</span>
            <button type="button" className="buy-x" onClick={() => setOpen(false)} aria-label="Close menu">×</button>
          </div>
          <nav aria-label="All pages">
            {links.map((l) =>
              l.ext ? (
                <a key={l.label} href={l.href} rel="noopener" onClick={() => setOpen(false)}><b>{l.label}</b>{l.note && <small>{l.note}</small>}</a>
              ) : (
                <Link key={l.label} href={l.href} onClick={() => setOpen(false)}><b>{l.label}</b>{l.note && <small>{l.note}</small>}</Link>
              ),
            )}
          </nav>
        </div>
      </dialog>
    </>
  );
}
