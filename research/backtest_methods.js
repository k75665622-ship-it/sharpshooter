'use strict';

/**
 * research/backtest_methods.js — the PRODUCTION v5 methodology code, walk-forward,
 * on real results with real Bet365 and best-of-17-books prices.
 *
 *   node research/backtest_methods.js <Matches.csv> <states.json> [out.json]
 *
 * For each test fixture, using only information dated before kick-off:
 *   ensemble   lib/ensemble.js on {market (Bet365 implied), ratings, shots rating as the
 *              xG stand-in, Elo}
 *   prices     lib/sources/odds.js consensus from Bet365, best price = max of ~17 books
 *   evidence   per-game history (last 12), head-to-head, league rates, table ranks
 *   verdicts   lib/methodology (all 13 specs, contradiction resolver, headline)
 *   general    lib/general.js best bet and predicted score
 * and settles every verdict on the real final score.
 *
 * Not available historically (so those gates are waived or fail closed): team news,
 * FPL availability, rest days, ESPN xG. The test is therefore of the results +
 * price + rating half of each methodology — the half that can be tested.
 */

const fs = require('fs');
const MI = require('../lib/methodology');
const ENS = require('../lib/ensemble');
const ODDS = require('../lib/sources/odds');
const PR = require('../lib/pricing');
const GEN = require('../lib/general');
const ELO = require('../lib/elo');

const [, , csvFile, statesFile, outFile] = process.argv;
const states = JSON.parse(fs.readFileSync(statesFile, 'utf8'));
const byKey = new Map(states.map((r) => [`${r.div}|${r.date}|${r.home}|${r.away}`, r]));

// ------------------------------------------------------------------ results by division
const lines = fs.readFileSync(csvFile, 'utf8').split('\n');
const head = lines[0].split(',');
const ix = (n) => head.indexOf(n);
const I = { div: ix('Division'), date: ix('MatchDate'), h: ix('HomeTeam'), a: ix('AwayTeam'), hg: ix('FTHome'), ag: ix('FTAway'), eh: ix('HomeElo'), ea: ix('AwayElo') };
const divs = new Set(states.map((r) => r.div));
const byDiv = {};
for (let k = 1; k < lines.length; k++) {
  const c = lines[k].split(',');
  if (!divs.has(c[I.div]) || c[I.date] < '2015-07-01' || c[I.hg] === '') continue;
  (byDiv[c[I.div]] = byDiv[c[I.div]] || []).push({ date: c[I.date], home: c[I.h], away: c[I.a], hg: Number(c[I.hg]), ag: Number(c[I.ag]), eh: Number(c[I.eh]), ea: Number(c[I.ea]) });
}

const { settle, pricesFor, teamGames, h2h, leagueRates, ranks } = require('./backtest_methods_lib');

