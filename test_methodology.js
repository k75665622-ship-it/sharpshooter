/* Offline tests for the methodology layer (lib/methodology, history, elo).
   No network. Every branch is driven by synthetic fixtures so the result is
   deterministic. Run: node test_methodology.js */
const M = require('./lib/model');
const MI = require('./lib/methodology');
const core = MI.core;
const H = require('./lib/history');
const ELO = require('./lib/elo');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

// ---------------------------------------------------------------- fixture builder

/** Games newest-first, alternating venue. Each entry [gf, ga]. */
function games(pairs, n = 10) {
  return Array.from({ length: n }, (_, i) => {
    const [gf, ga] = pairs[i % pairs.length];
    return { gf, ga, venue: i % 2 ? 'H' : 'A', date: `2026-09-${String(28 - i * 2).padStart(2, '0')}` };
  });
}

/**
 * Build a fixture and run every methodology.
 * opts.price(key) -> decimal price for a REAL quote, or undefined for none.
 */
function run({ lamH, lamA, home, away, h2h, news, elo, rest, odds, price, rho = -0.05, league }) {
  const sm = M.scoreMatrix(lamH, lamA, rho);
  const markets = M.deriveMarkets(sm).map((m) => {
    const p = price ? price(m) : undefined;
    return p ? { ...m, price: p, priceSource: 'book', impliedProb: 1 / p } : { ...m, price: m.fairOdds, priceSource: 'synthetic' };
  });
  const hist = {
    source: 'openfootball',
    leagueRates: league || { over25Rate: 0.52, bttsRate: 0.5, goalsPerGame: 2.7, homeWinRate: 0.43, drawRate: 0.26, awayWinRate: 0.31, homeGoalShare: 0.55, n: 380 },
    home: { name: 'Home FC', games: home },
    away: { name: 'Away FC', games: away },
    h2h: h2h || [],
  };
  const match = { date: '2026-10-17T15:00:00Z', home: { name: 'Home FC' }, away: { name: 'Away FC' }, odds: odds || null };
  const ctx = { standings: { home: { rank: 3 }, away: { rank: 6 } }, form: {}, homeRow: { xg: null }, awayRow: { xg: null } };
  if (rest) {
    // rest days -> make the newest game that many days before kick-off
    const d = (days) => new Date(Date.parse('2026-10-17T15:00:00Z') - days * 86400000).toISOString();
    if (rest.home != null) home[0].date = d(rest.home);
    if (rest.away != null) away[0].date = d(rest.away);
  }
  return MI.evaluateFixture({ match, sm, model: { lambda: { home: lamH, away: lamA } }, markets, ctx, newsRisk: news || null, hist, elo: elo || null });
}
const R = (out, id) => out.results.find((r) => r.id === id);
const gate = (r, id) => r.gates.find((g) => g.id === id);

// ================================================================== 1. history parser
console.log('\n1. history parser');
const sample = `
= X 2025/26
▪ Matchday 1
  Fri Aug 15 2025
    20:00  Arsenal FC              v Coventry City FC         3-0 (2-0)
  Sat Aug 16
           Brighton & Hove Albion FC v Aston Villa FC           4-0 (4-0)
    19:00   Liverpool  4-2 (1-0)  Bournemouth
  Sun Aug 17
    16:30  Not Played FC   v Someone FC
  Sat Jan 10
    15:00  A FC v B FC  0-0
`;
const parsed = H.parseSeasonText(sample, 2025);
t('parses both layouts (v-style and score-between)', parsed.length === 4, `got ${parsed.length}`);
t('v-style teams and score', parsed[0].home === 'Arsenal FC' && parsed[0].away === 'Coventry City FC' && parsed[0].hg === 3 && parsed[0].ag === 0);
t('half-time score is kept', parsed[0].hthg === 2 && parsed[0].htag === 0);
t('unplayed fixture is skipped', !parsed.some((m) => m.home === 'Not Played FC'));
t('no half-time score still parses', parsed[3].hg === 0 && parsed[3].hthg === null);
t('January date rolls into the next calendar year', parsed[3].date === '2026-01-10', parsed[3].date);
t('season start inference: Aug is the start year', parsed[0].date === '2025-08-15');
t('seasonStartFor: Oct 2026 -> 2026', H.seasonStartFor(new Date('2026-10-17')) === 2026);
t('seasonStartFor: Mar 2026 -> 2025', H.seasonStartFor(new Date('2026-03-01')) === 2025);
t('seasonFolder', H.seasonFolder(2025) === '2025-26' && H.seasonFolder(2099) === '2099-00');

