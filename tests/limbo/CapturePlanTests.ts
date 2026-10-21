/**
 * Cross-artifact guard on the capture plan.
 *
 * Step 14 scores the captured dataset against a planned phase structure held in
 * `tests/steps/dataset.ts`. That constant is a COPY of the plan that
 * `capture/capture-auto.reference.js` actually executes, and a copy drifts: the
 * constant was left at the Duel Dice phase sizes (B = 1,000, total 6,700) after
 * the plan moved to B = 2,000 / total 7,700, which would have made Step 14 FLAG
 * a capture that had in fact honoured the plan — and only after the money was
 * spent, since the step cannot run before a dataset exists.
 *
 * These tests read the capture script as text and assert the two agree, so the
 * drift is caught at `npm test` time rather than after the capture.
 */

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { PLAN, PLANNED_TOTAL } from '../../src/capture-plan';

const SCRIPT = path.join(__dirname, '..', '..', 'capture', 'capture-auto.reference.js');

/** Pull the `{ key: 'A', ... total: 5000, ... }` entries out of the PHASES table. */
function phasesFromCaptureScript(): Record<string, number> {
  const src = fs.readFileSync(SCRIPT, 'utf8');
  const table = src.slice(src.indexOf('var PHASES'), src.indexOf('var PHASES') + 1200);
  const out: Record<string, number> = {};
  const entry = /key:\s*'([A-Z])'[^}]*?total:\s*(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = entry.exec(table)) !== null) out[m[1]] = parseInt(m[2], 10);
  return out;
}

describe('Capture plan — verifier constant vs the script that places the bets', () => {
  const scriptPhases = phasesFromCaptureScript();

  it('the capture script is present and its PHASES table is parseable', () => {
    assert.ok(fs.existsSync(SCRIPT), `${SCRIPT} must exist`);
    assert.deepStrictEqual(Object.keys(scriptPhases).sort(), ['A', 'B', 'C', 'D'],
      `parsed ${JSON.stringify(scriptPhases)} — the regex no longer matches the PHASES table`);
  });

  it('every phase size in Step 14 matches the capture script', () => {
    assert.deepStrictEqual(scriptPhases, { ...PLAN },
      'tests/steps/dataset.ts PLAN and capture/capture-auto.reference.js PHASES disagree');
  });

  it('the planned total is the 7,700 the MANIFEST commits to', () => {
    assert.strictEqual(PLANNED_TOTAL, 7700, `planned total is ${PLANNED_TOTAL}`);
    const manifest = fs.readFileSync(path.join(__dirname, '..', '..', 'MANIFEST.md'), 'utf8');
    assert.ok(manifest.includes('7,700'), 'MANIFEST.md no longer states a 7,700-bet plan');
  });
});
