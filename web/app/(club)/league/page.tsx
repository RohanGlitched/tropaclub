import type { Metadata } from 'next';
import Link from 'next/link';
import { ClubLeagueTable, PreseasonTable, SupportersTable } from '@/components/club/Tables';
import { crestOf, ensureStockClubs, tryClubs } from '@/lib/server/clubs';
import { DOCS_URL, OPENS } from '@/lib/site';

export const metadata: Metadata = {
  title: 'The league: club standings and the Supporters table',
  description: 'Standings for private and pick-up clubs on Tropa Club, and the Supporters table for stock clubs, ranked on turnout and streaks.',
};

export default async function LeaguePage() {
  const data = await tryClubs(async (svc) => {
    await ensureStockClubs(svc);
    const [league, pre, sup, clubs] = await Promise.all([svc.getLeagueTable(), svc.getPreseasonTable(), svc.getSupportersTable(), svc.listClubs()]);
    return { league, pre, sup, clubs };
  });
  const byId = new Map((data?.clubs ?? []).map((c) => [c.id, c]));
  const crest = (id: string, seed: string) => crestOf(byId.get(id) ?? { crestSeed: seed });
  const league = (data?.league.rows ?? []).map((r) => ({ ...r, crest: crest(r.clubId, r.crestSeed), note: r.form.length ? `Form ${r.form.slice(-5).join(' ')}` : null }));
  const pre = (data?.pre ?? []).map((r) => ({ ...r, crest: crest(r.clubId, r.crestSeed), note: null }));
  const sup = (data?.sup.rows ?? []).map((r) => ({ ...r, crest: crest(r.clubId, r.crestSeed), note: r.stockSymbol }));
  const season = league.length > 0;

  return (
    <main id="main">
      <section className="wrap page-head">
        <h1>The league</h1>
        <p className="lede">
          Private and pick-up clubs play fixtures against clubs their size. Stock clubs have a table of their own. Every number here is a head count or a percentage: no club is ranked by how much money it holds.
        </p>
        <p className="asof">{season ? `Through ${data?.league.throughGw?.replace('GW', 'gameweek ') ?? 'the last gameweek'}.` : 'Gameweek 0 is preseason: no fixtures yet, so clubs are listed by turnout.'} Past performance · not advice.</p>
      </section>

      {!data ? (
        <section className="wrap section-tight"><p className="notice">The tables could not be loaded just now. Try again in a minute.</p></section>
      ) : (
        <>
          <section className="wrap section-tight" id="league" aria-label={season ? 'League table' : 'Preseason table'}>
            <h2 className="h3 table-title">{season ? 'League table' : 'Preseason table'}</h2>
            {season ? (
              <ClubLeagueTable rows={league} />
            ) : pre.length ? (
              <PreseasonTable rows={pre} />
            ) : (
              <p className="notice">No club has three members yet, so the table is empty. The first gameweek opens {OPENS}. <Link href="/clubs#start">Found a club</Link> and bring two friends to appear here.</p>
            )}
          </section>

          <section className="band" id="supporters">
            <div className="wrap">
              <div className="section-head">
                <h2>Supporters table</h2>
                <p>Stock clubs, one for every stock. Ranked on the share of supporters who played this gameweek, then on the share who are on a payday streak. Returns play no part.</p>
              </div>
              {sup.length ? <SupportersTable rows={sup} /> : <p className="notice">No stock club has a supporter yet. <Link href="/clubs#supporters">Pick a stock club</Link> and take the first seat.</p>}
            </div>
          </section>
        </>
      )}

      <section className="wrap section">
        <div className="section-head"><h2>How the tables work</h2></div>
        <ul className="limits">
          <li><h3>Three for a win</h3><p>A fixture goes to the club whose playing members had the higher median return for the gameweek. Win three points, draw one.</p></li>
          <li><h3>One for turning up</h3><p>Any club with 80% or more of its members playing earns a bonus point, win or lose.</p></li>
          <li><h3>Drawn by size</h3><p>Clubs need three members to be drawn, and they meet clubs in the same size band.</p></li>
          <li><h3>Median, not total</h3><p>The middle member’s percentage decides it, so one big wallet cannot carry a club and small buys count in full.</p></li>
          <li><h3>Supporters ignore returns</h3><p>Stock clubs would otherwise just be ranked by which stock rose. Their table uses turnout and streaks only.</p></li>
          <li><h3>Bragging rights only</h3><p>No prize, perk or payout ever depends on a return. Past performance says nothing about the future.</p></li>
        </ul>
        <p className="after-table"><a className="btn" href={DOCS_URL} rel="noopener">Scoring rules in the docs</a></p>
      </section>

      <section className="closing">
        <div className="wrap closing-in">
          <h2>Put your club on the table</h2>
          <p>Three members and one gameweek is all it takes.</p>
          <p className="closing-links"><Link className="btn btn-accent" href="/clubs#start">Found a club</Link><Link href="/stats">Stats</Link></p>
        </div>
      </section>
    </main>
  );
}
