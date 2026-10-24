'use strict';

/**
 * server.js — zero-dependency HTTP server.
 *
 * No npm install required: Node's built-in http + global fetch do everything.
 *
 * Endpoints
 *   GET /                          -> the app
 *   GET /api/health                -> status + cache stats
 *   GET /api/leagues               -> league registry
 *   GET /api/matches?date=YYYY-MM-DD  -> fixture board (fast, no deep analysis)
 *   GET /api/analysis?league=&event=  -> full deep report for one match
 *   GET /api/bankers?date=&limit=     -> legacy banker election (superseded by predictions)
 *   GET /api/predictions?date=&limit= -> methodology predictions across the day, grouped by market
 *   GET /api/price-backtest           -> profit backtest on real historical odds (runs in background; ?format=json)
 *   GET /api/sources-check            -> probes candidate free data sources from this server
 *   GET /api/methodology              -> the thirteen v5 methodologies, thresholds and backtest record
 *   GET /api/ledger[?format=csv]      -> live track record (predictions recorded pre-match, settled after)
 *   GET /api/accumulator?date=        -> v6 double-confirmed accumulator (methodology + normal prediction agree)
 *   GET /api/crawler                  -> v6 crawler status: per-source requests, cache hits, robots, pauses
 *   GET /api/intel-research           -> v6 research record: factor importance, patterns, decision backtest
 *   GET /api/strongest?date=          -> Strongest Picks: nine SportyBet market groups per match, one pick per
 *                                        match when every independent view agrees (no fixed number of picks)
 *   GET /api/strongest/record[?format=csv] -> the Strongest Picks track record
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const espn = require('./lib/espn');
const L = require('./lib/leagues');
const A = require('./lib/analysis');
const E = require('./lib/engine');
const IS = require('./lib/infersports');
const MI = require('./lib/methodology');
const LEDGER = require('./lib/ledger');
const BACKTEST = require('./lib/backtest.json');
const ACC = require('./lib/intel/accumulator');
const HTTPC = require('./lib/crawler/http');
const WH = require('./lib/crawler/warehouse');
const STR = require('./lib/strongest');

const readJson = (f) => {
  try {
    return require(f);
  } catch {
    return null;
  }
};

const PORT = process.env.PORT != null && process.env.PORT !== '' && Number.isFinite(Number(process.env.PORT)) ? Number(process.env.PORT) : 3000;
// Hosted platforms (Render, Railway, Fly, Heroku) set PORT and route traffic to the
// container's public interface, so bind 0.0.0.0 there; stay on loopback for local runs.
const HOST = process.env.HOST || (process.env.PORT || process.env.RENDER ? '0.0.0.0' : '127.0.0.1');
const PUBLIC = path.join(__dirname, 'public');

// ---------------------------------------------------------------- helpers

function json(res, code, body) {
  const payload = JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function todayUTC() {
  return espn.ymd(new Date());
}

/** Accept YYYY-MM-DD or YYYYMMDD, normalise to YYYYMMDD for ESPN. */
function normaliseDate(input) {
  if (!input) return todayUTC();
  const s = String(input).replace(/-/g, '');
  if (!/^\d{8}$/.test(s)) return todayUTC();
  return s;
}

function isoFromYmd(ymd) {
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  rel = rel.split('?')[0];
  const filePath = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

// ---------------------------------------------------------------- board

/** Analysis cache for deep reports (5 min). */
const analysisCache = new Map();
const ANALYSIS_TTL = 5 * 60 * 1000;
let lastWarm = 0;

async function buildBoard(dateYmd) {
  const leagues = L.CORE_SLUGS;
  const results = await Promise.all(
    leagues.map(async (slug) => {
      const raw = await espn.scoreboardRaw(slug, dateYmd);
      return { slug, year: raw.season, events: raw.events };
    })
  );

  const matches = [];
  for (const r of results) {
    for (const ev of r.events) {
      const norm = A.normaliseEvent(ev, r.slug);
      if (!norm) continue;
      norm.seasonYear = r.year || new Date().getUTCFullYear();
      matches.push(norm);
    }
  }

  matches.sort((a, b) => new Date(a.date) - new Date(b.date));

  // Group by league, preserving a stable league ordering by tier then name.
  const groups = new Map();
  for (const m of matches) {
    if (!groups.has(m.league)) {
      groups.set(m.league, {
        slug: m.league,
        name: m.leagueName,
        flag: m.leagueFlag,
        country: m.country,
        tier: m.leagueTier,
        matches: [],
      });
    }
    groups.get(m.league).matches.push(m);
  }

  const leagueList = [...groups.values()].sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));

  // v6: crawl the archive for the leagues on the board in the background (politely, cached),
  // so the first deep analysis of each fixture does not wait for the downloads.
  if (dateYmd === todayUTC() && Date.now() - lastWarm > 30 * 60 * 1000) {
    lastWarm = Date.now();
    const slugs = leagueList.map((g) => g.slug);
    setImmediate(() => WH.warm(slugs).catch(() => 0));
  }

  return {
    date: isoFromYmd(dateYmd),
    totalMatches: matches.length,
    totalLeagues: leagueList.length,
    leagues: leagueList,
  };
}

