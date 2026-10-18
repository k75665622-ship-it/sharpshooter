'use strict';
/**
 * research/score_study.js — tune the exact-score distribution and the final-score pick rule.
 *   node research/score_study.js <states.json>
 * 1. Dixon-Coles rho and a draw-diagonal inflation factor, fitted on tuning seasons by exact-score log-loss.
 * 2. Which "predicted final score" rule hits exactly most often on held-out seasons.
 */
const fs = require('fs');
const M = require('../lib/model');
const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).filter((r) => r.c.mkt && r.hg <= 10 && r.ag <= 10);
const tune = rows.filter((r) => r.season <= 2022 && r.c.mkt);
const hold = rows.filter((r) => r.season >= 2023 && r.c.mkt);
function mat(lh, la, rho, infl) {
  const sm = M.scoreMatrix(lh, la, rho);
  let z = 0;
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) { if (i === j) sm.m[i][j] *= infl; z += sm.m[i][j]; }
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) sm.m[i][j] /= z;
  return sm.m;
}
const ll = (set, rho, infl) => set.reduce((a, r) => a - Math.log(Math.max(1e-9, mat(r.c.mkt.lh, r.c.mkt.la, rho(r), infl)[r.hg][r.ag])), 0) / set.length;
const cur = (r) => M.clamp(-0.05 * (2.6 / Math.max(1.8, r.c.mkt.lh + r.c.mkt.la)), -0.1, -0.02);
const sub = tune.filter((_, i) => i % 3 === 0);
console.log('current rho rule: tune', ll(sub, cur, 1).toFixed(5), 'held-out', ll(hold, cur, 1).toFixed(5));
let best = null;
for (let rho = -0.16; rho <= 0.0001; rho += 0.02) for (let infl = 1.0; infl <= 1.12; infl += 0.02) {
  const v = ll(sub, () => rho, infl);
  if (!best || v < best.v) best = { rho, infl, v };
}
console.log('best constant rho', best.rho.toFixed(2), 'draw inflation', best.infl.toFixed(2), 'tune', best.v.toFixed(5), 'held-out', ll(hold, () => best.rho, best.infl).toFixed(5));
const RHO = () => best.rho; const INF = best.infl;

// ---- final score pick rules, on held-out
const rules = {
  mode: (m) => { let b = null; for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) if (!b || m[i][j] > b.p) b = { i, j, p: m[i][j] }; return b; },
  coherent: (m) => {
    let h = 0, d = 0, o = 0; for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) { const p = m[i][j]; if (i > j) h += p; else if (i === j) d += p; if (i + j > 2) o += p; }
    const a = 1 - h - d; const out = h >= d && h >= a ? 'h' : a >= d ? 'a' : 'd'; const over = o >= 0.5;
    let b = null; for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) {
      const oc = i > j ? 'h' : i === j ? 'd' : 'a'; if (oc !== out || (i + j > 2) !== over) continue;
      if (!b || m[i][j] > b.p) b = { i, j, p: m[i][j] };
    }
    return b || rules.mode(m);
  },
  outcomeMode: (m) => {
    let h = 0, d = 0; for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) { const p = m[i][j]; if (i > j) h += p; else if (i === j) d += p; }
    const a = 1 - h - d; const out = h >= d && h >= a ? 'h' : a >= d ? 'a' : 'd';
    let b = null; for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) { const oc = i > j ? 'h' : i === j ? 'd' : 'a'; if (oc !== out) continue; if (!b || m[i][j] > b.p) b = { i, j, p: m[i][j] }; }
    return b;
  },
};
for (const [name, f] of Object.entries(rules)) {
  let exact = 0, outc = 0, tot = 0, gd = 0, top3 = 0, said = 0;
  for (const r of hold) {
    const m = mat(r.c.mkt.lh, r.c.mkt.la, RHO(r), INF);
    const s = f(m);
    said += s.p;
    if (s.i === r.hg && s.j === r.ag) exact++;
    const oc = (x, y) => (x > y ? 'h' : x === y ? 'd' : 'a');
    if (oc(s.i, s.j) === oc(r.hg, r.ag)) outc++;
    if ((s.i + s.j > 2) === (r.hg + r.ag > 2)) tot++;
    if (s.i - s.j === r.hg - r.ag) gd++;
    const all = []; for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) all.push({ i, j, p: m[i][j] }); all.sort((a, b) => b.p - a.p);
    if (all.slice(0, 3).some((x) => x.i === r.hg && x.j === r.ag)) top3++;
  }
  const n = hold.length; const P = (x) => (100 * x / n).toFixed(1) + '%';
  console.log(`${name.padEnd(12)} exact ${P(exact)} (said ${P(said)})  outcome ${P(outc)}  O/U2.5 ${P(tot)}  goal-diff ${P(gd)}  top-3 contains ${P(top3)}  n=${n}`);
}
fs.writeFileSync(process.argv[2].replace(/\.json$/, '.score.json'), JSON.stringify({ rho: best.rho, drawInflation: best.infl }));
