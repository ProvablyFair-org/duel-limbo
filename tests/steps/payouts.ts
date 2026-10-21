/**
 * Steps 8–12: Payout Math and House-Edge Measurement
 *
 * This is the centre of the Limbo audit. Duel's own verifier states the fair
 * multiplier carries NO house edge — the edge is applied by the backend to the
 * win threshold: a bet at target T wins iff result >= T / (1 - edge).
 *
 * The edge is therefore invisible to anyone verifying a multiplier, and it is a
 * backend parameter we must MEASURE rather than assume. The derivation is exact
 * and needs no cooperation from the operator:
 *
 *   win  at (T, R):  R >= T/(1-e)  ⇔  e <= 1 - T/R     → an UPPER bound on e
 *   loss at (T, R):  R <  T/(1-e)  ⇔  e >  1 - T/R     → a LOWER bound on e
 *
 * Taking the min over wins and the max over losses brackets the true edge. With
 * a wide spread of targets the bracket closes tightly around the real value.
 * The operator's own `effective_edge` field is then cross-checked against this
 * measurement — never used to produce it.
 */

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import { num } from '../../src/types';
import { unitsFromDecimal } from '../../src/exact';
import { EXPECTED_BETS, WIN_CHANCE_DISPLAY_TOL } from '../../src/capture-plan';

