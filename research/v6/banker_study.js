'use strict';

/**
 * research/v6/banker_study.js — the High Banker rule (lib/banker.js, the production code) on history.
 *
 *   node research/v6/banker_study.js <banker_dump.jsonl> <out.json> [mode]
 *
 *   mode "report" (default)  the production settings on the tuning seasons (2019-07 .. 2023-06)
 *                            and, once, on the held-out seasons (2023-07 ..)
 *   mode "sweep"             one setting at a time around the production values, TUNING SEASONS
 *                            ONLY — how the thresholds in lib/banker.js CFG were chosen
 *
 * Per day: every match's banker (one per match, all checks), then the most likely set of
 * bankers whose odds reach the target (3.0) — exactly what the site shows. Odds are Bet365's
 * where the archive has a price (1X2, double chance, draw-no-bet, Over/Under 2.5) and are
 * otherwise estimated from the de-vigged price with that match's Over/Under margin (shown as ≈
 * on the site). Returns are reported separately for slips whose every leg had a real price.
 */

const fs = require('fs');
const BK = require('../../lib/banker');
const { settle } = require('../../lib/settle');

const [, , dumpFile, outFile, mode = 'report'] = require.main === module ? process.argv : [];
const TUNE = ['2019-07-01', '2023-06-30'];
const HELD = ['2023-07-01', '2099-01-01'];

function load(file = dumpFile) {
  const rows = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue;
    const x = JSON.parse(line);
    rows.push(x);
  }
  return rows;
}

