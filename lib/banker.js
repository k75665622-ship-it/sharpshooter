'use strict';

/**
 * banker.js — the High Banker: the day's safest selections, and the slip they make at 3.0+ odds.
 *
 * A selection becomes a BANKER only when every check below passes. Each check is a separate
 * question, so the page can say exactly why a pick is in — or why a strong-looking one is not.
 *
 *   1  DATA       a real bookmaker price, most of the 184 factors measurable, a decent history
 *                 for both teams (live: and a league match — not a cup or cross-league tie)
 *   2  STRENGTH   the v6 model rates it very likely AND the bookmakers' own price agrees
 *   3  NO TRAP    the factors do not rate it below the price, it is not on the match's
 *                 "avoid" list and no confirmed trap rule fires on it
 *   4  AGREES     it is the normal prediction's main pick, its safer pick, or a safer form of
 *                 the main pick — the same view the rest of the site gives for the match
 *   5  TRENDS     no red flag in either team's recent record, the head-to-head or the
 *                 patterns the research measured (form slump, opponent on fire, bogey fixture,
 *                 both sides failing to score, ...)
 *   6  PRICE      it still pays something (odds of at least 1.15) — a 1.05 "banker" adds
 *                 risk faster than it adds odds
 *   7  LIVE       (site only) not kicked off, no heavy team-news risk, the price is not
 *                 drifting against it
 *   +  METHODOLOGY  when one of the site's market methodologies also qualifies it, the
 *                 banker is marked "triple-confirmed" and ranks higher
 *
 * The slip: the most likely combination of bankers (one per match) whose odds reach the
 * target (3.0). No upper limit — every banker of the day is also listed, with the odds and
 * chance of taking them all. When the day's bankers cannot reach the target, there is no
 * slip: weaker picks are never added to make up the odds. The safer slip is the same
 * construction at 2.0: fewer legs, so it lands more often (measured beside the main slip).
 *
 * Every threshold is in CFG and was chosen on the 2019-23 seasons, then measured once on
 * 2023-26 (research/v6/banker_study.js). That measured record is lib/banker_record.json and
 * is shown on the page beside the picks.
 */

const D = require('./intel/decision');
const CAL = require('./strongest/calibrate');

const CFG = {
  version: '1.0',
  target: 3.0,
  // Also built from the same bankers: the most likely slip at 2.0+, for days you want fewer things
  // to go wrong. Every leg is a chance to lose, so fewer legs land more often: on 2019-23 the 2.0+
  // slip (about 3 legs) landed 49% of days that had one, the 3.0+ slip (about 5 legs) 36%.
  safer: 2.0,
  bigger: [5, 10, 20], // also shown: the most likely slip at each of these when the day's bankers reach it
  // markets a banker may use: all common on Ghanaian betting sites, all settled on the final score
  keys: ['1', '2', '1X', 'X2', 'DNB_H', 'DNB_A', 'O1.5', 'O2.5', 'U2.5', 'U3.5', 'BTTS_Y', 'BTTS_N', 'TTH_O0.5', 'TTA_O0.5', 'TTH_O1.5', 'TTA_O1.5'],
  // Chosen on 2019-23 (research/v6/banker_study.js): the most winning slips per 100 days among
  // settings whose legs AND slips win at least as often as stated. Stricter bars were tested:
  // 85%-sure legs need 6-7 per slip, so the slip lands no more often and exists on far fewer days.
  minProb: 0.74, // the v6 model's probability
  minBase: 0.72, // the bookmakers' own (margin-free) probability
  minShift: -0.005, // v6 - price: the factors may not rate it below the price
  maxShift: 0.08, // nor wildly above it (a big disagreement is a data question, not a banker)
  minOdds: 1.15, // shorter legs add risk faster than they add odds (tested 1.05-1.25)
  maxOdds: 1.6,
  minCoverage: 0.6, // share of the factors that could be measured
  minGames: 10, // live: archive games for each team
  requireDecision: true,
  redFlags: true,
  margin: 0.06, // assumed bookmaker margin when a market has no quoted price (estimate shown as ≈)
  maxDrift: 0.08, // live: price moved 8%+ against the selection since it opened
  // v2 (research/v6/banker_pace.js): each leg's chance is its MEASURED chance (the Strongest
  // Picks calibration, lib/strongest/calibrate.js) where one exists, and the possession model
  // (lib/pace.js: shots a game x goals per shot) may not rate a leg more than paceGap below
  // the bookmakers. null switches the possession check off.
  useMeasured: false,
  paceGap: null,
};

