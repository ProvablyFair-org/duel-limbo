/**
 * Exact Limbo arithmetic — integer units, no floating tolerance anywhere a lattice exists.
 *
 * THE RESULT LATTICE. src/rng.ts (rebuilt from docs/ALGORITHM.md §2 Step 2) computes, in exact integer
 * arithmetic,
 *     K(u) = floor(2^32 · 1e6 / u),   u = value + 1 ∈ [1, 2^32]
 *     result = K(u) / 1e6
 * so every served result is the integer K(u) in units of 1e-6. This module takes K(u) from src/rng.ts
 * resultUnitsFromU (whose argument is the raw draw value = u − 1; resultUnitsAtU below). Duel's
 * published Verify-tab code computes the same quantity in IEEE-754 doubles,
 * Math.max(1.0, Math.floor((2^32 / u) * 1e6) / 1e6); on integration (20 Oct 2026) the double form and
 * the integer form were compared on every u ∈ [1, 2^32] and differ on 0 of the 2^32 draws, so the
 * counts below are the same under either reading.
 *
 * MONOTONICITY (why a binary search is an exact count). floor(N / u) for a fixed positive N never
 * increases as u grows, so K is non-increasing in u. The set of draws
 * whose result reaches a threshold is therefore a prefix u ∈ [1, U*], and its size U* is found
 * exactly by binary search over that formula — no sampling, no closed-form
 * approximation. `checkMonotone` re-asserts the property on the evaluated points.
 *
 * THE FLOOR. K(2^32) = 1e6 exactly (2^32/2^32 = 1), and K(u) ≥ 1e6 for every u ≤ 2^32, so a
 * max(1.0, …) clamp (Duel's Verify-tab code has one) never changes a result: the lattice minimum 1.000000 is reached by exactly one
 * draw (value = 2^32 − 1), probability 2^-32.
 *
 * THE WIN RULE AT THE DECLARED EDGE. Duel's comment: "you win if result >= target / (1 - edge)".
 * With target T = t/100 (t integer hundredths) and edge e = a/b, result k/1e6 wins iff
 *     k · (b − a) · 100 ≥ t · b · 1e6   ⇔   k · (b − a) ≥ t · b · 1e4   ⇔   k ≥ ceil(t · b · 1e4 / (b − a)).
 * At the declared floor edge 0.001 (a/b = 1/1000): k ≥ ceil(t · 1e7 / 999). This is the EXACT
 * rational reading of the published rule. The backend's actual arithmetic for T/(1−e) is not
 * published; `winMinUnitsFloat` gives the double-precision reading so the two can be compared.
 */

import { MAX_U32, resultUnitsFromU } from './rng';

/** K(u) for u = value + 1 ∈ [1, 2^32]: result units from src/rng.ts, whose argument is the raw draw value = u − 1. */
export function resultUnitsAtU(u: number): number {
  return resultUnitsFromU(u - 1);
}

/** 6-dp result → integer units, parsed from the served decimal STRING (never via a float). */
export function unitsFromDecimal(s: string, decimals: number): bigint | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s.trim());
  if (!m) return null;
  const frac = m[2] ?? '';
  if (frac.length > decimals) {
    // allow trailing zeros beyond the grid, reject anything else
    if (!/^0*$/.test(frac.slice(decimals))) return null;
  }
  const f = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(m[1]!) * 10n ** BigInt(decimals) + BigInt(f || '0');
}

/** Target (2-dp) → integer hundredths from its served string; null if not on the 2-dp grid. */
export function targetCents(s: string): number | null {
  const u = unitsFromDecimal(s, 2);
  return u === null ? null : Number(u);
}

/** Smallest winning result units k at target t (hundredths) and edge a/b, exact rational rule. */
export function winMinUnits(t: number, a = 1, b = 1000): number {
  const num = BigInt(t) * BigInt(b) * 10_000n;
  const den = BigInt(b - a);
  return Number((num + den - 1n) / den);
}

/**
 * Smallest winning result units under the DOUBLE reading `k/1e6 >= (t/100)/(1-e)`, searched near
 * the exact-rational answer. Used only to count where the two readings of the unpublished backend
 * arithmetic would disagree.
 */
export function winMinUnitsFloat(t: number, a = 1, b = 1000): number {
  const thr = (t / 100) / (1 - a / b);
  let k = winMinUnits(t, a, b) - 2;
  while (!(k / 1e6 >= thr)) k++;
  while (k - 1 >= 0 && (k - 1) / 1e6 >= thr) k--;
  return k;
}

/**
 * Number of draws u ∈ [1, 2^32] whose result units reach kMin — exact, by binary search over the
 * result formula of src/rng.ts (K non-increasing in u).
 */
export function winningDraws(kMin: number): number {
  if (resultUnitsAtU(1) < kMin) return 0;
  let lo = 1, hi = MAX_U32; // invariant: K(lo) >= kMin
  if (resultUnitsAtU(hi) >= kMin) return hi;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (resultUnitsAtU(mid) >= kMin) lo = mid; else hi = mid;
  }
  return lo;
}

/** Number of draws u whose result is EXACTLY k units (collision class of a served result). */
export function drawsWithUnits(k: number): number {
  return winningDraws(k) - winningDraws(k + 1);
}

/** Spot-check monotonicity of K over a set of u values (sorted ascending). */
export function checkMonotone(us: number[]): boolean {
  let prev = Infinity;
  for (const u of us) {
    const k = resultUnitsAtU(u);
    if (k > prev) return false;
    prev = k;
  }
  return true;
}

export const TWO32 = 2 ** 32;
