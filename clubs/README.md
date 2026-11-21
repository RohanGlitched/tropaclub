# @tropaclub/clubs

The clubs engine for Tropa Club. It covers:
- clubs and seats, with a free Bench seat;
- verified buys that promote a member to Playing;
- NYSE gameweeks, lineups and time-weighted returns;
- fixtures, the league, Supporters and preseason tables;
- pick-up matching, payday streaks and call-ups;
- /stats and the control cohort;
- EAS pennant calldata;
- the cost basis and P&L statement.

It is a server-only TypeScript library with no UI. It uses the Firestore Admin SDK, or an in-memory store with the same interface.

```
npm i
npm test                # memory store
npm run test:emulator   # same suites + firestore.rules on the Firestore emulator (JDK 21, no login)
npm run seed:demo       # demo clubs into the EMULATOR only (refuses otherwise)
npm run typecheck
```

## Wiring (Next.js API routes)
```ts
import { createProductionClubs, countryFromHeaders, ClubsError } from '@tropaclub/clubs';
const clubs = await createProductionClubs();   // cache one per server instance
```

### Environment
| Variable | Purpose |
|---|---|
| `GOOGLE_CLOUD_PROJECT` / `FIRESTORE_PROJECT_ID` | Firestore project. Defaults to `project-5523359e-5941-4df4-998`. |
| `BASE_RPC_URL` | Keyed Base RPC, tried first. The public RPCs are the fallback. |
| `ETHERSCAN_API_KEY` | Wallet history for the statement, and funding sources for pick-up clubs. Without it, history falls back to RPC. |
| `PICKUP_MATCH_SALT` | HMAC salt for the pick-up queue's country key. Required in production. |
| `GEO_BLOCKED` | Countries where buying is blocked. Default `US,PR,GU,VI,AS,MP,UM`. |
| `GEO_UNKNOWN` | What happens when no country header arrives: `allow` (default) or `block`. |
| `DATA_BASE_URL` | Where the indexer's public files live (`index.json` gives the token map and DEX prices). |
| `SITE_URL` | Base URL for invite and call-up links. |
| `TROPA_ATTEST_SEND=1` + `TROPA_ATTESTER_KEY` | The later server signer for pennants. Nothing sends without both. |

## Cron jobs (Cloud Scheduler → API route)
| When (ET) | Call |
|---|---|
| Every 15 min | `matchPickups()` |
| Hourly | `sweepTransfers()` catches missed attributed buys and member sells. |
| Each close: 16:00, or 13:00 on half days | `captureCutMarks()`, then `refreshMatchday()` |
| Mon 08:00 | `scheduleFixtures('GWn')` (none for GW0) |
| Fri, after the cut | `settleGameweek('GWn')`, then `planChampionPennants('GWn')` |
| Dec 1 onward | `planFoundersPennants()` (D+7 holders of GW0) |

`COHORT-METHOD.md` is the pre-registered control-cohort method.
