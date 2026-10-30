'use strict';

/**
 * research/v6/strongest_fit.js — the measured models behind the Strongest Picks
 * (lib/strongest/models.json), fitted on the tuning seasons and checked on held-out ones.
 *
 *   node research/v6/strongest_fit.js <strongest_dump.jsonl> <out.json> [fitTo=2023-07-01] [testFrom=fitTo] [--models <models.json>]
 *
 * Reads research/v6/strongest_study.js output (run with no models file, so every view is raw).
 *
 * 1. The possession model (lib/pace.js) on its own: does "shots x goals per shot" price goals
 *    as well as the other views? (log-loss of 1X2, over 2.5 and both-teams-to-score)
 *
 * 2. Goal markets: one honest chance per selection from its views,
 *      logit(chance) = a + b·logit(market) + c·(logit(factors) - logit(market))
 *                      + d·(logit(stats) - logit(market)) + e·(logit(possession) - logit(market))
 *    per market, on the 18 divisions where the archive rebuilds the site's own stats view.
 *    Fitted with and without the possession term, so its contribution is measured.
 *
 * 3. Corners: Poisson regression per side on the teams' corner form, the price's strength gap and
 *    tempo, and (variant) the possession model's shot volume; negative-binomial dispersion by
 *    maximum likelihood.
 *    Cards: Poisson regression per match on card form, head-to-head, the price's mismatch and
 *    tempo, and (variant) the possession model's expected shots.
 *
 * 4. Corner and card lines: a per-family logistic calibration of the chosen model's figure.
 *
 * Every comparison is printed for the tuning and the held-out seasons; the chosen variants are
 * written to <out.json> in lib/strongest/models.json form (--models writes that file too).
 */

const fs = require('fs');
const M = require('../../lib/model');
const MK = require('../../lib/market');
const MAR = require('../../lib/strongest/markets');

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const modelsOut = flag('--models');
const [file, outFile, fitToArg, testFromArg] = args;
const FIT_TO = fitToArg || '2023-07-01';
const TEST_FROM = testFromArg || FIT_TO;

const L = (v) => Math.log(Math.max(1e-6, v));
const sig = (x) => 1 / (1 + Math.exp(-x));
const logit = (p) => {
  const q = Math.min(0.999, Math.max(0.001, p));
  return Math.log(q / (1 - q));
};
const lgamma = (z) => {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
};
const nbLog = (y, mu, r) => lgamma(y + r) - lgamma(r) - lgamma(y + 1) + r * Math.log(r / (r + mu)) + y * Math.log(mu / (r + mu));