// ================================================================== 2. name resolution
console.log('\n2. club name resolution');
const mm = [
  { home: 'Manchester City FC', away: 'Manchester United FC', date: '2025-09-01', hg: 1, ag: 0 },
  { home: 'Manchester United', away: 'Manchester City', date: '2026-09-01', hg: 2, ag: 1 },
  { home: 'Napoli', away: 'SSC Napoli', date: '2025-09-02', hg: 0, ag: 0 },
];
t('Manchester City and United never collide', H.resolveName('Manchester United', mm) !== H.resolveName('Manchester City', mm));
t('exact folded match', H.resolveName('Manchester City', mm).startsWith('Manchester City'));
t('unknown club -> null, not a guess', H.resolveName('Totally Unknown Rovers', mm) === null);

// ================================================================== 3. Elo
console.log('\n3. Elo');
const csv = 'Rank,Club,Country,Level,Elo,From,To,Date\n1,Arsenal,ENG,1,2050,2026-10-01,2026-10-20,x\n2,Man City,ENG,1,2000.5,2026-10-01,2026-10-20,x\nNaN,Bad,ENG,1,abc,x,x,x\n';
const rows = ELO.parseCsv(csv);
t('parseCsv reads rows by header name', rows.length === 2 && rows[0].club === 'Arsenal' && rows[0].elo === 2050, JSON.stringify(rows));
t('parseCsv drops unparseable Elo', !rows.some((r) => r.club === 'Bad'));
t('parseCsv tolerates garbage', ELO.parseCsv('<html>nope').length === 0 && ELO.parseCsv('').length === 0 && ELO.parseCsv(null).length === 0);
t('alias: "Manchester City" -> Man City', ELO.findClub(rows, 'Manchester City', 'ENG').club === 'Man City');
t('unknown club -> null', ELO.findClub(rows, 'Zzz United', 'ENG') === null);
const sum = ELO.summarise({ club: 'A', elo: 2000 }, { club: 'B', elo: 1800 });
t('home advantage is included in the diff', sum.diff === 200 + ELO.HOME_ADV);
t('expectancy > 0.5 for the stronger home side', sum.expectancy > 0.5 && sum.favourite === 'home');
t('near-equal ratings are "even"', ELO.summarise({ club: 'A', elo: 1800 }, { club: 'B', elo: 1850 }).favourite === 'even');

// ================================================================== 4. core evidence + price
console.log('\n4. core: evidence and price discipline');
const ev = core.sideEvidence(games([[0, 1], [1, 1], [2, 0], [3, 1]], 8));
t('0/1/2+ goal distribution counts', ev.gf0 === 2 && ev.gf1 === 2 && ev.gf2p === 4 && ev.gf3p === 2, JSON.stringify([ev.gf0, ev.gf1, ev.gf2p, ev.gf3p]));
t('clean sheets and failures to score', ev.cs === 2 && ev.fts === 2);
t('sample label', ev.sample === 'STRONG' && core.sideEvidence(games([[1, 0]], 5)).sample === 'LIMITED' && core.sideEvidence(games([[1, 0]], 3)).sample === 'TINY');
t('empty evidence is safe', core.sideEvidence([]).n === 0 && core.sideEvidence(null).n === 0);
t('streak counters', core.sideEvidence([{ gf: 1, ga: 0 }, { gf: 2, ga: 0 }, { gf: 0, ga: 0 }]).scoreStreak === 2);

