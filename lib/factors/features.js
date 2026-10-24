'use strict';

/**
 * factors/features.js — the v6 match factors.
 *
 * ~170 numbers per fixture in eleven families, computed ONLY from information dated
 * before kick-off. The same function runs in research (research/v6/build_features.js,
 * 238,858 historical matches) and on the live site (lib/intel.js), so every factor's
 * measured value is the value of the factor the site shows.
 *
 *   form         points per game (5 / 10 / venue / season), trend slope, streaks
 *   goals        scoring and conceding rates, Over 2.5 / BTTS / clean-sheet / blank rates,
 *                scoring streaks, first-half share, half-time -> full-time swing
 *   performance  shots and shots on target for and against, dominance shares, finishing and
 *                goalkeeping rates, shot-based expected goals and the "luck" gap
 *   vsMarket     results against what the bookmakers expected (points, goal difference, goals)
 *   strength     ClubElo and its 30 / 90-day momentum, how the market has rated the side
 *   discipline   red cards (suspension risk), yellows, fouls, corners
 *   schedule     rest days, games in the last 21 days
 *   table        position, points gaps to the title / Europe / relegation, games left,
 *                motivation (title race, relegation fight, nothing to play for), promoted
 *   market       de-vigged 1X2 and Over 2.5, overround, book dispersion, implied goals
 *   h2h          meetings in the last 6 years: points, goals, Over 2.5, BTTS, draws, same-venue
 *                record, results against the market's expectation
 *   league       league goals / home-win / draw / Over 2.5 / BTTS environment
 *
 * Missing evidence is null (never 0): the model treats it as unknown.
 */

const RC = require('./records');
const { DAY, dnum } = require('./history');

// ------------------------------------------------------------------ helpers
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const vals = (log, f) => log.map(f).filter((v) => v != null && Number.isFinite(v));
function avgOf(log, f, min = 1) {
  const v = vals(log, f);
  return v.length >= min ? mean(v) : null;
}
function rate(log, pred, min = 1) {
  if (log.length < min) return null;
  return log.filter(pred).length / log.length;
}
function streak(log, pred) {
  let s = 0;
  for (const g of log) {
    if (pred(g)) s++;
    else break;
  }
  return s;
}
const ratio = (a, b) => (a != null && b != null && a + b > 0 ? a / (a + b) : null);
const r4 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10000) / 10000);

const EUROPE = { E0: 6, SP1: 6, I1: 6, D1: 6, F1: 5, 'eng.1': 6, 'esp.1': 6, 'ita.1': 6, 'ger.1': 6, 'fra.1': 5 };

// ------------------------------------------------------------------ per side
/**
 * @param {object[]} log   team entries, newest first (records.teamEntry)
 * @param {'H'|'A'} venue  where this team plays the fixture
 * @param {object} fx      the fixture ({date, league, season})
 * @param {number|null} eloNow
 * @param {object|null} table
 * @param {string} team
 * @param {object|null} env
 * @param {Set|null} prevTeams
 */
