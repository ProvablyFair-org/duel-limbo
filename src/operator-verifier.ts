/**
 * THE OPERATOR'S OWN VERIFIER CODE, RUN AS A SECOND CHECK (profile LIMBO-09; Step 5, operator leg).
 *
 * Duel.com's Provably Fair → Verify page, with Limbo selected, shows a JavaScript code panel. That code
 * is the operator's published algorithm for Limbo.
 *
 * ROLE (since 20 Oct 2026, v1.2.0 draft). This file is a SECOND CHECK, not the source of src/rng.ts.
 * src/rng.ts is rebuilt from the written specification docs/ALGORITHM.md by an implementer who never
 * opened Duel's code; Duel's file is run here, byte for byte, to show that it agrees with that rebuild
 * and with the served results. Through v1.1.0 src/rng.ts was a port of this file and, from 26 Sep 2026,
 * cited 8 of its lines (OPERATOR_SOURCE_CITES); the port and that citation table were removed on
 * 20 Oct 2026.
 *
 * PROVENANCE. Pasted by Paulo from duel.com → Provably Fair → Verify (Limbo) on 2026-09-26 and saved
 * verbatim as evidence/verify-tab/duel-verify-tab-limbo-2026-09-26.js (committed in 9333460; 2,763
 * bytes, 78 lines). The file is never edited. Until then the package carried only a TRANSCRIPTION of the
 * Verify-page function (evidence/algorithm-transcription-2026-08-18.md, 2026-08-18 recon; MANIFEST DL-10), which this file superseded as
 * the operator reference. What this does NOT establish: that the Verify button on the live page runs exactly
 * the code its panel displays, or that Duel's server runs it.
 *
 * WHAT THIS FILE DOES.
 *   1. PINS the SHA-256 of that file and of the runner that executes it (OPERATOR_VERIFIER_PINS).
 *      A file that does not hash to its pin FAILs Step 5 before anything runs.
 *   2. EXECUTES the file in a child Node process (verifier-parity/operator/run-operator-verifier.cjs;
 *      its header lists the whole harness surface). The runner does what a player does in the Verify
 *      tab: it fills in the file's "User input values" (clientSeed, serverSeed, nonce, houseEdge) and
 *      runs it — only the literals on those four lines change, every other line is asserted
 *      byte-identical. The file returns { roll, afterEdge } as toFixed(6) strings and prints
 *      "Game result: <afterEdge>x" and, when houseEdge > 0, "PF roll before edge: <roll>x".
 *      The runner's stdin and stdout are temp FILES, not pipes, and the run has a hard timeout.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

export const PACKAGE_ROOT = path.join(__dirname, '..');
export const OPERATOR_VERIFIER_FILE = 'evidence/verify-tab/duel-verify-tab-limbo-2026-09-26.js';
export const OPERATOR_VERIFIER_RUNNER = 'verifier-parity/operator/run-operator-verifier.cjs';

/** Package-relative path → SHA-256 of the exact bytes. */
export const OPERATOR_VERIFIER_PINS: Readonly<Record<string, string>> = Object.freeze({
  'evidence/verify-tab/duel-verify-tab-limbo-2026-09-26.js': 'be69447465682f2b5fd674ead1cd55eab6d9d89e26b8a5a46a0c600898d62bd1',
  'verifier-parity/operator/run-operator-verifier.cjs':      '6d094ef0bddbca4493466f7310dcf7ba34770d5262243d8c70ca999597e6ca06',
});

export const OPERATOR_VERIFIER_PROVENANCE = Object.freeze({
  copiedBy: 'Paulo',
  copiedOn: '2026-09-26',
  from: 'pasted by Paulo from duel.com Verify tab 2026-09-26 (duel.com → Provably Fair → Verify, game Limbo, code panel)',
  savedAs: OPERATOR_VERIFIER_FILE,
  sha256: 'be69447465682f2b5fd674ead1cd55eab6d9d89e26b8a5a46a0c600898d62bd1',
  bytes: 2763,
  lines: 78,
});

/** The only thing the file prints when it runs as shipped (its inputs are empty strings). */
export const OPERATOR_EXPECTED_LOGS: readonly string[] = Object.freeze([
  'Please provide valid serverSeed, clientSeed, and nonce (>=0) before running.',
]);