// ---------------------------------------------------------------- deep analysis

async function getAnalysis(league, eventId, year, matchHint, dateYmd) {
  const key = `${league}:${eventId}`;
  const hit = analysisCache.get(key);
  if (hit && Date.now() - hit.at < ANALYSIS_TTL) return hit.value;

  let match = matchHint;
  if (!match) {
    // Rebuild the match from the scoreboard if the caller did not supply one.
    // This must use the *requested* date, not today — otherwise clicking any
    // fixture outside today's board fails with "Match not found" and date
    // browsing silently only ever works for the current day.
    const day = dateYmd || espn.ymd(new Date());
    const raw = await espn.scoreboardRaw(league, day);
    const ev = raw.events.find((e) => String(e.id) === String(eventId));
    if (!ev) throw new Error(`Match not found on ${day}`);
    match = A.normaliseEvent(ev, league);
    if (!match) throw new Error('Match could not be parsed');
    year = year || raw.season;
  }

  const report = await E.analyseMatch(match, year || new Date().getUTCFullYear());
  analysisCache.set(key, { at: Date.now(), value: report });
  return report;
}

/** Analyse every match on a date, with a concurrency cap. */
async function analyseDay(dateYmd, limit) {
  const board = await buildBoard(dateYmd);
  const all = board.leagues.flatMap((lg) => lg.matches);

  // Prefer matches that have bookmaker odds and are not already finished.
  const candidates = all
    .filter((m) => m.state !== 'post')
    .sort((a, b) => {
      const ao = a.odds ? 0 : 1;
      const bo = b.odds ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return a.leagueTier - b.leagueTier;
    })
    .slice(0, limit || 60);

  const reports = [];
  const queue = [...candidates];
  const CONCURRENCY = 6;

  async function worker() {
    while (queue.length) {
      const m = queue.shift();
      try {
        const rep = await getAnalysis(m.league, m.id, m.seasonYear, m);
        reports.push(rep);
      } catch (err) {
        reports.push({ match: m, analysable: false, reason: String(err.message || err), banker: null, markets: [] });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length || 1) }, worker));
  return { board, reports };
}

/** Legacy banker view: kept so existing API consumers do not break. */
async function buildBankers(dateYmd, limit) {
  const { reports } = await analyseDay(dateYmd, limit);

  const bankers = reports
    .filter((r) => r.analysable && r.banker)
    .map((r) => ({
      match: r.match,
      banker: r.banker,
      model: r.model,
      verdict: r.verdict,
      patterns: r.patterns,
      lineMovement: r.lineMovement,
      newsRisk: r.newsRisk,
      dataProvenance: r.dataProvenance,
    }))
    .sort((a, b) => b.banker.score - a.banker.score);

  const best = bankers[0] || null;

  // Leans: near-misses that did NOT clear every banker gate. Surfaced
  // separately and labelled as such — never mixed in with bankers.
  const leans = reports
    .filter((r) => r.analysable && !r.banker && r.lean)
    .map((r) => ({
      match: r.match,
      lean: r.lean,
      model: r.model,
      verdict: r.verdict,
      newsRisk: r.newsRisk,
      dataProvenance: r.dataProvenance,
    }))
    .sort((a, b) => b.lean.score - a.lean.score);

  return {
    date: isoFromYmd(dateYmd),
    analysed: reports.length,
    withBanker: bankers.length,
    bankerOfTheDay: best,
    bankers,
    leans,
    all: reports.map((r) => ({
      match: r.match,
      analysable: r.analysable,
      reason: r.reason || null,
      banker: r.banker,
      lean: r.lean || null,
      model: r.model
        ? {
            lambda: r.model.lambda,
            oneXtwo: r.model.oneXtwo,
            rho: r.model.rho,
          }
        : null,
      verdict: r.verdict || null,
      topMarket: r.markets && r.markets.length
        ? [...r.markets].filter((m) => !m.vetoed).sort((a, b) => b.score - a.score)[0] || null
        : null,
    })),
  };
}