/** Factor values the red-flag checks read (also dumped by research/v6/banker_dump.js). */
const TREND_FACTORS = [
  'h_ppg5', 'h_ppg10', 'h_ppgV5', 'a_ppg5', 'a_ppg10', 'a_ppgV5',
  'h_o25r', 'a_o25r', 'h_bttsr', 'a_bttsr', 'h_csr', 'a_csr', 'h_ftsr', 'a_ftsr',
  'h_gf10', 'h_ga10', 'a_gf10', 'a_ga10', 'h_played', 'a_played', 'h_lst', 'a_lst',
  'h2hN', 'h2hPpg', 'h2hGoals', 'h2hDraw', 'eloExp', 'p1', 'pX', 'p2', 'pO25',
];

const HOME_KEYS = new Set(['1', '1X', 'DNB_H']);
const AWAY_KEYS = new Set(['2', 'X2', 'DNB_A']);
const OVER_KEYS = new Set(['O1.5', 'O2.5', 'BTTS_Y', 'TTH_O0.5', 'TTA_O0.5', 'TTH_O1.5', 'TTA_O1.5']);
const UNDER_KEYS = new Set(['U2.5', 'U3.5', 'BTTS_N']);

const ge = (v, t) => v != null && v >= t;
const le = (v, t) => v != null && v <= t;
const pct = (v) => `${Math.round(v * 100)}%`;
const f2 = (v) => (Math.round(v * 100) / 100).toFixed(2);

let RULES = null;
function ruleVerdicts() {
  if (RULES) return RULES;
  try {
    RULES = require('./intel/rules.json').rules || {};
  } catch {
    RULES = {};
  }
  return RULES;
}

/**
 * How a measured pattern bears on a selection: < 0 against it, > 0 for it, 0 unrelated.
 * Only patterns whose direction held in BOTH research periods (trap / edge / weak) count.
 */
function patternEffect(id, key, f) {
  const v = ruleVerdicts()[id];
  if (!v || !['trap', 'edge', 'weak'].includes(v.status)) return 0;
  const gap = (v.discovery.gap + v.confirm.gap) / 2; // won - price said, for the rule's own selection
  const favHome = f.p1 != null && f.p2 != null ? f.p1 >= f.p2 : null;
  let sign = 0;
  if (v.selection === 'fav' || v.selection === 'dog') {
    if (favHome == null) return 0;
    const favSide = favHome ? 'H' : 'A';
    const ruleSide = v.selection === 'fav' ? favSide : favSide === 'H' ? 'A' : 'H';
    const keySide = HOME_KEYS.has(key) ? 'H' : AWAY_KEYS.has(key) ? 'A' : null;
    if (!keySide) return 0;
    sign = keySide === ruleSide ? 1 : -1;
  } else if (v.selection === 'over') sign = OVER_KEYS.has(key) ? 1 : UNDER_KEYS.has(key) ? -1 : 0;
  else if (v.selection === 'under') sign = UNDER_KEYS.has(key) ? 1 : OVER_KEYS.has(key) ? -1 : 0;
  else if (v.selection === 'draw') sign = key === '1X' || key === 'X2' ? 1 : HOME_KEYS.has(key) || AWAY_KEYS.has(key) ? -1 : 0;
  return sign * gap;
}

/**
 * Red flags in the teams' records for a selection: plain-English reasons not to trust it.
 * @param {string} key
 * @param {object} f   factor values (TREND_FACTORS)
 * @param {{home:string, away:string}} n
 * @param {string[]} [patterns]  ids of the patterns that fire
 */
