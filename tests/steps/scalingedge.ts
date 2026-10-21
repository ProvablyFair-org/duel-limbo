/**
 * Step 20: Scaling Edge — which edge was actually applied, exactly, to every captured bet.
 *
 * Limbo's operator config declares a bet-size-dependent edge floored at `min_edge` and
 * ceilinged at `max_edge` (a 10x range). A report that states a single "house edge" without
 * saying which stake range it holds over is making an unqualified claim about a quantity the
 * operator's config declares as variable.
 *
 * This step closes that by recomputing the edge from each bet's own fields rather than
 * asserting a constant: `edge = 1 - target x winChance` is exact per bet, so 7,700 bets give
 * 7,700 independent exact readings, not one noisy average. The step PASSES only if every
 * reading sits at the declared floor AND every bet was checked; a single bet above the floor
 * means scaling engaged inside the capture and the step FAILS rather than smoothing it out.
 */

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import { loadConfig, exposureCap, scalingOnset, maxProfit, exactEdgeFromBet, potentialProfit } from '../../src/scaling-edge';
import { num } from '../../src/types';

const EPS = 1e-9;

export function run(ctx: VerifyContext): StepResult[] {
  const { bets } = ctx;

  let cfg;
  try {
    cfg = loadConfig();
  } catch (e) {
    return [step(20, 'Scaling Edge (bet-size dependence)', 'FAIL',
      `limboConfig.json missing or unreadable (${String(e).slice(0, 80)}) — the operator's declared ` +
      `edge bounds are the reason a single flat edge cannot be claimed; without the artifact this step asserts nothing`)];
  }

  const p = cfg.scalingEdge;
  const onset = scalingOnset(p);   // bankroll x min_edge: potential profit where the config-implied rule leaves the floor
  const ceiling = maxProfit(p);    // bankroll x max_edge: the 1% ceiling and the largest profit a bet can carry
  const maxLoss = exposureCap(p);  // max_loss_fraction x bankroll: never binds under the rule (ceiling < maxLoss)
  const n = (x: number) => x.toLocaleString('en-US');

  if (bets.length === 0) {
    return [step(20, 'Scaling Edge (bet-size dependence)', 'FLAG',
      `no bets captured yet — config declares enabled=${p.enabled}, floor ${(p.minEdge * 100).toFixed(4)}%, ` +
      `ceiling ${(p.maxEdge * 100).toFixed(4)}%, scaling onset ${n(onset)} potential profit, ceiling at ${n(ceiling)}`)];
  }

  let checked = 0, offFloor = 0, maxProfitSeen = 0, maxStake = 0;
  let minSeen = Infinity, maxSeen = -Infinity;
  const examples: string[] = [];

  for (const b of bets) {
    const target = num(b.response.target);
    const wc = num(b.response.win_chance);
    if (!Number.isFinite(target) || !Number.isFinite(wc) || target <= 0) continue;

    const edge = exactEdgeFromBet(target, wc);
    checked++;
    if (edge < minSeen) minSeen = edge;
    if (edge > maxSeen) maxSeen = edge;

    const stake = parseFloat(b.request.amount);
    const profit = potentialProfit(stake, target);
    if (profit > maxProfitSeen) maxProfitSeen = profit;
    if (stake > maxStake) maxStake = stake;

    if (Math.abs(edge - p.minEdge) > EPS) {
      offFloor++;
      if (examples.length < 3) {
        examples.push(`nonce ${b.response.nonce}: stake ${stake} target ${target} -> edge ${(edge * 100).toFixed(6)}%`);
      }
    }
  }

  // COVERAGE: a step that silently skips bets proves nothing about the ones it skipped.
  const coverageOk = checked === bets.length;
  const allAtFloor = offFloor === 0;
  const onsetHeadroom = onset / (maxProfitSeen || 1);

  const detail =
    `${checked}/${bets.length} bets, edge RECOMPUTED per bet from target x win_chance (exact, no sampling error): ` +
    `observed ${(minSeen * 100).toFixed(6)}%–${(maxSeen * 100).toFixed(6)}% against a declared floor of ` +
    `${(p.minEdge * 100).toFixed(4)}% and ceiling of ${(p.maxEdge * 100).toFixed(4)}%. ` +
    `Largest stake ${maxStake}, largest potential profit (stake x (target − 1)) ${maxProfitSeen.toFixed(2)} vs ` +
    `${n(onset)} = bankroll x min_edge, where the rule implied by the config (limboConfig.json, captured ` +
    `${cfg.capturedAt}) lifts the edge off the floor ` +
    `(${n(Math.floor(onsetHeadroom))}x headroom); the 1% ceiling is reached at bankroll x max_edge = ${n(ceiling)}, ` +
    `which is also the largest profit a bet can carry, and max_loss_fraction x bankroll = ${n(maxLoss)} never binds. ` +
    `The capture never approaches the scaling onset, so these readings characterise the FLOOR only and say nothing ` +
    `about the edge above it. ` +
    (allAtFloor ? '' : `${offFloor} bet(s) OFF the floor: ${examples.join('; ')}. `) +
    (coverageOk ? '' : `COVERAGE FAIL: ${bets.length - checked} bet(s) skipped. `) +
    `Config: enabled=${p.enabled}, bankroll ${n(p.bankroll)}, max_loss_fraction ${p.maxLossFraction}.`;

  return [step(20, 'Scaling Edge (bet-size dependence)',
    coverageOk && allAtFloor ? 'PASS' : 'FAIL', detail)];
}
