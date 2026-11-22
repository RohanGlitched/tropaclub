// Sanity checks that fail the run loudly before anything is published.
import { batch } from './rpc.ts';
import { SUPPLY_TOLERANCE, NVDA_REAL_RANGE } from './config.ts';
import type { State } from './state.ts';
import type { Outputs } from './output.ts';
import type { ApiToken } from './tokens.ts';
import type { AttendanceHistoryFile } from '../../shared/types.ts';

export async function runChecks(s: State, out: Outputs, meta: Map<string, ApiToken>, block: number): Promise<string[]> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const hexBlock = '0x' + block.toString(16);

  // 1. no negative balances
  s.tokens.forEach((tk, t) => {
    let neg = 0;
    for (const p of s.pairs[t].values()) if (p.bal < 0) neg++;
    if (neg) errors.push(`${tk.symbol}: ${neg} negative balances`);
  });

  // 2. replayed supply vs onchain totalSupply at the same block (and vs the API, as a warning)
  const sup = await batch(s.tokens.map((tk) => ({ method: 'eth_call', params: [{ to: tk.address, data: '0x18160ddd' }, hexBlock] })), { block });
  s.tokens.forEach((tk, t) => {
    let replay = 0;
    for (const p of s.pairs[t].values()) if (p.bal > 0) replay += p.bal;
    const onchain = Number(BigInt(sup[t]));
    const diff = onchain ? Math.abs(replay - onchain) / onchain : replay ? 1 : 0;
    if (diff > SUPPLY_TOLERANCE) errors.push(`${tk.symbol}: replayed supply ${replay / 1e8} vs onchain ${onchain / 1e8} (${(diff * 100).toFixed(3)}%)`);
    else if (replay !== onchain) warnings.push(`${tk.symbol}: replay ${replay} != onchain ${onchain} raw (${(diff * 100).toFixed(4)}%)`);
    const api = meta.get(tk.address)?.totalSupply;
    if (api && Math.abs(replay / 1e8 - api) / api > SUPPLY_TOLERANCE) warnings.push(`${tk.symbol}: API total_supply ${api} vs replay ${replay / 1e8} (API snapshot time differs)`);
  });

  // 3. spot-check balanceOf for the 5 largest + 5 random holders + 2 emptied wallets per token
  const reqs: { t: number; a: string; want: number }[] = [];
  let seed = block % 2147483647;
  const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  s.tokens.forEach((tk, t) => {
    const all = [...s.pairs[t]];
    const pos = all.filter(([, p]) => p.bal > 0).sort((x, y) => y[1].bal - x[1].bal);
    const zero = all.filter(([, p]) => p.bal === 0);
    const pick = new Set<string>(pos.slice(0, 5).map(([a]) => a));
    for (let i = 0; i < 5 && pos.length; i++) pick.add(pos[Math.floor(rnd() * pos.length)][0]);
    for (let i = 0; i < 2 && zero.length; i++) pick.add(zero[Math.floor(rnd() * zero.length)][0]);
    for (const a of pick) reqs.push({ t, a, want: s.pairs[t].get(a)!.bal });
  });
  const bals = await batch(reqs.map((r) => ({ method: 'eth_call', params: [{ to: s.tokens[r.t].address, data: '0x70a08231' + r.a.slice(2).padStart(64, '0') }, hexBlock] })), { block });
  let bad = 0;
  reqs.forEach((r, i) => {
    const got = Number(BigInt(bals[i]));
    if (got !== r.want) { bad++; if (bad <= 10) errors.push(`${s.tokens[r.t].symbol} ${r.a}: balanceOf ${got} != replay ${r.want}`); }
  });
  console.log(`checks: balanceOf spot-checked ${reqs.length} (token, wallet) pairs, ${bad} mismatches`);

  // 4. NVDAc real fans in the expected range (research: 1,613 on Nov 21)
  const nv = out.index.tokens.find((x) => x.symbol === 'NVDAc');
  if (!nv) errors.push('NVDAc missing');
  else if (nv.realFans < NVDA_REAL_RANGE[0] || nv.realFans > NVDA_REAL_RANGE[1]) errors.push(`NVDAc realFans ${nv.realFans} outside ${NVDA_REAL_RANGE.join('-')}`);

  // 5. seat kinds sum to holders
  for (const x of out.index.tokens) {
    const sum = x.realFans + x.ghosts.dust + x.ghosts.farmerOnly + x.ghosts.contracts;
    if (sum !== x.holdersTotal) errors.push(`${x.symbol}: kinds sum ${sum} != holders ${x.holdersTotal}`);
  }

  for (const w of warnings.slice(0, 40)) console.warn('warn:', w);
  if (warnings.length > 40) console.warn(`warn: ... ${warnings.length - 40} more`);
  return errors;
}

