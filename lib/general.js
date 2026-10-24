'use strict';

/**
 * general.js — the v5 General Prediction, issued for EVERY analysable fixture.
 *
 * The methodologies are deliberately strict: most fixtures fall under none of them.
 * That is correct for staking, but a prediction site still needs to say what it
 * thinks of every match. This module does that, from the same calibrated,
 * market-anchored score matrix — so it never contradicts a methodology pick.
 *
 * Output
 *   result        1X2 call with all three probabilities
 *   doubleChance  the safer side of the result call
 *   goals         Over/Under 2.5 call (plus 1.5 / 3.5 where clear)
 *   btts          Both Teams To Score call
 *   score         predicted final score (coherent), most likely score, top six, half-time
 *   bestBet       the single most likely selection that still pays ≥ 1.30 (the
 *                 "banker" rule) — or the methodology headline when one qualifies
 *   confidence    High / Medium / Low with the reasons
 *
 * Measured on held-out seasons (research/backtest_methods.js): see METHODOLOGY.md.
 */

const SL = require('./scoreline');

/** Markets the best-bet rule may choose from: liquid, priceable, understandable. */
const BEST_BET_KEYS = [
  '1', '2', '1X', 'X2', 'DNB_H', 'DNB_A',
  'O1.5', 'O2.5', 'U2.5', 'U3.5',
  'BTTS_Y', 'BTTS_N',
  'TTH_O0.5', 'TTA_O0.5', 'TTH_O1.5', 'TTA_O1.5', 'TTH_U1.5', 'TTA_U1.5',
];
const BEST_MIN_FAIR = 1.3;

const pct = (v) => (v == null ? '—' : `${(v * 100).toFixed(0)}%`);

/** "Home Win" / "Away Over 1.5" read badly on a card: put the club names in. */
function humanLabel(mk, H, A) {
  const k = mk.key;
  let m;
  if (k === '1') return `${H} to win`;
  if (k === '2') return `${A} to win`;
  if (k === 'X') return 'Draw';
  if (k === '1X') return `${H} or draw`;
  if (k === 'X2') return `Draw or ${A}`;
  if (k === '12') return `${H} or ${A}`;
  if (k === 'DNB_H') return `${H} (draw no bet)`;
  if (k === 'DNB_A') return `${A} (draw no bet)`;
  if ((m = /^TT([HA])_([OU])(\d\.5)$/.exec(k))) return `${m[1] === 'H' ? H : A} ${m[2] === 'O' ? 'over' : 'under'} ${m[3]} goals`;
  return mk.label;
}

function brief(mk, H, A) {
  if (!mk) return null;
  const v = mk.v5price || {};
  return {
    key: mk.key,
    label: H ? humanLabel(mk, H, A) : mk.label,
    group: mk.group,
    prob: mk.prob,
    modelProb: mk.modelProb != null ? mk.modelProb : null,
    fairOdds: 1 / mk.prob,
    valuePrice: v.valuePrice || Math.max(1.25, 1.03 / mk.prob),
    best: v.best ? v.best.price : null,
    bestBook: v.best ? v.best.book : null,
    consensusProb: v.consensus ? v.consensus.prob : null,
  };
}

/**
 * v6: the general prediction from the match intelligence (lib/intel). Same shape as v5, so
 * every consumer keeps working, plus `decision` (main / safer / value / avoid) and the
 * methodology pick when one also qualifies.
 */