const spec = { minRatio: 1.08 };
const mk = (prob, price, src = 'book') => ({ prob, price, priceSource: src, label: 'x' });
t('unpriced market is "unpriced"', core.priceState(mk(0.7, 1.5, 'synthetic'), spec).state === 'unpriced');
t('real price with edge', core.priceState(mk(0.66, 1.80), spec).state === 'edge', JSON.stringify(core.priceState(mk(0.66, 1.80), spec)));
t('real price without edge', core.priceState(mk(0.56, 1.80), spec).state === 'no-edge');
t('price floor (Rule 7)', core.priceState(mk(0.95, 1.10), spec).state === 'too-short');
const r18 = core.priceState(mk(0.6, 1.8), spec).reqRatio;
const r80 = core.priceState(mk(0.3, 8.0), spec).reqRatio;
t('edge multiple scales with the price (1.8 vs 8.0)', Math.abs(r18 - 1.09) < 1e-9 && Math.abs(r80 - 1.4) < 1e-9, `${r18} ${r80}`);
t('missing market is safe', core.priceState(null, spec).state === 'unpriced');
const gu = core.G('X', 'x', null, 'v', 'n');
t('an unknown evidence gate fails closed', gu.pass === false && gu.unknown === true);

// ---- calibration
console.log('\n4b. calibration layer');
const mkts = [{ key: 'O2.5', prob: 0.7, fairOdds: 1 / 0.7 }, { key: 'U2.5', prob: 0.3, fairOdds: 1 / 0.3 }, { key: 'BTTS_Y', prob: 0.65, fairOdds: 1 / 0.65 }, { key: 'BTTS_N', prob: 0.35, fairOdds: 1 / 0.35 }, { key: '1', prob: 0.5, fairOdds: 2 }, { key: 'O3.5', prob: 0.4, fairOdds: 2.5 }];
const cm = core.calibrateMarkets(mkts);
const cb = Object.fromEntries(cm.map((m) => [m.key, m]));
t('over-confident Over 2.5 is shrunk toward the middle', cb['O2.5'].prob < 0.7 && cb['O2.5'].prob > 0.55, cb['O2.5'].prob);
t('Under 2.5 stays the exact complement of Over 2.5', Math.abs(cb['O2.5'].prob + cb['U2.5'].prob - 1) < 1e-12);
t('BTTS No stays the exact complement of BTTS Yes', Math.abs(cb['BTTS_Y'].prob + cb['BTTS_N'].prob - 1) < 1e-12);
t('raw probability is kept alongside', cb['O2.5'].rawProb === 0.7 && cb['O2.5'].calibrated === true);
t('fair odds follow the calibrated probability', Math.abs(cb['O2.5'].fairOdds - 1 / cb['O2.5'].prob) < 1e-12);
t('unmeasured markets are untouched', cb['1'].prob === 0.5 && cb['O3.5'].prob === 0.4 && cb['1'].calibrated === undefined);
t('input array is not mutated', mkts[0].prob === 0.7 && mkts[0].rawProb === undefined);
t('calibration is monotonic', core.calibrateProb('O2.5', 0.6) < core.calibrateProb('O2.5', 0.7) && core.calibrateProb('O2.5', 0.3) < core.calibrateProb('O2.5', 0.4));
t('calibration leaves an even game roughly even', Math.abs(core.calibrateProb('O2.5', 0.5) - 0.5) < 0.05);
t('every calibrated pair resolves to a real market key', Object.values(core.CALIBRATION).every((c) => !!c.pair));

// ================================================================== 5. archetypes
console.log('\n5. archetypes: each methodology fires on its own profile');

// OPEN GAME: two attacks, two leaky defences, no heavy favourite.
const OPEN_H = games([[2, 1], [3, 2], [1, 2], [2, 2], [3, 1], [2, 3], [1, 1], [4, 2]]);
const OPEN_A = games([[2, 2], [1, 3], [3, 1], [2, 1], [2, 3], [1, 2], [3, 2], [2, 2]]);
const open = run({ lamH: 1.75, lamA: 1.65, home: OPEN_H, away: OPEN_A, h2h: [{ hg: 2, ag: 2 }, { hg: 3, ag: 1 }, { hg: 1, ag: 2 }, { hg: 2, ag: 1 }] });
t('open game: Over 2.5 qualifies', R(open, 'over25').qualifies, `${R(open, 'over25').status} fails=${R(open, 'over25').failedGates}`);
t('open game: BTTS Yes qualifies', R(open, 'bttsYes').qualifies, `${R(open, 'bttsYes').status} fails=${R(open, 'bttsYes').failedGates}`);
t('open game: Under 2.5 removed', !R(open, 'under25').qualifies && R(open, 'under25').status === 'REMOVE');
t('open game: BTTS No removed', R(open, 'bttsNo').status === 'REMOVE');
t('open game: nobody predicts a draw', !R(open, 'draw').qualifies);

