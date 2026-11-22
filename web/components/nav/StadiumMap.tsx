'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { STAND_MOVES, hrefFor, standsFor, type Section, type Stand } from '@/lib/nav';
import { askWallet, pushRecent } from '@/lib/nav-store';
import { resolveInput } from '@/lib/client';
import type { PanelProps } from './NavHost';
import { Icon } from './icons';

const DIRS: Record<string, 'up' | 'down' | 'left' | 'right'> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

/** Pitch markings, 105 by 68, in both orientations. Hairlines only. */
function Markings({ portrait }: { portrait?: boolean }) {
  const g = (
    <g fill="none" stroke="currentColor" strokeWidth="0.5" vectorEffect="non-scaling-stroke">
      <rect x="0.5" y="0.5" width="104" height="67" />
      <path d="M52.5 0.5V67.5" />
      <circle cx="52.5" cy="34" r="9.15" />
      <rect x="0.5" y="13.85" width="16.5" height="40.3" />
      <rect x="88" y="13.85" width="16.5" height="40.3" />
      <rect x="0.5" y="24.85" width="5.5" height="18.3" />
      <rect x="99" y="24.85" width="5.5" height="18.3" />
      <circle cx="52.5" cy="34" r="0.6" fill="currentColor" />
    </g>
  );
  return portrait ? (
    <svg className="smap-lines smap-lines-p" viewBox="0 0 68 105" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
      <g transform="translate(68 0) rotate(90)">{g}</g>
    </svg>
  ) : (
    <svg className="smap-lines smap-lines-l" viewBox="0 0 105 68" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">{g}</svg>
  );
}

/**
 * The stadium map: the whole site drawn as a ground plan, one stand per destination.
 * Arrow keys walk between stands, Enter opens one, Esc closes. Under reduced motion it is a list.
 */
