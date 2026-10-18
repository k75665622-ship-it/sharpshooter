'use strict';

/**
 * evidence.js — per-league, per-day evidence shared by every fixture in it:
 * verified results (lib/sources/results.js), the Dixon-Coles ratings fitted on
 * them (lib/ratings.js), and each fixture's per-game history bundle for the
 * methodology layer (0/1/2+ goal distributions, venue splits, head-to-head).
 *
 * One league is loaded and fitted ONCE per day and served to all its fixtures
 * (coalesced, so concurrent fixtures never trigger duplicate work).
 */

const RS = require('./sources/results');
const R = require('./ratings');
const H = require('./history');
const N = require('./sources/names');

const cache = new Map(); // key -> { at, value | promise }
const TTL = 3 * 60 * 60 * 1000;

function leagueContext(slug, kickoffISO) {
  const day = String(kickoffISO || new Date().toISOString()).slice(0, 10);
  const key = `${slug}:${day}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  const value = (async () => {
    try {
      const res = await RS.leagueResults(slug, day);
      if (!res.matches.length) return { slug, results: [], provenance: res.provenance, ratings: null };
      const seasonStart = RS.seasonRange(slug, RS.seasonStartFor(slug, day)).from;
      const newcomers = R.newcomersAt(res.matches, day, seasonStart);
      const ratings = R.fit(res.matches, { asOf: day, newcomers });
      return { slug, results: res.matches, provenance: res.provenance, ratings, newcomers: [...newcomers] };
    } catch (err) {
      return { slug, results: [], provenance: { error: String((err && err.message) || err) }, ratings: null };
    }
  })();
  cache.set(key, { at: Date.now(), value });
  // a failed/empty load is retried after 10 minutes, never pinned for the full TTL
  value.then((v) => {
    if (!v.results.length) cache.set(key, { at: Date.now() - TTL + 10 * 60 * 1000, value });
  });
  return value;
}

function namesOf(ms) {
  const s = new Set();
  for (const m of ms) {
    s.add(m.home);
    s.add(m.away);
  }
  return [...s];
}

/** Resolve an ESPN fixture name to the spelling used in this league's results. */
function resolveIn(lc, espnName) {
  if (!lc || !lc.results.length) return null;
  const names = namesOf(lc.results);
  if (names.includes(espnName)) return espnName;
  return N.matchName(espnName, names);
}

/**
 * Evidence for one fixture.
 * @param {object} match  normalised fixture (league, date, home.name, away.name)
 * @param {string} homeLeague  league whose results describe the home side (its domestic league in a cup)
 * @param {string} awayLeague
 */
async function fixtureEvidence(match, homeLeague, awayLeague) {
  const kickoff = String(match.date || new Date().toISOString());
  const day = kickoff.slice(0, 10);
  const [lh, la] = await Promise.all([
    leagueContext(homeLeague, kickoff),
    awayLeague === homeLeague ? null : leagueContext(awayLeague, kickoff),
  ]);
  const lcA = la || lh;
  const hName = resolveIn(lh, match.home.name);
  const aName = resolveIn(lcA, match.away.name);
  const sameLeague = !la;

  let ratings = null;
  if (sameLeague && lh.ratings && hName && aName) {
    const p = R.predict(lh.ratings, hName, aName);
    if (p) ratings = { lamH: p.lamH, lamA: p.lamA, confidence: p.confidence, known: p.known, league: homeLeague };
  }

  let hist = null;
  if (hName && aName) {
    const home = teamGames(lh.results, hName, day, 12);
    const away = teamGames(lcA.results, aName, day, 12);
    if (home.length || away.length) {
      hist = {
        source: 'verified-results',
        crossLeague: !sameLeague,
        leagueRates: H.leagueRates(lh.results.filter((m) => m.date < day).slice(-380), day),
        home: { name: hName, games: home },
        away: { name: aName, games: away },
        h2h: sameLeague ? H.h2hGames(lh.results, hName, aName, day, 8) : [],
        provenance: {
          home: lh.provenance,
          away: sameLeague ? null : lcA.provenance,
          verifiedShare: shareVerified(home, away),
        },
      };
    }
  }

  return {
    ratings,
    hist,
    names: { home: hName, away: aName },
    espnResults: lh.results.filter((m) => m.src === 'espn' || m.primarySrc === 'espn'),
    provenance: { home: lh.provenance, away: sameLeague ? lh.provenance : lcA.provenance },
  };
}

/** A team's games before `before`, newest first, oriented to that team, keeping the verification tag. */
function teamGames(matches, team, before, limit) {
  const out = [];
  for (let i = matches.length - 1; i >= 0 && out.length < limit; i--) {
    const m = matches[i];
    if (m.date >= before) continue;
    if (m.home === team) out.push({ gf: m.hg, ga: m.ag, venue: 'H', date: m.date, opp: m.away, check: m.check || null });
    else if (m.away === team) out.push({ gf: m.ag, ga: m.hg, venue: 'A', date: m.date, opp: m.home, check: m.check || null });
  }
  return out;
}

function shareVerified(...lists) {
  const all = lists.flat();
  if (!all.length) return 0;
  return all.filter((g) => g.check && g.check !== 'single').length / all.length;
}

module.exports = { leagueContext, fixtureEvidence, resolveIn, _cache: cache };
