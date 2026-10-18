'use strict';
// Offline checks for the football-data loader and the price backtest maths.
const FD = require('./lib/fdata');
const PB = require('./lib/pricebacktest');

let pass = 0, fail = 0;
const t = (name, ok, extra) => { if (ok) { pass++; console.log('  PASS  ' + name); } else { fail++; console.log('  FAIL  ' + name + (extra ? ' — ' + extra : '')); } };

console.log('\n1. CSV parsing');
const csv = '﻿Div,Date,HomeTeam,AwayTeam,FTHG,FTAG,AvgCH,AvgCD,AvgCA,AvgC>2.5,AvgC<2.5,AHCh,AvgCAHH,AvgCAHA\nE0,16/08/25,Arsenal,"Man, United",1,0,1.5,4.2,6.5,1.8,2.05,-1,1.95,1.9\nE0,17/08/25,A,B,,,1.5,4,6,1.8,2,0,1.9,1.9\n';
const rows = FD.parseCsv(csv).map(FD.toMatch).filter(Boolean);
t('BOM stripped and quoted comma kept', rows.length === 1 && rows[0].home === 'Man, United'.replace('Man, United', rows[0].home) && rows[0].home === 'Arsenal' && rows[0].away === 'Man, United');
t('unplayed rows are dropped', rows.length === 1);
t('date parsed dd/mm/yy', rows[0].date === '2025-08-16');
t('closing prices chosen', rows[0].odds['1'] === 1.5 && rows[0].odds['O2.5'] === 1.8 && rows[0].odds['U2.5'] === 2.05);
t('asian handicap parsed as home line', rows[0].ah && rows[0].ah.line === -1 && rows[0].ah.home === 1.95 && rows[0].ah.away === 1.9);
const fb = FD.toMatch({ Date: '01/02/2024', Home: 'X', Away: 'Y', HG: '2', AG: '2', PH: '2.1', PD: '3.4', PA: '3.6' });
const mx = FD.toMatch({ Date: '01/02/2024', Home: 'X', Away: 'Y', HG: '1', AG: '0', AvgH: '2.0', MaxH: '2.2', AvgD: '3', MaxD: '3.3', AvgA: '3', MaxA: '3.1' });
t('best (max) prices parsed', mx.maxOdds['1'] === 2.2 && mx.maxOdds.X === 3.3);
t('new-layout file parses with fallback columns', fb && fb.odds['1'] === 2.1 && fb.odds.X === 3.4 && fb.odds['O2.5'] == null && fb.ah == null);

console.log('\n2. settlement and ROI');
t('Over 2.5', PB.settle('O2.5', 2, 1) === 1 && PB.settle('O2.5', 1, 1) === 0);
t('AH push returns null', PB.settle('AH_H_-1', 2, 1) === null);
t('AH half line never pushes', PB.settle('AH_H_-0.5', 1, 0) === 1 && PB.settle('AH_A_-0.5', 1, 0) === 0);
const r = PB.roi([{ profit: 1, hit: 1, price: 2 }, { profit: -1, hit: 0, price: 2 }, { profit: -1, hit: 0, price: 2 }, { profit: 1, hit: 1, price: 2 }]);
t('ROI maths', Math.abs(r.roi) < 1e-9 && r.n === 4 && r.hit === 0.5 && r.lo < 0 && r.hi > 0);
t('empty list gives null', PB.roi([]) === null);

console.log('\n3. end-to-end on synthetic league');
(async () => {
  // Deterministic pseudo-random league: 12 teams, 3 double round-robins.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const teams = Array.from({ length: 12 }, (_, i) => 'T' + i);
  const atk = teams.map(() => 0.8 + rnd() * 1.0);
  const pois = (l) => { let k = 0, p = Math.exp(-l), s = p, u = rnd(); while (u > s) { k++; p *= l / k; s += p; } return k; };
  const matches = [];
  let day = 0;
  for (let round = 0; round < 3; round++) {
    for (let a = 0; a < 12; a++) for (let b = 0; b < 12; b++) if (a !== b) {
      const d = new Date(Date.UTC(2023, 7, 1 + Math.floor(day / 6))); day++;
      const hg = pois(atk[a] * 1.1), ag = pois(atk[b] * 0.9);
      matches.push({ date: d.toISOString().slice(0, 10), home: teams[a], away: teams[b], hg, ag,
        odds: { '1': 2.4, X: 3.4, '2': 3.0, 'O2.5': 1.95, 'U2.5': 1.95 }, maxOdds: { '1': 2.5, X: 3.5, '2': 3.1, 'O2.5': 2.0, 'U2.5': 2.0 }, ah: { line: -0.5, home: 1.95, away: 1.95, maxHome: 2.0, maxAway: 2.0 } });
    }
  }
  const res = await PB.run({ leagues: ['SYN'], testFrom: matches[200].date, load: async () => matches });
  t('backtest ran and saw fixtures', res.coverage[0].tested > 100, JSON.stringify(res.coverage[0]));
  t('pricing coverage counted', res.coverage[0].priced1x2 === res.coverage[0].tested && res.coverage[0].pricedAH === res.coverage[0].tested);
  t('result is JSON-serialisable', (() => { try { JSON.stringify(res); return true; } catch { return false; } })());
  const base = res.variants.find((v) => v.id === 'baseline');
  t('three strategy variants are reported', res.variants.length === 3 && res.variants.map((v) => v.id).join() === 'baseline,agree05,agree02');
  t('every ROI interval brackets its estimate', [res.reference.blind, res.reference.edgeOnly, base.picked].filter(Boolean).every((x) => x.lo <= x.roi && x.roi <= x.hi));
  t('blind betting at a ~5% overround loses roughly the vig, not wildly', !res.reference.blind || (res.reference.blind.roi > -0.4 && res.reference.blind.roi < 0.2), res.reference.blind && String(res.reference.blind.roi));
  t('best-price ROI is never worse than closing-price ROI for the same bets', !res.reference.blind || res.reference.blindAtBest.roi >= res.reference.blind.roi - 1e-9);
  t('stricter agreement never admits more picks', !base.picked || res.variants[2].picked == null || res.variants[2].picked.n <= base.picked.n);
  t('CFG is restored after the run', require('./lib/methodology').core.CFG.marketAgree === false && require('./lib/methodology').core.CFG.priceEdgeLocks === false);
  t('report text renders', PB.formatReport({ status: 'done', progress: {}, result: res }).includes('Baseline (today)'));
  t('a failing league is reported, not thrown', (await PB.run({ leagues: ['BAD'], load: async () => { throw new Error('HTTP 503'); } })).coverage[0].error === 'HTTP 503');
  const job = PB.getJob();
  t('job state starts idle', job.status === 'idle');

  console.log(`\n ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
