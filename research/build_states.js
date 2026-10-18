'use strict';

/**
 * research/build_states.js — walk-forward feature builder for the v5 backtest.
 *
 * Input:  the open "Club Football Match Data 2000-2025" table (football-data.co.uk
 *         results + Bet365 / max-of-17-books odds + ClubElo ratings), downloaded from
 *         https://github.com/xgabora/Club-Football-Match-Data-2000-2025
 * Output: one JSON row per test fixture with every model component computed using
 *         ONLY information dated before kick-off.
 *
 *   node research/build_states.js <Matches.csv> <out.json> [fromDate=2019-07-01]
 *
 * Components per fixture
 *   v4   the v4 production formula on results only (season averages + fixed shrink)
 *   dc   time-decayed Dixon-Coles ratings (lib/ratings.js), several (xi, ridge) variants
 *   sot  the same rating model fitted on shots-on-target (an xG proxy, as ESPN xG is in production)
 *   mkt  the Bet365 1X2 + O/U 2.5 implied lambdas (lib/market.js)
 *   elo  ClubElo difference (converted to goals later, once its scale is fitted)
 */

const fs = require('fs');
const path = require('path');
const R = require('../lib/ratings');
const MK = require('../lib/market');
const M = require('../lib/model');

const [, , file, outFile, fromArg] = process.argv;
if (!file || !outFile) {
  console.error('usage: node research/build_states.js <Matches.csv> <out.json> [fromDate]');
  process.exit(1);
}
const FROM = fromArg || '2019-07-01';
const DIVS = (process.env.DIVS || 'E0,E1,E2,E3,D1,D2,SP1,SP2,I1,I2,F1,F2,N1,P1,B1,T1,G1,SC0').split(',');
const VARIANTS = (process.env.VARIANTS || '0.0015:6,0.0025:6,0.004:6,0.0025:3,0.0025:12')
  .split(',').map((s) => { const [xi, ridge] = s.split(':').map(Number); return { xi, ridge, id: `${xi}_${ridge}` }; });

