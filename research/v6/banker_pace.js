'use strict';

/**
 * research/v6/banker_pace.js — does the High Banker get better with the measured chance and
 * the possession model?
 *
 *   node research/v6/banker_pace.js <banker_dump.jsonl> <strongest_dump.jsonl> <fit.json> <out.json>
 *
 * Joins every match of research/v6/banker_dump.js with its Strongest Picks views
 * (research/v6/strongest_study.js: market, stats, factors and the possession model, lib/pace.js)
 * and runs the production banker (lib/banker.js, via research/v6/banker_study.js evaluate) under:
 *
 *   production         the v6 probability, as today
 *   measured           each leg's probability is its measured chance (the per-market calibration
 *                      research/v6/strongest_fit.js fitted on 2019-23, possession term included)
 *   + possession       ... and a leg fails when the possession model rates it more than `gap`
 *                      below the bookmakers
 *
 * Both are lib/banker.js CFG switches (useMeasured, paceGap), so this runs the production code.
 *
 * Variants are compared on the tuning seasons; the held-out seasons are printed for the record.
 */

const fs = require('fs');
const BS = require('./banker_study');
const BK = require('../../lib/banker');

const [, , bankerFile, strongestFile, fitFile, outFile] = process.argv;
const fit = JSON.parse(fs.readFileSync(fitFile, 'utf8'));
const GC = (fit.goals && fit.goals.calibration) || fit.goals; // a fit report or a models file
const sig = (x) => 1 / (1 + Math.exp(-x));
const logit = (p) => {
  const q = Math.min(0.999, Math.max(0.001, p));
  return Math.log(q / (1 - q));
};

// views per match and key from the Strongest replay (goal keys the banker uses)
const KEYS = new Set(BK.CFG.keys);
const views = new Map();
for (const line of fs.readFileSync(strongestFile, 'utf8').split('\n')) {
  if (!line) continue;
  const r = JSON.parse(line);
  const o = {};
  for (const [key, , , v] of r.s) if (KEYS.has(key)) o[key] = v;
  views.set(`${r.div}|${r.d}|${r.h}|${r.a}`, o);
}
const rows = BS.load(bankerFile);
console.log('banker rows', rows.length, 'with views', rows.filter((x) => views.has(`${x.div}|${x.date}|${x.home}|${x.away}`)).length);

const measured = (key, v) => {
  const c = GC[key];
  if (!c || !v || v.m == null) return null;
  const lm = logit(v.m);
  const dev = (p) => (p != null ? logit(p) - lm : 0);
  return sig(c.a + c.b * lm + c.c * dev(v.f) + c.d * dev(v.s) + (c.e || 0) * dev(v.p));
};

/** The rows with the views the production banker reads: measured chances, possession, market. */
const rowsV = rows.map((x) => {
  const v = views.get(`${x.div}|${x.date}|${x.home}|${x.away}`) || {};
  const mc = {};
  const pv = {};
  const mv = {};
  for (const k of Object.keys(x.p || {})) {
    const vk = v[k];
    if (!vk) continue;
    const c = measured(k, vk);
    if (c != null) mc[k] = c;
    if (vk.p != null) pv[k] = vk.p;
    if (vk.m != null) mv[k] = vk.m;
  }
  return { ...x, mc, pv, mv };
});

const VARIANTS = {
  production: { useMeasured: false, paceGap: null },
  'production + possession check (gap 0.05)': { useMeasured: false, paceGap: 0.05 },
  'production + possession check (gap 0.10)': { useMeasured: false, paceGap: 0.1 },
  measured: { useMeasured: true, paceGap: null },
  'measured + possession check (gap 0.00)': { useMeasured: true, paceGap: 0 },
  'measured + possession check (gap 0.05)': { useMeasured: true, paceGap: 0.05 },
  'measured + possession check (gap 0.10)': { useMeasured: true, paceGap: 0.1 },
};

const out = {};
const brief = (e) => ({
  legs: { n: e.legs.n, hit: e.legs.hit, stated: e.legs.stated, perDay: e.legs.perDay },
  slip: { days: e.slip.days, slips: e.slip.slips, coverage: e.slip.coverage, hit: e.slip.hit, stated: e.slip.stated, avgLegs: e.slip.avgLegs, landedPer100Days: +((e.slip.hit * e.slip.slips) / e.slip.days * 100).toFixed(1) },
});
for (const [name, v] of Object.entries(VARIANTS)) {
  const cfg = { ...BK.CFG, ...v };
  out[name] = { tune: brief(BS.evaluate(rowsV, BS.TUNE, cfg)), test: brief(BS.evaluate(rowsV, BS.HELD, cfg)) };
  const t = out[name].tune;
  const h = out[name].test;
  console.log(`${name.padEnd(44)} TUNE legs ${t.legs.n} hit ${(t.legs.hit * 100).toFixed(1)} stated ${(t.legs.stated * 100).toFixed(1)} | slips ${t.slip.slips} landed ${(t.slip.hit * 100).toFixed(1)}% stated ${(t.slip.stated * 100).toFixed(1)}% (${t.slip.landedPer100Days}/100 days)`);
  console.log(`${''.padEnd(44)} HELD legs ${h.legs.n} hit ${(h.legs.hit * 100).toFixed(1)} stated ${(h.legs.stated * 100).toFixed(1)} | slips ${h.slip.slips} landed ${(h.slip.hit * 100).toFixed(1)}% stated ${(h.slip.stated * 100).toFixed(1)}% (${h.slip.landedPer100Days}/100 days)`);
}
if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
