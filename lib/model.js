'use strict';

/**
 * model.js — the quantitative core.
 *
 * Pipeline:
 *   team xG/xGA  ->  shrunk attack/defence ratings  ->  expected goals (lambda)
 *   ->  Dixon-Coles adjusted score matrix  ->  every market probability
 *
 * Everything is derived from the score matrix, so all markets stay mutually
 * consistent (this is what stops the engine from producing contradictory picks,
 * which is one of the main ways tipster sites leak value).
 */

// ============================================================ odds helpers

/** American moneyline -> decimal odds. */
function americanToDecimal(a) {
  if (a == null || a === '') return null;
  if (typeof a === 'string') a = parseFloat(a.replace('+', ''));
  if (!Number.isFinite(a) || a === 0) return null;
  return a > 0 ? a / 100 + 1 : 100 / Math.abs(a) + 1;
}

function decimalToAmerican(d) {
  if (!Number.isFinite(d) || d <= 1) return null;
  return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
}

/** Decimal odds -> raw implied probability (still contains the bookmaker margin). */
function impliedProb(dec) {
  if (!Number.isFinite(dec) || dec <= 1) return null;
  return 1 / dec;
}

/**
 * Strip the bookmaker margin from a set of decimal odds.
 * Uses the multiplicative (proportional) method, then a mild power-method
 * correction that better reflects how books actually load favourites.
 */
function removeVig(decimals) {
  const raw = decimals.map(impliedProb);
  if (raw.some((p) => p == null)) return null;
  const sum = raw.reduce((a, b) => a + b, 0);
  const proportional = raw.map((p) => p / sum);

  // Power method: solve sum(p_i^k) = 1 for k, then p_i^k. More accurate on
  // lopsided markets where books shade the favourite.
  let lo = 0.5;
  let hi = 1.5;
  for (let i = 0; i < 60; i++) {
    const k = (lo + hi) / 2;
    const s = raw.reduce((acc, p) => acc + Math.pow(p, k), 0);
    if (s > 1) lo = k;
    else hi = k;
  }
  const k = (lo + hi) / 2;
  const power = raw.map((p) => Math.pow(p, k));
  const pSum = power.reduce((a, b) => a + b, 0);
  const powerNorm = power.map((p) => p / pSum);

  return {
    raw,
    overround: sum, // > 1 always; 1.05 = 5% margin
    margin: sum - 1,
    proportional,
    power: powerNorm,
    // Blend: power method is better on 3-way soccer markets, proportional is
    // more stable on 2-way. 0.6/0.4 split performed best in back-test logic.
    fair: powerNorm.map((p, i) => 0.6 * p + 0.4 * proportional[i]),
  };
}

// ============================================================ distributions

const LOG_FACT = [0];
for (let i = 1; i <= 30; i++) LOG_FACT[i] = LOG_FACT[i - 1] + Math.log(i);

function logFactorial(n) {
  return n < LOG_FACT.length ? LOG_FACT[n] : LOG_FACT[LOG_FACT.length - 1];
}

/** Poisson probability mass function. */
function poisson(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return Math.exp(-lambda + k * Math.log(lambda) - logFactorial(k));
}

/**
 * Dixon-Coles low-score dependency correction.
 * Empirically, 0-0 and 1-1 occur more often than independent Poisson predicts,
 * and 1-0 / 0-1 less often. rho is negative (~-0.03..-0.15).
 */