// ------------------------------------------------------------------ CSV
function parseCsv(text) {
  const lines = text.split(/\r?\n/);
  const head = lines[0].split(',');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = lines[i].split(','); // this file has no quoted fields
    const o = {};
    for (let k = 0; k < head.length; k++) o[head[k]] = c[k];
    out.push(o);
  }
  return out;
}
const num = (v) => (v === '' || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

const seasonOf = (d) => {
  const y = Number(d.slice(0, 4));
  return Number(d.slice(5, 7)) >= 7 ? y : y - 1;
};

// ------------------------------------------------------------------ load
console.time('load');
const rows = parseCsv(fs.readFileSync(file, 'utf8'));
console.timeEnd('load');
const byDiv = {};
for (const r of rows) {
  if (!DIVS.includes(r.Division)) continue;
  const hg = num(r.FTHome);
  const ag = num(r.FTAway);
  if (hg == null || ag == null) continue;
  const d = r.MatchDate;
  if (!d || d < '2015-07-01') continue;
  (byDiv[r.Division] = byDiv[r.Division] || []).push({
    div: r.Division,
    date: d,
    home: r.HomeTeam,
    away: r.AwayTeam,
    hg,
    ag,
    hs: num(r.HomeTarget),
    as: num(r.AwayTarget),
    eloH: num(r.HomeElo),
    eloA: num(r.AwayElo),
    o1: num(r.OddHome), oX: num(r.OddDraw), o2: num(r.OddAway),
    m1: num(r.MaxHome), mX: num(r.MaxDraw), m2: num(r.MaxAway),
    oO: num(r.Over25), oU: num(r.Under25), mO: num(r.MaxOver25), mU: num(r.MaxUnder25),
    ahL: num(r.HandiSize), ahH: num(r.HandiHome), ahA: num(r.HandiAway),
  });
}

// ------------------------------------------------------------------ v4 formula (results only)
function v4Lambdas(prior, hName, aName) {
  const win = prior.slice(-380);
  if (win.length < 60) return null;
  const lgGoals = win.reduce((a, m) => a + m.hg + m.ag, 0) / (win.length * 2);
  const homeShare = win.reduce((a, m) => a + m.hg, 0) / win.reduce((a, m) => a + m.hg + m.ag, 0);
  const row = (name) => {
    const g = [];
    for (let i = prior.length - 1; i >= 0 && g.length < 38; i--) {
      const m = prior[i];
      if (m.home === name || m.away === name) g.push(m);
    }
    if (g.length < 6) return null;
    let gf = 0, ga = 0, hgl = 0, agl = 0;
    for (const m of g) {
      if (m.home === name) { gf += m.hg; ga += m.ag; hgl += m.hg; } else { gf += m.ag; ga += m.hg; agl += m.ag; }
    }
    return { gp: g.length, xg: null, xga: null, gf, ga, homeGoals: hgl, awayGoals: agl };
  };
  const home = row(hName);
  const away = row(aName);
  if (!home || !away) return null;
  const est = M.estimateLambdas({ home, away, league: { xg: 0, goalsPerTeamPerGame: lgGoals, homeShare }, form: null, h2h: null, homeStrength: 1, awayStrength: 1 });
  return { lh: est.lamH, la: est.lamA };
}

// ------------------------------------------------------------------ walk forward
const out = [];
console.time('walk');
for (const div of DIVS) {
  const ms = (byDiv[div] || []).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!ms.length) continue;
  let fits = null;
  let fitWeek = null;
  let n = 0;
  for (let i = 0; i < ms.length; i++) {
    const fx = ms[i];
    if (fx.date < FROM) continue;
    // refit weekly (Monday-anchored) on everything strictly before this week
    const t = Date.parse(fx.date + 'T00:00:00Z');
    const week = Math.floor((t / 86400000 + 3) / 7);
    if (week !== fitWeek) {
      fitWeek = week;
      const asOf = new Date((week * 7 - 3) * 86400000).toISOString().slice(0, 10);
      const season = seasonOf(fx.date);
      const sStart = `${season}-07-01`;
      const prior = ms.filter((m) => m.date < asOf);
      const newcomers = R.newcomersAt(ms, asOf, sStart);
      // teams of the CURRENT fixture list that have no history yet are newcomers too
      const seen = new Set();
      for (const m of prior) { seen.add(m.home); seen.add(m.away); }
      for (let j = i; j < ms.length && ms[j].date < `${season + 1}-07-01`; j++) {
        if (!seen.has(ms[j].home)) newcomers.add(ms[j].home);
        if (!seen.has(ms[j].away)) newcomers.add(ms[j].away);
      }
      fits = { asOf, prior, dc: {}, sot: null };
      for (const v of VARIANTS) fits.dc[v.id] = R.fit(prior, { asOf, xi: v.xi, ridge: v.ridge, newcomers });
      // shots-on-target rating: goals replaced by SoT scaled to goal units
      const sotRows = prior.filter((m) => m.hs != null && m.as != null);
      if (sotRows.length > 200) {
        const g = sotRows.reduce((a, m) => a + m.hg + m.ag, 0);
        const s = sotRows.reduce((a, m) => a + m.hs + m.as, 0);
        const k = s ? g / s : 0.3;
        fits.sot = R.fit(sotRows.map((m) => ({ ...m, hg: m.hs * k, ag: m.as * k })), { asOf, xi: 0.0025, ridge: 6, newcomers });
      }
    }
    const rec = {
      div, date: fx.date, season: seasonOf(fx.date), home: fx.home, away: fx.away, hg: fx.hg, ag: fx.ag,
      odds: { o1: fx.o1, oX: fx.oX, o2: fx.o2, m1: fx.m1, mX: fx.mX, m2: fx.m2, oO: fx.oO, oU: fx.oU, mO: fx.mO, mU: fx.mU, ahL: fx.ahL, ahH: fx.ahH, ahA: fx.ahA },
      elo: fx.eloH != null && fx.eloA != null ? fx.eloH - fx.eloA : null,
      c: {},
    };
    const v4 = v4Lambdas(fits.prior, fx.home, fx.away);
    if (v4) rec.c.v4 = v4;
    for (const v of VARIANTS) {
      const p = R.predict(fits.dc[v.id], fx.home, fx.away);
      if (p) rec.c['dc_' + v.id] = { lh: p.lamH, la: p.lamA, conf: p.confidence };
    }
    if (fits.sot) {
      const p = R.predict(fits.sot, fx.home, fx.away);
      if (p) rec.c.sot = { lh: p.lamH, la: p.lamA };
    }
    const f1 = MK.fair([fx.o1, fx.oX, fx.o2]);
    const fo = MK.fair([fx.oO, fx.oU]);
    if (f1) {
      const s = MK.solveLambdas({ home: f1.probs[0], draw: f1.probs[1], away: f1.probs[2] }, fo ? { line: 2.5, over: fo.probs[0] } : null);
      if (s) rec.c.mkt = { lh: s.lamH, la: s.lamA, rms: s.rms, margin1x2: f1.margin };
    }
    out.push(rec);
    n++;
  }
  console.log(div, n);
}
console.timeEnd('walk');
fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(out));
console.log('wrote', out.length, 'rows to', outFile);