function sideFeatures(log, venue, fx, eloNow, table, team, env, prevTeams) {
  const f = {};
  const L5 = log.slice(0, 5);
  const L10 = log.slice(0, 10);
  const P10 = log.slice(5, 10);
  const V = log.filter((g) => g.venue === venue);
  const V5 = V.slice(0, 5);
  const S = log.filter((g) => g.season === fx.season && g.league === fx.league);

  // ---- form
  f.ppg5 = L5.length >= 3 ? avgOf(L5, (g) => g.points) : null;
  f.ppg10 = L10.length >= 6 ? avgOf(L10, (g) => g.points) : null;
  f.ppgV5 = V5.length >= 3 ? avgOf(V5, (g) => g.points) : null;
  f.ppgS = S.length >= 3 ? avgOf(S, (g) => g.points) : null;
  f.slope = L5.length === 5 && P10.length === 5 ? avgOf(L5, (g) => g.points) - avgOf(P10, (g) => g.points) : null;
  const has = log.length > 0;
  f.wst = has ? streak(log, (g) => g.points === 3) : null;
  f.ust = has ? streak(log, (g) => g.points >= 1) : null;
  f.nwst = has ? streak(log, (g) => g.points <= 1) : null;
  f.lst = has ? streak(log, (g) => g.points === 0) : null;

  // ---- goals
  f.gf5 = L5.length >= 3 ? avgOf(L5, (g) => g.gf) : null;
  f.ga5 = L5.length >= 3 ? avgOf(L5, (g) => g.ga) : null;
  f.gf10 = L10.length >= 6 ? avgOf(L10, (g) => g.gf) : null;
  f.ga10 = L10.length >= 6 ? avgOf(L10, (g) => g.ga) : null;
  f.gfV5 = V5.length >= 3 ? avgOf(V5, (g) => g.gf) : null;
  f.gaV5 = V5.length >= 3 ? avgOf(V5, (g) => g.ga) : null;
  f.o25r = rate(L10, (g) => g.gf + g.ga > 2.5, 6);
  f.bttsr = rate(L10, (g) => g.gf > 0 && g.ga > 0, 6);
  f.csr = rate(L10, (g) => g.ga === 0, 6);
  f.ftsr = rate(L10, (g) => g.gf === 0, 6);
  f.scst = has ? streak(log, (g) => g.gf > 0) : null;
  f.csst = has ? streak(log, (g) => g.ga === 0) : null;
  const ht = L10.filter((g) => g.htgf != null && g.htga != null);
  const sgf = ht.reduce((a, g) => a + g.gf, 0);
  const sga = ht.reduce((a, g) => a + g.ga, 0);
  f.htShareF = ht.length >= 6 && sgf >= 4 ? ht.reduce((a, g) => a + g.htgf, 0) / sgf : null;
  f.htShareA = ht.length >= 6 && sga >= 4 ? ht.reduce((a, g) => a + g.htga, 0) / sga : null;
  // points won (or lost) after half-time: FT points minus the points the HT score would have given
  f.htftSwing = ht.length >= 6 ? mean(ht.map((g) => g.points - RC.pts(g.htgf, g.htga))) : null;

  // ---- performance (shots)
  const sh = L10.filter((g) => g.sf != null && g.sa != null && g.sotf != null && g.sota != null);
  if (sh.length >= 5) {
    const sum = (k) => sh.reduce((a, g) => a + g[k], 0);
    const sf = sum('sf');
    const sa = sum('sa');
    const sotf = sum('sotf');
    const sota = sum('sota');
    const gf = sum('gf');
    const ga = sum('ga');
    const n = sh.length;
    f.sf10 = sf / n;
    f.sa10 = sa / n;
    f.sotf10 = sotf / n;
    f.sota10 = sota / n;
    f.shotShare = ratio(sf, sa);
    f.sotShare = ratio(sotf, sota);
    f.conv = sotf > 0 ? gf / sotf : null;
    f.save = sota > 0 ? 1 - ga / sota : null;
    const gps = env && env.gPerSot ? env.gPerSot : null;
    f.xgf10 = gps ? (sotf / n) * gps : null;
    f.xga10 = gps ? (sota / n) * gps : null;
    f.finLuck = gps ? gf / n - (sotf / n) * gps : null; // + = scoring more than the chances suggest
    f.defLuck = gps ? (sota / n) * gps - ga / n : null; // + = conceding fewer than the chances suggest
  } else {
    for (const k of ['sf10', 'sa10', 'sotf10', 'sota10', 'shotShare', 'sotShare', 'conv', 'save', 'xgf10', 'xga10', 'finLuck', 'defLuck']) f[k] = null;
  }

  // ---- results against the market's expectation
  const mk10 = L10.filter((g) => g.pW != null);
  f.pve10 = mk10.length >= 5 ? mean(mk10.map((g) => g.points - (3 * g.pW + g.pD))) : null;
  const mk5 = L5.filter((g) => g.pW != null);
  f.pve5 = mk5.length >= 3 ? mean(mk5.map((g) => g.points - (3 * g.pW + g.pD))) : null;
  const x10 = L10.filter((g) => g.xF != null && g.xA != null);
  f.gdve10 = x10.length >= 5 ? mean(x10.map((g) => g.gf - g.ga - (g.xF - g.xA))) : null;
  f.tve10 = x10.length >= 5 ? mean(x10.map((g) => g.gf + g.ga - (g.xF + g.xA))) : null;
  f.gfve10 = x10.length >= 5 ? mean(x10.map((g) => g.gf - g.xF)) : null;
  f.gave10 = x10.length >= 5 ? mean(x10.map((g) => g.ga - g.xA)) : null;

  // ---- strength
  f.elo = eloNow != null ? eloNow : null;
  const eloAgo = (days) => {
    if (eloNow == null) return null;
    const cut = dnum(fx.date) - days * DAY;
    for (const g of log) {
      const t = dnum(g.date);
      if (t <= cut) {
        if (t < cut - 45 * DAY || g.elo == null) return null;
        return eloNow - g.elo;
      }
    }
    return null;
  };
  f.eloChg30 = eloAgo(30);
  f.eloChg90 = eloAgo(90);
  f.mktStr5 = mk5.length >= 3 ? mean(mk5.map((g) => g.pW - g.pL)) : null;

  // ---- discipline and set pieces
  const L3 = log.slice(0, 3).filter((g) => g.rf != null);
  f.red3 = L3.length === 3 ? L3.reduce((a, g) => a + g.rf, 0) : null;
  f.yel10 = avgOf(L10, (g) => g.yf, 5);
  f.foul10 = avgOf(L10, (g) => g.ff, 5);
  f.cf10 = avgOf(L10, (g) => g.cf, 5);
  f.ca10 = avgOf(L10, (g) => g.ca, 5);

  // ---- schedule
  if (has) {
    const rest = (dnum(fx.date) - dnum(log[0].date)) / DAY;
    f.rest = Math.min(30, rest);
    f.g21 = log.filter((g) => dnum(fx.date) - dnum(g.date) <= 21 * DAY).length;
  } else {
    f.rest = null;
    f.g21 = null;
  }

  // ---- table and motivation
  const tr = table && table.rows.get(team);
  if (tr && tr.gp >= 1) {
    const n = table.n;
    const order = table.order;
    const remaining = Math.max(0, table.totalGames - tr.gp);
    const maxPts = 3 * remaining;
    const drop = RC.dropPlaces(fx.league);
    const eur = EUROPE[fx.league] || 4;
    const ptsAt = (pos) => (order[pos - 1] ? order[pos - 1].pts : null);
    const gapTop = tr.pos === 1 ? -(tr.pts - (ptsAt(2) || tr.pts)) : ptsAt(1) - tr.pts;
    const safeLine = n - drop; // last safe position
    const gapDrop = tr.pos <= safeLine ? tr.pts - (ptsAt(safeLine + 1) || 0) : tr.pts - (ptsAt(safeLine) || 0);
    const gapEur = tr.pos <= eur ? tr.pts - (ptsAt(eur + 1) || 0) : tr.pts - (ptsAt(eur) || 0);
    const progress = table.totalGames ? tr.gp / table.totalGames : null;
    f.pos = n > 1 ? (tr.pos - 1) / (n - 1) : null;
    f.gdpg = (tr.gf - tr.ga) / tr.gp;
    f.played = tr.gp;
    f.remaining = remaining;
    f.gapTop = gapTop;
    f.gapDrop = gapDrop;
    f.gapEur = gapEur;
    f.gapTopN = gapTop / (maxPts + 3);
    f.gapDropN = gapDrop / (maxPts + 3);
    const late = progress != null && progress >= 0.6;
    f.title = late && tr.pos <= 3 && gapTop <= Math.min(9, maxPts) ? 1 : 0;
    f.dropFight = late && gapDrop <= 6 && gapDrop > -maxPts ? 1 : 0;
    f.eurRace = late && Math.abs(gapEur) <= 4 && tr.pos <= eur + 4 ? 1 : 0;
    f.dead = progress != null && progress >= 0.75 && !f.title && !f.dropFight && !f.eurRace && gapDrop > Math.min(maxPts, 12) && gapTop > maxPts ? 1 : 0;
  } else {
    for (const k of ['pos', 'gdpg', 'played', 'remaining', 'gapTop', 'gapDrop', 'gapEur', 'gapTopN', 'gapDropN', 'title', 'dropFight', 'eurRace', 'dead']) f[k] = null;
    if (table) f.played = 0;
  }
  f.promoted = prevTeams ? (prevTeams.has(team) ? 0 : 1) : null;
  return f;
}

