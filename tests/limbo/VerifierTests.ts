/**
 * Verifier self-tests.
 *
 * The scored steps in tests/steps/ are the instrument this audit depends on, so
 * they are themselves tested against a synthetic dataset with a KNOWN house
 * edge, built here with the real RNG. Two things are proven before any live
 * capture exists:
 *
 *   1. the edge-measurement in Step 9 recovers a planted edge to high precision;
 *   2. the steps FAIL on tampered data — they are falsifiable, not vacuous.
 */

import * as assert from 'assert';
import * as crypto from 'crypto';

import { computeMultiplier } from '../../src/rng';
import type { LimboBet, SeedEntry, LimboDataset } from '../../src/types';
import type { VerifyContext } from '../steps/context';
import { buildSeedMap, groupByHash } from '../../src/loader';

import * as commitment  from '../steps/commitment';
import * as determinism from '../steps/determinism';
import * as payouts     from '../steps/payouts';

const PLANTED_EDGE = 0.01;
const TARGETS = [1.1, 1.5, 2, 3, 5, 10, 25, 50, 100, 500, 1000];

type Bytes = (n: number) => Buffer;

/** Fresh entropy — the default, so no draw can be cherry-picked. */
const randomBytes: Bytes = (n) => crypto.randomBytes(n);

/**
 * Deterministic byte source, used ONLY by the two tests whose expectation is a
 * claim about statistical POWER rather than about correctness.
 *
 * The bracket closes only when a result lands near T/(1-edge); since
 * P(R >= x) = 1/x the gap on each side is ~Exp(mean T/n), so the width is
 * Gamma(2, T/n) and a draw can always land in the tail. Asserting "this sample
 * is/is not precise enough" against fresh entropy therefore makes the
 * expectation itself a coin flip: measured over 2,000 draws, the wide-sample
 * FLAG expectation failed 1.5% of runs and the low-target PASS expectation 3.0%.
 * Pinning the source removes that flake without weakening either claim — the
 * low-target block is additionally sized (20,000 bets) so the PASS holds for
 * essentially any seed, not just this one.
 */
function pinnedBytes(label: string): Bytes {
  let counter = 0;
  return (n) => {
    const out = Buffer.alloc(n);
    for (let off = 0; off < n; off += 32) {
      crypto.createHash('sha256').update(`${label}:${counter++}`).digest().copy(out, off);
    }
    return out.subarray(0, n);
  };
}

