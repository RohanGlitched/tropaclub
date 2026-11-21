/**
 * Seed realistic demo clubs into the Firestore EMULATOR only (never production):
 *   npm run seed:demo        (starts the emulator, seeds, exits)
 * or, with an emulator already running:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npx tsx scripts/seed-demo.ts
 *
 * Demo wallets all start with 0xde00 so they can never be mistaken for real ones.
 */
import { createFirestoreStore } from '../src/store/firestore';
import { StaticPriceSource } from '../src/prices';
import { createClubsService } from '../src/service';
import { createGeoPolicy } from '../src/geo';
import { StaticFundingResolver } from '../src/funding';
import { seededRandom } from '../src/util';
import { Clock, FakeChain, TOK, TOKEN_MAP } from '../test/helpers';
import { assertEmulatorOnly } from './seed-guard';

const PROJECT = process.env.GCLOUD_PROJECT ?? process.env.FIRESTORE_PROJECT_ID ?? 'demo-tropaclub';
assertEmulatorOnly(PROJECT);

const at = (s: string) => Date.parse(s) / 1000;
const T0 = at('2026-11-20T00:00:00Z');
const blockAt = (t: number) => BigInt(50_000_000 + Math.floor((t - T0) / 2));
const demo = (i: number) => `0xde00${i.toString(16).padStart(36, '0')}`;
const rnd = seededRandom('tropa-demo-v1');

const px: Record<string, number> = { [TOK.NVDAc]: 130.7, [TOK.TSLAc]: 444.4, [TOK.SNDKc]: 649.4 };
const closes = [
  '2026-11-24T21:00:00Z',
  '2026-11-25T21:00:00Z',
  '2026-11-27T18:00:00Z',
  '2026-11-30T21:00:00Z',
  '2026-12-01T21:00:00Z',
  '2026-12-02T21:00:00Z',
  '2026-12-03T21:00:00Z',
  '2026-12-04T21:00:00Z',
];
const series: Record<string, [number, number][]> = {};
for (const tk of Object.keys(px)) {
  let p = px[tk]!;
  series[tk] = closes.map((c) => {
    p *= 1 + (rnd() - 0.48) * 0.03;
    return [at(c), Math.round(p * 100) / 100] as [number, number];
  });
}

