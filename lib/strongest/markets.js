'use strict';

/**
 * strongest/markets.js — the nine SportyBet market groups for one fixture.
 *
 *   Goals · Corners · Half · Players · Minutes · Team · Match · Bookings · Special
 *
 * Every selection is priced by several INDEPENDENT views, so a pick is only called
 * strong when they agree:
 *
 *   goal-based groups (Goals, Half, Minutes, Team, Match, Special)
 *     market   the site's market-anchored ensemble: de-vigged multi-book price (90%) +
 *              model (10%), calibrated on real results where a calibration exists
 *     stats    the model-only witness: verified-results ratings, ESPN xG, ClubElo — no price
 *     factors  the v6 factor model: 170 measured factors on top of the price
 *     pace     the possession model (lib/pace.js): shots a game x goals per shot
 *   Corners, Bookings (no bookmaker price on free data)
 *     model    form AND the bookmakers' read of the match (lib/strongest/calibrate.js)
 *     season   last 20 league games with the home/away split, shrunk to the league average
 *     recent   last 6 league games
 *   Players
 *     market / stats   the team's expected goals from each view x the player's share
 *
 * Each selection's `prob` is its MEASURED chance where the market has a measured record
 * (lib/strongest/models.json): what selections like it actually won given its views.
 *
 * Pure. No I/O.
 */

const M = require('../model');
const C = require('./config');
const CAL = require('./calibrate');

const GROUPS = ['Goals', 'Corners', 'Half', 'Players', 'Minutes', 'Team', 'Match', 'Bookings', 'Special'];
const HALF_MAX = 8; // goals per team per half considered in joint-half markets

// ------------------------------------------------------------------ distributions

/** Negative-binomial probabilities for 0..kmax-1 with mean mu, variance mu + mu^2/r. */
function nbPmf(mu, r, kmax = 41) {
  const out = new Array(kmax).fill(0);
  if (!(mu > 0)) {
    out[0] = 1;
    return out;
  }
  const rr = r > 0 ? r : 1e6;
  const q = mu / (rr + mu);
  out[0] = Math.pow(rr / (rr + mu), rr);
  for (let k = 1; k < kmax; k++) out[k] = out[k - 1] * ((k - 1 + rr) / k) * q;
  return out;
}

function convolve(a, b) {
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    if (!a[i]) continue;
    for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  }
  return out;
}

/** P(X > line) for a .5 line. */
function over(dist, line) {
  let s = 0;
  for (let k = Math.floor(line) + 1; k < dist.length; k++) s += dist[k];
  return s;
}

/** P(X > Y) for two independent count distributions. */
function greater(a, b) {
  let s = 0;
  let cumB = 0;
  for (let i = 0; i < a.length; i++) {
    s += a[i] * cumB; // P(Y < i)
    if (i < b.length) cumB += b[i];
  }
  return s;
}

const clampP = (p) => (p == null || !Number.isFinite(p) ? null : Math.min(0.9999, Math.max(0.0001, p)));

// ------------------------------------------------------------------ goal views

function sumIf(sm, pred) {
  let s = 0;
  for (let i = 0; i <= M.MAX_GOALS; i++) for (let j = 0; j <= M.MAX_GOALS; j++) if (pred(i, j)) s += sm.m[i][j];
  return s;
}

function totalsOf(sm) {
  const d = new Array(2 * M.MAX_GOALS + 1).fill(0);
  for (let i = 0; i <= M.MAX_GOALS; i++) for (let j = 0; j <= M.MAX_GOALS; j++) d[i + j] += sm.m[i][j];
  return d;
}

/** Everything one goal view needs: full-match and per-half score matrices. */
function goalContext(view, timing) {
  const s1 = timing.s1;
  const sm = M.scoreMatrix(view.lamH, view.lamA, view.rho);
  const h1 = M.scoreMatrix(view.lamH * s1, view.lamA * s1, view.rho);
  const h2 = M.scoreMatrix(view.lamH * (1 - s1), view.lamA * (1 - s1), view.rho);
  return {
    sm,
    h1,
    h2,
    total: view.lamH + view.lamA,
    timing,
    cal: view.cal || null,
    memo: new Map(),
  };
}

