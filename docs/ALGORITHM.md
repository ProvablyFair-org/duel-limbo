# Duel.com Limbo: clean-room algorithm specification

> Package copy of the ProvablyFair.org audit framework's `games/limbo/ALGORITHM.md`.
> It differs from that file only where the file named locations or tracking items
> in the spec author's workspace: those now read as paths inside this package or as
> neutral wording. No rule, number, vector or source note was changed.

Written 20 Oct 2026 for the ProvablyFair.org audit of Duel.com Limbo.

This document is the only input an implementer needs to rebuild Duel Limbo's
outcome derivation and settlement. It was written without opening any Duel
source code, any port of it, or any copy of Duel's in-site verifier code (§8
lists every file and URL read). Every step names where it came from:

- **PAGE**: Duel's public pages, quoted with URL and date.
- **STANDARD**: the standard provably-fair construction used across the
  industry (commit to SHA-256 of a server seed; HMAC-SHA256 keyed by the server
  seed over the client seed and nonce; bytes to an integer; the "crash/limbo"
  inverse-uniform multiplier).
- **DATA**: fixed by testing the standard candidates against the 7,700 live
  rounds in `data/limbo-master.json` (captured
  31 Aug 2026; phases A 5,000, B 2,000, C 200, D 500). The data chose; Duel's
  code did not.
- **CONFIG**: Duel's public limbo config, `GET /api/v2/limbo/config`, captured
  5 Oct 2026 as `evidence/E12-limbo-config-2026-10-05.json`.

Duel's public pages say what goes in, not how it is combined. There are no
limbo evidence images (no `*.png` under `evidence/`), and the
public limbo game page carries no rules text (§1.3), so most of §2 and §3 was
settled by DATA.

---

## 1. Inputs and commitment

### 1.1 Inputs

| Input | Form | Source |
|---|---|---|
| `serverSeed` | 64 lowercase hex characters (32 bytes); secret until the pair is rotated | PAGE: "Server seed - a random string provided by us". Form: DATA (all 157 revealed seeds are 64 hex chars) |
| `clientSeed` | text string chosen or accepted by the player | PAGE: "Client seed - a random string provided by you". DATA: 16-char `A–Z a–z 0–9` seeds in phases A–C, player-set seeds such as `pfauditmthn4ofx` in phase D |
| `nonce` | non-negative integer; 0 on the first round after a rotation, +1 per round | PAGE: "Nonce - a number that increases with each bet". DATA: each of the 154 epochs holds nonces exactly 0…49 in capture order |
| `target` | decimal with exactly 2 decimals, ≥ 1.01 observed (e.g. `"3.60"`) | DATA (request and response `target` equal on 7,700/7,700; response always 2 dp). CONFIG: `"max_target":"100000.00"` |
| `amount` | stake, decimal | DATA (`amount_currency` equals the request `amount` on 7,700/7,700) |
| `e` | house edge applied to the round, as a fraction (0.001 = 0.1 %) | DATA (`effective_edge` = `house_edge_percentage` = 0.1 on 7,700/7,700) + CONFIG (`min_edge` "0.001"); see §3.3 |

### 1.2 Commitment

PAGE (https://duel.com/provably-fair, Overview tab, rendered 20 Oct 2026 with
GET, fresh browser profile, no login):

> "We then send you the hex-encoded SHA-256 hash of our server seed before you
> place your bets, to prove we won't change our minds."
>
> "After the game, we reveal the unhashed Server Seed. You can verify that: The
> server seed matches the original hash. The combined seeds generated the exact
> result you played. No one — including us — could have interfered."

The page does not say which bytes are hashed. Spec:

```
commitment = lowercase_hex( SHA-256( hex_decode(serverSeed) ) )
```

i.e. hash the **32 raw bytes** the 64 hex characters encode, not the 64 ASCII
characters.

- SOURCE: STANDARD (SHA-256 commitment) + PAGE (hex-encoded output) + DATA (input encoding).
- Candidates: SHA-256 over the ASCII hex string → **0/154** bet commitments
  resolve; SHA-256 over the hex-decoded 32 bytes → **154/154**, covering
  **7,700/7,700** rounds.
- Pair seeds to rounds **by hashing**, never by record position: a rotation
  record can carry the revealed *old* seed beside the *new* active hash
  (e.g. the last record: revealed `e4577c82…996f` next to active hash
  `e0651faa…2d1a`; the revealed seed belongs to the epoch with hash
  `c3cddecc…52c0`).