/** Build a synthetic dataset: two epochs, both revealed, bets across targets. */
function buildDataset(edge: number, betsPerEpoch = 400, bytes: Bytes = randomBytes,
                      targets: number[] = TARGETS): LimboDataset {
  const epochs = [0, 1].map(() => {
    const serverSeed = bytes(32).toString('hex');
    const hashed = crypto.createHash('sha256')
      .update(Buffer.from(serverSeed, 'hex')).digest('hex');
    return { serverSeed, hashed, clientSeed: bytes(6).toString('hex') };
  });

  const bets: LimboBet[] = [];
  let id = 1;
  epochs.forEach((ep, ei) => {
    for (let n = 1; n <= betsPerEpoch; n++) {
      const target = targets[(n - 1) % targets.length];
      const result = computeMultiplier(ep.serverSeed, ep.clientSeed, n);
      const isWin  = result >= target / (1 - edge);
      const stake  = ei === 0 ? 0.01 : 10;
      const phase  = ei === 0 ? (n <= betsPerEpoch - 100 ? 'A' : 'B') : (n <= 100 ? 'C' : 'D');
      bets.push({
        at: new Date(1_780_000_000_000 + id * 1000).toISOString(),
        phase,
        request:  { amount: stake.toFixed(8), target, instant: true },
        response: {
          id: id++,
          result: result.toFixed(6),
          is_win: isWin,
          // the stake at 18 dp — NOT a currency code (live shape, 2026-08-31)
          amount_currency: stake.toFixed(18),
          amount_won: (isWin ? stake * target : 0).toFixed(8),
          target: target.toFixed(2),
          win_chance: ((1 - edge) / target).toFixed(18),
          multiplier: target.toFixed(8),
          nonce: n,
          server_seed_hashed: ep.hashed,
          client_seed: ep.clientSeed,
          server_seed: null,
          // live bets return these EQUAL; the fixture mirrors that rather than
          // the effective_edge = 0 that an earlier note recorded and that did
          // not reproduce at pre-flight
          effective_edge: edge * 100,
          house_edge_percentage: edge * 100,
          balance_type: 105,
          transaction_id: 1_100_000_000 + id,
        },
      });
    }
  });

  // Seed chain: entry N publishes its hash; entry N+1 carries the plaintext.
  // The chain must be genuinely linked (nextServerSeedHash === the next entry's
  // serverSeedHashed) — Step 2 recomputes adjacency from these fields.
  const closingHashed = crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex');
  const seeds: SeedEntry[] = [
    {
      at: '2026-01-01T00:00:00.000Z', context: 'initial', phase: 'A',
      seed: {
        clientSeed: epochs[0].clientSeed,
        serverSeedHashed: epochs[0].hashed,
        nextServerSeedHash: epochs[1].hashed,
        serverSeed: null,
      },
      nonce: 0,
      // every rotation record carries its promotion (Step 2 requires one per record, as the live rig records)
      nextSeedPromotion: { previousNextHash: epochs[0].hashed, newActiveHash: epochs[0].hashed, newNextHash: epochs[1].hashed, match: true },
    },
    {
      at: '2026-01-01T01:00:00.000Z', context: 'rotation', phase: 'C',
      seed: {
        clientSeed: epochs[1].clientSeed,
        serverSeedHashed: epochs[1].hashed,
        nextServerSeedHash: closingHashed,   // genuinely links to the closing entry
        serverSeed: epochs[0].serverSeed,   // reveals epoch 0
      },
      nonce: 0,
      nextSeedPromotion: {
        previousNextHash: epochs[1].hashed,
        newActiveHash:    epochs[1].hashed,
        newNextHash:      'n/a',
        match:            true,
      },
    },
    {
      at: '2026-01-01T02:00:00.000Z', context: 'final-rotation', phase: 'D',
      seed: {
        clientSeed: 'closing',
        serverSeedHashed: closingHashed,
        nextServerSeedHash: bytes(32).toString('hex'),
        serverSeed: epochs[1].serverSeed,   // reveals epoch 1
      },
      nonce: 0,
      nextSeedPromotion: { previousNextHash: closingHashed, newActiveHash: closingHashed, newNextHash: 'n/a', match: true },
    },
  ];

  return { meta: { synthetic: true, plantedEdge: edge }, seeds, bets };
}

function makeCtx(ds: LimboDataset): VerifyContext {
  return {
    bets: ds.bets, seeds: ds.seeds,
    seedMap: buildSeedMap(ds.seeds),
    byHash:  groupByHash(ds.bets),
    phaseA: ds.bets.filter(b => b.phase === 'A'),
    phaseB: ds.bets.filter(b => b.phase === 'B'),
    phaseC: ds.bets.filter(b => b.phase === 'C'),
    phaseD: ds.bets.filter(b => b.phase === 'D'),
    outputsDir: '/tmp',
    determinismMismatches: 0, determinismSkipped: 0,
    measuredEdge: null, chiResultsLog: [],
  };
}

/** Silence the step() console output while the self-tests run. */
function quiet<T>(fn: () => T): T {
  const log = console.log;
  console.log = () => {};
  try { return fn(); } finally { console.log = log; }
}

describe('Verifier self-test — commitment and determinism', () => {
  const ds  = buildDataset(PLANTED_EDGE);
  const ctx = makeCtx(ds);

  it('every epoch resolves to a revealed server seed', () => {
    assert.strictEqual(ctx.seedMap.size, 2);
  });

  // G-BIND (2026-09-26): Steps 1, 3, 4, 5 and 7 bind their population to src/capture-plan.ts
  // (7,700 bets, 154 epochs of 50 from nonce 0, 157 reveals). A synthetic 800-bet, 2-epoch dataset
  // is internally well-formed but is NOT the audited population, so those steps must FAIL on it —
  // that is the binding working. What must still hold on it: the forward chain (Step 2), the
  // negative control (Step 6), and zero recomputation mismatches.
  it('commitment: the chain passes on a well-formed dataset; population-bound steps refuse a population that is not the audited one', () => {
    const res = quiet(() => commitment.run(ctx));
    assert.strictEqual(res.find(r => r.step === 2)!.status, 'PASS', res.find(r => r.step === 2)!.detail);
    for (const n of [1, 3, 4]) {
      const r = res.find(x => x.step === n)!;
      assert.strictEqual(r.status, 'FAIL', `step ${n} must refuse an 800-bet population: ${r.detail}`);
    }
  });

  it('determinism: every result reproduces (0 mismatches) and the negative control fires; population-bound steps refuse the synthetic population', () => {
    const res = quiet(() => determinism.run(ctx));
    assert.strictEqual(res.find(r => r.step === 6)!.status, 'PASS');
    assert.strictEqual(ctx.determinismMismatches, 0);
    assert.strictEqual(res.find(r => r.step === 5)!.status, 'FAIL');   // 800 ≠ EXPECTED_BETS
    assert.strictEqual(res.find(r => r.step === 7)!.status, 'FAIL');   // nonces 1..400 ≠ 0..49
  });

  it('determinism FAILS when a single result is tampered with', () => {
    const tampered = makeCtx(JSON.parse(JSON.stringify(ds)) as LimboDataset);
    tampered.bets[5].response.result = (parseFloat(tampered.bets[5].response.result) + 0.000001).toFixed(6);
    const res = quiet(() => determinism.run(tampered));
    assert.strictEqual(res.find(r => r.step === 5)!.status, 'FAIL');
  });
});

