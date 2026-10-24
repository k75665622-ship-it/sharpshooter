'use strict';

/**
 * intel/rules.js — named patterns and bookmaker traps, each a testable claim.
 *
 * Every rule is a situation plus a selection: "the favourite is on a 4-game winning run ->
 * back the favourite". research/v6/patterns_study.js runs THIS file over 196,000 priced
 * historical matches and compares how often the selection won with what the price said,
 * twice: discovery seasons 2005-2023 and confirmation seasons 2023-26. The verdicts are
 * written to lib/intel/rules.json and shown next to the rule whenever it fires:
 *
 *   trap       the price over-states the selection, in both periods        -> avoid it
 *   edge       the price under-states the selection, in both periods
 *   weak       seen in discovery, same direction since, but not significant
 *   unstable   seen in discovery, reversed since
 *   priced-in  no measurable effect: the bookmakers already account for it
 */

/** Perspective helper over a factor object: favourite / underdog by the 1X2 price. */
function view(f) {
  if (f.p1 == null || f.p2 == null) return null;
  const favHome = f.p1 >= f.p2;
  const side = (fav) => (k) => {
    const h = f['h_' + k];
    const a = f['a_' + k];
    return (fav ? favHome : !favHome) ? h : a;
  };
  return {
    favHome,
    favP: favHome ? f.p1 : f.p2,
    dogP: favHome ? f.p2 : f.p1,
    fv: side(true),
    dg: side(false),
    favDisp: favHome ? f.disp1 : f.disp2,
    dogDisp: favHome ? f.disp2 : f.disp1,
    favEloExp: f.eloExp == null ? null : favHome ? f.eloExp : 1 - f.eloExp,
    favH2hPpg: f.h2hPpg == null ? null : favHome ? f.h2hPpg : 3 - f.h2hPpg - (f.h2hDraw || 0),
    f,
  };
}

const ge = (v, t) => v != null && v >= t;
const le = (v, t) => v != null && v <= t;
const eq = (v, t) => v != null && v === t;

