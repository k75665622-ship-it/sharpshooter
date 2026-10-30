'use strict';

/**
 * intel/index.js — the v6 match intelligence for one live fixture.
 *
 *   crawled data (football-data stats + prices, ClubElo now/30/90 days, ESPN, Open-Meteo)
 *     -> the same 170 factors the research measured (lib/factors/features.js)
 *     -> v6 probabilities for every market (lib/intel/predict.js)
 *     -> the decision: main / safer / value / avoid, confidence (lib/intel/decision.js)
 *     -> patterns and traps with their measured verdicts (lib/intel/rules.js)
 *     -> every factor family in plain English, with how hard it pulled (lib/intel/explain.js)
 *
 * Failure-safe: any missing source just leaves its factors unknown (null). A fixture with
 * neither a price nor enough history returns { available:false, reason }.
 */

const L = require('../leagues');
const FDS = require('../crawler/sources/footballdata');
const WH = require('../crawler/warehouse');
const ELOT = require('../crawler/sources/clubelo');
const WX = require('../crawler/sources/weather');
const F = require('../factors/features');
const RC = require('../factors/records');
const SL = require('../scoreline');
const P = require('./predict');
const D = require('./decision');
const X = require('./explain');
const RULES = require('./rules');
const PACE = require('../pace');
const M = require('../model');
const MK = require('../market');

let RECORD = null;
function record() {
  if (RECORD) return RECORD;
  try {
    RECORD = require('./record.json');
  } catch {
    RECORD = null;
  }
  return RECORD;
}

const CATALOG_KEYS = F.catalog().map((c) => c.key);

/** Odds object (records.js shape) from the fixture's quotes: Bet365 first, the training book. */
function oddsFromQuotes(quotes, consensus) {
  const qs = (quotes || []).filter((q) => q && q.aggregate !== 'avg');
  const has1x2 = (q) => q.h > 1 && q.d > 1 && q.a > 1 && q.aggregate !== 'max';
  const pickBook = (names) => {
    for (const n of names) {
      const q = qs.find((x) => has1x2(x) && x.book === n);
      if (q) return q;
    }
    return qs.find(has1x2) || null;
  };
  const ref = pickBook(['Bet365', 'Pinnacle', 'DraftKings', 'William Hill', 'Bwin']);
  const maxQ = (quotes || []).find((q) => q.aggregate === 'max' && q.h > 1);
  if (ref) {
    const tot = qs.find((q) => q.book === ref.book && q.line === 2.5 && q.over > 1 && q.under > 1)
      || qs.find((q) => q.line === 2.5 && q.over > 1 && q.under > 1 && q.aggregate !== 'max');
    return {
      odds: {
        h: ref.h, d: ref.d, a: ref.a,
        // book dispersion is only defined against a full best-of-market feed (as in training)
        maxH: maxQ ? maxQ.h : null, maxD: maxQ ? maxQ.d : null, maxA: maxQ ? maxQ.a : null,
        o25: tot ? tot.over : null, u25: tot ? tot.under : null,
        maxO25: maxQ && maxQ.line === 2.5 ? maxQ.over : null, maxU25: maxQ && maxQ.line === 2.5 ? maxQ.under : null,
        ahLine: null, ahH: null, ahA: null, close: null,
      },
      source: `${ref.book}${tot ? '' : ' (no Over/Under 2.5 price)'}`,
      synthetic: false,
    };
  }
  if (consensus && consensus.x12) {
    const fr = consensus.x12.fair;
    const t = consensus.totals && consensus.totals['2.5'] ? consensus.totals['2.5'].fair : null;
    return {
      odds: { h: 1 / fr.home, d: 1 / fr.draw, a: 1 / fr.away, o25: t ? 1 / t.over : null, u25: t ? 1 / t.under : null, close: null },
      source: `multi-book consensus (${consensus.nBooks} books)`,
      synthetic: true,
    };
  }
  return { odds: null, source: null, synthetic: false };
}

