'use strict';

/**
 * research/methods_audit.js — what in each methodology helps, hurts or does nothing.
 *
 *   node --max-old-space-size=8000 research/methods_audit.js <methods.json> [out.json]
 *
 * Reads research/backtest_methods.js output run with DIAG=all (every gate and checklist item of
 * every methodology, on every candidate). A pick's "edge" here is how much more often it won than
 * its stated probability (hit - prob): a rule that helps keeps picks with a higher edge and removes
 * picks with a lower one; a rule that hurts removes picks that would have won MORE than they said.
 * Tuning seasons (2019-22) and held-out seasons (2023-26) are shown side by side; a finding only
 * counts when both periods agree.
 *
 * Sections
 *   1  each methodology: qualified / WATCH / REMOVE, won v stated
 *   2  the tiers the site shows today (score: Platinum 88+, Gold 80+, Silver 70+, Bronze)
 *   3  qualified picks by stated probability (what a probability tier would look like)
 *   4  every hard gate: among candidates that clear the probability floor and the sample, the edge
 *      of the picks the gate lets through v the picks it removes
 *   5  the checklist bar: all gates passed, checklist ratio >= 0.85 (qualified) v 0.70-0.85 (WATCH)
 *      v below
 */

const fs = require('fs');

const [, , file, outFile] = process.argv;
const { rows } = JSON.parse(fs.readFileSync(file, 'utf8'));
const PERIODS = [['tune', (r) => r.season <= 2022], ['held', (r) => r.season >= 2023]];

function stat(list) {
  const s = list.filter((r) => r.hit != null && r.prob != null);
  if (!s.length) return { n: 0 };
  const hit = s.reduce((a, r) => a + r.hit, 0) / s.length;
  const said = s.reduce((a, r) => a + r.prob, 0) / s.length;
  const v = s.reduce((a, r) => a + r.prob * (1 - r.prob), 0) / s.length;
  const se = Math.sqrt(v / s.length);
  const b = s.filter((r) => r.b365 > 1);
  const roi = b.length >= 25 ? b.reduce((a, r) => a + (r.hit ? r.b365 - 1 : -1), 0) / b.length : null;
  return { n: s.length, hit, said, edge: hit - said, se, roi, nRoi: b.length };
}
const p1 = (x) => (x == null ? '   —  ' : `${(x * 100).toFixed(1).padStart(5)}%`);
const e1 = (s) => (s.n ? `${(s.edge * 100 >= 0 ? '+' : '') + (s.edge * 100).toFixed(1)}±${(1.96 * s.se * 100).toFixed(1)}` : '');
const fmt = (s) => (s.n ? `${String(s.n).padStart(6)} won ${p1(s.hit)} said ${p1(s.said)} edge ${e1(s).padEnd(11)}${s.roi != null ? ` B365 ${(s.roi * 100).toFixed(1)}%` : ''}` : '     0');

const out = {};
const ids = [...new Set(rows.map((r) => r.id))];
const byPeriod = Object.fromEntries(PERIODS.map(([k, f]) => [k, rows.filter(f)]));

// ---------------------------------------------------------------- 1. methodologies
console.log('\n1. EACH METHODOLOGY (tuning 2019-22 | held-out 2023-26)');
out.methods = {};
for (const id of ids) {
  out.methods[id] = {};
  console.log(`\n${id}`);
  for (const [lab, f] of [['qualified', (r) => r.kept], ['WATCH', (r) => r.status === 'WATCH'], ['REMOVE', (r) => r.status === 'REMOVE']]) {
    const t = stat(byPeriod.tune.filter((r) => r.id === id && f(r)));
    const h = stat(byPeriod.held.filter((r) => r.id === id && f(r)));
    out.methods[id][lab] = { tune: t, held: h };
    console.log(`  ${lab.padEnd(10)} ${fmt(t)}  |  ${fmt(h)}`);
  }
}

