/**
 * Capture-plan power analysis.
 *
 * The headline result of this audit is the house edge MEASURED from the
 * win/lose boundary (Step 9), and the precision of that measurement is a
 * property of the capture plan, decided before any money is spent. This script
 * is the producing artifact for that claim: it Monte-Carlos the frozen plan
 * against the real RNG and reports how often the bracket actually closes to the
 * Step 9 PASS threshold, so the plan is justified by a committed measurement
 * rather than by prose.
 *
 * Why the bracket behaves the way it does. A win at (T,R) gives edge <= 1 - T/R
 * and a loss gives edge > 1 - T/R, so the bracket closes only when a result
 * lands near the threshold T/(1-edge). Since P(R >= x) = 1/x, the gap to the
 * nearest result on each side is ~Exp(mean T/n), which makes the bracket width
 * Gamma(2, T/n): the EXPECTED width falls as T/n, but the distribution has a
 * tail, and a plan can be typical-case tight while still missing its threshold
 * on a meaningful fraction of runs. That gap between the average and the
 * achieved-with-high-probability width is what this script quantifies.
 *
 * Fresh entropy every run — no pinned seed arrays.
 *
 * Run: npm run power   (~2 min; override with POWER_TRIALS=<n>)
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { computeMultiplier } from './rng';
import { PLAN, PLANNED_TOTAL, PLANNED_TURNOVER, TARGET_RANGE, LOW_TARGET, TIGHT_PP } from './capture-plan';

/** Duel's declared distribution edge (limboConfig.json min_edge, 0.1%). */
const DECLARED_EDGE = 0.001;

const TRIALS = Number(process.env.POWER_TRIALS || 1500);

function randomTarget(): number {
  const lo = Math.log(TARGET_RANGE.lo), hi = Math.log(TARGET_RANGE.hi);
  return parseFloat(Math.exp(lo + Math.random() * (hi - lo)).toFixed(2));
}

/**
 * One simulated capture. Returns the Step 9 bracket it would produce.
 * Each phase runs under its own server-seed epoch, as the capture rotates.
 */
function simulateCapture(edge: number, phases: Array<[number, () => number]>) {
  let upper = Infinity, lower = -Infinity;
  for (const [n, targetFn] of phases) {
    const serverSeed = crypto.randomBytes(32).toString('hex');
    const clientSeed = crypto.randomBytes(6).toString('hex');
    for (let nonce = 1; nonce <= n; nonce++) {
      const T = targetFn();
      const R = computeMultiplier(serverSeed, clientSeed, nonce);
      const bound = 1 - T / R;
      if (R >= T / (1 - edge)) { if (bound < upper) upper = bound; }
      else if (bound > lower) { lower = bound; }
    }
  }
  return { lower, upper, widthPP: (upper - lower) * 100 };
}

const splitPhases = (a: number, b: number, bTarget = LOW_TARGET): Array<[number, () => number]> => [
  [a, randomTarget],
  [b, () => bTarget],
  [PLAN.C, () => LOW_TARGET],
  [PLAN.D, randomTarget],
];

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

/**
 * Memoised so a configuration appearing in more than one table is MEASURED
 * once. Two independent estimates of the same plan differ by the Monte Carlo
 * error alone, and printing both invites the reader to wonder which is real.
 */
const cache = new Map<string, ReturnType<typeof runTrials>>();

function measure(edge: number, phaseA: number, phaseB: number, bTarget = LOW_TARGET) {
  const key = `${edge}|${phaseA}|${phaseB}|${bTarget}`;
  if (!cache.has(key)) cache.set(key, runTrials(edge, phaseA, phaseB, bTarget));
  return cache.get(key)!;
}

function runTrials(edge: number, phaseA: number, phaseB: number, bTarget: number) {
  const widths: number[] = [];
  let missedTrueEdge = 0;
  for (let t = 0; t < TRIALS; t++) {
    const r = simulateCapture(edge, splitPhases(phaseA, phaseB, bTarget));
    widths.push(r.widthPP);
    if (!(r.lower < edge && edge <= r.upper)) missedTrueEdge++;
  }
  const sorted = widths.slice().sort((x, y) => x - y);
  const atOrUnder = (thr: number) => widths.filter(w => w <= thr).length / TRIALS;
  const pPass = atOrUnder(TIGHT_PP);
  return {
    edge, phaseA, phaseB, phaseBTarget: bTarget,
    totalBets: phaseA + phaseB + PLAN.C + PLAN.D,
    pStep9Pass:      pPass,
    /** Monte Carlo standard error on pStep9Pass — these are estimates, not constants. */
    pStep9PassSE:    Math.sqrt(pPass * (1 - pPass) / TRIALS),
    pWithin0_05pp:   atOrUnder(0.05),
    pWithin0_02pp:   atOrUnder(0.02),
    widthPP: {
      p05:  percentile(sorted, 0.05),
      p50:  percentile(sorted, 0.50),
      p95:  percentile(sorted, 0.95),
      max:  sorted[sorted.length - 1],
      mean: widths.reduce((a, b) => a + b, 0) / TRIALS,
    },
    missedTrueEdge,
  };
}

