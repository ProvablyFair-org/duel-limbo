# Duel Limbo — reversed algorithm (recon)

**Date:** 2026-08-18
**Source:** `duel.com/fairness/verify` → Game selector → **Limbo** → Code panel (Duel's own published verifier JS). Read-only, no login, no bets.

## Algorithm (verbatim logic from Duel's verify page)

```js
const validateLimboResult = async (serverSeed, clientSeed, nonce) => {
  const message = new TextEncoder().encode(`${clientSeed}:${nonce}`);
  const hash = await generateHMAC_SHA256(serverSeed, message); // key = hexToBytes(serverSeed)
  const MAX = 2 ** 32;
  const value = parseInt(hash.slice(0, 8), 16);               // first 4 bytes as uint32
  const result = Math.floor((MAX / (value + 1)) * 1000000) / 1000000; // 6-dp floor
  return Math.max(1.0, result).toFixed(6);
};
```

- **Primitive:** HMAC-SHA256, `key = hex-decoded serverSeed` (bytes, NOT utf-8), `message = clientSeed:nonce`. Same primitive family as Duel Dice, but Limbo uses only the **first 8 hex chars** (one uint32) — no rejection-sampling cursor loop.
- **Fair multiplier:** `2**32 / (value + 1)`. Range **1.000000 → 4,294,967,296×**. Floored to 6 decimals, min `1.0`.
- **Commit-reveal:** same as other Duel originals — `SHA-256(hexBytes(serverSeed)) === serverSeedHashed`.

## KEY DESIGN NOTE (their own comment)

> "Fair result multiplier with no house edge baked in. The edge is applied by the backend to the win threshold (you win if result >= target / (1 - edge)), it never changes this result."

- The verified/displayed **fair multiplier is edge-free.**
- House edge is applied to the **win threshold**, not the multiplier. Win condition ≈ `result >= target / (1 - edge)`.
- ⇒ Fair win prob at target T ≈ `1/T`; with edge, win prob ≈ `(1 - edge)/T` ⇒ **RTP ≈ (1 - edge)** per bet.
- **The exact `edge` is a backend parameter — MUST be measured from live bets** (`amount_won` vs `amount × target`, and whether a winning bet satisfied `result >= target/(1-edge)`). The operator's advertised figure is a label, not a measurement: it is cross-checked against the measured bracket in Step 11, never used to produce it.

## Status

1. ~~Port `validateLimboResult` into an isomorphic RNG module.~~ **Done** — `src/rng.ts`, Node `crypto` ≡ Web Crypto; the parity check is an executable test (`tests/limbo/LimboTests.ts`, 5,000 fresh random cases per run, 0 mismatches).
2. ~~Author the scored-step verifier and prove it falsifiable before it sees live data.~~ **Done** — `tests/verify.ts`, 20 scored steps at the time (30 since 2026-09-26), self-tested against synthetic datasets carrying a planted edge.
3. ~~Live capture.~~ **Done** — 7,700 bets captured 31 August 2026 on production duel.com, 154 epochs of 50, every betting epoch revealed (4 zero-bet seed records are not); dataset frozen at `data/limbo-master.json` (SHA-256 pinned in `src/loader.ts`).
4. ~~Verification.~~ **Done** — every result reproduced from revealed seeds with exact equality (7,700/7,700); house edge **measured** from the win/lose boundary: 0.0957%, bracket (0.073084%, 0.118281%], the declared 0.1% inside it; simulation convergent at every target; Zero Edge rakeback evidenced from 163 sampled wallet envelopes at exactly 0.001 × stake. Verdict at the time: **PROVABLY FAIR — Full Pass** (20/20; the suite is 30 scored steps since 2026-09-26, 30/30). An earlier line here also said "serial independence clean": the figure behind it was a lag-1 correlation r1 = 0.6215 printed as a z-score — see MANIFEST DL-14. Narrative report: docusaurus (publication pending).
