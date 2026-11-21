import type { Metadata } from 'next';
import Link from 'next/link';
import StatementView from '@/components/club/StatementView';
import SeatSearchBox from '@/components/SeatSearchBox';
import { isAddress, shortAddr } from '@/lib/format';

export const metadata: Metadata = {
  title: 'Statement: cost basis and records for a wallet',
  description: 'A wallet’s stock-token lots, cost basis and realised results, adjusted for splits and stock dividends. FIFO, USD. Records, not tax advice.',
  robots: { index: false, follow: true },
};

// The page itself renders at once. The statement is read in the browser, with progress,
// because the first read of a wallet's history from public Base nodes takes a while.
export default async function StatementPage({ params }: { params: Promise<{ address: string }> }) {
  const { address: raw } = await params;
  const address = raw.toLowerCase();
  const valid = isAddress(address);

  return (
    <main id="main">
      <section className="wrap page-head">
        <h1>{valid ? <>Statement for <span className="num addr">{shortAddr(address)}</span></> : 'That is not a wallet address'}</h1>
        <p className="lede">
          {valid
            ? 'Every lot of the stock tokens this wallet holds, with cost basis and results, adjusted for splits and stock dividends. Read straight from Base.'
            : 'A wallet address starts with 0x and has 42 characters. Paste it again to see its tickets, then open its statement from there.'}
        </p>
        {!valid && <SeatSearchBox label="Find a wallet" button="Find seat" />}
      </section>

      {valid && (
        <section className="wrap section-tight">
          <StatementView address={address} />
        </section>
      )}

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
            <h2>What it covers, and what it is not</h2>
            <ul className="ticks">
              <li>It covers the stock tokens this wallet held at the last count, from the day the wallet was first seen. A token sold in full before that count is not listed yet.</li>
              <li>Not tax advice. It is a record you can hand to someone qualified, in a format they can check.</li>
              <li>Not exact where the chain is silent. Estimated figures say so on their line.</li>
            </ul>
            <h3>Another wallet</h3>
            <SeatSearchBox label="See its tickets" button="Find seat" />
            <p className="muted small">The CSV download is offered only to the wallet’s owner, after sign-in. <Link href="/about#privacy">Privacy</Link></p>
          </div>
        </div>
      </section>
    </main>
  );
}