// ------------------------------------------------------------------ head-to-head
function h2hFeatures(h2h, home) {
  const f = {};
  const g = h2h.map((m) => {
    const isH = m.home === home;
    const gf = isH ? m.hg : m.ag;
    const ga = isH ? m.ag : m.hg;
    const mk = RC.marketOf(m);
    const pW = mk ? (isH ? mk.p1 : mk.p2) : null;
    return { gf, ga, same: isH, points: RC.pts(gf, ga), pW, pD: mk ? mk.pX : null };
  });
  f.h2hN = g.length;
  const has = g.length >= 2;
  f.h2hPpg = has ? mean(g.map((x) => x.points)) : null;
  f.h2hGd = has ? mean(g.map((x) => x.gf - x.ga)) : null;
  f.h2hGoals = has ? mean(g.map((x) => x.gf + x.ga)) : null;
  f.h2hO25 = has ? g.filter((x) => x.gf + x.ga > 2.5).length / g.length : null;
  f.h2hBtts = has ? g.filter((x) => x.gf > 0 && x.ga > 0).length / g.length : null;
  f.h2hDraw = has ? g.filter((x) => x.gf === x.ga).length / g.length : null;
  f.h2hLast = g.length ? Math.sign(g[0].gf - g[0].ga) : null;
  const sv = g.filter((x) => x.same);
  f.h2hVenN = sv.length;
  f.h2hVenPpg = sv.length >= 2 ? mean(sv.map((x) => x.points)) : null;
  const mk = g.filter((x) => x.pW != null);
  f.h2hPve = mk.length >= 2 ? mean(mk.map((x) => x.points - (3 * x.pW + x.pD))) : null;
  return f;
}

