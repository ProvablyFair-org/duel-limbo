/**
 * Duel Limbo audit — verification suite. 30 scored steps + informational items.
 * Run: npm run verify            (writes run products to outputs/run/ only; committed artifacts untouched)
 *      npm run report            (PF_EMIT=1: refreshes the committed artifacts of record in outputs/)
 * Target: 30/30 PASS, verdict PROVABLY FAIR — Full Pass
 *
 * The dataset hash guard runs FIRST and aborts on mismatch, so no step can
 * "pass" against absent or altered data.
 */

import * as fs   from 'fs';
import * as path from 'path';

import { loadDataset, checkDatasetHash, buildSeedMap, groupByHash, datasetExists } from '../src/loader';
import type { VerifyContext, InfoItem } from './steps/context';

import * as commitment  from './steps/commitment';
import * as determinism from './steps/determinism';
import * as payouts     from './steps/payouts';
import * as dataset     from './steps/dataset';
import * as simulation  from './steps/simulation';
import * as scalingedge from './steps/scalingedge';
import * as statistical from './steps/statistical';
import * as artifacts   from './steps/artifacts';
import * as exact       from './steps/exact';
import { labelFor, profileCoverageBlock } from '../src/profile-map';
import { runRtpClaimGate, RTP_CLAIM_STEP } from '../src/rtp-settings';
import { rtpClaimVerdict, RTP_FIGURE_OVERSTATED, RTP_FIGURE_OVERSTATED_EXIT } from '../src/rtp-claim';
import { fieldDiff, beyondTolerance, maxima, DIFF_ATOL, DIFF_RTOL } from '../src/diff';
import { AUDIT_ID } from '../src/capture-plan';

// ── Pre-flight: dataset must exist and match its pinned hash ──────────────────

if (!datasetExists()) {
  console.log('\n  No dataset at data/limbo-master.json.');
  console.log('  The capture has not been run yet — nothing to verify.');
  console.log('  This is a defensive branch: the delivered repo ships the frozen dataset.\n');
  process.exit(1);
}

const hashCheck = checkDatasetHash();
console.log('\n  Dataset hash check:');
console.log(`    Expected: ${hashCheck.expected || '<unpinned>'}`);
console.log(`    Actual:   ${hashCheck.actual}`);
console.log(`    Status:   ${hashCheck.match ? 'MATCH ✓' : 'MISMATCH ✗ — abort'}\n`);
if (!hashCheck.match) process.exit(1);

// ── Setup ─────────────────────────────────────────────────────────────────────

const ds      = loadDataset();
const seedMap = buildSeedMap(ds.seeds);

const bets   = ds.bets;
const seeds  = ds.seeds;
const phaseA = bets.filter(b => b.phase === 'A');
const phaseB = bets.filter(b => b.phase === 'B');
const phaseC = bets.filter(b => b.phase === 'C');
const phaseD = bets.filter(b => b.phase === 'D');

const outputsDir = path.join(__dirname, '../outputs');

console.log('══════════════════════════════════════════════════════════');
console.log('  DUEL LIMBO AUDIT — VERIFICATION SUITE');
console.log('══════════════════════════════════════════════════════════');
console.log(`  Dataset: ${bets.length} bets  |  Seeds: ${seeds.length}`);
console.log(`  Phase A: ${phaseA.length}  Phase B: ${phaseB.length}  Phase C: ${phaseC.length}  Phase D: ${phaseD.length}\n`);

const ctx: VerifyContext = {
  bets, seeds, seedMap,
  byHash: groupByHash(bets),
  phaseA, phaseB, phaseC, phaseD,
  outputsDir,
  determinismMismatches: 0,
  determinismSkipped:    0,
  measuredEdge:          null,
  chiResultsLog:         [],
};

// ── Scored steps ──────────────────────────────────────────────────────────────

const results = [
  ...commitment.run(ctx),   // Steps  1– 4
  ...determinism.run(ctx),  // Steps  5– 7
  ...payouts.run(ctx),      // Steps  8–12
  ...dataset.run(ctx),      // Steps 13–17
  ...simulation.run(ctx),   // Steps 18–19
  ...scalingedge.run(ctx),  // Step  20
  ...artifacts.run(ctx),    // Step 21
  ...exact.run(ctx),        // Steps 22–30
];

// ── Informational items ───────────────────────────────────────────────────────

const infoItems: InfoItem[] = statistical.run(ctx);

