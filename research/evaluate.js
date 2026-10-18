'use strict';

/**
 * research/evaluate.js — which model components predict best, and what blend wins.
 *
 *   node research/evaluate.js <states.json>
 *
 * Tuning seasons: 2019-20 .. 2022-23.  Held-out: 2023-24 .. 2026-27.
 * Every weight / scale is chosen on TUNING only, then reported on HELD-OUT.
 *
 * Metrics (lower is better): log-loss on 1X2, Over/Under 2.5, BTTS, exact score;
 * and the ranked probability score (RPS) on 1X2.
 */

const fs = require('fs');
const M = require('../lib/model');
const MK = require('../lib/market');

const file = process.argv[2];
const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
const TUNE = (r) => r.season <= 2022;
const HOLD = (r) => r.season >= 2023;

function probs(lh, la) {
  const sm = M.scoreMatrix(lh, la, MK.rhoFor(lh + la));
  let h = 0, d = 0, o = 0, b = 0;
  for (let i = 0; i <= M.MAX_GOALS; i++) for (let j = 0; j <= M.MAX_GOALS; j++) {
    const p = sm.m[i][j];
    if (i > j) h += p; else if (i === j) d += p;
    if (i + j > 2) o += p;
    if (i > 0 && j > 0) b += p;
  }
  return { h, d, a: 1 - h - d, o, b, m: sm.m };
}

const clampP = (p) => Math.min(1 - 1e-9, Math.max(1e-9, p));
function score(r, P) {
  const res = r.hg > r.ag ? 'h' : r.hg === r.ag ? 'd' : 'a';
  const ll1 = -Math.log(clampP(P[res]));
  const llo = -Math.log(clampP(r.hg + r.ag > 2 ? P.o : 1 - P.o));
  const llb = -Math.log(clampP(r.hg > 0 && r.ag > 0 ? P.b : 1 - P.b));
  const cs = r.hg <= M.MAX_GOALS && r.ag <= M.MAX_GOALS ? P.m[r.hg][r.ag] : 1e-6;
  const llc = -Math.log(clampP(cs));
  // RPS on ordered outcomes (home, draw, away)
  const c1 = P.h - (res === 'h' ? 1 : 0);
  const c2 = P.h + P.d - (res !== 'a' ? 1 : 0);
  const rps = (c1 * c1 + c2 * c2) / 2;
  return { ll1, llo, llb, llc, rps };
}
function mean(list, k) { return list.reduce((a, x) => a + x[k], 0) / list.length; }
function report(name, set, getLam) {
  const s = [];
  for (const r of set) {
    const l = getLam(r);
    if (!l) continue;
    s.push(score(r, probs(l.lh, l.la)));
  }
  if (!s.length) return null;
  const o = { name, n: s.length, ll1: mean(s, 'll1'), llo: mean(s, 'llo'), llb: mean(s, 'llb'), llc: mean(s, 'llc'), rps: mean(s, 'rps') };
  console.log(`${name.padEnd(26)} n=${String(o.n).padStart(6)}  1X2 ${o.ll1.toFixed(4)}  RPS ${o.rps.toFixed(4)}  O/U ${o.llo.toFixed(4)}  BTTS ${o.llb.toFixed(4)}  CS ${o.llc.toFixed(4)}`);
  return o;
}

// fixtures where every component exists, so comparisons are like for like
const full = rows.filter((r) => r.c.v4 && r.c['dc_0.0025_6'] && r.c.sot && r.c.mkt && r.elo != null);
const tune = full.filter(TUNE);
const hold = full.filter(HOLD);
console.log(`fixtures with every component: ${full.length} (tune ${tune.length}, held-out ${hold.length})\n`);

