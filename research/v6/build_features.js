'use strict';

/**
 * research/v6/build_features.js — every v6 factor for every historical match, walk-forward.
 *
 *   node research/v6/build_features.js <Matches.csv> <out.csv> [fromDate=2003-07-01]
 *
 * Uses lib/factors (the production code). A match's factors are computed from the store
 * BEFORE any match of the same day is added, so nothing from the match day leaks in.
 * Output columns: identifiers, outcomes, prices (for ROI), then every catalog factor.
 */

const fs = require('fs');
const RC = require('../../lib/factors/records');
const { History } = require('../../lib/factors/history');
const F = require('../../lib/factors/features');

const [, , file, outFile, fromArg] = process.argv;
if (!file || !outFile) {
  console.error('usage: node research/v6/build_features.js <Matches.csv> <out.csv> [fromDate]');
  process.exit(1);
}
const FROM = fromArg || '2003-07-01';

console.time('load');
const text = fs.readFileSync(file, 'utf8');
const lines = text.split(/\r?\n/);
const head = lines[0].split(',');
const recs = [];
for (let i = 1; i < lines.length; i++) {
  if (!lines[i]) continue;
  const c = lines[i].split(',');
  const o = {};
  for (let k = 0; k < head.length; k++) o[head[k]] = c[k];
  const mr = RC.fromDatasetRow(o);
  if (mr && mr.hg != null && mr.ag != null) recs.push(mr);
}
recs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
console.timeEnd('load');
console.log('records', recs.length);

console.time('market');
let solved = 0;
for (const r of recs) if (RC.marketOf(r)) solved++;
console.timeEnd('market');
console.log('priced', solved);

const cat = F.catalog().map((c) => c.key);
const ID = ['div', 'date', 'season', 'home', 'away', 'hg', 'ag', 'hthg', 'htag', 'oh', 'od', 'oa', 'mh', 'md', 'ma', 'oo', 'ou', 'mo', 'mu', 'ahl', 'ahh', 'aha'];
const out = fs.createWriteStream(outFile);
out.write([...ID, ...cat].join(',') + '\n');

const H = new History();
const fmt = (v) => (v == null || !Number.isFinite(v) ? '' : String(v));
console.time('features');
let i = 0;
let written = 0;
while (i < recs.length) {
  const day = recs[i].date;
  let j = i;
  while (j < recs.length && recs[j].date === day) j++;
  if (day >= FROM) {
    for (let k = i; k < j; k++) {
      const m = recs[k];
      const f = F.compute({
        fixture: m,
        homeLog: H.teamLog(m.league, m.home, day, 40),
        awayLog: H.teamLog(m.league, m.away, day, 40),
        h2h: H.h2h(m.league, m.home, m.away, day, 6, 10),
        table: H.table(m.league, m.season, day),
        env: H.env(m.league, day),
        prevTeams: H.teamsInSeason(m.league, m.season - 1),
      });
      const o = m.odds;
      const idv = [m.league, m.date, m.season, '"' + m.home + '"', '"' + m.away + '"', m.hg, m.ag, m.hthg, m.htag,
        o.h, o.d, o.a, o.maxH, o.maxD, o.maxA, o.o25, o.u25, o.maxO25, o.maxU25, o.ahLine, o.ahH, o.ahA];
      out.write(idv.map((v) => (typeof v === 'string' ? v : fmt(v))).join(',') + ',' + cat.map((kk) => fmt(f[kk])).join(',') + '\n');
      written++;
    }
  }
  for (let k = i; k < j; k++) H.add(recs[k]);
  H._tableCache.clear();
  i = j;
  if (written && written % 20000 < (j - i + 50) && day >= FROM) process.stdout.write(`\r${day} ${written}`);
}
out.end();
console.log();
console.timeEnd('features');
console.log('written', written);
