'use strict';
/** research/agree_study.js — conditional on the market's probability, does model agreement add accuracy?
 *   node research/agree_study.js <states.json> */
const fs = require('fs');
const M = require('../lib/model');
const MK = require('../lib/market');
const file = process.argv[2];
const cal = JSON.parse(fs.readFileSync(file.replace(/\.json$/, '.calib.json'), 'utf8'));
const rows = JSON.parse(fs.readFileSync(file, 'utf8')).filter((r) => r.c.mkt && r.c['dc_0.0025_6'] && r.c.sot && r.elo != null);
const W = cal.weights.modelOnly;
const probsOf = (lh, la) => { const m = M.scoreMatrix(lh, la, MK.rhoFor(lh + la)).m; let h = 0, d = 0, o = 0, b = 0; for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) { const p = m[i][j]; if (i > j) h += p; else if (i === j) d += p; if (i + j > 2) o += p; if (i && j) b += p; } return { '1': h, X: d, '2': 1 - h - d, O: o, U: 1 - o, BY: b, BN: 1 - b }; };
const out = [];
for (const r of rows) {
  const base = r.c['dc_0.0025_6']; const T = base.lh + base.la; const s = Math.exp((cal.elo.k * (r.elo + cal.elo.ha)) / 400);
  const elo = { lh: (T / 2) * s, la: (T / 2) / s };
  const comps = { 'dc_0.0025_6': base, sot: r.c.sot, elo };
  let lh = 0, la = 0, z = 0; for (const [k, w] of Object.entries(W)) { lh += w * Math.log(comps[k].lh); la += w * Math.log(comps[k].la); z += w; }
  const mo = probsOf(Math.exp(lh / z), Math.exp(la / z));
  const mk = probsOf(r.c.mkt.lh, r.c.mkt.la);
  const res = { '1': r.hg > r.ag, X: r.hg === r.ag, '2': r.hg < r.ag, O: r.hg + r.ag > 2, U: r.hg + r.ag <= 2, BY: r.hg > 0 && r.ag > 0, BN: !(r.hg > 0 && r.ag > 0) };
  for (const k of Object.keys(res)) out.push({ k, mk: mk[k], mo: mo[k], win: res[k] });
}
for (const k of ['1', '2', 'O', 'U', 'BY', 'BN']) {
  for (const [lo, hi] of [[0.55, 0.62], [0.62, 0.7], [0.7, 0.8]]) {
    const s = out.filter((x) => x.k === k && x.mk >= lo && x.mk < hi);
    if (s.length < 200) continue;
    const agree = s.filter((x) => x.mo >= lo); const dis = s.filter((x) => x.mo < lo - 0.05);
    const hr = (l) => (l.length ? `${(100 * l.filter((x) => x.win).length / l.length).toFixed(1)}% (n=${l.length}, said ${(100 * l.reduce((a, x) => a + x.mk, 0) / l.length).toFixed(1)})` : '—');
    console.log(`${k.padEnd(2)} market ${lo}-${hi}: model agrees ${hr(agree)}   model disagrees by 5+pts ${hr(dis)}`);
  }
}
