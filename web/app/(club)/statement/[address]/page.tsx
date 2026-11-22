import type { Metadata } from 'next';
import Link from 'next/link';
import StatementView from '@/components/club/StatementView';
import SeatSearchBox from '@/components/SeatSearchBox';
import Term from '@/components/nav/Term';
import { Crumbs, NextStrip } from '@/components/nav/Wayfinding';
import PageSections from '@/components/nav/PageSections';
import Anchor from '@/components/nav/Anchor';
import { isAddress, shortAddr } from '@/lib/format';
import { getIndex } from '@/lib/server/data';
import { sessionWallet } from '@/lib/server/session';

export const metadata: Metadata = {
  title: 'Cost-basis statement (estimate) for a wallet',
  description: 'What a wallet paid for its stock tokens, what they are worth now, and the gain or loss, adjusted for splits and stock dividends. First in, first out, in US dollars. A record, not tax advice.',
  robots: { index: false, follow: true },
};

// The page itself renders at once. The statement is read in the browser, with progress,
// because a wallet that is not in the published history is read from public Base nodes, which takes a while.
export default async function StatementPage({ params }: { params: Promise<{ address: string }> }) {
  const { address: raw } = await params;
  const address = raw.toLowerCase();
  const valid = isAddress(address);
  const [viewer, { data: index }] = await Promise.all([valid ? sessionWallet() : Promise.resolve(null), getIndex()]);
  // "Your" only when the visitor is signed in as this wallet; anyone else sees an estimate about an address
  const own = !!viewer && viewer.toLowerCase() === address;
  // where each token's "worth now" price comes from: the index's live price and its source
  const priceSources = Object.fromEntries(index.tokens.map((t) => [t.symbol, t.priceUsd == null ? null : t.priceSource ?? 'dex'] as const));

  return (
    <main id="main">
      <PageSections
        sections={[
          ...(valid ? [{ id: 'statement', label: 'The statement' }] : []),
          { id: 'read', label: 'How to read it' },
        ]}
      />
      <section className="wrap page-head">
        <Crumbs trail={valid ? [{ label: 'Statement' }, { label: <span className="num">{shortAddr(address)}</span> }] : [{ label: 'Statement' }]} />
        {valid && !own && <p className="public-line">Anyone can work this out from public Base data. Tropa Club only reads it.</p>}
        <h1>{valid ? (own ? 'Your cost-basis statement (estimate)' : <>Cost-basis estimate for <span className="num addr">{shortAddr(address)}</span></>) : 'That is not a wallet address'}</h1>
        <p className="lede">
          {valid
            ? <>What this wallet paid for its <Term id="stock-token">stock tokens</Term> (its <Term id="cost-basis">cost basis</Term>), what they&rsquo;re worth now, and the gain or loss, from its full history on Base. Adjusted for splits and stock dividends. An estimate and a record to share with your accountant, not tax advice.</>
            : 'A wallet address starts with 0x and has 42 characters. Paste it again to see its tickets, then open its statement from there.'}
        </p>
        {!valid && <SeatSearchBox label="Check a wallet" button="Check wallet" />}
      </section>

      {valid && (
        <section className="wrap section-tight" id="statement" aria-label="The statement">
          <StatementView address={address} own={own} priceSources={priceSources} asOf={index.asOf} />
        </section>
      )}

      <section className="band" id="read">
        <div className="wrap split">
          <div className="split-text">
            <h2>How to read it<Anchor id="read" label="How to read it" /></h2>
            <dl className="defs">
              <div><dt>First in, first out</dt><dd>Each purchase or receipt of a token is kept apart. When you sell or send, the oldest tokens are used up first.</dd></div>
              <div><dt>Cost basis (what you paid)</dt><dd>What the tokens cost in dollars at the time. A buy made through Tropa Club uses the <Term id="mark">market price</Term> at the moment of the buy. Older history uses that day&rsquo;s price, labelled with its source (Chainlink close, pool average, last close or reference price). Otherwise it is the payment seen on chain in the same transaction.</dd></div>
              <div><dt>Basis unknown</dt><dd>The tokens arrived without a visible payment, such as a transfer from another wallet, including another wallet of your own. Their value is shown, their gain or loss is not.</dd></div>
              <div><dt><Term id="share-equivalent">Share equivalent</Term></dt><dd>How many shares&rsquo; worth the tokens track. A token tracks a share; it is not a share.</dd></div>
              <div><dt>Split</dt><dd>Each token now represents more shares. Your total cost doesn&rsquo;t change.</dd></div>
              <div><dt>Stock dividend</dt><dd>A small rise in the token&rsquo;s <Term id="multiplier">multiplier</Term>. Its value shows under Income, never as a cost or proceeds, and the new tokens are kept at that day&rsquo;s value.</dd></div>
              <div><dt>Gain or loss</dt><dd>On what you hold: value now minus what you paid. On what you sold: what you got minus what you paid.</dd></div>
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
            <SeatSearchBox label="See its tickets" button="Check wallet" />
            <p className="muted small">The CSV download is offered only to the wallet’s owner, after sign-in. In it, a stock-dividend row carries its value in income_usd; its cost_usd is the cost basis of the new tokens, not money paid. <Link href="/about#privacy">Privacy</Link></p>
          </div>
        </div>
      </section>

      <NextStrip
        items={[
          valid ? { title: 'This wallet’s ticket', sub: 'Its rank in every ground it is in', href: `/ticket/${address}` } : { title: 'Your ticket', sub: 'Your rank in every ground you are in', mine: 'ticket' },
          { title: 'How it works', sub: 'The two things Tropa Club does', href: '/about' },
        ]}
      />
    </main>
  );
}
