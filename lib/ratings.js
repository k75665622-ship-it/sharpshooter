'use strict';

/**
 * ratings.js — time-decayed Dixon-Coles team ratings, fitted by maximum likelihood
 * on real match results.
 *
 * WHY THIS EXISTS (v5)
 * --------------------
 * The v4 model rated a team from its season-to-date averages (goals and xG per
 * game) shrunk toward 1.0 by a fixed constant. That has three structural flaws:
 *
 *   1. It is not opponent-adjusted. Scoring 2 a game against the bottom four is
 *      treated exactly like scoring 2 a game against the top four (v3.0 Rule 13
 *      asked for opponent-quality-adjusted form; this is that rule, done properly).
 *   2. It forgets everything at the season boundary. Five games into a new season
 *      the previous 38 games are thrown away, so early-season ratings are noise.
 *   3. Recent and old games weigh the same inside a season.
 *
 * The fix is the standard one from the literature (Dixon & Coles 1997; Maher 1982):
 *
 *     log λ_home = μ + h + att[home] + def[away]
 *     log λ_away = μ     + att[away] + def[home]
 *
 * fitted by weighted Poisson maximum likelihood, every game weighted by
 * exp(-ξ · daysAgo). A ridge penalty pulls each rating toward a prior (0 for an
 * established club, a measured "newcomer" prior for promoted clubs), which is
 * Rule 5 (small samples) expressed mathematically instead of as a fixed K.
 *
 * ξ (decay), the ridge strength and the newcomer prior were chosen by the
 * walk-forward backtest in research/backtest_v5.js — see that file for numbers.
 *
 * Pure and dependency-free. Deterministic. Never throws on bad rows: they are
 * skipped.
 */

const DEFAULTS = {
  /** Per-day decay. 0.0025/day ≈ a half-life of ~280 days. Chosen by backtest. */
  xi: 0.0025,
  /** Ridge strength on attack/defence (in "games of evidence" units). Chosen by backtest. */
  ridge: 6,
  /** Games older than this many days are ignored entirely (weight < ~5%). */
  horizonDays: 1100,
  /** Prior for a club with no history in this league (promoted). Chosen by backtest. */
  newcomer: { att: -0.18, def: 0.16 },
  /** Coordinate-ascent sweeps. 40 is far past convergence for ~20 teams. */
  sweeps: 40,
  /** Minimum weighted games before a team is considered rated at all. */
  minWeightedGames: 3,
};

/**
 * @param {Array<{date:string, home:string, away:string, hg:number, ag:number}>} matches
 * @param {object} [opts]
 * @param {string} [opts.asOf]      ISO date — only games strictly before it are used
 * @param {number} [opts.xi]
 * @param {number} [opts.ridge]
 * @param {Set<string>|string[]} [opts.newcomers]  clubs to treat as promoted (no prior history)
 * @returns {null | Ratings}
 */
