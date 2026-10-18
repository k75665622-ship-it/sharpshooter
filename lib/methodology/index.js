'use strict';

/**
 * methodology/index.js — registry + runner.
 *
 * For one fixture: build the View once, evaluate EVERY methodology against it,
 * and return which ones the match "falls under". That is the behaviour asked
 * for: if the data fits Over 2.5, predict Over 2.5; if it fits BTTS No, predict
 * BTTS No; and so on for all eleven markets.
 *
 * Contradictions are resolved, not hidden. Two qualifying picks that cannot both
 * be right (Over 2.5 and Under 2.5, Home Win and Draw, BTTS No and GG 2+ ...) are
 * reduced to the higher-scoring one and the drop is recorded.
 */

const core = require('./core');
const goals = require('./goals');
const results = require('./results');
const score = require('./score');

const SPECS = [
  goals.over25,
  goals.under25,
  goals.bttsYes,
  goals.bttsNo,
  goals.gg2,
  goals.teamGoals,
  results.homeWin,
  results.draw,
  results.awayWin,
  results.dogPlus,
  results.favMinus,
  results.doubleChance,
  score.correctScore,
];

const BY_ID = Object.fromEntries(SPECS.map((s) => [s.id, s]));

/**
 * Pairs that cannot both be true. Order-free. A qualifying pair is resolved to
 * its higher-scoring member.
 *
 * Team-total and handicap picks are checked against their SELECTION, not just
 * their methodology id, via `conflicts()` below.
 */
const EXCLUSIVE = [
  ['over25', 'under25'],
  ['bttsYes', 'bttsNo'],
  ['homeWin', 'draw'],
  ['homeWin', 'awayWin'],
  ['draw', 'awayWin'],
  ['gg2', 'bttsNo'],
  ['gg2', 'under25'],
];

/** Selection-level contradictions that id pairs cannot express. */
function conflicts(a, b) {
  const pair = [a.id, b.id].sort().join('|');
  if (EXCLUSIVE.some((p) => p.slice().sort().join('|') === pair)) return true;

  const k = (r) => r.pick.key || '';
  const kinds = [a, b];
  const tt = kinds.find((r) => r.id === 'teamGoals');
  const other = kinds.find((r) => r !== tt);
  if (tt && other) {
    const failsToScore = /^TT[HA]_U0\.5$/.test(k(tt));
    const side = /^TTH/.test(k(tt)) ? 'home' : 'away';
    // "Team fails to score" contradicts BTTS Yes and GG 2+.
    if (failsToScore && (other.id === 'bttsYes' || other.id === 'gg2')) return true;
    // "Team scores 2+" contradicts BTTS No only for the side that must blank — handled by prob, skipped here.
    // Team Over 1.5 and Under 2.5 together are possible (2-0), so no conflict.
    if (/^TT[HA]_U1\.5$/.test(k(tt)) && other.id === 'gg2') return true;
    // A team that fails to score cannot win.
    if (failsToScore && ((side === 'home' && other.id === 'homeWin') || (side === 'away' && other.id === 'awayWin'))) return true;
  }
  // Double Chance: 1X contradicts an away win, X2 a home win.
  const dc = kinds.find((r) => r.id === 'doubleChance');
  const dcOther = kinds.find((r) => r !== dc);
  if (dc && dcOther) {
    if (k(dc) === '1X' && dcOther.id === 'awayWin') return true;
    if (k(dc) === 'X2' && dcOther.id === 'homeWin') return true;
  }
  // Underdog + vs favourite − on the same match overlap only partly; they are different lines of one view.
  return false;
}

/**
 * Evaluate every methodology against the fixture.
 *
 * @param {object} input  see core.buildView
 * @returns {{ view:object, results:Array, predictions:Array, headline:object|null, dropped:Array, coverage:object }}
 */
function evaluateFixture(input) {
  const V = core.buildView(input);
  const all = SPECS.map((spec) => core.evaluateSpec(spec, V));

  // ---- resolve contradictions among qualifying picks
  const dropped = [];
  const qual = all.filter((r) => r.qualifies).sort((a, b) => core.STATUS_RANK[b.status] - core.STATUS_RANK[a.status] || b.score - a.score);
  const kept = [];
  for (const r of qual) {
    const clash = kept.find((k) => conflicts(k, r));
    if (clash) {
      dropped.push({ id: r.id, name: r.name, pick: r.pick.label, score: r.score, reason: `Contradicts ${clash.name} (${clash.pick.label}, score ${clash.score}).` });
      r.status = 'WATCH';
      r.qualifies = false;
      r.flags = [...(r.flags || []), `Set aside: contradicts ${clash.name}.`];
    } else kept.push(r);
  }

  // A methodology can opt out of the fixture headline (the correct score is reported in
  // its own Final Score panel and must never displace a market pick).
  const headlineSpec = (r) => !(BY_ID[r.id] && BY_ID[r.id].headline === false);
  const headline = kept.find(headlineSpec) || null;

  return {
    view: V,
    results: all,
    predictions: kept,
    headline,
    dropped,
    coverage: V.coverage,
  };
}

/** Compact, JSON-safe form of a result (drops the heavy per-game arrays). */
function slim(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    version: r.version,
    family: r.family,
    pick: r.pick,
    status: r.status,
    qualifies: r.qualifies,
    prob: r.prob,
    modelProb: r.modelProb != null ? r.modelProb : null,
    line35: r.line35 || null,
    fairOdds: r.fairOdds,
    floor: r.floor,
    price: r.price,
    score: r.score,
    tier: r.tier,
    gates: r.gates,
    failedGates: r.failedGates,
    checklist: r.checklist,
    support: r.support,
    failure: r.failure,
    flags: r.flags,
    sample: r.sample,
    maxLegs: r.maxLegs,
    stake: r.stake,
    paperOnly: r.paperOnly,
    candidates: r.candidates,
  };
}

/** The JSON shape attached to a match report. */
function summarise(out) {
  const V = out.view;
  return {
    predictions: out.predictions.map(slim),
    headline: slim(out.headline),
    all: out.results.map(slim),
    dropped: out.dropped,
    coverage: out.coverage,
    context: {
      favourite: V.fav.side ? { side: V.fav.side, price: V.fav.price, heavy: V.fav.heavy, source: V.fav.source } : null,
      elo: V.elo,
      league: V.league,
      rest: V.rest,
      evidenceBasis: V.coverage.basis,
      sides: {
        home: sideBrief(V.sides.home),
        away: sideBrief(V.sides.away),
      },
      h2h: V.h2h ? { n: V.h2h.n, btts: V.h2h.btts, o25: V.h2h.o25, draw: V.h2h.draw } : null,
    },
  };
}

function sideBrief(S) {
  return {
    n: S.n,
    sample: S.sample,
    form: S.form,
    gfpg: S.gfpg,
    gapg: S.gapg,
    dist: { g0: S.gf0, g1: S.gf1, g2p: S.gf2p, g3p: S.gf3p },
    cs: S.cs,
    fts: S.fts,
    btts: S.btts,
    o25: S.o25,
    u25: S.u25,
  };
}

module.exports = { SPECS, BY_ID, EXCLUSIVE, conflicts, evaluateFixture, summarise, slim, core, goals, results, score };
