'use strict';

/**
 * research/v6/banker_dump.js — everything the High Banker gates look at, for every historical match.
 *
 *   SHARPSHOOTER_V6_MODELS=<honest compact models> \
 *   node --max-old-space-size=6144 research/v6/banker_dump.js <features.csv> <methods_ids.json> <out.jsonl> [from] [to]
 *
 * Per priced match: the production v6 probabilities (models trained on 2005-2019 only), the price
 * alone, the production decision (main / safer / avoid, with confirmed trap rules excluded exactly
 * as on the site), the patterns that fire (lib/intel/rules.js), the trend factors the banker's
 * red-flag checks read, the methodologies that qualify (status PREDICT or LOCK, from
 * research/backtest_methods.js) and the final score. research/v6/banker_study.js then runs the
 * production banker code (lib/banker) over this file.
 */

const fs = require('fs');
const readline = require('readline');
const P = require('../../lib/intel/predict');
const D = require('../../lib/intel/decision');
const RULES = require('../../lib/intel/rules');
const F = require('../../lib/factors/features');
const BK = require('../../lib/banker');

const [, , file, methodsFile, outFile, fromArg, toArg] = process.argv;
const FROM = fromArg || '2019-07-01';
const TO = toArg || '2099-01-01';
const KEYS = ['1', 'X', '2', '1X', 'X2', '12', 'DNB_H', 'DNB_A', 'O1.5', 'O2.5', 'O3.5', 'U1.5', 'U2.5', 'U3.5', 'BTTS_Y', 'BTTS_N',
  'TTH_O0.5', 'TTA_O0.5', 'TTH_O1.5', 'TTA_O1.5', 'TTH_U1.5', 'TTA_U1.5'];
const CATALOG = F.catalog().map((c) => c.key);
const r4 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10000) / 10000);

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

/** Bet365 and best-of-market prices for the markets the archive prices (1X2, DC, DNB from 1X2; O/U 2.5). */
function pricesOf(r) {
  const out = {};
  const set = (k, ref, best) => {
    if (ref > 1 || best > 1) out[k] = [ref > 1 ? r4(ref) : null, best > 1 ? r4(best) : ref > 1 ? r4(ref) : null];
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
  return out;
}

async function loadMethods() {
  // PREDICT / LOCK selections per fixture (the 172 MB file is parsed once)
  const M = JSON.parse(fs.readFileSync(methodsFile, 'utf8'));
  const by = new Map();
  for (const r of M.rows) {
    if (!r.date || r.date < FROM || r.date > TO) continue;
    if (r.status !== 'PREDICT' && r.status !== 'LOCK') continue;
    const k = `${r.div}|${r.date}|${r.home}|${r.away}`;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push({ id: r.id, key: r.key, status: r.status });
  }
  return by;
}

async function main() {
  const methods = methodsFile && methodsFile !== '-' ? await loadMethods() : new Map();
  const out = fs.createWriteStream(outFile);
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  let head = null;
  let n = 0;
  for await (const line of rl) {
    if (!head) {
      head = csvSplit(line);
      continue;
    }
    const c = csvSplit(line);
    const date = c[1];
    if (date < FROM || date > TO) continue;
    const r = {};
    for (let i = 0; i < 22; i++) r[head[i]] = c[i];
    const f = {};
    for (let i = 22; i < head.length; i++) f[head[i]] = num(c[i]);
    f.divc = r.div;
    const pred = P.predict(f);
    if (!pred || pred.source !== 'market+factors') continue;
    const patterns = RULES.evaluate(f);
    const trapKeys = new Set(patterns.filter((p) => p.verdict === 'trap').map((p) => p.key));
    const row = { oh: num(r.oh), od: num(r.od), oa: num(r.oa), mh: num(r.mh), md: num(r.md), ma: num(r.ma), oo: num(r.oo), ou: num(r.ou), mo: num(r.mo), mu: num(r.mu) };
    const pr = pricesOf(row);
    const prices = {};
    for (const [k, [ref, best]] of Object.entries(pr)) prices[k] = { best: best ? { price: best, book: 'best' } : null };
    const dec = D.decide({ p: pred.p, base: pred.base, prices, exclude: trapKeys });
    const known = CATALOG.filter((k) => f[k] != null).length;
    const fx = {};
    for (const k of BK.TREND_FACTORS) fx[k] = r4(f[k]);
    out.write(JSON.stringify({
      div: r.div, date, home: r.home, away: r.away, hg: Number(r.hg), ag: Number(r.ag),
      p: Object.fromEntries(KEYS.map((k) => [k, r4(pred.p[k])])),
      base: Object.fromEntries(KEYS.map((k) => [k, r4(pred.base[k])])),
      pr,
      ovrOU: r4(f.ovrOU),
      main: dec.main ? dec.main.key : null,
      safer: dec.safer ? dec.safer.key : null,
      avoid: dec.avoid.map((a) => a.key),
      pat: patterns.map((p) => p.id),
      f: fx,
      cov: r4(known / CATALOG.length),
      m: methods.get(`${r.div}|${date}|${r.home}|${r.away}`) || [],
    }) + '\n');
    n++;
    if (n % 10000 === 0) process.stderr.write(`${n} ${date}\n`);
  }
  out.end();
  process.stderr.write(`done: ${n} fixtures\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
