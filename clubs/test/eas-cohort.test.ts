import { TROPA_SUFFIX, parseSuffix } from '@tropaclub/buy';
import { describe, expect, it } from 'vitest';
import { decodeAbiParameters, decodeFunctionData, encodePacked, keccak256, parseAbiParameters, type Hex } from 'viem';
import {
  EAS_ADDRESS,
  PENNANT_SCHEMA,
  PENNANT_SCHEMA_UID,
  SCHEMA_REGISTRY_ADDRESS,
  buildAttestTx,
  buildMultiAttestTx,
  buildRegisterSchemaTx,
  clubIdBytes32,
  easAbi,
  encodePennantData,
  schemaRegistryAbi,
} from '../src/eas';
import { bootstrapRatio, cohortReport, heldAt, matchControls, organicCandidates, subjectFromHistory, type CohortSubject } from '../src/cohort';
import type { HistTransfer } from '../src/history';
import { DAY } from '../src/util';
import { addr, hash } from './helpers';

const strip = (data: Hex) => {
  expect(data.toLowerCase().endsWith(TROPA_SUFFIX.slice(2).toLowerCase())).toBe(true);
  expect(parseSuffix(data)?.codes).toEqual(['bc_vdp89s9b']);
  return data.slice(0, data.length - (TROPA_SUFFIX.length - 2)) as Hex;
};

describe('EAS pennants', () => {
  it('computes the schema UID like SchemaRegistry', () => {
    expect(PENNANT_SCHEMA_UID).toBe(keccak256(encodePacked(['string', 'address', 'bool'], [PENNANT_SCHEMA, '0x0000000000000000000000000000000000000000', true])));
  });

  it('builds a suffixed schema registration call', () => {
    const tx = buildRegisterSchemaTx();
    expect(tx.to).toBe(SCHEMA_REGISTRY_ADDRESS);
    const d = decodeFunctionData({ abi: schemaRegistryAbi, data: strip(tx.data) });
    expect(d.args).toEqual([PENNANT_SCHEMA, '0x0000000000000000000000000000000000000000', true]);
  });

  it("builds a suffixed attest() for the Founders' Pennant on the EAS predeploy", () => {
    const recipient = addr(0x1234);
    const data = encodePennantData({ pennant: "Founders' Pennant", kind: 'founders', club: 'Lagos Value FC', clubId: 'club_abc', gameweek: 'GW0', earnedAt: 1_795_000_000, note: 'no money in it' });
    const tx = buildAttestTx(recipient, data);
    expect(tx.to).toBe(EAS_ADDRESS);
    expect(tx.value).toBe(0n);
    const call = decodeFunctionData({ abi: easAbi, data: strip(tx.data) });
    expect(call.functionName).toBe('attest');
    const req = call.args[0] as { schema: Hex; data: { recipient: string; data: Hex; revocable: boolean; expirationTime: bigint } };
    expect(req.schema).toBe(PENNANT_SCHEMA_UID);
    expect(req.data.recipient.toLowerCase()).toBe(recipient);
    expect(req.data.expirationTime).toBe(0n);
    const decoded = decodeAbiParameters(parseAbiParameters(PENNANT_SCHEMA), req.data.data);
    expect(decoded[0]).toBe("Founders' Pennant");
    expect(decoded[3]).toBe(clubIdBytes32('club_abc'));
    expect(decoded[5]).toBe(1_795_000_000n);
  });

  it('batches with multiAttest', () => {
    const data = encodePennantData({ pennant: 'GW1 Champions', kind: 'champion', club: 'X', clubId: 'x', gameweek: 'GW1', earnedAt: 1, note: '' });
    const tx = buildMultiAttestTx([{ recipient: addr(1), data }, { recipient: addr(2), data }]);
    const call = decodeFunctionData({ abi: easAbi, data: strip(tx.data) });
    expect(call.functionName).toBe('multiAttest');
    expect((call.args[0] as unknown as { data: unknown[] }[])[0]!.data).toHaveLength(2);
  });
});

const subj = (wallet: string, firstUsd: number, held: boolean, t0 = 1_000_000, token = 'tok'): CohortSubject => ({
  wallet,
  token,
  t0,
  firstRaw: 100n,
  firstUsd,
  flows: [
    { t: t0, token, dir: 'in', raw: 100n, tropa: false, txHash: `${wallet}-in`, logIndex: 0 },
    ...(held ? [] : [{ t: t0 + 3 * DAY, token, dir: 'out' as const, raw: 80n, tropa: false, txHash: `${wallet}-out`, logIndex: 0 }]),
  ],
});

