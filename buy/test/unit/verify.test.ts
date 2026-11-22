import { describe, expect, it } from 'vitest';
import { concat, encodeAbiParameters, encodeEventTopics, encodeFunctionData, encodePacked, erc20Abi, parseAbi, type Address, type Hex, type PublicClient } from 'viem';
import { entryPointAbi } from '../../src/constants';
import { TROPA_SUFFIX, appendSuffix, encodeBuilderSuffix } from '../../src/suffix';
import { attributionFromAccountCall, innerCallDatas, verifyAttribution } from '../../src/verify';

const EP6 = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789' as Address;
const EP7 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Address;
const EP8 = '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108' as Address;
const ROUTER = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5' as Address;
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;
const SENDER = '0x2222222222222222222222222222222222222222' as Address;
const OTHER = '0x3333333333333333333333333333333333333333' as Address;
const BUNDLER = '0x9999999999999999999999999999999999999999' as Address;
const HASH = `0x${'ab'.repeat(32)}` as Hex;
const ZERO32 = `0x${'00'.repeat(32)}` as Hex;

function mockClient(tx: { to: Address; input: Hex; from?: Address }, logs: { address: Address; topics: Hex[]; data: Hex }[] = []): PublicClient {
  return {
    getTransaction: async () => ({ ...tx, from: tx.from ?? BUNDLER, hash: HASH }),
    getTransactionReceipt: async () => ({ logs }),
  } as unknown as PublicClient;
}

function userOpEvent(sender: Address, nonce: bigint, ep: Address = EP7) {
  const topics = encodeEventTopics({ abi: entryPointAbi, eventName: 'UserOperationEvent', args: { userOpHash: HASH, sender, paymaster: '0x0000000000000000000000000000000000000000' } }) as Hex[];
  const data = encodeAbiParameters([{ type: 'uint256' }, { type: 'bool' }, { type: 'uint256' }, { type: 'uint256' }], [nonce, true, 1n, 1n]);
  return { address: ep, topics, data };
}

// ---------------------------------------------------------------- calldata builders

const SWAP = '0xe21fd0e9abcdef' as Hex; // stand-in router calldata
const APPROVE = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [ROUTER, 10_000_000n] });
const accountAbi = parseAbi([
  'function execute(address target, uint256 value, bytes data)',
  'function executeBatch((address target, uint256 value, bytes data)[] calls)',
  'function executeBatch(address[] dest, uint256[] value, bytes[] func)',
  'function executeBatch(address[] dest, bytes[] func)',
  'function execute(bytes32 mode, bytes executionCalldata)',
  'function execute((address to, uint256 value, bytes data)[] calls)',
]);
const execute = (data: Hex, target: Address = ROUTER) => encodeFunctionData({ abi: accountAbi, functionName: 'execute', args: [target, 0n, data] });
const cbswBatch = (calls: { target: Address; data: Hex }[]) =>
  encodeFunctionData({ abi: accountAbi, functionName: 'executeBatch', args: [calls.map((c) => ({ target: c.target, value: 0n, data: c.data }))] });
const arrays3 = (calls: { target: Address; data: Hex }[]) =>
  encodeFunctionData({ abi: accountAbi, functionName: 'executeBatch', args: [calls.map((c) => c.target), calls.map(() => 0n), calls.map((c) => c.data)] });
const arrays2 = (calls: { target: Address; data: Hex }[]) =>
  encodeFunctionData({ abi: accountAbi, functionName: 'executeBatch', args: [calls.map((c) => c.target), calls.map((c) => c.data)] });
const MODE_SINGLE = ZERO32;
const MODE_BATCH = `0x01${'00'.repeat(31)}` as Hex;
const erc7579Single = (data: Hex, target: Address = ROUTER) =>
  encodeFunctionData({ abi: accountAbi, functionName: 'execute', args: [MODE_SINGLE, encodePacked(['address', 'uint256', 'bytes'], [target, 0n, data])] });
