/**
 * Steps 22–30: exact Limbo checks added 2026-09-26 for the (proposed) Framework 1.0 Limbo profile.
 *
 *   22  Client-seed influence — model-rate gate + empty-seed control          (LIMBO-06)
 *   23  Draw domain & bias bound                                              (LIMBO-08)
 *   24  Result range, win rule at the declared edge & boundary census         (LIMBO-10, LIMBO-17)
 *   25  Win probability per served target, exact over 2^32 draws              (LIMBO-18, LIMBO-13)
 *   26  Effective edge on every legal target vs the claim                     (LIMBO-19)
 *   27  Target bounds & maximum payout                                        (LIMBO-14)
 *   28  Phase A target coverage by decade                                     (LIMBO-15)
 *   29  Wallet envelopes: ledger legs and rakeback, exact                     (LIMBO-16)
 *   30  Live-sample fit (informational)                                       (LIMBO-22)
 *
 * Every probability here is a COUNT of uint32 draws under the result formula of src/rng.ts (rebuilt from
 * docs/ALGORITHM.md; counted in src/exact.ts), never a sample and never an operator-supplied field. Every population is bound to
 * a constant in src/capture-plan.ts.
 */

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import { MAX_U32, DRAW_HEX_CHARS, RESULT_DECIMALS, computeResultUnitsFromBuffer } from '../../src/rng';
import {
  unitsFromDecimal, targetCents, winMinUnits, winMinUnitsFloat, winningDraws, drawsWithUnits, checkMonotone, TWO32,
  resultUnitsAtU,
} from '../../src/exact';
import {
  EXPECTED_BETS, EXPECTED_EPOCHS, EXPECTED_WALLET_SAMPLES, CLAIMED_EDGE, CLAIM_PRINTED_DECIMALS_PCT,
  MIN_TARGET_CENTS, PHASE_A_DECADES, PHASE_A_MIN_PER_DECADE, PLAN,
} from '../../src/capture-plan';
import { loadConfig, maxProfit, scalingOnset } from '../../src/scaling-edge';
import { ksTest, lagOneAutocorrelation, normalCdf } from '../../src/stats';
import * as crypto from 'crypto';

const A = CLAIMED_EDGE.num, B = CLAIMED_EDGE.den;
const UNIT = 10 ** RESULT_DECIMALS;

