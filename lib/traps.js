'use strict';

/**
 * traps.js — the Bookies' Trap scan for a methodology pick.
 *
 * The owner's "Bookies' Trap Avoider" protocol (Phase 8) rates every trap found on a pick as
 * Minor (-2), Medium (-5) or Major (-10). This module runs the traps the site's data can see
 * and gives each pick one verdict:
 *
 *   clear     nothing found
 *   caution   something found, total above -10: shown with the pick
 *   trap      a Major trap, or several that add up to -10: withdrawn from the day's lists and
 *             never a leg of a methodology slip
 *
 * Three sources, one list (a trap is counted once, at its worst rating):
 *   1  the engine's market screen (lib/signals.js): margin, short price, model against market,
 *      line movement, luck against xG, sample size, congestion, missing data
 *   2  the v6 layer (lib/intel): measured trap rules, "overrated by the price", cup ties,
 *      thin data, weather
 *   3  checks from the protocol the two above did not have: T9, T10, T16, T18, T20, T24, T32
 *
 * Codes T1-T37 are the protocol's own numbers; M1-M3 and N1 are the site's.
 * Traps that need a human reading (manager quotes, narrative, popularity, derbies, qualification
 * maths) are not here: nothing in the data says them reliably.
 *
 * Pure. No I/O. The chance of a pick is never changed here: a scan labels and withdraws.
 */

const POINTS = { minor: 2, medium: 5, major: 10 };
const RANK = { minor: 1, medium: 2, major: 3 };

/** lib/signals.js trap id -> [code, name, rating]. */
const MARKET = {
  short_price_trap: ['T24', 'False banker', 'major'],
  short_price_soft: ['T24', 'False banker', 'medium'],
  margin_trap: ['M1', 'Heavy bookmaker margin', 'medium'],
  margin_high: ['M1', 'Heavy bookmaker margin', 'minor'],
  model_market_conflict: ['T2', 'Price shorter than the numbers support', 'medium'],
  model_market_gap: ['T2', 'Price shorter than the numbers support', 'minor'],
  implausible_edge: ['T6', 'Too-good-to-be-true price', 'major'],
  large_edge: ['T6', 'Too-good-to-be-true price', 'medium'],
  cross_league: ['T36', 'Competition mismatch', 'medium'],
  reverse_line_movement: ['T7', 'Odds moving against the pick', 'medium'],
  line_drift: ['T7', 'Odds moving against the pick', 'minor'],
  xg_overperformance: ['T15', 'Form flattered by luck', 'medium'],
  xg_overperformance_mild: ['T15', 'Form flattered by luck', 'minor'],
  small_sample: ['T19', 'Too few games to judge', 'medium'],
  small_sample_soft: ['T19', 'Too few games to judge', 'minor'],
  congestion: ['T4', 'Fixture congestion, rotation risk', 'medium'],
  unverified_price: ['T23', 'Thin information', 'minor'],
  low_liquidity: ['T23', 'Thin information', 'medium'],
  missing_stats: ['T23', 'Thin information', 'medium'],
  draw_trap: ['T12', 'The draw is very live', 'medium'],
};

const GOALS = /^(O|U)\d|^BTTS|^TT[HA]_|^GG/;
const RESERVES = /(^Jong\s)|(\s(II|B|C|U\d\d|Reserves?|Res\.?|Am\.?|Amateure)$)/;
const pc = (v) => `${Math.round(v * 100)}%`;

/** Which side a pick leans on: 'home', 'away' or null. */
function sideOf(key) {
  if (/^(1|1X|DNB_H|TTH_.*|AH_H.*)$/.test(key)) return 'home';
  if (/^(2|X2|DNB_A|TTA_.*|AH_A.*)$/.test(key)) return 'away';
  return null;
}

/** The best price on offer for a pick, as a number, or null. */
function priceOf(p, mk) {
  const b = p && p.price ? p.price.best : null;
  const v = b && typeof b === 'object' ? b.price : b;
  if (v > 1) return Number(v);
  if (p && p.price && p.price.price > 1) return Number(p.price.price);
  return mk && mk.price > 1 ? Number(mk.price) : null;
}

/**
 * Scan one selection.
 * @param {{key:string, prob:number, price?:number|null, match?:object, market?:object, intel?:object, model?:object}} x
 * @returns {{score:number, verdict:'clear'|'caution'|'trap', flags:{code:string,name:string,rating:string,detail:string}[]}}
 */
