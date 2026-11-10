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
const CAL = require('./calibrate');
const BL = require('../betbuilder');
const REC = require('./record');
const GUARD = require('./guard');
const LG = require('../leagues');

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
    raw: r4(sel.raw),
    measured: !!sel.measured,
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

  // the live guard: the rule's own settled picks, by market family and league
  let guard = null;
  try {
    const log = o.guardLog || REC.guardLog();
    const g = GUARD.evaluate(log, o.day || new Date().toISOString().slice(0, 10));
    guard = { ...g, checked: log.length };
  } catch {
    guard = null;
  }
  const sel = PK.select(ok.map((x) => ({ id: String(x.r.match.id), kickoff: x.r.match.date, sels: x.sels, ctx: guard ? { ...x.fx.ctx, guard } : x.fx.ctx })));
  const pickByFixture = new Map(sel.picks.map((p) => [p.fixture, p.sel.key]));

  const picks = sel.picks.map((p) => {
    const x = byId.get(p.fixture);
    return { match: brief(x.r.match, x.fx.facts.fd), pick: selOut(p.sel, x.fx, x.r), expectedGoals: viewsOut(x.fx), data: dataOut(x.fx) };
  });
  // the day's slips, each leg named, with how slips built that way did on past matches
  const pickOut = new Map(picks.map((p) => [p.match.id, p]));
  const meas = (CAL.measured() || {}).slips || {};
  const slips = sel.slips.map((sl) => ({
    id: sl.id,
    target: sl.target,
    size: sl.size,
    prob: r4(sl.prob),
    fairOdds: r4(sl.fairOdds),
    bookOdds: r4(sl.bookOdds),
    legs: sl.legs.map((l) => {
      const p = pickOut.get(l.fixture);
      return { fixture: l.fixture, key: l.key, label: p.pick.label, prob: p.pick.prob, kickoff: p.match.date, home: p.match.home.name, away: p.match.away.name, league: p.match.leagueName };
    }),
    measured: sl.id === 'all' ? ((meas.bySize || {})[String(sl.size)] || null) : (meas[sl.id] || null),
  }));
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

  // the Bet Builder (lib/betbuilder.js) reads the same analysis of every match
  let betbuilder = null;
  try {
    const bb = BL.forDay(ok.map((x) => ({ match: brief(x.r.match, x.fx.facts.fd), fx: x.fx, sels: x.sels, ctx: x.fx.ctx })));
    betbuilder = { version: BL.CFG.version, date: o.day || null, generatedAt: new Date().toISOString(), ...bb };
  } catch (err) {
    betbuilder = { error: String((err && err.message) || err), builders: [], matches: [] };
  }

  return {
    version: C.version,
    date: o.day || null,
    generatedAt: new Date().toISOString(),
    betbuilder,
    rules: rules(),
    counts: {
      analysed: (reports || []).length,
      analysable: analysable.length,
      priced: ok.length,
      picks: picks.length,
      upcoming: matches.filter((m) => !m.started).length,
      // what the day's analysis had to work with
      withPrice: ok.filter((x) => x.fx.ctx.hasMarket).length,
      withCorners: ok.filter((x) => x.fx.cornerViews && x.fx.cornerViews.length > 0).length,
      // upcoming matches in leagues the rule was never measured on (no Strongest Pick there)
      untested: C.testedLeaguesOnly ? ok.filter((x) => !x.fx.ctx.started && !C.testedLeagues.includes(x.r.match.league)).length : 0,
    },
    picks,
    guard: guard ? {
      checked: guard.checked,
      suspended: [...Object.values(guard.families), ...Object.values(guard.leagues)].map(guardOut),
      watch: guard.watch.map(guardOut),
      config: GUARD.CFG,
    } : null,
    slips,
    combined: sel.combined.map((c) => ({ ...c, prob: r4(c.prob), fairOdds: r4(c.fairOdds) })),
    nearMisses,
    matches,
    failed: done.filter((x) => x.error).map((x) => ({ match: brief(x.r.match), error: x.error })),
  };
}

