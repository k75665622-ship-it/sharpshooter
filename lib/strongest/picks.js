'use strict';

/**
 * strongest/picks.js — which selections become Strongest Picks.
 *
 * A selection joins the list when ALL of these hold:
 *   - every independent view rates it at least C.floor (75%); corners and bookings, which
 *     have no bookmaker price on free data, need C.floorStatsOnly (80%) from both views
 *   - at least two views exist, and goal markets are anchored by a real bookmaker price
 *   - it still pays something: probability at most C.maxProb (fair odds 1.14 or more)
 *   - the v6 layer does not flag it as a bookmaker trap or as overrated by the price
 *   - no serious team news (two or more high-severity reports) on the side it backs
 *   - the match has not kicked off; player picks never qualify (they hang on the line-up)
 *
 * One pick per match: the qualifying selection whose LOWEST view is highest. There is no
 * fixed number of picks — a day can have none, three or twelve.
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

/** Reasons a selection cannot be a Strongest Pick ([] = it qualifies). */
function blockers(s, ctx) {
  const why = [];
  if (ctx.started) why.push('The match has kicked off.');
  if (s.group === 'Players') why.push('Scorer picks depend on the line-up, so they are never on the list.');
  if (s.prob > C.maxProb) why.push(`Pays too little: fair odds ${(1 / s.prob).toFixed(2)}.`);
  const bar = isStatsOnly(s) ? C.floorStatsOnly : C.floor;
  if (s.floor < bar - 1e-9) why.push(`Its lowest view is ${pct(s.floor)}, under the ${pct(bar)} bar.`);
  if (s.nViews < C.minViews) why.push('Only one view could price it.');
  if (!isStatsOnly(s) && !ctx.hasMarket) why.push('No bookmaker price to anchor it.');
  if (isStatsOnly(s) && ctx.statsGames && Math.min(ctx.statsGames.home, ctx.statsGames.away) < C.minGamesStatsOnly) {
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

/** Order: highest lowest-view first, then the main probability. */
const stronger = (a, b) => b.floor - a.floor || b.prob - a.prob;

/** Ranking strength for the list: statistics-only picks give way to bookmaker-anchored ones. */
const strength = (s) => s.floor - (isStatsOnly(s) ? C.statsOnlyPenalty : 0);
const strongerForList = (a, b) => strength(b) - strength(a) || b.prob - a.prob;

/** The best selection of each of the nine groups, for the match card. */
function cardPicks(sels) {
  const out = [];
  for (const g of GROUPS) {
    const list = sels.filter((s) => s.group === g);
    if (!list.length) {
      out.push({ group: g, none: true, note: g === 'Corners' || g === 'Bookings' ? 'No match statistics for this league in the free archive.' : g === 'Players' ? 'No scorer data for these teams.' : 'Not enough data.' });
      continue;
    }
    const lo = g === 'Players' ? C.cardMinProbPlayers : C.cardMinProb;
    const ok = list.filter((s) => s.prob >= lo && s.prob <= C.maxProb).sort(stronger);
    if (!ok.length) {
      out.push({ group: g, none: true, note: 'Every line is either too short to be worth it or too unlikely.' });
      continue;
    }
    out.push({ ...ok[0], level: levelOf(ok[0].floor) });
  }
  return out;
}

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
      // a near miss: blocked only by its lowest view being a little under the bar
      if (!miss && s.group !== 'Players' && !f.ctx.started && s.prob <= C.maxProb && s.floor >= C.nearMissFloor) {
        const onlyFloor = why.every((w) => /lowest view/.test(w));
        if (onlyFloor) miss = { sel: s, why };
      }
    }
    if (best) picks.push({ fixture: f.id, kickoff: f.kickoff, sel: { ...best, tier: tierOf(best.floor) } });
    else if (miss) near.push({ fixture: f.id, kickoff: f.kickoff, sel: miss.sel, why: miss.why });
  }
  picks.sort((a, b) => strongerForList(a.sel, b.sel) || String(a.kickoff).localeCompare(String(b.kickoff)));
  near.sort((a, b) => strongerForList(a.sel, b.sel));
  return { picks, nearMisses: near.slice(0, 6), combined: combined(picks.map((p) => p.sel.prob)) };
}

/** Chance that the strongest N picks all land (different matches: independent). */
function combined(probs) {
  const sizes = [...new Set([2, 3, 5, probs.length])].filter((k) => k >= 2 && k <= probs.length).sort((a, b) => a - b);
  return sizes.map((k) => {
    const p = probs.slice(0, k).reduce((a, x) => a * x, 1);
    return { size: k, all: k === probs.length, prob: p, fairOdds: 1 / p };
  });
}

module.exports = { select, cardPicks, blockers, combined, tierOf, levelOf, isStatsOnly, stronger, strength };