/** Per-feature pull (probability points) toward a pick, from the right model output. */
function pullFor(main, pred) {
  if (!main || !pred.explain) return null;
  const k = main.key;
  const e = pred.explain;
  const neg = (o) => (o ? Object.fromEntries(Object.entries(o).map(([a, v]) => [a, -v])) : null);
  let raw = null;
  if (e.result) {
    if (['1', 'DNB_H'].includes(k) || /^AH_H_/.test(k)) raw = e.result.home;
    if (['2', 'DNB_A'].includes(k) || /^AH_A_/.test(k)) raw = e.result.away;
    if (k === 'X') raw = e.result.draw;
    if (k === '1X') raw = neg(e.result.away);
    if (k === 'X2') raw = neg(e.result.home);
    if (k === '12') raw = neg(e.result.draw);
  }
  if (/^O\d|^TT[HA]_O/.test(k)) raw = e.over25 || (e.goals ? sumObj(e.goals.home, e.goals.away) : null);
  if (/^U\d|^TT[HA]_U/.test(k)) raw = neg(e.over25 || (e.goals ? sumObj(e.goals.home, e.goals.away) : null));
  if (k === 'BTTS_Y') raw = e.btts;
  if (k === 'BTTS_N') raw = neg(e.btts);
  return raw ? X.toPoints(raw, main.prob) : null;
}
function sumObj(a, b) {
  const o = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) o[k] = (o[k] || 0) + v;
  return o;
}

const r4 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10000) / 10000);

/** Compact team log rows for the trend charts. */
function trendRows(log) {
  return log.slice(0, 10).map((g) => ({
    date: g.date, opp: g.opp, venue: g.venue, gf: g.gf, ga: g.ga, htgf: g.htgf, htga: g.htga,
    sotf: g.sotf, sota: g.sota, cf: g.cf, ca: g.ca, res: g.gf > g.ga ? 'W' : g.gf === g.ga ? 'D' : 'L',
    pve: g.pW != null ? r4(g.points - (3 * g.pW + g.pD)) : null,
  }));
}

/**
 * @param {object} match   normalised ESPN fixture
 * @param {object} ctx     lib/analysis.js context (quotes, consensus, evidence, form, gameInfo, statsLeague...)
 * @param {object[]} markets v5 markets with prices (mk.v5price.best)
 */