// FORTRESS: strong home side that wins 1-0 / 2-0, away side blanks.
const FORT_H = games([[2, 0], [1, 0], [2, 0], [3, 1], [1, 0], [2, 0], [0, 0], [2, 1]]);
const FORT_A = games([[0, 2], [0, 1], [1, 2], [0, 0], [0, 1], [1, 3], [0, 2], [0, 1]]);
const fort = run({ lamH: 1.9, lamA: 0.4, home: FORT_H, away: FORT_A, h2h: [{ hg: 2, ag: 0 }, { hg: 1, ag: 0 }, { hg: 3, ag: 0 }, { hg: 1, ag: 0 }] });
t('fortress: BTTS No qualifies', R(fort, 'bttsNo').qualifies, `${R(fort, 'bttsNo').status} fails=${R(fort, 'bttsNo').failedGates}`);
t('fortress: Over/BTTS Yes removed', R(fort, 'bttsYes').status === 'REMOVE' && !R(fort, 'over25').qualifies);
t('fortress: away team-goals pick is the shutout leg', /U0\.5|U1\.5/.test(R(fort, 'teamGoals').pick.key), R(fort, 'teamGoals').pick.key);
t('fortress: Home win methodology evaluated', R(fort, 'homeWin').prob > 0.6);

// DRAW MACHINE: two low-scoring, drawing sides, no favourite.
const DRW_H = games([[1, 1], [0, 0], [1, 1], [2, 1], [1, 1], [0, 0], [1, 2], [1, 1]]);
const DRW_A = games([[1, 1], [0, 0], [1, 0], [1, 1], [0, 0], [2, 2], [1, 1], [0, 1]]);
const drw = run({ lamH: 1.0, lamA: 0.95, home: DRW_H, away: DRW_A, h2h: [{ hg: 1, ag: 1 }, { hg: 0, ag: 0 }, { hg: 1, ag: 1 }, { hg: 2, ag: 1 }], rho: -0.1 });
t('draw machine: Draw methodology reads the draw rates', gate(R(drw, 'draw'), 'MACHINE').pass, JSON.stringify(gate(R(drw, 'draw'), 'MACHINE')));
t('Draw (v5): honest probability, published as a half-stake prediction, never the headline', MI.BY_ID.draw.paperOnly === false && MI.BY_ID.draw.headline === false && R(drw, 'draw').status !== 'LOCK');
t('draw machine: Home/Away win removed', !R(drw, 'homeWin').qualifies && !R(drw, 'awayWin').qualifies);

// ================================================================== 6. specific rules
console.log('\n6. specific rules');

// Rule 29 + gate GG3: GG/NG 2+ is removed on an ordinary game, and is NEVER a LOCK.
t('GG/NG 2+ is removed on an ordinary open game (it needs far more than "lots of goals")', R(open, 'gg2').status === 'REMOVE' && R(open, 'gg2').failedGates.length > 0, `${R(open, 'gg2').status} ${R(open, 'gg2').failedGates}`);
t('GG/NG 2+ convolution gate bites on a one-sided game', !gate(R(fort, 'gg2'), 'GG3').pass, JSON.stringify(gate(R(fort, 'gg2'), 'GG3')));
const shoot = run({ lamH: 2.4, lamA: 2.3, home: games([[3, 2], [2, 2], [4, 2], [3, 3], [2, 1], [3, 2], [2, 2], [3, 1]]), away: games([[2, 3], [3, 2], [2, 2], [3, 3], [2, 4], [2, 2], [3, 2], [2, 3]]), league: { over25Rate: 0.62, bttsRate: 0.6, goalsPerGame: 3.1, homeWin: 0.4, drawRate: 0.26, awayWin: 0.34, n: 300 } });
const g2 = R(shoot, 'gg2');
t('GG/NG 2+ can reach the structural gates on a shoot-out profile', gate(g2, 'GG3').pass, JSON.stringify(gate(g2, 'GG3')));
t('GG/NG 2+ is paper-trade only: never LOCK', g2.status !== 'LOCK' && (g2.status === 'PAPER' || g2.status === 'REMOVE' || g2.status === 'WATCH'), g2.status);
t('GG/NG 2+ carries the 2-leg cap and fixed stake', g2.maxLegs === 2 && /fixed/.test(g2.stake || ''));
t('GG/NG 2+ states why it is unpriced (Rule 33)', /corroborat|second book|correct-score|offered/i.test(g2.price.note), g2.price.note);
t('GG/NG 2+ probability includes the 0.88 haircut', Math.abs(g2.prob - shoot.view.pr.gg2Raw * 0.88) < 1e-9);
const smallGg = run({ lamH: 2.4, lamA: 2.3, home: games([[3, 2], [2, 2], [4, 2]], 6), away: games([[2, 3], [3, 2], [2, 2]], 6) });
t('GG/NG 2+ needs 8+ games per side (Rule 32)', !gate(R(smallGg, 'gg2'), 'SAMPLE').pass);

