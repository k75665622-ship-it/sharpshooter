'use strict';

/**
 * ensemble.js — combine every model component into one score matrix, then
 * calibrate the probabilities the methodologies read.
 *
 * Components (any may be missing; weights renormalise over what exists):
 *   market   expected goals implied by the multi-book consensus price (lib/market.js)
 *   ratings  time-decayed Dixon-Coles ratings on verified results (lib/ratings.js)
 *   xg       the xG/xGA season formula (lib/model.js estimateLambdas)
 *   elo      ClubElo strength gap converted to goals
 *
 * Weights and calibration come from lib/calibration.json, which is produced by the
 * research scripts on 46,121 real fixtures (fitted 2019-23, verified 2023-26):
 *
 *   - With a book price, the market gets 90% of the weight. The measured optimum
 *     was 100%; the 10% model share costs ~0.05% log-loss and keeps the forecast
 *     responsive to verified information a price may not carry yet.
 *   - Without a price, ratings 30% / xG 35% / Elo 35% (renormalised).
 *
 * Every market leaves here with THREE probabilities:
 *   prob       calibrated ensemble — "how likely is this to happen" (drives floors)
 *   modelProb  calibrated model-only — the independent witness (Rule 13 / 16)
 *   rawProb    uncalibrated ensemble, kept for transparency
 */

const M = require('./model');
const MK = require('./market');
// Research runs can point at a calibration fitted on tuning seasons only, so held-out
// numbers stay genuinely out-of-sample (see research/README.md).
const CAL = process.env.SHARPSHOOTER_CALIBRATION
  ? JSON.parse(require('fs').readFileSync(process.env.SHARPSHOOTER_CALIBRATION, 'utf8'))
  : require('./calibration.json');

const sig = (x) => 1 / (1 + Math.exp(-x));
const logit = (p) => {
  const q = Math.min(0.999, Math.max(0.001, p));
  return Math.log(q / (1 - q));
};

/** Calibrated probability for `key` under parameter set `set` ('withMarket' | 'modelOnly'). */
function calibrate(set, key, p) {
  if (p == null || !Number.isFinite(p)) return p;
  const c = CAL.calibration[set] && CAL.calibration[set][key];
  return c ? sig(c.a + c.b * logit(p)) : p;
}

/** Elo difference (home minus away, raw ratings) -> λ pair around a total. */
function eloLambdas(eloDiff, total) {
  if (eloDiff == null || !Number.isFinite(eloDiff) || !(total > 0)) return null;
  const s = Math.exp((CAL.elo.k * (eloDiff + CAL.elo.homeAdv)) / 400);
  return { lamH: (total / 2) * s, lamA: total / 2 / s };
}

function geo(parts) {
  let lh = 0;
  let la = 0;
  let w = 0;
  for (const p of parts) {
    if (!p || !(p.w > 0) || !(p.lamH > 0) || !(p.lamA > 0)) continue;
    lh += p.w * Math.log(p.lamH);
    la += p.w * Math.log(p.lamA);
    w += p.w;
  }
  return w > 0 ? { lamH: Math.exp(lh / w), lamA: Math.exp(la / w), weight: w } : null;
}

/**
 * @param {object} c
 * @param {{lamH:number, lamA:number, books?:number, rms?:number}|null} c.market
 * @param {{lamH:number, lamA:number, confidence?:number}|null} c.ratings
 * @param {{lamH:number, lamA:number}|null} c.xg
 * @param {number|null} c.eloDiff   raw home Elo minus away Elo (home advantage added here)
 * @returns {null | Ensemble}
 */