async function analyse(match, ctx, markets) {
  const slug = match.league;
  const lg = L.get(slug) || {};
  const day = String(match.date || new Date().toISOString()).slice(0, 10);
  const homeSlug = lg.cup ? ctx.homeStatsLeague || slug : slug;
  const awaySlug = lg.cup ? ctx.awayStatsLeague || slug : slug;
  const sameLeague = homeSlug === awaySlug;
  const div = FDS.LEAGUES[slug] ? FDS.LEAGUES[slug].div : null; // the competition itself (null = cup / uncovered)
  const divH = FDS.LEAGUES[homeSlug] ? FDS.LEAGUES[homeSlug].div : null;
  const divA = FDS.LEAGUES[awaySlug] ? FDS.LEAGUES[awaySlug].div : null;

  const espnRes = ctx.evidence && ctx.evidence.espnResults ? ctx.evidence.espnResults : null;
  let [hist, eloT, hFd, aFd] = await Promise.all([
    divH || divA ? WH.historyFor([homeSlug, awaySlug], day).catch(() => null) : null,
    ELOT.trend(slug, match.home.name, match.away.name, day).catch(() => null),
    divH ? WH.resolveTeam(homeSlug, match.home.name, espnRes, day).catch(() => null) : null,
    divA ? WH.resolveTeam(awaySlug, match.away.name, sameLeague ? espnRes : null, day).catch(() => null) : null,
  ]);

  // A club new to this division (promoted / relegated) has its recent form in the neighbouring
  // division: load that only when needed, as research did (a club's form follows it across divisions).
  if (hist && ((hFd && hist.teamLog(divH, hFd, day, 10).length < 10) || (aFd && hist.teamLog(divA, aFd, day, 10).length < 10))) {
    hist = (await WH.historyFor([homeSlug, awaySlug], day, { neighbours: true }).catch(() => null)) || hist;
  }

  // ---- the fixture's price: football-data's own row first (the training definition)
  let odds = null;
  let priceSource = null;
  let synthetic = false;
  if (div && hFd && aFd) {
    const row = await WH.fixtureRow(div, day, hFd, aFd).catch(() => null);
    if (row && row.odds && row.odds.h) {
      odds = row.odds;
      priceSource = 'football-data.co.uk (Bet365 + best of market)';
    }
  }
  if (!odds) {
    const q = oddsFromQuotes(ctx.quotes, ctx.consensus);
    odds = q.odds;
    priceSource = q.source;
    synthetic = q.synthetic;
  }

  const season = div ? RC.seasonOf(day, div) : null;
  const fx = {
    league: div || slug,
    season,
    date: day,
    home: hFd || match.home.name,
    away: aFd || match.away.name,
    eloH: eloT && eloT.home ? eloT.home.now : null,
    eloA: eloT && eloT.away ? eloT.away.now : null,
    odds,
  };
  const homeLog = hist && hFd ? hist.teamLog(divH, hFd, day, 40) : [];
  const awayLog = hist && aFd ? hist.teamLog(divA, aFd, day, 40) : [];
  const h2h = hist && hFd && aFd && sameLeague ? hist.h2h(divH, hFd, aFd, day, 6, 10) : [];
  const table = hist && div && sameLeague ? hist.table(div, season, day) : null;
  const env = hist && div ? hist.env(div, day) : null;
  const prevTeams = hist && div ? hist.teamsInSeason(div, season - 1) : null;

  const f = F.compute({ fixture: fx, homeLog, awayLog, h2h, table, env, prevTeams });
  // the possession model (lib/pace.js): shots per game x goals per shot, both sides, one league
  const paceBase = hist && div && sameLeague ? PACE.baseFromHistory(hist, div, day) : null;
  const pace = paceBase ? PACE.lambdas({ homeLog, awayLog, base: paceBase }) : null;
  // Elo momentum from ClubElo's own history (live archive rows carry no Elo)
  const chg = (s, d) => (s && s.now != null && s[d] != null ? s.now - s[d] : null);
  f.h_eloChg30 = r4(chg(eloT && eloT.home, 'd30'));
  f.h_eloChg90 = r4(chg(eloT && eloT.home, 'd90'));
  f.a_eloChg30 = r4(chg(eloT && eloT.away, 'd30'));
  f.a_eloChg90 = r4(chg(eloT && eloT.away, 'd90'));
  f.d_eloChg30 = f.h_eloChg30 != null && f.a_eloChg30 != null ? r4(f.h_eloChg30 - f.a_eloChg30) : null;
  f.d_eloChg90 = f.h_eloChg90 != null && f.a_eloChg90 != null ? r4(f.h_eloChg90 - f.a_eloChg90) : null;
  if (synthetic) for (const k of ['ovr', 'ovrOU', 'disp1', 'dispX', 'disp2', 'dispO', 'dispU']) f[k] = null;
  f.divc = div; // a cup or an uncovered league is an unseen category: the model treats it as such

  const known = CATALOG_KEYS.filter((k) => f[k] != null).length;
  const coverage = known / CATALOG_KEYS.length;
  if (f.p1 == null && homeLog.length < 6 && awayLog.length < 6) {
    return { available: false, version: '6.0', reason: 'No bookmaker price and fewer than 6 archived games for either side — not enough to rate this fixture.', coverage: r4(coverage) };
  }
  const pred = P.predict(f);
  if (!pred) return { available: false, version: '6.0', reason: 'The v6 models are not installed.', coverage: r4(coverage) };

  // ---- prices for the decision: the v5 multi-book best price per market
  const prices = {};
  for (const mk of markets || []) if (mk.v5price && mk.v5price.best && mk.v5price.best.price > 1) prices[mk.key] = { best: mk.v5price.best };

  // ---- patterns: a confirmed trap on a selection keeps it out of the picks
  const patterns = RULES.evaluate(f);
  const trapKeys = new Set(patterns.filter((p) => p.verdict === 'trap').map((p) => p.key));
  const dec = D.decide({ p: pred.p, base: pred.base, prices, home: match.home.name, away: match.away.name, exclude: trapKeys });
  const conf = D.confidence(dec.main, { hasMarket: pred.source === 'market+factors', coverage, crossLeague: !sameLeague || !div }, record());
  const pull = pullFor(dec.main, pred);
  const families = X.families({
    f,
    names: { home: match.home.name, away: match.away.name },
    logs: { home: homeLog, away: awayLog },
    h2h,
    table,
    fd: { home: hFd, away: aFd },
    pull,
  });
  const topPull = pull
    ? Object.entries(pull).filter(([k]) => k !== 'divc').sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 8)
      .map(([k, v]) => ({ key: k, label: labelOf(k), pts: Math.round(v * 1000) / 10, value: f[k] }))
    : [];

  // ---- traps: the model's, the confirmed rules', and data cautions
  const traps = [];
  for (const a of dec.avoid) {
    traps.push({ kind: 'model', key: a.key, label: `${a.label} is overrated by the price`, detail: `Price says ${(a.base * 100).toFixed(0)}%, the factors say ${(a.prob * 100).toFixed(0)}% (${(a.shift * 100).toFixed(1)} pts).` });
  }
  for (const p of patterns.filter((x) => x.verdict === 'trap')) {
    traps.push({ kind: 'rule', key: p.key, label: p.desc, detail: p.evidence ? `Since 2023 the price said ${(p.evidence.said * 100).toFixed(0)}%, it won ${(p.evidence.won * 100).toFixed(0)}% (${p.evidence.n} matches).` : p.plain });
  }
  if (!sameLeague || !div) traps.push({ kind: 'data', label: 'Cup or cross-league tie', detail: 'Form and table come from different competitions; the forecast leans on the price.' });
  if (coverage < 0.5) traps.push({ kind: 'data', label: 'Thin data', detail: `Only ${Math.round(coverage * 100)}% of the factors could be measured.` });
  if (f.h_red3 >= 1 || f.a_red3 >= 1) traps.push({ kind: 'data', label: 'Recent red card', detail: 'A red card in the last 3 games can mean a suspension — check the line-up.' });

  // ---- context the model did not use (labelled as such)
  const venue = ctx.gameInfo && ctx.gameInfo.venue ? ctx.gameInfo.venue : null;
  const weather = venue && venue.address ? await WX.forKickoff({ city: venue.address.city, country: venue.address.country }, match.date).catch(() => null) : null;
  if (weather && weather.flags && weather.flags.length) traps.push({ kind: 'context', label: `Weather: ${weather.flags.join(', ')}`, detail: 'Extreme conditions are not in the model; treat goal markets with care.' });
  const restAll = (form) => (form && form.lastGameDate ? Math.round((Date.parse(match.date) - Date.parse(form.lastGameDate)) / 86400000) : null);

  const sp = SL.predict(pred.lamH, pred.lamA, { home: pred.p['1'], draw: pred.p.X, away: pred.p['2'], over25: pred.p['O2.5'] });
  const P2 = (k) => r4(pred.p[k]);
  const B2 = (k) => (pred.base ? r4(pred.base[k]) : null);
  const KEYS = ['1', 'X', '2', '1X', 'X2', '12', 'DNB_H', 'DNB_A', 'O0.5', 'O1.5', 'O2.5', 'O3.5', 'O4.5', 'U1.5', 'U2.5', 'U3.5', 'U4.5', 'BTTS_Y', 'BTTS_N',
    'TTH_O0.5', 'TTH_O1.5', 'TTH_O2.5', 'TTA_O0.5', 'TTA_O1.5', 'TTA_O2.5', 'TTH_U1.5', 'TTA_U1.5', 'AH_H_-1', 'AH_A_-1', 'AH_H_1', 'AH_A_1', 'AH_H_-1.5', 'AH_A_-1.5', 'AH_H_1.5', 'AH_A_1.5'];

  return {
    available: true,
    version: '6.0',
    source: pred.source,
    priceSource,
    coverage: r4(coverage),
    factorsKnown: known,
    factorsTotal: CATALOG_KEYS.length,
    names: { home: hFd, away: aFd },
    lam: { home: r4(pred.lamH), away: r4(pred.lamA) },
    probs: Object.fromEntries(KEYS.map((k) => [k, P2(k)])),
    base: pred.base ? Object.fromEntries(KEYS.map((k) => [k, B2(k)])) : null,
    bttsModel: r4(pred.pBtts),
    pace: pace ? paceOut(pace) : null,
    decision: {
      main: dec.main,
      safer: dec.safer,
      value: dec.value,
      avoid: dec.avoid,
      confidence: conf,
      top: dec.candidates.slice(0, 8),
    },
    score: { predicted: sp.predicted, mostLikely: sp.mostLikely, top: sp.top, halfTime: sp.halfTime, band: sp.band },
    families,
    topPull,
    patterns,
    traps,
    trends: { home: trendRows(homeLog), away: trendRows(awayLog) },
    h2h: h2h.map((m) => ({ date: m.date, home: m.home, away: m.away, hg: m.hg, ag: m.ag })),
    table: table && hFd && aFd
      ? {
          n: table.n,
          home: rowBrief(table.rows.get(hFd)),
          away: rowBrief(table.rows.get(aFd)),
        }
      : null,
    elo: eloT || null,
    context: {
      weather,
      restAllComps: { home: restAll(ctx.form && ctx.form.home), away: restAll(ctx.form && ctx.form.away) },
    },
    data: {
      archive: hist ? hist.provenance : null,
      historyGames: { home: homeLog.length, away: awayLog.length },
      h2hMeetings: h2h.length,
    },
    factors: f,
  };
}

