'use strict';

/**
 * research/v6/betbuilder_report.js — how the Bet Builder rule did on history.
 *
 *   node research/v6/betbuilder_report.js <betbuilder.jsonl> [out.json] [--fit] [--measured <models.json>]
 *
 * Reads research/v6/betbuilder_study.js output and prints, for the tuning seasons
 * (2019-07..2023-06) and the held-out seasons (2023-07 on) separately: how many matches had a
 * builder, how often builders landed against their stated combined chance, by number of legs,
 * by the kinds of legs (goals / corners / cards) and by stated chance; and how often each leg
 * landed on its own.
 *
 *   --fit                 fits the builder calibration logit(landed) = a + b·logit(stated) on the
 *                         TUNING seasons only and writes it into the models file given with
 *                         --measured (as builder.cal), for the next replay
 *   --measured <file>     writes the held-out record into <file> (lib/strongest/models.json
 *                         "builder.measured"), for the page
 */

const fs = require('fs');

const argv = process.argv.slice(2);
const flag = (name, hasValue) => {
  const i = argv.indexOf(name);
  if (i < 0) return null;
  const v = hasValue ? argv[i + 1] : true;
  argv.splice(i, hasValue ? 2 : 1);
  return v;
};
const fit = flag('--fit', false);
const measuredInto = flag('--measured', true);
const [file, outFile] = argv;
const SPLIT = '2023-07-01';

const sig = (x) => 1 / (1 + Math.exp(-x));
const logit = (p) => {
  const q = Math.min(0.999, Math.max(0.001, p));
  return Math.log(q / (1 - q));
};
const acc = () => ({ n: 0, w: 0, p: 0, prod: 0 });
const add = (a, r) => {
  a.n++;
  a.w += r.landed;
  a.p += r.chance;
  a.prod += r.product;
};
const show = (a) => (a.n ? { n: a.n, landed: +(a.w / a.n * 100).toFixed(1), stated: +(a.p / a.n * 100).toFixed(1), multiplied: +(a.prod / a.n * 100).toFixed(1) } : { n: 0 });

const P = { tune: newPart(), test: newPart() };
function newPart() {
  return { matches: 0, built: 0, days: new Map(), all: acc(), size: {}, kinds: {}, bins: {}, legs: {}, rows: [] };
}
let last = '';
for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!line) continue;
  const r = JSON.parse(line);
  last = r.d;
  const part = r.d < SPLIT ? P.tune : P.test;
  part.matches++;
  part.days.set(r.d, (part.days.get(r.d) || 0) + (r.legs ? 1 : 0));
  if (!r.legs) continue;
  part.built++;
  if (r.landed == null) continue;
  add(part.all, r);
  add((part.size[r.size] = part.size[r.size] || acc()), r);
  add((part.kinds[r.kinds] = part.kinds[r.kinds] || acc()), r);
  const b = r.chance >= 0.32 ? '32-34' : r.chance >= 0.3 ? '30-32' : r.chance >= 0.27 ? '27-30' : '22-27';
  add((part.bins[b] = part.bins[b] || acc()), r);
  for (const [key, c, res] of r.legs) {
    if (res == null) continue;
    const fam = /^C|^K_/.test(key) ? key.replace(/\d+\.5$/, '') : key;
    const a = (part.legs[fam] = part.legs[fam] || { n: 0, w: 0, p: 0 });
    a.n++;
    a.w += res;
    a.p += c;
  }
  part.rows.push({ y: r.landed, x: [1, logit(r.chance)] });
}

const report = {};
for (const [name, part] of Object.entries(P)) {
  const perDay = [...part.days.values()];
  report[name] = {
    matches: part.matches,
    builders: part.built,
    share: +(part.built / Math.max(1, part.matches) * 100).toFixed(1),
    perMatchDay: +(perDay.reduce((a, b) => a + b, 0) / Math.max(1, perDay.length)).toFixed(1),
    all: show(part.all),
    size: Object.fromEntries(Object.entries(part.size).sort().map(([k, a]) => [k, show(a)])),
    kinds: Object.fromEntries(Object.entries(part.kinds).sort((a, b) => b[1].n - a[1].n).map(([k, a]) => [k, show(a)])),
    bins: Object.fromEntries(Object.entries(part.bins).sort().map(([k, a]) => [k, show(a)])),
    legs: Object.fromEntries(Object.entries(part.legs).sort((a, b) => b[1].n - a[1].n).slice(0, 24).map(([k, a]) => [k, { n: a.n, won: +(a.w / a.n * 100).toFixed(1), stated: +(a.p / a.n * 100).toFixed(1) }])),
  };
}

