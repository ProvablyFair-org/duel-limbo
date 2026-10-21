/**
 * Steps 13–17: Dataset Integrity and Coverage
 *
 * Proves the dataset the report cites is the one on disk, that the capture
 * covered the planned configuration space, and that behaviour does not change
 * with stake size or with a player-chosen client seed.
 */

import * as fs from 'fs';
import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import { checkDatasetHash, getDatasetPath } from '../../src/loader';
import { num } from '../../src/types';

import { PLAN, EXPECTED_SEEDS, EXPECTED_EPOCHS, EPOCH_SIZE, EXPECTED_BETS, PHASE_C_MIN_WINS, STAKES, MIN_DISTINCT_TARGETS } from '../../src/capture-plan';

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, phaseA, phaseB, phaseC, phaseD } = ctx;

  // ── Step 13: dataset hash pinned and matching ────────────────────────────────
  const h = checkDatasetHash();
  const s13 = step(13, 'Dataset Integrity (pinned SHA-256)',
    h.match ? 'PASS' : 'FAIL',
    h.match
      ? `dataset matches the pinned hash ${h.actual}`
      : `pinned "${h.expected || '<unpinned>'}" vs actual "${h.actual}" — pin the frozen dataset hash in src/loader.ts`,
  );

  // ── Step 14: phase structure matches the capture plan ────────────────────────
  const counts  = { A: phaseA.length, B: phaseB.length, C: phaseC.length, D: phaseD.length };
  const planned = Object.values(PLAN).reduce((a, b) => a + b, 0);
  const exact   = (Object.keys(PLAN) as (keyof typeof PLAN)[]).every(k => counts[k] === PLAN[k]);
  // A shrunken capture whose header was doctored to agree with it is internally consistent and
  // re-pins cleanly, so FLAG is the wrong verdict here — it exits 0. The counts come from
  // src/capture-plan.ts, which the dataset does not control, and disagreeing with them is a
  // HARD FAIL. The seed population is checked too: dropping whole epochs keeps every phase
  // ratio intact and would otherwise pass.
  const seedsOk = ctx.seeds.length === EXPECTED_SEEDS;
  const epochSizes = [...ctx.byHash.values()].map(g => g.length);
  const epochsOk = ctx.byHash.size === EXPECTED_EPOCHS && epochSizes.every(n => n === EPOCH_SIZE)
    && EXPECTED_EPOCHS * EPOCH_SIZE === EXPECTED_BETS && planned === EXPECTED_BETS;
  const undeclared = bets.filter(b => !(b.phase in PLAN)).length;
  const s14 = step(14, 'Population & Phase Structure (capture plan honoured)',
    exact && bets.length === planned && seedsOk && epochsOk && undeclared === 0 ? 'PASS' : 'FAIL',
    `A ${counts.A}/${PLAN.A}, B ${counts.B}/${PLAN.B}, C ${counts.C}/${PLAN.C}, D ${counts.D}/${PLAN.D}; ` +
      `${undeclared} bets in an undeclared phase; ` +
      `total ${bets.length}/${planned}; seed records ${ctx.seeds.length}/${EXPECTED_SEEDS}; ` +
      `betting epochs ${ctx.byHash.size}/${EXPECTED_EPOCHS}, ${epochSizes.filter(n => n !== EPOCH_SIZE).length} not of size ${EPOCH_SIZE} ` +
      `(EXPECTED_EPOCHS × EPOCH_SIZE = ${EXPECTED_EPOCHS * EPOCH_SIZE} vs EXPECTED_BETS ${EXPECTED_BETS}; dataset meta counts are not the denominator)` +
      (exact && bets.length === planned ? '' : '; POPULATION MISMATCH vs src/capture-plan.ts') +
      (seedsOk ? '' : '; SEED COUNT MISMATCH'),
  );

  // ── Step 15: target coverage across the betting range ────────────────────────
  const targets = [...new Set(bets.map(b => b.request.target))].sort((a, b) => a - b);
  const s15 = step(15, 'Target Coverage (spread of chosen multipliers)',
    targets.length >= MIN_DISTINCT_TARGETS ? 'PASS' : 'FLAG',
    `${targets.length} distinct targets from ${targets[0] ?? 'n/a'} to ${targets[targets.length - 1] ?? 'n/a'}` +
      ` (floor MIN_DISTINCT_TARGETS = ${MIN_DISTINCT_TARGETS})` +
      (targets.length >= MIN_DISTINCT_TARGETS ? '' : ' — a narrow spread weakens the edge bracket in Step 9'),
  );

  // ── Step 16: bet-size invariance (Phase C vs Phase A) ────────────────────────
  // The edge must not depend on stake. Compare the measured bracket restricted
  // to each phase; recomputed from raw bets, never from a stored scalar.
  const bracketFor = (subset: typeof bets) => {
    let lo = -Infinity, hi = Infinity;
    for (const b of subset) {
      const bound = 1 - num(b.request.target) / num(b.response.result);
      if (b.response.is_win) hi = Math.min(hi, bound);
      else                   lo = Math.max(lo, bound);
    }
    return { lo, hi };
  };
  const bigStake   = bracketFor(phaseC);
  const smallStake = bracketFor(phaseA);
  const compatible =
    Number.isFinite(bigStake.lo) && Number.isFinite(smallStake.hi)
      ? bigStake.lo < smallStake.hi && smallStake.lo < bigStake.hi
      : false;
  // The power of this test is bounded by the WIDER bracket, so state both widths
  // rather than reporting a bare PASS. At the planned Phase C size (200 bets at
  // target 1.01x) the high-stake bracket is ~0.5 pp wide against a main bracket of
  // a median 0.057 pp (outputs/capture-power.json), so overlap is close to
  // guaranteed regardless of the truth: this
  // detects only a gross stake-dependent difference. Accepted deliberately —
  // see MANIFEST.md, "Stated limitation of Phase C".
  const widthPP = (b: { lo: number; hi: number }) => (b.hi - b.lo) * 100;
  // DIRECT stake-price invariance: every Phase C ($10) bet must be priced exactly as the base-stake
  // bets at the same target (identical served win_chance string, identical per-bet edge), must be at
  // the planned elevated stake, and Phase C must carry >= PHASE_C_MIN_WINS wins so the payout path
  // (Step 8, exact) is exercised at the elevated stake, not only the result (Step 5, exact).
  const basePrice = new Map<string, Set<string>>();
  for (const b of bets) if (b.phase !== 'C') {
    const k = b.response.target; if (!basePrice.has(k)) basePrice.set(k, new Set()); basePrice.get(k)!.add(b.response.win_chance);
  }
  let priced = 0, mispriced = 0, noBase = 0, wrongStake = 0;
  for (const b of phaseC) {
    if (parseFloat(b.request.amount) !== STAKES.C) wrongStake++;
    const base = basePrice.get(b.response.target);
    if (!base) { noBase++; continue; }
    if (base.size === 1 && base.has(b.response.win_chance)) priced++; else mispriced++;
  }
  const cWins = phaseC.filter(b => b.response.is_win).length;
  const priceOk = phaseC.length === PLAN.C && priced === PLAN.C && mispriced === 0 && noBase === 0 && wrongStake === 0 && cWins >= PHASE_C_MIN_WINS;
  const s16 = step(16, 'Bet-Size Invariance (edge independent of stake)',
    phaseC.length === 0 ? 'FAIL' : compatible && priceOk ? 'PASS' : 'FAIL',
    phaseC.length === 0
      ? 'no high-stake phase captured — cannot test stake independence'
      : `small-stake bracket (${smallStake.lo.toFixed(8)}, ${smallStake.hi.toFixed(8)}] ` +
        `width ${widthPP(smallStake).toFixed(4)} pp vs ` +
        `high-stake bracket (${bigStake.lo.toFixed(8)}, ${bigStake.hi.toFixed(8)}] ` +
        `width ${widthPP(bigStake).toFixed(4)} pp — ` +
        (compatible ? 'overlapping, consistent with a single stake-independent edge' : 'DISJOINT — edge appears to depend on stake') +
        `. Detects only a difference larger than ~${Math.max(widthPP(smallStake), widthPP(bigStake)).toFixed(2)} pp ` +
        `(${phaseC.length} high-stake bets) — so the price is also checked DIRECTLY: ${priced}/${PLAN.C} Phase C bets at ` +
        `$${STAKES.C} carry exactly the win_chance served to base-stake bets at the same target (${mispriced} mispriced, ` +
        `${noBase} with no base-stake comparator, ${wrongStake} not at the planned stake), every one recomputes (Step 5) and pays ` +
        `exactly amount × target (Step 8); ${cWins} elevated-stake wins (floor ${PHASE_C_MIN_WINS}).`,
  );

  // ── Step 17: Phase D — player-set client seeds honoured ──────────────────────
  // Every Phase D bet was placed under a client seed the auditor set (one per epoch) and must
  // recompute under it (Step 5 recomputes all 7,700 exactly; here the Phase D population is bound).
  // DISCLOSURE (capture-origin, decision-13): the rig generated Phase D seeds as 'pfaudit' +
  // Date.now().toString(36) (capture/capture-auto.reference.js:473,494) — PREDICTABLE — and the
  // Phases A–C seeds with Math.random() (:375-378), which is NOT a CSPRNG. Every one of those seeds was
  // set in a rotation whose server-seed commitment the capture had already recorded as the outstanding
  // next-seed hash (the previous record's nextServerSeedHash; for record 0, the pre-capture read kept in
  // its nextSeedPromotion.previousNextHash). That ORDER is the capture's record (capture integrity assumed, DL-4);
  // Step 2's hash equality is a consistency check and carries no time. The exposed epochs are
  // enumerated here rather than asserted harmless.
  const seedsUsed = new Set(bets.map(b => b.response.client_seed));
  const phaseDSeeds = new Set(phaseD.map(b => b.response.client_seed));
  const expectedDSeeds = PLAN.D / EPOCH_SIZE;
  const predictable = [...phaseDSeeds].filter(sd => /^pfaudit[0-9a-z]+$/.test(sd));
  const dEpochs = new Set(phaseD.map(b => b.response.server_seed_hashed)).size;
  const abcEpochs = new Set(bets.filter(b => b.phase !== 'D').map(b => b.response.server_seed_hashed)).size;
  const d17ok = phaseD.length === PLAN.D && phaseDSeeds.size === expectedDSeeds && dEpochs === expectedDSeeds && seedsUsed.size > 1;
  const s17 = step(17, 'Client-Seed Variation (player-supplied entropy)',
    d17ok ? 'PASS' : 'FAIL',
    `${phaseD.length}/${PLAN.D} Phase D bets under ${phaseDSeeds.size}/${expectedDSeeds} auditor-set client seeds ` +
      `(one per ${EPOCH_SIZE}-bet epoch, floor 2), each recomputed exactly in Step 5; ${seedsUsed.size} distinct client seeds ` +
      `in the dataset. DISCLOSED (capture-origin): ${predictable.length} of the ${phaseDSeeds.size} Phase D seeds are ` +
      `'pfaudit' + a base-36 timestamp (predictable), exposing ${dEpochs} epochs; the ${abcEpochs} Phase A–C epochs used ` +
      `Math.random() seeds (not a CSPRNG). Each was set at a rotation after the capture had recorded its server-seed ` +
      `commitment as the outstanding next-seed hash; that order rests on the capture's records (capture integrity ` +
      `assumed, MANIFEST DL-4), and Step 2's hash equality is a consistency check, not timing.`,
  );

  return [s13, s14, s15, s16, s17];
}

/** Exposed for the source-scan guard in verify.ts. */
export function datasetFileExists(): boolean {
  return fs.existsSync(getDatasetPath());
}
