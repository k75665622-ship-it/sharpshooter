'use strict';

/**
 * research/calibrate_v5.js — fine market weight, robust model-only weights, and the
 * calibration of every derived market the methodologies use.
 *
 *   node research/calibrate_v5.js <states.json>
 *
 * Writes <states>.calib.json with:
 *   weights.withMarket   λ blend weights when a book price exists
 *   weights.modelOnly    λ blend weights when it does not
 *   calibration[key]     {a, b} for p' = sigmoid(a + b·logit(p)), fitted on tuning seasons,
 *                        kept only if held-out log-loss improves
 */

const fs = require('fs');
const M = require('../lib/model');
const MK = require('../lib/market');

const file = process.argv[2];
const ev = JSON.parse(fs.readFileSync(file.replace(/\.json$/, '.eval.json'), 'utf8'));
const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
const full = rows.filter((r) => r.c['dc_0.0025_6'] && r.c.sot && r.c.mkt && r.elo != null);
for (const r of full) {
  const base = r.c['dc_0.0025_6'];
  const T = base.lh + base.la;
  const s = Math.exp((ev.elo.k * (r.elo + ev.elo.ha)) / 400);
  r.c.elo = { lh: (T / 2) * s, la: (T / 2) / s };
}
// FIT_ALL=1: the method has been validated on the held-out seasons; refit on every season
// (2019-2026) so production also learns the most recent scoring environment.
const tune = process.env.FIT_ALL ? full : full.filter((r) => r.season <= 2022);
const hold = full.filter((r) => r.season >= 2023);

const clampP = (p) => Math.min(1 - 1e-9, Math.max(1e-9, p));
function blend(r, w) {
  let lh = 0, la = 0, s = 0;
  for (const [k, wk] of Object.entries(w)) {
    if (!wk || !r.c[k]) continue;
    lh += wk * Math.log(r.c[k].lh);
    la += wk * Math.log(r.c[k].la);
    s += wk;
  }
  return { lh: Math.exp(lh / s), la: Math.exp(la / s) };
}
function matrix(l) { return M.scoreMatrix(l.lh, l.la, MK.rhoFor(l.lh + l.la)).m; }
const sum = (m, f) => { let s = 0; for (let i = 0; i <= M.MAX_GOALS; i++) for (let j = 0; j <= M.MAX_GOALS; j++) if (f(i, j)) s += m[i][j]; return s; };

function ll1x2(set, w) {
  let t = 0;
  for (const r of set) {
    const m = matrix(blend(r, w));
    const p = r.hg > r.ag ? sum(m, (i, j) => i > j) : r.hg === r.ag ? sum(m, (i, j) => i === j) : sum(m, (i, j) => i < j);
    const o = sum(m, (i, j) => i + j > 2);
    t += -Math.log(clampP(p)) - Math.log(clampP(r.hg + r.ag > 2 ? o : 1 - o));
  }
  return t / set.length;
}

// ---------------------------------------------------------------- fine market weight
const MODEL = { 'dc_0.0025_6': 0.3, sot: 0.35, elo: 0.35 };
console.log('model-only (robust, fixed) on held-out:', ll1x2(hold, MODEL).toFixed(5), ' vs fitted', JSON.stringify(ev.modelOnly), ll1x2(hold, ev.modelOnly).toFixed(5));
let bestW = null;
const tsub = tune.filter((_, i) => i % 2 === 0);
for (let wm = 0.5; wm <= 1.0001; wm += 0.05) {
  const w = { mkt: wm };
  for (const [k, v] of Object.entries(MODEL)) w[k] = (1 - wm) * v;
  const t = ll1x2(tsub, w);
  const h = ll1x2(hold, w);
  console.log(`  market weight ${wm.toFixed(2)}  tune ${t.toFixed(5)}  held-out ${h.toFixed(5)}`);
  if (!bestW || t < bestW.t) bestW = { wm, t, h, w };
}
console.log('chosen market weight', bestW.wm.toFixed(2));

