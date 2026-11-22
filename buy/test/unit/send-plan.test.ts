import { describe, expect, it } from 'vitest';
import { type Address, type Hex } from 'viem';
import { WALLET_CANT_TAG_MESSAGE, accountKind, buildBuyCalls, planSend, walletSupportsSendCalls } from '../../src/calls';
import { USDC } from '../../src/constants';
import type { BuiltSwap, Quote } from '../../src/quote';
import { TROPA_SUFFIX, parseSuffix, stripSuffix } from '../../src/suffix';

const SNDK = '0xb200000000000000000000397293Cb8cda9a10c5' as Address;
const ROUTER = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5' as Address;
const from = '0x1111111111111111111111111111111111111111' as Address;
const quote = { provider: 'kyberswap', sellToken: USDC, buyToken: SNDK, sellAmount: 10_000_000n, amountOut: 1_549_386n, router: ROUTER, venues: ['aero-cl'], raw: {}, taker: from } as Quote;
const swap: BuiltSwap = { to: ROUTER, data: '0xe21fd0e9abcdef', value: 0n, amountOut: 1_549_386n, minReturnAmount: 1_516_690n, dstReceiver: from, provider: 'kyberswap' };
const calls = buildBuyCalls({ quote, swap, sellSymbol: 'USDC', buySymbol: 'SNDKc' });

const SUFFIX_CAPS = { '0x2105': { atomic: { status: 'supported' }, dataSuffix: { supported: true } } };
const PLAIN_CAPS = { '0x2105': { atomic: { status: 'supported' } } };
const CONTRACT_CODE = '0x363d3d373d3d3d363d73bebebebebebebebebebebebebebebebebebebebe5af43d82803e903d91602b57fd5bf3' as Hex;
const DELEGATED_CODE = '0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b' as Hex;

const tagged = (d: Hex) => parseSuffix(d)?.codes ?? null;

describe('accountKind', () => {
  it('no code is an EOA (viem undefined, 0x, null)', () => {
    expect(accountKind(undefined)).toBe('eoa');
    expect(accountKind('0x')).toBe('eoa');
    expect(accountKind(null)).toBe('eoa');
  });
  it('EIP-7702 designator 0xef0100 is a delegated account', () => {
    expect(accountKind(DELEGATED_CODE)).toBe('delegated');
    expect(accountKind(DELEGATED_CODE.toUpperCase().replace('0X', '0x') as Hex)).toBe('delegated');
  });
  it('any other code is a contract account', () => {
    expect(accountKind(CONTRACT_CODE)).toBe('contract');
  });
});

