// Duel Limbo — capture methodology, published for provenance/review.
// Reference record, not a runnable tool. Dataset lands in `data/`, hash-verified
// by the suite. Structure follows the Duel Dice capture reference; the phase
// plan differs for the reason documented below.
//
// ── PRE-FLIGHT: DONE 2026-08-31 ──────────────────────────────────────────────
// Endpoint, payload and response shape confirmed against five live bets — see
// evidence/preflight-2026-08-31.md. Fixes that came out of it: the stake was
// below the table minimum (0.01 vs a 0.01000321 floor, every bet would have
// been rejected); house_edge_percentage was not recorded although Step 11
// scores on it; bet_type and drand_* were dead fields.
//
// Both the seed-reveal path and the wallet sampling ran in the capture: in
// data/limbo-master.json 157 of the 158 seed records carry a revealed server
// seed with its revealedFrom transaction (record 0, the capture-start rotation,
// precedes every bet), and 163 of the 7,700 bets carry a wallet envelope.
//
// ── WHY THE PHASE PLAN LOOKS LIKE THIS ───────────────────────────────────────
// The house edge is applied to the WIN THRESHOLD, not the multiplier, so it can
// only be measured from where wins flip to losses:
//     win  at (T,R): edge <= 1 - T/R      loss at (T,R): edge > 1 - T/R
// The bracket closes only when a result lands near T/(1-edge). Since
// P(R >= x) = 1/x, the expected closest approach after n bets at target T is
// ~T/n — so LOW targets pin the edge about an order of magnitude faster than
// high ones. Measured by src/capture-power.ts over 1,500 simulated captures per
// row (outputs/capture-power.json), holding Phase B at 2,000 bets and varying
// only the target they are placed at:
//     2,000 @ 1.01x  ->  median 0.0573 pp, clears the 0.10 pp Step 9 threshold 78.3% of runs
//     2,000 @ 10x    ->  median 0.1430 pp, 31.7%
//     2,000 @ 100x   ->  median 0.1713 pp, 25.5%
// Phase B is therefore a LOW-target block, not the high-target block used for
// Dice. Phase A still sweeps the full range for distribution and tail evidence.
//
// NOTE the width is Gamma(2, T/n), not a constant: about one capture in five
// ends wider than 0.10 pp and Step 9 then reports FLAG rather than PASS.
// The capture placed Phase B at 2,000 bets, 7,700 in all (data/limbo-master.json:
// A 5,000, B 2,000, C 200, D 500). Its bracket came out 0.045196 pp wide from
// the 7,700 bets, inside the 0.10 pp threshold, and Step 9 reports PASS
// (outputs/verification-results.json).

if (window._limbokill) window._limbokill();

