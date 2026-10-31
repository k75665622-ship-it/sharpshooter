/* ============================================================
   Sharpshooter — bet builder core (browser + server)

   One match, several selections, one combined chance. Selections from the same match
   depend on each other ("Chelsea to win" and "Chelsea to score" mostly happen together),
   so their chances are NOT multiplied. Instead every goal selection is a condition on the
   final score, and the combined chance is the probability of the scores where every
   condition holds, from one score model of the match:

     goals     Dixon-Coles score matrix from the bookmakers' expected goals (lib/model.js)
     scorers   given the team scores g goals, a player with share s of its goals scores at
               least once with probability 1 - (1 - s)^g (two team-mates by inclusion-exclusion)
     corners   each side's corners from the form + price model (negative binomial)
     cards     the match's cards from the form + price model (negative binomial)

   Corners and cards are combined with the goals as independent; every leg's own chance is
   then nudged to its MEASURED chance (lib/strongest/calibrate.js), and the bet builder's
   combined chance is checked against what actually happened on 2019-26 matches
   (research/v6/betbuilder_report.js) and calibrated (`calibrate` below).

   Used by lib/betbuilder.js (server) and public/betbuilder.js (the Bet Builder tab).
   ============================================================ */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BBCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_GOALS = 10; // as lib/model.js
  const MAX_CORNERS = 20; // per side
  const MAX_CARDS = 16;

  // ---------------------------------------------------------------- distributions
  const LOG_FACT = [0];
  for (let i = 1; i <= 60; i++) LOG_FACT[i] = LOG_FACT[i - 1] + Math.log(i);
  function poisson(k, lambda) {
    if (lambda <= 0) return k === 0 ? 1 : 0;
    return Math.exp(-lambda + k * Math.log(lambda) - LOG_FACT[Math.min(k, 60)]);
  }
  function tau(x, y, lambda, mu, rho) {
    if (x === 0 && y === 0) return 1 - lambda * mu * rho;
    if (x === 0 && y === 1) return 1 + lambda * rho;
    if (x === 1 && y === 0) return 1 + mu * rho;
    if (x === 1 && y === 1) return 1 - rho;
    return 1;
  }
  /** The Dixon-Coles score matrix, exactly as lib/model.js scoreMatrix builds it. */
  function scoreMatrix(lambda, mu, rho) {
    const r = rho == null ? -0.05 : rho;
    const m = [];
    let total = 0;
    for (let i = 0; i <= MAX_GOALS; i++) {
      m[i] = [];
      for (let j = 0; j <= MAX_GOALS; j++) {
        let p = poisson(i, lambda) * poisson(j, mu) * tau(i, j, lambda, mu, r);
        if (p < 0) p = 0;
        m[i][j] = p;
        total += p;
      }
    }
    if (total > 0) for (let i = 0; i <= MAX_GOALS; i++) for (let j = 0; j <= MAX_GOALS; j++) m[i][j] /= total;
    return m;
  }
  /** Negative binomial with mean mu and variance mu + mu^2/r (as lib/strongest/markets.js). */
  function nbPmf(mu, r, kmax) {
    const out = new Array(kmax).fill(0);
    if (!(mu > 0)) {
      out[0] = 1;
      return out;
    }
    const rr = r > 0 ? r : 1e6;
    const q = mu / (rr + mu);
    out[0] = Math.pow(rr / (rr + mu), rr);
    for (let k = 1; k < kmax; k++) out[k] = out[k - 1] * ((k - 1 + rr) / k) * q;
    const s = out.reduce((a, b) => a + b, 0);
    return s > 0 ? out.map((v) => v / s) : out;
  }

  // ---------------------------------------------------------------- the selections
  /**
   * What a selection key asks of the match. kind: goals (on the final score), corners (on
   * the two sides' corners), cards (on the match's cards), player (a scorer). family: one
   * selection per family in a bet builder (two lines of one market are one bet, not two).
   */
  function legOf(key) {
    let m;
    const k = String(key);
    switch (true) {
      case k === '1': return { kind: 'goals', family: 'result', test: (i, j) => i > j };
      case k === 'X': return { kind: 'goals', family: 'result', test: (i, j) => i === j };
      case k === '2': return { kind: 'goals', family: 'result', test: (i, j) => i < j };
      case k === '1X': return { kind: 'goals', family: 'result', test: (i, j) => i >= j };
      case k === 'X2': return { kind: 'goals', family: 'result', test: (i, j) => i <= j };
      case k === '12': return { kind: 'goals', family: 'result', test: (i, j) => i !== j };
      case k === 'BTTS_Y': return { kind: 'goals', family: 'btts', test: (i, j) => i > 0 && j > 0 };
      case k === 'BTTS_N': return { kind: 'goals', family: 'btts', test: (i, j) => i === 0 || j === 0 };
      case (m = /^([OU])(\d\.5)$/.exec(k)) !== null: {
        const l = Number(m[2]);
        return { kind: 'goals', family: 'total', test: m[1] === 'O' ? (i, j) => i + j > l : (i, j) => i + j < l };
      }
      case (m = /^TT([HA])_([OU])(\d\.5)$/.exec(k)) !== null: {
        const l = Number(m[3]);
        const g = m[1] === 'H' ? (i) => i : (i, j) => j;
        return { kind: 'goals', family: m[1] === 'H' ? 'homeGoals' : 'awayGoals', test: m[2] === 'O' ? (i, j) => g(i, j) > l : (i, j) => g(i, j) < l };
      }
      case (m = /^C_([OU])(\d+\.5)$/.exec(k)) !== null: {
        const l = Number(m[2]);
        return { kind: 'corners', family: 'corners', test: m[1] === 'O' ? (h, a) => h + a > l : (h, a) => h + a < l };
      }
      case k === 'C_MOST_H': return { kind: 'corners', family: 'cornersMost', test: (h, a) => h > a };
      case k === 'C_MOST_A': return { kind: 'corners', family: 'cornersMost', test: (h, a) => a > h };
      case (m = /^C([HA])_O(\d+\.5)$/.exec(k)) !== null: {
        const l = Number(m[2]);
        return { kind: 'corners', family: m[1] === 'H' ? 'homeCorners' : 'awayCorners', test: m[1] === 'H' ? (h) => h > l : (h, a) => a > l };
      }
      case (m = /^K_([OU])(\d+\.5)$/.exec(k)) !== null: {
        const l = Number(m[2]);
        return { kind: 'cards', family: 'cards', test: m[1] === 'O' ? (c) => c > l : (c) => c < l };
      }
      case (m = /^PL_([HA])_(\d+)$/.exec(k)) !== null: return { kind: 'player', family: `player:${k}`, side: m[1] === 'H' ? 'home' : 'away', index: Number(m[2]) };
      default: return null;
    }
  }

  // ---------------------------------------------------------------- one match
  /**
   * Everything the combined chance needs for one match, computed once.
   * @param {object} model
   * @param {{lamH:number, lamA:number, rho:number}} model.goals     the bookmaker-anchored view
   * @param {{home:number, away:number, r:number}|null} [model.corners]
   * @param {{mu:number, r:number}|null} [model.cards]
   * @param {Array<{key:string, side:'home'|'away', share:number, involvement:number}>} [model.players]
   * @param {Object<string, {chance:number, raw:number, measured:boolean}>} [model.legs]  each leg's own chance
   */
  function prepare(model) {
    const g = model && model.goals;
    if (!g || !(g.lamH > 0) || !(g.lamA > 0)) return null;
    const sm = scoreMatrix(g.lamH, g.lamA, g.rho);
    const c = model.corners && model.corners.home > 0 && model.corners.away > 0 ? model.corners : null;
    const k = model.cards && model.cards.mu > 0 ? model.cards : null;
    return {
      sm,
      ch: c ? nbPmf(c.home, c.r, MAX_CORNERS + 1) : null,
      ca: c ? nbPmf(c.away, c.r, MAX_CORNERS + 1) : null,
      kp: k ? nbPmf(k.mu, k.r, MAX_CARDS + 1) : null,
      players: Object.fromEntries((model.players || []).map((p) => [p.key, p])),
      legs: model.legs || {},
    };
  }

  /** Probability that every listed scorer of one side scores, given that side scores n goals. */
  function scorersGiven(shares, n) {
    // inclusion-exclusion over the set of players: each goal goes to player i with prob s_i
    const k = shares.length;
    let p = 0;
    for (let mask = 0; mask < 1 << k; mask++) {
      let s = 0;
      let bits = 0;
      for (let i = 0; i < k; i++) if (mask & (1 << i)) {
        s += shares[i];
        bits++;
      }
      p += (bits % 2 ? -1 : 1) * Math.pow(Math.max(0, 1 - s), n);
    }
    return Math.max(0, Math.min(1, p));
  }

  /**
   * The raw combined chance of a set of selections under the match model (no calibration).
   * Returns null when a selection is unknown or its part of the model is missing.
   */
  function rawJoint(prep, keys) {
    if (!prep) return null;
    const goals = [];
    const corners = [];
    const cards = [];
    const scorers = { home: [], away: [] };
    for (const key of keys) {
      const l = legOf(key);
      if (!l) return null;
      if (l.kind === 'goals') goals.push(l.test);
      else if (l.kind === 'corners') {
        if (!prep.ch) return null;
        corners.push(l.test);
      } else if (l.kind === 'cards') {
        if (!prep.kp) return null;
        cards.push(l.test);
      } else if (l.kind === 'player') {
        const p = prep.players[key];
        if (!p) return null;
        scorers[p.side].push(Math.max(0, Math.min(0.95, (p.share || 0) * (p.involvement == null ? 1 : p.involvement))));
      }
    }
    let pg = 0;
    for (let i = 0; i <= MAX_GOALS; i++) {
      for (let j = 0; j <= MAX_GOALS; j++) {
        const cell = prep.sm[i][j];
        if (cell < 1e-12) continue;
        let ok = true;
        for (const t of goals) if (!t(i, j)) { ok = false; break; }
        if (!ok) continue;
        let w = cell;
        if (scorers.home.length) w *= scorersGiven(scorers.home, i);
        if (scorers.away.length) w *= scorersGiven(scorers.away, j);
        pg += w;
      }
    }
    let pc = 1;
    if (corners.length) {
      pc = 0;
      for (let h = 0; h <= MAX_CORNERS; h++) {
        for (let a = 0; a <= MAX_CORNERS; a++) {
          let ok = true;
          for (const t of corners) if (!t(h, a)) { ok = false; break; }
          if (ok) pc += prep.ch[h] * prep.ca[a];
        }
      }
    }
    let pk = 1;
    if (cards.length) {
      pk = 0;
      for (let c = 0; c <= MAX_CARDS; c++) {
        let ok = true;
        for (const t of cards) if (!t(c)) { ok = false; break; }
        if (ok) pk += prep.kp[c];
      }
    }
    return pg * pc * pk;
  }

  /**
   * The combined chance of a bet builder.
   *   raw        the model's combined chance (correlation included)
   *   product    what multiplying the legs' own chances would say (shown for comparison)
   *   chance     raw, with every leg nudged to its measured chance, then the measured bet
   *              builder calibration when one is given
   * @param {object} prep         prepare(model)
   * @param {string[]} keys
   * @param {{a:number, b:number}|null} [cal]  logit calibration of the combined chance
   */
  function joint(prep, keys, cal) {
    const raw = rawJoint(prep, keys);
    if (raw == null) return null;
    // a leg the others already make certain changes nothing, so it takes no nudge either
    // (the day's builders never hold one; "build your own" can)
    const passengers = new Set();
    if (keys.length > 1 && raw > 0) {
      let kept = keys.slice();
      for (const key of keys) {
        const rest = kept.filter((k) => k !== key);
        if (rest.length && Math.abs(rawJoint(prep, rest) - raw) < 1e-12) {
          passengers.add(key);
          kept = rest;
        }
      }
    }
    let adj = raw;
    let product = 1;
    let cap = 1;
    let measured = true;
    for (const key of keys) {
      const own = prep.legs[key];
      const r1 = rawJoint(prep, [key]);
      const c1 = own && own.chance != null ? own.chance : r1;
      if (!own || !own.measured) measured = false;
      product *= c1;
      cap = Math.min(cap, c1);
      if (!passengers.has(key) && r1 > 1e-9 && c1 != null) adj *= c1 / r1;
    }
    adj = Math.max(0, Math.min(cap, adj));
    const chance = cal && adj > 0 && adj < 1 ? calibrate(adj, cal) : adj;
    return { raw, product, chance, fairOdds: chance > 0 ? 1 / chance : null, measured };
  }

  function calibrate(p, cal) {
    const q = Math.min(0.999, Math.max(0.001, p));
    const z = cal.a + cal.b * Math.log(q / (1 - q));
    return 1 / (1 + Math.exp(-z));
  }

  /** Do these selections contradict each other (impossible together)? */
  function impossible(prep, keys) {
    const r = rawJoint(prep, keys);
    return r != null && r < 1e-9;
  }

  return { MAX_GOALS, MAX_CORNERS, MAX_CARDS, scoreMatrix, nbPmf, legOf, prepare, rawJoint, joint, calibrate, scorersGiven, impossible };
});