function combine(c) {
  const W = CAL.weights.model;
  // Elo needs a total; take it from the other model components (never from the market,
  // so the model-only witness stays independent of the price).
  const base = geo([
    c.ratings ? { ...c.ratings, w: 1 } : null,
    c.xg ? { ...c.xg, w: 1 } : null,
  ]);
  const elo = base ? eloLambdas(c.eloDiff, base.lamH + base.lamA) : null;

  const modelParts = [
    c.ratings ? { name: 'ratings', ...c.ratings, w: W.ratings * (c.ratings.confidence != null ? 0.5 + 0.5 * c.ratings.confidence : 1) } : null,
    c.xg ? { name: 'xg', ...c.xg, w: W.xg } : null,
    elo ? { name: 'elo', ...elo, w: W.elo } : null,
  ].filter(Boolean);
  const model = geo(modelParts);
  const market = c.market && c.market.lamH > 0 && c.market.lamA > 0 ? c.market : null;
  if (!model && !market) return null;

  let final;
  const share = CAL.weights.marketShare;
  if (market && model) {
    final = geo([{ ...market, w: share }, { ...model, w: 1 - share }]);
  } else if (market) {
    final = { lamH: market.lamH, lamA: market.lamA };
  } else {
    final = { lamH: model.lamH, lamA: model.lamA };
  }

  const lamH = M.clamp(final.lamH, 0.12, 5);
  const lamA = M.clamp(final.lamA, 0.12, 5);
  const sm = M.scoreMatrix(lamH, lamA, MK.rhoFor(lamH + lamA));
  const modelSm = model ? M.scoreMatrix(model.lamH, model.lamA, MK.rhoFor(model.lamH + model.lamA)) : null;

  // Agreement between independent witnesses: the spread of their goal-supremacy reads.
  const sup = (p) => p.lamH - p.lamA;
  const witnesses = [...modelParts.map((p) => ({ name: p.name, sup: sup(p), total: p.lamH + p.lamA }))];
  if (market) witnesses.push({ name: 'market', sup: sup(market), total: market.lamH + market.lamA });
  const sups = witnesses.map((w) => w.sup);
  const tots = witnesses.map((w) => w.total);
  const agreement = witnesses.length >= 2
    ? { supremacySpread: Math.max(...sups) - Math.min(...sups), totalSpread: Math.max(...tots) - Math.min(...tots), witnesses }
    : { supremacySpread: null, totalSpread: null, witnesses };

  return {
    lamH,
    lamA,
    sm,
    model: model ? { lamH: model.lamH, lamA: model.lamA } : null,
    modelSm,
    market: market ? { lamH: market.lamH, lamA: market.lamA, books: market.books || null } : null,
    components: {
      market: market ? { lamH: market.lamH, lamA: market.lamA } : null,
      ratings: c.ratings ? { lamH: c.ratings.lamH, lamA: c.ratings.lamA, confidence: c.ratings.confidence } : null,
      xg: c.xg ? { lamH: c.xg.lamH, lamA: c.xg.lamA } : null,
      elo: elo ? { lamH: elo.lamH, lamA: elo.lamA } : null,
    },
    weights: {
      market: market ? (model ? share : 1) : 0,
      model: model ? (market ? 1 - share : 1) : 0,
      parts: Object.fromEntries(modelParts.map((p) => [p.name, p.w])),
    },
    calibrationSet: market ? 'withMarket' : 'modelOnly',
    agreement,
  };
}

/** Score matrix with the draw diagonal inflated (exact-score work only; see research/score_study.js). */
function scoreGrid(lamH, lamA) {
  const sm = M.scoreMatrix(lamH, lamA, CAL.score.rho);
  const k = CAL.score.drawInflation;
  let z = 0;
  for (let i = 0; i <= M.MAX_GOALS; i++) for (let j = 0; j <= M.MAX_GOALS; j++) {
    if (i === j) sm.m[i][j] *= k;
    z += sm.m[i][j];
  }
  for (let i = 0; i <= M.MAX_GOALS; i++) for (let j = 0; j <= M.MAX_GOALS; j++) sm.m[i][j] /= z;
  return sm;
}

/** Raw probabilities from a matrix for the calibrated keys. */
function rawKeyProbs(sm) {
  const S = (f) => M.sumIf(sm, f);
  return {
    '1': S((a, b) => a > b),
    X: S((a, b) => a === b),
    '2': S((a, b) => a < b),
    'O0.5': S((a, b) => a + b > 0.5),
    'O1.5': S((a, b) => a + b > 1.5),
    'O2.5': S((a, b) => a + b > 2.5),
    'O3.5': S((a, b) => a + b > 3.5),
    'O4.5': S((a, b) => a + b > 4.5),
    BTTS_Y: S((a, b) => a > 0 && b > 0),
    GG2P: S((a, b) => a >= 2 && b >= 2),
    'TTH_O0.5': S((a) => a >= 1),
    'TTH_O1.5': S((a) => a >= 2),
    'TTH_O2.5': S((a) => a >= 3),
    'TTA_O0.5': S((_a, b) => b >= 1),
    'TTA_O1.5': S((_a, b) => b >= 2),
    'TTA_O2.5': S((_a, b) => b >= 3),
    WIN2: S((a, b) => Math.abs(a - b) >= 2),
  };
}

