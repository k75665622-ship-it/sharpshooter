'use strict';
/** research/report_methods.js — summarise backtest_methods output.  node research/report_methods.js <methods.json> */
const fs = require('fs');
const { rows, gen } = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const fmtPct = (x) => (x == null ? '   —  ' : `${(x * 100).toFixed(1).padStart(5)}%`);
function roi(list, k) {
  const l = list.filter((r) => r[k] > 1 && r.hit != null);
  if (l.length < 25) return { s: '      —        ', n: l.length };
  const pl = l.map((r) => (r.hit ? r[k] - 1 : -1));
  const m = pl.reduce((a, x) => a + x, 0) / pl.length;
  const sd = Math.sqrt(pl.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, pl.length - 1));
  const se = sd / Math.sqrt(pl.length);
  return { s: `${(m * 100).toFixed(1).padStart(5)}% ±${(1.96 * se * 100).toFixed(1).padStart(4)}`, n: l.length, m };
}
function line(label, l) {
  const s = l.filter((r) => r.hit != null);
  const hit = s.length ? s.reduce((a, r) => a + r.hit, 0) / s.length : null;
  const said = s.length ? s.reduce((a, r) => a + r.prob, 0) / s.length : null;
  const b = roi(l, 'b365');
  const x = roi(l, 'max');
  console.log(`  ${label.padEnd(30)} n=${String(s.length).padStart(5)}  hit ${fmtPct(hit)}  said ${fmtPct(said)}  ROI B365 ${b.s} (n=${b.n})  ROI best ${x.s}`);
}
for (const [lab, f] of [['TUNE 2019-22', (r) => r.season <= 2022], ['HELD-OUT 2023-26', (r) => r.season >= 2023]]) {
  console.log(`\n=================== ${lab}`);
  const R = rows.filter(f);
  const ids = [...new Set(R.map((r) => r.id))];
  for (const id of ids) {
    const all = R.filter((r) => r.id === id);
    console.log(`${id}`);
    line('qualified (kept)', all.filter((r) => r.kept));
    line('  of which LOCK', all.filter((r) => r.kept && r.status === 'LOCK'));
    line('  of which PAPER', all.filter((r) => r.kept && r.status === 'PAPER'));
    line('WATCH', all.filter((r) => r.status === 'WATCH'));
    line('REMOVE', all.filter((r) => r.status === 'REMOVE'));
  }
  console.log('HEADLINE per fixture');
  line('headline pick', R.filter((r) => r.headline));
  const G = gen.filter(f);
  console.log('GENERAL prediction');
  line('best bet (all fixtures)', G.filter((g) => g.key));
  line('best bet from methodology', G.filter((g) => g.key && g.src === 'methodology'));
  line('best bet from general rule', G.filter((g) => g.key && g.src === 'general'));
  for (const c of ['High', 'Medium', 'Low']) line(`best bet, confidence ${c}`, G.filter((g) => g.key && g.conf === c));
  const n = G.length;
  const s = (k) => G.reduce((a, g) => a + g[k], 0) / n;
  console.log(`  result call hit ${fmtPct(s('resHit'))} (said ${fmtPct(s('resProb'))})   predicted score exact ${fmtPct(s('scoreHit'))} (said ${fmtPct(s('scoreProb'))})   most-likely score exact ${fmtPct(s('modeHit'))}   n=${n}`);
}
