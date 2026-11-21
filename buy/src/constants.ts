import { parseAbi, type Address } from 'viem';

export const BASE_CHAIN_ID = 8453;
export const BASE_CHAIN_HEX = '0x2105' as const;

/** Tropa Club Builder Code (ACCOUNTS.md). */
export const TROPA_BUILDER_CODE = 'bc_vdp89s9b';

/** Public Base RPCs. publicnode allows 50k-block getLogs; mainnet.base.org runs eth_simulateV1 with B20 precompiles. */
export const DEFAULT_RPC_URLS = ['https://base-rpc.publicnode.com', 'https://mainnet.base.org'] as const;
export const DEFAULT_SIMULATE_RPC_URLS = ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'] as const;

export const USDC: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const WETH: Address = '0x4200000000000000000000000000000000000006';
/** KyberSwap sentinel for native ETH. */
export const NATIVE_ETH: Address = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
export const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

/**
 * USDC (FiatToken v2.2) keeps `balanceAndBlacklistStates` in mapping slot 9:
 * bit 255 = blacklisted flag, bits 0..254 = balance. Verified on Base Nov 22 2026
 * (eth_getStorageAt(keccak(holder, 9)) == balanceOf(holder)).
 */
export const USDC_BALANCE_SLOT = 9n;

/** Coinbase OracleRegistry (multiplier + pause flag the Chainlink feeds read). Verified ABI on Sourcify. */
export const ORACLE_REGISTRY: Address = '0x3f3E8cf41cdd3b1D118c16471aB0113DfDDd5CaD';
export const POLICY_REGISTRY: Address = '0x8453000000000000000000000000000000000002';

/** keccak256 of the scope names (docs.base.org/specifications/b20/reference/constants). */
export const POLICY_SCOPES = {
  TRANSFER_SENDER_POLICY: '0xb81736c875ab819dd97f59f2a6542cfb731ad52b4ae15a6f24df2fb02b0327f5',
  TRANSFER_RECEIVER_POLICY: '0x8a4b3fa2d8b921852bc0089c6ef0958aa6961897be36fd731330fe2cd23f8363',
  TRANSFER_EXECUTOR_POLICY: '0x10be5173aff2a44e748bd9acd8b19fe34689581398a9db7ba2fb671e786ff7d8',
} as const;
export type PolicyScopeName = keyof typeof POLICY_SCOPES;

/** Chainlink "Coinbase <TICKER>" total-return feeds on Base (docs.base.org list-tokenized-stocks), keyed by B20 token. */
export const STOCK_FEEDS: Record<string, { symbol: string; feed: Address }> = {
  '0xb200000000000000000000c2e324d24d7eecd1fb': { symbol: 'AAPLc', feed: '0x787f13dEa48Db0897CbCDD985de77809D837F988' },
  '0xb200000000000000000000d9192b6b456483c2e8': { symbol: 'AMZNc', feed: '0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295' },
  '0xb2000000000000000000002d0ba3164cc74f58b7': { symbol: 'GOOGLc', feed: '0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2' },
  '0xb2000000000000000000008bc8786b856e61707c': { symbol: 'METAc', feed: '0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D' },
  '0xb200000000000000000000ab99cfa739e253872b': { symbol: 'MSFTc', feed: '0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c' },
  '0xb2000000000000000000004884b426556b92883d': { symbol: 'MSTRc', feed: '0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a' },
  '0xb20000000000000000000078ee7ce2fe4908108c': { symbol: 'NVDAc', feed: '0x04689a41629776563E6822F76f2e57D148d28513' },
  '0xb200000000000000000000397293cb8cda9a10c5': { symbol: 'SNDKc', feed: '0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA' },
  '0xb2000000000000000000007b9fcbd005511acbd5': { symbol: 'SPCXc', feed: '0x6A634B235903C4ad6376892180d6fF8612e3Fa68' },
  '0xb2000000000000000000001e800a7f5189430cd0': { symbol: 'TSLAc', feed: '0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4' },
};

/** Handy token addresses for tests and the web app. */
export const TOKENS = {
  NVDAc: '0xb20000000000000000000078ee7ce2fE4908108C',
  SNDKc: '0xb200000000000000000000397293Cb8cda9a10c5',
  TSLAc: '0xb2000000000000000000001e800a7f5189430cD0',
  SPCXc: '0xb2000000000000000000007b9fcbd005511aCBd5',
  MSTRc: '0xb2000000000000000000004884b426556b92883d',
  GOOGLc: '0xb2000000000000000000002D0BA3164cc74f58B7',
} as const satisfies Record<string, Address>;

/** Chainlink crypto feeds on Base (8 decimals), used to value non-USDC inputs. */
export const ETH_USD_FEED: Address = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';
export const USDC_USD_FEED: Address = '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B';

