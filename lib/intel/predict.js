'use strict';

/**
 * intel/predict.js — v6 probabilities for one fixture, from its factors.
 *
 * With a bookmaker price (the normal case):
 *   result   the de-vigged 1X2 price adjusted by the factor model (lib/factors/models/result.json)
 *   over25   the de-vigged Over 2.5 price adjusted by the factor model
 *   btts     the price-implied BTTS adjusted by the factor model
 *   -> one Dixon-Coles score matrix solved to match the adjusted 1X2 and Over 2.5, so every
 *      market (double chance, totals, team goals, handicaps, exact scores) is consistent
 *
 * Without a price:
 *   goals_h / goals_a  expected goals from the factors alone (Poisson models)
 *   result_nomkt       H/D/A from the factors alone
 *   -> the matrix is solved to the factor-only 1X2 with the factor-only total
 *
 * Every probability also has a "price only" twin (the same matrix built from the market
 * alone), so the decision layer can see exactly where the factors disagree with the price.
 * Measured on held-out seasons: research/v6/RESULTS.md.
 */

const fs = require('fs');
const path = require('path');
const G = require('../factors/gbm');
const M = require('../model');
const MK = require('../market');

const DIR = process.env.SHARPSHOOTER_V6_MODELS || path.join(__dirname, '..', 'factors', 'models');
const cache = {};
function model(name) {
  if (cache[name] !== undefined) return cache[name];
  try {
    cache[name] = JSON.parse(fs.readFileSync(path.join(DIR, `${name}.json`), 'utf8'));
  } catch {
    cache[name] = null;
  }
  return cache[name];
}
function available() {
  return ['result', 'over25', 'btts', 'goals_h', 'goals_a', 'result_nomkt'].filter((n) => model(n));
}

/** Probabilities for every candidate market from one score matrix. */
function marketsFromMatrix(sm) {
  const S = (f) => M.sumIf(sm, f);
  const p1 = S((a, b) => a > b);
  const pX = S((a, b) => a === b);
  const p2 = 1 - p1 - pX;
  const out = {
    '1': p1, X: pX, '2': p2,
    '1X': p1 + pX, X2: pX + p2, '12': p1 + p2,
    DNB_H: p1 / (p1 + p2), DNB_A: p2 / (p1 + p2),
    BTTS_Y: S((a, b) => a > 0 && b > 0),
  };
  out.BTTS_N = 1 - out.BTTS_Y;
  for (const l of [0.5, 1.5, 2.5, 3.5, 4.5]) {
    const o = S((a, b) => a + b > l);
    out[`O${l}`] = o;
    out[`U${l}`] = 1 - o;
  }
  for (const l of [0.5, 1.5, 2.5]) {
    const h = S((a) => a > l);
    const a2 = S((_a, b) => b > l);
    out[`TTH_O${l}`] = h;
    out[`TTH_U${l}`] = 1 - h;
    out[`TTA_O${l}`] = a2;
    out[`TTA_U${l}`] = 1 - a2;
  }
  // Asian handicap, v4 key convention: the key carries the HOME line; AH_A_<line> is the away
  // side of that line. Whole lines push, so the probability is win-given-no-push (as v4).
  for (const line of [-1.5, -1, 1, 1.5]) {
    const win = S((a, b) => a - b + line > 1e-4);
    const lose = S((a, b) => a - b + line < -1e-4);
    const dec = win + lose;
    if (dec > 0) {
      out[`AH_H_${line}`] = win / dec;
      out[`AH_A_${line}`] = lose / dec;
    }
  }
  return out;
}

const clampLam = (v) => Math.min(5, Math.max(0.12, v));

function matrixFrom(p1x2, pOver, priorTotal) {
  const sol = MK.solveLambdas(
    { home: p1x2[0], draw: p1x2[1], away: p1x2[2] },
    pOver != null ? { line: 2.5, over: pOver } : null,
    { priorTotal: priorTotal || 2.6 },
  );
  if (!sol) return null;
  const lamH = clampLam(sol.lamH);
  const lamA = clampLam(sol.lamA);
  return { lamH, lamA, sm: M.scoreMatrix(lamH, lamA, MK.rhoFor(lamH + lamA)) };
}