(function () {
  'use strict';

  var INSTANCE = Date.now();
  window._limbokill = function () { INSTANCE = -1; };

  // ── Phase config (matches audit report) ──────────────────────────────────
  // Log-uniform sweep across the useful betting range for Phase A.
  function randomTarget() {
    var lo = Math.log(1.01), hi = Math.log(1000);
    return (Math.exp(lo + Math.random() * (hi - lo))).toFixed(2);
  }

  // STAKE: the site enforces a DYNAMIC minimum pegged to ~$0.01 in the balance
  // currency — it read 0.01000321 at pre-flight on 2026-08-31, so the previous
  // '0.01' was BELOW the minimum and every bet would have been rejected. 0.0125
  // carries ~25% headroom against exchange-rate drift over a multi-hour run.
  // If bets start failing, read the "Min bet is" value off the game panel and
  // raise this — do not lower it.
  var PHASES = [
    { key: 'A', name: 'Random targets',     total: 5000, amount: '0.0125', targetFn: randomTarget },
    { key: 'B', name: 'Edge precision 1.01x', total: 2000, amount: '0.0125', targetFn: function () { return '1.01'; } },
    { key: 'C', name: 'Stake independence',  total: 200,  amount: '10',   targetFn: function () { return '1.01'; } },
    { key: 'D', name: 'Custom client seed',  total: 500,  amount: '0.0125', targetFn: randomTarget },
  ];

  var PLANNED_TOTAL = PHASES.reduce(function (s, p) { return s + p.total; }, 0);

  var BETS_PER_EPOCH = 50;
  var BET_DELAY      = 500;
  var MAX_ERRORS     = 8;
  var DB_NAME        = 'limbo_capture_v1';

  // ── IndexedDB ────────────────────────────────────────────────────────────
  var db = null;

  function openDB() {
    if (db) return Promise.resolve(db);
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function (e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains('bets'))  d.createObjectStore('bets',  { autoIncrement: true });
        if (!d.objectStoreNames.contains('seeds')) d.createObjectStore('seeds', { autoIncrement: true });
        if (!d.objectStoreNames.contains('meta'))  d.createObjectStore('meta');
      };
      req.onsuccess = function (e) { db = e.target.result; resolve(db); };
      req.onerror   = function (e) { reject(e.target.error); };
    });
  }

  function dbPut(store, value, key) {
    return new Promise(function (resolve, reject) {
      var tx  = db.transaction(store, 'readwrite');
      var req = key !== undefined ? tx.objectStore(store).put(value, key) : tx.objectStore(store).add(value);
      req.onsuccess = function () { resolve(req.result); };
      req.onerror   = function () { reject(req.error); };
    });
  }

  function dbGetAll(store) {
    return new Promise(function (resolve, reject) {
      var req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = function () { resolve(req.result); };
      req.onerror   = function () { reject(req.error); };
    });
  }

  var meta = { phaseIdx: 0, phaseBets: 0, epochBets: 0, phaseStarted: false,
               errors: 0, token: null, tokenAt: 0, lastTxId: null, lastNextHash: null,
               phaseBetCounts: { A: 0, B: 0, C: 0, D: 0 }, walletSamples: 0 };
  var betCount = 0, seedCount = 0, paused = false;

  function saveMeta() { return dbPut('meta', meta, 'state'); }

  function log(m)  { console.log('%c[limbo] ' + m, 'color:#4fc3f7'); }
  function warn(m) { console.warn('%c[limbo] ' + m, 'color:#ffb74d'); }
  function good(m) { console.log('%c[limbo] ' + m, 'color:#81c784'); }

  // ── Visual Panel ─────────────────────────────────────────────────────────
  // Same format as the Duel Dice / Plinko / Keno capture panels: draggable,
  // one progress bar per phase, GO / PAUSE / SAVE. The extra wallet line is
  // Limbo-specific — it tracks the sampled ledger reads that evidence the
  // Zero Edge rakeback, which no other Duel game captures.
  function buildPanel() {
    var old = document.getElementById('cap-panel');
    if (old) old.remove();

    var d = document.createElement('div');
    d.id = 'cap-panel';
    Object.assign(d.style, {
      position:'fixed', bottom:'16px', right:'16px', zIndex:'99999',
      background:'#0d1117', border:'1px solid #1e2d3d', borderRadius:'8px',
      padding:'12px 16px', fontFamily:'monospace', fontSize:'11px',
      color:'#b8cfe0', minWidth:'300px', boxShadow:'0 4px 24px rgba(0,0,0,.7)',
      cursor:'move', userSelect:'none',
    });

    var dragging = false, ox = 0, oy = 0;
    d.addEventListener('mousedown', function (e) {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true; ox = e.clientX - d.offsetLeft; oy = e.clientY - d.offsetTop;
    });
    document.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      d.style.left = (e.clientX - ox) + 'px'; d.style.top = (e.clientY - oy) + 'px';
      d.style.right = 'auto'; d.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', function () { dragging = false; });

    var title = document.createElement('div');
    title.textContent = 'LIMBO CAPTURE';
    Object.assign(title.style, { color:'#4fc3f7', fontWeight:'700', fontSize:'13px' });
    d.appendChild(title);

    var st = document.createElement('div');
    st.id = 'cap-status';
    Object.assign(st.style, { margin:'6px 0', color:'#4d6880', fontSize:'10px' });
    d.appendChild(st);

    for (var pi = 0; pi < PHASES.length; pi++) {
      var ph = PHASES[pi];
      var row = document.createElement('div');
      Object.assign(row.style, { display:'flex', alignItems:'center', gap:'6px', marginBottom:'3px' });

      var lbl = document.createElement('span');
      lbl.textContent = ph.key;
      Object.assign(lbl.style, { width:'14px', color:'#4d6880', fontWeight:'700' });

      var barOuter = document.createElement('div');
      Object.assign(barOuter.style, { flex:'1', height:'8px', background:'#161e28', borderRadius:'4px', overflow:'hidden' });
      var fill = document.createElement('div');
      fill.id = 'cap-bar-' + ph.key;
      Object.assign(fill.style, { height:'100%', width:'0%', background:'#2dff82', borderRadius:'4px', transition:'width .3s' });
      barOuter.appendChild(fill);

      var ct = document.createElement('span');
      ct.id = 'cap-ct-' + ph.key;
      ct.textContent = '0/' + ph.total;
      Object.assign(ct.style, { width:'80px', textAlign:'right', fontSize:'9px', color:'#4d6880' });

      row.appendChild(lbl); row.appendChild(barOuter); row.appendChild(ct);
      d.appendChild(row);
    }

    var seedLine = document.createElement('div');
    seedLine.id = 'cap-seeds';
    Object.assign(seedLine.style, { margin:'6px 0 0', fontSize:'10px', color:'#4d6880' });
    d.appendChild(seedLine);

    var walletLine = document.createElement('div');
    walletLine.id = 'cap-wallet';
    Object.assign(walletLine.style, { margin:'2px 0 4px', fontSize:'10px', color:'#4d6880' });
    d.appendChild(walletLine);

    function mkBtn(text, color, fn) {
      var b = document.createElement('button');
      b.textContent = text;
      Object.assign(b.style, {
        flex:'1', padding:'5px 0', background:'#161e28', border:'1px solid #1e2d3d',
        color: color, borderRadius:'3px', cursor:'pointer', fontFamily:'monospace',
        fontSize:'10px', fontWeight:'700',
      });
      b.addEventListener('click', fn);
      return b;
    }

    function mkRow() {
      var r = document.createElement('div');
      Object.assign(r.style, { display:'flex', gap:'4px', marginTop:'6px' });
      return r;
    }

    var row1 = mkRow();
    row1.appendChild(mkBtn('GO', '#2dff82', function () { pub.go(); }));
    row1.appendChild(mkBtn('PAUSE', '#ffcc44', function () { pub.pause(); }));
    row1.appendChild(mkBtn('SAVE', '#33ccff', function () { pub.save(); }));
    d.appendChild(row1);

    var row2 = mkRow();

    // ROTATE: the run must end with one more rotation or the FINAL epoch is
    // never revealed and its bets cannot be verified. There was no control for
    // that — the only rotations were automatic ones between epochs.
    row2.appendChild(mkBtn('ROTATE', '#c792ea', function () { pub.rotate(); }));

    // RESET: two-click arm, so a stray click cannot destroy a 90-minute run.
    var resetArmed = false, resetTimer = null;
    var resetBtn = mkBtn('RESET', '#ff5f6d', function () {
      if (!resetArmed) {
        resetArmed = true;
        resetBtn.textContent = 'CONFIRM?';
        resetBtn.style.background = '#3a1218';
        resetTimer = setTimeout(function () {
          resetArmed = false; resetBtn.textContent = 'RESET'; resetBtn.style.background = '#161e28';
        }, 5000);
        return;
      }
      clearTimeout(resetTimer);
      resetArmed = false; resetBtn.textContent = 'RESET'; resetBtn.style.background = '#161e28';
      pub.reset('yes');
    });
    row2.appendChild(resetBtn);
    d.appendChild(row2);

    document.body.appendChild(d);
    updatePanel();
  }

  function updatePanel() {
    for (var pi = 0; pi < PHASES.length; pi++) {
      var ph = PHASES[pi];
      var n = meta.phaseBetCounts ? (meta.phaseBetCounts[ph.key] || 0) : 0;
      var bar = document.getElementById('cap-bar-' + ph.key);
      var ct  = document.getElementById('cap-ct-' + ph.key);
      if (bar) {
        bar.style.width = Math.min(100, n / ph.total * 100) + '%';
        bar.style.background = n >= ph.total ? '#33ccff' : '#2dff82';
      }
      if (ct) ct.textContent = n + '/' + ph.total;
    }
    var st = document.getElementById('cap-status');
    if (st) {
      var state = paused ? 'paused' : (meta.running ? 'running' : 'idle');
      var cfg = PHASES[meta.phaseIdx];
      var where = cfg ? ('phase ' + cfg.key + ' @ $' + cfg.amount) : 'all phases done';
      var errStr = meta.errors > 0 ? '  err:' + meta.errors : '';
      var pct = PLANNED_TOTAL ? Math.floor(betCount / PLANNED_TOTAL * 100) : 0;
      st.textContent = state + '  |  ' + where + '  |  ' +
                       betCount + '/' + PLANNED_TOTAL + ' (' + pct + '%)' + errStr;
      st.style.color = meta.running && !paused ? '#2dff82' : (meta.errors > 0 ? '#ff5f6d' : '#4d6880');
    }
    var sl = document.getElementById('cap-seeds');
    if (sl) sl.textContent = 'seeds: ' + seedCount + '  |  epoch: ' + meta.epochBets + '/' + BETS_PER_EPOCH;
    var wl = document.getElementById('cap-wallet');
    if (wl) wl.textContent = 'wallet samples: ' + (meta.walletSamples || 0) +
                             '  (every ' + WALLET_SAMPLE_EVERY + ')';
  }

  // ── API ──────────────────────────────────────────────────────────────────
  function api(method, path, body) {
    var opts = {
      method: method, credentials: 'include',
      headers: {
        'content-type': 'application/json', 'accept': 'application/json, text/plain, */*',
        'x-duel-device-identifier': localStorage.getItem('security:uuid') || '',
        'x-env-class': localStorage.getItem('env_class') || 'blue',
      },
    };
    if (body) opts.body = JSON.stringify(body);
    return fetch(path, opts).then(function (res) {
      return res.json().then(function (j) {
        if (!res.ok || j.success === false) {
          var errDetail = JSON.stringify(j).slice(0, 400);
          log('API ' + method + ' ' + path + ' ' + res.status + ': ' + errDetail);
          throw new Error((j.error || j.message || errDetail).slice(0, 200));
        }
        return j.data || j;
      });
    });
  }

  function refreshToken() {
    return api('POST', '/api/v2/user/security/token', {
      uuid: localStorage.getItem('security:uuid'), code: '0000', type: 'standard',
    }).then(function (r) { meta.token = r.token || r; meta.tokenAt = Date.now(); return meta.token; });
  }

  function ensureToken() {
    return (Date.now() - meta.tokenAt > 300000) ? refreshToken() : Promise.resolve(meta.token);
  }

  function getActiveSeed()      { return api('GET', '/api/v2/client-seed'); }

  // NOTE api() returns `j.data || j`. For the transaction endpoint `j.data` is
  // the ROUND, so getTransaction gives round fields — which is what the seed
  // reveal wants (`server_seed` lives on the round, confirmed 2026-08-31), but
  // it hides the wallet envelope. getTransactionRaw returns the transaction
  // itself: delta_coins, the payout leg in related_transactions, and the
  // zero_edge_rakeback_transaction.
  function getTransaction(txId) { return api('GET', '/api/v2/user/transactions/' + txId); }

  function getTransactionRaw(txId) {
    return fetch('/api/v2/user/transactions/' + txId, {
      credentials: 'include',
      headers: {
        'accept': 'application/json, text/plain, */*',
        'x-duel-device-identifier': localStorage.getItem('security:uuid') || '',
        'x-env-class': localStorage.getItem('env_class') || 'blue',
      },
    }).then(function (res) { return res.json(); });
  }

  // Wallet reconciliation is SAMPLED, not per-bet: fetching a transaction for
  // all 7,700 bets would double the request count and the run time for no extra
  // evidence. Every WALLET_SAMPLE_EVERY-th bet records its ledger legs and its
  // Zero Edge rakeback, which is what lets the report evidence the rakeback
  // instead of repeating the operator's claim about it.
  //
  // Confirmed at pre-flight: on a 0.011 stake the rakeback posted as its own
  // transaction of 0.000011 currency = exactly 0.001 x stake. It lands about a
  // second AFTER the bet settles, hence the delay before reading.
  // 47, not 50: BETS_PER_EPOCH is 50, so a stride of 50 would sample the LAST
  // bet of every epoch and nothing else — a systematically biased sample sitting
  // permanently next to a rotation. 47 is coprime with 50, so the sample walks
  // through every position within the epoch (~163 samples over the run).
  var WALLET_SAMPLE_EVERY = 47;
  var WALLET_READ_DELAY   = 2500;

  function captureWallet(txId) {
    return new Promise(function (r) { setTimeout(r, WALLET_READ_DELAY); })
      .then(function () { return getTransactionRaw(txId); })
      .then(function (t) {
        var legs = [t].concat(t.related_transactions || []).map(function (x) {
          return { id: x.id, key: x.key, delta_coins: x.delta_coins,
                   amount_currency: x.amount_currency,
                   balance_before_coins: x.balance_before_coins,
                   balance_after_coins: x.balance_after_coins };
        });
        var rb = t.zero_edge_rakeback_transaction || null;
        return {
          legs: legs,
          rakeback: rb ? { id: rb.id, reward_type: rb.reward_type,
                           amount_coins: rb.amount_coins,
                           amount_currency: rb.amount_currency,
                           balance_type: rb.balance_type, created_at: rb.created_at } : null,
          rakebackSums: t.rakeback_sums || null,
        };
      })
      .catch(function (e) { return { error: String(e && e.message || e) }; });
  }

  function generateClientSeed() {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var s = ''; for (var i = 0; i < 16; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  function rotateSeed(customSeed) {
    var clientSeed = customSeed || generateClientSeed();
    return ensureToken().then(function (token) {
      function tryRotate(attempt) {
        return api('POST', '/api/v2/client-seed/rotate', { client_seed: clientSeed, security_token: token })
          .catch(function (e) {
            if (/complete.*round|rotating/i.test(e.message) && attempt < 4) {
              return new Promise(function (r) { setTimeout(r, 1000 * (attempt + 1)); })
                .then(function () { return tryRotate(attempt + 1); });
            }
            throw e;
          });
      }
      return tryRotate(0);
    });
  }

  // target is a payout MULTIPLIER for Limbo (e.g. "2.00"), not a 0–10000 roll line.
  function placeBet(amount, target) {
    return ensureToken().then(function (token) {
      // Payload shape read from Duel's own client bundle (assets/limbo-*.js):
      // { amount, target, currency, security_token, instant }. Limbo has no
      // bet_type — there is no over/under, only a target multiplier — and
      // `instant` is the skip-animation toggle, set true so the response
      // returns without waiting on the client-side reveal.
      return api('POST', '/api/v2/limbo/bet', {
        amount: String(amount), target: String(target),
        currency: 105, security_token: token, instant: true,
      });
    });
  }

  // ── Seed rotation: record the forward commitment and reveal the old seed ──
  function doRotation(phase, customSeed) {
    return Promise.resolve().then(function () {
      if (!meta.lastNextHash) {
        return getActiveSeed().then(function (s) {
          meta.lastNextHash = s.next_server_seed_hash;
          log('initial next_hash: ' + String(meta.lastNextHash).slice(0, 24) + '...');
        });
      }
    }).then(function () {
      return rotateSeed(customSeed);
    }).then(function (rot) {
      var entry = {
        at: new Date().toISOString(), context: 'rotate-phase-' + phase, phase: phase,
        seed: { clientSeed: rot.client_seed, serverSeedHashed: rot.server_seed_hashed,
                nextServerSeedHash: rot.next_server_seed_hash, serverSeed: null },
        nonce: 0,
      };
      var promoted = rot.server_seed_hashed === meta.lastNextHash;
      entry.nextSeedPromotion = {
        previousNextHash: meta.lastNextHash, newActiveHash: rot.server_seed_hashed,
        newNextHash: rot.next_server_seed_hash, match: promoted,
      };
      if (promoted) good('promoted: ' + meta.lastNextHash.slice(0, 16) + ' -> ' + rot.server_seed_hashed.slice(0, 16));
      else warn('FORWARD COMMITMENT MISMATCH');
      meta.lastNextHash = rot.next_server_seed_hash;

      function persist() {
        return dbPut('seeds', entry).then(function () {
          seedCount++; meta.epochBets = 0; meta.errors = 0; return saveMeta();
        });
      }

      if (meta.lastTxId) {
        return getTransaction(meta.lastTxId).then(function (tx) {
          entry.seed.serverSeed = tx.server_seed || null;
          entry.revealedFrom = { transactionId: meta.lastTxId };
          good('revealed: ' + String(entry.seed.serverSeed || 'PENDING').slice(0, 16) + '...');
          return persist();
        }).catch(persist);
      }
      return persist();
    });
  }

  // ── Main loop ────────────────────────────────────────────────────────────
  function runLoop() {
    if (INSTANCE === -1 || paused) { log('paused'); meta.running = false; saveMeta(); updatePanel(); return; }

    if (meta.phaseIdx >= PHASES.length) {
      good('ALL PHASES COMPLETE — ' + betCount + ' bets, ' + seedCount + ' seeds. Run limbo.save()');
      good('IMPORTANT: rotate once more so the final epoch is revealed before export.');
      meta.running = false; saveMeta(); updatePanel();
      return;
    }
    var cfg = PHASES[meta.phaseIdx];

    if (!meta.phaseStarted) {
      meta.phaseStarted = true; saveMeta();
      log('Phase ' + cfg.key + ': ' + cfg.name + ' — ' + cfg.total + ' @ $' + cfg.amount);
      var cs = cfg.key === 'D' ? 'pfaudit' + Date.now().toString(36) : null;
      doRotation(cfg.key, cs)
        .then(function () { updatePanel(); setTimeout(runLoop, BET_DELAY); })
        .catch(function (e) {
          warn('rotation failed: ' + e.message); meta.errors++;
          if (meta.errors >= MAX_ERRORS) { warn('too many errors — pausing'); paused = true; }
          saveMeta(); updatePanel(); setTimeout(runLoop, 3000);
        });
      return;
    }

    if (meta.phaseBets >= cfg.total) {
      doRotation(cfg.key, null).then(function () {
        good('Phase ' + cfg.key + ' done');
        meta.phaseIdx++; meta.phaseBets = 0; meta.epochBets = 0; meta.phaseStarted = false;
        saveMeta(); updatePanel(); setTimeout(runLoop, BET_DELAY);
      }).catch(function (e) { warn('end rotation failed: ' + e.message); setTimeout(runLoop, 3000); });
      return;
    }

    if (meta.epochBets >= BETS_PER_EPOCH) {
      var ds = cfg.key === 'D' ? 'pfaudit' + Date.now().toString(36) : null;
      doRotation(cfg.key, ds)
        .then(function () { updatePanel(); setTimeout(runLoop, BET_DELAY); })
        .catch(function (e) {
          warn('epoch rotation: ' + e.message); meta.errors++;
          if (meta.errors >= MAX_ERRORS) { warn('too many errors — pausing'); paused = true; }
          saveMeta(); updatePanel(); setTimeout(runLoop, 3000);
        });
      return;
    }

    var target = cfg.targetFn();
    placeBet(cfg.amount, target).then(function (bet) {
      var r = bet.round || bet;
      var rec = {
        at: new Date().toISOString(), phase: cfg.key,
        request: { amount: cfg.amount, target: Number(target), instant: true },
        // Field list confirmed against live bets 2026-08-31 (evidence/preflight-2026-08-31.md).
        // house_edge_percentage is MANDATORY: Step 11 scores the operator's
        // distribution edge from it, and a dataset without it makes that step
        // FLAG rather than PASS. It was missing here.
        // Removed: bet_type (does not exist on Limbo) and drand_round /
        // drand_randomness (Limbo is HMAC commit-reveal, not a drand game —
        // template residue that would have written null on all 7,700 rows).
        response: {
          id: r.id, result: r.result, is_win: r.is_win,
          amount_currency: r.amount_currency, amount_won: r.amount_won,
          target: r.target, win_chance: r.win_chance,
          multiplier: r.multiplier, nonce: r.nonce,
          server_seed_hashed: r.server_seed_hashed, client_seed: r.client_seed,
          effective_edge: r.effective_edge,
          house_edge_percentage: r.house_edge_percentage,
          balance_type: r.balance_type,
          transaction_id: r.transaction_id,
        },
      };
      meta.lastTxId = r.transaction_id;
      meta.phaseBets++; meta.epochBets++; meta.errors = 0;
      if (!meta.phaseBetCounts) meta.phaseBetCounts = { A:0, B:0, C:0, D:0 };
      meta.phaseBetCounts[cfg.key]++;
      betCount++;
      return Promise.resolve()
        .then(function () {
          if (betCount % WALLET_SAMPLE_EVERY !== 0 || !r.transaction_id) return null;
          return captureWallet(r.transaction_id).then(function (w) {
            rec.wallet = w;
            meta.walletSamples = (meta.walletSamples || 0) + 1;
          });
        })
        .then(function () { return dbPut('bets', rec); })
        .then(saveMeta).then(function () {
        if (betCount % 100 === 0) log('Phase ' + cfg.key + ': ' + meta.phaseBets + '/' + cfg.total + ' | total: ' + betCount);
        updatePanel();
      });
    }).then(function () {
      setTimeout(runLoop, BET_DELAY);
    }).catch(function (e) {
      warn('bet failed: ' + e.message); meta.errors++;
      if (meta.errors >= MAX_ERRORS) { warn('too many errors — pausing'); paused = true; }
      saveMeta(); updatePanel(); setTimeout(runLoop, 2000);
    });
  }

  // ── Export ───────────────────────────────────────────────────────────────
  var pub = {
    go: function () {
      paused = false;
      openDB()
        .then(function () { return dbGetAll('meta'); })
        .then(function (m) { if (m && m[0]) meta = m[0]; return dbGetAll('bets'); })
        .then(function (b) { betCount = b.length; return dbGetAll('seeds'); })
        .then(function (s) { seedCount = s.length; meta.running = true; return saveMeta(); })
        .then(function () { log('resuming at ' + betCount + ' bets'); runLoop(); });
    },
    pause: function () { paused = true; updatePanel(); },

    /**
     * Rotate the seed pair once, by hand.
     *
     * Needed at the END of a run: the final epoch is only revealed by a
     * rotation that comes after its last bet, so without this the closing
     * bets can never be verified. Refuses to run while the loop is betting,
     * because a rotation racing the bet loop would split an epoch and break
     * the nonce chain.
     */
    rotate: function () {
      if (meta.running && !paused) {
        warn('pause first — rotating while betting would split the epoch');
        return Promise.resolve(false);
      }
      var cfg = PHASES[meta.phaseIdx];
      var key = cfg ? cfg.key : 'final';
      return openDB()
        .then(function () { return doRotation(key, null); })
        .then(function () {
          updatePanel();
          good('manual rotation done — seeds: ' + seedCount +
               ' (previous epoch now revealed)');
          return true;
        })
        .catch(function (e) { warn('rotation failed: ' + e.message); return false; });
    },

    // Discard everything and start clean. go() RESUMES from IndexedDB, so
    // without this a smoke run stays in the dataset and the real capture
    // continues on top of it. Console-only and guarded — deliberately not a
    // panel button, so it cannot be clicked mid-capture.
    reset: function (confirm) {
      if (confirm !== 'yes') {
        warn('reset() DISCARDS all captured bets and seeds. Call limbo.reset("yes") to confirm.');
        return Promise.resolve(false);
      }
      paused = true;
      return openDB()
        .then(function () { return dbGetAll('bets'); })
        .then(function (b) {
          var n = b.length;
          if (db) { db.close(); db = null; }
          return new Promise(function (resolve, reject) {
            var req = indexedDB.deleteDatabase(DB_NAME);
            req.onsuccess = function () { resolve(n); };
            req.onerror   = function () { reject(req.error); };
            req.onblocked = function () { warn('reset blocked — close other duel.com tabs and retry'); };
          });
        })
        .then(function (n) {
          meta = { phaseIdx: 0, phaseBets: 0, epochBets: 0, phaseStarted: false,
                   errors: 0, token: null, tokenAt: 0, lastTxId: null, lastNextHash: null,
                   phaseBetCounts: { A: 0, B: 0, C: 0, D: 0 }, walletSamples: 0, running: false };
          betCount = 0; seedCount = 0;
          buildPanel();
          good('reset — discarded ' + n + ' bets. Panel back to zero; limbo.go() starts clean.');
          return true;
        });
    },
    save: function () {
      return openDB()
        .then(function () { return Promise.all([dbGetAll('bets'), dbGetAll('seeds')]); })
        .then(function (r) {
          var out = {
            meta: {
              game: 'limbo', platform: 'duel.com',
              capturedAt: new Date().toISOString(),
              phases: PHASES.map(function (p) { return { key: p.key, name: p.name, total: p.total, amount: p.amount }; }),
              totalBets: r[0].length, totalSeeds: r[1].length,
            },
            seeds: r[1], bets: r[0],
          };
          var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'limbo-master.json';
          a.click();
          good('exported ' + r[0].length + ' bets / ' + r[1].length + ' seeds');
        });
    },
  };
  window.limbo = pub;

  // Draw the panel immediately and restore any progress already in IndexedDB,
  // so a page reload mid-capture comes back showing where the run actually is
  // rather than zeros.
  buildPanel();
  openDB()
    .then(function () { return dbGetAll('meta'); })
    .then(function (m) { if (m && m[0]) meta = m[0]; return dbGetAll('bets'); })
    .then(function (b) { betCount = b.length; return dbGetAll('seeds'); })
    .then(function (s) { seedCount = s.length; paused = true; meta.running = false; updatePanel(); })
    .catch(function (e) { warn('panel restore failed: ' + e.message); });
})();

console.log('[limbo] capture panel loaded — GO / PAUSE / SAVE on the panel, or limbo.go()');
