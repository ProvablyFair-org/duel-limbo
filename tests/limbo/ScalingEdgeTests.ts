/**
 * Self-tests for Step 20 (scaling edge).
 *
 * The point of Step 20 is that it RECOMPUTES the applied edge from each bet's own
 * `target x win_chance` rather than trusting a constant or an operator field. A step
 * like that is only worth shipping if it can be shown to fail, so these tests plant
 * edges into synthetic datasets and assert the step reacts:
 *
 *   - every bet at the declared floor            -> PASS
 *   - a single bet lifted off the floor          -> FAIL   (not averaged away)
 *   - an entire dataset above the floor          -> FAIL
 *   - no bets captured yet                       -> FLAG   (never a silent PASS)
 *
 * Without the middle case a "PASS" would prove nothing: a step that only ever sees
 * conforming data cannot distinguish a compliant operator from a broken check.
 */

import { strict as assert } from 'assert';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { buildSeedMap, groupByHash } from '../../src/loader';
import type { LimboBet, LimboDataset } from '../../src/types';
import type { VerifyContext } from '../steps/context';
import * as scalingedge from '../steps/scalingedge';
import {
  loadConfig, exposureCap, scalingOnset, maxProfit, exactEdgeFromBet,
  getConfigPath, CONFIG_2026_10_05_SHA256, getConfig20261005Path,
} from '../../src/scaling-edge';

const TARGETS = [1.01, 1.5, 2, 5, 25, 100, 1000];

function buildDataset(edgeFor: (i: number) => number, n = 60): LimboDataset {
  const serverSeed = crypto.randomBytes(32).toString('hex');
  const hashed = crypto.createHash('sha256').update(Buffer.from(serverSeed, 'hex')).digest('hex');
  const clientSeed = crypto.randomBytes(6).toString('hex');
  const bets: LimboBet[] = [];
  for (let i = 0; i < n; i++) {
    const target = TARGETS[i % TARGETS.length];
    const edge = edgeFor(i);
    bets.push({
      at: new Date(1_780_000_000_000 + i * 1000).toISOString(),
      phase: 'A',
      request: { amount: '0.01000000', target, instant: true },
      response: {
        id: i + 1,
        result: (target * 2).toFixed(6),
        is_win: true,
        amount_currency: 'USD',
        amount_won: (0.01 * target).toFixed(8),
        target: target.toFixed(2),
        win_chance: ((1 - edge) / target).toFixed(18),
        multiplier: target.toFixed(8),
        nonce: i + 1,
        server_seed_hashed: hashed,
        client_seed: clientSeed,
        server_seed: serverSeed,
        effective_edge: 0,
        house_edge_percentage: 0.1,
        balance_type: 105,
      },
    } as LimboBet);
  }
  return {
    meta: {} as LimboDataset['meta'],
    seeds: [{ epoch: 0, phase: 'A', at: '', clientSeed, hashedServerSeed: hashed,
              nextHashedServerSeed: '', serverSeed, nonceStart: 1, nonceEnd: n,
              commitVerified: true, chainLinkOk: true }] as unknown as LimboDataset['seeds'],
    bets,
  } as LimboDataset;
}

function ctxFor(ds: LimboDataset): VerifyContext {
  return {
    bets: ds.bets, seeds: ds.seeds,
    seedMap: buildSeedMap(ds.seeds), byHash: groupByHash(ds.bets),
    phaseA: ds.bets, phaseB: [], phaseC: [], phaseD: [],
    outputsDir: '/tmp',
    determinismMismatches: 0, determinismSkipped: 0,
    measuredEdge: null, chiResultsLog: [],
  } as unknown as VerifyContext;
}

function quiet<T>(fn: () => T): T {
  const log = console.log;
  console.log = () => {};
  try { return fn(); } finally { console.log = log; }
}

