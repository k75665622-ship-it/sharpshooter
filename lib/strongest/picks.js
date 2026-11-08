'use strict';

/**
 * strongest/picks.js — which selections become Strongest Picks.
 *
 * A selection joins the list when ALL of these hold:
 *   - its MEASURED chance (lib/strongest/calibrate.js: what selections like it actually won on
 *     2019-26 matches) is at least C.minChance; corners and bookings, which have no bookmaker
 *     price of their own, need C.minChanceStatsOnly
 *   - every independent view still rates it at least C.floor (C.floorStatsOnly for corners and
 *     bookings): the views must agree, not just average out
 *   - the market has a measured record at all (minutes markets and scorers do not), and corners
 *     and bookings are only priced when the bookmakers' read of the match is known
 *   - it still pays something: the bookmakers' own probability at most C.maxProb (fair odds 1.08+)
 *   - it is not one of the markets kept off for their record (C.excluded: team unders, BTTS No...)
 *   - the match is in a league the rule was measured on (C.testedLeagues)
 *   - the v6 layer does not flag it as a bookmaker trap or as overrated by the price
 *   - no serious team news (two or more high-severity reports) on the side it backs
 *   - the match has not kicked off
 *
 * One pick per match: the qualifying selection with the highest measured chance. There is no
 * fixed number of picks — a day can have none, three or twelve.
 *
 * Slips (slips()): picks from different matches are independent, so a slip's chance is the
 * product of its legs' and every leg lowers it — ten 88% picks land together only 28% of the
 * time. The safe slip takes the strongest picks first while the combined chance stays at
 * C.safeSlipChance (75%), the longer slip at C.longSlipChance (60%).
 *
 * Pure. No I/O.
 */

const C = require('./config');
const { GROUPS } = require('./markets');

const pct = (p) => `${Math.round(p * 100)}%`;

function tierOf(p) {
  const t = C.tiers.find((x) => p >= x.min - 1e-9);
  return t ? t.name : null;
}

function levelOf(p) {
  const t = C.cardLevels.find((x) => p >= x.min - 1e-9);
  return t ? t.name : C.cardLevels[C.cardLevels.length - 1].name;
}

const isStatsOnly = (s) => s.kind === 'corners' || s.kind === 'cards';

/** A market kept off the list, the match cards and the bet builders for its record. */
const isExcluded = (key) => C.excluded.includes(key);

/** The probability the price pays on: the bookmakers' own for goal markets, ours otherwise. */
const payProb = (s) => (!isStatsOnly(s) && s.views && s.views.market != null ? s.views.market : s.prob);

/** Reasons a selection cannot be a Strongest Pick ([] = it qualifies). */
function blockers(s, ctx) {
  const why = [];
  const statsOnly = isStatsOnly(s);
  if (ctx.started) why.push('The match has kicked off.');
  if (s.group === 'Players') why.push('Scorer picks depend on the line-up, so they are never on the list.');
  else if (!s.measured) {
    why.push(statsOnly
      ? 'No bookmaker price to read the match with, so its corners and bookings cannot be measured.'
      : 'This market has no measured record on past matches.');
  }
  if (isExcluded(s.key)) why.push('This market is kept off the list: on past matches it did not hold its stated chance.');
  if (C.testedLeaguesOnly && ctx.league && !C.testedLeagues.includes(ctx.league)) why.push('The rule was never measured on this league, so its chance here is untested.');
  const pay = payProb(s);
  if (pay > C.maxProb) why.push(`Pays too little: fair odds ${(1 / pay).toFixed(2)}.`);
  const need = statsOnly ? C.minChanceStatsOnly : C.minChance;
  if (s.measured && s.prob < need - 1e-9) why.push(`Measured chance ${pct(s.prob)}, under the ${pct(need)} bar.`);
  const bar = statsOnly ? C.floorStatsOnly : C.floor;
  if (s.floor < bar - 1e-9) why.push(`Its lowest view is ${pct(s.floor)}, under the ${pct(bar)} bar.`);
  if (s.nViews < C.minViews) why.push('Only one view could price it.');
  if (!statsOnly && !ctx.hasMarket) why.push('No bookmaker price to anchor it.');
  if (statsOnly && ctx.statsGames && Math.min(ctx.statsGames.home, ctx.statsGames.away) < C.minGamesStatsOnly) {
    why.push(`Fewer than ${C.minGamesStatsOnly} archived games with match statistics for one of the teams.`);
  }
  if ((ctx.avoid && ctx.avoid.has(s.key)) || (ctx.ruleTraps && ctx.ruleTraps.has(s.key))) why.push('The v6 layer lists it as a bookmaker trap.');
  if (ctx.shift && ctx.shift[s.key] != null && ctx.shift[s.key] <= C.trapShift) {
    why.push(`The v6 factors rate it ${Math.abs(ctx.shift[s.key] * 100).toFixed(1)} points below the price.`);
  }
  const sides = s.side === 'both' ? ['home', 'away'] : s.side ? [s.side] : [];
  for (const sd of sides) {
    if (ctx.news && ctx.news[sd] && ctx.news[sd].highs >= 2) why.push(`Two or more serious team-news reports for the ${sd} side.`);
  }
  return why;
}

