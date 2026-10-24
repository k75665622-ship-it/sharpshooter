'use strict';

/**
 * intel/explain.js — every factor family in plain English, plus how hard it pulled.
 *
 * For each family (form, goals, performance, beating the bookmakers, strength, head-to-head,
 * table, schedule, discipline, league, market) this builds:
 *   facts       short sentences with the clubs' names and the numbers
 *   pull        how far this family moved the probability of the main pick, in percentage
 *               points (Saabas attribution of the factor model; + supports the pick)
 *   importance  the family's measured share of the model's decisions on held-out seasons,
 *               with and without a price (lib/intel/importance.json)
 */

const F = require('../factors/features');

let IMPORTANCE = null;
function importance() {
  if (IMPORTANCE) return IMPORTANCE;
  try {
    IMPORTANCE = require('./importance.json');
  } catch {
    IMPORTANCE = { withMarket: {}, factorsOnly: {} };
  }
  return IMPORTANCE;
}

const GROUP_OF = (() => {
  const m = {};
  for (const c of F.catalog()) m[c.key] = c.group;
  m.divc = 'league';
  return m;
})();

const pct = (v, d = 0) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);
const f1 = (v) => (v == null ? '—' : v.toFixed(1));
const f2 = (v) => (v == null ? '—' : v.toFixed(2));
const sgn = (v, d = 1) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(d)}`);
const ord = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/** W/D/L sequence, oldest -> newest, from a newest-first team log. */
function seq(log, n = 5) {
  return log.slice(0, n).map((g) => (g.gf > g.ga ? 'W' : g.gf === g.ga ? 'D' : 'L')).reverse().join('');
}

function streakText(f, side, name) {
  const g = (k) => f[`${side}_${k}`];
  if (g('wst') >= 3) return `${name} have won ${g('wst')} in a row`;
  if (g('lst') >= 3) return `${name} have lost ${g('lst')} in a row`;
  if (g('ust') >= 5) return `${name} are unbeaten in ${g('ust')}`;
  if (g('nwst') >= 5) return `${name} are winless in ${g('nwst')}`;
  return null;
}

/**
 * @param {object} c
 * @param {object} c.f        factor values
 * @param {object} c.names    {home, away} display names
 * @param {object} c.logs     {home, away} newest-first team logs
 * @param {object[]} c.h2h    meetings, newest first (records.js shape)
 * @param {object|null} c.table History#table
 * @param {object} c.fd       {home, away} the clubs' names in the archive (for table lookups)
 * @param {object|null} c.pull  per-feature contributions toward the main pick (pp)
 */
function families(c) {
  const { f, names } = c;
  const H = names.home;
  const A = names.away;
  const L = c.logs || { home: [], away: [] };
  const facts = {};
  const add = (g, s) => {
    if (!s) return;
    (facts[g] = facts[g] || []).push(s);
  };

  // ---- market
  if (f.p1 != null) {
    add('market', `The price makes it ${H} ${pct(f.p1)}, draw ${pct(f.pX)}, ${A} ${pct(f.p2)}${f.pO25 != null ? `; Over 2.5 ${pct(f.pO25)}` : ''}.`);
    if (f.lamH != null) add('market', `Expected goals implied by the odds: ${H} ${f2(f.lamH)}, ${A} ${f2(f.lamA)} (${f2(f.lamT)} in total).`);
    if (f.ovr != null) add('market', `Bookmaker margin ${pct(f.ovr, 1)}${f.ovr >= 0.08 ? ' — high, prices are padded' : ''}.`);
    if (f.disp1 != null && f.disp1 >= 0.05) add('market', `Best price on ${H} is ${pct(f.disp1)} above Bet365.`);
    if (f.disp2 != null && f.disp2 >= 0.05) add('market', `Best price on ${A} is ${pct(f.disp2)} above Bet365.`);
  } else add('market', 'No bookmaker price — this forecast comes from the factors alone.');

  // ---- form
  for (const [side, name, log, venue] of [['h', H, L.home, 'home'], ['a', A, L.away, 'away']]) {
    const p5 = f[`${side}_ppg5`];
    if (p5 != null) add('form', `${name}: ${f1(p5)} pts/game from the last 5 (${seq(log)}), ${f1(f[`${side}_ppgV5`])} in the last 5 ${venue} games.`);
    add('form', streakText(f, side, name));
    const sl = f[`${side}_slope`];
    if (sl != null && Math.abs(sl) >= 0.6) add('form', `${name} are ${sl > 0 ? 'improving' : 'declining'}: ${sgn(sl)} pts/game against the 5 games before.`);
  }

  // ---- goals
  for (const [side, name] of [['h', H], ['a', A]]) {
    const gf = f[`${side}_gf10`];
    if (gf == null) continue;
    add('goals', `${name}: ${f1(gf)} scored and ${f1(f[`${side}_ga10`])} conceded per game; Over 2.5 in ${Math.round(f[`${side}_o25r`] * 10)}/10, both scored in ${Math.round(f[`${side}_bttsr`] * 10)}/10.`);
    const cs = f[`${side}_csr`];
    const fts = f[`${side}_ftsr`];
    if (cs != null && cs >= 0.4) add('goals', `${name} kept clean sheets in ${Math.round(cs * 10)} of the last 10.`);
    if (fts != null && fts >= 0.4) add('goals', `${name} failed to score in ${Math.round(fts * 10)} of the last 10.`);
    const sw = f[`${side}_htftSwing`];
    if (sw != null && Math.abs(sw) >= 0.3) add('goals', `${name} ${sw > 0 ? 'finish strongly' : 'fade after half-time'}: ${sgn(sw)} pts/game won after the break.`);
    const hs = f[`${side}_htShareF`];
    if (hs != null && (hs >= 0.6 || hs <= 0.3)) add('goals', `${name} score ${pct(hs)} of their goals before half-time.`);
  }

  // ---- performance
  for (const [side, name] of [['h', H], ['a', A]]) {
    const s = f[`${side}_sotf10`];
    if (s == null) continue;
    add('performance', `${name}: ${f1(s)} shots on target per game, ${f1(f[`${side}_sota10`])} against — ${pct(f[`${side}_sotShare`])} of the shots on target in their games.`);
    const fl = f[`${side}_finLuck`];
    if (fl != null && Math.abs(fl) >= 0.3) add('performance', `${name} are scoring ${f2(Math.abs(fl))} goals/game ${fl > 0 ? 'more' : 'fewer'} than their chances suggest — ${fl > 0 ? 'hot finishing tends to cool' : 'due a correction upwards'}.`);
    const dl = f[`${side}_defLuck`];
    if (dl != null && Math.abs(dl) >= 0.3) add('performance', `${name} are conceding ${f2(Math.abs(dl))} goals/game ${dl > 0 ? 'fewer' : 'more'} than the chances against them suggest.`);
  }

  // ---- beating the bookmakers
  for (const [side, name] of [['h', H], ['a', A]]) {
    const v = f[`${side}_pve10`];
    if (v != null && Math.abs(v) >= 0.25) add('vsMarket', `${name} have ${v > 0 ? 'beaten' : 'fallen short of'} the bookmakers' expectation by ${f2(Math.abs(v))} pts/game over 10 games.`);
    const t = f[`${side}_tve10`];
    if (t != null && Math.abs(t) >= 0.4) add('vsMarket', `${name}'s games produced ${f2(Math.abs(t))} ${t > 0 ? 'more' : 'fewer'} goals than the odds expected.`);
  }

  // ---- strength
  if (f.h_elo != null && f.a_elo != null) {
    add('strength', `ClubElo: ${H} ${Math.round(f.h_elo)}${f.h_eloChg90 != null ? ` (${sgn(f.h_eloChg90, 0)} in 90 days)` : ''}, ${A} ${Math.round(f.a_elo)}${f.a_eloChg90 != null ? ` (${sgn(f.a_eloChg90, 0)})` : ''}.`);
    if (f.eloExp != null) add('strength', `Elo alone gives ${H} an expected score of ${pct(f.eloExp)} (draws count half).`);
  }

  // ---- head-to-head
  if (c.h2h && c.h2h.length) {
    let w = 0;
    let d = 0;
    let l = 0;
    let goals = 0;
    let o25 = 0;
    let btts = 0;
    for (const m of c.h2h) {
      const gf = m.home === c.fd.home ? m.hg : m.ag;
      const ga = m.home === c.fd.home ? m.ag : m.hg;
      if (gf > ga) w++;
      else if (gf === ga) d++;
      else l++;
      goals += m.hg + m.ag;
      if (m.hg + m.ag > 2.5) o25++;
      if (m.hg > 0 && m.ag > 0) btts++;
    }
    const n = c.h2h.length;
    add('h2h', `Last ${n} meeting${n > 1 ? 's' : ''} (6 years): ${H} won ${w}, drew ${d}, lost ${l}; ${f1(goals / n)} goals per game, Over 2.5 in ${o25}/${n}, both scored in ${btts}/${n}.`);
    const last = c.h2h[0];
    add('h2h', `Last meeting ${last.date}: ${last.home === c.fd.home ? H : A} ${last.hg}-${last.ag} ${last.home === c.fd.home ? A : H}.`);
    if (f.h2hVenN >= 2) add('h2h', `At this ground: ${H} ${f1(f.h2hVenPpg)} pts/game in ${f.h2hVenN} meetings.`);
  } else add('h2h', 'No league meeting in the last six years.');

  // ---- table & motivation
  if (c.table && c.fd) {
    for (const [side, name, team] of [['h', H, c.fd.home], ['a', A, c.fd.away]]) {
      const r = c.table.rows.get(team);
      if (!r || !r.gp) continue;
      const tags = [];
      if (f[`${side}_title`]) tags.push('in a title race');
      if (f[`${side}_eurRace`]) tags.push('chasing Europe');
      if (f[`${side}_dropFight`]) tags.push('in a relegation fight');
      if (f[`${side}_dead`]) tags.push('nothing left to play for');
      if (f[`${side}_promoted`]) tags.push('promoted this season');
      add('table', `${name}: ${ord(r.pos)} of ${c.table.n}, ${r.pts} pts from ${r.gp} (GD ${sgn(r.gf - r.ga, 0)})${tags.length ? ' — ' + tags.join(', ') : ''}.`);
    }
  }

  // ---- schedule
  for (const [side, name] of [['h', H], ['a', A]]) {
    const r = f[`${side}_rest`];
    if (r != null) add('schedule', `${name}: ${Math.round(r)} days since the last league game${f[`${side}_g21`] >= 4 ? `, ${f[`${side}_g21`]} league games in 3 weeks` : ''}.`);
  }

  // ---- discipline
  for (const [side, name] of [['h', H], ['a', A]]) {
    if (f[`${side}_red3`] >= 1) add('discipline', `${name} had ${f[`${side}_red3`]} red card${f[`${side}_red3`] > 1 ? 's' : ''} in the last 3 games — check for suspensions.`);
    if (f[`${side}_cf10`] != null) add('discipline', `${name}: ${f1(f[`${side}_cf10`])} corners won, ${f1(f[`${side}_yel10`])} yellow cards per game.`);
  }

  // ---- league
  if (f.lgGoals != null) add('league', `This league: ${f2(f.lgGoals)} goals per game, home wins ${pct(f.lgHome)}, draws ${pct(f.lgDraw)}, Over 2.5 ${pct(f.lgO25)}.`);

  // ---- pull per family
  const pull = {};
  if (c.pull) {
    for (const [k, v] of Object.entries(c.pull)) {
      const g = GROUP_OF[k] || 'other';
      pull[g] = (pull[g] || 0) + v;
    }
  }
  const imp = importance();
  // the calendar family (month, weekday) moves forecasts by fractions of a point: not shown
  return F.GROUPS.filter((g) => g.id !== 'calendar').map((g) => ({
    id: g.id,
    name: g.name,
    blurb: g.blurb,
    facts: facts[g.id] || [],
    pull: c.pull ? Math.round((pull[g.id] || 0) * 1000) / 10 : null, // percentage points
    importance: {
      withMarket: imp.withMarket[g.id] != null ? imp.withMarket[g.id] : null,
      factorsOnly: imp.factorsOnly[g.id] != null ? imp.factorsOnly[g.id] : null,
    },
  }));
}

/**
 * Convert raw-score contributions toward a pick into approximate probability points.
 * @param {Object<string,number>} contrib  per-feature raw-score pulls (+ = towards the pick)
 * @param {number} p  the pick's probability
 */
function toPoints(contrib, p) {
  if (!contrib) return null;
  const k = p * (1 - p);
  const out = {};
  for (const [f, v] of Object.entries(contrib)) out[f] = v * k;
  return out;
}

module.exports = { families, toPoints, seq, GROUP_OF, importance };