function solve(A, y) {
  const n = y.length;
  const Mx = A.map((row, i) => [...row, y[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(Mx[r][c]) > Math.abs(Mx[p][c])) p = r;
    [Mx[c], Mx[p]] = [Mx[p], Mx[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = Mx[r][c] / Mx[c][c];
      for (let k = c; k <= n; k++) Mx[r][k] -= f * Mx[c][k];
    }
  }
  return Mx.map((row, i) => row[n] / row[i]);
}

/** Poisson regression with an offset (IRLS). */
function poissonFit(rows, nf, ridge = 1e-3) {
  let b = new Array(nf).fill(0);
  for (let it = 0; it < 30; it++) {
    const A = Array.from({ length: nf }, () => new Array(nf).fill(0));
    const g = new Array(nf).fill(0);
    for (const r of rows) {
      let eta = r.off;
      for (let i = 0; i < nf; i++) eta += r.x[i] * b[i];
      const mu = Math.exp(eta);
      for (let i = 0; i < nf; i++) {
        g[i] += (r.y - mu) * r.x[i];
        for (let j = 0; j < nf; j++) A[i][j] += mu * r.x[i] * r.x[j];
      }
    }
    for (let i = 0; i < nf; i++) {
      A[i][i] += ridge * rows.length;
      g[i] -= ridge * rows.length * b[i];
    }
    const step = solve(A, g);
    b = b.map((v, i) => v + step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-7) break;
  }
  return b;
}

/** Logistic regression (IRLS), the slope on feature 1 shrunk toward 1 and the rest toward 0. */
function logisticFit(rows, nf, ridge = 1e-3) {
  let b = new Array(nf).fill(0);
  b[1] = 1;
  for (let it = 0; it < 40; it++) {
    const A = Array.from({ length: nf }, () => new Array(nf).fill(0));
    const g = new Array(nf).fill(0);
    for (const r of rows) {
      let z = 0;
      for (let i = 0; i < nf; i++) z += r.x[i] * b[i];
      const p = sig(z);
      const w = Math.max(1e-6, p * (1 - p));
      for (let i = 0; i < nf; i++) {
        g[i] += (r.y - p) * r.x[i];
        for (let j = 0; j < nf; j++) A[i][j] += w * r.x[i] * r.x[j];
      }
    }
    for (let i = 0; i < nf; i++) {
      A[i][i] += ridge * rows.length;
      g[i] -= ridge * rows.length * (i === 1 ? b[i] - 1 : b[i]);
    }
    const step = solve(A, g);
    b = b.map((v, i) => v + step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-8) break;
  }
  return b;
}

function nbDispersion(pairs) {
  let best = null;
  for (let lr = Math.log(1); lr <= Math.log(400); lr += 0.02) {
    const r = Math.exp(lr);
    let ll = 0;
    for (const [y, mu] of pairs) ll += nbLog(y, mu, r);
    if (!best || ll > best.ll) best = { r, ll };
  }
  return best.r;
}
const predictP = (b, row, nf) => {
  let eta = row.off;
  for (let i = 0; i < nf; i++) eta += row.x[i] * b[i];
  return Math.exp(eta);
};
const r4 = (v) => +v.toFixed(4);
const partOf = (d) => (d < FIT_TO ? 'tune' : d >= TEST_FROM ? 'test' : null);

// ------------------------------------------------------------------ read the replay once
const goalRows = { tune: {}, test: {} };
const lamRows = { tune: [], test: [] };
const corner = { tune: [], test: [] };
const cards = { tune: [], test: [] };
const GOAL = (k) => !/^(C|K_|PL_|M\d)/.test(k);

for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!line) continue;
  const r = JSON.parse(line);
  const part = partOf(r.d);
  if (!part) continue;
  const x = r.x || {};
  // goal selections, for the calibration (live-mirrored divisions only)
  if (r.live) {
    for (const s of r.s) {
      const [key, , floor, v, res] = s;
      if (res == null || !GOAL(key) || v.m == null || floor < 0.55) continue;
      const lm = logit(v.m);
      (goalRows[part][key] = goalRows[part][key] || []).push({
        y: res,
        m: v.m,
        x: [1, lm, v.f != null ? logit(v.f) - lm : 0, v.s != null ? logit(v.s) - lm : 0, v.p != null ? logit(v.p) - lm : 0],
        hasP: v.p != null,
      });
    }
  }
  // expected goals per view, for the possession model's own log-loss
  if (x.mk && x.pc) lamRows[part].push({ hg: r.hg, ag: r.ag, mk: x.mk, st: x.st, fa: x.fa, pc: [x.pc[0], x.pc[1]], live: r.live });
  const mk = x.mk;
  if (!mk || !(mk[0] > 0) || !(mk[1] > 0)) continue;
  const sup = L(mk[0] / mk[1]);
  const tot = L((mk[0] + mk[1]) / 2.6);
  const pc = x.pc || null;
  if (x.cb && x.cs && x.cr && x.co && x.co[0] != null && x.co[1] != null) {
    const [bh, ba, disp] = x.cb;
    const [sHa, sHd, sAa, sAd] = x.cs;
    const [rHa, rHd, rAa, rAd] = x.cr;
    const meta = { disp, season: [bh * sHa * sAd, ba * sAa * sHd], recent: [bh * rHa * rAd, ba * rAa * rHd], pace: !!pc };
    // shot volume from the possession model: own attack and the opponent's shots conceded
    const vH = pc ? [L(pc[2]), L(pc[7])] : [0, 0];
    const vA = pc ? [L(pc[6]), L(pc[3])] : [0, 0];
    corner[part].push({ y: x.co[0], off: L(bh), meta, x: [1, 0, L(sHa), L(sAd), L(rHa), L(rAd), sup, tot, ...vH] });
    corner[part].push({ y: x.co[1], off: L(ba), meta, x: [0, 1, L(sAa), L(sHd), L(rAa), L(rHd), -sup, tot, ...vA] });
  }
  if (x.kb && x.ks && x.kr && x.ca && x.ca[0] != null && x.ca[1] != null) {
    const [bh, ba, disp, hf] = x.kb;
    const [sH, sA] = x.ks;
    const [rH, rA] = x.kr;
    const base = bh + ba;
    const season = (bh * sH + ba * sA) * hf;
    const recent = (bh * rH + ba * rA) * hf;
    // the possession model's expected shots in the match vs the league (tempo)
    const shots = pc ? L((pc[10] * (pc[2] + pc[7]) / 2 + pc[11] * (pc[6] + pc[3]) / 2) / (pc[10] + pc[11])) : 0;
    cards[part].push({
      y: x.ca[0] + x.ca[1] + (x.ca[2] || 0) + (x.ca[3] || 0),
      off: L(base),
      meta: { disp, season, recent, pace: !!pc },
      x: [1, L(season / base / hf), L(recent / base / hf), L(hf), Math.abs(sup), tot, shots],
    });
  }
}
const report = { fitTo: FIT_TO, testFrom: TEST_FROM };

