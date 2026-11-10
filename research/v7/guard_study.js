'use strict';

/**
 * research/v7/guard_study.js — would a live guard have helped?
 *
 *   node research/v7/guard_study.js <slips.jsonl>
 *
 * The guard watches the settled Strongest Picks of each market family and each league. When a
 * family or league has won clearly less often than its stated chance (z below -Z on its last N
 * picks, at least MIN of them), it is suspended for DAYS days, then let back in with a clean
 * slate. Replayed day by day on research/v6/slips_study.js output (every division of the archive,
 * Brazil and Argentina included, to see whether the guard finds them on its own).
 */

const fs = require('fs');
const SC = require('../../lib/strongest/config');
const CAL = require('../../lib/strongest/calibrate');
const GUARD = require('../../lib/strongest/guard');

const [, , file] = process.argv;
const SPLIT = '2023-07-01';
const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const byDay = new Map();
for (const r of rows) {
  if (!byDay.has(r.d)) byDay.set(r.d, []);
  byDay.get(r.d).push(r);
}
const days = [...byDay.keys()].sort();

function pickOf(r, blocked) {
  let best = null;
  for (const [key, group, prob, floor, pay, res] of r.sels) {
    if (SC.excluded.includes(key)) continue;
    const so = group === 'Corners' || group === 'Bookings';
    if (prob < (so ? SC.minChanceStatsOnly : SC.minChance) - 1e-9 || floor < SC.floor - 1e-9 || pay > SC.maxProb + 1e-9) continue;
    if (blocked && blocked(CAL.family(key))) continue;
    const st = prob - (so ? 0.03 : 0);
    if (!best || st > best.st) best = { key, fam: CAL.family(key), prob, res, st };
  }
  return best;
}

function run(cfg, label) {
  const R = { tune: { n: 0, w: 0, p: 0, days: new Set() }, held: { n: 0, w: 0, p: 0, days: new Set() } };
  const log = []; // settled picks so far: { day, family, league, prob, hit }
  const events = [];
  for (const d of days) {
    const state = cfg ? GUARD.evaluate(log, d, cfg) : null;
    if (state) for (const s of state.started || []) events.push(`${d} ${s.kind} ${s.name} suspended: won ${(s.won * 100).toFixed(0)}% of ${s.n} (stated ${(s.stated * 100).toFixed(0)}%)`);
    const settledToday = [];
    for (const r of byDay.get(d)) {
      if (state && state.leagues[r.div]) continue;
      const p = pickOf(r, state ? (fam) => !!state.families[fam] : null);
      if (!p || p.res == null) continue;
      const part = d < SPLIT ? R.tune : R.held;
      part.n++;
      part.w += p.res;
      part.p += p.prob;
      part.days.add(d);
      settledToday.push({ day: d, family: p.fam, league: r.div, prob: p.prob, hit: p.res });
    }
    log.push(...settledToday); // known from the next day on
  }
  const f = (x) => `${x.n} picks, won ${(x.w / x.n * 100).toFixed(2)}% (stated ${(x.p / x.n * 100).toFixed(2)}%), ${(x.n / x.days.size).toFixed(1)} a day`;
  console.log(`\n${label}\n  tuning   ${f(R.tune)}\n  held-out ${f(R.held)}\n  suspensions: ${events.length}`);
  return events;
}

run(null, 'No guard');
for (const z of [2, 2.5, 3]) {
  for (const win of [60, 120]) {
    const ev = run({ ...GUARD.CFG, z, window: win }, `Guard z=${z}, last ${win} picks, ${GUARD.CFG.minPicks}+ picks, ${GUARD.CFG.days} days`);
    if (z === GUARD.CFG.z && win === GUARD.CFG.window) console.log(ev.map((e) => '    ' + e).join('\n'));
  }
}