function evaluate(rows, window, cfg) {
  const days = new Map();
  for (const x of rows) {
    if (x.date < window[0] || x.date > window[1]) continue;
    if (!days.has(x.date)) days.set(x.date, []);
    days.get(x.date).push(x);
  }
  const L = { n: 0, won: 0, lost: 0, push: 0, stated: 0, byKey: {}, triple: { n: 0, won: 0, stated: 0 }, single: { n: 0, won: 0, stated: 0 }, retRef: 0, nRef: 0, retBest: 0, nBest: 0 };
  const S = { days: 0, daysWith: 0, slips: 0, won: 0, stated: 0, legs: 0, odds: 0, ret: 0, priced: 0, wonPriced: 0, retRef: 0, retBest: 0, oddsHist: {} };
  const A = { n: 0, won: 0, stated: 0, odds: 0 };
  const SF = { n: 0, won: 0, stated: 0, legs: 0, odds: 0, ret: 0 };
  const BIG = {};
  for (const [, xs] of days) {
    S.days++;
    const out = BK.build(xs, cfg);
    const byId = new Map(xs.map((x) => [`${x.home}|${x.away}`, x]));
    const res = (l) => {
      const x = byId.get(`${l.home}|${l.away}`);
      return settle(l.key, x.hg, x.ag);
    };
    for (const l of out.bankers) {
      const r = res(l);
      const x = byId.get(`${l.home}|${l.away}`);
      const k = (L.byKey[l.key] = L.byKey[l.key] || { n: 0, won: 0, stated: 0 });
      if (r == null) {
        L.push++;
        continue;
      }
      L.n++;
      L.won += r;
      L.lost += 1 - r;
      L.stated += l.prob;
      k.n++;
      k.won += r;
      k.stated += l.prob;
      const t = l.tripleConfirmed ? L.triple : L.single;
      t.n++;
      t.won += r;
      t.stated += l.prob;
      const q = x.pr && x.pr[l.key];
      if (q && q[0] > 1) {
        L.nRef++;
        L.retRef += r ? q[0] - 1 : -1;
      }
      if (q && q[1] > 1) {
        L.nBest++;
        L.retBest += r ? q[1] - 1 : -1;
      }
    }
    if (out.bankers.length) S.daysWith++;
    if (out.slip) {
      S.slips++;
      const rs = out.slip.legs.map(res);
      const lost = rs.some((r) => r === 0);
      // a pushed draw-no-bet leg is void: the slip pays at the remaining odds
      const odds = out.slip.legs.reduce((a, l, i) => a * (rs[i] == null ? 1 : l.odds), 1);
      S.won += lost ? 0 : 1;
      S.stated += out.slip.prob;
      S.legs += out.slip.size;
      S.odds += out.slip.odds;
      S.ret += lost ? -1 : odds - 1;
      const b = out.slip.odds < 3.5 ? '3.0-3.5' : out.slip.odds < 4 ? '3.5-4' : out.slip.odds < 5 ? '4-5' : '5+';
      S.oddsHist[b] = (S.oddsHist[b] || 0) + 1;
      const allPriced = out.slip.legs.every((l) => {
        const x = byId.get(`${l.home}|${l.away}`);
        return x.pr && x.pr[l.key] && x.pr[l.key][0] > 1;
      });
      if (allPriced) {
        S.priced++;
        S.wonPriced += lost ? 0 : 1;
        const refOdds = out.slip.legs.reduce((a, l, i) => a * (rs[i] == null ? 1 : byId.get(`${l.home}|${l.away}`).pr[l.key][0]), 1);
        const bestOdds = out.slip.legs.reduce((a, l, i) => a * (rs[i] == null ? 1 : byId.get(`${l.home}|${l.away}`).pr[l.key][1]), 1);
        S.retRef += lost ? -1 : refOdds - 1;
        S.retBest += lost ? -1 : bestOdds - 1;
      }
    }
    if (out.safer) {
      SF.n++;
      const rs = out.safer.legs.map(res);
      const lost = rs.some((r) => r === 0);
      const odds = out.safer.legs.reduce((a, l, i) => a * (rs[i] == null ? 1 : l.odds), 1);
      SF.won += lost ? 0 : 1;
      SF.stated += out.safer.prob;
      SF.legs += out.safer.size;
      SF.odds += out.safer.odds;
      SF.ret += lost ? -1 : odds - 1;
    }
    for (const o of out.bigger || []) {
      const g = (BIG[o.target] = BIG[o.target] || { n: 0, won: 0, stated: 0, odds: 0, legs: 0 });
      g.n++;
      g.won += o.legs.map(res).some((r) => r === 0) ? 0 : 1;
      g.stated += o.prob;
      g.odds += o.odds;
      g.legs += o.size;
    }
    if (out.all && out.all.size > (out.slip ? out.slip.size : 0) && out.all.odds >= cfg.target) {
      A.n++;
      A.won += out.all.legs.map(res).some((r) => r === 0) ? 0 : 1;
      A.stated += out.all.prob;
      A.odds += out.all.odds;
    }
  }
  const r3 = (v) => (v == null ? null : Math.round(v * 1000) / 1000);
  return {
    window,
    legs: {
      n: L.n, hit: r3(L.won / L.n), stated: r3(L.stated / L.n), pushes: L.push,
      perDay: r3((L.n + L.push) / S.days),
      tripleConfirmed: { n: L.triple.n, hit: r3(L.triple.won / L.triple.n), stated: r3(L.triple.stated / L.triple.n) },
      modelAndPriceOnly: { n: L.single.n, hit: r3(L.single.won / L.single.n), stated: r3(L.single.stated / L.single.n) },
      roiBet365: r3(L.retRef / L.nRef), nBet365: L.nRef, roiBest: r3(L.retBest / L.nBest), nBest: L.nBest,
      byKey: Object.fromEntries(Object.entries(L.byKey).filter(([, v]) => v.n).sort((a, b) => b[1].n - a[1].n).map(([k, v]) => [k, { n: v.n, hit: r3(v.won / v.n), stated: r3(v.stated / v.n) }])),
    },
    slip: {
      days: S.days, daysWithBankers: S.daysWith, slips: S.slips, coverage: r3(S.slips / S.days),
      hit: r3(S.won / S.slips), stated: r3(S.stated / S.slips), avgLegs: r3(S.legs / S.slips), avgOdds: r3(S.odds / S.slips),
      roi: r3(S.ret / S.slips), oddsHist: S.oddsHist,
      fullyPriced: { n: S.priced, hit: r3(S.wonPriced / S.priced), roiBet365: r3(S.retRef / S.priced), roiBest: r3(S.retBest / S.priced) },
    },
    safer: SF.n ? { target: cfg.safer, slips: SF.n, coverage: r3(SF.n / S.days), hit: r3(SF.won / SF.n), stated: r3(SF.stated / SF.n), avgLegs: r3(SF.legs / SF.n), avgOdds: r3(SF.odds / SF.n), roi: r3(SF.ret / SF.n) } : null,
    allBankers: { n: A.n, hit: r3(A.won / A.n), stated: r3(A.stated / A.n) },
    bigger: Object.fromEntries(Object.entries(BIG).map(([t, g]) => [t, { slips: g.n, coverage: r3(g.n / S.days), hit: r3(g.won / g.n), stated: r3(g.stated / g.n), avgOdds: r3(g.odds / g.n), avgLegs: r3(g.legs / g.n) }])),
  };
}