- Forward commitment: each rotation record's `nextServerSeedHash` equals the
  following record's `serverSeedHashed` on **157/157** transitions (DATA).

### 1.3 What the public pages do and do not say

The Overview tab gives the inputs and one line on combining them:

> "Then we combine all of these values to generate a random result for each
> round: Fair result = Server seed + Client seed + Nonce"

https://duel.com/limbo (rendered 20 Oct 2026, logged out) shows only the bet
panel labels ("Multiplier", "Win Chance", "Profit on Win", "Bet Amount") and a
"Zero Edge" badge. It states no RTP, no edge figure, no formula and no limits.
Neither page names HMAC, a key form, a separator, a byte mapping or a win rule.

---

## 2. Outcome derivation

### Step 1: HMAC

```
key     = hex_decode(serverSeed)                        # 32 bytes
message = UTF-8( clientSeed + ":" + decimal(nonce) )    # e.g. "6MAdd35Ffi5AfC7A:0"
digest  = HMAC-SHA256(key, message)                     # 32 bytes
```

`decimal(nonce)`: plain base 10, no padding, no sign (`0`, `5`, `47`).

- SOURCE: STANDARD + DATA (key form and message format).
- Candidates (each crossed with every mapping in Step 2): key = ASCII hex string
  or hex-decoded bytes; message = `c:n`, `c:n:0`, `c-n`, `cn`, `n:c`.
  Only key = **hex-decoded bytes** with message = **`c:n`** reproduces the data
  (Step 2 table). No cursor / round counter: one HMAC per round, first 4 bytes
  only, on every captured round.

### Step 2: bytes to result

```
u   = digest[0..3] read as an unsigned 32-bit BIG-ENDIAN integer   # 0 … 2^32−1
raw = 2^32 / (u + 1)                                               # exact rational, ≥ 1
R   = floor(raw × 10^6) / 10^6                                     # truncate to 6 decimals
```

`R` is the round's result multiplier. Compute it in exact (integer or rational)
arithmetic: `R_micro = floor(2^32 × 10^6 / (u + 1))`, `R = R_micro / 10^6`.

- There is no range reduction and no rejection: every one of the 2^32 values of
  `u` is used. The minimum is `R = 1.000000` exactly (u = 2^32−1); the maximum
  is `R = 4294967296.000000` (u = 0). No edge enters the result itself (§3.1).
- The result is served with trailing zeros removed (`"1.01"` not `"1.010000"`;
  6, 5, 4, 3 and 2 decimals all occur). Compare numerically.
- SOURCE: STANDARD (inverse-uniform multiplier) + DATA (byte order, the `+1`,
  6-dp truncation).
- Candidates tried (key = hex bytes, message = `c:n` unless stated):

  | Mapping | Match |
  |---|---|
  | 2^32 / (u32BE + 1), truncated to 6 dp | **7,700 / 7,700** |
  | 2^32 / (u32BE + 1), rounded half-up to 6 dp | 3,859 / 7,700 |
  | 2^32 / (u32BE + 1), rounded up to 6 dp | 0 / 7,700 |
  | 2^52 / (first 13 hex chars + 1), truncated 6 dp | 7,527 / 7,700 (agrees often because the leading bits are shared; not a match) |
  | 1 / (u32BE / 2^32), truncated 6 dp | 7,445 / 7,700 |
  | 2^32 / (2^32 − u32BE), truncated 6 dp | 0 / 7,700 |
  | 2^32 / (u32LE + 1), truncated 6 dp | 0 / 7,700 |
  | (1 − 0.001) × 2^32 / (u32BE + 1), truncated 6 dp | 0 / 7,700 |
  | 2^52 / (2^52 − 13-hex), truncated 6 dp | 0 / 7,700 |
  | any mapping with key = ASCII hex, or message `c:n:0`, `c-n`, `cn`, `n:c` | 0 / 7,700 |

  `explore.py` counts only exact matches and prints every combination with
  ≥ 1 match; only the three rows with non-zero counts appeared, so every other
  combination tried matched 0.

---

## 3. Win condition and payout

### 3.1 Win condition (edge in the threshold)