function scan(x) {
  const { key, prob } = x;
  const price = x.price > 1 ? x.price : null;
  const found = new Map();
  const add = (code, name, rating, detail) => {
    const cur = found.get(code);
    if (!cur || RANK[rating] > RANK[cur.rating]) found.set(code, { code, name, rating, detail: detail || '' });
  };
  const side = sideOf(key);
  const ids = new Set();

  // 1. the engine's market screen
  for (const t of (x.market && x.market.traps) || []) {
    if (!t) continue;
    ids.add(t.id);
    const m = MARKET[t.id];
    if (m) add(m[0], m[1], m[2], t.detail);
    else if (t.label) add(/keeper/i.test(t.label) ? 'T27' : 'N1', /keeper/i.test(t.label) ? 'Goalkeeper change' : 'Team news', t.severity === 'veto' || t.severity === 'high' ? 'medium' : 'minor', t.label);
  }

  // 2. the v6 layer
  const intel = x.intel && x.intel.available !== false ? x.intel : null;
  let cup = false;
  if (intel) {
    const avoid = ((intel.decision && intel.decision.avoid) || []).some((a) => a.key === key);
    if (avoid) add('M2', 'Measured trap', 'major', 'On past matches the price overstated this kind of pick.');
    for (const t of intel.traps || []) {
      if (t.kind === 'rule' && t.key === key) add('M2', 'Measured trap', 'major', t.detail || t.label);
      else if (t.kind === 'model' && t.key === key) add('M3', 'Overrated by the price', 'medium', t.detail);
      else if (t.kind === 'data' && /cup or cross-league/i.test(t.label)) cup = true;
      else if (t.kind === 'data' && /thin data/i.test(t.label)) add('T23', 'Thin information', 'medium', t.detail);
      else if (t.kind === 'data' && /red card/i.test(t.label)) add('T15', 'Form flattered by luck', 'minor', t.detail);
      else if (t.kind === 'context' && /^weather/i.test(t.label)) add('T22', 'Weather wildcard', GOALS.test(key) ? 'major' : 'minor', t.label);
    }
  }
  if (cup) {
    // T20: the favourite's markets in a cup tie are the classic rotation / giant-killing trap
    if (side && price && price <= 1.5) add('T20', 'Cup rotation, giant-killing risk', 'major', `A favourite at ${price.toFixed(2)} in a cup tie: line-ups change and the league form does not carry over.`);
    else add('T36', 'Competition mismatch', 'medium', 'Form and table come from another competition.');
  }

  // 3. the protocol's own checks
  if (price && price <= 1.15 && prob != null) {
    // T24: looks certain at the price, the numbers disagree
    const says = 1 / price;
    if (prob <= says - 0.08) add('T24', 'False banker', 'major', `Priced ${price.toFixed(2)} (says ${pc(says)}), the numbers say ${pc(prob)}.`);
    else if (prob < 0.87) add('T24', 'False banker', 'medium', `Priced ${price.toFixed(2)} as a near-certainty, the numbers say ${pc(prob)}.`);
  }
  const mdl = x.model || null;
  if (mdl && mdl.oneXtwo && mdl.lambda && /^U[34]\.5$/.test(key)) {
    // T9: an Under on a mismatch — a strong favourite can run up the score alone
    const favHome = mdl.oneXtwo.pHome >= mdl.oneXtwo.pAway;
    const fav = favHome ? mdl.oneXtwo.pHome : mdl.oneXtwo.pAway;
    const lam = favHome ? mdl.lambda.home : mdl.lambda.away;
    if (fav >= 0.65 && lam >= 2.0) add('T9', 'Mismatch Under trap', 'major', `A ${pc(fav)} favourite expected to score ${lam.toFixed(1)} on its own.`);
  }
  const m = x.match || {};
  const names = [m.home && m.home.name, m.away && m.away.name].filter(Boolean);
  if (names.some((n) => RESERVES.test(n))) add('T16', 'Reserve or B team', 'major', 'Squads of second teams change from week to week.');
  const rest = intel && intel.context && intel.context.restAllComps ? intel.context.restAllComps : null;
  if (rest) {
    const { home: rh, away: ra } = rest;
    if (rh != null && ra != null && rh >= 12 && ra >= 12) add('T18', 'First match after a break', 'minor', `Both sides last played ${Math.min(rh, ra)}+ days ago.`);
    for (const [s, d] of [['home', rh], ['away', ra]]) {
      if (d != null && d >= 0 && d <= 3) add('T4', 'Fixture congestion, rotation risk', side === s ? 'medium' : 'minor', `The ${s} side played ${d} day${d === 1 ? '' : 's'} ago.`);
    }
  }
  if ((key === '1X' || key === 'X2') && price && price >= 1.1 && price <= 1.25 && ((found.get('T4') || {}).rating === 'medium' || found.has('N1') || found.has('T27'))) {
    add('T10', '"They can\'t lose" illusion', 'medium', `Priced ${price.toFixed(2)} on reputation while rotation or team news is in doubt.`);
  }
  const tb = intel && intel.table ? intel.table : null;
  if (tb && [tb.home, tb.away].some((r) => r && r.gp != null && r.gp < 6)) add('T19', 'Too few games to judge', 'minor', 'Fewer than six league games played.');
  if (ids.has('reverse_line_movement') && (ids.has('low_liquidity') || ids.has('unverified_price'))) {
    add('T32', 'Unexplained odds move in a thin market', 'major', 'Odds moving hard against the pick where little is known.');
  }

  const flags = [...found.values()].sort((a, b) => RANK[b.rating] - RANK[a.rating] || a.code.localeCompare(b.code));
  const score = -flags.reduce((s, f) => s + POINTS[f.rating], 0);
  return { score, verdict: score <= -10 ? 'trap' : score < 0 ? 'caution' : 'clear', flags };
}

/** Scan every methodology pick of a report and hang the result on it (`prediction.trap`). */
function attach(report) {
  const mt = report && report.methodology;
  if (!mt || !Array.isArray(mt.predictions)) return 0;
  let n = 0;
  const run = (p) => {
    if (!p || !p.pick || !p.pick.key) return;
    const mk = (report.markets || []).find((k) => k.key === p.pick.key) || null;
    p.trap = scan({ key: p.pick.key, prob: p.prob, price: priceOf(p, mk), match: report.match, market: mk, intel: report.intel, model: report.model });
    n++;
  };
  for (const p of mt.predictions) run(p);
  if (mt.headline && !mt.headline.trap) run(mt.headline);
  return n;
}

module.exports = { scan, attach, priceOf, sideOf, POINTS, MARKET };
