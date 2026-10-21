/**
 * Steps 5–7: Determinism
 *
 * Every served result must reproduce from (serverSeed, clientSeed, nonce) under src/rng.ts (rebuilt
 * from the written spec docs/ALGORITHM.md, not from Duel's code) EXACTLY on its 6-dp lattice — compared as integer units parsed from the served decimal
 * string, never as floats. A negative control proves the check can fail, and the nonce audit binds
 * every epoch to the declared base and size.
 */

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import { computeMultiplierFromBuffer, computeResultUnitsFromBuffer, RESULT_DECIMALS } from '../../src/rng';
import { unitsFromDecimal, targetCents, winMinUnits } from '../../src/exact';
import { EXPECTED_BETS, EXPECTED_EPOCHS, EPOCH_SIZE, NONCE_BASE, CAPTURE_RETRY_GAPS, CLAIMED_EDGE } from '../../src/capture-plan';
import { loadConfig, exactEdgeFromBet } from '../../src/scaling-edge';
import { num } from '../../src/types';
import {
  runOperatorVerifier, OPERATOR_EXPECTED_LOGS, OPERATOR_VERIFIER_PROVENANCE, OPERATOR_SCALING_EDGE_NOTE,
} from '../../src/operator-verifier';

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, seedMap } = ctx;

  // ── Step 5: exact reproduction of every result on the 6-dp lattice ───────────
  const keyCache = new Map<string, Buffer>();
  let mismatches = 0, skipped = 0, checked = 0, offGrid = 0;
  const examples: string[] = [];
  for (const b of bets) {
    const seed = seedMap.get(b.response.server_seed_hashed);
    if (!seed) { skipped++; continue; }
    let key = keyCache.get(seed);
    if (!key) { key = Buffer.from(seed, 'hex'); keyCache.set(seed, key); }
    const served = unitsFromDecimal(b.response.result, RESULT_DECIMALS);
    if (served === null) { offGrid++; continue; }
    const recomputed = BigInt(computeResultUnitsFromBuffer(key, b.response.client_seed, b.response.nonce));
    // the float path (multiplier = units / 1e6, printed with toFixed(6)) must land on the same lattice point
    const viaFloat = unitsFromDecimal(computeMultiplierFromBuffer(key, b.response.client_seed, b.response.nonce).toFixed(RESULT_DECIMALS), RESULT_DECIMALS);
    checked++;
    if (recomputed !== served || viaFloat !== served) {
      mismatches++;
      if (examples.length < 3) examples.push(`bet ${b.response.id}: served ${b.response.result}, recomputed ${recomputed} units (float path ${viaFloat})`);
    }
  }
  ctx.determinismMismatches = mismatches;
  ctx.determinismSkipped    = skipped + offGrid;

  // ── Step 5, operator leg: THE OPERATOR'S OWN Verify-tab code (LIMBO-09), a SECOND CHECK ──────────
  // src/rng.ts is rebuilt from the written spec docs/ALGORITHM.md, not from this code; Duel's file is
  // run here as an independent cross-check of that rebuild and of the served results, never as its source.
  // Duel's Limbo code panel, pasted by Paulo from the Verify tab on 2026-09-26, is vendored verbatim
  // under evidence/verify-tab/ and pinned in src/operator-verifier.ts. The pinned runner fills in the
  // file's four "User input values" (clientSeed, serverSeed, nonce, houseEdge) per bet and runs it,
  // as a player would. houseEdge is the edge the package already declares for that bet: Step 20
  // recomputes every bet's applied edge exactly from target × win_chance and requires it at the
  // limboConfig.json floor (min_edge); a bet at the floor gets min_edge, any other bet gets its own
  // recomputed edge. HARD FAIL unless: both pins match, the file ran as shipped printing only its
  // empty-input line, its roll (toFixed(6)) equals the served result AND src/rng.ts as integer 6-dp
  // units on EXPECTED_BETS bets, and what it printed equals what it returned. REPORTED, NOT SCORED (decision-12: no new operator flag): its
  // afterEdge, the multiplier its comment says a bet is scored on ("You win when it reaches the target
  // you picked"), compared on every bet with the served win flag and with the package's exact rule
  // result >= target/(1−e) (Step 24).
  const opIssues: string[] = [];
  const cfg = loadConfig();
  const floor = cfg.scalingEdge.minEdge;
  const opRounds: Array<{ id: string; inputs: { clientSeed: string; serverSeed: string; nonce: number; houseEdge: number } }> = [];
  let atFloor = 0;
  bets.forEach((b, i) => {
    const seed = seedMap.get(b.response.server_seed_hashed);
    if (!seed) return;
    const e = exactEdgeFromBet(num(b.response.target), num(b.response.win_chance));
    const houseEdge = Math.abs(e - floor) <= 1e-9 ? floor : e;
    if (houseEdge === floor) atFloor++;
    opRounds.push({ id: String(i), inputs: { clientSeed: b.response.client_seed, serverSeed: seed, nonce: b.response.nonce, houseEdge } });
  });
  const edgeById = new Map(opRounds.map(x => [x.id, x.inputs.houseEdge] as [string, number]));
  const op = runOperatorVerifier(opRounds);
  let opChecked = 0, opVsServed = 0, opVsRng = 0, opPrinted = 0, opErrors = 0;
  let aeWinServed = 0, aeWinRule = 0, aeN = 0;
  const opFirst: string[] = [];
  if (!op.results) {
    opIssues.push(`operator Verify-tab code: ${op.error}`);
  } else {
    const logsOk = op.shippedLogs.length === OPERATOR_EXPECTED_LOGS.length && op.shippedLogs.every((l, i) => l === OPERATOR_EXPECTED_LOGS[i]);
    if (!logsOk) opIssues.push(`operator Verify-tab code printed ${JSON.stringify(op.shippedLogs).slice(0, 200)} as shipped — not only its empty-input message`);
    bets.forEach((b, i) => {
      const r = op.results!.get(String(i));
      if (r === undefined) return;
      opChecked++;
      if (!r.value || r.error) { opErrors++; if (opFirst.length < 3) opFirst.push(`bet ${b.response.id}: ${r.error ?? 'no value'}`); return; }
      const seed = seedMap.get(b.response.server_seed_hashed)!;
      const roll = unitsFromDecimal(r.value.roll, RESULT_DECIMALS);
      const mine = BigInt(computeResultUnitsFromBuffer(Buffer.from(seed, 'hex'), b.response.client_seed, b.response.nonce));
      if (roll !== unitsFromDecimal(b.response.result, RESULT_DECIMALS)) { opVsServed++; if (opFirst.length < 3) opFirst.push(`bet ${b.response.id}: operator roll ${r.value.roll} vs served ${b.response.result}`); }
      if (roll !== mine) { opVsRng++; if (opFirst.length < 3) opFirst.push(`bet ${b.response.id}: operator roll ${r.value.roll} vs src/rng.ts ${mine} units`); }
      const he = edgeById.get(String(i))!;
      const printed = he > 0
        ? r.logs[0] === `Game result: ${r.value.afterEdge}x` && r.logs[1] === `PF roll before edge: ${r.value.roll}x`
        : r.logs[0] === `Game result: ${r.value.afterEdge}x` && r.logs[1] === OPERATOR_SCALING_EDGE_NOTE;
      if (printed && r.logs.length === 2) opPrinted++; else if (opFirst.length < 3) opFirst.push(`bet ${b.response.id}: printed ${JSON.stringify(r.logs).slice(0, 120)}`);
      const t = targetCents(b.response.target);
      const ae = unitsFromDecimal(r.value.afterEdge, RESULT_DECIMALS);
      if (t !== null && ae !== null && roll !== null) {
        aeN++;
        const opWin = ae >= BigInt(t) * 10_000n;                                   // afterEdge >= target (6-dp units)
        if (opWin === b.response.is_win) aeWinServed++;
        if (opWin === (Number(roll) >= winMinUnits(t, CLAIMED_EDGE.num, CLAIMED_EDGE.den))) aeWinRule++;
      }
    });
    if (opChecked !== EXPECTED_BETS) opIssues.push(`operator Verify-tab code ran on ${opChecked} bets, ${EXPECTED_BETS} declared`);
    if (opVsServed + opVsRng + opErrors > 0 || opPrinted !== opChecked) {
      opIssues.unshift(`operator Verify-tab code disagrees: roll vs the served result on ${opVsServed}, vs src/rng.ts on ${opVsRng}, `
        + `${opErrors} run error(s), printed output ≠ returned value on ${opChecked - opErrors - opPrinted} (${opFirst.join('; ')})`);
    }
  }

  const s5Ok = checked === EXPECTED_BETS && mismatches === 0 && skipped === 0 && offGrid === 0 && opIssues.length === 0;
  const s5 = step(5, 'Result Determinism (exact equality, no tolerance)',
    s5Ok ? 'PASS' : 'FAIL',
    `${checked}/${EXPECTED_BETS} bets (EXPECTED_BETS) recomputed from revealed seeds and compared as integer 6-dp units ` +
      `parsed from the served string (the float path, multiplier.toFixed(6), must land on the same unit): ${mismatches} mismatches, ${skipped} skipped ` +
      `(no revealed seed), ${offGrid} served results not on the 6-dp grid` + (examples.length ? ` — ${examples.join('; ')}` : '') +
      (opIssues.length > 0
        ? `. OPERATOR VERIFY-TAB CODE PARITY (LIMBO-09): ${opIssues.join('; ')}`
        : `. Second check, operator-code parity (LIMBO-09; src/rng.ts is rebuilt from docs/ALGORITHM.md, not from this code): Duel's own Limbo Verify-tab code (${OPERATOR_VERIFIER_PROVENANCE.savedAs}, ` +
          `${OPERATOR_VERIFIER_PROVENANCE.from}, SHA-256 ${OPERATOR_VERIFIER_PROVENANCE.sha256.slice(0, 16)}…, pinned) executed with only its ` +
          `four "User input values" filled in on ${opChecked}/${EXPECTED_BETS} bets — its roll equals the served result and src/rng.ts ` +
          `as integer 6-dp units on every bet (${opVsServed} / ${opVsRng} differ), what it printed equals what it returned on ` +
          `${opPrinted}/${opChecked}. ` +
          `Its afterEdge at the edge the package declares per bet (houseEdge = the limboConfig.json floor ${floor} on ${atFloor}/${opChecked} ` +
          `bets, as Step 20 measures): win iff afterEdge >= target agrees with the served win flag on ${aeWinServed}/${aeN} and with the ` +
          `package's exact rule result >= target/(1−${CLAIMED_EDGE.num}/${CLAIMED_EDGE.den}) on ${aeWinRule}/${aeN} (reported, not scored). ` +
          `The file's own comment, printed when houseEdge is 0: "${OPERATOR_SCALING_EDGE_NOTE.replace(/^Note: /, '')}"`),
  );

  // ── Step 6: negative control — the check must be falsifiable ─────────────────
  // (a) a +1 nonce must change the recomputed result; (b) a served result one lattice unit off
  // (±1e-6) must be rejected by the same integer comparison Step 5 uses.
  let nonceCtl = false, unitCtl = false;
  const sample = bets.find(b => seedMap.has(b.response.server_seed_hashed));
  if (sample) {
    const key = Buffer.from(seedMap.get(sample.response.server_seed_hashed)!, 'hex');
    const r0 = computeResultUnitsFromBuffer(key, sample.response.client_seed, sample.response.nonce);
    nonceCtl = computeResultUnitsFromBuffer(key, sample.response.client_seed, sample.response.nonce + 1) !== r0;
    const served = unitsFromDecimal(sample.response.result, RESULT_DECIMALS)!;
    unitCtl = BigInt(r0) === served && BigInt(r0) !== served + 1n && BigInt(r0) !== served - 1n;
  }
  const s6 = step(6, 'Negative Control (tampered nonce must break reproduction)',
    nonceCtl && unitCtl ? 'PASS' : 'FAIL',
    `bet ${sample?.response.id}: nonce+1 changes the recomputed result (${nonceCtl}); the Step 5 comparison accepts the served ` +
      `${sample?.response.result} and rejects it one 6-dp unit either side (${unitCtl}) — Step 5 is falsifiable`,
  );

  // ── Step 7: nonce audit — declared base, declared size, no gap or repeat ─────
  // Within every epoch the nonces must be exactly NONCE_BASE … NONCE_BASE+EPOCH_SIZE−1. A gap or
  // repeat is operator-side and FAILs unless src/capture-plan.ts CAPTURE_RETRY_GAPS attributes it to
  // an auditor-side retry, in which case it is a capture-origin FLAG (verdict-neutral, disclosed).
  let clean = 0, operatorBad = 0, captureGaps = 0, epochs = 0;
  const detail: string[] = [];
  const declared = new Set(CAPTURE_RETRY_GAPS.map(g => `${g.epoch}:${g.nonce}`));
  for (const [hash, group] of ctx.byHash) {
    epochs++;
    const nonces = group.map(b => b.response.nonce).sort((a, b) => a - b);
    const seen = new Set(nonces);
    const missing: number[] = [];
    for (let n = NONCE_BASE; n < NONCE_BASE + EPOCH_SIZE; n++) if (!seen.has(n)) missing.push(n);
    const outOfRange = nonces.filter(n => n < NONCE_BASE || n >= NONCE_BASE + EPOCH_SIZE).length;
    const repeats = nonces.length - seen.size;
    if (!missing.length && !outOfRange && !repeats) { clean++; continue; }
    const allDeclared = !outOfRange && !repeats && missing.every(n => declared.has(`${hash}:${n}`));
    if (allDeclared) captureGaps++; else operatorBad++;
    if (detail.length < 3) detail.push(`epoch ${hash.slice(0, 12)}: missing [${missing.slice(0, 5).join(',')}], ${repeats} repeats, ${outOfRange} out of range`);
  }
  const status = epochs !== EXPECTED_EPOCHS || operatorBad > 0 ? 'FAIL' : captureGaps > 0 ? 'FLAG' : 'PASS';
  const s7 = step(7, 'Nonce Continuity (no gaps or repeats within an epoch)', status,
    `${clean}/${EXPECTED_EPOCHS} epochs carry exactly nonces ${NONCE_BASE}..${NONCE_BASE + EPOCH_SIZE - 1} (declared base ` +
      `NONCE_BASE, size EPOCH_SIZE — src/capture-plan.ts, not the dataset); ${operatorBad} epoch(s) with an undeclared gap, ` +
      `repeat or out-of-range nonce (operator-side, FAIL); ${captureGaps} with a gap declared as an auditor-side retry ` +
      `(${CAPTURE_RETRY_GAPS.length} declared; capture-origin FLAG)` + (detail.length ? ` — ${detail.join('; ')}` : ''),
    status === 'FLAG' ? 'capture' : undefined,
  );

  return [s5, s6, s7];
}