function S(X, pred) {
  return sumIf(X.sm, pred);
}

/** Half-time lead and full-time win for one side, halves independent. */
function htft(X, home) {
  const lead = home ? (a, b) => a > b : (a, b) => b > a;
  let p = 0;
  for (let a = 0; a <= HALF_MAX; a++) {
    for (let b = 0; b <= HALF_MAX; b++) {
      const p1 = X.h1.m[a][b];
      if (!lead(a, b) || p1 < 1e-12) continue;
      for (let c = 0; c <= HALF_MAX; c++) for (let d = 0; d <= HALF_MAX; d++) if (lead(a + c, b + d)) p += p1 * X.h2.m[c][d];
    }
  }
  return p;
}

const winHalf = (hm, home) => sumIf(hm, home ? (a, b) => a > b : (a, b) => b > a);

/** Raw (matrix) probability of a goal-based selection under one view. */
function rawGoal(key, X) {
  if (X.memo.has(key)) return X.memo.get(key);
  let m;
  let p = null;
  switch (true) {
    case key === '1': p = S(X, (a, b) => a > b); break;
    case key === 'X': p = S(X, (a, b) => a === b); break;
    case key === '2': p = S(X, (a, b) => a < b); break;
    case key === '1X': p = S(X, (a, b) => a >= b); break;
    case key === 'X2': p = S(X, (a, b) => a <= b); break;
    case key === '12': p = S(X, (a, b) => a !== b); break;
    case key === 'BTTS_Y': p = S(X, (a, b) => a > 0 && b > 0); break;
    case key === 'BTTS_N': p = S(X, (a, b) => a === 0 || b === 0); break;
    case (m = /^([OU])(\d\.5)$/.exec(key)) !== null: {
      const l = Number(m[2]);
      p = m[1] === 'O' ? S(X, (a, b) => a + b > l) : S(X, (a, b) => a + b < l);
      break;
    }
    case (m = /^TT([HA])_([OU])(\d\.5)$/.exec(key)) !== null: {
      const l = Number(m[3]);
      const g = m[1] === 'H' ? (a) => a : (_a, b) => b;
      p = m[2] === 'O' ? S(X, (a, b) => g(a, b) > l) : S(X, (a, b) => g(a, b) < l);
      break;
    }
    case key === 'H1_O0.5': p = 1 - X.h1.m[0][0]; break;
    case key === 'H1_U1.5': p = X.h1.m[0][0] + X.h1.m[1][0] + X.h1.m[0][1]; break;
    case key === 'H2_O0.5': p = 1 - X.h2.m[0][0]; break;
    case key === 'H2_O1.5': p = 1 - (X.h2.m[0][0] + X.h2.m[1][0] + X.h2.m[0][1]); break;
    case key === 'HT_1': p = winHalf(X.h1, true); break;
    case key === 'HT_2': p = winHalf(X.h1, false); break;
    case key === 'HT_X': p = 1 - winHalf(X.h1, true) - winHalf(X.h1, false); break;
    case key === 'HSH_2': p = greater(totalsOf(X.h2), totalsOf(X.h1)); break;
    case key === 'M15_Y': p = 1 - Math.exp(-X.total * X.timing.s15); break;
    case key === 'M15_N': p = Math.exp(-X.total * X.timing.s15); break;
    case key === 'M30_Y': p = 1 - Math.exp(-X.total * X.timing.s30); break;
    case key === 'M30_N': p = Math.exp(-X.total * X.timing.s30); break;
    case key === 'WEH_H': p = 1 - (1 - winHalf(X.h1, true)) * (1 - winHalf(X.h2, true)); break;
    case key === 'WEH_A': p = 1 - (1 - winHalf(X.h1, false)) * (1 - winHalf(X.h2, false)); break;
    case key === 'WBH_H': p = winHalf(X.h1, true) * winHalf(X.h2, true); break;
    case key === 'WBH_A': p = winHalf(X.h1, false) * winHalf(X.h2, false); break;
    case key === 'WO15_H': p = S(X, (a, b) => a > b && a + b >= 2); break;
    case key === 'WO15_A': p = S(X, (a, b) => b > a && a + b >= 2); break;
    case key === 'WTN_H': p = S(X, (a, b) => a > b && b === 0); break;
    case key === 'WTN_A': p = S(X, (a, b) => b > a && a === 0); break;
    case key === 'GG_O2.5': p = S(X, (a, b) => a > 0 && b > 0 && a + b >= 3); break;
    case key === 'DC1X_U3.5': p = S(X, (a, b) => a >= b && a + b <= 3); break;
    case key === 'DCX2_U3.5': p = S(X, (a, b) => b >= a && a + b <= 3); break;
    case key === 'DC1X_O1.5': p = S(X, (a, b) => a >= b && a + b >= 2); break;
    case key === 'DCX2_O1.5': p = S(X, (a, b) => b >= a && a + b >= 2); break;
    case key === 'HTFT_HH': p = htft(X, true); break;
    case key === 'HTFT_AA': p = htft(X, false); break;
    default: p = null;
  }
  X.memo.set(key, p);
  return p;
}