async function main() {
  const store = createFirestoreStore({ projectId: PROJECT, appName: 'tropa-demo-seed' });
  const chain = new FakeChain();
  const clock = new Clock(at('2026-11-24T13:00:00Z'));
  const prices = new StaticPriceSource(series);
  const svc = createClubsService({
    store,
    chain,
    prices,
    now: clock.now,
    geo: createGeoPolicy({ unknown: 'allow' }),
    funding: new StaticFundingResolver({}),
    config: { tokens: TOKEN_MAP, matchSalt: 'demo-salt' },
  });
  let h = 1;
  const buy = async (wallet: string, clubId: string, token: string, usd: number, time: string) => {
    const t = at(time);
    const price = (await prices.markAt(token, t))?.usd ?? px[token]!;
    const raw = BigInt(Math.round((usd / price) * 1e8));
    const hash = `0x${(h++).toString(16).padStart(64, '0')}`;
    chain.addBuy({ hash, wallet, token, raw, usdc: BigInt(Math.round(usd * 1e6)), block: blockAt(t), time: t });
    clock.set(Math.max(clock.t, t + 60));
    return svc.recordBuy({ txHash: hash, wallet, clubId });
  };

  const stock = {
    nv: await svc.ensureStockClub({ symbol: 'NVDAc', token: TOK.NVDAc, name: 'NVIDIA' }),
    ts: await svc.ensureStockClub({ symbol: 'TSLAc', token: TOK.TSLAc, name: 'Tesla' }),
    sn: await svc.ensureStockClub({ symbol: 'SNDKc', token: TOK.SNDKc, name: 'Sandisk' }),
  };
  const names = ['Payday Collective', 'Friday Five', 'The Ten Dollar Club', 'Night Shift Savers'];
  const nicks = ['Ada', 'Bo', 'Caro', 'Dee', 'Eli', 'Fen', 'Gus', 'Hana', 'Iko', 'Jun', 'Kai', 'Lu', 'Mo', 'Nia', 'Oz', 'Pia'];
  let w = 1;
  const privateClubs: { id: string; members: string[] }[] = [];
  for (const name of names) {
    const size = 3 + Math.floor(rnd() * 4);
    const owner = demo(w++);
    const { club, inviteCode } = await svc.createClub({ name, createdBy: owner, nickname: nicks[w % nicks.length] });
    const members = [owner];
    for (let i = 1; i < size; i++) {
      const m = demo(w++);
      await svc.joinClub({ wallet: m, inviteCode, nickname: rnd() < 0.7 ? nicks[w % nicks.length] : null });
      members.push(m);
    }
    privateClubs.push({ id: club.id, members });
  }
  // solo joiners into pick-up matching (country from a fake edge header; only a salted hash is stored)
  for (const c of ['BR', 'BR', 'AR', 'PH', 'PH', 'ID', 'NG', 'KE']) await svc.optInPickup({ wallet: demo(w++), country: c });
  clock.add(25 * 3600);
  await svc.matchPickups();
  const pickups = await svc.listClubs('pickup');

  // GW0 buys
  const gw0Days = ['2026-11-24T16:', '2026-11-25T15:', '2026-11-27T14:'];
  for (const { id, members } of privateClubs)
    for (const m of members) {
      if (rnd() < 0.25) continue; // stays on the bench
      const tk = [TOK.NVDAc, TOK.TSLAc, TOK.SNDKc][Math.floor(rnd() * 3)]!;
      await buy(m, id, tk, 10 + Math.round(rnd() * 30), `${gw0Days[Math.floor(rnd() * 3)]}${String(10 + Math.floor(rnd() * 40)).padStart(2, '0')}:00Z`);
      if (rnd() < 0.5) {
        const sc = tk === TOK.NVDAc ? stock.nv : tk === TOK.TSLAc ? stock.ts : stock.sn;
        await svc.joinClub({ wallet: m, clubId: sc.id });
      }
    }
  clock.set(at('2026-11-27T19:00:00Z'));
  await svc.settleGameweek('GW0');

  // GW1
  clock.set(at('2026-11-30T12:00:00Z'));
  await svc.scheduleFixtures('GW1');
  const gw1Days = ['2026-11-30T16:', '2026-12-01T16:', '2026-12-02T16:', '2026-12-03T16:', '2026-12-04T15:'];
  for (const { id, members } of privateClubs)
    for (const m of members) {
      if (rnd() < 0.35) continue;
      const tk = [TOK.NVDAc, TOK.TSLAc, TOK.SNDKc][Math.floor(rnd() * 3)]!;
      await buy(m, id, tk, 10 + Math.round(rnd() * 20), `${gw1Days[Math.floor(rnd() * 5)]}${String(10 + Math.floor(rnd() * 40)).padStart(2, '0')}:00Z`);
    }
  clock.set(at('2026-12-04T22:00:00Z'));
  await svc.settleGameweek('GW1');
  await svc.addExclusion({ wallet: demo(999), label: 'test', reason: 'demo exclusion-list entry' });

  const table = await svc.getLeagueTable();
  const stats = await svc.getStats();
  console.log(`seeded ${privateClubs.length} private clubs, ${pickups.length} pick-up clubs, 3 stock clubs into ${PROJECT} (emulator ${process.env.FIRESTORE_EMULATOR_HOST})`);
  console.log('league:', table.rows.map((r) => `${r.position}. ${r.name} ${r.points} pts`).join(' | '));
  console.log('stats:', JSON.stringify({ uniqueSigners: stats.uniqueSigners, attributedTx: stats.attributedTx, usdRouted: stats.usdRouted, seats: stats.seats }));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
