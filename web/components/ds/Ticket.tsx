import type { TokenSummary, WalletTokenEntry } from '@shared/types';
import { Mark } from './Logo';
import { Pennant } from './Pennant';
import { kitFor, shortName } from '@/lib/clubs';
import { groundName } from '@/lib/site';
import { fmtDate, fmtInt, shortAddr } from '@/lib/format';
import { barcode, barcodeWidth, statSentence, ticketSeat } from '@/lib/ticket';
import type { SeatLabel } from '@/lib/stadium';

export function Barcode({ address, className }: { address: string; className?: string }) {
  const bars = barcode(address);
  const w = barcodeWidth(bars);
  return (
    <svg className={className} viewBox={`0 0 ${w} 40`} preserveAspectRatio="none" role="img" aria-label="Barcode drawn from the wallet address">
      {bars.map((b, i) => (
        <rect key={i} x={b.x} y="0" width={b.w} height="40" fill="currentColor" />
      ))}
    </svg>
  );
}

/** Thumbnail seating plan with the seat marked. */
export function MiniPlan({ seat, className }: { seat: SeatLabel | null; className?: string }) {
  return (
    <svg className={className} viewBox="-108 -88 216 176" role="img" aria-label={seat ? `Seat position: ${seat.stand}` : 'Seating plan'}>
      <rect x="-100" y="-80" width="200" height="160" rx="34" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <rect x="-78" y="-58" width="156" height="116" rx="22" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.55" />
      <rect x="-55" y="-35" width="110" height="70" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <path d="M0 -35V35" stroke="currentColor" strokeWidth="1.5" />
      <circle r="10" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {seat && (
        <g transform={`translate(${(seat.x * 96).toFixed(1)} ${(seat.y * 76).toFixed(1)})`}>
          <circle r="9" fill="currentColor" />
          <circle r="15" fill="none" stroke="currentColor" strokeWidth="2" />
        </g>
      )}
    </svg>
  );
}

interface Props {
  address: string;
  entry: WalletTokenEntry;
  token: TokenSummary;
  asOf?: string;
  specimen?: boolean;
  headingLevel?: 2 | 3;
  /** Print the ticket in on load. One per page. */
  printIn?: boolean;
  /** A seat not taken yet: drawn in ghost style, marked Preview. */
  preview?: boolean;
  /** "Played GW0": stamped on when the wallet bought this token through Tropa Club that gameweek. */
  stamp?: string | null;
  /** Payday streak badge, printed under the stamp. */
  badge?: string | null;
  /** Cosmetic honours of the wallet ("Scout", "First 1,000"), stamped small under the seat. */
  honours?: string[];
}

export default function Ticket({ address, entry, token, asOf, specimen, headingLevel = 2, printIn, preview, stamp, badge, honours }: Props) {
  const kit = kitFor(token.symbol);
  const seat = ticketSeat(address, entry, token);
  const H = `h${headingLevel}` as 'h2' | 'h3';
  return (
    <article className={`ticket${printIn ? ' print-in' : ''}${preview ? ' ticket-preview' : ''}`} aria-label={`${preview ? 'Preview of a ticket' : 'Ticket'}, ${groundName(token.name, token.symbol)}`}>
      <div className="ticket-main">
        <header className="ticket-top">
          <span className="ticket-brand"><Mark size={16} /> Tropa Club</span>
          <span>Ticket</span>
          <span className="ticket-asof">{preview ? 'Preview' : specimen ? 'Sample' : `As of ${fmtDate(asOf)}`}</span>
        </header>
        <div className="ticket-club">
          <Pennant kit={kit} width={34} />
          <div>
            <H>{groundName(token.name, token.symbol)}</H>
            <p>Holders of {token.symbol}, {shortName(token.name, token.symbol)}&rsquo;s stock token on Base</p>
          </div>
        </div>
        <dl className="ticket-seat">
          <div><dt>Block</dt><dd className="num">{seat?.block ?? '—'}</dd></div>
          <div><dt>Row</dt><dd className="num">{seat?.row ?? '—'}</dd></div>
          <div><dt>Seat</dt><dd className="num">{seat?.seat ?? '—'}</dd></div>
          <div className="ticket-fan">
            <dt>Real holder</dt>
            <dd className="num">{preview && <small className="about">about </small>}{entry.rank != null ? fmtInt(entry.rank) : '—'}<small> of {fmtInt(entry.of || token.realFans)}</small></dd>
          </div>
        </dl>
        {stamp && !preview && (
          <p className="ticket-stamp" aria-label={`${stamp} with Tropa Club${badge ? `, ${badge}` : ''}`}>
            <b>{stamp}</b>
            {badge && <small>{badge}</small>}
          </p>
        )}
        {honours && honours.length > 0 && !preview && (
          <p className="ticket-honours" aria-label={`Honours: ${honours.join(', ')}`}>
            {honours.map((h) => <span key={h}>{h}</span>)}
          </p>
        )}
        <p className="ticket-stat">{preview ? 'Yours after one $10 buy, at the next count' : statSentence(entry.bestStat)}</p>
        <p className="ticket-fine">
          {seat ? `${seat.stand} of the stadium drawing. ` : ''}{token.symbol} is a stock token that tracks the share price; it is not the share. Ranked by time held, never by size. A picture to share, not an NFT. Not advice.
        </p>
      </div>
      <div className="ticket-stub">
        <MiniPlan seat={seat} className="ticket-plan" />
        <Barcode address={address} className="ticket-bars" />
        <p className="ticket-addr num">{shortAddr(address)}</p>
      </div>
    </article>
  );
}