// ── RTP-CLAIM rule (1.2.0, Methodology v1.1; 1.0.0 agreed on Slack 2026-09-29) ──
// The per-setting exact RTP table held to the published claim (src/rtp-settings.ts). The package
// switch RTP_CLAIM_RULE_ENFORCED is true (D3, 2026-10-14). Status OVERSTATED (a house-side miss) is
// scored on the step carrying LIMBO-19 as an operator-origin FLAG (the profile's policy) and the
// verdict becomes RTP FIGURE OVERSTATED, exit 5 (rtpClaimVerdict) — never NOT PROVABLY FAIR: the
// draws themselves pass. Status FAIL means the committed table no longer equals this run (or its
// pin): a reproduction failure, exit 1, whether or not the rule is enforced; no step moves for it.
const rtpClaim = runRtpClaimGate();
console.log('');
for (const line of rtpClaim.lines) console.log(`  ${line}`);
const rtpOverstated = rtpClaim.status === 'OVERSTATED';
if (rtpOverstated) {
  const s = (results as any[]).find(r => r.step === RTP_CLAIM_STEP);
  if (s && s.status !== 'FAIL') {
    s.status = 'FLAG'; s.origin = 'operator';
    s.detail += ` — ${RTP_FIGURE_OVERSTATED} (RTP-CLAIM enforced): ${rtpClaim.result.minimalFix}`;
    // The step printed its own line when it ran, before this rule was scored. Print it again at the
    // status it is now counted at, so the console agrees with the summary and the emitted record.
    console.log(`  [FLAG] Step ${s.step} — ${s.name} (re-scored: RTP-CLAIM enforced, ${RTP_FIGURE_OVERSTATED})`);
    console.log(`         ${s.detail}`);
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
// A FLAG's ORIGIN decides whether it bears on the verdict (profile policy FLAG, decided 2026-09-17):
// operator → Conditional Pass (exit 2); capture → disclosed, verdict-neutral (exit 0).
// A flag with no origin defaults to operator, so an unclassified flag can only err toward disclosure.
// An INFO step (profile policy INFORMATIONAL — the live-sample fit, Mike 2026-09-29) is reported and
// never counted: it is not a flag and it never enters the verdict.
const passed   = results.filter(r => r.status === 'PASS').length;
const flags    = results.filter(r => r.status === 'FLAG').length;
const hardFail = results.filter(r => r.status === 'FAIL').length;
const informational = results.filter(r => r.status === 'INFO').length;
const captureFlags  = results.filter(r => r.status === 'FLAG' && r.origin === 'capture').length;
const operatorFlags = flags - captureFlags;
// Ranked by the rule's rtpClaimVerdict: a failed draw check (NOT PROVABLY FAIR) > RTP FIGURE
// OVERSTATED > Conditional Pass > Full Pass. This suite has no INCOMPLETE state.
const ruled    = rtpClaimVerdict({ fails: hardFail, complete: true, overstated: rtpOverstated, opFlags: operatorFlags });
const verdict  = ruled.verdict;

if (infoItems.length > 0) {
  console.log('');
  console.log('  ┌── Informational Context (not scored) ──');
  for (const item of infoItems) console.log(`  │ ${item.label}: ${item.detail}`);
  console.log('  └──');
}

console.log('\n══════════════════════════════════════════════════════════');
console.log('  RESULTS SUMMARY');
console.log('══════════════════════════════════════════════════════════');
console.log(`  Passed:     ${passed}/${results.length}`);
console.log(`  Hard fails: ${hardFail}`);
console.log(`  Flags:      ${flags} (${operatorFlags} verdict-affecting, ${captureFlags} capture-origin)`);
if (informational) console.log(`  Informational deviations: ${informational} (reported, not counted, verdict unchanged)`);
if (ctx.measuredEdge?.bracketed) {
  const e = ctx.measuredEdge;
  console.log(`\n  MEASURED HOUSE EDGE: ${(e.point * 100).toFixed(4)}%  ` +
              `(bracket ${(e.lower * 100).toFixed(6)}% – ${(e.upper * 100).toFixed(6)}%, ${e.witnesses} witnesses)`);
}
// The RTP printed is the one at the declared edge, exact over every legal target (the same enumeration
// as Step 26). 1 − the measured midpoint is not printed: it can sit above the 99.9% maximum Step 26 proves.
console.log(`  Theoretical RTP at the declared edge: ${rtpClaim.result.trueMin.rtpPct}%–${rtpClaim.result.trueMax.rtpPct}%  ` +
            `(every legal target, exact count)`);
console.log(`\n  VERDICT: ${verdict}`);
console.log('══════════════════════════════════════════════════════════\n');

// ── Outputs ───────────────────────────────────────────────────────────────────
// ARTIFACTS OF RECORD CARRY NO RUN METADATA (profile LIMBO-27, rules.reproduction): no generatedAt,
// so a regeneration that changes no figure reproduces the pinned bytes. The runtime is recorded in
// outputs/run/diff.json. A VERIFICATION RUN MUST NOT REWRITE THE ARTIFACT IT SCORES: a plain run
// writes under outputs/run/ (gitignored); the committed copies are refreshed only by PF_EMIT=1.
const verificationOutput = {
  auditId:      AUDIT_ID,
  totalBets:    bets.length,
  totalSeeds:   seeds.length,
  measuredEdge: ctx.measuredEdge,
  steps:        results.map(r => ({ ...r, ...labelFor(r.step) })),
  profileCoverage: profileCoverageBlock(),
  info:         infoItems,
  summary:      { passed, flags, operatorFlags, captureFlags, hardFail, verdict },
};
const determinismOutput = {
  verified:    bets.length - ctx.determinismSkipped,
  mismatches:  ctx.determinismMismatches,
  skipped:     ctx.determinismSkipped,
};
const chiSquaredOutput = { groups: ctx.chiResultsLog };

const PF_EMIT = process.env.PF_EMIT === '1';
const RUN_DIR = path.join(outputsDir, 'run');
const RESULTS_DIR = PF_EMIT ? outputsDir : RUN_DIR;
fs.mkdirSync(RUN_DIR, { recursive: true });
fs.writeFileSync(path.join(RESULTS_DIR, 'verification-results.json'), JSON.stringify(verificationOutput, null, 2));
fs.writeFileSync(path.join(RESULTS_DIR, 'determinism-log.json'), JSON.stringify(determinismOutput, null, 2));
fs.writeFileSync(path.join(RESULTS_DIR, 'chi-squared-results.json'), JSON.stringify(chiSquaredOutput, null, 2));
const WROTE_TO = PF_EMIT ? 'outputs' : 'outputs/run';
console.log(`  Outputs written to: ${WROTE_TO}/verification-results.json, determinism-log.json, chi-squared-results.json`);
if (!PF_EMIT) console.log('  Committed artifacts NOT modified.');

// ── Reproduction gate ─────────────────────────────────────────────────────────
// The committed artifacts are field-diffed against this run (src/diff.ts: integers and strings exact,
// non-integers within 1e-14 + 1e-12·max). When `npm run test:full` has regenerated the simulation
// into outputs/run/, that regeneration is diffed against the pinned artifact too.
let reproductionFailures = 0;
if (!PF_EMIT) {
  const readJsonOrNull = (p: string): unknown => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
  const targets: { file: string; fresh: unknown }[] = [
    { file: 'verification-results.json', fresh: verificationOutput },
    { file: 'determinism-log.json',      fresh: determinismOutput },
    { file: 'chi-squared-results.json',  fresh: chiSquaredOutput },
  ];
  const runSim = readJsonOrNull(path.join(RUN_DIR, 'simulation-results.json'));
  if (runSim !== null) targets.push({ file: 'simulation-results.json', fresh: runSim });
  const perFile = targets.map(t => {
    const committed = readJsonOrNull(path.join(outputsDir, t.file));
    const diffs = fieldDiff(committed, t.fresh, []);
    return { file: t.file, readable: committed !== null, diffs, real: beyondTolerance(diffs) };
  });
  const allDiffs  = perFile.flatMap(p => p.diffs);
  const realTotal = perFile.reduce((n, p) => n + p.real.length, 0);
  const gap       = maxima(allDiffs);
  fs.writeFileSync(path.join(RUN_DIR, 'diff.json'), JSON.stringify({
    runtime: process.versions.node, verdict,
    tolerance: { atol: DIFF_ATOL, rtol: DIFF_RTOL },
    reproduced: realTotal === 0, beyondToleranceCount: realTotal,
    withinToleranceCount: allDiffs.length - realTotal, largestGap: gap,
    files: perFile.map(p => ({ file: `outputs/${p.file}`, committedReadable: p.readable, differences: p.diffs })),
  }, null, 2));
  console.log(`  Reproduction vs the committed artifacts on Node ${process.versions.node}: `
    + `${realTotal === 0 ? 'REPRODUCED' : `${realTotal} field(s) BEYOND TOLERANCE`}`
    + `${allDiffs.length - realTotal > 0 ? ` (${allDiffs.length - realTotal} within tolerance)` : ''}`
    + ` — compared: ${perFile.map(p => p.file).join(', ')}`);
  if (realTotal > 0) {
    console.log('  ⚠ THIS RUN DISAGREES WITH THE COMMITTED EVIDENCE:');
    for (const p of perFile) {
      if (!p.readable) { console.log(`      outputs/${p.file}: committed copy absent or unreadable`); continue; }
      for (const d of p.real.slice(0, 4)) console.log(`      ${p.file} ${d.path}: committed ${JSON.stringify(d.committed)} vs this run ${JSON.stringify(d.thisRun)}`);
    }
  }
  reproductionFailures = realTotal;
} else {
  console.log('  REPORT GENERATION (PF_EMIT=1): the committed artifacts in outputs/ were rewritten.');
}

// ── Exit contract ─────────────────────────────────────────────────────────────
// FAIL or a reproduction beyond tolerance → 1; RTP FIGURE OVERSTATED → 5; an operator-origin FLAG → 2;
// otherwise 0.
if (hardFail > 0 || reproductionFailures > 0 || !rtpClaim.tableMatches) process.exit(1);
if (ruled.exit === RTP_FIGURE_OVERSTATED_EXIT) process.exit(RTP_FIGURE_OVERSTATED_EXIT);
if (operatorFlags > 0) process.exit(2);
