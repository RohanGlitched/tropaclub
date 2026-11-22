import type { Metadata } from 'next';
import Link from 'next/link';
import Term from '@/components/nav/Term';
import { Crumbs, NextStrip } from '@/components/nav/Wayfinding';
import PageSections from '@/components/nav/PageSections';
import Anchor from '@/components/nav/Anchor';
import OpensAt from '@/components/OpensAt';
import Countdown from '@/components/Countdown';
import SeasonMine from '@/components/season/SeasonMine';
import SeasonQuests from '@/components/season/SeasonQuests';
import { CapsCopy } from '@/components/season/CapsCopy';
import { getIndex } from '@/lib/server/data';
import { getSeasonStats } from '@/lib/server/season';
import { shortName } from '@/lib/clubs';
import { fmtDate, fmtInt } from '@/lib/format';
import { SEASON1, X_HANDLE, X_URL } from '@/lib/season';
import { DOCS_URL, PAUSED_MESSAGE, PLAY_USD, REGION_LINE, SCOUT_RULES, SITE_URL, buyState, notAffiliated, seasonPhase, utcDay, utcWhen } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Season 1 airdrop',
  description: 'Season 1 runs Tue Nov 24 to Fri Dec 4. Caps earned for buying through Tropa Club, holding and bringing friends count toward the planned $TROPA airdrop. The token may never launch and may have no value. The terms, the checks and your Caps.',
};

const caps2 = (n: number) => n.toFixed(2);
const C = SEASON1.caps;
const S = SEASON1.social;

/** Every Cap value of Season 1, from rules.json. */
const EARN: { what: React.ReactNode; caps: string; note: string; max?: boolean }[] = [
  { what: <>Played a <Term id="gameweek">gameweek</Term>: a verified buy of ${PLAY_USD} or more through Tropa Club in it</>, caps: caps2(C.played), note: 'Once a gameweek.' },
  { what: <>That buy still held, ${SCOUT_RULES.holdUsd} or more, 7 days later (day 7)</>, caps: `+${caps2(C.heldD7)}`, note: 'Added on day 7.' },
  { what: <>Each credited friend (a <Term id="scout">scout</Term> credit)</>, caps: `+${caps2(C.scout)}`, note: `Up to ${C.scoutPerGw} friends a gameweek.` },
  { what: 'Most you can earn in one gameweek', caps: caps2(C.perGw), note: 'Played, holding and friends together.', max: true },
  { what: 'Founder Cap', caps: `+${caps2(SEASON1.founderCaps)}`, note: `${SEASON1.earn.founderRule} ${SEASON1.earn.founderNote}` },
  { what: <>Follow @{X_HANDLE} on X (a <Term id="social-quest">social quest</Term>)</>, caps: `+${caps2(S.follow)}`, note: 'Once.' },
  { what: 'Like and repost the Season 1 post on X', caps: `+${caps2(S.likeRepost)}`, note: 'Once, when the post is up.' },
  { what: 'Post your ticket on X', caps: `+${caps2(S.post)}`, note: 'Once.' },
  { what: 'Most from social quests', caps: caps2(S.max), note: `${SEASON1.earn.socialNote} Counted only after the wallet’s first verified Season 1 buy.`, max: true },
];

/** The anti-farming checks, in plain words. */
const CHECKS: { title: string; text: string }[] = [
  { title: 'Shared funders', text: 'A friend funded from the scout’s wallet, or sharing a first funder with the scout or with another of the scout’s friends, earns the scout nothing. A first funder is the first wallet that sent it money, native ETH included. The same rule applies to the founder Cap.' },
  { title: 'Wash trades', text: 'A buy, then a sell, then another buy of the same token within 24 hours scores nothing, for either buy.' },
  { title: 'Buys that don’t verify', text: 'Only buys made through Tropa Club that pass every check count: from the wallet itself, through the pinned route, at a fair price, with the stock token received. Anything else earns no Caps.' },
  { title: 'Team wallets', text: 'Founder, test and contest wallets are on a public exclusion list and get no allocation. The list is on the stats page.' },
  { title: 'New wallets are provisional', text: `A wallet first seen less than ${SEASON1.provisionalHours} hours before its first verified buy is held as provisional. Its Caps show on the table but are decided at the snapshot.` },
  { title: 'Social spot-checks', text: 'Social quests are self-reported. We spot-check before the snapshot; claims we can’t confirm are removed.' },
  { title: 'One person, one X account', text: 'One X handle per wallet and one wallet per handle. Duplicate X accounts or wallets are removed and can disqualify the wallet.' },
];