// ------------------------------------------------------------------ 1. the possession model alone
function lamLoss(rows, pick) {
  let n = 0;
  let l1 = 0;
  let lo = 0;
  let lb = 0;
  for (const r of rows) {
    const lam = pick(r);
    if (!lam || !(lam[0] > 0) || !(lam[1] > 0)) continue;
    const sm = M.scoreMatrix(lam[0], lam[1], MK.rhoFor(lam[0] + lam[1]));
    const S = (f) => M.sumIf(sm, f);
    const p1 = S((a, b) => a > b);
    const pX = S((a, b) => a === b);
    const p2 = 1 - p1 - pX;
    const po = S((a, b) => a + b > 2.5);
    const pb = S((a, b) => a > 0 && b > 0);
    const res = r.hg > r.ag ? p1 : r.hg === r.ag ? pX : p2;
    l1 += -Math.log(Math.max(1e-9, res));
    lo += -Math.log(Math.max(1e-9, r.hg + r.ag > 2.5 ? po : 1 - po));
    lb += -Math.log(Math.max(1e-9, r.hg > 0 && r.ag > 0 ? pb : 1 - pb));
    n++;
  }
  return { n, result: r4(l1 / n), over25: r4(lo / n), btts: r4(lb / n) };
}
report.possession = {};
for (const part of ['tune', 'test']) {
  const rows = lamRows[part].filter((r) => r.live && r.st);
  report.possession[part] = {
    bookmakers: lamLoss(rows, (r) => r.mk),
    statsView: lamLoss(rows, (r) => r.st),
    possession: lamLoss(rows, (r) => r.pc),
    'stats + possession (geometric mean)': lamLoss(rows, (r) => [Math.sqrt(r.st[0] * r.pc[0]), Math.sqrt(r.st[1] * r.pc[1])]),
    factors: lamLoss(rows, (r) => r.fa),
  };
}
console.log('\n1. Possession model on its own (log-loss, lower is better; same matches for every view)');
for (const part of ['tune', 'test']) {
  console.log(`  ${part}`);
  for (const [k, v] of Object.entries(report.possession[part])) console.log(`    ${k.padEnd(38)} n ${v.n}  1X2 ${v.result}  O2.5 ${v.over25}  BTTS ${v.btts}`);
}