// ---------------------------------------------------------------- Elo -> goals scale (fitted on tune)
function eloLam(r, k, ha, base) {
  const T = base.lh + base.la;
  const s = Math.exp((k * (r.elo + ha)) / 400);
  return { lh: (T / 2) * s, la: (T / 2) / s };
}
let bestElo = null;
{
  const sub = tune.filter((_, i) => i % 3 === 0);
  for (let k = 0.6; k <= 1.6; k += 0.1) for (let ha = 40; ha <= 110; ha += 10) {
    let ll = 0;
    for (const r of sub) ll += score(r, probs(...Object.values(eloLam(r, k, ha, r.c['dc_0.0025_6'])))).ll1;
    ll /= sub.length;
    if (!bestElo || ll < bestElo.ll) bestElo = { k, ha, ll };
  }
  console.log(`Elo scale fitted on tune: k=${bestElo.k.toFixed(2)} homeAdv=${bestElo.ha} (Elo pts)\n`);
}
for (const r of full) r.c.elo = eloLam(r, bestElo.k, bestElo.ha, r.c['dc_0.0025_6']);

// ---------------------------------------------------------------- single components
for (const [label, set] of [['TUNE 2019-22', tune], ['HELD-OUT 2023-26', hold]]) {
  console.log(`=== ${label} — single components`);
  report('v4 (old production formula)', set, (r) => r.c.v4);
  for (const k of Object.keys(set[0].c).filter((x) => x.startsWith('dc_'))) report(k, set, (r) => r.c[k]);
  report('sot (shots rating)', set, (r) => r.c.sot);
  report('elo', set, (r) => r.c.elo);
  report('mkt (Bet365 implied)', set, (r) => r.c.mkt);
  console.log('');
}

// ---------------------------------------------------------------- ensembles (log-linear on λ)
function blend(r, w) {
  let lh = 0, la = 0, s = 0;
  for (const [k, wk] of Object.entries(w)) {
    if (!wk || !r.c[k]) continue;
    lh += wk * Math.log(r.c[k].lh);
    la += wk * Math.log(r.c[k].la);
    s += wk;
  }
  return s ? { lh: Math.exp(lh / s), la: Math.exp(la / s) } : null;
}
function objective(set, w) {
  let t = 0;
  for (const r of set) {
    const l = blend(r, w);
    const sc = score(r, probs(l.lh, l.la));
    t += sc.ll1 + sc.llo + 0.5 * sc.llc;
  }
  return t / set.length;
}
function gridSearch(set, keys, step) {
  let best = null;
  const rec = (i, left, w) => {
    if (i === keys.length - 1) {
      const ww = { ...w, [keys[i]]: Math.round(left * 100) / 100 };
      const v = objective(set, ww);
      if (!best || v < best.v) best = { v, w: ww };
      return;
    }
    for (let x = 0; x <= left + 1e-9; x += step) rec(i + 1, left - x, { ...w, [keys[i]]: Math.round(x * 100) / 100 });
  };
  rec(0, 1, {});
  return best;
}
const tsub = tune.filter((_, i) => i % 2 === 0);
console.log('Fitting blends on tuning seasons…');
const modelOnly = gridSearch(tsub, ['dc_0.0025_6', 'sot', 'elo'], 0.1);
console.log('  model-only weights:', JSON.stringify(modelOnly.w));
const withMkt = gridSearch(tsub, ['dc_0.0025_6', 'sot', 'elo', 'mkt'], 0.1);
console.log('  with-market weights:', JSON.stringify(withMkt.w));
console.log('');
for (const [label, set] of [['TUNE 2019-22', tune], ['HELD-OUT 2023-26', hold]]) {
  console.log(`=== ${label} — blends`);
  report('v4 (old production formula)', set, (r) => r.c.v4);
  report('model-only blend', set, (r) => blend(r, modelOnly.w));
  report('mkt alone', set, (r) => r.c.mkt);
  report('full blend (with market)', set, (r) => blend(r, withMkt.w));
  console.log('');
}

fs.writeFileSync(file.replace(/\.json$/, '.eval.json'), JSON.stringify({ elo: bestElo, modelOnly: modelOnly.w, withMkt: withMkt.w }, null, 2));