function redFlags(key, f, n, patterns) {
  const out = [];
  const H = n.home;
  const A = n.away;
  const home = HOME_KEYS.has(key);
  const away = AWAY_KEYS.has(key);
  if (home || away) {
    const us = home ? 'h' : 'a';
    const them = home ? 'a' : 'h';
    const U = home ? H : A;
    const T = home ? A : H;
    const strict = key === '1' || key === '2' || /^DNB/.test(key); // a win is needed (or a draw voids it)
    if (le(f[`${us}_ppg5`], 1.0)) out.push(`${U} have taken ${f2(f[`${us}_ppg5`])} points a game from their last 5`);
    if (ge(f[`${them}_ppg5`], strict ? 2.2 : 2.4)) out.push(`${T} are in form: ${f2(f[`${them}_ppg5`])} points a game from their last 5`);
    if (le(f[`${us}_ppgV5`], strict ? 1.2 : 0.8)) out.push(`${U} have taken only ${f2(f[`${us}_ppgV5`])} points a game from their last 5 ${home ? 'home' : 'away'} games`);
    if (ge(f[`${them}_ppgV5`], strict ? 2.2 : 2.4)) out.push(`${T} have taken ${f2(f[`${them}_ppgV5`])} points a game from their last 5 ${home ? 'away' : 'home'} games`);
    const h2hPpgUs = f.h2hPpg == null ? null : home ? f.h2hPpg : 3 - f.h2hPpg - (f.h2hDraw || 0);
    if (le(h2hPpgUs, 0.8) && ge(f.h2hN, 3)) out.push(`${U} have a poor head-to-head record against ${T} (${f2(h2hPpgUs)} points a game, ${f.h2hN} meetings)`);
    if (strict && ge(f.h2hDraw, 0.5) && ge(f.h2hN, 4)) out.push(`half or more of the last ${f.h2hN} meetings were draws`);
    if (strict && f.eloExp != null) {
      const eloUs = home ? f.eloExp : 1 - f.eloExp;
      const priceUs = home ? f.p1 : f.p2;
      if (priceUs != null && eloUs - priceUs <= -0.1) out.push(`the Elo ratings give ${U} ${Math.round((priceUs - eloUs) * 100)} points less than the price does`);
    }
  }
  if (key === 'O1.5' || key === 'O2.5' || key === 'BTTS_Y') {
    if (ge(f.h_ftsr, 0.35) && ge(f.a_ftsr, 0.35)) out.push(`both teams failed to score in 35%+ of their last 10 (${pct(f.h_ftsr)} and ${pct(f.a_ftsr)})`);
    if (le(f.h_o25r, 0.3) && le(f.a_o25r, 0.3)) out.push(`both teams' last 10 games were mostly low-scoring (over 2.5 in ${pct(f.h_o25r)} and ${pct(f.a_o25r)})`);
    if (le(f.h2hGoals, key === 'O1.5' ? 1.6 : 2.0) && ge(f.h2hN, 3)) out.push(`the last ${f.h2hN} meetings averaged ${f2(f.h2hGoals)} goals`);
  }
  if (key === 'O2.5' && (le(f.h_o25r, 0.4) || le(f.a_o25r, 0.4))) out.push(`one side's games rarely go over 2.5 (${pct(Math.min(f.h_o25r == null ? 1 : f.h_o25r, f.a_o25r == null ? 1 : f.a_o25r))} of the last 10)`);
  if (key === 'BTTS_Y') {
    if (ge(f.h_ftsr, 0.35) || ge(f.a_ftsr, 0.35)) out.push(`${ge(f.h_ftsr, 0.35) ? H : A} failed to score in ${pct(Math.max(f.h_ftsr || 0, f.a_ftsr || 0))} of their last 10`);
    if (ge(f.h_csr, 0.45) || ge(f.a_csr, 0.45)) out.push(`${ge(f.h_csr, 0.45) ? H : A} kept a clean sheet in ${pct(Math.max(f.h_csr || 0, f.a_csr || 0))} of their last 10`);
  }
  if (key === 'U2.5' || key === 'U3.5' || key === 'BTTS_N') {
    if (ge(f.h_o25r, 0.7) && ge(f.a_o25r, 0.7)) out.push(`both teams' last 10 games mostly went over 2.5 (${pct(f.h_o25r)} and ${pct(f.a_o25r)})`);
    if (ge(f.h2hGoals, key === 'U3.5' ? 3.5 : 3.0) && ge(f.h2hN, 3)) out.push(`the last ${f.h2hN} meetings averaged ${f2(f.h2hGoals)} goals`);
  }
  if (key === 'BTTS_N' && ge(f.h_bttsr, 0.65) && ge(f.a_bttsr, 0.65)) out.push(`both teams scored in 65%+ of each side's last 10 (${pct(f.h_bttsr)} and ${pct(f.a_bttsr)})`);
  if (key === 'TTH_O0.5' || key === 'TTH_O1.5') {
    if (ge(f.h_ftsr, 0.35)) out.push(`${H} failed to score in ${pct(f.h_ftsr)} of their last 10`);
    if (ge(f.a_csr, 0.45)) out.push(`${A} kept a clean sheet in ${pct(f.a_csr)} of their last 10`);
  }
  if (key === 'TTA_O0.5' || key === 'TTA_O1.5') {
    if (ge(f.a_ftsr, 0.35)) out.push(`${A} failed to score in ${pct(f.a_ftsr)} of their last 10`);
    if (ge(f.h_csr, 0.45)) out.push(`${H} kept a clean sheet in ${pct(f.h_csr)} of their last 10`);
  }
  for (const id of patterns || []) {
    const e = patternEffect(id, key, f);
    if (e <= -0.008) out.push(`measured pattern against it: ${(ruleVerdicts()[id] || {}).desc || id}`);
  }
  return out;
}