describe('control cohort', () => {
  it('holds at D+7 when >= 50% of the first buy is still there', () => {
    expect(heldAt(subj('a', 10, true), 7)).toBe(true);
    expect(heldAt(subj('b', 10, false), 7)).toBe(false);
    expect(heldAt(subj('b', 10, false), 1)).toBe(true); // sold on day 3
  });

  it('matches on token and first-buy size without replacement', () => {
    const treated = [subj('t1', 10, true), subj('t2', 40, true)];
    const pool = [subj('c1', 11, true), subj('c2', 39, true), subj('c3', 41, false), subj('c4', 200, true), subj('c5', 10, true, 1_000_000, 'other'), subj('c6', 9.5, false)];
    const m = matchControls(treated, pool, { perTreated: 2 });
    expect(m.pairs).toEqual([
      { treated: 't1', controls: ['c6', 'c1'] },
      { treated: 't2', controls: ['c3', 'c2'] },
    ]);
    expect(m.controls.map((c) => c.wallet)).not.toContain('c4');
    expect(m.controls.map((c) => c.wallet)).not.toContain('c5');
  });

  it('bootstraps the hold-rate ratio with a deterministic 95% CI, labelled descriptive', () => {
    const t = Array.from({ length: 120 }, (_, i) => i < 84); // 70%
    const c = Array.from({ length: 360 }, (_, i) => i < 180); // 50%
    const a = bootstrapRatio(t, c, { iters: 4000 });
    const b = bootstrapRatio(t, c, { iters: 4000 });
    expect(a).toEqual(b);
    expect(a.ratio).toBeCloseTo(1.4, 6);
    expect(a.lo!).toBeLessThan(1.4);
    expect(a.hi!).toBeGreaterThan(1.4);
    expect(a.lo!).toBeGreaterThan(1.0);
    expect(a.label).toBe('descriptive, not causal; joiners self-select');
    expect(bootstrapRatio([true], []).ratio).toBeNull();
  });

  it('builds a report with only D+7-eligible treated subjects', () => {
    const now = 1_000_000 + 8 * DAY;
    const r = cohortReport({ window: { from: 0, to: 2_000_000 }, treated: [subj('t1', 10, true), subj('t2', 20, false), subj('t3', 20, true, now)], organicPool: [subj('c1', 10, false), subj('c2', 20, true), subj('c3', 21, false)], now });
    expect(r.treated.n).toBe(2);
    expect(r.organic.matched).toBe(3);
    expect(r.method).toContain('pre-registered');
  });

  it('picks organic first-time buyers from indexer state and sizes them from history', async () => {
    const state = {
      tokens: [{ address: '0xB20000000000000000000078EE7CE2FE4908108C', symbol: 'NVDAc' }],
      pairs: [[
        ['0x01', 1, 0, 0, 0, 1500], // first buy in window, first-ever stock buy in window
        ['0x02', 1, 0, 0, 0, 1500], // contract
        ['0x03', 1, 0, 0, 0, 500], // before window
        ['0x04', 1, 0, 0, 0, 1500], // bought another stock earlier
      ]],
      firstBuyAny: new Map([['0x01', 1500], ['0x02', 1500], ['0x03', 500], ['0x04', 100]]),
      codes: new Map([['0x01', 0], ['0x02', 3], ['0x03', 0], ['0x04', 0]]),
      flags: new Map<string, number>(),
    };
    expect(organicCandidates(state, { from: 1000, to: 2000 })).toEqual([{ wallet: '0x01', token: '0xb20000000000000000000078ee7ce2fe4908108c' }]);
    // > 50 swaps in the 7 days from the window start = bot
    const botty = { ...state, hours: [[1, [['0x01', 51, {}]]]] as [number, [string, number, unknown][]][] };
    expect(organicCandidates(botty, { from: 1000, to: 2000 })).toEqual([]);
    const tx: HistTransfer[] = [
      { token: 'tok', dir: 'in', raw: 7_000_000n, t: 1500, blockNumber: 1, txHash: hash(1), logIndex: 0, counterparty: addr(9), legs: { paidUsd: 9.1, receivedUsd: null, otherOut: false, otherIn: false } },
    ];
    expect(await subjectFromHistory('0x01', tx, { from: 1000, to: 2000 })).toBeNull(); // $9.10 < $10
    tx[0]!.legs.paidUsd = 25;
    expect((await subjectFromHistory('0x01', tx, { from: 1000, to: 2000 }))!.firstUsd).toBe(25);
    tx[0]!.legs.paidUsd = null; // transfer-in, not a buy
    expect(await subjectFromHistory('0x01', tx, { from: 1000, to: 2000 })).toBeNull();
  });
});