function fit(matches, opts = {}) {
  const o = { ...DEFAULTS, ...opts, newcomer: { ...DEFAULTS.newcomer, ...(opts.newcomer || {}) } };
  const asOf = opts.asOf ? String(opts.asOf).slice(0, 10) : null;
  const asOfT = asOf ? Date.parse(asOf + 'T00:00:00Z') : null;

  // ---- collect weighted games
  const games = [];
  let latest = 0;
  for (const m of matches || []) {
    if (!m || !m.date || !m.home || !m.away) continue;
    if (!Number.isFinite(m.hg) || !Number.isFinite(m.ag)) continue;
    const d = String(m.date).slice(0, 10);
    if (asOf && d >= asOf) continue;
    const t = Date.parse(d + 'T00:00:00Z');
    if (!Number.isFinite(t)) continue;
    if (t > latest) latest = t;
    games.push({ t, h: m.home, a: m.away, hg: m.hg, ag: m.ag });
  }
  if (!games.length) return null;
  const ref = asOfT || latest + 86400000;
  const rows = [];
  for (const g of games) {
    const days = (ref - g.t) / 86400000;
    if (days > o.horizonDays || days < 0) continue;
    rows.push({ ...g, w: Math.exp(-o.xi * days) });
  }
  if (rows.length < 20) return null;

  // ---- index teams
  const teams = new Map();
  const idx = (n) => {
    if (!teams.has(n)) teams.set(n, teams.size);
    return teams.get(n);
  };
  for (const r of rows) {
    r.hi = idx(r.h);
    r.ai = idx(r.a);
  }
  const T = teams.size;
  const names = [...teams.keys()];
  const newSet = new Set(opts.newcomers ? [...opts.newcomers] : []);
  const priorAtt = new Float64Array(T);
  const priorDef = new Float64Array(T);
  for (let i = 0; i < T; i++) {
    if (newSet.has(names[i])) {
      priorAtt[i] = o.newcomer.att;
      priorDef[i] = o.newcomer.def;
    }
  }

  // ---- initial values
  let sw = 0;
  let sg = 0;
  let sh = 0;
  let sa = 0;
  for (const r of rows) {
    sw += r.w;
    sg += r.w * (r.hg + r.ag);
    sh += r.w * r.hg;
    sa += r.w * r.ag;
  }
  const meanGoals = sg / (2 * sw);
  let mu = Math.log(Math.max(0.3, sa / sw));
  let home = Math.log(Math.max(0.3, sh / sw)) - mu;
  const att = Float64Array.from(priorAtt);
  const def = Float64Array.from(priorDef);

  // ---- weighted games per team (for "is this team rated" and the confidence read)
  const wGames = new Float64Array(T);
  for (const r of rows) {
    wGames[r.hi] += r.w;
    wGames[r.ai] += r.w;
  }

  // ---- coordinate ascent (each update is one exact Newton step on a concave objective)
  const lamH = new Float64Array(rows.length);
  const lamA = new Float64Array(rows.length);
  const recompute = () => {
    for (let k = 0; k < rows.length; k++) {
      const r = rows[k];
      lamH[k] = Math.exp(mu + home + att[r.hi] + def[r.ai]);
      lamA[k] = Math.exp(mu + att[r.ai] + def[r.hi]);
    }
  };
  recompute();

  for (let sweep = 0; sweep < o.sweeps; sweep++) {
    // global intercept
    {
      let g = 0;
      let h = 0;
      for (let k = 0; k < rows.length; k++) {
        const r = rows[k];
        g += r.w * (r.hg - lamH[k] + r.ag - lamA[k]);
        h += r.w * (lamH[k] + lamA[k]);
      }
      mu += g / h;
      recompute();
    }
    // home advantage
    {
      let g = 0;
      let h = 0;
      for (let k = 0; k < rows.length; k++) {
        const r = rows[k];
        g += r.w * (r.hg - lamH[k]);
        h += r.w * lamH[k];
      }
      home += g / h;
      recompute();
    }
    // attack and defence, all teams at once (Jacobi step — stable because each
    // parameter's Hessian is diagonal-dominant and the ridge adds curvature)
    const gA = new Float64Array(T);
    const hA = new Float64Array(T);
    const gD = new Float64Array(T);
    const hD = new Float64Array(T);
    for (let k = 0; k < rows.length; k++) {
      const r = rows[k];
      const eh = r.w * (r.hg - lamH[k]);
      const ea = r.w * (r.ag - lamA[k]);
      gA[r.hi] += eh;
      hA[r.hi] += r.w * lamH[k];
      gA[r.ai] += ea;
      hA[r.ai] += r.w * lamA[k];
      gD[r.ai] += eh;
      hD[r.ai] += r.w * lamH[k];
      gD[r.hi] += ea;
      hD[r.hi] += r.w * lamA[k];
    }
    // ridge measured in "goals of evidence": ridge * meanGoals is the curvature
    // one average game contributes, so `ridge` reads as "games of prior".
    const R = o.ridge * meanGoals;
    let maxStep = 0;
    for (let i = 0; i < T; i++) {
      const sa_ = (gA[i] - R * (att[i] - priorAtt[i])) / (hA[i] + R);
      const sd_ = (gD[i] - R * (def[i] - priorDef[i])) / (hD[i] + R);
      att[i] += sa_;
      def[i] += sd_;
      maxStep = Math.max(maxStep, Math.abs(sa_), Math.abs(sd_));
    }
    // identifiability: centre attack and defence on the established clubs' mean,
    // folding the shift into μ so predictions are unchanged.
    let ma = 0;
    let md = 0;
    let n = 0;
    for (let i = 0; i < T; i++) {
      if (newSet.has(names[i])) continue;
      ma += att[i];
      md += def[i];
      n++;
    }
    if (n) {
      ma /= n;
      md /= n;
      for (let i = 0; i < T; i++) {
        att[i] -= ma;
        def[i] -= md;
      }
      mu += ma + md;
    }
    recompute();
    if (maxStep < 1e-6) break;
  }

  // ---- dispersion of the fitted teams: used as the confidence read on a rating
  const byTeam = {};
  for (let i = 0; i < T; i++) {
    byTeam[names[i]] = {
      att: att[i],
      def: def[i],
      weightedGames: wGames[i],
      rated: wGames[i] >= o.minWeightedGames,
      newcomer: newSet.has(names[i]),
    };
  }

  return {
    mu,
    home,
    meanGoals,
    teams: byTeam,
    n: rows.length,
    asOf: asOf || null,
    xi: o.xi,
    ridge: o.ridge,
  };
}