function predictV6({ match, markets, methodology, intel }) {
  const by = Object.fromEntries(markets.map((m) => [m.key, m]));
  const H = match.home.name;
  const A = match.away.name;
  const P = intel.probs;
  const res = [
    { call: 'H', label: `${H} win`, prob: P['1'] },
    { call: 'D', label: 'Draw', prob: P.X },
    { call: 'A', label: `${A} win`, prob: P['2'] },
  ].sort((x, y) => y.prob - x.prob)[0];
  const dcKey = res.call === 'H' ? '1X' : res.call === 'A' ? 'X2' : P['1'] >= P['2'] ? '1X' : 'X2';
  const o25 = P['O2.5'];
  const goals = { line: 2.5, call: o25 >= 0.5 ? 'Over' : 'Under', prob: o25 >= 0.5 ? o25 : 1 - o25, extra: [] };
  if (P['O1.5'] >= 0.75) goals.extra.push({ label: 'Over 1.5', prob: P['O1.5'] });
  if (P['U3.5'] >= 0.75) goals.extra.push({ label: 'Under 3.5', prob: P['U3.5'] });
  const bY = P.BTTS_Y;
  const btts = { call: bY >= 0.5 ? 'Yes' : 'No', prob: bY >= 0.5 ? bY : 1 - bY };

  const sp = SL.predict(intel.lam.home, intel.lam.away, { home: P['1'], draw: P.X, away: P['2'], over25: o25 });
  const grid5 = [];
  for (let i = 0; i <= 4; i++) grid5.push([0, 1, 2, 3, 4].map((j) => Math.round(sp.grid[i][j] * 10000) / 10000));
  const score = { grid5, predicted: sp.predicted, mostLikely: sp.mostLikely, top: sp.top, halfTime: sp.halfTime, band: sp.band, expected: sp.expected };

  const dec = intel.decision;
  const pick = (d, role) => {
    if (!d) return null;
    const mk = by[d.key];
    const v = (mk && mk.v5price) || {};
    return {
      key: d.key,
      label: d.label,
      role,
      group: mk ? mk.group : null,
      prob: d.prob,
      baseProb: d.base,
      shift: d.shift,
      fairOdds: d.fair,
      valuePrice: d.takeAt,
      best: d.best != null ? d.best : v.best ? v.best.price : null,
      bestBook: d.bestBook || (v.best ? v.best.book : null),
      ev: d.ev,
    };
  };
  const bestBet = pick(dec.main, 'main');
  const alternatives = [pick(dec.safer, 'safer'), pick(dec.value, 'value')].filter(Boolean);
  const h = methodology && methodology.headline;
  const methodologyPick = h && (h.status === 'LOCK' || h.status === 'PREDICT')
    ? { id: h.id, name: h.name, status: h.status, key: h.pick.key, label: h.pick.label, agrees: !!(bestBet && h.pick.key === bestBet.key) }
    : null;
  const conf = dec.confidence || { level: 'Low', reasons: [] };
  const summary = `${res.label} is the most likely result (${pct(res.prob)}). `
    + `${goals.call} 2.5 goals ${pct(goals.prob)}, BTTS ${btts.call} ${pct(btts.prob)}. `
    + `Predicted score ${H} ${sp.predicted.home}-${sp.predicted.away} ${A}`
    + (sp.mostLikely.score !== sp.predicted.score ? ` (single likeliest score ${sp.mostLikely.score}).` : '.')
    + (bestBet ? ` Main pick: ${bestBet.label} ${pct(bestBet.prob)}, take at ${bestBet.valuePrice.toFixed(2)} or better.` : ' No selection clears the bar.')
    + (dec.value ? ` Value: ${dec.value.label} at ${dec.value.best.toFixed(2)} (${dec.value.bestBook}).` : '');
  return {
    version: '6.0',
    source: intel.source === 'market+factors' ? 'price + 170 factors' : 'factors only (no price)',
    result: { ...res, probs: { home: P['1'], draw: P.X, away: P['2'] } },
    doubleChance: { key: dcKey, label: humanLabel({ key: dcKey }, H, A), prob: P[dcKey], fairOdds: 1 / P[dcKey] },
    goals,
    btts,
    score,
    bestBet,
    alternatives,
    avoid: (dec.avoid || []).map((a) => ({ key: a.key, label: a.label, prob: a.prob, baseProb: a.base, shift: a.shift })),
    methodologyPick,
    confidence: { level: conf.level, reasons: conf.reasons || [], measured: conf.measured || null },
    traps: (intel.traps || []).slice(0, 6),
    summary,
  };
}

