/**
 * Spec self-test — docs/ALGORITHM.md §5 vectors and properties, run against src/rng.ts.
 *
 * Written by the clean-room implementer together with src/rng.ts, from docs/ALGORITHM.md and the module
 * interface alone (never from Duel's code). Integrated 20 Oct 2026: the checks are unchanged; only the
 * import path, the mocha wrapper and the reporting (failures collected instead of printed) were adapted.
 */
// Self-test for rng.ts: every worked vector in ALGORITHM.md §5, plus properties.
// Settlement is not part of rng.ts (INTERFACE.md), so the win rule (§3.1), the exact
// winning-u count (§3.2), win_chance (§3.4) and payout (§3.4) are recomputed here in
// exact BigInt arithmetic only to check the vectors end to end.

import { createHash, createHmac } from "crypto";
import {
  MAX_U32, RESULT_DECIMALS, DRAW_HEX_CHARS,
  drawValue, resultUnitsFromU, computeResultUnitsFromBuffer, computeMultiplierFromBuffer,
  computeMultiplier, verifyHash, fairWinChance, effectiveWinChance, theoreticalRTP, edgeFromThreshold,
} from "../../src/rng";
import * as assert from "assert";

const EXPECTED_CHECKS = 118;

function runSelftest(): { pass: number; total: number; failed: string[] } {

let pass = 0;
let total = 0;
const failed: string[] = [];
function check(name: string, ok: boolean, detail = ""): void {
  total++;
  if (ok) pass++;
  else failed.push(`${name}${detail ? "  " + detail : ""}`);
}
function throws(fn: () => unknown): boolean {
  try { fn(); return false; } catch { return true; }
}

const B = (x: number | string): bigint => BigInt(x);
const TWO32 = B(2) ** B(32);
const MICRO = B(10) ** B(6);

// Decimal string -> [integer, scale]
function dec(s: string): [bigint, number] {
  const [i, f = ""] = s.split(".");
  return [B(i + f), f.length];
}
function fmtStrip(v: bigint, scale: number): string {
  if (scale === 0) return v.toString();
  const s = v.toString().padStart(scale + 1, "0");
  let out = s.slice(0, -scale) + "." + s.slice(-scale);
  out = out.replace(/0+$/, "").replace(/\.$/, "");
  return out;
}
function fmtFixed(v: bigint, scale: number): string {
  const s = v.toString().padStart(scale + 1, "0");
  return s.slice(0, -scale) + "." + s.slice(-scale);
}

interface Vector {
  id: string; serverSeed: string; commitment: string; clientSeed: string; nonce: number;
  target: string; amount: string; hmac: string; u: number; rawPrefix: string; R: string;
  ceil6?: string; win: boolean; winChance: string; multiplier: string; amountWon: string;
  winCount?: number; P?: string;
}

// ALGORITHM.md §5, copied verbatim. e = 0.001 for all.
const vectors: Vector[] = [
  { id: "V1", serverSeed: "7a3b7d8e935810ccff93a711a217fb041231e15cc4d9d84ad83dde6982c23205",
    commitment: "6da4c8020d776be303c9e727017b8023e5a6c27a58b43174a2556eaf27197eed",
    clientSeed: "6MAdd35Ffi5AfC7A", nonce: 0, target: "3.60", amount: "0.0125",
    hmac: "733e14adddb0354eabacee86189fd573b94a24205d03aac02f5a500efea11030",
    u: 1933448365, rawPrefix: "2.2214026355", R: "2.221402", ceil6: "3.603604", win: false,
    winChance: "0.277500000000000000", multiplier: "3.600000000000000000", amountWon: "0",
    winCount: 1191853293, P: "0.2774999694" },
  { id: "V2", serverSeed: "64efb41cb4c27dd415e7342bbe210cb09f79a7acbb073726aa6a650064ad6199",
    commitment: "e8843c885f8cf65636f3fcb13bcb5e8462d8ddec458782932e239d86b1e26ae4",
    clientSeed: "paYStrspwMufQlJW", nonce: 5, target: "1.01", amount: "0.0125",
    hmac: "fd76043e7e2898a12186c5a354dd3eccc8f582ce71a9e35630bb9a38d36418ed",
    u: 4252369982, rawPrefix: "1.0100173110", R: "1.010017", ceil6: "1.011012", win: false,
    winChance: "0.989108910891089109", multiplier: "1.010000000000000000", amountWon: "0",
    winCount: 4248186268, P: "0.9891079431" },
  { id: "V3", serverSeed: "ec2d7f44c2f1828885be647a35192cdbcff8d8cb1f83531675e08bb83bbba0ea",
    commitment: "5651e2a499e983971c761758b6c68335f284053b7a746af0008c85a64e8ba165",
    clientSeed: "T4kZsQsziQWrrS69", nonce: 47, target: "769.02", amount: "0.0125",
    hmac: "00510a20ea0aef12e61dfc7bf327bc9c925515d886a189fdfc015e48850a5ca6",
    u: 5311008, rawPrefix: "808.6913985", R: "808.691398", ceil6: "769.789790", win: true,
    winChance: "0.001299055941327924", multiplier: "769.020000000000000000", amountWon: "9.61275",
    winCount: 5579402, P: "0.0012990558" },
  { id: "V4", serverSeed: "b44b9829f864ee16e20838027bd033b5455af11c34c98e8fe0572918a12a04d9",
    commitment: "3e8077a2c4e6f4186c23924bbbf02d028ea43cc53cd8b71e5d1d9d5ce2c7988e",
    clientSeed: "S06wBI051NtT24Q9", nonce: 0, target: "1.01", amount: "10",
    hmac: "32f2b1d304145aeb81b9f23ab1518fb523725cf7857dae3ae5541cc35f3e6687",
    u: 854766035, rawPrefix: "5.0247285398", R: "5.024728", win: true,
    winChance: "0.989108910891089109", multiplier: "1.010000000000000000", amountWon: "10.1" },
  { id: "V5", serverSeed: "d59d42586875f59d8a6106e115fe1fdf20bdae11d821649f6a9ca100901173a7",
    commitment: "4f28c9a6a0935f332790cd78d77d5de75bbb185d1f29ecb9c588746be56bb1ba",
    clientSeed: "pfauditmthn4ofx", nonce: 0, target: "1.17", amount: "0.0125",
    hmac: "d507e32c783dab6cd465128975ac4ae304a41e7f141f8ae46d176feddee335d9",
    u: 3574063916, rawPrefix: "1.2017041093", R: "1.201704", ceil6: "1.171172", win: true,
    winChance: "0.853846153846153846", multiplier: "1.170000000000000000", amountWon: "0.014625",
    winCount: 3667238711, P: "0.8538455495" },
];

// e = 0.001 as the exact rational 1/1000
const E_NUM = B(1), E_DEN = B(1000);

for (const v of vectors) {
  const key = Buffer.from(v.serverSeed, "hex");
  check(`${v.id} commitment verifyHash`, verifyHash(v.serverSeed, v.commitment));
  check(`${v.id} commitment sha256(hexdecode)`, createHash("sha256").update(key).digest("hex") === v.commitment);
  const hm = createHmac("sha256", key).update(`${v.clientSeed}:${v.nonce}`, "utf8").digest("hex");
  check(`${v.id} HMAC digest`, hm === v.hmac, hm);
  check(`${v.id} u = first ${DRAW_HEX_CHARS} hex BE`, parseInt(v.hmac.slice(0, DRAW_HEX_CHARS), 16) === v.u);
  const u = drawValue(v.serverSeed, v.clientSeed, v.nonce);
  check(`${v.id} drawValue`, u === v.u, String(u));
  const rawScaled = (TWO32 * B(10) ** B(10)) / (B(u) + B(1));
  check(`${v.id} raw prefix`, fmtFixed(rawScaled, 10).startsWith(v.rawPrefix), fmtFixed(rawScaled, 10));
  const units = resultUnitsFromU(u);
  const [rExp] = dec(v.R);
  check(`${v.id} resultUnitsFromU`, B(units) === rExp, String(units));
  check(`${v.id} computeResultUnitsFromBuffer`, computeResultUnitsFromBuffer(key, v.clientSeed, v.nonce) === units);
  check(`${v.id} computeMultiplier`, computeMultiplier(v.serverSeed, v.clientSeed, v.nonce) === Number(v.R),
    String(computeMultiplier(v.serverSeed, v.clientSeed, v.nonce)));
  check(`${v.id} computeMultiplierFromBuffer`, computeMultiplierFromBuffer(key, v.clientSeed, v.nonce) === Number(v.R));

  // §3.1 threshold = T/(1-e); T = Tn/10^ts. ceil6 of it in micro-units.
  const [tN, tS] = dec(v.target);
  const tDen = B(10) ** B(tS);
  const thrNum = tN * E_DEN * MICRO;             // threshold x 10^6 = tN*E_DEN*10^6 / (tDen*(E_DEN-E_NUM))
  const thrDen = tDen * (E_DEN - E_NUM);
  const ceil6 = (thrNum + thrDen - B(1)) / thrDen;
  if (v.ceil6) check(`${v.id} ceil6 threshold`, fmtFixed(ceil6, 6) === v.ceil6, fmtFixed(ceil6, 6));
  // win iff R >= threshold, exact: units * thrDen >= thrNum
  const win = B(units) * thrDen >= thrNum;
  check(`${v.id} win rule R >= T/(1-e) -> ${v.win ? "win" : "loss"}`, win === v.win);
  if (v.id === "V2") {
    check(`${v.id} R >= target but loses (edge in threshold)`, B(units) * tDen >= tN * MICRO && !win);
  }

  // §3.2 exact winning-u count and probability
  if (v.winCount !== undefined && v.P !== undefined) {
    const cnt = (TWO32 * MICRO) / ceil6;
    check(`${v.id} exact winning u count`, cnt === B(v.winCount), cnt.toString());
    check(`${v.id} exact P(win)`, (Number(cnt) / MAX_U32).toFixed(10) === v.P, (Number(cnt) / MAX_U32).toFixed(10));
    // brute definition on the boundary: u = cnt-1 wins, u = cnt loses
    const wins = (x: bigint): boolean => B(resultUnitsFromU(Number(x))) * thrDen >= thrNum;
    check(`${v.id} count boundary (u=cnt-1 wins, u=cnt loses)`, wins(cnt - B(1)) && !wins(cnt));
  }

  // §3.4 win_chance = round_half_up_18((1-e)/T)
  const wcNum = (E_DEN - E_NUM) * tDen * B(10) ** B(18);
  const wcDen = E_DEN * tN;
  const wc18 = (B(2) * wcNum + wcDen) / (B(2) * wcDen);
  check(`${v.id} win_chance 18dp half-up`, fmtFixed(wc18, 18) === v.winChance, fmtFixed(wc18, 18));
  const ewc = effectiveWinChance(Number(v.target), 0.001);
  check(`${v.id} effectiveWinChance ~ served win_chance`, Math.abs(ewc - Number(v.winChance)) < 1e-15, String(ewc));
  // §3.4 multiplier = target at 18 dp
  check(`${v.id} multiplier = target`, fmtFixed(tN * B(10) ** B(18 - tS), 18) === v.multiplier);
  // §3.4 payout = amount x target on a win, 0 on a loss
  const [aN, aS] = dec(v.amount);
  const won = win ? fmtStrip(aN * tN, aS + tS) : "0";
  check(`${v.id} amount_won`, won === v.amountWon, won);
}

// ---- Properties ----
check("const MAX_U32 = 2^32", MAX_U32 === 2 ** 32);
check("const RESULT_DECIMALS = 6", RESULT_DECIMALS === 6);
check("const DRAW_HEX_CHARS = 8", DRAW_HEX_CHARS === 8);
check("range: u=0 -> 4294967296.000000", resultUnitsFromU(0) === 4294967296000000);
check("range: u=2^32-1 -> 1.000000", resultUnitsFromU(MAX_U32 - 1) === 1000000);
check("resultUnitsFromU rejects -1, 2^32, 1.5",
  throws(() => resultUnitsFromU(-1)) && throws(() => resultUnitsFromU(MAX_U32)) && throws(() => resultUnitsFromU(1.5)));
check("resultUnitsFromU = floor(2^32*10^6/(u+1)) at u=2,3,999999,2^31",
  [2, 3, 999999, 2 ** 31].every((u) => B(resultUnitsFromU(u)) === (TWO32 * MICRO) / B(u + 1)));

const seed = vectors[0].serverSeed;
const key0 = Buffer.from(seed, "hex");
const N = 200000;
let inRange = true, agree = true;
let sumU = 0, hit2 = 0, hitEdge = 0;
const thrEdgeUnits = 1011012; // ceil6(1.01/0.999)
for (let n = 0; n < N; n++) {
  const u = drawValue(seed, "selftest-client", n);
  if (!Number.isInteger(u) || u < 0 || u >= MAX_U32) inRange = false;
  const units = resultUnitsFromU(u);
  if (units < 1000000 || units > 4294967296000000) inRange = false;
  if (n < 2000 && computeMultiplierFromBuffer(key0, "selftest-client", n) !== units / 1e6) agree = false;
  sumU += u / MAX_U32;
  if (units >= 2000000) hit2++;
  if (units >= thrEdgeUnits) hitEdge++;
}
check(`range: ${N} draws u in [0,2^32), R in [1, 2^32]`, inRange);
check("computeMultiplierFromBuffer = units/10^6 (2000 nonces)", agree);
const meanU = sumU / N, seMean = Math.sqrt(1 / 12 / N);
check("bias: mean(u/2^32) within 5 SE of 0.5", Math.abs(meanU - 0.5) < 5 * seMean, `mean ${meanU.toFixed(6)} SE ${seMean.toExponential(2)}`);
const p2 = fairWinChance(2), f2 = hit2 / N, se2 = Math.sqrt(p2 * (1 - p2) / N);
check("bias: freq(R>=2) within 5 SE of fairWinChance(2)", Math.abs(f2 - p2) < 5 * se2, `freq ${f2.toFixed(5)} p ${p2}`);
const pe = effectiveWinChance(1.01, 0.001), fe = hitEdge / N, see = Math.sqrt(pe * (1 - pe) / N);
check("bias: freq(R>=1.01/0.999) within 5 SE of effectiveWinChance(1.01,0.001)", Math.abs(fe - pe) < 5 * see, `freq ${fe.toFixed(5)} p ${pe.toFixed(5)}`);
// exact law vs the continuous model: P_exact(R >= t) = floor(2^32*10^6/t_micro)/2^32, within 2^-32 of 1/t when t_micro/10^6 = t exactly
check("bias report consistent: exact P(R>=2) vs fairWinChance(2) within 2^-32",
  Math.abs(Number((TWO32 * MICRO) / B(2000000)) / MAX_U32 - fairWinChance(2)) <= 1 / MAX_U32);
check("bias report consistent: exact P(R>=1000) vs fairWinChance(1000) within 2^-32",
  Math.abs(Number((TWO32 * MICRO) / B(1000000000)) / MAX_U32 - fairWinChance(1000)) <= 1 / MAX_U32);

check("drawValue = computeMultiplier path (V1 nonce 1..5)",
  [1, 2, 3, 4, 5].every((n) => computeMultiplier(seed, vectors[0].clientSeed, n) === resultUnitsFromU(drawValue(seed, vectors[0].clientSeed, n)) / 1e6));
check("drawValue rejects malformed seed / bad nonce",
  throws(() => drawValue("zz" + seed.slice(2), "c", 0)) && throws(() => drawValue(seed.slice(2), "c", 0)) &&
  throws(() => drawValue(seed, "c", -1)) && throws(() => drawValue(seed, "c", 1.5)));

const asciiHash = createHash("sha256").update(seed, "utf8").digest("hex");
check("verifyHash false: hash of ASCII seed text", verifyHash(seed, asciiHash) === false);
const flipped = (vectors[0].commitment[0] === "0" ? "1" : "0") + vectors[0].commitment.slice(1);
check("verifyHash false: one hex char changed", verifyHash(seed, flipped) === false);
check("verifyHash false: other vector's commitment", verifyHash(seed, vectors[1].commitment) === false);
check("verifyHash false: malformed seed", verifyHash("xyz", vectors[0].commitment) === false);
check("verifyHash true: uppercase commitment", verifyHash(seed, vectors[0].commitment.toUpperCase()) === true);

check("fairWinChance(t) = effectiveWinChance(t, 0)", [1.01, 2, 3.6, 769.02].every((t) => fairWinChance(t) === effectiveWinChance(t, 0)));
check("theoreticalRTP(0.001) = 0.999", theoreticalRTP(0.001) === 0.999);
check("theoreticalRTP = target x effectiveWinChance", [1.01, 3.6, 769.02].every((t) => Math.abs(t * effectiveWinChance(t, 0.001) - theoreticalRTP(0.001)) < 1e-12));
check("edgeFromThreshold(3.60, 3.60/0.999) = 0.001", Math.abs(edgeFromThreshold(3.6, 3.6 / 0.999) - 0.001) < 1e-12);
check("edgeFromThreshold(t, t) = 0", edgeFromThreshold(2, 2) === 0);

return { pass, total, failed };
}

describe("Spec self-test — src/rng.ts against docs/ALGORITHM.md (clean-room rebuild)", function () {
  this.timeout(300_000);
  it(`all ${EXPECTED_CHECKS} spec vector and property checks pass`, () => {
    const r = runSelftest();
    assert.deepStrictEqual(r.failed, []);
    assert.strictEqual(r.total, EXPECTED_CHECKS);
    assert.strictEqual(r.pass, EXPECTED_CHECKS);
  });
});
