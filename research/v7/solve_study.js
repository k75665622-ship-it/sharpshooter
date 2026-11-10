'use strict';

/**
 * research/v7/solve_study.js — how should the bookmakers' prices be turned into expected goals?
 *
 *   node research/v7/solve_study.js <Matches.csv> [out.json] [from=2019-07-01]
 *
 * For every match with a Bet365 1X2 price, an Over/Under 2.5 price and an Asian handicap line,
 * the pair of expected goals (home, away) is solved several ways, the score grid built, and the
 * markets the site derives from it (team goals, both teams to score, other goal lines, double
 * chance, two-goal wins, the exact score) scored on the real result. Log-loss, lower is better;
 * raw, and after a one-slope calibration fitted on the tuning seasons only (as the engine does).
 *
 * Variants
 *   v6        the engine up to v6: blend de-vig, 1X2 + Over/Under 2.5
 *   power     power de-vig, 1X2 + Over/Under 2.5
 *   power+AH  power de-vig, 1X2 + Over/Under 2.5 + the Asian handicap line (weights 1 and 2)
 *   AH only   Over/Under 2.5 + the Asian handicap line, no 1X2 (what the handicap knows alone)
 */

const fs = require('fs');
const DV = require('../../lib/devig');
const MK = require('../../lib/market');

const args = process.argv.slice(2);
const [file, outFile, fromArg] = args;
const FROM = fromArg || '2019-07-01';
const SPLIT = '2023-07-01';
const NG = 10;

const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
const H = lines[0].split(',');
const ix = (n) => H.indexOf(n);
const I = { date: ix('MatchDate'), hg: ix('FTHome'), ag: ix('FTAway'), h: ix('OddHome'), d: ix('OddDraw'), a: ix('OddAway'), o: ix('Over25'), u: ix('Under25'), al: ix('HandiSize'), ah: ix('HandiHome'), aa: ix('HandiAway') };
const num = (v) => (v === '' || v == null ? null : Number(v));
const odd = (v) => {
  const x = num(v);
  return x != null && x > 1.0001 ? x : null;
};

const VARIANTS = {
  v6: { devig: (o) => DV.blend(o, 0.6), ah: 0, x12: 1 },
  power: { devig: DV.power, ah: 0, x12: 1 },
  'power+AH w1': { devig: DV.power, ah: 1, x12: 1 },
  'power+AH w2': { devig: DV.power, ah: 2, x12: 1 },
  'AH only': { devig: DV.power, ah: 2, x12: 0 },
};

const KEYS = {
  '1': (h, a) => h > a, X: (h, a) => h === a, '2': (h, a) => h < a,
  '1X': (h, a) => h >= a, X2: (h, a) => a >= h, 12: (h, a) => h !== a,
  'O1.5': (h, a) => h + a > 1.5, 'O2.5': (h, a) => h + a > 2.5, 'O3.5': (h, a) => h + a > 3.5,
  BTTS_Y: (h, a) => h > 0 && a > 0,
  'TTH_O0.5': (h) => h >= 1, 'TTH_O1.5': (h) => h >= 2, 'TTH_O2.5': (h) => h >= 3,
  'TTA_O0.5': (_h, a) => a >= 1, 'TTA_O1.5': (_h, a) => a >= 2, 'TTA_O2.5': (_h, a) => a >= 3,
  WIN2: (h, a) => Math.abs(h - a) >= 2,
  DNB_H: null, // settled apart (draws are void)
};

const rows = [];
for (let i = 1; i < lines.length; i++) {
  if (!lines[i]) continue;
  const c = lines[i].split(',');
  const date = c[I.date];
  if (!date || date < FROM) continue;
  const hg = num(c[I.hg]);
  const ag = num(c[I.ag]);
  const o = [odd(c[I.h]), odd(c[I.d]), odd(c[I.a])];
  const ou = [odd(c[I.o]), odd(c[I.u])];
  const al = num(c[I.al]);
  const ah = [odd(c[I.ah]), odd(c[I.aa])];
  if (hg == null || ag == null || !o.every(Boolean) || !ou.every(Boolean) || al == null || !ah.every(Boolean)) continue;
  rows.push({ date, hg, ag, o, ou, al, ah });
}
console.log(`${rows.length} matches with 1X2, Over/Under 2.5 and an Asian handicap line, from ${FROM}`);

const sig = (x) => 1 / (1 + Math.exp(-x));
const logit = (p) => {
  const q = Math.min(0.9995, Math.max(0.0005, p));
  return Math.log(q / (1 - q));
};
/** logit(y) = a + b logit(p), Newton. */
function fitCal(ps, ys) {
  let a = 0;
  let b = 1;
  const xs = ps.map(logit);
  for (let it = 0; it < 25; it++) {
    let g0 = 0;
    let g1 = 0;
    let h00 = 0;
    let h01 = 0;
    let h11 = 0;
    for (let i = 0; i < xs.length; i++) {
      const p = sig(a + b * xs[i]);
      const e = p - ys[i];
      const w = p * (1 - p);
      g0 += e;
      g1 += e * xs[i];
      h00 += w;
      h01 += w * xs[i];
      h11 += w * xs[i] * xs[i];
    }
    const det = h00 * h11 - h01 * h01;
    if (!(Math.abs(det) > 1e-12)) break;
    a -= (h11 * g0 - h01 * g1) / det;
    b -= (-h01 * g0 + h00 * g1) / det;
  }
  return { a, b };
}

