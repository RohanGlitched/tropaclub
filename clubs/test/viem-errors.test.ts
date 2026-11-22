/** A pool check must say "no" only when the contract answered, never because a node failed. */
import { ContractFunctionExecutionError, ContractFunctionRevertedError, ContractFunctionZeroDataError, HttpRequestError, TimeoutError, parseAbi } from 'viem';
import { describe, expect, it } from 'vitest';
import { baseRpcUrls, contractAnswered } from '../src/chain/viem';

const abi = parseAbi(['function factory() view returns (address)']);
const wrap = (cause: Error) => new ContractFunctionExecutionError(cause as never, { abi, functionName: 'factory', contractAddress: '0x00000000000000000000000000000000000000aa' });

describe('contractAnswered', () => {
  it('is true for a revert or no data (not a pool)', () => {
    expect(contractAnswered(wrap(new ContractFunctionRevertedError({ abi, functionName: 'factory', message: 'execution reverted' })))).toBe(true);
    expect(contractAnswered(wrap(new ContractFunctionZeroDataError({ functionName: 'factory' })))).toBe(true);
  });
  it('is false for HTTP errors and timeouts, even wrapped in ContractFunctionExecutionError', () => {
    expect(contractAnswered(wrap(new HttpRequestError({ url: 'https://mainnet.base.org', status: 429, body: {} })))).toBe(false);
    expect(contractAnswered(wrap(new TimeoutError({ body: {}, url: 'https://mainnet.base.org' })))).toBe(false);
    expect(contractAnswered(new Error('execution reverted'))).toBe(false);
  });
  it('lists every public node, BASE_RPC_URL first when set', () => {
    const prev = process.env.BASE_RPC_URL;
    delete process.env.BASE_RPC_URL;
    expect(baseRpcUrls()).toEqual(expect.arrayContaining(['https://mainnet.base.org', 'https://base-rpc.publicnode.com', 'https://base.llamarpc.com', 'https://base.drpc.org', 'https://1rpc.io/base']));
    process.env.BASE_RPC_URL = 'https://example.invalid/rpc';
    expect(baseRpcUrls()[0]).toBe('https://example.invalid/rpc');
    if (prev === undefined) delete process.env.BASE_RPC_URL;
    else process.env.BASE_RPC_URL = prev;
  });
});