// ---------------------------------------------------------------- 2. score tiers
console.log('\n2. TODAY\'S TIERS (score) — qualified picks');
out.scoreTiers = {};
for (const tier of ['Platinum', 'Gold', 'Silver', 'Bronze']) {
  const t = stat(byPeriod.tune.filter((r) => r.kept && r.tier === tier));
  const h = stat(byPeriod.held.filter((r) => r.kept && r.tier === tier));
  out.scoreTiers[tier] = { tune: t, held: h };
  console.log(`  ${tier.padEnd(10)} ${fmt(t)}  |  ${fmt(h)}`);
}
console.log('  -- by methodology, held-out (won / said, n)');
for (const id of ids) {
  const parts = ['Platinum', 'Gold', 'Silver', 'Bronze'].map((tier) => {
    const h = stat(byPeriod.held.filter((r) => r.kept && r.id === id && r.tier === tier));
    return h.n ? `${tier[0]} ${p1(h.hit).trim()}/${p1(h.said).trim()} (${h.n})` : `${tier[0]} —`;
  });
  console.log(`  ${id.padEnd(13)} ${parts.join('   ')}`);
}

// ---------------------------------------------------------------- 3. probability bands
console.log('\n3. QUALIFIED PICKS BY STATED PROBABILITY');
const BANDS = [[0.8, 1.01, '80%+'], [0.7, 0.8, '70-80%'], [0.6, 0.7, '60-70%'], [0.5, 0.6, '50-60%'], [0, 0.5, 'under 50%']];
out.bands = {};
for (const [lo, hi, lab] of BANDS) {
  const f = (r) => r.kept && r.prob >= lo && r.prob < hi;
  const t = stat(byPeriod.tune.filter(f));
  const h = stat(byPeriod.held.filter(f));
  out.bands[lab] = { tune: t, held: h };
  console.log(`  ${lab.padEnd(10)} ${fmt(t)}  |  ${fmt(h)}`);
  const mix = {};
  for (const r of byPeriod.held.filter(f)) mix[r.id] = (mix[r.id] || 0) + 1;
  console.log(`             held-out mix: ${Object.entries(mix).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
}

// ---------------------------------------------------------------- 4. gates
console.log('\n4. HARD GATES — candidates over the probability floor with the sample: edge of picks LET THROUGH v REMOVED');
console.log('   (a gate helps when what it removes won LESS than stated; it costs picks when what it removes did as well or better)');
out.gates = {};
for (const id of ids) {
  const base = (r) => r.id === id && r.gates && r.gates.MODEL === 1 && r.gates.SAMPLE === 1;
  const gateIds = new Set();
  for (const r of byPeriod.held) if (base(r)) for (const g of Object.keys(r.gates)) if (g !== 'MODEL' && g !== 'SAMPLE') gateIds.add(g);
  if (!gateIds.size) continue;
  console.log(`\n${id}`);
  out.gates[id] = {};
  for (const g of gateIds) {
    const res = {};
    for (const [k] of PERIODS) {
      const B = byPeriod[k].filter(base);
      res[k] = { pass: stat(B.filter((r) => r.gates[g] === 1)), fail: stat(B.filter((r) => r.gates[g] === 0)), unknown: B.filter((r) => r.gates[g] == null).length };
    }
    out.gates[id][g] = res;
    const sh = (s) => (s.n ? `${String(s.n).padStart(5)} ${e1(s).padEnd(10)}` : '    0           ');
    console.log(`  ${g.padEnd(9)} through ${sh(res.tune.pass)} removed ${sh(res.tune.fail)} |  through ${sh(res.held.pass)} removed ${sh(res.held.fail)}`);
  }
}

// ---------------------------------------------------------------- 5. the checklist bar
console.log('\n5. THE CHECKLIST BAR — every hard gate passed');
out.checklist = {};
for (const id of ids) {
  const base = (r) => r.id === id && !(r.failed && r.failed.length) && r.ratio != null;
  const res = {};
  for (const [k] of PERIODS) {
    const B = byPeriod[k].filter(base);
    res[k] = { q: stat(B.filter((r) => r.ratio >= 0.85)), w: stat(B.filter((r) => r.ratio >= 0.7 && r.ratio < 0.85)), low: stat(B.filter((r) => r.ratio < 0.7)) };
  }
  out.checklist[id] = res;
  const sh = (s) => (s.n ? `${String(s.n).padStart(5)} ${p1(s.hit).trim()}/${p1(s.said).trim()} ${e1(s)}` : '0');
  console.log(`  ${id.padEnd(13)} 85%+ ${sh(res.tune.q)}  70-85% ${sh(res.tune.w)}  <70% ${sh(res.tune.low)}`);
  console.log(`  ${''.padEnd(13)} 85%+ ${sh(res.held.q)}  70-85% ${sh(res.held.w)}  <70% ${sh(res.held.low)}   (held-out)`);
}

if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
