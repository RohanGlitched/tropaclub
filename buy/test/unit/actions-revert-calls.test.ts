import { describe, expect, it } from 'vitest';
import { encodeErrorResult, parseAbi, type Address, type Hex } from 'viem';
import { evaluateCorporateActions, type AnnouncementLog } from '../../src/actions';
import { buildBuyCalls, planSend, walletSupportsDataSuffix } from '../../src/calls';
import { POLICY_SCOPES, USDC, b20ErrorsAbi } from '../../src/constants';
import { decodeRevert } from '../../src/revert';
import { TROPA_SUFFIX, parseSuffix } from '../../src/suffix';
import type { BuiltSwap, Quote } from '../../src/quote';

const SNDK = '0xb200000000000000000000397293Cb8cda9a10c5' as Address;
const UUID = '4d449eba-9206-4c35-8c1e-921c20e864d5';
const pre: AnnouncementLog[] = [
  { token: SNDK, kind: 'Announcement', id: `${UUID}:pre`, description: 'Stock Split', uri: `https://api.coinbase.com/v1/tokenized-stocks/corporate-actions/${UUID}`, blockNumber: 53298759n, txHash: '0xa7' },
  { token: SNDK, kind: 'EndAnnouncement', id: `${UUID}:pre`, blockNumber: 53298759n, txHash: '0xa7' },
];
const final: AnnouncementLog[] = [
  { token: SNDK, kind: 'Announcement', id: UUID, description: '8-for-1 Stock Split', uri: `https://api.coinbase.com/v1/tokenized-stocks/corporate-actions/${UUID}`, blockNumber: 59674150n, txHash: '0x3f' },
  { token: SNDK, kind: 'EndAnnouncement', id: UUID, blockNumber: 59674150n, txHash: '0x3f' },
];
const applied = { symbol: 'SNDKc', multiplierWad: 8n * 10n ** 18n, pendingMultiplierWad: 8n * 10n ** 18n, effectiveAt: 1795150800 };
const now = Math.floor(Date.parse('2026-11-22T12:00:00Z') / 1000);

describe('corporate actions (SNDKc 8-for-1 split replay)', () => {
  it('pre-notice only (Oct 30 - Nov 19) -> open', () => {
    const s = evaluateCorporateActions(pre, { ...applied, multiplierWad: 10n ** 18n, pendingMultiplierWad: 10n ** 18n, effectiveAt: 0 }, now);
    expect(s.open).toBe(true);
    expect(s.reasons[0]).toMatch(/pre-notice/);
  });
  it('final announcement with a future effectiveAt (Nov 19 - Nov 20 05:00Z) -> open', () => {
    const s = evaluateCorporateActions([...pre, ...final], { ...applied, multiplierWad: 10n ** 18n }, Math.floor(Date.parse('2026-11-19T22:00:00Z') / 1000));
    expect(s.open).toBe(true);
    expect(s.reasons.join()).toMatch(/x8/);
  });
  it('applied (now) -> closed', () => {
    expect(evaluateCorporateActions([...pre, ...final], applied, now).open).toBe(false);
  });
  it('API status ANNOUNCED wins', () => {
    expect(evaluateCorporateActions([...pre, ...final], applied, now, { [UUID]: 'CORPORATE_ACTION_STATUS_ANNOUNCED' }).open).toBe(true);
  });
  it('Announcement without EndAnnouncement -> open', () => {
    expect(evaluateCorporateActions([final[0]!], applied, now).open).toBe(true);
  });
  it('multiplier change scheduled with no Announcement at all -> open', () => {
    const s = evaluateCorporateActions([], { symbol: 'XYZc', multiplierWad: 10n ** 18n, pendingMultiplierWad: 1_010_000_000_000_000_000n, effectiveAt: now + 3600 }, now);
    expect(s.open).toBe(true);
  });
});

