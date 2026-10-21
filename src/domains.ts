/**
 * Duel Limbo — VALUE DOMAINS for every numeric leaf of the pinned JSON artifacts of record
 * (outputs/simulation-results.json, chi-squared-results.json, determinism-log.json, capture-power.json).
 *
 * A SHA-256 pin proves only that the bytes have not moved since they were pinned; a forger who doctors
 * a scalar re-pins in the same commit. So every numeric leaf must also lie in a domain of PHYSICAL
 * POSSIBILITY whose bounds come from src/ (the audited population, the simulation design) — never from
 * the artifact being checked — and every numeric leaf path must be covered by an explicit rule: a new
 * numeric field with no declared domain FAILS Step 21. Nothing here rejects a value for being surprising.
 * (Ported in shape from pf-duel-workspace/games/dice/src/domains.ts, 2026-09-26.)
 */

import { EXPECTED_BETS, PLAN, PLANNED_TOTAL } from './capture-plan';
import { ROUNDS_PER_TARGET, TARGETS_CENTS, UNIFORMITY_DRAWS, UNIFORMITY_BINS, SNAPSHOTS, SIM_EDGE } from './simulate';

type Pred = (v: number, path: string) => boolean;
const int = (v: number) => Number.isInteger(v);
const prob: Pred = v => v >= 0 && v <= 1;
const nonNegFinite: Pred = v => Number.isFinite(v) && v >= 0;