// ── Frozen plan, at the declared edge and at a 10x larger one ─────────────────

const frozen = [DECLARED_EDGE, 0.01].map(edge => measure(edge, PLAN.A, PLAN.B));

// ── Alternative A/B splits at the SAME total bets and the same turnover ───────
// Phases A and B are both $0.01, so moving bets between them costs nothing.

const alternatives = [[PLAN.A, PLAN.B], [4000, 3000], [3500, 3500], [3000, 4000], [2000, 5000]]
  .map(([a, b]) => measure(DECLARED_EDGE, a, b));

// ── Why Phase B is a LOW target — the claim the whole plan rests on ───────────
// Same 2,000 bets, same stake, same cost; only the target they are placed at
// changes. Bracket width scales as T/n, so a high-target Phase B buys tail
// coverage that Phase A already provides while barely moving the edge bracket.

const phaseBTargetComparison = [LOW_TARGET, 10, 100]
  .map(t => measure(DECLARED_EDGE, PLAN.A, PLAN.B, t));

const out = {
  generatedBy: 'src/capture-power.ts',
  trialsPerRow: TRIALS,
  declaredEdge: DECLARED_EDGE,
  step9TightThresholdPP: TIGHT_PP,
  frozenPlan: { ...PLAN, total: PLANNED_TOTAL, turnoverUSD: PLANNED_TURNOVER },
  frozenPlanPower: frozen,
  phaseBTargetComparison,
  alternativeSplits: alternatives,
  note:
    'Bracket width is Gamma(2, T/n): the mean falls as T/n but the tail is heavy, so a plan ' +
    'can be tight on average and still miss the Step 9 threshold on a large minority of runs. ' +
    'Phases A and B share a $0.01 stake, so reallocating between them changes precision at ' +
    'identical cost. Fresh entropy each run — figures move slightly between runs.',
};

const outputsDir = path.join(__dirname, '..', 'outputs');
fs.mkdirSync(outputsDir, { recursive: true });
fs.writeFileSync(path.join(outputsDir, 'capture-power.json'), JSON.stringify(out, null, 2));

const pc = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log(`\n  Capture-plan power — ${TRIALS} simulated captures per row, fresh entropy`);
console.log(`  Step 9 PASSes only if the bracket is <= ${TIGHT_PP} pp wide\n`);
console.log(`  Frozen plan: A ${PLAN.A} / B ${PLAN.B} / C ${PLAN.C} / D ${PLAN.D} = ${PLANNED_TOTAL} bets, $${PLANNED_TURNOVER.toFixed(2)} turnover`);
for (const r of frozen) {
  console.log(`    edge ${(r.edge * 100).toFixed(1)}%  P(Step 9 PASS) ${pc(r.pStep9Pass)} +/- ${pc(r.pStep9PassSE)}   ` +
    `width pp p50 ${r.widthPP.p50.toFixed(4)} / p95 ${r.widthPP.p95.toFixed(4)} / max ${r.widthPP.max.toFixed(4)}   ` +
    `bracket missed the true edge ${r.missedTrueEdge}/${TRIALS}`);
}
console.log(`\n  Why Phase B is a LOW target — same ${PLAN.B} bets, same cost, target varied:`);
console.log('    Phase B target   P(PASS)   width p50    p95');
for (const r of phaseBTargetComparison) {
  console.log(`    ${String(r.phaseBTarget).padStart(8)}x   ${pc(r.pStep9Pass).padStart(8)}   ` +
    `${r.widthPP.p50.toFixed(4)}  ${r.widthPP.p95.toFixed(4)}`);
}

console.log(`\n  Alternative A/B splits at edge ${(DECLARED_EDGE * 100).toFixed(1)}% — same ${PLANNED_TOTAL} bets, same $${PLANNED_TURNOVER.toFixed(2)}:`);
console.log('    split           P(PASS)   P(<=0.05pp)  P(<=0.02pp)   width p50    p95');
for (const r of alternatives) {
  console.log(`    A=${String(r.phaseA).padStart(4)} B=${String(r.phaseB).padStart(4)}   ` +
    `${pc(r.pStep9Pass).padStart(6)} ${pc(r.pWithin0_05pp).padStart(11)} ${pc(r.pWithin0_02pp).padStart(12)}   ` +
    `${r.widthPP.p50.toFixed(4)}  ${r.widthPP.p95.toFixed(4)}`);
}
console.log('\n  Written: outputs/capture-power.json\n');