// ------------------------------------------------------------------ 2. goal markets
const goalCal = {};
const goalCalNoP = {};
for (const [key, rows] of Object.entries(goalRows.tune)) {
  if (rows.length < 400) continue;
  const b5 = logisticFit(rows, 5);
  const b4 = logisticFit(rows.map((r) => ({ ...r, x: r.x.slice(0, 4) })), 4);
  goalCal[key] = { a: r4(b5[0]), b: r4(b5[1]), c: r4(b5[2]), d: r4(b5[3]), e: r4(b5[4]), n: rows.length };
  goalCalNoP[key] = { a: r4(b4[0]), b: r4(b4[1]), c: r4(b4[2]), d: r4(b4[3]), e: 0, n: rows.length };
}
const chanceOf = (cal, key, row) => {
  const c = cal[key];
  return c ? sig(c.a + c.b * row.x[1] + c.c * row.x[2] + c.d * row.x[3] + c.e * row.x[4]) : row.m;
};
function goalTable(part) {
  const bins = {};
  const ll = { market: 0, withoutPossession: 0, withPossession: 0, n: 0 };
  for (const [key, rows] of Object.entries(goalRows[part])) {
    for (const row of rows) {
      const pm = row.m;
      const p4 = chanceOf(goalCalNoP, key, row);
      const p5 = chanceOf(goalCal, key, row);
      if (row.hasP && goalCal[key]) {
        const l = (p) => -Math.log(Math.max(1e-9, row.y ? p : 1 - p));
        ll.market += l(pm);
        ll.withoutPossession += l(p4);
        ll.withPossession += l(p5);
        ll.n++;
      }
      for (const [how, p] of [['market view', pm], ['measured (no possession)', p4], ['measured (with possession)', p5]]) {
        if (p < 0.75 || p > 0.92) continue;
        const b = p >= 0.88 ? '88-92' : p >= 0.85 ? '85-88' : p >= 0.8 ? '80-85' : '75-80';
        const k = `${how}|${b}`;
        const o = (bins[k] = bins[k] || { n: 0, w: 0, p: 0 });
        o.n++;
        o.w += row.y;
        o.p += p;
      }
    }
  }
  return {
    logLoss: { n: ll.n, market: r4(ll.market / ll.n), withoutPossession: r4(ll.withoutPossession / ll.n), withPossession: r4(ll.withPossession / ll.n) },
    bins: Object.fromEntries(Object.entries(bins).sort().map(([k, o]) => [k, { n: o.n, hit: +(o.w / o.n * 100).toFixed(1), stated: +(o.p / o.n * 100).toFixed(1) }])),
  };
}
report.goals = { calibration: goalCal, calibrationWithoutPossession: goalCalNoP, tune: goalTable('tune'), test: goalTable('test') };
console.log('\n2. Goal markets: measured chance (log-loss per selection, matches with a possession view)');
for (const part of ['tune', 'test']) {
  const t = report.goals[part];
  if (!t.logLoss.n) continue;
  console.log(`  ${part}: n ${t.logLoss.n}  market ${t.logLoss.market}  measured without possession ${t.logLoss.withoutPossession}  with possession ${t.logLoss.withPossession}`);
  for (const [k, v] of Object.entries(t.bins)) console.log(`    ${k.padEnd(34)} n ${String(v.n).padStart(7)} hit ${v.hit.toFixed(1).padStart(5)} stated ${v.stated.toFixed(1).padStart(5)}`);
}
const eCoefs = Object.entries(goalCal).map(([k, c]) => [k, c.e]).sort((a, b) => b[1] - a[1]);
console.log('  possession weight per market (e):', eCoefs.map(([k, e]) => `${k} ${e}`).join(', '));
// A view earns a place in the measured chance only when it improves the TUNING log-loss by at
// least EARN per selection: an extra term that changes nothing only adds noise to the weights.
const EARN = 0.0005;
const tl = report.goals.tune.logLoss;
// FORCE_GOAL_POSSESSION=0|1 keeps a choice made on the tuning seasons when refitting on everything
const possessionEarns = process.env.FORCE_GOAL_POSSESSION != null ? process.env.FORCE_GOAL_POSSESSION === '1'
  : tl.n > 0 && tl.withoutPossession - tl.withPossession >= EARN;
