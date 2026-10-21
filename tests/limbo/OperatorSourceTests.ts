/**
 * Operator source, run as a SECOND CHECK (profile LIMBO-09).
 *
 * src/rng.ts is rebuilt from the written specification docs/ALGORITHM.md by an implementer who never
 * opened Duel's code (its own spec self-test is tests/limbo/RngSpecTests.ts). Duel's own Limbo Verify-tab code, pasted by Paulo from duel.com → Provably Fair → Verify (Limbo) on
 * 2026-09-26, is vendored verbatim at evidence/verify-tab/duel-verify-tab-limbo-2026-09-26.js and
 * pinned in src/operator-verifier.ts. These tests:
 *   1. require the file and its runner to hash to their pins, and the file, run as shipped, to print
 *      only its empty-input line;
 *   2. EXECUTE the pinned file — only its "User input values" filled in — on fixed vectors (the first
 *      captured bet of each phase) and on every captured bet, and require its roll to equal the served
 *      result and src/rng.ts as integer 6-dp units;
 *   3. keep the older 2026-08-18 transcription (evidence/algorithm-transcription-2026-08-18.md, E04) executing too, as a record that it
 *      computes the same result.
 * Through v1.1.0 src/rng.ts was a port of the Verify-tab file and these tests also checked the 8 lines it
 * cited (OPERATOR_SOURCE_CITES); the port and the citation table were removed on 20 Oct 2026.
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { webcrypto } from 'crypto';
import { computeResultUnitsFromBuffer } from '../../src/rng';
import { unitsFromDecimal } from '../../src/exact';
import { loadDataset, buildSeedMap } from '../../src/loader';
import {
  runOperatorVerifier, OPERATOR_VERIFIER_PINS, OPERATOR_VERIFIER_FILE, OPERATOR_EXPECTED_LOGS,
  OPERATOR_SCALING_EDGE_NOTE,
} from '../../src/operator-verifier';

const ALGO = path.join(__dirname, '../../evidence/algorithm-transcription-2026-08-18.md');

function transcribedFunction(): (s: string, c: string, n: number) => Promise<string> {
  const lines = fs.readFileSync(ALGO, 'utf8').split('\n');
  const start = lines.findIndex(l => l.trim() === '```js');
  const end = lines.findIndex((l, i) => i > start && l.trim() === '```');
  const code = lines.slice(start + 1, end).join('\n');
  const helper = async (serverSeed: string, message: Uint8Array): Promise<string> => {
    const key = await webcrypto.subtle.importKey('raw', Buffer.from(serverSeed, 'hex'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await webcrypto.subtle.sign('HMAC', key, message);
    return Buffer.from(sig).toString('hex');
  };
  // eslint-disable-next-line no-new-func
  return new Function('generateHMAC_SHA256', 'TextEncoder', `${code}\nreturn validateLimboResult;`)(helper, TextEncoder);
}

describe('Second check — Duel\'s own Limbo Verify-tab code, executed with only its inputs filled in (pasted 2026-09-26)', function () {
  this.timeout(300_000);
  const ds = loadDataset();
  const seeds = buildSeedMap(ds.seeds);
  const phaseFirst = ['A', 'B', 'C', 'D'].map(ph => ds.bets.find(x => x.phase === ph)!);
  const rounds = ds.bets.map((b, i) => ({ id: `bet${i}`, inputs: {
    clientSeed: b.response.client_seed, serverSeed: seeds.get(b.response.server_seed_hashed) ?? '', nonce: b.response.nonce, houseEdge: 0.001 } }));
  // houseEdge 0 on the fixed vectors: the file then prints its scaling-edge note and afterEdge == roll
  const zero = phaseFirst.map((b, i) => ({ id: `zero${i}`, inputs: {
    clientSeed: b.response.client_seed, serverSeed: seeds.get(b.response.server_seed_hashed)!, nonce: b.response.nonce, houseEdge: 0 } }));
  const run = runOperatorVerifier([...zero, ...rounds]);

  it('the vendored operator file and its runner hash to their pins, the code ran, and as shipped it printed only its empty-input message', () => {
    assert.deepStrictEqual(run.files.map(f => f.match), [true, true]);
    assert.strictEqual(run.files[0].file, OPERATOR_VERIFIER_FILE);
    assert.strictEqual(run.files[0].actual, OPERATOR_VERIFIER_PINS[OPERATOR_VERIFIER_FILE]);
    assert.strictEqual(run.error, null);
    assert.deepStrictEqual(run.shippedLogs, [...OPERATOR_EXPECTED_LOGS]);
  });

  it('fixed vectors: first captured bet of each phase — at houseEdge 0 the file prints its scaling-edge note and roll = afterEdge = served', () => {
    phaseFirst.forEach((b, i) => {
      const r = run.results!.get(`zero${i}`)!;
      assert.strictEqual(r.error, undefined);
      assert.strictEqual(r.value!.roll, b.response.result, `phase ${b.phase} bet ${b.response.id}`);
      assert.strictEqual(r.value!.afterEdge, b.response.result);
      assert.deepStrictEqual(r.logs, [`Game result: ${b.response.result}x`, OPERATOR_SCALING_EDGE_NOTE]);
    });
  });

  it('every captured bet: the operator roll equals the served result and src/rng.ts (7,700/7,700, integer 6-dp units)', () => {
    let agree = 0;
    ds.bets.forEach((b, i) => {
      const r = run.results!.get(`bet${i}`)!;
      const roll = r.value ? unitsFromDecimal(r.value.roll, 6) : null;
      const mine = BigInt(computeResultUnitsFromBuffer(Buffer.from(rounds[i].inputs.serverSeed, 'hex'), b.response.client_seed, b.response.nonce));
      if (roll !== null && roll === unitsFromDecimal(b.response.result, 6) && roll === mine) agree++;
    });
    assert.strictEqual(ds.bets.length, 7700);
    assert.strictEqual(agree, 7700);
  });

  it('the 2026-08-18 transcription (E04, superseded by the 2026-09-26 Verify-tab file) still reproduces every captured result (7,700/7,700)', async () => {
    const fn = transcribedFunction();
    let agree = 0, n = 0;
    for (const b of ds.bets) {
      const s = seeds.get(b.response.server_seed_hashed);
      if (!s) continue;
      n++;
      const out = await fn(s, b.response.client_seed, b.response.nonce);
      if (unitsFromDecimal(out, 6) === unitsFromDecimal(b.response.result, 6)) agree++;
    }
    assert.strictEqual(n, 7700);
    assert.strictEqual(agree, 7700);
  });
});
