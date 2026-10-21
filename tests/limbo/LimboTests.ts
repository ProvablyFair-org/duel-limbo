/**
 * Unit tests — Duel.com Limbo provably fair audit.
 * Run: npm test
 *
 * Two groups:
 *  1. "Cryptographic Core" and "Payout Formulas". Vectors are computed by
 *     Duel's PUBLISHED verifier formula, used here as a second check of
 *     src/rng.ts (which is rebuilt from the written spec docs/ALGORITHM.md, not
 *     from Duel's code; its own spec self-test is tests/limbo/RngSpecTests.ts).
 *  2. "Live dataset" — skipped until data/limbo-master.json exists, then it
 *     reproduces every captured bet from first principles.
 */

import * as assert from 'assert';
import * as crypto from 'crypto';
import {
  computeMultiplier, computeMultiplierFromBuffer, drawValue, verifyHash,
  fairWinChance, effectiveWinChance, theoreticalRTP, MAX_U32,
} from '../../src/rng';
import { datasetExists, loadDataset, buildSeedMap, groupByHash } from '../../src/loader';
import { num } from '../../src/types';

// ── Engine vectors (algorithm-derived; the live-dataset block below anchors the ──
// engine to the 7,700 captured bets, and the Web Crypto parity test checks src/rng.ts
// against Duel's published formula over the browser primitive on every run) ──
// serverSeed → serverSeedHashed verified below via SHA-256(hex bytes).
const SS  = 'aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899';
const SSH = '13216bdbddb256a9c661c2f6844cdba5ca81d1d9b4225153f0834c58d027fc8d';
const CS  = 'audit-limbo';

const vectors = [
  { nonce: 0,  value: 1686590029, expected: 2.546539 },
  { nonce: 1,  value: 1531982053, expected: 2.803536 },
  { nonce: 2,  value: 1621931926, expected: 2.648056 },
  { nonce: 7,  value: 2775628872, expected: 1.547385 },
  { nonce: 42, value: 4062804661, expected: 1.057143 },
];

describe('Cryptographic Core', () => {
  it('computeMultiplier matches expected multiplier for all engine vectors', () => {
    for (const v of vectors) {
      const m = computeMultiplier(SS, CS, v.nonce);
      assert.strictEqual(m, v.expected,
        `nonce=${v.nonce}: expected ${v.expected}, got ${m}`);
    }
  });

  it('drawValue matches the expected first-4-byte uint32 for all vectors', () => {
    for (const v of vectors) {
      assert.strictEqual(drawValue(SS, CS, v.nonce), v.value, `nonce=${v.nonce}`);
    }
  });

  it('computeMultiplierFromBuffer matches computeMultiplier', () => {
    const key = Buffer.from(SS, 'hex');
    for (const v of vectors) {
      assert.strictEqual(computeMultiplierFromBuffer(key, CS, v.nonce), computeMultiplier(SS, CS, v.nonce));
    }
  });

  it('HMAC key must be hex-decoded bytes (UTF-8 key would differ)', () => {
    const wrong = Buffer.from(SS, 'utf-8');
    for (const v of vectors) {
      assert.notStrictEqual(computeMultiplierFromBuffer(wrong, CS, v.nonce), computeMultiplier(SS, CS, v.nonce));
    }
  });

  it('multiplier is always >= 1.0 and truncated to 6 decimals', () => {
    for (let n = 0; n < 2000; n++) {
      const m = computeMultiplier(SS, CS, n);
      assert.ok(m >= 1.0, `m=${m} < 1.0`);
      assert.ok(Math.abs(m * 1e6 - Math.round(m * 1e6)) < 1e-6, `m=${m} not 6-dp`);
    }
  });

  it('formula equals floor(2^32/(value+1)*1e6)/1e6 (min 1.0)', () => {
    for (const v of vectors) {
      const expected = Math.max(1.0, Math.floor((MAX_U32 / (v.value + 1)) * 1e6) / 1e6);
      assert.strictEqual(computeMultiplier(SS, CS, v.nonce), expected);
    }
  });

  it('verifyHash confirms commit-reveal integrity (SHA-256 over hex bytes)', () => {
    assert.ok(verifyHash(SS, SSH));
  });

  it('verifyHash rejects a tampered server seed', () => {
    assert.strictEqual(verifyHash('ff' + SS.slice(2), SSH), false);
  });

  it('verifyHash rejects a tampered hash', () => {
    assert.strictEqual(verifyHash(SS, 'ff' + SSH.slice(2)), false);
  });

  it('different nonces and client seeds produce different multipliers', () => {
    assert.notStrictEqual(computeMultiplier(SS, CS, 0), computeMultiplier(SS, CS, 1));
    assert.notStrictEqual(computeMultiplier(SS, 'alpha', 0), computeMultiplier(SS, 'beta', 0));
  });
});