// Joint selections that are a subset of a calibrated parent are scaled by the parent's
// calibration, so (for example) "home win and over 1.5" can never exceed "home win".
const PARENT = {
  WO15_H: '1', WTN_H: '1', WBH_H: '1', HTFT_HH: '1',
  WO15_A: '2', WTN_A: '2', WBH_A: '2', HTFT_AA: '2',
  'DC1X_U3.5': '1X', 'DC1X_O1.5': '1X', 'DCX2_U3.5': 'X2', 'DCX2_O1.5': 'X2',
  'GG_O2.5': 'BTTS_Y',
};

/** Probability of a goal-based selection under one view (calibrated where a calibration exists). */
function goalProb(key, X) {
  const cal = X.cal;
  if (cal && cal[key] != null && Number.isFinite(cal[key])) return cal[key];
  const raw = rawGoal(key, X);
  if (raw == null) return null;
  const parent = PARENT[key];
  if (parent && cal && cal[parent] != null) {
    const rp = rawGoal(parent, X);
    if (rp > 1e-9) return Math.min(cal[parent], raw * (cal[parent] / rp));
  }
  return raw;
}

// ------------------------------------------------------------------ selection catalogue

const GOAL_KEYS = {
  Goals: ['O1.5', 'O2.5', 'O3.5', 'U1.5', 'U2.5', 'U3.5', 'BTTS_Y', 'BTTS_N'],
  Team: ['TTH_O0.5', 'TTH_O1.5', 'TTH_O2.5', 'TTH_U1.5', 'TTH_U2.5', 'TTA_U0.5',
    'TTA_O0.5', 'TTA_O1.5', 'TTA_O2.5', 'TTA_U1.5', 'TTA_U2.5', 'TTH_U0.5'],
  Match: ['1', 'X', '2', '1X', 'X2', '12'],
  Half: ['H1_O0.5', 'H1_U1.5', 'H2_O0.5', 'H2_O1.5', 'HT_1', 'HT_X', 'HT_2', 'HSH_2'],
  Minutes: ['M15_Y', 'M15_N', 'M30_Y', 'M30_N'],
  Special: ['WEH_H', 'WEH_A', 'WBH_H', 'WBH_A', 'WO15_H', 'WO15_A', 'WTN_H', 'WTN_A', 'GG_O2.5',
    'DC1X_U3.5', 'DCX2_U3.5', 'DC1X_O1.5', 'DCX2_O1.5', 'HTFT_HH', 'HTFT_AA'],
};
const CORNER_LINES = [7.5, 8.5, 9.5, 10.5, 11.5];
const CORNER_TEAM_LINES = { H: [3.5, 4.5, 5.5], A: [2.5, 3.5, 4.5] };
const CARD_LINES = [2.5, 3.5, 4.5, 5.5];

