# @tropaclub/buy

The buy engine for Tropa Club: quotes, the 1.5% guard, approve + swap calls with our ERC-8021 Builder Code, wallet send strategy, attribution checks, and `eth_simulateV1` dry runs on Base mainnet. It is viem-based, has no React, and never signs or sends anything.

```
npm i
npm run test:unit   # pure tests, no network
npm run test:live   # Base mainnet quotes + eth_simulateV1 (writes test/live/results.json)
npm run typecheck
```

## Builder Code suffix (ERC-8021, schema 0)

```
txData || codes (ASCII, comma-separated) || codesLength (1 byte) || schemaId 0x00 || 0x80218021802180218021802180218021
```

`bc_vdp89s9b` encodes to `0x62635f76647038397339620b0080218021802180218021802180218021` (29 bytes).

Sources:
- The ERC-8021 spec (eip.tools/eip/8021). Its test vector `0xdddddddd62617365617070070080218021802180218021802180218021` is unit-tested.
- docs.base.org/base-chain/builder-codes/app-developers. Base uses `Attribution.toDataSuffix` from `ox/erc8021`, and its example `bc_b7k3p9da` → `0x62635f62376b33703964610b00…8021` is unit-tested.
- We call ox's implementation directly.

The hex example on the docs.base.org Builder Codes overview page appears to put the length byte first. The spec, ox and the app-developers page all put it after the codes, and we follow them.

## API

| Function | What it does |
|---|---|
| `encodeBuilderSuffix(codes)`, `TROPA_SUFFIX`, `appendSuffix`, `parseSuffix` | Builds, appends and parses the ERC-8021 suffix. |
| `getQuote({ sellToken, buyToken, sellAmount, taker, sources? })` | Gets a quote from KyberSwap (`x-client-id: tropaclub`, no key needed). `sources` defaults to `'aerodrome'` (Kyber ids `aero-cl`, `aerodrome-cl-3`) and falls back to the best route. `'best'` uses any venue. LI.FI is the fallback provider. `sellToken` can be `'USDC'`, `'ETH'` or any address. |
| `guardMinOut({ token, quotedOut, sellToken, sellAmount }, { client })` | Returns `amountOutMin` (raw units), `uiShares`, `mark`, `quoteOk`, `reopenGapRisk` and `unitCheck`. |
| `computeGuardMinOut`, `checkMarkUnits` | Pure guard math and the units sanity check. |
| `isBuyable(token, { client, announcements? })` | Returns `{ buyable, reason, reasons, mark, reopenGapRisk, corporateActions }`. |
| `buildSwap(quote, { amountOutMin })` | Builds router calldata. It decodes Kyber's `minReturnAmount` and receiver and asserts both. |
| `buildBuyCalls({ quote, swap, currentAllowance? })` | Returns the approve and swap calls. Every call ends in the suffix. |
| `planSend(calls, from, capabilities)` | Returns a `wallet_sendCalls` request (with `capabilities.dataSuffix`) or sequential `eth_sendTransaction` requests. |
| `verifyAttribution(txHash, { client })` | Returns `{ attributed, codes, via: 'tx' \| 'userop' \| 'none', innerOnly? }`. Handles EntryPoint v0.6, v0.7 and v0.8 `handleOps` matched to `UserOperationEvent`. |
| `simulateBuy({ sellToken, buyToken, sellAmount })` | Runs the full approve + swap via `eth_simulateV1`, funding a throwaway address through USDC storage slot 9. Returns `amountOut`, gas, policy checks and a decoded revert. |
| `decodeRevert(data, message?)` | Turns a revert into one plain sentence. |
| `AnnouncementWatcher`, `fetchAnnouncementLogs`, `evaluateCorporateActions` | Corporate-action state for a token. |

## Guard

The mark is chosen in this order:
1. A fresh Chainlink feed: the 24/5 session is open and `updatedAt` is within 24 h 15 min.
2. Otherwise a fresh Coinbase `nav_price`.
3. Otherwise a 30-minute Slipstream USDC-pool TWAP, which sets `reopenGapRisk: true`.

Coinbase feeds report total return, which is the underlying price × multiplier. That makes the feed value USD per whole raw token. The conversion is mark → USD per share (mark / multiplier) → UI shares → raw units via `fromUIAmount`, which reduces to usdIn / mark. `checkMarkUnits` rejects a mark that is off from the DEX price by about the multiplier. That catches a guard that is 8× too loose or 8× too tight on SNDKc.

`isBuyable` returns false in these cases:
- The OracleRegistry pause flag is set.
- The token's TRANSFER feature is paused.
- The token and registry multipliers differ.
- A corporate action is open: an Announcement without an EndAnnouncement, a `:pre` notice without its final announcement, an API status of ANNOUNCED, or a scheduled multiplier change that isn't effective yet.
- There is no mark.
- The TWAP is more than 7.5% from the last close while the market is shut.

## Usage (web app)

```ts
import { createBaseClient, isBuyable, getQuote, guardMinOut, buildSwap, buildBuyCalls, planSend, USDC } from '@tropaclub/buy';
const client = createBaseClient();                           // server: reads + guard
const ok = await isBuyable(token, { client, announcements }); // announcements from the indexer
if (!ok.buyable) return showHold(ok.reason);
const quote = await getQuote({ sellToken: 'USDC', buyToken: token, sellAmount: 10_000_000n, taker: user });
const guard = await guardMinOut({ token, quotedOut: quote.amountOut, sellToken: USDC, sellAmount: 10_000_000n }, { client });
if (!guard.quoteOk || !guard.unitCheck.ok) return showHold('Price is outside the 1.5% guard.');
const swap = await buildSwap(quote, { amountOutMin: guard.amountOutMin });
const calls = buildBuyCalls({ quote, swap, currentAllowance, sellSymbol: 'USDC', buySymbol: ok.symbol });
const plan = planSend(calls, user, await provider.request({ method: 'wallet_getCapabilities', params: [user] }).catch(() => null));
// plan.kind === 'sendCalls' ? provider.request(plan.request) : for (const r of plan.requests) await provider.request(r) (wait for each receipt)
```

After the tx confirms, call `verifyAttribution(hash, { client })` on the server and store `attributed` for /stats.