describe('limbo: scaling-edge config artifact', () => {
  it('loads the operator config and exposes the declared bounds; E12, the duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET), carries the same values', () => {
    const cfg = loadConfig();
    assert.equal(cfg.scalingEdge.enabled, true, 'config declares scaling edge enabled');
    assert.ok(cfg.scalingEdge.minEdge > 0, 'floor is positive');
    assert.ok(cfg.scalingEdge.maxEdge > cfg.scalingEdge.minEdge, 'ceiling exceeds floor');
    assert.equal(cfg.maxTarget, 100000, 'max_target read from the artifact');

    // E12: the duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET), saved unedited.
    const bytes = fs.readFileSync(getConfig20261005Path());
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), CONFIG_2026_10_05_SHA256,
      'evidence/E12-limbo-config-2026-10-05.json matches its pin');
    const fetched = JSON.parse(bytes.toString('utf-8'));
    const recorded = JSON.parse(fs.readFileSync(getConfigPath(), 'utf-8'));
    assert.deepEqual(fetched.data, recorded.data,
      'the duel.com config as fetched 2026-10-05 in a logged-in session (read-only GET) carries the same max_target and scaling_edge values as limboConfig.json (2026-08-21)');
  });

  it('derives the exposure cap, the scaling onset and the maximum profit from the config parameters', () => {
    const p = loadConfig().scalingEdge;
    assert.equal(exposureCap(p), p.maxLossFraction * p.bankroll);
    assert.equal(scalingOnset(p), p.bankroll * p.minEdge);
    assert.equal(maxProfit(p), p.bankroll * p.maxEdge);
    assert.equal(scalingOnset(p), 25000, 'bankroll 25,000,000 x min_edge 0.001');
    assert.equal(maxProfit(p), 250000, 'bankroll 25,000,000 x max_edge 0.01');
    assert.ok(maxProfit(p) < exposureCap(p), 'the max-loss limit never binds: the ceiling profit is below it');
  });

  it('recovers a planted edge exactly from target x win_chance', () => {
    for (const planted of [0.001, 0.005, 0.01, 0.037]) {
      const wc = (1 - planted) / 2;
      assert.ok(Math.abs(exactEdgeFromBet(2, wc) - planted) < 1e-12,
        `edge identity must invert exactly for ${planted}`);
    }
  });
});

describe('limbo: Step 20 falsifiability', () => {
  const floor = loadConfig().scalingEdge.minEdge;

  it('PASSES when every bet sits at the declared floor', () => {
    const [r] = quiet(() => scalingedge.run(ctxFor(buildDataset(() => floor))));
    assert.equal(r.status, 'PASS', r.detail);
    assert.match(r.detail, /60\/60 bets/);
  });

  it('FAILS on a SINGLE bet lifted off the floor — not averaged away', () => {
    const [r] = quiet(() => scalingedge.run(ctxFor(buildDataset(i => (i === 17 ? floor * 2 : floor)))));
    assert.equal(r.status, 'FAIL', 'one non-conforming bet must fail the step');
    assert.match(r.detail, /1 bet\(s\) OFF the floor/);
  });

  it('FAILS when the whole dataset sits above the floor', () => {
    const [r] = quiet(() => scalingedge.run(ctxFor(buildDataset(() => 0.01))));
    assert.equal(r.status, 'FAIL', r.detail);
  });

  it('FLAGS rather than passing when no bets have been captured', () => {
    const ds = buildDataset(() => floor, 0);
    const [r] = quiet(() => scalingedge.run(ctxFor(ds)));
    assert.equal(r.status, 'FLAG', 'an empty capture must never read as a clean pass');
  });

  it('reports the scaling-onset headroom so the floor-only scope is explicit', () => {
    const [r] = quiet(() => scalingedge.run(ctxFor(buildDataset(() => floor))));
    assert.match(r.detail, /largest potential profit \(stake x \(target − 1\)\)/);
    assert.match(r.detail, /vs 25,000 = bankroll x min_edge/);
    assert.match(r.detail, /headroom/);
    assert.match(r.detail, /characterise the FLOOR only/);
  });
});
