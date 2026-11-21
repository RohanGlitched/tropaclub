/**
 * Live Base mainnet tests: KyberSwap quotes + eth_simulateV1 with state overrides. Nothing is signed or sent.
 * Run: npm run test:live   (needs network; ~2-4 min)
 */
import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { type Address, type Hex } from 'viem';
import {
  AERODROME_SOURCES,
  TOKENS,
  TROPA_SUFFIX,
  createBaseClient,
  fetchAnnouncementLogs,
  fetchNavMap,
  getReferenceMark,
  isBuyable,
  marketPhase,
  parseSuffix,
  readPoolTwap,
  readStockFeed,
  readTokenInfo,
  selectMark,
  simulateBuy,
  verifyAttribution,
  b20Abi,
  fromUIAmountLocal,
  type SimulateBuyResult,
} from '../../src';

const client = createBaseClient();
const summary: Record<string, unknown> = { at: new Date().toISOString(), phase: marketPhase(Math.floor(Date.now() / 1000)) };
const j = (x: unknown) => JSON.parse(JSON.stringify(x, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));

afterAll(() => {
  writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(j(summary), null, 2));
});

const CASES: [keyof typeof TOKENS, number][] = [
  ['NVDAc', 10], ['NVDAc', 25],
  ['SNDKc', 10], ['SNDKc', 25],
  ['TSLAc', 10], ['TSLAc', 25],
];

function brief(r: SimulateBuyResult) {
  return {
    ok: r.ok,
    reason: r.reason,
    venues: r.venues,
    quotedOut: r.quote.amountOut,
    amountOut: r.amountOut,
    amountOutMin: r.amountOutMin,
    routerMin: r.swap?.minReturnAmount,
    headroomBps: r.amountOutMin > 0n ? Number(((r.amountOut - r.amountOutMin) * 10_000n) / r.amountOutMin) : null,
    quoteVsMarkBps: r.guard.quoteVsMarkBps,
    mark: { source: r.guard.mark.source, usd: Number(r.guard.mark.usdPerToken8) / 1e8, reopenGapRisk: r.guard.reopenGapRisk, lastCloseUsd: r.guard.mark.lastClose8 ? Number(r.guard.mark.lastClose8) / 1e8 : null },
    multiplier: Number(r.guard.multiplierWad) / 1e18,
    uiShares: r.guard.uiShares,
    gas: r.gas,
    policy: r.policy.passes,
    policyChecks: r.policy.checks.map((c) => `${c.role}:${c.scope}:${c.authorized}`),
    suffixOnEveryCall: r.suffixOnEveryCall,
  };
}

describe('simulated buys on Base mainnet (USDC in)', () => {
  for (const [sym, usd] of CASES) {
    it(`${sym} with $${usd} USDC`, async () => {
      const r = await simulateBuy({ sellToken: 'USDC', buyToken: TOKENS[sym], sellAmount: BigInt(usd) * 1_000_000n, client });
      summary[`${sym}_$${usd}`] = brief(r);
      expect(r.reason).toBeUndefined();
      expect(r.ok).toBe(true);
      expect(r.guard.unitCheck.ok).toBe(true);
      expect(r.amountOut).toBeGreaterThanOrEqual(r.amountOutMin);
      expect(r.swap!.minReturnAmount!).toBeGreaterThanOrEqual(r.guard.amountOutMin);
      expect(r.policy.passes).toBe(true);
      expect(r.policy.checks.some((c) => c.role === 'kyber executor' && c.scope === 'TRANSFER_EXECUTOR_POLICY' && c.authorized)).toBe(true);
      expect(r.suffixOnEveryCall).toBe(true);
      const swapCall = r.calls.find((c) => c.label.startsWith('Buy'))!;
      expect(swapCall.data.endsWith(TROPA_SUFFIX.slice(2))).toBe(true);
      expect(parseSuffix(swapCall.data)?.codes).toEqual(['bc_vdp89s9b']);
      expect(r.results.every((x) => x.status === 'success')).toBe(true);
      expect(r.venues.every((v) => (AERODROME_SOURCES as readonly string[]).includes(v))).toBe(true);
    });
  }
  it('TSLAc $10 with sources "best" (any KyberSwap venue)', async () => {
    const r = await simulateBuy({ sellToken: 'USDC', buyToken: TOKENS.TSLAc, sellAmount: 10_000_000n, client, sources: 'best' });
    summary['TSLAc_$10_best'] = brief(r);
    expect(r.ok).toBe(true);
    expect(r.policy.passes).toBe(true);
  });
});

describe('other inputs', () => {
  it('ETH -> NVDAc (Chainlink ETH/USD values the input)', async () => {
    const r = await simulateBuy({ sellToken: 'ETH', buyToken: TOKENS.NVDAc, sellAmount: 4_000_000_000_000_000n, client });
    summary['NVDAc_ETH_0.004'] = brief(r);
    expect(r.ok).toBe(true);
    expect(r.guard.usdInSource).toBe('chainlink-eth');
    expect(r.calls).toHaveLength(1); // no approve for native ETH
  });
});

describe('SNDKc multiplier x8 against the precompile', () => {
  it('local fromUIAmount equals on-chain fromUIAmount', async () => {
    const info = await readTokenInfo(client, TOKENS.SNDKc);
    expect(info.multiplierWad).toBe(8n * 10n ** 18n);
    for (const ui of [1n, 12_318_305n, 10n ** 8n, 123_456_789_012n]) {
      const chain = await client.readContract({ address: TOKENS.SNDKc, abi: b20Abi, functionName: 'fromUIAmount', args: [ui] });
      expect(fromUIAmountLocal(ui, info.multiplierWad)).toBe(chain);
    }
  });
});

