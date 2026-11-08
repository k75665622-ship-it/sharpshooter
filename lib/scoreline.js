'use strict';

/**
 * scoreline.js — final-score prediction from the ensemble expected goals.
 *
 * Built and tested in research/score_study.js on 19,991 held-out fixtures:
 *
 *   rule        exact hit   right result   right O/U 2.5   right goal diff
 *   mode           13.3%        38.4%          49.5%            27.3%
 *   coherent       11.8%        51.0%          57.2%            24.2%
 *
 * The single most likely score ("mode") is usually 1-1 or 1-0, so it maximises the
 * exact-hit rate but contradicts the predicted result half the time. The "coherent"
 * score is the most likely scoreline INSIDE the predicted result and the predicted
 * Over/Under 2.5 side, so it reads consistently with every other prediction on the
 * page.
 *
 * v6.2: the headline "predicted final score" is the single most likely score. Re-checked on
 * 29,191 matches of 2023-26 (research/v6/RESULTS.md, 9): the most likely score was exactly right
 * 13.0% of the time against 11.5% for the coherent one, and the three likeliest scores together
 * 33.9% (stated 33.2%). No model gets much past 1 in 8 on one exact score: the page therefore
 * shows the three likeliest scores with their combined chance, and the likeliest pair of
 * total-goals counts ("2 or 3 goals", 46.7%). The coherent score is kept (`coherent`) for the
 * Correct Score methodology, whose record was measured on it.
 *
 * The exact-score grid uses a constant-rho Dixon-Coles matrix with the draw diagonal
 * inflated by 10% — the best exact-score log-loss in the study.
 */

const ENS = require('./ensemble');
const M = require('./model');

const MAXS = 6;

function outcomeOf(i, j) {
  return i > j ? 'H' : i === j ? 'D' : 'A';
}

/**
 * @param {number} lamH
 * @param {number} lamA
 * @param {{home:number, draw:number, away:number, over25:number}} [calls] calibrated probabilities to anchor the result / goals calls
 */
function predict(lamH, lamA, calls) {
  const grid = ENS.scoreGrid(lamH, lamA);
  const m = grid.m;
  const cells = [];
  for (let i = 0; i <= MAXS; i++) for (let j = 0; j <= MAXS; j++) cells.push({ h: i, a: j, p: m[i][j], s: `${i}-${j}` });
  cells.sort((x, y) => y.p - x.p);

  // result and goals calls: calibrated probabilities when given, otherwise the grid's
  let pH = 0;
  let pD = 0;
  let pO = 0;
  for (let i = 0; i <= M.MAX_GOALS; i++) for (let j = 0; j <= M.MAX_GOALS; j++) {
    if (i > j) pH += m[i][j];
    else if (i === j) pD += m[i][j];
    if (i + j > 2) pO += m[i][j];
  }
  const probs = calls || { home: pH, draw: pD, away: 1 - pH - pD, over25: pO };
  const outcome = probs.home >= probs.draw && probs.home >= probs.away ? 'H' : probs.away >= probs.draw ? 'A' : 'D';
  const over = probs.over25 >= 0.5;

  const mode = cells[0];
  const coherent = cells.find((c) => outcomeOf(c.h, c.a) === outcome && (c.h + c.a > 2) === over)
    || cells.find((c) => outcomeOf(c.h, c.a) === outcome) || mode;

  // half-time: ~44% of goals land before the break (v4 constant, unchanged)
  const ht = M.scoreMatrix(lamH * 0.44, lamA * 0.44, -0.05).m;
  let htMode = { h: 0, a: 0, p: 0 };
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) if (ht[i][j] > htMode.p) htMode = { h: i, a: j, p: ht[i][j] };

  // how concentrated the distribution is: share of probability in the top three scores
  const top3 = cells.slice(0, 3).reduce((a, c) => a + c.p, 0);
  // the likeliest pair of neighbouring total-goals counts ("2 or 3 goals")
  const tg = Array(2 * MAXS + 1).fill(0);
  for (let i = 0; i <= MAXS; i++) for (let j = 0; j <= MAXS; j++) tg[i + j] += m[i][j];
  let pair = [0, 1];
  for (let g = 0; g < tg.length - 1; g++) if (tg[g] + tg[g + 1] > tg[pair[0]] + tg[pair[1]]) pair = [g, g + 1];
  // the set of scores that together cover >= 50% (a "score band")
  const band = [];
  let cum = 0;
  for (const c of cells) {
    band.push(c);
    cum += c.p;
    if (cum >= 0.5) break;
  }

  return {
    expected: { home: lamH, away: lamA, total: lamH + lamA },
    outcome,
    outcomeProb: outcome === 'H' ? probs.home : outcome === 'A' ? probs.away : probs.draw,
    over25: over,
    over25Prob: over ? probs.over25 : 1 - probs.over25,
    predicted: { score: mode.s, home: mode.h, away: mode.a, prob: mode.p },
    mostLikely: { score: mode.s, home: mode.h, away: mode.a, prob: mode.p },
    coherent: { score: coherent.s, home: coherent.h, away: coherent.a, prob: coherent.p },
    top: cells.slice(0, 6).map((c) => ({ score: c.s, prob: c.p })),
    top3: { scores: cells.slice(0, 3).map((c) => c.s), prob: top3 },
    goalsRange: { totals: pair, label: `${pair[0]} or ${pair[1]} goals`, prob: tg[pair[0]] + tg[pair[1]] },
    halfTime: { score: `${htMode.h}-${htMode.a}`, prob: htMode.p },
    concentration: top3,
    band: { scores: band.map((c) => c.s), prob: cum },
    grid: m,
  };
}

module.exports = { predict, outcomeOf };