function main() {
  const rows = load();
  process.stderr.write(`${rows.length} fixtures\n`);
  const base = { ...BK.CFG };
  if (mode === 'sweep') {
    const SWEEP = JSON.parse(process.env.SWEEP || 'null') || {
      minProb: [0.72, 0.75, 0.78, 0.8, 0.82, 0.85],
      minBase: [0.7, 0.72, 0.75, 0.78, 0.8],
      minShift: [-0.02, -0.01, -0.005, 0, 0.005, 0.01],
      maxShift: [0.03, 0.05, 0.08, 1],
      minOdds: [1.05, 1.08, 1.1, 1.12, 1.15, 1.2],
      maxOdds: [1.35, 1.45, 1.6, 1.8],
      redFlags: [false, true],
      requireDecision: [false, true],
    };
    const out = { base: BK.publicConfig(base), baseline: evaluate(rows, TUNE, base), sweep: {} };
    for (const [k, vals] of Object.entries(SWEEP)) {
      out.sweep[k] = vals.map((v) => {
        const e = evaluate(rows, TUNE, { ...base, [k]: v });
        return { value: v, legs: { n: e.legs.n, hit: e.legs.hit, stated: e.legs.stated, perDay: e.legs.perDay, roiBest: e.legs.roiBest }, slip: { coverage: e.slip.coverage, hit: e.slip.hit, stated: e.slip.stated, avgLegs: e.slip.avgLegs, avgOdds: e.slip.avgOdds, roi: e.slip.roi, pricedRoiBest: e.slip.fullyPriced.roiBest } };
      });
      process.stderr.write(`swept ${k}\n`);
    }
    fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
    return;
  }
  const out = {
    config: BK.publicConfig(base),
    tuning: evaluate(rows, TUNE, base),
    heldOut: evaluate(rows, HELD, base),
  };
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  // RECORD_FILE=lib/banker_record.json writes the numbers the page shows
  if (process.env.RECORD_FILE) {
    const brief = (e) => ({ window: e.window, legs: { n: e.legs.n, hit: e.legs.hit, stated: e.legs.stated, perDay: e.legs.perDay, roiBest: e.legs.roiBest, nBest: e.legs.nBest, tripleConfirmed: e.legs.tripleConfirmed, byKey: e.legs.byKey }, slip: e.slip, safer: e.safer, bigger: e.bigger });
    fs.writeFileSync(process.env.RECORD_FILE, JSON.stringify({
      note: 'The production High Banker rule (lib/banker.js) on history: thresholds chosen on the tuning seasons, reported once on the held-out seasons. v6 models trained on 2005-2019 only. Odds: Bet365 where the archive has a price, otherwise estimated from the de-vigged price and the match margin.',
      config: out.config, tuning: brief(out.tuning), heldOut: brief(out.heldOut),
    }, null, 1) + '\n');
  }
  process.stdout.write(JSON.stringify({ tuning: { legs: out.tuning.legs.hit, legsStated: out.tuning.legs.stated, slip: out.tuning.slip }, heldOut: { legs: out.heldOut.legs.hit, legsStated: out.heldOut.legs.stated, slip: out.heldOut.slip } }, null, 1) + '\n');
}

if (require.main === module) main();
module.exports = { evaluate, load, TUNE, HELD };
