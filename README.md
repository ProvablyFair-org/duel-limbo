# Duel Limbo — Provably Fair Audit

**Auditor:** [ProvablyFair.org](https://www.provablyfair.org) · **Audit ID:** PF-2026-DL11 · **Release:** `v1.2.0` · **Capture:** 31 August 2026

**Result: PROVABLY FAIR — Full Pass.** All 7,700 captured results reproduce from `(serverSeed, clientSeed, nonce)` with exact equality on the 6-dp lattice. The verifier reports 30 of 30 scored steps passing, 0 flags and 0 hard fails.

**Scope:** Limbo's house edge lives in the backend win threshold, not in the multiplier, so this audit **measures** it from the win/lose boundary of 7,700 live bets: **0.0957%**, bracketed to **(0.073084%, 0.118281%]**. The operator's declared distribution edge of **0.1%** lies inside the bracket. At the declared 0.1% floor edge every legal target from 1.01x to 100,000x is priced between **0.1000000%** and **0.1023269%**, counted over all 2^32 draws. On each of the 163 sampled bets the Zero Edge rakeback was **0.001 × stake**, which offsets the 0.1% floor edge; all 7,700 captured bets sat at that floor. **Open item:** Zero Edge's net 100% is evidenced only at the 0.1% floor. Under the config-implied rule (`limboConfig.json` of 2026-08-21) the edge rises once a bet's potential profit passes 25,000 (at 1,000×, a stake of about 25) and reaches 1% at the 250,000 maximum. If the rakeback stays at 0.001 × stake there, net RTP falls to about 99.1% at the ceiling. Whether it does is unverified ([DL-8](MANIFEST.md#declared-limitations-register)).

## What was verified

| Check | Captured evidence |
|---|---|
| Results | 7,700 of 7,700 reproduced with exact equality. The RNG code (`src/rng.ts`) was rebuilt from a written specification ([docs/ALGORITHM.md](docs/ALGORITHM.md)) by an implementer who never opened Duel's code; Duel's published Verify-tab code is run as a second check, not used as the source, and gives the served result on 7,700/7,700 |
| Seed records | 158 records, 154 betting epochs of 50, every epoch that carries bets revealed (154/154) |
| Payouts | 2,965 wins paid exactly `amount × target`, losses exactly 0; 0 payout errors |
| Measured edge | 0.0957%, bracket (0.073084%, 0.118281%], width 0.045 pp; declared 0.1% inside it |
| Every legal target | 9,999,900 targets 1.01x … 100,000x; edge 0.1000000% to 0.1023269%; 0 below the claim |
| Zero Edge rakeback | 163 sampled wallet envelopes, each a separate credit of exactly 0.001 × stake |
| Scaling edge | All 7,700 bets sit at the 0.1% floor; largest potential profit 12.47 vs 25,000, where scaling starts under the 2026-08-21 config |
| Simulation | Pass 1 from pinned seeds (2,000,000-draw census, 13 targets × 1,000,000 rounds); Pass 2 over 154 epochs × 10,000 nonces |
| Observed return | 99.7664% over 7,700 bets; a variance illustration, not RTP evidence |

A matching hash shows consistency with a commitment; it carries no time. The commitment chronology, the floor-only edge evidence and the other open items are in the [overview's limitations](MANIFEST.md#limitations-and-trust).

## Run the audit

Open a terminal in this package's directory. Use **Node 22.x**, as declared in [.nvmrc](.nvmrc) and [package.json](package.json).

```sh
npm ci
npm test
```

Expected: **43 unit tests pass; 30/30 PASS; 0 flags; 0 hard fails; PROVABLY FAIR — Full Pass; REPRODUCED; exit 0.** `npm test` runs the unit tests and `npm run verify`. It does not run the simulation: verify scores the pinned simulation artifact, re-derives every statistic from its census, writes only to `outputs/run/` and field-diffs this run against the committed results. The exit code is the verdict: `0` PROVABLY FAIR — Full Pass · `2` PROVABLY FAIR — Conditional Pass · `5` RTP FIGURE OVERSTATED (the RTP-CLAIM rule 1.2.0 found a published RTP figure above the game's real RTP; the draws pass) · `1` NOT PROVABLY FAIR, or a reproduction difference.

**RTP claim (RTP-CLAIM 1.2.0, switched on).** Every target from 1.01× to 100,000× is held to the 99.9% of the 0.1% floor edge stated in Duel's game settings (scaling_edge min_edge 0.001 in the limbo config). Scored on Step 26: PASS, 0 of 9,999,900 targets beyond the 0.1 pp band ([table](outputs/rtp-claim-table.json)). The Zero Edge rakeback is noted, not tested.

```sh
npm run test:full                 # optional: regenerates Pass 1 into outputs/run/ from pinned seeds, then mocha + verify
node scripts/release-manifest.mjs --check
```

See [reproduction details](MANIFEST.md#reproduce-the-audit) for the comparison rules, the mutation battery, the power analysis and the deliberate artifact-refresh procedure.

## Verify a bet

Before betting, copy the active server seed hash shown on duel.com → Provably Fair and keep it. After rotating your seed pair, the server seed is revealed. Check `SHA-256(hex_decode(serverSeed))` against the hash you saved: a PASS means the hashes are equal, which shows consistency; the assurance that the seed was fixed before your bets comes from the copy you saved before betting. Then recompute the result from `HMAC-SHA256(hex_decode(serverSeed), client_seed:nonce)`, then check the win rule and the payout. The six ordered steps, with the exact formulas and field names, are in [Verify a bet](MANIFEST.md#verify-a-bet). `src/rng.ts` and `src/exact.ts` implement them and can be called directly.

## Files and evidence

There are two documentation files: this README and [MANIFEST.md — consolidated audit overview](MANIFEST.md). The overview contains the algorithm, the money model, the verification results, evidence, limitations and release history. The written specification `src/rng.ts` is rebuilt from is [docs/ALGORITHM.md](docs/ALGORITHM.md).

- [Captured bets](data/limbo-master.json) — SHA-256 `b2db8685eeafde731152bd9770bf4df9872bda626b65b3412e29b067871365cc`.
- [Operator config](limboConfig.json) — SHA-256 `676beff74f5a3c2e9d634a49e994acfc5adc0aa1a19fdc1ee4be36a916b07379`.
- [Verification results](outputs/verification-results.json), [RTP claim table](outputs/rtp-claim-table.json) and [release manifest](RELEASE-MANIFEST.json).
- Evidence exhibits kept as files: [pre-flight record](evidence/preflight-2026-08-31.md) (E03), [2026-08-18 algorithm transcription](evidence/algorithm-transcription-2026-08-18.md) (E04), [Duel's Verify-tab code](evidence/verify-tab/duel-verify-tab-limbo-2026-09-26.js) (E10), [the duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET)](evidence/E12-limbo-config-2026-10-05.json) (E12; the same values as the operator config above).
- [Audit report](https://audit.provablyfair.org/casino/duel/games/limbo/overview) · [MIT license](LICENSE).

This release is v1.2.0, the first public release of this repository. The consolidation of the documentation and the RNG rebuilt from a written specification (20 October 2026) are recorded in the [release history](MANIFEST.md#release-history).