/** The price a leg is shown at: the best quoted price, else the reference book, else an estimate. */
function priceOf(x, key, cfg) {
  const q = x.pr && x.pr[key];
  if (q && (q[1] > 1 || q[0] > 1)) return { odds: q[1] > 1 ? q[1] : q[0], ref: q[0] > 1 ? q[0] : null, estimated: false };
  const b = x.base ? x.base[key] : null;
  if (b == null) return null;
  const m = x.ovrOU != null && x.ovrOU > 0 && x.ovrOU < 0.15 ? x.ovrOU : cfg.margin;
  return { odds: Math.max(1.01, 1 / (b * (1 + m))), ref: null, estimated: true };
}

/** Is `key` the main pick, the safer pick, or guaranteed by the main pick? */
function agreesWithDecision(x, key) {
  if (!x.main) return null;
  if (key === x.main) return 'main';
  if (key === x.safer) return 'safer';
  if (D.implies(x.main, key)) return 'safer';
  return null;
}

/** Methodologies (PREDICT / LOCK) whose selection guarantees this one. */
function methodsFor(x, key) {
  return (x.m || []).filter((m) => (m.status === 'PREDICT' || m.status === 'LOCK') && m.key && (m.key === key || D.implies(m.key, key)));
}

/**
 * Every check for one selection.
 * @returns {{key, pass:boolean, failed:string|null, checks:object[], prob, base, shift, price, flags, methods, agreement}}
 */