export function printCounts(out: Outputs) {
  const rows = [...out.index.tokens].sort((a, b) => b.holdersTotal - a.holdersTotal);
  console.log('symbol      holders   real   dust farmer contr  price     wkBuyers new7d medBuy top10%');
  for (const x of rows) {
    console.log(`${x.symbol.padEnd(10)} ${String(x.holdersTotal).padStart(8)} ${String(x.realFans).padStart(6)} ${String(x.ghosts.dust).padStart(6)} ${String(x.ghosts.farmerOnly).padStart(6)} ${String(x.ghosts.contracts).padStart(5)}  ${String(x.priceUsd ?? '-').padStart(8)}${x.priceSource === 'reference' ? 'r' : ' '} ${String(x.weeklyBuyers).padStart(8)} ${String(x.newBuyers7d).padStart(5)} ${String(x.medianWeeklyBuyUsd ?? '-').padStart(6)} ${x.top10SharePct}`);
  }
  const st = out.stats;
  console.log(`stats: holders ${st.holdersTotal}, real>=10 ${st.realWallets}, real>=100 ${st.realWallets100}, tokens ${st.tokensMinted}, value $${st.totalValueUsd}`);
  for (const w of st.weeklyBuyers.slice(-6)) console.log(`  week ${w.weekStart}: buyers ${w.buyers}, new ${w.newBuyers}, median $${w.medianBuyUsd}`);
}

// Attendance history: today's (last) entry must equal index.json / stats.json, and days must be contiguous to today.
export function checkAttendance(file: AttendanceHistoryFile, out: Outputs): string[] {
  const errors: string[] = [];
  const last = file.days.length - 1;
  if (last < 0) return ['attendance: no days'];
  if (file.days[last] !== out.index.asOf.slice(0, 10)) errors.push(`attendance: last day ${file.days[last]} != index asOf ${out.index.asOf}`);
  for (let i = 1; i < file.days.length; i++) {
    if (Date.parse(file.days[i]) - Date.parse(file.days[i - 1]) !== 86400_000) { errors.push(`attendance: days not contiguous at ${file.days[i]}`); break; }
  }
  if (file.asOf !== out.index.asOf || file.block !== out.index.block) errors.push('attendance: asOf/block differ from index.json');
  const bySym = new Map(file.tokens.map((t) => [t.symbol, t]));
  const fields = ['holdersTotal', 'realFans', 'attendancePct', 'dust', 'farmerOnly', 'contracts', 'priceUsd'] as const;
  for (const x of out.index.tokens) {
    const t = bySym.get(x.symbol);
    if (!t) { errors.push(`attendance: ${x.symbol} missing`); continue; }
    const want = { holdersTotal: x.holdersTotal, realFans: x.realFans, attendancePct: x.attendancePct, dust: x.ghosts.dust, farmerOnly: x.ghosts.farmerOnly, contracts: x.ghosts.contracts, priceUsd: x.priceUsd };
    for (const f of fields) if (t[f][last] !== want[f]) errors.push(`attendance: ${x.symbol} today ${f} ${t[f][last]} != index ${want[f]}`);
  }
  for (const t of file.tokens) if (t.holdersTotal[last] && !out.index.tokens.some((x) => x.symbol === t.symbol)) errors.push(`attendance: ${t.symbol} has holders today but is not in index.json`);
  const realSum = out.index.tokens.reduce((s, x) => s + x.realFans, 0), holdSum = out.index.tokens.reduce((s, x) => s + x.holdersTotal, 0);
  if (file.totals.realFans[last] !== realSum) errors.push(`attendance: totals.realFans today ${file.totals.realFans[last]} != index sum ${realSum}`);
  if (file.totals.holdersTotal[last] !== holdSum) errors.push(`attendance: totals.holdersTotal today ${file.totals.holdersTotal[last]} != index sum ${holdSum}`);
  if (file.totals.uniqueHolders[last] !== out.stats.holdersTotal) errors.push(`attendance: uniqueHolders today ${file.totals.uniqueHolders[last]} != stats.holdersTotal ${out.stats.holdersTotal}`);
  return errors.slice(0, 40);
}
