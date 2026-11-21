import { describe, expect, it } from 'vitest';
import { WAD, checkMarkUnits, computeGuardMinOut, fromUIAmountLocal, toUIAmountLocal } from '../../src/guard';
import { isMarkFresh, marketPhase, selectMark, type FeedRead, type NavRecord, type TwapRead } from '../../src/market';

const t = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const SNDK_MULT = 8n * WAD;
const NVDA_MULT = 1000537939576369481n;

describe('ERC-8056 conversions match the B20 precompile', () => {
  it('SNDKc x8 (values read on-chain Nov 22 2026)', () => {
    expect(fromUIAmountLocal(10n ** 8n, SNDK_MULT)).toBe(12_500_000n);
    expect(toUIAmountLocal(10n ** 8n, SNDK_MULT)).toBe(800_000_000n);
  });
  it('NVDAc x1.000538', () => {
    expect(fromUIAmountLocal(10n ** 8n, NVDA_MULT)).toBe(99_946_234n);
    expect(toUIAmountLocal(10n ** 8n, NVDA_MULT)).toBe(100_053_793n);
  });
});

describe('guard conversion: USD mark -> UI shares -> raw units', () => {
  it('SNDKc x8: $10 at the total-return mark $649.44', () => {
    const g = computeGuardMinOut({ usdIn6: 10_000_000n, mark8: 64_944_000_000n, decimals: 8, multiplierWad: SNDK_MULT });
    // underlying per share = 649.44 / 8 = 81.18
    expect(g.usdPerShare8).toBe(8_118_000_000n);
    // UI shares = 10 / 81.18 = 0.12318305 shares
    expect(g.uiShares).toBe((10n * 10n ** 8n * 10n ** 8n) / 8_118_000_000n);
    // raw = shares / 8 = 10 / 649.44 tokens = 0.01539788 tokens
    expect(g.fairRaw).toBe((10n * 10n ** 8n * 10n ** 8n) / 64_944_000_000n);
    expect(g.fairRaw).toBe(1_539_788n);
    expect(g.amountOutMin).toBe(1_516_691n);
    // the live KyberSwap fill on Nov 22 was 1,549,386 raw for $10, which clears the guard
    expect(1_549_386n >= g.amountOutMin).toBe(true);
  });

  it('x1 token (TSLAc): $25 at $350.45', () => {
    const g = computeGuardMinOut({ usdIn6: 25_000_000n, mark8: 35_045_000_000n, decimals: 8, multiplierWad: WAD });
    expect(g.uiShares).toBe(g.fairRaw);
    expect(g.fairRaw).toBe(7_133_685n);
    expect(g.amountOutMin).toBe(7_026_679n);
  });

  it('NVDAc: raw units do not depend on the multiplier once the mark is total-return', () => {
    const g = computeGuardMinOut({ usdIn6: 10_000_000n, mark8: 12_982_480_034n, decimals: 8, multiplierWad: NVDA_MULT });
    expect(g.fairRaw).toBe((10n * 10n ** 16n) / 12_982_480_034n);
    expect(g.uiShares).toBeGreaterThan(g.fairRaw); // 1 raw token = 1.000538 shares
  });

  it('mis-unit marks are caught (toothless or always-reverting guards)', () => {
    const dex = 64_552_822_983n; // pool TWAP, USD per raw SNDKc
    expect(checkMarkUnits({ mark8: 64_944_000_000n, dexUsdPerToken8: dex, multiplierWad: SNDK_MULT }).ok).toBe(true);
    // treating the feed as a per-share price and dividing by the multiplier -> guard 8x too loose
    const perShare = checkMarkUnits({ mark8: 64_944_000_000n / 8n, dexUsdPerToken8: dex, multiplierWad: SNDK_MULT });
    expect(perShare.ok).toBe(false);
    if (!perShare.ok) expect(perShare.reason).toMatch(/x8 multiplier/);
    // multiplying the feed by the multiplier again -> guard 8x too tight, every buy reverts
    expect(checkMarkUnits({ mark8: 64_944_000_000n * 8n, dexUsdPerToken8: dex, multiplierWad: SNDK_MULT }).ok).toBe(false);
  });
});