function check(x, key, cfg = CFG) {
  const measured = cfg.useMeasured && x.mc && x.mc[key] != null ? x.mc[key] : null;
  const prob = measured != null ? measured : x.p ? x.p[key] : null;
  const base = x.base ? x.base[key] : null;
  const shift = prob != null && base != null ? prob - base : null;
  const price = priceOf(x, key, cfg);
  const names = { home: x.home, away: x.away };
  const live = x.live || {};
  const checks = [];
  const add = (id, ok, text) => checks.push({ id, ok: !!ok, text });

  add('data', base != null && (x.cov == null || x.cov >= cfg.minCoverage)
    && (live.games == null || (live.games.home >= cfg.minGames && live.games.away >= cfg.minGames))
    && !live.crossLeague,
    base == null ? 'no bookmaker price'
      : live.crossLeague ? 'cup or cross-league tie'
        : live.games && (live.games.home < cfg.minGames || live.games.away < cfg.minGames) ? `only ${Math.min(live.games.home, live.games.away)} archived games for one side`
          : x.cov != null && x.cov < cfg.minCoverage ? `only ${pct(x.cov)} of the factors could be measured`
            : `bookmaker price and ${x.cov != null ? pct(x.cov) : 'most'} of the factors measured`);
  add('strength', prob != null && prob >= cfg.minProb && base != null && base >= cfg.minBase,
    prob == null ? 'not rated' : `${measured != null ? 'measured chance' : 'model'} ${pct(prob)}, bookmakers ${base != null ? pct(base) : '—'} (needs ${pct(cfg.minProb)} and ${pct(cfg.minBase)})`);
  if (cfg.paceGap != null) {
    // the possession model (shots a game x goals per shot) must not see it well below the price
    const pv = x.pv ? x.pv[key] : null;
    const mv = x.mv && x.mv[key] != null ? x.mv[key] : base;
    const ok = pv == null || mv == null || pv >= mv - cfg.paceGap;
    add('possession', ok, pv == null ? 'no shot data for the possession model — not used'
      : ok ? `the possession model agrees (${pct(pv)} against the bookmakers' ${pct(mv)})`
        : `the possession model rates it only ${pct(pv)} against the bookmakers' ${pct(mv)} — the teams' shots and finishing do not back it`);
  }
  const avoided = (x.avoid || []).includes(key);
  add('trap', shift != null && shift >= cfg.minShift && shift <= cfg.maxShift && !avoided,
    avoided ? 'on the match\'s avoid list'
      : shift == null ? 'no price to compare'
        : shift < cfg.minShift ? `the factors rate it ${Math.abs(Math.round(shift * 1000) / 10)} points below the price — the price overrates it`
          : shift > cfg.maxShift ? `the model is ${Math.round(shift * 1000) / 10} points above the price — too big a disagreement to bank on`
            : `price and factors agree (${shift >= 0 ? '+' : ''}${Math.round(shift * 1000) / 10} points)`);
  const agreement = agreesWithDecision(x, key);
  add('agrees', !cfg.requireDecision || agreement, agreement === 'main' ? 'it is the normal prediction\'s main pick'
    : agreement ? `a safer form of the normal prediction's main pick (${D.label(x.main, x.home, x.away)})`
      : x.main ? `the normal prediction's main pick is ${D.label(x.main, x.home, x.away)} — a different view of the match` : 'the normal prediction makes no main pick for this match');
  const flags = cfg.redFlags ? redFlags(key, x.f || {}, names, x.pat) : [];
  add('trends', flags.length === 0, flags.length ? flags[0] : 'no red flag in form, venue form, head-to-head, scoring trends or measured patterns');
  add('price', price && price.odds >= cfg.minOdds && price.odds <= cfg.maxOdds,
    !price ? 'no price' : price.odds < cfg.minOdds ? `pays only ${f2(price.odds)} — too short to add anything` : price.odds > cfg.maxOdds ? `pays ${f2(price.odds)} — too long to be a banker` : `${price.estimated ? '≈' : ''}${f2(price.odds)}`);
  if (x.live) {
    const lv = [];
    if (live.started) lv.push('already kicked off');
    // team news: a confirmed absence on the side the selection depends on
    const sides = HOME_KEYS.has(key) || /^TTH_/.test(key) ? ['home'] : AWAY_KEYS.has(key) || /^TTA_/.test(key) ? ['away'] : OVER_KEYS.has(key) ? ['home', 'away'] : [];
    const hurt = sides.filter((sd) => live.news && live.news[sd] === 'high');
    if (hurt.length && (OVER_KEYS.has(key) && sides.length === 2 ? hurt.length === 2 : true)) lv.push(`confirmed absence reported for ${hurt.map((sd) => (sd === 'home' ? x.home : x.away)).join(' and ')}`);
    // the price on this side lengthening since it opened = money going the other way
    const mv = live.moves || {};
    const side = HOME_KEYS.has(key) ? 'home' : AWAY_KEYS.has(key) ? 'away' : OVER_KEYS.has(key) ? 'over' : UNDER_KEYS.has(key) ? 'under' : null;
    const drift = side && mv[side] != null ? mv[side] : null;
    if (drift != null && drift >= cfg.maxDrift) lv.push(`the price has drifted ${Math.round(drift * 100)}% longer since it opened`);
    add('live', lv.length === 0, lv.length ? lv.join('; ') : 'not started, no confirmed absence, price not drifting');
  }
  const methods = methodsFor(x, key);
  const failed = checks.find((c) => !c.ok);
  return { key, pass: !failed, failed: failed ? failed.id : null, checks, prob, base, shift, price, flags, methods, agreement };
}

