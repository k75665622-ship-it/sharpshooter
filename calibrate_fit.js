/* Fit a one-dimensional logistic recalibration for the raw model probabilities.

   p' = sigmoid(a + b * logit(p))        (b < 1 shrinks over-confident probabilities)

   Fitted on the "Over 2.5" and "BTTS Yes" probabilities only; the complementary
   market is defined as 1 - p' so Over/Under and Yes/No stay coherent.

   Method: fit on earlier seasons, then score on a HELD-OUT season. The parameters
   are only worth shipping if the held-out log-loss improves.

   Needs the dump written by:  BT_DUMP=/tmp/bt_raw.json node backtest_methodology.js
   Run:  node calibrate_fit.js [/tmp/bt_raw.json] [holdoutSeason=2025]                */
const fs = require('fs');
const file = process.argv[2] || '/tmp/bt_raw.json';
const holdout = Number(process.argv[3]) || 2025;
const { raw } = JSON.parse(fs.readFileSync(file, 'utf8'));

const logit = (p) => Math.log(Math.min(0.999, Math.max(0.001, p)) / (1 - Math.min(0.999, Math.max(0.001, p))));
const sig = (x) => 1 / (1 + Math.exp(-x));
const ll = (rows, f) => -rows.reduce((a, r) => a + (r.hit ? Math.log(Math.max(1e-9, f(r.prob))) : Math.log(Math.max(1e-9, 1 - f(r.prob)))), 0) / rows.length;
const brier = (rows, f) => rows.reduce((a, r) => a + (f(r.prob) - r.hit) ** 2, 0) / rows.length;

function fit(rows) {
  let best = null;
  for (let b = 0.3; b <= 1.3; b += 0.01) {
    for (let a = -0.4; a <= 0.4; a += 0.005) {
      const f = (p) => sig(a + b * logit(p));
      const l = ll(rows, f);
      if (!best || l < best.l) best = { a, b, l };
    }
  }
  return best;
}

const out = {};
for (const [name, key] of [['totals (Over 2.5)', 'O2.5'], ['btts (BTTS Yes)', 'BTTS_Y']]) {
  const rows = raw.filter((r) => r.key === key);
  const train = rows.filter((r) => r.season !== holdout);
  const test = rows.filter((r) => r.season === holdout);
  const p = fit(train);
  const f = (x) => sig(p.a + p.b * logit(x));
  const id = (x) => x;
  console.log(`\n${name}: train n=${train.length}, held-out ${holdout} n=${test.length}`);
  console.log(`  fitted a=${p.a.toFixed(3)} b=${p.b.toFixed(2)}`);
  console.log(`  held-out log-loss  raw ${ll(test, id).toFixed(5)}  calibrated ${ll(test, f).toFixed(5)}   (${ll(test, f) < ll(test, id) ? 'IMPROVES' : 'does NOT improve'})`);
  console.log(`  held-out Brier     raw ${brier(test, id).toFixed(5)}  calibrated ${brier(test, f).toFixed(5)}`);
  // also fit on everything for the shipped constants
  const all = fit(rows);
  console.log(`  all-data fit: a=${all.a.toFixed(3)} b=${all.b.toFixed(2)}`);
  for (const q of [0.35, 0.5, 0.6, 0.65, 0.7, 0.75]) console.log(`    raw ${q.toFixed(2)} -> ${sig(all.a + all.b * logit(q)).toFixed(3)}`);
  out[key] = { a: +all.a.toFixed(3), b: +all.b.toFixed(2), trainOnly: { a: +p.a.toFixed(3), b: +p.b.toFixed(2) }, improvesHeldOut: ll(test, f) < ll(test, id) };
}
console.log('\n' + JSON.stringify(out));