export default async function SeasonPage() {
  const [stats, { data: index }] = await Promise.all([getSeasonStats(), getIndex()]);
  const now = Date.now();
  const phase = seasonPhase(now);
  const buy = buyState(now);
  const names = Object.fromEntries(index.tokens.map((t) => [t.symbol, shortName(t.name, t.symbol)]));
  const counting = !!stats && (stats.capsIssued > 0 || stats.wallets > 0);
  const excluded = stats?.excluded ?? [];

  return (
    <main id="main">
      <PageSections
        sections={[
          { id: 'numbers', label: 'Season 1 so far' },
          { id: 'yours', label: 'Your Caps' },
          { id: 'earn', label: 'How to earn' },
          { id: 'quests', label: 'Social quests', clubsOnly: true },
          { id: 'timeline', label: 'Timeline' },
          { id: 'checks', label: 'Checks' },
          { id: 'terms', label: 'Airdrop terms' },
          { id: 'faq', label: 'Questions' },
        ]}
      />

      <section className="wrap page-head s1-head">
        <Crumbs trail={[{ label: SEASON1.navLabel }]} />
        <div className="s1-head-grid">
          <div className="s1-head-text">
            <p className="hero-pitch">{SEASON1.name} · {utcDay(SEASON1.startAt)} to {utcDay(SEASON1.endAt)}</p>
            <h1>{SEASON1.headline}</h1>
            <p className="lede">
              Play each <Term id="gameweek">gameweek</Term>, keep holding and bring friends. The <Term id="caps">Caps</Term> you earn in <Term id="season-1">Season 1</Term> count toward the planned $TROPA airdrop. The amount you buy doesn&rsquo;t matter, and there&rsquo;s no guarantee the token launches or has any value.
            </p>
            {phase === 'before' ? (
              <>
                <p className="s1-status"><span className="tag">Opens soon</span> Season 1 opens <OpensAt at={SEASON1.startAt} />.</p>
                <p className="s1-count">Starts <Countdown at={SEASON1.startAt} now={now} /></p>
              </>
            ) : phase === 'during' ? (
              <p className="s1-status">
                <span className="tag">On now</span> {buy === 'paused' ? `${PAUSED_MESSAGE} ` : 'Season 1 is on. '}It ends with the <Term id="snapshot">snapshot</Term> on <OpensAt at={SEASON1.endAt} />.
              </p>
            ) : (
              <p className="s1-status">
                <span className="tag tag-quiet">Ended</span> Season 1 ended {utcWhen(SEASON1.endAt)}. The snapshot is being settled, and every wallet&rsquo;s share is published before any claim opens.
              </p>
            )}
            <p className="hero-cta">
              <a className="btn btn-accent" href="#earn">How to earn</a>
              <a className="btn" href="#terms">Airdrop terms</a>
            </p>
            <p className="asof"><span className="tag tag-quiet">Planned token</span> $TROPA has not launched. Caps are points, not a token, and can&rsquo;t be bought, sold or transferred. Not financial advice.</p>
          </div>
          <aside className="s1-glance" aria-label="Season 1 at a glance">
            <p className="s1-glance-title">Season 1 at a glance</p>
            <dl>
              <div><dt>Opens</dt><dd className="num">{utcWhen(SEASON1.startAt)}</dd></div>
              <div><dt>Snapshot</dt><dd className="num">{utcWhen(SEASON1.endAt)}</dd></div>
              <div><dt>Gameweeks</dt><dd>{SEASON1.gameweeks.join(' and ')}</dd></div>
              <div><dt>Most a gameweek</dt><dd className="num">{caps2(C.perGw)} Caps</dd></div>
              <div><dt>Founder Cap</dt><dd className="num">+{caps2(SEASON1.founderCaps)}, once</dd></div>
              <div><dt>Social quests</dt><dd className="num">up to {caps2(S.max)}</dd></div>
              <div><dt>Amount bought</dt><dd>Doesn&rsquo;t count</dd></div>
            </dl>
            <p className="s1-glance-foot">A planned token. No guarantee it launches or has any value.</p>
          </aside>
        </div>
      </section>

      <section className="wrap section-tight" id="numbers" aria-labelledby="numbers-h">
        <h2 className="h3" id="numbers-h">Season 1 so far<Anchor id="numbers" label="Season 1 so far" /></h2>
        {!stats ? (
          <p className="notice">The Season 1 numbers could not be loaded just now. Nothing is lost; try again in a minute.</p>
        ) : (
          <>
            <dl className="figures s1-figures">
              <div>
                <dt>Caps issued</dt>
                <dd className="num">{caps2(stats.capsIssued)}</dd>
                <p>{counting ? `Across every wallet with Caps, social quests included. ${fmtInt(stats.founderCaps)} founder ${stats.founderCaps === 1 ? 'Cap' : 'Caps'} so far.` : phase === 'before' ? 'Counting starts when Season 1 opens.' : 'None yet: the first are given once buys are recorded.'}</p>
              </div>
              <div>
                <dt>Wallets with Caps</dt>
                <dd className="num">{fmtInt(stats.wallets)}</dd>
                <p>Wallets on the Season 1 table. Team wallets are left out.</p>
              </div>
              <div>
                <dt>Provisional wallets</dt>
                <dd className="num">{fmtInt(stats.provisionalWallets)}</dd>
                <p>{stats.provisionalWallets ? `Holding ${caps2(stats.provisionalCaps)} Caps, decided at the snapshot.` : 'New wallets are held here until the snapshot.'}</p>
              </div>
              <div>
                <dt>Social Caps counted</dt>
                <dd className="num">{caps2(stats.socialCaps)}</dd>
                <p>{fmtInt(stats.socialPending)} {stats.socialPending === 1 ? 'claim' : 'claims'} pending a first verified buy or the next update.</p>
              </div>
            </dl>
            <p className="asof">Updated {fmtDate(stats.updatedAt, true)}. The numbers refresh about every minute.</p>
          </>
        )}
      </section>

      <section className="band" id="yours" aria-labelledby="yours-h">
        <div className="wrap split s1-yours">
          <div className="split-text">
            <h2 id="yours-h">Your Caps<Anchor id="yours" label="Your Caps" /></h2>
            <p>Signed in, your own Caps, rank and where they came from show here. Any wallet&rsquo;s Season 1 total is public, like the table, so you can also paste one to check it.</p>
            <ul className="ticks">
              <li>Holding at day 7 and friends are added on day 7, so a total can still grow after a gameweek ends.</li>
              <li>A provisional wallet&rsquo;s Caps are decided at the snapshot.</li>
              <li>Ties on the table go to the earlier first verified buy.</li>
            </ul>
            <p><Link href="/league?tab=caps" prefetch={false}>See the whole Season 1 table</Link></p>
          </div>
          <SeasonMine />
        </div>
      </section>

      <section className="wrap section" id="earn" aria-labelledby="earn-h">
        <div className="section-head">
          <h2 id="earn-h">How to earn Caps<Anchor id="earn" label="How to earn Caps" /></h2>
          <p>Small fixed values, a fixed most per gameweek, and nothing for the size of a buy: a ${PLAY_USD} buy counts the same as a $500 one. Season 1 is gameweeks {SEASON1.gameweeks.join(' and ')}.</p>
        </div>
        <table className="mini-table s1-earn">
          <caption className="sr">Season 1 Caps values</caption>
          <thead>
            <tr><th scope="col">For</th><th scope="col" className="r">Caps</th><th scope="col">Limit</th></tr>
          </thead>
          <tbody>
            {EARN.map((r, i) => (
              <tr key={i} className={r.max ? 's1-earn-max' : undefined}>
                <th scope="row">{r.what}</th>
                <td className="r num">{r.caps}</td>
                <td>{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="limits s1-earn-notes">
          <li><h3>The amount doesn&rsquo;t count</h3><p>Only playing and holding count. ${PLAY_USD} and $500 earn the same Caps, and returns decide nothing.</p></li>
          <li><h3>An example week</h3><p>Buy ${PLAY_USD} in GW0 and still hold it a week later: {caps2(C.played + C.heldD7)} Caps. Two friends who buy through your link and still hold on day 7 add {caps2(2 * C.scout)}.</p></li>
          <li><h3>Written once</h3><p>Every award goes into an append-only ledger, so a total is the sum of what was earned and is never recalculated upward.</p></li>
        </ul>
        <p className="board-copy"><CapsCopy /></p>
        <p className="after-table">
          <Link className="btn" href="/league?tab=caps" prefetch={false}>The Season 1 table</Link>{' '}
          <a className="btn" href={`${DOCS_URL}/season-1-airdrop`} rel="noopener">The rules in the docs</a>
        </p>
      </section>

      <section className="band clubs-only" id="quests" aria-labelledby="quests-h">
        <div className="wrap split s1-quests-wrap">
          <div className="split-text">
            <h2 id="quests-h">Social quests<Anchor id="quests" label="Social quests" /></h2>
            <p>Three small quests on X, worth at most {caps2(S.max)} Caps for the whole season. Add your X handle once, do a quest, then tap &ldquo;I did this&rdquo;.</p>
            <ul className="ticks">
              <li>Social Caps count only once your wallet has a verified Season 1 buy. Until then they wait as pending.</li>
              <li>One handle per wallet, one wallet per handle. The handle can&rsquo;t be changed after your first claim.</li>
              <li>We spot-check before the snapshot; claims we can&rsquo;t confirm are removed.</li>
            </ul>
          </div>
          <SeasonQuests names={names} siteUrl={SITE_URL} phase={phase} />
        </div>
      </section>
      <section className="wrap section-tight us-only">
        <p className="notice">Season 1 quests and the airdrop aren&rsquo;t available to US persons or in sanctioned regions. You can still read the terms and check any wallet&rsquo;s Caps.</p>
      </section>

      <section className="wrap section" id="timeline" aria-labelledby="timeline-h">
        <div className="section-head">
          <h2 id="timeline-h">Season 1 timeline<Anchor id="timeline" label="Season 1 timeline" /></h2>
          <p>All times in UTC. Dates still to come are announced on <a href={X_URL} rel="noopener">@{X_HANDLE}</a> first.</p>
        </div>
        <ol className="s1-timeline">
          {SEASON1.timeline.map((t, i) => {
            const past = t.at != null && Date.parse(t.at) <= now;
            return (
              <li key={t.title} data-past={past || undefined}>
                <span className="s1-tl-no num" aria-hidden="true">{i + 1}</span>
                <div>
                  <p className="s1-tl-when">{t.at ? <time dateTime={t.at}>{utcWhen(t.at)}</time> : 'Date to come'}{past && <span className="tag tag-quiet">Done</span>}</p>
                  <h3>{t.title}</h3>
                  <p>{t.text}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="band" id="checks" aria-labelledby="checks-h">
        <div className="wrap">
          <div className="section-head">
            <h2 id="checks-h">Checks and exclusions<Anchor id="checks" label="Checks and exclusions" /></h2>
            <p>Caps are meant for people who buy and hold, so farming them with many wallets doesn&rsquo;t work. These checks run before anything counts, and again before the snapshot.</p>
          </div>
          <ul className="limits">
            {CHECKS.map((c) => (
              <li key={c.title}><h3>{c.title}</h3><p>{c.text}</p></li>
            ))}
          </ul>
          <h3 className="table-title s1-ex-h">What the checks have caught so far</h3>
          {excluded.length ? (
            <table className="mini-table s1-ex">
              <caption className="sr">Season 1 exclusions, counts only</caption>
              <thead><tr><th scope="col">Reason</th><th scope="col" className="r">Count</th></tr></thead>
              <tbody>
                {excluded.map((e) => (
                  <tr key={e.key}><th scope="row">{e.label}</th><td className="r num">{fmtInt(e.count)}</td></tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="notice">{stats ? 'Nothing caught yet.' : 'The counts could not be loaded just now. Try again in a minute.'}</p>
          )}
          <p className="muted small s1-ex-note">Counts only, never addresses. <Link href="/stats" prefetch={false}>The team and test wallets are listed on the stats page.</Link></p>
        </div>
      </section>

      <section className="wrap section" id="terms" aria-labelledby="terms-h">
        <div className="section-head">
          <h2 id="terms-h">Airdrop terms<Anchor id="terms" label="Airdrop terms" /></h2>
          <p>The terms of the planned $TROPA airdrop for Season 1, in full. Read them before you take part.</p>
        </div>
        <div className="split s1-terms">
          <div className="split-text">
            <h3>The airdrop</h3>
            <ol className="s1-terms-list">
              {SEASON1.terms.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ol>
          </div>
          <div className="split-text">
            <h3>Social quests</h3>
            <ol className="s1-terms-list">
              {SEASON1.socialTerms.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ol>
            <h3>Where it applies</h3>
            <p>{REGION_LINE}</p>
            <p className="muted small">{notAffiliated([])} Past results don&rsquo;t predict future results. Nothing here is advice, and nothing here is an offer to sell or a promise of a token.</p>
          </div>
        </div>
      </section>

      <section className="band" id="faq" aria-labelledby="faq-h">
        <div className="wrap">
          <div className="section-head"><h2 id="faq-h">Questions<Anchor id="faq" label="Questions" /></h2></div>
          <dl className="defs s1-faq">
            {SEASON1.faq.map((f) => (
              <div key={f.q}><dt>{f.q}</dt><dd>{f.a}</dd></div>
            ))}
            <div><dt>Where do I hear about changes?</dt><dd>On <a href={X_URL} rel="noopener">@{X_HANDLE}</a> on X. The terms may be updated before the snapshot, and every change is announced there.</dd></div>
          </dl>
        </div>
      </section>

      <section className="closing">
        <div className="wrap closing-in">
          <h2>Play your first Season 1 gameweek</h2>
          <p>Buy ${PLAY_USD} or more through Tropa Club in a gameweek and you have your first Cap. Bring friends in a club and they count too.</p>
          <p className="closing-links"><Link className="btn btn-accent" href="/attendance">Pick a stock token</Link><Link href="/clubs#start">Start a club</Link><Link href="/clubs#join">Join a club</Link><Link href="/league?tab=caps">The Season 1 table</Link></p>
          <p className="muted small s1-close-note">{phase === 'before' ? <>Buying opens <OpensAt at={SEASON1.startAt} />. </> : ''}{REGION_LINE}</p>
        </div>
      </section>

      <NextStrip
        items={[
          { title: 'Season 1 points (Caps)', sub: 'Every wallet with Caps, ranked', href: '/league?tab=caps' },
          { title: 'Clubs', sub: 'Start or join a club for your group chat', href: '/clubs' },
        ]}
      />
    </main>
  );
}