function rules() {
  const p = (v) => `${Math.round(v * 100)}%`;
  return [
    `The chance shown is MEASURED: what selections like it actually won on 2019-26 matches, given what each view said. A pick needs ${p(C.minChance)} (${p(C.minChanceStatsOnly)} for corners and bookings).`,
    `Every view must still rate it at least ${p(C.floor)}: the bookmaker-anchored market model, the stats model with no price, the v6 factor model and the possession model (shots a game x goals per shot, for both sides).`,
    'Corners and bookings are priced from the teams\' form AND the bookmakers\' read of the match (a strong favourite pins its opponent back; lopsided games are booked less), and only when that price exists.',
    `Nothing the bookmakers rate above ${p(C.maxProb)}: a pick must still pay at least ${(1 / C.maxProb).toFixed(2)}.`,
    'Nothing the v6 layer flags as a bookmaker trap or as overrated by the price, nothing hit by serious team news, and no market without a measured record (minutes, scorers).',
    ...(C.excluded.length ? [`Kept off the list, the match cards and the bet builders because they did not hold their stated chance on past matches, or paid almost nothing: ${[...new Set(C.excluded.map(excludedLabel))].join(', ')}.`] : []),
    ...(C.testedLeaguesOnly ? [`Only the ${C.testedLeagues.length} leagues the rule was measured on: England 1-5, Scotland 1-4, Germany 1-2, Italy 1-2, Spain 1-2, France 1-2, Netherlands, Belgium, Portugal, Turkey, Greece, USA, Mexico, Japan, China, Sweden, Norway, Denmark, Austria, Switzerland, Poland, Romania and Russia. Brazil and Argentina were measured and failed (double chance won 83% when it said 90%), so they get no pick; anywhere else is untested.`] : []),
    `A live guard checks the rule against its own results: a market or league whose last ${GUARD.CFG.window} settled picks won clearly less than they said (${GUARD.CFG.z} standard errors, ${GUARD.CFG.minPicks}+ picks) is suspended for ${GUARD.CFG.days} days.`,
    'One pick per match, no fixed number: a weak day gives few picks rather than forced ones.',
    `Picks are from different matches, so on one slip their chances multiply: ten ${p(C.minChance)} picks land together only ${p(Math.pow(C.minChance, 10))} of the time. The safe slip keeps the combined chance at ${p(C.safeSlipChance)}+.`,
  ];
}

const FAMILY_LABEL = {
  'TT_O0.5': 'Team to score', 'TT_O1.5': 'Team over 1.5 goals', 'TT_O2.5': 'Team over 2.5 goals', DC: 'Double chance', WIN: 'Match winner',
  12: 'Either team to win', 'U3.5': 'Under 3.5 goals', 'O1.5': 'Over 1.5 goals', 'O2.5': 'Over 2.5 goals', 'H2_O0.5': 'Goal in the 2nd half',
  'H1_O0.5': 'Goal in the 1st half', C_TEAM_O: 'Team corners over', C_O: 'Total corners over', C_MOST: 'Most corners', K_O: 'Cards over',
  K_U: 'Cards under', BTTS_Y: 'Both teams to score', WEH_H: 'Home to win either half', WEH_A: 'Away to win either half',
};

/** One guard entry for the page: named in plain words. */
function guardOut(g) {
  const lg = g.kind === 'league' ? LG.get(g.name) : null;
  return {
    kind: g.kind, id: g.name, name: g.kind === 'league' ? (lg && lg.name !== g.name ? lg.name : g.name) : FAMILY_LABEL[g.name] || g.name,
    n: g.n, won: r4(g.won), stated: r4(g.stated), z: r4(g.z), since: g.since || null, until: g.until || null,
  };
}

/** Plain name of an excluded market (both sides of a team market read as one). */
function excludedLabel(key) {
  let m;
  if ((m = /^TT[HA]_U0\.5$/.exec(key))) return 'clean sheets';
  if ((m = /^TT[HA]_([OU])(\d\.5)$/.exec(key))) return `team ${m[1] === 'O' ? 'over' : 'under'} ${m[2]} goals`;
  if (/^C_U\d+\.5$/.test(key)) return 'total corners under';
  return MAR.label(key, 'Home', 'Away');
}

/** Public thresholds and the measured record of the rule, for the page. */
function publicConfig() {
  return {
    minChance: C.minChance,
    minChanceStatsOnly: C.minChanceStatsOnly,
    floor: C.floor,
    floorStatsOnly: C.floorStatsOnly,
    maxProb: C.maxProb,
    excluded: C.excluded,
    testedLeaguesOnly: C.testedLeaguesOnly,
    testedLeagues: C.testedLeagues,
    failedLeagues: C.failedLeagues || [],
    safeSlipChance: C.safeSlipChance,
    longSlipChance: C.longSlipChance,
    tiers: C.tiers,
    cardLevels: C.cardLevels,
    version: C.version,
    measured: CAL.measured(),
  };
}

module.exports = { forReports, publicConfig, rules, record: REC, CFG: C };
