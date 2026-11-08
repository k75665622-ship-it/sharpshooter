'use strict';

/**
 * research/v6/slips_study.js — the Strongest Picks rule, pick by pick and slip by slip, on history.
 *
 *   SHARPSHOOTER_CALIBRATION=<tune-only engine calibration> \
 *   node --max-old-space-size=6000 research/v6/slips_study.js <Matches.csv> <out.jsonl> [from=2019-07-01]
 *
 * Walk-forward over every priced match from `from`, built the way research/v6/betbuilder_study.js
 * builds it (the bookmaker-anchored score model, the possession view, the form + price corner and
 * card models; every selection priced with its measured chance, lib/strongest/calibrate.js). The
 * archive cannot rebuild the v6 factor view or the stats view, so the two-view rule is relaxed to
 * one and the v6 trap checks are off: this is the price-anchored half of the rule.
 *
 * Output (JSONL, one priced match per line):
 *   { d, div, fav, sels: [[key, group, prob, floor, marketProb, result]] }
 * where sels are every selection with a measured chance of 70%+ that passes the Strongest Picks
 * blockers other than the chance bar (so any bar from 70% up can be replayed), and result is 1 / 0 /
 * null (void) settled on the real full-time score, half-time score, corners and cards.
 */

const fs = require('fs');
const RC = require('../../lib/factors/records');
const { History } = require('../../lib/factors/history');
const MK = require('../../lib/market');
const ENS = require('../../lib/ensemble');
const MAR = require('../../lib/strongest/markets');
const IN = require('../../lib/strongest/inputs');
const C = require('../../lib/strongest/config');
const PK = require('../../lib/strongest/picks');
const REC = require('../../lib/strongest/record');

const [, , matchesFile, outFile, fromArg] = process.argv;
const FROM = fromArg || '2019-07-01';
const r4 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10000) / 10000);
const BAR = /under the \d+% bar|Pays too little/; // replayed in the analysis, so any bar can be tried

C.minViews = 1; // the archive has the price and the possession view only
const EXCLUDED = C.excluded;
C.excluded = []; // record the excluded markets too, so their record can be measured

function main() {
  const lines = fs.readFileSync(matchesFile, 'utf8').split(/\r?\n/);
  const head = lines[0].split(',');
  const recs = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = lines[i].split(',');
    const o = {};
    for (let k = 0; k < head.length; k++) o[head[k]] = c[k];
    const mr = RC.fromDatasetRow(o);
    if (mr && mr.hg != null && mr.ag != null) recs.push(mr);
  }
  recs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const fd = fs.openSync(outFile, 'w');
  const H = new History();
  let n = 0;
  let i = 0;
  while (i < recs.length) {
    const day = recs[i].date;
    let j = i;
    while (j < recs.length && recs[j].date === day) j++;
    if (day >= FROM) {
      for (let k = i; k < j; k++) {
        const m = recs[k];
        const mkt = RC.marketOf(m);
        if (!mkt || !(mkt.lamH > 0) || !(mkt.lamA > 0)) continue;
        const ens = ENS.combine({ market: { lamH: mkt.lamH, lamA: mkt.lamA }, ratings: null, xg: null, eloDiff: null });
        if (!ens) continue;
        const cal = {};
        for (const mk of ENS.deriveMarkets(ens)) if (mk.prob != null) cal[mk.key] = mk.prob;
        const goalViews = [{ name: 'market', lamH: ens.lamH, lamA: ens.lamA, rho: MK.rhoFor(ens.lamH + ens.lamA), cal }];
        const homeLog = H.teamLog(m.league, m.home, day, 40);
        const awayLog = H.teamLog(m.league, m.away, day, 40);
        const env = IN.leagueEnv(H, m.league, day);
        const timing = MAR.defaultTiming(env && env.firstHalf ? env.firstHalf.used : C.firstHalfShare);
        const pv = IN.paceView(env, homeLog, awayLog);
        if (pv) goalViews.push(pv);
        const h2h = IN.h2hFacts(H.h2h(m.league, m.home, m.away, day, 6, 10), m.home, env);
        const sv = IN.statsViews({ env, homeLog, awayLog, h2h, referee: null, lamMarket: { home: mkt.lamH, away: mkt.lamA }, pace: pv ? { ...pv.detail, base: env.shots } : null });
        const fx = { names: { home: m.home, away: m.away }, goalViews, timing, cornerViews: sv.corners, cardViews: sv.cards, players: [] };
        const sels = MAR.price(fx);
        const ctx = {
          hasMarket: true, started: false, avoid: new Set(), ruleTraps: new Set(), shift: {},
          news: { home: { highs: 0 }, away: { highs: 0 } },
          statsGames: { home: homeLog.slice(0, C.seasonGames).filter((g) => g.cf != null).length, away: awayLog.slice(0, C.seasonGames).filter((g) => g.cf != null).length },
        };
        const o = {
          hg: m.hg, ag: m.ag,
          hthg: m.hthg, htag: m.htag,
          corners: m.hc != null && m.ac != null ? { home: m.hc, away: m.ac } : null,
          cards: m.hy != null && m.ay != null ? { home: m.hy + (m.hr || 0), away: m.ay + (m.ar || 0) } : null,
        };
        const out = [];
        for (const s of sels) {
          if (!s.measured || !(s.prob >= 0.7) || s.group === 'Players' || s.group === 'Minutes') continue;
          const why = PK.blockers(s, ctx).filter((w) => !BAR.test(w));
          if (why.length) continue;
          const res = REC.settleKey(s.key, o);
          if (res === undefined) continue;
          out.push([s.key, s.group, r4(s.prob), r4(s.floor), r4(PK.payProb(s)), res]);
        }
        // the favourite's de-vigged win chance (context for the analysis)
        const fav = Math.max(mkt.p1 || 0, mkt.p2 || 0);
        fs.writeSync(fd, JSON.stringify({ d: day, div: m.league, fav: r4(fav), sels: out }) + '\n');
        n++;
      }
    }
    for (let k = i; k < j; k++) H.add(recs[k]);
    H._tableCache.clear();
    i = j;
    if (day >= FROM && day.endsWith('-01')) process.stdout.write(`${day} ${n}\n`);
  }
  fs.closeSync(fd);
  C.excluded = EXCLUDED;
  console.log('matches', n);
}

main();
