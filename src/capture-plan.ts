/**
 * The capture plan, in one place.
 *
 * `capture/capture-auto.reference.js` is the script that actually places the
 * bets and is therefore the authority. This module mirrors it so the verifier
 * (Step 14) and the power analysis (`src/capture-power.ts`) read the same
 * numbers, and `tests/limbo/CapturePlanTests.ts` asserts the mirror matches the
 * script — a copy that drifted is what left Step 14 scoring against the Duel
 * Dice sizes (B = 1,000, total 6,700) after the plan had moved to B = 2,000.
 */

/** Bets per phase. */
export const PLAN = { A: 5000, B: 2000, C: 200, D: 500 };

/**
 * Seed records an honest capture carries. Stated here as CODE, like PLAN above, because the
 * dataset must not be the only thing that says how large the dataset should be: deleting rounds
 * and re-pinning the hash leaves a file that agrees with its own header, and re-pinning is
 * exactly what a forger does. A count asserted from outside the artifact is what closes that.
 */
export const EXPECTED_SEEDS = 158;

/**
 * Stake per phase, in USD — the EXECUTED stakes. The design-time plan priced the
 * low phases at $0.01; the live table minimum turned out to be dynamic
 * (~$0.01000321 at pre-flight), so the capture ran at $0.0125. The committed
 * outputs/capture-power.json still prices the design-time stake ($2,075) —
 * stake does not enter the edge bracket, so its precision figures stand.
 */
export const STAKES = { A: 0.0125, B: 0.0125, C: 10, D: 0.0125 };

/** Phases A and D draw log-uniform targets over this range, quoted to 2 dp. */
export const TARGET_RANGE = { lo: 1.01, hi: 1000 };

/** Phases B and C bet a fixed low target — this is what closes the edge bracket. */
export const LOW_TARGET = 1.01;

export const PLANNED_TOTAL = Object.values(PLAN).reduce((a, b) => a + b, 0);

export const PLANNED_TURNOVER =
  (Object.keys(PLAN) as (keyof typeof PLAN)[]).reduce((sum, k) => sum + PLAN[k] * STAKES[k], 0);

/**
 * Step 9 reports a PASS only if the measured edge bracket is at least this
 * tight; a wider bracket is FLAGged rather than presented as a measurement.
 */
export const TIGHT_PP = 0.10;

// ── Population constants (G-BIND) ─────────────────────────────────────────────
// Stated as CODE so the dataset is never the only thing that says how large it should be.
// Measured from the frozen capture on 2026-09-26 and fixed here; a dataset that disagrees FAILs.

/** Bets the capture plan places (= PLANNED_TOTAL). */
export const EXPECTED_BETS = 7700;
/** Seed epochs that carry bets: 154 = 7,700 / 50. */
export const EXPECTED_EPOCHS = 154;
/** Bets per epoch — the capture rotates the seed pair after this many bets. */
export const EPOCH_SIZE = 50;
/** First nonce of every epoch (Duel resets the nonce to 0 on rotation). */
export const NONCE_BASE = 0;
/**
 * Seed records whose server seed was revealed. 158 records: record 0's plaintext is revealed by
 * record 1, and so on; the final active seed (record 157) is never revealed, so 157 carry a plaintext.
 */
export const EXPECTED_REVEALED = 157;
/**
 * Seed records that carry no bets: at each phase change the rig rotates twice within ~2 s, leaving
 * one bet-less epoch per phase boundary (records 100, 141, 146) plus the final active seed (157).
 */
export const EXPECTED_BETLESS_RECORDS = 4;
/** Bets whose wallet envelope (ledger legs + rakeback) the rig sampled. */
export const EXPECTED_WALLET_SAMPLES = 163;
/**
 * Nonce gaps the capture log attributes to an auditor-side retry. The Duel limbo rig kept no retry
 * log and the frozen capture has none; any gap in the data is therefore operator-side and FAILs.
 * A declared entry here would be shown as a capture-origin FLAG (verdict-neutral) instead.
 */
export const CAPTURE_RETRY_GAPS: ReadonlyArray<{ epoch: string; nonce: number }> = [];

// ── Declared game parameters ──────────────────────────────────────────────────
/** The edge the operator declares per bet: house_edge_percentage 0.1 on every bet = limboConfig min_edge. */
export const CLAIMED_EDGE: { num: number; den: number } = { num: 1, den: 1000 };
/** Printed precision of the claim: house_edge_percentage is served as 0.1 (percent, 1 decimal). */
export const CLAIM_PRINTED_DECIMALS_PCT = 1;
/** Smallest target the capture placed and the operator accepted (Phases B and C bet it). */
export const MIN_TARGET_CENTS = 101;
/** Decades Phase A must cover, from TARGET_RANGE (log-uniform 1.01 .. 1000). */
export const PHASE_A_DECADES: ReadonlyArray<[number, number]> = [[1, 10], [10, 100], [100, 1000]];
/** Phase A floor per declared decade (profile LIMBO-15). */
export const PHASE_A_MIN_PER_DECADE = 50;
/** Phase C must carry at least this many elevated-stake WINS (profile LIMBO-12). */
export const PHASE_C_MIN_WINS = 100;
/** Step 15 FLAGs a capture with fewer distinct targets than this (a narrow spread weakens the Step 9 bracket). */
export const MIN_DISTINCT_TARGETS = 10;
/**
 * Step 12 compares the served win_chance with the measured bracket to within this absolute amount — it
 * guards float noise in the bracket arithmetic only; the exact 1e-18 comparison with (1−e)/T is Step 25.
 */
export const WIN_CHANCE_DISPLAY_TOL = 1e-6;

// ── Pass 2 (cherry-pick screen) ───────────────────────────────────────────────
/** Nonces replayed per revealed seed. */
export const PASS2_NONCES = 10_000;

/**
 * Audit ID. The Duel series runs PF-2026-DL01 … DL10 (plinko … groomers-van); limbo is PF-2026-DL11.
 * Single-sourced here and emitted into outputs/verification-results.json; README.md and MANIFEST.md carry
 * it in their header lines, and scripts/release-manifest.mjs checks both docs against DECLARED.auditId.
 */
export const AUDIT_ID: string | null = 'PF-2026-DL11';