const erc7579Batch = (calls: { target: Address; data: Hex }[]) =>
  encodeFunctionData({
    abi: accountAbi,
    functionName: 'execute',
    args: [MODE_BATCH, encodeAbiParameters([{ type: 'tuple[]', components: [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes' }] }], [calls.map((c) => [c.target, 0n, c.data] as const)])],
  });
const buyCalls = (tag: boolean) => [
  { target: USDC, data: tag ? appendSuffix(APPROVE) : APPROVE },
  { target: ROUTER, data: tag ? appendSuffix(SWAP) : SWAP },
];

const packedOp = (sender: Address, nonce: bigint, callData: Hex) => ({
  sender,
  nonce,
  initCode: '0x' as Hex,
  callData,
  accountGasLimits: ZERO32,
  preVerificationGas: 1n,
  gasFees: ZERO32,
  paymasterAndData: '0x' as Hex,
  signature: '0x' as Hex,
});
const v6Op = (sender: Address, nonce: bigint, callData: Hex) => ({
  sender,
  nonce,
  initCode: '0x' as Hex,
  callData,
  callGasLimit: 1n,
  verificationGasLimit: 1n,
  preVerificationGas: 1n,
  maxFeePerGas: 1n,
  maxPriorityFeePerGas: 1n,
  paymasterAndData: '0x' as Hex,
  signature: '0x' as Hex,
});
const handleOps7 = (ops: ReturnType<typeof packedOp>[]) => encodeFunctionData({ abi: entryPointAbi, functionName: 'handleOps', args: [ops, BUNDLER] });
const handleOps6 = (ops: ReturnType<typeof v6Op>[]) => encodeFunctionData({ abi: entryPointAbi, functionName: 'handleOps', args: [ops, BUNDLER] });
const aggregatedAbi = parseAbi([
  'struct PackedUserOperation { address sender; uint256 nonce; bytes initCode; bytes callData; bytes32 accountGasLimits; uint256 preVerificationGas; bytes32 gasFees; bytes paymasterAndData; bytes signature; }',
  'struct UserOpsPerAggregator { PackedUserOperation[] userOps; address aggregator; bytes signature; }',
  'function handleAggregatedOps(UserOpsPerAggregator[] opsPerAggregator, address beneficiary)',
]);

/** One v0.7 bundle with one op, event included. */
const bundle7 = (callData: Hex, sender: Address = SENDER, nonce = 7n) =>
  mockClient({ to: EP7, input: handleOps7([packedOp(sender, nonce, callData)]) }, [userOpEvent(sender, nonce)]);

// ---------------------------------------------------------------- tests

describe('verifyAttribution: tx input (EOA)', () => {
  it('EOA tx with the suffix at the end', async () => {
    const r = await verifyAttribution(HASH, { client: mockClient({ to: ROUTER, input: appendSuffix('0xe21fd0e9abcd'), from: SENDER }) });
    expect(r).toMatchObject({ attributed: true, codes: ['bc_vdp89s9b'], via: 'tx', match: 'input', from: SENDER });
  });

  it('plain tx without suffix', async () => {
    const r = await verifyAttribution(HASH, { client: mockClient({ to: SENDER, input: '0xa9059cbb' }) });
    expect(r).toMatchObject({ attributed: false, codes: [], via: 'none' });
  });

  it('non-EntryPoint tx with the suffix only in the middle of its input is NOT credited', async () => {
    const input = concat(['0xe21fd0e9', TROPA_SUFFIX, '0x' + '00'.repeat(35) as Hex]);
    const r = await verifyAttribution(HASH, { client: mockClient({ to: ROUTER, input, from: SENDER }) });
    expect(r).toMatchObject({ attributed: false, via: 'none', innerOnly: true, from: SENDER });
  });

  it('another app’s code at the end is reported but not credited', async () => {
    const r = await verifyAttribution(HASH, { client: mockClient({ to: ROUTER, input: appendSuffix(SWAP, encodeBuilderSuffix(['baseapp'])), from: SENDER }) });
    expect(r).toMatchObject({ attributed: false, codes: ['baseapp'], via: 'tx' });
  });

  it('a batch relayed into someone else’s account, suffix only on an inner call, is NOT credited', async () => {
    const batch = encodeFunctionData({ abi: accountAbi, functionName: 'execute', args: [[{ to: ROUTER, value: 0n, data: appendSuffix('0xe21fd0e9') }]] });
    const r = await verifyAttribution(HASH, { client: mockClient({ to: SENDER, input: batch }) });
    expect(r.attributed).toBe(false);
    expect(r.innerOnly).toBe(true);
  });

  it('EIP-7702 account calling itself with an ERC-7579 batch, inner calls suffixed: credited', async () => {
    const r = await verifyAttribution(HASH, { client: mockClient({ to: SENDER, from: SENDER, input: erc7579Batch(buyCalls(true)) }) });
    expect(r).toMatchObject({ attributed: true, via: 'tx', match: 'innerCall', from: SENDER, codes: ['bc_vdp89s9b'] });
  });

  it('EIP-7702 self-call where the suffix sits inside an inner call but not at its end: NOT credited', async () => {
    const r = await verifyAttribution(HASH, { client: mockClient({ to: SENDER, from: SENDER, input: erc7579Batch([{ target: ROUTER, data: concat([SWAP, TROPA_SUFFIX, '0x1234']) }]) }) });
    expect(r).toMatchObject({ attributed: false, via: 'none', innerOnly: true });
  });
});

describe('verifyAttribution: userOp callData (ERC-4337)', () => {
  it('v0.7 handleOps: suffix at the end of the UserOp callData', async () => {
    const r = await verifyAttribution(HASH, { client: bundle7(appendSuffix(execute(SWAP))) });
    expect(r).toMatchObject({ attributed: true, via: 'userop', match: 'callData', from: SENDER });
  });

  it('v0.6 handleOps (UserOperation struct): suffix at the end of callData', async () => {
    const input = handleOps6([v6Op(SENDER, 3n, appendSuffix(execute(SWAP)))]);
    const r = await verifyAttribution(HASH, { client: mockClient({ to: EP6, input }, [userOpEvent(SENDER, 3n, EP6)]) });
    expect(r).toMatchObject({ attributed: true, via: 'userop', match: 'callData', from: SENDER });
  });

  it('v0.8 handleOps (PackedUserOperation): suffix at the end of callData', async () => {
    const input = handleOps7([packedOp(SENDER, 9n, appendSuffix(cbswBatch(buyCalls(false))))]);
    const r = await verifyAttribution(HASH, { client: mockClient({ to: EP8, input }, [userOpEvent(SENDER, 9n, EP8)]) });
    expect(r).toMatchObject({ attributed: true, via: 'userop', match: 'callData', from: SENDER });
  });

  it('v0.7 handleAggregatedOps: the buyer’s op inside an aggregator group', async () => {
    const op = packedOp(SENDER, 4n, appendSuffix(execute(SWAP)));
    const input = encodeFunctionData({ abi: aggregatedAbi, functionName: 'handleAggregatedOps', args: [[{ userOps: [op], aggregator: OTHER, signature: '0x' }], BUNDLER] });
    const r = await verifyAttribution(HASH, { client: mockClient({ to: EP7, input }, [userOpEvent(SENDER, 4n)]) });
    expect(r).toMatchObject({ attributed: true, via: 'userop', from: SENDER });
  });

  it('an op the receipt does not show executing (no matching UserOperationEvent) is not credited', async () => {
    const input = handleOps7([packedOp(SENDER, 7n, appendSuffix(execute(SWAP)))]);
    const r = await verifyAttribution(HASH, { client: mockClient({ to: EP7, input }, [userOpEvent(SENDER, 8n)]) });
    expect(r.attributed).toBe(false);
  });

  it('a bundler’s own code on handleOps does not hide the buyer’s tagged inner call', async () => {
    const input = appendSuffix(handleOps7([packedOp(SENDER, 7n, execute(appendSuffix(SWAP)))]), encodeBuilderSuffix(['bundlr']));
    const r = await verifyAttribution(HASH, { client: mockClient({ to: EP7, input }, [userOpEvent(SENDER, 7n)]) });
    expect(r).toMatchObject({ attributed: true, via: 'userop', match: 'innerCall', from: SENDER });
  });

  it('no suffix anywhere: not credited, signer is the sender', async () => {
    const r = await verifyAttribution(HASH, { client: bundle7(execute(SWAP)) });
    expect(r).toMatchObject({ attributed: false, via: 'none', from: SENDER });
  });
});

describe('verifyAttribution: inner calls of the smart account call', () => {
  const shapes: [string, Hex][] = [
    ['execute(address,uint256,bytes)', execute(appendSuffix(SWAP))],
    ['Coinbase Smart Wallet executeBatch((address,uint256,bytes)[])', cbswBatch(buyCalls(true))],
    ['executeBatch(address[],uint256[],bytes[])', arrays3(buyCalls(true))],
    ['executeBatch(address[],bytes[])', arrays2(buyCalls(true))],
    ['ERC-7579 execute(bytes32,bytes) single', erc7579Single(appendSuffix(SWAP))],
    ['ERC-7579 execute(bytes32,bytes) batch', erc7579Batch(buyCalls(true))],
    ['v0.7 executeUserOp prefix + ERC-7579 batch', concat(['0x8dd7712f', erc7579Batch(buyCalls(true))])],
    ['execute(address,...) wrapping a Coinbase executeBatch', execute(cbswBatch(buyCalls(true)), SENDER)],
  ];
  for (const [name, callData] of shapes) {
    it(`${name}: callData ends in ABI zero padding, inner call carries the suffix -> credited`, async () => {
      expect(callData.endsWith('00')).toBe(true);
      expect(attributionFromAccountCall(callData).where).toBe('innerCall');
      const r = await verifyAttribution(HASH, { client: bundle7(callData) });
      expect(r).toMatchObject({ attributed: true, codes: ['bc_vdp89s9b'], via: 'userop', match: 'innerCall', from: SENDER });
    });
  }

  it('only the swap call is tagged (approve untagged): still credited', async () => {
    const r = await verifyAttribution(HASH, { client: bundle7(cbswBatch([{ target: USDC, data: APPROVE }, { target: ROUTER, data: appendSuffix(SWAP) }])) });
    expect(r.attributed).toBe(true);
  });

  it('untagged inner calls are not credited', async () => {
    for (const cd of [cbswBatch(buyCalls(false)), erc7579Batch(buyCalls(false)), erc7579Single(SWAP), arrays3(buyCalls(false))]) {
      const r = await verifyAttribution(HASH, { client: bundle7(cd) });
      expect(r.attributed).toBe(false);
    }
  });

  it('innerCallDatas flattens a batch and nested account calls', () => {
    expect(innerCallDatas(cbswBatch(buyCalls(true)))).toHaveLength(2);
    expect(innerCallDatas(execute(cbswBatch(buyCalls(true)), SENDER))).toHaveLength(3);
    expect(innerCallDatas(APPROVE)).toEqual([]);
  });
});

describe('verifyAttribution: the buyer’s userOp only', () => {
  const event2 = [userOpEvent(SENDER, 1n), userOpEvent(OTHER, 2n)];

  it('suffix only on an inner call of a different userOp (sender not the buyer): NOT credited for the buyer', async () => {
    const input = handleOps7([packedOp(SENDER, 1n, cbswBatch(buyCalls(false))), packedOp(OTHER, 2n, cbswBatch(buyCalls(true)))]);
    const client = mockClient({ to: EP7, input }, event2);
    const forBuyer = await verifyAttribution(HASH, { client, buyer: SENDER.toLowerCase() });
    expect(forBuyer.attributed).toBe(false);
    expect(forBuyer.from).toBe(SENDER);
    // without a buyer the credit goes to the other sender, so the signer check (clubs/src/buys.ts) rejects the buyer
    const any = await verifyAttribution(HASH, { client });
    expect(any).toMatchObject({ attributed: true, from: OTHER });
    expect(any.from).not.toBe(SENDER);
  });

  it('both ops tagged: the buyer is credited as the sender, whatever the order', async () => {
    const input = handleOps7([packedOp(OTHER, 2n, cbswBatch(buyCalls(true))), packedOp(SENDER, 1n, appendSuffix(execute(SWAP)))]);
    const r = await verifyAttribution(HASH, { client: mockClient({ to: EP7, input }, event2), buyer: SENDER });
    expect(r).toMatchObject({ attributed: true, via: 'userop', from: SENDER, match: 'callData' });
    expect(r.userOps).toHaveLength(2);
  });

  it('buyer not in the bundle: not credited', async () => {
    const input = handleOps7([packedOp(OTHER, 2n, appendSuffix(execute(SWAP)))]);
    const r = await verifyAttribution(HASH, { client: mockClient({ to: EP7, input }, [userOpEvent(OTHER, 2n)]), buyer: SENDER });
    expect(r.attributed).toBe(false);
  });
});

describe('verifyAttribution: only router calls and the payment approve credit (red team r4)', () => {
  const RANDOM = '0x5555555555555555555555555555555555555555' as Address;
  const WETH = '0x4200000000000000000000000000000000000006' as Address;
  const approveTo = (spender: Address) => encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, 1n] });

  it('suffix on an inner call to a random contract: NOT credited (code still reported)', async () => {
    for (const cd of [execute(appendSuffix(SWAP), RANDOM), cbswBatch([{ target: RANDOM, data: appendSuffix('0x12345678') }, { target: ROUTER, data: SWAP }]), erc7579Single(appendSuffix(SWAP), RANDOM)]) {
      const r = await verifyAttribution(HASH, { client: bundle7(cd) });
      expect(r).toMatchObject({ attributed: false, codes: ['bc_vdp89s9b'], via: 'userop' });
    }
  });

  it('approve with the suffix credits only on USDC / WETH and only with the router as spender', async () => {
    const tagged = (target: Address, data: Hex) => bundle7(cbswBatch([{ target, data: appendSuffix(data) }, { target: ROUTER, data: SWAP }]));
    expect((await verifyAttribution(HASH, { client: tagged(USDC, APPROVE) })).attributed).toBe(true);
    expect((await verifyAttribution(HASH, { client: tagged(WETH, approveTo(ROUTER)) })).attributed).toBe(true);
    expect((await verifyAttribution(HASH, { client: tagged(USDC, approveTo(RANDOM)) })).attributed).toBe(false);
    expect((await verifyAttribution(HASH, { client: tagged(RANDOM, approveTo(ROUTER)) })).attributed).toBe(false);
    // a transfer on USDC carrying the suffix is not an approve
    const transfer = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [ROUTER, 1n] });
    expect((await verifyAttribution(HASH, { client: tagged(USDC, transfer) })).attributed).toBe(false);
  });

  it('inner-call suffix in a handleOps tx not sent to an EntryPoint: NOT credited, even with a matching event', async () => {
    const input = handleOps7([packedOp(SENDER, 7n, cbswBatch(buyCalls(true)))]);
    const r = await verifyAttribution(HASH, { client: mockClient({ to: RANDOM, input }, [userOpEvent(SENDER, 7n)]) });
    expect(r.attributed).toBe(false);
    // the same ops sent to the EntryPoint are credited
    const ok = await verifyAttribution(HASH, { client: mockClient({ to: EP7, input }, [userOpEvent(SENDER, 7n)]) });
    expect(ok).toMatchObject({ attributed: true, match: 'innerCall', from: SENDER });
  });

  it('userOp callData ending in the suffix keeps its existing behaviour when the receipt shows the op', async () => {
    const input = handleOps7([packedOp(SENDER, 7n, appendSuffix(execute(SWAP)))]);
    const r = await verifyAttribution(HASH, { client: mockClient({ to: RANDOM, input }, [userOpEvent(SENDER, 7n)]) });
    expect(r).toMatchObject({ attributed: true, via: 'userop', match: 'callData', from: SENDER });
  });

  it('inner-call suffix in a tx to some other contract (not an EntryPoint, not a self-call): NOT credited', async () => {
    const r = await verifyAttribution(HASH, { client: mockClient({ to: RANDOM, from: SENDER, input: erc7579Batch(buyCalls(true)) }) });
    expect(r.attributed).toBe(false);
  });

  it('EIP-7702 self-call: a suffixed inner call to a random contract is NOT credited, to the router it is', async () => {
    const bad = await verifyAttribution(HASH, { client: mockClient({ to: SENDER, from: SENDER, input: erc7579Batch([{ target: RANDOM, data: appendSuffix(SWAP) }]) }) });
    expect(bad.attributed).toBe(false);
    const good = await verifyAttribution(HASH, { client: mockClient({ to: SENDER, from: SENDER, input: erc7579Batch([{ target: ROUTER, data: appendSuffix(SWAP) }]) }) });
    expect(good).toMatchObject({ attributed: true, match: 'innerCall' });
  });

  it('a router call nested inside a call into another account is NOT credited to the buyer', async () => {
    const r = await verifyAttribution(HASH, { client: bundle7(execute(cbswBatch(buyCalls(true)), OTHER)) });
    expect(r.attributed).toBe(false);
    // nested inside the buyer's own account it is
    expect((await verifyAttribution(HASH, { client: bundle7(execute(cbswBatch(buyCalls(true)), SENDER)) })).attributed).toBe(true);
  });
});
