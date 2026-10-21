/**
 * Steps 18–19: Simulation
 *
 * Step 18 re-derives every Pass 1 statistic from the pinned artifact's raw census (bin counts, serial
 * sums, win counts) and compares each target with its EXACT win probability W(t)/2^32 recomputed here
 * from src/exact.ts — never with a scalar the simulator wrote about itself.
 *
 * Step 19 is Pass 2, computed entirely in verify from the pinned dataset: every revealed seed is
 * replayed over 10,000 nonces and the captured window is ranked against the 199 later windows.
 */

import * as fs   from 'fs';
import * as path from 'path';
import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import { computeResultUnitsFromBuffer } from '../../src/rng';
import { winMinUnits, winningDraws, targetCents, unitsFromDecimal, TWO32 } from '../../src/exact';
import { chiSquaredTest, normalCdf } from '../../src/stats';
import {
  SIM_MASTER_SEED, ROUNDS_PER_TARGET, TARGETS_CENTS, SIM_EDGE, UNIFORMITY_DRAWS, UNIFORMITY_BINS,
} from '../../src/simulate';
import { EXPECTED_EPOCHS, EPOCH_SIZE, NONCE_BASE, PASS2_NONCES, CLAIMED_EDGE } from '../../src/capture-plan';

/** Family-wise level for Pass 1: every per-target RTP test + the uniformity chi-squared + the serial test. */
const FAMILY_ALPHA = 0.01;
/** Pass 2 pre-registered one-sided rule: cherry-picking is indicated when the rank-sum Z is below this. */
const PASS2_Z_CRIT = -3.0902323061678132; // one-sided α = 0.001