```
threshold = target / (1 − e)                  # exact rational; e = 0.001 on every captured round
win  ⇔  R ≥ threshold                         # equivalently R × (1 − e) ≥ target
```

- SOURCE: DATA. The served `is_win` matches `R ≥ target/(1−e)` on
  **7,700 / 7,700**. The edge-free rules `R ≥ target` and `R > target` match
  only **7,696 / 7,700**: the 4 rounds with `target ≤ R < target/(1−e)` are all
  recorded as losses (ids 4085747, 4100195, 4106072, 4116046; e.g. 4106072:
  target 1.01, R 1.010017, threshold 1.011011…, loss). So the edge lives in the
  backend win threshold, not in the result (§2) and not in the paid multiplier
  (§3.4).
- **≥ vs >** is not settled (O1). A tie needs `R` (on the 6-dp grid) to equal
  `target/(1−e)` exactly, which for e = 0.001 happens only when `target × 100`
  is a multiple of 999 (9.99, 19.98, …, 99.90, …), threshold then 10.000000,
  20.000000, …. Five captured rounds used such targets (9.99 ×2, 49.95, 99.90,
  149.85); none landed on the tie. Both `≥` and `>` match 7,700 / 7,700.
- Equivalent forms that also match 7,700/7,700 and that an implementer may use:
  `R ≥ ceil6(target/(1−e))`, `R ≥ floor6(target/(1−e))` (these differ from the
  exact rule only at a tie), `raw ≥ target/(1−e)`. Forms rounding the threshold
  to 2 dp do **not** match (`R ≥ ceil2(...)` 7,675; `R ≥ floor2(...)` 7,697).

### 3.2 Exact win probability (derived, for checks; not an operator figure)

For a non-tie target, with `c = ceil6(target/(1−e))` written as `c_micro / 10^6`:

```
winning u count = floor(2^32 × 10^6 / c_micro)
P(win)          = winning u count / 2^32
```

because `R ≥ c ⇔ 2^32·10^6/(u+1) ≥ c_micro ⇔ u + 1 ≤ 2^32·10^6/c_micro`.
This is slightly below the nominal `(1 − e)/target` (target 3.60:
1,191,853,293 / 2^32 = 0.2774999694 vs 0.2775). SOURCE: derived from §2 + §3.1.

### 3.3 House edge `e`

- Every captured round: `effective_edge` = `house_edge_percentage` = 0.1, i.e.
  e = 0.001, including the 200 phase C rounds at 10 per bet (DATA, 7,700/7,700).
- CONFIG (5 Oct 2026):
  `"scaling_edge":{"enabled":true,"bankroll":"25000000","max_edge":"0.01","min_edge":"0.001","max_loss_fraction":"0.12"}`.
  The config gives a floor (0.1 %) and a ceiling (1 %) but **not the schedule**
  between them, nor what quantity (stake, potential payout, exposure vs
  bankroll × max_loss_fraction) drives it. This spec does not invent one: an
  implementation takes `e` as the bet's applied edge and checks it equals
  `min_edge` for rounds where scaling did not engage (O2).
- The UI badge says "Zero Edge" (PAGE, duel.com/limbo); the served edge was
  0.1 % on every captured round.

### 3.4 Multiplier, win chance, payout

```
multiplier  = target                                       (exactly)
win_chance  = round_half_up_18( (1 − e) / target )          # served field, nominal
win : amount_won = amount × target                          (exact; no rounding observed)
loss: amount_won = 0
```

- `multiplier == target` on **7,700 / 7,700** (served to 18 dp, e.g.
  `"3.600000000000000000"`).
- `win_chance` = `(1 − e)/target` at 18 dp: half-up **7,700**, half-even
  **7,700**, truncation 2,819, round-up 5,079 (DATA). It is the nominal figure,
  not the exact §3.2 probability. It is an operator claim; a derivation must not
  read it.
- Payout = `amount × target` exactly on **2,965 / 2,965** wins; losses pay 0 on
  **4,735 / 4,735**. With 2-dp targets and the captured stakes (0.0125, 10) the
  product never needs rounding, so the payout rounding rule is not exercised
  (O3). `amount_won` is served with trailing zeros removed (`"9.61275"`).
- UI "Profit on Win" = amount × multiplier − amount (label on duel.com/limbo;
  the arithmetic is STANDARD, not witnessed in a screenshot).
- SOURCE: DATA for all three; STANDARD for stake × multiplier.

