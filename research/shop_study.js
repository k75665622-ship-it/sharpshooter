'use strict';
/**
 * research/shop_study.js — does PRICE SHOPPING make money?
 * Fair price = Bet365 de-vigged (the market consensus stand-in).
 * Bet when the best available price (max of ~17 books) beats fair by >= X%.
 *   node research/shop_study.js <states.json>
 */
const fs = require('fs');
const MK = require('../lib/market');
const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).filter((r) => r.odds.o1 && r.odds.m1 && r.odds.oO && r.odds.mO);
const bets = [];
for (const r of rows) {
  const f1 = MK.fair([r.odds.o1, r.odds.oX, r.odds.o2]);
  const fo = MK.fair([r.odds.oO, r.odds.oU]);
  if (!f1 || !fo) continue;
  const res = { '1': r.hg > r.ag, X: r.hg === r.ag, '2': r.hg < r.ag, O: r.hg + r.ag > 2, U: r.hg + r.ag <= 2 };
  const fair = { '1': f1.probs[0], X: f1.probs[1], '2': f1.probs[2], O: fo.probs[0], U: fo.probs[1] };
  const max = { '1': r.odds.m1, X: r.odds.mX, '2': r.odds.m2, O: r.odds.mO, U: r.odds.mU };
  for (const k of Object.keys(fair)) if (max[k] > 1) bets.push({ season: r.season, key: k, p: fair[k], price: max[k], over: fair[k] * max[k], win: res[k] });
}
const roi = (l) => { if (l.length < 30) return '—'; const pl = l.map((b) => (b.win ? b.price - 1 : -1)); const m = pl.reduce((a, x) => a + x, 0) / pl.length; const sd = Math.sqrt(pl.reduce((a, x) => a + (x - m) ** 2, 0) / (pl.length - 1)); const se = sd / Math.sqrt(pl.length); return `n=${String(l.length).padStart(6)} ROI ${(m * 100).toFixed(2).padStart(6)}% [${((m - 1.96 * se) * 100).toFixed(1)}, ${((m + 1.96 * se) * 100).toFixed(1)}]`; };
for (const [label, f] of [['TUNE', (b) => b.season <= 2022], ['HELD-OUT', (b) => b.season >= 2023]]) {
  console.log('===', label);
  for (const X of [1.0, 1.02, 1.04, 1.06]) {
    const s = bets.filter((b) => f(b) && b.over >= X);
    console.log(`  best price >= fair x${X.toFixed(2)}  all ${roi(s)}`);
    for (const k of ['1', 'X', '2', 'O', 'U']) console.log(`      ${k}: ${roi(s.filter((b) => b.key === k))}`);
  }
  for (const [lo, hi] of [[0, 0.3], [0.3, 0.5], [0.5, 0.65], [0.65, 0.8], [0.8, 1]]) console.log(`  fair prob ${lo}-${hi} (best price >= fair x1.02): ${roi(bets.filter((b) => f(b) && b.over >= 1.02 && b.p >= lo && b.p < hi))}`);
}