// ------------------------------------------------------------------ main
/**
 * @param {object} c
 * @param {object} c.fixture   {league, season, date, home, away, eloH, eloA, odds}
 * @param {object[]} c.homeLog team entries newest first, before kick-off
 * @param {object[]} c.awayLog
 * @param {object[]} c.h2h     match records newest first
 * @param {object|null} c.table   History#table
 * @param {object|null} c.env     History#env
 * @param {Set|null} c.prevTeams  last season's teams in this league
 * @returns {Object<string, number|null>}
 */
function compute(c) {
  const fx = c.fixture;
  const out = {};
  const hs = sideFeatures(c.homeLog || [], 'H', fx, fx.eloH, c.table, fx.home, c.env, c.prevTeams);
  const as = sideFeatures(c.awayLog || [], 'A', fx, fx.eloA, c.table, fx.away, c.env, c.prevTeams);
  for (const [k, v] of Object.entries(hs)) out['h_' + k] = v;
  for (const [k, v] of Object.entries(as)) out['a_' + k] = v;

  // ---- market
  const mk = fx.odds ? RC.marketOf(fx) : null;
  out.p1 = mk ? mk.p1 : null;
  out.pX = mk ? mk.pX : null;
  out.p2 = mk ? mk.p2 : null;
  out.pO25 = mk ? mk.pO25 : null;
  out.ovr = mk ? mk.ovr : null;
  out.ovrOU = mk ? mk.ovrOU : null;
  out.disp1 = mk ? mk.disp1 : null;
  out.dispX = mk ? mk.dispX : null;
  out.disp2 = mk ? mk.disp2 : null;
  out.dispO = mk ? mk.dispO : null;
  out.dispU = mk ? mk.dispU : null;
  out.lamH = mk ? mk.lamH : null;
  out.lamA = mk ? mk.lamA : null;
  out.lamT = mk && mk.lamH != null ? mk.lamH + mk.lamA : null;
  out.ahLine = fx.odds && fx.odds.ahLine != null ? fx.odds.ahLine : null;

  // ---- strength
  out.eloDiff = fx.eloH != null && fx.eloA != null ? fx.eloH - fx.eloA : null;
  out.eloExp = out.eloDiff != null ? 1 / (1 + Math.pow(10, -(out.eloDiff + 65) / 400)) : null;

  // ---- head-to-head
  Object.assign(out, h2hFeatures(c.h2h || [], fx.home));

  // ---- league environment
  const e = c.env;
  out.lgGoals = e ? e.goals : null;
  out.lgHome = e ? e.home : null;
  out.lgDraw = e ? e.draw : null;
  out.lgO25 = e ? e.o25 : null;
  out.lgBtts = e ? e.btts : null;

  // ---- calendar
  const d = new Date(fx.date + 'T12:00:00Z');
  out.month = d.getUTCMonth() + 1;
  out.dow = d.getUTCDay();
  out.midweek = out.dow >= 2 && out.dow <= 4 ? 1 : 0;
  out.progress = c.table && c.table.totalGames && hs.played != null && as.played != null
    ? (hs.played + as.played) / (2 * c.table.totalGames) : null;

  // ---- differences (home minus away)
  const dif = (k) => (hs[k] != null && as[k] != null ? hs[k] - as[k] : null);
  out.d_ppg5 = dif('ppg5');
  out.d_ppg10 = dif('ppg10');
  out.d_ppgV = dif('ppgV5');
  out.d_gd10 = hs.gf10 != null && as.gf10 != null ? hs.gf10 - hs.ga10 - (as.gf10 - as.ga10) : null;
  out.d_sotShare = dif('sotShare');
  out.d_xgd = hs.xgf10 != null && as.xgf10 != null ? hs.xgf10 - hs.xga10 - (as.xgf10 - as.xga10) : null;
  out.d_pve10 = dif('pve10');
  out.d_gdve10 = dif('gdve10');
  out.d_eloChg30 = dif('eloChg30');
  out.d_eloChg90 = dif('eloChg90');
  out.d_rest = dif('rest');
  out.d_pos = dif('pos');
  out.d_mktStr5 = dif('mktStr5');

  for (const k of Object.keys(out)) out[k] = r4(out[k]);
  return out;
}