/** Order for the match cards: highest lowest-view first, then the chance. */
const stronger = (a, b) => b.floor - a.floor || b.prob - a.prob;

/** Ranking strength for the list: the measured chance; statistics-only picks give way. */
const strength = (s) => s.prob - (isStatsOnly(s) ? C.statsOnlyPenalty : 0);
const strongerForList = (a, b) => strength(b) - strength(a) || b.floor - a.floor;

/** The best selection of each of the nine groups, for the match card. */
function cardPicks(sels) {
  const out = [];
  for (const g of GROUPS) {
    const list = sels.filter((s) => s.group === g && !isExcluded(s.key));
    if (!list.length) {
      out.push({ group: g, none: true, note: g === 'Corners' || g === 'Bookings' ? 'No match statistics for this league in the free archive.' : g === 'Players' ? 'No scorer data for these teams.' : 'Not enough data.' });
      continue;
    }
    const lo = g === 'Players' ? C.cardMinProbPlayers : C.cardMinProb;
    const ok = list.filter((s) => s.prob >= lo && payProb(s) <= C.maxProb).sort(stronger);
    if (!ok.length) {
      out.push({ group: g, none: true, note: 'Every line is either too short to be worth it or too unlikely.' });
      continue;
    }
    out.push({ ...ok[0], level: levelOf(Math.min(ok[0].floor, ok[0].prob)) });
  }
  return out;
}

/** Blocked only by a bar (chance or lowest view), and close to it? */
const BAR = /under the \d+% bar/;

/**
 * Strongest Picks across a day.
 * @param {Array<{id:string, kickoff:string, sels:object[], ctx:object}>} fixtures
 * @returns {{picks:object[], nearMisses:object[], combined:object[]}}
 */
function select(fixtures) {
  const picks = [];
  const near = [];
  for (const f of fixtures) {
    const ranked = [...f.sels].sort(strongerForList);
    let best = null;
    let miss = null;
    for (const s of ranked) {
      const why = blockers(s, f.ctx);
      if (!why.length) {
        best = s;
        break;
      }
      // a near miss: blocked only by a bar it nearly reaches
      if (!miss && s.group !== 'Players' && !f.ctx.started && s.measured && s.prob >= C.nearMissFloor && why.every((w) => BAR.test(w))) {
        miss = { sel: s, why };
      }
    }
    if (best) picks.push({ fixture: f.id, kickoff: f.kickoff, sel: { ...best, tier: tierOf(best.prob) } });
    else if (miss) near.push({ fixture: f.id, kickoff: f.kickoff, sel: miss.sel, why: miss.why });
  }
  picks.sort((a, b) => strongerForList(a.sel, b.sel) || String(a.kickoff).localeCompare(String(b.kickoff)));
  near.sort((a, b) => strongerForList(a.sel, b.sel));
  return { picks, nearMisses: near.slice(0, 6), combined: combined(picks.map((p) => p.sel.prob)), slips: slips(picks) };
}

/**
 * The day's slips from its Strongest Picks (strongest first, as the list ranks them).
 *   safe    the strongest picks while the combined chance stays at C.safeSlipChance (2+ legs)
 *   long    the same while it stays at C.longSlipChance
 *   all     every pick (shown with its chance: the more legs, the less often it lands)
 * Slips with the same legs are shown once.
 * @param {Array<{fixture:string, sel:{prob:number, key:string}}>} picks strongest first
 */
function slips(picks) {
  const out = [];
  const seen = new Set();
  const add = (id, legs, target) => {
    if (legs.length < 2 || seen.has(legs.length)) return;
    seen.add(legs.length);
    const prob = legs.reduce((a, p) => a * p.sel.prob, 1);
    const pay = legs.reduce((a, p) => a * Math.max(0.01, payProb(p.sel)), 1);
    out.push({ id, target: target || null, size: legs.length, legs: legs.map((p) => ({ fixture: p.fixture, key: p.sel.key })), prob, fairOdds: 1 / prob, bookOdds: 1 / pay });
  };
  const upTo = (target) => {
    const legs = [];
    let p = 1;
    for (const x of picks) {
      if (legs.length >= 2 && p * x.sel.prob < target - 1e-9) break;
      legs.push(x);
      p *= x.sel.prob;
    }
    return p >= target - 1e-9 ? legs : [];
  };
  add('safe', upTo(C.safeSlipChance), C.safeSlipChance);
  add('long', upTo(C.longSlipChance), C.longSlipChance);
  add('all', picks);
  return out;
}

/** Chance that the strongest N picks all land (different matches: independent). */
function combined(probs) {
  const sizes = [...new Set([2, 3, 5, probs.length])].filter((k) => k >= 2 && k <= probs.length).sort((a, b) => a - b);
  return sizes.map((k) => {
    const p = probs.slice(0, k).reduce((a, x) => a * x, 1);
    return { size: k, all: k === probs.length, prob: p, fairOdds: 1 / p };
  });
}

module.exports = { select, cardPicks, blockers, combined, slips, tierOf, levelOf, isStatsOnly, isExcluded, payProb, stronger, strength };
