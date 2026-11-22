'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import BuySheet from './BuySheet';
import BuyPaused from './BuyPaused';
import OpensAt from '@/components/OpensAt';
import LookBeforeConnect from '@/components/LookBeforeConnect';
import { LAUNCH_AT, REGION_LINE, X_FOLLOW_URL, type BuyState } from '@/lib/site';

// Pages outside the clubs section have no wallet code loaded. It arrives only when Buy is tapped.
const BuyStandalone = dynamic(() => import('./BuyStandalone'), { ssr: false });

interface Props {
  /** Token address to preselect. */
  token?: string | null;
  symbol?: string;
  clubId?: string | null;
  /** Where buying stands, from the server (buyState()): the first paint matches it. */
  state: BuyState;
  /** ISO time the buy gate opens (from the server: buyOpenAt()). Only used to flip the button on time, never shown. */
  openAt: string;
  /** True on pages that are not already inside the wallet provider. */
  standalone?: boolean;
  label?: string;
  /** Say less: one line and the buttons. */
  compact?: boolean;
}

/**
 * The buy button for one stock. Before buying opens it shows the launch time and an add-to-calendar
 * link instead; while buying is paused it shows the paused note and no button.
 */
export default function BuyCta({ token = null, symbol, clubId = null, state, openAt, standalone = false, label, compact = false }: Props) {
  const opensMs = Date.parse(openAt);
  // the server's answer first (so the first paint matches), the visitor's clock after mount
  const [isOpen, setIsOpen] = useState(state === 'open');
  // the gate was moved past the launch time and the launch time has gone by: no stale date
  const [late, setLate] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [us, setUs] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (state !== 'before') return;
    const left = opensMs - Date.now();
    setLate(Date.now() >= Date.parse(LAUNCH_AT));
    if (left <= 0) return setIsOpen(true);
    if (left < 2_000_000_000) {
      const t = setTimeout(() => setIsOpen(true), left + 500);
      return () => clearTimeout(t);
    }
  }, [opensMs, state]);

  const text = label ?? `Buy $10 of ${symbol ?? 'a stock token'}`;
  // what it costs and who can use it, before anything is tapped
  const facts = (
    <ul className="buy-facts-up">
      <li><b>0% Tropa fee.</b> Network gas is a few cents.</li>
      <li><b>1.5% price guard.</b> If the price moves more than 1.5% before your buy goes through, it’s cancelled and nothing is spent.</li>
      <li>Bought on Aerodrome, a public exchange on Base, from your own wallet, in USDC or ETH.</li>
      <li>{REGION_LINE} You’ll confirm before buying.</li>
    </ul>
  );
  return (
    <div className={`buy-cta${compact ? ' buy-cta-compact' : ''}`}>
      <div className="clubs-only">
        {state === 'paused' ? (
          <BuyPaused />
        ) : isOpen ? (
          <>
            <button
              ref={opener}
              type="button"
              className="btn btn-accent buy-cta-btn"
              onClick={() => {
                // a blocked region, or one that could not be told: no buying (pages stay open)
                setUs(['restricted', 'unknown'].includes(document.documentElement.dataset.region ?? ''));
                setLoaded(true);
                setSheet(true);
              }}
            >
              {text}
            </button>
            {facts}
          </>
        ) : (
          <>
            {late ? (
              <p className="buy-opens"><span className="tag">Buying opens</span> <b>shortly</b></p>
            ) : (
              <p className="buy-opens"><span className="tag">Buying opens</span> <b><OpensAt at={LAUNCH_AT} /></b></p>
            )}
            <div className="buy-remind">
              <a className="btn btn-accent" href="/remind.ics" download="tropa-club-buying-opens.ics">Add to calendar</a>
              <a className="btn" href={X_FOLLOW_URL} target="_blank" rel="noopener noreferrer">Follow @tropaclubxyz</a>
            </div>
            {facts}
          </>
        )}
        {!compact && state !== 'paused' && <LookBeforeConnect />}
      </div>
      <p className="us-only notice"><b>Buying isn't available in your region.</b> Checking wallets and holder counts stays open.</p>
      {loaded && state !== 'paused' &&
        (standalone ? (
          <BuyStandalone open={sheet} onClose={() => setSheet(false)} opener={opener} clubId={clubId} token={token} us={us} />
        ) : (
          <BuySheet open={sheet} onClose={() => setSheet(false)} opener={opener} clubId={clubId} token={token} us={us} />
        ))}
    </div>
  );
}
