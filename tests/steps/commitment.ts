/**
 * Steps 1–4: Commit-Reveal Integrity
 *
 * Duel shows SHA-256(hex_bytes(serverSeed)) for a seed pair and the plaintext only after rotation.
 * In this capture the plaintext of seed record i is carried by record i + 1 (the rotation that
 * retired it). These steps are consistency checks: each revealed plaintext hashes to a commitment
 * of an earlier record, the forward commitment matches across every rotation, every bet sits in the
 * rotation window of the record whose commitment it carries, and 100% of the audited population is
 * verifiable — every count bound to a constant in src/capture-plan.ts. A SHA-256 digest carries no
 * time: that each commitment was shown before its bets rests on the capture's records (DL-4).
 */

import * as crypto from 'crypto';
import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import {
  EXPECTED_BETS, EXPECTED_EPOCHS, EXPECTED_REVEALED, EPOCH_SIZE, EXPECTED_BETLESS_RECORDS,
} from '../../src/capture-plan';

const sha = (hex: string) => crypto.createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex');

export function run(ctx: VerifyContext): StepResult[] {
  const { seeds, bets, seedMap, byHash } = ctx;

  // ── Step 1: every revealed plaintext opens the commitment of an EARLIER seed record ─────────────
  // The former check accepted a plaintext that hashed to ANY commitment in the chain, including one
  // recorded after the reveal. Now a plaintext carried by record i must open the commitment of an
  // EARLIER record j < i, and the opened commitments must cover every epoch that carries bets. This is
  // a consistency check on record order; hash equality carries no time (DL-4). Counts are bound to
  // src/capture-plan.ts, not the dataset.
  const indexOfHash = new Map<string, number>();
  seeds.forEach((s, i) => indexOfHash.set(s.seed.serverSeedHashed, i));
  let revealed = 0, opensEarlier = 0, adjacent = 0, repeats = 0;
  const bad: string[] = [];
  const opened = new Set<string>();
  for (let i = 0; i < seeds.length; i++) {
    const p = seeds[i].seed.serverSeed;
    if (!p) continue;
    revealed++;
    const h = sha(p);
    const j = indexOfHash.get(h);
    if (j === undefined || j >= i) { if (bad.length < 3) bad.push(`record ${i}: plaintext opens ${j === undefined ? 'no commitment' : `record ${j} (not earlier)`}`); continue; }
    opensEarlier++;
    if (j === i - 1) adjacent++;
    if (i > 0 && seeds[i - 1].seed.serverSeed === p) repeats++;
    opened.add(h);
  }
  const bettingEpochs = [...byHash.keys()];
  const epochsOpened = bettingEpochs.filter(h => opened.has(h)).length;
  const unopened = seeds.filter(s => !opened.has(s.seed.serverSeedHashed));
  const unopenedWithBets = unopened.filter(s => byHash.has(s.seed.serverSeedHashed)).length;
  const s1ok = revealed === EXPECTED_REVEALED && opensEarlier === revealed
    && bettingEpochs.length === EXPECTED_EPOCHS && epochsOpened === EXPECTED_EPOCHS
    && unopenedWithBets === 0 && unopened.length === EXPECTED_BETLESS_RECORDS;
  const s1 = step(1, 'Commit-Reveal Integrity (SHA-256 over hex bytes)',
    s1ok ? 'PASS' : 'FAIL',
    `${revealed}/${EXPECTED_REVEALED} revealed plaintexts (src/capture-plan.ts EXPECTED_REVEALED); ${opensEarlier} open a ` +
      `commitment published at an EARLIER seed record (${adjacent} the immediately preceding one; ${repeats} repeat the ` +
      `plaintext of the record before — the phase-boundary double rotation); ${epochsOpened}/${EXPECTED_EPOCHS} betting epochs ` +
      `opened (EXPECTED_EPOCHS); ${unopened.length} commitment(s) never opened (expected ${EXPECTED_BETLESS_RECORDS}, the ` +
      `bet-less phase-boundary epochs and the final active seed), ${unopenedWithBets} of them carrying bets` +
      (bad.length ? `; ${bad.join('; ')}` : ''),
  );

  // ── Step 2: forward commitment honoured across rotations ─────────────────────
  // RECOMPUTED from the operator-response fields, never from the rig's own `match` boolean:
  //   (a) inside each promotion record: previousNextHash === newActiveHash;
  //   (b) across the chain: seeds[i].nextServerSeedHash === seeds[i+1].serverSeedHashed.
  // Record 0 is the rotation performed at capture start: its promotion anchors the chain before epoch 0.
  const promotions = seeds.filter(s => s.nextSeedPromotion);
  const promoOk = promotions.filter(
    s => s.nextSeedPromotion!.previousNextHash === s.nextSeedPromotion!.newActiveHash
      && s.nextSeedPromotion!.newActiveHash === s.seed.serverSeedHashed,
  ).length;
  let chainOk = 0, chainChecked = 0;
  for (let i = 0; i < seeds.length - 1; i++) {
    chainChecked++;
    if (seeds[i].seed.nextServerSeedHash === seeds[i + 1].seed.serverSeedHashed) chainOk++;
  }
  const s2 = step(2, 'Forward Commitment (next server seed hash honoured)',
    promotions.length === seeds.length && promoOk === promotions.length && chainChecked === seeds.length - 1 && chainOk === chainChecked
      ? 'PASS' : 'FAIL',
    `${promoOk}/${promotions.length} promotions recomputed from operator fields (previousNextHash === newActiveHash === the ` +
      `record's serverSeedHashed) over ${seeds.length} seed records; chain adjacency ${chainOk}/${chainChecked} ` +
      `(nextServerSeedHash === next record's serverSeedHashed); pre-capture anchor: record 0 is the capture-start rotation ` +
      `whose promoted hash ${seeds[0]?.seed.serverSeedHashed.slice(0, 12)}… is the commitment epoch 0 settles against`,
  );

  // ── Step 3: epoch binding — one hash and one client seed per rotation window ─────────────────────
  // Grouping bets BY their hash and asserting one hash per group is a tautology. Instead each bet is
  // placed in the rotation WINDOW of the seed record active when it was placed ([record.at, next.at)),
  // and must carry that record's commitment and client seed; every betting epoch must hold exactly
  // EPOCH_SIZE bets and be revealed.
  const windows = seeds.map((s, i) => ({ s, from: Date.parse(s.at), to: i + 1 < seeds.length ? Date.parse(seeds[i + 1].at) : Infinity }));
  let bound = 0, wrongHash = 0, wrongClient = 0, noWindow = 0;
  const w3: string[] = [];
  for (const b of bets) {
    const t = Date.parse(b.at);
    const w = windows.find(x => t >= x.from && t < x.to);
    if (!w) { noWindow++; continue; }
    if (w.s.seed.serverSeedHashed !== b.response.server_seed_hashed) { wrongHash++; if (w3.length < 2) w3.push(`bet ${b.response.id} hash ≠ window's`); continue; }
    if (w.s.seed.clientSeed !== b.response.client_seed) { wrongClient++; if (w3.length < 2) w3.push(`bet ${b.response.id} client seed ≠ window's`); continue; }
    bound++;
  }
  const sizes = [...byHash.values()].map(g => g.length);
  const offSize = sizes.filter(n => n !== EPOCH_SIZE).length;
  const epochsCovered = bettingEpochs.filter(h => seedMap.has(h)).length;
  const s3 = step(3, 'Seed Coverage & Epoch Binding (every epoch revealed, one commitment and one client seed per rotation window)',
    bound === EXPECTED_BETS && offSize === 0 && bettingEpochs.length === EXPECTED_EPOCHS && epochsCovered === EXPECTED_EPOCHS ? 'PASS' : 'FAIL',
    `${bound}/${EXPECTED_BETS} bets sit in the rotation window of the record whose commitment AND client seed they carry ` +
      `(${wrongHash} wrong hash, ${wrongClient} wrong client seed, ${noWindow} outside every window); ` +
      `${bettingEpochs.length}/${EXPECTED_EPOCHS} betting epochs, ${offSize} not of size ${EPOCH_SIZE}; ` +
      `${epochsCovered}/${EXPECTED_EPOCHS} revealed` + (w3.length ? ` — ${w3.join('; ')}` : ''),
  );

  // ── Step 4: 100% of the audited population verifiable ───────────────────────
  const verifiable = bets.filter(b => seedMap.has(b.response.server_seed_hashed)).length;
  const s4 = step(4, 'Dataset Verifiability (100% of bets)',
    bets.length === EXPECTED_BETS && verifiable === EXPECTED_BETS ? 'PASS' : 'FAIL',
    `${verifiable}/${EXPECTED_BETS} bets (EXPECTED_BETS, src/capture-plan.ts) sit under a revealed server seed; dataset carries ${bets.length}` +
      (verifiable === bets.length ? '' : ' — rotate all seeds before export'),
  );

  return [s1, s2, s3, s4];
}