report.goals.possessionEarns = possessionEarns;
console.log(`  possession term ${possessionEarns ? 'EARNS' : 'does not earn'} a place (tuning gain ${((tl.withoutPossession - tl.withPossession) || 0).toFixed(5)} per selection, needs ${EARN})`);

// ------------------------------------------------------------------ 3. corners and cards
const NAMES_C = ['home', 'away', 'seasonAtt', 'oppSeasonDef', 'recentAtt', 'oppRecentDef', 'priceStrengthGap', 'priceTotal', 'shotVolume', 'oppShotsConceded'];
const NAMES_K = ['intercept', 'seasonForm', 'recentForm', 'h2h', 'priceMismatch', 'priceTotal', 'expectedShots'];
const cornerVariants = {
  'form + price': 8,
  'form + price + possession': 10,
};
const cardVariants = {
  'form + price': 6,
  'form + price + possession': 7,
};
const cut = (rows, nf) => rows.map((r) => ({ ...r, x: r.x.slice(0, nf) }));
const fits = { corners: {}, cards: {} };
for (const [name, nf] of Object.entries(cornerVariants)) {
  const rows = cut(corner.tune, nf);
  const b = poissonFit(rows, nf);
  fits.corners[name] = { nf, b, r: nbDispersion(rows.map((row) => [row.y, predictP(b, row, nf)])) };
}
for (const [name, nf] of Object.entries(cardVariants)) {
  const rows = cut(cards.tune, nf);
  const b = poissonFit(rows, nf);
  fits.cards[name] = { nf, b, r: nbDispersion(rows.map((row) => [row.y, predictP(b, row, nf)])) };
}

function cornerSels(mh, ma, r, hy, ay) {
  const ph = MAR.nbPmf(mh, r);
  const pa = MAR.nbPmf(ma, r);
  const tot = MAR.convolve(ph, pa);
  const T = hy + ay;
  const out = [];
  for (const l of MAR.CORNER_LINES) {
    out.push([`C_O${l}`, MAR.over(tot, l), T > l ? 1 : 0]);
    out.push([`C_U${l}`, 1 - MAR.over(tot, l), T < l ? 1 : 0]);
  }
  for (const l of [3.5, 4.5, 5.5]) out.push([`CH_O${l}`, MAR.over(ph, l), hy > l ? 1 : 0]);
  for (const l of [2.5, 3.5, 4.5]) out.push([`CA_O${l}`, MAR.over(pa, l), ay > l ? 1 : 0]);
  out.push(['C_MOST_H', MAR.greater(ph, pa), hy > ay ? 1 : 0]);
  out.push(['C_MOST_A', MAR.greater(pa, ph), ay > hy ? 1 : 0]);
  return { ll: -Math.log(Math.max(1e-12, tot[Math.min(T, tot.length - 1)])), sels: out };
}
function cardSels(mu, r, y) {
  const pmf = MAR.nbPmf(mu, r);
  const out = [];
  for (const l of MAR.CARD_LINES) {
    out.push([`K_O${l}`, MAR.over(pmf, l), y > l ? 1 : 0]);
    out.push([`K_U${l}`, 1 - MAR.over(pmf, l), y < l ? 1 : 0]);
  }
  return { ll: -Math.log(Math.max(1e-12, pmf[Math.min(y, pmf.length - 1)])), sels: out };
}
const famOf = (k) => (/^C[HA]_O/.test(k) ? 'C_TEAM_O' : /^C_MOST/.test(k) ? 'C_MOST' : /^C_O/.test(k) ? 'C_O' : /^C_U/.test(k) ? 'C_U' : /^K_O/.test(k) ? 'K_O' : 'K_U');

