'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { GLOSSARY, type TermId } from '@/lib/glossary';

/**
 * A word with a definition: dotted underline, and a small card on hover, focus or tap.
 * Esc or a tap elsewhere closes it. Definitions live in lib/glossary.ts.
 */
export default function Term({ id, children }: { id: TermId; children?: ReactNode }) {
  const g = GLOSSARY[id];
  const tipId = useId();
  const box = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);

  useEffect(() => {
    if (!open) return;
    const close = () => {
      pinned.current = false;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && close();
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  // keep the card inside the screen: shift it sideways, or open it upwards near the bottom
  useLayoutEffect(() => {
    const t = tip.current;
    if (!open || !t) return;
    t.style.setProperty('--shift', '0px');
    delete t.dataset.up;
    const r = t.getBoundingClientRect();
    const pad = 12;
    let dx = 0;
    if (r.right > window.innerWidth - pad) dx = window.innerWidth - pad - r.right;
    if (r.left + dx < pad) dx = pad - r.left;
    t.style.setProperty('--shift', `${Math.round(dx)}px`);
    if (r.bottom > window.innerHeight - pad && r.top - r.height > 80) t.dataset.up = '';
  }, [open]);

  return (
    <span
      className="term"
      ref={box}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setOpen(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && !pinned.current && setOpen(false)}
    >
      <button
        type="button"
        className="term-btn"
        aria-describedby={tipId}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          pinned.current = false;
          setOpen(false);
        }}
        onClick={() => {
          pinned.current = !pinned.current || !open;
          setOpen(pinned.current);
        }}
      >
        {children ?? g.term}
      </button>
      <span role="tooltip" id={tipId} ref={tip} className="term-tip" data-open={open ? '' : undefined}>
        <b>{g.term}</b> {g.def}
      </span>
    </span>
  );
}