/**
 * Methodology predictions for a day.
 *
 * A fixture appears under every market it genuinely falls under. `headline` is
 * the strongest single prediction per fixture, ranked LOCK > PREDICT > PAPER.
 */
async function buildPredictions(dateYmd, limit) {
  const { reports } = await analyseDay(dateYmd, limit);
  // Write every pre-match prediction to the track record before anyone sees a result.
  try {
    LEDGER.record(reports);
  } catch {
    /* the ledger is best-effort and must never break the board */
  }
  const agg = E.collectPredictions(reports);
  const analysable = reports.filter((r) => r.analysable);
  // v6: the double-confirmed accumulator (a leg must pass a methodology AND the normal prediction)
  let accumulator = null;
  try {
    accumulator = ACC.forReports(reports);
    LEDGER.recordAcca(accumulator, isoFromYmd(dateYmd));
  } catch (err) {
    accumulator = { error: String(err && err.message ? err.message : err), legs: [], options: [] };
  }
  const withHistory = analysable.filter((r) => r.dataProvenance && r.dataProvenance.hasHistory).length;
  const withElo = analysable.filter((r) => r.dataProvenance && r.dataProvenance.hasElo).length;
  const statusCounts = {};
  for (const h of agg.headline) statusCounts[h.prediction.status] = (statusCounts[h.prediction.status] || 0) + 1;

  return {
    date: isoFromYmd(dateYmd),
    analysed: reports.length,
    analysable: analysable.length,
    predicted: agg.headline.length,
    statusCounts,
    coverage: { withHistory, withElo },
    methods: MI.SPECS.map((s) => ({ id: s.id, name: s.name, family: s.family, count: agg.counts[s.id] || 0 })),
    headline: agg.headline,
    byMethod: agg.byMethod,
    // v5: the general prediction for EVERY analysable fixture, so a match that falls under
    // no methodology still gets a result call, goals call, BTTS call and a predicted score.
    general: analysable
      .filter((r) => r.general && !r.general.error)
      .map((r) => ({ match: briefFull(r.match), general: r.general, methodology: r.methodology && r.methodology.headline ? { id: r.methodology.headline.id, status: r.methodology.headline.status, label: r.methodology.headline.pick.label } : null }))
      .sort((a, b) => new Date(a.match.date) - new Date(b.match.date)),
    accumulator,
    skipped: analysable.length - agg.headline.length,
    unanalysable: reports.filter((r) => !r.analysable).map((r) => ({ match: brief(r.match), reason: r.reason || null })),
  };
}

function brief(m) {
  return { id: m.id, league: m.league, leagueName: m.leagueName, home: m.home, away: m.away, date: m.date };
}

function briefFull(m) {
  return {
    id: m.id, league: m.league, leagueName: m.leagueName, leagueFlag: m.leagueFlag, leagueTier: m.leagueTier,
    date: m.date, home: m.home, away: m.away, state: m.state, seasonYear: m.seasonYear,
  };
}

/**
 * Strongest Picks for a day (lib/strongest). Built on the same day analysis as the
 * predictions (shared caches), cached for a few minutes, recorded before kick-off.
 */
const strongestCache = new Map();
const strongestInflight = new Map();
async function strongestDay(dateYmd, limit) {
  const key = `${dateYmd}|${limit}`;
  const hit = strongestCache.get(key);
  if (hit && Date.now() - hit.at < STR.CFG.dayCacheMinutes * 60 * 1000) return hit.value;
  // two visitors opening the tab at once share one build
  if (strongestInflight.has(key)) return strongestInflight.get(key);
  const p = (async () => {
    const { reports } = await analyseDay(dateYmd, limit);
    const day = await STR.forReports(reports, { day: isoFromYmd(dateYmd) });
    try {
      STR.record.record(day);
    } catch {
      /* the record is best-effort and must never break the page */
    }
    strongestCache.set(key, { at: Date.now(), value: day });
    if (strongestCache.size > 20) strongestCache.delete(strongestCache.keys().next().value);
    return day;
  })().finally(() => strongestInflight.delete(key));
  strongestInflight.set(key, p);
  return p;
}
async function buildStrongest(dateYmd, limit) {
  const day = await strongestDay(dateYmd, limit);
  // settle finished picks in the background (throttled inside)
  STR.record.settleAll().catch(() => 0);
  const now = Date.now();
  return {
    ...day,
    config: STR.publicConfig(),
    record: STR.record.summary(),
    earlier: STR.record.forDate(isoFromYmd(dateYmd)).filter((e) => Date.parse(e.date) <= now).map((e) => ({
      fixture: e.fixture, date: e.date, league: e.leagueName || e.league, home: e.home, away: e.away, group: e.group, label: e.label,
      prob: e.prob, floor: e.floor, tier: e.tier, result: e.result, hit: e.hit, ht: e.ht || null,
    })),
  };
}

