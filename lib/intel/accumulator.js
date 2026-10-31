'use strict';

/**
 * intel/accumulator.js — the double-confirmed accumulator.
 *
 * A selection becomes an accumulator LEG only when two independent layers agree on it:
 *
 *   1. METHODOLOGY  it qualifies under one of the market methodologies (status LOCK or
 *                   PREDICT — never PAPER, WATCH or REMOVE), and
 *   2. NORMAL (v6)  the normal prediction says the same thing:
 *                     main    it IS the v6 main pick
 *                     call    it matches the normal prediction's calls — its result call,
 *                             its Over/Under 2.5 call, its BTTS call (normal says Over 2.5 and
 *                             the Over 2.5 methodology qualifies) — and v6 rates it 60%+
 *                     safer   it is a safer form of the v6 main pick (normal says Home win and
 *                             Double Chance 1X qualifies), rated 60%+
 *                   and the v6 layer does not flag it as overrated by the price (trap) or
 *                   list it under "avoid".
 *
 * Never in an accumulator: correct scores, draws (half-stake singles), paper markets, a
 * methodology whose own rules cap its legs below the accumulator's size, two legs from
 * one match, a match that has kicked off.
 *
 * From the legs it builds the best double, treble, four-fold and five-fold: the most likely
 * legs, one per match. Leg probabilities are the v6 (calibrated) ones; legs are treated as
 * independent, which holds for different matches. The measured record of exactly this rule
 * on held-out seasons is lib/intel/acca_record.json (research/v6/acca_study.js).
 */

const D = require('./decision');

const EXCLUDED_METHODS = new Set(['draw', 'correctScore', 'gg2']);
const ACCA_CHECKLIST = 0.85;
const SIZES = [2, 3, 4, 5];
const MIN_LEG_PROB = 0.6; // the normal prediction must rate a leg at least this likely

let RECORD = null;
function record() {
  if (RECORD) return RECORD;
  try {
    RECORD = require('./acca_record.json');
  } catch {
    RECORD = null;
  }
  return RECORD;
}

/** Does the v6 main pick `main` guarantee the methodology selection `key`? */
function saferForm(main, key) {
  if (!main) return false;
  if (D.implies(main, key)) return true;
  const AH = {
    '1': ['AH_H_1', 'AH_H_1.5'],
    '2': ['AH_A_-1', 'AH_A_-1.5'],
    '1X': ['AH_H_1', 'AH_H_1.5'],
    X2: ['AH_A_-1', 'AH_A_-1.5'],
    DNB_H: ['AH_H_1', 'AH_H_1.5'],
    DNB_A: ['AH_A_-1', 'AH_A_-1.5'],
    'AH_H_-1.5': ['1', '1X', 'DNB_H', 'AH_H_-1', 'O1.5', 'TTH_O0.5', 'TTH_O1.5'],
    'AH_A_1.5': ['2', 'X2', 'DNB_A', 'AH_A_1', 'O1.5', 'TTA_O0.5', 'TTA_O1.5'],
  };
  return (AH[main] || []).includes(key);
}

/**
 * The normal prediction's own calls: most likely result, Over/Under 2.5 side, BTTS side.
 * @param {Object<string,number>} p  v6 probabilities
 */
function callsOf(p) {
  const res = [['1', p['1']], ['X', p.X], ['2', p['2']]].sort((a, b) => b[1] - a[1])[0][0];
  return {
    result: res,
    goals: p['O2.5'] != null ? (p['O2.5'] >= 0.5 ? 'O2.5' : 'U2.5') : null,
    btts: p.BTTS_Y != null ? (p.BTTS_Y >= 0.5 ? 'BTTS_Y' : 'BTTS_N') : null,
  };
}

