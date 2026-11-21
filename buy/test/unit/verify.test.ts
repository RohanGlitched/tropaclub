import { describe, expect, it } from 'vitest';
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbi, type Address, type Hex, type PublicClient } from 'viem';
import { entryPointAbi } from '../../src/constants';
import { appendSuffix } from '../../src/suffix';
import { verifyAttribution } from '../../src/verify';

const EP7 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Address;
const SENDER = '0x2222222222222222222222222222222222222222' as Address;
const HASH = `0x${'ab'.repeat(32)}` as Hex;

function mockClient(tx: { to: Address; input: Hex; from?: Address }, logs: { address: Address; topics: Hex[]; data: Hex }[] = []): PublicClient {
  return {
    getTransaction: async () => ({ ...tx, from: tx.from ?? '0x9999999999999999999999999999999999999999', hash: HASH }),
    getTransactionReceipt: async () => ({ logs }),
  } as unknown as PublicClient;
}

function userOpEvent(sender: Address, nonce: bigint) {
  const topics = encodeEventTopics({ abi: entryPointAbi, eventName: 'UserOperationEvent', args: { userOpHash: HASH, sender, paymaster: '0x0000000000000000000000000000000000000000' } }) as Hex[];
  const data = encodeAbiParameters([{ type: 'uint256' }, { type: 'bool' }, { type: 'uint256' }, { type: 'uint256' }], [nonce, true, 1n, 1n]);
  return { address: EP7, topics, data };
}

const execute = parseAbi(['function execute(address target, uint256 value, bytes data)']);
const inner = encodeFunctionData({ abi: execute, functionName: 'execute', args: ['0x6131B5fae19EA4f9D964eAc0408E4408b66337b5', 0n, '0xe21fd0e9'] });

describe('verifyAttribution', () => {
  it('EOA tx with the suffix at the end', async () => {
    const r = await verifyAttribution(HASH, { client: mockClient({ to: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5', input: appendSuffix('0xe21fd0e9abcd') }) });
    expect(r).toMatchObject({ attributed: true, codes: ['bc_vdp89s9b'], via: 'tx' });
  });

  it('ERC-4337 v0.7 handleOps: suffix at the end of the UserOp callData', async () => {
    const op = {
      sender: SENDER,
      nonce: 7n,
      initCode: '0x' as Hex,
      callData: appendSuffix(inner),
      accountGasLimits: `0x${'00'.repeat(32)}` as Hex,
      preVerificationGas: 1n,
      gasFees: `0x${'00'.repeat(32)}` as Hex,
      paymasterAndData: '0x' as Hex,
      signature: '0x' as Hex,
    };
    const input = encodeFunctionData({ abi: entryPointAbi, functionName: 'handleOps', args: [[op], SENDER] });
    const r = await verifyAttribution(HASH, { client: mockClient({ to: EP7, input }, [userOpEvent(SENDER, 7n)]) });
    expect(r.attributed).toBe(true);
    expect(r.via).toBe('userop');
    expect(r.from).toBe(SENDER);
  });

  it('7702 batch where only an inner call carries the suffix is NOT attributed', async () => {
    const batch = parseAbi(['function execute((address to, uint256 value, bytes data)[] calls)']);
    const input = encodeFunctionData({ abi: batch, functionName: 'execute', args: [[{ to: '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5', value: 0n, data: appendSuffix('0xe21fd0e9') }]] });
    const r = await verifyAttribution(HASH, { client: mockClient({ to: SENDER, input }) });
    expect(r.attributed).toBe(false);
    expect(r.innerOnly).toBe(true);
  });

  it('plain tx without suffix', async () => {
    const r = await verifyAttribution(HASH, { client: mockClient({ to: SENDER, input: '0xa9059cbb' }) });
    expect(r).toMatchObject({ attributed: false, codes: [], via: 'none' });
  });
});