// ------------------------------------------------------------------ catalog
/** Families shown in the UI, in order, with plain-English names. */
const GROUPS = [
  { id: 'market', name: 'Market & price', blurb: 'What the bookmakers already expect — the base every factor adjusts.' },
  { id: 'form', name: 'Form & trend', blurb: 'Recent points, momentum and streaks.' },
  { id: 'goals', name: 'Goal trends', blurb: 'Scoring and conceding patterns, Over 2.5 / BTTS / clean-sheet rates, half-time patterns.' },
  { id: 'performance', name: 'Performance & luck', blurb: 'Shots and shots on target: who is creating chances, and who is riding luck.' },
  { id: 'vsMarket', name: 'Beating the bookmakers', blurb: 'Results against what the odds expected — the hidden trend.' },
  { id: 'strength', name: 'Strength & momentum', blurb: 'ClubElo rating and how it is moving.' },
  { id: 'h2h', name: 'Head-to-head', blurb: 'Meetings in the last six years.' },
  { id: 'table', name: 'Table & motivation', blurb: 'Position, title / Europe / relegation pressure, games left, promoted sides.' },
  { id: 'schedule', name: 'Schedule & fatigue', blurb: 'Rest days and fixture pile-up.' },
  { id: 'discipline', name: 'Discipline & set pieces', blurb: 'Red cards (suspension risk), yellows, fouls, corners.' },
  { id: 'league', name: 'League environment', blurb: 'How this league scores and how often home sides win or draw.' },
  { id: 'calendar', name: 'Calendar', blurb: 'Month, midweek round, stage of season.' },
];

