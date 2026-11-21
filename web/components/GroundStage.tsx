'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TokenSummary, WalletSummary } from '@shared/types';
import Ground, { type Emphasis, type GroundHandle } from './Ground';
import { Pennant } from './ds/Pennant';
import { clubName, groundPath, kitFor } from '@/lib/clubs';
import { fmtInt, fmtPct, shortAddr } from '@/lib/format';
import { fetchWallet, resolveInput, useSeats } from '@/lib/client';
import { seatLabel } from '@/lib/stadium';
import { KIND_LABEL, seatIndexFor } from '@/lib/ticket';

export type Club = Pick<TokenSummary, 'symbol' | 'name' | 'holdersTotal' | 'realFans' | 'ghosts' | 'attendancePct'>;

interface Props {
  mode: 'hero' | 'ground';
  clubs: Club[]; // every club (for lookups)
  tabs?: string[]; // symbols offered as tabs (hero)
  initial: string;
  examples?: string[];
  /** Hero only: the paragraph under the headline. */
  lede?: ReactNode;
}

type Focus = { index: number; address?: string; mine: boolean; rank?: number | null; of?: number; kind?: string };
type Status = { tone: 'idle' | 'busy' | 'ok' | 'warn'; text: string; links?: { href: string; label: string }[] };

export default function GroundStage({ mode, clubs, tabs, initial, examples = [], lede }: Props) {
  const [symbol, setSymbol] = useState(initial);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [emphasis, setEmphasis] = useState<Emphasis>('all');
  const [status, setStatus] = useState<Status>({ tone: 'idle', text: '' });
  const [value, setValue] = useState('');
  const [zoomed, setZoomed] = useState(false);
  const [arrivalKey, setArrivalKey] = useState(true);
  const ground = useRef<GroundHandle>(null);
  const pendingFly = useRef<number | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const inputId = useId();

  const club = useMemo(() => clubs.find((c) => c.symbol === symbol) ?? clubs[0], [clubs, symbol]);
  const kit = useMemo(() => kitFor(club.symbol), [club.symbol]);
  const seats = useSeats(club.symbol, mode === 'ground');
  const tabClubs = useMemo(() => (tabs ?? []).map((s) => clubs.find((c) => c.symbol === s)).filter((c): c is Club => !!c), [tabs, clubs]);

  // fly after the club (and its layout) has switched
  useEffect(() => {
    if (pendingFly.current == null) return;
    const i = pendingFly.current;
    pendingFly.current = null;
    const t = setTimeout(() => ground.current?.flyTo(i), 60);
    return () => clearTimeout(t);
  }, [focus]);

  // Hero: once, shortly after load, the camera flies to the front row to show the plan is a place
  // you can walk. Skipped for reduced motion and as soon as the visitor does anything.
  const touched = useRef(false);
  useEffect(() => {
    if (mode !== 'hero') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const stop = () => {
      touched.current = true;
    };
    const evs = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
    evs.forEach((e) => window.addEventListener(e, stop, { once: true, passive: true }));
    const t = setTimeout(() => {
      if (touched.current || document.visibilityState !== 'visible') return;
      setArrivalKey(false);
      pendingFly.current = 0;
      setFocus({ index: 0, mine: false, rank: 1, of: clubs.find((c) => c.symbol === initial)?.realFans, kind: 'real' });
    }, 1500);
    return () => {
      clearTimeout(t);
      evs.forEach((e) => window.removeEventListener(e, stop));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickClub = (s: string) => {
    if (s === symbol) return;
    ground.current?.reset();
    setFocus(null);
    setEmphasis('all');
    setStatus({ tone: 'idle', text: '' });
    setArrivalKey(true);
    setSymbol(s);
  };

  const seatFor = useCallback(
    (address: string, w: WalletSummary, c: Club): Focus | null => {
      const e = w.tokens.find((t) => t.symbol === c.symbol);
      if (!e) return null;
      let index = seatIndexFor(address, e, c);
      if (e.rank == null && seats.status === 'ready' && c.symbol === club.symbol) {
        const exact = seats.seats.findIndex((s) => s.a === address);
        if (exact >= 0) index = exact;
      }
      return { index, address, mine: true, rank: e.rank, of: e.of || c.realFans, kind: e.kind };
    },
    [seats, club.symbol],
  );

  async function onSubmit(raw: string) {
    setStatus({ tone: 'busy', text: 'Checking the gate…' });
    const r = await resolveInput(raw);
    if (!r.ok) return setStatus({ tone: 'warn', text: r.message });
    let w: WalletSummary | null = null;
    try {
      w = (await fetchWallet(r.address)).wallet;
    } catch {
      return setStatus({ tone: 'warn', text: 'The seat list did not load. Check your connection and try again.' });
    }
    const ticket = `/ticket/${r.address}`;
    const held = (w?.tokens ?? []).filter((t) => clubs.some((c) => c.symbol === t.symbol));
    if (!w || !held.length) {
      setFocus(null);
      return setStatus({ tone: 'warn', text: `${shortAddr(r.address)} holds no stock tokens on Base, so it has no seat yet.`, links: [{ href: ticket, label: 'See what a seat needs' }] });
    }
    let target = club;
    if (mode === 'hero' || !held.some((t) => t.symbol === club.symbol)) {
      const real = held.filter((t) => t.rank != null).sort((a, b) => (a.rank! / Math.max(1, a.of)) - (b.rank! / Math.max(1, b.of)));
      const bestSym = (real[0] ?? held[0]).symbol;
      if (mode === 'ground') {
        setFocus(null);
        return setStatus({
          tone: 'warn',
          text: `${shortAddr(r.address)} has no seat at ${clubName(club.name)}. It has ${held.length === 1 ? 'a seat' : 'seats'} elsewhere.`,
          links: [
            ...held.slice(0, 3).map((t) => ({ href: groundPath(t.symbol), label: clubName(clubs.find((c) => c.symbol === t.symbol)?.name ?? t.symbol) })),
            { href: ticket, label: 'All tickets' },
          ],
        });
      }
      target = clubs.find((c) => c.symbol === bestSym) ?? club;
    }
    const f = seatFor(r.address, w, target);
    if (!f) return setStatus({ tone: 'warn', text: 'That seat could not be placed. Try again in a minute.' });
    const lbl = seatLabel(target.holdersTotal, f.index);
    setArrivalKey(false);
    // on a phone the field sits under the ground: bring the ground back into view before the camera moves
    const box = stageRef.current?.getBoundingClientRect();
    if (box && (box.top < 0 || box.bottom > window.innerHeight)) {
      const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      stageRef.current?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
    }
    if (target.symbol !== symbol) setSymbol(target.symbol);
    setEmphasis('all');
    pendingFly.current = f.index;
    setFocus(f);
    setStatus({
      tone: 'ok',
      text: f.rank != null
        ? `Found it at ${clubName(target.name)}: block ${lbl?.block}, row ${lbl?.row}, seat ${lbl?.seat}.`
        : `Found a ghost seat at ${clubName(target.name)}: this wallet holds under $10, was only sent tokens, or is a contract.`,
      links: [{ href: ticket, label: f.rank != null ? (held.length > 1 ? 'See all its tickets' : 'See the ticket') : 'See this wallet' }],
    });
  }

  const onPick = (index: number | null) => {
    if (mode !== 'ground') return;
    if (index == null) return setFocus((f) => (f && !f.mine ? null : f));
    const s = seats.seats[index];
    setFocus({ index, mine: false, address: s?.a, rank: index < club.realFans ? index + 1 : null, of: club.realFans, kind: s?.k ?? (index < club.realFans ? 'real' : 'ghost') });
  };

  const lbl = focus ? seatLabel(club.holdersTotal, focus.index) : null;
  const picked = focus && seats.seats[focus.index];
  const pin = focus && lbl ? (
    <div className="pin">
      <div className="pin-seat">
        <span><b>{lbl.block}</b>Block</span>
        <span><b>{lbl.row}</b>Row</span>
        <span><b>{lbl.seat}</b>Seat</span>
      </div>
      <p className="pin-line">
        {focus.rank != null ? `Real fan ${fmtInt(focus.rank)} of ${fmtInt(focus.of ?? club.realFans)}` : focus.kind === 'ghost' ? 'Ghost seat' : KIND_LABEL[focus.kind ?? 'dust'] ?? 'Ghost seat'}
        {picked && !focus.mine ? `, held ${fmtInt(picked.holdDays)} days` : ''}
      </p>
      {focus.address && (
        <Link className="pin-link" href={`/ticket/${focus.address}`} prefetch={false}>
          {focus.mine ? 'Open your ticket' : `Ticket for ${shortAddr(focus.address)}`}
        </Link>
      )}
    </div>
  ) : null;

  const legend: { key: Emphasis; label: string; n: number }[] = [
    { key: 'real', label: 'Real fans', n: club.realFans },
    { key: 'dust', label: 'Dust', n: club.ghosts.dust },
    { key: 'farmer', label: 'Farmer-only', n: club.ghosts.farmerOnly },
    { key: 'contract', label: 'Contracts', n: club.ghosts.contracts },
  ];

  const form = (
    <form
      className="find"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit(value);
      }}
    >
      <label htmlFor={inputId}>Find your seat</label>
      <div className="find-row">
        <input
          id={inputId}
          name="wallet"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0x… or yourname.base.eth"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          inputMode="text"
          aria-describedby={`${inputId}-s`}
          aria-invalid={status.tone === 'warn' ? true : undefined}
        />
        <button className="btn btn-accent" type="submit" disabled={status.tone === 'busy'}>
          {status.tone === 'busy' ? 'Looking…' : 'Find seat'}
        </button>
      </div>
      {examples.length > 0 && (
        <p className="find-eg">
          <span>No wallet to hand? Try a fan:</span>
          {examples.map((a) => (
            <button key={a} type="button" className="chip chip-eg num" onClick={() => { setValue(a); void onSubmit(a); }}>
              {shortAddr(a)}
            </button>
          ))}
        </p>
      )}
      <p id={`${inputId}-s`} className={`find-status tone-${status.tone}`} role="status" aria-live="polite">
        {status.text}
        {status.links?.map((l) => (
          <Link key={l.href} href={l.href}>{l.label}</Link>
        ))}
      </p>
      <p className="find-note">Read-only. Nothing to connect or sign: seats come from public Base data.</p>
    </form>
  );

  const stage = (
    <div className={`stage stage-${mode}`} ref={stageRef}>
      <Ground
        ref={ground}
        total={club.holdersTotal}
        realFans={club.realFans}
        ghosts={club.ghosts}
        kit={kit}
        kinds={mode === 'ground' ? seats.kinds : null}
        focus={focus?.index ?? null}
        pin={pin}
        emphasis={emphasis}
        interactive={mode === 'ground'}
        arrival={arrivalKey}
        onPick={onPick}
        onZoomChange={setZoomed}
        label={`Seating plan of ${clubName(club.name)}: ${fmtInt(club.holdersTotal)} seats, ${fmtInt(club.realFans)} lit for real fans.`}
      />
      {mode === 'ground' && (
        <div className="stage-tools">
          <button type="button" className="tool" onClick={() => ground.current?.zoom(1 / 1.8)} aria-label="Zoom out" disabled={!zoomed}>−</button>
          <button type="button" className="tool" onClick={() => ground.current?.zoom(1.8)} aria-label="Zoom in">+</button>
          <button type="button" className="tool tool-wide" onClick={() => { ground.current?.reset(); }} disabled={!zoomed}>Whole ground</button>
        </div>
      )}
      {mode === 'hero' && (zoomed || focus) && (
        <div className="stage-tools">
          <button type="button" className="tool tool-wide" onClick={() => { ground.current?.reset(); setFocus(null); setStatus({ tone: 'idle', text: '' }); }}>Whole ground</button>
        </div>
      )}
    </div>
  );

  if (mode === 'hero') {
    return (
      <div className="hero-grid">
        <div className="hero-head">
          <h1>
            {clubName(club.name)} sold <span className="num">{fmtInt(club.holdersTotal)}</span> tickets.{' '}
            <span className="h1-fans"><span className="num">{fmtInt(club.realFans)}</span> fans showed up.</span>
          </h1>
          <p className="lede">
            {lede ?? <>Every wallet holding a stock token on Base is a seat in that stock&rsquo;s ground. Tropa Club counts the fans who are really there, across all {clubs.length} tokens.</>}
          </p>
        </div>
        <div className="hero-stage">
          {stage}
          <div className="hero-under">
            <div className="tabs" role="group" aria-label="Choose a club">
              {tabClubs.map((c) => (
                <button key={c.symbol} type="button" className="tab" aria-pressed={c.symbol === symbol} onClick={() => pickClub(c.symbol)} title={clubName(c.name)}>
                  <Pennant kit={kitFor(c.symbol)} width={20} />
                  <span>{c.symbol.replace(/c$/, '')}</span>
                </button>
              ))}
            </div>
            <p className="hero-key">
              <span><i className="sw" style={{ background: kit.primary }} /><i className="sw" style={{ background: kit.secondary }} />Real fans, {fmtPct(club.attendancePct)} attendance</span>
              <span><i className="sw sw-ghost" />Ghost seats</span>
              <Link className="tap" href={groundPath(club.symbol)}>Walk the ground</Link>
            </p>
          </div>
        </div>
        <div className="hero-find">{form}</div>
      </div>
    );
  }

  return (
    <div className="explore">
      <div className="explore-bar">
        <div className="legend" role="group" aria-label="Pick out a kind of seat">
          {legend.map((l) => (
            <button key={l.key} type="button" className="chip" aria-pressed={emphasis === l.key} onClick={() => setEmphasis(emphasis === l.key ? 'all' : l.key)}>
              <i className={`sw ${l.key === 'real' ? '' : 'sw-ghost'}`} style={l.key === 'real' ? { background: kit.primary } : undefined} />
              {l.label} <span className="num">{fmtInt(l.n)}</span>
            </button>
          ))}
        </div>
        <p className="explore-hint">
          {seats.status === 'loading' ? 'Loading the seat list…' : seats.status === 'missing' ? 'The seat-by-seat list is not out yet. The plan is drawn from the club totals.' : 'Tap a seat to see who sits there. Pinch or double-tap to zoom, drag to move.'}
        </p>
      </div>
      {stage}
      {form}
    </div>
  );
}
