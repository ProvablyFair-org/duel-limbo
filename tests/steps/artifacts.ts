/**
 * Step 21 — Artifact Integrity.
 *
 * Recompute the SHA-256 of every artifact of record (src/artifact-pins.ts) and of the operator config
 * limboConfig.json (src/scaling-edge.ts CONFIG_SHA256) and compare each with its pin; assert that no
 * pinned JSON artifact carries run metadata (generatedAt / executionTimeMs / hostname), so a
 * regeneration that changes no figure reproduces the pinned bytes. A missing or altered artifact is a
 * HARD FAIL: the figures in these files are published.
 */

import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import type { StepResult } from './context';
import { step, VerifyContext } from './context';
import { ARTIFACT_PINS } from '../../src/artifact-pins';
import { CONFIG_SHA256, getConfigPath } from '../../src/scaling-edge';
import { checkDomains, DOMAIN_ARTIFACTS } from '../../src/domains';

const RUN_METADATA = /^(generatedAt|executionTimeMs|hostname)$/;

function metadataKeys(o: unknown, at = ''): string[] {
  if (!o || typeof o !== 'object') return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const p = at ? `${at}.${k}` : k;
    if (RUN_METADATA.test(k)) out.push(p);
    out.push(...metadataKeys(v, p));
  }
  return out;
}

export function run(ctx: VerifyContext): StepResult[] {
  const outputsDir = ctx.outputsDir;
  const notes: string[] = [];
  let bad = 0;

  const check = (label: string, fp: string, expected: string) => {
    if (!fs.existsSync(fp)) { bad++; notes.push(`${label} ABSENT`); return; }
    const buf = fs.readFileSync(fp);
    const actual = createHash('sha256').update(buf).digest('hex');
    if (actual !== expected) { bad++; notes.push(`${label} sha256 ${actual.slice(0, 16)}… != pin ${expected.slice(0, 16)}…`); return; }
    if (label.endsWith('.json')) {
      let meta: string[] = [];
      try { meta = metadataKeys(JSON.parse(buf.toString('utf8'))); } catch { bad++; notes.push(`${label} unparsable`); return; }
      if (meta.length) { bad++; notes.push(`${label} carries run metadata: ${meta.join(', ')}`); return; }
    }
    notes.push(`${label} matches its pin`);
  };
  for (const [file, expected] of Object.entries(ARTIFACT_PINS)) check(file, path.join(outputsDir, file), expected);
  check('limboConfig.json', getConfigPath(), CONFIG_SHA256);

  // VALUE DOMAINS (src/domains.ts): every numeric leaf of every pinned JSON artifact must lie in a
  // domain whose bounds come from src/, and every numeric leaf path must be covered by a rule.
  let leaves = 0;
  const domainIssues: string[] = [];
  for (const f of DOMAIN_ARTIFACTS) {
    let j: unknown;
    try { j = JSON.parse(fs.readFileSync(path.join(outputsDir, f), 'utf8')); } catch { continue; } // absence already failed above
    const d = checkDomains(f, j);
    leaves += d.leaves;
    domainIssues.push(...d.violations, ...d.uncovered.map(u => `${u} has no declared domain`));
  }
  if (domainIssues.length) { bad++; notes.push(`VALUE DOMAINS: ${domainIssues.slice(0, 4).join('; ')}${domainIssues.length > 4 ? ` (+${domainIssues.length - 4})` : ''}`); }
  else notes.push(`value domains: ${leaves} numeric leaves across ${DOMAIN_ARTIFACTS.length} artifacts, all covered by a rule in src/domains.ts and inside it`);

  return [step(21, 'Artifact Integrity (pinned artifacts of record)',
    bad === 0 ? 'PASS' : 'FAIL',
    `${Object.keys(ARTIFACT_PINS).length} artifact(s) of record + the operator config checked against their pins, JSON artifacts ` +
    `checked free of run metadata: ${notes.join('; ')}`)];
}