/** Selections of every corner / card line under one model, for one part. */
function statsSelections(kind, part, how) {
  const out = [];
  let ll = 0;
  let n = 0;
  if (kind === 'corners') {
    const rows = corner[part];
    for (let i = 0; i + 1 < rows.length; i += 2) {
      const h = rows[i];
      const a = rows[i + 1];
      if (!h.meta.pace) continue; // same matches for every model
      const [mh, ma, r] = how(h, a);
      const c = cornerSels(mh, ma, r, h.y, a.y);
      ll += c.ll;
      n++;
      for (const s of c.sels) out.push(s);
    }
  } else {
    for (const row of cards[part]) {
      if (!row.meta.pace) continue;
      const [mu, r] = how(row);
      const c = cardSels(mu, r, row.y);
      ll += c.ll;
      n++;
      for (const s of c.sels) out.push(s);
    }
  }
  return { logLoss: r4(ll / n), n, sels: out };
}
function bins(sels, chance) {
  const o = {};
  for (const [k, p0, y] of sels) {
    const p = chance ? chance(k, p0) : p0;
    if (p < 0.75 || p > 0.92) continue;
    const b = p >= 0.85 ? '85+' : p >= 0.8 ? '80-85' : '75-80';
    const kk = `${famOf(k)} ${b}`;
    const a = (o[kk] = o[kk] || { n: 0, w: 0, p: 0 });
    a.n++;
    a.w += y;
    a.p += p;
  }
  return Object.fromEntries(Object.entries(o).sort().map(([k, a]) => [k, { n: a.n, hit: +(a.w / a.n * 100).toFixed(1), stated: +(a.p / a.n * 100).toFixed(1) }]));
}

report.corners = {};
report.cards = {};
console.log('\n3. Corners and cards (log-loss of the count, same matches for every model)');
for (const part of ['tune', 'test']) {
  report.corners[part] = {};
  report.cards[part] = {};
  const cHow = {
    'site season view': (h) => [h.meta.season[0], h.meta.season[1], h.meta.disp],
    'site recent view': (h) => [h.meta.recent[0], h.meta.recent[1], h.meta.disp],
  };
  for (const [name, f] of Object.entries(fits.corners)) cHow[name] = (h, a) => [predictP(f.b, h, f.nf), predictP(f.b, a, f.nf), f.r];
  for (const [name, how] of Object.entries(cHow)) {
    const s = statsSelections('corners', part, how);
    report.corners[part][name] = { logLoss: s.logLoss, n: s.n };
    console.log(`  ${part} corners ${name.padEnd(28)} n ${s.n} logLoss ${s.logLoss}`);
  }
  const kHow = {
    'site season view': (r) => [r.meta.season, r.meta.disp],
    'site recent view': (r) => [r.meta.recent, r.meta.disp],
  };
  for (const [name, f] of Object.entries(fits.cards)) kHow[name] = (r) => [predictP(f.b, r, f.nf), f.r];
  for (const [name, how] of Object.entries(kHow)) {
    const s = statsSelections('cards', part, how);
    report.cards[part][name] = { logLoss: s.logLoss, n: s.n };
    console.log(`  ${part} cards   ${name.padEnd(28)} n ${s.n} logLoss ${s.logLoss}`);
  }
}