/** Ranking among a match's passing selections, and among the day's bankers. */
function score(c) {
  return c.prob + (c.methods.length ? 0.01 : 0) + (c.agreement === 'main' ? 0.005 : 0);
}

/**
 * The banker for one match (or null), plus its strongest near miss for the page.
 * @param {object} x  the match input (see fromReport / research/v6/banker_dump.js)
 */
function forMatch(x, cfg = CFG) {
  const all = cfg.keys.filter((k) => x.p && x.p[k] != null).map((k) => check(x, k, cfg));
  const pass = all.filter((c) => c.pass).sort((a, b) => score(b) - score(a));
  const best = pass[0] || null;
  // the most likely selection that looked like a banker — strong enough AND paying enough — but
  // failed another check (a trap, a red flag, a disagreement, a late change); "too short" is not a near miss
  const near = best ? null : all.filter((c) => c.checks.find((k) => k.id === 'strength').ok && c.checks.find((k) => k.id === 'price').ok)
    .sort((a, b) => b.prob - a.prob)[0] || null;
  return { best, near };
}

/**
 * The most likely set of legs (one per match, already) whose odds reach the target.
 * 0/1 knapsack on log-odds: maximise the sum of log-probabilities subject to the sum of
 * log-odds >= log(target). Weights are floored, so a found set always truly reaches the target.
 */
function bestSlip(legs, target) {
  const STEP = 0.0001; // log-odds resolution: ten legs lose at most 0.1% of the odds to rounding
  const need = Math.max(0, Math.ceil(Math.log(target) / STEP));
  const W = legs.map((l) => Math.max(0, Math.floor(Math.log(l.odds) / STEP)));
  const C = legs.map((l) => -Math.log(Math.max(1e-9, l.prob)));
  // dp[w]: the smallest -log(chance) of a set whose (capped) log-odds weight is w
  let dp = new Float64Array(need + 1).fill(Infinity);
  dp[0] = 0;
  const from = []; // from[i][w]: the weight before leg i when the best way to w takes leg i, else -1
  for (let i = 0; i < legs.length; i++) {
    const nd = Float64Array.from(dp);
    const fr = new Int32Array(need + 1).fill(-1);
    for (let w = 0; w <= need; w++) {
      if (dp[w] === Infinity) continue;
      const w2 = Math.min(need, w + W[i]);
      const c2 = dp[w] + C[i];
      if (c2 < nd[w2] - 1e-12) {
        nd[w2] = c2;
        fr[w2] = w;
      }
    }
    from.push(fr);
    dp = nd;
  }
  if (dp[need] === Infinity) return null;
  const chosen = [];
  let w = need;
  for (let i = legs.length - 1; i >= 0; i--) {
    if (from[i][w] >= 0) {
      chosen.push(legs[i]);
      w = from[i][w];
    }
  }
  return chosen.reverse();
}

/** Combine legs: odds, chance, value. */
function combine(legs) {
  const odds = legs.reduce((a, l) => a * l.odds, 1);
  const prob = legs.reduce((a, l) => a * l.prob, 1);
  return { legs, size: legs.length, odds, prob, fairOdds: 1 / prob, value: odds * prob - 1, estimated: legs.some((l) => l.estimated) };
}

/**
 * The day's High Banker.
 * @param {object[]} matches  match inputs
 * @returns {{bankers:object[], slip:object|null, all:object|null, near:object[], target:number, reached:boolean}}
 */
