'use strict';

/**
 * research/v6/patterns_study.js — test every rule in lib/intel/rules.js, write lib/intel/rules.json.
 *
 *   node research/v6/patterns_study.js <features.csv> <out rules.json>
 *
 * For each rule and each priced match where it fires: the selection's de-vigged Bet365
 * probability ("what the price said") vs whether it won. z = (wins - sum p) / sqrt(sum p(1-p)).
 *
 *   discovery 2005-07-01 .. 2023-06-30, confirmation 2023-07-01 .. end
 *   trap / edge  |z| >= 2.5 in discovery (n >= 200) AND same sign with |z| >= 1.5 in confirmation (n >= 80)
 *   weak         |z| >= 2.5 in discovery, same sign since, not significant
 *   unstable     |z| >= 2.5 in discovery, opposite sign since
 *   priced-in    |z| <  2.5 in discovery
 */

const fs = require('fs');
const readline = require('readline');
const R = require('../../lib/intel/rules');
const { settle } = require('../../lib/settle');

const [, , file, outFile] = process.argv;
const num = (v) => (v === '' || v == null ? null : Number(v));
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

function selProb(key, f) {
  if (key === '1') return f.p1;
  if (key === '2') return f.p2;
  if (key === 'X') return f.pX;
  if (key === 'O2.5') return f.pO25;
  if (key === 'U2.5') return f.pO25 == null ? null : 1 - f.pO25;
  return null;
}
function selOdds(key, r) {
  const m = { '1': ['oh', 'mh'], '2': ['oa', 'ma'], X: ['od', 'md'], 'O2.5': ['oo', 'mo'], 'U2.5': ['ou', 'mu'] }[key];
  return m ? [num(r[m[0]]), num(r[m[1]])] : [null, null];
}

const acc = () => ({ n: 0, w: 0, p: 0, v: 0, rb: 0, nb: 0, rm: 0, nm: 0 });
function stat(a) {
  if (a.n < 30) return { n: a.n };
  return {
    n: a.n,
    said: a.p / a.n,
    won: a.w / a.n,
    gap: (a.w - a.p) / a.n,
    z: (a.w - a.p) / Math.sqrt(a.v),
    roiBet365: a.nb ? a.rb / a.nb : null,
    roiBest: a.nm ? a.rm / a.nm : null,
  };
}

async function main() {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let head = null;
  const D = {};
  const C = {};
  for (const r of R.RULES) {
    D[r.id] = acc();
    C[r.id] = acc();
  }
  for await (const line of rl) {
    if (!head) {
      head = csvSplit(line);
      continue;
    }
    const c = csvSplit(line);
    const date = c[1];
    if (date < '2005-07-01') continue;
    const row = {};
    for (let i = 0; i < head.length; i++) row[head[i]] = c[i];
    const f = {};
    for (let i = 22; i < head.length; i++) f[head[i]] = num(c[i]);
    if (f.p1 == null) continue;
    const v = R.view(f);
    const hg = Number(row.hg);
    const ag = Number(row.ag);
    const bucket = date <= '2023-06-30' ? D : C;
    for (const r of R.RULES) {
      let hit = false;
      try {
        hit = r.when(v);
      } catch {
        hit = false;
      }
      if (!hit) continue;
      const key = R.keyOf(r.selection, v);
      const p = selProb(key, f);
      if (p == null) continue;
      const won = settle(key, hg, ag);
      if (won == null) continue;
      const a = bucket[r.id];
      a.n++;
      a.w += won;
      a.p += p;
      a.v += p * (1 - p);
      const [ob, om] = selOdds(key, row);
      if (ob > 1) {
        a.nb++;
        a.rb += won ? ob - 1 : -1;
      }
      if (om > 1) {
        a.nm++;
        a.rm += won ? om - 1 : -1;
      }
    }
  }
  const out = { generated: new Date().toISOString().slice(0, 10), discovery: ['2005-07-01', '2023-06-30'], confirm: ['2023-07-01', 'end'], rules: {} };
  for (const r of R.RULES) {
    const d = stat(D[r.id]);
    const cf = stat(C[r.id]);
    let status = 'priced-in';
    if (d.n >= 200 && Math.abs(d.z) >= 2.5) {
      if (cf.n >= 80 && Math.sign(cf.z) === Math.sign(d.z) && Math.abs(cf.z) >= 1.5) status = d.z < 0 ? 'trap' : 'edge';
      else if (cf.n >= 30 && Math.sign(cf.z) === Math.sign(d.z)) status = 'weak';
      else if (cf.n >= 30) status = 'unstable';
      else status = 'weak';
    }
    out.rules[r.id] = { desc: r.desc, selection: r.selection, status, discovery: d, confirm: cf };
    const f2 = (s) => (s.n >= 30 ? `n=${s.n} said=${s.said.toFixed(3)} won=${s.won.toFixed(3)} z=${s.z >= 0 ? '+' : ''}${s.z.toFixed(2)}` : `n=${s.n}`);
    console.log(`${status.padEnd(10)} ${r.id.padEnd(24)} DISC ${f2(d)} | CONF ${f2(cf)}`);
  }
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
}

main();
