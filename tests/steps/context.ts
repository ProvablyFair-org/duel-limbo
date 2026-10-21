import type { LimboBet, SeedEntry } from '../../src/types';

export interface StepResult {
  step:   number;
  name:   string;
  /** INFO: an informational step's deviation (profile policy INFORMATIONAL, Mike 2026-09-29) —
   *  reported, never counted as a flag, never affects the verdict. */
  status: 'PASS' | 'FLAG' | 'FAIL' | 'INFO';
  detail: string;
  /** For a FLAG: operator (verdict-affecting) or capture (verdict-neutral). */
  origin?: 'operator' | 'capture';
}

export interface InfoItem {
  label:  string;
  detail: string;
}

/**
 * The measured house edge, derived in steps/payouts.ts from the win/lose
 * boundary of live bets. It is NEVER taken from the operator's reported
 * `effective_edge` field — that field is cross-checked against this value in a
 * separate scored step. `null` until the derivation runs.
 */
export interface EdgeMeasurement {
  lower:      number;   // tightest lower bound implied by observed wins
  upper:      number;   // tightest upper bound implied by observed losses
  point:      number;   // midpoint of the bracket — the reported measurement
  witnesses:  number;   // bets that constrained the bracket
  bracketed:  boolean;  // true when lower/upper are both finite and consistent
}

export interface VerifyContext {
  bets:       LimboBet[];
  seeds:      SeedEntry[];
  seedMap:    Map<string, string>;
  byHash:     Map<string, LimboBet[]>;
  phaseA:     LimboBet[];
  phaseB:     LimboBet[];
  phaseC:     LimboBet[];
  phaseD:     LimboBet[];
  outputsDir: string;
  // Mutable accumulators
  determinismMismatches: number;
  determinismSkipped:    number;
  measuredEdge:          EdgeMeasurement | null;
  chiResultsLog:         Record<string, unknown>[];
}

export function step(
  num:    number,
  name:   string,
  status: 'PASS' | 'FLAG' | 'FAIL' | 'INFO',
  detail: string,
  origin?: 'operator' | 'capture',
): StepResult {
  const tag = status === 'PASS' ? '[PASS]' : status === 'INFO' ? '[INFO]' : status === 'FLAG' ? `[FLAG${origin && origin !== 'operator' ? ` ⚑ ${origin}` : ''}]` : '[FAIL]';
  console.log(`  ${tag} Step ${num} — ${name}`);
  if (status !== 'PASS') console.log(`         ${detail}`);
  return status === 'FLAG' ? { step: num, name, status, detail, origin: origin ?? 'operator' } : { step: num, name, status, detail };
}
