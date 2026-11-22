'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import BuySheet from './BuySheet';
import OpensAt from '@/components/OpensAt';
import { REGION_LINE, X_FOLLOW_URL } from '@/lib/site';

// Pages outside the clubs section have no wallet code loaded. It arrives only when Buy is tapped.
const BuyStandalone = dynamic(() => import('./BuyStandalone'), { ssr: false });

interface Props {
  /** Token address to preselect. */
  token?: string | null;
  symbol?: string;
  clubId?: string | null;
  /** ISO time buying opens (from the server: env BUY_OPEN_AT). */
  openAt: string;
  /** True on pages that are not already inside the wallet provider. */
  standalone?: boolean;
  label?: string;
  /** Say less: one line and the buttons. */
  compact?: boolean;
}

/** The buy button for one stock. Until buying opens it shows the opening time and an add-to-calendar link instead. */
export default function BuyCta({ token = null, symbol, clubId = null, openAt, standalone = false, label, compact = false }: Props) {
  const opensMs = Date.parse(openAt);
  // The server's answer first (so the first paint matches), the visitor's clock after mount.
  const [isOpen, setIsOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [us, setUs] = useState(false);

  useEffect(() => {
    const left = opensMs - Date.now();
    setIsOpen(left <= 0);
    if (left > 0 && left < 2_000_000_000) {
      const t = setTimeout(() => setIsOpen(true), left + 500);
      return () => clearTimeout(t);
    }
  }, [opensMs]);

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
        {isOpen ? (
          <>
            <button
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
            <p className="buy-opens"><span className="tag">Buying opens</span> <b><OpensAt at={openAt} /></b></p>
            <div className="buy-remind">
              <a className="btn btn-accent" href="/remind.ics" download="tropa-club-buying-opens.ics">Add to calendar</a>
              <a className="btn" href={X_FOLLOW_URL} target="_blank" rel="noopener noreferrer">Follow @tropaclubxyz</a>
            </div>
            {facts}
          </>
        )}
      </div>
      <p className="us-only notice"><b>Buying isn't available in your region.</b> Checking wallets and holder counts stays open.</p>
      {loaded && (standalone ? <BuyStandalone open={sheet} onClose={() => setSheet(false)} clubId={clubId} token={token} us={us} /> : <BuySheet open={sheet} onClose={() => setSheet(false)} clubId={clubId} token={token} us={us} />)}
    </div>
  );
}