describe('decoded-revert map', () => {
  const errStr = parseAbi(['error Error(string)']);
  it('PolicyForbids (executor scope)', () => {
    const d = decodeRevert(encodeErrorResult({ abi: b20ErrorsAbi, errorName: 'PolicyForbids', args: [POLICY_SCOPES.TRANSFER_EXECUTOR_POLICY, 5n] }));
    expect(d.kind).toBe('policy');
    expect(d.sentence).toMatch(/compliance policy.*contract moving the tokens.*policy 5/);
  });
  it('ContractPaused(TRANSFER)', () => {
    const d = decodeRevert(encodeErrorResult({ abi: b20ErrorsAbi, errorName: 'ContractPaused', args: [0] }));
    expect(d.kind).toBe('paused');
    expect(d.sentence).toMatch(/paused transfers/);
  });
  it('B20 InsufficientAllowance', () => {
    const d = decodeRevert(encodeErrorResult({ abi: b20ErrorsAbi, errorName: 'InsufficientAllowance', args: [USDC, 0n, 10n] }));
    expect(d.kind).toBe('allowance');
  });
  it('KyberSwap min-out ("Return amount is not enough")', () => {
    const d = decodeRevert(encodeErrorResult({ abi: errStr, errorName: 'Error', args: ['Return amount is not enough'] }));
    expect(d.kind).toBe('slippage');
    expect(d.sentence).toMatch(/1\.5% guard/);
  });
  it('KyberSwap pull without approval ("TransferHelper: TRANSFER_FROM_FAILED")', () => {
    const d = decodeRevert(encodeErrorResult({ abi: errStr, errorName: 'Error', args: ['TransferHelper: TRANSFER_FROM_FAILED'] }));
    expect(d.kind).toBe('allowance');
  });
  it('USDC paused / blacklisted strings', () => {
    expect(decodeRevert(encodeErrorResult({ abi: errStr, errorName: 'Error', args: ['Pausable: paused'] })).kind).toBe('paused');
    expect(decodeRevert(encodeErrorResult({ abi: errStr, errorName: 'Error', args: ['Blacklistable: account is blacklisted'] })).kind).toBe('blacklisted');
  });
  it('unknown selector is still one sentence', () => {
    const d = decodeRevert('0xdeadbeef');
    expect(d.kind).toBe('unknown');
    expect(d.sentence.endsWith('.')).toBe(true);
  });
});

describe('buildBuyCalls + send strategy', () => {
  const quote = { provider: 'kyberswap', sellToken: USDC, buyToken: SNDK, sellAmount: 10_000_000n, amountOut: 1_549_386n, router: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5', venues: ['aero-cl'], raw: {}, taker: '0x1111111111111111111111111111111111111111' } as Quote;
  const swap: BuiltSwap = { to: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5', data: '0xe21fd0e9abcdef', value: 0n, amountOut: 1_549_386n, minReturnAmount: 1_516_690n, dstReceiver: quote.taker, provider: 'kyberswap' };
  const from = quote.taker;

  it('approve + swap, both ending in the suffix', () => {
    const calls = buildBuyCalls({ quote, swap, sellSymbol: 'USDC', buySymbol: 'SNDKc' });
    expect(calls.map((c) => c.label)).toEqual(['Approve USDC', 'Buy SNDKc']);
    for (const c of calls) expect(parseSuffix(c.data)?.codes).toEqual(['bc_vdp89s9b']);
    expect(calls[1]!.data.endsWith(TROPA_SUFFIX.slice(2))).toBe(true);
  });
  it('skips approve when allowance covers it', () => {
    expect(buildBuyCalls({ quote, swap, currentAllowance: 10_000_000n })).toHaveLength(1);
  });
  it('wallet with dataSuffix capability -> wallet_sendCalls with the capability', () => {
    const caps = { '0x2105': { atomic: { status: 'supported' }, dataSuffix: { supported: true } } };
    expect(walletSupportsDataSuffix(caps)).toBe(true);
    const plan = planSend(buildBuyCalls({ quote, swap }), from, caps);
    expect(plan.kind).toBe('sendCalls');
    if (plan.kind === 'sendCalls') {
      expect(plan.request.params[0].capabilities?.dataSuffix.value).toBe(TROPA_SUFFIX);
      expect(plan.request.params[0].atomicRequired).toBe(true);
      // the wallet tags once: our calls go without the suffix
      for (const c of plan.request.params[0].calls) expect(parseSuffix(c.data)).toBeNull();
    }
  });
  it('MetaMask-style 7702 batching without dataSuffix -> sequential suffixed txs', () => {
    const caps = { '0x2105': { atomic: { status: 'ready' } } };
    const plan = planSend(buildBuyCalls({ quote, swap }), from, caps);
    expect(plan.kind).toBe('sequential');
    if (plan.kind === 'sequential') {
      expect(plan.requests).toHaveLength(2);
      for (const r of plan.requests) expect(parseSuffix(r.params[0].data as Hex)?.codes).toEqual(['bc_vdp89s9b']);
    }
  });
  it('no capabilities at all -> sequential', () => {
    expect(planSend(buildBuyCalls({ quote, swap }), from, null).kind).toBe('sequential');
  });
});
