# Duel Limbo — Consolidated Audit Overview

**Audit ID:** PF-2026-DL11 (single-sourced in `src/capture-plan.ts` AUDIT_ID) · **Auditor:** ProvablyFair.org · **Release:** `v1.2.0` · **Framework:** 1.1

Built August 2026. Dataset captured on **31 August 2026** (17:29–19:47 UTC) on production `duel.com`. Publication: 21 October 2026, release `v1.2.0`, the first public release of this repository. Audit report: https://audit.provablyfair.org/casino/duel/games/limbo/overview. This overview consolidates the package documentation; the machine-readable release identity remains in [RELEASE-MANIFEST.json](RELEASE-MANIFEST.json).

## Conclusion and scope

**PROVABLY FAIR — Full Pass** (30/30 scored steps, 0 flags, 0 hard fails; 43/43 unit tests). Every one of the 7,700 captured results reproduces from `(serverSeed, clientSeed, nonce)` with **exact equality** on the 6-dp lattice, with no tolerance.

Because Limbo's house edge lives in the backend win threshold rather than the multiplier, the audit **measures** the edge from the win/lose boundary of all 7,700 bets instead of assuming it: **0.0957%**, bracketed to **(0.073084%, 0.118281%]**, width 0.045 pp. The operator's declared distribution edge of **0.1%** lies inside the measured bracket: consistent. At the declared 0.1% floor edge, the edge on each of the 9,999,900 legal targets 1.01x … 100,000x, counted over all 2^32 draws and not sampled, lies between **0.1000000%** (36,099.45x) and **0.1023269%** (99,945.78x). No target is priced below the claim.

The **Zero Edge rakeback** is evidenced from the wallet ledger: 163 sampled bets each drew a separate rakeback credit of exactly **0.001 × stake** (Step 29), which offsets the **0.1% floor** edge on each sampled bet. All 7,700 captured bets sat at that floor (Step 20); the other 7,537 carry no wallet record.