/** Is a selection consistent with the normal prediction's calls? */
function consistent(key, calls) {
  let m;
  const r = calls.result;
  if (key === '1' || key === 'DNB_H') return r === '1';
  if (key === '2' || key === 'DNB_A') return r === '2';
  if (key === '1X') return r !== '2';
  if (key === 'X2') return r !== '1';
  if (key === '12') return r !== 'X';
  if ((m = /^AH_H_(-?\d+(?:\.\d+)?)$/.exec(key))) return Number(m[1]) <= 0 ? r === '1' : r !== '2';
  if ((m = /^AH_A_(-?\d+(?:\.\d+)?)$/.exec(key))) return Number(m[1]) >= 0 ? r === '2' : r !== '1';
  if (key === 'O2.5' || key === 'O3.5' || key === 'O4.5') return calls.goals === 'O2.5';
  if (key === 'U2.5' || key === 'U1.5') return calls.goals === 'U2.5';
  if (key === 'BTTS_Y') return calls.btts === 'BTTS_Y';
  if (key === 'BTTS_N') return calls.btts === 'BTTS_N';
  return true; // lower / higher lines and team totals carry no call of their own: the probability decides
}

/**
 * How a methodology selection relates to the normal (v6) prediction, or null if it does not pass.
 * @param {string} key
 * @param {{main:string|null, safer:string|null, avoid:Set<string>, p:Object, base:Object|null}} n
 * @param {{minProb?:number, trapShift?:number}} [o]
 */
function agreementOf(key, n, o = {}) {
  const minProb = o.minProb != null ? o.minProb : MIN_LEG_PROB;
  const trapShift = o.trapShift != null ? o.trapShift : D.DEFAULTS.trapShift;
  const prob = n.p[key];
  if (prob == null || n.avoid.has(key)) return null;
  const base = n.base ? n.base[key] : null;
  if (base != null && prob - base <= trapShift) return null; // the factors say the price overrates it
  if (key === n.main) return 'main';
  if (key === n.safer || saferForm(n.main, key)) return prob >= minProb ? 'safer' : null;
  if (prob >= minProb && consistent(key, callsOf(n.p))) return 'call';
  return null;
}

/**
 * Legs from a day's analysed fixtures.
 * @param {object[]} reports  engine reports (methodology + intel)
 * @param {{now?:number}} [o]
 */
function legsFrom(reports, o = {}) {
  const now = o.now || Date.now();
  const legs = [];
  for (const r of reports || []) {
    if (!r || !r.analysable || !r.methodology || !r.intel || !r.intel.available) continue;
    const m = r.match;
    if (m.state && m.state !== 'pre') continue;
    if (m.date && Date.parse(m.date) <= now) continue;
    const dec = r.intel.decision || {};
    const normal = {
      main: dec.main ? dec.main.key : null,
      safer: dec.safer ? dec.safer.key : null,
      avoid: new Set((dec.avoid || []).map((a) => a.key)),
      p: r.intel.probs || {},
      base: r.intel.base || null,
    };
    const calls = callsOf(normal.p);
    const cands = [];
    for (const p of r.methodology.predictions || []) {
      if (!p || !p.pick || !p.pick.key) continue;
      if (p.status !== 'LOCK' && p.status !== 'PREDICT') continue;
      if (p.paperOnly || EXCLUDED_METHODS.has(p.id) || /^CS_/.test(p.pick.key)) continue;
      // the accumulator keeps the checklist bar its record was measured with (research/v6/acca_study.js):
      // methodologies qualify at 0.70 since v5.1, the accumulator's legs still need 0.85
      if (p.checklist && p.checklist.ratio != null && p.checklist.ratio < ACCA_CHECKLIST - 1e-9) continue;
      const key = p.pick.key;
      const agreement = agreementOf(key, normal, o);
      if (!agreement) continue;
      const prob = normal.p[key];
      const base = normal.base ? normal.base[key] : null;
      const mk = (r.markets || []).find((x) => x.key === key);
      const best = mk && mk.v5price && mk.v5price.best ? mk.v5price.best : null;
      cands.push({
        fixtureId: m.id,
        league: m.league,
        leagueName: m.leagueName || null,
        kickoff: m.date,
        home: m.home.name,
        away: m.away.name,
        key,
        label: D.label(key, m.home.name, m.away.name),
        agreement,
        methodology: { id: p.id, name: p.name, status: p.status, prob: p.prob, maxLegs: p.maxLegs || null },
        normal: {
          main: dec.main ? { key: normal.main, label: dec.main.label, prob: dec.main.prob } : null,
          calls: { result: D.label(calls.result, m.home.name, m.away.name), goals: calls.goals ? D.label(calls.goals) : null, btts: calls.btts ? D.label(calls.btts) : null },
          confidence: dec.confidence ? dec.confidence.level : null,
        },
        prob,
        base,
        shift: base != null ? prob - base : null,
        fair: 1 / prob,
        takeAt: Math.max(1.05, 1.02 / prob),
        best: best ? best.price : null,
        bestBook: best ? best.book : null,
      });
    }
    // one leg per match: the strongest double-confirmed selection
    cands.sort((a, b) => rank(b) - rank(a));
    if (cands[0]) legs.push(cands[0]);
  }
  legs.sort((a, b) => rank(b) - rank(a));
  return legs;
}

