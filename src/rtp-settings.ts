/**
 * RTP-CLAIM wiring — Duel Limbo: the per-setting exact RTP table and the claim it is held to.
 *
 * The rule is src/rtp-claim.ts, a byte-identical copy of the framework's core/rtp-claim.ts (its
 * SHA-256 is compared by conformance C-13), version 1.2.0 (Methodology v1.1, agreed 2026-10-14;
 * 1.0.0 agreed on Slack 2026-09-29). The enforcement switch RTP_CLAIM_RULE_ENFORCED is the
 * package's own src/rtp-claim-switch.ts, set to true (decision D3): the outcome is scored on the
 * step carrying LIMBO-19, and a house-side miss makes the verdict RTP FIGURE OVERSTATED (exit 5),
 * never NOT PROVABLY FAIR. The claim names one of the rule's six places: the game settings.
 *
 * SETTINGS. Every legal 2-dp target from MIN_TARGET_CENTS (1.01×) to the operator's max_target
 * (limboConfig.json): 9,999,900 settings. Too many rows to commit: the table carries per-decade
 * buckets, the true min and max rows and every house-side row up to RETAIN_ROWS; every setting is
 * still scored exactly.
 * EXACT RTP. T · W(t) / 2^32 with W(t) the winning draws COUNTED on the result formula of src/rng.ts
 * (rebuilt from docs/ALGORITHM.md) at the declared floor edge 1/1000, exact-rational reading of the win rule
 * (src/exact.ts winMinUnits / winningDraws — the same count Step 26 makes). Scope: the floor edge;
 * a bet whose potential profit passes the 25,000 scaling onset is priced higher (Step 20; config-implied rule).
 * CLAIM. Flat 0.1 % house edge = RTP 999/1000, a stated edge in the game settings (decision D2):
 * scaling_edge min_edge 0.001 in Duel's limbo config (limboConfig.json; E12, as fetched 2026-10-05),
 * the edge served on every captured bet as house_edge_percentage 0.1 (src/capture-plan.ts:82
 * CLAIMED_EDGE; declaration gameModel.edge.claimSource).
 *
 *   npm run rtp-claim:write    rewrite outputs/rtp-claim-table.json and print its SHA-256 to pin
 */
import * as path from 'path';
import * as fs from 'fs';
import { createHash } from 'crypto';
import { RtpClaim, RtpClaimAccumulator, RtpClaimResult, rtpClaimTable, rtpClaimGate, RtpClaimGate } from './rtp-claim';
import { CLAIMED_EDGE, MIN_TARGET_CENTS } from './capture-plan';
import { winMinUnits, winningDraws, TWO32 } from './exact';
import { loadConfig } from './scaling-edge';

export const RTP_CLAIM: RtpClaim = {
  kind: 'flat',
  rtp: '0.999',
  source: 'game settings: scaling_edge min_edge 0.001 in Duel\'s limbo config (limboConfig.json; E12, as fetched 2026-10-05), served on every captured bet as house_edge_percentage 0.1 (src/capture-plan.ts:82; declaration gameModel.edge.claimSource)',
};

/** The scored step that carries the per-target half of LIMBO-19 (src/profile-map.ts). */
export const RTP_CLAIM_STEP = 26;
/** House-side rows kept in the committed table beyond the buckets and the two extremes. */
export const RETAIN_ROWS = 1000;

export const RTP_CLAIM_TABLE = path.join(__dirname, '..', 'outputs', 'rtp-claim-table.json');
/** SHA-256 of the committed table — re-pin with the run that rewrote it (npm run rtp-claim:write). */
export const RTP_CLAIM_TABLE_SHA256 = 'e26e7b2bfbf41985e18cf8cc21c34db8d220eb1f48892a5f366e79f7c9ab939b';

const DECADES: Array<[number, number, string]> = ([[101, 200], [200, 1000], [1000, 10000], [10000, 100000], [100000, 1000000], [1000000, 10000001]] as const)
  .map(([lo, hi]) => [lo, hi, `${(lo / 100).toFixed(2)}× – <${(hi / 100).toFixed(2)}×`]);
const decade = (c: number): string => {
  for (const [lo, hi, name] of DECADES) if (c >= lo && c < hi) return name;
  return 'other';
};

export function computeRtpClaim(): RtpClaimResult {
  const tMax = Math.round(loadConfig().maxTarget * 100);
  const A = CLAIMED_EDGE.num, B = CLAIMED_EDGE.den;
  const D = 100 * TWO32;
  const acc = new RtpClaimAccumulator(RTP_CLAIM, { retainRows: RETAIN_ROWS });
  for (let t = MIN_TARGET_CENTS; t <= tMax; t++) {
    const W = winningDraws(winMinUnits(t, A, B));
    acc.add(() => `target=${(t / 100).toFixed(2)}`, t * W, D, decade(t));
  }
  return acc.result();
}

export function rtpClaimTableText(r: RtpClaimResult): string {
  return rtpClaimTable(r, {
    package: 'duel/limbo', game: 'limbo',
    settingSpace: 'every legal 2-dp target 1.01× … max_target (limboConfig.json) at the floor edge (9,999,900 settings; rows = extremes + house-side rows up to 1000, buckets = per decade)',
    rtpMethod: 'exact rational: T·W(t)/2^32, W(t) counted by bisection on the operator result formula at edge 1/1000 (exact-rational win rule)',
  });
}

export function runRtpClaimGate(): RtpClaimGate {
  const r = computeRtpClaim();
  return rtpClaimGate(r, rtpClaimTableText(r), RTP_CLAIM_TABLE, RTP_CLAIM_TABLE_SHA256);
}

if (require.main === module) {
  const text = rtpClaimTableText(computeRtpClaim());
  fs.writeFileSync(RTP_CLAIM_TABLE, text);
  console.log(`wrote outputs/rtp-claim-table.json sha256 ${createHash('sha256').update(text).digest('hex')}`);
}
