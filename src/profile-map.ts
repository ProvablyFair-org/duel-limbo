/**
 * Which ProvablyFair.org Limbo profile check each scored step implements.
 *
 * The framework's Limbo profile (1.0.2, approved 2026-10-14, Methodology v1.1 D6) declares checks LIMBO-01 … LIMBO-31. This suite scores
 * its steps under its own numbering, which the chapters cite by number and which therefore cannot
 * be renumbered to match. The mapping is declared here, emitted into
 * `outputs/verification-results.json` beside the step results, and read back by `pf-audit matrix`.
 *
 * THIS FILE LABELS; IT DOES NOT CHECK. Nothing here can make a step pass or fail. Claim a check
 * only if the step's assertion actually decides the profile's `asserts` text.
 *
 * COVERAGE DESCRIBES THE PACKAGE, NOT THE STEP.
 *   full    — nothing the profile's `asserts` requires is unimplemented anywhere in the package.
 *   partial — something the profile requires is implemented nowhere, and the note says what.
 */

export type Coverage = 'full' | 'partial';
export interface CheckClaim { id: string; coverage: Coverage; note?: string }
export interface StepClaims { claims: CheckClaim[]; reason?: string }

export const PROFILE_GAME = 'limbo';
export const PROFILE_VERSION = '1.0.2';

const P = (id: string, note: string): CheckClaim => ({ id, coverage: 'partial', note });
const F = (id: string, note?: string): CheckClaim => (note ? { id, coverage: 'full', note } : { id, coverage: 'full' });

/**
 * Mapping as of 2026-09-26 (30 scored steps). The BASELINE, before this round's work, was 3 implemented ·
 * 19 partial · 9 missing of 31 (the package as copied from duel-limbo @ 466027f, 21 steps).
 */
const CSPRNG_GAP = 'CAPTURE-ORIGIN (decision-13, disclosed, never held against the operator): the profile requires the '
  + 'A–C client-seed generator to be a CSPRNG; the rig used Math.random() (capture/capture-auto.reference.js:375-378, '
  + 'MANIFEST DL-2) and the Phase D seeds are predictable pfaudit+timestamp strings (DL-3, 10 epochs enumerated by '
  + 'Step 17). Only a new capture could change the generator; everything else LIMBO-06 asserts is implemented '
  + '(wrong-seed model-rate gate + empty-seed control in Step 22, Phase D recompute in Steps 5/17)';