function build(matches, cfg = CFG) {
  const bankers = [];
  const near = [];
  for (const x of matches) {
    const { best, near: nm } = forMatch(x, cfg);
    if (best) bankers.push(legOf(x, best));
    else if (nm) near.push(legOf(x, nm));
  }
  bankers.sort((a, b) => b.score - a.score);
  near.sort((a, b) => b.prob - a.prob);
  // the most likely slip at the target, then at each bigger target the day can reach (no upper limit)
  const options = [];
  for (const t of [cfg.target, ...(cfg.bigger || [])]) {
    const set = bankers.length ? bestSlip(bankers, t) : null;
    if (!set) break; // a bigger target is unreachable too
    const c = combine(set.slice().sort((a, b) => Date.parse(a.kickoff || 0) - Date.parse(b.kickoff || 0) || b.prob - a.prob));
    const sig = c.legs.map((l) => l.fixtureId + l.key).join(',');
    if (options.length && options[options.length - 1].sig === sig) continue;
    options.push({ target: t, sig, ...c });
  }
  for (const o of options) delete o.sig;
  const slip = options.length && options[0].target === cfg.target ? options[0] : null;
  const all = bankers.length ? combine(bankers) : null;
  // the safer slip: the most likely set of the same bankers reaching the smaller target
  const sset = cfg.safer && bankers.length ? bestSlip(bankers, cfg.safer) : null;
  const safer = sset ? { target: cfg.safer, ...combine(sset.slice().sort((a, b) => Date.parse(a.kickoff || 0) - Date.parse(b.kickoff || 0) || b.prob - a.prob)) } : null;
  return { target: cfg.target, reached: !!slip, slip, safer, bigger: slip ? options.slice(1) : [], all, bankers, near: near.slice(0, 6) };
}

function legOf(x, c) {
  return {
    fixtureId: x.id || null,
    league: x.league || x.div || null,
    leagueName: x.leagueName || null,
    kickoff: x.kickoff || x.date || null,
    home: x.home,
    away: x.away,
    key: c.key,
    label: D.label(c.key, x.home, x.away),
    prob: c.prob,
    base: c.base,
    shift: c.shift,
    odds: c.price ? c.price.odds : null,
    refOdds: c.price ? c.price.ref : null,
    estimated: c.price ? c.price.estimated : true,
    agreement: c.agreement,
    methods: c.methods.map((m) => ({ id: m.id, name: m.name || null, status: m.status, key: m.key })),
    tripleConfirmed: c.methods.length > 0,
    checks: c.checks,
    failed: c.failed,
    flags: c.flags,
    score: score(c),
  };
}

/**
 * The match input from a live engine report (lib/engine.js report with report.intel).
 * @param {object} r
 * @param {{now?:number}} [o]
 */
