'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Statement } from '@tropaclub/clubs';
import { CsvButton } from '@/components/club/Actions';
import { Mark } from '@/components/ds/Logo';
import Term from '@/components/nav/Term';
import { fmtDate, fmtUsd, shortAddr } from '@/lib/format';
import { STATEMENT_LABEL_TEXT, readableNote, worthNowSource, type NowPriceSource } from '@/lib/statement-history';

const LINE: Record<string, string> = {
  buy: 'Buy', transfer_in: 'Received', mint: 'Mint', sell: 'Sell', transfer_out: 'Sent', redeem: 'Redeem', split: 'Split', dividend: 'Stock dividend', unclassified: 'Multiplier change', pending_action: 'Pending change',
};
const OPENING = /^0x0{60}/;
const ORIGIN: Record<string, string> = { buy: 'Bought', buy_estimated: 'Bought, cost estimated at the day’s price', dividend: 'Stock dividend', transfer_in: 'Received', mint: 'Minted' };
const money = (n: number | null | undefined) => (n == null ? '—' : fmtUsd(n));
const plain = (n: number | null | undefined) => (n == null ? '—' : `${n < 0 ? '−' : ''}${fmtUsd(Math.abs(n))}`);
const shares = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 6 });
/** The engine's label ("FIFO · USD · records, not tax advice") in words. */
const labelText = (label: string) => (/FIFO/.test(label) ? STATEMENT_LABEL_TEXT : label);

