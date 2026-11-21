import type { Metadata } from 'next';
import Link from 'next/link';
import type { Statement } from '@tropaclub/clubs';
import { CsvButton } from '@/components/club/Actions';
import { Mark } from '@/components/ds/Logo';
import SeatSearchBox from '@/components/SeatSearchBox';
import { loadStatement, specimenStatement } from '@/lib/server/statement';
import { fmtDate, fmtUsd, isAddress, shortAddr } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Statement: cost basis and records for a wallet',
  description: 'A wallet’s stock-token lots, cost basis and realised results, adjusted for splits and stock dividends. FIFO, USD. Records, not tax advice.',
  robots: { index: false, follow: true },
};

const LINE: Record<string, string> = {
  buy: 'Buy', transfer_in: 'Received', mint: 'Mint', sell: 'Sell', transfer_out: 'Sent', redeem: 'Redeem', split: 'Split', dividend: 'Stock dividend', unclassified: 'Multiplier change', pending_action: 'Pending change',
};
const ORIGIN: Record<string, string> = { buy: 'Bought', buy_estimated: 'Bought (estimated)', dividend: 'Stock dividend', transfer_in: 'Received', mint: 'Minted' };
const money = (n: number | null | undefined) => (n == null ? '—' : fmtUsd(n));
const plain = (n: number | null | undefined) => (n == null ? '—' : `${n < 0 ? '−' : ''}${fmtUsd(Math.abs(n))}`);
const shares = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 6 });

function Programme({ s, specimen }: { s: Statement; specimen: boolean }) {
  const t = s.totals;
  return (
    <article className="programme" aria-label="Statement">
      <header className="programme-head">
        <p className="programme-brand"><Mark size={18} /> Tropa Club</p>
        <p>Official statement</p>
        <p className="programme-no">{specimen ? 'Specimen' : `As of ${fmtDate(s.asOf, true)}`}</p>
      </header>
      <div className="programme-title">
        <h2>Cost basis and results</h2>
        <p className="num">{specimen ? 'A made-up wallet' : s.wallet}</p>
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
                  <td data-label="How">{ORIGIN[l.origin] ?? l.origin}</td>
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
                  {LINE[l.type] ?? l.type}
                  {l.note && l.note.length > 10 && <small>{l.note}</small>}
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
        <p>Stock tokens track the share price. They are not shares. Past performance · not advice.</p>
      </footer>
    </article>
  );
}

export default async function StatementPage({ params }: { params: Promise<{ address: string }> }) {
  const { address: raw } = await params;
  const address = raw.toLowerCase();
  const valid = isAddress(address);
  const real = valid ? await loadStatement(address) : null;
  const empty = !!real && real.lines.length === 0 && real.lots.length === 0;
  const specimen = !real || empty ? await specimenStatement().catch(() => null) : null;

  return (
    <main id="main">
      <section className="wrap page-head">
        <h1>{valid ? <>Statement for <span className="num addr">{shortAddr(address)}</span></> : 'That is not a wallet address'}</h1>
        <p className="lede">
          {!valid
            ? 'A wallet address starts with 0x and has 42 characters. Below is a specimen statement to show what one looks like.'
            : real && !empty
              ? 'Every stock-token lot this wallet holds or has held, with cost basis and results, adjusted for splits and stock dividends.'
              : empty
                ? 'This wallet has never held a stock token on Base, so there is nothing to state yet. Below is a specimen to show what one looks like.'
                : 'This wallet’s history could not be read from the chain yet. The first read can take a minute. Reload shortly. Below is a specimen in the meantime.'}
        </p>
        {valid && real && !empty && <div className="statement-actions"><CsvButton address={address} /><Link className="btn" href={`/ticket/${address}`}>Its tickets</Link></div>}
        {valid && !real && <p className="closing-links"><Link className="btn btn-accent" href={`/statement/${address}`}>Reload</Link></p>}
      </section>

      <section className="wrap section-tight">
        <div className="programme-stage">
          {real && !empty ? <Programme s={real} specimen={false} /> : specimen ? <Programme s={specimen} specimen /> : <p className="notice">The statement could not be drawn just now. Try again in a minute.</p>}
        </div>
      </section>

      <section className="band">
        <div className="wrap split">
          <div className="split-text">
            <h2>How to read it</h2>
            <dl className="defs">
              <div><dt>Lot</dt><dd>One purchase or receipt of a token. Lots are used up oldest first when you sell or send.</dd></div>
              <div><dt>Cost basis</dt><dd>What the lot cost in dollars at the time, read from the payment in the same transaction.</dd></div>
              <div><dt>Basis unknown</dt><dd>The tokens arrived without a visible payment, such as a transfer from another wallet. Their value is shown, their result is not.</dd></div>
              <div><dt>Split</dt><dd>The token’s multiplier jumped by a whole number. Shares change, total basis does not.</dd></div>
              <div><dt>Stock dividend</dt><dd>A small rise in the multiplier. Shown as income, and as a new lot at that day’s value.</dd></div>
              <div><dt>Unrealised and realised</dt><dd>Unrealised is market value minus basis on what you still hold. Realised is proceeds minus basis on what you sold.</dd></div>
            </dl>
          </div>
          <div className="split-text">
            <h2>What it is not</h2>
            <ul className="ticks">
              <li>Not tax advice. It is a record you can hand to someone qualified, in a format they can check.</li>
              <li>Not a complete picture of your finances. It covers stock tokens on Base in this one wallet.</li>
              <li>Not exact where the chain is silent. Estimated figures say so on their line.</li>
            </ul>
            <h3>Another wallet</h3>
            <SeatSearchBox label="See its tickets" button="Find seat" />
            <p className="muted small">The CSV download is offered only to the wallet’s owner, after sign-in.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