### 3.5 Fields an implementation must not read

`result`, `is_win`, `win_chance`, `multiplier`, `effective_edge`,
`house_edge_percentage` and `amount_won` are the operator's claims, to be
checked. The derivation reads only `serverSeed`, `clientSeed`, `nonce`,
`target`, `amount` and `e` (the CONFIG floor, until O2 is settled).

---

## 4. Source per step (summary)

| Step | Source | Evidence |
|---|---|---|
| Inputs: server seed, client seed, nonce | PAGE | duel.com/provably-fair Overview, 20 Oct 2026 |
| Commitment = SHA-256, hex output | PAGE + STANDARD | "hex-encoded SHA-256 hash of our server seed" |
| Hash input = hex-decoded 32 bytes | DATA | 154/154 hashes, 7,700/7,700 rounds (ASCII form 0/154) |
| Forward chain next-hash → active hash | DATA | 157/157 transitions |
| HMAC-SHA256, key = hex-decoded seed, msg `clientSeed:nonce` | STANDARD + DATA | 7,700/7,700; every other key/message combination 0 |
| u = first 4 bytes, big-endian | DATA | 7,700/7,700 (little-endian 0) |
| R = 2^32/(u+1) truncated to 6 dp | STANDARD + DATA | 7,700/7,700 (half-up 3,859; ceil 0) |
| No rejection / no range reduction | DATA + derived | all 2^32 values map to a result; nothing to reject |
| Win ⇔ R ≥ target/(1−e) | DATA | 7,700/7,700; edge-free rules 7,696 (4 separating rounds) |
| ≥ vs > at the tie | open | 0 ties captured (O1) |
| e = 0.001 applied | DATA + CONFIG | 7,700/7,700 at 0.1; schedule above floor unpublished (O2) |
| multiplier = target | DATA | 7,700/7,700 |
| win_chance = (1−e)/target, 18 dp nearest | DATA | 7,700/7,700 (down 2,819; ceil 5,079) |
| Payout = amount × target; loss 0 | STANDARD + DATA | 2,965/2,965 wins; 4,735/4,735 losses |

---

## 5. Test vectors (from the dataset)

Copied from `limbo-master.json`, server seed taken from the revealed seed whose
SHA-256(hex-decoded) equals the round's `server_seed_hashed`. e = 0.001 for all.
"served" values are the operator's recorded fields; every derived value equals
them.

**V1: round 4077531** (phase A, first captured round, loss)
```
serverSeed  7a3b7d8e935810ccff93a711a217fb041231e15cc4d9d84ad83dde6982c23205
commitment  6da4c8020d776be303c9e727017b8023e5a6c27a58b43174a2556eaf27197eed
clientSeed  6MAdd35Ffi5AfC7A   nonce 0   target 3.60   amount 0.0125
HMAC        733e14adddb0354eabacee86189fd573b94a24205d03aac02f5a500efea11030
u 1933448365 → raw 2.2214026355… → R 2.221402
threshold 3.603603603… (ceil6 3.603604) → loss
win_chance 0.277500000000000000   multiplier 3.600000000000000000   amount_won 0
exact winning u count 1191853293 (P 0.2774999694)
```

**V2: round 4106072** (phase B, R ≥ target but below the edge threshold: loss)
```
serverSeed  64efb41cb4c27dd415e7342bbe210cb09f79a7acbb073726aa6a650064ad6199
commitment  e8843c885f8cf65636f3fcb13bcb5e8462d8ddec458782932e239d86b1e26ae4
clientSeed  paYStrspwMufQlJW   nonce 5   target 1.01   amount 0.0125
HMAC        fd76043e7e2898a12186c5a354dd3eccc8f582ce71a9e35630bb9a38d36418ed
u 4252369982 → raw 1.0100173110… → R 1.010017
threshold 1.011011011… (ceil6 1.011012) → loss (1.010017 ≥ 1.01 but < 1.011011)
win_chance 0.989108910891089109   multiplier 1.010000000000000000   amount_won 0
exact winning u count 4248186268 (P 0.9891079431)
```