/** [id, description, selection, condition(view)] — the same list the research tested. */
const RULES = [
  ['fav_win_streak', 'Favourite on a 4+ game winning run', 'fav', (v) => ge(v.fv('wst'), 4)],
  ['fav_beating_odds', 'Favourite has beaten the bookmakers\' expectation by 0.5+ pts/game over 10 games', 'fav', (v) => ge(v.fv('pve10'), 0.5)],
  ['fav_lucky_finishing', 'Favourite scoring 0.4+ goals/game more than its chances suggest', 'fav', (v) => ge(v.fv('finLuck'), 0.4)],
  ['fav_lucky_defence', 'Favourite conceding 0.4+ goals/game fewer than its chances suggest', 'fav', (v) => ge(v.fv('defLuck'), 0.4)],
  ['fav_not_dominant', 'Favourite does not win the shots-on-target battle (share 48% or less)', 'fav', (v) => le(v.fv('sotShare'), 0.48)],
  ['fav_dominant', 'Favourite takes 60%+ of the shots on target in its games', 'fav', (v) => ge(v.fv('sotShare'), 0.6)],
  ['dog_losing_streak', 'Underdog on a 3+ game losing run', 'fav', (v) => ge(v.dg('lst'), 3)],
  ['dog_beating_odds', 'Underdog has beaten the bookmakers\' expectation by 0.5+ pts/game', 'dog', (v) => ge(v.dg('pve10'), 0.5)],
  ['dog_underperforming', 'Underdog 0.5+ pts/game below the bookmakers\' expectation', 'dog', (v) => le(v.dg('pve10'), -0.5)],
  ['fav_dead_dog_fighting', 'Favourite has nothing to play for, underdog fighting relegation', 'fav', (v) => eq(v.fv('dead'), 1) && eq(v.dg('dropFight'), 1)],
  ['fav_title_race', 'Favourite in a late-season title race', 'fav', (v) => eq(v.fv('title'), 1)],
  ['dog_relegation_fight', 'Underdog in a late-season relegation fight', 'dog', (v) => eq(v.dg('dropFight'), 1)],
  ['fav_dead', 'Favourite has nothing left to play for', 'fav', (v) => eq(v.fv('dead'), 1)],
  ['fav_short_rest', 'Favourite on 3 days rest or fewer, underdog on 6+', 'fav', (v) => le(v.fv('rest'), 3) && ge(v.dg('rest'), 6)],
  ['heavy_fav_away', 'Heavy away favourite (price says 65%+)', 'fav', (v) => v.favP >= 0.65 && !v.favHome],
  ['heavy_fav_home', 'Heavy home favourite (price says 70%+)', 'fav', (v) => v.favP >= 0.7 && v.favHome],
  ['high_margin', 'Bookmaker margin of 8%+ on the match', 'fav', (v) => ge(v.f.ovr, 0.08)],
  ['fav_price_gap', 'Best price on the favourite 8%+ above Bet365', 'fav', (v) => ge(v.favDisp, 0.08)],
  ['dog_price_gap', 'Best price on the underdog 15%+ above Bet365', 'dog', (v) => ge(v.dogDisp, 0.15)],
  ['fav_bogey_h2h', 'Favourite has a poor head-to-head record (0.8 pts/game or less, 3+ meetings)', 'fav', (v) => le(v.favH2hPpg, 0.8) && ge(v.f.h2hN, 3)],
  ['promoted_dog_early', 'Promoted underdog in its first 8 games', 'dog', (v) => eq(v.dg('promoted'), 1) && le(v.dg('played'), 8)],
  ['promoted_fav', 'Promoted side is the favourite', 'fav', (v) => eq(v.fv('promoted'), 1)],
  ['season_opening', 'Opening two rounds of the season', 'fav', (v) => le(v.fv('played'), 2) && le(v.dg('played'), 2)],
  ['season_finale', 'Final rounds (92%+ of the season played)', 'fav', (v) => ge(v.f.progress, 0.92)],
  ['fav_elo_falling', 'Favourite\'s Elo down 40+ points in 90 days', 'fav', (v) => le(v.fv('eloChg90'), -40)],
  ['fav_elo_rising', 'Favourite\'s Elo up 40+ points in 90 days', 'fav', (v) => ge(v.fv('eloChg90'), 40)],
  ['dog_elo_rising', 'Underdog\'s Elo up 40+ points in 90 days', 'dog', (v) => ge(v.dg('eloChg90'), 40)],
  ['fav_red_recent', 'Favourite had a red card in its last 3 games', 'fav', (v) => ge(v.fv('red3'), 1)],
  ['elo_doubts_fav', 'Elo gives the favourite 10+ points less than the price', 'fav', (v) => v.favEloExp != null && v.favEloExp - v.favP <= -0.1],
  ['elo_backs_fav', 'Elo gives the favourite 10+ points more than the price', 'fav', (v) => v.favEloExp != null && v.favEloExp - v.favP >= 0.1],
  ['fav_form_slump', 'Favourite took 1 pt/game or less from its last 5', 'fav', (v) => le(v.fv('ppg5'), 1)],
  ['dog_hot_form', 'Underdog took 2+ pts/game from its last 5', 'dog', (v) => ge(v.dg('ppg5'), 2)],
  ['balanced_draw', 'Evenly matched (home and away within 5 points)', 'draw', (v) => Math.abs(v.f.p1 - v.f.p2) <= 0.05],
  ['low_total_draw', 'Price expects 2.2 goals or fewer', 'draw', (v) => le(v.f.lamT, 2.2)],
  ['h2h_draws', 'Half or more of 4+ recent meetings drawn', 'draw', (v) => ge(v.f.h2hDraw, 0.5) && ge(v.f.h2hN, 4)],
  ['both_dead_draw', 'Neither side has anything to play for', 'draw', (v) => eq(v.f.h_dead, 1) && eq(v.f.a_dead, 1)],
  ['hyped_over', 'Both sides went over 2.5 in 70%+ of their last 10', 'over', (v) => ge(v.f.h_o25r, 0.7) && ge(v.f.a_o25r, 0.7)],
  ['short_over', 'Over 2.5 priced as a 65%+ shot', 'over', (v) => ge(v.f.pO25, 0.65)],
  ['h2h_goalfest', 'Recent meetings averaged 3.5+ goals (3+ meetings)', 'over', (v) => ge(v.f.h2hGoals, 3.5) && ge(v.f.h2hN, 3)],
  ['goals_beating_odds', 'Both sides\' games beat the expected total by 0.5+ goals', 'over', (v) => ge(v.f.h_tve10, 0.5) && ge(v.f.a_tve10, 0.5)],
  ['chance_rich', 'Both sides create 1.6+ chance-based goals per game', 'over', (v) => ge(v.f.h_xgf10, 1.6) && ge(v.f.a_xgf10, 1.6)],
  ['cold_under', 'Both sides went over 2.5 in 30% or less of their last 10', 'under', (v) => le(v.f.h_o25r, 0.3) && le(v.f.a_o25r, 0.3)],
  ['h2h_tight', 'Recent meetings averaged 1.8 goals or fewer (3+ meetings)', 'under', (v) => le(v.f.h2hGoals, 1.8) && ge(v.f.h2hN, 3)],
  ['relegation_six_pointer', 'Both sides in a relegation fight', 'under', (v) => eq(v.f.h_dropFight, 1) && eq(v.f.a_dropFight, 1)],
  ['dead_rubber_over', 'Neither side has anything to play for', 'over', (v) => eq(v.f.h_dead, 1) && eq(v.f.a_dead, 1)],
  ['short_under', 'Under 2.5 priced as a 60%+ shot', 'under', (v) => v.f.pO25 != null && 1 - v.f.pO25 >= 0.6],
].map(([id, desc, selection, when]) => ({ id, desc, selection, when }));

