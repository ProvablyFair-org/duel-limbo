import * as fs     from 'fs';
import * as path   from 'path';
import * as crypto from 'crypto';
import type { LimboDataset, LimboBet, SeedEntry } from './types';

/**
 * Dataset path + integrity hash.
 *
 * The master dataset was captured live on 2026-08-31 (7,700 bets, 158 seed
 * entries, every epoch revealed) and is frozen here: EXPECTED_HASH pins its
 * SHA-256, and `checkDatasetHash()` aborts the suite on any single-byte change.
 */
const DATASET_PATH  = path.join(__dirname, '../data/limbo-master.json');
const EXPECTED_HASH: string = 'b2db8685eeafde731152bd9770bf4df9872bda626b65b3412e29b067871365cc'; // pinned 2026-08-31 — frozen capture of 7,700 bets / 158 seeds

export function getDatasetPath(): string { return DATASET_PATH; }

export function datasetExists(): boolean { return fs.existsSync(DATASET_PATH); }

export function loadDataset(): LimboDataset {
  const raw = fs.readFileSync(DATASET_PATH, 'utf-8');
  return JSON.parse(raw) as LimboDataset;
}

export function loadDatasetBuffer(): Buffer {
  return fs.readFileSync(DATASET_PATH);
}

export function checkDatasetHash(): { expected: string; actual: string; match: boolean } {
  if (!fs.existsSync(DATASET_PATH)) {
    return { expected: EXPECTED_HASH, actual: '<no dataset file>', match: false };
  }
  const raw    = fs.readFileSync(DATASET_PATH);
  const actual = crypto.createHash('sha256').update(raw).digest('hex');
  return { expected: EXPECTED_HASH, actual, match: EXPECTED_HASH !== '' && actual === EXPECTED_HASH };
}

/**
 * Build O(1) map: serverSeedHashed → serverSeed (plaintext).
 *
 * The plaintext for seeds[N].serverSeedHashed is revealed as
 * seeds[N+1].seed.serverSeed once the epoch rotates. We verify the hash
 * (SHA-256 over the hex-decoded seed bytes) before trusting the mapping.
 */
export function buildSeedMap(seeds: SeedEntry[]): Map<string, string> {
  const m = new Map<string, string>();
  for (let i = 0; i < seeds.length - 1; i++) {
    const next = seeds[i + 1];
    if (next.seed.serverSeed) {
      const h = crypto.createHash('sha256')
        .update(Buffer.from(next.seed.serverSeed, 'hex'))
        .digest('hex');
      if (h === seeds[i].seed.serverSeedHashed) {
        m.set(seeds[i].seed.serverSeedHashed, next.seed.serverSeed);
      }
    }
  }
  return m;
}

/** Group bets by serverSeedHashed (epoch). */
export function groupByHash(bets: LimboBet[]): Map<string, LimboBet[]> {
  const m = new Map<string, LimboBet[]>();
  for (const b of bets) {
    const hash = b.response.server_seed_hashed;
    const arr = m.get(hash) ?? [];
    arr.push(b);
    m.set(hash, arr);
  }
  return m;
}