**V3: round 4084905** (phase A, highest won target)
```
serverSeed  ec2d7f44c2f1828885be647a35192cdbcff8d8cb1f83531675e08bb83bbba0ea
commitment  5651e2a499e983971c761758b6c68335f284053b7a746af0008c85a64e8ba165
clientSeed  T4kZsQsziQWrrS69   nonce 47   target 769.02   amount 0.0125
HMAC        00510a20ea0aef12e61dfc7bf327bc9c925515d886a189fdfc015e48850a5ca6
u 5311008 → raw 808.6913985… → R 808.691398
threshold 769.789789789… (ceil6 769.789790) → win
win_chance 0.001299055941327924   multiplier 769.020000000000000000   amount_won 9.61275
exact winning u count 5579402 (P 0.0012990558)
```

**V4: round 4113793** (phase C, stake 10, win)
```
serverSeed  b44b9829f864ee16e20838027bd033b5455af11c34c98e8fe0572918a12a04d9
commitment  3e8077a2c4e6f4186c23924bbbf02d028ea43cc53cd8b71e5d1d9d5ce2c7988e
clientSeed  S06wBI051NtT24Q9   nonce 0   target 1.01   amount 10
HMAC        32f2b1d304145aeb81b9f23ab1518fb523725cf7857dae3ae5541cc35f3e6687
u 854766035 → raw 5.0247285398… → R 5.024728
threshold 1.011011011… → win
win_chance 0.989108910891089109   multiplier 1.010000000000000000   amount_won 10.1
```

**V5: round 4115242** (phase D, player-set client seed, win)
```
serverSeed  d59d42586875f59d8a6106e115fe1fdf20bdae11d821649f6a9ca100901173a7
commitment  4f28c9a6a0935f332790cd78d77d5de75bbb185d1f29ecb9c588746be56bb1ba
clientSeed  pfauditmthn4ofx   nonce 0   target 1.17   amount 0.0125
HMAC        d507e32c783dab6cd465128975ac4ae304a41e7f141f8ae46d176feddee335d9
u 3574063916 → raw 1.2017041093… → R 1.201704
threshold 1.171171171… (ceil6 1.171172) → win
win_chance 0.853846153846153846   multiplier 1.170000000000000000   amount_won 0.014625
exact winning u count 3667238711 (P 0.8538455495)
```

---

## 6. Open points the public sources do not settle

- **O1: tie at the threshold (≥ or >).** Only reachable when
  `target/(1−e)` lies on the 6-dp grid (for e = 0.001: target × 100 a multiple
  of 999). 5 rounds used such targets, 0 landed on the tie. To settle: find a
  nonce on a revealed seed whose R equals e.g. 10.000000 for target 9.99, then
  check it on Duel's Verify page or with a live round.
- **O2: scaling-edge schedule.** CONFIG publishes `min_edge` 0.001,
  `max_edge` 0.01, `bankroll` 25,000,000 and `max_loss_fraction` 0.12, but not
  how the edge moves between them or what drives it. Every captured round
  (stakes 0.0125 and 10, targets ≤ 998.37) was at 0.1 %. Whether the threshold
  in §3.1 uses the scaled edge when scaling engages is unwitnessed. The config
  was captured 5 Oct, the rounds 31 Aug; the 31 Aug config was not captured.
  A fresh fetch on 20 Oct 2026 returned a Cloudflare challenge (HTTP 403).
- **O3: payout rounding.** Every captured product `amount × target` is exact
  at the served precision, so the rounding rule for stakes with more decimals
  is not witnessed.
- **O4: result cap and target limits.** `max_target` is 100000.00 (CONFIG);
  the result can reach 4,294,967,296 by §2. Whether results are capped, the
  minimum legal target (1.01 is the lowest captured, not necessarily the
  floor), and any max-payout / exposure clip are not stated publicly and not
  exercised (highest captured R 6027.575908, highest target 998.37).
- **O5: the 1.000000 floor.** R = 1.000000 occurs only at u = 2^32−1
  (probability 2^−32); not witnessed. It loses at every legal target ≥ 1.01.
- **O6: client-seed encoding beyond ASCII.** UTF-8 is the assumption; every
  captured client seed is ASCII.
- **O7: "Zero Edge" badge vs served 0.1 %.** The game page shows a "Zero Edge"
  badge; no page states a limbo RTP or edge figure.
- **O8: no written algorithm.** "Fair result = Server seed + Client seed +
  Nonce" does not name HMAC, the key form, the separator, the mapping or the
  win rule. Everything in §2–§3 beyond the inputs rests on STANDARD + DATA.
  Unlike Dice, no Duel Verify-page result for limbo was available as an
  independent check (no limbo screenshots exist, and the Verify tab was not
  opened).