/** The file's own comment, printed when houseEdge is 0 (L73). Quoted in the Step 5 detail. */
export const OPERATOR_SCALING_EDGE_NOTE = 'Note: the real round multiplier changes with the size of the bet and the scaling edge applied';

export interface OperatorRound { id: string; inputs: { clientSeed: string; serverSeed: string; nonce: number; houseEdge: number } }
export interface OperatorResult { value: { roll: string; afterEdge: string } | null; logs: string[]; error?: string }
export interface OperatorRun {
  files: Array<{ file: string; pinned: string; actual: string | null; match: boolean }>;
  hashesMatch: boolean;
  /** id → what the operator's code returned and printed for that round. */
  results: Map<string, OperatorResult> | null;
  /** What the file printed when run as shipped (no inputs). */
  shippedLogs: string[];
  error: string | null;
}

const sha256 = (b: Buffer): string => crypto.createHash('sha256').update(b).digest('hex');

/**
 * HOW THE PINNED RUNNER IS STARTED. Its stdin and stdout are temp FILES, not pipes, and the run has a
 * hard timeout (the pipe deadlock seen on 2026-09-25 in the Duel Blackjack battery: a runner idle at
 * 0 % CPU with its pipe descriptors open for ~1 h 54 min). A runner that does not exit within
 * OPERATOR_RUNNER_TIMEOUT_MS is SIGKILLed and reported as a failed run — the calling step FAILs.
 */
export const OPERATOR_RUNNER_TIMEOUT_MS = 300_000;
function runPinnedRunner(root: string, input: string): { status: number | null; stdout: string; stderr: string; error?: Error } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-operator-runner-'));
  const inPath = path.join(dir, 'jobs.json');
  const outPath = path.join(dir, 'out.json');
  fs.writeFileSync(inPath, input);
  const inFd = fs.openSync(inPath, 'r');
  const outFd = fs.openSync(outPath, 'w');
  try {
    const r = spawnSync(process.execPath, [path.join(root, OPERATOR_VERIFIER_RUNNER), path.join(root, OPERATOR_VERIFIER_FILE)], {
      stdio: [inFd, outFd, 'pipe'],
      encoding: 'utf8',
      timeout: OPERATOR_RUNNER_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      maxBuffer: 1 << 24,
    });
    const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT' || r.signal === 'SIGKILL';
    return {
      status: timedOut ? null : r.status,
      stdout: fs.readFileSync(outPath, 'utf8'),
      stderr: timedOut ? `runner killed after ${OPERATOR_RUNNER_TIMEOUT_MS} ms (hard timeout)` : (r.stderr || ''),
      error: r.error,
    };
  } finally {
    fs.closeSync(inFd);
    fs.closeSync(outFd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Hash the pinned files and, only if every one matches, run the operator's code on `rounds`.
 * Never throws: a failure is returned as `error` so the calling step reports a FAIL.
 */
export function runOperatorVerifier(rounds: OperatorRound[], root = PACKAGE_ROOT): OperatorRun {
  const files = Object.entries(OPERATOR_VERIFIER_PINS).map(([file, pinned]) => {
    const p = path.join(root, file);
    const actual = fs.existsSync(p) ? sha256(fs.readFileSync(p)) : null;
    return { file, pinned, actual, match: actual === pinned };
  });
  const hashesMatch = files.every(f => f.match);
  if (!hashesMatch) return { files, hashesMatch, results: null, shippedLogs: [], error: 'operator Verify-tab code or its runner does not match its pinned SHA-256' };
  const r = runPinnedRunner(root, JSON.stringify({ rounds }));
  if (r.status !== 0) {
    return { files, hashesMatch, results: null, shippedLogs: [],
      error: `operator verifier runner exited ${r.status}: ${(r.stderr || String(r.error || '')).trim().slice(0, 400)}` };
  }
  try {
    const out = JSON.parse(r.stdout) as { shippedLogs: string[]; results: Array<{ id: string; value: OperatorResult['value']; logs: string[]; error?: string }> };
    const results = new Map<string, OperatorResult>();
    for (const x of out.results) results.set(String(x.id), { value: x.value ?? null, logs: x.logs ?? [], error: x.error });
    return { files, hashesMatch, results, shippedLogs: out.shippedLogs, error: null };
  } catch (e) {
    return { files, hashesMatch, results: null, shippedLogs: [], error: `operator verifier output unreadable: ${(e as Error).message}` };
  }
}
