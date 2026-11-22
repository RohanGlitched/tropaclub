import type { Metadata } from 'next';
import Link from 'next/link';
import SeatSearchBox from '@/components/SeatSearchBox';
import { Pennant } from '@/components/ds/Pennant';
import { Crumbs, NextStrip } from '@/components/nav/Wayfinding';
import PageSections from '@/components/nav/PageSections';
import Anchor from '@/components/nav/Anchor';
import { getIndex, getStats } from '@/lib/server/data';
import { kitFor } from '@/lib/clubs';
import Term from '@/components/nav/Term';
import { GLOSSARY, type TermId } from '@/lib/glossary';
import { fmtDate, fmtInt } from '@/lib/format';
import { BUILDER, BUILDER_CODE, BUILDER_CODE_DOCS, BUY_ROUTER, CAPS_COPY, CHANGELOG, FIXTURE_SHORT, OPENS, PAY_WITH, REAL_FAN_LINE, REGION_LINE, REPO_URL, RULE_LINE, SLIPSTREAM_FACTORY_LIST, TWO_THINGS, UPCOMING, X_URL, DOCS_URL, basescan, groundName, openClubName } from '@/lib/site';

/** The site glossary terms, in reading order. */
const GLOSSARY_ORDER: TermId[] = ['stock-token', 'ground', 'holders', 'real-fan', 'ghost-seat', 'attendance', 'ticket', 'weekly-run', 'club', 'stock-club', 'gameweek', 'bench', 'matchday', 'payday-streak', 'fixture', 'caps', 'scout'];

export const revalidate = 60;
export const metadata: Metadata = {
  title: 'How it works: real holders, clubs and the rules we keep',
  description: 'Tropa Club does two things: it counts who really holds each stock token on Base, and it lets friends each buy about $10 a week from their own wallets. How both work, and the rules it keeps: no advice, no ranking by size, no custody.',
};

