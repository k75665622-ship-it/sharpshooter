'use strict';

/**
 * strongest/guard.js — the live guard: the rule checks itself against its own results.
 *
 * Every chance on the site was measured on past matches. Live football can drift away from that
 * (a league changes, a data source degrades, referees book differently), and a rule that never
 * looks at its own record keeps publishing picks that have stopped holding up. The guard reads
 * the settled Strongest Picks and, for each market family (double chance, team to score, cards
 * over...) and each league, compares how often they won with how often they said they would.
 *
 *   z = (won - sum of stated chances) / sqrt(sum of chance x (1 - chance))   on the last N picks
 *
 * When z falls below -CFG.z on at least CFG.minPicks picks, the family or league is SUSPENDED
 * from the Strongest Picks for CFG.days days: its selections stay on the match cards, it is named
 * on the page with its numbers, and it comes back with a clean slate afterwards (the picks before
 * the suspension no longer count against it).
 *
 * research/v7/guard_study.js replays it day by day on the archive. On honest markets it almost
 * never fires (it costs a few picks); where a market or league really ran under its chance it
 * fires and stays out.
 *
 * Pure. The log is whatever the record holds: { day, family, league, prob, hit }.
 */

const CFG = {
  z: 2.5, // how far under its stated chance (in standard errors) before a suspension
  window: 120, // the last N settled picks of a family / league
  minPicks: 30, // never judged on fewer
  days: 21, // how long a suspension lasts
};

function zOf(list) {
  let n = 0;
  let w = 0;
  let p = 0;
  let v = 0;
  for (const e of list) {
    n++;
    w += e.hit;
    p += e.prob;
    v += e.prob * (1 - e.prob);
  }
  return { n, won: n ? w / n : null, stated: n ? p / n : null, z: v > 0 ? (w - p) / Math.sqrt(v) : 0 };
}

const addDays = (day, k) => new Date(Date.parse(day + 'T00:00:00Z') + k * 86400000).toISOString().slice(0, 10);

/**
 * Walk the settled picks in order and work out what is suspended on `today`.
 * @param {Array<{day:string, family:string, league:string, prob:number, hit:number}>} log oldest first
 * @param {string} today YYYY-MM-DD: picks of earlier days only are read
 * @param {object} [cfg]
 * @returns {{families:object, leagues:object, started:object[], watch:object[]}}
 */
function evaluate(log, today, cfg = CFG) {
  const out = { families: {}, leagues: {}, started: [], watch: [] };
  for (const [kind, field, bag] of [['family', 'family', out.families], ['league', 'league', out.leagues]]) {
    const by = new Map();
    for (const e of log || []) {
      if (!e || e.day >= today || !(e.hit === 0 || e.hit === 1) || !(e.prob > 0) || !e[field]) continue;
      if (!by.has(e[field])) by.set(e[field], []);
      by.get(e[field]).push(e);
    }
    for (const [name, list] of by) {
      // replay this family's history: a suspension wipes the slate and skips the days it covers
      let recent = [];
      let until = null;
      let last = null;
      for (const e of list) {
        if (until && e.day < until) continue; // settled while suspended (it was not on the list)
        recent.push(e);
        if (recent.length > cfg.window) recent.shift();
        if (recent.length >= cfg.minPicks) {
          const s = zOf(recent);
          if (s.z < -cfg.z) {
            until = addDays(e.day, cfg.days + 1);
            last = { kind, name, since: addDays(e.day, 1), until, n: s.n, won: s.won, stated: s.stated, z: s.z };
            recent = [];
          }
        }
      }
      if (last && today < last.until) {
        bag[name] = last;
        if (last.since === today) out.started.push(last);
      } else if (recent.length >= cfg.minPicks) {
        const s = zOf(recent);
        if (s.z < -cfg.z * 0.6) out.watch.push({ kind, name, n: s.n, won: s.won, stated: s.stated, z: s.z });
      }
    }
  }
  return out;
}

module.exports = { CFG, evaluate, zOf };
