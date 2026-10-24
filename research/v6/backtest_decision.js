'use strict';

/**
 * research/v6/backtest_decision.js — the production v6 decision code on every held-out match.
 *
 *   SHARPSHOOTER_V6_MODELS=<honest compact models> \
 *   node research/v6/backtest_decision.js <features.csv> <out.json> [from=2023-07-01] [to=2099-01-01]
 *
 * For each match: lib/intel/predict.js (models trained on 2005-2019 only) -> every market ->
 * lib/intel/decision.js -> settled on the real score (lib/settle.js). Prices: Bet365 and the
 * best of ~17 books for 1X2 and Over/Under 2.5 (double chance and draw-no-bet are built from
 * the 1X2 prices); other markets have no historical price, so they report hit rate only.
 *
 * DECISION_OPTS='{"trapShift":-0.02}' overrides decision thresholds (tuning runs).
 */

const fs = require('fs');
const readline = require('readline');
const P = require('../../lib/intel/predict');
const D = require('../../lib/intel/decision');
const { settle } = require('../../lib/settle');

const [, , file, outFile, fromArg, toArg] = process.argv;
const FROM = fromArg || '2023-07-01';
const TO = toArg || '2099-01-01';
const OPTS = process.env.DECISION_OPTS ? JSON.parse(process.env.DECISION_OPTS) : {};
// DUMP_FILE=<path.jsonl> writes every fixture's decision (used by research/v6/acca_study.js)
const DUMP = process.env.DUMP_FILE ? fs.createWriteStream(process.env.DUMP_FILE) : null;
const DUMP_KEYS = ['1', 'X', '2', '1X', 'X2', '12', 'DNB_H', 'DNB_A', 'O1.5', 'O2.5', 'O3.5', 'U1.5', 'U2.5', 'U3.5', 'BTTS_Y', 'BTTS_N',
  'TTH_O0.5', 'TTA_O0.5', 'TTH_O1.5', 'TTA_O1.5', 'TTH_U1.5', 'TTA_U1.5', 'AH_H_-1', 'AH_A_-1', 'AH_H_1', 'AH_A_1', 'AH_H_-1.5', 'AH_A_1.5', 'AH_A_-1.5', 'AH_H_1.5'];
const r4 = (v) => (v == null ? null : Math.round(v * 10000) / 10000);
const brief = (x) => (x ? { key: x.key, prob: r4(x.prob), base: r4(x.base) } : null);

function csvSplit(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}
const num = (v) => (v === '' || v == null ? null : Number(v));

/** Prices per market key from the row's 1X2 and O/U prices. */
function pricesOf(r) {
  const P2 = {};
  const set = (k, ref, best) => {
    if (ref > 1 || best > 1) P2[k] = { ref: ref > 1 ? { price: ref, book: 'Bet365' } : null, best: best > 1 ? { price: best, book: 'best' } : ref > 1 ? { price: ref, book: 'Bet365' } : null };
  };
  const dc = (a, b) => (a > 1 && b > 1 ? 1 / (1 / a + 1 / b) : null);
  const dnb = (w, d) => (w > 1 && d > 1 ? w * (1 - 1 / d) : null);
  set('1', r.oh, r.mh);
  set('X', r.od, r.md);
  set('2', r.oa, r.ma);
  set('1X', dc(r.oh, r.od), dc(r.mh, r.md));
  set('X2', dc(r.od, r.oa), dc(r.md, r.ma));
  set('DNB_H', dnb(r.oh, r.od), dnb(r.mh, r.md));
  set('DNB_A', dnb(r.oa, r.od), dnb(r.ma, r.md));
  set('O2.5', r.oo, r.mo);
  set('U2.5', r.ou, r.mu);
  return P2;
}

const acc = () => ({ n: 0, won: 0, push: 0, stated: 0, priced: 0, retRef: 0, nRef: 0, retBest: 0, nBest: 0 });
function add(a, pick, res, prices) {
  if (!pick) return;
  if (res == null) {
    a.push++;
    return;
  }
  a.n++;
  a.won += res;
  a.stated += pick.prob;
  const pr = prices[pick.key];
  if (pr && pr.ref) {
    a.nRef++;
    a.retRef += res ? pr.ref.price - 1 : -1;
  }
  if (pr && pr.best) {
    a.nBest++;
    a.retBest += res ? pr.best.price - 1 : -1;
  }
}
const fin = (a) => ({
  n: a.n,
  hit: a.n ? a.won / a.n : null,
  stated: a.n ? a.stated / a.n : null,
  pushes: a.push,
  roiBet365: a.nRef ? a.retRef / a.nRef : null,
  nBet365: a.nRef,
  roiBest: a.nBest ? a.retBest / a.nBest : null,
  nBest: a.nBest,
});