---

## 7. Reproduction of this spec

Implemented independently of any audit package in throwaway scripts outside
the repo (`explore.py`, `winrule.py`, `payout.py`, `spec_check.py`,
`vectors.py`, in the session scratchpad `limbo-spec/`), run on every round.
`spec_check.py` output:

```
commitment SHA256(hexdecode(serverSeed)) resolves: 154/154 hashes, 7700/7700 bets; ASCII form resolves 0/154
forward chain next-hash == following active hash: 157/157
result = 2^32/(u32BE(HMAC[0..3])+1) to 6 dp, by rounding mode: {'floor': 7700, 'half_up': 3859, 'ceil': 0}
win rule (e = effective_edge/100): {'R >= T/(1-e)': 7700, 'R > T/(1-e)': 7700, 'R >= T (no edge)': 7696, 'R > T (no edge)': 7696}
rounds with T <= R < T/(1-e) (separate edge-in-threshold from no-edge): 4 [4085747, 4100195, 4106072, 4116046]
rounds with R exactly = T/(1-e): 0
rounds whose target makes T/(1-e) land on the 6-dp grid (T*100 multiple of 999): 5 Counter({'9.99': 2, '99.90': 1, '49.95': 1, '149.85': 1})
win_chance = (1-e)/T at 18 dp, by mode: {'half_up': 7700, 'half_even': 7700, 'down': 2819, 'ceil': 5079}
multiplier == target: 7700
effective_edge == house_edge_percentage == 0.1: 7700
loss: amount_won == 0: 4735
win: amount_won == amount x target (exact): 2965
wins=2965 losses=4735
epochs 154 nonces exactly 0..n-1 in capture order: 154 sizes {50: 154}
min u32 712552 max u32 4294861939
```

`explore.py` (key × message × mapping search; every combination with ≥ 1 match):

```
7700 / 7700 ('bytes', 'c:n', '2^32/(u+1) trunc6')
7527 / 7700 ('bytes', 'c:n', '2^52/(v52+1) trunc6')
7445 / 7700 ('bytes', 'c:n', '1/f trunc6 (f=u/2^32)')
```

`winrule.py` (threshold forms): `R >= T/(1-e) exact` 7700, `R > T/(1-e) exact`
7700, `raw >= T/(1-e)` 7700, `R*(1-e) >= T` 7700, `floor2(R*(1-e)) >= T` 7700,
`R >= floor6(T/(1-e))` 7700, `R >= ceil6(T/(1-e))` 7700, `R >= ceil2(T/(1-e))`
7675, `R >= floor2(T/(1-e))` 7697, `R >= T` 7696, `R > T` 7696.

---

## 8. Files and URLs read while writing this spec

Read: `evidence/E12-limbo-config-2026-10-05.json`
and its `.meta.json`; `data/limbo-master.json`;
the audit framework's `games/limbo/profile.json`;
the audit framework's `games/dice/ALGORITHM.md` (shape model, not Duel
code). Directory listings of this package's root, its `evidence/`
(filtered to exclude verify-tab names) and `data/`. URLs (GET, no login, fresh
headless profile, 20 Oct 2026): `https://duel.com/provably-fair` (visible prose
only; `<script>`, `<pre>`, `<code>` stripped before reading),
`https://duel.com/limbo` (same), `https://duel.com/api/v2/limbo/config`
(Cloudflare challenge, 403, no data).

Note on the profile: `profile.json` (an allowed source) contains two summary
phrases describing the existing package, "duel draws uint32 directly (no
reduction)" (LIMBO-08 reference) and "duel Step 10 (R ≥ T/(1−e))" (LIMBO-10
reference). They were read before the data tests. They did not choose anything
here: every step was settled by the match counts above, and the tie direction
the second phrase implies (≥) is left open (O1) because the data cannot settle it.

Not opened: any `verify-tab` or `verifier-parity` path, any `src/`, `tests/`,
`scripts/`, `capture/`, `verify.js`, `test.js`, `MANIFEST.md`, `README.md`,
`limboConfig.json` or `evidence/*.md` of the limbo package, any saved Duel JS
bundle, the browser tool's snapshot folder, or Duel's Verify tab.
