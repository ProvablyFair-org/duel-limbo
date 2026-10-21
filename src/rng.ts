/**
 * PROVENANCE (header added on integration, 20 Oct 2026; everything below this comment is the
 * clean-room module byte for byte).
 *
 * This module was REBUILT FROM A WRITTEN SPECIFICATION, not ported from Duel's code:
 *   spec      docs/ALGORITHM.md, a copy of games/limbo/ALGORITHM.md in the ProvablyFair.org audit
 *             framework (pf-audit, branch clean-room-spec-2026-10-20, commit 48f91a4). Written from
 *             Duel's public pages, the standard provably-fair construction and the 7,700 live rounds,
 *             without opening Duel's code (its §8 lists every file read).
 *   rebuild   written by an implementer who read ONLY that spec and a module-interface file, and
 *             never opened Duel's code, its Verify-tab file, or this package's earlier src/rng.ts.
 *   self-test tests/limbo/RngSpecTests.ts (the spec's §5 vectors and properties).
 *
 * Duel's published Verify-tab code (evidence/verify-tab/duel-verify-tab-limbo-2026-09-26.js, E10) is
 * NOT the source of this module. It is run byte for byte as a SECOND CHECK, by Step 5 and the unit
 * tests (src/operator-verifier.ts).
 *
 * The result is computed in exact integer arithmetic, floor(2^32 x 10^6 / (u + 1)); Duel's Verify-tab
 * code computes Math.floor((2^32 / (u + 1)) * 1e6) in doubles. Measured on integration over every u in
 * 0 .. 2^32-1: the two forms differ on 0 of 4,294,967,296 draws.
 *
 * Three-way agreement measured on integration (20 Oct 2026, the 7,700-round capture): this module vs
 * the live rounds, result units / multiplier / commitment 7,700/7,700 (seeds paired by hash, 154
 * epochs); vs Duel's Verify-tab code 7,700/7,700 rolls; the package has no provablyfair.org live-site
 * verifier leg. Step 5 of `npm run verify` re-measures the first two on every run.
 */
// Clean-room Limbo outcome derivation, written from ALGORITHM.md and INTERFACE.md only.
// Node `crypto` is the only dependency.

import { createHash, createHmac } from "crypto";

/** 2^32: the number of distinct 32-bit draws (ALGORITHM.md §2 Step 2). */
export const MAX_U32: number = 4294967296;

/** The result is truncated to 6 decimals (ALGORITHM.md §2 Step 2: R = floor(raw x 10^6) / 10^6). */
export const RESULT_DECIMALS: number = 6;

/** The draw reads the first 4 digest bytes = 8 hex characters (ALGORITHM.md §2 Step 2: digest[0..3]). */
export const DRAW_HEX_CHARS: number = 8;

const MAX_U32_BIG = BigInt(MAX_U32);
const RESULT_SCALE_BIG = BigInt(10) ** BigInt(RESULT_DECIMALS);
const RESULT_SCALE = 10 ** RESULT_DECIMALS;
const SEED_HEX = /^[0-9a-fA-F]{64}$/;

// §1.1: the server seed is 64 hex characters (32 bytes). Buffer.from(..., "hex") silently drops
// invalid characters, so the form is checked first rather than trusting the decoder.
function decodeServerSeed(serverSeed: string): Buffer {
  if (typeof serverSeed !== "string" || !SEED_HEX.test(serverSeed)) {
    throw new Error("serverSeed must be exactly 64 hex characters");
  }
  return Buffer.from(serverSeed, "hex");
}

// §1.1: nonce is a non-negative integer; §2 Step 1: written in plain base 10, no padding, no sign.
function nonceText(nonce: number): string {
  if (!Number.isSafeInteger(nonce) || nonce < 0) {
    throw new Error("nonce must be a non-negative safe integer");
  }
  return nonce.toString(10);
}

// §2 Step 1: digest = HMAC-SHA256(key = 32 decoded seed bytes, message = UTF-8(clientSeed ":" nonce)).
// §2 Step 2: u = digest bytes 0..3 as an unsigned big-endian 32-bit integer. One HMAC per round, no cursor.
function drawFromKey(keyBuffer: Buffer, clientSeed: string, nonce: number): number {
  if (typeof clientSeed !== "string") throw new Error("clientSeed must be a string");
  const message = Buffer.from(`${clientSeed}:${nonceText(nonce)}`, "utf8");
  const digest = createHmac("sha256", keyBuffer).update(message).digest();
  return digest.readUInt32BE(0);
}

