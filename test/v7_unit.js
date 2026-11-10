'use strict';

/**
 * test/v7_unit.js — the v7 research tools: margin removal (lib/devig.js) and the Asian handicap
 * in the price solve (lib/market.js); and the history of the day's slips (lib/ledger.js
 * slipHistory) the Today page shows. Offline.
 *
 *   node test/v7_unit.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SHARPSHOOTER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-v7-'));

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

console.log('\n4. What became of each day\'s slips');
{
  const LEDGER = require('../lib/ledger');
  const iso = (d) => d.toISOString().slice(0, 10);
  const day = iso(new Date(Date.now() + 2 * 86400e3));
  const ko = new Date(Date.now() + 2 * 86400e3).toISOString();
  const leg = (id, label, prob, price) => ({ fixtureId: id, league: 'eng.1', kickoff: ko, home: `H${id}`, away: `A${id}`, key: 'O1.5', label, prob, best: price, odds: price, takeAt: 1.02 / prob });
  const L = [leg(1, 'Over 1.5 goals', 0.82, 1.25), leg(2, 'Home or Draw', 0.8, 1.27), leg(3, 'Home to win', 0.78, 1.3), leg(4, 'Under 3.5 goals', 0.77, 1.3), leg(5, 'Away or Draw', 0.76, 1.32)];
  const opt = (k) => ({ size: k, name: { 2: 'Double', 3: 'Treble', 4: 'Four-fold' }[k], legs: L.slice(0, k), prob: 0.6, fairOdds: 1.67, bestOdds: 1.6, takeAt: 1.6 });
  const slip = (k, target) => ({ target, legs: L.slice(0, k), size: k, prob: 0.4, odds: target + 0.05, fairOdds: 2.5, estimated: false });
  t('no slips, no history', LEDGER.slipHistory().length === 0);
  LEDGER.recordAcca({ options: [opt(2), opt(3), opt(4)] }, day);
  const main = slip(5, 3);
  LEDGER.recordBanker({ target: 3, bankers: L, slip: main, safer: slip(3, 2), bigger: [slip(5, 5)] }, day);
  const h = LEDGER.slipHistory();
  t('the double, the treble and both banker slips of a day, nothing else', h.length === 1 && h[0].day === day && Object.keys(h[0]).sort().join(',') === 'banker2,banker3,day,double,treble', JSON.stringify(h));
  t('unsettled slips are pending', ['double', 'treble', 'banker2', 'banker3'].every((k) => h[0][k] === 'pending'));
  // settle them by hand, as the settling pass would
  const file = path.join(LEDGER.DIR, `ledger-${day.slice(0, 7)}.json`);
  const book = JSON.parse(fs.readFileSync(file, 'utf8'));
  book[`acca|${day}|2`].hit = 1;
  book[`acca|${day}|3`].hit = 0;
  book[`banker|${day}|safer`].hit = 1;
  book[`banker|${day}`].result = 'void';
  // an older day in the same book
  const old = iso(new Date(Date.parse(day + 'T00:00:00Z') - 86400e3));
  if (old.slice(0, 7) === day.slice(0, 7)) book[`acca|${old}|2`] = { ...book[`acca|${day}|2`], hit: 0 };
  fs.writeFileSync(file, JSON.stringify(book));
  const h2 = LEDGER.slipHistory();
  const d2 = h2.find((x) => x.day === day);
  t('settled slips say won, lost or void', d2.double === 'won' && d2.treble === 'lost' && d2.banker2 === 'won' && d2.banker3 === 'void', JSON.stringify(d2));
  t('newest day first, and the list can be cut short', h2[0].day === day && LEDGER.slipHistory(1).length === 1 && (old.slice(0, 7) !== day.slice(0, 7) || (h2.length === 2 && h2[1].double === 'lost')), JSON.stringify(h2));
}

console.log('\n=========================================================');
console.log(` ${pass} passed, ${fail} failed`);
console.log('=========================================================');
process.exit(fail ? 1 : 0);
