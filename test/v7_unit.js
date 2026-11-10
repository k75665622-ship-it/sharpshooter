'use strict';

/**
 * test/v7_unit.js — the v7 research tools: margin removal (lib/devig.js) and the Asian handicap
 * in the price solve (lib/market.js). Offline, pure maths.
 *
 *   node test/v7_unit.js
 */

const DV = require('../lib/devig');
const MK = require('../lib/market');
const M = require('../lib/model');

let pass = 0;
let fail = 0;
function t(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail != null ? ' — ' + detail : ''}`);
  }
}
const near = (a, b, tol = 1e-6) => a != null && b != null && Math.abs(a - b) <= tol;
const sum = (a) => a.reduce((x, y) => x + y, 0);

console.log('\n1. Removing the margin');
{
  const odds = [1.3, 5.5, 10]; // a strong favourite, 6.9% margin
  const all = { proportional: DV.proportional(odds), power: DV.power(odds), shin: DV.shin(odds), oddsRatio: DV.oddsRatio(odds), blend: DV.blend(odds) };
  t('every method returns probabilities that sum to one', Object.values(all).every((p) => near(sum(p), 1, 1e-9)), JSON.stringify(all));
  t('every method keeps the order of the prices', Object.values(all).every((p) => p[0] > p[1] && p[1] > p[2]));
  t('power, Shin and odds ratio rate the favourite above the proportional share (the outsider carries more margin)',
    all.power[0] > all.proportional[0] && all.shin[0] > all.proportional[0] && all.oddsRatio[0] > all.proportional[0], `${all.proportional[0]} ${all.power[0]} ${all.shin[0]}`);
  t('the blend sits between proportional and power', all.blend[0] > all.proportional[0] && all.blend[0] < all.power[0]);
  const fairOdds = [2, 4, 4];
  t('prices with no margin come back unchanged', ['proportional', 'power', 'shin', 'oddsRatio'].every((k) => DV[k](fairOdds).every((p, i) => near(p, 1 / fairOdds[i], 1e-6))));
  t('two-way prices work too', near(sum(DV.power([1.9, 1.9])), 1, 1e-9) && near(DV.shin([1.9, 1.9])[0], 0.5, 1e-9));
  t('a bad price gives null, not a guess', DV.power([1.5, 0.9, 4]) === null && DV.shin([]) === null && DV.proportional(null) === null);
}

console.log('\n2. The Asian handicap as one number');
{
  const even = M.scoreMatrix(1.3, 1.3, 0).m;
  t('level sides, level handicap: a coin flip (the draw is a push)', near(MK.handicapCover(even, 0), 0.5, 1e-9));
  const fav = M.scoreMatrix(2.0, 0.8, 0).m;
  let win = 0;
  let draw = 0;
  let lose = 0;
  for (let i = 0; i < fav.length; i++) for (let j = 0; j < fav[i].length; j++) {
    if (i > j) win += fav[i][j];
    else if (i === j) draw += fav[i][j];
    else lose += fav[i][j];
  }
  t('home -0.5 is the home win', near(MK.handicapCover(fav, -0.5), win, 1e-9));
  t('home +0.5 is the home win or draw', near(MK.handicapCover(fav, 0.5), win + draw, 1e-9));
  t('home 0 (draw no bet) leaves the draw out', near(MK.handicapCover(fav, 0), win / (win + lose), 1e-9));
  t('home -0.25: a draw loses half the stake', near(MK.handicapCover(fav, -0.25), win / (win + lose + 0.5 * draw), 1e-9));
  t('home +0.25: a draw wins half the stake', near(MK.handicapCover(fav, 0.25), (win + 0.5 * draw) / (win + 0.5 * draw + lose), 1e-9));
  t('a bigger start is easier to cover', MK.handicapCover(fav, -1.5) < MK.handicapCover(fav, -1) && MK.handicapCover(fav, -1) < MK.handicapCover(fav, -0.5));
}

console.log('\n3. The price solve');
{
  const truth = { lamH: 1.85, lamA: 0.95 };
  const q = MK.implied(truth.lamH, truth.lamA, 2.5, -0.75);
  const plain = MK.solveLambdas({ home: q.h, draw: q.d, away: q.a }, { line: 2.5, over: q.over });
  t('1X2 + Over/Under recover the expected goals they came from', near(plain.lamH, truth.lamH, 1e-3) && near(plain.lamA, truth.lamA, 1e-3), `${plain.lamH} ${plain.lamA}`);
  const withAh = MK.solveLambdas({ home: q.h, draw: q.d, away: q.a }, { line: 2.5, over: q.over }, { handicap: { line: -0.75, home: q.cover, weight: 1 } });
  t('a consistent handicap price changes nothing', near(withAh.lamH, truth.lamH, 1e-3) && near(withAh.lamA, truth.lamA, 1e-3) && near(withAh.fitted.cover, q.cover, 1e-4));
  const ahOnly = MK.solveLambdas(null, { line: 2.5, over: q.over }, { handicap: { line: -0.75, home: q.cover, weight: 2 } });
  t('handicap + total alone recover them as well', ahOnly && near(ahOnly.lamH, truth.lamH, 2e-2) && near(ahOnly.lamA, truth.lamA, 2e-2), ahOnly && `${ahOnly.lamH} ${ahOnly.lamA}`);
  const pulled = MK.solveLambdas({ home: q.h, draw: q.d, away: q.a }, { line: 2.5, over: q.over }, { handicap: { line: -0.75, home: q.cover + 0.06, weight: 2 } });
  t('a handicap price that rates the home side higher pulls the gap wider', pulled.lamH - pulled.lamA > plain.lamH - plain.lamA);
  t('no 1X2 and no handicap: nothing to solve', MK.solveLambdas(null, { line: 2.5, over: 0.5 }) === null);
  t('the engine\'s solve is unchanged without the option', near(MK.solveLambdas({ home: 0.5, draw: 0.27, away: 0.23 }, { line: 2.5, over: 0.52 }).lamH, 1.674, 2e-3));
}

console.log('\n=========================================================');
console.log(` ${pass} passed, ${fail} failed`);
console.log('=========================================================');
process.exit(fail ? 1 : 0);