async function main() {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let head = null;
  const S = {
    main: acc(), safer: acc(), value: acc(), v5rule: acc(), mainPricedOnly: acc(),
    byGrade: {}, byKey: {}, avoid: { n: 0, won: 0, marketSaid: 0, v6Said: 0 },
    logloss: {}, n: 0, noMarket: 0,
  };
  const LL = (k, p, y) => {
    if (p == null || !Number.isFinite(p)) return;
    const q = Math.min(1 - 1e-9, Math.max(1e-9, p));
    S.logloss[k] = S.logloss[k] || { n: 0, sum: 0 };
    S.logloss[k].n++;
    S.logloss[k].sum += -(y ? Math.log(q) : Math.log(1 - q));
  };
  for await (const line of rl) {
    if (!head) {
      head = csvSplit(line);
      continue;
    }
    const c = csvSplit(line);
    const date = c[1];
    if (date < FROM || date > TO) continue;
    const r = {};
    for (let i = 0; i < head.length; i++) r[head[i]] = c[i];
    const f = {};
    for (let i = 22; i < head.length; i++) f[head[i]] = num(c[i]);
    f.divc = r.div;
    const row = { oh: num(r.oh), od: num(r.od), oa: num(r.oa), mh: num(r.mh), md: num(r.md), ma: num(r.ma), oo: num(r.oo), ou: num(r.ou), mo: num(r.mo), mu: num(r.mu) };
    const hg = Number(r.hg);
    const ag = Number(r.ag);
    const pred = P.predict(f);
    if (!pred) continue;
    S.n++;
    if (pred.source !== 'market+factors') {
      S.noMarket++;
      continue; // the decision backtest is about priced fixtures; no-market accuracy is in train_final
    }
    const prices = pricesOf(row);
    const dec = D.decide({ p: pred.p, base: pred.base, prices, opts: OPTS });
    const grade = D.confidence(dec.main, { hasMarket: true, coverage: 1, crossLeague: false }, null).level;
    if (DUMP) {
      DUMP.write(JSON.stringify({
        div: r.div, date, home: r.home, away: r.away, hg, ag,
        main: brief(dec.main), safer: brief(dec.safer), value: brief(dec.value), avoid: dec.avoid.map((a) => a.key),
        p: Object.fromEntries(DUMP_KEYS.map((k) => [k, r4(pred.p[k])])), base: Object.fromEntries(DUMP_KEYS.map((k) => [k, r4(pred.base[k])])),
        prices: Object.fromEntries(Object.entries(prices).map(([k, v]) => [k, [v.ref ? v.ref.price : null, v.best ? v.best.price : null]])),
      }) + '\n');
    }
    const st = (pick) => (pick ? settle(pick.key, hg, ag) : null);
    add(S.main, dec.main, st(dec.main), prices);
    add(S.safer, dec.safer, st(dec.safer), prices);
    add(S.value, dec.value, st(dec.value), prices);
    if (dec.main && prices[dec.main.key]) add(S.mainPricedOnly, dec.main, st(dec.main), prices);
    if (dec.main) {
      S.byGrade[grade] = S.byGrade[grade] || acc();
      add(S.byGrade[grade], dec.main, st(dec.main), prices);
      S.byKey[dec.main.key] = S.byKey[dec.main.key] || acc();
      add(S.byKey[dec.main.key], dec.main, st(dec.main), prices);
    }
    // v5's general rule on the price alone (most likely selection with fair odds >= 1.30)
    const v5 = D.MAIN_KEYS.map((k) => ({ key: k, prob: pred.base[k] })).filter((x) => x.prob != null && 1 / x.prob >= 1.3).sort((a, b) => b.prob - a.prob)[0];
    add(S.v5rule, v5, st(v5), prices);
    for (const a of dec.avoid) {
      const res = settle(a.key, hg, ag);
      if (res == null) continue;
      S.avoid.n++;
      S.avoid.won += res;
      S.avoid.marketSaid += a.base;
      S.avoid.v6Said += a.prob;
    }
    // market-level accuracy, v6 vs price-only, every derived market
    for (const k of ['1', 'X', '2', 'O1.5', 'O2.5', 'O3.5', 'BTTS_Y', 'TTH_O0.5', 'TTA_O0.5', 'TTH_O1.5', 'TTA_O1.5']) {
      const y = settle(k, hg, ag);
      if (y == null) continue;
      LL('v6:' + k, pred.p[k], y);
      LL('price:' + k, pred.base[k], y);
    }
    if (pred.pBtts != null) LL('v6model:BTTS_Y', pred.pBtts, settle('BTTS_Y', hg, ag));
  }
  const out = {
    window: [FROM, TO],
    opts: { ...D.DEFAULTS, ...OPTS },
    fixtures: S.n,
    noMarket: S.noMarket,
    main: fin(S.main),
    mainPricedOnly: fin(S.mainPricedOnly),
    safer: fin(S.safer),
    value: fin(S.value),
    v5rule: fin(S.v5rule),
    grades: Object.fromEntries(Object.entries(S.byGrade).map(([k, v]) => [k, fin(v)])),
    byKey: Object.fromEntries(Object.entries(S.byKey).map(([k, v]) => [k, fin(v)])),
    avoid: { n: S.avoid.n, won: S.avoid.n ? S.avoid.won / S.avoid.n : null, marketSaid: S.avoid.n ? S.avoid.marketSaid / S.avoid.n : null, v6Said: S.avoid.n ? S.avoid.v6Said / S.avoid.n : null },
    logloss: Object.fromEntries(Object.entries(S.logloss).map(([k, v]) => [k, { n: v.n, ll: v.sum / v.n }])),
  };
  if (DUMP) DUMP.end();
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ fixtures: out.fixtures, main: out.main, safer: out.safer, value: out.value, v5rule: out.v5rule, avoid: out.avoid, grades: out.grades }, null, 1));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
