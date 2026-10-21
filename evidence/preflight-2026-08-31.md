# Live pre-flight — 2026-08-31

Purpose: confirm the bet request/response shape against a live Limbo round before
committing to the 7,700-bet capture. Five bets at the table minimum, recorded during a
logged-in browser session. **No seed rotation was performed** — the active epoch was left
untouched so the capture starts from a clean chain.

All values below are copied from the actual API responses.

## Endpoints confirmed

| Call | Shape |
|------|-------|
| `POST /api/v2/user/security/token` | `{ success, token, token_type, expires_in }` — token at TOP level, not under `data` |
| `GET /api/v2/client-seed` | `data: { client_seed, server_seed_hashed, next_server_seed_hash, nonce, initialized }` |
| `GET /api/v2/limbo/config` | `data: { max_target, scaling_edge }` |
| `POST /api/v2/limbo/bet` | `data: { round: {...} }` — 200 |
| `GET /api/v2/user/transactions/{id}` | transaction at TOP level; the round is under `data` |

## Bet payload — ACCEPTED

The corrected payload from `capture/capture-auto.reference.js` was sent verbatim and accepted:

```json
{ "amount": "0.011", "target": "2.00", "currency": 105,
  "security_token": "<redacted>", "instant": true }
```

`bet_type` is correctly absent — Limbo has no over/under side. This is the first time the
corrected body has been sent to a live endpoint; the shape had previously only been read
out of Duel's client bundle.

## Response — live shape

```json
{ "id": 4070664, "result": "11.82324", "is_win": true,
  "amount_currency": "0.011000000000000000", "balance_type": 105,
  "amount_won": "0.022", "target": "2.00",
  "win_chance": "0.499500000000000000", "multiplier": "2.000000000000000000",
  "nonce": 29,
  "server_seed_hashed": "f98c5abdc0fc6f23417812a81b782fd19c534592874455d67f62dc9ce1162ad3",
  "client_seed": "mpz6LzeQC6zDNcg5",
  "effective_edge": 0.1, "house_edge_percentage": 0.1,
  "transaction_id": 1196907185 }
```

### Divergences from what the repo assumed

1. **`amount_currency` is the STAKE at 18 dp, not a currency code.** The synthetic fixtures
   carried `"USD"`. Corrected in `src/types.ts` and in the fixtures.
2. **`effective_edge` is 0.1, equal to `house_edge_percentage`** — on all five bets, at three
   different targets. An earlier note recorded `effective_edge = 0` and built a "net of the
   Zero Edge rakeback" reading on it. That did not reproduce. The rakeback itself is real
   (below); it is the FIELD reading that was wrong. Neither field is now characterised in
   the verifier — the capture settles it.
3. **`transaction_id` was missing from the `BetResponse` type.** Added.
4. **`server_seed` is absent from the bet response** (it lives on the round returned by the
   transaction endpoint, and is `null` until the pair is rotated). Made optional.
5. **`result` strips trailing zeros** — `"11.82324"`, `"1.224602"`, `"2.937661"`. Not a
   fixed-width 6-dp string; must be parsed, never compared as text.

## Edge identity — exact at all three targets

`1 − target × win_chance` recomputed from the raw response strings:

| Target | `win_chance` | Implied edge | Result | Outcome |
|--------|--------------|--------------|--------|---------|
| 1.01 | `0.989108910891089109` | 0.001000000000000001 | 1.224602 | win, paid `0.01111` |
| 2.00 | `0.499500000000000000` | 0.001 | 11.82324 | win, paid `0.022` |
| 1000.00 | `0.000999000000000000` | 0.000999999999999890 | 2.937661 | loss, paid `0` |

The distribution edge is **exactly 0.1% and target-independent**, sitting at the
`min_edge` floor of the operator config. Payouts equal `stake × target` exactly.

## Operator config — unchanged

`GET /api/v2/limbo/config` returned byte-for-byte what `limboConfig.json` already records:
`max_target "100000.00"`, `scaling_edge { enabled: true, bankroll "25000000",
min_edge "0.001", max_edge "0.01", max_loss_fraction "0.12" }`.

## Zero Edge rakeback — CONFIRMED, and it posts per bet

Transaction `1196907185` (the 0.011 stake at target 2.00):

| Leg | `delta_coins` | balance before → after (coins) |
|-----|---------------|-------------------------------|
| stake debit (`1196907185`) | `-0.010996` | 503.441199 → 503.430203 |
| payout credit (`1196907221`, in `related_transactions`) | `0.021993` | 503.430202 → 503.452195 |

and a **separate** `zero_edge_rakeback_transaction`:

```json
{ "id": 1494118228, "reward_type": "zero_edge_rakeback", "bet_id": 4070664,
  "amount_coins": "0.000011", "amount_currency": "0.000011000000000000",
  "balance_type": 105, "created_at": "2026-08-31T16:29:24.000000Z" }
```

`0.000011 / 0.011 = 0.001` — the rakeback is **exactly 0.1% of stake**, exactly offsetting
the distribution edge, and it posts as its own transaction about a second after settlement.
The MANIFEST's Zero Edge account is therefore correct as a mechanism; only the
`effective_edge = 0` reading of it was not.

Two unit cautions for the reconciliation, both observed here:

- Coins and currency are different units — a `0.011000000000000000` currency stake posted
  as `-0.010996` coins.
- The coins ledger does not chain exactly across legs: the debit's `balance_after_coins`
  was `503.430203` while the credit's `balance_before_coins` was `503.430202`. Net on
  `delta_coins`, not on the balances.

Cross-check: the transaction's `balance_before_currency` of `503.612426806716380400`
matches the balance shown in the game header after the two preceding bets.

## Table minimum — the capture would have failed on bet 1

The UI rejected a `0.01` stake with **"Min bet is 0.01000321"**. The capture script's
phases A, B and D were hard-coded to `'0.01'`, i.e. *below the minimum*, so every bet in
the run would have been rejected. The minimum is dynamic (pegged to roughly $0.01 in the
balance currency), so the stake is now `0.0125` — about 25% headroom against rate drift
over a multi-hour run.

## Seed state after the pre-flight

```json
{ "client_seed": "mpz6LzeQC6zDNcg5",
  "server_seed_hashed": "f98c5abdc0fc6f23417812a81b782fd19c534592874455d67f62dc9ce1162ad3",
  "next_server_seed_hash": "3af04fb9b8533e0a398459a69b0e4107e7987471a62457f4dec17628657819b7",
  "nonce": 32, "initialized": true }
```

`next_server_seed_hash` is published, so the forward-commitment check (Step 2) has the
input it needs. Nonces advanced 29 → 30 → 31 across the three API bets, one per bet.

## NOT verified

- **No multiplier has been re-derived from a revealed server seed.** The active epoch was
  not rotated, so `server_seed` is still `null` and `src/rng.ts` has not been checked
  against live data. The engine's only proof remains the 5,000-case parity run against
  Duel's own published verifier.
- **The sampled wallet capture added to the capture script has not been executed.** Its
  field names come from the live transaction read above, but the code path itself has only
  been syntax-checked.
- **Rakeback behaviour above the daily Zero Edge cap was not exercised** — five bets at
  ~$0.011 come nowhere near it. Operator-disclosed only.
- **Whether `effective_edge` is ever 0** is unresolved. Five bets on one account, one
  currency, one day.