/** The possession model for the report: expected goals, shots, finishing, and its market probabilities. */
function paceOut(p) {
  const sm = M.scoreMatrix(p.lamH, p.lamA, MK.rhoFor(p.lamH + p.lamA));
  const probs = P.marketsFromMatrix(sm);
  const per = (t) => ({ shotsFor: r4(t.perGame.shotsFor), shotsAgainst: r4(t.perGame.shotsAgainst), conversion: r4(t.perGame.conversion), conversionAllowed: r4(t.perGame.conversionAllowed), games: t.games });
  return {
    lam: { home: r4(p.lamH), away: r4(p.lamA) },
    shots: { home: r4(p.shots.home), away: r4(p.shots.away) },
    efficiency: { home: r4(p.efficiency.home), away: r4(p.efficiency.away) },
    home: per(p.home),
    away: per(p.away),
    probs: Object.fromEntries(Object.entries(probs).map(([k, v]) => [k, r4(v)])),
  };
}

function rowBrief(r) {
  return r ? { pos: r.pos, pts: r.pts, gp: r.gp, gd: r.gf - r.ga, w: r.w, d: r.d, l: r.l } : null;
}

const LABEL = (() => {
  const m = {};
  for (const c of F.catalog()) m[c.key] = c.side ? `${c.side === 'h' ? 'Home' : 'Away'}: ${c.label}` : c.label;
  return m;
})();
function labelOf(k) {
  return LABEL[k] || k;
}

module.exports = { analyse, oddsFromQuotes, pullFor, trendRows };
