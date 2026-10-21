/**
 * Duel Limbo — bet-size-dependent house edge ("scaling edge").
 *
 * Limbo's house edge is NOT a single constant. `limboConfig.json`, recorded verbatim from
 * the operator's own `GET /api/v2/limbo/config`, carries:
 *
 *     scaling_edge: { enabled, bankroll, min_edge, max_edge, max_loss_fraction }
 *
 * `min_edge` (0.1%) is the FLOOR and `max_edge` (1%) the CEILING — a 10x range. The endpoint
 * serves these values, not a formula, and Duel's Verify tab (evidence/verify-tab, E10) says only
 * that the round multiplier changes with the bet size and the scaling edge. Read as a cap on
 * potential profit (bankroll x edge), the config of 2026-08-21 implies
 * edge = stake x (target - 1) / bankroll, clamped to [min_edge, max_edge]: the floor holds while a
 * bet's potential profit is at most bankroll x min_edge (25,000), the ceiling is reached at
 * bankroll x max_edge (250,000), which is also the largest profit a bet can carry, and
 * max_loss_fraction x bankroll (3,000,000) never binds.
 *
 * WHAT THIS MODULE DOES NOT DO: it does not apply or audit that rule. The rule is config-implied;
 * no captured bet leaves the floor, so nothing here exercises it. What this module exposes is:
 *
 *   - the parameters, read from a committed artifact,
 *   - the scaling onset and the ceiling those parameters imply, and the max-loss limit,
 *   - an EXACT per-bet edge derived from the bet's own fields.
 *
 * The last point is what makes this falsifiable rather than descriptive. Limbo's payout
 * identity (see `src/rng.ts`) is `target x winChance = 1 - edge`, so every captured bet
 * reveals the edge that was actually applied to it, exactly and without sampling error.
 * If the captured stake range sits entirely at the floor, that is a measurement, not an
 * assumption — and if a bet ever comes back above the floor, the scored step fails loudly
 * instead of averaging it away.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface ScalingEdgeParams {
  enabled:          boolean;
  bankroll:         number;
  minEdge:          number;
  maxEdge:          number;
  maxLossFraction:  number;
}

export interface LimboConfig {
  maxTarget:    number;
  scalingEdge:  ScalingEdgeParams;
  /** `_captured_at` of the recorded response: the date every scaling-edge statement is scoped to. */
  capturedAt:   string;
}

/**
 * SHA-256 of limboConfig.json — the operator config recorded verbatim on 2026-08-21. Pinned like the
 * dataset: Step 20 reads the declared floor/ceiling from it, so an edited config would move what the
 * step asserts. Step 21 FAILs on a mismatch.
 */
export const CONFIG_SHA256 = '676beff74f5a3c2e9d634a49e994acfc5adc0aa1a19fdc1ee4be36a916b07379';

/** Path to the operator config artifact shipped with this repo. */
export function getConfigPath(): string {
  return path.join(__dirname, '..', 'limboConfig.json');
}

/**
 * SHA-256 of evidence/E12-limbo-config-2026-10-05.json: the duel.com config as fetched 2026-10-05 in
 * a logged-in session (read-only GET), i.e. the response body of the same endpoint,
 * `GET /api/v2/limbo/config`, fetched 12:16:21 UTC and saved unedited. No scored step reads it; the
 * steps read limboConfig.json. tests/limbo/ScalingEdgeTests.ts checks this pin and that its `data`
 * block equals limboConfig.json's, so "the duel.com config as fetched 2026-10-05 in a logged-in
 * session (read-only GET) carries the same values" is re-checked on every npm test. The fetch
 * metadata beside it (.meta.json) is not pinned here; only the release manifest records its hash.
 */
export const CONFIG_2026_10_05_SHA256 = 'ce36245867f930f5587e4ca71d4e2ace5c082dd660c4c6574c888f8fa162eb18';

/** Path to exhibit E12, the duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET). */
export function getConfig20261005Path(): string {
  return path.join(__dirname, '..', 'evidence', 'E12-limbo-config-2026-10-05.json');
}

export function loadConfig(): LimboConfig {
  const raw = JSON.parse(fs.readFileSync(getConfigPath(), 'utf-8'));
  const d = raw.data ?? raw;
  const se = d.scaling_edge ?? {};
  return {
    maxTarget: parseFloat(d.max_target),
    scalingEdge: {
      enabled:         !!se.enabled,
      bankroll:        parseFloat(se.bankroll),
      minEdge:         parseFloat(se.min_edge),
      maxEdge:         parseFloat(se.max_edge),
      maxLossFraction: parseFloat(se.max_loss_fraction),
    },
    capturedAt: typeof raw._captured_at === 'string' ? raw._captured_at : 'undated',
  };
}

/**
 * The max-loss limit `max_loss_fraction x bankroll` (3,000,000). Under the config-implied scaling
 * rule it never binds: the largest profit a bet can carry is `maxProfit()` (bankroll x max_edge,
 * 250,000). Kept as a record of the config's parameters; Steps 20 and 27 compare against
 * `scalingOnset()` and `maxProfit()`.
 */
export function exposureCap(p: ScalingEdgeParams): number {
  return p.maxLossFraction * p.bankroll;
}

/**
 * Potential profit at which the config-implied rule lifts the edge off the floor:
 * `bankroll x min_edge` (25,000). A bet at or below it sits at the floor.
 */
export function scalingOnset(p: ScalingEdgeParams): number {
  return p.bankroll * p.minEdge;
}

/**
 * Potential profit at which the config-implied rule reaches the ceiling: `bankroll x max_edge`
 * (250,000), which is also the largest profit a bet can carry. Implied by the rule, not served
 * as a field.
 */
export function maxProfit(p: ScalingEdgeParams): number {
  return p.bankroll * p.maxEdge;
}

/**
 * EXACT edge applied to one bet, from the bet's own recorded fields.
 * Identity: winChance = (1 - edge) / target  =>  edge = 1 - target x winChance.
 * Deterministic — no sampling error, so a single bet is sufficient evidence.
 */
export function exactEdgeFromBet(target: number, winChance: number): number {
  return 1 - target * winChance;
}

/** Potential payout of a bet — what the operator would owe if it wins. */
export function potentialPayout(stake: number, target: number): number {
  return stake * target;
}

/** Potential profit of a bet — the payout less the stake, `stake x (target - 1)`. The scaling rule reads this. */
export function potentialProfit(stake: number, target: number): number {
  return stake * (target - 1);
}