/** Calibrated key probabilities (1X2 renormalised so it still sums to one). */
function calibratedKeyProbs(sm, set) {
  const r = rawKeyProbs(sm);
  const out = {};
  for (const [k, p] of Object.entries(r)) out[k] = calibrate(set, k, p);
  const z = out['1'] + out.X + out['2'];
  out['1'] /= z;
  out.X /= z;
  out['2'] /= z;
  return { raw: r, cal: out };
}

/**
 * Derive every market from the ensemble matrix and attach calibrated probabilities.
 * Keeps the v4 market list (keys, labels, groups) so every consumer keeps working,
 * and adds GG2P (both teams 2+) as a first-class market.
 */
function deriveMarkets(ens) {
  const markets = M.deriveMarkets(ens.sm);
  const E = calibratedKeyProbs(ens.sm, ens.calibrationSet);
  const Mo = ens.modelSm ? calibratedKeyProbs(ens.modelSm, 'modelOnly') : null;
  const modelRawAll = ens.modelSm ? M.deriveMarkets(ens.modelSm) : null;
  const modelRawByKey = modelRawAll ? Object.fromEntries(modelRawAll.map((m) => [m.key, m.prob])) : {};

  // GG/NG 2+ as a real market
  markets.push({ key: 'GG2P', label: 'GG/NG 2+ — Yes', group: 'GG/NG 2+', prob: E.raw.GG2P, fairOdds: 1 / E.raw.GG2P });
  markets.push({ key: 'GG2N', label: 'GG/NG 2+ — No', group: 'GG/NG 2+', prob: 1 - E.raw.GG2P, fairOdds: 1 / (1 - E.raw.GG2P) });

  const calOf = (key, P) => {
    if (!P) return null;
    const c = P.cal;
    let m;
    switch (true) {
      case key === '1' || key === 'X' || key === '2': return c[key];
      case key === '1X': return c['1'] + c.X;
      case key === '12': return c['1'] + c['2'];
      case key === 'X2': return c.X + c['2'];
      case key === 'DNB_H': return c['1'] / (c['1'] + c['2']);
      case key === 'DNB_A': return c['2'] / (c['1'] + c['2']);
      case key === 'BTTS_Y': return c.BTTS_Y;
      case key === 'BTTS_N': return 1 - c.BTTS_Y;
      case key === 'GG2P': return c.GG2P;
      case key === 'GG2N': return 1 - c.GG2P;
      case (m = /^([OU])(\d\.5)$/.exec(key)) !== null: {
        const o = c[`O${m[2]}`];
        return o == null ? null : m[1] === 'O' ? o : 1 - o;
      }
      case (m = /^TT([HA])_([OU])(\d\.5)$/.exec(key)) !== null: {
        const o = c[`TT${m[1]}_O${m[3]}`];
        return o == null ? null : m[2] === 'O' ? o : 1 - o;
      }
      default: return null;
    }
  };

  for (const mk of markets) {
    const raw = mk.prob;
    const cal = calOf(mk.key, E);
    mk.rawProb = raw;
    mk.prob = cal != null && Number.isFinite(cal) ? cal : raw;
    mk.fairOdds = 1 / mk.prob;
    const mcal = calOf(mk.key, Mo);
    mk.modelProb = mcal != null ? mcal : modelRawByKey[mk.key] != null ? modelRawByKey[mk.key] : null;
    mk.calibrated = cal != null;
  }
  return markets;
}

module.exports = { combine, deriveMarkets, calibrate, calibratedKeyProbs, rawKeyProbs, eloLambdas, scoreGrid, CAL };