export const STEP_CLAIMS: Record<number, StepClaims> = {
  1: { claims: [F('LIMBO-01', 'every revealed plaintext must open a commitment published at an EARLIER record (the former any-commitment match is gone); 157 reveals, 154 betting epochs and 4 bet-less unopened records bound to src/capture-plan.ts; zero unverifiable bets with Steps 3–4')] },
  2: { claims: [F('LIMBO-02', 'promotion records and chain adjacency recomputed from operator fields on all 158 records; record 0 is the capture-start rotation that anchors epoch 0')] },
  3: { claims: [
    F('LIMBO-03', 'no longer the group-by-hash tautology: every bet is placed in the rotation window of the seed record active when it was placed and must carry that record\'s commitment AND client seed; epochs bound to EXPECTED_EPOCHS × EPOCH_SIZE'),
    F('LIMBO-01', 'epoch-coverage half: 154/154 betting epochs revealed'),
  ] },
  4: { claims: [F('LIMBO-01', 'verifiable-bet half: EXPECTED_BETS under a revealed seed')] },
  5: { claims: [F('LIMBO-07', 'exact integer 1e-6 units parsed from the served string, float path (src/rng.ts multiplier, toFixed(6)) must land on the same unit; coverage bound to EXPECTED_BETS; a skipped bet FAILs')] },
  6: { claims: [F('LIMBO-18', 'negative-control half: nonce+1 changes the result and a served result ±1e-6 is rejected; the exact-count half is Step 25')] },
  7: { claims: [F('LIMBO-04', 'nonces exactly NONCE_BASE..NONCE_BASE+EPOCH_SIZE−1 from src/capture-plan.ts; an undeclared gap/repeat FAILs; a gap declared in CAPTURE_RETRY_GAPS is a capture-origin FLAG (verdict-neutral) — the branch is reachable (probe) though the capture has none')] },
  8: { claims: [
    F('LIMBO-11', 'amount_won == amount × target compared as integers on the 1e-20 grid from the served strings; losses exactly 0'),
    F('LIMBO-13', 'paid-multiplier half: the 18-dp multiplier echo and the served target must equal the chosen target exactly'),
  ] },
  9: { claims: [F('LIMBO-19', 'measured-edge half: the backend edge bracket from the win/lose boundary, width printed; the per-target enumeration against the claim is Step 26')] },
  10: { claims: [F('LIMBO-10', 'settlement half at the MEASURED edge; the declared-edge exact rule and the result range are Step 24')] },
  11: { claims: [F('LIMBO-13', 'the operator-reported house_edge_percentage is compared with the measured bracket, never read')] },
  12: { claims: [F('LIMBO-13', 'the operator-reported win_chance is compared with the measured bracket, never read; the exact comparison with (1−e)/T is Step 25')] },
  13: { claims: [F('LIMBO-26')] },
  14: { claims: [F('LIMBO-05', 'bets, seeds, epochs, epoch size and per-phase counts bound to src/capture-plan.ts; no undeclared phase; meta counts not the denominator')] },
  15: { claims: [F('LIMBO-15', 'distinct-target spread; the per-decade assertion against the plan is Step 28')] },
  16: { claims: [F('LIMBO-12', 'every Phase C bet carries exactly the base-stake win_chance at its target, recomputes (Step 5) and pays exactly (Step 8); 198 elevated-stake wins ≥ 100; plus the bracket overlap')] },
  17: { claims: [P('LIMBO-06', CSPRNG_GAP)] },
  18: { claims: [F('LIMBO-20', 'pinned seeds (SIM_MASTER_SEED), 2,000,000-draw uniformity chi-squared + lag-1 serial, 13 targets 1.1x–100,000x × 1,000,000 rounds against the EXACT per-target win probability, family-wise Bonferroni; all re-derived in verify from the stored census; regeneration byte-identical and field-diffed by test:full')] },
  19: { claims: [F('LIMBO-21', 'every revealed seed × 10,000 nonces computed in verify; windows bet the served targets; captured window vs the 199 others under an exact permutation null; pre-registered one-sided rule; direction split and detection power printed')] },
  20: { claims: [F('LIMBO-31', 'config pinned (Step 21); every bet\'s applied edge recovered exactly from target × win_chance, off-floor FAILs; scaling onset (25,000 potential profit, limboConfig.json of 2026-08-21) stated and not reached; the floor→ceiling rule is disclosed as config-implied')] },
  21: { claims: [F('LIMBO-27', 'every artifact of record + limboConfig.json pinned in src/, no run metadata (asserted), value domains on every numeric leaf (src/domains.ts, both directions), verify writes only outputs/run/')] },
  22: { claims: [P('LIMBO-06', CSPRNG_GAP)] },
  23: { claims: [F('LIMBO-08', 'uint32 taken directly (8 hex chars, denominator 2^32), no modulo or rejection: bias bound 0 by construction, asserted from src/rng.ts constants and every recomputed draw')] },
  24: { claims: [
    F('LIMBO-10', 'result range [1.000000, 2^32] on the 6-dp lattice and every served win flag equal to the exact rule at the declared edge, no served field read'),
    P('LIMBO-17', 'the boundary census is printed but the TIE (result exactly on the threshold) and the 1.000000 FLOOR are unwitnessed in the capture (0 of each in 7,700; the floor has probability 2^-32 per bet) and no operator-verifier probe exists; the >= comparator rests on Duel\'s published comment (MANIFEST DL-1). The floor losing at every legal target is proved by arithmetic'),
  ] },
  25: { claims: [
    F('LIMBO-18', 'exact-count half: winning draws counted over all 2^32 under the operator\'s formula for every served target, against the closed form within the truncation bound'),
    F('LIMBO-13', 'the served win_chance equals (1−e)/T to one 1e-18 unit on every bet (compared, never read)'),
  ] },
  26: { claims: [F('LIMBO-19', 'every one of the 9,999,900 legal targets priced by an exact count; min/max edge and where printed; compared with the claim at its printed precision (0.1%, R1-style reading: no target changes the published figure at its printed precision, so no FLAG) — every target differs from 0.1% by at most +0.0023269 pp and none is below it; the measured bracket printed beside the claim')] },
  27: { claims: [F('LIMBO-14', 'every target on the 2-dp grid within [1.01, max_target]; the 250,000 maximum profit (limboConfig.json of 2026-08-21) and advertised-max playability printed; the maximum profit disclosed as implied by the config rule, not served as a field there; minimum legal target disclosed')] },
  28: { claims: [F('LIMBO-15', 'Phase A per declared decade (PHASE_A_DECADES from TARGET_RANGE) ≥ 50, minimum target placed, asserted against the plan in code')] },
  29: { claims: [P('LIMBO-16', 'the capture carries a balance field only on 163 SAMPLED wallet envelopes: each leg\'s balance moves by exactly its delta, debit = −amount, credit = amount_won iff won, rakeback = 0.001 × amount — all exact; a consecutive-bet balance ledger was not captured (capture design), so the consecutive-delta half cannot be asserted')] },
  30: { claims: [F('LIMBO-22', 'KS against P(R >= x) = 1/x and lag-1 serial on 1/R; informational (profile policy INFORMATIONAL, Mike 2026-09-29): a deviation is reported as INFO, never counted as a flag, never bears the verdict; reachable (mutation M30)')] },
};

