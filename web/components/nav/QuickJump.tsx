'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { pagesFor, scoreText, scoreToken, type JumpToken } from '@/lib/nav';
import { askWallet, pushRecent, readRecent, type Recent } from '@/lib/nav-store';
import { resolveInput } from '@/lib/client';
import { groundPath, kitFor } from '@/lib/clubs';
import { isAddress, shortAddr } from '@/lib/format';
import { Pennant } from '@/components/ds/Pennant';
import type { PanelProps } from './NavHost';
import { Icon, type Glyph } from './icons';

interface Item {
  key: string;
  group: string;
  label: string;
  sub?: string;
  href?: string;
  ext?: boolean;
  /** A ground's ticker, for its pennant. */
  symbol?: string;
  glyph?: Glyph;
  /** A name to look up before going anywhere. */
  lookup?: string;
}

const NAME = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

/** Quick jump: one box for every page, every ground, and any wallet or base.eth name. */
export default function QuickJump({ tokens, ground, wallet, onClose }: PanelProps) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const uid = useId().replace(/[:«»]/g, '');
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [recent, setRecent] = useState<Recent[]>([]);

  const groundName = useMemo(() => tokens.find(([s]) => groundPath(s) === ground)?.[1] ?? 'NVIDIA', [tokens, ground]);
  const pages = useMemo(() => pagesFor(ground, groundName), [ground, groundName]);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    input.current?.focus();
    setRecent(readRecent());
    if (wallet === undefined) askWallet();
    return () => {
      if (d?.open) d.close();
    };
    // opened once per mount
  }, []);

  const items = useMemo<Item[]>(() => {
    const v = q.trim();
    const mine: Item[] = wallet
      ? [
          { key: 'my-ticket', group: 'Your wallet', label: 'Your ticket', sub: shortAddr(wallet), href: `/ticket/${wallet}`, glyph: 'ticket' },
          { key: 'my-statement', group: 'Your wallet', label: 'Your statement', sub: 'Cost basis and results', href: `/statement/${wallet}`, glyph: 'statement' },
        ]
      : [];
    if (!v) {
      const rec: Item[] = recent.map((r) => ({ key: `r:${r.href}`, group: 'Recent', label: r.label, href: r.href, glyph: 'recent' }));
      const seen = new Set(recent.map((r) => r.href));
      const start = pages.filter((p) => !seen.has(p.href)).slice(0, 5).map<Item>((p) => ({ key: `p:${p.label}`, group: 'Pages', label: p.label, sub: p.sub, href: p.href, glyph: 'page' }));
      return [...mine, ...rec, ...start];
    }
    if (isAddress(v)) {
      const a = v.toLowerCase();
      return [
        { key: 'w-ticket', group: 'Wallet', label: `Ticket for ${shortAddr(a)}`, sub: 'Its rank in every ground it is in', href: `/ticket/${a}`, glyph: 'ticket' },
        { key: 'w-statement', group: 'Wallet', label: `Statement for ${shortAddr(a)}`, sub: 'Its cost basis and results', href: `/statement/${a}`, glyph: 'statement' },
      ];
    }
    if (/^0x/i.test(v)) return [];
    const out: Item[] = [];
    if (NAME.test(v) && v.includes('.')) out.push({ key: 'name', group: 'Wallet', label: `Find the wallet for ${v.toLowerCase()}`, sub: 'Then open its ticket', lookup: v.toLowerCase(), glyph: 'ticket' });
    const g = tokens
      .map((t) => ({ t, s: scoreToken(v, t) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8);
    const p = [...pages, ...(wallet ? [] : [{ label: 'Your statement', sub: 'Paste a wallet here to open one', href: '', keys: 'statement cost basis' }])]
      .map((x) => ({ x, s: scoreText(v, x.label, `${x.sub} ${x.keys}`) }))
      .filter((y) => y.s > 0 && y.x.href)
      .sort((a, b) => b.s - a.s)
      .slice(0, 6);
    const gi = g.map<Item>(({ t: [sym, name] }) => ({ key: `g:${sym}`, group: 'Grounds', label: `${name} ground`, sub: `Holders of ${sym}`, href: groundPath(sym), symbol: sym }));
    const pi = p.map<Item>(({ x }) => ({ key: `p:${x.label}`, group: 'Pages', label: x.label, sub: x.sub, href: x.href, ext: 'ext' in x ? x.ext : undefined, glyph: 'ext' in x && x.ext ? 'ext' : 'page' }));
    const mi = mine.filter((m) => scoreText(v, m.label, 'ticket statement wallet my') > 0);
    const groundsFirst = (g[0]?.s ?? 0) >= (p[0]?.s ?? 0);
    return [...out, ...mi, ...(groundsFirst ? [...gi, ...pi] : [...pi, ...gi])];
  }, [q, tokens, pages, recent, wallet]);

  useEffect(() => {
    setActive(0);
    setMsg('');
  }, [q]);

  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`#${uid}-o-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, uid]);

  const hint = (() => {
    const v = q.trim();
    if (/^0x/i.test(v) && !isAddress(v)) return 'A wallet address starts with 0x and has 42 characters.';
    if (v && !items.length) return `Nothing called “${v}”. Try a ticker such as NVDA, a page such as League, or paste a wallet.`;
    return '';
  })();

  const choose = async (it: Item | undefined) => {
    if (!it || busy) return;
    if (it.lookup) {
      setBusy(true);
      setMsg('Looking up the name…');
      const r = await resolveInput(it.lookup);
      setBusy(false);
      if (!r.ok) return setMsg(r.message);
      const href = `/ticket/${r.address}`;
      pushRecent({ href, label: `Ticket for ${it.lookup}` });
      onClose();
      return router.push(href);
    }
    if (!it.href) return;
    if (it.ext) {
      onClose();
      window.location.assign(it.href);
      return;
    }
    pushRecent({ href: it.href, label: it.label });
    onClose();
    router.push(it.href);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (a + d + items.length) % items.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(items[active]);
    } else if (e.key === 'Tab') {
      // two stops only: the box and Close
      e.preventDefault();
      dialog.current?.querySelector<HTMLElement>('.qj-x')?.focus();
    }
  };

  let lastGroup = '';
  const rows: ReactNode[] = [];
  items.forEach((it, i) => {
    if (it.group !== lastGroup) {
      lastGroup = it.group;
      rows.push(<li key={`h:${it.group}`} role="presentation" className="qj-group">{it.group}</li>);
    }
    rows.push(
      <li
        key={it.key}
        id={`${uid}-o-${i}`}
        role="option"
        aria-selected={i === active}
        className="qj-opt"
        onPointerMove={() => i !== active && setActive(i)}
        onClick={() => choose(it)}
      >
        <span className="qj-ic" aria-hidden="true">{it.symbol ? <Pennant kit={kitFor(it.symbol)} width={18} /> : <Icon name={it.glyph ?? 'page'} size={18} />}</span>
        <span className="qj-text">
          <b>{it.label}</b>
          {it.sub && <small>{it.sub}</small>}
        </span>
        {i === active && <kbd className="qj-enter" aria-hidden="true">Enter</kbd>}
      </li>,
    );
  });

  const status = msg || hint || (q.trim() ? `${items.length} ${items.length === 1 ? 'result' : 'results'}` : '');

  return (
    <dialog
      ref={dialog}
      className="qj"
      aria-labelledby={`${uid}-l`}
      aria-modal="true"
      onClose={() => !dialog.current?.open && onClose()}
      onClick={(e) => e.target === dialog.current && onClose()}
    >
      <div className="qj-in">
        <div className="qj-bar">
          <label id={`${uid}-l`} htmlFor={`${uid}-i`} className="qj-label">
            <Icon name="search" />
            <span className="sr">Jump to a page, ground or wallet</span>
          </label>
          <input
            ref={input}
            id={`${uid}-i`}
            className="qj-input"
            role="combobox"
            aria-expanded={items.length > 0}
            aria-controls={`${uid}-list`}
            aria-autocomplete="list"
            aria-activedescendant={items[active] ? `${uid}-o-${active}` : undefined}
            aria-describedby={`${uid}-s`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Page, ticker, company, 0x… or name.base.eth"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
          />
          <button
            type="button"
            className="qj-x"
            onClick={onClose}
            onKeyDown={(e) => {
              if (e.key === 'Tab') {
                e.preventDefault();
                input.current?.focus();
              }
            }}
            aria-label="Close quick jump"
          >
            <span className="qj-x-key" aria-hidden="true">Esc</span>
            <span className="qj-x-word" aria-hidden="true">Close</span>
          </button>
        </div>
        <ul ref={list} id={`${uid}-list`} role="listbox" aria-label="Results" className="qj-list">
          {rows}
        </ul>
        <p id={`${uid}-s`} className={`qj-status${msg || hint ? '' : ' sr'}${(msg && !busy) || hint ? ' tone-warn' : ''}`} role="status" aria-live="polite">{status}</p>
        <p className="qj-foot" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> move</span>
          <span><kbd>Enter</kbd> open</span>
          <span><kbd>Esc</kbd> close</span>
        </p>
      </div>
    </dialog>
  );
}
