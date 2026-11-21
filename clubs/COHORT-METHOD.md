# Tropa Club control cohort: pre-registered method (v1)

**Status:** pre-registered. It is published on Mon Nov 23 2026, before any clubs data exists, and frozen from then on. Any later change goes in the deviation log at the bottom, with a date and a reason.
**Label on every chart and table:** *descriptive, not causal; joiners self-select.*
**Code:** `app/clubs/src/cohort.ts` (`heldAt`, `matchControls`, `bootstrapRatio`, `organicCandidates`, `subjectFromHistory`, `cohortReport`).

## Question
Do people who play GW0 in a Tropa Club club still hold their first stock-token buy a week later more often than comparable buyers who didn't use Tropa Club?

## Treated group: GW0 Playing joiners
- **Who counts:** wallets whose first qualifying Tropa buy falls inside GW0's buy window, Tue Nov 24 00:00 ET to Fri Nov 27 13:00 ET.
- **What a qualifying buy is:**
  - verified onchain with our ERC-8021 Builder Code;
  - signed by the member's own wallet;
  - worth $10 or more;
  - not part of a wash pattern (a buy, sell and buy of the same token within 24 h).
- **Excluded:**
  - Bench seats (no buy);
  - wallets on the public exclusion list (founder, test and contest wallets);
  - wallets whose first buy is under $10.
- **Their first buy:** token, raw amount, USD paid, and time t0.

## Baseline (a): organic first-time buyers, matched
- **Candidate pool:** from the indexer's replay state (`indexer-state/state.json.gz`), wallets that meet all of these:
  - their first DEX buy of the token falls in the same window;
  - their first buy of any stock token also falls in that window;
  - they are an EOA or smart wallet, not a contract;
  - they are not farmer-only (the indexer's rule);
  - they made no more than 50 swaps in 7 days (more means a bot);
  - they are not on the exclusion list;
  - they never used Tropa Club.
- **Sizing:** the exact first-buy USD and later balances come from each candidate's full history (Etherscan V2 `tokentx`/`txlist`, chain 8453). A first inbound with no visible payment is a transfer or airdrop, so that wallet is dropped.
- **Size filter:** the first buy must be $10–50.
- **Matching:**
  - same token;
  - nearest first-buy size by |ln(usd_control / usd_treated)|, capped at ln 1.5;
  - up to **3 controls per joiner**, without replacement;
  - processed in order of t0, then wallet, so the result is deterministic;
  - joiners with no match are counted and reported.

## Baseline (b): cashback-campaign recipients
- **Who counts:** wallets that claimed from the Merkl distributor (`Claimed(address user, address token, uint256 amount)`) for campaigns on Base stock tokens, within 14 days of the window.
- **Same buyer rules as (a):** a first-ever stock buy inside the same window, of $10–50.
- **To check on Nov 23, before the freeze:**
  - the distributor address and event signature;
  - which campaigns target stock tokens.

  Whatever we find is recorded here.
- **Comparison:** reported unmatched, as a second, separate comparison.

## Outcome
- **Held at D+k:** for the token of the first buy, the wallet's balance at t0 + k days minus its balance just before t0 is at least **50% of the raw amount of that first buy**. The same rule applies to every group.
  - This works in raw units, so splits and stock dividends (which change the ERC-8056 multiplier, not raw balances) can't move it.
  - A transfer to another wallet counts as not held. We can't tell a sale from moving tokens to the owner's other wallet, and the rule treats both groups the same way.
- **Primary outcome:** held at **D+7**.
- **Secondary, descriptive only:** D+1 and D+3, the W+1 repeat-buy rate, and the share of buyers with 2+ buys in the window.

## Statistic
- **Hold-rate ratio** = treated D+7 hold rate ÷ control D+7 hold rate.
- **95% CI:** percentile bootstrap.
  - 10,000 resamples with fixed seed `tropa-cohort-v1` (`tropa-cohort-v1-cashback` for baseline b).
  - Each group is resampled independently.
  - If the control rate is 0 in a resample, that resample is dropped. If it is 0 in the data, no ratio is reported.
- **Who is included:** only subjects whose t0 + 7 days has passed when the report runs.
- **What we report:** N for each group, both rates, the ratio, the CI, the number of joiners with no match, and the date.

## What would count as a result
- **The bar (SPEC v3.2):** the lower 95% bound is above 1.0×, on 100 or more GW0 Playing joiners.
- **Reporting:** we publish the numbers whatever they show, including a null result or a ratio below 1, on /stats and on X.
- **What a result does not mean:** clearing the bar is not evidence that clubs cause retention. People who choose to join may differ from people who don't, in ways we can't observe.

## Known limitations
- **Self-selection.** Matching on token, week and first-buy size removes only those differences.
- **Selling vs. moving.** A self-transfer to another wallet looks like a sale.
- **Baseline (b) coverage.** Merkl claimants miss cashback paid outside Merkl, and claims can lag the buy.
- **Valuation.** Raw-unit holding avoids multiplier effects. The first-buy USD of controls who paid in ETH uses Chainlink ETH/USD at that block.

## Deviation log
| Date | Change | Reason |
|---|---|---|
| (none yet) | | |