/** Raw 32-bit draw u for a round, from the server seed as published (64 hex chars). §2 Steps 1-2. */
export function drawValue(serverSeed: string, clientSeed: string, nonce: number): number {
  return drawFromKey(decodeServerSeed(serverSeed), clientSeed, nonce);
}

/**
 * Result in integer micro-units from the draw u.
 * §2 Step 2: R_micro = floor(2^32 x 10^6 / (u + 1)), computed in exact integer arithmetic.
 * No range reduction and no rejection: every u in 0 .. 2^32-1 maps to a result
 * (u = 2^32-1 gives 1_000_000, u = 0 gives 4_294_967_296_000_000; both below 2^53).
 */
export function resultUnitsFromU(u: number): number {
  if (!Number.isInteger(u) || u < 0 || u >= MAX_U32) {
    throw new Error("u must be an integer in [0, 2^32)");
  }
  const units = (MAX_U32_BIG * RESULT_SCALE_BIG) / (BigInt(u) + BigInt(1)); // BigInt division truncates = floor for positives
  return Number(units);
}

/** §2 Steps 1-2 from already-decoded key bytes. */
export function computeResultUnitsFromBuffer(keyBuffer: Buffer, clientSeed: string, nonce: number): number {
  return resultUnitsFromU(drawFromKey(keyBuffer, clientSeed, nonce));
}

/** Result multiplier R = R_micro / 10^6 (§2 Step 2), from decoded key bytes. */
export function computeMultiplierFromBuffer(keyBuffer: Buffer, clientSeed: string, nonce: number): number {
  return computeResultUnitsFromBuffer(keyBuffer, clientSeed, nonce) / RESULT_SCALE;
}

/** Result multiplier R from the published server seed (§2). */
export function computeMultiplier(serverSeed: string, clientSeed: string, nonce: number): number {
  return computeMultiplierFromBuffer(decodeServerSeed(serverSeed), clientSeed, nonce);
}

/**
 * §1.2: commitment = lowercase hex of SHA-256 over the 32 hex-decoded seed bytes (not the ASCII text).
 * Returns false (rather than throwing) on a malformed seed. The published hash is compared
 * case-insensitively, since hex case carries no information.
 */
export function verifyHash(serverSeed: string, serverSeedHashed: string): boolean {
  if (typeof serverSeedHashed !== "string" || !/^[0-9a-fA-F]{64}$/.test(serverSeedHashed)) return false;
  let key: Buffer;
  try {
    key = decodeServerSeed(serverSeed);
  } catch {
    return false;
  }
  const commitment = createHash("sha256").update(key).digest("hex");
  return commitment === serverSeedHashed.toLowerCase();
}

/**
 * P(R >= target) with no edge. Under §2 the continuous result law is P(raw >= t) = 1/t;
 * INTERFACE.md fixes this as 1/target. (The exact discrete count of §3.2 sits a hair below it.)
 */
export function fairWinChance(target: number): number {
  if (!(target >= 1)) throw new Error("target must be >= 1");
  return 1 / target;
}

/**
 * §3.1 puts the edge in the win threshold: win iff R >= target/(1-e), so the nominal
 * win chance is 1/(target/(1-e)) = (1-e)/target (also the served nominal figure, §3.4).
 */
export function effectiveWinChance(target: number, edge: number): number {
  if (!(target >= 1)) throw new Error("target must be >= 1");
  if (!(edge >= 0 && edge < 1)) throw new Error("edge must be in [0, 1)");
  return (1 - edge) / target;
}

/** §3.4: a win pays amount x target, so RTP = target x (1-e)/target = 1 - e. */
export function theoreticalRTP(edge: number): number {
  if (!(edge >= 0 && edge < 1)) throw new Error("edge must be in [0, 1)");
  return 1 - edge;
}

/** Inverts §3.1 threshold = target/(1-e): e = 1 - target/threshold. */
export function edgeFromThreshold(target: number, threshold: number): number {
  if (!(target > 0) || !(threshold > 0)) throw new Error("target and threshold must be positive");
  return 1 - target / threshold;
}