function label(key, H, A) {
  let m;
  const name = (s) => (s === 'H' ? H : A);
  switch (true) {
    case key === '1': return `${H} to win`;
    case key === 'X': return 'Draw';
    case key === '2': return `${A} to win`;
    case key === '1X': return `${H} or draw`;
    case key === 'X2': return `${A} or draw`;
    case key === '12': return `${H} or ${A} (no draw)`;
    case key === 'BTTS_Y': return 'Both teams to score';
    case key === 'BTTS_N': return 'Both teams to score: No';
    case (m = /^([OU])(\d\.5)$/.exec(key)) !== null: return `${m[1] === 'O' ? 'Over' : 'Under'} ${m[2]} goals`;
    case key === 'TTA_U0.5': return `${H} clean sheet`;
    case key === 'TTH_U0.5': return `${A} clean sheet`;
    case (m = /^TT([HA])_([OU])(\d\.5)$/.exec(key)) !== null: return `${name(m[1])} ${m[2] === 'O' ? 'over' : 'under'} ${m[3]} goals`;
    case key === 'H1_O0.5': return '1st half over 0.5 goals';
    case key === 'H1_U1.5': return '1st half under 1.5 goals';
    case key === 'H2_O0.5': return '2nd half over 0.5 goals';
    case key === 'H2_O1.5': return '2nd half over 1.5 goals';
    case key === 'HT_1': return `Half-time: ${H}`;
    case key === 'HT_X': return 'Half-time: Draw';
    case key === 'HT_2': return `Half-time: ${A}`;
    case key === 'HSH_2': return 'Highest scoring half: 2nd';
    case key === 'M15_Y': return 'Goal in minutes 1-15: Yes';
    case key === 'M15_N': return 'Goal in minutes 1-15: No';
    case key === 'M30_Y': return 'Goal in minutes 1-30: Yes';
    case key === 'M30_N': return 'Goal in minutes 1-30: No';
    case key === 'WEH_H': return `${H} to win either half`;
    case key === 'WEH_A': return `${A} to win either half`;
    case key === 'WBH_H': return `${H} to win both halves`;
    case key === 'WBH_A': return `${A} to win both halves`;
    case key === 'WO15_H': return `${H} to win & over 1.5 goals`;
    case key === 'WO15_A': return `${A} to win & over 1.5 goals`;
    case key === 'WTN_H': return `${H} to win to nil`;
    case key === 'WTN_A': return `${A} to win to nil`;
    case key === 'GG_O2.5': return 'Both teams score & over 2.5';
    case key === 'DC1X_U3.5': return `${H} or draw & under 3.5`;
    case key === 'DCX2_U3.5': return `${A} or draw & under 3.5`;
    case key === 'DC1X_O1.5': return `${H} or draw & over 1.5`;
    case key === 'DCX2_O1.5': return `${A} or draw & over 1.5`;
    case key === 'HTFT_HH': return `Half-time/full-time: ${H}/${H}`;
    case key === 'HTFT_AA': return `Half-time/full-time: ${A}/${A}`;
    case (m = /^C_([OU])(\d+\.5)$/.exec(key)) !== null: return `${m[1] === 'O' ? 'Over' : 'Under'} ${m[2]} corners`;
    case key === 'C_MOST_H': return `${H} most corners`;
    case key === 'C_MOST_A': return `${A} most corners`;
    case (m = /^C([HA])_O(\d+\.5)$/.exec(key)) !== null: return `${name(m[1])} over ${m[2]} corners`;
    case (m = /^K_([OU])(\d+\.5)$/.exec(key)) !== null: return `${m[1] === 'O' ? 'Over' : 'Under'} ${m[2]} cards`;
    default: return key;
  }
}