// Rule 31 / heavy favourite: Over 2.5 gate.
const heavyOdds = { homeClose: 1.28, drawClose: 6.0, awayClose: 11.0, homeOpen: 1.28, awayOpen: 11, drawOpen: 6 };
const heavy = run({ lamH: 2.3, lamA: 0.7, home: games([[2, 0], [1, 0], [2, 0], [1, 0], [2, 1], [1, 0], [3, 0], [2, 0]]), away: games([[0, 2], [1, 2], [0, 1], [0, 2], [1, 3], [0, 1], [0, 2], [1, 2]]), odds: heavyOdds });
t('heavy favourite is identified from the book price', heavy.view.fav.heavy && heavy.view.fav.side === 'home' && heavy.view.fav.source === 'book');
t('Over 2.5 gates a heavy favourite that wins 1-0 / 2-0 (Rule 25)', !gate(R(heavy, 'over25'), 'FAV').pass);

// Low block kills the Over.
const lowBlock = run({ lamH: 1.4, lamA: 1.3, home: games([[1, 0], [0, 0], [1, 0], [0, 1], [1, 0], [0, 0], [1, 1], [0, 0]]), away: games([[0, 1], [0, 0], [0, 1], [1, 0], [0, 0], [0, 1], [0, 0], [1, 0]]) });
t('low-block profile fails the Over 2.5 gate (Rule 26)', !gate(R(lowBlock, 'over25'), 'LOWBLOCK').pass);

// Rotation (Rule 15).
const rot = run({ lamH: 1.75, lamA: 1.65, home: OPEN_H.map((g) => ({ ...g })), away: OPEN_A.map((g) => ({ ...g })), rest: { home: 2, away: 7 } });
t('rotation (played 2 days ago) fails the Over 2.5 news gate', !gate(R(rot, 'over25'), 'NEWS').pass, JSON.stringify(gate(R(rot, 'over25'), 'NEWS')));
t('rest days are computed from the newest game', Math.abs(rot.view.rest.home - 2) < 0.01);

// Team-news positions from the scanner shape.
const newsRisk = {
  scanned: 3,
  home: { level: 'high', items: [{ kind: 'injury', severity: 'medium', headline: 'Home centre-back injured', evidence: 'injured' }, { kind: 'suspension', severity: 'high', headline: 'Home goalkeeper suspended', evidence: 'suspended' }] },
  away: { level: 'none', items: [] },
  neutral: [],
};
const pos = core.newsPositions(newsRisk);
t('news positions: defender and keeper absences are counted', pos.home.def === 1 && pos.home.gk === 1 && pos.home.absences === 2, JSON.stringify(pos.home));
const under2 = run({ lamH: 1.2, lamA: 1.0, home: games([[1, 0], [0, 1], [1, 1], [0, 0], [1, 0], [0, 0], [1, 1], [0, 1]]), away: games([[0, 0], [1, 0], [0, 1], [1, 1], [0, 0], [1, 0], [0, 0], [1, 0]]), news: newsRisk });
t('Under 2.5 refuses defensive disruption (Rule 15 inverted)', !gate(R(under2, 'under25'), 'NEWS').pass, JSON.stringify(gate(R(under2, 'under25'), 'NEWS')));

