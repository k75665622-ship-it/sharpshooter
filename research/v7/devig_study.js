'use strict';

/**
 * research/v7/devig_study.js — which way of removing the bookmaker's margin gives the most
 * accurate probabilities?
 *
 *   node research/v7/devig_study.js <Matches.csv> [from=2012-07-01]
 *
 * For every match with a Bet365 1X2 price (and the best price of the books, "Max"), the fair
 * probabilities are computed with each method and scored on the real result (log-loss, lower is
 * better), tuning seasons (to 2023-06) and held-out seasons (2023-07 on) apart. The same for
 * Over/Under 2.5 goals. Also printed: how well each method's probabilities are calibrated for
 * strong favourites, where the Strongest Picks live.
 *
 * Methods
 *   prop    q_i / sum(q)                      (the margin shared in proportion to the price)
 *   power   q_i^k with sum = 1                (more margin taken off outsiders)
 *   shin    Shin (1993): the margin as protection against insiders
 *   or      odds ratio: q_i / (c + q_i - c q_i)
 *   blend   0.6 power + 0.4 prop              (the engine up to v6)
 */

const fs = require('fs');
const DV = require('../../lib/devig');

const [, , file, fromArg] = process.argv;
const FROM = fromArg || '2012-07-01';
const SPLIT = '2023-07-01';

const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
const H = lines[0].split(',');
const ix = (n) => H.indexOf(n);
const I = { div: 0, date: ix('MatchDate'), hg: ix('FTHome'), ag: ix('FTAway'), h: ix('OddHome'), d: ix('OddDraw'), a: ix('OddAway'), mh: ix('MaxHome'), md: ix('MaxDraw'), ma: ix('MaxAway'), o: ix('Over25'), u: ix('Under25'), mo: ix('MaxOver25'), mu: ix('MaxUnder25') };
const num = (v) => (v === '' || v == null ? null : Number(v));
const odd = (v) => {
  const x = num(v);
  return x != null && x > 1.0001 ? x : null;
};

const METHODS = { prop: DV.proportional, power: DV.power, shin: DV.shin, or: DV.oddsRatio, blend: (o) => DV.blend(o, 0.6) };
const acc = () => ({ n: 0, ll: 0 });
const R = { x12: {}, ou: {}, fav: {} };
const put = (tab, name, part, p) => {
  const a = ((tab[name] = tab[name] || { tune: acc(), held: acc() })[part]);
  a.n++;
  a.ll -= Math.log(Math.max(1e-6, p));
};

for (let i = 1; i < lines.length; i++) {
  if (!lines[i]) continue;
  const c = lines[i].split(',');
  const date = c[I.date];
  if (!date || date < FROM) continue;
  const hg = num(c[I.hg]);
  const ag = num(c[I.ag]);
  if (hg == null || ag == null) continue;
  const part = date < SPLIT ? 'tune' : 'held';
  const b = [odd(c[I.h]), odd(c[I.d]), odd(c[I.a])];
  const mx = [odd(c[I.mh]), odd(c[I.md]), odd(c[I.ma])];
  const res = hg > ag ? 0 : hg === ag ? 1 : 2;
  if (b.every(Boolean)) {
    const fair = {};
    for (const [name, f] of Object.entries(METHODS)) {
      const p = f(b);
      if (!p) continue;
      fair[name] = p;
      put(R.x12, `b365 ${name}`, part, p[res]);
    }
    if (mx.every(Boolean) && mx.reduce((s, o) => s + 1 / o, 0) > 1.0005) {
      for (const [name, f] of Object.entries(METHODS)) {
        const p = f(mx);
        if (!p) continue;
        put(R.x12, `max ${name}`, part, p[res]);
        if (fair[name]) put(R.x12, `b365+max ${name} (mean)`, part, (p[res] + fair[name][res]) / 2);
      }
    }
    // strong favourites: the favourite's stated chance against how often it won
    for (const name of Object.keys(METHODS)) {
      const p = fair[name];
      if (!p) continue;
      const f = p[0] >= p[2] ? 0 : 2;
      const pf = p[f];
      const bk = pf >= 0.8 ? '80%+' : pf >= 0.7 ? '70-80%' : pf >= 0.6 ? '60-70%' : null;
      if (!bk) continue;
      const a = ((R.fav[`${name} ${bk}`] = R.fav[`${name} ${bk}`] || { tune: { n: 0, w: 0, p: 0 }, held: { n: 0, w: 0, p: 0 } })[part]);
      a.n++;
      a.w += res === f ? 1 : 0;
      a.p += pf;
      // and the double chance of the favourite (favourite or draw)
      const a2 = ((R.fav[`${name} DC of ${bk}`] = R.fav[`${name} DC of ${bk}`] || { tune: { n: 0, w: 0, p: 0 }, held: { n: 0, w: 0, p: 0 } })[part]);
      a2.n++;
      a2.w += res === f || res === 1 ? 1 : 0;
      a2.p += pf + p[1];
    }
  }
  const ou = [odd(c[I.o]), odd(c[I.u])];
  if (ou.every(Boolean)) {
    const over = hg + ag > 2.5 ? 0 : 1;
    for (const [name, f] of Object.entries(METHODS)) {
      const p = f(ou);
      if (p) put(R.ou, `b365 ${name}`, part, p[over]);
    }
  }
}

const show = (tab, title) => {
  console.log(`\n${title}`);
  const base = tab['b365 blend'];
  for (const [k, v] of Object.entries(tab)) {
    const t = v.tune.ll / v.tune.n;
    const h = v.held.ll / v.held.n;
    const dt = base ? (t / (base.tune.ll / base.tune.n) - 1) * 100 : 0;
    const dh = base ? (h / (base.held.ll / base.held.n) - 1) * 100 : 0;
    console.log(`  ${k.padEnd(26)} tune ${t.toFixed(5)} (${dt >= 0 ? '+' : ''}${dt.toFixed(3)}%) n=${v.tune.n}   held ${h.toFixed(5)} (${dh >= 0 ? '+' : ''}${dh.toFixed(3)}%) n=${v.held.n}`);
  }
};
show(R.x12, '1X2 log-loss (against the v6 engine\'s blend on Bet365)');
show(R.ou, 'Over/Under 2.5 log-loss');
console.log('\nStrong favourites: won - stated, points');
for (const [k, v] of Object.entries(R.fav).sort()) {
  const g = (a) => (a.n ? `${((a.w - a.p) / a.n * 100).toFixed(2).padStart(6)} (n=${a.n}, won ${(a.w / a.n * 100).toFixed(1)}%)` : '');
  console.log(`  ${k.padEnd(22)} tune ${g(v.tune)}   held ${g(v.held)}`);
}
