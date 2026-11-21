'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Statement } from '@tropaclub/clubs';
import { CsvButton } from '@/components/club/Actions';
import { Mark } from '@/components/ds/Logo';
import { fmtDate, fmtUsd } from '@/lib/format';

const LINE: Record<string, string> = {
  buy: 'Buy', transfer_in: 'Received', mint: 'Mint', sell: 'Sell', transfer_out: 'Sent', redeem: 'Redeem', split: 'Split', dividend: 'Stock dividend', unclassified: 'Multiplier change', pending_action: 'Pending change',
};
const OPENING = /^0x0{60}/;
const ORIGIN: Record<string, string> = { buy: 'Bought', buy_estimated: 'Bought (estimated)', dividend: 'Stock dividend', transfer_in: 'Received', mint: 'Minted' };
const money = (n: number | null | undefined) => (n == null ? '—' : fmtUsd(n));
const plain = (n: number | null | undefined) => (n == null ? '—' : `${n < 0 ? '−' : ''}${fmtUsd(Math.abs(n))}`);
const shares = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 6 });

function Programme({ s, countedAt }: { s: Statement; countedAt?: string | null }) {
  const t = s.totals;
  return (
    <article className="programme" aria-label="Statement">
      <header className="programme-head">
        <p className="programme-brand"><Mark size={18} /> Tropa Club</p>
        <p>Official statement</p>
        <p className="programme-no">Prices as counted {fmtDate(countedAt ?? s.asOf, true)}</p>
      </header>
      <div className="programme-title">
        <h2>Cost basis and results</h2>
        <p className="num">{s.wallet}</p>
        <p className="programme-label">{s.label}</p>
      </div>

      <dl className="programme-totals">
        <div><dt>Cost basis, open lots</dt><dd className="num">{money(t.costBasisOpenUsd)}</dd></div>
        <div><dt>Market value</dt><dd className="num">{money(t.marketValueUsd)}</dd></div>
        <div><dt>Unrealised</dt><dd className="num">{plain(t.unrealizedUsd)}</dd></div>
        <div><dt>Realised</dt><dd className="num">{plain(t.realizedUsd)}</dd></div>
        <div><dt>Stock-dividend income</dt><dd className="num">{money(t.incomeUsd)}</dd></div>
        <div><dt>Value with unknown basis</dt><dd className="num">{money(t.basisUnknownMarketValueUsd)}</dd></div>
      </dl>

      <section>
        <h3>Open lots</h3>
        {s.lots.length ? (
          <table className="programme-table">
            <caption className="sr">Open lots, oldest first</caption>
            <thead><tr><th scope="col">Acquired</th><th scope="col">Token</th><th scope="col">How</th><th scope="col" className="r">Shares</th><th scope="col" className="r">Basis</th><th scope="col" className="r">Value</th><th scope="col" className="r">Unrealised</th></tr></thead>
            <tbody>
              {s.lots.map((l) => (
                <tr key={l.id}>
                  <td data-label="Acquired">{fmtDate(l.acquiredAt)}</td>
                  <th scope="row" data-label="Token">{l.symbol}</th>
                  <td data-label="How">{OPENING.test(l.txHash ?? '') ? 'Held before the readable history' : ORIGIN[l.origin] ?? l.origin}</td>
                  <td className="r num" data-label="Shares">{shares(l.shares)}</td>
                  <td className="r num" data-label="Basis">{l.basisStatus === 'unknown' ? 'basis unknown' : `${money(l.basisUsd)}${l.basisStatus === 'estimated' ? ' est.' : ''}`}</td>
                  <td className="r num" data-label="Value">{money(l.marketValueUsd)}</td>
                  <td className="r num" data-label="Unrealised">{plain(l.unrealizedUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No open lots: this wallet holds no stock tokens now.</p>
        )}
      </section>

      <section>
        <h3>Every movement</h3>
        <table className="programme-table">
          <caption className="sr">All stock-token movements, oldest first</caption>
          <thead><tr><th scope="col">Date</th><th scope="col">Token</th><th scope="col">What</th><th scope="col" className="r">Shares</th><th scope="col" className="r">Cost</th><th scope="col" className="r">Proceeds</th><th scope="col" className="r">Realised</th></tr></thead>
          <tbody>
            {s.lines.map((l, i) => (
              <tr key={i}>
                <td data-label="Date">{fmtDate(l.t)}</td>
                <th scope="row" data-label="Token">{l.symbol}</th>
                <td data-label="What">
                  {OPENING.test(l.txHash ?? '') ? 'Opening balance' : LINE[l.type] ?? l.type}
                  {OPENING.test(l.txHash ?? '') ? <small>held before the readable history: basis unknown</small> : l.note && l.note.length > 10 && <small>{l.note}</small>}
                </td>
                <td className="r num" data-label="Shares">{shares(l.shares)}</td>
                <td className="r num" data-label="Cost">{l.basisStatus === 'unknown' ? 'unknown' : money(l.costUsd)}</td>
                <td className="r num" data-label="Proceeds">{money(l.proceedsUsd ?? l.incomeUsd)}</td>
                <td className="r num" data-label="Realised">{plain(l.realizedUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {(s.warnings.length > 0 || s.alternate) && (
        <section className="programme-notes">
          <h3>Notes on this statement</h3>
          <ul>
            {s.warnings.map((w, i) => <li key={i}>{w}</li>)}
            {s.alternate && <li>One multiplier change could not be classified. Treated the other way ({s.alternate.treatUnclassifiedAs}), realised would be {plain(s.alternate.totals.realizedUsd)} and open cost basis {money(s.alternate.totals.costBasisOpenUsd)}.</li>}
          </ul>
        </section>
      )}

      <footer className="programme-foot">
        <p>{s.label}. First in, first out. A split spreads the old basis over the new shares. A stock dividend is income, and a new lot at that day’s value. Tokens that were sent to this wallet show “basis unknown”.</p>
      </footer>
    </article>
  );
}


type State =
  | { status: 'pending'; step: string; done: number; total: number; seconds: number }
  | { status: 'ready'; statement: Statement; countedAt?: string | null }
  | { status: 'empty' }
  | { status: 'failed' };

/** How long to wait for a statement before saying its history is being prepared. */
const SLOW_AFTER_MS = 10_000;

const START: State = { status: 'pending', step: 'Looking up what this wallet holds', done: 0, total: 0, seconds: 0 };

/** Loads a wallet's statement in the browser, with progress. It only ever shows that wallet's own records. */
export default function StatementView({ address }: { address: string }) {
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
        <div className="statement-actions"><CsvButton address={address} /><Link className="btn" href={`/ticket/${address}`}>Its tickets</Link></div>
        <div className="programme-stage"><Programme s={state.statement} countedAt={state.countedAt} /></div>
      </>
    );
  }
  if (state.status === 'empty') {
    return (
      <div className="statement-state">
        <h2 className="h3">Nothing to state yet</h2>
        <p>This wallet held no stock tokens on Base at the last count, so it has no lots to list. A statement appears here after its first buy is counted.</p>
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
      <p className="muted small">{pct != null ? `${pct}% of the blocks read.` : 'Starting.'} Reading a wallet for the first time can take a while. After that it opens at once.</p>
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