// 1-1 trap for BTTS No.
const trap = run({ lamH: 1.3, lamA: 1.2, home: games([[1, 1], [1, 0], [0, 1], [1, 1], [2, 1], [1, 1], [0, 0], [1, 2]]), away: games([[1, 1], [1, 1], [0, 1], [1, 0], [1, 1], [1, 2], [0, 0], [1, 1]]) });
// v5: the 1-1 trap is a checklist item (as a hard gate it removed ~75% of candidates without
// raising the hit rate once probabilities are calibrated), and it still fails here.
const trapItem = R(trap, 'bttsNo').checklist.items.find((c) => c.id === 'TRAP11');
t('BTTS No fails the 1-1 trap when 1-1 is live (Rule 1)', trapItem && trapItem.score < 0.5 && !R(trap, 'bttsNo').qualifies, JSON.stringify(trapItem));

// ================================================================== 7. price states
console.log('\n7. status ladder and price');
const priced = (mult) => (m) => ((m.key === 'O2.5') ? m.fairOdds * mult : undefined);
const withEdge = run({ lamH: 1.75, lamA: 1.65, home: OPEN_H, away: OPEN_A, h2h: [{ hg: 2, ag: 2 }, { hg: 3, ag: 1 }, { hg: 1, ag: 2 }, { hg: 2, ag: 1 }], price: priced(1.25) });
const noEdge = run({ lamH: 1.75, lamA: 1.65, home: OPEN_H, away: OPEN_A, h2h: [{ hg: 2, ag: 2 }, { hg: 3, ag: 1 }, { hg: 1, ag: 2 }, { hg: 2, ag: 1 }], price: priced(0.9) });
const unpriced = run({ lamH: 1.75, lamA: 1.65, home: OPEN_H, away: OPEN_A, h2h: [{ hg: 2, ag: 2 }, { hg: 3, ag: 1 }, { hg: 1, ag: 2 }, { hg: 2, ag: 1 }] });
t('the same fixture: a generous real price -> LOCK', R(withEdge, 'over25').status === 'LOCK', `${R(withEdge, 'over25').status} ${R(withEdge, 'over25').price.note}`);
t('a short real price -> PREDICT, never LOCK', R(noEdge, 'over25').status === 'PREDICT', `${R(noEdge, 'over25').status}`);
t('no price at all -> PREDICT with fair odds', R(unpriced, 'over25').status === 'PREDICT' && R(unpriced, 'over25').fairOdds > 1);
t('LOCK outranks PREDICT in the headline', core.STATUS_RANK.LOCK > core.STATUS_RANK.PREDICT && core.STATUS_RANK.PREDICT > core.STATUS_RANK.PAPER);
t('every result exposes gates, checklist, support and failure case', open.results.every((r) => Array.isArray(r.gates) && r.checklist && Array.isArray(r.support) && Array.isArray(r.failure)));
t('failed gates are listed by id', R(open, 'under25').failedGates.length > 0 && R(open, 'under25').gates.filter((g) => !g.pass).length === R(open, 'under25').failedGates.length);

