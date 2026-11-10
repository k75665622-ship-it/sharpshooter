'use strict';

/**
 * research/v7/method_study.js — the methodology picks at real prices: which ones pay, and what
 * slips built from them do.
 *
 *   node --max-old-space-size=6000 research/v7/method_study.js <methods.json> [out.json]
 *
 * Input: research/backtest_methods.js output (every methodology verdict on every fixture, settled,
 * with the Bet365 price and the best price of ~17 books where the market is quoted).
 * Tuning seasons 2019-22, held-out 2023 on, apart.
 *
 *   1  every qualified pick with a real price: hit rate, average odds, return at Bet365 and at
 *      the best price — by methodology, by tier and by the pick's expected value at the price
 *   2  the day's methodology slips: the N best priced picks of the day (one per match), by rule
 */

const fs = require('fs');
const [, , file, outFile] = process.argv;
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const HELD = (r) => r.season >= 2023;
const rows = data.rows.filter((r) => r.kept && r.status !== 'PAPER' && (r.hit === 0 || r.hit === 1));
console.log(`${rows.length} qualified, settled picks; ${rows.filter((r) => r.b365 > 1).length} with a Bet365 price`);

const acc = () => ({ n: 0, w: 0, p: 0, o: 0, om: 0, r: 0, rm: 0 });
const add = (a, r) => {
  a.n++;
  a.w += r.hit;
  a.p += r.prob;
  a.o += r.b365;
  a.om += r.max > 1 ? r.max : r.b365;
  a.r += r.hit ? r.b365 - 1 : -1;
  a.rm += r.hit ? (r.max > 1 ? r.max : r.b365) - 1 : -1;
};
const show = (a) => (a.n ? `${String(a.n).padStart(5)} won ${(a.w / a.n * 100).toFixed(1)}% said ${(a.p / a.n * 100).toFixed(1)}% odds ${(a.o / a.n).toFixed(2)}/${(a.om / a.n).toFixed(2)} return ${(a.r / a.n * 100 >= 0 ? '+' : '') + (a.r / a.n * 100).toFixed(1)}%/${(a.rm / a.n * 100 >= 0 ? '+' : '') + (a.rm / a.n * 100).toFixed(1)}%` : '    0');
const two = (title, groups) => {
  console.log(`\n${title}   (odds and return: Bet365 / best price)`);
  for (const [k, g] of Object.entries(groups).sort()) console.log(`  ${k.padEnd(26)} tune ${show(g.t).padEnd(76)} | held ${show(g.h)}`);
};
const G = (o, k) => (o[k] = o[k] || { t: acc(), h: acc() });

const priced = rows.filter((r) => r.b365 > 1);
const byMethod = {};
const byTier = {};
const byEv = {};
const byOdds = {};
for (const r of priced) {
  const part = HELD(r) ? 'h' : 't';
  add(G(byMethod, r.id)[part], r);
  add(G(byTier, r.tier)[part], r);
  const ev = r.prob * r.b365 - 1;
  add(G(byEv, ev >= 0.04 ? 'd: value +4% or more' : ev >= 0 ? 'c: value 0 to +4%' : ev >= -0.04 ? 'b: -4% to 0' : 'a: under -4%')[part], r);
  add(G(byOdds, r.b365 < 1.25 ? 'a: under 1.25' : r.b365 < 1.4 ? 'b: 1.25-1.40' : r.b365 < 1.6 ? 'c: 1.40-1.60' : r.b365 < 2 ? 'd: 1.60-2.00' : 'e: 2.00+')[part], r);
}
two('1a. By methodology (priced picks)', byMethod);
two('1b. By tier', byTier);
two('1c. By expected value at the Bet365 price (chance x odds - 1)', byEv);
two('1d. By the Bet365 odds', byOdds);

// ---- slips: per day, one pick per match (its best by the rule's order), the top N
const RULES = {
  'top by chance': { ok: (r) => r.b365 >= 1.2, order: (a, b) => b.prob - a.prob },
  'top by chance, odds 1.3+': { ok: (r) => r.b365 >= 1.3, order: (a, b) => b.prob - a.prob },
  'top by value (EV at Bet365)': { ok: (r) => r.b365 >= 1.25, order: (a, b) => b.prob * b.b365 - a.prob * a.b365 },
  'value 0%+ then chance': { ok: (r) => r.b365 >= 1.25 && r.prob * r.b365 >= 1, order: (a, b) => b.prob - a.prob },
  'chance 70%+ and value 0%+': { ok: (r) => r.b365 >= 1.25 && r.prob >= 0.7 && r.prob * r.b365 >= 1, order: (a, b) => b.prob - a.prob },
  'result picks only (1 / 2 / double chance), chance': { ok: (r) => r.b365 >= 1.25 && ['homeWin', 'awayWin', 'doubleChance'].includes(r.id), order: (a, b) => b.prob - a.prob },
};
const out = { slips: {} };
for (const [name, rule] of Object.entries(RULES)) {
  const byDay = new Map();
  for (const r of priced) {
    if (!rule.ok(r)) continue;
    if (!byDay.has(r.date)) byDay.set(r.date, []);
    byDay.get(r.date).push(r);
  }
  const S = {};
  for (const [, list] of byDay) {
    list.sort(rule.order);
    const seen = new Set();
    const picks = [];
    for (const r of list) {
      const mk = `${r.home}|${r.away}`;
      if (seen.has(mk)) continue;
      seen.add(mk);
      picks.push(r);
    }
    const part = HELD(picks[0]) ? 'h' : 't';
    for (const k of [1, 2, 3, 4]) {
      if (picks.length < k) continue;
      const legs = picks.slice(0, k);
      const s = ((S[k] = S[k] || { t: { n: 0, w: 0, p: 0, o: 0, om: 0, r: 0, rm: 0 }, h: { n: 0, w: 0, p: 0, o: 0, om: 0, r: 0, rm: 0 } })[part]);
      const win = legs.every((l) => l.hit === 1) ? 1 : 0;
      const o = legs.reduce((a, l) => a * l.b365, 1);
      const om = legs.reduce((a, l) => a * (l.max > 1 ? l.max : l.b365), 1);
      s.n++;
      s.w += win;
      s.p += legs.reduce((a, l) => a * l.prob, 1);
      s.o += o;
      s.om += om;
      s.r += win ? o - 1 : -1;
      s.rm += win ? om - 1 : -1;
    }
  }
  console.log(`\n2. Slips: ${name}`);
  for (const [k, s] of Object.entries(S)) console.log(`  ${k} leg${k > 1 ? 's' : ' '}  tune ${show(s.t).padEnd(76)} | held ${show(s.h)}`);
  out.slips[name] = S;
}
if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