/** Leg ordering: probability first; a LOCK and an exact agreement break near-ties. */
function rank(l) {
  return l.prob + (l.methodology.status === 'LOCK' ? 0.005 : 0) + (l.agreement === 'main' ? 0.003 : 0);
}

/**
 * The best accumulator of each size from the legs.
 * @returns {{legs:object[], options:object[], rules:string[], record:object|null}}
 */
function build(legs, o = {}) {
  const sizes = o.sizes || SIZES;
  const options = [];
  for (const k of sizes) {
    const pick = [];
    for (const l of legs) {
      if (pick.length >= k) break;
      if (l.methodology.maxLegs && l.methodology.maxLegs < k) continue;
      pick.push(l);
    }
    if (pick.length < k) continue;
    const prob = pick.reduce((a, l) => a * l.prob, 1);
    const allPriced = pick.every((l) => l.best);
    const bestOdds = allPriced ? pick.reduce((a, l) => a * l.best, 1) : null;
    const takeAt = pick.reduce((a, l) => a * l.takeAt, 1);
    const rec = record();
    const measured = rec && rec.sizes && rec.sizes[String(k)] ? rec.sizes[String(k)] : null;
    options.push({
      size: k,
      name: { 2: 'Double', 3: 'Treble', 4: 'Four-fold', 5: 'Five-fold' }[k] || `${k}-fold`,
      legs: pick,
      prob,
      fairOdds: 1 / prob,
      bestOdds,
      takeAt,
      value: bestOdds ? bestOdds * prob - 1 : null,
      measured,
    });
  }
  // the recommended option: the biggest whose chance stays at or above 40%
  let rec = null;
  for (const op of options) if (op.prob >= 0.4) rec = op.size;
  if (rec == null && options.length) rec = options[0].size;
  for (const op of options) op.recommended = op.size === rec;
  return {
    legs,
    options,
    rules: [
      'Every leg qualifies under a methodology (LOCK or PREDICT) AND the normal prediction agrees: it is the normal main pick, a safer form of it, or matches its result / goals / BTTS call at 60%+.',
      'Nothing the normal prediction flags as a bookmaker trap, no draws, no correct scores, no paper markets.',
      'One leg per match; legs from different matches are treated as independent.',
      'Bookmaker margins multiply in an accumulator: only take it at or above the "take at" price.',
    ],
    record: record(),
  };
}

function forReports(reports, o) {
  return build(legsFrom(reports, o), o);
}

module.exports = { legsFrom, build, forReports, saferForm, rank, callsOf, consistent, agreementOf, SIZES, EXCLUDED_METHODS, MIN_LEG_PROB };