// choose each variant on the TUNING seasons only; the possession variant must beat the plain
// one by EARN, as in the goal markets
const pickBest = (kind) => {
  const t = report[kind].tune;
  const plain = t['form + price'];
  const withP = t['form + price + possession'];
  return withP && plain && plain.logLoss - withP.logLoss >= EARN ? 'form + price + possession' : 'form + price';
};
// FORCE_CORNERS / FORCE_CARDS (variant names) keep the tuning-season choice on a refit
const bestC = process.env.FORCE_CORNERS || pickBest('corners');
const bestK = process.env.FORCE_CARDS || pickBest('cards');
console.log(`  chosen on the tuning seasons: corners "${bestC}", cards "${bestK}"`);
const fc = fits.corners[bestC];
const fk = fits.cards[bestK];

// ------------------------------------------------------------------ 4. corner and card line calibration
const statsTune = [
  ...statsSelections('corners', 'tune', (h, a) => [predictP(fc.b, h, fc.nf), predictP(fc.b, a, fc.nf), fc.r]).sels,
  ...statsSelections('cards', 'tune', (r) => [predictP(fk.b, r, fk.nf), fk.r]).sels,
];
const statsTest = [
  ...statsSelections('corners', 'test', (h, a) => [predictP(fc.b, h, fc.nf), predictP(fc.b, a, fc.nf), fc.r]).sels,
  ...statsSelections('cards', 'test', (r) => [predictP(fk.b, r, fk.nf), fk.r]).sels,
];
const statsCal = {};
for (const fam of ['C_O', 'C_U', 'C_TEAM_O', 'C_MOST', 'K_O', 'K_U']) {
  const rows = statsTune.filter(([k, p]) => famOf(k) === fam && p >= 0.55).map(([, p, y]) => ({ y, x: [1, logit(p)] }));
  if (rows.length < 400) continue;
  const b = logisticFit(rows, 2);
  statsCal[fam] = { a: r4(b[0]), b: r4(b[1]), n: rows.length };
}
const statsChance = (k, p) => {
  const c = statsCal[famOf(k)];
  return c ? sig(c.a + c.b * logit(p)) : p;
};
report.stats = {
  calibration: statsCal,
  tune: { model: bins(statsTune), measured: bins(statsTune, statsChance) },
  test: { model: bins(statsTest), measured: bins(statsTest, statsChance) },
};
console.log('\n4. Corner and card lines: chosen model, then measured');
for (const part of ['tune', 'test']) {
  for (const how of ['model', 'measured']) {
    console.log(`  ${part} ${how}`);
    for (const [k, v] of Object.entries(report.stats[part][how])) console.log(`    ${k.padEnd(16)} n ${String(v.n).padStart(6)} hit ${v.hit.toFixed(1).padStart(5)} stated ${v.stated.toFixed(1).padStart(5)}`);
  }
}

// ------------------------------------------------------------------ the models file
const coef = (names, b, nf) => Object.fromEntries(names.slice(0, nf).map((n, i) => [n, r4(b[i])]));
const models = {
  version: '2.0',
  note: 'Written by research/v6/strongest_fit.js from research/v6/strongest_study.js. Read by lib/strongest/calibrate.js.',
  fitted: { from: '2019-07-01', to: FIT_TO, heldOutFrom: TEST_FROM < '2099' ? TEST_FROM : null },
  goals: possessionEarns ? goalCal : goalCalNoP,
  corners: { variant: bestC, coef: { ...Object.fromEntries(NAMES_C.map((n) => [n, 0])), ...coef(NAMES_C, fc.b, fc.nf) }, dispersion: r4(fc.r) },
  cards: { variant: bestK, coef: { ...Object.fromEntries(NAMES_K.map((n) => [n, 0])), ...coef(NAMES_K, fk.b, fk.nf) }, dispersion: r4(fk.r) },
  stats: statsCal,
};
report.models = models;
if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
if (modelsOut) fs.writeFileSync(modelsOut, JSON.stringify(models, null, 1) + '\n');
console.log('\ncorners', JSON.stringify(models.corners));
console.log('cards', JSON.stringify(models.cards));