/** Which side a selection backs: 'home', 'away', 'both' (needs goals from both) or null. */
function sideOf(key) {
  if (/^PL_H_/.test(key)) return 'home';
  if (/^PL_A_/.test(key)) return 'away';
  if (['1', '1X', 'HT_1', 'WEH_H', 'WBH_H', 'WO15_H', 'WTN_H', 'HTFT_HH', 'DC1X_U3.5', 'DC1X_O1.5', 'C_MOST_H', 'TTA_U0.5'].includes(key)) return 'home';
  if (['2', 'X2', 'HT_2', 'WEH_A', 'WBH_A', 'WO15_A', 'WTN_A', 'HTFT_AA', 'DCX2_U3.5', 'DCX2_O1.5', 'C_MOST_A', 'TTH_U0.5'].includes(key)) return 'away';
  if (/^TTH_O/.test(key) || /^CH_O/.test(key)) return 'home';
  if (/^TTA_O/.test(key) || /^CA_O/.test(key)) return 'away';
  if (/^O\d/.test(key) || key === 'BTTS_Y' || key === 'GG_O2.5' || /^H[12]_O/.test(key) || /_Y$/.test(key)) return 'both';
  return null;
}

// ------------------------------------------------------------------ assembling selections

const MAIN_ORDER = { goals: ['market', 'factors', 'stats'], corners: ['model', 'season', 'recent'], cards: ['model', 'season', 'recent'], players: ['market', 'stats'] };

/**
 * One priced selection.
 *   views     each view's own probability
 *   floor     the lowest view (the agreement check)
 *   raw       the main view's probability
 *   prob      the MEASURED chance when the market has a measured calibration
 *             (lib/strongest/calibrate.js), otherwise the main view; `measured` says which
 */
function make(key, group, lab, views, kind, extra) {
  const vals = Object.entries(views).filter(([, p]) => p != null && Number.isFinite(p));
  if (!vals.length) return null;
  const vmap = Object.fromEntries(vals.map(([n, p]) => [n, clampP(p)]));
  const mainName = MAIN_ORDER[kind].find((n) => vmap[n] != null) || vals[0][0];
  const raw = vmap[mainName];
  let chance = null;
  if (kind === 'goals') chance = CAL.goalChance(key, vmap);
  else if ((kind === 'corners' || kind === 'cards') && vmap.model != null) chance = CAL.statsChance(key, vmap.model);
  const prob = chance != null && Number.isFinite(chance) ? clampP(chance) : raw;
  const floor = Math.min(...Object.values(vmap));
  return {
    key,
    group,
    label: lab,
    kind,
    side: sideOf(key),
    prob,
    raw,
    measured: chance != null && Number.isFinite(chance),
    floor,
    main: mainName,
    views: vmap,
    nViews: Object.keys(vmap).length,
    fair: 1 / prob,
    ...(extra || {}),
  };
}

/**
 * Price every selection of the nine groups for one fixture.
 *
 * @param {object} fx
 * @param {{home:string, away:string}} fx.names
 * @param {Array<{name:string, lamH:number, lamA:number, rho:number, cal?:Object}>} fx.goalViews
 * @param {{s1:number, s15:number, s30:number}} fx.timing
 * @param {Array<{name:string, home:number, away:number, r:number}>} [fx.cornerViews]
 * @param {Array<{name:string, mu:number, r:number}>} [fx.cardViews]
 * @param {Array<{name:string, side:'home'|'away', share:number, involvement:number}>} [fx.players]
 * @returns {object[]} selections
 */
