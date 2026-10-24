'use strict';

/**
 * test/v6_unit.js — offline unit tests for every v6 module.
 *   node test/v6_unit.js
 *
 * crawler (robots.txt, rate limits, conditional GET, stale-on-failure, circuit breaker),
 * records, history store, factor engine, tree evaluator, v6 probabilities, decision,
 * patterns, explanations, accumulator, weather, Elo momentum, ledger accumulators.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SHARPSHOOTER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-v6-'));

const HTTP = require('../lib/crawler/http');
const RC = require('../lib/factors/records');
const { History, countryOf } = require('../lib/factors/history');
const F = require('../lib/factors/features');
const G = require('../lib/factors/gbm');
const P = require('../lib/intel/predict');
const D = require('../lib/intel/decision');
const RULES = require('../lib/intel/rules');
const X = require('../lib/intel/explain');
const ACC = require('../lib/intel/accumulator');
const WX = require('../lib/crawler/sources/weather');
const ELOT = require('../lib/crawler/sources/clubelo');
const FDS = require('../lib/crawler/sources/footballdata');
const INTEL = require('../lib/intel');
const { settle } = require('../lib/settle');

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
const near = (a, b, tol) => Math.abs(a - b) <= tol;

(async () => {
  // ================================================================ crawler
  console.log('\n1. crawler/http.js');
  {
    const rules = HTTP.parseRobots('User-agent: *\nDisallow: /private/\nAllow: /private/ok.csv\nDisallow: /*.php$\n\nUser-agent: otherbot\nDisallow: /');
    t('robots: disallowed path refused', HTTP.robotsAllows(rules, '/private/x.csv') === false);
    t('robots: longer Allow wins over Disallow', HTTP.robotsAllows(rules, '/private/ok.csv') === true);
    t('robots: wildcard + end anchor', HTTP.robotsAllows(rules, '/a/b.php') === false && HTTP.robotsAllows(rules, '/a/b.php?x=1') === true);
    t('robots: other agents\' rules do not apply to us', HTTP.robotsAllows(rules, '/mmz4281/2526/E0.csv') === true);
    t('robots: empty Disallow allows everything', HTTP.robotsAllows(HTTP.parseRobots('User-agent: *\nDisallow:'), '/anything') === true);
    t('Retry-After seconds and HTTP date', HTTP.retryAfterMs('3') === 3000 && HTTP.retryAfterMs(new Date(Date.now() + 5000).toUTCString()) > 3000);

    // a stubbed network
    let calls = [];
    let mode = 'ok';
    HTTP._reset();
    HTTP.setFetch(async (url, init) => {
      const u = new URL(url);
      calls.push({ url, at: Date.now(), headers: init && init.headers });
      if (u.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /blocked/', { status: 200 });
      if (u.pathname.startsWith('/blocked/')) return new Response('secret', { status: 200 });
      if (mode === 'down') return new Response('err', { status: 500 });
      if (mode === '304' && init.headers['if-none-match'] === 'v1') return new Response(null, { status: 304 });
      if (u.pathname === '/missing.csv') return new Response('nope', { status: 404 });
      return new Response('Div,Date\nE0,01/01/2026', { status: 200, headers: { etag: 'v1' } });
    });
    const base = 'https://www.football-data.co.uk';
    const r1 = await HTTP.get(`${base}/a.csv`, { ttl: 60000 });
    t('first fetch downloads', r1.ok && !r1.fromCache && /E0/.test(r1.body));
    const r2 = await HTTP.get(`${base}/a.csv`, { ttl: 60000 });
    t('second fetch is served from the cache', r2.ok && r2.fromCache);
    mode = '304';
    const r3 = await HTTP.get(`${base}/a.csv`, { ttl: 0 });
    t('expired entry revalidated with If-None-Match -> 304, body kept', r3.ok && r3.notModified && /E0/.test(r3.body));
    mode = 'down';
    const r4 = await HTTP.get(`${base}/a.csv`, { ttl: 0 });
    t('source down: last good copy served, marked stale', r4.ok && r4.stale && /E0/.test(r4.body));
    const r5 = await HTTP.get(`${base}/never.csv`, { ttl: 0 });
    t('source down and no copy: failure reported, nothing cached', !r5.ok && !fs.existsSync(HTTP.cachePath(`${base}/never.csv`)));
    mode = 'ok';
    const r6 = await HTTP.get(`${base}/blocked/x.csv`);
    t('robots.txt disallow is honoured (no request made)', !r6.ok && /robots/.test(r6.error) && !calls.some((c) => c.url.includes('/blocked/x.csv')));
    const r7 = await HTTP.get(`${base}/missing.csv`);
    t('404 is not retried', !r7.ok && calls.filter((c) => c.url.endsWith('/missing.csv')).length === 1);
    // rate limit: two fresh requests to one host are spaced by its minInterval
    calls = [];
    await Promise.all([HTTP.get(`${base}/r1.csv`, { ttl: 0 }), HTTP.get(`${base}/r2.csv`, { ttl: 0 })]);
    const times = calls.filter((c) => /r[12]\.csv/.test(c.url)).map((c) => c.at).sort();
    t('per-host rate limit spaces requests (>= 1s on football-data)', times.length === 2 && times[1] - times[0] >= 950, JSON.stringify(times));
    const st = HTTP.stats()['www.football-data.co.uk'];
    t('stats count requests, cache hits, 304s, stale serves, robots blocks', st.ok >= 1 && st.cacheHits >= 1 && st.notModified >= 1 && st.staleServed >= 1 && st.robotsBlocked >= 1, JSON.stringify(st));
    // circuit breaker on a host that keeps failing
    HTTP._reset();
    HTTP.setFetch(async () => new Response('x', { status: 500 }));
    for (let i = 0; i < 5; i++) await HTTP.get(`https://api.clubelo.com/2026-01-0${i + 1}`, { ttl: 0 });
    const br = await HTTP.get('https://api.clubelo.com/2026-01-09', { ttl: 0 });
    t('circuit breaker pauses a host after repeated failures', !br.ok && /circuit breaker/.test(br.error) && HTTP.stats()['api.clubelo.com'].paused === true);
    HTTP.setFetch(null);
    HTTP._reset();
  }

  // ================================================================ records & history
  console.log('\n2. factors/records.js + history.js');
  {
    const row = {
      Div: 'E0', Date: '15/08/2025', Time: '20:00', HomeTeam: 'Liverpool', AwayTeam: 'Bournemouth', FTHG: '4', FTAG: '2', HTHG: '1', HTAG: '0',
      HS: '19', AS: '10', HST: '10', AST: '3', HC: '6', AC: '7', HF: '7', AF: '10', HY: '1', AY: '2', HR: '0', AR: '0',
      B365H: '1.3', B365D: '6.0', B365A: '8.5', MaxH: '1.34', MaxD: '6.5', MaxA: '9.5', 'B365>2.5': '1.36', 'B365<2.5': '3.2', 'Max>2.5': '1.38', 'Max<2.5': '3.3',
      B365CH: '1.28', B365CD: '6.25', B365CA: '9.0',
    };
    const mr = RC.fromFootballDataRow(row, 'E0');
    t('football-data row: scores, half-time, shots, cards', mr.hg === 4 && mr.hthg === 1 && mr.hst === 10 && mr.ac === 7 && mr.ay === 2 && mr.season === 2025);
    t('football-data row: Bet365 pre-closing first, best price, closing kept', mr.odds.h === 1.3 && mr.odds.maxH === 1.34 && mr.odds.o25 === 1.36 && mr.odds.close.h === 1.28);
    const nw = RC.fromFootballDataRow({ Country: 'Norway', Date: '12/04/2026', Home: 'Bodo/Glimt', Away: 'Molde', HG: '3', AG: '1', PSCH: '1.6', PSCD: '4.2', PSCA: '5.0', MaxCH: '1.7', MaxCD: '4.5', MaxCA: '5.5' }, 'NOR');
    t('"new" layout (Home/Away/HG/AG, closing prices) parsed', nw.hg === 3 && nw.home === 'Bodo/Glimt' && nw.odds.h === 1.6 && nw.odds.maxH === 1.7 && nw.season === 2026);
    t('calendar-year leagues get a calendar season', RC.seasonOf('2026-03-01', 'NOR') === 2026 && RC.seasonOf('2026-03-01', 'E0') === 2025);
    const mk = RC.marketOf(mr);
    t('market view: de-vigged 1X2 sums to one, implied goals solved', near(mk.p1 + mk.pX + mk.p2, 1, 1e-9) && mk.lamH > mk.lamA && mk.pO25 > 0.6);
    t('market view: book dispersion and closing move', near(mk.disp1, 1.34 / 1.3 - 1, 1e-9) && mk.move1 > 0);
    const te = RC.teamEntry(mr, 'Bournemouth');
    t('team entry is oriented to the team', te.venue === 'A' && te.gf === 2 && te.ga === 4 && te.sotf === 3 && te.points === 0 && near(te.pW, mk.p2, 1e-12));
    t('country keys keep namesakes apart', countryOf('E0') === 'ENG' && countryOf('eng.2') === 'ENG' && countryOf('SP1') === 'ESP' && countryOf('NOR') === 'NOR');

    // a small league: A beats everyone; per round B 4 pts, D 2, C 1
    const H = new History();
    const games = [];
    const teams = ['A', 'B', 'C', 'D'];
    let day = 1;
    for (let r = 0; r < 3; r++) {
      for (const [h, a, hg, ag] of [['A', 'B', 2, 0], ['C', 'D', 1, 1], ['B', 'C', 1, 0], ['D', 'A', 0, 3], ['A', 'C', 2, 1], ['B', 'D', 2, 2]]) {
        const date = `2025-${String(8 + Math.floor(day / 28)).padStart(2, '0')}-${String((day % 28) + 1).padStart(2, '0')}`;
        games.push({ league: 'E0', season: 2025, date, home: h, away: a, hg, ag, hthg: 0, htag: 0, hs: 10, as: 8, hst: 4, ast: 3, odds: { h: 2, d: 3.4, a: 3.6 } });
        day += 2;
      }
    }
    H.addAll(games);
    const last = games[games.length - 1].date;
    const tbl = H.table('E0', 2025, '2026-01-01');
    t('table: A top on points, C bottom', tbl.order[0].team === 'A' && tbl.order[3].team === 'C' && tbl.rows.get('A').pts === 27 && tbl.rows.get('D').pts === 6, JSON.stringify(tbl.order.map((r) => [r.team, r.pts])));
    t('table: four teams, season length from double round-robin', tbl.n === 4 && tbl.totalGames === 6);
    const logA = H.teamLog('E0', 'A', '2026-01-01', 40);
    t('team log newest first, before the date only', logA.length === 9 && logA[0].date >= logA[1].date && H.teamLog('E0', 'A', games[0].date, 40).length === 0);
    t('head-to-head within the window', H.h2h('E0', 'A', 'B', '2026-01-01', 6, 10).length === 3 && H.h2h('E0', 'A', 'B', '2026-01-01', 6, 2).length === 2);
    t('league environment needs a real sample (>= 30 games)', H.env('E0', '2026-01-01') === null);
    t('teams in season', [...H.teamsInSeason('E0', 2025)].sort().join() === teams.join());

    // ================================================================ factor engine
    console.log('\n3. factors/features.js');
    const fx = { league: 'E0', season: 2025, date: '2026-01-01', home: 'A', away: 'D', eloH: 1800, eloA: 1600, odds: { h: 1.5, d: 4.2, a: 6.5, maxH: 1.55, maxD: 4.4, maxA: 7.0, o25: 1.8, u25: 2.0 } };
    const f = F.compute({ fixture: fx, homeLog: H.teamLog('E0', 'A', fx.date), awayLog: H.teamLog('E0', 'D', fx.date), h2h: H.h2h('E0', 'A', 'D', fx.date), table: H.table('E0', 2025, fx.date), env: null, prevTeams: null });
    const keys = F.catalog().map((c) => c.key);
    t('every catalog factor is computed (no missing keys, no extras)', keys.every((k) => k in f) && Object.keys(f).every((k) => keys.includes(k)), keys.filter((k) => !(k in f)).join(','));
    t('170 factors in the catalog', keys.length >= 165, keys.length);
    t('form: A 3 pts/game, D on a winless run', f.h_ppg5 === 3 && f.a_nwst >= 5 && f.h_wst === 9);
    t('goals: A scores 2.33/game over 10 (9 games), clean sheets', f.h_gf10 != null && near(f.h_gf10, 7 / 3, 1e-3) && f.h_csr > 0.5);
    t('shots on target share computed from the log', near(f.h_sotShare, 4 / 7, 1e-3) || near(f.h_sotShare, 0.5, 0.2));
    t('no league environment -> chance-based expected goals unknown (null, not 0)', f.h_xgf10 === null && f.h_finLuck === null);
    t('results vs the bookmakers\' expectation', f.h_pve10 > 0 && f.a_pve10 < 0);
    t('table: A top (pos 0), D third of four (pos 0.667)', f.h_pos === 0 && near(f.a_pos, 2 / 3, 1e-3));
    t('market factors from the fixture odds', near(f.p1 + f.pX + f.p2, 1, 1e-3) && f.disp2 != null && f.lamT > 2);
    t('Elo difference and expectancy', f.eloDiff === 200 && f.eloExp > 0.7);
    t('head-to-head: A won every meeting', f.h2hN === 3 && f.h2hPpg === 3 && f.h2hLast === 1);
    t('differences are home minus away', near(f.d_ppg5, f.h_ppg5 - f.a_ppg5, 1e-9));
    const empty = F.compute({ fixture: { league: 'E0', season: 2025, date: '2026-01-01', home: 'X', away: 'Y', eloH: null, eloA: null, odds: null }, homeLog: [], awayLog: [], h2h: [], table: null, env: null, prevTeams: null });
    t('no data: factors are null, never invented', empty.h_ppg5 === null && empty.p1 === null && empty.h2hPpg === null && empty.h2hN === 0);
  }

  // ================================================================ tree evaluator
  console.log('\n4. factors/gbm.js');
  {
    // numeric split with NaN going left; a zero-split at -1e-35; a categorical split
    const m = {
      objective: 'binary', numClass: 1, features: ['a', 'b', 'divc'], categorical: { divc: ['E0', 'D1', 'SP1'] },
      trees: [
        { k: 0, n: [[0, 0.5, 1 | (2 << 1), 1, 2, 0.1], [0.5], [-0.5]] },
        { k: 0, n: [[1, -1e-35, 2 << 1, 1, 2, 0], [0.2], [-0.2]] },
        { k: 0, n: [[2, [1], 8, 1, 2, 0], [0.3], [-0.3]] },
      ],
    };
    t('numeric split', G.raw(m, { a: 0.2, b: 1, divc: 'E0' })[0] === 0.5 - 0.2 - 0.3);
    t('missing value follows the default direction', G.raw(m, { a: null, b: 1, divc: 'E0' })[0] === 0.5 - 0.2 - 0.3);
    t('exact zero goes right of a -1e-35 split (LightGBM zero handling)', G.raw(m, { a: 1, b: 0, divc: 'E0' })[0] === -0.5 - 0.2 - 0.3);
    t('categorical split by category name', G.raw(m, { a: 1, b: 1, divc: 'D1' })[0] === -0.5 - 0.2 + 0.3);
    t('unseen category goes right', G.raw(m, { a: 1, b: 1, divc: 'XX' })[0] === -0.5 - 0.2 - 0.3);
    const e = G.explain(m, { a: 0.2, b: 1, divc: 'D1' });
    const sum = e.bias[0] + Object.values(e.contrib[0]).reduce((x, y) => x + y, 0);
    t('explanations sum exactly to the raw score', near(sum, G.raw(m, { a: 0.2, b: 1, divc: 'D1' })[0], 1e-12));
    t('binary prediction adds the base on the logit scale', near(G.predict(m, { a: 0.2, b: 1, divc: 'D1' }, 0.5), 1 / (1 + Math.exp(-(0.5 - 0.2 + 0.3))), 1e-12));
  }

  // ================================================================ v6 probabilities
  console.log('\n5. intel/predict.js (production models)');
  {
    t('all six production models installed', P.available().length === 6, P.available().join(','));
    const fBase = Object.fromEntries(F.catalog().map((c) => [c.key, null]));
    const mkt = { ...fBase, p1: 0.55, pX: 0.25, p2: 0.2, pO25: 0.56, lamH: 1.6, lamA: 0.95, lamT: 2.55, ovr: 0.05, divc: 'E0' };
    const pr = P.predict(mkt);
    t('with a price: source is price + factors', pr && pr.source === 'market+factors');
    t('1X2 sums to one; double chance and draw-no-bet consistent', near(pr.p['1'] + pr.p.X + pr.p['2'], 1, 1e-9) && near(pr.p['1X'], pr.p['1'] + pr.p.X, 1e-9) && near(pr.p.DNB_H, pr.p['1'] / (pr.p['1'] + pr.p['2']), 1e-9));
    t('over and under are complements on every line', ['0.5', '1.5', '2.5', '3.5'].every((l) => near(pr.p[`O${l}`] + pr.p[`U${l}`], 1, 1e-9)));
    t('BTTS comes from the dedicated model', pr.pBtts != null && near(pr.p.BTTS_Y, pr.pBtts, 1e-12) && near(pr.p.BTTS_Y + pr.p.BTTS_N, 1, 1e-12));
    t('with no factors the forecast stays close to the price', Math.abs(pr.p['1'] - 0.55) < 0.05 && Math.abs(pr.pO25 - 0.56) < 0.06, JSON.stringify([pr.p['1'], pr.pO25]));
    t('a price-only twin for comparison', pr.base && near(pr.base['1'], 0.55, 0.01));
    t('explanations for the result model per outcome', pr.explain.result && pr.explain.result.home && Object.keys(pr.explain.result.home).length > 0);
    const nm = P.predict({ ...fBase, h_elo: 1850, a_elo: 1600, eloDiff: 250, eloExp: 0.84, h_ppg10: 2.3, a_ppg10: 0.9, divc: 'E0' });
    t('no price: factors-only forecast', nm && nm.source === 'factors' && nm.base === null);
    t('no price: the stronger side is favoured', nm.p['1'] > nm.p['2'] + 0.15, JSON.stringify([nm.p['1'], nm.p.X, nm.p['2']]));
    t('no price: goals from the Poisson goal models', nm.lamH > nm.lamA && nm.lamH + nm.lamA > 1.5 && nm.lamH + nm.lamA < 4.5);
    t('AH keys follow the v4 convention (AH_H_-1 + AH_A_-1 = 1)', near(pr.p['AH_H_-1'] + pr.p['AH_A_-1'], 1, 1e-9));
  }

  // ================================================================ decision
  console.log('\n6. intel/decision.js');
  {
    const p = { '1': 0.62, X: 0.22, '2': 0.16, '1X': 0.84, X2: 0.38, DNB_H: 0.795, DNB_A: 0.205, 'O1.5': 0.78, 'O2.5': 0.55, 'U2.5': 0.45, 'U3.5': 0.74, BTTS_Y: 0.5, BTTS_N: 0.5, 'TTH_O0.5': 0.83, 'TTA_O0.5': 0.6, 'TTH_O1.5': 0.52, 'TTA_O1.5': 0.22, 'TTH_U1.5': 0.48, 'TTA_U1.5': 0.78, 'O3.5': 0.26 };
    const base = { ...p, 'O1.5': 0.80, '1': 0.6, 'U3.5': 0.75, 'TTA_U1.5': 0.80 };
    const dec = D.decide({ p, base, prices: { '1': { best: { price: 1.85, book: 'B' } } }, home: 'Arsenal', away: 'Leeds' });
    t('main pick pays at least 1.30 (fair)', dec.main && dec.main.fair >= 1.3);
    t('a selection the factors rate 2 pts below the price is never the main pick', dec.main.key !== 'O1.5' && dec.main.key !== 'TTA_U1.5', dec.main.key);
    t('main pick names the club', /Arsenal|Leeds|goals/.test(dec.main.label), dec.main.label);
    t('safer pick is implied by the main pick', !dec.safer || D.implies(dec.main.key, dec.safer.key), JSON.stringify(dec.safer));
    t('value pick needs the best price 5%+ above fair and factors on its side', dec.value && dec.value.key === '1' && dec.value.ev > 0.05, JSON.stringify(dec.value));
    t('overrated selections are listed under avoid', dec.avoid.some((a) => a.key === 'O1.5'), JSON.stringify(dec.avoid.map((a) => a.key)));
    const dx = D.decide({ p, base, exclude: new Set(['1X']), home: 'H', away: 'A' });
    t('a confirmed trap pattern keeps a selection out of every pick and on the avoid list', dx.main.key !== '1X' && (!dx.safer || dx.safer.key !== '1X') && dx.avoid.some((a) => a.key === '1X'));
    const c1 = D.confidence({ prob: 0.74 }, { hasMarket: true, coverage: 0.9, crossLeague: false }, { grades: { High: { hit: 0.74, stated: 0.744, n: 23935 } } });
    t('confidence grade with its measured record', c1.level === 'High' && c1.measured && c1.measured.n === 23935);
    const c2 = D.confidence({ prob: 0.74 }, { hasMarket: false, coverage: 0.4, crossLeague: true }, null);
    t('thin evidence lowers the grade', c2.level === 'Low' && c2.reasons.length === 3);
  }

  // ================================================================ patterns, explanations
  console.log('\n7. intel/rules.js + explain.js');
  {
    const f = Object.fromEntries(F.catalog().map((c) => [c.key, null]));
    Object.assign(f, { p1: 0.74, pX: 0.16, p2: 0.10, a_eloChg90: 55, h_sotShare: 0.64, pO25: 0.6 });
    const ev = RULES.evaluate(f);
    const ids = ev.map((x) => x.id);
    t('heavy home favourite fires on the home win', ids.includes('heavy_fav_home') && ev.find((x) => x.id === 'heavy_fav_home').key === '1');
    t('underdog with rising Elo fires on the away win, as a confirmed trap', ev.find((x) => x.id === 'dog_elo_rising') && ev.find((x) => x.id === 'dog_elo_rising').key === '2' && ev.find((x) => x.id === 'dog_elo_rising').verdict === 'trap');
    t('every verdict comes from the measured study', ev.every((x) => x.verdict !== 'untested' && x.evidence && x.evidence.n > 30));
    t('46 rules tested, verdicts shipped for each', RULES.RULES.length === 46 && Object.keys(RULES.verdicts().rules).length === 46);
    const fam = X.families({
      f: { ...f, h_ppg5: 2.2, a_ppg5: 0.8, h_ppgV5: 2.4, a_ppgV5: 0.6, h_gf10: 2.1, h_ga10: 0.8, h_o25r: 0.7, h_bttsr: 0.5, lgGoals: 2.8, lgHome: 0.45, lgDraw: 0.25, lgO25: 0.52 },
      names: { home: 'Arsenal', away: 'Leeds' }, logs: { home: [], away: [] }, h2h: [], table: null, fd: { home: 'Arsenal', away: 'Leeds' }, pull: { h_ppg5: 0.01, p1: 0.02 },
    });
    t('families explained with club names', fam.find((g) => g.id === 'form').facts.some((s) => /Arsenal: 2\.2 pts\/game/.test(s)));
    t('family pull sums its features (pts)', fam.find((g) => g.id === 'form').pull === 1 && fam.find((g) => g.id === 'market').pull === 2);
    t('measured importance attached to families', fam.find((g) => g.id === 'strength').importance.factorsOnly > 0.2);
    t('probability points from raw pulls', near(X.toPoints({ a: 1 }, 0.5).a, 0.25, 1e-12));
  }

  // ================================================================ accumulator
  console.log('\n8. intel/accumulator.js');
  {
    const calls = ACC.callsOf({ '1': 0.5, X: 0.27, '2': 0.23, 'O2.5': 0.58, BTTS_Y: 0.44 });
    t('normal prediction calls: result, goals, BTTS', calls.result === '1' && calls.goals === 'O2.5' && calls.btts === 'BTTS_N');
    t('consistency with the calls', ACC.consistent('O2.5', calls) && !ACC.consistent('U2.5', calls) && ACC.consistent('1X', calls) && !ACC.consistent('X2', calls) && ACC.consistent('BTTS_N', calls));
    const normal = { main: 'O2.5', safer: 'O1.5', avoid: new Set(['BTTS_Y']), p: { '1': 0.5, X: 0.27, '2': 0.23, 'O2.5': 0.62, 'O1.5': 0.8, '1X': 0.77, BTTS_Y: 0.6, X2: 0.5 }, base: { 'O2.5': 0.6, 'O1.5': 0.81, '1X': 0.80, BTTS_Y: 0.65, X2: 0.5 } };
    t('agreement: the normal main pick', ACC.agreementOf('O2.5', normal) === 'main');
    t('agreement: the normal safer pick', ACC.agreementOf('O1.5', normal) === 'safer');
    t('no agreement when the factors rate it 3 pts below the price', ACC.agreementOf('1X', normal) === null);
    t('no agreement for an "avoid" selection', ACC.agreementOf('BTTS_Y', normal) === null);
    t('no agreement against the result call', ACC.agreementOf('X2', normal) === null);
    t('safer forms of a main pick (Home win -> 1X, home +1)', ACC.saferForm('1', '1X') && ACC.saferForm('1', 'AH_H_1') && !ACC.saferForm('1X', '1'));
    const future = new Date(Date.now() + 6 * 3600 * 1000).toISOString();
    const rep = (id, mainKey, methKey, status, prob, extra = {}) => ({
      analysable: true,
      match: { id, league: 'eng.1', date: future, state: 'pre', home: { name: `H${id}` }, away: { name: `A${id}` } },
      methodology: { predictions: [{ id: extra.mid || 'over25', name: 'Over 2.5', status, pick: { key: methKey, label: methKey }, prob }] },
      intel: { available: true, probs: { '1': 0.5, X: 0.27, '2': 0.23, 'O2.5': prob, 'O1.5': 0.85, BTTS_Y: 0.55, '1X': 0.77 }, base: { 'O2.5': prob - 0.01 }, decision: { main: { key: mainKey, label: mainKey, prob }, safer: null, avoid: [], confidence: { level: 'High' } } },
      markets: [{ key: methKey, v5price: { best: { price: 1 / prob + 0.1, book: 'X' } } }],
    });
    const reps = [rep('1', 'O2.5', 'O2.5', 'LOCK', 0.74), rep('2', 'O2.5', 'O2.5', 'PREDICT', 0.7), rep('3', 'O2.5', 'O2.5', 'WATCH', 0.8), rep('4', 'O2.5', 'O2.5', 'PREDICT', 0.68, { mid: 'draw' }), rep('5', '1X', 'O2.5', 'PREDICT', 0.66)];
    reps.push({ ...rep('6', 'O2.5', 'O2.5', 'PREDICT', 0.9), match: { ...rep('6', 'O2.5', 'O2.5', 'PREDICT', 0.9).match, state: 'in' } });
    const legs = ACC.legsFrom(reps);
    t('legs need LOCK/PREDICT, no draws, not started', legs.map((l) => l.fixtureId).sort().join() === '1,2,5', legs.map((l) => l.fixtureId).join());
    t('legs record how the normal prediction agreed', legs.find((l) => l.fixtureId === '1').agreement === 'main' && legs.find((l) => l.fixtureId === '5').agreement === 'call');
    const acc = ACC.build(legs);
    const dbl = acc.options.find((o) => o.size === 2);
    t('best double = the two most likely legs; probability multiplies', dbl && dbl.legs.map((l) => l.fixtureId).join() === '1,2' && near(dbl.prob, 0.74 * 0.7, 1e-9));
    t('treble built when three legs exist; no four-fold from three legs', acc.options.some((o) => o.size === 3) && !acc.options.some((o) => o.size === 4));
    t('combined best price and take-at', dbl.bestOdds > dbl.fairOdds && near(dbl.takeAt, (1.02 / 0.74) * (1.02 / 0.7), 1e-9));
    t('one option is recommended (the biggest at 40%+)', acc.options.filter((o) => o.recommended).length === 1 && acc.options.find((o) => o.recommended).prob >= 0.4);
    t('measured record attached per size', dbl.measured && dbl.measured.n > 100);
  }

  // ================================================================ sources
  console.log('\n9. crawler sources');
  {
    const day = '2026-10-24';
    const hourly = { time: ['2026-10-24T18:00', '2026-10-24T19:00', '2026-10-24T20:00'], temperature_2m: [12, 11, 10], precipitation: [0, 5.2, 0], precipitation_probability: [10, 90, 20], wind_speed_10m: [10, 45, 12], wind_gusts_10m: [20, 70, 25], weather_code: [2, 65, 3] };
    const w = WX.atHour(hourly, '2026-10-24T19:05:00Z');
    t('weather: the kick-off hour is picked', w.tempC === 11 && w.description === 'Heavy rain');
    t('weather: extreme conditions flagged', w.flags.includes('heavy rain') && w.flags.includes('strong wind') && w.flags.includes('gale-force gusts'));
    t('weather: no hour within 3h -> nothing', WX.atHour(hourly, '2026-10-25T12:00:00Z') === null);
    t('Elo snapshots 30 and 90 days back', ELOT.shift(day, 30) === '2026-09-24' && ELOT.shift(day, 90) === '2026-07-26');
    t('every football-data league maps to a research division', Object.values(FDS.LEAGUES).every((l) => /^[A-Z0-9]{2,4}$/.test(l.div)) && FDS.LEAGUES['jpn.1'].div === 'JAP' && FDS.LEAGUES['sui.1'].fd === 'SWZ');
    t('football-data CSV -> records', FDS.toRecords('Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,HST,AST\nE0,01/09/2026,A,B,2,1,5,3', 'E0')[0].hst === 5);
    const q = INTEL.oddsFromQuotes([{ book: 'DraftKings', h: 1.8, d: 3.6, a: 4.5 }, { book: 'Bet365', h: 1.85, d: 3.5, a: 4.4, line: 2.5, over: 1.9, under: 1.9 }, { book: 'Best price', aggregate: 'max', h: 1.95, d: 3.8, a: 4.9 }], null);
    t('live price: Bet365 first (the training book), best-of-market for dispersion', q.odds.h === 1.85 && q.odds.o25 === 1.9 && q.odds.maxH === 1.95 && !q.synthetic);
    const q2 = INTEL.oddsFromQuotes([], { x12: { fair: { home: 0.5, draw: 0.3, away: 0.2 } }, totals: {}, nBooks: 3 });
    t('consensus-only price is marked synthetic (margin and dispersion unknown)', q2.synthetic && near(1 / q2.odds.h, 0.5, 1e-12));
  }

  // ================================================================ settle keys used by v6
  console.log('\n10. settlement of v6 keys');
  t('AH keys settle with the v4 convention', settle('AH_H_-1', 2, 0) === 1 && settle('AH_H_-1', 1, 0) === null && settle('AH_A_-1', 1, 1) === 1);
  t('team totals and BTTS', settle('TTA_U1.5', 0, 1) === 1 && settle('BTTS_N', 1, 0) === 1);

  console.log(`\n ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