// Settling the ledger touches ESPN once per league-day; do it at most every 10 minutes.
let lastSettle = 0;
async function settleLedger() {
  if (Date.now() - lastSettle < 10 * 60 * 1000) return 0;
  lastSettle = Date.now();
  try {
    return await LEDGER.settleAll();
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------- router

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  try {
    if (p === '/api/health') {
      return json(res, 200, {
        ok: true,
        time: new Date().toISOString(),
        today: isoFromYmd(todayUTC()),
        leaguesConfigured: L.all().length,
        coreLeagues: L.CORE_SLUGS.length,
        analysisCached: analysisCache.size,
        sources: [
          'site.api.espn.com/apis/site/v2/sports/soccer/{league}/scoreboard',
          'site.api.espn.com/apis/site/v2/sports/soccer/{league}/summary',
          'sports.core.api.espn.com/.../teams/{id}/statistics',
          'api.infersports.dev/v1/events/{id}/odds  (Asian books, keyless)',
          'raw.githubusercontent.com/openfootball/*  (per-game results history, keyless)',
          'api.clubelo.com/{date}  (independent Elo ratings, keyless)',
          'site.api.espn.com/.../scoreboard?dates=RANGE  (whole-season results, v5)',
          'site.api.espn.com/.../summary odds  (Bet365 + DraftKings, v5)',
          'raw.githubusercontent.com/openfootball/football.json  (19+ leagues, v5)',
          'football-data.co.uk  (results + multi-book odds incl. Pinnacle, v5)',
          'fantasy.premierleague.com/api/bootstrap-static  (Premier League availability, v5)',
          'football-data.co.uk/mmz4281/{season}/{league}.csv  (shots, corners, cards, half-time, opening+closing odds; 6 seasons, v6 crawler)',
          'football-data.co.uk/fixtures.csv  (upcoming fixtures: Bet365 + best-of-market prices, v6 crawler)',
          'api.clubelo.com/{date}  x3  (Elo now, 30 and 90 days ago: momentum, v6)',
          'geocoding-api.open-meteo.com + api.open-meteo.com  (kick-off weather, context only, v6)',
        ],
        crawler: Object.fromEntries(Object.entries(HTTPC.stats()).map(([h, s2]) => [h, { requests: s2.requests, cacheHits: s2.cacheHits, notModified: s2.notModified, errors: s2.errors, paused: s2.paused }])),
        // Secondary source diagnostics. `errors` here is informational: the
        // engine is designed to run correctly with this source unavailable.
        asianSource: IS.netStats(),
      });
    }

    if (p === '/api/sources-check') {
      return json(res, 200, await require('./lib/sourcecheck').checkSources());
    }

    if (p === '/api/price-backtest') {
      const PB = require('./lib/pricebacktest');
      const cur = PB.getJob();
      if (url.searchParams.get('start') || url.searchParams.get('restart') || (cur.status === 'idle' && !url.searchParams.get('peek'))) {
        const leagues = (url.searchParams.get('leagues') || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
        PB.startJob(leagues);
      }
      const j = PB.getJob();
      if (url.searchParams.get('format') === 'json') return json(res, 200, j);
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(PB.formatReport(j));
    }

    if (p === '/api/leagues') {
      return json(res, 200, { leagues: L.all() });
    }

    if (p === '/api/matches') {
      const dateYmd = normaliseDate(url.searchParams.get('date'));
      const board = await buildBoard(dateYmd);
      return json(res, 200, board);
    }

    if (p === '/api/analysis') {
      const league = url.searchParams.get('league');
      const eventId = url.searchParams.get('event');
      const year = Number(url.searchParams.get('year')) || null;
      const dateYmd = normaliseDate(url.searchParams.get('date'));
      if (!league || !eventId) return json(res, 400, { error: 'league and event are required' });
      const report = await getAnalysis(league, eventId, year, null, dateYmd);
      return json(res, 200, report);
    }

    if (p === '/api/predictions') {
      const dateYmd = normaliseDate(url.searchParams.get('date'));
      const limit = Number(url.searchParams.get('limit')) || 60;
      return json(res, 200, await buildPredictions(dateYmd, limit));
    }

    if (p === '/api/methodology') {
      return json(res, 200, {
        version: '5.0',
        config: MI.core.CFG,
        methods: MI.SPECS.map((s) => ({
          id: s.id, name: s.name, version: s.version, family: s.family,
          floor: s.floor, minRatio: s.minRatio || null, minSample: s.minSample || MI.core.CFG.minSample,
          paperOnly: !!s.paperOnly, maxLegs: s.maxLegs || null, stake: s.stake || null,
          headline: s.headline !== false, canLock: s.canLock !== false,
          backtest: BACKTEST.methods[s.id] || null,
        })),
        backtest: { dataset: BACKTEST.dataset, heldOut: BACKTEST.heldOut, fixtures: BACKTEST.fixtures, headline: BACKTEST.headline, general: BACKTEST.general },
      });
    }

    if (p === '/api/ledger') {
      await settleLedger();
      if (url.searchParams.get('format') === 'csv') {
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="sharpshooter-ledger.csv"' });
        return res.end(LEDGER.toCsv());
      }
      return json(res, 200, LEDGER.summary());
    }

    if (p === '/api/accumulator') {
      const dateYmd = normaliseDate(url.searchParams.get('date'));
      const limit = Number(url.searchParams.get('limit')) || 60;
      const out = await buildPredictions(dateYmd, limit);
      return json(res, 200, { date: out.date, accumulator: out.accumulator });
    }

    if (p === '/api/crawler') {
      return json(res, 200, { hosts: HTTPC.stats(), warehouse: WH.status(), userAgent: HTTPC.UA });
    }

    if (p === '/api/intel-research') {
      return json(res, 200, {
        record: readJson('./lib/intel/record.json'),
        accumulator: readJson('./lib/intel/acca_record.json'),
        importance: readJson('./lib/intel/importance.json'),
        patterns: readJson('./lib/intel/rules.json'),
      });
    }

    if (p === '/api/strongest') {
      const dateYmd = normaliseDate(url.searchParams.get('date'));
      const limit = Number(url.searchParams.get('limit')) || 60;
      return json(res, 200, await buildStrongest(dateYmd, limit));
    }

    if (p === '/api/strongest/record') {
      await STR.record.settleAll().catch(() => 0);
      if (url.searchParams.get('format') === 'csv') {
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="strongest-picks-record.csv"' });
        return res.end(STR.record.toCsv());
      }
      return json(res, 200, STR.record.summary());
    }

    if (p === '/api/bankers') {
      const dateYmd = normaliseDate(url.searchParams.get('date'));
      const limit = Number(url.searchParams.get('limit')) || 60;
      const out = await buildBankers(dateYmd, limit);
      return json(res, 200, out);
    }

    return serveStatic(req, res, p);
  } catch (err) {
    return json(res, 500, { error: String(err.message || err), stack: process.env.DEBUG ? err.stack : undefined });
  }
});

server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  console.log('');
  console.log('  SHARPSHOOTER  \u2014  football prediction engine');
  console.log('  ' + '-'.repeat(46));
  console.log(`  Running at  ${url}`);
  console.log(`  Leagues     ${L.CORE_SLUGS.length} core / ${L.all().length} total`);
  console.log('  Data        ESPN public APIs        (fixtures, xG, form, H2H)');
  console.log('              api.infersports.dev     (Asian books, multi-line)');
  console.log('              openfootball results    (per-game history, 0/1/2+ goal evidence)');
  console.log('              api.clubelo.com         (independent Elo strength read)');
  console.log('              football-data.co.uk     (v6 crawler: stats, half-times, odds history)');
  console.log('              api.open-meteo.com      (kick-off weather, context)');
  console.log('              all free and keyless');
  const q = IS.quotaSnapshot();
  console.log(`  Odds quota  ${q.limit == null ? 'unknown' : q.limit}/day` +
    (q.remaining == null ? '' : `, ${q.remaining} left`));
  if (!q.open) {
    console.log(`              EXHAUSTED \u2014 resumes in ${Math.ceil(q.resumesInSec / 60)} min;`);
    console.log('              board will price from ESPN alone until then.');
  }
  console.log('  ' + '-'.repeat(46));
  console.log('');
});

module.exports = server;