const fmt = (a) => (a.n ? `${String(a.n).padStart(6)}  landed ${a.landed.toFixed(1).padStart(5)}%  stated ${a.stated.toFixed(1).padStart(5)}%  (legs multiplied ${a.multiplied.toFixed(1)}%)` : '     0');
for (const [name, r] of Object.entries(report)) {
  console.log(`\n=== ${name === 'tune' ? 'TUNING 2019-07..2023-06' : 'HELD-OUT 2023-07..'}  matches ${r.matches}, builders ${r.builders} (${r.share}%, ${r.perMatchDay} a match day)`);
  console.log('ALL           ', fmt(r.all));
  console.log('-- legs');
  for (const [k, a] of Object.entries(r.size)) console.log(`  ${(k + ' legs').padEnd(12)}`, fmt(a));
  console.log('-- kinds');
  for (const [k, a] of Object.entries(r.kinds)) console.log(`  ${k.padEnd(20)}`, fmt(a));
  console.log('-- stated');
  for (const [k, a] of Object.entries(r.bins)) console.log(`  ${k.padEnd(12)}`, fmt(a));
  console.log('-- each leg on its own');
  for (const [k, a] of Object.entries(r.legs)) console.log(`  ${k.padEnd(12)} ${String(a.n).padStart(6)}  won ${a.won.toFixed(1)}%  stated ${a.stated.toFixed(1)}%`);
}

// ---- the calibration, fitted on the tuning seasons only
function logisticFit(rows) {
  let b = [0, 1];
  for (let it = 0; it < 50; it++) {
    const A = [[0, 0], [0, 0]];
    const g = [0, 0];
    for (const r of rows) {
      const p = sig(b[0] * r.x[0] + b[1] * r.x[1]);
      const w = Math.max(1e-6, p * (1 - p));
      for (let i = 0; i < 2; i++) {
        g[i] += (r.y - p) * r.x[i];
        for (let j = 0; j < 2; j++) A[i][j] += w * r.x[i] * r.x[j];
      }
    }
    const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
    const step = [(A[1][1] * g[0] - A[0][1] * g[1]) / det, (A[0][0] * g[1] - A[1][0] * g[0]) / det];
    b = [b[0] + step[0], b[1] + step[1]];
    if (Math.abs(step[0]) + Math.abs(step[1]) < 1e-10) break;
  }
  return b;
}
if (fit) {
  const b = logisticFit(P.tune.rows);
  report.cal = { a: +b[0].toFixed(4), b: +b[1].toFixed(4), n: P.tune.rows.length };
  console.log(`\ncalibration fitted on ${P.tune.rows.length} tuning builders: logit(landed) = ${report.cal.a} + ${report.cal.b}·logit(stated)`);
  for (const p of [0.22, 0.25, 0.3, 0.333]) console.log(`  stated ${(p * 100).toFixed(1)}% -> ${(sig(b[0] + b[1] * logit(p)) * 100).toFixed(1)}%`);
}
if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 1));

if (measuredInto) {
  const models = JSON.parse(fs.readFileSync(measuredInto, 'utf8'));
  models.builder = models.builder || {};
  if (fit) models.builder.cal = { a: report.cal.a, b: report.cal.b };
  else {
    const t = report.test;
    const frac = (a) => ({ n: a.n, landed: +(a.landed / 100).toFixed(4), stated: +(a.stated / 100).toFixed(4), multiplied: +(a.multiplied / 100).toFixed(4) });
    models.builder.measured = {
      window: `Jul 2023 – ${new Date(last + 'T00:00:00Z').toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`,
      matches: t.matches,
      builders: t.builders,
      share: +(t.share / 100).toFixed(4),
      perMatchDay: t.perMatchDay,
      all: frac(t.all),
      kinds: Object.fromEntries(Object.entries(t.kinds).map(([k, a]) => [k, frac(a)])),
      size: Object.fromEntries(Object.entries(t.size).map(([k, a]) => [k, frac(a)])),
    };
  }
  fs.writeFileSync(measuredInto, JSON.stringify(models, null, 1) + '\n');
  console.log(`\nwritten into ${measuredInto}`);
}
