'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import BuySheet from './BuySheet';
import { X_FOLLOW_URL } from '@/lib/site';

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

const utc = (iso: string) => {
  const d = new Date(iso);
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()];
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
  return `${day} ${d.getUTCDate()} ${mon}, ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
};

/** The buy button for one stock. Until buying opens it shows the opening time and a reminder instead. */
export default function BuyCta({ token = null, symbol, clubId = null, openAt, standalone = false, label, compact = false }: Props) {
  const opensMs = Date.parse(openAt);
  // The server's answer first (so the first paint matches), the visitor's clock and time zone after mount.
  const [isOpen, setIsOpen] = useState(false);
  const [when, setWhen] = useState(utc(openAt));
  const [sheet, setSheet] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [us, setUs] = useState(false);

  useEffect(() => {
    const left = opensMs - Date.now();
    setIsOpen(left <= 0);
    try {
      setWhen(new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(opensMs)));
    } catch {
      /* keep UTC */
    }
    if (left > 0 && left < 2_000_000_000) {
      const t = setTimeout(() => setIsOpen(true), left + 500);
      return () => clearTimeout(t);
    }
  }, [opensMs]);

  const text = label ?? `Buy $10 of ${symbol ?? 'a stock token'}`;
  return (
    <div className={`buy-cta${compact ? ' buy-cta-compact' : ''}`}>
      <div className="clubs-only">
        {isOpen ? (
          <>
            <button
              type="button"
              className="btn btn-accent buy-cta-btn"
              onClick={() => {
                setUs(document.documentElement.dataset.region === 'restricted');
                setLoaded(true);
                setSheet(true);
              }}
            >
              {text}
            </button>
            {!compact && <p className="buy-cta-note">From your own wallet, in USDC or ETH on Base. No account. Tropa Club holds nothing and takes no fee.</p>}
          </>
        ) : (
          <>
            <p className="buy-opens"><span className="tag">Buying opens</span> <b suppressHydrationWarning>{when}</b></p>
            <div className="buy-remind">
              <a className="btn btn-accent" href="/remind.ics" download="tropa-club-buying-opens.ics">Remind me</a>
              <a className="btn" href={X_FOLLOW_URL} target="_blank" rel="noopener noreferrer">Follow @tropaclubxyz</a>
            </div>
            {!compact && <p className="buy-cta-note">“Remind me” adds the moment to your calendar. {symbol ? `Then ${text.charAt(0).toLowerCase()}${text.slice(1)} from your own wallet.` : ''}</p>}
          </>
        )}
      </div>
      <p className="us-only notice"><b>Not available to US persons.</b> Buying is not offered in the United States. Everything else here stays open.</p>
      {loaded && (standalone ? <BuyStandalone open={sheet} onClose={() => setSheet(false)} clubId={clubId} token={token} us={us} /> : <BuySheet open={sheet} onClose={() => setSheet(false)} clubId={clubId} token={token} us={us} />)}
    </div>
  );
}
