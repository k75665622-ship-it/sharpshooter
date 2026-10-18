'use strict';

/**
 * market.js — what the bookmakers think, in goals.
 *
 * The 1X2 and Over/Under prices together pin down a pair of expected-goal rates
 * (λ_home, λ_away). Solving for that pair turns the market into a model component
 * that can be blended with our own ratings, compared against them, and checked
 * for internal consistency.
 *
 * Why it matters (measured in research/backtest_v5.js): de-vigged closing prices
 * are the single most accurate public forecast of a football match. A model that
 * ignores them is not "independent", it is just less accurate. The v5 engine
 * therefore keeps TWO probabilities for every market:
 *
 *   modelProb   our ratings + xG + Elo only — used to look for disagreement (edge)
 *   prob        the ensemble including the market — used to decide whether a
 *               prediction is likely to be RIGHT (the probability floors)
 *
 * Pure. Deterministic. No I/O.
 */

const M = require('./model');

/** De-vig a 2-way or 3-way price set. Returns fair probabilities or null. */
function fair(prices) {
  if (!prices || prices.some((p) => !(p > 1))) return null;
  const v = M.removeVig(prices);
  return v ? { probs: v.fair, margin: v.margin } : null;
}

function rhoFor(total) {
  return M.clamp(-0.05 * (2.6 / Math.max(1.8, total)), -0.1, -0.02);
}

/** Probabilities a (λh, λa) pair implies for the quantities a market quotes. */
function implied(lh, la, line) {
  const sm = M.scoreMatrix(lh, la, rhoFor(lh + la));
  let h = 0;
  let d = 0;
  let over = 0;
  for (let i = 0; i <= M.MAX_GOALS; i++) {
    for (let j = 0; j <= M.MAX_GOALS; j++) {
      const p = sm.m[i][j];
      if (i > j) h += p;
      else if (i === j) d += p;
      if (line != null && i + j > line) over += p;
    }
  }
  return { h, d, a: 1 - h - d, over: line != null ? over : null };
}

/**
 * Solve for (λh, λa) given fair 1X2 probabilities and, optionally, a fair
 * Over probability on a total line. Levenberg-Marquardt on log-λ.
 *
 * Without a total line the total is weakly identified by 1X2 alone (the draw
 * share carries the information), so a soft prior on the total keeps the
 * solution sane: `priorTotal` with weight `priorWeight`.
 *
 * @param {{home:number, draw:number, away:number}} p1x2 fair probabilities
 * @param {{line:number, over:number}|null} total fair over probability on a line
 * @param {{priorTotal?:number, priorWeight?:number}} [opts]
 * @returns {null | {lamH:number, lamA:number, rms:number, fitted:object}}
 */
function solveLambdas(p1x2, total, opts = {}) {
  if (!p1x2 || !(p1x2.home > 0) || !(p1x2.away > 0) || !(p1x2.draw > 0)) return null;
  const priorTotal = opts.priorTotal || 2.6;
  const priorWeight = total ? 0 : opts.priorWeight != null ? opts.priorWeight : 0.15;
  const line = total ? total.line : null;

  const resid = (x, y) => {
    const lh = Math.exp(x);
    const la = Math.exp(y);
    const q = implied(lh, la, line);
    const r = [q.h - p1x2.home, q.a - p1x2.away];
    if (total) r.push(1.4 * (q.over - total.over)); // the total line carries extra weight: it is the most liquid goals price
    if (priorWeight) r.push(priorWeight * Math.log((lh + la) / priorTotal));
    return r;
  };
  const sse = (r) => r.reduce((a, v) => a + v * v, 0);

  // Start from a sensible point: supremacy from the 1X2 split, total from the line or prior.
  const startTotal = total ? Math.max(1.2, Math.min(4.5, total.line + (total.over - 0.5) * 2.2)) : priorTotal;
  const sup = (p1x2.home - p1x2.away) * 2.2;
  let x = Math.log(Math.max(0.15, (startTotal + sup) / 2));
  let y = Math.log(Math.max(0.15, (startTotal - sup) / 2));
  let r = resid(x, y);
  let cost = sse(r);
  let lambda = 1e-3;
  const eps = 1e-4;

  for (let it = 0; it < 40; it++) {
    const rx = resid(x + eps, y);
    const ry = resid(x, y + eps);
    const J = r.map((_, k) => [(rx[k] - r[k]) / eps, (ry[k] - r[k]) / eps]);
    // normal equations (2x2)
    let a11 = 0;
    let a12 = 0;
    let a22 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let k = 0; k < r.length; k++) {
      a11 += J[k][0] * J[k][0];
      a12 += J[k][0] * J[k][1];
      a22 += J[k][1] * J[k][1];
      b1 += J[k][0] * r[k];
      b2 += J[k][1] * r[k];
    }
    let improved = false;
    for (let tries = 0; tries < 8; tries++) {
      const m11 = a11 * (1 + lambda);
      const m22 = a22 * (1 + lambda);
      const det = m11 * m22 - a12 * a12;
      if (!(Math.abs(det) > 1e-14)) {
        lambda *= 10;
        continue;
      }
      const dx = -(m22 * b1 - a12 * b2) / det;
      const dy = -(-a12 * b1 + m11 * b2) / det;
      const nx = Math.max(Math.log(0.05), Math.min(Math.log(6), x + dx));
      const ny = Math.max(Math.log(0.05), Math.min(Math.log(6), y + dy));
      const nr = resid(nx, ny);
      const nc = sse(nr);
      if (nc < cost) {
        x = nx;
        y = ny;
        r = nr;
        const delta = cost - nc;
        cost = nc;
        lambda = Math.max(1e-7, lambda / 3);
        improved = true;
        if (delta < 1e-12) it = 99;
        break;
      }
      lambda *= 10;
    }
    if (!improved) break;
  }
  const lamH = Math.exp(x);
  const lamA = Math.exp(y);
  const q = implied(lamH, lamA, line);
  return {
    lamH,
    lamA,
    rms: Math.sqrt(cost / r.length),
    fitted: q,
  };
}

/**
 * Pool several books' prices for one market into a single fair probability set.
 *
 * Each book is de-vigged on its own, then the fair probabilities are averaged
 * (with optional weights, e.g. Pinnacle > retail). Taking each book's own fair
 * line and averaging is more robust than averaging raw prices.
 *
 * @param {Array<{book:string, prices:number[], weight?:number}>} quotes
 * @returns {null | {probs:number[], books:number, spread:number, perBook:Array}}
 */
function pool(quotes) {
  const ok = [];
  for (const q of quotes || []) {
    const f = fair(q.prices);
    if (f) ok.push({ book: q.book, probs: f.probs, margin: f.margin, weight: q.weight || 1 });
  }
  if (!ok.length) return null;
  const k = ok[0].probs.length;
  const wsum = ok.reduce((a, b) => a + b.weight, 0);
  const probs = [];
  for (let i = 0; i < k; i++) probs.push(ok.reduce((a, b) => a + b.weight * b.probs[i], 0) / wsum);
  // spread: the widest disagreement between any two books on any outcome (in prob points)
  let spread = 0;
  for (let i = 0; i < k; i++) {
    const v = ok.map((b) => b.probs[i]);
    spread = Math.max(spread, Math.max(...v) - Math.min(...v));
  }
  return { probs, books: ok.length, spread, perBook: ok };
}

module.exports = { fair, implied, solveLambdas, pool, rhoFor };