// ------------------------------------------------------------------ run
const rows = [];
const gen = [];
const t0 = Date.now();
let done = 0;
for (const div of Object.keys(byDiv)) {
  const ms = byDiv[div].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (let i = 0; i < ms.length; i++) {
    const fx = ms[i];
    const st = byKey.get(`${div}|${fx.date}|${fx.home}|${fx.away}`);
    if (!st || !st.c.mkt || !st.c['dc_0.0025_6'] || !st.odds.o1) continue;
    let j = i;
    while (j > 0 && ms[j - 1].date >= fx.date) j--;
    const prior = ms.slice(Math.max(0, j - 2500), j);

    const ens = ENS.combine({
      market: { lamH: st.c.mkt.lh, lamA: st.c.mkt.la, books: 1 },
      ratings: { lamH: st.c['dc_0.0025_6'].lh, lamA: st.c['dc_0.0025_6'].la, confidence: st.c['dc_0.0025_6'].conf },
      xg: st.c.sot ? { lamH: st.c.sot.lh, lamA: st.c.sot.la } : null,
      eloDiff: st.elo,
    });
    const markets = ENS.deriveMarkets(ens);
    const o = st.odds;
    const quotes = [{ book: 'Bet365', h: o.o1, d: o.oX, a: o.o2, ...(o.oO && o.oU ? { line: 2.5, over: o.oO, under: o.oU } : {}) }];
    if (o.m1 && o.mX && o.m2) quotes.push({ book: 'Best price', aggregate: 'max', h: o.m1, d: o.mX, a: o.m2, ...(o.mO && o.mU ? { line: 2.5, over: o.mO, under: o.mU } : {}) });
    const consensus = ODDS.buildConsensus(quotes, null);
    PR.attach(markets, consensus);
    const rk = ranks(prior, fx.date);
    const elo = Number.isFinite(fx.eh) && Number.isFinite(fx.ea) ? ELO.summarise({ club: fx.home, elo: fx.eh }, { club: fx.away, elo: fx.ea }) : null;

    const out = MI.evaluateFixture({
      match: { date: `${fx.date}T15:00:00Z`, home: { name: fx.home }, away: { name: fx.away }, odds: null },
      sm: ens.sm,
      model: { lambda: { home: ens.lamH, away: ens.lamA } },
      markets,
      ctx: { standings: { home: rk[fx.home] ? { rank: rk[fx.home] } : null, away: rk[fx.away] ? { rank: rk[fx.away] } : null }, form: {}, homeRow: null, awayRow: null },
      newsRisk: null,
      hist: { source: 'results', leagueRates: leagueRates(prior), home: { name: fx.home, games: teamGames(prior, fx.home, 12) }, away: { name: fx.away, games: teamGames(prior, fx.away, 12) }, h2h: h2h(prior, fx.home, fx.away, 8) },
      elo,
      ens,
      fpl: null,
      consensus,
    });
    const season = st.season;
    for (const r of out.results) {
      if (!r.pick.key) continue;
      const hit = settle(r.pick.key, fx.hg, fx.ag);
      if (hit == null && !/^DNB|^AH/.test(r.pick.key)) continue;
      const [b365, max] = pricesFor(r.pick.key, o);
      rows.push({
        div, season, date: fx.date, home: fx.home, away: fx.away, id: r.id, key: r.pick.key, status: r.status, kept: out.predictions.includes(r), headline: out.headline === r,
        prob: r.prob, model: r.modelProb, hit, b365, max, priceState: r.price && r.price.state,
        score: r.score, tier: r.tier, ratio: r.checklist ? +r.checklist.ratio.toFixed(3) : null, failed: r.failedGates && r.failedGates.length ? r.failedGates : undefined,
        ...(process.env.DIAG && (process.env.DIAG === 'all' || process.env.DIAG.split(',').includes(r.id)) ? {
          gates: Object.fromEntries(r.gates.map((g) => [g.id, g.unknown ? null : g.pass ? 1 : 0])),
          items: Object.fromEntries(r.checklist.items.map((c) => [c.id, c.unknown ? null : +c.score.toFixed(2)])),
        } : {}),
      });
    }
    const g = GEN.predict({ match: { home: { name: fx.home }, away: { name: fx.away } }, ens, markets, methodology: { headline: out.headline ? { ...out.headline, pick: out.headline.pick } : null } });
    const gb = g.bestBet;
    const [gb365, gmax] = gb ? pricesFor(gb.key, o) : [null, null];
    gen.push({
      div, season, src: g.source, key: gb && gb.key, prob: gb && gb.prob, hit: gb ? settle(gb.key, fx.hg, fx.ag) : null, b365: gb365, max: gmax,
      res: g.result.call, resHit: (g.result.call === 'H' && fx.hg > fx.ag) || (g.result.call === 'A' && fx.hg < fx.ag) || (g.result.call === 'D' && fx.hg === fx.ag) ? 1 : 0, resProb: g.result.prob,
      score: g.score.predicted.score, scoreHit: g.score.predicted.score === `${fx.hg}-${fx.ag}` ? 1 : 0, scoreProb: g.score.predicted.prob,
      mode: g.score.mostLikely.score, modeHit: g.score.mostLikely.score === `${fx.hg}-${fx.ag}` ? 1 : 0,
      conf: g.confidence.level,
    });
    done++;
    if (done % 5000 === 0) console.error(`${done} fixtures, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
}
console.error(`done: ${done} fixtures in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
fs.writeFileSync(outFile || statesFile.replace(/\.json$/, '.methods.json'), JSON.stringify({ rows, gen }));
