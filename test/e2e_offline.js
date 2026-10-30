'use strict';

/**
 * test/e2e_offline.js — the whole v5 pipeline, end to end, with the internet stubbed.
 *
 *   node test/e2e_offline.js            (optionally JSDOM_PATH=/path/to/node_modules/jsdom for the UI pass)
 *
 * Every external source is replaced by a local responder that serves payloads in the
 * exact shapes the live sources use (ESPN scoreboard / summary / core statistics,
 * openfootball football.json, football-data.co.uk CSVs, Fantasy Premier League,
 * ClubElo). The results history is REAL Premier League data (openfootball + football-data
 * fixtures in test/fixtures), with ESPN-style team names, so the name learner, the
 * cross-source verifier, the ratings fit, the consensus and the methodologies all run
 * on genuine inputs. Then the real HTTP server is started and every API is called.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-e2e-'));
process.env.SHARPSHOOTER_DATA_DIR = TMP;
process.env.IS_PERSIST = '0';
process.env.IS_CACHE_DIR = path.join(TMP, 'is');

const FIX = path.join(__dirname, 'fixtures');
const realFetch = global.fetch;

let pass = 0;
let fail = 0;
function t(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

// ------------------------------------------------------------------ data
const espnName = (n) => n.replace(/ FC$/, '').replace(/ AFC$/, '').trim();
const ofSeasons = {
  '2025-26': JSON.parse(fs.readFileSync(path.join(FIX, 'of-en.1-2025-26.json'), 'utf8')),
  '2026-27': JSON.parse(fs.readFileSync(path.join(FIX, 'of-en.1-2026-27.json'), 'utf8')),
};
const played = [];
for (const s of Object.values(ofSeasons)) {
  for (const m of s.matches) {
    if (!m.score || !m.score.ft) continue;
    played.push({ date: m.date, home: espnName(m.team1), away: espnName(m.team2), hg: m.score.ft[0], ag: m.score.ft[1] });
  }
}
const teams = [...new Set(played.flatMap((m) => [m.home, m.away]))].sort();
const idOf = (n) => String(100 + teams.indexOf(n));

const today = new Date();
const kick = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 23, 30));
const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
const FIXTURES = [
  { id: '9001', home: 'Arsenal', away: 'Leeds United', dk: ['-250', '+450', '+700'], ou: ['-140', '+115'] },
  { id: '9002', home: 'Sunderland', away: 'Brighton & Hove Albion', dk: ['+210', '+240', '+130'], ou: ['-105', '-115'] },
];

function competitor(name, side, score) {
  return {
    id: idOf(name), homeAway: side, score: score == null ? undefined : String(score), form: 'WDWLW',
    team: { id: idOf(name), displayName: name, abbreviation: name.slice(0, 3).toUpperCase(), logo: null },
    records: [{ type: 'total', summary: '3-1-1' }],
  };
}

function scoreboardFor(slug, dates) {
  if (slug !== 'eng.1') return { events: [] };
  if (dates.includes('-')) {
    const [a, b] = dates.split('-');
    const from = `${a.slice(0, 4)}-${a.slice(4, 6)}-${a.slice(6)}`;
    const to = `${b.slice(0, 4)}-${b.slice(4, 6)}-${b.slice(6)}`;
    return {
      events: played.filter((m) => m.date >= from && m.date <= to).map((m, i) => ({
        id: `r${m.date}${i}`, date: `${m.date}T15:00Z`, season: { year: 2026 },
        competitions: [{ status: { type: { state: 'post', completed: true, description: 'Full Time' } },
          competitors: [{ ...competitor(m.home, 'home'), score: { value: m.hg, displayValue: String(m.hg) } }, { ...competitor(m.away, 'away'), score: { value: m.ag, displayValue: String(m.ag) } }] }],
      })),
    };
  }
  if (dates !== ymd(kick)) return { events: [] };
  return {
    season: { year: 2026 },
    events: FIXTURES.map((f) => ({
      id: f.id, date: kick.toISOString(), name: `${f.away} at ${f.home}`, shortName: 'x', season: { year: 2026 },
      competitions: [{
        status: { type: { state: 'pre', completed: false, shortDetail: '23:30' } },
        venue: { fullName: 'Stadium' },
        competitors: [competitor(f.home, 'home'), competitor(f.away, 'away')],
        odds: [{
          provider: { name: 'DraftKings' }, details: 'x',
          moneyline: { home: { close: { odds: f.dk[0] } }, away: { close: { odds: f.dk[2] } } },
          drawOdds: { moneyLine: f.dk[1] },
          total: { over: { close: { odds: f.ou[0], line: 'o2.5' } }, under: { close: { odds: f.ou[1], line: 'u2.5' } } },
          overUnder: 2.5,
        }],
      }],
    })),
  };
}

function lastFive(name) {
  const g = played.filter((m) => m.home === name || m.away === name).slice(-5);
  return {
    team: { id: idOf(name) },
    events: g.map((m) => ({ gameDate: `${m.date}T15:00Z`, homeTeamId: idOf(m.home), atVs: m.home === name ? 'vs' : '@', score: `${m.hg}-${m.ag}` })),
  };
}

function summaryFor(id) {
  const f = FIXTURES.find((x) => x.id === id);
  if (!f) return null;
  return {
    lastFiveGames: [lastFive(f.home), lastFive(f.away)],
    gameInfo: { venue: { fullName: `${f.home} Stadium`, address: { city: f.home === 'Arsenal' ? 'London' : 'Sunderland', country: 'England' } } },
    seasonseries: [],
    standings: { groups: [] },
    news: { articles: [{ headline: `${f.home} boss confident ahead of ${f.away} clash`, description: 'Preview.' }] },
    odds: [
      { provider: { id: '100', name: 'DraftKings' }, moneyline: { home: { close: { odds: f.dk[0] } }, away: { close: { odds: f.dk[2] } }, draw: { close: { odds: f.dk[1] } } }, overUnder: 2.5, total: { over: { close: { odds: f.ou[0] } }, under: { close: { odds: f.ou[1] } } } },
      {
        provider: { id: '2000', name: 'Bet 365' },
        homeTeamOdds: { odds: { summary: f.id === '9001' ? '2/7' : '6/5', value: f.id === '9001' ? 1.286 : 2.2 } },
        awayTeamOdds: { odds: { summary: f.id === '9001' ? '8/1' : '13/10', value: f.id === '9001' ? 9.0 : 2.3 } },
        drawOdds: { summary: f.id === '9001' ? '5/1' : '12/5', value: f.id === '9001' ? 6.0 : 3.4 },
        bettingOdds: { teamOdds: { preMatchOverUnderHandicap: { value: '2.5' }, preMatchGoalLineOver: { value: f.id === '9001' ? '8/13' : '10/11' }, preMatchGoalLineUnder: { value: f.id === '9001' ? '6/5' : '10/11' } } },
      },
    ],
  };
}

const statRow = (name) => {
  const g = played.filter((m) => m.date >= '2026-07-01' && (m.home === name || m.away === name));
  const gf = g.reduce((a, m) => a + (m.home === name ? m.hg : m.ag), 0);
  const ga = g.reduce((a, m) => a + (m.home === name ? m.ag : m.hg), 0);
  const n = Math.max(1, g.length);
  return {
    splits: { categories: [{ stats: [
      { name: 'appearances', value: n }, { name: 'totalGoals', value: gf }, { name: 'goalsConceded', value: ga },
      { name: 'avgExpectedGoals', value: +(gf / n * 0.9 + 0.15).toFixed(2) }, { name: 'avgExpectedGoalsConceded', value: +(ga / n * 0.9 + 0.15).toFixed(2) },
      { name: 'homeGoals', value: Math.round(gf * 0.55) }, { name: 'awayGoals', value: Math.round(gf * 0.45) },
      { name: 'totalShots', value: 12 * n }, { name: 'shotsOnTarget', value: 4 * n }, { name: 'possessionPct', value: 50 }, { name: 'cleanSheet', value: 1 },
    ] }] },
  };
};

const FPL = {
  teams: [{ id: 1, name: 'Arsenal', short_name: 'ARS' }, { id: 2, name: 'Leeds', short_name: 'LEE' }, { id: 3, name: 'Sunderland', short_name: 'SUN' }, { id: 4, name: 'Brighton', short_name: 'BHA' }],
  elements: [
    { web_name: 'Saliba', team: 1, element_type: 2, status: 'i', chance_of_playing_next_round: 0, news: 'Back injury - Unknown return date', minutes: 540, starts: 6, expected_goal_involvements: '0.4' },
    { web_name: 'Saka', team: 1, element_type: 3, status: 'a', chance_of_playing_next_round: null, news: '', minutes: 520, starts: 6, expected_goal_involvements: '3.1' },
    { web_name: 'Gyokeres', team: 1, element_type: 4, status: 'd', chance_of_playing_next_round: 50, news: 'Knock - 50% chance of playing', minutes: 500, starts: 6, expected_goal_involvements: '3.8' },
    { web_name: 'Raya', team: 1, element_type: 1, status: 'a', chance_of_playing_next_round: null, news: '', minutes: 540, starts: 6, expected_goal_involvements: '0' },
    { web_name: 'Calvert-Lewin', team: 2, element_type: 4, status: 'a', chance_of_playing_next_round: null, news: '', minutes: 450, starts: 5, expected_goal_involvements: '2.0' },
    { web_name: 'Isidor', team: 3, element_type: 4, status: 'a', chance_of_playing_next_round: null, news: '', minutes: 480, starts: 6, expected_goal_involvements: '1.9' },
    { web_name: 'Welbeck', team: 4, element_type: 4, status: 'a', chance_of_playing_next_round: null, news: '', minutes: 480, starts: 6, expected_goal_involvements: '2.2' },
  ],
};

const ddmmyyyy = (d) => `${d.toISOString().slice(8, 10)}/${d.toISOString().slice(5, 7)}/${d.toISOString().slice(0, 4)}`;
const FD_FIX = [
  'Div,Date,Time,HomeTeam,AwayTeam,B365H,B365D,B365A,PSH,PSD,PSA,AvgH,AvgD,AvgA,MaxH,MaxD,MaxA,B365>2.5,B365<2.5,P>2.5,P<2.5,Avg>2.5,Avg<2.5,Max>2.5,Max<2.5,AHh,B365AHH,B365AHA',
  `E0,${ddmmyyyy(kick)},23:30,Arsenal,Leeds,1.30,5.75,9.5,1.32,5.9,10.5,1.30,5.6,9.6,1.36,6.2,11.5,1.62,2.30,1.65,2.36,1.61,2.30,1.70,2.45,-1.5,1.95,1.95`,
  `E0,${ddmmyyyy(kick)},23:30,Sunderland,Brighton,3.10,3.40,2.30,3.20,3.45,2.33,3.05,3.35,2.30,3.30,3.55,2.42,1.95,1.90,1.97,1.93,1.93,1.88,2.02,1.98,0.25,1.95,1.95`,
].join('\n');

const ELO_BASE = { Arsenal: 2010, Leeds: 1720, Sunderland: 1700, Brighton: 1800 };
function eloCsv(dateStr) {
  const age = (Date.now() - Date.parse(dateStr + 'T00:00:00Z')) / 86400000;
  const drift = { Arsenal: age > 60 ? -25 : age > 20 ? -10 : 0, Leeds: age > 60 ? 20 : 0, Sunderland: age > 60 ? -30 : age > 20 ? -12 : 0, Brighton: 0 };
  return ['Rank,Club,Country,Level,Elo,From,To', ...Object.entries(ELO_BASE).map(([c, e], i) => `${i + 1},${c},ENG,1,${e + drift[c]},${dateStr},${dateStr}`)].join('\n');
}
const HOURLY = (day) => {
  const time = [];
  for (let h = 0; h < 24; h++) time.push(`${day}T${String(h).padStart(2, '0')}:00`);
  return { time, temperature_2m: time.map(() => 11.5), precipitation: time.map(() => 0.2), precipitation_probability: time.map(() => 30), wind_speed_10m: time.map(() => 14), wind_gusts_10m: time.map(() => 30), weather_code: time.map(() => 61) };
};

// ------------------------------------------------------------------ the stubbed internet
const hits = {};
function reply(status, body, type = 'application/json') {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, { status, headers: { 'content-type': type } });
}
global.fetch = async (input, init) => {
  const url = String(input && input.url ? input.url : input);
  const u = new URL(url);
  if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return realFetch(input, init);
  hits[u.hostname] = (hits[u.hostname] || 0) + 1;
  const p = u.pathname;
  if (u.hostname === 'site.api.espn.com') {
    let m = /\/soccer\/([^/]+)\/scoreboard$/.exec(p);
    if (m) return reply(200, scoreboardFor(m[1], u.searchParams.get('dates') || ''));
    m = /\/soccer\/([^/]+)\/summary$/.exec(p);
    if (m) {
      const s = m[1] === 'eng.1' ? summaryFor(u.searchParams.get('event')) : null;
      return s ? reply(200, s) : reply(404, {});
    }
    m = /\/soccer\/([^/]+)\/teams$/.exec(p);
    if (m) return reply(200, { sports: [{ leagues: [{ teams: m[1] === 'eng.1' ? teams.map((n) => ({ team: { id: idOf(n), displayName: n } })) : [] }] }] });
    return reply(404, {});
  }
  if (u.hostname === 'sports.core.api.espn.com') {
    let m = /\/leagues\/([^/]+)\/seasons\/\d+\/teams$/.exec(p);
    if (m) return reply(200, { items: m[1] === 'eng.1' ? teams.map((n) => ({ $ref: `http://x/teams/${idOf(n)}?lang=en` })) : [] });
    m = /\/leagues\/([^/]+)\/seasons\/\d+\/types\/1\/teams\/(\d+)\/statistics$/.exec(p);
    if (m && m[1] === 'eng.1') {
      const name = teams[Number(m[2]) - 100];
      return name ? reply(200, statRow(name)) : reply(404, {});
    }
    return reply(404, {});
  }
  if (u.hostname === 'raw.githubusercontent.com') {
    const m = /football\.json\/master\/([^/]+)\/en\.1\.json$/.exec(p);
    if (m && ofSeasons[m[1]]) return reply(200, ofSeasons[m[1]]);
    return reply(404, 'not found', 'text/plain');
  }
  if (u.hostname === 'www.football-data.co.uk') {
    if (p === '/robots.txt') return reply(200, 'User-agent: *\nDisallow: /cgi-bin/\n', 'text/plain');
    if (p === '/fixtures.csv') return reply(200, FD_FIX, 'text/csv');
    const m = /\/mmz4281\/(\d{4})\/E0\.csv$/.exec(p);
    if (m && fs.existsSync(path.join(FIX, `fd-E0-${m[1]}.csv`))) return reply(200, fs.readFileSync(path.join(FIX, `fd-E0-${m[1]}.csv`), 'utf8'), 'text/csv');
    return reply(404, 'not found', 'text/plain');
  }
  if (u.hostname === 'geocoding-api.open-meteo.com') {
    const name = u.searchParams.get('name');
    return reply(200, { results: [{ name, latitude: name === 'London' ? 51.5072 : 54.9061, longitude: name === 'London' ? -0.1276 : -1.3811, country: 'United Kingdom', country_code: 'GB' }] });
  }
  if (u.hostname === 'api.open-meteo.com') return reply(200, { hourly: HOURLY(u.searchParams.get('start_date')) });
  if (u.hostname === 'fantasy.premierleague.com') return reply(200, FPL);
  if (u.hostname === 'api.clubelo.com') return reply(200, eloCsv(p.slice(1, 11)), 'text/csv');
  if (u.hostname === 'api.infersports.dev') return reply(503, { error: 'offline test' });
  return reply(404, {});
};

// ------------------------------------------------------------------ run
(async () => {
  // SERVE_PORT=4000 node test/e2e_offline.js  -> serve the stubbed site for manual / screenshot checks
  if (process.env.SERVE_PORT) {
    process.env.PORT = process.env.SERVE_PORT;
    require('../server');
    console.log(`offline demo on http://127.0.0.1:${process.env.SERVE_PORT}  (fixture date ${kick.toISOString().slice(0, 10)})`);
    return;
  }
  console.log('\n1. API, end to end through the real server');
  process.env.PORT = '0';
  delete require.cache[require.resolve('../server')];
  const server = require('../server');
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (q) => {
    const res = await realFetch(base + q);
    return { status: res.status, body: res.headers.get('content-type').includes('json') ? await res.json() : await res.text() };
  };
  const day = kick.toISOString().slice(0, 10);

  try {
    const board = await get(`/api/matches?date=${day}`);
    t('board lists the two fixtures', board.status === 200 && board.body.totalMatches === 2, JSON.stringify(board.body).slice(0, 200));

    const rep = (await get(`/api/analysis?league=eng.1&event=9001&date=${day}`)).body;
    t('fixture is analysable', rep.analysable === true, rep.reason || rep.error);
    t('all 13 methodologies evaluated', rep.methodology && rep.methodology.all.length === 13, rep.methodology && rep.methodology.error);
    const comp = rep.model && rep.model.ensemble && rep.model.ensemble.components;
    t('ensemble has market, ratings, xG and Elo components', !!(comp && comp.market && comp.ratings && comp.xg && comp.elo), JSON.stringify(comp));
    t('market carries 90% of the weight', rep.model.ensemble.weights.market === 0.9);
    t('consensus pools DraftKings, Bet365, Pinnacle and the market average', rep.consensus && rep.consensus.nBooks >= 4, rep.consensus && rep.consensus.books.join(', '));
    t('Bet365 fractional prices parsed from the ESPN summary', rep.consensus.books.some((b) => /bet ?365/i.test(b)));
    const prov = rep.dataProvenance.results && rep.dataProvenance.results.home;
    t('league results loaded from several sources', prov && prov.n > 300 && prov.sources.length >= 2, JSON.stringify(prov && { n: prov.n, sources: prov.sources }));
    const multi = prov && prov.seasons.filter((x) => x.sources && x.sources.length >= 1 && x.checked);
    const twoSrc = (prov && prov.seasons || []).filter((x) => x.season >= 2025);
    t('seasons with a second source are >90% verified', twoSrc.length >= 2 && twoSrc.every((x) => x.verifiedShare > 0.9), JSON.stringify(twoSrc.map((x) => [x.season, x.verifiedShare])));
    t('a season only one source has is reported as unverified, not passed off', (prov.seasons.find((x) => x.season === 2024) || {}).verifiedShare === 0, JSON.stringify(multi && multi.map((x) => [x.season, x.primary, x.verifiedShare])));
    t('per-game history comes from the verified results (12 games a side)', rep.dataProvenance.hasHistory && rep.dataProvenance.historySource === 'verified-results' && rep.dataProvenance.historySample.home === 12, JSON.stringify(rep.dataProvenance.historySample));
    t('older seasons are translated into the fixture spelling', prov && prov.canonicalSource === 'espn');
    t('best bet label names the club, not "Home"', rep.general.bestBet && !/^Home |^Away /.test(rep.general.bestBet.label), rep.general.bestBet && rep.general.bestBet.label);
    t('FPL availability attached (Arsenal: Saliba out, Gyokeres 50%)', rep.fpl && rep.fpl.home.keyOut.some((p) => p.name === 'Saliba') && rep.fpl.home.doubtful.some((p) => p.name === 'Gyokeres'), JSON.stringify(rep.fpl && rep.fpl.home));
    t('general prediction issued', rep.general && rep.general.result && rep.general.score && rep.general.score.predicted, rep.general && rep.general.error);
    t('Arsenal favoured at home', rep.general.result.call === 'H' && rep.general.result.prob > 0.6, JSON.stringify(rep.general.result));
    const mk = Object.fromEntries(rep.markets.map((m) => [m.key, m]));
    t('markets carry calibrated, model-only and raw probabilities', mk['1'].prob != null && mk['1'].modelProb != null && mk['1'].rawProb != null);
    t('1X2 still sums to one after calibration', Math.abs(mk['1'].prob + mk.X.prob + mk['2'].prob - 1) < 1e-9);
    t('every market has a value price', rep.markets.every((m) => m.v5price && m.v5price.valuePrice >= 1.25));
    const verdicts = rep.methodology.all;
    t('verdicts carry the Rule 35 line', verdicts.filter((v) => v.prob).every((v) => typeof v.line35 === 'string' && /Fair/.test(v.line35)));
    t('correct-score methodology never takes the headline', !rep.methodology.headline || rep.methodology.headline.id !== 'correctScore');
    t('report is JSON-serialisable', (() => { try { JSON.stringify(rep); return true; } catch { return false; } })());

    // ---------------------------------------------------------------- v6 match intelligence
    const I = rep.intel || {};
    t('v6 intelligence available', I.available === true, I.reason);
    t('v6 forecast starts from the price and adds the factors', I.source === 'market+factors', I.source);
    t('v6 price comes from football-data\'s own fixture row (training definition)', /football-data/.test(I.priceSource || ''), I.priceSource);
    t('crawled archive: four seasons of E0 with shots and odds', I.data && I.data.archive && I.data.archive['eng.1'] && I.data.archive['eng.1'].matches > 1000 && I.data.archive['eng.1'].withStats > 1000, JSON.stringify(I.data && I.data.archive && I.data.archive['eng.1'] && { m: I.data.archive['eng.1'].matches, s: I.data.archive['eng.1'].withStats }));
    t('names resolved to the archive spelling (Leeds United -> Leeds)', I.names && I.names.home === 'Arsenal' && I.names.away === 'Leeds', JSON.stringify(I.names));
    t('most of the 170 factors measured', I.coverage > 0.75, I.coverage);
    t('shots-based factors present', I.factors && I.factors.h_sotShare != null && I.factors.a_xga10 != null);
    t('Elo momentum from three ClubElo snapshots', I.factors && I.factors.h_eloChg90 === 25, I.factors && I.factors.h_eloChg90);
    t('head-to-head meetings found in the archive', I.h2h && I.h2h.length >= 2, I.h2h && I.h2h.length);
    t('league table on the day', I.table && I.table.home && I.table.home.pos >= 1);
    t('trend rows for both teams (10 games)', I.trends && I.trends.home.length === 10 && I.trends.away.length === 10);
    t('factor families explained in plain English', I.families && I.families.length >= 10 && I.families.find((g) => g.id === 'form').facts.some((x) => /Arsenal/.test(x)), JSON.stringify(I.families && I.families.map((g) => g.id)));
    t('families carry measured importance', I.families.every((g) => g.importance && (g.importance.withMarket != null || g.importance.factorsOnly != null)));
    t('a main pick with a take-at price', I.decision && I.decision.main && I.decision.main.takeAt >= 1.05 && /Arsenal|Leeds|goals|score/.test(I.decision.main.label), JSON.stringify(I.decision && I.decision.main));
    t('confidence carries its measured record', I.decision.confidence && I.decision.confidence.level && I.decision.confidence.measured && I.decision.confidence.measured.n > 1000, JSON.stringify(I.decision.confidence));
    t('patterns carry measured verdicts', Array.isArray(I.patterns) && I.patterns.every((x) => ['trap', 'edge', 'weak', 'unstable', 'priced-in'].includes(x.verdict)), JSON.stringify(I.patterns && I.patterns.map((x) => x.verdict)));
    t('weather at kick-off (context only)', I.context && I.context.weather && I.context.weather.tempC === 11.5 && I.context.weather.place === 'London', JSON.stringify(I.context && I.context.weather));
    t('v6 probabilities are coherent (1X2 sums to one)', Math.abs(I.probs['1'] + I.probs.X + I.probs['2'] - 1) < 1e-3);
    t('general prediction is v6 and uses the v6 main pick', rep.general.version === '6.0' && rep.general.bestBet && rep.general.bestBet.key === I.decision.main.key, rep.general.version);

    const rep2 = (await get(`/api/analysis?league=eng.1&event=9002&date=${day}`)).body;
    t('second fixture analysable', rep2.analysable === true, rep2.reason || rep2.error);

    const preds = (await get(`/api/predictions?date=${day}`)).body;
    t('predictions endpoint returns a general prediction for every fixture', preds.general && preds.general.length === 2, preds.error);
    t('predictions list methods with counts', Array.isArray(preds.methods) && preds.methods.length === 13);
    t('predictions carry the double-confirmed accumulator', preds.accumulator && Array.isArray(preds.accumulator.legs) && Array.isArray(preds.accumulator.options) && preds.accumulator.rules.length >= 3, JSON.stringify(preds.accumulator && { legs: preds.accumulator.legs.length, err: preds.accumulator.error }));
    t('every accumulator leg passed a methodology AND the normal prediction', (preds.accumulator.legs || []).every((l) => ['LOCK', 'PREDICT'].includes(l.methodology.status) && ['main', 'call', 'safer'].includes(l.agreement)));
    const acc = (await get(`/api/accumulator?date=${day}`)).body;
    t('accumulator endpoint', acc.accumulator && Array.isArray(acc.accumulator.options), JSON.stringify(acc).slice(0, 200));
    t('predictions carry the High Banker with its measured record', preds.banker && Array.isArray(preds.banker.bankers) && preds.banker.rules.length >= 5 && preds.banker.record && preds.banker.record.heldOut && preds.banker.record.heldOut.slip.slips > 100, JSON.stringify(preds.banker && { n: preds.banker.bankers.length, err: preds.banker.error }));
    t('every banker passed every check', (preds.banker.bankers || []).every((l) => l.checks.length >= 6 && l.checks.every((c) => c.ok)));
    t('a High Banker slip always reaches its target', !preds.banker.slip || preds.banker.slip.odds >= preds.banker.target - 1e-9);
    const bkr = (await get(`/api/banker?date=${day}`)).body;
    t('banker endpoint', bkr.banker && Array.isArray(bkr.banker.bankers) && bkr.banker.target === 3, JSON.stringify(bkr).slice(0, 200));
    const crawl = (await get('/api/crawler')).body;
    t('crawler reports football-data requests and honours robots.txt', crawl.hosts && crawl.hosts['www.football-data.co.uk'] && crawl.hosts['www.football-data.co.uk'].ok >= 2 && crawl.hosts['www.football-data.co.uk'].robotsBlocked === 0, JSON.stringify(crawl.hosts && crawl.hosts['www.football-data.co.uk']));
    const ir = (await get('/api/intel-research')).body;
    t('research record served (decision, accumulator, importance, patterns)', ir.record && ir.accumulator && ir.importance && ir.patterns && Object.keys(ir.patterns.rules).length >= 40);

    // ---------------------------------------------------------------- Strongest Picks
    const sp = (await get(`/api/strongest?date=${day}`)).body;
    const GROUPS9 = 'Goals,Corners,Half,Players,Minutes,Team,Match,Bookings,Special';
    t('strongest: both fixtures priced', sp.counts && sp.counts.priced === 2, JSON.stringify(sp.counts || sp.error));
    t('strongest: every match card has the nine SportyBet groups in order', (sp.matches || []).length === 2 && sp.matches.every((m) => m.cards.map((c) => c.group).join(',') === GROUPS9));
    t('strongest: four goal views (market, stats, v6 factors, possession model)', sp.matches.every((m) => m.data.views.join(',') === 'market,stats,factors,pace'), JSON.stringify(sp.matches.map((m) => m.data.views)));
    t('strongest: the possession model reads shots and finishing from the archive', sp.matches.every((m) => m.expectedGoals.pace && m.expectedGoals.pace.total > 0.8 && m.expectedGoals.pace.total < 5), JSON.stringify(sp.matches.map((m) => m.expectedGoals.pace)));
    t('strongest: corners and bookings priced from the crawled archive', sp.matches.every((m) => m.data.corners && m.data.bookings));
    t('strongest: first-half share measured from the archive half-times', sp.matches.every((m) => m.data.firstHalfShare > 0.38 && m.data.firstHalfShare < 0.5), JSON.stringify(sp.matches.map((m) => m.data.firstHalfShare)));
    const spBar = (p) => (p.kind === 'corners' || p.kind === 'cards' ? sp.config.floorStatsOnly : sp.config.floor);
    const spPay = (p) => (p.kind === 'corners' || p.kind === 'cards' || p.views.market == null ? p.prob : p.views.market);
    const spNeed = (p) => (p.kind === 'corners' || p.kind === 'cards' ? sp.config.minChanceStatsOnly : sp.config.minChance);
    t('strongest: every pick is measured, clears its chance bar and every view, and still pays', (sp.picks || []).every((p) => p.pick.measured && p.pick.prob >= spNeed(p.pick) - 1e-9 && Object.values(p.pick.views).every((v) => v >= spBar(p.pick) - 1e-9) && spPay(p.pick) <= sp.config.maxProb + 1e-9), JSON.stringify((sp.picks || []).map((p) => [p.pick.prob, p.pick.views])));
    t('strongest: at most one pick per match, no fixed count', new Set(sp.picks.map((p) => p.match.id)).size === sp.picks.length && sp.picks.length <= 2);
    t('strongest: picks carry reasons, checks and a take-at price', sp.picks.every((p) => p.pick.reasons.length >= 2 && /%/.test(p.pick.checks) && p.pick.takeAt >= 1.05));
    t('strongest: reasons quote real numbers, never undefined / NaN', sp.matches.every((m) => m.cards.every((c) => c.none || (c.reasons || []).every((r) => !/undefined|NaN/.test(r)))));
    t('strongest: picks recorded before kick-off', sp.record && sp.record.picks.pending >= sp.picks.length, JSON.stringify(sp.record && sp.record.picks));
    t('strongest: rules and thresholds published', Array.isArray(sp.rules) && sp.rules.length >= 4 && sp.config.floor === 0.75);
    const spRec = (await get('/api/strongest/record')).body;
    t('strongest: track record endpoint', spRec.picks && spRec.byTier && Array.isArray(spRec.recent));
    const spCsv = await get('/api/strongest/record?format=csv');
    t('strongest: track record CSV', typeof spCsv.body === 'string' && spCsv.body.startsWith('date,kind,league'));

    const meth = (await get('/api/methodology')).body;
    t('methodology endpoint is v5 with backtest numbers', meth.version === '5.0' && meth.backtest && meth.backtest.headline && meth.backtest.headline.v5.n > 1000);

    const led = (await get('/api/ledger')).body;
    t('ledger recorded the pre-match predictions', led.entries >= 2, JSON.stringify(led).slice(0, 200));
    t('ledger reports discipline rules 17 / 27 / 34', led.discipline && led.discipline.rule17 && led.discipline.rule27 && led.discipline.rule34);
    const csv = await get('/api/ledger?format=csv');
    t('ledger exports CSV', typeof csv.body === 'string' && csv.body.startsWith('date,'));

    // ---------------------------------------------------------------- UI
    console.log('\n2. UI renders every tab (jsdom)');
    let JSDOM = null;
    try {
      ({ JSDOM } = require(process.env.JSDOM_PATH || 'jsdom'));
    } catch {
      console.log('  SKIP  jsdom not installed (set JSDOM_PATH to run the UI pass)');
    }
    if (JSDOM) {
      const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8').replace('<script src="/app.js"></script>', '').replace('<script src="/strongest.js"></script>', '')
        .replace('<script src="/shared.js"></script>', '').replace('<script src="/daycache.js"></script>', '').replace('<script src="/banker.js"></script>', '');
      const errors = [];
      const dom = new JSDOM(html, { url: base + '/', runScripts: 'dangerously', pretendToBeVisual: true });
      const w = dom.window;
      w.fetch = (q) => realFetch(base + q);
      w.console.error = (...a) => errors.push(a.join(' '));
      w.addEventListener('error', (e) => errors.push(String(e.message)));
      const sc = w.document.createElement('script');
      // the day database scripts first (jsdom has no IndexedDB: daycache.js falls back to memory)
      for (const f of ['shared.js', 'daycache.js']) {
        const s0 = dom.window.document.createElement('script');
        s0.textContent = fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
        dom.window.document.body.appendChild(s0);
      }
      sc.textContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
      w.document.body.appendChild(sc);
      const sc2 = w.document.createElement('script');
      sc2.textContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'strongest.js'), 'utf8');
      w.document.body.appendChild(sc2);
      const sc3 = w.document.createElement('script');
      sc3.textContent = fs.readFileSync(path.join(__dirname, '..', 'public', 'banker.js'), 'utf8');
      w.document.body.appendChild(sc3);
      w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
      const settle = (ms) => new Promise((r) => setTimeout(r, ms));
      w.eval(`setDate(${JSON.stringify(day)})`);
      await settle(1500);
      const board = w.document.querySelector('#board').textContent;
      t('Matches tab lists the fixtures', /Arsenal/.test(board) && /Sunderland/.test(board), board.slice(0, 200));
      t('Matches tab shows predicted score chips', w.document.querySelectorAll('.sc-chip').length === 2);
      for (const view of ['banker', 'strongest', 'predictions', 'top', 'general', 'acca', 'record', 'method']) {
        w.eval(`setView(${JSON.stringify(view)})`);
        await settle(1200);
        const txt = w.document.querySelector('#board').textContent;
        t(`${view} tab renders`, txt.length > 40 && !/Analysis failed|Could not load/.test(txt), txt.slice(0, 160));
        if (view === 'strongest') {
          t('Strongest Picks tab shows the picks and the nine-market cards', /The picks every view agrees on/.test(txt) && w.document.querySelectorAll('.sp-mc').length === 2 && w.document.querySelectorAll('.sp-row').length === 18, txt.slice(0, 200));
          w.document.querySelector('[data-group="Corners"]').click();
          await settle(50);
          t('Strongest Picks market filter shows one row per match', w.document.querySelectorAll('.sp-row').length === 2);
        }
      }
      w.eval("openMatch('9001','eng.1','2026')");
      await settle(1500);
      const det = w.document.querySelector('#detailInner').textContent;
      t('detail panel shows the predicted final score', /Predicted final score/.test(det));
      t('detail panel shows the match intelligence', /Match intelligence/.test(det) && /Form & trend/.test(det) && /Head-to-head/.test(det), det.slice(0, 200));
      t('detail panel shows patterns and traps', /Patterns & traps/.test(det));
      t('detail panel shows how the probabilities were built', /How the probabilities were built/.test(det));
      t('detail panel shows FPL availability', /Saliba/.test(det));
      t('detail panel shows all 13 methodologies', /All 13 methodologies/.test(det));
      t('no script errors in the page', errors.length === 0, errors.join(' | ').slice(0, 300));
      w.close();
    }
  } catch (err) {
    t('end-to-end run completed', false, err.stack);
  } finally {
    server.close();
    console.log(`\n  external hosts touched (all stubbed): ${Object.entries(hits).map(([h, n]) => `${h} ${n}`).join(', ')}`);
    console.log('\n=========================================================');
    console.log(` ${pass} passed, ${fail} failed`);
    console.log('=========================================================');
    process.exit(fail ? 1 : 0);
  }
})();