**Open item:** Zero Edge's net 100% is evidenced only at the 0.1% floor. Under the config-implied rule (`limboConfig.json` of 2026-08-21) the edge rises once a bet's potential profit passes 25,000 (at 1,000×, a stake of about 25) and reaches 1% at the 250,000 maximum. If the rakeback stays at 0.001 × stake there, net RTP falls to about 99.1% at the ceiling. Whether it does is unverified ([DL-8](#declared-limitations-register)). The money model is set out in [Payouts and RTP](#payouts-and-rtp).

## Contents

- [Dataset and capture](#dataset-and-capture)
- [Game and algorithm](#game-and-algorithm)
- [Payouts and RTP](#payouts-and-rtp)
- [Verification results](#verification-results)
- [Reproduce the audit](#reproduce-the-audit)
- [Verify a bet](#verify-a-bet)
- [Evidence](#evidence)
- [Limitations and trust](#limitations-and-trust)
- [Terms](#terms)
- [Release history](#release-history)

## Dataset and capture

- **File:** `data/limbo-master.json`
- **SHA-256:** `b2db8685eeafde731152bd9770bf4df9872bda626b65b3412e29b067871365cc` (pinned in `src/loader.ts`; the suite aborts on mismatch)
- **Total bets:** 7,700, captured 31 August 2026 (17:29–19:47 UTC) on production `duel.com`
- **Seed chain:** 158 entries, 154 betting epochs of 50 bets; **every epoch that carries bets is revealed** (154/154; a closing rotation was run after the final bet), so 100% of bets are verifiable. Four zero-bet entries are unrevealed: the three phase-boundary intermediates below plus the terminal entry (the fresh epoch the closing rotation opened)
- **Configuration space:** 4,094 distinct targets from 1.01 to 998.37 (single-sided "over"); seeds rotated every 50 bets
- **Wins / losses:** 2,965 / 4,735 · staked $2,093.75 · returned $2,088.86 · realised RTP 99.7664% (variance illustration, not RTP evidence)
- **Wallet sampling:** every 47th bet recorded its full transaction envelope: 163 samples, each with stake leg, payout leg and the `zero_edge_rakeback_transaction`
- **Chain observation (capture artifact, not an operator defect):** at each of the three phase boundaries the capture rotates twice back-to-back (closing rotation + opening rotation). The capture rig reads each revealed seed from the round of the last bet placed (`GET /api/v2/user/transactions/{lastTxId}`, `capture/capture-auto.reference.js:446-449`), not from the rotate response. No bet is placed between the two rotations, so the second read returned the same transaction and recorded the same plaintext again (same `revealedFrom.transactionId` on entries 100 and 101, 141 and 142, 146 and 147). The three intermediate epochs (0-based entries 100, 141, 146 of the seed chain) carry **zero bets**, and the capture never retrieved their server seeds. Every commitment that a reveal was published for verifies by set membership (157/157, Step 1), all 158 next-seed promotions match (Step 2), and all **154 epochs that carry bets are revealed and fully reproduced** (Steps 3–5). The unrevealed zero-bet epochs affect nothing a player could have wagered on.

The verifier confirms the dataset hash before running any checks; tampering with the dataset causes `npm test` to fail at startup.

| Input | Identity |
|---|---|
| [data/limbo-master.json](data/limbo-master.json) | SHA-256 `b2db8685eeafde731152bd9770bf4df9872bda626b65b3412e29b067871365cc` |
| [limboConfig.json](limboConfig.json) | SHA-256 `676beff74f5a3c2e9d634a49e994acfc5adc0aa1a19fdc1ee4be36a916b07379`, pinned in `src/scaling-edge.ts` (CONFIG_SHA256) |

### Capture phases (executed exactly as planned — Step 14)

| Phase | Bets | Stake | Targets | Purpose |
|-------|------|-------|---------|---------|
| A | 5,000 | $0.0125 | log-uniform 1.01–1000 | Distribution, tail, config coverage |
| B | 2,000 | $0.0125 | fixed 1.01× | **House-edge precision** |
| C | 200 | $10 | fixed 1.01× | Stake independence |
| D | 500 | $0.0125 | log-uniform, custom client seeds (10) | Player-entropy variation |

Wagering $2,093.75; the game's 0.1% distribution edge priced the run at ~$2 expected, and the Zero Edge rakeback returned 0.001 × stake on every sampled bet. Realised net over the run: −$4.89 before rakeback, ordinary variance. Phase C carries $2,000 of the wagering at $10 stakes; phases A, B and D together are under $100. The capture rig is preserved as [capture/capture-auto.reference.js](capture/capture-auto.reference.js) (E05); its phase plan is mirrored in `src/capture-plan.ts`.

**Stated limitation of Phase C (decided 2026-08-20; achieved widths below).** At 200 bets and target 1.01× the high-stake bracket came out **0.2862 pp** wide against the main bracket's **0.0452 pp** (Step 16 prints both). The brackets overlap, consistent with a single stake-independent edge, but the test detects only a difference larger than ~0.29 pp; a subtler stake dependence would pass unnoticed. Accepted deliberately rather than adding wagering to narrow it, and stated rather than presented as a strong result. Step 16 also checks the price directly: 200/200 Phase C bets at $10 carry exactly the win_chance served to base-stake bets at the same target.

**Why Phase B is a low target.** The edge is applied to the win threshold, so it is measured from where wins flip to losses: a win at `(T,R)` gives `edge <= 1 − T/R`, a loss gives `edge > 1 − T/R`. The bracket closes only when a result lands near `T/(1−edge)`, and since `P(R >= x) = 1/x` the expected closest approach after `n` bets at target `T` is `~T/n`. Low targets therefore pin the edge roughly an order of magnitude faster than high ones.

Measured by `src/capture-power.ts` (`npm run power` → `outputs/capture-power.json`), which Monte-Carlos the plan against the real RNG over 1,500 simulated captures per row. Holding Phase B at 2,000 bets and varying only the target it is placed at:

| Phase B target | P(Step 9 PASS) | Width p50 | Width p95 |
|----------------|----------------|-----------|-----------|
| **1.01× (chosen)** | **78.3%** | 0.0573 pp | 0.1645 pp |
| 10× | 31.7% | 0.1430 pp | 0.3795 pp |
| 100× | 25.5% | 0.1713 pp | 0.4614 pp |

This is why the plan diverges from the Duel Dice phase structure, which uses a high-target Phase B for tail behaviour. Phase A still covers the full range.

**The width is a distribution, not a number.** Each side of the bracket is the gap to the nearest result near the threshold, ~Exp(mean `T/n`), so the width is Gamma(2, `T/n`): the plan's typical capture lands at 0.057 pp but the tail reaches past 0.3 pp, clearing the 0.10 pp Step 9 threshold on 78.3% ± 1.1% of simulated runs. The power artifact prices the design-time $0.01 stake ($2,075 wagered); the executed stake was $0.0125 after the pre-flight table-minimum finding. Stake does not enter the bracket, so the precision figures are unaffected. **The executed capture landed at 0.0452 pp**, near the distribution's median and inside the threshold, so Step 9 reports a PASS-grade measurement rather than a FLAG. The power analysis stays committed as the design rationale.

## Game and algorithm

The algorithm below is specified in [`docs/ALGORITHM.md`](docs/ALGORITHM.md), written from Duel's public pages, the standard provably-fair construction and the 7,700 live rounds, without Duel's code; each step there names its source. `src/rng.ts` implements that specification.

HMAC-SHA256, a single 32-bit draw per bet. The fair multiplier is `2^32 / (value + 1)`, truncated to 6 decimals, floored at 1.0. **No house edge is baked into the multiplier**: Duel applies the edge to the win threshold, not the payout curve.

```
key       = hexDecode(serverSeed)
message   = clientSeed + ":" + nonce
hmac      = HMAC-SHA256(key, message)                 // 64 hex chars = 32 bytes

value     = parseInt(hmac[0..8], 16)                  // first 4 bytes → uint32 (0..2^32−1)
result    = floor( 2^32 · 1e6 / (value + 1) ) / 1e6   // fair multiplier, 6-dp, exact integer arithmetic
                                                      // ≥ 1.000000 for every value, so a max(1.0, …) floor never binds

// House edge (backend): a bet at chosen target T wins iff
win       = result >= T / (1 - edge)
payout    = bet × T                                   // payout multiplier = chosen target
RTP       = T · winChance = T · (1 - edge)/T = (1 - edge)
```

The fair multiplier ranges from 1.000000 to 4,294,967,296×. The commitment is `SHA-256(hexBytes(serverSeed)) === serverSeedHashed`, as for other Duel originals. Limbo uses only the first 8 hex characters (one uint32): there is no rejection-sampling cursor loop, no modulo reduction and so no range-mapping bias (Step 23).

- **Source:** `src/rng.ts` was rebuilt from a written specification, [`docs/ALGORITHM.md`](docs/ALGORITHM.md), by an implementer who never opened Duel's code; Duel's published Verify-tab code is run as a second check, not used as the source. That code is the Verify-tab file pasted by Paulo from duel.com Verify tab 2026-09-26: `evidence/verify-tab/duel-verify-tab-limbo-2026-09-26.js` (E10, SHA-256 `be69447465682f2b5fd674ead1cd55eab6d9d89e26b8a5a46a0c600898d62bd1`), pinned in `src/operator-verifier.ts` and executed by Step 5 on every bet. Through v1.1.0 `src/rng.ts` was ported from it (v1.2.0 in the [release history](#release-history)). Duel's code computes the result in doubles, `Math.floor((2^32 / (value + 1)) * 1e6)`; `src/rng.ts` computes it in exact integers. The two forms were compared on every one of the 2^32 values of `value`: they differ on none. The earlier (2026-08-18) transcription is kept as exhibit E04, [evidence/algorithm-transcription-2026-08-18.md](evidence/algorithm-transcription-2026-08-18.md).
- **Second check against Duel's formula:** `tests/limbo/LimboTests.ts` runs **5,000 fresh random `(serverSeed, clientSeed, nonce)` cases** through Node's WebCrypto implementation of Duel's published verifier formula against `src/rng.ts` on every `npm test` (0 mismatches required). The specification's own vectors and properties run against `src/rng.ts` in `tests/limbo/RngSpecTests.ts` (118 checks).
- **Edge:** the effective edge is a backend parameter and was **measured, not assumed**: the win/lose boundary of all 7,700 captured bets brackets it to **(0.073084%, 0.118281%]**, point estimate **0.0957%**, width 0.045 pp (Step 9). The operator's declared 0.1% lies inside the bracket (Step 11).

### The operator file and the earlier transcription

The 2026-08-18 transcription quoted Duel's own comment: *"Fair result multiplier with no house edge baked in. The edge is applied by the backend to the win threshold (you win if result >= target / (1 - edge)), it never changes this result."* The Verify-tab file pasted on 2026-09-26 differs from the transcription in one respect that matters for the reader: it takes a `houseEdge` input and returns `afterEdge = max(1, floor(roll·(1−houseEdge)·1e6)/1e6)` ("the multiplier the bet is scored on … You win when it reaches the target you picked"), where the transcription applied the edge to the threshold (`result >= target/(1 − edge)`). At the per-bet declared edge (the floor 0.001 on every bet, Step 20) the two rules give the same win flag on 7,700/7,700 bets, and both equal the served flag on 7,700/7,700 (Step 5, reported, not scored). The file's `roll` equals the served result and `src/rng.ts` on 7,700/7,700. `tests/limbo/OperatorSourceTests.ts` still executes the transcription on all 7,700 bets (7,700/7,700 agree). Agreement with published code does not establish that the Verify button, or Duel's server, runs exactly this code.

### Seed lifecycle

Steps 1–3 check commitment opening, forward promotion and epoch binding. 157/157 revealed plaintexts open a commitment published at an earlier seed record (154 the immediately preceding one; 3 repeat the previous record's plaintext at the phase-boundary double rotation). 158/158 promotions are recomputed from operator fields, and 7,700/7,700 bets sit in the rotation window of the record whose commitment and client seed they carry. The client seeds were chosen by the capture rig: `Math.random()` strings for the 144 Phase A–C epochs and `'pfaudit' + Date.now().toString(36)` for the 10 Phase D epochs (DL-2, DL-3). Hash matching (Step 1) and the forward links (Step 2) are consistency checks: they show the seed records fit together, not when a commitment was shown, and a seed/commitment pair made after settlement would pass them too. Timing rests on the capture's own records: each client seed was set at a rotation after the capture had recorded that epoch's server-seed commitment as the outstanding next-seed hash, and every bet's capture time falls in the rotation window opened by the record that carries its commitment (Step 3, 7,700/7,700). That holds only as far as the capture is a faithful record of what Duel served, which this package assumes (DL-4).

## Payouts and RTP

### Money model — two layers (parity with the Duel Crash audit)

Confirmed from the live client on 2026-08-20, during the build. Duel's UI computes the win chance as `(1 − 0.001) / T`: an implied **0.1% distribution edge**, flat and target-independent across the whole range.

| Target | Win chance shown | Fair `1/T` | Implied edge |
|---|---|---|---|
| 1.01× | 98.9109% | 99.009901% | 0.1% |
| 2.00× | 49.95% | 50% | 0.1% |
| 10.00× | 9.99% | 10% | 0.1% |
| 1000.00× | 0.0999% | 0.1% | 0.1% |

The game is nonetheless badged **"Zero Edge"**, and that is not a contradiction. It is the same mechanism the Duel Crash audit documents:

1. **Settled payout on a win** = `bet × target`, no haircut at settlement.
2. **Separately**, under Duel's **Zero Edge** mechanism, a rakeback credit of `0.001 × bet` posted on each of the 163 sampled bets (every 47th bet: 158 at $0.0125 and 5 at $10, all at the 0.1% floor edge). The other 7,537 captured bets carry no wallet record, and no bet above the floor was placed (point 4).
3. **At the floor edge, where all 7,700 captured bets sat, net player RTP = 100.0% to one decimal, at the 0.001 × bet rakeback measured on the 163 samples.** The rakeback rate (0.001) is precisely `min_edge`, the declared 0.1% *floor* distribution edge, consistent with a rakeback sized to the floor. It offsets the declared floor exactly, not the counted edge: the RTP claim table (`outputs/rtp-claim-table.json`, counted over all 2^32 draws) puts the floor-edge RTP of every target below 1,000× (the captured targets run from 1.01× to 998.37×) at 99.899902% to 99.900000%, lowest in its 1.01×–2× bucket, so the net there is between 99.999902% and 100%. This is the regime the capture evidences (largest potential profit 12.47, about 2,000× below the 25,000 where scaling starts under the 2026-08-21 config).
4. **Above the floor, net 100% is an open item.** The distribution edge is *not* globally 0.1%: under the config-implied rule in [Scaling edge](#scaling-edge) (`limboConfig.json` of 2026-08-21) it rises from the `min_edge` floor (0.1%) once a bet's potential profit passes 25,000 (at 1,000×, a stake of about 25) and reaches the `max_edge` ceiling (1%) at the 250,000 maximum. The rakeback is **flat** at `0.001 × stake` on all 163 sampled bets, all of them floor-edge bets. If the rakeback stays at 0.001 × stake there, net RTP falls to about 99.1% at the ceiling (`1 − max_edge + 0.001`). Whether it does is unverified: the capture never leaves the floor, so it neither exhibits nor contradicts this, and a single wallet sample from a bet whose potential profit passes 25,000 would settle it. Marked as an open item (DL-8), not asserted.
5. **Above the daily Zero Edge cap**, by an operator disclosure that is not an exhibit in this package, the rakeback stops entirely and the distribution edge (floor or scaled) is the realised edge. Not evidenced here: the premise is ASSUMED in [Load-bearing premises](#load-bearing-premises), and this audit does not exercise above-cap behaviour.

**Points 1–3 are evidenced from the captured wallet ledger**: every 47th bet of the capture recorded its transaction envelope (163 samples in `data/limbo-master.json`), and every one drew a separate `zero_edge_rakeback_transaction` of **exactly `0.001 × stake`** (ratio 0.001000 on all 163, min == max). Settlement itself pays `stake × target` exactly on all 2,965 wins (Step 8, 0 payout errors). **Point 4** is conditional, not measured: the scaling rule is config-implied (`limboConfig.json`, `min_edge` 0.1% → `max_edge` 1%; [Scaling edge](#scaling-edge)), the flat rakeback is the 163-sample observation above, and the ≈ 99.1% figure is arithmetic from the two if the rakeback stays flat. The capture stays at the floor so it cannot itself show it, and the rakeback's behaviour at elevated edge is the single unverified premise. **Point 5** rests only on that operator disclosure, which no exhibit holds: the capture's largest potential payout (12.48) never approaches the cap. Floor-regime points were first confirmed at pre-flight ([evidence/preflight-2026-08-31.md](evidence/preflight-2026-08-31.md), E03) and confirmed at scale by the capture.

**One correction from the same pre-flight.** An earlier note in this repo recorded the bet response's `effective_edge` as `0`, read as the net edge after the rakeback. It is not: on all five pre-flight bets `effective_edge === house_edge_percentage === 0.1`. The rakeback is real; it simply is not what that field reports. The verifier records both fields and characterises neither; Step 11 scores against `house_edge_percentage` and says so.

**Consequence for the capture and the report.** The scored verifier measures the *distribution* edge from the win/lose threshold (Step 9) and must report it as such. Stating "0.1% house edge" without the rakeback layer would misdescribe the player's actual return, and stating "0% edge" would misdescribe the distribution. Both numbers are stated, with the cap named, as Crash does. The rakeback is **not** visible in the bet response, so the capture samples the wallet envelope at `/api/v2/user/transactions/{transaction_id}` every 47th bet, recording the stake and payout legs plus the `zero_edge_rakeback_transaction`, so the rakeback credit is evidenced rather than assumed. Coins and currency are different units and must not be mixed in the reconciliation.

### Scaling edge

`limboConfig.json` (recorded verbatim from `GET /api/v2/limbo/config` on 2026-08-21, SHA-256 pinned) declares `max_target` 100000.00 and a `scaling_edge` block: floor `min_edge` 0.1%, ceiling `max_edge` 1%, bankroll 25,000,000, max_loss_fraction 0.12. The duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET), saved unedited as [E12](#evidence), carries the same `max_target` and the same five `scaling_edge` values; a unit test checks its SHA-256 and that its `data` block equals `limboConfig.json`'s on every `npm test`. Both responses carry these values and no formula, and Duel's Verify tab (E10) says only that "the real round multiplier changes with the size of the bet and the scaling edge applied". Read as a cap on potential profit (bankroll × edge), these imply edge = stake × (target − 1) / 25,000,000, clamped to [0.1%, 1%]. The floor holds while a bet's potential profit is at most 25,000 (bankroll × min_edge). The 1% ceiling is reached at 250,000 (bankroll × max_edge), which is also the largest profit a bet can carry. bankroll × max_loss_fraction (3,000,000) never binds. This rule is config-implied and not audited. Step 20 recomputes the edge applied to every captured bet exactly from `target × win_chance`: **all 7,700 read 0.100000%, the floor**. The largest potential profit in the capture is 12.47, about 2,000× below where scaling starts.

Under that rule, by target (stakes are 25,000 and 250,000 divided by target − 1, rounded; implied by the 2026-08-21 config, not exercised by the capture):

| Target | 0.1% holds up to (stake) | 1% at max stake |
|---|---|---|
| 2× | 25,000 | 250,000 |
| 10× | 2,778 | 27,778 |
| 100× | 253 | 2,525 |
| 1,000× | 25 | 250 |
| 100,000× | 0.25 | 2.50 |

### Exact pricing of every legal target (Step 26)

At the declared floor edge, the winning draws for each of the 9,999,900 legal targets 1.01x … 100,000x are COUNTED over all 2^32 draws under the operator's own double formula (binary search on the non-increasing result map, `src/exact.ts`): edge min **0.1000000%** at 36,099.45x, max **0.1023269%** at 99,945.78x, 0 targets below the claim, 0 outside it at its printed precision (0.1%). The backend's `T/(1−e)` arithmetic is unpublished; the double and exact-rational readings give the same winning set on all 9,999,900 targets.

**RTP claim table, scored.** `outputs/rtp-claim-table.json` scores every target from 1.01× to 100,000× against a flat 99.9% claim from the game settings, one of the RTP-CLAIM rule's six places (game page, fairness page, help page, bet panel, rules, game settings): scaling_edge `min_edge` 0.001 in Duel's limbo config (E12), served on every captured bet as `house_edge_percentage` 0.1. The rule (RTP-CLAIM 1.2.0, Methodology v1.1) is switched on (decision D3, 14 October 2026): the outcome is scored on Step 26, the step carrying LIMBO-19, and a house-side miss would make the verdict RTP FIGURE OVERSTATED (exit 5), never NOT PROVABLY FAIR, because the draws themselves pass. The Zero Edge rakeback is noted, not tested (D3). Outcome: pass (true minimum 99.897673% at a 99,945.78× target, true maximum 99.900000%; 0 targets beyond the 0.1 pp band).

**Anti-circularity:** win probability is counted from the draw domain and the published win rule; the edge is measured from the win/lose boundary; operator fields (`house_edge_percentage`, `win_chance`) are compared, never read into a derivation (Steps 11, 12, 25).

### Simulation

- **Pass 1** (`src/simulate.ts`, rebuilt 2026-09-26): seeds derived from `SIM_MASTER_SEED`, so `npm run simulate` regenerates the pinned artifact byte-for-byte; 2,000,000-draw uniformity census (1,000 bins: chi-squared 986.69, df 999, p 0.6031; lag-1 serial z −0.844) and 13 targets (1.10x–100,000x) × 1,000,000 rounds, each compared in Step 18 with its EXACT win probability: worst |z| 1.56 (at 100x) against the family-wise critical value 3.403 (α 0.01 over 15 tests). Every statistic is re-derived in verify from the stored census. `outputs/rtp-convergence.html` shows realised RTP per target at n = 1,000 to 1,000,000.
- **Pass 2** (Step 19, computed in verify): 154 revealed epochs × 10,000 nonces; each 50-nonce window bets the targets the casino served in that epoch; the captured window is ranked among the 200 windows (exact permutation null). Rank-sum Z = 0.453 (one-sided p 0.6748; pre-registered rule fires at Z < −3.090); window 0 replays every captured result exactly.

**Live-bet RTP is not RTP evidence:** 99.7664% over 7,700 bets is a variance illustration only (DL-9); RTP evidence is Steps 18 and 26.

## Verification results

The verifier `tests/verify.ts` has **30 scored steps**. Every population is bound to a constant in `src/capture-plan.ts` (G-BIND), never to the dataset's own header. The committed run reports **30/30 PASS, 0 flags, 0 hard fails**. Results below are quoted from [outputs/verification-results.json](outputs/verification-results.json).

| Step | Check | Result |
|---:|---|---|
| 1 | Commit-Reveal Integrity (SHA-256 over hex bytes) | PASS: 157/157 revealed plaintexts open an earlier commitment; 154/154 betting epochs opened; 4 commitments never opened, as expected (the bet-less phase-boundary epochs and the final active seed) |
| 2 | Forward Commitment | PASS: 158/158 promotions recomputed from operator fields; chain adjacency 157/157 |
| 3 | Seed Coverage & Epoch Binding | PASS: 7,700/7,700 bets in the rotation window of the record whose commitment and client seed they carry; 154/154 epochs of 50, all revealed |
| 4 | Dataset Verifiability (100% of bets) | PASS: 7,700/7,700 bets sit under a revealed server seed |
| 5 | Result Determinism (exact equality) | PASS: 7,700/7,700 recomputed as integer 6-dp units by `src/rng.ts` (rebuilt from `docs/ALGORITHM.md`), 0 mismatches; Duel's Verify-tab code executed on every bet as a second check, not the source |
| 6 | Negative Control | PASS: nonce+1 changes the recomputed result; one 6-dp unit either side is rejected |
| 7 | Nonce Continuity | PASS: 154/154 epochs carry exactly nonces 0..49; 0 gaps, 0 repeats |
| 8 | Payout Math | PASS: 7,700/7,700 compared on the 1e-20 grid; 2,965 wins paid exactly amount × target; 0 payout errors |
| 9 | House Edge Measured from Win/Lose Boundary | PASS: (0.073084%, 0.118281%], 0.0957%, width 0.045196 pp against the 0.1 pp threshold |
| 10 | Win Condition | PASS: 7,700 settlements reproduced from the measured edge; 0 disagreements |
| 11 | Operator-Reported Edge Cross-Check | PASS: house_edge_percentage 0.1000% inside the measured bracket |
| 12 | Reported Win Chance vs Measured Bracket | PASS: 7,700 bets, 0 outside the admissible band |
| 13 | Dataset Integrity | PASS: dataset matches its pinned SHA-256 |
| 14 | Population & Phase Structure | PASS: A 5000/5000, B 2000/2000, C 200/200, D 500/500; 158/158 seed records |
| 15 | Target Coverage | PASS: 4,094 distinct targets from 1.01 to 998.37 |
| 16 | Bet-Size Invariance | PASS: brackets 0.0452 pp and 0.2862 pp overlap; 200/200 Phase C bets carry the base-stake win_chance |
| 17 | Client-Seed Variation | PASS: 500/500 Phase D bets under 10/10 auditor-set seeds; capture-origin seed weaknesses disclosed (DL-2, DL-3) |
| 18 | Simulation Pass 1 | PASS: chi2 986.69 (df 999), p 0.6031; lag-1 z −0.844; worst \|z\| 1.56 at 100x |
| 19 | Simulation Pass 2 | PASS: 154 × 10,000 nonces; rank-sum Z = 0.453 (p 0.6748); window 0 replays with 0 mismatches |
| 20 | Scaling Edge | PASS: all 7,700 at 0.100000%; largest potential profit 12.47 vs 25,000 = bankroll × min_edge, where the rule implied by `limboConfig.json` (captured 2026-08-21) lifts the edge off the floor (2,005x headroom); 1% ceiling at 250,000, also the largest profit a bet can carry; 3,000,000 never binds |
| 21 | Artifact Integrity | PASS: 5 artifacts and the operator config match their pins; 1,346 numeric leaves within declared domains |
| 22 | Client-Seed Influence | PASS: 0 of 7,700 kept the same result under a wrong seed (E = 2.549e-3, bound 1.255); empty-seed control 0 collisions |
| 23 | Draw Domain & Bias Bound | PASS: uint32 taken directly, no modulo or rejection, bias bound 0 |
| 24 | Result Range & Win Rule at the Declared Edge | PASS: 7,700/7,700 win flags equal the exact rule at e = 1/1000; 0 ties, 0 floor results |
| 25 | Win Probability per Served Target | PASS: 4,094/4,094 within the truncation bound of (1−e)/T; served win_chance equal to within one 1e-18 unit on 7,700/7,700 |
| 26 | Effective Edge on Every Legal Target | PASS: 9,999,900 targets, 0.1000000% to 0.1023269%, 0 below the claim |
| 27 | Target Bounds & Maximum Payout | PASS: 7,700/7,700 targets within [1.01, 100000]; largest potential profit 12.4671 vs the maximum profit 250,000; advertised maximum at the smallest stake 0.0125 × (100000 − 1) = 1,249.99 ≤ 250,000; the 250,000 maximum profit is implied by the config rule (`limboConfig.json`, captured 2026-08-21), not served as a field there |
| 28 | Phase A Target Coverage by Decade | PASS: [1,10) 1662, [10,100) 1693, [100,1000] 1645 (floor 50 each) |
| 29 | Wallet Envelopes | PASS: 163/163 envelopes; 163/163 rakebacks exactly 0.001 × amount |
| 30 | Live-Sample Fit (informational) | PASS: KS D = 0.01199, p = 0.2172; lag-1 r1 = −0.00262, z = −0.230 |

Steps 22–30 are the exact checks added 2026-09-26.

**Unit tests:** Mocha (`tests/**/*Tests.ts`), **43/43 pass**: engine vectors, Web Crypto parity with Duel's formula (5,000 fresh cases), payout formulas, scaling edge, the capture-plan guard, verifier self-tests on synthetic planted-edge datasets, the live-dataset reproduction, the specification's self-test (`tests/limbo/RngSpecTests.ts`: the 118 vector and property checks of `docs/ALGORITHM.md` §5 against `src/rng.ts`), and the second check against Duel's code (`tests/limbo/OperatorSourceTests.ts`: Duel's own Verify-tab file (E10) executed with only its "User input values" filled in on all 7,700 bets, roll = served result and `src/rng.ts` on 7,700/7,700, and on the first bet of each phase at houseEdge 0; the older 2026-08-18 transcription (E04) still reproduces 7,700/7,700).

### Fairness-integrity matrix (Framework S5-1 … S5-8)

S5: fairness-integrity matrix; game-integrity testing not commissioned.

Every row names the scored step or capture that decides it; a row nothing decides is **Not tested — disclosed**, never Pass. Figures are the committed `outputs/verification-results.json` of this package (30 scored steps).

<!-- S5-MATRIX:START -->

| Test ID | Category | What Was Tested | Expected Behaviour | Result | Finding Summary |
|---------|----------|-----------------|--------------------|--------|-----------------|
| S5-1 | Seed substitution | Can a revealed server seed be swapped for one the commitment did not bind? | A substituted plaintext fails `SHA-256(hex_decode(serverSeed)) == server_seed_hashed` for a commitment published earlier in the chain. | Pass | 157/157 revealed plaintexts open a commitment published at an EARLIER seed record (154 the immediately preceding one; 3 repeat the previous record's plaintext at the phase-boundary double rotation); 154/154 betting epochs opened; the 4 unopened commitments carry 0 bets. The forward chain holds on 157/157 links and 158/158 promotion records. [Step 1, Step 2] |
| S5-2 | Client-seed manipulation | Does the client seed genuinely enter the derivation? | A wrong or empty client seed must change the result except for chance collisions at the exact lattice rate. | Pass | 7,700/7,700 bets recomputed under a wrong client seed: 0 kept the same result (exact lattice rate E = 2.549e-3, bound 1.255); empty-seed control over 7,700: 0 collisions. Phase D: 500/500 bets under 10 auditor-set seeds recompute. [Step 22, Step 17, Step 5] |
| S5-3 | Stake-conditional outcome | Does a higher stake change the result or the price? | Stake must affect only `amount_won = amount × target`. | Pass | 200/200 Phase C bets at $10 carry exactly the win_chance served to base-stake bets at the same target (1.01x), recompute exactly, and pay exactly amount × target; 198 elevated-stake wins. The RNG takes no stake argument. [Step 16, Step 5, Step 8] |
| S5-4 | Server-seed cherry-picking | Did the operator pre-select server seeds unfavourable to the captured bets? | The captured window must be exchangeable with later windows of the same seed. | Pass, limited power | 154 revealed epochs × 10,000 nonces: the captured window's rank among 200 same-target windows gives rank-sum Z = 0.453 (exact permutation null, one-sided p = 0.6748; rule fires at Z < −3.090); captured window below its epoch median in 71 epochs, above in 83. Detects with ≥ 50% probability a cherry-pick placing ≥ 15.5% of epochs in their worst decile. Disclosed: Phase A–C client seeds came from `Math.random()` (not a CSPRNG) and Phase D seeds are predictable (DL-2, DL-3); per the capture's records, each seed was set after the capture had recorded its server-seed commitment (capture integrity assumed, DL-4; the hash checks of Steps 1–2 show consistency, not timing). [Step 19, Step 17] |
| S5-5 | Seed-rotation race (TOCTOU) | Can a rotation concurrent with an in-flight bet change the settling seed? | The settling seed is the one committed when the bet was accepted. | Not tested — disclosed | Limbo settles in one action; the single-session sequential capture never interleaves a rotation with an in-flight bet. Step 3 shows every captured bet sits in the rotation window of the commitment it carries, which bounds but does not test the race (DL-12). |
| S5-6 | Multiplier tampering | Can a win be paid at anything other than the chosen target? | `amount_won = amount × target` exactly; the 18-dp multiplier echo equals the target. | Pass | 7,700/7,700 bets compared as integers on the 1e-20 grid: 0 payout errors, 0 echo divergences, 0 requested/served target disagreements. Limbo has no multiplier table — the payout multiplier is the target. [Step 8] |
| S5-7 | Nonce manipulation | Can nonces be skipped, reused or reordered? | Every epoch carries exactly nonces 0..49 (declared base and size). | Pass | 154/154 epochs carry exactly 0..49, bound to `src/capture-plan.ts` NONCE_BASE / EPOCH_SIZE (not the dataset); 0 gaps, 0 repeats; no capture-retry gap declared. [Step 7] |
| S5-8 | Range-mapping bias | Does the digest-to-result mapping favour some results? | No modulo reduction, or rejection sampling with an exact whole number of ranges. | Pass (no reduction — bias 0) | The draw is the first 8 hex characters of the HMAC (a full uint32) used directly as `2^32/(value+1)` — no modulo, no rejection, bias bound 0. The per-target win probability is COUNTED over all 2^32 draws under the operator's own double formula (4,094 served targets within the truncation bound of (1−e)/T). [Step 23, Step 25] |

<!-- S5-MATRIX:END -->

Supplementary rows (not framework IDs):

| Test ID | Category | Result | Finding Summary |
|---------|----------|--------|-----------------|
| S5-D1 | Player-favourable target hunt | Pass | At the declared floor edge, all 9,999,900 legal targets 1.01x … 100,000x carry an edge between 0.1000000% (at 36,099.45x) and 0.1023269% (at 99,945.78x); 0 below the 0.1% claim. [Step 26] |
| S5-S1 | Multi-account isolation | Not tested — disclosed | Single account, single session (DL-11). |

## Reproduce the audit

Use **Node 22.x** (`engines` and `.nvmrc`). Run from this package's directory:

```sh
npm ci
npm test          # 43 unit tests + the 30-step verifier; expected: 30/30 PASS · PROVABLY FAIR — Full Pass
```

`npm ci && npm test` runs the 43 unit tests and the 30-step verifier against the committed artifacts: the dataset hash is checked at startup, every result is recomputed with exact equality, the edge is re-measured, every simulation statistic is re-derived from the pinned census, Pass 2 is recomputed from the dataset, and the run is field-diffed against `outputs/verification-results.json` (integers exact, other numbers within 1e-14 + 1e-12·max), writing only to `outputs/run/`. It does **not** run the simulation. **Expected `npm test` result:** 43 mocha + 30/30 scored steps · PROVABLY FAIR — Full Pass · Reproduction REPRODUCED. The exit code is the verdict: `0` Full Pass and reproduced; `1` a hard fail, or a reproduction difference beyond tolerance; `2` an operator-origin FLAG, `PROVABLY FAIR — Conditional Pass`; `5` `RTP FIGURE OVERSTATED`, no draw check failed but the RTP-CLAIM rule (1.2.0, switched on) found settings beyond the 0.1 pp band on the house side of the published figure (it outranks a Conditional Pass; a hard fail outranks it).

| Command | Purpose |
|---|---|
| `npm run verify` | The 30-step verifier alone (≈ 6 s) |
| `npm run test:full` | Regenerates the Pass 1 simulation into `outputs/run/` (pinned seeds), then mocha + verify, which diffs it against the pinned artifact |
| `npm run mutate` | Falsifiability battery: every scored step has a mutation that kills it |
| `npm run report` | `PF_EMIT=1`: refreshes the committed artifacts in `outputs/` (the only writer) |
| `npm run power` | Capture-plan power analysis (design artifact: why Phase B is a low target) |

No artifact of record carries run metadata; the runtime is recorded in `outputs/run/diff.json`. The artifacts of record pinned in `src/artifact-pins.ts` are `chi-squared-results.json`, `determinism-log.json`, `capture-power.json`, `rtp-convergence.html` and `simulation-results.json`; `limboConfig.json` is pinned in `src/scaling-edge.ts`, and so is `evidence/E12-limbo-config-2026-10-05.json`, the duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET), which a unit test checks and no scored step reads; its `.meta.json` is pinned in no source file, and only the release manifest records its hash. `outputs/verification-results.json` is compared field by field rather than hash-pinned.

**Falsifiability battery:** `npm run mutate` runs `tests/mutations.json` in a disposable copy; every scored step has at least one mutation that kills it: 37/37 mutations killed (36 against verify, 1 against mocha) on 2026-09-26, 30/30 scored steps covered, every kill confirmed by its expect marker; no declared survivors. Re-run 2026-09-26 after Duel's Verify-tab code was wired into Step 5: **42/42 killed** (41 against verify, 1 against mocha), 30/30 scored steps covered; the five added entries forge the operator file and re-pin it (M05c), edit it without re-pin (M05d), edit the runner without re-pin (M05e), forge the runner and re-pin it (M05f), and move a citation (M05g). The documentation consolidation did not rerun the battery. Re-run 2026-10-05 after the Step 20, 26 and 27 text changes: **42/42 killed** (41 against verify, 1 against mocha), 30/30 scored steps covered. For it `scripts/mutate.mjs` now copies `outputs/rtp-claim-table.json` into its disposable tree: without that file the baseline verify exited 1 ("committed table outputs/rtp-claim-table.json: ABSENT") and no mutation could be scored. Re-run again 2026-10-05 after exhibit E12 and its unit-test check were added: baseline verify and mocha exit 0 in the disposable copy, **42/42 killed** (41 against verify, 1 against mocha), 30/30 scored steps covered. Re-run 2026-10-14 on the tree carrying RTP-CLAIM 1.2.0 switched on: baseline verify and mocha exit 0 in the disposable copy, **42/42 killed** (41 against verify, 1 against mocha), 30/30 scored steps covered; the release manifest records this run. Second pass, 14–15 October 2026 (FIXPASS2 class C3, the exit-5 entries): see the release-history entry "14 October 2026 (second pass)". Re-run 2026-10-20 on the tree with `src/rng.ts` rebuilt from `docs/ALGORITHM.md` (M05b, M05g, M09c, M22 and M23 retargeted to it): **46/46 killed**, 30/30 scored steps covered; the release manifest records this run.

### Fresh-clone reproduction — measured 2026-09-27

`git clone git@github-pf:ProvablyFair-org/pf-duel-workspace.git` (package at games/limbo) into an empty directory, commit `6c85377` (origin/main at the time; this package as it stood after Duel's Verify-tab code was wired in `3fbacf4` and `.nvmrc` was added in `6c85377`), Node v22.23.1, npm 10.9.8:

| command | exit | result |
|---|---|---|
| `npm ci` | 0 | clean install from package-lock.json |
| `npm test` | 0 | 11.4 s; 43 passing, Passed 30/30, VERDICT: PROVABLY FAIR — Full Pass, Reproduction vs the committed artifacts on Node 22.23.1: REPRODUCED — compared: verification-results.json, determinism-log.json, chi-squared-results.json |
| `npm run test:full` | 0 | 28.7 s; 43 passing, 30/30, Full Pass, REPRODUCED — compared: verification-results.json, determinism-log.json, chi-squared-results.json, simulation-results.json; `outputs/run/diff.json`: runtime 22.23.1, reproduced true, 0 beyond tolerance |

`outputs/` (7 files outside `outputs/run/`) was hashed (SHA-256) before `npm test`, after it and after `test:full`: byte-identical both times, and `git status --porcelain` in the clone was empty after the run. Neither command rewrote an artifact of record. The earlier record (2026-09-26, commit `0c2c46c`, 41 passing) predates the Verify-tab wiring. Re-run the three commands above to repeat it.

## Verify a bet

1. **Save the commitment before you bet, then reveal the seed.** Before your first bet on a seed pair, copy the active server seed hash shown on duel.com → Provably Fair and keep that copy. After your bets, rotate your seed pair: the server seed you were playing under is revealed.
2. **Which fields to take from your bet.** `serverSeed` (revealed), `server_seed_hashed`, `client_seed`, `nonce`, `target`, `amount`, `win_chance`, and the served `result`, `is_win`, `amount_won`. Your bet's `server_seed_hashed` should equal the hash you saved in step 1.
3. **Check the commitment against your saved copy.** `SHA-256(hex_decode(serverSeed))` must equal the hash you saved before betting. The hash is over the seed's **bytes**, not its hex text. A PASS here means the two hashes are equal: the revealed seed is consistent with that commitment. A seed and commitment produced after the round would also match each other, so the assurance that the seed was fixed before your bets comes from your own copy saved before you bet, not from the match.
4. **Recompute the result.** `hash = HMAC-SHA256(key = hex_decode(serverSeed), message = client_seed + ":" + nonce)`; `value = parseInt(hash[0..8], 16)`; `result = floor((2^32 / (value + 1)) × 1e6) / 1e6`, minimum 1.0. It must equal the served `result` exactly.
5. **Check the win rule.** Take your bet's edge from its own fields: `e = 1 − target × win_chance`, rounded to 12 decimal places. The rounding removes the remainder the 18-dp `win_chance` leaves, which is at most `target × 10^-18` (at most 10^-13 up to the 100,000 `max_target`); left in, it can flip a result that lands exactly on the threshold. Step 20 does this for every captured bet: all 7,700 read 0.100000%, the 0.1% floor, so here `e = 0.001`. `is_win` must equal `result >= target / (1 − e)`; at the floor, exactly: `result_in_1e-6_units × 999 >= target_in_hundredths × 1000 × 10^4`. Under Duel's scaling edge a bet with a large potential payout can carry a higher edge ([Scaling edge](#scaling-edge)), so do not assume 0.001 for your own bet. In Duel's own Verify tab, enter the same `e` as `houseEdge`: the tab's "PF roll before edge" must equal the served `result` (it did on all 7,700 bets here), and its "Game result" (`afterEdge`) wins when it reaches your target, per Duel's own comment.
6. **Check the payout.** `amount_won = amount × target` on a win, `0` on a loss, exactly.

`src/rng.ts` (`computeMultiplier`, `verifyHash`) and `src/exact.ts` (`winMinUnits`) implement steps 3–5 and can be called directly. `winMinUnits(t, a, b)` takes the edge as `a/b`; for an edge rounded to 12 places, `a = e × 10^12` and `b = 10^12`. No ProvablyFair.org site verifier exists for Duel Limbo (DL-13).

## Evidence

Every exhibit this package relies on, numbered from E01, with its evidential role. Nothing outside this list is cited as evidence.

| # | Exhibit | What it is | Evidential role |
|---|---------|------------|-----------------|
| E01 | [data/limbo-master.json](data/limbo-master.json) | The frozen live capture of 31 August 2026 on duel.com: 7,700 bets, 158 seed records, 163 sampled wallet envelopes. SHA-256 `b2db8685eeafde731152bd9770bf4df9872bda626b65b3412e29b067871365cc`, pinned in `src/loader.ts`. | The audited population. Every scored step reads it; the loader aborts before any step on a hash mismatch (Step 13). |
| E02 | [limboConfig.json](limboConfig.json) | The operator's `GET /api/v2/limbo/config` response recorded verbatim on 2026-08-21: `max_target` 100000.00 and the `scaling_edge` block (floor 0.001, ceiling 0.01, bankroll 25,000,000, max_loss_fraction 0.12). SHA-256 pinned in `src/scaling-edge.ts` (CONFIG_SHA256). The duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET) carries the same `data` block (E12). | The legal target ceiling (Steps 26–27), the declared floor edge and the scaling thresholds it implies: 25,000 where scaling starts (Step 20) and the 250,000 maximum profit (Steps 20, 27). |
| E03 | [evidence/preflight-2026-08-31.md](evidence/preflight-2026-08-31.md) | Five live pre-flight bets and the endpoint shapes, recorded before the capture. | Witness of the request/response shape and of `win_chance = (1 − 0.001)/T` at 1.01x before the capture ran. |
| E04 | [evidence/algorithm-transcription-2026-08-18.md](evidence/algorithm-transcription-2026-08-18.md) (lines 9–16) | Duel's published Limbo verifier as TRANSCRIBED from duel.com → Provably Fair → Verify → Limbo on 2026-08-18. Not a byte copy of the Verify-tab file. Formerly `ALGORITHM.md` in the package root; moved unchanged on 4 October 2026. Lines 9–16 are the 2026-08-18 transcription. The Status section below them was kept as a working note until 2026-09-26. | Until 2026-09-26 the operator algorithm the former port in `src/rng.ts` cited line by line; superseded by E10 as the operator reference. Since v1.2.0 `src/rng.ts` is rebuilt from `docs/ALGORITHM.md` and cites no operator code. `tests/limbo/OperatorSourceTests.ts` still executes it on all 7,700 bets (7,700/7,700 agree). |
| E05 | [capture/capture-auto.reference.js](capture/capture-auto.reference.js) | The capture rig that placed the bets. | Discloses the client-seed generators (Math.random for A–C, `pfaudit`+timestamp for D) and the phase plan mirrored in `src/capture-plan.ts`. |
| E06 | [outputs/simulation-results.json](outputs/simulation-results.json) + [outputs/rtp-convergence.html](outputs/rtp-convergence.html) | Pass 1 on seeds derived from SIM_MASTER_SEED: 2,000,000-draw uniformity census, 13 targets (1.1x–100,000x) × 1,000,000 rounds. Pinned in `src/artifact-pins.ts`; regenerated byte-identically by `npm run simulate`. | Draw uniformity and RTP convergence (Step 18, re-derived from the census). |
| E07 | [outputs/capture-power.json](outputs/capture-power.json) | The capture-plan power analysis (1,500 simulated captures per row, fresh entropy). Pinned. | Design rationale for Phase B at 1.01x and for the Step 9 0.10 pp threshold. Not verdict-bearing. |
| E08 | [outputs/verification-results.json](outputs/verification-results.json) | This verifier's committed results (30 scored steps, profile labels). Refreshed only by `npm run report`. | The record every figure in this overview is quoted from; a plain run field-diffs against it. |
| E09 | [outputs/chi-squared-results.json](outputs/chi-squared-results.json), [outputs/determinism-log.json](outputs/determinism-log.json) | Run summaries of the win/lose chi-squared and the recomputation census, pinned. | Supporting records; no verdict depends on them alone. |
| E10 | [evidence/verify-tab/duel-verify-tab-limbo-2026-09-26.js](evidence/verify-tab/duel-verify-tab-limbo-2026-09-26.js) | Duel's own Limbo verification code, pasted by Paulo from duel.com Verify tab 2026-09-26 (duel.com → Provably Fair → Verify, game Limbo, code panel), saved verbatim and never edited. SHA-256 `be69447465682f2b5fd674ead1cd55eab6d9d89e26b8a5a46a0c600898d62bd1`, 2,763 bytes, 78 lines. Pinned with its runner (`verifier-parity/operator/run-operator-verifier.cjs`) in `src/operator-verifier.ts`. | The operator code Step 5 and `tests/limbo/OperatorSourceTests.ts` EXECUTE as a second check (only its four "User input values" filled in) on all 7,700 bets: roll = served result and `src/rng.ts` on 7,700/7,700 (LIMBO-09). Not the source of `src/rng.ts`, which is rebuilt from `docs/ALGORITHM.md`; through v1.1.0 `src/rng.ts` was ported from this file and cited 8 of its lines. Supersedes E04 as the operator reference. |
| E12 | [evidence/E12-limbo-config-2026-10-05.json](evidence/E12-limbo-config-2026-10-05.json) + [its .meta.json](evidence/E12-limbo-config-2026-10-05.json.meta.json) | The duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET): the `GET /api/v2/limbo/config` response body, fetched 12:16:21 UTC and saved unedited: 168 bytes, SHA-256 `ce36245867f930f5587e4ca71d4e2ace5c082dd660c4c6574c888f8fa162eb18`. It carries `max_target` "100000.00" and the `scaling_edge` block (enabled true, bankroll "25000000", max_edge "0.01", min_edge "0.001", max_loss_fraction "0.12"). The `.meta.json` beside it (SHA-256 `b27f4a9588b68d8e4d01b2a7b443ed2e23ad77f17df3dad9c149adebb8ad5136`) records the request path, HTTP status 200, the response headers and the fetch time. The `.json` is pinned in `src/scaling-edge.ts` (CONFIG_2026_10_05_SHA256); the `.meta.json` is pinned in no source file. The release manifest records both hashes. | Shows that the duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET) carries, value for value, the config E02 records: its `data` block equals E02's, checked by `tests/limbo/ScalingEdgeTests.ts` on every `npm test`. No scored step reads it; the scored steps read E02. |

E11 is unassigned: no exhibit carries that number. The release manifest also records the SHA-256 of `outputs/rtp-claim-table.json`, which `src/rtp-settings.ts` pins, and of both E12 files.

## Limitations and trust

### Load-bearing premises

Every premise the verdict rests on, its witness artifact, and whether the captured data could have contradicted it. A "no"/"partial" premise must carry a witness from outside the repo's own pipeline; "our checks agree with each other" is not evidence for a premise the data cannot see.

| Premise | Witness artifact | Could the captured data contradict it? |
|---------|------------------|----------------------------------------|
| RNG: HMAC-SHA256, hex-decoded key, `clientSeed:nonce`, first-uint32 → `2^32/(value+1)` | `data/limbo-master.json` | yes — 7,700/7,700 results reproduce with exact equality (Step 5) by `src/rng.ts`, rebuilt from `docs/ALGORITHM.md`; it is also checked against Node's WebCrypto implementation of Duel's published formula on every test run (5,000 fresh cases) |
| Edge applied to the win threshold, `result >= T/(1−edge)` | `data/limbo-master.json` | yes — the measured bracket (Step 9) and 7,700/7,700 settlement reproductions (Step 10) both derive from it |
| Threshold comparator is `>=` rather than `>` | ASSUMED — a result exactly equal to `T/(1−edge)` at 6-dp precision occurs with probability ≈ 1e-6 per bet and none occurred in 7,700; the two readings differ only on that measure-zero event and shift the measured bracket by < 1e-6. Taken from Duel's published verifier comment | no |
| Payout = `stake × target`, no haircut | `data/limbo-master.json` | yes — 7,700 bets, 0 payout errors (Step 8) |
| Zero Edge rakeback = flat `0.001 × stake` per bet (= `min_edge × stake`) | `data/limbo-master.json` (163 sampled wallet envelopes) | yes — ratio exactly 0.001000 on all 163 samples (min == max) — but every one of the 163 was a floor-edge bet |
| If the rakeback stays at `0.001 × stake` above the floor, net RTP falls below 100% there (about 99.1% at `max_edge`) | the config-implied rule in [Scaling edge](#scaling-edge) + the flat-rakeback observation; the ≈ 99.1% figure is arithmetic (`1 − max_edge + 0.001`) | **PARTIAL / OPEN ITEM** — the edge rule is config-implied and the rakeback is observed flat, but only at the floor edge; whether the rakeback stays at 0.001 × stake once a bet's potential profit passes 25,000 (2026-08-21 config) is NOT witnessed by the capture. One wallet sample from such a bet would confirm or overturn it. Stated as conditional, not asserted |
| Scaling-edge schedule: capture sits at the floor | `data/limbo-master.json` + `limboConfig.json` | yes — the per-bet identity `edge = 1 − target × win_chance` (exact up to the API field's 18-dp representation: the remainder is below 10⁻¹⁵ on all 7,700, far inside Step 20's 10⁻⁹ tolerance) reads 0.1% on all 7,700 (Step 20); behaviour above the 25,000 scaling onset (2026-08-21 config) is NOT exercised and is stated as unaudited |
| Rakeback continues to the daily Zero Edge cap | ASSUMED — operator-disclosed, not an exhibit in this package; the capture never approaches the cap | no |
| `effective_edge` response field semantics | ASSUMED — recorded verbatim (0.1 on all bets, equal to `house_edge_percentage`), not interpreted; Step 11 scores only `house_edge_percentage` | no |

### Declared limitations register

What this audit does not establish.

| # | Limitation | Magnitude (measured) | Why it is not closed here |
|---|---|---|---|
| **DL-1** | **The win-rule tie and the 1.00x floor are unwitnessed.** No captured result lies exactly on its threshold, and none sits at the 1.000000 floor. | Step 24 census: 0 ties, 0 floor results in 7,700; the floor has probability 2^-32 per bet. The `>=` comparator rests on Duel's published comment (E04, the 2026-08-18 transcription). The floor loses at every legal target by arithmetic. | A tie can only occur where 999 divides the target in hundredths; a witness needs an operator-verifier probe this engagement did not run. |
| **DL-2** | **Phase A–C client seeds came from `Math.random()`, not a CSPRNG** (`capture/capture-auto.reference.js:375-378`). | 144 epochs. | Capture-origin (decision-13): disclosed, never held against the operator. Per the capture's records, each seed was set at a rotation after the capture had recorded its server-seed commitment as the outstanding next-seed hash; that order rests on capture integrity (DL-4), and Step 2's hash equality is a consistency check, not timing. |
| **DL-3** | **Phase D client seeds are predictable in shape:** `'pfaudit' + Date.now().toString(36)` (`capture/capture-auto.reference.js:473,494`). | 10 of 10 Phase D seeds, 10 epochs, 500 bets. | Capture-origin; enumerated by Step 17. |
| **DL-4** | **The commitment chronology rests on the capture alone.** Hash matching (Step 1) and the forward links (Step 2) are consistency checks; a SHA-256 digest carries no time, and a seed/commitment pair made after settlement would pass them too. That each commitment was shown before its epoch's bets rests on the capture's recorded pre-bet observations: the rig recorded each epoch's active commitment from the rotate response before that epoch's first bet, and Step 3 places every bet in the rotation window of the record that carries its commitment. This holds only as far as the capture is a faithful record of what Duel served; the package assumes capture integrity and does not test it. | The whole capture. | Needs an independently timestamped commitment log. |
| **DL-5** | **Trailing withholding inside an epoch is invisible** to a client-side capture. | Not quantifiable from this capture. | Needs an operator-side round log. |
| **DL-6** | **The edge is measured and priced at the FLOOR only.** Every captured bet sits at the 0.1% floor; the scaled edge between floor and ceiling follows the config-implied rule in [Scaling edge](#scaling-edge) (`limboConfig.json` of 2026-08-21), not exercised. | Largest potential profit 12.47 vs 25,000, where scaling starts. | Needs high-exposure bets. |
| **DL-7** | **The backend threshold arithmetic is unpublished.** Steps 24–26 evaluate `result >= T/(1−e)` exactly; the backend may compute it in doubles. | On all 9,999,900 legal targets the two readings give the same winning set (Step 26); every captured flag agrees with the exact rule (Step 24). | Only operator source would close it. |
| **DL-8** | **Whether the Zero Edge rakeback scales with the per-bet edge** is unwitnessed (see [Money model](#money-model--two-layers-parity-with-the-duel-crash-audit), point 4). | 163/163 sampled rakebacks are exactly 0.001 × stake, all at the floor (Step 29). | The capture places no bet above the floor and this release adds none, so it ships as an open item. One wallet sample from a bet whose potential profit passes 25,000 (2026-08-21 config) would close it. |
| **DL-9** | **Live-bet RTP is not RTP evidence.** | 99.7664% over 7,700 bets. | Variance illustration only; RTP evidence is Steps 18 and 26. |
| **DL-10** | **CLOSED (2026-09-26).** This row said the operator algorithm was a transcription (formerly `ALGORITHM.md`, 2026-08-18, now exhibit E04), not a byte copy. Paulo pasted Duel's Limbo Verify-tab code from duel.com on 2026-09-26: `evidence/verify-tab/duel-verify-tab-limbo-2026-09-26.js` (E10, SHA-256 `be69447465682f2b5fd674ead1cd55eab6d9d89e26b8a5a46a0c600898d62bd1`), pinned in `src/operator-verifier.ts` and executed by Step 5 and the unit tests with only its four "User input values" filled in, as a second check: since v1.2.0 `src/rng.ts` is rebuilt from `docs/ALGORITHM.md`, not from this file (through v1.1.0 it was ported from it and cited 8 of its lines). Its `roll` equals the served result on 7,700/7,700. The file's one material difference from the transcription is set out in [Game and algorithm](#the-operator-file-and-the-earlier-transcription). | 7,700/7,700 rolls agree; win flag by `afterEdge >= target` = served on 7,700/7,700. | Closed for the published code. Not established: that the Verify button, or Duel's server, runs exactly this code. |
| **DL-11** | **Dataset provenance and scope:** one account, one currency, one window. | 7,700 bets. | Needs an independent second-party capture. |
| **DL-12** | **Untested adversarial surfaces:** mid-round rotation race, multi-account correlation, account/session-state dependence, selective bet rejection, server-seed custody. | Not quantified. | Each needs a capture design this engagement did not run. |
| **DL-13** | **No ProvablyFair.org site verifier exists for Duel Limbo.** | — | The docs-site and live verify-bets carry no limbo module (checked 2026-09-26). |
| **DL-14** | **Corrected 2026-09-26: the "serial independence" line on the win/lose stream printed the lag-1 CORRELATION r1 = 0.6215 under the label "z" with a \|z\| < 3 threshold.** z = r1·√n = 54.53: the win/lose stream is strongly dependent — by the phase design (Phases B and C bet 1.01x and win ~99%), not by the RNG. The old simulate.ts `lag1Z` fields were likewise r1, not z. | Informational line only; no scored step read it. | The RNG serial screens are now Step 18 (2,000,000 draws, z −0.844) and Step 30 (1/R in capture order). |

## Terms

**Fair multiplier (result):** `2^32 / (value + 1)` floored to 6 decimals, minimum 1.0; it carries no house edge. **Target:** the multiplier the player picks; a win pays `amount × target`. **Distribution edge:** the edge the backend applies to the win threshold, `result >= T/(1−edge)`. **Floor and ceiling edge:** `min_edge` and `max_edge` of the operator's `scaling_edge` config. **Zero Edge rakeback:** a separate wallet credit under Duel's Zero Edge mechanism; in this capture, 0.001 × stake on each of the 163 sampled bets. **Bracket:** the interval the edge must lie in, closed by the nearest win and loss to the threshold. **Epoch:** one server-seed lifecycle; here 50 bets. **Nonce:** the round counter within an epoch. **Commit-reveal:** the operator publishes `SHA-256` of the server seed before play and reveals the seed on rotation. **RTP:** expected or observed return divided by stake; this overview labels which one is meant.

## Release history

| Release | What changed | Verdict |
|---------|--------------|---------|
| `v1.0.0` | The original audit. | PROVABLY FAIR — Full Pass |
| `v1.1.0` (never tagged) | Re-certification under Framework 1.1, October 2026, below. The dataset of record is unchanged. Its changes ship in v1.2.0. | unchanged |
| `v1.2.0` | The RNG rebuilt from a written specification instead of ported from Duel's code; Duel's code kept as a second check. Below, "20 October 2026". A fresh release: one squashed commit starts its public repo ("21 October 2026" below). | unchanged |

### v1.1.0 — what changed

Never tagged or released on its own; these changes ship in v1.2.0.

- **Scored steps: 21 in v1.0.0, 30 now.** The verdict is unchanged, PROVABLY FAIR — Full Pass. The dataset of record is byte-identical to v1.0.0. New: Client-Seed Influence, Draw Domain & Bias Bound, Result Range & Win Rule at the Declared Edge, Win Probability per Served Target, Effective Edge on Every Legal Target vs Claim, Target Bounds & Maximum Payout, Phase A Target Coverage by Decade, Wallet Envelopes, and Live-Sample Fit (informational).
- **Simulation Pass 1 runs from pinned seeds.** v1.0.0 ran it from fresh seeds; `outputs/rtp-convergence.html` now shows realised RTP per target at n = 1,000 to 1,000,000, so its figures differ from v1.0.0.
- **RTP claim table, scored.** `outputs/rtp-claim-table.json` scores every target from 1.01× to 100,000× against a flat 99.9% claim (`min_edge` 0.001 in Duel's game settings, served on every bet as house_edge_percentage 0.1); under RTP-CLAIM 1.2.0, switched on, the outcome is scored on Step 26. Outcome: pass (true minimum 99.897673% at a 99,945.78× target, true maximum 99.900000%).
- **Added:** `.nvmrc` (Node 22) and `RELEASE-MANIFEST.json` (written by `scripts/release-manifest.mjs`); the mutation battery (`tests/mutations.json`) grew from 3 entries to 42.
- **Correction: the phase-boundary double reveal.** v1.0.0 attributed the repeated reveal at each phase-boundary double rotation to the operator, saying Duel revealed the same retiring seed on both rotations. The capture rig reads each reveal from the last bet's round, not from the rotate response, so the repeat is the rig's ([Dataset and capture](#dataset-and-capture)). No step, figure or verdict changes.
- **Correction: the remainder of `edge = 1 − target × win_chance`.** v1.0.0 bounded it at ≤2e-16; on the captured bets it reaches about 5 × 10⁻¹⁶, so the scaling-edge premise row now says below 10⁻¹⁵. Step 20 tolerates 10⁻⁹, so its result is unchanged.
- **Scaling-edge thresholds (final pass, 5 October 2026).** Steps 20 and 27 now compare a bet's potential profit, stake × (target − 1), with the thresholds the config implies: 25,000, where the edge leaves the 0.1% floor, and 250,000, the 1% ceiling and the largest profit a bet can carry. The capture's largest potential profit is 12.47. v1.0.0's Step 20 compared the largest potential payout (12.48) with the 3,000,000 max-loss limit, which never binds under that rule. The floor-to-ceiling rule is stated as config-implied rather than unpublished, and every scaling-edge threshold is scoped to the 2026-08-21 config; Step 26's scope note now says the same. The net-100% finding is restated as an open item (DL-8). No step result changed; `outputs/verification-results.json` was re-emitted by `npm run report`. The verifier console prints the RTP at the declared edge, 99.897673%–99.900000%, instead of 1 − the measured midpoint.
- **Config response of 5 October 2026 added (E12).** The duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET), the `GET /api/v2/limbo/config` response body, is saved unedited as exhibit E12, with its fetch metadata. It carries the same `max_target` and `scaling_edge` values as the 2026-08-21 record (E02); a unit test checks its SHA-256 and that equality, and the release manifest records both files' hashes. E02 remains the config the verifier reads. No step result, figure or verdict changed; `outputs/verification-results.json` was re-emitted by `npm run report` because the exhibit list in the profile-coverage note changed. The mutation battery was re-run after E12 and its unit-test check were added: 42/42 killed.
- **Audit ID and the open item (5 October 2026).** The audit is assigned **PF-2026-DL11**, single-sourced in `src/capture-plan.ts` AUDIT_ID and carried in `outputs/verification-results.json`, the README, this overview and `RELEASE-MANIFEST.json`. The release ships without a bet above the 0.1% floor: whether the Zero Edge rakeback stays at 0.001 × stake once a bet's potential profit passes 25,000 remains open item DL-8, and E11 is unassigned. No step result, figure or verdict changed; `outputs/verification-results.json` was re-emitted by `npm run report` for the audit ID and the reproduction-coverage note (LIMBO-28, now full).
- **Commitment timing (5 October 2026).** Hash matching (Step 1) and the forward links (Step 2) are now described as consistency checks only. That each commitment was shown before its bets is attributed to the capture's recorded pre-bet observations, conditional on capture integrity, which the package assumes (DL-4; also the seed lifecycle, DL-2, the S5-4 row and the Step 17 detail). Verify a bet now tells the player to save the commitment shown before betting and to compare the revealed seed against that saved copy. No step result, figure or verdict changed; `outputs/verification-results.json` was re-emitted by `npm run report` for the Step 17 detail.
- **Rakeback scope and release-history corrections (6 October 2026).** The Zero Edge rakeback is now stated at the scope it was measured: 0.001 × stake on each of the 163 sampled wallet envelopes (158 at $0.0125 and 5 at $10, all at the 0.1% floor edge). Point 2 of the money model said it posts on every bet, and the conclusion and the README said it offsets the floor edge on every captured bet. Point 3 now says the rakeback offsets the declared floor exactly but not the counted edge: below 1,000× the RTP claim table puts the net between 99.999902% and 100%. Point 5, the stop above the daily Zero Edge cap, now says it rests on an operator disclosure that is not an exhibit (ASSUMED in the premise table); the Terms entry is scoped the same way. The **Added** line above no longer lists 2 Markdown report files: v1.0.0 has README.md, MANIFEST.md and ALGORITHM.md at the root, and this draft has README.md and MANIFEST.md, with ALGORITHM.md moved to `evidence/`, so no Markdown file is added. The line predates the 4 October consolidation, which removed `evidence.md` and `exploit-testing.md`. The comments in `tests/steps/commitment.ts` now describe Steps 1–2 as consistency checks, as the 5 October entry says; no step code or detail string changed. No step result, figure or verdict changed, and no output was re-emitted.

### 4 October 2026 — consolidated documentation

The five Markdown files in the package root were reduced to **README.md and this MANIFEST.md**. Two evidence records remain as files under `evidence/`: the pre-flight record (E03), unchanged, and the 2026-08-18 algorithm transcription (E04). Repeated explanations were removed; the dataset, config, evidence files, algorithm and settlement logic were retained, and every finding, premise, limitation (DL-1 … DL-14), exhibit (E01–E10) and verification result was carried over. The transcription, formerly `ALGORITHM.md`, moved unchanged to `evidence/algorithm-transcription-2026-08-18.md`; the unit test that executes it reads it there. Documentation references in the profile-coverage map now point to the retained sections, and `outputs/verification-results.json` was re-emitted with those references; no step result changed. Dependent release hashes were refreshed. No new casino capture, simulation regeneration or mutation campaign is asserted for this update.

### 14 October 2026 (second pass) — an RTP miss ends RTP FIGURE OVERSTATED (FIXPASS2 class C3)

No verdict, scored step status, figure or artifact changed.

- **Exit-5 mutations.** `scripts/mutate.mjs` gained `regen` (in the disposable copy: the RTP table rewritten by `src/rtp-settings.ts` and re-pinned, then the committed record re-emitted with `PF_EMIT=1`), `expectExit` (an entry counts as killed only when the run also ends with that exit code) and runner `test` (mocha, then the verifier, as `npm test` runs them). New entries: MC3a (the winning threshold of target 5000.00× raised 1 % in `src/exact.ts`: 98.910881 %) and MC3b (the claim raised to 100.1 %), each with the table and record regenerated and expected to end RTP FIGURE OVERSTATED, exit 5. MC3as and MC3bs make the same changes without regenerating the table and are expected to end exit 1: a committed RTP table that differs from the run, or from its pin, is a reproduction failure, miss or no miss.
- **Battery (Apple M2 Max, 12 cores, Node v22.23.1).** The whole registry (46 entries) in one `npm run mutate` on this tree, 14 October 2026 evening (baseline green): 46/46 killed, 30/30 scored steps covered. On 15 October `--only` (now taking several comma-separated substrings) reran the four C3 entries and every entry naming Step 26, the RTP-claim step (M26, MC3): 5/5 killed; MC3a and MC3b ended `VERDICT: RTP FIGURE OVERSTATED`, exit 5; MC3as and MC3bs exit 1 with the committed table reported as differing from the run.

### 14 October 2026 — Methodology v1.1

No draw check, scored step status, figure or verdict changed. The dataset and the artifacts pinned in `src/artifact-pins.ts` are unchanged; the RTP-claim table, pinned in `src/rtp-settings.ts`, was rewritten and re-pinned (below).

- **Framework 1.1.** The audit is re-certified under ProvablyFair.org Framework 1.1 (decision D1); the release manifest's `framework` field and the release row above say 1.1.
- **RTP-CLAIM 1.2.0, switched on.** `src/rtp-claim.ts` is the framework's rule 1.2.0, byte-identical to `core/rtp-claim.ts` (SHA-256 `c9a9c1c4…5f131c`), and `src/rtp-claim-switch.ts` is set to true (decision D3). The outcome is scored on Step 26 (LIMBO-19): a house-side miss would be an operator-origin FLAG on that step and the verdict RTP FIGURE OVERSTATED, exit 5, never NOT PROVABLY FAIR. The claim source now names its place, the game settings (decision D2: "The edge in Duel's game settings counts"): `min_edge` 0.001 in the limbo config. The Zero Edge rakeback is noted, not tested (D3). Outcome: pass, as before. In `outputs/rtp-claim-table.json` only `ruleVersion` and the source wording changed.
- **Profile.** The Limbo profile version this suite cites is 1.0.2 (decision D6, approved as cited; the `-proposed` suffix is dropped, no check changed). In `outputs/verification-results.json` only `profileCoverage.profileVersion` changed.
- **S5 level.** The adversarial matrix states the S5 level received: the fairness-integrity matrix; game-integrity testing was not commissioned (decision D5).
- **Exit 5** (RTP FIGURE OVERSTATED) is added to the exit codes.
- `outputs/rtp-claim-table.json` was rewritten with `npm run rtp-claim:write` and re-pinned, `outputs/verification-results.json` regenerated with `PF_EMIT=1 npm run verify`, and the release manifest refreshed with `npm run release-manifest`. The mutation battery was rerun: 42/42 killed (41 against verify, 1 against mocha), 30/30 scored steps covered.

### 20 October 2026 — RNG rebuilt from a written specification (v1.2.0)

The verdict, the scored-step statuses (30 PASS, 0 flags, 0 hard fails), every figure and the dataset are unchanged. Through v1.1.0, `src/rng.ts` was ported from Duel's published Verify-tab code (E10). A port can copy the casino's own mistake into the check of it, so the RNG is now rebuilt from a written specification instead.

- **Specification.** [`docs/ALGORITHM.md`](docs/ALGORITHM.md), a copy of the ProvablyFair.org framework's `games/limbo/ALGORITHM.md` (commit `48f91a4`) with the spec author's workspace paths replaced by package paths or neutral wording (its header says so). It was written from Duel's public pages, the standard provably-fair construction and the 7,700 live rounds, without opening Duel's code; its §4 gives the source of every step and its §8 lists every file read.
- **Rebuild.** `src/rng.ts` was written by an implementer who read only that specification and an interface file and never opened Duel's code or the earlier `src/rng.ts`. Its body is that implementer's file byte for byte; only a provenance header was added. Its self-test is now a unit test, `tests/limbo/RngSpecTests.ts` (118/118). The unit-test count stays 43: that test replaces the citation test below.
- **Duel's code is a second check, not the source.** Step 5 and the unit tests still run Duel's Verify-tab file byte for byte on all 7,700 rounds: 7,700/7,700 rolls agree with the served result and with `src/rng.ts`. The port's 8-line citation table (`OPERATOR_SOURCE_CITES`), its check in Step 5 and its unit test are removed.
- **Integer result.** `src/rng.ts` computes the result as `floor(2^32 · 10^6 / (value + 1))` in exact integers; Duel's code and the port computed `Math.floor((2^32 / (value + 1)) * 1e6)` in doubles. On integration the two were compared on every one of the 2^32 values of `value`: they differ on none, so no result, count or figure moves. The rebuilt `resultUnitsFromU` takes the raw draw `value`, where the port's took `value + 1`; `src/exact.ts` adapts with `resultUnitsAtU(u) = resultUnitsFromU(u − 1)`.
- **Three-way agreement, measured on integration** over the 7,700 rounds, seeds paired to rounds by hashing (154 epochs): `src/rng.ts` against the served results 7,700/7,700 (result units, multiplier and commitment), against Duel's Verify-tab code 7,700/7,700 rolls. The package has no ProvablyFair.org live-site verifier leg (DL-13).
- **Mutations.** Four entries targeted the port's text and were retargeted to the rebuilt module: M05b (2^32 denominator) and M23 (draw width) to its constants, M22 (client seed dropped) to its HMAC message; M05g and M09c, which moved a citation, now make `src/rng.ts` round half-up instead of truncating (Step 5) and read the draw little-endian (the spec self-test). The registry still holds 46 entries. Battery (Apple M2 Max, 12 cores, Node v22.23.1), the whole registry in one `npm run mutate` on this tree, 20 October 2026 (baseline verify and mocha exit 0): **46/46 killed**, 30/30 scored steps covered, no declared survivors.
- **Artifacts.** `outputs/simulation-results.json`, `rtp-convergence.html` (`npm run simulate`) and `rtp-claim-table.json` (`npm run rtp-claim:write`) were regenerated and are byte-identical, so no pin moved. `outputs/verification-results.json` was re-emitted with `npm run report`: only text changed (the Step 5, 23 and 25 details, the Step 5 profile note and the LIMBO-09 and LIMBO-29 notes). `outputs/capture-power.json` was not regenerated: `npm run power` draws unseeded random captures, so it cannot reproduce its pinned bytes. The release manifest was refreshed with `npm run release-manifest`; its release label stayed `v1.1.0` until 21 October.

### 21 October 2026 — review corrections (v1.2.0)

No draw check, scored step status, figure or verdict changed. The dataset and every pinned artifact are unchanged.

- **Fresh release.** This release starts its public repo as one squashed commit. The history of the private record repo `ProvablyFair-org/duel-limbo`, whose main carries the `v1.0.0` tag of 17 September 2026, is not carried over. `v1.1.0` was never tagged, so v1.2.0 supersedes `v1.0.0` and carries the v1.1.0 changes above.
- **Release labels.** The header, the README and `package.json` named `v1.1.0`; they now name `v1.2.0`, and `package-lock.json` says 1.2.0. The release manifest's `release` field says `v1.2.0` (was `v1.1.0`). Its `signature` field carried a key fingerprint although no Limbo release had been signed under it; it was set to null until the release was tagged and signed.
- **Specification copy.** [`docs/ALGORITHM.md`](docs/ALGORITHM.md) named locations in the spec author's workspace; they now read as paths inside this package or as neutral wording, and a header says so. No rule, number, vector or source note changed. The 20 October entry now says the copy differs from commit `48f91a4` in this way.
- The release manifest was refreshed with `npm run release-manifest`.
- **Release wording.** At tagging, the README, this overview and the release manifest stopped describing `v1.2.0` as a draft until tagged, and the header's publication date names this release. The release manifest records `v1.2.0`, superseding `v1.0.0`, and the fingerprint of the ProvablyFair.org signing key (`signature`, `SHA256:gEujiJm2pRyq7lQsfYQfQ1r97H/J7GdaKHbOW8GtikY`), as tagged `v1.2.0`; its `pending` line is empty. It was refreshed with `npm run release-manifest`. No check, figure or verdict changed.

### Where the former chapters went

| Former documentation | Consolidated location |
|---|---|
| README headline result | Conclusion and scope; README |
| README reproduce and MANIFEST Reproducibility | Reproduce the audit |
| README "Verify one of your own bets" | Verify a bet |
| README dataset and MANIFEST Dataset, capture phases, power analysis | Dataset and capture |
| MANIFEST Algorithm | Game and algorithm |
| `ALGORITHM.md` (2026-08-18 transcription) | Exhibit E04, `evidence/algorithm-transcription-2026-08-18.md`; its findings in Game and algorithm |
| MANIFEST Money model | Payouts and RTP |
| MANIFEST Verification | Verification results; Payouts and RTP (scaling edge, exact pricing, simulation) |
| `exploit-testing.md` | Verification results (S5 matrix and supplementary rows) |
| `evidence.md` | Evidence |
| MANIFEST Load-Bearing Premises and Declared Limitations | Limitations and trust |
| README release history | Release history |