// ================================================================== 8. exclusivity property test
console.log('\n8. property test: no contradictory predictions, no crashes');
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const rndGames = (lamFor, lamAgainst) => games(Array.from({ length: 8 }, () => {
  const g = (l) => { let k = 0, p = Math.exp(-l), s = p, u = rnd(); while (u > s && k < 8) { k++; p *= l / k; s += p; } return k; };
  return [g(lamFor), g(lamAgainst)];
}));
let contradictions = 0, crashes = 0, predictedFixtures = 0, total = 0, locksWithoutPrice = 0, gg2Locks = 0;
for (let i = 0; i < 400; i++) {
  const lamH = 0.5 + rnd() * 2.3;
  const lamA = 0.4 + rnd() * 2.0;
  try {
    const out = run({ lamH, lamA, home: rndGames(lamH, lamA * 0.9), away: rndGames(lamA, lamH * 0.9), h2h: rndGames(lamH, lamA).slice(0, 4).map((g) => ({ hg: g.gf, ag: g.ga })) });
    total++;
    if (out.predictions.length) predictedFixtures++;
    const ids = out.predictions.map((p) => p.id);
    for (let a = 0; a < out.predictions.length; a++) for (let b = a + 1; b < out.predictions.length; b++) if (MI.conflicts(out.predictions[a], out.predictions[b])) contradictions++;
    if (ids.includes('over25') && ids.includes('under25')) contradictions++;
    if (ids.includes('bttsYes') && ids.includes('bttsNo')) contradictions++;
    for (const r of out.results) {
      if (r.status === 'LOCK' && r.price.state !== 'edge') locksWithoutPrice++;
      if (r.id === 'gg2' && r.status === 'LOCK') gg2Locks++;
    }
  } catch (e) { crashes++; console.log('   crash:', e.message); }
}
t(`400 random fixtures evaluated without a crash (${total})`, crashes === 0 && total === 400);
t('no two predictions on one fixture contradict each other', contradictions === 0, `${contradictions} contradictions`);
t('a LOCK always has a real price with the required edge', locksWithoutPrice === 0, `${locksWithoutPrice}`);
t('GG/NG 2+ is never a LOCK', gg2Locks === 0);
// v5.1 (checklist bar 0.70): on real fixtures 63% get a methodology pick (research/methods_audit.js,
// 12,538 of 19,991 held-out); these random fixtures are more lopsided than real ones
t(`selective: ${predictedFixtures}/${total} fixtures get any prediction`, predictedFixtures < total * 0.9, `${predictedFixtures}/${total}`);

// v5.1: tiers are a pick's chance; the checklist qualifies at 70% (draw and correct score 85%)
{
  t('tiers by chance: Diamond 80%+, Gold 70-80%, Silver 60-70%, Bronze 50-60%, long shot under 50%',
    core.tierFor(0.84) === 'Diamond' && core.tierFor(0.8) === 'Diamond' && core.tierFor(0.75) === 'Gold' && core.tierFor(0.65) === 'Silver' && core.tierFor(0.55) === 'Bronze' && core.tierFor(0.31) === 'Long shot' && core.tierFor(null) === 'Long shot');
  const V = {
    markets: { O2: { key: 'O2', prob: 0.72, price: 1.3, priceSource: 'synthetic' } },
    sides: { home: { n: 10, sample: 10 }, away: { n: 10, sample: 10 } },
    coverage: { basis: 'test', sample: { home: 10, away: 10 }, xg: false, newsScanned: false, odds1x2: false },
    v5: false,
  };
  // three of four checks pass: 0.75 of the checklist
  const spec = (extra) => ({ id: 'x', name: 'X', floor: 0.6, marketKey: 'O2', build: () => ({ gates: [], checklist: [core.C('a', 'a', 1), core.C('b', 'b', 1), core.C('c', 'c', 1), core.C('d', 'd', 0)] }), ...extra });
  const r = core.evaluateCandidate(spec(), V, { key: 'O2' });
  t('75% of the checklist now qualifies', r.status === 'PREDICT' && r.qualifies && r.checklist.need === 0.7, `${r.status} ${r.checklist.ratio}`);
  t('the tier follows the chance (72% -> Gold)', r.tier === 'Gold');
  const d = core.evaluateCandidate(spec({ qualify: 0.85 }), V, { key: 'O2' });
  t('a methodology that keeps the 85% bar (draw, correct score) does not qualify at 75%', d.status === 'WATCH' && !d.qualifies);
  t('draw and correct score keep the 85% bar', MI.BY_ID.draw.qualify === 0.85 && MI.BY_ID.correctScore.qualify === 0.85 && MI.BY_ID.over25.qualify == null);
}