function price(fx) {
  const H = fx.names.home;
  const A = fx.names.away;
  const out = [];
  const timing = fx.timing || defaultTiming();

  // ---- goal-based groups
  const views = (fx.goalViews || []).filter((v) => v && v.lamH > 0 && v.lamA > 0);
  const ctxs = views.map((v) => ({ name: v.name, X: goalContext(v, timing), view: v }));
  if (ctxs.length) {
    for (const [group, keys] of Object.entries(GOAL_KEYS)) {
      for (const key of keys) {
        const vs = {};
        for (const c of ctxs) vs[c.name] = goalProb(key, c.X);
        const s = make(key, group, label(key, H, A), vs, 'goals');
        if (s) out.push(s);
      }
    }
  }

  // ---- corners
  const cvs = (fx.cornerViews || []).filter((v) => v && v.home > 0 && v.away > 0);
  if (cvs.length) {
    const d = cvs.map((v) => {
      const ph = nbPmf(v.home, v.r);
      const pa = nbPmf(v.away, v.r);
      return { name: v.name, ph, pa, tot: convolve(ph, pa) };
    });
    const each = (f) => Object.fromEntries(d.map((x) => [x.name, f(x)]));
    const extra = { expected: Object.fromEntries(cvs.map((v) => [v.name, { home: v.home, away: v.away, total: v.home + v.away }])) };
    for (const l of CORNER_LINES) {
      out.push(make(`C_O${l}`, 'Corners', label(`C_O${l}`, H, A), each((x) => over(x.tot, l)), 'corners', extra));
      out.push(make(`C_U${l}`, 'Corners', label(`C_U${l}`, H, A), each((x) => 1 - over(x.tot, l)), 'corners', extra));
    }
    out.push(make('C_MOST_H', 'Corners', label('C_MOST_H', H, A), each((x) => greater(x.ph, x.pa)), 'corners', extra));
    out.push(make('C_MOST_A', 'Corners', label('C_MOST_A', H, A), each((x) => greater(x.pa, x.ph)), 'corners', extra));
    for (const l of CORNER_TEAM_LINES.H) out.push(make(`CH_O${l}`, 'Corners', label(`CH_O${l}`, H, A), each((x) => over(x.ph, l)), 'corners', extra));
    for (const l of CORNER_TEAM_LINES.A) out.push(make(`CA_O${l}`, 'Corners', label(`CA_O${l}`, H, A), each((x) => over(x.pa, l)), 'corners', extra));
  }

  // ---- bookings (cards shown: each yellow and each red counts one)
  const kvs = (fx.cardViews || []).filter((v) => v && v.mu > 0);
  if (kvs.length) {
    const d = kvs.map((v) => ({ name: v.name, pmf: nbPmf(v.mu, v.r) }));
    const each = (f) => Object.fromEntries(d.map((x) => [x.name, f(x)]));
    const extra = { expected: Object.fromEntries(kvs.map((v) => [v.name, { total: v.mu }])) };
    for (const l of CARD_LINES) {
      out.push(make(`K_O${l}`, 'Bookings', label(`K_O${l}`, H, A), each((x) => over(x.pmf, l)), 'cards', extra));
      out.push(make(`K_U${l}`, 'Bookings', label(`K_U${l}`, H, A), each((x) => 1 - over(x.pmf, l)), 'cards', extra));
    }
  }

  // ---- players (anytime scorer)
  if (ctxs.length) {
    (fx.players || []).forEach((pl, i) => {
      if (!pl || !(pl.share > 0) || !(pl.involvement > 0)) return;
      const vs = {};
      for (const c of ctxs) {
        if (c.name !== 'market' && c.name !== 'stats') continue;
        const lam = pl.side === 'home' ? c.view.lamH : c.view.lamA;
        vs[c.name] = 1 - Math.exp(-lam * Math.min(C.maxShare, pl.share) * pl.involvement);
      }
      if (!Object.keys(vs).length) {
        const c = ctxs[0];
        const lam = pl.side === 'home' ? c.view.lamH : c.view.lamA;
        vs.market = 1 - Math.exp(-lam * Math.min(C.maxShare, pl.share) * pl.involvement);
      }
      const key = `PL_${pl.side === 'home' ? 'H' : 'A'}_${i}`;
      const s = make(key, 'Players', `${pl.name} to score`, vs, 'players', { player: { ...pl } });
      if (s) out.push(s);
    });
  }

  return out.filter(Boolean);
}

function defaultTiming(s1 = C.firstHalfShare) {
  return { s1, s15: s1 * C.min15OfFirstHalf, s30: s1 * C.min30OfFirstHalf };
}

module.exports = { price, label, sideOf, nbPmf, convolve, over, greater, goalProb, rawGoal, goalContext, defaultTiming, GROUPS, GOAL_KEYS, CORNER_LINES, CARD_LINES, PARENT };
