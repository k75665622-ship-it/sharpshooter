'use strict';

/**
 * research/v6/write_records.js — the measured record the site shows next to every v6 output.
 *
 *   node research/v6/write_records.js <scratch v6 dir>
 *
 * Reads: final/metrics.json (model training), final_tune.json / final_test.json
 * (research/v6/backtest_decision.js), acca_final_tune.json / acca_final_test.json
 * (research/v6/acca_study.js). Writes lib/intel/record.json and lib/intel/acca_record.json.
 */

const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node research/v6/write_records.js <scratch v6 dir>');
  process.exit(1);
}
const rd = (f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const metrics = rd('final/metrics.json');
const tune = rd('final_tune.json');
const test = rd('final_test.json');
const at = rd('acca_final_test.json');
const au = rd('acca_final_tune.json');

const r4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000);
const slim = (m) => (m ? { n: m.n, hit: r4(m.hit), stated: r4(m.stated), roiBet365: r4(m.roiBet365), nBet365: m.nBet365, roiBest: r4(m.roiBest), nBest: m.nBest } : null);
const grades = (g) => Object.fromEntries(Object.entries(g || {}).map(([k, v]) => [k, slim(v)]));
const ll = (L) => {
  const out = {};
  for (const k of Object.keys(L)) {
    const m = /^v6:(.+)$/.exec(k);
    if (!m || !L[`price:${m[1]}`]) continue;
    out[m[1]] = { n: L[k].n, v6: r4(L[k].ll), priceOnly: r4(L[`price:${m[1]}`].ll) };
  }
  return out;
};
const period = (j) => ({
  window: j.window,
  fixtures: j.fixtures,
  main: slim(j.main),
  mainPricedOnly: slim(j.mainPricedOnly),
  safer: slim(j.safer),
  value: slim(j.value),
  v5rule: slim(j.v5rule),
  avoid: { n: j.avoid.n, won: r4(j.avoid.won), marketSaid: r4(j.avoid.marketSaid), v6Said: r4(j.avoid.v6Said) },
  grades: grades(j.grades),
  logloss: ll(j.logloss),
});

const models = Object.fromEntries(Object.entries(metrics.models).map(([k, v]) => [k, {
  trainRows: v.n_train, tuneRows: v.n_tune, testRows: v.n_test, trees: v.rounds,
  testLogloss: r4(v.test_logloss), testPriceLogloss: r4(v.test_market_logloss), gainPct: v.test_gain_pct != null ? Math.round(v.test_gain_pct * 1000) / 1000 : null,
  gainCI95: v.test_gain_ci95 ? v.test_gain_ci95.map((x) => Math.round(x * 1e6) / 1e6) : null,
  ...(k === 'result_nomkt' ? { pricedSubset: v.test_priced_subset, baseRateLogloss: r4(v.test_baserate_logloss), accuracy: r4(v.test_acc) } : {}),
}]));

const record = {
  generated: new Date().toISOString().slice(0, 10),
  splits: { train: ['2005-07-01', '2019-06-30'], tune: ['2019-07-01', '2023-06-30'], heldOut: ['2023-07-01', 'end'] },
  models,
  heldOut: period(test),
  tuning: period(tune),
  grades: grades(test.grades),
  note: 'Main pick = most likely selection paying >= 1.30, ranked by probability + 2 x the factors\' disagreement with the price, never a trap. Value = best price >= 5% above the v6 fair price. Thresholds chosen on 2019-23, reported on 2023-26.',
};
const accaPeriod = (a) => ({
  window: a.window,
  legs: a.legs,
  mainAgreement: a.mainAgreement,
  callAgreement: a.callAgreement,
  saferAgreement: a.saferAgreement,
  methodologyOnly: a.methodologyOnly,
  rejectedByNormal: a.rejectedByNormal,
  daysWithLegs: a.daysWithLegs,
  sizes: Object.fromEntries(Object.entries(a.sizes).map(([k, v]) => [k, { n: v.n, hit: r4(v.hit), stated: r4(v.stated), roiBet365: r4(v.roiBet365), nPricedBet365: v.nPricedBet365, roiBest: r4(v.roiBest), nPricedBest: v.nPricedBest }])),
  methodologyOnlyAccas: a.methodologyOnlyAccas,
});
const acca = {
  generated: record.generated,
  rule: 'Leg = methodology LOCK/PREDICT AND the normal prediction agrees (main pick, a safer form of it, or its result/goals/BTTS call at 60%+), never flagged as overrated. One leg per match; each day\'s most likely k legs.',
  heldOut: accaPeriod(at),
  tuning: accaPeriod(au),
  sizes: accaPeriod(at).sizes,
};
const out = path.join(__dirname, '..', '..', 'lib', 'intel');
fs.writeFileSync(path.join(out, 'record.json'), JSON.stringify(record, null, 1));
fs.writeFileSync(path.join(out, 'acca_record.json'), JSON.stringify(acca, null, 1));
console.log('wrote', path.join(out, 'record.json'), path.join(out, 'acca_record.json'));