describe('Payout Formulas', () => {
  it('fair win chance = 1/T', () => {
    for (const T of [1.5, 2, 5, 10, 100, 1000]) {
      assert.ok(Math.abs(fairWinChance(T) - 1 / T) < 1e-15, `T=${T}`);
    }
  });

  it('effective win chance = (1-edge)/T and RTP = 1-edge (edge applied to threshold)', () => {
    for (const edge of [0.01, 0.02, 0.05]) {
      for (const T of [2, 5, 25, 100]) {
        const wc  = effectiveWinChance(T, edge);
        const rtp = T * wc;                 // payout multiplier = T
        assert.ok(Math.abs(wc - (1 - edge) / T) < 1e-15, `edge=${edge} T=${T}`);
        assert.ok(Math.abs(rtp - theoreticalRTP(edge)) < 1e-12, `RTP edge=${edge} T=${T}`);
      }
    }
  });

  it('empirical fair win rate approximates 1/T over a Monte-Carlo sample', () => {
    const T = 2, N = 200_000;
    let wins = 0;
    for (let n = 0; n < N; n++) if (computeMultiplier(SS, CS, n) >= T) wins++;
    const rate = wins / N;
    assert.ok(Math.abs(rate - 1 / T) < 0.01, `win rate ${rate} vs 1/T ${1 / T}`);
  });
});

describe('Live dataset (reproduce every captured bet)', function () {
  before(function () {
    if (!datasetExists()) this.skip();   // defensive: delivered repo ships the dataset
  });

  it('reproduces every captured multiplier from revealed seeds', () => {
    const ds      = loadDataset();
    const seedMap = buildSeedMap(ds.seeds);
    const byHash  = groupByHash(ds.bets);
    let checked = 0, mism = 0;
    for (const [hash, serverSeed] of seedMap) {
      const key = Buffer.from(serverSeed, 'hex');
      for (const b of byHash.get(hash) ?? []) {
        const m = computeMultiplierFromBuffer(key, b.response.client_seed, b.response.nonce);
        checked++;
        if (m !== num(b.response.result)) mism++;
      }
    }
    assert.ok(checked > 0, 'no reproducible bets — seed map empty');
    assert.strictEqual(mism, 0, `${mism}/${checked} multipliers did not reproduce`);
  });
});

describe('Web Crypto parity (second check against Duel\'s published formula)', function () {
  this.timeout(60000);
  // src/rng.ts is rebuilt from docs/ALGORITHM.md, not from Duel's code. As a second check,
  // Duel's published Web-Crypto formula (crypto.subtle HMAC-SHA256 with a hex-decoded key over
  // `clientSeed:nonce`, first uint32 -> max(1, floor(2^32/(v+1)*1e6)/1e6), in doubles) is run
  // fresh every time on 5,000 random cases and compared with src/rng.ts (exact integer form).
  it('5,000 random cases: Web Crypto implementation of Duel\'s formula == src/rng.ts (0 mismatches)', async () => {
    const subtle = (crypto as any).webcrypto.subtle;
    async function duelPublished(serverSeedHex: string, clientSeed: string, nonce: number): Promise<number> {
      const key = await subtle.importKey('raw', Buffer.from(serverSeedHex, 'hex'),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const sig = Buffer.from(await subtle.sign('HMAC', key, Buffer.from(`${clientSeed}:${nonce}`, 'utf8')));
      const value = sig.readUInt32BE(0);
      return Math.max(1, Math.floor(2 ** 32 / (value + 1) * 1e6) / 1e6);
    }
    let mismatches = 0;
    for (let i = 0; i < 5000; i++) {
      const ss = crypto.randomBytes(32).toString('hex');
      const cs = crypto.randomBytes(8).toString('hex');
      const n  = crypto.randomBytes(2).readUInt16BE(0);
      const a  = await duelPublished(ss, cs, n);
      const b  = computeMultiplier(ss, cs, n);
      if (a !== b) mismatches++;
    }
    assert.strictEqual(mismatches, 0, `${mismatches}/5000 cases diverged`);
  });
});