describe('market calendar (24/5 feed session, NYSE holidays)', () => {
  it.each([
    ['2026-11-20T23:38:55Z', 'extended'], // Fri 18:38 ET, SNDK feed's last update
    ['2026-11-21T01:30:00Z', 'closed'], // Fri 20:30 ET
    ['2026-11-22T12:00:00Z', 'closed'], // Sunday
    ['2026-11-23T02:00:00Z', 'overnight'], // Sun 21:00 ET
    ['2026-11-24T15:00:00Z', 'regular'], // Tue 10:00 ET (launch day)
    ['2026-11-26T01:30:00Z', 'closed'], // Wed 20:30 ET, Thanksgiving next
    ['2026-11-26T17:00:00Z', 'closed'], // Thanksgiving
    ['2026-11-27T02:00:00Z', 'overnight'], // Thu 21:00 ET for Friday
    ['2026-11-27T19:00:00Z', 'extended'], // Fri half day 14:00 ET
    ['2026-11-27T22:30:00Z', 'closed'], // Fri 17:30 ET
  ])('%s -> %s', (iso, phase) => {
    expect(marketPhase(t(iso))).toBe(phase);
  });

  it('freshness needs an open session and the 24 h heartbeat', () => {
    expect(isMarkFresh(t('2026-11-24T14:00:00Z'), t('2026-11-24T15:00:00Z'))).toBe(true);
    expect(isMarkFresh(t('2026-11-23T10:00:00Z'), t('2026-11-24T15:00:00Z'))).toBe(false); // 29 h old
    expect(isMarkFresh(t('2026-11-20T23:38:55Z'), t('2026-11-22T12:00:00Z'))).toBe(false); // weekend
  });
});

describe('mark selection and the weekend path', () => {
  const feed: FeedRead = { feed: '0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA', description: 'Coinbase SNDK', answer8: 64_944_000_000n, updatedAt: t('2026-11-20T23:38:55Z') };
  const nav: NavRecord = { symbol: 'SNDKc', address: '0xb200000000000000000000397293Cb8cda9a10c5', multiplier: 8, navPrice: 649.44, navUpdatedAt: t('2026-11-20T23:38:55Z') };
  const twap: TwapRead = { pool: '0x2836e062a3fe75943a7F4A552E2365b98E414E75', windowSec: 1800, answer8: 64_552_822_983n };

  it('in session with a fresh feed -> chainlink, no gap risk', () => {
    const m = selectMark({ feed, nav, twap, nowSec: t('2026-11-20T23:45:00Z') })!;
    expect(m.source).toBe('chainlink');
    expect(m.reopenGapRisk).toBe(false);
  });

  it('weekend: frozen feed and stale NAV fall back to the pool TWAP and flag reopen-gap risk', () => {
    const m = selectMark({ feed, nav, twap, nowSec: t('2026-11-22T12:00:00Z') })!;
    expect(m.source).toBe('twap');
    expect(m.reopenGapRisk).toBe(true);
    expect(m.lastClose8).toBe(64_944_000_000n);
    expect(m.notes.join(' ')).toMatch(/frozen/);
  });

  it('token with NAV but no Chainlink feed (e.g. ANTc) uses a fresh NAV in session', () => {
    const m = selectMark({ feed: null, nav: { ...nav, navUpdatedAt: t('2026-11-24T14:30:00Z') }, twap, nowSec: t('2026-11-24T15:00:00Z') })!;
    expect(m.source).toBe('nav');
  });

  it('missed heartbeat in session -> TWAP', () => {
    const m = selectMark({ feed: { ...feed, updatedAt: t('2026-11-23T08:00:00Z') }, nav: null, twap, nowSec: t('2026-11-24T15:00:00Z') })!;
    expect(m.source).toBe('twap');
  });

  it('nothing available -> no reference mark', () => {
    expect(selectMark({ feed: null, nav: null, twap: null, nowSec: t('2026-11-24T15:00:00Z') })).toBeNull();
  });

  it('weekend guard on the TWAP mark still clears the live quote', () => {
    const m = selectMark({ feed, nav, twap, nowSec: t('2026-11-22T12:00:00Z') })!;
    const g = computeGuardMinOut({ usdIn6: 10_000_000n, mark8: m.usdPerToken8, decimals: 8, multiplierWad: SNDK_MULT });
    expect(1_549_386n).toBeGreaterThanOrEqual(g.amountOutMin);
  });
});
