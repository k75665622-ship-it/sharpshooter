'use strict';
/**
 * research/summarise.js — write lib/backtest.json (shown on the Methodology and Tiers tabs) from
 * the v5 and v4 backtest outputs.
 *   node research/summarise.js <methods_v5.json> [methods_v4.json]
 * Without the v4 file, the v4 columns already in lib/backtest.json are kept (the v4 code does
 * not change).
 */
const fs = require('fs');
const path = require('path');
const CORE = require('../lib/methodology/core');
const FILE = path.join(__dirname, '..', 'lib', 'backtest.json');
const v5 = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const v4 = process.argv[3] ? JSON.parse(fs.readFileSync(process.argv[3], 'utf8')) : null;
const prev = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, 'utf8')) : {};
const HOLD = (r) => r.season >= 2023;
const TUNE = (r) => r.season <= 2022;
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
    v4: v4 ? agg(v4.rows.filter((r) => HOLD(r) && r.id === id && r.kept)) : (prev.methods && prev.methods[id] && prev.methods[id].v4) || null,
  };
}
// the tiers (a pick's measured chance, lib/methodology/core.js TIERS): every qualified pick
const days = (f) => new Set(v5.rows.filter(f).map((r) => r.date)).size;
const tiers = CORE.TIERS.map((t) => {
  const of = (f) => v5.rows.filter((r) => f(r) && r.kept && r.status !== 'PAPER' && CORE.tierFor(r.prob) === t.name);
  const H = of(HOLD);
  const T = of(TUNE);
  const held = agg(H);
  const tune = agg(T);
  // picks a match day, pushes (stake back) included
  return {
    name: t.name, min: t.min, label: t.label,
    heldOut: held ? { ...held, perMatchDay: +(H.length / days(HOLD)).toFixed(1) } : null,
    tuning: tune ? { ...tune, perMatchDay: +(T.length / days(TUNE)).toFixed(1) } : null,
  };
});
const G = v5.gen.filter(HOLD);
const mean = (k) => +(G.reduce((a, g) => a + g[k], 0) / G.length).toFixed(4);
const out = {
  dataset: 'Club Football Match Data 2000-2025 (football-data.co.uk results + Bet365 / best-of-17 odds + ClubElo), 18 European divisions',
  heldOut: 'seasons 2023-24 to 2026-27 (not used to fit any v5 parameter)',
  fixtures: G.length,
  rule: `v${CORE.CFG.qualify === 0.7 ? '5.1' : '5.0'}: every hard gate, then ${Math.round(CORE.CFG.qualify * 100)}% of the checklist (draw and correct score 85%)`,
  headline: { v5: agg(v5.rows.filter((r) => HOLD(r) && r.headline)), v4: v4 ? agg(v4.rows.filter((r) => HOLD(r) && r.headline)) : (prev.headline && prev.headline.v4) || null },
  general: {
    bestBet: agg(G.filter((g) => g.key).map((g) => ({ ...g, prob: g.prob }))),
    resultCall: { hitRate: mean('resHit'), statedProb: mean('resProb') },
    predictedScore: { exact: mean('scoreHit'), statedProb: mean('scoreProb') },
    mostLikelyScore: { exact: mean('modeHit') },
  },
  methods,
  tiers,
  generatedAt: new Date().toISOString().slice(0, 10),
};
fs.writeFileSync(FILE, JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out.headline), JSON.stringify(out.general));