/**
 * Expected goals for a fixture from a fitted rating set.
 * Unknown clubs fall back to the newcomer prior, and say so.
 *
 * @returns {null | {lamH:number, lamA:number, known:{home:boolean, away:boolean}, confidence:number}}
 */
function predict(R, homeName, awayName, opts = {}) {
  if (!R) return null;
  const nc = { ...DEFAULTS.newcomer, ...(opts.newcomer || {}) };
  const th = R.teams[homeName];
  const ta = R.teams[awayName];
  const ah = th ? th.att : nc.att;
  const dh = th ? th.def : nc.def;
  const aa = ta ? ta.att : nc.att;
  const da = ta ? ta.def : nc.def;
  const neutral = !!opts.neutral;
  const lamH = Math.exp(R.mu + (neutral ? R.home / 2 : R.home) + ah + da);
  const lamA = Math.exp(R.mu + (neutral ? R.home / 2 : 0) + aa + dh);
  // confidence: weighted games of evidence on the thinner side, saturating ~25
  const wg = Math.min(th ? th.weightedGames : 0, ta ? ta.weightedGames : 0);
  return {
    lamH,
    lamA,
    known: { home: !!(th && th.rated), away: !!(ta && ta.rated) },
    weightedGames: { home: th ? th.weightedGames : 0, away: ta ? ta.weightedGames : 0 },
    confidence: Math.max(0, Math.min(1, wg / 25)),
  };
}

/**
 * Clubs in `matches` that had NO game in this league in the `lookbackDays` before
 * `asOf` but do have games after the season start — i.e. promoted (or new) clubs.
 */
function newcomersAt(matches, asOf, seasonStartISO, lookbackDays = 400) {
  const asOfS = String(asOf).slice(0, 10);
  const start = String(seasonStartISO).slice(0, 10);
  const lb = new Date(Date.parse(start + 'T00:00:00Z') - lookbackDays * 86400000).toISOString().slice(0, 10);
  const before = new Set();
  const current = new Set();
  for (const m of matches) {
    const d = String(m.date).slice(0, 10);
    if (d >= lb && d < start) {
      before.add(m.home);
      before.add(m.away);
    } else if (d >= start && d < asOfS) {
      current.add(m.home);
      current.add(m.away);
    }
  }
  return new Set([...current].filter((t) => !before.has(t)));
}

module.exports = { fit, predict, newcomersAt, DEFAULTS };