function Programme({ s, countedAt, own, priceSources }: { s: Statement; countedAt?: string | null; own: boolean; priceSources: Record<string, NowPriceSource> }) {
  const t = s.totals;
  const title = own ? 'Your cost-basis statement (estimate)' : `Cost-basis estimate for ${shortAddr(s.wallet)}`;
  const src = worthNowSource(s.lots.map((l) => l.symbol), priceSources, countedAt ?? s.asOf);
  return (
    <article className="programme" aria-label={title}>
      <header className="programme-head">
        <p className="programme-brand"><Mark size={18} /> Tropa Club</p>
        <p>{title}</p>
        <p className="programme-no">Prices as counted {fmtDate(countedAt ?? s.asOf, true)}</p>
      </header>
      <div className="programme-title">
        <h2>Cost basis and results</h2>
        <p className="num">{s.wallet}</p>
        <p className="programme-label">{labelText(s.label)}</p>
      </div>

      <dl className="programme-totals">
        <div><dt>What you paid (still held)</dt><dd className="num">{money(t.costBasisOpenUsd)}</dd></div>
        <div><dt>Worth now</dt><dd className="num">{money(t.marketValueUsd)}</dd>{src && <p className="programme-src">{src}</p>}</div>
        <div><dt>Gain or loss on what you hold</dt><dd className="num">{plain(t.unrealizedUsd)}</dd></div>
        <div><dt>Gain or loss on what you sold</dt><dd className="num">{plain(t.realizedUsd)}</dd></div>
        <div><dt>Stock-dividend income</dt><dd className="num">{money(t.incomeUsd)}</dd></div>
        <div><dt>Value of tokens received without a known price</dt><dd className="num">{money(t.basisUnknownMarketValueUsd)}</dd></div>
      </dl>

      <section>
        <h3>Tokens still held</h3>
        {s.lots.length ? (
          <table className="programme-table">
            <caption className="sr">Tokens still held, oldest first</caption>
            <thead><tr><th scope="col">Acquired</th><th scope="col">Token</th><th scope="col">How</th><th scope="col" className="r"><Term id="share-equivalent">Share equivalent</Term></th><th scope="col" className="r">Paid</th><th scope="col" className="r">Worth now</th><th scope="col" className="r">Gain or loss</th></tr></thead>
            <tbody>
              {s.lots.map((l) => (
                <tr key={l.id}>
                  <td data-label="Acquired">{fmtDate(l.acquiredAt)}</td>
                  <th scope="row" data-label="Token">{l.symbol}</th>
                  <td data-label="How">{OPENING.test(l.txHash ?? '') ? 'Held before the readable history' : ORIGIN[l.origin] ?? l.origin}</td>
                  <td className="r num" data-label="Share equivalent">{shares(l.shares)}</td>
                  <td className="r num" data-label="Paid">{l.basisStatus === 'unknown' ? 'basis unknown' : `${money(l.basisUsd)}${l.basisStatus === 'estimated' ? ' est.' : ''}`}</td>
                  <td className="r num" data-label="Worth now">{money(l.marketValueUsd)}</td>
                  <td className="r num" data-label="Gain or loss">{plain(l.unrealizedUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">Nothing still held: this wallet holds no stock tokens now.</p>
        )}
      </section>

      <section>
        <h3>Every movement</h3>
        <table className="programme-table">
          <caption className="sr">All stock-token movements, oldest first</caption>
          <thead><tr><th scope="col">Date</th><th scope="col">Token</th><th scope="col">What</th><th scope="col" className="r">Share equivalent</th><th scope="col" className="r">Cost</th><th scope="col" className="r">Proceeds</th><th scope="col" className="r">Income</th><th scope="col" className="r">Gain or loss</th></tr></thead>
          <tbody>
            {s.lines.map((l, i) => {
              // A stock dividend is income: its value shows under Income only, never as a cost or proceeds.
              const income = l.type === 'dividend' || l.incomeUsd != null;
              return (
              <tr key={i}>
                <td data-label="Date">{fmtDate(l.t)}</td>
                <th scope="row" data-label="Token">{l.symbol}</th>
                <td data-label="What">
                  {OPENING.test(l.txHash ?? '') ? 'Opening balance' : LINE[l.type] ?? l.type}
                  {OPENING.test(l.txHash ?? '') ? <small>held before the readable history: basis unknown</small> : l.note && l.note.length > 10 && <small>{readableNote(l.note, l.t)}</small>}
                </td>
                <td className="r num" data-label="Share equivalent">{shares(l.shares)}</td>
                <td className="r num" data-label="Cost">{income ? money(null) : l.basisStatus === 'unknown' ? 'unknown' : money(l.costUsd)}</td>
                <td className="r num" data-label="Proceeds">{income ? money(null) : money(l.proceedsUsd)}</td>
                <td className="r num" data-label="Income">{income ? (l.basisStatus === 'unknown' ? 'value unknown' : money(l.incomeUsd)) : money(null)}</td>
                <td className="r num" data-label="Gain or loss">{plain(l.realizedUsd)}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {(s.warnings.length > 0 || s.alternate) && (
        <section className="programme-notes">
          <h3>Notes on this statement</h3>
          <ul>
            {s.warnings.map((w, i) => <li key={i}>{w}</li>)}
            {s.alternate && <li>One change in the token&rsquo;s multiplier could not be classified. Treated the other way ({s.alternate.treatUnclassifiedAs}), the gain or loss on what you sold would be {plain(s.alternate.totals.realizedUsd)} and what you paid for what you still hold {money(s.alternate.totals.costBasisOpenUsd)}.</li>}
          </ul>
        </section>
      )}

      <footer className="programme-foot">
        <p>{labelText(s.label)} When tokens are sold or sent, the oldest are used up first. A split spreads your total cost over the new share equivalent; the total doesn’t change. A stock dividend is income: its value shows under Income, not as a cost, and the new tokens are kept at that day’s value. Tokens sent to this wallet from another wallet, including another of your own, show “basis unknown”.</p>
      </footer>
    </article>
  );
}


type State =
  | { status: 'pending'; step: string; done: number; total: number; seconds: number }
  | { status: 'ready'; statement: Statement; countedAt?: string | null }
  | { status: 'empty' }
  | { status: 'holdings'; reason?: 'too_active' | 'pool' | 'contract'; holdings: { symbol: string; usd: number }[]; countedAt?: string | null }
  | { status: 'busy'; holdings: { symbol: string; usd: number }[]; countedAt?: string | null }
  | { status: 'failed' };

type Holding = { symbol: string; usd: number };

/** What a wallet holds now, from the last count: shown when its lots are not worked out. */
function HoldingsTable({ holdings }: { holdings: Holding[] }) {
  const total = holdings.reduce((sum, h) => sum + h.usd, 0);
  if (!holdings.length) return null;
  return (
    <div className="programme-stage">
      <article className="programme" aria-label="Current holdings">
        <table className="programme-table">
          <caption className="sr">Stock tokens this address holds now</caption>
          <thead><tr><th scope="col">Token</th><th scope="col" className="r">Value now</th></tr></thead>
          <tbody>
            {holdings.map((h) => (
              <tr key={h.symbol}><th scope="row" data-label="Token">{h.symbol}</th><td className="r num" data-label="Value now">{fmtUsd(h.usd)}</td></tr>
            ))}
          </tbody>
          <tfoot><tr><th scope="row">Total</th><td className="r num">{fmtUsd(total)}</td></tr></tfoot>
        </table>
      </article>
    </div>
  );
}

const HOLDINGS_COPY: Record<'too_active' | 'pool' | 'contract', { title: string; body: string }> = {
  too_active: { title: 'Too many transfers to itemise', body: 'This wallet has made more than 1,000 stock-token transfers, so its lots and cost basis are not worked out here. What it holds now is shown instead' },
  pool: { title: 'A trading pool, not a wallet', body: 'This address is a DEX pool. Its transfers are trades by everyone who uses it, so it has no lots or cost basis of its own. What it holds now is shown instead' },
  contract: { title: 'A contract, not a wallet', body: 'This address is a contract, not a person’s wallet, so no lots or cost basis are worked out for it. What it holds now is shown instead' },
};

/** How long to wait for a statement before saying its history is being prepared. */
const SLOW_AFTER_MS = 10_000;

const START: State = { status: 'pending', step: 'Reading this wallet’s history', done: 0, total: 0, seconds: 0 };

/** Loads a wallet's statement in the browser, with progress. It only ever shows that wallet's own records. */
export default function StatementView({ address, own = false, priceSources = {}, asOf }: { address: string; own?: boolean; priceSources?: Record<string, NowPriceSource>; asOf?: string }) {
  const [state, setState] = useState<State>(START);
  const [attempt, setAttempt] = useState(0);
  const started = useRef(Date.now());
  // After ten seconds without a statement the page stops promising one "soon" and says the
  // history is being prepared. It never prints figures it does not have.
  const [slow, setSlow] = useState(false);
  const slowRef = useRef(false);

  const retry = useCallback(() => {
    started.current = Date.now();
    slowRef.current = false;
    setSlow(false);
    setState(START);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const slowTimer = setTimeout(() => {
      if (!live) return;
      slowRef.current = true;
      setSlow(true);
    }, SLOW_AFTER_MS);
    const poll = async () => {
      try {
        const res = await fetch(`/api/statement/${address}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(String(res.status));
        const j = (await res.json()) as State;
        if (!live) return;
        if (j.status === 'pending') {
          if (Date.now() - started.current > 420_000) return setState({ status: 'failed' });
          setState(j);
          timer = setTimeout(poll, slowRef.current ? 5000 : 1200);
        } else setState(j);
      } catch {
        if (live) setState({ status: 'failed' });
      }
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
      clearTimeout(slowTimer);
    };
  }, [address, attempt]);

  if (state.status === 'ready') {
    return (
      <>
        <div className="statement-actions"><CsvButton address={address} /><Link className="btn" href={`/ticket/${address}`}>See this wallet&rsquo;s tickets</Link></div>
        <div className="programme-stage"><Programme s={state.statement} countedAt={state.countedAt ?? asOf} own={own} priceSources={priceSources} /></div>
      </>
    );
  }
  if (state.status === 'holdings') {
    const copy = HOLDINGS_COPY[state.reason ?? 'too_active'];
    return (
      <div className="statement-state">
        <h2 className="h3">{copy.title}</h2>
        <p>{copy.body}{state.countedAt ? `, as counted ${fmtDate(state.countedAt, true)}` : ''}.</p>
        <HoldingsTable holdings={state.holdings} />
        <p className="closing-links"><Link className="btn" href={`/ticket/${address}`}>See this wallet</Link></p>
      </div>
    );
  }
  if (state.status === 'busy') {
    return (
      <div className="statement-state" role="status" aria-live="polite">
        <h2 className="h3">Statements are busy just now</h2>
        <p>Other wallets are being read from Base at the moment, or this one needs more reading than one statement is allowed at a time. No figures are guessed. What this wallet holds now is shown below{state.countedAt ? `, as counted ${fmtDate(state.countedAt, true)}` : ''}. Try again in a minute for the full statement.</p>
        <HoldingsTable holdings={state.holdings} />
        <p className="closing-links"><button type="button" className="btn btn-accent" onClick={retry}>Try again</button><Link className="btn" href={`/ticket/${address}`}>See this wallet</Link></p>
      </div>
    );
  }
  if (state.status === 'empty') {
    return (
      <div className="statement-state">
        <h2 className="h3">Nothing to state yet</h2>
        <p>This wallet held no stock tokens on Base at the last count, so there is nothing to list. A statement appears here after its first buy is counted.</p>
        <p className="closing-links"><Link className="btn" href={`/ticket/${address}`}>See this wallet</Link><Link href="/clubs">Clubs</Link></p>
      </div>
    );
  }
  if (state.status === 'failed') {
    return (
      <div className="statement-state" role="alert">
        <h2 className="h3">The statement could not be read</h2>
        <p>This wallet’s history could not be read in full from the public Base nodes, so nothing is shown rather than a wrong figure. Nothing is lost: the records are onchain.</p>
        <p><button type="button" className="btn btn-accent" onClick={retry}>Retry</button></p>
      </div>
    );
  }
  const pct = state.total > 0 ? Math.min(100, Math.round((state.done / state.total) * 100)) : null;
  if (slow) {
    return (
      <div className="statement-state" role="status" aria-live="polite">
        <h2 className="h3">History is being prepared</h2>
        <p>This wallet’s history is still being read from Base{pct != null ? ` (${pct}% so far)` : ''}. No figures are shown until all of it is in, so nothing here can be wrong or zero by mistake. The statement opens on this page by itself when it is ready.</p>
        <p><button type="button" className="btn btn-accent" onClick={retry}>Retry</button></p>
      </div>
    );
  }
  return (
    <div className="statement-state" role="status" aria-live="polite">
      <h2 className="h3">{state.step}…</h2>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined} aria-label="Reading progress">
        <span style={{ width: `${pct ?? 6}%` }} />
      </div>
      <p className="muted small">{pct != null ? `${pct}% read so far. ` : ''}The first time can take about 30 seconds. After that it opens at once.</p>
      <div className="programme-stage programme-skel" aria-hidden="true">
        <div className="programme">
          <span className="sk sk-title" />
          <div className="sk-row"><span className="sk" /><span className="sk" /><span className="sk" /></div>
          <span className="sk sk-line" /><span className="sk sk-line" /><span className="sk sk-line" /><span className="sk sk-line" />
        </div>
      </div>
    </div>
  );
}