export const NOT_APPLICABLE: Array<{ id: string; reason: string }> = [];

export const PACKAGE_CHECKS: Array<{ id: string; artifact: string; coverage: Coverage | 'none'; note: string }> = [
  { id: 'LIMBO-09', artifact: 'docs/ALGORITHM.md + tests/limbo/RngSpecTests.ts + tests/limbo/OperatorSourceTests.ts + src/operator-verifier.ts + Step 5', coverage: 'full',
    note: 'REWRITTEN 2026-10-20 (v1.2.0 draft). src/rng.ts is rebuilt from a written specification, docs/ALGORITHM.md '
      + '(framework games/limbo/ALGORITHM.md, commit 48f91a4), by an implementer who never opened Duel\'s code; Duel\'s '
      + 'published Verify-tab code is run as a second check, not used as the source. Through v1.1.0 src/rng.ts was a port '
      + 'of that code and cited 8 of its lines (OPERATOR_SOURCE_CITES); the port and the citation table are gone. Duel\'s own Limbo '
      + 'Verify-tab code, pasted by Paulo from duel.com Verify tab 2026-09-26, is vendored verbatim at '
      + 'evidence/verify-tab/duel-verify-tab-limbo-2026-09-26.js (E10, SHA-256 be694474…, never edited) and pinned with its runner in '
      + 'src/operator-verifier.ts. The asserts: (1) "unit tests reproduce at least one captured bet … against the operator\'s '
      + 'published algorithm" — tests/limbo/OperatorSourceTests.ts EXECUTES the pinned file with only its four "User input values" filled in '
      + 'on all 7,700 captured bets: its roll equals the served result and src/rng.ts as integer 6-dp units on 7,700/7,700; (2) "fixed vectors" '
      + '— the first bet of each phase through the same file at houseEdge 0 (it then prints its scaling-edge note and afterEdge = roll = served), '
      + 'and tests/limbo/RngSpecTests.ts runs the spec\'s own vectors and properties against src/rng.ts (118/118); '
      + '(3) "the adapter cites the operator source line it ports" — superseded for this package by the 20 Oct 2026 rule that RNG code is '
      + 'rebuilt from a written spec: nothing is ported, so no operator line is cited; docs/ALGORITHM.md §4 names the source of every step '
      + 'instead (Duel\'s public pages, the standard construction, or the 7,700 live rounds). Step 5 runs the same execution in the verifier and also reports its afterEdge at the per-bet declared edge '
      + '(the limboConfig.json floor 0.001 on 7,700/7,700, Step 20): win iff afterEdge >= target agrees with the served win flag on '
      + '7,700/7,700 and with the package\'s exact rule on 7,700/7,700 (reported, not scored). FAIL probed: M05c (a line of the file changed AND '
      + 're-pinned), M05d (file byte, no re-pin), M05e (runner byte, no re-pin), M05f (runner forged AND re-pinned). Not established: that '
      + 'the Verify button, or Duel\'s server, runs exactly this code' },
  { id: 'LIMBO-23', artifact: 'MANIFEST.md#verification-results', coverage: 'full',
    note: 'S5-1 … S5-8 between S5-MATRIX markers, each tied to a scored step (S5-5 Not tested — disclosed); supplementary S5-D1 and S5-S1' },
  { id: 'LIMBO-24', artifact: 'none', coverage: 'none',
    note: 'no ProvablyFair.org site verifier exists for Duel Limbo (qa-workspace/duel/docusaurus/src/components/VerifyBets/games has no limbo module, checked 2026-09-26); Duel publishes its own Verify page, so the check applies (MANIFEST DL-13)' },
  { id: 'LIMBO-25', artifact: 'MANIFEST.md#verify-a-bet', coverage: 'full',
    note: 'six ordered steps: where the seed is revealed, the fields, the exact commitment encoding, the result formula, the exact win rule at the floor edge, the payout — in the served field names' },
  { id: 'LIMBO-28', artifact: 'package.json + tests/verify.ts', coverage: 'full',
    note: 'npm test = mocha + verify (no simulate), verify writes only outputs/run/ and field-diffs against the committed results, test:full regenerates the simulation and diffs it, engines node 22.x; runtime pinned (engines node 22.x + .nvmrc 22); a real git clone of origin @ 6c85377 reproduced on Node 22.23.1 on 2026-09-27 (npm ci, npm test 11.4 s, test:full 28.7 s, all exit 0; 43 passing, 30/30 Full Pass, REPRODUCED; outputs/run/diff.json reproduced true, 0 beyond tolerance; outputs byte-identical, clone tree unmodified; MANIFEST.md#reproduce-the-audit); audit ID PF-2026-DL11 assigned (src/capture-plan.ts AUDIT_ID, emitted into the results; README.md and MANIFEST.md headers, both checked by scripts/release-manifest.mjs)' },
  { id: 'LIMBO-29', artifact: 'tests/mutations.json + scripts/mutate.mjs', coverage: 'full',
    note: 'step-named registry run in a disposable copy by npm run mutate; every scored step 1–30 has a killing mutation with an expect marker; includes re-pinned forgeries of the dataset (M01–M17, M25, M29), of the simulation census (M18, M18b), of run metadata (M21b), of the config (M27) and of Duel\'s Verify-tab code and its runner (M05c, M05f; added 2026-09-26 with M05d, M05e); M05g and M09c, which broke a src/rng.ts citation, were retargeted on 20 Oct 2026 to the rebuilt src/rng.ts (6-dp rounding, byte order) when the citation table was removed; no declared survivors' },
  { id: 'LIMBO-30', artifact: 'MANIFEST.md#limitations-and-trust + MANIFEST.md#evidence', coverage: 'full',
    note: 'MANIFEST carries the load-bearing premises table and the declared-limitations register DL-1 … DL-14 with magnitudes; MANIFEST Evidence numbers every exhibit E01–E10 and E12 (E11 unassigned) with its evidential role; no internal QA material ships' },
];

export function profileCoverageBlock(): Record<string, unknown> {
  return { game: PROFILE_GAME, profileVersion: PROFILE_VERSION, notApplicable: NOT_APPLICABLE, packageChecks: PACKAGE_CHECKS };
}

export function labelFor(step: number): Record<string, unknown> {
  const entry = STEP_CLAIMS[step];
  if (!entry) return { profileIds: [], profileChecks: [], profileNote: 'no mapping declared for this step' };
  return entry.claims.length
    ? { profileIds: [...new Set(entry.claims.map(c => c.id))], profileChecks: entry.claims }
    : { profileIds: [], profileChecks: [], profileNote: entry.reason ?? 'no reason given' };
}