describe('planSend', () => {
  it('dataSuffix supported (EOA): sendCalls with the capability, calls carry no suffix of ours', () => {
    const plan = planSend(calls, from, SUFFIX_CAPS);
    expect(plan).toMatchObject({ kind: 'sendCalls', tagging: 'wallet' });
    if (plan.kind !== 'sendCalls') throw new Error(plan.kind);
    const p = plan.request.params[0];
    expect(p.capabilities).toEqual({ dataSuffix: { value: TROPA_SUFFIX, optional: false } });
    expect(p.calls).toHaveLength(2);
    for (const c of p.calls) expect(tagged(c.data)).toBeNull();
    expect(p.calls[1]!.data).toBe('0xe21fd0e9abcdef');
  });

  it('dataSuffix supported (smart wallet with code): same, the wallet tags once', () => {
    const plan = planSend(calls, from, SUFFIX_CAPS, { code: CONTRACT_CODE });
    expect(plan).toMatchObject({ kind: 'sendCalls', tagging: 'wallet' });
    if (plan.kind !== 'sendCalls') throw new Error(plan.kind);
    for (const c of plan.request.params[0].calls) expect(tagged(c.data)).toBeNull();
  });

  it('dataSuffix advertised globally under 0x0 counts too', () => {
    const plan = planSend(calls, from, { '0x0': { dataSuffix: { status: 'supported' } } }, { code: DELEGATED_CODE });
    expect(plan).toMatchObject({ kind: 'sendCalls', tagging: 'wallet' });
  });

  it('contract account without dataSuffix, wallet takes sendCalls: suffix on every inner call, no capability', () => {
    const plan = planSend(calls, from, PLAIN_CAPS, { code: CONTRACT_CODE });
    expect(plan).toMatchObject({ kind: 'sendCalls', tagging: 'calls' });
    if (plan.kind !== 'sendCalls') throw new Error(plan.kind);
    const p = plan.request.params[0];
    expect(p.capabilities).toBeUndefined();
    expect(p.atomicRequired).toBe(true);
    for (const c of p.calls) expect(tagged(c.data)).toEqual(['bc_vdp89s9b']);
  });

  it('EIP-7702 delegated account without dataSuffix, wallet takes sendCalls: suffix on every inner call', () => {
    // inner calls that arrive untagged get tagged, exactly once
    const bare = calls.map((c) => ({ ...c, data: stripSuffix(c.data) }));
    const plan = planSend(bare, from, {}, { code: DELEGATED_CODE });
    expect(plan).toMatchObject({ kind: 'sendCalls', tagging: 'calls' });
    if (plan.kind !== 'sendCalls') throw new Error(plan.kind);
    for (const c of plan.request.params[0].calls) {
      expect(c.data.endsWith(TROPA_SUFFIX.slice(2))).toBe(true);
      expect(c.data.indexOf(TROPA_SUFFIX.slice(2))).toBe(c.data.length - (TROPA_SUFFIX.length - 2));
    }
    expect(plan.request.params[0].atomicRequired).toBe(false);
  });

  it('contract account with no wallet_sendCalls: blocked, with the exact message', () => {
    for (const code of [CONTRACT_CODE, DELEGATED_CODE]) {
      const plan = planSend(calls, from, null, { code });
      expect(plan.kind).toBe('blocked');
      if (plan.kind !== 'blocked') throw new Error(plan.kind);
      expect(plan.message).toBe("This wallet can't tag buys for your club yet. Use Coinbase Smart Wallet or a regular wallet.");
      expect(plan.message).toBe(WALLET_CANT_TAG_MESSAGE);
      expect('requests' in plan || 'request' in plan).toBe(false);
    }
  });

  it('EOA without dataSuffix (caps answered): sequential, each tx ends in the suffix', () => {
    const plan = planSend(calls, from, PLAIN_CAPS, { code: undefined });
    expect(plan).toMatchObject({ kind: 'sequential', tagging: 'calls' });
    if (plan.kind !== 'sequential') throw new Error(plan.kind);
    expect(plan.requests.map((r) => r.method)).toEqual(['eth_sendTransaction', 'eth_sendTransaction']);
    for (const r of plan.requests) expect(tagged(r.params[0].data)).toEqual(['bc_vdp89s9b']);
  });

  it('EOA with no wallet_getCapabilities: sequential', () => {
    const plan = planSend(calls, from, null, { code: '0x' });
    expect(plan.kind).toBe('sequential');
  });

  it('code unknown (read failed) falls back to the EOA path', () => {
    expect(planSend(calls, from, PLAIN_CAPS, { code: null }).kind).toBe('sequential');
  });

  it('forceSequential overrides every other branch', () => {
    expect(planSend(calls, from, SUFFIX_CAPS, { forceSequential: true }).kind).toBe('sequential');
    expect(planSend(calls, from, null, { forceSequential: true, code: CONTRACT_CODE }).kind).toBe('sequential');
  });

  it('walletSupportsSendCalls: any wallet_getCapabilities answer', () => {
    expect(walletSupportsSendCalls({})).toBe(true);
    expect(walletSupportsSendCalls(PLAIN_CAPS)).toBe(true);
    expect(walletSupportsSendCalls(null)).toBe(false);
    expect(walletSupportsSendCalls(undefined)).toBe(false);
  });
});
