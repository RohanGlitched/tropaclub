import type { Metadata } from 'next';
import Link from 'next/link';
import { ClubLeagueTable, PreseasonTable, SupportersTable } from '@/components/club/Tables';
import StockClubList from '@/components/club/StockClubList';
import ClubPreview from '@/components/ClubPreview';
import { Pennant } from '@/components/ds/Pennant';
import { crestOf, ensureStockClubs, tryClubs } from '@/lib/server/clubs';
import { getIndex } from '@/lib/server/data';
import { fmtInt } from '@/lib/format';
import { DOCS_URL, OPENS, RULE_LINE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'The league: club standings and the Supporters table',
  description: 'Standings for private and pick-up clubs on Tropa Club, and the Supporters table for stock clubs, ranked on turnout and streaks.',
};

export default async function LeaguePage() {
  const [{ data: index }, data] = await Promise.all([
    getIndex(),
    tryClubs(async (svc) => {
      await ensureStockClubs(svc);
      const [league, pre, sup, clubs] = await Promise.all([svc.getLeagueTable(), svc.getPreseasonTable(), svc.getSupportersTable(), svc.listClubs()]);
      return { league, pre, sup, clubs };
    }),
  ]);
  const byId = new Map((data?.clubs ?? []).map((c) => [c.id, c]));
  const crest = (id: string, seed: string) => crestOf(byId.get(id) ?? { crestSeed: seed });
  const league = (data?.league.rows ?? []).map((r) => ({ ...r, crest: crest(r.clubId, r.crestSeed), note: r.form.length ? `Form ${r.form.slice(-5).join(' ')}` : null }));
  const pre = (data?.pre ?? []).map((r) => ({ ...r, crest: crest(r.clubId, r.crestSeed), note: null }));
  const sup = (data?.sup.rows ?? []).filter((r) => r.members > 0).map((r) => ({ ...r, crest: crest(r.clubId, r.crestSeed), note: r.stockSymbol }));
  const season = league.length > 0;
  const founding = (data?.clubs ?? []).filter((c) => c.kind !== 'stock').sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
  const stock = new Map((data?.clubs ?? []).filter((c) => c.kind === 'stock').map((c) => [c.stockSymbol, c]));
  const stockRows = index.tokens.map((t) => ({ symbol: t.symbol, name: t.name, realFans: t.realFans, supporters: stock.get(t.symbol)?.memberCount ?? 0, playing: stock.get(t.symbol)?.playingCount ?? 0 }));

  return (
    <main id="main">
      <section className="wrap page-head">
        <h1>The league</h1>
        <p className="lede">
          Private and pick-up clubs play fixtures against clubs their size. Stock clubs have a table of their own. Every number here is a head count or a percentage: no club is ranked by how much money it holds.
        </p>
        <p className="asof">
          {season
            ? `Through ${data?.league.throughGw?.replace('GW', 'gameweek ') ?? 'the last gameweek'}.`
            : pre.length
              ? 'Gameweek 0 is preseason: no fixtures yet, so clubs are listed by turnout.'
              : `The season opens ${OPENS} with gameweek 0, a preseason week. Fixtures start the week after.`}
        </p>
      </section>

      {!data ? (
        <section className="wrap section-tight"><p className="notice">The tables could not be loaded just now. Try again in a minute.</p></section>
      ) : season || pre.length ? (
        <section className="wrap section-tight" id="league" aria-label={season ? 'League table' : 'Preseason table'}>
          <h2 className="h3 table-title">{season ? 'League table' : 'Preseason table'}</h2>
          {season ? <ClubLeagueTable rows={league} /> : <PreseasonTable rows={pre} />}
        </section>
      ) : (
        <section className="wrap section-tight" id="league" aria-label="Founding clubs">
          <div className="split">
            <div className="split-text">
              <h2 className="h3 table-title">Founding clubs</h2>
              {founding.length ? (
                <>
                  <p className="muted">Clubs founded before the first gameweek, in the order they were founded. A club needs three members to enter the table.</p>
                  <ol className="founding">
                    {founding.slice(0, 30).map((c, i) => (
                      <li key={c.id}>
                        <span className="founding-no num">No. {i + 1}</span>
                        <Pennant kit={crestOf(c)} width={20} />
                        <Link href={`/club/${c.id}`} prefetch={false}>{c.name}</Link>
                        <span className="founding-n">{fmtInt(c.memberCount)} {c.memberCount === 1 ? 'member' : 'members'}{c.memberCount < 3 ? `, ${3 - c.memberCount} more to enter the table` : ''}</span>
                      </li>
                    ))}
                  </ol>
                  {founding.length > 30 && <p className="muted small">And {fmtInt(founding.length - 30)} more.</p>}
                </>
              ) : (
                <p className="notice">No club has been founded yet. The first one is listed here as founding club No. 1.</p>
              )}
              <p className="after-table"><Link className="btn btn-accent" href="/clubs#start">Found club No. {fmtInt(founding.length + 1)}</Link></p>
            </div>
            <div className="split-text">
              <h2 className="h3 table-title">A Matchday, in preview</h2>
              <p className="muted">Made-up names. This is the card every club gets once its members start buying.</p>
              <div className="preview-frame"><span className="tag">Preview</span><ClubPreview /></div>
            </div>
          </div>
        </section>
      )}

      {data && (
        <section className="band" id="supporters">
          <div className="wrap">
            <div className="section-head">
              <h2>Supporters table</h2>
              <p>Stock clubs, one for every stock. Ranked on the share of supporters who played this gameweek, then on the share who are on a payday streak. Returns play no part.</p>
            </div>
            {sup.length ? (
              <SupportersTable rows={sup} />
            ) : (
              <>
                <p className="muted">No stock club has a supporter yet, so there is nothing to rank. These are the biggest crowds. Take a free seat and the club enters the table.</p>
                <StockClubList rows={stockRows} first={8} />
              </>
            )}
          </div>
        </section>
      )}

      <section className="wrap section">
        <div className="section-head"><h2>How the tables work</h2></div>
        <ul className="limits">
          <li><h3>You play by buying</h3><p>{RULE_LINE} Everyone else is on the Bench that week.</p></li>
          <li><h3>Three for a win</h3><p>A fixture goes to the club whose playing members had the higher median return for the gameweek. Win three points, draw one.</p></li>
          <li><h3>One for turning up</h3><p>Any club with 80% or more of its members playing earns a bonus point, win or lose.</p></li>
          <li><h3>Drawn by size</h3><p>Clubs need three members to be drawn, and they meet clubs in the same size band.</p></li>
          <li><h3>Median, not total</h3><p>The middle member’s percentage decides it, so one big wallet cannot carry a club and small buys count in full.</p></li>
          <li><h3>Bragging rights only</h3><p>No prize, perk or payout ever depends on a return. Stock clubs ignore returns altogether.</p></li>
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