export default async function AboutPage() {
  const [{ data: index }, { data: stats }] = await Promise.all([getIndex(), getStats()]);
  const top = index.tokens[0];
  return (
    <>
      <main id="main">
        <PageSections
          sections={[
            { id: 'two', label: 'Two things we do' },
            { id: 'glossary', label: 'Words we use' },
            { id: 'idea', label: 'The idea' },
            { id: 'method', label: 'Data method' },
            { id: 'seats', label: 'Grounds and tickets' },
            { id: 'clubs', label: 'Clubs', clubsOnly: true },
            { id: 'rules', label: 'Rules we keep' },
            { id: 'privacy', label: 'Privacy' },
            { id: 'who', label: 'Who builds this' },
            { id: 'contact', label: 'Contact' },
            { id: 'log', label: 'Changelog' },
          ]}
        />
        <section className="wrap page-head">
          <Crumbs trail={[{ label: 'How it works' }]} />
          <h1>How Tropa Club works</h1>
          <p className="lede">
            Tropa Club does two things. It counts who really holds each Coinbase <Term id="stock-token">stock token</Term> on Base, and from {OPENS} it lets friends each buy about $10 a week from their own wallets and track it together.
          </p>
          <p className="hero-cta"><Link className="btn btn-accent" href="/#find">Check my wallet</Link><Link className="btn" href="/clubs#start">Start a club with friends</Link></p>
        </section>

        <section className="band" id="two" aria-labelledby="two-h">
          <div className="wrap">
            <div className="section-head"><h2 id="two-h">Two things we do<Anchor id="two" label="Two things we do" /></h2></div>
            <div className="split">
              {TWO_THINGS.map((t, i) => (
                <div key={t.title} className="split-text">
                  <h3>{i + 1}. {t.title}</h3>
                  <p>{t.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="wrap section-tight prose-solo">
          <div className="prose">
            <h2 id="glossary">Words we use<Anchor id="glossary" label="Words we use" /></h2>
            <p>The site borrows a few football words. Each one means exactly this:</p>
            <dl className="defs">
              {GLOSSARY_ORDER.map((id) => (
                <div key={id}><dt>{GLOSSARY[id].term}</dt><dd>{GLOSSARY[id].def}{id === 'caps' ? ` ${CAPS_COPY}` : ''}</dd></div>
              ))}
            </dl>

            <h2 id="idea">The idea<Anchor id="idea" label="The idea" /></h2>
            <p>
              Every stock token is drawn as a football ground, and every wallet holding it as a seat in that ground. In the {groundName(top.name, top.symbol)}, {fmtInt(top.holdersTotal)} wallets hold {top.symbol}, but only {fmtInt(top.realFans)} are real holders. The picture makes one point: a holder count is not a crowd.
            </p>
            <div className="rail" aria-hidden="true">
              {index.tokens.slice(0, 8).map((t, i) => (
                <span key={t.symbol} style={{ '--drop': `${[0, 18, 6, 24, 10, 0, 20, 4][i]}px` } as React.CSSProperties}><Pennant kit={kitFor(t.symbol)} width={28} /></span>
              ))}
            </div>

            <h2 id="method">Data method<Anchor id="method" label="Data method" /></h2>
            <ol className="method">
              <li><h3>Replay every transfer</h3><p>All Transfer logs of the {stats.tokensMinted || index.tokens.length} minted Coinbase stock tokens are read from Base, starting at the first mint on 12 Aug 2026, and replayed into balances. Replayed supply is checked against the reported total supply for every token.</p></li>
              <li><h3>Price each balance</h3><p>A balance is valued at the exchange (DEX) price of the token&rsquo;s most liquid pool at the time of the count. That price already includes the token&rsquo;s split and dividend <Term id="multiplier">multiplier</Term>. Tokens with no liquid pool have no dollar value and no $10 line.</p></li>
              <li><h3>Tell people from code</h3><p>Each address is checked for contract code. Plain wallets, delegated wallets and smart wallets (the kind wallet apps create) count as people. Pools, vaults, routers and other contracts do not.</p></li>
              <li><h3>Set giveaways aside</h3><p>Some contracts send small amounts to thousands of wallets. A wallet whose every incoming transfer came from one of those, with no purchase of its own, is &ldquo;airdrop-only&rdquo;.</p></li>
              <li><h3>Count the real holders</h3><p>A real holder (real fan) holds $10 or more, is a person&rsquo;s wallet, and is not airdrop-only. The real share (attendance) is real holders divided by all holders.</p></li>
              <li><h3>Count the buyers</h3><p>A weekly buyer is a wallet that ends up with tokens from an exchange purchase in that week. Wallets with more than 50 swaps in the week are treated as bots and left out.</p></li>
            </ol>
            <p>
              Across all tokens, {fmtInt(stats.holdersTotal)} wallets hold something and {fmtInt(stats.realWallets)} are real holders of at least one. The current count is from {fmtDate(index.asOf, true)}. The files behind every page are public: see the <Link href="/attendance#feed">free JSON feed</Link>.
            </p>

            <h2 id="seats">Grounds and tickets<Anchor id="seats" label="Grounds and tickets" /></h2>
            <p>
              Each ground is drawn to hold exactly its holders: a rounded bowl of rows around a pitch, split into 16 blocks per tier. Big grounds get two tiers. Small ones get one.
            </p>
            <p>
              Real holders are ranked by unbroken days held, then by who bought first. Rank one takes the best seat, pitchside at halfway, and the rest fill outward with a little scatter, the way a real crowd sits. <Term id="ghost-seat">Ghost seats</Term> (other holders) take what is left, drawn faint. <strong>How much a wallet holds never affects its rank or its seat.</strong> The top ten wallets own most of every token, so ranking by size would only ever show the same few.
            </p>
            <p>
              A ticket shows the block, row and seat, the real-holder number, and the wallet&rsquo;s best stat: hold time, arrival, entry price, or <Term id="weekly-run">weeks in a row</Term>, which is not the club payday streak. It shows no dollar amount, and it is a picture to share, not an NFT. When you tap Share, a picture of the ticket is made once and stored as a plain file, so the link previews instantly wherever it is pasted.
            </p>

            <div className="clubs-only">
              <h2 id="clubs">Clubs, from {OPENS}<Anchor id="clubs" label="Clubs" /></h2>
              <p>
                A club is a group of friends who each buy about $10 of stock tokens a week from their own wallets, paid in {PAY_WITH}. There is no shared pot. {RULE_LINE} Each member also keeps a <Term id="payday-streak">payday streak</Term>, a habit badge that never changes a score.
              </p>
              <p>
                Members who haven&rsquo;t bought this week show as &ldquo;on the Bench&rdquo;. A teammate can send them a one-tap nudge on WhatsApp or Telegram.
              </p>
              <p>
                From Mon Nov 30, clubs of 3 or more are paired each week with a club of a similar size. {FIXTURE_SHORT} <Link href="/clubs#how-scored">How a club is scored</Link>. Returns are for bragging rights only: no prize ever depends on them.
              </p>
              <p>
                Each stock token also has an open club, like the {openClubName(top.name, top.symbol)}, that anyone can join for free. Open clubs are ranked separately, on how many members buy and keep a streak, never on returns. {REAL_FAN_LINE}
              </p>
              <p>Tropa Club holds no funds, takes no fee, and has no contract of its own in the path of your money.</p>
            </div>

            <h2 id="rules">Rules we keep<Anchor id="rules" label="Rules we keep" /></h2>
            <ul className="rules">
              <li><h3>No advice</h3><p>Nothing here says what to buy, sell or hold. No stock is picked, tipped or scored.</p></li>
              <li><h3>Plain words about what a token is</h3><p>A stock token tracks the share price and gives economic exposure. It is not the share, and holding one carries no vote.</p></li>
              <li><h3>Never ranked by size</h3><p>Seats and real-holder numbers use time held. Club rankings use turnout and streaks, never returns and never dollar amounts, so $10 counts the same as $1 million.</p></li>
              <li><h3>No prize depends on returns</h3><p>Fixture points are bragging rights. Nothing of value is ever handed out for a return, and there are no odds or bets.</p></li>
              <li><h3>History doesn&rsquo;t predict the future</h3><p>Every chart with history says it can&rsquo;t predict the future. Nothing here is advice.</p></li>
              <li><h3>Honest about where buying is offered</h3><p>Buying and clubs: {REGION_LINE} Buying is hidden in the US and its territories. Checking wallets, grounds, tickets and stock rankings stays open everywhere.</p></li>
              <li><h3>Public records only</h3><p>Everything shown comes from the public Base chain. No sign-in is needed to look, and lookups are not stored against a wallet.</p></li>
              <li><h3>Attribution in the open</h3><p>From {OPENS}, buys made through Tropa Club carry <Term id="builder-code">Builder Code</Term> <code>{BUILDER_CODE}</code> (a public label Base uses to credit an app), so they can be counted. Founder and test wallets are kept out of every count and listed on the <Link href="/stats">stats page</Link>.</p></li>
            </ul>

            <h2 id="privacy">Privacy<Anchor id="privacy" label="Privacy" /></h2>
            <p>
              Looking is anonymous: no account, no sign-in, and wallet lookups are not stored against you. If you join a club, the link between your wallet and that club is kept on our server so the member list works; other members see your nickname or a shortened address. Signing in sets one cookie that proves the wallet is yours. Your IP address is used once per visit to tell whether you are in the United States, where buying is not offered. If you ask for a pick-up club, a scrambled form of your country is kept only until you are matched; your country itself is never stored with your wallet. IP geolocation by <a href="https://db-ip.com" rel="noopener">DB-IP</a>.
            </p>

            <h2 id="who">Who builds this<Anchor id="who" label="Who builds this" /></h2>
            <div className="who">
              {BUILDER.name && <p>Tropa Club is built by {BUILDER.name}.</p>}
              <p>Open source, recounted every 6 hours from public Base data.</p>
              <ul className="who-links">
                <li><span>Source code</span><a href={REPO_URL} rel="noopener">github.com/RohanGlitched/tropaclub</a></li>
                <li><span>On X</span><a href={X_URL} rel="noopener">@tropaclubxyz</a></li>
                <li><span>Docs</span><a href={DOCS_URL} rel="noopener">docs.tropaclub.xyz</a></li>
                {BUILDER.email && <li><span>Email</span><a href={`mailto:${BUILDER.email}`}>{BUILDER.email}</a></li>}
              </ul>
              <h3 id="money">Where your money goes</h3>
              <p>A buy goes from your own wallet to one contract, the KyberSwap router, pinned to this exact address. The app refuses any quote that names another router. The router trades only in Aerodrome Slipstream pools, made by the pool factories below. Each address opens on Basescan.</p>
              <dl className="who-addrs">
                <div><dt>KyberSwap router</dt><dd><a className="num addr-full" href={basescan(BUY_ROUTER)} rel="noopener">{BUY_ROUTER}</a></dd></div>
                {SLIPSTREAM_FACTORY_LIST.map((a, i) => (
                  <div key={a}><dt>Aerodrome Slipstream pool factory{SLIPSTREAM_FACTORY_LIST.length > 1 ? ` ${i + 1}` : ''}</dt><dd><a className="num addr-full" href={basescan(a)} rel="noopener">{a}</a></dd></div>
                ))}
              </dl>
              <p><strong>Tropa Club has no contract of its own and never holds funds.</strong></p>
              <p>Every buy carries the <Term id="builder-code">Builder Code</Term> <code>{BUILDER_CODE}</code>, a public tag Base uses to credit an app, so anyone can count buys made through Tropa Club on chain. <a href={BUILDER_CODE_DOCS} rel="noopener">How the Builder Code works</a></p>
            </div>

            <h2 id="contact">Contact<Anchor id="contact" label="Contact" /></h2>
            <p>
              Partners, researchers and press: the <a href={`${DOCS_URL}/for-partners`} rel="noopener">partners page in the docs</a> says what Tropa Club can share and how the data feed works. For anything else, send a direct message to <a href={X_URL} rel="noopener">@tropaclubxyz on X</a>. Tropa Club will never message you first to ask for a signature or a payment.
            </p>

            <h2 id="log">Changelog<Anchor id="log" label="Changelog" /></h2>
            <ul className="log log-wide">
              {UPCOMING.map((c) => (
                <li key={c.date}><b>{c.date}</b> <span><span className="tag tag-quiet">Next</span> {c.text}</span></li>
              ))}
              {CHANGELOG.map((c, i) => (
                <li key={`${c.date}-${i}`}><b>{c.date}</b> <span>{c.text}</span></li>
              ))}
            </ul>
            <p>Questions and corrections: <a href={X_URL} rel="noopener">@tropaclubxyz on X</a>.</p>
          </div>
        </section>

        <section className="closing">
          <div className="wrap closing-in">
            <h2>See it for yourself</h2>
            <p>Paste a wallet to see whether it is a real holder.</p>
            <SeatSearchBox label="Wallet address or name" button="Check wallet" />
          </div>
        </section>

        <NextStrip
          items={[
            { title: 'Start a club', sub: 'Name it and get an invite link for the group chat', href: '/clubs#start' },
            { title: 'Stock rankings', sub: 'Real holders of every stock token, ranked', href: '/attendance' },
          ]}
        />
      </main>
    </>
  );
}