/** Aerodrome Slipstream CL factories (pool.factory() of live B20 pools, plus the original factory). */
export const SLIPSTREAM_FACTORIES: Address[] = [
  '0x9CB220581b91b0C83223012FE69688b92aD07a76',
  '0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A',
];
export const SLIPSTREAM_TICK_SPACINGS = [1, 10, 50, 100, 200, 2000] as const;

export const ENTRYPOINTS: Record<string, 'v0.6' | 'v0.7' | 'v0.8'> = {
  '0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789': 'v0.6',
  '0x0000000071727de22e5e9d8baf0edac6f37da032': 'v0.7',
  '0x4337084d9e255ff0702461cf8895ce9e3b5ff108': 'v0.8',
};

export const KYBER_API = 'https://aggregator-api.kyberswap.com/base/api/v1';
export const KYBER_CLIENT_ID = 'tropaclub';
/** KyberSwap MetaAggregationRouterV2 on Base. The only contract a buy is ever sent to or approved for. */
export const KYBER_ROUTER: Address = '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5';
export const COINBASE_STOCKS_API = 'https://api.coinbase.com/v1/tokenized-stocks';

/** Guard: amountOutMin = mark x (1 - 1.5%). */
export const GUARD_BPS = 150;

export const b20Abi = parseAbi([
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
  'function uiMultiplier() view returns (uint256)',
  'function newUIMultiplier() view returns (uint256)',
  'function effectiveAt() view returns (uint256)',
  'function fromUIAmount(uint256 uiAmount) view returns (uint256)',
  'function toUIAmount(uint256 rawAmount) view returns (uint256)',
  'function policyId(bytes32 policyScope) view returns (uint64)',
  'function isPaused(uint8 feature) view returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Announcement(address indexed caller, string id, string description, string uri)',
  'event EndAnnouncement(string id)',
  'event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp)',
  'event UIMultiplierUpdateCancelled(uint256 cancelledMultiplier, uint256 cancelledEffectiveAt)',
]);

export const b20ErrorsAbi = parseAbi([
  'error PolicyForbids(bytes32 policyScope, uint64 policyId)',
  'error ContractPaused(uint8 feature)',
  'error InsufficientAllowance(address spender, uint256 allowance, uint256 needed)',
  'error InsufficientBalance(address sender, uint256 balance, uint256 needed)',
  'error InvalidReceiver(address receiver)',
  'error InvalidSender(address sender)',
  'error PolicyNotFound(uint64 policyId)',
  'error NonPayable()',
  // OpenZeppelin v5 ERC20 errors (some routers / tokens)
  'error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)',
  'error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)',
]);

export const oracleRegistryAbi = parseAbi([
  'function getOracleParams(address token) view returns (uint256 multiplier, bool paused)',
]);

export const policyRegistryAbi = parseAbi([
  'function isAuthorized(uint64 policyId, address account) view returns (bool)',
]);

export const aggregatorV3Abi = parseAbi([
  'function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)',
  'function decimals() view returns (uint8)',
  'function description() view returns (string)',
]);

export const clPoolAbi = parseAbi([
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function liquidity() view returns (uint128)',
  'function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)',
]);

export const clFactoryAbi = parseAbi([
  'function getPool(address tokenA, address tokenB, int24 tickSpacing) view returns (address)',
]);

/** KyberSwap MetaAggregationRouterV2.swap (selector 0xe21fd0e9). */
export const kyberRouterAbi = parseAbi([
  'struct SwapDescriptionV2 { address srcToken; address dstToken; address[] srcReceivers; uint256[] srcAmounts; address[] feeReceivers; uint256[] feeAmounts; address dstReceiver; uint256 amount; uint256 minReturnAmount; uint256 flags; bytes permit; }',
  'struct SwapExecutionParams { address callTarget; address approveTarget; bytes targetData; SwapDescriptionV2 desc; bytes clientData; }',
  'function swap(SwapExecutionParams execution) payable returns (uint256 returnAmount, uint256 gasUsed)',
]);

export const entryPointAbi = parseAbi([
  'struct UserOperationV6 { address sender; uint256 nonce; bytes initCode; bytes callData; uint256 callGasLimit; uint256 verificationGasLimit; uint256 preVerificationGas; uint256 maxFeePerGas; uint256 maxPriorityFeePerGas; bytes paymasterAndData; bytes signature; }',
  'struct PackedUserOperation { address sender; uint256 nonce; bytes initCode; bytes callData; bytes32 accountGasLimits; uint256 preVerificationGas; bytes32 gasFees; bytes paymasterAndData; bytes signature; }',
  'function handleOps(UserOperationV6[] ops, address beneficiary)',
  'function handleOps(PackedUserOperation[] ops, address beneficiary)',
  'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)',
]);
