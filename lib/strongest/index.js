'use strict';

/**
 * strongest/index.js — the Strongest Picks for a day.
 *
 *   engine reports (lib/engine.js, the site's full analysis of every fixture)
 *     -> inputs.js   archive corners / cards / half-times, referee, players, line-ups
 *     -> markets.js  the nine SportyBet groups, each selection priced by independent views
 *     -> picks.js    one Strongest Pick per match when every view agrees (no fixed count)
 *     -> reasons.js  the facts behind every pick, and its caveats
 *
 * The section reads the site's analysis but changes none of it.
 */

const C = require('./config');
const MAR = require('./markets');
const IN = require('./inputs');
const PK = require('./picks');
const RS = require('./reasons');
const REC = require('./record');

const r4 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10000) / 10000);

function brief(m, fd) {
  const team = (t) => ({ name: t.name, short: t.short || null, logo: t.logo || null });
  return {
    id: String(m.id),
    league: m.league,
    leagueName: m.leagueName || m.league,
    leagueFlag: m.leagueFlag || null,
    leagueTier: m.leagueTier || null,
    date: m.date,
    state: m.state || null,
    seasonYear: m.seasonYear || null,
    home: team(m.home),
    away: team(m.away),
    fd: fd && (fd.home || fd.away) ? fd : null,
  };
}

/** The best real price the site saw for a selection, and the edge against our probability. */
function priceOf(report, sel) {
  const mk = (report.markets || []).find((x) => x.key === sel.key);
  const best = mk && mk.v5price && mk.v5price.best && mk.v5price.best.price > 1 ? mk.v5price.best : null;
  return best ? { best: r4(best.price), book: best.book || null, edge: r4(sel.prob * best.price - 1) } : null;
}

function selOut(sel, fx, report) {
  const ex = RS.explain(sel, fx, report);
  const out = {
    key: sel.key,
    group: sel.group,
    label: sel.label,
    kind: sel.kind,
    side: sel.side,
    prob: r4(sel.prob),
    floor: r4(sel.floor),
    main: sel.main,
    views: Object.fromEntries(Object.entries(sel.views).map(([k, v]) => [k, r4(v)])),
    nViews: sel.nViews,
    fair: r4(1 / sel.prob),
    takeAt: r4(Math.max(1.05, 1.02 / sel.prob)),
    tier: sel.tier || null,
    level: sel.level || null,
    checks: ex.checks,
    reasons: ex.reasons,
    caveats: ex.caveats,
    price: priceOf(report, sel),
  };
  if (sel.player) out.player = { name: sel.player.name, fullName: sel.player.fullName || null, team: sel.player.team, lineup: sel.player.lineup || null, source: sel.player.source };
  if (sel.expected) out.expected = sel.expected;
  return out;
}

function viewsOut(fx) {
  const out = {};
  for (const v of fx.goalViews || []) out[v.name] = { home: r4(v.lamH), away: r4(v.lamA), total: r4(v.lamH + v.lamA) };
  return out;
}

function dataOut(fx) {
  const c = fx.ctx;
  return {
    hasMarket: c.hasMarket,
    views: (fx.goalViews || []).map((v) => v.name),
    corners: fx.cornerViews.length > 0,
    bookings: fx.cardViews.length > 0,
    players: c.playersSource,
    lineups: c.lineupKnown,
    archiveGames: c.archiveGames,
    firstHalfShare: r4(fx.timing.s1),
    referee: fx.facts.referee ? { name: fx.facts.referee.name, perGame: r4(fx.facts.referee.perGame), games: fx.facts.referee.games, used: fx.facts.referee.used } : null,
    crossLeague: c.crossLeague,
  };
}

async function eachLimited(items, n, fn) {
  const queue = [...items];
  const out = [];
  async function worker() {
    while (queue.length) {
      const it = queue.shift();
      out.push(await fn(it));
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, queue.length || 1) }, worker));
  return out;
}

/**
 * @param {object[]} reports  engine reports for the day (server.js analyseDay)
 * @param {{day?:string}} [o]
 */
async function forReports(reports, o = {}) {
  const analysable = (reports || []).filter((r) => r && r.analysable && r.match);
  const done = await eachLimited(analysable, 6, async (r) => {
    try {
      const fx = await IN.gather(r);
      return { r, fx, sels: MAR.price(fx) };
    } catch (err) {
      return { r, error: String((err && err.message) || err) };
    }
  });
  done.sort((a, b) => new Date(a.r.match.date) - new Date(b.r.match.date));
  const ok = done.filter((x) => !x.error);
  const byId = new Map(ok.map((x) => [String(x.r.match.id), x]));

  const sel = PK.select(ok.map((x) => ({ id: String(x.r.match.id), kickoff: x.r.match.date, sels: x.sels, ctx: x.fx.ctx })));
  const pickByFixture = new Map(sel.picks.map((p) => [p.fixture, p.sel.key]));

  const picks = sel.picks.map((p) => {
    const x = byId.get(p.fixture);
    return { match: brief(x.r.match, x.fx.facts.fd), pick: selOut(p.sel, x.fx, x.r), expectedGoals: viewsOut(x.fx), data: dataOut(x.fx) };
  });
  const nearMisses = sel.nearMisses.map((p) => {
    const x = byId.get(p.fixture);
    return { match: brief(x.r.match, x.fx.facts.fd), pick: selOut(p.sel, x.fx, x.r), why: p.why };
  });
  const matches = ok.map((x) => {
    const id = String(x.r.match.id);
    return {
      match: brief(x.r.match, x.fx.facts.fd),
      started: x.fx.ctx.started,
      strongest: pickByFixture.get(id) || null,
      cards: PK.cardPicks(x.sels).map((c) => (c.none ? c : selOut(c, x.fx, x.r))),
      expectedGoals: viewsOut(x.fx),
      data: dataOut(x.fx),
    };
  });

  return {
    version: C.version,
    date: o.day || null,
    generatedAt: new Date().toISOString(),
    rules: rules(),
    counts: {
      analysed: (reports || []).length,
      analysable: analysable.length,
      priced: ok.length,
      picks: picks.length,
      upcoming: matches.filter((m) => !m.started).length,
    },
    picks,
    combined: sel.combined.map((c) => ({ ...c, prob: r4(c.prob), fairOdds: r4(c.fairOdds) })),
    nearMisses,
    matches,
    failed: done.filter((x) => x.error).map((x) => ({ match: brief(x.r.match), error: x.error })),
  };
}

function rules() {
  const p = (v) => `${Math.round(v * 100)}%`;
  return [
    `Every independent view must rate the pick at least ${p(C.floor)}: the bookmaker-anchored market model, the stats model with no price, and the v6 factor model.`,
    `Corners and bookings have no bookmaker price on free data, so both of their views (season and last 6 games) must reach ${p(C.floorStatsOnly)}, and in the same match a bookmaker-backed pick comes first.`,
    `Nothing above ${p(C.maxProb)}: a pick must still pay at least ${(1 / C.maxProb).toFixed(2)} at fair odds.`,
    'Nothing the v6 layer flags as a bookmaker trap or as overrated by the price, and nothing hit by serious team news.',
    'One pick per match, no fixed number of picks: a day can have none, three or twelve.',
  ];
}

/** Public thresholds, for the page. */
function publicConfig() {
  return { floor: C.floor, floorStatsOnly: C.floorStatsOnly, maxProb: C.maxProb, tiers: C.tiers, cardLevels: C.cardLevels, version: C.version };
}

module.exports = { forReports, publicConfig, rules, record: REC, CFG: C };