export function run(ctx: VerifyContext): StepResult[] {
  const { bets, seedMap } = ctx;
  const out: StepResult[] = [];
  const keyOf = new Map<string, Buffer>();
  const key = (hash: string) => {
    let k = keyOf.get(hash);
    if (!k) { k = Buffer.from(seedMap.get(hash)!, 'hex'); keyOf.set(hash, k); }
    return k;
  };
  const cfg = loadConfig();

  // ── Step 22: client-seed influence (model-rate gate + empty-seed control) ────────────────────────
  // A wrong client seed must change the result — but on a lattice two seeds can land on the same
  // result by chance. The chance is EXACT per bet: the served result k is produced by
  // drawsWithUnits(k) of the 2^32 draws, so P(same result) = drawsWithUnits(k) / 2^32. Collisions are
  // held to E + 5σ + 1 (σ² = Σ p(1−p)). An RNG that ignored the client seed would collide on every bet.
  // The EMPTY-SEED control repeats this with clientSeed = "" — the case an implementation that drops
  // or defaults the field would reproduce.
  {
    let tested = 0, collisions = 0, E = 0, V = 0, eTested = 0, eColl = 0, eE = 0, eV = 0;
    for (const b of bets) {
      if (!seedMap.has(b.response.server_seed_hashed)) continue;
      const k = key(b.response.server_seed_hashed);
      const r = computeResultUnitsFromBuffer(k, b.response.client_seed, b.response.nonce);
      const p = drawsWithUnits(r) / TWO32;
      tested++; E += p; V += p * (1 - p);
      if (computeResultUnitsFromBuffer(k, 'wrong-client-seed-test', b.response.nonce) === r) collisions++;
      eTested++; eE += p; eV += p * (1 - p);
      if (computeResultUnitsFromBuffer(k, '', b.response.nonce) === r) eColl++;
    }
    const bound = E + 5 * Math.sqrt(V) + 1, eBound = eE + 5 * Math.sqrt(eV) + 1;
    const ok = tested === EXPECTED_BETS && eTested === EXPECTED_BETS && collisions <= bound && eColl <= eBound;
    out.push(step(22, 'Client-Seed Influence (model-rate gate + empty-seed control)', ok ? 'PASS' : 'FAIL',
      `${tested}/${EXPECTED_BETS} bets recomputed under a wrong client seed: ${collisions} kept the same result against the ` +
      `exact lattice rate E = Σ drawsWithUnits(k)/2^32 = ${E.toExponential(3)}, bound E + 5σ + 1 = ${bound.toFixed(3)}; ` +
      `empty-seed control (clientSeed = "") over ${eTested}/${EXPECTED_BETS}: ${eColl} collision(s), bound ${eBound.toFixed(3)}` +
      (collisions > bound || eColl > eBound ? ' — THE RESULT IS NOT RESPONDING TO THE CLIENT SEED' : '')));
  }

  // ── Step 23: draw domain & bias bound ─────────────────────────────────────────────────────────
  // Duel's draw is the first DRAW_HEX_CHARS hex characters of the HMAC read as an unsigned integer:
  // with 8 hex characters that is the whole 32-bit domain, taken with NO range reduction (no modulo,
  // no rejection), so each of the 2^32 values is an equiprobable input and the draw bias is 0 by
  // construction. The step asserts the construction rather than restating it: the width and the
  // denominator are read from src/rng.ts, every captured draw is recomputed into [0, 2^32), and the
  // result map is checked non-increasing on a spread of points (the property the exact counts of
  // Steps 24–26 rely on).
  {
    let inRange = 0, n = 0;
    for (const b of bets) {
      if (!seedMap.has(b.response.server_seed_hashed)) continue;
      const h = crypto.createHmac('sha256', key(b.response.server_seed_hashed))
        .update(`${b.response.client_seed}:${b.response.nonce}`).digest('hex');
      const v = parseInt(h.slice(0, DRAW_HEX_CHARS), 16);
      n++;
      if (Number.isInteger(v) && v >= 0 && v < TWO32) inRange++;
    }
    const probes: number[] = [];
    for (let e = 0; e <= 32; e++) { const u = Math.min(TWO32, Math.max(1, Math.round(2 ** e))); probes.push(u, Math.max(1, u - 1), Math.min(TWO32, u + 1)); }
    probes.push(2_070_000_000, 2_070_000_001, 4_294_967_295, 4_294_967_296);
    probes.sort((a, b) => a - b);
    const mono = checkMonotone(probes);
    const widthBits = DRAW_HEX_CHARS * 4;
    const ok = MAX_U32 === TWO32 && widthBits === 32 && n === EXPECTED_BETS && inRange === n && mono
      && resultUnitsAtU(TWO32) === UNIT;
    out.push(step(23, 'Draw Domain & Bias Bound (uint32, no range reduction)', ok ? 'PASS' : 'FAIL',
      `draw = first ${DRAW_HEX_CHARS} hex chars of HMAC-SHA256 = ${widthBits} bits; denominator MAX_U32 = ${MAX_U32} ` +
      `(${MAX_U32 === TWO32 ? '= 2^32' : '≠ 2^32 — the draw domain is not the full uint32'}); no modulo, no rejection: bias bound = 0 ` +
      `(each of the 2^32 values is one equiprobable input). ${inRange}/${EXPECTED_BETS} recomputed draws lie in [0, 2^32). ` +
      `Result map K(u) = floor(2^32·1e6/u) non-increasing on ${probes.length} probe points: ${mono}; K(2^32) = ` +
      `${resultUnitsAtU(TWO32)} units (the 1.000000 floor is reached by exactly one draw, so the max(1.0, …) clamp never changes a result)`));
  }

  // ── Step 24: result range, win rule at the declared edge, boundary census ────────────────────────
  // Every served result must lie on the 6-dp lattice inside [1.000000, 2^32]; every served win flag
  // must equal the published rule `result >= target / (1 − edge)` evaluated EXACTLY (integer units)
  // at the declared edge 0.001 — never reading the served flag or an operator field. The census
  // records whether the tie (result exactly on the threshold) and the 1.00x floor were witnessed.
  {
    const kMax = resultUnitsAtU(1);
    let inRange = 0, ruleOk = 0, ties = 0, floors = 0, n = 0;
    let tightWin = Infinity, tightLoss = Infinity;
    const bad: string[] = [];
    for (const b of bets) {
      const k = unitsFromDecimal(b.response.result, RESULT_DECIMALS);
      const t = targetCents(b.response.target);
      if (k === null || t === null) { if (bad.length < 2) bad.push(`bet ${b.response.id} unparsable`); continue; }
      n++;
      const kk = Number(k);
      if (kk >= UNIT && kk <= kMax) inRange++;
      const kMin = winMinUnits(t, A, B);
      const win = kk >= kMin;
      if (win === b.response.is_win) ruleOk++; else if (bad.length < 3) bad.push(`bet ${b.response.id}: result ${b.response.result} target ${b.response.target} rule says ${win}, served ${b.response.is_win}`);
      if (kk * (B - A) === t * B * 10_000) ties++;   // k/1e6 == (t/100)·b/(b−a) exactly
      if (kk === UNIT) floors++;
      if (win) tightWin = Math.min(tightWin, kk - kMin); else tightLoss = Math.min(tightLoss, kMin - kk);
    }
    const floorLosesEverywhere = UNIT < winMinUnits(MIN_TARGET_CENTS, A, B);
    const ok = n === EXPECTED_BETS && inRange === n && ruleOk === n && floorLosesEverywhere;
    out.push(step(24, 'Result Range & Win Rule at the Declared Edge (exact, with boundary census)', ok ? 'PASS' : 'FAIL',
      `${inRange}/${EXPECTED_BETS} served results on the 6-dp lattice within [1.000000, ${kMax / UNIT}] (the formula's own ` +
      `maximum; no cap below it); ${ruleOk}/${EXPECTED_BETS} served win flags equal the published rule result >= target/(1−e) ` +
      `evaluated exactly at the declared e = ${A}/${B} (k·${B - A} >= t·${B}·10^4, integer units, no served field read). ` +
      `Boundary census: ${ties} result(s) exactly ON the threshold (tie UNWITNESSED in the capture — the >= comparator rests on ` +
      `Duel's published comment); ${floors} result(s) at the 1.000000 floor (probability 2^-32 per bet; UNWITNESSED), which ` +
      `loses at every legal target (1.000000 < threshold at ${MIN_TARGET_CENTS / 100}: ${floorLosesEverywhere}); tightest win ` +
      `${tightWin} unit(s) above its threshold, tightest loss ${tightLoss} unit(s) below` + (bad.length ? ` — ${bad.join('; ')}` : '')));
  }

  // ── Step 25: win probability per served target, exact over all 2^32 draws ────────────────────────
  // For every distinct served target the number of winning draws W(t) is COUNTED over the operator's
  // formula (binary search on the non-increasing result map, src/exact.ts) and compared with the closed
  // form (1−e)/T within the truncation bound 1e-6/thr² + 2^-31 (the 6-dp floor moves the effective
  // threshold by < 1e-6). The operator's served win_chance (an 18-dp fraction) is then COMPARED with
  // the declared formula (1−e)/T to within one 1e-18 unit — compared, never read by the derivation.
  {
    const targets = new Map<number, string[]>();
    for (const b of bets) {
      const t = targetCents(b.response.target);
      if (t === null) continue;
      if (!targets.has(t)) targets.set(t, []);
      targets.get(t)!.push(b.response.win_chance);
    }
    let closedOk = 0, worst = 0, worstT = 0, wcOk = 0, wcN = 0;
    for (const [t, wcs] of targets) {
      const W = winningDraws(winMinUnits(t, A, B));
      const T = t / 100, thr = T * B / (B - A);
      const dev = Math.abs(W / TWO32 - (B - A) / (B * T));
      const bound = 10 ** -RESULT_DECIMALS / (thr * thr) + 2 / TWO32;
      if (dev <= bound) closedOk++;
      if (dev / bound > worst) { worst = dev / bound; worstT = T; }
      // served win_chance vs (B−A)/(B·T) = (B−A)·100/(B·t), exact rational at 1e-18
      for (const wc of wcs) {
        wcN++;
        const u = unitsFromDecimal(wc, 18);
        if (u === null) continue;
        const lhs = u * BigInt(B) * BigInt(t);                 // wc · B · t · 1e18
        const rhs = BigInt(B - A) * 100n * 10n ** 18n;         // (B−A)·100 · 1e18
        const diff = lhs > rhs ? lhs - rhs : rhs - lhs;
        if (diff < BigInt(B) * BigInt(t)) wcOk++;               // |wc − q| < 1e-18
      }
    }
    const nT = targets.size;
    const ok = nT > 0 && closedOk === nT && wcOk === wcN && wcN === EXPECTED_BETS;
    out.push(step(25, 'Win Probability per Served Target (exact count over 2^32 draws)', ok ? 'PASS' : 'FAIL',
      `${nT} distinct served targets: winning draws W(t) COUNTED over the src/rng.ts result formula at e = ${A}/${B}; ${closedOk}/${nT} ` +
      `within the truncation bound of the closed form (1−e)/T (worst ${worst.toFixed(3)} of its bound, at ${worstT}x). ` +
      `Operator's served win_chance vs (1−e)/T: ${wcOk}/${wcN} bets equal to within one 1e-18 unit (compared, never read)`));
  }

  // ── Step 26: effective edge on EVERY legal target vs the claim ───────────────────────────────────
  // edge(t) = 1 − T·W(t)/2^32, computed for every legal 2-dp target from MIN_TARGET_CENTS to the
  // operator's max_target (limboConfig.json), not only the captured ones, in integers:
  // D − t·W with D = 100·2^32 (t·W < 2^53 on the whole grid). Compared with the declared claim
  // (house_edge_percentage 0.1) at the precision the claim is printed; the backend's arithmetic for
  // T/(1−e) is not published, so the double reading is counted beside the exact-rational one.
  {
    const tMax = Math.round(cfg.maxTarget * 100);
    const D = 100 * TWO32;
    let n = 0, outside = 0, belowClaim = 0, disagree = 0;
    let minNum = Infinity, maxNum = -Infinity, argMin = 0, argMax = 0;
    const half = 0.5 * 10 ** (-CLAIM_PRINTED_DECIMALS_PCT) / 100;   // half a printed unit, as a fraction
    const claim = A / B;
    for (let t = MIN_TARGET_CENTS; t <= tMax; t++) {
      const kMin = winMinUnits(t, A, B);
      const W = winningDraws(kMin);
      const numr = D - t * W;                    // edge · D, exact integer
      n++;
      if (numr < minNum) { minNum = numr; argMin = t; }
      if (numr > maxNum) { maxNum = numr; argMax = t; }
      const e = numr / D;
      if (e < claim - half || e >= claim + half) outside++;
      if (numr * B < A * D) belowClaim++;
      if (winMinUnitsFloat(t, A, B) !== kMin) disagree++;
    }
    const me = ctx.measuredEdge;
    const pct = (x: number) => `${(x * 100).toFixed(7)}%`;
    const ok = n === tMax - MIN_TARGET_CENTS + 1 && n > 0 && outside === 0;
    out.push(step(26, 'Effective Edge on Every Legal Target vs Claim (exact enumeration)', ok ? 'PASS' : 'FLAG',
      `${n.toLocaleString('en-US')} legal targets ${MIN_TARGET_CENTS / 100}x … ${tMax / 100}x (max_target, limboConfig.json), each ` +
      `edge = 1 − T·W(t)/2^32 from an exact count at the declared floor edge e = ${A}/${B}: min ${pct(minNum / D)} at ` +
      `${argMin / 100}x, max ${pct(maxNum / D)} at ${argMax / 100}x; ${belowClaim} target(s) below the claim; ${outside} ` +
      `outside the claim at its printed precision (${(claim * 100).toFixed(CLAIM_PRINTED_DECIMALS_PCT)}%). The backend's ` +
      `T/(1−e) arithmetic is unpublished: the double reading and the exact-rational reading give a different winning set on ` +
      `${disagree} target(s). Measured beside the claim (Step 9): ` +
      (me?.bracketed ? `(${pct(me.lower)}, ${pct(me.upper)}] from ${me.witnesses} bets` : 'not bracketed') +
      `. Scope: the floor edge; under the rule implied by the config captured ${cfg.capturedAt}, a bet whose potential ` +
      `profit passes bankroll × min_edge = ${scalingOnset(cfg.scalingEdge).toLocaleString('en-US')} would be priced ` +
      `higher (Step 20)`));
  }

  // ── Step 27: target bounds & maximum payout ──────────────────────────────────────────────────────
  {
    const tMax = Math.round(cfg.maxTarget * 100);
    let onGrid = 0, inBounds = 0;
    let maxProfitSeen = 0, minStake = Infinity;
    for (const b of bets) {
      const t = targetCents(b.response.target);
      if (t === null) continue;
      onGrid++;
      if (t >= MIN_TARGET_CENTS && t <= tMax) inBounds++;
      const stake = parseFloat(b.request.amount);
      maxProfitSeen = Math.max(maxProfitSeen, stake * (t - 100) / 100);   // potential profit, stake × (target − 1)
      minStake = Math.min(minStake, stake);
    }
    // The largest profit a bet can carry under the config-implied scaling rule: bankroll × max_edge.
    const profitMax = maxProfit(cfg.scalingEdge);
    const advertisedMaxProfit = minStake * (cfg.maxTarget - 1);
    const ok = onGrid === EXPECTED_BETS && inBounds === EXPECTED_BETS && maxProfitSeen <= profitMax && advertisedMaxProfit <= profitMax;
    out.push(step(27, 'Target Bounds & Maximum Payout', ok ? 'PASS' : 'FLAG',
      `${onGrid}/${EXPECTED_BETS} targets on the 2-dp grid, ${inBounds}/${EXPECTED_BETS} within [${MIN_TARGET_CENTS / 100}, ` +
      `${cfg.maxTarget}] (max_target, limboConfig.json); result cap: none below the formula maximum 2^32; largest potential ` +
      `profit in the capture ${maxProfitSeen.toFixed(4)} (stake × (target − 1)) vs the maximum profit bankroll × max_edge = ` +
      `${profitMax.toLocaleString('en-US')}; the advertised maximum target is playable at the smallest captured stake ` +
      `(${minStake} × (${cfg.maxTarget} − 1) = ${advertisedMaxProfit.toLocaleString('en-US', { maximumFractionDigits: 2 })} ≤ ` +
      `${profitMax.toLocaleString('en-US')}). The ${profitMax.toLocaleString('en-US')} maximum profit is implied by the config ` +
      `rule (limboConfig.json, captured ${cfg.capturedAt}), not served as a field there. Not declared by the operator: the ` +
      `minimum legal target (${MIN_TARGET_CENTS / 100}x is ` +
      `the smallest the capture placed)`));
  }

  // ── Step 28: Phase A target coverage by decade ───────────────────────────────────────────────────
  {
    const phaseA = bets.filter(b => b.phase === 'A');
    const counts = PHASE_A_DECADES.map(([lo, hi]) => phaseA.filter(b => {
      const T = (targetCents(b.response.target) ?? 0) / 100; return T >= lo && T < (hi === 1000 ? 1000.0001 : hi);
    }).length);
    const minTargetPlaced = bets.some(b => targetCents(b.response.target) === MIN_TARGET_CENTS);
    const distinct = new Set(phaseA.map(b => b.response.target)).size;
    const ok = phaseA.length === PLAN.A && counts.every(c => c >= PHASE_A_MIN_PER_DECADE) && minTargetPlaced;
    out.push(step(28, 'Phase A Target Coverage by Decade (against the plan in code)', ok ? 'PASS' : 'FLAG',
      `Phase A ${phaseA.length}/${PLAN.A} bets, ${distinct} distinct targets; per declared decade (src/capture-plan.ts ` +
      `PHASE_A_DECADES, from TARGET_RANGE): ` + PHASE_A_DECADES.map(([lo, hi], i) => `[${lo},${hi}${hi === 1000 ? ']' : ')'} ${counts[i]}`).join(', ') +
      ` (floor ${PHASE_A_MIN_PER_DECADE} each); minimum target ${MIN_TARGET_CENTS / 100}x placed: ${minTargetPlaced}. Targets above ` +
      `1000x up to max_target are not captured; their pricing is covered by enumeration (Step 26), not by play`));
  }

  // ── Step 29: wallet envelopes — ledger legs and rakeback, exact ───────────────────────────────────
  // The rig sampled the wallet envelope of EXPECTED_WALLET_SAMPLES bets. For each: every ledger leg's
  // balance moves by exactly its delta (6-dp coin units); the debit leg is exactly −amount and a credit
  // leg exists iff the bet won and equals amount_won exactly (18-dp currency); the Zero Edge rakeback
  // equals exactly 0.001 × amount. Consecutive-bet balance continuity is NOT asserted: the sample is
  // not consecutive and coin balances move by other wallet activity between legs.
  {
    const W = bets.filter(b => (b as any).wallet);
    let legsOk = 0, legs = 0, debitOk = 0, creditOk = 0, rakeOk = 0;
    const bad: string[] = [];
    for (const b of W) {
      const w = (b as any).wallet;
      for (const l of w.legs) {
        legs++;
        const bb = unitsFromDecimal(l.balance_before_coins, 6), ba = unitsFromDecimal(l.balance_after_coins, 6);
        const d = l.delta_coins.startsWith('-') ? -(unitsFromDecimal(l.delta_coins.slice(1), 6) ?? 0n) : unitsFromDecimal(l.delta_coins, 6);
        if (bb !== null && ba !== null && d !== null && ba - bb === d) legsOk++; else if (bad.length < 2) bad.push(`leg ${l.id}`);
      }
      const amt = unitsFromDecimal(b.request.amount, 18)!;
      const won = unitsFromDecimal(b.response.amount_won, 18)!;
      const debit = w.legs.filter((l: any) => l.amount_currency.startsWith('-'));
      const credit = w.legs.filter((l: any) => !l.amount_currency.startsWith('-'));
      if (debit.length === 1 && unitsFromDecimal(debit[0].amount_currency.slice(1), 18) === amt) debitOk++;
      if (b.response.is_win ? credit.length === 1 && unitsFromDecimal(credit[0].amount_currency, 18) === won : credit.length === 0) creditOk++;
      // rakeback (18-dp) × 1000 == amount (18-dp): the rakeback is exactly 0.001 × amount
      const rk = unitsFromDecimal(w.rakeback?.amount_currency ?? 'x', 18);
      if (rk !== null && rk * 1000n === amt) rakeOk++;
    }
    const n = W.length;
    const ok = n === EXPECTED_WALLET_SAMPLES && legsOk === legs && debitOk === n && creditOk === n && rakeOk === n;
    out.push(step(29, 'Wallet Envelopes (ledger legs and rakeback, exact)', ok ? 'PASS' : 'FLAG',
      `${n}/${EXPECTED_WALLET_SAMPLES} sampled envelopes (phases ${[...new Set(W.map(b => b.phase))].join('')}): ${legsOk}/${legs} ` +
      `ledger legs move the balance by exactly their delta (6-dp coins); ${debitOk}/${n} debit exactly −amount; ${creditOk}/${n} ` +
      `carry a credit leg iff the bet won, equal to amount_won exactly; ${rakeOk}/${n} Zero Edge rakebacks equal exactly 0.001 × ` +
      `amount. Not asserted: consecutive-bet balance continuity (the sample is not consecutive)` + (bad.length ? ` — ${bad.join('; ')}` : '')));
  }

  // ── Step 30: live-sample fit (informational) ────────────────────────────────────────────────────
  // The fair result has the law P(R >= x) = 1/x (x >= 1): KS on the captured results against
  // F(x) = 1 − 1/x, and lag-1 serial correlation of the uniform transform 1/R in capture order.
  // A 7,700-bet sample has little power; the step is informational (profile policy INFORMATIONAL, Mike
  // 2026-09-29): a deviation is reported as INFO, never counted as a flag, and never bears the verdict.
  {
    const rs = bets.map(b => Number(unitsFromDecimal(b.response.result, RESULT_DECIMALS)) / UNIT);
    const ks = ksTest(rs, x => (x < 1 ? 0 : 1 - 1 / x));
    const r1 = lagOneAutocorrelation(rs.map(x => 1 / x));
    const z = r1 * Math.sqrt(rs.length);
    const pz = 2 * (1 - normalCdf(Math.abs(z)));
    const ok = ks.pValue >= 0.01 && Math.abs(z) < 3;
    out.push(step(30, 'Live-Sample Fit (informational)', ok ? 'PASS' : 'INFO',
      `${rs.length} captured results vs P(R >= x) = 1/x: KS D = ${ks.d.toFixed(5)}, p = ${ks.pValue.toFixed(4)} (deviation reported below 0.01); ` +
      `lag-1 serial correlation of 1/R in capture order r1 = ${r1.toFixed(5)}, z = ${z.toFixed(3)} (p = ${pz.toFixed(4)}; deviation reported at |z| >= 3). ` +
      `Informational: a sample of this size has little power; a deviation is reported, never counted as a flag, and never bears the verdict`));
  }

  return out;
}