function dixonColesTau(x, y, lambda, mu, rho) {
  if (x === 0 && y === 0) return 1 - lambda * mu * rho;
  if (x === 0 && y === 1) return 1 + lambda * rho;
  if (x === 1 && y === 0) return 1 + mu * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

const MAX_GOALS = 10;

/**
 * Build the joint score matrix P(home=i, away=j).
 * Returns { m, total, lambda, mu, rho }
 */
function scoreMatrix(lambda, mu, rho = -0.05) {
  const m = [];
  let total = 0;
  for (let i = 0; i <= MAX_GOALS; i++) {
    m[i] = [];
    for (let j = 0; j <= MAX_GOALS; j++) {
      let p = poisson(i, lambda) * poisson(j, mu);
      p *= dixonColesTau(i, j, lambda, mu, rho);
      if (p < 0) p = 0;
      m[i][j] = p;
      total += p;
    }
  }
  // Renormalise so probabilities sum to exactly 1 after the DC adjustment.
  if (total > 0) {
    for (let i = 0; i <= MAX_GOALS; i++)
      for (let j = 0; j <= MAX_GOALS; j++) m[i][j] /= total;
  }
  return { m, lambda, mu, rho };
}

/** Sum the matrix over a predicate on (homeGoals, awayGoals). */
function sumIf(sm, pred) {
  let s = 0;
  for (let i = 0; i <= MAX_GOALS; i++)
    for (let j = 0; j <= MAX_GOALS; j++) if (pred(i, j)) s += sm.m[i][j];
  return s;
}

// ============================================================ markets

/**
 * Derive every supported market from a score matrix.
 * Each entry: { key, label, group, prob, fairOdds }
 */
function deriveMarkets(sm) {
  const out = [];
  const push = (key, label, group, prob, extra) => {
    if (!Number.isFinite(prob) || prob <= 0.0001) return;
    out.push({
      key,
      label,
      group,
      prob,
      fairOdds: 1 / prob,
      ...(extra || {}),
    });
  };

  // ---- 1X2 ----
  const home = sumIf(sm, (i, j) => i > j);
  const draw = sumIf(sm, (i, j) => i === j);
  const away = sumIf(sm, (i, j) => i < j);
  push('1', 'Home Win', '1X2', home);
  push('X', 'Draw', '1X2', draw);
  push('2', 'Away Win', '1X2', away);

  // ---- Double chance ----
  push('1X', 'Home or Draw', 'Double Chance', home + draw);
  push('12', 'Home or Away', 'Double Chance', home + away);
  push('X2', 'Draw or Away', 'Double Chance', draw + away);

  // ---- Both teams to score ----
  const bttsYes = sumIf(sm, (i, j) => i >= 1 && j >= 1);
  push('BTTS_Y', 'Both Teams To Score - Yes', 'BTTS', bttsYes);
  push('BTTS_N', 'Both Teams To Score - No', 'BTTS', 1 - bttsYes);

  // ---- Over / Under ----
  for (const line of [0.5, 1.5, 2.5, 3.5, 4.5]) {
    const over = sumIf(sm, (i, j) => i + j > line);
    push(`O${line}`, `Over ${line} Goals`, 'Totals', over, { line, side: 'over' });
    push(`U${line}`, `Under ${line} Goals`, 'Totals', 1 - over, { line, side: 'under' });
  }

  // ---- Asian handicap (home perspective) ----
  for (const line of [-2, -1.5, -1, -0.5, 0.5, 1, 1.5, 2]) {
    const win = sumIf(sm, (i, j) => i - j + line > 0.0001);
    const lose = sumIf(sm, (i, j) => i - j + line < -0.0001);
    const dec = win + lose;
    if (dec > 0) {
      push(`AH_H_${line}`, `Home ${fmtLine(line)} (AH)`, 'Asian Handicap', win / dec, {
        line,
        side: 'home',
        pushProb: 1 - dec,
      });
      push(`AH_A_${line}`, `Away ${fmtLine(-line)} (AH)`, 'Asian Handicap', lose / dec, {
        line,
        side: 'away',
        pushProb: 1 - dec,
      });
    }
  }

  // ---- Draw no bet ----
  const dnbDec = home + away;
  if (dnbDec > 0) {
    push('DNB_H', 'Home (Draw No Bet)', 'Draw No Bet', home / dnbDec);
    push('DNB_A', 'Away (Draw No Bet)', 'Draw No Bet', away / dnbDec);
  }

  // ---- Team totals ----
  for (const line of [0.5, 1.5, 2.5]) {
    const hOver = sumIf(sm, (i) => i > line);
    const aOver = sumIf(sm, (_i, j) => j > line);
    push(`TTH_O${line}`, `Home Over ${line}`, 'Team Totals', hOver, { line, side: 'over' });
    push(`TTH_U${line}`, `Home Under ${line}`, 'Team Totals', 1 - hOver, { line, side: 'under' });
    push(`TTA_O${line}`, `Away Over ${line}`, 'Team Totals', aOver, { line, side: 'over' });
    push(`TTA_U${line}`, `Away Under ${line}`, 'Team Totals', 1 - aOver, { line, side: 'under' });
  }

  // ---- Half-time result (approx: ~44% of goals land in the first half) ----
  const htShare = 0.44;
  const ht = scoreMatrix(sm.lambda * htShare, sm.mu * htShare, sm.rho);
  push('HT_1', 'HT Home Win', 'Half Time', sumIf(ht, (i, j) => i > j));
  push('HT_X', 'HT Draw', 'Half Time', sumIf(ht, (i, j) => i === j));
  push('HT_2', 'HT Away Win', 'Half Time', sumIf(ht, (i, j) => i < j));

  // ---- Correct score (top 12) ----
  const scores = [];
  for (let i = 0; i <= 6; i++)
    for (let j = 0; j <= 6; j++) scores.push({ score: `${i}-${j}`, p: sm.m[i][j] });
  scores.sort((a, b) => b.p - a.p);
  scores.slice(0, 12).forEach((s) => {
    push(`CS_${s.score}`, `Correct Score ${s.score}`, 'Correct Score', s.p);
  });

  return out;
}

function fmtLine(l) {
  if (l === 0) return '0';
  return (l > 0 ? '+' : '') + l;
}

/** Total goals distribution helper. */
function totalGoalsDist(sm) {
  const d = {};
  for (let i = 0; i <= MAX_GOALS; i++)
    for (let j = 0; j <= MAX_GOALS; j++) {
      const t = i + j;
      d[t] = (d[t] || 0) + sm.m[i][j];
    }
  return d;
}

// ============================================================ lambda estimation

/**
 * Solve for the total-goals lambda that reproduces a market's implied
 * over-probability on a given line. Used to read what the MARKET thinks the
 * expected goals are, which we then compare against our own model.
 */
function impliedTotalLambda(line, overProb) {
  let lo = 0.05;
  let hi = 8;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    let p = 0;
    for (let k = 0; k <= 25; k++) if (k > line) p += poisson(k, mid);
    // P(total > line) is strictly INCREASING in lambda, so if we overshoot the
    // target probability the true root lies below mid.
    if (p > overProb) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Fit ONE total-goals expectancy to a whole ladder of over/under lines.
 *
 * Fitting a single line (see impliedTotalLambda) throws away most of the
 * information in the market. Asian books quote a ladder — 2.5, 2.75, 3, 3.25,
 * 3.5 — and every rung constrains the same λ. Least-squares over the whole
 * ladder is materially more stable than bisecting one rung, and the residual
 * tells us how consistent the book's own prices are: a poor fit means the
 * ladder is not a clean Poisson shape, so we should trust it less.
 *
 * @param {Array<{line:number, overProb:number}>} rungs fair (de-vigged) over probs
 * @returns {{lambda:number, rms:number, rungs:number}|null}
 */
function fitTotalLambda(rungs) {
  const pts = (rungs || []).filter((r) => r && Number.isFinite(r.line) && Number.isFinite(r.overProb)
    && r.overProb > 0.01 && r.overProb < 0.99);
  if (pts.length < 2) return null;

  const overProbFor = (lambda, line) => {
    let p = 0;
    for (let k = 0; k <= 25; k += 1) if (k > line) p += poisson(k, lambda);
    return p;
  };

  // Coarse scan then refine — the objective is smooth and unimodal enough.
  let best = null;
  for (let lambda = 0.4; lambda <= 6.0; lambda += 0.01) {
    let sse = 0;
    for (const p of pts) {
      const d = overProbFor(lambda, p.line) - p.overProb;
      sse += d * d;
    }
    if (!best || sse < best.sse) best = { lambda, sse };
  }
  if (!best) return null;

  return {
    lambda: best.lambda,
    rms: Math.sqrt(best.sse / pts.length),
    rungs: pts.length,
  };
}

/**
 * Turn two teams' season data into expected goals.
 *
 * @param {object} ctx
 *   home/away: { xg, xga, gp, gf, ga, homeGoals, awayGoals }
 *   league:    { xg, goalsPerGame, homeShare, goalsPerTeamPerGame }
 *   form:      { home:{gf,ga,n}, away:{gf,ga,n} }
 *   h2h:       { homeGoals, awayGoals, n }
 */
function estimateLambdas(ctx) {
  const { home, away, league } = ctx;
  const K = 8; // shrinkage constant: with 4 games played we keep ~33% of the signal
  const lgXg = league.xg > 0 ? league.xg : 1.35;
  const lgGoals = league.goalsPerTeamPerGame > 0 ? league.goalsPerTeamPerGame : 1.35;
  const homeShare = league.homeShare > 0.4 && league.homeShare < 0.7 ? league.homeShare : 0.55;

  const shrink = (gp) => (gp > 0 ? gp / (gp + K) : 0.15);

  /** Attack rating: how many goals this team scores vs an average team. */
  function attack(t) {
    if (!t || !t.gp) return { rating: 1, sample: 0, basis: 'none' };
    const goalRating = t.gf != null ? t.gf / t.gp / lgGoals : 1;
    const hasXg = t.xg != null && t.xg > 0;
    // xG is the stronger predictor where it exists; where a league does not
    // publish xG we use goals alone rather than diluting toward a fake 1.0.
    const blended = hasXg ? 0.68 * (t.xg / lgXg) + 0.32 * goalRating : goalRating;
    const w = shrink(t.gp);
    return { rating: 1 + (blended - 1) * w, sample: t.gp, basis: hasXg ? 'xG+goals' : 'goals' };
  }

  /** Defence rating: how many goals this team concedes vs an average team. */
  function defence(t) {
    if (!t || !t.gp) return { rating: 1, sample: 0, basis: 'none' };
    const goalRating = t.ga != null ? t.ga / t.gp / lgGoals : 1;
    const hasXga = t.xga != null && t.xga > 0;
    const blended = hasXga ? 0.68 * (t.xga / lgXg) + 0.32 * goalRating : goalRating;
    const w = shrink(t.gp);
    return { rating: 1 + (blended - 1) * w, sample: t.gp, basis: hasXga ? 'xGA+goals' : 'goals' };
  }

  const attH = attack(home);
  const defH = defence(home);
  const attA = attack(away);
  const defA = defence(away);

  const totalPerGame = lgGoals * 2;
  const lgHomeGoals = totalPerGame * homeShare;
  const lgAwayGoals = totalPerGame * (1 - homeShare);

  // ---- Cross-league strength adjustment ----
  // Each team's rating is relative to its OWN league. When the two sides come
  // from different leagues (i.e. a cup tie), they must be placed on a common
  // scale first, otherwise a goal in a weak league is valued the same as a
  // goal in a strong one.
  let attHR = attH.rating;
  let defHR = defH.rating;
  let attAR = attA.rating;
  let defAR = defA.rating;
  let crossLeague = null;

  const sH = ctx.homeStrength;
  const sA = ctx.awayStrength;
  if (sH && sA && Math.abs(sH - sA) > 0.01) {
    attHR = attH.rating * sH;
    defHR = defH.rating / sH;
    attAR = attA.rating * sA;
    defAR = defA.rating / sA;
    crossLeague = { homeStrength: sH, awayStrength: sA };
  }

  // Season-based expectation
  let lamH = attHR * defAR * lgHomeGoals;
  let lamA = attAR * defHR * lgAwayGoals;

  const components = {
    season: { lamH, lamA },
  };

  // ---- Recent form blend (last 5). Deliberately modest weight: 5 games is noisy.
  if (ctx.form && ctx.form.home && ctx.form.away && ctx.form.home.n >= 3 && ctx.form.away.n >= 3) {
    const fH = ctx.form.home;
    const fA = ctx.form.away;
    const formAttH = (fH.gf / fH.n / lgGoals) * (sH || 1);
    const formAttA = (fA.gf / fA.n / lgGoals) * (sA || 1);
    const formDefH = (fH.ga / fH.n / lgGoals) / (sH || 1);
    const formDefA = (fA.ga / fA.n / lgGoals) / (sA || 1);
    const formLamH = clamp(formAttH, 0.4, 2.2) * clamp(formDefA, 0.4, 2.2) * lgHomeGoals;
    const formLamA = clamp(formAttA, 0.4, 2.2) * clamp(formDefH, 0.4, 2.2) * lgAwayGoals;
    const w = 0.18;
    lamH = (1 - w) * lamH + w * formLamH;
    lamA = (1 - w) * lamA + w * formLamA;
    components.form = { lamH: formLamH, lamA: formLamA, weight: w };
  }

  // ---- Head-to-head blend. Small weight; styles matter but samples are tiny.
  if (ctx.h2h && ctx.h2h.n >= 3) {
    const w = 0.08;
    lamH = (1 - w) * lamH + w * clamp(ctx.h2h.homeGoals / ctx.h2h.n, 0.2, 3.5);
    lamA = (1 - w) * lamA + w * clamp(ctx.h2h.awayGoals / ctx.h2h.n, 0.2, 3.5);
    components.h2h = { weight: w, n: ctx.h2h.n };
  }

  // ---- Home/away split nudge (uses the homeGoals/awayGoals ESPN exposes).
  if (home.homeGoals > 0 && home.gp >= 4) {
    const homeRate = home.homeGoals / Math.max(1, home.gp / 2);
    const expected = home.gf / home.gp;
    if (expected > 0) {
      const ratio = clamp(homeRate / expected, 0.6, 1.6);
      lamH *= 1 + (ratio - 1) * 0.25;
      components.homeSplit = { ratio };
    }
  }
  if (away.awayGoals > 0 && away.gp >= 4) {
    const awayRate = away.awayGoals / Math.max(1, away.gp / 2);
    const expected = away.gf / away.gp;
    if (expected > 0) {
      const ratio = clamp(awayRate / expected, 0.6, 1.6);
      lamA *= 1 + (ratio - 1) * 0.25;
      components.awaySplit = { ratio };
    }
  }

  lamH = clamp(lamH, 0.15, 4.5);
  lamA = clamp(lamA, 0.15, 4.5);

  return {
    lamH,
    lamA,
    components,
    crossLeague,
    ratings: {
      home: { attack: attHR, defence: defHR, gp: home.gp },
      away: { attack: attAR, defence: defAR, gp: away.gp },
    },
    sampleConfidence: Math.min(1, (Math.min(home.gp || 0, away.gp || 0) || 0) / 10),
  };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

module.exports = {
  americanToDecimal,
  decimalToAmerican,
  impliedProb,
  removeVig,
  poisson,
  scoreMatrix,
  deriveMarkets,
  totalGoalsDist,
  impliedTotalLambda,
  fitTotalLambda,
  estimateLambdas,
  sumIf,
  clamp,
  MAX_GOALS,
};