function fromReport(r, o = {}) {
  if (!r || !r.analysable || !r.intel || !r.intel.available) return null;
  const m = r.match;
  const it = r.intel;
  const dec = it.decision || {};
  const pr = {};
  for (const mk of r.markets || []) {
    const best = mk.v5price && mk.v5price.best && mk.v5price.best.price > 1 ? mk.v5price.best.price : null;
    if (best) pr[mk.key] = [null, best];
  }
  const f = {};
  for (const k of TREND_FACTORS) f[k] = it.factors && it.factors[k] != null ? it.factors[k] : null;
  // the views the measured chance reads (as lib/strongest/inputs.js goalViews), and the
  // possession model's own probabilities
  const byKey = Object.fromEntries((r.markets || []).map((mk) => [mk.key, mk]));
  const pace = it.pace && it.pace.probs ? it.pace.probs : {};
  const mc = {};
  const pv = {};
  const mv = {};
  for (const k of CFG.keys) {
    const mk = byKey[k];
    const views = {
      market: mk && mk.prob != null ? mk.prob : it.base && it.base[k] != null ? it.base[k] : null,
      stats: mk && mk.modelProb != null ? mk.modelProb : null,
      factors: it.probs && it.probs[k] != null ? it.probs[k] : null,
      pace: pace[k] != null ? pace[k] : null,
    };
    mv[k] = views.market;
    pv[k] = views.pace;
    const c = CAL.goalChance(k, views);
    if (c != null) mc[k] = c;
  }
  const now = o.now || Date.now();
  const crossLeague = (it.traps || []).some((t) => t.kind === 'data' && /cup or cross-league/i.test(t.label));
  const moves = {};
  for (const mv of (r.lineMovement && r.lineMovement.moves) || []) if (mv && mv.side && Number.isFinite(mv.changePct)) moves[mv.side] = mv.changePct / 100;
  const lvl = (s) => (s && s.level ? String(s.level).toLowerCase() : null);
  return {
    id: String(m.id),
    league: m.league,
    leagueName: m.leagueName || null,
    kickoff: m.date,
    home: m.home.name,
    away: m.away.name,
    p: it.probs || {},
    base: it.base || null,
    mc,
    pv,
    mv,
    pace: it.pace ? { lam: it.pace.lam, shots: it.pace.shots, efficiency: it.pace.efficiency } : null,
    pr,
    ovrOU: it.factors && it.factors.ovrOU != null ? it.factors.ovrOU : null,
    main: dec.main ? dec.main.key : null,
    safer: dec.safer ? dec.safer.key : null,
    avoid: (dec.avoid || []).map((a) => a.key),
    pat: (it.patterns || []).map((p) => p.id),
    f,
    cov: it.coverage != null ? it.coverage : null,
    // methodology confirmation at the checklist bar the banker record was measured with (85%;
    // methodologies themselves qualify at 70% since v5.1)
    m: ((r.methodology && r.methodology.predictions) || []).filter((p) => p && p.pick && p.pick.key && !p.paperOnly && !(p.checklist && p.checklist.ratio != null && p.checklist.ratio < 0.85 - 1e-9))
      .map((p) => ({ id: p.id, name: p.name, key: p.pick.key, status: p.status })),
    live: {
      started: (m.state && m.state !== 'pre') || (m.date && Date.parse(m.date) <= now),
      games: it.data && it.data.historyGames ? it.data.historyGames : null,
      crossLeague,
      news: r.newsRisk ? { home: lvl(r.newsRisk.home), away: lvl(r.newsRisk.away) } : null,
      moves,
    },
  };
}

/** The day's High Banker from analysed engine reports. */
function forReports(reports, o = {}) {
  const cfg = { ...CFG, ...(o.cfg || {}) };
  const inputs = (reports || []).map((r) => fromReport(r, o)).filter(Boolean);
  const out = build(inputs, cfg);
  return { ...out, config: publicConfig(cfg), record: record(), rules: RULE_TEXT(cfg) };
}

let RECORD;
function record() {
  if (RECORD !== undefined) return RECORD;
  try {
    RECORD = require('./banker_record.json');
  } catch {
    RECORD = null;
  }
  return RECORD;
}

function publicConfig(cfg = CFG) {
  return {
    version: cfg.version, target: cfg.target, safer: cfg.safer, bigger: cfg.bigger, minProb: cfg.minProb, minBase: cfg.minBase, minShift: cfg.minShift, maxShift: cfg.maxShift,
    minOdds: cfg.minOdds, maxOdds: cfg.maxOdds, minCoverage: cfg.minCoverage, minGames: cfg.minGames, keys: cfg.keys,
  };
}

const RULE_TEXT = (cfg) => [
  `The model rates it at least ${pct(cfg.minProb)} AND the bookmakers' own price says at least ${pct(cfg.minBase)}.`,
  'The factors do not rate it below the price, it is not on the match\'s avoid list and no confirmed trap fires.',
  'It is the normal prediction\'s main pick or a safer form of it — never a contradiction.',
  'No red flag in either team\'s form, venue form, scoring trends, the head-to-head, or the measured patterns.',
  `It pays between ${f2(cfg.minOdds)} and ${f2(cfg.maxOdds)}; a real bookmaker price and a full history for both teams; league matches only.`,
  `The slip is the most likely set of bankers reaching ${f2(cfg.target)}+ odds, one per match. If the bankers cannot reach it, there is no slip — never padded with weaker picks.`,
  `The safer slip is the most likely set of the same bankers reaching ${f2(cfg.safer)}+: fewer legs, so fewer things that can go wrong.`,
];

module.exports = { CFG, TREND_FACTORS, check, forMatch, build, bestSlip, combine, redFlags, patternEffect, priceOf, fromReport, forReports, publicConfig, record };