function predict({ match, ens, markets, methodology, intel }) {
  if (intel && intel.available && intel.probs && intel.decision) {
    try {
      return predictV6({ match, markets, methodology, intel });
    } catch {
      /* fall through to the v5 prediction */
    }
  }
  const by = Object.fromEntries(markets.map((m) => [m.key, m]));
  const H = match.home.name;
  const A = match.away.name;
  const pH = by['1'].prob;
  const pD = by.X.prob;
  const pA = by['2'].prob;

  // ---- result
  const res = [
    { call: 'H', label: `${H} win`, prob: pH },
    { call: 'D', label: 'Draw', prob: pD },
    { call: 'A', label: `${A} win`, prob: pA },
  ].sort((x, y) => y.prob - x.prob)[0];

  // ---- double chance: cover the result call plus the draw (or both teams if the draw is the call)
  const dcKey = res.call === 'H' ? '1X' : res.call === 'A' ? 'X2' : pH >= pA ? '1X' : 'X2';
  // ---- goals
  const o25 = by['O2.5'].prob;
  const goals = { line: 2.5, call: o25 >= 0.5 ? 'Over' : 'Under', prob: o25 >= 0.5 ? o25 : 1 - o25 };
  const extra = [];
  if (by['O1.5'] && by['O1.5'].prob >= 0.75) extra.push({ label: 'Over 1.5', prob: by['O1.5'].prob });
  if (by['U3.5'] && by['U3.5'].prob >= 0.75) extra.push({ label: 'Under 3.5', prob: by['U3.5'].prob });
  // ---- btts
  const bY = by.BTTS_Y.prob;
  const btts = { call: bY >= 0.5 ? 'Yes' : 'No', prob: bY >= 0.5 ? bY : 1 - bY };

  // ---- score
  const sp = SL.predict(ens.lamH, ens.lamA, { home: pH, draw: pD, away: pA, over25: o25 });
  // 5x5 exact-score grid for the UI heat map (home goals rows, away goals columns)
  const grid5 = [];
  for (let i = 0; i <= 4; i++) grid5.push([0, 1, 2, 3, 4].map((j) => Math.round(sp.grid[i][j] * 10000) / 10000));
  const score = {
    grid5,
    predicted: sp.predicted,
    mostLikely: sp.mostLikely,
    top: sp.top,
    halfTime: sp.halfTime,
    band: sp.band,
    expected: sp.expected,
  };

  // ---- best bet
  let bestBet = null;
  let source = 'general';
  const h = methodology && methodology.headline;
  if (h && (h.status === 'LOCK' || h.status === 'PREDICT') && by[h.pick.key]) {
    bestBet = { ...brief(by[h.pick.key], H, A), label: h.pick.label, methodology: h.name, status: h.status };
    source = 'methodology';
  } else {
    const pool = BEST_BET_KEYS.map((k) => by[k]).filter((m) => m && 1 / m.prob >= BEST_MIN_FAIR && !m.vetoed);
    pool.sort((x, y) => y.prob - x.prob);
    if (pool[0]) bestBet = brief(pool[0], H, A);
  }
  const alternatives = BEST_BET_KEYS.map((k) => by[k]).filter((m) => m && 1 / m.prob >= BEST_MIN_FAIR && (!bestBet || m.key !== bestBet.key))
    .sort((x, y) => y.prob - x.prob).slice(0, 3).map((m) => brief(m, H, A));

  // ---- confidence
  const reasons = [];
  let c = 0;
  if (ens.market) {
    c += 30;
    reasons.push(`priced by ${ens.market.books || 1} bookmaker source(s)`);
  } else reasons.push('no bookmaker price — model only');
  if (ens.components.ratings) {
    c += 10 + 10 * (ens.components.ratings.confidence || 0);
    reasons.push('verified-results ratings');
  }
  if (ens.components.xg) {
    c += 8;
    reasons.push('ESPN xG');
  }
  if (ens.components.elo) c += 5;
  const top = bestBet ? bestBet.prob : res.prob;
  c += Math.max(0, Math.min(30, (top - 0.55) * 120));
  const spread = ens.agreement && ens.agreement.supremacySpread;
  if (spread != null && spread > 0.6) {
    c -= 10;
    reasons.push('witnesses disagree on who is stronger');
  }
  const level = c >= 70 ? 'High' : c >= 48 ? 'Medium' : 'Low';

  const summary = `${res.label} is the most likely result (${pct(res.prob)}). `
    + `${goals.call} 2.5 goals ${pct(goals.prob)}, BTTS ${btts.call} ${pct(btts.prob)}. `
    + `Predicted score ${H} ${sp.predicted.home}-${sp.predicted.away} ${A}`
    + (sp.mostLikely.score !== sp.predicted.score ? ` (single likeliest score ${sp.mostLikely.score}).` : '.')
    + (bestBet ? ` Best bet: ${bestBet.label} ${pct(bestBet.prob)}, take at ${bestBet.valuePrice.toFixed(2)} or better.` : '');

  return {
    version: '5.0',
    source,
    result: { ...res, probs: { home: pH, draw: pD, away: pA } },
    doubleChance: brief(by[dcKey], H, A),
    goals: { ...goals, extra },
    btts,
    score,
    bestBet,
    alternatives,
    confidence: { level, score: Math.round(Math.max(0, Math.min(100, c))), reasons },
    summary,
  };
}

module.exports = { predict, BEST_BET_KEYS, BEST_MIN_FAIR };