// ---------------------------------------------------------------- calibration of derived markets
const logit = (p) => Math.log(clampP(p) / (1 - clampP(p)));
const sig = (x) => 1 / (1 + Math.exp(-x));
const MARKETS = {
  'O1.5': [(i, j) => i + j > 1.5, (h, a) => h + a > 1.5],
  'O2.5': [(i, j) => i + j > 2.5, (h, a) => h + a > 2.5],
  'O3.5': [(i, j) => i + j > 3.5, (h, a) => h + a > 3.5],
  BTTS_Y: [(i, j) => i > 0 && j > 0, (h, a) => h > 0 && a > 0],
  GG2P: [(i, j) => i >= 2 && j >= 2, (h, a) => h >= 2 && a >= 2],
  '1': [(i, j) => i > j, (h, a) => h > a],
  X: [(i, j) => i === j, (h, a) => h === a],
  '2': [(i, j) => i < j, (h, a) => h < a],
  'TTH_O1.5': [(i) => i >= 2, (h) => h >= 2],
  'TTA_O1.5': [(_i, j) => j >= 2, (_h, a) => a >= 2],
  'TTH_O0.5': [(i) => i >= 1, (h) => h >= 1],
  'TTA_O0.5': [(_i, j) => j >= 1, (_h, a) => a >= 1],
  WIN2: [(i, j) => Math.abs(i - j) >= 2, (h, a) => Math.abs(h - a) >= 2],
};

function collect(set, w, keyFn) {
  const out = [];
  for (const r of set) {
    const m = matrix(blend(r, w));
    out.push({ p: sum(m, keyFn[0]), y: keyFn[1](r.hg, r.ag) ? 1 : 0 });
  }
  return out;
}
const LL = (rows_, f) => -rows_.reduce((a, r) => a + Math.log(clampP(r.y ? f(r.p) : 1 - f(r.p))), 0) / rows_.length;
function fitCal(rows_) {
  let best = null;
  for (let b = 0.5; b <= 1.5; b += 0.02) for (let a = -0.4; a <= 0.4; a += 0.01) {
    const v = LL(rows_, (p) => sig(a + b * logit(p)));
    if (!best || v < best.v) best = { a, b, v };
  }
  return best;
}
function reliability(rows_, f) {
  const bins = [[0, 0.2], [0.2, 0.35], [0.35, 0.5], [0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 1]];
  return bins.map(([lo, hi]) => {
    const b = rows_.filter((r) => f(r.p) >= lo && f(r.p) < hi);
    if (b.length < 40) return null;
    return `${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}%: said ${(100 * b.reduce((a, r) => a + f(r.p), 0) / b.length).toFixed(1)} got ${(100 * b.reduce((a, r) => a + r.y, 0) / b.length).toFixed(1)} (n=${b.length})`;
  }).filter(Boolean);
}

const calibration = {};
for (const [label, w] of [['withMarket', bestW.w], ['modelOnly', MODEL]]) {
  calibration[label] = {};
  console.log(`\n=== calibration — ${label}`);
  for (const [key, fn] of Object.entries(MARKETS)) {
    const tr = collect(tsub, w, fn);
    const ho = collect(hold, w, fn);
    const c = fitCal(tr);
    const id = (p) => p;
    const cf = (p) => sig(c.a + c.b * logit(p));
    const raw = LL(ho, id);
    const cal = LL(ho, cf);
    const keep = cal < raw - 1e-5;
    if (keep) calibration[label][key] = { a: +c.a.toFixed(3), b: +c.b.toFixed(3) };
    console.log(`${key.padEnd(9)} a=${c.a.toFixed(3)} b=${c.b.toFixed(2)}  held-out LL raw ${raw.toFixed(5)} cal ${cal.toFixed(5)} ${keep ? 'KEEP' : 'skip'}`);
    for (const line of reliability(ho, keep ? cf : id)) console.log('     ' + line);
  }
}

const out = {
  fittedOn: 'tuning seasons 2019-20..2022-23; verified on held-out 2023-24..2026-27',
  fixtures: { tune: tune.length, holdout: hold.length },
  elo: ev.elo,
  weights: { withMarket: bestW.w, modelOnly: MODEL, marketWeight: bestW.wm },
  heldOut: { withMarket1x2ou: bestW.h, modelOnly1x2ou: ll1x2(hold, MODEL) },
  calibration,
};
if (process.env.FIT_ALL) out.fittedOn = 'all seasons 2019-20..2026-27 (method validated first on held-out 2023-26)';
fs.writeFileSync(file.replace(/\.json$/, process.env.FIT_ALL ? '.calib_all.json' : '.calib.json'), JSON.stringify(out, null, 2));
console.log('\n' + JSON.stringify(out.weights));