/** Inverse standard normal (Acklam), for the Bonferroni critical value printed in Step 18. */
function probit(p: number): number {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425;
  if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > 1 - pl) return -probit(1 - p);
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export function run(ctx: VerifyContext): StepResult[] {
  const artifactPath = path.join(ctx.outputsDir, 'simulation-results.json');

  // ── Step 18: Pass 1, re-derived from the pinned census ───────────────────────
  let s18: StepResult;
  const NAME18 = 'Simulation Pass-1 (pinned seeds: draw uniformity + exact-RTP convergence)';
  let art: any = null;
  try { art = JSON.parse(fs.readFileSync(artifactPath, 'utf-8')); } catch { /* handled below */ }
  const rows: any[] = art?.pass1?.targets ?? [];
  const uni = art?.pass1?.uniformity;
  const issues: string[] = [];
  if (!art) issues.push('outputs/simulation-results.json missing or unreadable');
  else {
    // G-BIND: the artifact's design must equal the producer's constants, never the artifact's own header
    if (art.masterSeed !== SIM_MASTER_SEED) issues.push(`masterSeed ${art.masterSeed} ≠ SIM_MASTER_SEED`);
    if (art.simulatedEdge?.num !== SIM_EDGE.num || art.simulatedEdge?.den !== SIM_EDGE.den
      || SIM_EDGE.num !== CLAIMED_EDGE.num || SIM_EDGE.den !== CLAIMED_EDGE.den) issues.push('simulated edge ≠ the declared edge');
    const cents = rows.map(r => r.targetCents);
    if (cents.length !== TARGETS_CENTS.length || cents.some((c, i) => c !== TARGETS_CENTS[i])) issues.push(`targets [${cents}] ≠ TARGETS_CENTS`);
    if (rows.some(r => r.rounds !== ROUNDS_PER_TARGET)) issues.push('a target row does not carry ROUNDS_PER_TARGET rounds');
    if (!uni || uni.draws !== UNIFORMITY_DRAWS || uni.bins !== UNIFORMITY_BINS || !Array.isArray(uni.counts)
      || uni.counts.length !== UNIFORMITY_BINS || uni.counts.reduce((a: number, b: number) => a + b, 0) !== UNIFORMITY_DRAWS
      || uni.counts.some((c: number) => !Number.isInteger(c) || c < 0)) issues.push('uniformity census does not match UNIFORMITY_DRAWS / UNIFORMITY_BINS');
  }
  const nTests = TARGETS_CENTS.length + 2;
  const perTestAlpha = FAMILY_ALPHA / nTests;
  const zCrit = -probit(perTestAlpha / 2);
  let worstZ = 0, worstT = 0, rtpFails = 0;
  const perTarget: string[] = [];
  let chi = { chi2: NaN, df: 0, pValue: NaN }, serialZ = NaN;
  if (!issues.length) {
    for (const r of rows) {
      if (!Number.isInteger(r.wins) || r.wins < 0 || r.wins > r.rounds) { issues.push(`target ${r.targetCents}: impossible win count ${r.wins}`); continue; }
      const W = winningDraws(winMinUnits(r.targetCents, SIM_EDGE.num, SIM_EDGE.den));
      const p = W / TWO32;
      if (!(p > 0 && p < 1)) { issues.push(`target ${r.targetCents}: exact win probability ${p} not in (0,1) — the reference is broken`); continue; }
      const z = (r.wins - r.rounds * p) / Math.sqrt(r.rounds * p * (1 - p));
      if (Math.abs(z) > Math.abs(worstZ)) { worstZ = z; worstT = r.targetCents / 100; }
      if (Math.abs(z) > zCrit) rtpFails++;
      const T = r.targetCents / 100;
      perTarget.push(`${T}x RTP ${(r.wins * T / r.rounds).toFixed(5)} vs exact ${(T * p).toFixed(6)} (z ${z.toFixed(2)})`);
    }
    chi = chiSquaredTest(uni.counts, new Array(UNIFORMITY_BINS).fill(UNIFORMITY_DRAWS / UNIFORMITY_BINS));
    const s = uni.serial;
    const n = s.n, mean = s.sumX / n;
    const varSum = s.sumXX - n * mean * mean;
    const cov = s.sumLag1Products - mean * (2 * s.sumX - s.first - s.last) + (n - 1) * mean * mean;
    const r1 = varSum > 0 ? cov / varSum : NaN;
    serialZ = r1 * Math.sqrt(n);
    if (!Number.isFinite(serialZ)) issues.push('serial statistic not finite');
  }
  const uniOk = chi.pValue >= perTestAlpha, serOk = Math.abs(serialZ) < zCrit;
  s18 = issues.length
    ? step(18, NAME18, 'FAIL', issues.join('; '))
    : step(18, NAME18, rtpFails === 0 && uniOk && serOk ? 'PASS' : 'FAIL',
      `pinned seeds (SIM_MASTER_SEED "${SIM_MASTER_SEED}"), every statistic re-derived here from the artifact's census: ` +
      `draw uniformity ${UNIFORMITY_DRAWS.toLocaleString('en-US')} uint32 draws in ${UNIFORMITY_BINS} equal bins — chi2 ${chi.chi2.toFixed(2)} ` +
      `(df ${chi.df}), p ${chi.pValue.toFixed(4)}; lag-1 serial z ${serialZ.toFixed(3)}; RTP at ${rows.length} targets × ` +
      `${ROUNDS_PER_TARGET.toLocaleString('en-US')} rounds against the EXACT win probability W(t)/2^32 (src/exact.ts, declared edge ` +
      `${SIM_EDGE.num}/${SIM_EDGE.den}): worst |z| ${Math.abs(worstZ).toFixed(2)} at ${worstT}x, ${rtpFails} beyond the family-wise ` +
      `critical value ${zCrit.toFixed(3)} (α ${FAMILY_ALPHA} over ${nTests} tests, Bonferroni). ${perTarget.join('; ')}`);

  // ── Step 19: Pass 2 — cherry-pick screen over 10,000 nonces per revealed seed ────────────────────
  // For every betting epoch, the targets the casino actually served at nonces 0..49 are replayed on
  // nonces 0..PASS2_NONCES−1 (nonce n bets the target served at nonce n mod 50), unit stake, under the
  // declared edge. The 10,000 nonces form 200 disjoint windows of 50 that bet the same targets in the
  // same order, so under "no cherry-pick" the captured window (window 0) is exchangeable with the other
  // 199 and its rank among the 200 standardized window returns is uniform — an EXACT permutation null,
  // no bootstrap, no assumed rate. Rank sums over epochs give Z; the pre-registered one-sided rule
  // flags Z < PASS2_Z_CRIT (captured windows systematically worse for the player). The replay of
  // window 0 must also reproduce every captured result exactly.
  const { bets, seedMap, byHash } = ctx;
  let epochs = 0, replayMismatch = 0, rankSum = 0, rankVar = 0, below = 0, above = 0, noncesTotal = 0;
  let earlyRet = 0, earlyExp = 0;
  const kMinCache = new Map<number, number>(), pCache = new Map<number, number>();
  const pOf = (t: number) => {
    if (!pCache.has(t)) { const k = winMinUnits(t, CLAIMED_EDGE.num, CLAIMED_EDGE.den); kMinCache.set(t, k); pCache.set(t, winningDraws(k) / TWO32); }
    return pCache.get(t)!;
  };
  const WINDOWS = PASS2_NONCES / EPOCH_SIZE;
  for (const [hash, group] of byHash) {
    const seed = seedMap.get(hash);
    if (!seed) continue;
    epochs++;
    const key = Buffer.from(seed, 'hex');
    const client = group[0].response.client_seed;
    const served = new Array<number>(EPOCH_SIZE);
    const servedResult = new Array<string>(EPOCH_SIZE);
    for (const b of group) { served[b.response.nonce - NONCE_BASE] = targetCents(b.response.target)!; servedResult[b.response.nonce - NONCE_BASE] = b.response.result; }
    let mu = 0, v = 0;
    for (const t of served) { const p = pOf(t); const T = t / 100; mu += T * p; v += T * T * p * (1 - p); }
    const S: number[] = [];
    for (let w = 0; w < WINDOWS; w++) {
      let ret = 0;
      for (let j = 0; j < EPOCH_SIZE; j++) {
        const n = NONCE_BASE + w * EPOCH_SIZE + j;
        const k = computeResultUnitsFromBuffer(key, client, n);
        noncesTotal++;
        if (w === 0 && unitsFromDecimal(servedResult[j], 6) !== BigInt(k)) replayMismatch++;
        const t = served[j];
        if (k >= kMinCache.get(t)!) ret += t / 100;
      }
      S.push((ret - mu) / Math.sqrt(v));
      if (w === 0) { earlyRet += ret; earlyExp += mu; }
    }
    // mid-rank of window 0 among the 200, and its exact permutation variance
    const ranks = S.map(x => S.filter(y => y < x).length + (S.filter(y => y === x).length + 1) / 2);
    const meanR = (WINDOWS + 1) / 2;
    rankSum += ranks[0] - meanR;
    rankVar += ranks.reduce((a, r) => a + (r - meanR) ** 2, 0) / WINDOWS;
    if (ranks[0] < meanR) below++; else if (ranks[0] > meanR) above++;
  }
  const Z = rankSum / Math.sqrt(rankVar);
  const pOne = normalCdf(Z);
  // detection power: fraction f of epochs whose captured window sits in its worst decile (mean rank
  // shift ≈ −90 of 200) that the rule detects with ≥ 50 % probability
  const fDetect = (-PASS2_Z_CRIT) * Math.sqrt(rankVar) / (0.45 * WINDOWS * epochs);
  const s19ok = epochs === EXPECTED_EPOCHS && noncesTotal === EXPECTED_EPOCHS * PASS2_NONCES && replayMismatch === 0;
  const s19 = step(19, 'Simulation Pass-2 (cherry-pick screen, 10,000 nonces per revealed seed)',
    !s19ok || Z < PASS2_Z_CRIT ? 'FAIL' : 'PASS',
    `${epochs}/${EXPECTED_EPOCHS} revealed betting epochs × ${PASS2_NONCES.toLocaleString('en-US')} nonces ` +
      `(${noncesTotal.toLocaleString('en-US')} results, each window betting the targets the casino served in that epoch, ` +
      `declared edge ${CLAIMED_EDGE.num}/${CLAIMED_EDGE.den}); window 0 replays the ${EPOCH_SIZE} captured results: ` +
      `${replayMismatch} mismatches. Exact permutation null (window 0 exchangeable with the other ${WINDOWS - 1}): rank-sum ` +
      `Z = ${Z.toFixed(3)} (one-sided p = ${pOne.toFixed(4)}; pre-registered rule: cherry-pick indicated at Z < ${PASS2_Z_CRIT.toFixed(3)}, α 0.001). ` +
      `Direction split: captured window below its epoch median in ${below} epochs, above in ${above}. Captured-window ` +
      `return ${earlyRet.toFixed(2)} vs expectation ${earlyExp.toFixed(2)} (unit stakes). Power: detects with ≥ 50% ` +
      `probability a cherry-pick that puts ≥ ${(fDetect * 100).toFixed(1)}% of epochs' captured windows in their worst decile`);

  return [s18, s19];
}
