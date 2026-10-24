'use strict';

/**
 * research/v6/acca_study.js — the double-confirmed accumulator rule on held-out seasons.
 *
 *   node research/v6/acca_study.js <methods_ids.json> <decisions.jsonl> <out.json> [from] [to]
 *
 *   methods_ids.json  research/backtest_methods.js output (production methodology code,
 *                     tune-only calibration) with fixture identities
 *   decisions.jsonl   research/v6/backtest_decision.js DUMP_FILE output (v6, models trained
 *                     on 2005-2019 only)
 *
 * Legs are selected with the SAME code the site runs (lib/intel/accumulator.js saferForm,
 * rank, exclusions). Each day's best k legs form that day's k-fold. Reported: leg hit rate
 * vs the probability stated, against methodology-only and normal-only picks, and accumulator
 * hit rates and returns (Bet365 and best price, only when every leg had a price).
 */

const fs = require('fs');
const readline = require('readline');
const ACC = require('../../lib/intel/accumulator');

const [, , methodsFile, decFile, outFile, fromArg, toArg] = process.argv;
const FROM = fromArg || '2023-07-01';
const TO = toArg || '2099-01-01';

async function main() {
  const dec = new Map();
  const rl = readline.createInterface({ input: fs.createReadStream(decFile), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    const d = JSON.parse(line);
    if (d.date < FROM || d.date > TO) continue;
    dec.set(`${d.div}|${d.date}|${d.home}|${d.away}`, d);
  }
  const M = JSON.parse(fs.readFileSync(methodsFile, 'utf8'));
  const legsByFixture = new Map();
  const mOnlyByFixture = new Map();
  const methodOnly = { n: 0, hit: 0, stated: 0 };
  const exactOnly = { n: 0, hit: 0, stated: 0 };
  const saferOnly = { n: 0, hit: 0, stated: 0 };
  const callOnly = { n: 0, hit: 0, stated: 0 };
  const rejected = { n: 0, hit: 0, stated: 0 };
  let joined = 0;
  for (const r of M.rows) {
    if (!r.date || r.date < FROM || r.date > TO) continue;
    if (r.status !== 'LOCK' && r.status !== 'PREDICT') continue;
    if (ACC.EXCLUDED_METHODS.has(r.id) || /^CS_/.test(r.key)) continue;
    const d = dec.get(`${r.div}|${r.date}|${r.home}|${r.away}`);
    if (!d) continue;
    joined++;
    if (r.hit == null) continue; // push / void
    {
      const k0 = `${r.div}|${r.date}|${r.home}|${r.away}`;
      const cur = mOnlyByFixture.get(k0);
      if (!cur || r.prob > cur.prob) mOnlyByFixture.set(k0, { date: r.date, prob: r.prob, hit: r.hit, b365: r.b365, max: r.max, methodology: { status: r.status }, agreement: 'none' });
    }
    methodOnly.n++;
    methodOnly.hit += r.hit;
    methodOnly.stated += r.prob;
    const normal = { main: d.main ? d.main.key : null, safer: d.safer ? d.safer.key : null, avoid: new Set(d.avoid || []), p: d.p, base: d.base };
    const agreement = ACC.agreementOf(r.key, normal, process.env.ACCA_MIN_PROB ? { minProb: Number(process.env.ACCA_MIN_PROB) } : {});
    const prob = d.p[r.key];
    if (!agreement) {
      rejected.n++;
      rejected.hit += r.hit;
      rejected.stated += r.prob;
      continue;
    }
    const leg = {
      date: r.date, div: r.div, home: r.home, away: r.away, key: r.key, id: r.id, agreement,
      methodology: { id: r.id, status: r.status, maxLegs: null }, prob, mprob: r.prob, hit: r.hit, b365: r.b365, max: r.max,
    };
    const tgt = agreement === 'main' ? exactOnly : agreement === 'safer' ? saferOnly : callOnly;
    tgt.n++;
    tgt.hit += r.hit;
    tgt.stated += prob;
    const k = `${r.div}|${r.date}|${r.home}|${r.away}`;
    if (!legsByFixture.has(k)) legsByFixture.set(k, []);
    legsByFixture.get(k).push(leg);
  }
  // one leg per fixture, ranked as the site ranks them
  const byDate = new Map();
  const legStats = { n: 0, hit: 0, stated: 0 };
  for (const list of legsByFixture.values()) {
    list.sort((a, b) => ACC.rank(b) - ACC.rank(a));
    const l = list[0];
    legStats.n++;
    legStats.hit += l.hit;
    legStats.stated += l.prob;
    if (!byDate.has(l.date)) byDate.set(l.date, []);
    byDate.get(l.date).push(l);
  }
  function simulate(byD, rankFn, filter) {
    const res = {};
    for (const k of ACC.SIZES) {
      const s = { n: 0, won: 0, stated: 0, nB365: 0, retB365: 0, nBest: 0, retBest: 0 };
      for (const [, all] of byD) {
        const legs = all.filter(filter || (() => true)).sort((a, b) => rankFn(b) - rankFn(a));
        if (legs.length < k) continue;
        const pick = legs.slice(0, k);
        const won = pick.every((l) => l.hit === 1) ? 1 : 0;
        s.n++;
        s.won += won;
        s.stated += pick.reduce((a, l) => a * l.prob, 1);
        if (pick.every((l) => l.b365 > 1)) { const o = pick.reduce((a, l) => a * l.b365, 1); s.nB365++; s.retB365 += won ? o - 1 : -1; }
        if (pick.every((l) => l.max > 1)) { const o = pick.reduce((a, l) => a * l.max, 1); s.nBest++; s.retBest += won ? o - 1 : -1; }
      }
      res[k] = { n: s.n, hit: s.n ? s.won / s.n : null, stated: s.n ? s.stated / s.n : null, roiBet365: s.nB365 ? s.retB365 / s.nB365 : null, nPricedBet365: s.nB365, roiBest: s.nBest ? s.retBest / s.nBest : null, nPricedBest: s.nBest };
    }
    return res;
  }
  const mByDate = new Map();
  for (const l of mOnlyByFixture.values()) { if (!mByDate.has(l.date)) mByDate.set(l.date, []); mByDate.get(l.date).push(l); }
  const methodologyOnlyAccas = simulate(mByDate, (l) => l.prob);
  const valueLegAccas = simulate(byDate, ACC.rank, (l) => l.max > 1 && l.max >= Math.max(1.05, 1.02 / l.prob));
  const mainOnlyAccas = simulate(byDate, ACC.rank, (l) => l.agreement === 'main');
  const sizes = {};
  for (const k of ACC.SIZES) {
    const s = { n: 0, won: 0, stated: 0, nB365: 0, retB365: 0, nBest: 0, retBest: 0, days: 0 };
    for (const [, legs] of byDate) {
      legs.sort((a, b) => ACC.rank(b) - ACC.rank(a));
      if (legs.length < k) continue;
      const pick = legs.slice(0, k);
      const won = pick.every((l) => l.hit === 1) ? 1 : 0;
      s.n++;
      s.won += won;
      s.stated += pick.reduce((a, l) => a * l.prob, 1);
      if (pick.every((l) => l.b365 > 1)) {
        const odds = pick.reduce((a, l) => a * l.b365, 1);
        s.nB365++;
        s.retB365 += won ? odds - 1 : -1;
      }
      if (pick.every((l) => l.max > 1)) {
        const odds = pick.reduce((a, l) => a * l.max, 1);
        s.nBest++;
        s.retBest += won ? odds - 1 : -1;
      }
    }
    sizes[k] = {
      n: s.n,
      hit: s.n ? s.won / s.n : null,
      stated: s.n ? s.stated / s.n : null,
      roiBet365: s.nB365 ? s.retB365 / s.nB365 : null,
      nPricedBet365: s.nB365,
      roiBest: s.nBest ? s.retBest / s.nBest : null,
      nPricedBest: s.nBest,
    };
  }
  const fin = (a) => ({ n: a.n, hit: a.n ? a.hit / a.n : null, stated: a.n ? a.stated / a.n : null });
  const out = {
    window: [FROM, TO],
    joinedMethodologyPicks: joined,
    legs: fin(legStats),
    mainAgreement: fin(exactOnly),
    callAgreement: fin(callOnly),
    saferAgreement: fin(saferOnly),
    methodologyOnly: fin(methodOnly),
    rejectedByNormal: fin(rejected),
    daysWithLegs: byDate.size,
    sizes,
    methodologyOnlyAccas,
    mainOnlyAccas,
    valueLegAccas,
  };
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1));
}

main();