describe('Verifier self-test — house-edge measurement', () => {
  it('recovers a planted 1% edge from the win/lose boundary', () => {
    const ctx = makeCtx(buildDataset(0.01));
    quiet(() => payouts.run(ctx));
    const e = ctx.measuredEdge!;
    assert.ok(e.bracketed, 'edge should be bracketed');
    assert.ok(e.lower < 0.01 && 0.01 <= e.upper,
      `planted 0.01 must lie in the measured bracket (${e.lower}, ${e.upper}]`);
  });

  it('recovers a different planted edge (3%) — the method is not hard-coded', () => {
    const ctx = makeCtx(buildDataset(0.03));
    quiet(() => payouts.run(ctx));
    const e = ctx.measuredEdge!;
    assert.ok(e.bracketed);
    assert.ok(e.lower < 0.03 && 0.03 <= e.upper,
      `planted 0.03 must lie in the measured bracket (${e.lower}, ${e.upper}]`);
  });

  it('fails an operator-reported edge that lies outside the measured bracket', () => {
    // Discrimination power is bounded by the bracket width: a claim inside the
    // bracket cannot be contradicted by the data, which is why the capture is
    // designed to close the bracket (see the low-target test below). Here the
    // claimed 5% is far outside a bracket that sits around 1%.
    const ds = buildDataset(0.01);
    for (const b of ds.bets) b.response.house_edge_percentage = 5;   // claim 5% distribution edge
    const ctx = makeCtx(ds);
    const res = quiet(() => payouts.run(ctx));
    const s11 = res.find(r => r.step === 11)!;
    assert.strictEqual(s11.status, 'FAIL', s11.detail);
  });

  it('accepts a reported edge the data cannot rule out, and says so', () => {
    // Honest behaviour on a weak sample: a nearby claim is reported consistent
    // rather than manufactured into a finding.
    //
    // The claim is derived from the bracket THIS draw produced. A hard-coded
    // 0.9% made the expectation depend on the draw — the bracket's lower bound
    // exceeded 0.9% in 18.4% of 2,000 measured draws, so the test failed roughly
    // one run in five for a reason that had nothing to do with the instrument.
    const ds = buildDataset(0.01);
    const probe = makeCtx(ds);
    quiet(() => payouts.run(probe));
    const { lower, upper, bracketed } = probe.measuredEdge!;
    assert.ok(bracketed, 'precondition: the draw must bracket the edge');

    // Strictly inside the bracket and deliberately NOT the planted 1%: a claim
    // that is wrong but that the data has no power to contradict must still be
    // reported consistent rather than turned into a finding.
    const claim = (lower + PLANTED_EDGE) / 2;
    assert.ok(claim > lower && claim <= upper && claim < PLANTED_EDGE,
      `claim ${claim} must sit inside (${lower}, ${upper}] and below the planted edge`);

    for (const b of ds.bets) b.response.house_edge_percentage = claim * 100;
    const res = quiet(() => payouts.run(makeCtx(ds)));
    const s11 = res.find(r => r.step === 11)!;
    assert.strictEqual(s11.status, 'PASS', s11.detail);
  });

  it('payout, win-condition and win-chance steps pass on honest data', () => {
    const ctx = makeCtx(buildDataset(0.01));
    const res = quiet(() => payouts.run(ctx));
    // Step 8 is population-bound (EXPECTED_BETS): on the synthetic set it must FAIL for that reason
    // alone — every payout is exact.
    const s8 = res.find(r => r.step === 8)!;
    assert.strictEqual(s8.status, 'FAIL');
    assert.ok(/ 0 payout errors; 0 bets whose 18-dp multiplier echo/.test(s8.detail), s8.detail);
    for (const stepNum of [10, 12]) {
      assert.strictEqual(res.find(r => r.step === stepNum)!.status, 'PASS',
        `step ${stepNum} should pass: ${res.find(r => r.step === stepNum)!.detail}`);
    }
  });

  it('a small sample brackets the edge but FLAGs it as imprecise', () => {
    // 800 bets spread over 11 targets cannot pin the edge to 0.10 pp. The step
    // must say so rather than presenting a wide bracket as a measurement.
    // Pinned source — see pinnedBytes: this asserts a power claim, and against
    // fresh entropy the draw itself came in under 0.10 pp in 1.5% of runs.
    const ctx = makeCtx(buildDataset(0.01, 400, pinnedBytes('wide-sample')));
    const res = quiet(() => payouts.run(ctx));
    const s9 = res.find(r => r.step === 9)!;
    assert.strictEqual(s9.status, 'FLAG', s9.detail);
    assert.ok(ctx.measuredEdge!.bracketed);
    const widthPP = (ctx.measuredEdge!.upper - ctx.measuredEdge!.lower) * 100;
    assert.ok(widthPP > 0.10, `the draw must actually be imprecise, width ${widthPP} pp`);
  });

  it('a low-target sample tightens the bracket enough to PASS', () => {
    // Concentrating bets at a low target is what closes the bracket — this is
    // the capture-design conclusion the plan is built on, asserted here so a
    // future change to the plan cannot quietly break the precision claim.
    // Pinned source and 20,000 bets — see pinnedBytes. At 6,000 bets the width
    // is Gamma(2, T/n) with mean 0.034 pp, whose tail put the draw over the
    // 0.10 pp threshold in 3.0% of runs; at 20,000 the same tail bound is
    // ~5e-8, so the PASS now holds for essentially any seed, not just this one.
    const bytes = pinnedBytes('low-target');
    const ds = buildDataset(0.01, 60, bytes);
    const serverSeed = bytes(32).toString('hex');
    const hashed = crypto.createHash('sha256')
      .update(Buffer.from(serverSeed, 'hex')).digest('hex');
    const clientSeed = 'low-target-phase';
    const extra: LimboBet[] = [];
    for (let n = 1; n <= 20000; n++) {
      const target = 1.01;
      const result = computeMultiplier(serverSeed, clientSeed, n);
      const isWin = result >= target / (1 - 0.01);
      extra.push({
        at: '2026-01-02T00:00:00.000Z', phase: 'B',
        request: { amount: '0.01000000', target, instant: true },
        response: {
          id: 500000 + n, result: result.toFixed(6), is_win: isWin,
          amount_currency: (0.01).toFixed(18),
          amount_won: (isWin ? 0.01 * target : 0).toFixed(8), target: target.toFixed(2),
          win_chance: ((1 - 0.01) / target).toFixed(18), multiplier: target.toFixed(8),
          nonce: n, server_seed_hashed: hashed, client_seed: clientSeed,
          server_seed: null, effective_edge: 1, house_edge_percentage: 1, balance_type: 105,
          transaction_id: 1_200_000_000 + n,
        },
      });
    }
    ds.bets.push(...extra);
    ds.seeds.push({
      at: '2026-01-02T01:00:00.000Z', context: 'reveal', phase: 'B',
      seed: {
        clientSeed: 'closing-2', serverSeedHashed: bytes(32).toString('hex'),
        nextServerSeedHash: bytes(32).toString('hex'), serverSeed,
      },
      nonce: 0,
    });

    const ctx = makeCtx(ds);
    const res = quiet(() => payouts.run(ctx));
    const s9 = res.find(r => r.step === 9)!;
    assert.strictEqual(s9.status, 'PASS', s9.detail);
    const e = ctx.measuredEdge!;
    assert.ok(e.lower < 0.01 && 0.01 <= e.upper, `planted edge must sit in (${e.lower}, ${e.upper}]`);
  });

  it('payout step FAILS when a winning bet is underpaid', () => {
    const ds = buildDataset(0.01);
    const win = ds.bets.find(b => b.response.is_win)!;
    win.response.amount_won = (parseFloat(win.response.amount_won) * 0.9).toFixed(8);
    const ctx = makeCtx(ds);
    const res = quiet(() => payouts.run(ctx));
    assert.strictEqual(res.find(r => r.step === 8)!.status, 'FAIL');
  });
});
