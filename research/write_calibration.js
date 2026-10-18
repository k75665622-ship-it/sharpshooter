'use strict';
/**
 * research/write_calibration.js — assemble lib/calibration.json from the research outputs.
 *   node research/write_calibration.js <states.calib_all.json> <states.score.json>
 * Weights: the measured optimum market share was 1.00; production uses 0.90 (costs ~0.05%
 * log-loss) so verified late information in the model components can still move the line.
 */
const fs = require('fs');
const c = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const s = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const out = {
  version: '5.0',
  source: 'research/ on 46,121 fixtures (18 European divisions, Bet365 odds, 2019-20..2026-27). '
    + 'Methods validated on held-out 2023-26 after fitting on 2019-23; production constants then refitted on all seasons.',
  elo: { k: +c.elo.k.toFixed(2), homeAdv: c.elo.ha },
  weights: { marketShare: 0.9, marketShareMeasuredOptimum: 1.0, model: { ratings: 0.3, xg: 0.35, elo: 0.35 } },
  calibration: c.calibration,
  score: { drawInflation: s.drawInflation, rho: s.rho },
  fittedOn: c.fittedOn,
};
fs.writeFileSync(require('path').join(__dirname, '..', 'lib', 'calibration.json'), JSON.stringify(out, null, 2) + '\n');
console.log('wrote lib/calibration.json');
