'use client';

import { useEffect, useRef, useState } from 'react';
import { goToSection } from './PageSections';

/**
 * The small "#" after a section heading: a link to that section. Clicking it goes there, puts the
 * link in the address bar and copies it. It shows on hover or focus (always, faintly, on touch).
 */
export default function Anchor({ id, label }: { id: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);

  const onClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    goToSection(id);
    const url = `${location.origin}${location.pathname}${location.search}#${id}`;
    try {
      void navigator.clipboard?.writeText(url).then(
        () => {
          setCopied(true);
          if (t.current) clearTimeout(t.current);
          t.current = setTimeout(() => setCopied(false), 1800);
        },
        () => {},
      );
    } catch {
      /* no clipboard: the link is still in the address bar */
    }
  };

  return (
    <a className="h-anchor" href={`#${id}`} onClick={onClick} aria-label={`Link to this section: ${label}`}>
      <span aria-hidden="true">#</span>
      <span className="h-anchor-done" role="status">{copied ? 'Link copied' : ''}</span>
    </a>
  );
}