describe('market closed / weekend path with real feed data', () => {
  it('frozen feed -> TWAP mark + reopen-gap flag; fresh feed -> chainlink', async () => {
    const feed = await readStockFeed(client, TOKENS.SNDKc);
    const nav = (await fetchNavMap()).get(TOKENS.SNDKc.toLowerCase()) ?? null;
    const twap = await readPoolTwap(client, TOKENS.SNDKc, 8);
    expect(feed && twap).toBeTruthy();
    // next Saturday 12:00 UTC after the feed's last update: market shut, feed frozen
    const d = new Date(feed!.updatedAt * 1000);
    d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7));
    d.setUTCHours(12, 0, 0, 0);
    const weekend = selectMark({ feed, nav, twap, nowSec: Math.floor(d.getTime() / 1000) })!;
    expect(weekend.source).toBe('twap');
    expect(weekend.reopenGapRisk).toBe(true);
    // one minute after the update the feed counts as fresh only if that moment was in session
    const justAfter = selectMark({ feed, nav, twap, nowSec: feed!.updatedAt + 60 })!;
    expect(justAfter.source).toBe(marketPhase(feed!.updatedAt + 60) === 'closed' ? 'twap' : 'chainlink');
    const live = await getReferenceMark(client, TOKENS.SNDKc);
    summary.weekendPath = { nowPhase: summary.phase, liveSource: live?.source, liveReopenGapRisk: live?.reopenGapRisk, twapUsd: Number(twap!.answer8) / 1e8, frozenCloseUsd: Number(feed!.answer8) / 1e8, driftBps: Math.round((Number(twap!.answer8) / Number(feed!.answer8) - 1) * 10_000) };
  });
});

describe('isBuyable', () => {
  it('NVDAc, SNDKc, TSLAc are buyable now; SNDKc split replay is closed', async () => {
    const head = await client.getBlockNumber();
    // recent 2 days for all three + the SNDKc split window (pre-notice block 53298759, final 59674150)
    const recent = await fetchAnnouncementLogs(client, [TOKENS.NVDAc, TOKENS.SNDKc, TOKENS.TSLAc], { fromBlock: head - 2n * 86_400n * 5n, toBlock: head });
    const split = [
      ...(await fetchAnnouncementLogs(client, [TOKENS.SNDKc], { fromBlock: 53_298_759n, toBlock: 53_298_759n })),
      ...(await fetchAnnouncementLogs(client, [TOKENS.SNDKc], { fromBlock: 59_674_150n, toBlock: 59_674_150n })),
    ];
    expect(split.filter((l) => l.kind === 'Announcement').map((l) => l.id)).toEqual(['4d449eba-9206-4c35-8c1e-921c20e864d5:pre', '4d449eba-9206-4c35-8c1e-921c20e864d5']);
    const out: Record<string, unknown> = {};
    for (const sym of ['NVDAc', 'SNDKc', 'TSLAc'] as const) {
      const b = await isBuyable(TOKENS[sym], { client, announcements: [...recent, ...split] });
      out[sym] = { buyable: b.buyable, reason: b.reason, mark: b.mark?.source, reopenGapRisk: b.reopenGapRisk, actions: b.corporateActions.actions.map((a) => `${a.description}:${a.status ?? '-'}`) };
      expect(b.reasons).toEqual([]);
      expect(b.buyable).toBe(true);
    }
    // the pre-notice alone (as seen between Oct 30 and Nov 19) blocks buys if the API lookup is off
    const preOnly = await isBuyable(TOKENS.SNDKc, { client, announcements: split.filter((l) => l.id.endsWith(':pre')), checkActionApi: false });
    expect(preOnly.buyable).toBe(false);
    out.SNDKc_preNoticeOnly = preOnly.reason;
    summary.isBuyable = out;
  });
});

describe('decoded reverts from real simulations', () => {
  it('missing approval', async () => {
    const r = await simulateBuy({ sellToken: 'USDC', buyToken: TOKENS.TSLAc, sellAmount: 10_000_000n, client, skipApprove: true });
    expect(r.ok).toBe(false);
    expect(r.revert?.kind).toBe('allowance');
    summary.revert_noApprove = r.revert;
  });
  it('minOut above the fill (slippage guard trips)', async () => {
    const r = await simulateBuy({ sellToken: 'USDC', buyToken: TOKENS.TSLAc, sellAmount: 10_000_000n, client, overrideMinOut: 10n ** 12n });
    expect(r.ok).toBe(false);
    expect(r.revert?.kind).toBe('slippage');
    summary.revert_minOut = r.revert;
  });
});

describe('verifyAttribution on a real Base tx carrying an ERC-8021 suffix', () => {
  it('finds and parses a live attributed tx in recent blocks', async () => {
    const head = await client.getBlockNumber();
    let found: { hash: Hex; to: Address | null } | null = null;
    for (let i = 0n; i < 40n && !found; i++) {
      const b = await client.getBlock({ blockNumber: head - i, includeTransactions: true });
      const tx = b.transactions.find((t) => t.input.toLowerCase().endsWith('80218021802180218021802180218021'));
      if (tx) found = { hash: tx.hash, to: tx.to };
    }
    if (!found) {
      summary.liveAttribution = 'no suffixed tx in the last 40 blocks';
      return;
    }
    const r = await verifyAttribution(found.hash, { client });
    summary.liveAttribution = { tx: found.hash, codes: r.codes, via: r.via };
    expect(r.codes.length).toBeGreaterThan(0);
    expect(r.via).toBe('tx');
  });
});
