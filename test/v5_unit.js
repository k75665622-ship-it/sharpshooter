'use strict';

/**
 * test/v5_unit.js — offline unit tests for every v5 module.
 *   node test/v5_unit.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SHARPSHOOTER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-v5-'));

const M = require('../lib/model');
const MK = require('../lib/market');
const R = require('../lib/ratings');
const N = require('../lib/sources/names');
const RS = require('../lib/sources/results');
const ODDS = require('../lib/sources/odds');
const FPL = require('../lib/sources/fpl');
const PR = require('../lib/pricing');
const ENS = require('../lib/ensemble');
const SL = require('../lib/scoreline');
const GEN = require('../lib/general');
const MI = require('../lib/methodology');
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

// ================================================================== 1. market solver
console.log('\n1. market solver');
{
  const q = MK.implied(1.8, 1.1, 2.5);
  const s = MK.solveLambdas({ home: q.h, draw: q.d, away: q.a }, { line: 2.5, over: q.over });
  t('recovers λ from 1X2 + total exactly', near(s.lamH, 1.8, 1e-4) && near(s.lamA, 1.1, 1e-4), JSON.stringify(s));
  const s2 = MK.solveLambdas({ home: q.h, draw: q.d, away: q.a }, null, { priorTotal: 2.9 });
  t('recovers λ from 1X2 alone (total via the draw share)', near(s2.lamH, 1.8, 0.05) && near(s2.lamA, 1.1, 0.05), JSON.stringify(s2));
  t('refuses nonsense input', MK.solveLambdas({ home: 0, draw: 0.3, away: 0.7 }, null) === null);
  const p = MK.pool([{ book: 'A', prices: [2.0, 3.4, 4.0] }, { book: 'Pinnacle', prices: [2.1, 3.5, 3.9], weight: 2 }]);
  t('pool: each book de-vigged then averaged', p && near(p.probs.reduce((a, b) => a + b, 0), 1, 1e-9) && p.books === 2);
  t('pool: reports the widest disagreement', p.spread > 0 && p.spread < 0.05, p.spread);
}

// ================================================================== 2. ratings
console.log('\n2. ratings (time-decayed Dixon-Coles)');
{
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pois = (l) => { let L = Math.exp(-l), k = 0, p = 1; do { k++; p *= rnd(); } while (p > L); return k - 1; };
  const teams = Array.from({ length: 12 }, (_, i) => ({ n: `T${i}`, a: (i - 6) / 12, d: -(i - 6) / 14 }));
  const ms = [];
  let day = Date.parse('2025-08-01');
  for (let r = 0; r < 44; r++) {
    const sh = [...teams].sort(() => rnd() - 0.5);
    for (let k = 0; k < 6; k++) {
      const h = sh[2 * k];
      const a = sh[2 * k + 1];
      ms.push({ date: new Date(day).toISOString().slice(0, 10), home: h.n, away: a.n, hg: pois(Math.exp(0.2 + 0.3 + h.a + a.d)), ag: pois(Math.exp(0.2 + a.a + h.d)) });
    }
    day += 5 * 86400000;
  }
  const f = R.fit(ms, { xi: 0.001 });
  const order = teams.map((x) => f.teams[x.n].att);
  const truth = teams.map((x) => x.a);
  const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
  const mx = mean(order);
  const my = mean(truth);
  const corr = order.reduce((a, x, i) => a + (x - mx) * (truth[i] - my), 0)
    / Math.sqrt(order.reduce((a, x) => a + (x - mx) ** 2, 0) * truth.reduce((a, y) => a + (y - my) ** 2, 0));
  t('attack ratings track the true strengths (correlation ≥ 0.8 on 264 noisy games)', corr >= 0.8, corr.toFixed(3));
  t('home advantage is recovered', near(f.home, 0.3, 0.12), f.home);
  const p = R.predict(f, 'T11', 'T0');
  t('strong home side vs weak away side: λ_home > λ_away', p.lamH > p.lamA * 1.5, JSON.stringify(p));
  const u = R.predict(f, 'Nobody FC', 'T0');
  t('unknown club falls back to the newcomer prior and says so', u && u.known.home === false);
  t('deterministic', JSON.stringify(R.fit(ms, { xi: 0.001 })) === JSON.stringify(f));
  t('no future leakage: asOf excludes later games', R.fit(ms, { asOf: '2025-09-01' }).n < f.n);
  const nc = R.newcomersAt([...ms, { date: '2026-08-20', home: 'Promoted', away: 'T1', hg: 0, ag: 1 }], '2026-09-01', '2026-07-01');
  t('promoted clubs are detected as newcomers', nc.has('Promoted') && !nc.has('T1'));
}

// ================================================================== 3. names
console.log('\n3. team names across sources');
{
  t('fold: club tags and accents removed', N.fold('1. FC Köln') === N.fold('FC Koln') && N.fold('Brighton & Hove Albion FC') === N.fold('Brighton and Hove Albion'));
  t('matchName refuses Manchester ambiguity', N.matchName('Manchester', ['Manchester City', 'Manchester United']) === null);
  t('matchName: alias + containment', N.matchName('Man Utd', ['Manchester United', 'Manchester City']) === 'Manchester United' && N.matchName('Leeds United', ['Leeds', 'Leicester']) === 'Leeds');
  const A = [];
  const B = [];
  const ta = ['Arsenal', 'Nottingham Forest', 'Brighton & Hove Albion', 'Wolverhampton Wanderers'];
  const tb = ['Arsenal FC', "Nott'm Forest", 'Brighton', 'Wolves'];
  let d = Date.parse('2025-08-10');
  for (let r = 0; r < 12; r++) {
    for (const [i, j] of [[0, 1], [2, 3]]) {
      const [h, a] = r % 2 ? [j, i] : [i, j];
      const hg = (r * 7 + i) % 4;
      const ag = (r * 3 + j) % 3;
      const date = new Date(d).toISOString().slice(0, 10);
      A.push({ date, home: ta[h], away: ta[a], hg, ag });
      B.push({ date, home: tb[h], away: tb[a], hg, ag });
    }
    d += 7 * 86400000;
  }
  const map = N.learnMapping(A, B);
  t('learnMapping pairs every club from shared results, no alias table', ta.every((n, i) => map.get(n) === tb[i]), JSON.stringify([...map]));
}

// ================================================================== 4. results verification
console.log('\n4. results: parsing and cross-verification');
{
  const fj = RS.parseFootballJson(JSON.stringify({ matches: [
    { date: '2025-08-15', team1: 'A FC', team2: 'B FC', score: { ft: [2, 1] } },
    { date: '2025-08-16', team1: 'C FC', team2: 'D FC', score: { ft: [1, 1], et: [2, 1] } },
    { date: '2025-08-17', team1: 'E FC', team2: 'F FC' },
  ] }));
  t('football.json: scored games kept; extra-time and unplayed dropped', fj.length === 1 && fj[0].hg === 2);
  const ev = RS.parseEspnEvents([
    { id: '1', date: '2025-09-01T15:00Z', competitions: [{ status: { type: { completed: true, state: 'post', description: 'Full Time' } }, competitors: [{ homeAway: 'home', team: { id: '1', displayName: 'A' }, score: '2' }, { homeAway: 'away', team: { id: '2', displayName: 'B' }, score: { value: 0, displayValue: '0' } }] }] },
    { id: '2', date: '2025-09-02T15:00Z', competitions: [{ status: { type: { completed: false, state: 'pre' } }, competitors: [] }] },
  ]);
  t('ESPN events: string and object scores both parsed; unfinished skipped', ev.length === 1 && ev[0].hg === 2 && ev[0].ag === 0);
  t('month chunks cover a season', RS.monthChunks('2025-07-01', '2025-09-15').length === 3);
  const P = [
    { date: '2025-08-10', home: 'A', away: 'B', hg: 1, ag: 0 },
    { date: '2025-08-10', home: 'C', away: 'D', hg: 2, ag: 2 },
    { date: '2025-08-17', home: 'B', away: 'C', hg: 0, ag: 3 },
    { date: '2025-08-17', home: 'D', away: 'A', hg: 1, ag: 1 },
    { date: '2025-08-24', home: 'A', away: 'C', hg: 2, ag: 1 },
    { date: '2025-08-24', home: 'B', away: 'D', hg: 0, ag: 0 },
  ];
  const ren = (m) => ({ ...m, home: m.home + ' FC', away: m.away + ' FC' });
  const O1 = P.map(ren);
  const O2 = P.map(ren).map((m, i) => (i === 4 ? { ...m, hg: 3 } : m)); // one wrong score
  const one = RS.crossCheck(P, [{ src: 'x', matches: O2 }]);
  t('two sources disagreeing on a score -> result dropped as disputed', one.stats.disputed === 1 && one.matches.length === 5, JSON.stringify(one.stats));
  const two = RS.crossCheck(P, [{ src: 'x', matches: O1 }, { src: 'y', matches: O2 }]);
  t('three sources: the majority wins', two.stats.disputed === 0 && two.matches.length === 6 && two.matches.every((m) => m.check !== 'single'), JSON.stringify(two.stats));
  const Pwrong = P.map((m, i) => (i === 4 ? { ...m, hg: 5 } : m));
  const corr = RS.crossCheck(Pwrong, [{ src: 'x', matches: O1 }, { src: 'y', matches: O1 }]);
  t('two independent sources overrule a wrong primary', corr.matches.find((m) => m.date === '2025-08-24' && m.home === 'A').hg === 2);
}

// ================================================================== 5. odds
console.log('\n5. odds parsing and consensus');
{
  t('fractional and American odds', near(ODDS.frac('4/7'), 1.5714, 1e-3) && near(ODDS.american('-170'), 1.588, 1e-3) && near(ODDS.american('+475'), 5.75, 1e-9));
  const sum = {
    odds: [
      { provider: { name: 'DraftKings' }, moneyline: { home: { close: { odds: '-170' } }, away: { close: { odds: '+475' } }, draw: { close: { odds: '+280' } } }, overUnder: 2.5, total: { over: { close: { odds: '-115' } }, under: { close: { odds: '-120' } } } },
      { provider: { name: 'Bet 365' }, homeTeamOdds: { odds: { summary: '4/7', value: 1.571 } }, awayTeamOdds: { odds: { summary: '4/1', value: 5.0 } }, drawOdds: { summary: '16/5', value: 4.2 },
        bettingOdds: { teamOdds: { preMatchOverUnderHandicap: { value: '2.5' }, preMatchGoalLineOver: { value: '37/40' }, preMatchGoalLineUnder: { value: '37/40' }, preMatchDoubleChanceHomeOrDraw: { value: '1/6' } } } },
    ],
  };
  const q = ODDS.parseEspnOdds(sum);
  const b365 = q.find((x) => /365/.test(x.book));
  t('ESPN summary: DraftKings (American) and Bet365 (fractional) both parsed', q.length === 2 && near(b365.h, 1.571, 1e-3) && near(b365.over, 1.925, 1e-3) && near(q[0].h, 1.588, 1e-3));
  t('Bet365 double chance parsed', b365.dc && near(b365.dc['1X'], 1.1667, 1e-3));
  const fd = ODDS.parseFdFixtures('Div,Date,Time,HomeTeam,AwayTeam,B365H,B365D,B365A,PSH,PSD,PSA,MaxH,MaxD,MaxA,AvgH,AvgD,AvgA,B365>2.5,B365<2.5,AHh,B365AHH,B365AHA\nE0,18/10/2026,15:00,Arsenal,Leeds,1.3,5.5,9,1.32,5.8,10,1.36,6,11,1.3,5.6,9.5,1.6,2.3,-1.5,1.95,1.95\nXX,18/10/2026,15:00,X,Y,2,3,4,,,,,,,,,,,,,,');
  t('football-data fixtures: per-book quotes, unknown divisions dropped', fd.length === 1 && fd[0].slug === 'eng.1' && fd[0].quotes.some((x) => x.book === 'Pinnacle'), JSON.stringify(fd).slice(0, 200));
  const asian = { reversed: true, books: ['a', 'b'], h2h: { home: { median: 5.0, best: 5.4 }, draw: { median: 4.0, best: 4.2 }, away: { median: 1.6, best: 1.65 } }, totals: { 2.5: { over: { median: 1.9, best: 1.95 }, under: { median: 1.9, best: 1.95 } } } };
  const cons = ODDS.buildConsensus([...q, ...fd[0].quotes], asian);
  t('consensus pools ESPN, football-data and Asian books', cons.nBooks >= 6, cons.books.join(', '));
  t('reversed Asian listing is oriented to our home side', cons.x12.fair.home > cons.x12.fair.away);
  t('"Best price" (max) is never pooled into the fair line', !cons.books.includes('Best price') && cons.x12.best.h.price >= 1.36);
  const lam = ODDS.impliedLambdas(cons, 2.7);
  t('market-implied expected goals from the consensus', lam && lam.lamH > lam.lamA && lam.lamH + lam.lamA > 2, JSON.stringify(lam));
}

// ================================================================== 6. FPL
console.log('\n6. Fantasy Premier League availability');
{
  const boot = {
    fetchedAt: 'x',
    teams: [{ id: 1, name: 'Man Utd', short: 'MUN' }, { id: 2, name: 'Man City', short: 'MCI' }, { id: 3, name: "Nott'm Forest", short: 'NFO' }],
    elements: [
      { name: 'Striker', team: 1, pos: 4, status: 'i', chance: 0, news: 'Hamstring', minutes: 800, xgi: 6 },
      { name: 'Winger', team: 1, pos: 3, status: 'd', chance: 50, news: 'Knock', minutes: 700, xgi: 3 },
      { name: 'Keeper', team: 1, pos: 1, status: 's', chance: null, news: 'Suspended', minutes: 900, xgi: 0 },
      { name: 'Back', team: 1, pos: 2, status: 'a', chance: null, news: '', minutes: 900, xgi: 1 },
      { name: 'Rest', team: 1, pos: 3, status: 'a', chance: null, news: '', minutes: 200, xgi: 10 },
      { name: 'City9', team: 2, pos: 4, status: 'a', chance: null, news: '', minutes: 800, xgi: 8 },
    ],
  };
  const r = FPL.teamReport(boot, 'Manchester United');
  t('ESPN name resolves to the FPL club (Manchester United -> Man Utd)', r && r.team === 'Man Utd');
  t('FPL Manchester City is not confused with United', FPL.teamReport(boot, 'Manchester City').team === 'Man City');
  t('attack loss = missing xGI share weighted by chance', near(r.attackLoss, (6 + 0.5 * 3) / 20, 1e-9), r.attackLoss);
  t('suspended regular keeper flagged', r.gkOut === true && r.keyOut.some((p) => p.name === 'Keeper'));
  t('50% player is doubtful, not out', r.doubtful.some((p) => p.name === 'Winger') && !r.keyOut.some((p) => p.name === 'Winger'));
  const adj = FPL.lambdaAdjust({ home: r, away: FPL.teamReport(boot, 'Manchester City') });
  t('availability lowers the depleted side and is bounded', adj.home < 1 && adj.home > 0.7 && adj.away <= 1.12);
}

// ================================================================== 7. ensemble + pricing
console.log('\n7. ensemble, calibration and pricing');
{
  const ens = ENS.combine({ market: { lamH: 1.9, lamA: 0.8, books: 3 }, ratings: { lamH: 1.5, lamA: 1.0, confidence: 0.8 }, xg: { lamH: 1.6, lamA: 1.1 }, eloDiff: 150 });
  t('market carries 90% of the weight when priced', ens.weights.market === 0.9 && ens.calibrationSet === 'withMarket');
  t('ensemble lies between model and market', ens.lamH < 1.9 && ens.lamH > ens.model.lamH);
  const solo = ENS.combine({ market: null, ratings: { lamH: 1.5, lamA: 1.0 }, xg: null, eloDiff: null });
  t('model-only when there is no price', solo.weights.market === 0 && solo.calibrationSet === 'modelOnly');
  t('nothing to rate -> null', ENS.combine({}) === null);
  const mk = ENS.deriveMarkets(ens);
  const by = Object.fromEntries(mk.map((m) => [m.key, m]));
  t('1X2 sums to one after calibration', near(by['1'].prob + by.X.prob + by['2'].prob, 1, 1e-9));
  t('Over/Under and BTTS stay complementary', near(by['O2.5'].prob + by['U2.5'].prob, 1, 1e-9) && near(by.BTTS_Y.prob + by.BTTS_N.prob, 1, 1e-9));
  t('GG/NG 2+ is a first-class market', by.GG2P && by.GG2N && near(by.GG2P.prob + by.GG2N.prob, 1, 1e-9));
  t('every market keeps raw, calibrated and model-only probabilities', mk.every((m) => m.rawProb != null && m.prob != null) && by['1'].modelProb != null);
  const cons = { nBooks: 3, books: ['a', 'b', 'c'], x12: { fair: { home: 0.6, draw: 0.24, away: 0.16 }, books: 3, best: { h: { price: 1.75, book: 'b' }, d: null, a: null } }, totals: {} };
  PR.attach(mk, cons);
  const s1 = PR.priceState({ ...by['1'], prob: 0.6 });
  t('a price beating the 3-book fair by 5% is VALUE', s1.state === 'value', JSON.stringify(s1));
  cons.x12.best.h.price = 1.68;
  PR.attach(mk, cons);
  t('a price only 0.8% above fair is FAIR, not value', PR.priceState({ ...by['1'], prob: 0.6 }).state === 'fair');
  t('fair odds under 1.25 -> too short', PR.priceState({ ...by['1'], prob: 0.85, v5price: by['1'].v5price }).state === 'too-short');
  t('unquoted market -> unpriced with a take-at price', PR.priceState(by.GG2P).state === 'unpriced' && by.GG2P.v5price.valuePrice > 1.25);
}

// ================================================================== 8. scoreline + general
console.log('\n8. final score and general prediction');
{
  const sp = SL.predict(1.9, 0.7, { home: 0.66, draw: 0.2, away: 0.14, over25: 0.55 });
  t('coherent score agrees with the result call and the goals call', sp.predicted.home > sp.predicted.away && sp.predicted.home + sp.predicted.away >= 3, sp.predicted.score);
  t('most likely score is the grid argmax', sp.top[0].score === sp.mostLikely.score);
  t('score band covers at least half the probability', sp.band.prob >= 0.5);
  const ens = ENS.combine({ market: { lamH: 1.9, lamA: 0.75, books: 2 }, ratings: null, xg: null, eloDiff: null });
  const mk = ENS.deriveMarkets(ens);
  PR.attach(mk, null);
  const g = GEN.predict({ match: { home: { name: 'Home FC' }, away: { name: 'Away FC' } }, ens, markets: mk, methodology: null });
  t('general: result, goals, BTTS and score all present', g.result && g.goals && g.btts && g.score.predicted && g.score.grid5.length === 5);
  t('general best bet pays at least 1.30', g.bestBet && g.bestBet.fairOdds >= 1.3);
  t('labels name the clubs', !/^Home |^Away /.test(g.bestBet.label) && /Home FC|Away FC|Goals|Both|Over|Under/.test(g.bestBet.label), g.bestBet.label);
}

// ================================================================== 9. methodology v5 behaviour
console.log('\n9. methodology v5 rules');
{
  const games = (list) => list.map(([gf, ga], i) => ({ gf, ga, venue: i % 2 ? 'A' : 'H', date: `2026-09-${String(28 - i).padStart(2, '0')}` }));
  function run({ lamH, lamA, home, away, h2h = [], cons = null, market = true }) {
    const ens = ENS.combine({ market: market ? { lamH, lamA, books: 3 } : null, ratings: { lamH, lamA, confidence: 1 }, xg: { lamH, lamA }, eloDiff: 0 });
    const markets = ENS.deriveMarkets(ens);
    PR.attach(markets, cons);
    return MI.evaluateFixture({
      match: { date: '2026-10-18T15:00:00Z', home: { name: 'H' }, away: { name: 'A' }, odds: null },
      sm: ens.sm, model: { lambda: { home: ens.lamH, away: ens.lamA } }, markets,
      ctx: { form: {}, standings: { home: { rank: 5 }, away: { rank: 8 } } },
      newsRisk: { scanned: 2, home: { level: 'none', items: [] }, away: { level: 'none', items: [] } },
      hist: { source: 'verified-results', leagueRates: null, home: { games: home }, away: { games: away }, h2h },
      elo: null, ens, fpl: null, consensus: cons,
    });
  }
  const R_ = (out, id) => out.results.find((r) => r.id === id);
  // Rule 38: extreme recent Under streak + clean sheets
  const streak = games([[1, 0], [0, 0], [1, 0], [0, 0], [1, 0], [0, 0], [2, 0], [0, 0]]);
  const u = run({ lamH: 0.95, lamA: 0.75, home: streak, away: streak });
  const rec = R_(u, 'under25').gates.find((g) => g.id === 'RECENCY');
  t('Under 2.5 Rule 38 rejects a price built on an extreme recent streak', rec && rec.pass === false, JSON.stringify(rec));
  // GG1 needs two independent reconstructions
  const gg = R_(run({ lamH: 2.1, lamA: 1.9, home: games([[3, 2], [2, 2], [3, 1], [2, 3], [4, 2], [2, 2], [3, 3], [2, 1]]), away: games([[2, 2], [3, 2], [2, 3], [2, 1], [3, 3], [2, 2], [1, 2], [3, 2]]) }), 'gg2');
  const gg1 = gg.gates.find((g) => g.id === 'GG1');
  t('GG/NG 2+ Rule 33 corroboration uses market-implied and model-only reconstructions', gg1 && gg1.pass === true && /market-implied/.test(gg1.value), JSON.stringify(gg1));
  t('GG/NG 2+ stays paper-only', gg.status !== 'LOCK' && gg.status !== 'PREDICT');
  // correct score never headlines; Rule 35 line everywhere
  const fav = run({ lamH: 2.2, lamA: 0.6, home: games([[2, 0], [3, 0], [2, 1], [1, 0], [3, 1], [2, 0], [4, 1], [2, 0]]), away: games([[0, 2], [1, 2], [0, 1], [0, 3], [1, 1], [0, 2], [0, 1], [1, 3]]) });
  t('correct score never takes the fixture headline', !fav.headline || fav.headline.id !== 'correctScore');
  t('every scored verdict carries a Rule 35 line with a take-at price', fav.results.filter((r) => r.prob).every((r) => /Take at ≥/.test(r.line35)));
  t('independent witness item present on v5 verdicts', R_(fav, 'homeWin').checklist.items.some((c) => c.id === 'WITNESS'));
  // LOCK requires a price edge vs the consensus, not a model opinion
  const consV = { nBooks: 3, books: ['a', 'b', 'c'], x12: { fair: { home: 0.7, draw: 0.18, away: 0.12 }, books: 3, best: { h: { price: 1.6, book: 'b' }, d: null, a: null } }, totals: {} };
  const locked = run({ lamH: 2.2, lamA: 0.6, home: games([[2, 0], [3, 0], [2, 1], [1, 0], [3, 1], [2, 0], [4, 1], [2, 0]]), away: games([[0, 2], [1, 2], [0, 1], [0, 3], [1, 1], [0, 2], [0, 1], [1, 3]]), cons: consV });
  const hw = R_(locked, 'homeWin');
  t('the price ladder reads the consensus (value state when a book beats fair)', hw.price.state === 'value', `${hw.status} ${hw.price.state}`);
  {
    const e2 = ENS.combine({ market: { lamH: 2.2, lamA: 0.6, books: 3 }, ratings: { lamH: 2.2, lamA: 0.6, confidence: 1 }, xg: { lamH: 2.2, lamA: 0.6 }, eloDiff: 250 });
    const m2 = ENS.deriveMarkets(e2);
    PR.attach(m2, consV);
    const ten = (l) => l.map(([gf, ga], i) => ({ gf, ga, venue: i % 2 ? 'A' : 'H', date: `2026-09-${String(28 - i).padStart(2, '0')}` }));
    const o2 = MI.evaluateFixture({
      match: { date: '2026-10-18T15:00:00Z', home: { name: 'H' }, away: { name: 'A' }, odds: null }, sm: e2.sm, model: { lambda: { home: e2.lamH, away: e2.lamA } }, markets: m2,
      ctx: { form: {}, standings: { home: { rank: 2 }, away: { rank: 18 } } }, newsRisk: { scanned: 2, home: { level: 'none', items: [] }, away: { level: 'none', items: [] } },
      hist: { source: 'verified-results', leagueRates: null, home: { games: ten([[2, 0], [3, 0], [2, 1], [1, 0], [3, 1], [2, 0], [4, 1], [2, 0], [3, 0], [2, 1]]) }, away: { games: ten([[0, 2], [1, 2], [0, 1], [0, 3], [1, 1], [0, 2], [0, 1], [1, 3], [0, 2], [1, 2]]) }, h2h: [] },
      elo: { home: 1900, away: 1650, diff: 320, expectancy: 0.86, favourite: 'home' }, ens: e2, fpl: null, consensus: consV,
    });
    const h2 = o2.results.find((r) => r.id === 'homeWin');
    t('a qualifying home win at a price 12% over the 3-book fair is a LOCK', h2.status === 'LOCK', `${h2.status} ${h2.price.state} ${h2.failedGates}`);
    consV.x12.best.h.price = 1.44;
    PR.attach(m2, consV);
    const o3 = MI.evaluateFixture({ ...{ match: { date: '2026-10-18T15:00:00Z', home: { name: 'H' }, away: { name: 'A' }, odds: null } }, sm: e2.sm, model: { lambda: { home: e2.lamH, away: e2.lamA } }, markets: m2,
      ctx: { form: {}, standings: { home: { rank: 2 }, away: { rank: 18 } } }, newsRisk: { scanned: 2, home: { level: 'none', items: [] }, away: { level: 'none', items: [] } },
      hist: { source: 'verified-results', leagueRates: null, home: { games: ten([[2, 0], [3, 0], [2, 1], [1, 0], [3, 1], [2, 0], [4, 1], [2, 0], [3, 0], [2, 1]]) }, away: { games: ten([[0, 2], [1, 2], [0, 1], [0, 3], [1, 1], [0, 2], [0, 1], [1, 3], [0, 2], [1, 2]]) }, h2h: [] },
      elo: { home: 1900, away: 1650, diff: 320, expectancy: 0.86, favourite: 'home' }, ens: e2, fpl: null, consensus: consV });
    t('the same pick at the fair price is a PREDICT, not a LOCK', o3.results.find((r) => r.id === 'homeWin').status === 'PREDICT');
  }
  t('Double Chance contradicts the opposite win', MI.conflicts({ id: 'doubleChance', pick: { key: 'X2' } }, { id: 'homeWin', pick: { key: '1' } }));
  t('13 methodologies registered', MI.SPECS.length === 13);
}

// ================================================================== 10. settlement
console.log('\n10. settlement');
{
  t('totals, BTTS, GG2', settle('O2.5', 2, 1) === 1 && settle('U2.5', 2, 1) === 0 && settle('BTTS_N', 1, 0) === 1 && settle('GG2P', 2, 1) === 0);
  t('double chance and draw no bet', settle('1X', 1, 1) === 1 && settle('X2', 2, 1) === 0 && settle('DNB_H', 1, 1) === null);
  t('Asian handicap with push', settle('AH_H_-1', 2, 1) === null && settle('AH_H_-1.5', 3, 1) === 1 && settle('AH_A_1', 1, 0) === 0);
  t('team totals and correct score', settle('TTA_U1.5', 0, 1) === 1 && settle('CS_2-1', 2, 1) === 1 && settle('CS_2-1', 1, 2) === 0);
}

// ================================================================== 11. ledger
console.log('\n11. ledger');
(async () => {
  const L = require('../lib/ledger');
  const espn = require('../lib/espn');
  const mk = (id, date, state, prob) => ({
    analysable: true,
    match: { id, league: 'eng.1', leagueName: 'Premier League', date, state, home: { name: 'H' + id }, away: { name: 'A' + id } },
    methodology: { headline: { id: 'homeWin', name: 'Home Win', status: 'PREDICT', pick: { key: '1', label: 'H wins' }, prob, price: { valuePrice: 1.5 } }, predictions: [] },
    general: { bestBet: { key: 'O1.5', label: 'Over 1.5', prob: 0.75, valuePrice: 1.37 }, score: { predicted: { score: '2-0', prob: 0.11 } } },
  });
  const days = ['2026-09-01', '2026-09-02', '2026-09-03'].map((d, i) => mk(String(500 + i), `${d}T15:00:00Z`, 'pre', 0.6));
  const added = L.record([...days, mk('600', '2026-09-04T15:00:00Z', 'post', 0.6)]);
  t('only pre-match fixtures are recorded', added === 9, added);
  t('recording is idempotent', L.record(days) === 0);
  // stub the scoreboard: every home side loses 0-1
  const orig = espn.scoreboardRaw;
  espn.scoreboardRaw = async (league, day) => ({ events: days.filter((r) => espn.ymd(new Date(r.match.date)) === day).map((r) => ({
    id: r.match.id, competitions: [{ status: { type: { completed: true } }, competitors: [{ homeAway: 'home', score: '0' }, { homeAway: 'away', score: '1' }] }],
  })) });
  const n = await L.settleAll();
  espn.scoreboardRaw = orig;
  t('finished matches are settled from the scoreboard', n === 9, n);
  const s = L.summary();
  t('per-method record computed', s.perMethod.headline && s.perMethod.headline.n === 3 && s.perMethod.headline.hitRate === 0);
  t('Rule 17: three losing days trigger the cooldown', s.discipline.rule17.consecutiveLossDays === 3 && !!s.discipline.rule17.cooldownUntil);
  t('Rule 34 not ready without 40 GG legs', s.discipline.rule34.readyForRealMoney === false);
  t('CSV export has a header and rows', L.toCsv().split('\n').length >= 10);

  console.log('\n=========================================================');
  console.log(` ${pass} passed, ${fail} failed`);
  console.log('=========================================================');
  process.exit(fail ? 1 : 0);
})();