export function run(ctx: VerifyContext): StepResult[] {
  const { bets } = ctx;

  // ── Step 8: payout math — EXACT on the money grid, against the chosen target ──
  // Stake, target, credited amount and the multiplier echo are all served as decimal STRINGS, so
  // they are compared as integers on a common grid (1e-20: 18-dp amounts × 2-dp targets), never as
  // floats. The former relative tolerance (1e-12) was a bound where no bound is needed: on this
  // grid the identity  amount_won == amount × target  is exact or it is wrong.
  const AMT_DP = 18, TGT_DP = 2;
  let payoutErrors = 0, echoErrors = 0, targetDisagree = 0, unparsable = 0, wins = 0;
  const payoutExamples: string[] = [];
  for (const b of bets) {
    const stake = unitsFromDecimal(b.request.amount, AMT_DP);
    const won   = unitsFromDecimal(b.response.amount_won, AMT_DP);
    const tgt   = unitsFromDecimal(b.response.target, TGT_DP);
    const echo  = unitsFromDecimal(b.response.multiplier, AMT_DP);
    const reqT  = unitsFromDecimal(String(b.request.target), TGT_DP);
    if (stake === null || won === null || tgt === null || echo === null || reqT === null) { unparsable++; continue; }
    if (reqT !== tgt) targetDisagree++;
    // the multiplier echo is the target on an 18-dp grid
    if (echo !== tgt * 10n ** BigInt(AMT_DP - TGT_DP)) echoErrors++;
    const expected = b.response.is_win ? stake * tgt : 0n;       // units of 1e-20
    const paid     = won * 10n ** BigInt(TGT_DP);                 // units of 1e-20
    if (b.response.is_win) wins++;
    if (expected !== paid) {
      payoutErrors++;
      if (payoutExamples.length < 3) payoutExamples.push(`bet ${b.response.id}: expected ${b.request.amount} × ${b.response.target}, paid ${b.response.amount_won}`);
    }
  }
  const s8 = step(8, 'Payout Math (stake x target, exact on the money grid)',
    bets.length === EXPECTED_BETS && payoutErrors === 0 && echoErrors === 0 && targetDisagree === 0 && unparsable === 0 ? 'PASS' : 'FAIL',
    `${bets.length}/${EXPECTED_BETS} bets compared as integers on the 1e-20 grid (18-dp amounts × 2-dp targets, parsed from ` +
      `the served strings): ${wins} wins paid exactly amount × target, losses exactly 0 — ${payoutErrors} payout errors; ` +
      `${echoErrors} bets whose 18-dp multiplier echo differs from the target; ${targetDisagree} whose requested and served ` +
      `target differ; ${unparsable} unparsable` + (payoutExamples.length ? ` — ${payoutExamples.join('; ')}` : ''),
  );

  // ── Step 9: measure the house edge from the win/lose boundary ────────────────
  let upper = Infinity;   // min over wins of 1 - T/R
  let lower = -Infinity;  // max over losses of 1 - T/R
  let upperWitness = '', lowerWitness = '', witnesses = 0;

  for (const b of bets) {
    const T = num(b.request.target);
    const R = num(b.response.result);
    if (!(T > 0) || !(R > 0)) continue;
    const bound = 1 - T / R;
    witnesses++;
    if (b.response.is_win) {
      if (bound < upper) { upper = bound; upperWitness = `bet ${b.response.id} (T=${T}, R=${R})`; }
    } else if (bound > lower) {
      lower = bound; lowerWitness = `bet ${b.response.id} (T=${T}, R=${R})`;
    }
  }

  const bracketed = Number.isFinite(lower) && Number.isFinite(upper) && lower < upper;
  const point     = bracketed ? (lower + upper) / 2 : NaN;
  ctx.measuredEdge = { lower, upper, point, witnesses, bracketed };

  // A bracket that is merely non-empty is not a measurement. Require it to be
  // tight enough to state an edge to two decimal places; otherwise FLAG with the
  // width, so a weak capture cannot masquerade as a precise result.
  // Threshold justified by a power analysis over candidate capture plans: the
  // bracket closes only when results land near the threshold, and since
  // P(R >= x) = 1/x the expected closest approach after n bets at target T is
  // ~T/n. Low targets therefore pin the edge roughly an order of magnitude
  // faster than high ones. Measured over 1,500 simulated captures of the frozen
  // plan (src/capture-power.ts -> outputs/capture-power.json): Phase B at 1.01x
  // gives a median width of 0.057 pp and clears this threshold on 78.3% of runs,
  // against 0.143 pp / 31.7% with the same 2,000 bets placed at 10x. 0.10 pp is
  // therefore what the planned capture can actually achieve on a typical run,
  // and is tight enough to identify a round edge — but it is a threshold the
  // capture can miss, which is why missing it FLAGs rather than FAILs.
  const widthPP = (upper - lower) * 100;
  const TIGHT_PP = 0.10;
  const s9 = step(9, 'House Edge Measured from Win/Lose Boundary',
    !bracketed ? 'FAIL' : widthPP <= TIGHT_PP ? 'PASS' : 'FLAG',
    bracketed
      ? `edge bracketed to (${lower.toFixed(8)}, ${upper.toFixed(8)}] from ${witnesses} bets ` +
        `-> ${(point * 100).toFixed(4)}% (width ${widthPP.toFixed(6)} pp, tight threshold ${TIGHT_PP} pp). ` +
        `Tightest loss: ${lowerWitness}; tightest win: ${upperWitness}` +
        (widthPP <= TIGHT_PP ? '' : ' — widen target coverage or capture more bets to tighten')
      : `could not bracket the edge (lower=${lower}, upper=${upper}) — need bets on both sides of the threshold across a spread of targets`,
  );

  // ── Step 10: every settlement consistent with the measured edge ──────────────
  // Uses the measured value only; if Step 9 failed this cannot be evaluated.
  let condErrors = 0;
  const condExamples: string[] = [];
  if (bracketed) {
    for (const b of bets) {
      const threshold = b.request.target / (1 - point);
      const expectedWin = num(b.response.result) >= threshold;
      if (expectedWin !== b.response.is_win) {
        condErrors++;
        if (condExamples.length < 3) {
          condExamples.push(
            `bet ${b.response.id}: T=${b.request.target}, R=${b.response.result}, ` +
            `threshold ${threshold.toFixed(6)}, recorded is_win=${b.response.is_win}`);
        }
      }
    }
  }
  const s10 = step(10, 'Win Condition (result >= target / (1 - measured edge))',
    bracketed && condErrors === 0 ? 'PASS' : 'FAIL',
    bracketed
      ? `${bets.length} settlements reproduced from the measured edge; ${condErrors} disagreements` +
        (condExamples.length ? ` — ${condExamples.join('; ')}` : '')
      : 'not evaluated — edge could not be measured (Step 9)',
  );

  // ── Step 11: operator's reported edge vs our measurement ─────────────────────
  //
  // Duel reports TWO edge fields, `house_edge_percentage` and `effective_edge`.
  //
  // Step 9 measures the DISTRIBUTION edge from the win/lose boundary, so the
  // like-for-like comparison is against house_edge_percentage. That is what is
  // scored here.
  //
  // `effective_edge` is reported alongside, NOT characterised. An earlier note
  // recorded it as 0 (read as a net edge after a "Zero Edge" rakeback); the
  // pre-flight bets of 2026-08-31 returned effective_edge = house_edge_percentage
  // = 0.1 on all five, so that reading did not reproduce. Until the capture
  // settles it, this step states both values and says which one it scored,
  // rather than explaining a difference that may not exist.
  const reportedDist = [...new Set(
    bets.map(b => b.response.house_edge_percentage).filter(e => e != null),
  )].map(e => e / 100);
  const reportedNet = [...new Set(bets.map(b => b.response.effective_edge).filter(e => e != null))];

  let reportedConsistent = false;
  if (bracketed && reportedDist.length === 1) {
    reportedConsistent = reportedDist[0] > lower && reportedDist[0] <= upper;
  }
  const s11 = step(11, 'Operator-Reported Edge Cross-Check (distribution edge)',
    !bracketed ? 'FAIL' : reportedDist.length === 0 ? 'FLAG' : reportedConsistent ? 'PASS' : 'FAIL',
    reportedDist.length === 0
      ? 'no house_edge_percentage field in the dataset — the measurement stands alone'
      : reportedDist.length > 1
        ? `operator reported multiple distribution edges: ${reportedDist.join(', ')} — measured bracket (${lower.toFixed(8)}, ${upper.toFixed(8)}]`
        : `operator reports house_edge_percentage ${(reportedDist[0] * 100).toFixed(4)}%; ` +
          `measured bracket (${(lower * 100).toFixed(6)}%, ${(upper * 100).toFixed(6)}%] — ` +
          (reportedConsistent ? 'consistent' : 'INCONSISTENT, the reported edge is outside the measured bracket') +
          `. The operator also reports effective_edge ${reportedNet.join('/')} — recorded, not scored ` +
          `here, and not interpreted: whether it differs from the distribution edge is settled by ` +
          `the wallet reconciliation, not by this step.`,
  );

  // ── Step 12: reported win chance vs the measured edge ────────────────────────
  // The edge is known only to within the bracket, so the reported win chance is
  // tested for consistency with the whole bracket — comparing against the
  // midpoint would manufacture disagreements the data cannot actually support.
  //   edge in (lower, upper]  ⇒  winChance = (1-edge)/T in [(1-upper)/T, (1-lower)/T)
  let wcErrors = 0;
  const wcExamples: string[] = [];
  const DISPLAY_TOL = WIN_CHANCE_DISPLAY_TOL;   // src/capture-plan.ts — guards float noise only, not rounding slack
  if (bracketed) {
    for (const b of bets) {
      const reportedWc = parseFloat(b.response.win_chance);
      if (!Number.isFinite(reportedWc)) continue;
      const T  = num(b.request.target);
      const lo = (1 - upper) / T;      // win_chance is a FRACTION on the live API
      const hi = (1 - lower) / T;      // (0.499500000000000000 at target 2.00)
      if (reportedWc < lo - DISPLAY_TOL || reportedWc > hi + DISPLAY_TOL) {
        wcErrors++;
        if (wcExamples.length < 3) {
          wcExamples.push(
            `bet ${b.response.id}: reported ${reportedWc}, admissible [${lo.toFixed(8)}, ${hi.toFixed(8)}]`);
        }
      }
    }
  }
  const s12 = step(12, 'Reported Win Chance Consistent with Measured Edge Bracket',
    bracketed && wcErrors === 0 ? 'PASS' : bracketed ? 'FLAG' : 'FAIL',
    bracketed
      ? `${bets.length} bets checked against [(1-upper)/T, (1-lower)/T]; ${wcErrors} outside the admissible band` +
        (wcExamples.length ? ` — ${wcExamples.join('; ')}` : '')
      : 'not evaluated — edge could not be measured (Step 9)',
  );

  return [s8, s9, s10, s11, s12];
}