/** [artifact, path regex over the normalised path (array indexes as []), label, predicate]. */
const RULES: Array<[string, RegExp, string, Pred]> = [
  ['simulation-results.json', /^simulatedEdge\.num$/, `= SIM_EDGE.num`, v => v === SIM_EDGE.num],
  ['simulation-results.json', /^simulatedEdge\.den$/, `= SIM_EDGE.den`, v => v === SIM_EDGE.den],
  ['simulation-results.json', /^pass1\.uniformity\.(draws|serial\.n)$/, `= UNIFORMITY_DRAWS`, v => v === UNIFORMITY_DRAWS],
  ['simulation-results.json', /^pass1\.uniformity\.bins$/, `= UNIFORMITY_BINS`, v => v === UNIFORMITY_BINS],
  ['simulation-results.json', /^pass1\.uniformity\.counts\[\]$/, 'integer in [0, UNIFORMITY_DRAWS]', v => int(v) && v >= 0 && v <= UNIFORMITY_DRAWS],
  ['simulation-results.json', /^pass1\.uniformity\.serial\.sumX$/, '[0, UNIFORMITY_DRAWS)', v => v >= 0 && v < UNIFORMITY_DRAWS],
  ['simulation-results.json', /^pass1\.uniformity\.serial\.sumXX$/, '[0, UNIFORMITY_DRAWS)', v => v >= 0 && v < UNIFORMITY_DRAWS],
  ['simulation-results.json', /^pass1\.uniformity\.serial\.sumLag1Products$/, '[0, UNIFORMITY_DRAWS − 1)', v => v >= 0 && v < UNIFORMITY_DRAWS - 1],
  ['simulation-results.json', /^pass1\.uniformity\.serial\.(first|last)$/, '[0, 1)', v => v >= 0 && v < 1],
  ['simulation-results.json', /^pass1\.targets\[\]\.targetCents$/, 'one of TARGETS_CENTS', v => TARGETS_CENTS.includes(v)],
  ['simulation-results.json', /^pass1\.targets\[\]\.rounds$/, '= ROUNDS_PER_TARGET', v => v === ROUNDS_PER_TARGET],
  ['simulation-results.json', /^pass1\.targets\[\]\.wins$/, 'integer in [0, ROUNDS_PER_TARGET]', v => int(v) && v >= 0 && v <= ROUNDS_PER_TARGET],
  ['simulation-results.json', /^pass1\.targets\[\]\.snapshots\[\]\.n$/, 'one of SNAPSHOTS', v => SNAPSHOTS.includes(v)],
  ['simulation-results.json', /^pass1\.targets\[\]\.snapshots\[\]\.wins$/, 'integer in [0, ROUNDS_PER_TARGET]', v => int(v) && v >= 0 && v <= ROUNDS_PER_TARGET],
  ['chi-squared-results.json', /^groups\[\]\.observedWins$/, 'integer in [0, EXPECTED_BETS]', v => int(v) && v >= 0 && v <= EXPECTED_BETS],
  ['chi-squared-results.json', /^groups\[\]\.expectedWins$/, '[0, EXPECTED_BETS]', v => v >= 0 && v <= EXPECTED_BETS],
  ['chi-squared-results.json', /^groups\[\]\.chi2$/, 'finite, ≥ 0', nonNegFinite],
  ['chi-squared-results.json', /^groups\[\]\.df$/, 'positive integer', v => int(v) && v >= 1],
  ['chi-squared-results.json', /^groups\[\]\.pValue$/, '[0, 1]', prob],
  ['determinism-log.json', /^(verified|mismatches|skipped)$/, 'integer in [0, EXPECTED_BETS]', v => int(v) && v >= 0 && v <= EXPECTED_BETS],
  ['capture-power.json', /^trialsPerRow$/, 'positive integer', v => int(v) && v > 0],
  ['capture-power.json', /^declaredEdge$/, '= SIM_EDGE', v => v === SIM_EDGE.num / SIM_EDGE.den],
  ['capture-power.json', /^step9TightThresholdPP$/, '(0, 100]', v => v > 0 && v <= 100],
  ['capture-power.json', /^frozenPlan\.(A|B|C|D)$/, '= PLAN[phase]', (v, p) => v === (PLAN as Record<string, number>)[p.slice(-1)]],
  ['capture-power.json', /^frozenPlan\.total$/, '= PLANNED_TOTAL', v => v === PLANNED_TOTAL],
  ['capture-power.json', /^frozenPlan\.turnoverUSD$/, 'finite, > 0', v => Number.isFinite(v) && v > 0],
  ['capture-power.json', /^\w+\[\]\.edge$/, '[0, 1)', v => v >= 0 && v < 1],
  ['capture-power.json', /^\w+\[\]\.(phaseA|phaseB|totalBets)$/, 'integer in [0, 100000]', v => int(v) && v >= 0 && v <= 100_000],
  ['capture-power.json', /^\w+\[\]\.phaseBTarget$/, 'a legal target ≥ 1.01', v => v >= 1.01],
  ['capture-power.json', /^\w+\[\]\.(pStep9Pass|pStep9PassSE|pWithin0_05pp|pWithin0_02pp)$/, '[0, 1]', prob],
  ['capture-power.json', /^\w+\[\]\.widthPP\.(p05|p50|p95|max|mean)$/, 'finite, ≥ 0 (percentage points)', nonNegFinite],
  ['capture-power.json', /^\w+\[\]\.missedTrueEdge$/, 'integer ≥ 0', v => int(v) && v >= 0],
];

export const DOMAIN_ARTIFACTS = ['simulation-results.json', 'chi-squared-results.json', 'determinism-log.json', 'capture-power.json'];

function numericLeaves(o: unknown, at: string, out: Array<[string, number]>): void {
  if (o && typeof o === 'object') {
    const arr = Array.isArray(o);
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) numericLeaves(v, arr ? `${at}[]` : at ? `${at}.${k}` : k, out);
  } else if (typeof o === 'number') out.push([at, o]);
}

/** Every numeric leaf of one artifact: out-of-domain values and paths with no rule. */
export function checkDomains(file: string, json: unknown): { leaves: number; violations: string[]; uncovered: string[] } {
  const leaves: Array<[string, number]> = [];
  numericLeaves(json, '', leaves);
  const violations: string[] = [], uncovered = new Set<string>();
  for (const [p, v] of leaves) {
    const rule = RULES.find(([f, re]) => f === file && re.test(p));
    if (!rule) { uncovered.add(p); continue; }
    if (!Number.isFinite(v) || !rule[3](v, p)) violations.push(`${file} ${p} = ${v} (domain ${rule[2]})`);
  }
  return { leaves: leaves.length, violations, uncovered: [...uncovered].map(p => `${file} ${p}`) };
}