const SIDE_GROUP = {
  ppg5: 'form', ppg10: 'form', ppgV5: 'form', ppgS: 'form', slope: 'form', wst: 'form', ust: 'form', nwst: 'form', lst: 'form',
  gf5: 'goals', ga5: 'goals', gf10: 'goals', ga10: 'goals', gfV5: 'goals', gaV5: 'goals', o25r: 'goals', bttsr: 'goals', csr: 'goals', ftsr: 'goals',
  scst: 'goals', csst: 'goals', htShareF: 'goals', htShareA: 'goals', htftSwing: 'goals',
  sf10: 'performance', sa10: 'performance', sotf10: 'performance', sota10: 'performance', shotShare: 'performance', sotShare: 'performance',
  conv: 'performance', save: 'performance', xgf10: 'performance', xga10: 'performance', finLuck: 'performance', defLuck: 'performance',
  pve10: 'vsMarket', pve5: 'vsMarket', gdve10: 'vsMarket', tve10: 'vsMarket', gfve10: 'vsMarket', gave10: 'vsMarket',
  elo: 'strength', eloChg30: 'strength', eloChg90: 'strength', mktStr5: 'strength',
  red3: 'discipline', yel10: 'discipline', foul10: 'discipline', cf10: 'discipline', ca10: 'discipline',
  rest: 'schedule', g21: 'schedule',
  pos: 'table', gdpg: 'table', played: 'table', remaining: 'table', gapTop: 'table', gapDrop: 'table', gapEur: 'table', gapTopN: 'table', gapDropN: 'table',
  title: 'table', dropFight: 'table', eurRace: 'table', dead: 'table', promoted: 'table',
};
const SIDE_LABEL = {
  ppg5: 'Points per game, last 5', ppg10: 'Points per game, last 10', ppgV5: 'Points per game, last 5 at this venue', ppgS: 'Points per game, this season',
  slope: 'Form trend (last 5 vs previous 5, pts/game)', wst: 'Winning streak', ust: 'Unbeaten run', nwst: 'Winless run', lst: 'Losing streak',
  gf5: 'Goals scored per game, last 5', ga5: 'Goals conceded per game, last 5', gf10: 'Goals scored per game, last 10', ga10: 'Goals conceded per game, last 10',
  gfV5: 'Scored per game at this venue, last 5', gaV5: 'Conceded per game at this venue, last 5',
  o25r: 'Over 2.5 rate, last 10', bttsr: 'Both-teams-scored rate, last 10', csr: 'Clean-sheet rate, last 10', ftsr: 'Failed-to-score rate, last 10',
  scst: 'Games in a row scoring', csst: 'Clean sheets in a row', htShareF: 'Share of goals scored before half-time', htShareA: 'Share of goals conceded before half-time',
  htftSwing: 'Points gained after half-time per game',
  sf10: 'Shots per game', sa10: 'Shots conceded per game', sotf10: 'Shots on target per game', sota10: 'Shots on target conceded per game',
  shotShare: 'Share of all shots', sotShare: 'Share of shots on target', conv: 'Goals per shot on target', save: 'Save rate',
  xgf10: 'Chance-based expected goals for', xga10: 'Chance-based expected goals against', finLuck: 'Finishing luck (goals minus expected)',
  defLuck: 'Defensive luck (expected minus conceded)',
  pve10: 'Points vs bookmaker expectation, last 10', pve5: 'Points vs bookmaker expectation, last 5', gdve10: 'Goal difference vs expectation, last 10',
  tve10: 'Match goals vs expectation, last 10', gfve10: 'Goals scored vs expectation, last 10', gave10: 'Goals conceded vs expectation, last 10',
  elo: 'ClubElo rating', eloChg30: 'Elo change, 30 days', eloChg90: 'Elo change, 90 days', mktStr5: 'How the market rated them, last 5',
  red3: 'Red cards, last 3 games', yel10: 'Yellow cards per game', foul10: 'Fouls per game', cf10: 'Corners won per game', ca10: 'Corners conceded per game',
  rest: 'Days since last league game', g21: 'League games in the last 21 days',
  pos: 'League position (0 = top)', gdpg: 'Season goal difference per game', played: 'Games played this season', remaining: 'Games remaining',
  gapTop: 'Points behind the leader', gapDrop: 'Points above the relegation zone', gapEur: 'Points from the European places',
  gapTopN: 'Title gap vs points left', gapDropN: 'Relegation gap vs points left',
  title: 'In a title race', dropFight: 'In a relegation fight', eurRace: 'In a European race', dead: 'Nothing left to play for', promoted: 'Promoted this season',
};
const MATCH_GROUP = {
  p1: 'market', pX: 'market', p2: 'market', pO25: 'market', ovr: 'market', ovrOU: 'market', disp1: 'market', dispX: 'market', disp2: 'market',
  dispO: 'market', dispU: 'market', lamH: 'market', lamA: 'market', lamT: 'market', ahLine: 'market',
  eloDiff: 'strength', eloExp: 'strength',
  h2hN: 'h2h', h2hPpg: 'h2h', h2hGd: 'h2h', h2hGoals: 'h2h', h2hO25: 'h2h', h2hBtts: 'h2h', h2hDraw: 'h2h', h2hLast: 'h2h', h2hVenN: 'h2h', h2hVenPpg: 'h2h', h2hPve: 'h2h',
  lgGoals: 'league', lgHome: 'league', lgDraw: 'league', lgO25: 'league', lgBtts: 'league',
  month: 'calendar', dow: 'calendar', midweek: 'calendar', progress: 'calendar',
  d_ppg5: 'form', d_ppg10: 'form', d_ppgV: 'form', d_gd10: 'goals', d_sotShare: 'performance', d_xgd: 'performance', d_pve10: 'vsMarket', d_gdve10: 'vsMarket',
  d_eloChg30: 'strength', d_eloChg90: 'strength', d_rest: 'schedule', d_pos: 'table', d_mktStr5: 'strength',
};
const MATCH_LABEL = {
  p1: 'Market: home win', pX: 'Market: draw', p2: 'Market: away win', pO25: 'Market: Over 2.5', ovr: 'Bookmaker margin (1X2)', ovrOU: 'Bookmaker margin (goals)',
  disp1: 'Best price vs Bet365, home', dispX: 'Best price vs Bet365, draw', disp2: 'Best price vs Bet365, away', dispO: 'Best price vs Bet365, Over', dispU: 'Best price vs Bet365, Under',
  lamH: 'Market expected goals, home', lamA: 'Market expected goals, away', lamT: 'Market expected total goals', ahLine: 'Asian handicap line (home)',
  eloDiff: 'Elo difference (home - away)', eloExp: 'Elo win expectancy (home)',
  h2hN: 'Meetings in 6 years', h2hPpg: 'Home side points per game in meetings', h2hGd: 'Home side goal difference per meeting', h2hGoals: 'Goals per meeting',
  h2hO25: 'Meetings with 3+ goals', h2hBtts: 'Meetings where both scored', h2hDraw: 'Meetings drawn', h2hLast: 'Last meeting (home side: +1 win, 0 draw, -1 loss)',
  h2hVenN: 'Meetings at this ground', h2hVenPpg: 'Home side points per game at this ground', h2hPve: 'Home side points vs expectation in meetings',
  lgGoals: 'League goals per game', lgHome: 'League home-win rate', lgDraw: 'League draw rate', lgO25: 'League Over 2.5 rate', lgBtts: 'League BTTS rate',
  month: 'Month', dow: 'Day of week', midweek: 'Midweek round', progress: 'Season completed',
  d_ppg5: 'Form gap, last 5 (home - away)', d_ppg10: 'Form gap, last 10', d_ppgV: 'Venue form gap', d_gd10: 'Goal-difference gap, last 10',
  d_sotShare: 'Shot-on-target dominance gap', d_xgd: 'Chance-based goal-difference gap', d_pve10: 'Beating-expectation gap', d_gdve10: 'Goal-difference-vs-expectation gap',
  d_eloChg30: 'Elo momentum gap, 30 days', d_eloChg90: 'Elo momentum gap, 90 days', d_rest: 'Rest-days gap', d_pos: 'Table-position gap', d_mktStr5: 'Market-rating gap',
};

/** Every feature key with its family and label, in a stable order. */
function catalog() {
  const out = [];
  for (const side of ['h', 'a']) {
    for (const [k, g] of Object.entries(SIDE_GROUP)) out.push({ key: `${side}_${k}`, base: k, side, group: g, label: SIDE_LABEL[k] || k });
  }
  for (const [k, g] of Object.entries(MATCH_GROUP)) out.push({ key: k, base: k, side: null, group: g, label: MATCH_LABEL[k] || k });
  return out;
}

module.exports = { compute, sideFeatures, h2hFeatures, catalog, GROUPS, SIDE_GROUP, MATCH_GROUP, SIDE_LABEL, MATCH_LABEL };