/** The market key a rule's selection refers to, for this fixture. */
function keyOf(selection, v) {
  if (selection === 'fav') return v.favHome ? '1' : '2';
  if (selection === 'dog') return v.favHome ? '2' : '1';
  if (selection === 'draw') return 'X';
  if (selection === 'over') return 'O2.5';
  if (selection === 'under') return 'U2.5';
  return null;
}

let VERDICTS = null;
function verdicts() {
  if (VERDICTS) return VERDICTS;
  try {
    VERDICTS = require('./rules.json');
  } catch {
    VERDICTS = { rules: {} };
  }
  return VERDICTS;
}

const PLAIN = {
  trap: 'Confirmed trap — the price over-states this selection',
  edge: 'Confirmed edge — the price under-states this selection',
  weak: 'Weak signal — seen in the past, not confirmed in recent seasons',
  unstable: 'Unstable — the effect reversed in recent seasons',
  'priced-in': 'Priced in — the bookmakers already account for this',
};

/**
 * Rules that fire for a fixture, with their measured verdicts.
 * @param {Object<string,number|null>} f  factor values
 */
function evaluate(f) {
  const v = view(f);
  if (!v) return [];
  const V = verdicts().rules || {};
  const out = [];
  for (const r of RULES) {
    let hit = false;
    try {
      hit = !!r.when(v);
    } catch {
      hit = false;
    }
    if (!hit) continue;
    const ver = V[r.id] || null;
    out.push({
      id: r.id,
      desc: r.desc,
      selection: r.selection,
      key: keyOf(r.selection, v),
      verdict: ver ? ver.status : 'untested',
      plain: ver ? PLAIN[ver.status] : 'Not yet measured',
      evidence: ver ? { said: ver.confirm.said, won: ver.confirm.won, n: ver.confirm.n, z: ver.confirm.z, discovery: { said: ver.discovery.said, won: ver.discovery.won, n: ver.discovery.n } } : null,
    });
  }
  const order = { trap: 0, edge: 1, weak: 2, unstable: 3, 'priced-in': 4, untested: 5 };
  return out.sort((a, b) => order[a.verdict] - order[b.verdict]);
}

module.exports = { RULES, view, keyOf, evaluate, verdicts, PLAIN };