const report = {};
for (const [name, V] of Object.entries(VARIANTS)) {
  const t0 = Date.now();
  const P = {}; // key -> { tune: {p:[], y:[]}, held: {...} }
  for (const k of Object.keys(KEYS)) P[k] = { tune: { p: [], y: [] }, held: { p: [], y: [] } };
  const cs = { tune: { n: 0, ll: 0 }, held: { n: 0, ll: 0 } };
  const lam = { tune: { n: 0, h: 0, a: 0 }, held: { n: 0, h: 0, a: 0 } };
  for (const r of rows) {
    const part = r.date < SPLIT ? 'tune' : 'held';
    const p = V.devig(r.o);
    const t = V.devig(r.ou);
    const hp = DV.power(r.ah);
    const sol = MK.solveLambdas(
      V.x12 ? { home: p[0], draw: p[1], away: p[2] } : null,
      { line: 2.5, over: t[0] },
      { handicap: V.ah ? { line: r.al, home: hp[0], weight: V.ah } : null, x12Guess: { home: p[0], draw: p[1], away: p[2] } },
    );
    if (!sol) continue;
    const grid = MK.grid(sol.lamH, sol.lamA);
    lam[part].n++;
    lam[part].h += sol.lamH;
    lam[part].a += sol.lamA;
    for (const [k, f] of Object.entries(KEYS)) {
      if (!f) continue;
      let s = 0;
      for (let i = 0; i <= NG; i++) for (let j = 0; j <= NG; j++) if (f(i, j)) s += grid[i][j];
      P[k][part].p.push(s);
      P[k][part].y.push(f(r.hg, r.ag) ? 1 : 0);
    }
    if (r.hg !== r.ag) {
      let h = 0;
      let a = 0;
      for (let i = 0; i <= NG; i++) for (let j = 0; j <= NG; j++) {
        if (i > j) h += grid[i][j];
        else if (i < j) a += grid[i][j];
      }
      P.DNB_H[part].p.push(h / (h + a));
      P.DNB_H[part].y.push(r.hg > r.ag ? 1 : 0);
    }
    cs[part].n++;
    cs[part].ll -= Math.log(Math.max(1e-5, r.hg <= NG && r.ag <= NG ? grid[r.hg][r.ag] : 1e-5));
  }
  const out = {};
  for (const [k, d] of Object.entries(P)) {
    const ll = (ps, ys, cal) => {
      let s = 0;
      for (let i = 0; i < ps.length; i++) {
        const p = cal ? sig(cal.a + cal.b * logit(ps[i])) : Math.min(0.9995, Math.max(0.0005, ps[i]));
        s -= ys[i] ? Math.log(p) : Math.log(1 - p);
      }
      return s / ps.length;
    };
    const cal = fitCal(d.tune.p, d.tune.y);
    out[k] = { n: [d.tune.p.length, d.held.p.length], rawTune: ll(d.tune.p, d.tune.y), rawHeld: ll(d.held.p, d.held.y), calTune: ll(d.tune.p, d.tune.y, cal), calHeld: ll(d.held.p, d.held.y, cal), cal };
  }
  out.SCORE = { n: [cs.tune.n, cs.held.n], rawTune: cs.tune.ll / cs.tune.n, rawHeld: cs.held.ll / cs.held.n };
  report[name] = out;
  console.log(`${name}: ${((Date.now() - t0) / 1000).toFixed(0)}s  mean goals tune ${(lam.tune.h / lam.tune.n).toFixed(3)}-${(lam.tune.a / lam.tune.n).toFixed(3)} held ${(lam.held.h / lam.held.n).toFixed(3)}-${(lam.held.a / lam.held.n).toFixed(3)}`);
}

const base = report.v6;
const names = Object.keys(report).filter((n) => n !== 'v6');
console.log(`\nLog-loss against v6, % (negative = better).  raw tune / raw held | calibrated tune / calibrated held`);
console.log(`${'market'.padEnd(10)} ${'v6 (abs, held cal)'.padEnd(20)} ${names.map((n) => n.padEnd(34)).join(' ')}`);
for (const k of [...Object.keys(KEYS), 'SCORE']) {
  const b = base[k];
  const cell = (r) => {
    const d = (x, y) => (x == null || y == null ? '   —  ' : `${((x / y - 1) * 100 >= 0 ? '+' : '') + ((x / y - 1) * 100).toFixed(3)}`);
    return `${d(r.rawTune, b.rawTune)}/${d(r.rawHeld, b.rawHeld)} | ${d(r.calTune, b.calTune)}/${d(r.calHeld, b.calHeld)}`.padEnd(34);
  };
  console.log(`${k.padEnd(10)} ${String((b.calHeld != null ? b.calHeld : b.rawHeld).toFixed(5)).padEnd(20)} ${names.map((n) => cell(report[n][k])).join(' ')}`);
}
if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 1));
