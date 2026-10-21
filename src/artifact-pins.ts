/**
 * ARTIFACTS OF RECORD — pinned.
 *
 * These files are shipped as evidence and their figures are quoted in the report, but until this
 * pin existed nothing hashed them: emptying, duplicating or shrinking any of them left the
 * verifier reporting PROVABLY FAIR — Full Pass, exit 0. A published artifact that nothing can
 * distinguish from a rewritten one is not evidence.
 *
 * outputs/verification-results.json is deliberately NOT pinned — it is this verifier's own
 * output; a plain run writes it to outputs/run/ and field-diffs it against the committed copy.
 *
 * RE-PINNED 2026-09-26 (none of these carries run metadata any more):
 *   chi-squared-results.json, determinism-log.json — re-emitted by `npm run report` (PF_EMIT=1) with
 *     `generatedAt` removed; field diff against the previous copies: only `generatedAt` differed.
 *   simulation-results.json, rtp-convergence.html — Pass 1 rebuilt on pinned seeds (src/simulate.ts);
 *     regenerated with `npm run simulate`, byte-identical across two runs. Every figure changed.
 *
 * Regenerating an artifact legitimately means re-pinning it here, in the same commit, with the
 * run that produced it.
 */
export const ARTIFACT_PINS: Readonly<Record<string, string>> = Object.freeze({
  'chi-squared-results.json':
    'e2d83a46b05f3aa6ff0cb2f4b60f9a86b9a269b6387537a511bcab62a89048a7',
  'determinism-log.json':
    'cc52b48e1bb1bc37a962b7fd90d19e7671f593cf8659637591b9c9579b581c6c',
  'capture-power.json':
    '4aa3c304278706fb6628442fe5727416431e5457809f359770d53597f6d6a5ef',
  'rtp-convergence.html':
    '203df3b6da90d6902ab2c9f12a2a9702033beb698555860ee0d9cfb5ed2d1ac9',
  'simulation-results.json':
    '1ab73639811451f4a75212f83fde7651fbe9bb3e974473523c2be70ed789d2ae',
});
