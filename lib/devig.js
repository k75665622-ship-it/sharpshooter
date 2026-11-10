'use strict';

/**
 * devig.js — turning a bookmaker's prices into fair probabilities.
 *
 * A bookmaker's prices add up to more than 100%: the excess is the margin. It is not spread
 * evenly — outsiders carry more of it than favourites (the favourite-longshot bias) — so how the
 * margin is taken off decides how accurate the probabilities are, most of all for strong
 * favourites, where the Strongest Picks live.
 *
 * Methods (all take decimal odds and return probabilities that sum to one, or null):
 *   proportional  q_i / sum(q)
 *   power         q_i^k, k solved so the sum is one
 *   shin          Shin (1993): the margin modelled as protection against informed bettors
 *   oddsRatio     q_i / (c + q_i - c q_i), c solved so the sum is one
 *   blend         w x power + (1 - w) x proportional  (the engine up to v6 used w = 0.6)
 *
 * research/v7/devig_study.js scores each on 141,000 matches. `fair` is the engine's choice.
 * Pure. No I/O.
 */

function implied(odds) {
  if (!Array.isArray(odds) || odds.length < 2) return null;
  const q = odds.map((o) => (o > 1 ? 1 / o : null));
  return q.some((x) => x == null || !Number.isFinite(x)) ? null : q;
}

function proportional(odds) {
  const q = implied(odds);
  if (!q) return null;
  const s = q.reduce((a, b) => a + b, 0);
  return q.map((x) => x / s);
}

/** Bisection for a monotone f on [lo, hi] with f(lo) and f(hi) on opposite sides of zero. */
function bisect(f, lo, hi, n = 60) {
  let flo = f(lo);
  for (let i = 0; i < n; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if ((fm > 0) === (flo > 0)) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return (lo + hi) / 2;
}

function power(odds) {
  const q = implied(odds);
  if (!q) return null;
  const s = q.reduce((a, b) => a + b, 0);
  if (Math.abs(s - 1) < 1e-9) return q;
  const k = bisect((x) => q.reduce((a, p) => a + Math.pow(p, x), 0) - 1, 0.3, 3);
  const p = q.map((x) => Math.pow(x, k));
  const z = p.reduce((a, b) => a + b, 0);
  return p.map((x) => x / z);
}

function shin(odds) {
  const q = implied(odds);
  if (!q) return null;
  const S = q.reduce((a, b) => a + b, 0);
  if (S <= 1 + 1e-9) return q.map((x) => x / S);
  const of = (z) => q.map((x) => (Math.sqrt(z * z + (4 * (1 - z) * x * x) / S) - z) / (2 * (1 - z)));
  const z = bisect((x) => of(x).reduce((a, b) => a + b, 0) - 1, 0, 0.4);
  const p = of(z);
  const t = p.reduce((a, b) => a + b, 0);
  return p.map((x) => x / t);
}

function oddsRatio(odds) {
  const q = implied(odds);
  if (!q) return null;
  const S = q.reduce((a, b) => a + b, 0);
  if (Math.abs(S - 1) < 1e-9) return q;
  const of = (c) => q.map((x) => x / (c + x - c * x));
  const c = bisect((x) => of(x).reduce((a, b) => a + b, 0) - 1, 0.2, 5);
  const p = of(c);
  const t = p.reduce((a, b) => a + b, 0);
  return p.map((x) => x / t);
}

function blend(odds, w = 0.6) {
  const a = power(odds);
  const b = proportional(odds);
  return a && b ? a.map((x, i) => w * x + (1 - w) * b[i]) : null;
}

module.exports = { implied, proportional, power, shin, oddsRatio, blend };
