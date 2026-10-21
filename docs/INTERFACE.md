# Module interface the audit package expects (written by the auditor, not from the casino)

Write `rng.ts` (TypeScript, strict, Node `crypto` only, no dependencies) exporting exactly these names.
Semantics come from ALGORITHM.md; this file only fixes names, types and the package's own conventions.

```ts
export const MAX_U32: number;          // 2^32
export const RESULT_DECIMALS: number;  // decimals the result is cut to (per the spec)
export const DRAW_HEX_CHARS: number;   // hex characters of the digest the draw reads
// The raw 32-bit draw u for a round (server seed as published).
export function drawValue(serverSeed: string, clientSeed: string, nonce: number): number;
// The result as an INTEGER count of 10^-RESULT_DECIMALS units, from the raw draw u, per the spec's formula and cutting rule.
export function resultUnitsFromU(u: number): number;
// Same from the decoded key bytes.
export function computeResultUnitsFromBuffer(keyBuffer: Buffer, clientSeed: string, nonce: number): number;
// The result multiplier (= units / 10^RESULT_DECIMALS) from decoded key bytes / from the published server seed.
export function computeMultiplierFromBuffer(keyBuffer: Buffer, clientSeed: string, nonce: number): number;
export function computeMultiplier(serverSeed: string, clientSeed: string, nonce: number): number;
export function verifyHash(serverSeed: string, serverSeedHashed: string): boolean;
// P(result >= target) with no edge: 1/target (exact model of the spec's result law).
export function fairWinChance(target: number): number;
// Win chance with the edge applied where the spec puts it (the win line): (1 - edge)/target.
export function effectiveWinChance(target: number, edge: number): number;
// Per-bet RTP at that edge: 1 - edge.
export function theoreticalRTP(edge: number): number;
// The edge implied by a known win threshold for a target: 1 - target/threshold.
export function edgeFromThreshold(target: number, threshold: number): number;
```
Settlement and payout are NOT part of this module; implement only the above.