// conflict resolution on a forced collision
const fake = (id, key, score) => ({ id, name: id, pick: { key, label: id }, status: 'PREDICT', score, qualifies: true });
t('conflicts(): Over 2.5 vs Under 2.5', MI.conflicts(fake('over25', 'O2.5', 70), fake('under25', 'U2.5', 60)));
t('conflicts(): BTTS No vs GG 2+', MI.conflicts(fake('bttsNo', 'BTTS_N', 70), fake('gg2', 'GG2P', 60)));
t('conflicts(): team fails to score vs BTTS Yes', MI.conflicts(fake('teamGoals', 'TTA_U0.5', 70), fake('bttsYes', 'BTTS_Y', 60)));
t('conflicts(): Over 2.5 and Home Win are compatible', !MI.conflicts(fake('over25', 'O2.5', 70), fake('homeWin', '1', 60)));
t('conflicts(): Under 2.5 and BTTS No are compatible', !MI.conflicts(fake('under25', 'U2.5', 70), fake('bttsNo', 'BTTS_N', 60)));

// ================================================================== 9. asian handicap maths
console.log('\n9. handicap maths');
const ahv = open.view;
const a1 = ahv.ah('home', -1);
t('AH probabilities sum to 1', Math.abs(a1.win + a1.push + a1.lose - 1) < 1e-9);
const m1 = open.view.markets['AH_H_-1'];
t('view.ah matches the derived market (home -1, ex-push)', m1 && Math.abs(a1.probExPush - m1.prob) < 1e-9, `${a1.probExPush} vs ${m1 && m1.prob}`);
const dogKey = require('./lib/methodology/results').ahKey('away', 1);
t('away +1 maps to home line -1 key', dogKey === 'AH_A_-1', dogKey);
t('AH +0.5 has no push', ahv.ah('home', 0.5).push === 0);

// ================================================================== 10. engine integration
console.log('\n10. engine integration (stubbed context)');
(async () => {
  const A = require('./lib/analysis');
  const E = require('./lib/engine');
  const original = A.buildContext;
  const row = { gp: 10, xg: 1.5, xga: 1.2, gf: 17, ga: 12, homeGoals: 9, awayGoals: 8, shots: 100, shotsOnTarget: 40, possession: 52, cleanSheets: 3, red: 0, suspensions: 0 };
  A.buildContext = async (match) => ({
    match, baseline: { xg: 1.4, xga: 1.4, goalsPerTeamPerGame: 1.4, goalsPerGame: 2.8, homeShare: 0.55, source: 'espn-team-stats' },
    homeRow: row, awayRow: { ...row, xg: 1.4 }, homeVia: 'x', awayVia: 'x', homeStatsLeague: match.league, awayStatsLeague: match.league,
    homeStrength: 1, awayStrength: 1, form: { home: null, away: null }, h2h: null, standings: { home: null, away: null },
    news: [], pickcenter: [], asian: null, asianNote: 'stub',
    hist: { source: 'openfootball', leagueRates: null, home: { name: 'H', games: OPEN_H }, away: { name: 'A', games: OPEN_A }, h2h: [] }, elo: null,
    summaryOdds: [], gameInfo: null,
  });
  try {
    const rep = await E.analyseMatch({ id: '1', league: 'eng.1', date: '2026-10-17T15:00:00Z', name: 'x', home: { id: '1', name: 'Home FC', short: 'HOM' }, away: { id: '2', name: 'Away FC', short: 'AWY' }, odds: null }, 2026);
    t('report carries a methodology block', rep.methodology && Array.isArray(rep.methodology.all) && rep.methodology.all.length === MI.SPECS.length, rep.methodology && rep.methodology.error);
    t('all thirteen methodologies are evaluated', new Set(rep.methodology.all.map((r) => r.id)).size === 13);
    t('v5 general prediction is attached', rep.general && rep.general.score && rep.general.score.predicted);
    t('legacy banker field is still present', 'banker' in rep);
    t('provenance reports the history source', rep.dataProvenance.hasHistory === true && rep.dataProvenance.historySample.home === 10);
    t('methodology output is JSON-serialisable', (() => { try { JSON.stringify(rep.methodology); return true; } catch { return false; } })());
    const agg = E.collectPredictions([rep]);
    t('collectPredictions groups by methodology', typeof agg.byMethod === 'object' && Array.isArray(agg.headline));
  } catch (e) {
    t('engine integration ran', false, e.stack);
  } finally {
    A.buildContext = original;
  }

  console.log('\n=========================================================');
  console.log(` ${pass} passed, ${fail} failed`);
  console.log('=========================================================');
  process.exit(fail ? 1 : 0);
})();
