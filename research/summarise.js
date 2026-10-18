'use strict';
/**
 * research/summarise.js — write lib/backtest.json (shown on the Methodology tab) from the
 * v5 and v4 backtest outputs.
 *   node research/summarise.js <methods_v5.json> <methods_v4.json>
 */
const fs = require('fs');
const path = require('path');
const v5 = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const v4 = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const HOLD = (r) => r.season >= 2023;
function agg(list, priceKey = 'b365') {
  const s = list.filter((r) => r.hit === 0 || r.hit === 1);
  if (!s.length) return null;
  const pr = s.filter((r) => r[priceKey] > 1);
  const roi = (k) => { const l = s.filter((r) => r[k] > 1); return l.length >= 25 ? +(l.reduce((a, r) => a + (r.hit ? r[k] - 1 : -1), 0) / l.length).toFixed(4) : null; };
  return {
    n: s.length,
    hitRate: +(s.reduce((a, r) => a + r.hit, 0) / s.length).toFixed(4),
    statedProb: +(s.reduce((a, r) => a + r.prob, 0) / s.length).toFixed(4),
    roiBet365: roi('b365'),
    roiBestPrice: roi('max'),
    priced: pr.length,
  };
}
const ids = [...new Set(v5.rows.map((r) => r.id))];
const methods = {};
for (const id of ids) {
  methods[id] = {
    v5: agg(v5.rows.filter((r) => HOLD(r) && r.id === id && r.kept)),
    v4: agg(v4.rows.filter((r) => HOLD(r) && r.id === id && r.kept)),
  };
}
const G = v5.gen.filter(HOLD);
const mean = (k) => +(G.reduce((a, g) => a + g[k], 0) / G.length).toFixed(4);
const out = {
  dataset: 'Club Football Match Data 2000-2025 (football-data.co.uk results + Bet365 / best-of-17 odds + ClubElo), 18 European divisions',
  heldOut: 'seasons 2023-24 to 2026-27 (not used to fit any v5 parameter)',
  fixtures: G.length,
  headline: { v5: agg(v5.rows.filter((r) => HOLD(r) && r.headline)), v4: agg(v4.rows.filter((r) => HOLD(r) && r.headline)) },
  general: {
    bestBet: agg(G.filter((g) => g.key).map((g) => ({ ...g, prob: g.prob }))),
    resultCall: { hitRate: mean('resHit'), statedProb: mean('resProb') },
    predictedScore: { exact: mean('scoreHit'), statedProb: mean('scoreProb') },
    mostLikelyScore: { exact: mean('modeHit') },
  },
  methods,
  generatedAt: new Date().toISOString().slice(0, 10),
};
fs.writeFileSync(path.join(__dirname, '..', 'lib', 'backtest.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out.headline), JSON.stringify(out.general));
