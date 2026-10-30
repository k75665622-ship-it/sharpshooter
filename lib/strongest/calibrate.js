'use strict';

/**
 * strongest/calibrate.js — the measured models behind the Strongest Picks.
 *
 * Every number comes from lib/strongest/models.json, written by research/v6/strongest_fit.js
 * from a walk-forward replay of this section on 2019-2026 football-data.co.uk matches
 * (research/v6/strongest_study.js). Methods were chosen on 2019-07..2023-06 and checked once on
 * 2023-07 onwards; the production file is then refitted on every season.
 *
 *   goalChance(key, views)   one honest chance for a goal-based selection from its views
 *                            (market, stats, factors, possession): per-market logistic
 *                            calibration, so each view gets the weight it earned on past matches
 *   cornerMeans(input)       expected corners per side from the teams' corner form, the
 *                            bookmakers' read of the match (strength gap, expected goals) and
 *                            the possession model's shot volume (lib/pace.js)
 *   cardMean(input)          expected cards from card form, head-to-head, the price
 *                            (lopsided games are booked less) and the match's expected tempo
 *   statsChance(key, p)      a corner or card line's measured chance from the model's figure
 *
 * Pure apart from reading the JSON once. A missing or partial file degrades to the raw
 * figures, and the pick rules then refuse what cannot be measured.
 */

const fs = require('fs');
const path = require('path');

const FILE = process.env.SHARPSHOOTER_STRONGEST_MODELS || path.join(__dirname, 'models.json');
let MODELS = null;

function models() {
  if (MODELS === null) {
    try {
      MODELS = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    } catch {
      MODELS = {};
    }
  }
  return MODELS;
}

const sig = (x) => 1 / (1 + Math.exp(-x));
const logit = (p) => {
  const q = Math.min(0.999, Math.max(0.001, p));
  return Math.log(q / (1 - q));
};
const L = (v) => Math.log(Math.max(1e-6, v));

/** Market family of a selection key (how the calibration and the record group it). */
function family(key) {
  let m;
  if ((m = /^TT([HA])_([OU])(\d\.5)$/.exec(key))) return `TT_${m[2]}${m[3]}`;
  if (/^C[HA]_O/.test(key)) return 'C_TEAM_O';
  if (/^C_MOST/.test(key)) return 'C_MOST';
  if ((m = /^C_([OU])/.exec(key))) return `C_${m[1]}`;
  if ((m = /^K_([OU])/.exec(key))) return `K_${m[1]}`;
  if (key === '1X' || key === 'X2') return 'DC';
  if (key === '1' || key === '2') return 'WIN';
  return key;
}

/** Is there a measured calibration for this goal-based selection? */
function hasGoal(key) {
  const g = models().goals;
  return !!(g && g[key]);
}

/**
 * One honest chance from the goal views.
 * @param {string} key
 * @param {{market?:number, stats?:number, factors?:number, pace?:number}} views
 * @returns {number|null} null when the market view or the calibration is missing
 */
function goalChance(key, views) {
  const c = models().goals && models().goals[key];
  if (!c || views.market == null) return null;
  const lm = logit(views.market);
  const dev = (v) => (v != null ? logit(v) - lm : 0); // a missing view counts as agreeing with the price
  return sig(c.a + c.b * lm + c.c * dev(views.factors) + c.d * dev(views.stats) + (c.e || 0) * dev(views.pace));
}

/** How far the possession model's shot volume sits from the league (log ratios; 0 = unknown). */
function volumeTerms(pace) {
  if (!pace || !pace.home || !pace.away) return { home: [0, 0], away: [0, 0], shots: 0 };
  const H = pace.home;
  const A = pace.away;
  const b = pace.base;
  const shots = b && b.home && b.away
    ? L((b.home.shots * (H.attack + A.defence) / 2 + b.away.shots * (A.attack + H.defence) / 2) / (b.home.shots + b.away.shots))
    : 0;
  return { home: [L(H.attack), L(A.defence)], away: [L(A.attack), L(H.defence)], shots };
}

