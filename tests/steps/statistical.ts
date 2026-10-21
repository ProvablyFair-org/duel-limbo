/**
 * Informational items — live-bet statistics.
 *
 * NOT scored. A 7,700-bet capture is far too small to say anything decisive
 * about a game whose payout distribution has a 4.29-billion-times tail: the
 * realised RTP over a capture of this size carries a standard error of whole
 * percentage points. These figures are published as context and as a sanity
 * check for gross anomalies, never as RTP evidence. RTP evidence comes from the
 * theoretical derivation plus the Pass-1 simulation.
 */

import type { InfoItem } from './context';
import { VerifyContext } from './context';
import { chiSquaredTest, lagOneAutocorrelation, waldsWolfowitzRunsTest } from '../../src/stats';
import { num } from '../../src/types';

export function run(ctx: VerifyContext): InfoItem[] {
  const { bets } = ctx;
  const items: InfoItem[] = [];
  if (bets.length === 0) return items;

  const edge = ctx.measuredEdge?.bracketed ? ctx.measuredEdge.point : null;

  // Realised return over the capture
  let staked = 0, returned = 0, wins = 0;
  for (const b of bets) {
    const stake = parseFloat(b.request.amount);
    staked   += stake;
    returned += b.response.is_win ? stake * b.request.target : 0;
    if (b.response.is_win) wins++;
  }
  items.push({
    label:  'Realised RTP over the capture',
    detail: `${((returned / staked) * 100).toFixed(4)}% over ${bets.length} bets ` +
            `(${wins} wins) — variance illustration, not RTP evidence`,
  });

  // Expected wins under the measured edge, and a chi-squared on win/lose
  if (edge !== null) {
    let expectedWins = 0;
    for (const b of bets) expectedWins += (1 - edge) / b.request.target;
    const { chi2, df, pValue } = chiSquaredTest(
      [wins, bets.length - wins],
      [expectedWins, bets.length - expectedWins],
    );
    ctx.chiResultsLog.push({ group: 'win-lose', observedWins: wins, expectedWins, chi2, df, pValue });
    items.push({
      label:  'Win count vs measured edge',
      detail: `observed ${wins}, expected ${expectedWins.toFixed(2)} — chi2 ${chi2.toFixed(4)} (df ${df}), p ${pValue.toFixed(4)}`,
    });
  }

  // Serial independence on the win/lose stream
  const stream = bets.map(b => (b.response.is_win ? 1 : 0));
  // CORRECTED 2026-09-26: lagOneAutocorrelation returns the correlation r1, not a z-score; this line
  // used to print r1 labelled "z". z = r1·√n. The win/lose stream carries phase block structure
  // (Phases B and C bet 1.01x and win ~99%), so it is not an RNG serial test — Step 30 is.
  const lag1   = lagOneAutocorrelation(stream);
  const runs   = waldsWolfowitzRunsTest(stream);
  items.push({
    label:  'Serial dependence of the win/lose stream (phase-structured, not an RNG test)',
    detail: `lag-1 r ${lag1.toFixed(4)}, z = r·√n ${(lag1 * Math.sqrt(stream.length)).toFixed(2)}; runs p ${runs.pValue.toFixed(4)} — ` +
            `dominated by the phase blocks (B and C bet 1.01x); the RNG serial screen is Step 30 on 1/R`,
  });

  // Edge bracket recomputed independently per target band — a target-DEPENDENT
  // edge could hide inside the pooled Step 9 bracket (the pooled bound is
  // dominated by whichever band closes tightest). Every band's own bracket
  // containing the same edge is the evidence that the threshold edge is
  // target-independent, as the model asserts.
  if (edge !== null) {
    const bands: Array<[number, number]> = [[1.01, 1.02], [1.02, 1.5], [1.5, 5], [5, 50], [50, 1000]];
    const parts: string[] = [];
    let allContain = true;
    for (const [lo, hi] of bands) {
      let up = Infinity, low = -Infinity, n = 0;
      for (const b of bets) {
        const T = b.request.target;
        if (T < lo || T >= hi) continue;
        n++;
        const bound = 1 - T / num(b.response.result);
        if (b.response.is_win) { if (bound < up) up = bound; } else if (bound > low) low = bound;
      }
      const contains = low < edge && edge <= up;
      if (n > 0 && !contains) allContain = false;
      parts.push(`[${lo},${hi}) n=${n}: (${(low * 100).toFixed(4)}%, ${(up * 100).toFixed(4)}%]${contains ? '' : ' EXCLUDES the measured edge'}`);
    }
    items.push({
      label: 'Edge bracket by target band (target-independence evidence)',
      detail: parts.join('; ') + (allContain ? ' — every band contains the measured edge' : ' — INCONSISTENT ACROSS BANDS'),
    });
  }

  // Distribution of the raw fair multiplier against its known law P(R >= x) = 1/x
  const decades = [2, 10, 100, 1000];
  const tail = decades.map(x => {
    const obs = bets.filter(b => num(b.response.result) >= x).length;
    const exp = bets.length / x;
    return `>=${x}x: ${obs} obs / ${exp.toFixed(1)} exp`;
  });
  items.push({ label: 'Fair-multiplier tail vs P(R >= x) = 1/x', detail: tail.join(', ') });

  return items;
}
