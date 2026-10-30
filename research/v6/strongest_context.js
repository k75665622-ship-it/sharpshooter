'use strict';

/**
 * research/v6/strongest_context.js — where do high-probability selections let us down?
 *
 *   node research/v6/strongest_context.js <strongest_dump.jsonl> <fit.json> [minN=300]
 *
 * For every market family, every selection rated 75-90% (by the measured chance from
 * research/v6/strongest_fit.js, or the market view where there is none) is split by context:
 *
 *   tier      top five leagues / their second divisions / the rest
 *   month     Jul-Sep, Oct-Dec, Jan-Mar, Apr-Jun (early season, run-in)
 *   fav       the favourite's win chance from the price (<45%, 45-60%, 60-75%, 75%+)
 *   goals     expected total goals from the price (<2.3, 2.3-2.7, 2.7-3.1, 3.1+)
 *   side      home or away team (team markets)
 *
 * and the gap between what happened and what was stated is printed for the tuning seasons and
 * the held-out seasons side by side. A context is only worth a rule when the gap is large,
 * has the same sign in both periods, and rests on enough selections.
 */

const fs = require('fs');

const [, , file, fitFile, minArg] = process.argv;
const MIN_N = Number(minArg || 300);
const SPLIT = '2023-07-01';
const fit = fitFile ? JSON.parse(fs.readFileSync(fitFile, 'utf8')) : {};
const GC = (fit.goals && (fit.goals.calibration || fit.goals)) || {}; // a fit report or a models file
const sig = (x) => 1 / (1 + Math.exp(-x));
const logit = (p) => {
  const q = Math.min(0.999, Math.max(0.001, p));
  return Math.log(q / (1 - q));
};
const FAMILY = (k) => {
  let m;
  if ((m = /^TT([HA])_([OU])(\d\.5)$/.exec(k))) return `TT_${m[2]}${m[3]}`;
  if (/^C[HA]_O/.test(k)) return 'C_TEAM_O';
  if (/^C_MOST/.test(k)) return 'C_MOST';
  if ((m = /^C_([OU])/.exec(k))) return `C_${m[1]}`;
  if ((m = /^K_([OU])/.exec(k))) return `K_${m[1]}`;
  if (k === '1X' || k === 'X2') return 'DC';
  if (k === '1' || k === '2') return 'WIN';
  return k;
};
const TOP = new Set(['E0', 'SP1', 'I1', 'D1', 'F1']);
const SECOND = new Set(['E1', 'SP2', 'I2', 'D2', 'F2']);

const acc = {};
function add(fam, ctx, part, p, y) {
  const k = `${fam}|${ctx}`;
  const a = (acc[k] = acc[k] || { tune: { n: 0, w: 0, p: 0 }, test: { n: 0, w: 0, p: 0 } });
  a[part].n++;
  a[part].w += y;
  a[part].p += p;
}

for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!line) continue;
  const r = JSON.parse(line);
  const part = r.d < SPLIT ? 'tune' : 'test';
  const x = r.x || {};
  const pr = x.pr || [];
  const mk = x.mk || [];
  const fav = pr[0] != null && pr[2] != null ? Math.max(pr[0], pr[2]) : null;
  const T = mk[0] != null ? mk[0] + mk[1] : null;
  const mon = Number(r.d.slice(5, 7));
  const ctxs = [
    `tier:${TOP.has(r.div) ? 'top5' : SECOND.has(r.div) ? 'second' : 'other'}`,
    `month:${mon >= 7 && mon <= 9 ? 'Jul-Sep' : mon >= 10 ? 'Oct-Dec' : mon <= 3 ? 'Jan-Mar' : 'Apr-Jun'}`,
    fav != null ? `fav:${fav < 0.45 ? '<45' : fav < 0.6 ? '45-60' : fav < 0.75 ? '60-75' : '75+'}` : null,
    T != null ? `goals:${T < 2.3 ? '<2.3' : T < 2.7 ? '2.3-2.7' : T < 3.1 ? '2.7-3.1' : '3.1+'}` : null,
  ].filter(Boolean);
  for (const [key, , , v, res] of r.s) {
    if (res == null || v.m == null) continue;
    const c = GC[key];
    let p = v.m;
    if (c) {
      const lm = logit(v.m);
      p = sig(c.a + c.b * lm + c.c * (v.f != null ? logit(v.f) - lm : 0) + c.d * (v.s != null ? logit(v.s) - lm : 0));
    }
    if (p < 0.75 || p > 0.9) continue;
    const fam = FAMILY(key);
    add(fam, 'all', part, p, res);
    for (const cx of ctxs) add(fam, cx, part, p, res);
    const sm = /^TT([HA])_/.exec(key);
    if (sm) add(fam, `side:${sm[1] === 'H' ? 'home' : 'away'}`, part, p, res);
    if (key === '1X' || key === 'X2') add(fam, `side:${key === '1X' ? 'home' : 'away'}`, part, p, res);
  }
}

const gap = (a) => (a.n ? ((a.w - a.p) / a.n) * 100 : null);
const fams = [...new Set(Object.keys(acc).map((k) => k.split('|')[0]))].sort((a, b) => acc[`${b}|all`].tune.n - acc[`${a}|all`].tune.n);
for (const fam of fams) {
  const all = acc[`${fam}|all`];
  if (all.tune.n < MIN_N) continue;
  console.log(`\n${fam}  tune n ${all.tune.n} gap ${gap(all.tune).toFixed(1)} | held-out n ${all.test.n} gap ${all.test.n ? gap(all.test).toFixed(1) : '—'}`);
  for (const k of Object.keys(acc).filter((k) => k.startsWith(fam + '|') && !k.endsWith('|all')).sort()) {
    const a = acc[k];
    if (a.tune.n < MIN_N / 3) continue;
    const g1 = gap(a.tune);
    const g2 = gap(a.test);
    const flag = g2 != null && Math.sign(g1) === Math.sign(g2) && Math.abs(g1) >= 2 && Math.abs(g2) >= 2 ? '  <<' : '';
    console.log(`   ${k.split('|')[1].padEnd(16)} tune n ${String(a.tune.n).padStart(6)} stated ${(a.tune.p / a.tune.n * 100).toFixed(1)} gap ${g1 >= 0 ? '+' : ''}${g1.toFixed(1).padStart(4)} | held-out n ${String(a.test.n).padStart(6)} gap ${g2 == null ? '  —' : (g2 >= 0 ? '+' : '') + g2.toFixed(1)}${flag}`);
  }
}