/**
 * Expected corners for both sides, form and price together.
 * @param {object} x
 * @param {{home:number, away:number}} x.base  league corners per match won at home / away
 * @param {{att:number, def:number}} x.seasonH  home side, last 20 (lib/strongest/inputs cornerRates)
 * @param {{att:number, def:number}} x.seasonA
 * @param {{att:number, def:number}} x.recentH  last 6
 * @param {{att:number, def:number}} x.recentA
 * @param {{home:number, away:number}} x.lam    the bookmakers' expected goals
 * @param {object} [x.pace]  lib/pace.js lambdas() with its league base: shot volume
 * @returns {{home:number, away:number, r:number}|null}
 */
function cornerMeans(x) {
  const m = models().corners;
  if (!m || !m.coef || !x || !x.lam || !(x.lam.home > 0) || !(x.lam.away > 0)) return null;
  const b = m.coef;
  const sup = L(x.lam.home / x.lam.away);
  const tot = L((x.lam.home + x.lam.away) / 2.6);
  const v = volumeTerms(x.pace);
  const side = (base, own, opp, ownR, oppR, venue, gap, vol) => Math.exp(
    L(base) + (venue === 'H' ? b.home : b.away)
    + b.seasonAtt * L(own.att) + b.oppSeasonDef * L(opp.def)
    + b.recentAtt * L(ownR.att) + b.oppRecentDef * L(oppR.def)
    + b.priceStrengthGap * gap + b.priceTotal * tot
    + (b.shotVolume || 0) * vol[0] + (b.oppShotsConceded || 0) * vol[1],
  );
  return {
    home: side(x.base.home, x.seasonH, x.seasonA, x.recentH, x.recentA, 'H', sup, v.home),
    away: side(x.base.away, x.seasonA, x.seasonH, x.recentA, x.recentH, 'A', -sup, v.away),
    r: m.dispersion,
  };
}

/**
 * Expected cards in the match.
 * @param {object} x
 * @param {{home:number, away:number}} x.base   league cards per match by the home / away side
 * @param {number} x.seasonRate  form ratios (lib/strongest/inputs cardRate .rate), home and away
 * @param {{home:number, away:number}} x.season
 * @param {{home:number, away:number}} x.recent
 * @param {number} x.h2h          head-to-head factor (1 = none)
 * @param {number} [x.referee]    referee factor (1 = unknown); not in the archive, applied on top
 * @param {{home:number, away:number}} x.lam
 * @param {object} [x.pace]  lib/pace.js lambdas() with its league base: the match's tempo
 * @returns {{mu:number, r:number}|null}
 */
function cardMean(x) {
  const m = models().cards;
  if (!m || !m.coef || !x || !x.lam || !(x.lam.home > 0) || !(x.lam.away > 0)) return null;
  const b = m.coef;
  const base = x.base.home + x.base.away;
  const seasonRatio = (x.base.home * x.season.home + x.base.away * x.season.away) / base;
  const recentRatio = (x.base.home * x.recent.home + x.base.away * x.recent.away) / base;
  const mu = Math.exp(
    L(base) + b.intercept + b.seasonForm * L(seasonRatio) + b.recentForm * L(recentRatio)
    + b.h2h * L(x.h2h || 1) + b.priceMismatch * Math.abs(L(x.lam.home / x.lam.away))
    + b.priceTotal * L((x.lam.home + x.lam.away) / 2.6)
    + (b.expectedShots || 0) * volumeTerms(x.pace).shots,
  ) * (x.referee || 1);
  return { mu, r: m.dispersion };
}

/** A corner or card line's measured chance from the model's own figure. */
function statsChance(key, p) {
  if (p == null) return null;
  const c = models().stats && models().stats[family(key)];
  return c ? sig(c.a + c.b * logit(p)) : null;
}

/** The measured record of the rule (research/v6/strongest_report.js), for the page. */
function measured() {
  return models().measured || null;
}

function _reset(obj) {
  MODELS = obj === undefined ? null : obj;
}

module.exports = { goalChance, hasGoal, cornerMeans, cardMean, statsChance, volumeTerms, family, measured, models, _reset, FILE };