export default function StadiumMap({ tokens, wallet, here, onClose }: PanelProps) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const links = useRef(new Map<Section, HTMLElement>());
  const input = useRef<HTMLInputElement>(null);
  const uid = useId().replace(/[:«»]/g, '');
  const [active, setActive] = useState<Section | null>(null);
  const [asking, setAsking] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const w = wallet ?? null;
  const stands = useMemo(() => standsFor({ grounds: tokens.length, wallet: w }), [tokens.length, w]);
  const byId = useMemo(() => new Map(stands.map((s) => [s.id, s])), [stands]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (!d.open) d.showModal();
    (links.current.get(here ?? 'home') ?? links.current.get('home'))?.focus();
    if (wallet === undefined) askWallet();
    return () => {
      if (d.open) d.close();
    };
    // opened once per mount
  }, []);

  useEffect(() => {
    if (asking) input.current?.focus();
  }, [asking]);

  const go = (s: Stand, href: string) => {
    if (s.id !== 'docs') pushRecent({ href, label: s.label });
    onClose();
  };

  const onPlanKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const id = (e.target as HTMLElement).dataset?.stand as Section | undefined;
    if (!id) return;
    let next: Section | undefined;
    if (DIRS[e.key]) next = STAND_MOVES[id][DIRS[e.key]];
    else if (e.key === 'Home') next = 'home';
    else if (e.key === 'End') next = 'docs';
    else return;
    e.preventDefault();
    if (next) links.current.get(next)?.focus();
  };

  // Keep Tab inside the dialog (the page behind is inert, but the browser chrome is not).
  const onDialogKey = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key !== 'Tab') return;
    const f = [...(dialog.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])') ?? [])].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const submit = async () => {
    setBusy(true);
    setMsg('');
    const r = await resolveInput(value);
    setBusy(false);
    if (!r.ok) return setMsg(r.message);
    const href = `/statement/${r.address}`;
    pushRecent({ href, label: `Statement for ${r.name ?? `${r.address.slice(0, 6)}…${r.address.slice(-4)}`}` });
    onClose();
    router.push(href);
  };

  const shown = active ? byId.get(active) : null;
  const hereStand = here ? byId.get(here) : null;

  return (
    <dialog ref={dialog} className="smap" aria-labelledby={`${uid}-t`} aria-describedby={`${uid}-h`} aria-modal="true" onClose={() => !dialog.current?.open && onClose()} onKeyDown={onDialogKey}>
      <div className="smap-in">
        <div className="smap-head">
          <div>
            <h2 id={`${uid}-t`}>Stadium map</h2>
            <p id={`${uid}-h`}>Every part of Tropa Club is a stand in this ground. Arrow keys walk between them, Enter goes in, Esc closes.</p>
          </div>
          <button type="button" className="smap-x" onClick={onClose} aria-label="Close the map">
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div className="smap-stage">
          <ul className="smap-plan" onKeyDown={onPlanKey} onPointerLeave={() => setActive(null)}>
            {stands.map((s) => {
              const href = hrefFor(s.id, w);
              const isHere = here === s.id;
              const inner = (
                <>
                  <span className="smap-name">{s.label}{s.id === 'docs' && <Icon name="ext" size={14} />}</span>
                  <span className="smap-sub">{s.sub}</span>
                  <span className="smap-stand">{s.stand}</span>
                  {isHere && <span className="smap-here">You are here</span>}
                </>
              );
              const common = {
                className: 'smap-go',
                'data-stand': s.id,
                'aria-describedby': `${uid}-${s.id}`,
                ref: (el: HTMLElement | null) => {
                  if (el) links.current.set(s.id, el);
                  else links.current.delete(s.id);
                },
                onPointerEnter: () => setActive(s.id),
                onFocus: () => setActive(s.id),
              };
              return (
                <li key={s.id} className={`smap-area smap-${s.id}`} data-here={isHere || undefined}>
                  {s.id === 'docs' && href ? (
                    <a {...common} href={href} rel="noopener" onClick={() => go(s, href)}>{inner}</a>
                  ) : href ? (
                    <Link {...common} href={href} aria-current={isHere ? 'page' : undefined} onClick={() => go(s, href)}>{inner}</Link>
                  ) : (
                    <button {...common} type="button" aria-expanded={asking} aria-controls={`${uid}-f`} onClick={() => setAsking(true)}>{inner}</button>
                  )}
                  <span id={`${uid}-${s.id}`} className="smap-desc">{s.desc}</span>
                </li>
              );
            })}
            <li className="smap-pitch" role="presentation" aria-hidden="true">
              <Markings />
              <Markings portrait />
              <span className="smap-board">
                {shown ? (
                  <>
                    <b>{shown.label}</b>
                    <span>{shown.desc}</span>
                  </>
                ) : (
                  <>
                    <b>{hereStand ? `You are in ${hereStand.label}` : 'Tropa Club'}</b>
                    <span>Pick a stand to see what is there.</span>
                  </>
                )}
              </span>
            </li>
          </ul>
        </div>

        <div className="smap-foot">
          {asking ? (
            <form
              id={`${uid}-f`}
              className="smap-form"
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <label htmlFor={`${uid}-i`}>Whose statement? Paste a wallet or a base.eth name</label>
              <div className="find-row">
                <input ref={input} id={`${uid}-i`} value={value} onChange={(e) => setValue(e.target.value)} placeholder="0x… or yourname.base.eth" autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={msg ? true : undefined} aria-describedby={`${uid}-s`} />
                <button className="btn btn-accent" type="submit" disabled={busy}>{busy ? 'Looking…' : 'See statement'}</button>
              </div>
              <p id={`${uid}-s`} className="find-status tone-warn" role="status" aria-live="polite">{msg}</p>
            </form>
          ) : (
            <p className="smap-key" aria-hidden="true">
              <span><kbd>←</kbd><kbd>↑</kbd><kbd>→</kbd><kbd>↓</kbd> walk</span>
              <span><kbd>Enter</kbd> go in</span>
              <span><kbd>Esc</kbd> close</span>
              <span className="smap-key-alt"><kbd>/</kbd> jump to anything</span>
            </p>
          )}
        </div>
      </div>
    </dialog>
  );
}
