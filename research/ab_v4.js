'use strict';
/**
 * research/ab_v4.js — run the ORIGINAL v4 methodology code on the same fixtures as
 * backtest_methods.js, for an apples-to-apples v4 vs v5 comparison.
 *   node research/ab_v4.js <v4-lib-dir> <Matches.csv> <states.json> <out.json>
 * v4 inputs as v4 production had them historically: results-only λ (no xG — absent
 * historically for both versions), raw Dixon-Coles markets, Bet365 1X2 / O/U as book prices.
 */
const fs = require('fs');
const path = require('path');
const [, , v4dir, csvFile, statesFile, outFile] = process.argv;
const M = require(path.resolve(v4dir, 'model'));
const MI = require(path.resolve(v4dir, 'methodology'));
const states = JSON.parse(fs.readFileSync(statesFile, 'utf8'));
const byKey = new Map(states.map((r) => [`${r.div}|${r.date}|${r.home}|${r.away}`, r]));
const lines = fs.readFileSync(csvFile, 'utf8').split('\n');
const head = lines[0].split(',');
const ix = (n) => head.indexOf(n);
const I = { div: ix('Division'), date: ix('MatchDate'), h: ix('HomeTeam'), a: ix('AwayTeam'), hg: ix('FTHome'), ag: ix('FTAway') };
const divs = new Set(states.map((r) => r.div));
const byDiv = {};
for (let k = 1; k < lines.length; k++) {
  const c = lines[k].split(',');
  if (!divs.has(c[I.div]) || c[I.date] < '2015-07-01' || c[I.hg] === '') continue;
  (byDiv[c[I.div]] = byDiv[c[I.div]] || []).push({ date: c[I.date], home: c[I.h], away: c[I.a], hg: Number(c[I.hg]), ag: Number(c[I.ag]) });
}
const BM = require('./backtest_methods_lib');
const rows = [];
for (const div of Object.keys(byDiv)) {
  const ms = byDiv[div].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (let i = 0; i < ms.length; i++) {
    const fx = ms[i];
    const st = byKey.get(`${div}|${fx.date}|${fx.home}|${fx.away}`);
    if (!st || !st.c.v4 || !st.odds.o1) continue;
    let j = i;
    while (j > 0 && ms[j - 1].date >= fx.date) j--;
    const prior = ms.slice(Math.max(0, j - 2500), j);
    const { lh, la } = st.c.v4;
    const rho = M.clamp(-0.05 * (2.6 / Math.max(1.8, lh + la)), -0.1, -0.02);
    const sm = M.scoreMatrix(lh, la, rho);
    const o = st.odds;
    const quote = { '1': o.o1, X: o.oX, '2': o.o2, 'O2.5': o.oO, 'U2.5': o.oU };
    const markets = M.deriveMarkets(sm).map((m) => (quote[m.key] > 1 ? { ...m, price: quote[m.key], priceSource: 'book' } : { ...m, price: m.fairOdds, priceSource: 'synthetic' }));
    const rk = BM.ranks(prior, fx.date);
    const out = MI.evaluateFixture({
      match: { date: `${fx.date}T15:00:00Z`, home: { name: fx.home }, away: { name: fx.away }, odds: { homeClose: o.o1, drawClose: o.oX, awayClose: o.o2 } },
      sm, model: { lambda: { home: lh, away: la } }, markets,
      ctx: { standings: { home: rk[fx.home] ? { rank: rk[fx.home] } : null, away: rk[fx.away] ? { rank: rk[fx.away] } : null }, form: {}, homeRow: null, awayRow: null },
      newsRisk: null,
      hist: { source: 'openfootball', leagueRates: BM.leagueRates(prior), home: { name: fx.home, games: BM.teamGames(prior, fx.home, 12) }, away: { name: fx.away, games: BM.teamGames(prior, fx.away, 12) }, h2h: BM.h2h(prior, fx.home, fx.away, 8) },
      elo: null,
    });
    for (const r of out.results) {
      if (!r.pick.key) continue;
      const hit = BM.settle(r.pick.key, fx.hg, fx.ag);
      const [b365, max] = BM.pricesFor(r.pick.key, o);
      rows.push({ div, season: st.season, id: r.id, key: r.pick.key, status: r.status, kept: out.predictions.includes(r), headline: out.headline === r, prob: r.prob, hit, b365, max });
    }
  }
}
fs.writeFileSync(outFile, JSON.stringify({ rows, gen: [] }));
console.error('v4 rows', rows.length);
