/**
 * Simulation Pass 1 for Duel Limbo — pinned, replayable, no run metadata.
 *
 * REBUILT 2026-09-26 (profile LIMBO-20). The former Pass 1 drew crypto.randomBytes per target (not
 * replayable), carried `generatedAt`, never tested the draw's uniformity, and compared each target's
 * RTP with the approximation 1 − edge rather than the exact per-target RTP. Now:
 *
 *   seeds      every server/client seed is derived from SIM_MASTER_SEED (below) by SHA-256, so a
 *              regeneration reproduces the artifact byte-for-byte on the same runtime;
 *   uniformity UNIFORMITY_DRAWS draws of the uint32 value, histogrammed into UNIFORMITY_BINS equal
 *              bins (the COUNTS are stored, so verify re-derives chi-squared from them), plus the lag-1
 *              serial correlation of v/2^32 (stored as its sums, re-derived in verify);
 *   RTP        ROUNDS_PER_TARGET rounds at each of TARGETS under the published win rule at SIM_EDGE,
 *              evaluated exactly in integer units (src/exact.ts); the stored census is the WIN COUNT,
 *              and the exact expected win probability W(t)/2^32 is recomputed in verify from src/exact.ts;
 *   chart      outputs/rtp-convergence.html from the stored snapshots, no timestamp.
 *
 * Pass 2 (cherry-pick screen over 10,000 nonces per revealed seed) is computed in verify itself
 * (tests/steps/simulation.ts, Step 19) from the pinned dataset — there is no Pass 2 artifact to trust.
 *
 * Output: `npm run simulate` (PF_EMIT=1) writes the artifacts of record to outputs/;
 *         `npm run simulate:run` writes to outputs/run/ so verify can field-diff a regeneration.
 */

import * as fs   from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { computeResultUnitsFromBuffer, DRAW_HEX_CHARS } from './rng';
import { winMinUnits } from './exact';

export const SIM_MASTER_SEED = 'duel-limbo-pass1-2026-09-26';
export const ROUNDS_PER_TARGET = 1_000_000;
/** Target hundredths: 1.10x … 100,000x (max_target) — thirteen targets spanning every decade of the legal range. */
export const TARGETS_CENTS = [110, 125, 150, 200, 300, 500, 1000, 2500, 5000, 10000, 100000, 1000000, 10000000];
/** Operator-declared floor edge (limboConfig.json min_edge = house_edge_percentage 0.1). */
export const SIM_EDGE: { num: number; den: number } = { num: 1, den: 1000 };
export const UNIFORMITY_DRAWS = 2_000_000;
export const UNIFORMITY_BINS = 1000;
export const SNAPSHOTS = [1_000, 10_000, 100_000, 500_000, 1_000_000];

const derive = (label: string) => crypto.createHash('sha256').update(`${SIM_MASTER_SEED}:${label}`).digest();

export interface TargetRow {
  targetCents: number;
  rounds: number;
  wins: number;
  serverSeedLabel: string;
  snapshots: { n: number; wins: number }[];
}

export function pass1(): { uniformity: Record<string, unknown>; targets: TargetRow[] } {
  // Uniformity of the raw draw v on [0, 2^32)
  const key = derive('uniformity:server');
  const client = derive('uniformity:client').toString('hex').slice(0, 16);
  const bins = new Array<number>(UNIFORMITY_BINS).fill(0);
  let sx = 0, sxx = 0, sxy = 0, first = 0, prev = -1;
  for (let n = 0; n < UNIFORMITY_DRAWS; n++) {
    const h = crypto.createHmac('sha256', key).update(`${client}:${n}`).digest('hex');
    const v = parseInt(h.slice(0, DRAW_HEX_CHARS), 16);
    bins[Math.floor((v * UNIFORMITY_BINS) / 2 ** 32)]++;
    const x = v / 2 ** 32;
    sx += x; sxx += x * x;
    if (prev >= 0) sxy += prev * x; else first = x;
    prev = x;
  }
  const uniformity = {
    draws: UNIFORMITY_DRAWS, bins: UNIFORMITY_BINS, counts: bins,
    serial: { n: UNIFORMITY_DRAWS, sumX: sx, sumXX: sxx, sumLag1Products: sxy, first, last: prev },
  };

  const targets: TargetRow[] = [];
  for (const t of TARGETS_CENTS) {
    const label = `target:${t}`;
    const k = derive(`${label}:server`);
    const c = derive(`${label}:client`).toString('hex').slice(0, 16);
    const kMin = winMinUnits(t, SIM_EDGE.num, SIM_EDGE.den);
    let wins = 0;
    const snaps: { n: number; wins: number }[] = [];
    for (let n = 0; n < ROUNDS_PER_TARGET; n++) {
      if (computeResultUnitsFromBuffer(k, c, n) >= kMin) wins++;
      if (SNAPSHOTS.includes(n + 1)) snaps.push({ n: n + 1, wins });
    }
    targets.push({ targetCents: t, rounds: ROUNDS_PER_TARGET, wins, serverSeedLabel: label, snapshots: snaps });
    // eslint-disable-next-line no-console
    console.log(`target ${t / 100}: ${wins} wins / ${ROUNDS_PER_TARGET}`);
  }
  return { uniformity, targets };
}

function chartHtml(rows: TargetRow[]): string {
  const tr = rows.map(r => {
    const T = r.targetCents / 100;
    const cells = r.snapshots.map(s => `<td>${((s.wins * T) / s.n).toFixed(6)}</td>`).join('');
    return `<tr><td>${T}</td>${cells}</tr>`;
  }).join('\n');
  return `<!doctype html><meta charset="utf-8"><title>Limbo RTP convergence</title>
<h1>Duel Limbo — RTP convergence (Pass 1, pinned seeds)</h1>
<p>Realised RTP (wins × T / n) at n = ${SNAPSHOTS.join(', ')} rounds per target, at the declared floor edge
${SIM_EDGE.num}/${SIM_EDGE.den}. Seeds derived from SIM_MASTER_SEED "${SIM_MASTER_SEED}". The exact per-target RTP and
the family-wise tolerance are computed in verify (Step 18), not stored here.</p>
<table border="1" cellpadding="6"><tr><th>Target</th>${SNAPSHOTS.map(n => `<th>n=${n}</th>`).join('')}</tr>
${tr}</table>
`;
}

function main(): void {
  const outDir = path.join(__dirname, '../outputs');
  const dest = process.env.PF_EMIT === '1' ? outDir : path.join(outDir, 'run');
  fs.mkdirSync(dest, { recursive: true });
  const p1 = pass1();
  const artifact = {
    masterSeed: SIM_MASTER_SEED,
    simulatedEdge: SIM_EDGE,
    edgeProvenance: 'limboConfig.json min_edge = house_edge_percentage 0.1 on every captured bet; the Step 9 bracket contains it',
    winRule: 'result units k win iff k·(den−num)·100 >= targetCents·den·1e4 (src/exact.ts winMinUnits)',
    pass1: p1,
  };
  fs.writeFileSync(path.join(dest, 'simulation-results.json'), JSON.stringify(artifact, null, 2));
  fs.writeFileSync(path.join(dest, 'rtp-convergence.html'), chartHtml(p1.targets));
  // eslint-disable-next-line no-console
  console.log(`wrote ${path.relative(path.join(__dirname, '..'), dest)}/simulation-results.json and rtp-convergence.html`);
}

if (require.main === module) main();
