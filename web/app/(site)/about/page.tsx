import type { Metadata } from 'next';
import Link from 'next/link';
import SeatSearchBox from '@/components/SeatSearchBox';
import { Pennant } from '@/components/ds/Pennant';
import { getIndex, getStats } from '@/lib/server/data';
import { groundPath, kitFor } from '@/lib/clubs';
import { fmtDate, fmtInt } from '@/lib/format';
import { BUILDER_CODE, CHANGELOG, OPENS, UPCOMING, X_URL, DOCS_URL } from '@/lib/site';

export const revalidate = 300;
export const metadata: Metadata = {
  title: 'How it works: the count, the ground and the rules we keep',
  description: 'How Tropa Club counts real holders of stock tokens on Base, how seats and tickets are given out, and the rules it keeps: no advice, no ranking by size, no custody.',
};

export default async function AboutPage() {
  const [{ data: index }, { data: stats }] = await Promise.all([getIndex(), getStats()]);
  const top = index.tokens[0];
  return (
    <>
      <main id="main">
        <section className="wrap page-head">
          <h1>How Tropa Club works</h1>
          <p className="lede">
            Stock tokens on Base report tens of thousands of holders. Most of those wallets hold cents. Tropa Club counts the ones who are really there, gives each a seat, and from {OPENS} lets them form clubs that put $10 a week in together.
          </p>
        </section>

        <section className="wrap section-tight prose-grid">
          <nav className="toc" aria-label="On this page">
            <a href="#idea">The idea</a>
            <a href="#method">Data method</a>
            <a href="#seats">Seats and tickets</a>
            <a href="#clubs" className="clubs-only">Clubs</a>
            <a href="#rules">Rules we keep</a>
            <a href="#privacy">Privacy</a>
            <a href="#contact">Contact</a>
            <a href="#log">Changelog</a>
          </nav>
          <div className="prose">
            <h2 id="idea">The idea</h2>
            <p>
              Every stock token is treated as a football club, and every wallet holding it as a seat in that club&rsquo;s ground. A club such as &ldquo;{top.name} FC&rdquo; has sold {fmtInt(top.holdersTotal)} tickets, but only {fmtInt(top.realFans)} fans are in the ground. The picture makes one point: a holder count is not a crowd.
            </p>
            <div className="rail" aria-hidden="true">
              {index.tokens.slice(0, 8).map((t, i) => (
                <span key={t.symbol} style={{ '--drop': `${[0, 18, 6, 24, 10, 0, 20, 4][i]}px` } as React.CSSProperties}><Pennant kit={kitFor(t.symbol)} width={28} /></span>
              ))}
            </div>

            <h2 id="method">Data method</h2>
            <ol className="method">
              <li><h3>Replay every transfer</h3><p>All Transfer logs of the {stats.tokensMinted || index.tokens.length} minted Coinbase stock tokens are read from Base, starting at the first mint on 12 Aug 2026, and replayed into balances. Replayed supply is checked against the reported total supply for every token.</p></li>
              <li><h3>Price each balance</h3><p>A balance is valued at the DEX price of the token&rsquo;s most liquid pool at the time of the count. That price already includes the token&rsquo;s split and dividend multiplier. Tokens with no liquid pool have no dollar value and no $10 line.</p></li>
              <li><h3>Tell people from code</h3><p>Each address is checked for contract code. Plain wallets, delegated wallets and smart wallets (the kind wallet apps create) count as people. Pools, vaults, routers and other contracts do not.</p></li>
              <li><h3>Set giveaways aside</h3><p>Some contracts send small amounts to thousands of wallets. A wallet whose every incoming transfer came from one of those, with no purchase of its own, is &ldquo;farmer-only&rdquo;.</p></li>
              <li><h3>Count the fans</h3><p>A real fan holds $10 or more, is a person&rsquo;s wallet, and is not farmer-only. Attendance is real fans divided by tickets sold.</p></li>
              <li><h3>Count the buyers</h3><p>A weekly buyer is a wallet that ends up with tokens from a DEX purchase in that week. Wallets with more than 50 swaps in the week are treated as bots and left out.</p></li>
            </ol>
            <p>
              Across all tokens, {fmtInt(stats.holdersTotal)} wallets hold something and {fmtInt(stats.realWallets)} are real fans somewhere. The current count is from {fmtDate(index.asOf, true)}. The files behind every page are public: see the <Link href="/attendance#feed">free JSON feed</Link>.
            </p>

            <h2 id="seats">Seats and tickets</h2>
            <p>
              Each ground is drawn to hold exactly its holders: a rounded bowl of rows around a pitch, split into 16 blocks per tier. Big clubs get two tiers. Small clubs get a small ground.
            </p>
            <p>
              Real fans are ranked by unbroken days held, then by who bought first. Rank one takes the best seat, pitchside at halfway, and the rest fill outward with a little scatter, the way a real crowd sits. Ghost seats take what is left. <strong>How much a wallet holds never affects its rank or its seat.</strong> The top ten wallets own most of every token, so ranking by size would only ever show the same few.
            </p>
            <p>
              A ticket prints the block, row and seat, the fan number, and the wallet&rsquo;s best true stat. It prints no dollar amount. When you tap Share, a picture of the ticket is made once and stored as a plain file, so the link previews instantly wherever it is pasted.
            </p>

            <div className="clubs-only">
              <h2 id="clubs">Clubs, from {OPENS}</h2>
              <p>
                A club is a group of friends who each put $10 a week into stock tokens from their own wallets. A member who buys $5 or more in a gameweek has played that Matchday. Members who have not are on the Bench, and a teammate can call them up with one tap. Fixtures between private and pick-up clubs are decided on the median gameweek return of the members who played: three points for a win, one for a draw, and one more when 80% or more of the club played. Returns are status only: no prize ever depends on them. Stock clubs sit in a separate Supporters table that ignores returns and ranks on turnout and streaks.
              </p>
              <p>Tropa Club holds no funds, takes no fee, and has no contract of its own in the path of your money.</p>
            </div>

            <h2 id="rules">Rules we keep</h2>
            <ul className="rules">
              <li><h3>No advice</h3><p>Nothing here says what to buy, sell or hold. No stock is picked, tipped or scored.</p></li>
              <li><h3>Plain words about what a token is</h3><p>A stock token tracks the share price and gives economic exposure. It is not the share, and holding one carries no vote.</p></li>
              <li><h3>Never ranked by size</h3><p>Seats and fan numbers use time held. Club tables use turnout, streaks and percentage returns, never dollar amounts, so a tenner counts the same as a fortune.</p></li>
              <li><h3>No prize depends on returns</h3><p>Fixture results are bragging rights. Nothing of value is ever handed out for a return, and there are no odds or bets.</p></li>
              <li><h3>Past performance · not advice</h3><p>Every card and table that shows history carries that line.</p></li>
              <li><h3>Honest about where buying is offered</h3><p>Buying will be hidden in countries where it cannot be offered. The ground, the tickets and The Attendance stay open everywhere.</p></li>
              <li><h3>Public records only</h3><p>Everything shown comes from the public Base chain. No sign-in is needed to look, and lookups are not stored against a wallet.</p></li>
              <li><h3>Attribution in the open</h3><p>From {OPENS}, buys made through Tropa Club carry Builder Code <code>{BUILDER_CODE}</code> so they can be counted on Base. Founder and test wallets are kept out of every count and listed on the <Link href="/stats">stats page</Link>.</p></li>
            </ul>

            <h2 id="privacy">Privacy</h2>
            <p>
              Looking is anonymous: no account, no sign-in, and wallet lookups are not stored against you. If you join a club, the link between your wallet and that club is kept on our server so the team sheet works; other members see your nickname or a shortened address. Signing in sets one cookie that proves the wallet is yours. Your IP address is used once per visit to tell whether you are in the United States, where buying is not offered. If you ask for a pick-up club, a scrambled form of your country is kept only until you are seated; your country itself is never stored with your wallet. IP geolocation by <a href="https://db-ip.com" rel="noopener">DB-IP</a>.
            </p>

            <h2 id="contact">Contact</h2>
            <p>
              Partners, researchers and press: the <a href={`${DOCS_URL}/for-partners`} rel="noopener">partners page in the docs</a> says what Tropa Club can share and how the data feed works. For anything else, send a direct message to <a href={X_URL} rel="noopener">@tropaclubxyz on X</a>. Tropa Club will never message you first to ask for a signature or a payment.
            </p>

            <h2 id="log">Changelog</h2>
            <ul className="log log-wide">
              {UPCOMING.map((c) => (
                <li key={c.date}><b>{c.date}</b> <span><span className="tag tag-quiet">Next</span> {c.text}</span></li>
              ))}
              {CHANGELOG.map((c) => (
                <li key={c.date}><b>{c.date}</b> <span>{c.text}</span></li>
              ))}
            </ul>
            <p>Questions and corrections: <a href={X_URL} rel="noopener">@tropaclubxyz on X</a>.</p>
          </div>
        </section>

        <section className="closing">
          <div className="wrap closing-in">
            <h2>See it for yourself</h2>
            <p>Paste a wallet and find its seat.</p>
            <SeatSearchBox label="Wallet address or name" button="Find seat" />
          </div>
        </section>
      </main>
    </>
  );
}
