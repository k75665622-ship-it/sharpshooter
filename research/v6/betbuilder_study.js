'use strict';

/**
 * research/v6/betbuilder_study.js — the Bet Builder rule (lib/betbuilder.js, production code) on history.
 *
 *   SHARPSHOOTER_CALIBRATION=<tune-only engine calibration> [SHARPSHOOTER_STRONGEST_MODELS=<models>] \
 *   node --max-old-space-size=6000 research/v6/betbuilder_study.js <Matches.csv> <out.jsonl> [from=2019-07-01]
 *
 * Walk-forward over every priced match from `from` (a day's matches never see that day's
 * results). Per match, as lib/strongest/inputs.js builds it on the site:
 *
 *   goals    the bookmaker-anchored view: the de-vigged Bet365 1X2 + Over/Under 2.5 price through
 *            lib/ensemble.js (calibrated with the engine calibration given), plus the possession
 *            view (lib/pace.js)
 *   corners  lib/strongest/inputs.js statsViews: form + price model, season, last 6
 *   cards    the same (the archive names no referees)
 *
 * then lib/strongest/markets.js prices every selection with its measured chance
 * (lib/strongest/calibrate.js) and lib/betbuilder.js builds the match's bet builder. Every leg is
 * settled on the real result (full-time score, corners, cards) and the builder landed only when
 * every leg did.
 *
 * Differences from the site, stated: the archive cannot rebuild the v6 factor view or the
 * stats view without re-training, so each leg's measured chance rests on the price (and the
 * possession view, weight 0); the v6 trap checks are therefore off, and the one-view rule
 * (a Strongest Pick needs two independent views) is relaxed to one.
 *
 * Output (JSONL, one priced match per line):
 *   { d, div, n:0 }  no builder, or
 *   { d, div, legs:[[key, chance, result]], chance, raw, product, size, kinds, landed }
 */

const fs = require('fs');
const RC = require('../../lib/factors/records');
const { History } = require('../../lib/factors/history');
const MK = require('../../lib/market');
const ENS = require('../../lib/ensemble');
const MAR = require('../../lib/strongest/markets');
const IN = require('../../lib/strongest/inputs');
const C = require('../../lib/strongest/config');
const BL = require('../../lib/betbuilder');
const { settle } = require('../../lib/settle');

const [, , matchesFile, outFile, fromArg] = process.argv;
const FROM = fromArg || '2019-07-01';
const r4 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10000) / 10000);

// the archive replay has the price and the possession view only: relax the two-view rule
C.minViews = 1;

function settleLeg(key, m) {
  let mm;
  if ((mm = /^C_([OU])(\d+\.5)$/.exec(key))) return m.hc == null || m.ac == null ? null : mm[1] === 'O' ? +(m.hc + m.ac > Number(mm[2])) : +(m.hc + m.ac < Number(mm[2]));
  if (key === 'C_MOST_H') return m.hc == null || m.ac == null ? null : +(m.hc > m.ac);
  if (key === 'C_MOST_A') return m.hc == null || m.ac == null ? null : +(m.ac > m.hc);
  if ((mm = /^C([HA])_O(\d+\.5)$/.exec(key))) return m.hc == null || m.ac == null ? null : +((mm[1] === 'H' ? m.hc : m.ac) > Number(mm[2]));
  if ((mm = /^K_([OU])(\d+\.5)$/.exec(key))) {
    if (m.hy == null || m.ay == null) return null;
    const k = m.hy + m.ay + (m.hr || 0) + (m.ar || 0);
    return mm[1] === 'O' ? +(k > Number(mm[2])) : +(k < Number(mm[2]));
  }
  return settle(key, m.hg, m.ag);
}

function main() {
  console.time('load');
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
  console.timeEnd('load');

  const fd = fs.openSync(outFile, 'w');
  const H = new History();
  let n = 0;
  let built = 0;
  console.time('study');
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
        // the bookmaker-anchored view, as the engine builds it from a price
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
          hasMarket: true,
          started: false,
          avoid: new Set(),
          ruleTraps: new Set(),
          shift: {},
          news: { home: { highs: 0 }, away: { highs: 0 } },
          statsGames: { home: homeLog.slice(0, C.seasonGames).filter((g) => g.cf != null).length, away: awayLog.slice(0, C.seasonGames).filter((g) => g.cf != null).length },
        };
        const r = BL.forMatch({ fx, sels, ctx });
        n++;
        if (!r.builder) {
          fs.writeSync(fd, JSON.stringify({ d: day, div: m.league, n: 0 }) + '\n');
          continue;
        }
        built++;
        const legs = r.builder.legs.map((l) => [l.key, l.chance, settleLeg(l.key, m)]);
        const res = legs.map((l) => l[2]);
        const kinds = [...new Set(r.builder.legs.map((l) => (l.group === 'Corners' ? 'corners' : l.group === 'Bookings' ? 'cards' : 'goals')))].sort().join('+');
        fs.writeSync(fd, JSON.stringify({
          d: day,
          div: m.league,
          legs,
          chance: r.builder.chance,
          raw: r.builder.raw,
          product: r.builder.product,
          size: r.builder.size,
          kinds,
          landed: res.some((x) => x == null) ? null : res.every((x) => x === 1) ? 1 : 0,
          p: [r4(mkt.p1), r4(mkt.pX), r4(mkt.p2)],
        }) + '\n');
      }
    }
    for (let k = i; k < j; k++) H.add(recs[k]);
    H._tableCache.clear();
    i = j;
    if (day >= FROM && day.endsWith('-01')) process.stdout.write(`${day} ${n} matches ${built} builders\n`);
  }
  fs.closeSync(fd);
  console.timeEnd('study');
  console.log('matches', n, 'builders', built);
}

main();