/** Top contributions of one model output, by feature (raw-score units). */
function contributions(mdl, feats, cls) {
  if (!mdl) return null;
  const e = G.explain(mdl, feats);
  const c = e.contrib[cls || 0];
  if (mdl.numClass > 1) {
    // a class's pull relative to the other classes (what actually moves its probability)
    const others = e.contrib.filter((_, i) => i !== cls);
    const out = {};
    for (const k of new Set([...Object.keys(c), ...others.flatMap((o) => Object.keys(o))])) {
      out[k] = (c[k] || 0) - others.reduce((a, o) => a + (o[k] || 0), 0) / others.length;
    }
    return out;
  }
  return { ...c };
}

/**
 * @param {Object<string, number|null>} f   factor values (lib/factors/features.compute) + `divc`
 * @returns {null | {
 *   source:'market+factors'|'factors', p:Object<string,number>, base:Object<string,number>|null,
 *   lamH:number, lamA:number, sm:object, pRes:number[], pO25:number|null, pBtts:number|null,
 *   explain:{result:object, over25:object|null, btts:object|null}
 * }}
 */
function predict(f) {
  const hasMkt = f.p1 != null && f.pX != null && f.p2 != null;
  const prior = f.lgGoals || 2.6;
  if (hasMkt && model('result')) {
    const base1x2 = [f.p1, f.pX, f.p2];
    const pRes = G.predict(model('result'), f, base1x2);
    let pO = null;
    if (f.pO25 != null && model('over25')) pO = G.predict(model('over25'), f, f.pO25);
    // no Over/Under price: the total comes from the factor-only goal models (or the league)
    let priorTotal = prior;
    if (pO == null && model('goals_h') && model('goals_a')) priorTotal = G.predict(model('goals_h'), f) + G.predict(model('goals_a'), f);
    const fin = matrixFrom(pRes, pO, priorTotal);
    const baseM = matrixFrom(base1x2, f.pO25, f.lamT || prior);
    if (!fin) return null;
    const p = marketsFromMatrix(fin.sm);
    // BTTS: the dedicated model (held-out log-loss 0.6843 vs 0.6853 for the price matrix and
    // 0.6859 for the v6 matrix), so BTTS Yes/No take its probability
    let pB = null;
    if (model('btts') && f.lamH != null && f.lamA != null) {
      const b0 = (1 - Math.exp(-f.lamH)) * (1 - Math.exp(-f.lamA));
      pB = G.predict(model('btts'), f, b0);
      p.BTTS_Y = pB;
      p.BTTS_N = 1 - pB;
    }
    return {
      source: 'market+factors',
      p,
      base: baseM ? marketsFromMatrix(baseM.sm) : null,
      lamH: fin.lamH,
      lamA: fin.lamA,
      sm: fin.sm,
      pRes,
      pO25: pO != null ? pO : p['O2.5'],
      pBtts: pB,
      explain: {
        result: { home: contributions(model('result'), f, 0), draw: contributions(model('result'), f, 1), away: contributions(model('result'), f, 2) },
        over25: pO != null ? contributions(model('over25'), f, 0) : null,
        btts: pB != null ? contributions(model('btts'), f, 0) : null,
      },
    };
  }
  // ---- no price: factors alone
  if (!model('goals_h') || !model('goals_a')) return null;
  const lh = G.predict(model('goals_h'), f);
  const la = G.predict(model('goals_a'), f);
  let fin;
  let pRes = null;
  if (model('result_nomkt')) {
    pRes = G.predict(model('result_nomkt'), f);
    fin = matrixFrom(pRes, null, lh + la);
  }
  if (!fin) {
    const lamH = clampLam(lh);
    const lamA = clampLam(la);
    fin = { lamH, lamA, sm: M.scoreMatrix(lamH, lamA, MK.rhoFor(lamH + lamA)) };
  }
  const p = marketsFromMatrix(fin.sm);
  return {
    source: 'factors',
    p,
    base: null,
    lamH: fin.lamH,
    lamA: fin.lamA,
    sm: fin.sm,
    pRes: pRes || [p['1'], p.X, p['2']],
    pO25: p['O2.5'],
    pBtts: null,
    explain: {
      result: model('result_nomkt')
        ? { home: contributions(model('result_nomkt'), f, 0), draw: contributions(model('result_nomkt'), f, 1), away: contributions(model('result_nomkt'), f, 2) }
        : null,
      over25: null,
      btts: null,
      goals: { home: contributions(model('goals_h'), f, 0), away: contributions(model('goals_a'), f, 0) },
    },
  };
}

module.exports = { predict, marketsFromMatrix, matrixFrom, model, available, contributions, DIR };
