/**
 * Duel.com Limbo — type definitions.
 *
 * Field names mirror the Duel public transaction / bet-response payload so a
 * captured dataset deserialises without transformation. `result` is the fair
 * multiplier (>= 1.0); `target` is the multiplier the player bet on; a bet
 * wins when the backend's edge-adjusted threshold is met (see rng.ts).
 */

export interface BetRequest {
  amount:   string;
  target:   number;   // chosen payout multiplier, e.g. 2.00
  instant:  boolean;  // skip-animation flag; Limbo has NO bet_type (no over/under side)
}

/**
 * Live shape confirmed by pre-flight bets on 2026-08-31 (see evidence/preflight-2026-08-31.md).
 * The response arrives as `{ success, data: { round: BetResponse } }`.
 */
export interface BetResponse {
  id:                     number;
  /**
   * Fair multiplier as a decimal STRING, floored to 6 dp. TRAILING ZEROS ARE
   * STRIPPED — observed "11.82324", "1.224602", "2.937661" — so the string is
   * not fixed-width and must be parsed, never compared as text.
   */
  result:                 string;
  is_win:                 boolean;
  /**
   * NOT a currency code — this is the STAKE, 18 dp ("0.011000000000000000").
   * The currency is `balance_type`. Do not read this field as "USD".
   */
  amount_currency:        string;
  amount_won:             string;   // equals stake x target exactly on a win; "0" on a loss
  target:                 string;   // chosen payout multiplier, as a string (e.g. "2.00")
  win_chance:             string;   // FRACTION, not a percentage — "0.499500000000000000" at 2.00x
  multiplier:             string;   // 18-dp echo of `target`
  nonce:                  number;
  server_seed_hashed:     string;
  client_seed:            string;
  /**
   * ABSENT from the live bet response — the active server seed is only ever
   * published by rotating the pair, so this is populated from the seed feed,
   * not from the bet. Optional rather than `| null` for that reason.
   */
  server_seed?:           string | null;
  /**
   * Duel reports TWO edge fields. On the pre-flight bets of 2026-08-31 they
   * were EQUAL — `effective_edge === house_edge_percentage === 0.1` on all five
   * bets, at targets 1.01x, 2.00x and 1000.00x, balance_type 105.
   *
   * An earlier note in this repo recorded `effective_edge = 0` and built a
   * "Zero Edge rakeback" reading on it. That did not reproduce. Which of the
   * two is account-, currency- or period-dependent is UNKNOWN and must not be
   * asserted either way in the report — the capture settles it, and until then
   * both fields are recorded verbatim and neither is characterised.
   *
   * Either way both are operator claims. The audit measures the distribution
   * edge from the win/lose boundary (Step 9) and tests it against these.
   */
  effective_edge:         number;
  house_edge_percentage:  number;
  balance_type:           number;  // 105 — matches the `currency` field on the bet request
  transaction_id:         number;  // key into /api/v2/user/transactions/{id} for the wallet legs
}

/**
 * A settled bet as it appears in /api/v2/user/transactions/{id}. Each bet
 * produces TWO rows — the stake debit and (on a win) the payout credit — so
 * wallet reconciliation must net them rather than reading one. Confirmed
 * 2026-08-31: the debit row is returned at the top level and the payout leg
 * arrives inside `related_transactions`, NOT as a second top-level row.
 *
 * `delta_coins` is in COINS; `amount_currency` is in the display currency. They
 * differ by a conversion factor — on the pre-flight bet, a stake of
 * 0.011000000000000000 currency posted as -0.010996 coins and a 0.022 payout as
 * +0.021993 — so a reconciliation must not mix the two units.
 *
 * The coins ledger also does not chain exactly: the debit row's
 * `balance_after_coins` was 503.430203 while the credit row's
 * `balance_before_coins` was 503.430202. A 1e-6 display rounding, not a
 * discrepancy to reconcile against — net on `delta_coins`, not on the balances.
 */
export interface TransactionRow {
  id:                   number;
  type:                 string;   // "Limbo Rounds"
  key:                  string;   // "limbo_rounds"
  delta:                number;   // whole coins, rounded — use delta_coins for the real figure
  delta_coins:          string;
  balance_before_coins: string;
  balance_after_coins:  string;
  timestamp_raw:        number;
  currency:             number;   // 105, matching balance_type
  amount_currency?:     string;
  related_transactions?: TransactionRow[];
  data?:                BetResponse;
}

export interface LimboBet {
  at:       string;
  phase:    string;
  request:  BetRequest;
  response: BetResponse;
}

export interface NextSeedPromotion {
  previousNextHash: string;
  newActiveHash:    string;
  newNextHash:      string;
  match:            boolean;
}

export interface SeedEntry {
  at:      string;
  context: string;
  phase:   string;
  seed: {
    clientSeed:         string;
    serverSeedHashed:   string;
    nextServerSeedHash: string;
    serverSeed:         string | null;
  };
  nonce: number;
  nextSeedPromotion?: NextSeedPromotion;
  revealedFrom?: { transactionId: number };
}

export interface LimboDataset {
  meta:  Record<string, unknown>;
  seeds: SeedEntry[];
  bets:  LimboBet[];
}

/** The live API returns `result`, `target` and `win_chance` as decimal STRINGS. */
export const num = (v: string | number): number => (typeof v === 'number' ? v : parseFloat(v));
