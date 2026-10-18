'use strict';

/**
 * research/edge_study.js — does disagreeing with the bookmaker make money?
 *
 *   node research/edge_study.js <states.json>
 *
 * For every fixture, the calibrated MODEL-ONLY probability (ratings + shots + Elo,
 * never the market) is compared with the Bet365 price. A "bet" is placed when the
 * model's probability is at least R x the price-implied probability. ROI is
 * reported at Bet365 prices and at the best of ~17 books ("Max"), on TUNING and
 * HELD-OUT seasons separately. 95% intervals are normal approximations.
 */

const fs = require('fs');
const M = require('../lib/model');
const MK = require('../lib/market');

const file = process.argv[2];
const cal = JSON.parse(fs.readFileSync(file.replace(/\.json$/, '.calib.json'), 'utf8'));
const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
const full = rows.filter((r) => r.c['dc_0.0025_6'] && r.c.sot && r.elo != null && r.odds.o1 && r.odds.oO);
for (const r of full) {
  const base = r.c['dc_0.0025_6'];
  const T = base.lh + base.la;
  const s = Math.exp((cal.elo.k * (r.elo + cal.elo.ha)) / 400);
  r.c.elo = { lh: (T / 2) * s, la: (T / 2) / s };
}
const W = cal.weights.modelOnly;
const C = cal.calibration.modelOnly;
const sig = (x) => 1 / (1 + Math.exp(-x));
const logit = (p) => { const q = Math.min(0.999, Math.max(0.001, p)); return Math.log(q / (1 - q)); };
const calib = (k, p) => (C[k] ? sig(C[k].a + C[k].b * logit(p)) : p);

function modelProbs(r) {
  let lh = 0, la = 0, s = 0;
  for (const [k, w] of Object.entries(W)) { lh += w * Math.log(r.c[k].lh); la += w * Math.log(r.c[k].la); s += w; }
  lh = Math.exp(lh / s); la = Math.exp(la / s);
  const m = M.scoreMatrix(lh, la, MK.rhoFor(lh + la)).m;
  let h = 0, d = 0, o = 0;
  for (let i = 0; i <= M.MAX_GOALS; i++) for (let j = 0; j <= M.MAX_GOALS; j++) { const p = m[i][j]; if (i > j) h += p; else if (i === j) d += p; if (i + j > 2) o += p; }
  let H = calib('1', h), A = calib('2', 1 - h - d), D = calib('X', d);
  const z = H + D + A; H /= z; D /= z; A /= z;
  const O = calib('O2.5', o);
  return { '1': H, X: D, '2': A, O, U: 1 - O };
}

const bets = [];
for (const r of full) {
  const P = modelProbs(r);
  const res = { '1': r.hg > r.ag, X: r.hg === r.ag, '2': r.hg < r.ag, O: r.hg + r.ag > 2, U: r.hg + r.ag <= 2 };
  const px = { '1': [r.odds.o1, r.odds.m1], X: [r.odds.oX, r.odds.mX], '2': [r.odds.o2, r.odds.m2], O: [r.odds.oO, r.odds.mO], U: [r.odds.oU, r.odds.mU] };
  for (const k of Object.keys(P)) {
    const [b365, max] = px[k];
    if (!(b365 > 1)) continue;
    bets.push({ season: r.season, key: k, p: P[k], ratio: P[k] * b365, b365, max: max > 1 ? max : b365, win: res[k] });
  }
}

function roi(list, priceKey) {
  if (list.length < 30) return null;
  const pl = list.map((b) => (b.win ? b[priceKey] - 1 : -1));
  const m = pl.reduce((a, x) => a + x, 0) / pl.length;
  const sd = Math.sqrt(pl.reduce((a, x) => a + (x - m) ** 2, 0) / (pl.length - 1));
  const se = sd / Math.sqrt(pl.length);
  return { n: list.length, hit: list.filter((b) => b.win).length / list.length, roi: m, lo: m - 1.96 * se, hi: m + 1.96 * se };
}
const fmt = (o) => (o ? `n=${String(o.n).padStart(5)} hit ${(o.hit * 100).toFixed(1)}%  ROI ${(o.roi * 100).toFixed(1).padStart(5)}%  [${(o.lo * 100).toFixed(1)}, ${(o.hi * 100).toFixed(1)}]` : '—');

for (const [label, f] of [['TUNE 2019-22', (b) => b.season <= 2022], ['HELD-OUT 2023-26', (b) => b.season >= 2023]]) {
  console.log(`\n=== ${label}`);
  for (const key of ['1', 'X', '2', 'O', 'U']) {
    console.log(`  market ${key}`);
    for (const R of [0, 1.0, 1.05, 1.1, 1.2, 1.3]) {
      const set = bets.filter((b) => f(b) && b.key === key && (R === 0 || b.ratio >= R));
      console.log(`    edge≥${R ? R.toFixed(2) : 'any '}  B365 ${fmt(roi(set, 'b365'))}   MAX ${fmt(roi(set, 'max'))}`);
    }
  }
}
