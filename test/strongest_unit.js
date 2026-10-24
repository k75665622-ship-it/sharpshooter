'use strict';

/**
 * test/strongest_unit.js — the Strongest Picks section: maths, pick rules, reasons, settlement.
 *
 *   node test/strongest_unit.js
 *
 * Offline. The archive checks run on the real Premier League football-data.co.uk files in
 * test/fixtures (corners, cards and half-time scores as the live crawler receives them).
 */

const fs = require('fs');
const path = require('path');
const MAR = require('../lib/strongest/markets');
const PK = require('../lib/strongest/picks');
const IN = require('../lib/strongest/inputs');
const RS = require('../lib/strongest/reasons');
const REC = require('../lib/strongest/record');
const C = require('../lib/strongest/config');
const FDS = require('../lib/crawler/sources/footballdata');
const { History } = require('../lib/factors/history');

let pass = 0;
let fail = 0;
function t(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail != null ? ' — ' + detail : ''}`);
  }
}
const near = (a, b, tol = 1e-3) => a != null && b != null && Math.abs(a - b) <= tol;
const byKey = (sels) => Object.fromEntries(sels.map((s) => [s.key, s]));

// ------------------------------------------------------------------ 1. distributions
console.log('\n1. Distributions');
{
  const p = MAR.nbPmf(5.4, 8);
  const sum = p.reduce((a, b) => a + b, 0);
  const mean = p.reduce((a, b, k) => a + k * b, 0);
  const vr = p.reduce((a, b, k) => a + (k - mean) * (k - mean) * b, 0);
  t('negative binomial sums to one', near(sum, 1, 1e-6), sum);
  t('negative binomial keeps its mean', near(mean, 5.4, 1e-3), mean);
  t('negative binomial variance = mu + mu^2/r', near(vr, 5.4 + (5.4 * 5.4) / 8, 2e-2), vr);
  const tot = MAR.convolve(MAR.nbPmf(6, 8), MAR.nbPmf(4, 8));
  t('convolution keeps the total mean', near(tot.reduce((a, b, k) => a + k * b, 0), 10, 1e-3));
  t('over + under = 1', near(MAR.over(tot, 9.5) + (1 - MAR.over(tot, 9.5)), 1));
  const g = MAR.greater(MAR.nbPmf(6, 8), MAR.nbPmf(4, 8));
  const l = MAR.greater(MAR.nbPmf(4, 8), MAR.nbPmf(6, 8));
  t('P(A>B) + P(B>A) < 1 (ties exist)', g + l < 1 && g > l, `${g.toFixed(3)} ${l.toFixed(3)}`);
}

// ------------------------------------------------------------------ 2. goal maths (pure Poisson, rho = 0)
console.log('\n2. Goal markets, checked against closed forms (independent Poisson)');
const timing = MAR.defaultTiming(0.44);
const fxBase = {
  names: { home: 'Lazio', away: 'Parma' },
  goalViews: [{ name: 'market', lamH: 1.83, lamA: 0.63, rho: 0 }],
  timing,
};
{
  const S = byKey(MAR.price(fxBase));
  const la = 0.63;
  const T = 1.83 + 0.63;
  t('Parma under 1.5 = e^-0.63 (1 + 0.63)', near(S['TTA_U1.5'].prob, Math.exp(-la) * (1 + la)), S['TTA_U1.5'].prob);
  t('Lazio clean sheet = e^-0.63', near(S['TTA_U0.5'].prob, Math.exp(-la)), S['TTA_U0.5'].prob);
  t('2nd half over 0.5 = 1 - e^(-T x 0.56)', near(S['H2_O0.5'].prob, 1 - Math.exp(-T * 0.56)), S['H2_O0.5'].prob);
  t('1st half over 0.5 = 1 - e^(-T x 0.44)', near(S['H1_O0.5'].prob, 1 - Math.exp(-T * 0.44)), S['H1_O0.5'].prob);
  t('no goal in 1-15 = e^(-T x s15)', near(S.M15_N.prob, Math.exp(-T * timing.s15)), S.M15_N.prob);
  t('s15 and s30 are 13% and 28% of goals at a 45% first-half share', near(MAR.defaultTiming(0.45).s15, 0.13, 2e-3) && near(MAR.defaultTiming(0.45).s30, 0.28, 2e-3));
  t('complements sum to one (O2.5/U2.5, BTTS)', near(S['O2.5'].prob + S['U2.5'].prob, 1) && near(S.BTTS_Y.prob + S.BTTS_N.prob, 1));
  t('1X2 sums to one', near(S['1'].prob + S.X.prob + S['2'].prob, 1));
  t('half-time 1X2 sums to one', near(S.HT_1.prob + S.HT_X.prob + S.HT_2.prob, 1));
  t('win and over 1.5 never exceeds win', S.WO15_H.prob <= S['1'].prob + 1e-12);
  t('HT/FT home/home is below both HT home and home win', S.HTFT_HH.prob <= S.HT_1.prob && S.HTFT_HH.prob <= S['1'].prob);
  t('win either half is at least win both halves', S.WEH_H.prob >= S.WBH_H.prob);
  t('either-half win is above the full-time win for a strong favourite', S.WEH_H.prob > S['1'].prob);
  t('nine groups are priced (players and corners need data)', ['Goals', 'Half', 'Minutes', 'Team', 'Match', 'Special'].every((g) => MAR.price(fxBase).some((s) => s.group === g)));
}
{
  // calibration: a calibrated parent caps its joint children
  const fx = { ...fxBase, goalViews: [{ name: 'market', lamH: 1.83, lamA: 0.63, rho: 0, cal: { '1': 0.6 } }] };
  const S = byKey(MAR.price(fx));
  t('calibrated 1 is used as given', near(S['1'].prob, 0.6));
  t('joint selections are scaled by the parent calibration', S.WO15_H.prob <= 0.6 && S.WTN_H.prob <= 0.6 && S.HTFT_HH.prob <= 0.6);
}
{
  // views: the lowest view is the floor, the market view is the main probability
  const fx = { ...fxBase, goalViews: [
    { name: 'market', lamH: 1.83, lamA: 0.63, rho: 0 },
    { name: 'stats', lamH: 1.6, lamA: 0.9, rho: 0 },
    { name: 'factors', lamH: 1.9, lamA: 0.6, rho: 0 },
  ] };
  const S = byKey(MAR.price(fx));
  const s = S['TTA_U1.5'];
  t('three views priced', s.nViews === 3);
  t('main probability is the market view', near(s.prob, s.views.market));
  t('floor is the lowest view (the stats model here)', near(s.floor, Math.min(...Object.values(s.views))) && near(s.floor, s.views.stats));
}

// ------------------------------------------------------------------ 3. corners and cards
console.log('\n3. Corners and bookings');
{
  const fx = { ...fxBase, cornerViews: [{ name: 'season', home: 6.4, away: 3.6, r: 8 }, { name: 'recent', home: 6.0, away: 4.0, r: 8 }], cardViews: [{ name: 'season', mu: 3.4, r: 6 }, { name: 'recent', mu: 3.8, r: 6 }] };
  const S = byKey(MAR.price(fx));
  t('corner lines priced with two views', S['C_O9.5'] && S['C_O9.5'].nViews === 2);
  t('corner over + under = 1 in each view', near(S['C_O9.5'].views.season + S['C_U9.5'].views.season, 1));
  t('home most corners favoured when home wins more', S.C_MOST_H.prob > S.C_MOST_A.prob);
  t('card lines priced', S['K_U4.5'] && S['K_O3.5'] && near(S['K_O3.5'].views.season + S['K_U3.5'].views.season, 1));
  t('cards: a higher mean makes over 3.5 likelier', S['K_O3.5'].views.recent > S['K_O3.5'].views.season);
  t('corners are a statistics-only kind', PK.isStatsOnly(S['C_O9.5']) && PK.isStatsOnly(S['K_U4.5']));
}

// ------------------------------------------------------------------ 4. archive baselines on the real Premier League files
console.log('\n4. Archive baselines (real football-data Premier League files)');
const recs = [];
for (const f of ['fd-E0-2324.csv', 'fd-E0-2425.csv', 'fd-E0-2526.csv', 'fd-E0-2627.csv']) {
  recs.push(...FDS.toRecords(fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8'), 'E0'));
}
const hist = new History().addAll(recs);
const day = '2026-09-15';
const env = IN.leagueEnv(hist, 'E0', day);
t('league baseline built from a year of matches', env.n >= 300, env.n);
t('corners per match look like the Premier League (9-12)', env.corners && env.corners.total > 9 && env.corners.total < 12, env.corners && env.corners.total);
t('home sides win more corners than away sides', env.corners.home > env.corners.away);
t('cards per match are plausible (2.5-5.5)', env.cards && env.cards.total > 2.5 && env.cards.total < 5.5, env.cards && env.cards.total);
t('first-half goal share measured (0.38-0.50)', env.firstHalf.measured > 0.38 && env.firstHalf.measured < 0.5, env.firstHalf.measured);
t('dispersions are estimated inside the allowed range', env.corners.dispersion >= C.dispersionRange[0] && env.corners.dispersion <= C.dispersionRange[1] && env.cards.dispersion >= C.dispersionRange[0]);
const arsenal = hist.teamLog('E0', 'Arsenal', day, 40);
const facts = IN.teamFacts(arsenal, 'H');
t('team facts: last 10 results and corners', facts.last10.n === 10 && facts.cornersFor > 0 && facts.cards != null, JSON.stringify(facts.last10));
const cr = IN.cornerRates(arsenal, 'H', env.corners, 20, 0.5);
t('Arsenal win more corners than the average side (attack rating > 1)', cr.att > 1, cr.att);
const ref = IN.refereeFactor({ ...env, referees: new Map([['A Ref', { n: 20, cards: 20 * env.cards.total * 1.4 }]]) }, 'A Ref');
t('referee factor is shrunk and capped', ref.used && ref.factor <= C.refereeRange[1] && ref.factor > 1, ref.factor);
const h2h = IN.h2hFacts(hist.h2h('E0', 'Arsenal', 'Chelsea', day, 6, 10), 'Arsenal', env);
t('head-to-head facts include corners and cards', h2h && h2h.n >= 2 && h2h.corners && h2h.cards, h2h && h2h.n);

// ------------------------------------------------------------------ 5. ESPN parsing
console.log('\n5. ESPN players and line-ups');
{
  const scoreboardLeaders = [
    { name: 'goals', displayName: 'Goals', leaders: [{ displayValue: '2', value: 2, athlete: { id: '308524', displayName: 'Nicolas Jackson', fullName: 'Nicolas Jackson' } }] },
    { name: 'goalsLeaders', displayName: 'Goals', leaders: [{ displayValue: '2', value: 2, athlete: { id: '308524', displayName: 'Nicolas Jackson' } }] },
  ];
  const sc = IN.espnScorers(scoreboardLeaders, '362');
  t('scoreboard competitor leaders -> top scorer', sc.length === 1 && sc[0].name === 'Nicolas Jackson' && sc[0].goals === 2, JSON.stringify(sc));
  const summaryLeaders = [
    { team: { id: '362' }, leaders: [{ name: 'goalsLeaders', displayName: 'Goals', leaders: [{ value: 5, athlete: { displayName: 'Ollie Watkins' } }, { value: 3, athlete: { displayName: 'John McGinn' } }] }, { name: 'assistsLeaders', leaders: [] }] },
    { team: { id: '382' }, leaders: [{ name: 'goalsLeaders', leaders: [{ value: 8, athlete: { displayName: 'Erling Haaland' } }] }] },
  ];
  const s2 = IN.espnScorers(summaryLeaders, '382');
  t('summary leaders -> the right team', s2.length === 1 && s2[0].name === 'Erling Haaland');
  const lu = IN.espnLineups({ rosters: [{ team: { id: '382' }, roster: [...Array.from({ length: 10 }, (_, i) => ({ starter: true, athlete: { displayName: `Player ${i}` } })), { starter: true, athlete: { displayName: 'Erling Haaland' } }, { starter: false, athlete: { displayName: 'Phil Foden' } }] }] });
  t('line-ups parsed once 11 starters are listed', lu['382'] && lu['382'].starters.length === 11);
  t('line-up status: starter / bench / out', IN.lineupStatus(lu['382'], ['Erling Haaland']) === 'start' && IN.lineupStatus(lu['382'], ['Foden']) === 'bench' && IN.lineupStatus(lu['382'], ['Rodri']) === 'out');
  t('no line-up yet -> unknown', IN.lineupStatus(null, ['x']) === null);
}

// ------------------------------------------------------------------ 6. pick rules
console.log('\n6. Pick rules');
const ctxOk = { hasMarket: true, started: false, avoid: new Set(), ruleTraps: new Set(), shift: {}, news: { home: { highs: 0 }, away: { highs: 0 } }, statsGames: { home: 20, away: 20 } };
const mk = (key, group, views, kind = 'goals', extra = {}) => {
  const vals = Object.values(views);
  return { key, group, label: key, kind, side: MAR.sideOf(key), prob: views.market != null ? views.market : vals[0], floor: Math.min(...vals), views, nViews: vals.length, ...extra };
};
{
  const s = mk('TTA_U1.5', 'Team', { market: 0.86, stats: 0.8, factors: 0.85 });
  t('a selection every view rates 80%+ qualifies', PK.blockers(s, ctxOk).length === 0, PK.blockers(s, ctxOk).join(' '));
  t('one weak view blocks it', PK.blockers(mk('1', 'Match', { market: 0.86, stats: 0.7, factors: 0.85 }), ctxOk).some((w) => /lowest view/.test(w)));
  t('too short a price blocks it', PK.blockers(mk('O1.5', 'Goals', { market: 0.92, stats: 0.9 }), ctxOk).some((w) => /Pays too little/.test(w)));
  t('a single view is not enough', PK.blockers(mk('1', 'Match', { market: 0.8 }), ctxOk).some((w) => /Only one view/.test(w)));
  t('no bookmaker price -> goal picks blocked', PK.blockers(s, { ...ctxOk, hasMarket: false }).some((w) => /No bookmaker/.test(w)));
  t('a v6 trap blocks it', PK.blockers(s, { ...ctxOk, avoid: new Set(['TTA_U1.5']) }).some((w) => /trap/.test(w)));
  t('factors rating it below the price blocks it', PK.blockers(s, { ...ctxOk, shift: { 'TTA_U1.5': -0.02 } }).some((w) => /below the price/.test(w)));
  t('kicked off blocks it', PK.blockers(s, { ...ctxOk, started: true }).some((w) => /kicked off/.test(w)));
  t('serious news on the backed side blocks it', PK.blockers(mk('1', 'Match', { market: 0.8, stats: 0.8 }), { ...ctxOk, news: { home: { highs: 2 }, away: { highs: 0 } } }).some((w) => /team-news/.test(w)));
  t('serious news on the other side does not', PK.blockers(mk('1', 'Match', { market: 0.8, stats: 0.8 }), { ...ctxOk, news: { home: { highs: 0 }, away: { highs: 2 } } }).length === 0);
  const c = mk('C_U11.5', 'Corners', { season: 0.78, recent: 0.79 }, 'corners');
  t('corners need 80% from both views', PK.blockers(c, ctxOk).some((w) => /80%/.test(w)));
  t('corners qualify at 80%+ with enough games', PK.blockers(mk('C_U11.5', 'Corners', { season: 0.82, recent: 0.81 }, 'corners'), ctxOk).length === 0);
  t('corners blocked with too few archived games', PK.blockers(mk('C_U11.5', 'Corners', { season: 0.82, recent: 0.81 }, 'corners'), { ...ctxOk, statsGames: { home: 3, away: 20 } }).some((w) => /archived games/.test(w)));
  t('players never qualify', PK.blockers(mk('PL_H_0', 'Players', { market: 0.8, stats: 0.8 }, 'players'), ctxOk).some((w) => /line-up/.test(w)));
}
{
  // no fixed number of picks
  const fixtures = Array.from({ length: 9 }, (_, i) => ({
    id: String(i), kickoff: `2026-10-24T1${i}:00:00Z`, ctx: ctxOk,
    sels: [mk('TTA_U1.5', 'Team', { market: 0.8 + i * 0.008, stats: 0.79, factors: 0.81 }), mk('O2.5', 'Goals', { market: 0.6, stats: 0.6 })],
  }));
  const r = PK.select(fixtures);
  t('nine qualifying matches -> nine picks (no cap at five)', r.picks.length === 9, r.picks.length);
  t('one pick per match', new Set(r.picks.map((p) => p.fixture)).size === r.picks.length);
  t('ordered by the lowest view', r.picks.every((p, i, a) => i === 0 || a[i - 1].sel.floor >= p.sel.floor));
  t('combined chances for 2, 3, 5 and all', r.combined.map((c) => c.size).join(',') === '2,3,5,9', r.combined.map((c) => c.size).join(','));
  t('combined chance is the product', near(r.combined[0].prob, r.picks[0].sel.prob * r.picks[1].sel.prob));
  const none = PK.select([{ id: 'a', kickoff: 'x', ctx: ctxOk, sels: [mk('1', 'Match', { market: 0.74, stats: 0.71 })] }]);
  t('nothing qualifies -> no picks, and the near miss is reported', none.picks.length === 0 && none.nearMisses.length === 1);
  t('two qualifying -> two picks', PK.select(fixtures.slice(0, 2)).picks.length === 2);
  const mixed = PK.select([{ id: 'm', kickoff: 'x', ctx: ctxOk, sels: [
    mk('K_U5.5', 'Bookings', { season: 0.82, recent: 0.81 }, 'cards'),
    mk('TTA_U1.5', 'Team', { market: 0.82, stats: 0.79, factors: 0.8 }),
  ] }]);
  t('a bookmaker-backed pick ranks ahead of a slightly stronger cards pick', mixed.picks[0].sel.key === 'TTA_U1.5', mixed.picks[0] && mixed.picks[0].sel.key);
  const cardsOnly = PK.select([{ id: 'c', kickoff: 'x', ctx: ctxOk, sels: [mk('K_U5.5', 'Bookings', { season: 0.84, recent: 0.83 }, 'cards')] }]);
  t('a cards pick still qualifies when it is the match\'s only one', cardsOnly.picks.length === 1 && cardsOnly.picks[0].sel.tier === 'Strong');
  t('tiers by the lowest view', PK.tierOf(0.86) === 'Elite' && PK.tierOf(0.8) === 'Strong' && PK.tierOf(0.76) === 'Solid' && PK.tierOf(0.7) === null);
}
{
  const cards = PK.cardPicks(MAR.price({ ...fxBase, goalViews: [{ name: 'market', lamH: 1.83, lamA: 0.63, rho: 0 }, { name: 'stats', lamH: 1.7, lamA: 0.7, rho: 0 }] }));
  t('match card has all nine groups in SportyBet order', cards.map((c) => c.group).join(',') === MAR.GROUPS.join(','));
  t('groups without data say why', cards.find((c) => c.group === 'Corners').none && /statistics/.test(cards.find((c) => c.group === 'Corners').note));
  t('card picks stay inside the probability band', cards.filter((c) => !c.none).every((c) => c.prob >= C.cardMinProb && c.prob <= C.maxProb));
}

// ------------------------------------------------------------------ 7. reasons
console.log('\n7. Reasons');
{
  const fx = {
    ...fxBase,
    goalViews: [{ name: 'market', lamH: 1.83, lamA: 0.63, rho: 0 }, { name: 'stats', lamH: 1.7, lamA: 0.7, rho: 0 }],
    cornerViews: [{ name: 'season', home: 6.2, away: 3.7, r: 8 }, { name: 'recent', home: 6, away: 4, r: 8 }],
    cardViews: [{ name: 'season', mu: 3.6, r: 6 }, { name: 'recent', mu: 3.4, r: 6 }],
    ctx: { ...ctxOk },
    facts: { home: IN.teamFacts(arsenal, 'H'), away: IN.teamFacts(hist.teamLog('E0', 'Burnley', day, 40), 'A'), league: { name: 'Premier League', goalsPerGame: 2.9, firstHalf: { measured: 0.45, matches: 380, used: 0.448 }, corners: env.corners, cards: env.cards }, h2h, traps: [] },
  };
  const report = { consensus: { x12: { fair: { home: 0.66, draw: 0.21, away: 0.13 }, books: 4 } }, model: { oneXtwo: { pHome: 0.66, pDraw: 0.21, pAway: 0.13 } } };
  const sels = MAR.price(fx);
  let bad = 0;
  for (const s of sels) {
    const e = RS.explain(s, fx, report);
    if (!e.reasons.length || e.reasons.some((r) => /undefined|NaN|null/.test(r))) bad++;
  }
  t('every selection gets reasons, none with undefined / NaN', bad === 0, bad);
  const e = RS.explain(byKey(sels)['TTA_U1.5'], fx, report);
  t('team-under reasons use the archive and the price', e.reasons.some((r) => /Bookmakers/.test(r)) && e.reasons.some((r) => /scored 2\+ in \d+ of their last/.test(r)), e.reasons.join(' | '));
  t('checks line lists every view', /Market/.test(e.checks) && /Stats model/.test(e.checks));
  const ec = RS.explain(byKey(sels)['C_U11.5'], fx, report);
  t('corner reasons quote corners per game and the expectation', ec.reasons.some((r) => /Corners per game/.test(r)) && ec.reasons.some((r) => /Expected corners/.test(r)), ec.reasons.join(' | '));
  t('statistics-only caveat on corners', ec.caveats.some((c) => /Statistics-only/.test(c)));
  const sparse = RS.explain(byKey(sels)['1'], { ...fx, facts: {} }, {});
  t('missing data leaves sentences out instead of failing', Array.isArray(sparse.reasons));
}

// ------------------------------------------------------------------ 8. settlement
console.log('\n8. Settlement');
{
  const o = { hg: 2, ag: 0, hthg: 1, htag: 0, goals: [{ minute: 12, side: 'home', scorer: 'Erling Haaland' }, { minute: 70, side: 'home', scorer: 'Phil Foden' }], corners: { home: 7, away: 3 }, cards: { home: 1, away: 2 } };
  const S = (k, p) => REC.settleKey(k, o, p);
  t('team under / clean sheet', S('TTA_U1.5') === 1 && S('TTA_U0.5') === 1 && S('TTH_U1.5') === 0);
  t('match and goals', S('1') === 1 && S('X2') === 0 && S('U2.5') === 1 && S('O1.5') === 1 && S('BTTS_N') === 1);
  t('halves', S('H1_O0.5') === 1 && S('H2_O0.5') === 1 && S('HT_1') === 1 && S('HSH_2') === 0 && S('WBH_H') === 1 && S('WEH_A') === 0 && S('HTFT_HH') === 1);
  t('minutes from goal times', S('M15_Y') === 1 && S('M30_N') === 0);
  t('specials', S('WTN_H') === 1 && S('WO15_H') === 1 && S('GG_O2.5') === 0 && S('DC1X_U3.5') === 1);
  t('corners', S('C_O9.5') === 1 && S('C_U9.5') === 0 && S('C_MOST_H') === 1 && S('CH_O5.5') === 1 && S('CA_O3.5') === 0);
  t('cards', S('K_U3.5') === 1 && S('K_O2.5') === 1);
  t('anytime scorer by full name or surname', S('PL_H_0', { name: 'Haaland', fullName: 'Erling Haaland' }) === 1 && S('PL_H_1', { name: 'Doku' }) === 0);
  const noHt = { hg: 1, ag: 1 };
  t('missing half-time -> waits instead of guessing', REC.settleKey('HT_X', noHt) === undefined && REC.settleKey('C_O9.5', noHt) === undefined && REC.settleKey('M15_Y', noHt) === undefined);
  t('0-0 settles minutes and scorers without goal times', REC.settleKey('M30_N', { hg: 0, ag: 0 }) === 1 && REC.settleKey('PL_A_0', { hg: 0, ag: 0 }, { name: 'x' }) === 0);
  t('unknown match -> undefined', REC.settleKey('1', null) === undefined);
  t('ESPN clock "45\'+2\'" is minute 45', REC.minuteOf({ displayValue: "45'+2'" }) === 45 && REC.minuteOf({ displayValue: "90'+5'" }) === 90 && REC.minuteOf({ value: 1234 }) === 21);
  const comp = {
    competitors: [{ id: '1', homeAway: 'home' }, { id: '2', homeAway: 'away' }],
    details: [
      { type: { text: 'Goal' }, scoringPlay: true, clock: { displayValue: "12'" }, team: { id: '1' }, athletesInvolved: [{ displayName: 'A Striker' }] },
      { type: { text: 'Yellow Card' }, yellowCard: true, clock: { displayValue: "30'" }, team: { id: '2' } },
      { type: { text: 'Own Goal' }, scoringPlay: true, ownGoal: true, clock: { displayValue: "50'" }, team: { id: '2' }, athletesInvolved: [{ displayName: 'A Defender' }] },
    ],
  };
  const ev = REC.espnEvents(comp);
  t('ESPN details -> goals with minutes, own goals without a scorer, cards per side', ev.goals.length === 2 && ev.goals[0].minute === 12 && ev.goals[1].ownGoal && ev.goals[1].scorer === null && ev.cards.away === 1);
  t('no details -> null (settled later from the archive)', REC.espnEvents({ competitors: [], details: [] }) === null);
}

console.log('\n=========================================================');
console.log(` ${pass} passed, ${fail} failed`);
console.log('=========================================================');
process.exit(fail ? 1 : 0);
