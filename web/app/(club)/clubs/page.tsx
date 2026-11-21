import type { Metadata } from 'next';
import Link from 'next/link';
import { InviteCodeForm, PickupButton, StartClub } from '@/components/club/Actions';
import { Crest, Pennant } from '@/components/ds/Pennant';
import ClubPreview from '@/components/ClubPreview';
import StockClubList from '@/components/club/StockClubList';
import { crestOf, ensureStockClubs, tryClubs } from '@/lib/server/clubs';
import { getIndex } from '@/lib/server/data';
import { sessionWallet } from '@/lib/server/session';
import { fmtInt } from '@/lib/format';
import { DOCS_URL, OPENS, RULE_LINE, buyIsOpen } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Clubs: $10 a week in stocks with your group chat',
  description: 'Start a free investing club for your group chat, join one with an invite, get matched into a pick-up club of five, or support a stock club. Everyone buys from their own wallet.',
};

export default async function ClubsPage() {
  const [wallet, { data: index }] = await Promise.all([sessionWallet(), getIndex()]);
  const data = await tryClubs(async (svc) => {
    await ensureStockClubs(svc);
    const [stock, priv, pick, mine] = await Promise.all([svc.listClubs('stock'), svc.listClubs('private'), svc.listClubs('pickup'), wallet ? svc.walletClubs(wallet) : Promise.resolve([])]);
    return { stock, priv, pick, mine, now: svc.ctx.now() };
  });
  const preLaunch = !buyIsOpen();
  const stock = new Map((data?.stock ?? []).map((c) => [c.stockSymbol, c]));
  const stockRows = index.tokens.map((t) => ({ symbol: t.symbol, name: t.name, realFans: t.realFans, supporters: stock.get(t.symbol)?.memberCount ?? 0, playing: stock.get(t.symbol)?.playingCount ?? 0 }));
  const founded = data ? data.priv.length + data.pick.length : 0;

  return (
    <main id="main">
      <section className="wrap page-head">
        <h1>Clubs</h1>
        <p className="lede">
          A club is your group chat putting $10 a week into stock tokens, each from their own wallet. Tropa Club keeps the team sheet, the Matchday score and the streaks. It holds no money and takes no fee.
        </p>
        {preLaunch && <p className="opens"><span className="tag">Buying opens {OPENS}</span> Found your club and fill the Bench now.</p>}
        {data && (
          <p className="asof">
            {founded > 0 ? `${fmtInt(founded)} ${founded === 1 ? 'club' : 'clubs'} founded so far.` : 'No club founded yet: yours can be founding club No. 1.'} Every one of the {index.tokens.length} stocks also has a supporters’ club.
          </p>
        )}
      </section>

      {!data && (
        <section className="wrap section-tight">
          <p className="notice">The clubhouse is not answering just now, so clubs cannot be listed or joined. Nothing is lost. Try again in a minute.</p>
        </section>
      )}

      {data && data.mine.length > 0 && (
        <section className="wrap section-tight" aria-label="Your clubs">
          <h2 className="h3">Your clubs</h2>
          <div className="club-grid">
            {data.mine.map(({ club, member }) => (
              <Link key={club.id} href={`/club/${club.id}`} className="club-card">
                <Pennant kit={crestOf(club)} width={30} />
                <span>
                  <b>{club.name}</b>
                  <small>{member.seat === 'playing' ? 'Playing seat' : 'Bench seat'}, {fmtInt(club.memberCount)} {club.memberCount === 1 ? 'member' : 'members'}</small>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="band" id="start">
        <div className="wrap split">
          <div className="split-text">
            <h2>Found a club</h2>
            <p>Name it and Tropa Club cuts its crest. You get an invite link for the group chat. Everyone who opens it takes a free seat on the Bench.</p>
            <ul className="ticks">
              <li>Up to 50 members. A wallet can found five clubs and sit in twelve.</li>
              <li>A seat on the Bench needs no buy. {RULE_LINE}</li>
              <li>Clubs of three or more play fixtures against clubs their size.</li>
            </ul>
          </div>
          <StartClub />
        </div>
      </section>

      <section className="wrap section" id="join">
        <div className="split">
          <div className="split-text">
            <h2>Join with an invite</h2>
            <p>Private clubs are joined with a link from someone inside. Paste it here, or just open it.</p>
            <InviteCodeForm />
          </div>
          <div className="split-text">
            <h2>No group chat? Get a pick-up club</h2>
            <p>Ask to be matched and you are seated with four others from your part of the world. A pick-up club plays as soon as it has three. It gets a region name and a crest, and it never shows where any member is from.</p>
            <PickupButton />
            <p className="muted small">Your country is used once to match you and is not stored with your wallet. Wallets funded from the same source are never seated together.</p>
          </div>
        </div>
      </section>

      <section className="band" id="supporters">
        <div className="wrap">
          <div className="section-head">
            <h2>Support a stock club</h2>
            <p>Every one of the {index.tokens.length} stocks has a public club, the same one whose ground you can walk. The biggest crowds are listed first. Stock clubs do not play fixtures. They sit in the Supporters table, ranked on turnout and streaks, never on returns.</p>
          </div>
          <StockClubList rows={stockRows} />
          <p className="after-table"><Link className="btn" href="/league#supporters">See the Supporters table</Link></p>
        </div>
      </section>

      <section className="wrap section">
        <div className="section-head">
          <h2>What a Matchday looks like</h2>
          <p>A working preview with made-up names. Four of five have bought this week. Call up the one on the Bench.</p>
        </div>
        <ClubPreview />
      </section>

      <section className="band">
        <div className="wrap">
          <div className="section-head">
            <h2>How a club is scored</h2>
          </div>
          <ul className="limits">
            <li><h3>You play by buying</h3><p>{RULE_LINE} Any stock token counts, bought through Tropa Club before the last close of the week.</p></li>
            <li><h3>Turnout comes first</h3><p>When 80% or more of a club plays, it earns a bonus point. That is what call-ups are for.</p></li>
            <li><h3>Fixtures are bragging rights</h3><p>A fixture goes to the club whose playing members had the higher median return for the week, in percent. No prize ever depends on it.</p></li>
            <li><h3>Size never counts</h3><p>Scores use percentages and head counts. Ten dollars counts the same as ten thousand.</p></li>
            <li><h3>Your money stays yours</h3><p>Each buy goes from your wallet to a public exchange route. There is no club pot and nothing to withdraw.</p></li>
            <li><h3>Not in the United States</h3><p>Buying and call-ups are not offered to US persons. Clubs can still be viewed there.</p></li>
          </ul>
          <p className="after-table">
            <Link className="btn" href="/league">The league</Link>{' '}
            <a className="btn" href={DOCS_URL} rel="noopener">Read the full rules</a>
          </p>
        </div>
      </section>

      <section className="closing">
        <div className="wrap closing-in">
          <div className="closing-crests" aria-hidden="true">
            {(data?.priv ?? []).slice(0, 6).map((c) => <Crest key={c.id} recipe={crestOf(c)} width={34} />)}
          </div>
          <h2>Bring the group chat</h2>
          <p>Found a club in a minute. It is free, and the Bench is open to everyone you invite.</p>
          <p className="closing-links"><Link className="btn btn-accent" href="#start">Found a club</Link><Link href="/about">How it works</Link></p>
        </div>
      </section>
    </main>
  );
}
