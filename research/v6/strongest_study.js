'use strict';

/**
 * research/v6/strongest_study.js — the Strongest Picks rule (lib/strongest, production code) on history.
 *
 *   SHARPSHOOTER_V6_MODELS=<honest compact models> SHARPSHOOTER_CALIBRATION=<tune-only calibration> \
 *   node --max-old-space-size=8000 research/v6/strongest_study.js <Matches.csv> <features.csv> <states.json> <out.jsonl> [from=2019-07-01]
 *
 * Walk-forward over every priced match (nothing from a match day is known before its matches):
 *
 *   goal views   market   lib/ensemble.js exactly as the engine runs it: the de-vigged Bet365
 *                         1X2 + Over/Under 2.5 price (90%) and the model (10%), calibrated
 *                stats    the ensemble's model-only witness: Dixon-Coles ratings, the shots-on-target
 *                         rating model (the archive's stand-in for ESPN xG) and ClubElo, calibrated
 *                         (research/build_states.js rebuilds these for the site's 18 divisions;
 *                         elsewhere the v6 factor models without the price stand in, flagged live:0)
 *                factors  the v6 models with the price (models trained on 2005-2019 only)
 *   corners and  lib/strongest/inputs.js cornerRates / cardRate / leagueEnv on the same archive the
 *   cards        site crawls (season and last-6 views; the archive names no referees)
 *
 * lib/strongest/markets.js prices every selection of the nine groups, picks.js chooses the match's
 * Strongest Pick (and its blockers), and every selection is settled on the real result: goals,
 * halves, corners, cards. Minutes markets have no goal times in the archive and stay unsettled.
 * Point SHARPSHOOTER_CALIBRATION at a calibration fitted on 2019-23 only, so 2023-26 stays held out.
 *
 * Output (JSONL, one match per line):
 *   { d, div, h, a, hg, ag, live, s:[[key, prob, floor, {view:p}, result, blocked, measured]...], pick, x }
 * blocked: a bit mask of the pick rules' blockers other than the chance / lowest-view / price
 * bars (0 = only those bars can stop it).
 * Selections whose lowest view is under 0.5 are left out (they never qualify for anything);
 * x keeps the raw ingredients (expected goals per view, corner and card rates, the result's
 * half-time score, corners and cards) so better models can be fitted from the file.
 */

const fs = require('fs');
const readline = require('readline');
const RC = require('../../lib/factors/records');
const { History } = require('../../lib/factors/history');
const P = require('../../lib/intel/predict');
const D = require('../../lib/intel/decision');
const RULES = require('../../lib/intel/rules');
const MK = require('../../lib/market');
const ENS = require('../../lib/ensemble');
const MAR = require('../../lib/strongest/markets');
const IN = require('../../lib/strongest/inputs');
const PK = require('../../lib/strongest/picks');
const C = require('../../lib/strongest/config');
const { settle } = require('../../lib/settle');

const [, , matchesFile, featuresFile, statesFile, outFile, fromArg] = process.argv;
const FROM = fromArg || '2019-07-01';
const r3 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000);
const OTHER = [
  [/kicked off/, 1], [/line-up/, 2], [/no measured record|cannot be measured/, 4], [/kept off the list/, 8],
  [/Only one view/, 16], [/No bookmaker price to anchor/, 32], [/archived games/, 64], [/trap/, 128],
  [/below the price/, 256], [/team-news/, 512],
];

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

/** Settle any Strongest selection on the archive row (1 win, 0 loss, null unknown / push). */
function settleSel(key, m) {
  const hg = m.hg;
  const ag = m.ag;
  const ht = m.hthg != null && m.htag != null;
  const h1 = m.hthg;
  const a1 = m.htag;
  const h2 = ht ? hg - h1 : null;
  const a2 = ht ? ag - a1 : null;
  const b = (c) => (c ? 1 : 0);
  let mm;
  if (/^(1|X|2|1X|X2|12|BTTS_[YN]|[OU]\d\.5|TT[HA]_[OU]\d\.5)$/.test(key)) return settle(key, hg, ag);
  switch (key) {
    case 'H1_O0.5': return ht ? b(h1 + a1 > 0) : null;
    case 'H1_U1.5': return ht ? b(h1 + a1 < 1.5) : null;
    case 'H2_O0.5': return ht ? b(h2 + a2 > 0) : null;
    case 'H2_O1.5': return ht ? b(h2 + a2 > 1.5) : null;
    case 'HT_1': return ht ? b(h1 > a1) : null;
    case 'HT_X': return ht ? b(h1 === a1) : null;
    case 'HT_2': return ht ? b(a1 > h1) : null;
    case 'HSH_2': return ht ? b(h2 + a2 > h1 + a1) : null;
    case 'WEH_H': return ht ? b(h1 > a1 || h2 > a2) : null;
    case 'WEH_A': return ht ? b(a1 > h1 || a2 > h2) : null;
    case 'WBH_H': return ht ? b(h1 > a1 && h2 > a2) : null;
    case 'WBH_A': return ht ? b(a1 > h1 && a2 > h2) : null;
    case 'WO15_H': return b(hg > ag && hg + ag >= 2);
    case 'WO15_A': return b(ag > hg && hg + ag >= 2);
    case 'WTN_H': return b(hg > ag && ag === 0);
    case 'WTN_A': return b(ag > hg && hg === 0);
    case 'GG_O2.5': return b(hg > 0 && ag > 0 && hg + ag >= 3);
    case 'DC1X_U3.5': return b(hg >= ag && hg + ag <= 3);
    case 'DCX2_U3.5': return b(ag >= hg && hg + ag <= 3);
    case 'DC1X_O1.5': return b(hg >= ag && hg + ag >= 2);
    case 'DCX2_O1.5': return b(ag >= hg && hg + ag >= 2);
    case 'HTFT_HH': return ht ? b(h1 > a1 && hg > ag) : null;
    case 'HTFT_AA': return ht ? b(a1 > h1 && ag > hg) : null;
    default: break;
  }
  const corners = m.hc != null && m.ac != null;
  if ((mm = /^C_([OU])(\d+\.5)$/.exec(key))) return corners ? (mm[1] === 'O' ? b(m.hc + m.ac > Number(mm[2])) : b(m.hc + m.ac < Number(mm[2]))) : null;
  if (key === 'C_MOST_H') return corners ? b(m.hc > m.ac) : null;
  if (key === 'C_MOST_A') return corners ? b(m.ac > m.hc) : null;
  if ((mm = /^C([HA])_O(\d+\.5)$/.exec(key))) return corners ? b((mm[1] === 'H' ? m.hc : m.ac) > Number(mm[2])) : null;
  if ((mm = /^K_([OU])(\d+\.5)$/.exec(key))) {
    if (m.hy == null || m.ay == null) return null;
    const k = m.hy + m.ay + (m.hr || 0) + (m.ar || 0);
    return mm[1] === 'O' ? b(k > Number(mm[2])) : b(k < Number(mm[2]));
  }
  return null; // minutes markets, players: no data
}

async function loadFeatures() {
  const map = new Map();
  const rl = readline.createInterface({ input: fs.createReadStream(featuresFile), crlfDelay: Infinity });
  let head = null;
  for await (const line of rl) {
    if (!head) {
      head = csvSplit(line);
      continue;
    }
    const c = csvSplit(line);
    if (c[1] < FROM) continue;
    const f = {};
    for (let i = 22; i < head.length; i++) f[head[i]] = num(c[i]);
    f.divc = c[0];
    map.set(`${c[0]}|${c[1]}|${c[3]}|${c[4]}`, f);
  }
  return map;
}

function loadStates() {
  const map = new Map();
  if (!statesFile || statesFile === '-') return map;
  for (const r of JSON.parse(fs.readFileSync(statesFile, 'utf8'))) map.set(`${r.div}|${r.date}|${r.home}|${r.away}`, r);
  return map;
}

/**
 * The three goal views for one match, as lib/strongest/inputs.js goalViews builds them from
 * the engine report: market = calibrated ensemble (mk.prob), stats = calibrated model-only
 * witness (mk.modelProb), factors = v6 (intel.probs).
 */
function goalViews(f, st) {
  const pred = P.predict(f);
  if (!pred || pred.source !== 'market+factors' || !pred.base) return null;
  const views = [];
  const dc = st && st.c['dc_0.0025_6'];
  const sot = st && st.c.sot;
  const mk = st && st.c.mkt ? { lamH: st.c.mkt.lh, lamA: st.c.mkt.la } : (() => {
    const b = P.matrixFrom([f.p1, f.pX, f.p2], f.pO25, f.lamT || f.lgGoals || 2.6);
    return b ? { lamH: b.lamH, lamA: b.lamA } : null;
  })();
  const ens = ENS.combine({
    market: mk,
    ratings: dc ? { lamH: dc.lh, lamA: dc.la, confidence: dc.conf } : null,
    xg: sot ? { lamH: sot.lh, lamA: sot.la } : null,
    eloDiff: st && st.elo != null ? st.elo : null,
  });
  let live = 0;
  if (ens) {
    const markets = ENS.deriveMarkets(ens);
    const cal = {};
    const mcal = {};
    for (const m of markets) {
      if (m.prob != null) cal[m.key] = m.prob;
      if (m.modelProb != null) mcal[m.key] = m.modelProb;
    }
    views.push({ name: 'market', lamH: ens.lamH, lamA: ens.lamA, rho: MK.rhoFor(ens.lamH + ens.lamA), cal });
    if (ens.model && dc && sot) {
      views.push({ name: 'stats', lamH: ens.model.lamH, lamA: ens.model.lamA, rho: MK.rhoFor(ens.model.lamH + ens.model.lamA), cal: mcal });
      live = 1;
    }
  }
  if (!live) {
    // outside the 18 rebuilt divisions: the v6 factors with every price feature removed
    const g = { ...f };
    for (const k of ['p1', 'pX', 'p2', 'pO25', 'ovr', 'ovrOU', 'disp1', 'dispX', 'disp2', 'dispO', 'dispU', 'lamH', 'lamA', 'lamT', 'ahLine']) g[k] = null;
    const s = P.predict(g);
    if (s && s.lamH > 0 && s.lamA > 0) views.push({ name: 'stats', lamH: s.lamH, lamA: s.lamA, rho: MK.rhoFor(s.lamH + s.lamA), cal: s.p });
  }
  views.push({ name: 'factors', lamH: pred.lamH, lamA: pred.lamA, rho: MK.rhoFor(pred.lamH + pred.lamA), cal: pred.p });
  return { views, pred, live, mk };
}

async function main() {
  console.time('features');
  const feats = await loadFeatures();
  const states = loadStates();
  console.timeEnd('features');
  console.log('feature rows', feats.size, 'states', states.size);

  console.time('load');
  const lines = fs.readFileSync(matchesFile, 'utf8').split(/\r?\n/);
  const head = lines[0].split(',');
  const recs = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const c = lines[i].split(',');
    const o = {};
    for (let k = 0; k < head.length; k++) o[head[k]] = c[k];
    const mr = RC.fromDatasetRow(o);
    if (mr && mr.hg != null && mr.ag != null) recs.push(mr);
  }
  recs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  console.timeEnd('load');

  // written synchronously: the walk never yields to the event loop, so a stream would buffer it all
  const fd = fs.openSync(outFile, 'w');
  const H = new History();
  let i = 0;
  let n = 0;
  let picks = 0;
  console.time('study');
  while (i < recs.length) {
    const day = recs[i].date;
    let j = i;
    while (j < recs.length && recs[j].date === day) j++;
    if (day >= FROM) {
      for (let k = i; k < j; k++) {
        const m = recs[k];
        const f = feats.get(`${m.league}|${m.date}|${m.home}|${m.away}`);
        if (!f) continue;
        const gv = goalViews(f, states.get(`${m.league}|${m.date}|${m.home}|${m.away}`));
        if (!gv) continue;
        const homeLog = H.teamLog(m.league, m.home, day, 40);
        const awayLog = H.teamLog(m.league, m.away, day, 40);
        const env = IN.leagueEnv(H, m.league, day);
        const timing = MAR.defaultTiming(env && env.firstHalf ? env.firstHalf.used : C.firstHalfShare);
        const meetings = H.h2h(m.league, m.home, m.away, day, 6, 10);
        const h2h = IN.h2hFacts(meetings, m.home, env);
        // the possession model (lib/pace.js) as a fourth goal view, exactly as gather() adds it
        const pv = IN.paceView(env, homeLog, awayLog);
        if (pv) gv.views.push(pv);
        // raw ingredients, kept so better corner / card models can be fitted from this file
        const x = {
          mk: gv.mk ? [r3(gv.mk.lamH), r3(gv.mk.lamA)] : null,
          st: (() => { const v = gv.views.find((w) => w.name === 'stats'); return v ? [r3(v.lamH), r3(v.lamA)] : null; })(),
          fa: [r3(gv.pred.lamH), r3(gv.pred.lamA)],
          pr: [r3(f.p1), r3(f.pX), r3(f.p2), r3(f.pO25)],
          elo: [m.eloH, m.eloA],
          ht: [m.hthg, m.htag],
          co: [m.hc, m.ac],
          ca: [m.hy, m.ay, m.hr, m.ar],
          s1: r3(timing.s1),
        };
        if (pv) {
          const d = pv.detail;
          const b = env.shots;
          x.pc = [r3(d.lamH), r3(d.lamA), r3(d.home.attack), r3(d.home.defence), r3(d.home.finishing), r3(d.home.keeping),
            r3(d.away.attack), r3(d.away.defence), r3(d.away.finishing), r3(d.away.keeping),
            r3(b.home.shots), r3(b.away.shots), r3(b.home.goals), r3(b.away.goals), d.home.games, d.away.games];
        }
        if (env && env.corners && homeLog.length && awayLog.length) {
          const base = env.corners;
          const sH = IN.cornerRates(homeLog, 'H', base, C.seasonGames, 0.5);
          const sA = IN.cornerRates(awayLog, 'A', base, C.seasonGames, 0.5);
          const rH = IN.cornerRates(homeLog, 'H', base, C.recentGames, 0);
          const rA = IN.cornerRates(awayLog, 'A', base, C.recentGames, 0);
          if (sH.games && sA.games) {
            x.cb = [r3(base.home), r3(base.away), r3(base.dispersion)];
            x.cs = [r3(sH.att), r3(sH.def), r3(sA.att), r3(sA.def), sH.games, sA.games];
            x.cr = [r3(rH.att), r3(rH.def), r3(rA.att), r3(rA.def), rH.games, rA.games];
          }
        }
        if (env && env.cards && homeLog.length && awayLog.length) {
          const base = env.cards;
          const hf = h2h && h2h.cards ? h2h.cards.factor : 1;
          const sH = IN.cardRate(homeLog, 'H', base, C.seasonGames, 0.5);
          const sA = IN.cardRate(awayLog, 'A', base, C.seasonGames, 0.5);
          const rH = IN.cardRate(homeLog, 'H', base, C.recentGames, 0);
          const rA = IN.cardRate(awayLog, 'A', base, C.recentGames, 0);
          if (sH.games && sA.games) {
            x.kb = [r3(base.home), r3(base.away), r3(base.dispersion), r3(hf)];
            x.ks = [r3(sH.rate), r3(sA.rate), sH.games, sA.games];
            x.kr = [r3(rH.rate), r3(rA.rate), rH.games, rA.games];
          }
        }
        // the production corner and card views (lib/strongest/inputs.js statsViews); the archive
        // names no referees, so the referee factor stays at 1
        const sv = IN.statsViews({ env, homeLog, awayLog, h2h, referee: null, lamMarket: gv.mk ? { home: gv.mk.lamH, away: gv.mk.lamA } : null, pace: pv ? { ...pv.detail, base: env.shots } : null });
        const sels = MAR.price({ names: { home: m.home, away: m.away }, goalViews: gv.views, timing, cornerViews: sv.corners, cardViews: sv.cards, players: [] });
        // the pick rules' context, as inputs.js builds it
        const patterns = RULES.evaluate(f);
        const ruleTraps = new Set(patterns.filter((p) => p.verdict === 'trap').map((p) => p.key));
        const dec = D.decide({ p: gv.pred.p, base: gv.pred.base, prices: {}, exclude: ruleTraps });
        const shift = {};
        for (const [kk, p] of Object.entries(gv.pred.p)) if (p != null && gv.pred.base[kk] != null) shift[kk] = p - gv.pred.base[kk];
        const ctx = {
          hasMarket: true,
          started: false,
          avoid: new Set(dec.avoid.map((a) => a.key)),
          ruleTraps,
          shift,
          news: { home: { highs: 0 }, away: { highs: 0 } },
          statsGames: { home: homeLog.slice(0, C.seasonGames).filter((g) => g.cf != null).length, away: awayLog.slice(0, C.seasonGames).filter((g) => g.cf != null).length },
        };
        const sel = PK.select([{ id: 'x', kickoff: day, sels, ctx }]);
        const pick = sel.picks[0] ? sel.picks[0].sel.key : null;
        const S = [];
        for (const s of sels) {
          if (s.group === 'Players' || s.floor < 0.5) continue;
          const res = settleSel(s.key, m);
          const why = PK.blockers(s, ctx);
          // blockers other than the three bars (chance, lowest view, price), as a bit mask, so
          // research/v6/strongest_report.js can re-run the selection under other bars
          const blocked = why.reduce((a, w) => a | (OTHER.find(([re]) => re.test(w)) || [null, 0])[1], 0);
          // views by initial: market / stats / factors / pace for goals; model / season / recent
          // for corners and cards
          S.push([s.key, r3(s.prob), r3(s.floor), Object.fromEntries(Object.entries(s.views).map(([kk, v]) => [kk[0], r3(v)])), res, blocked, s.measured ? 1 : 0]);
        }
        fs.writeSync(fd, JSON.stringify({ d: day, div: m.league, h: m.home, a: m.away, hg: m.hg, ag: m.ag, live: gv.live, s: S, pick, x }) + '\n');
        n++;
        if (pick) picks++;
      }
    }
    for (let k = i; k < j; k++) H.add(recs[k]);
    H._tableCache.clear();
    i = j;
    if (day >= FROM && day.endsWith('-01')) process.stdout.write(`${day} ${n} matches ${picks} picks\n`);
  }
  fs.closeSync(fd);
  console.log();
  console.timeEnd('study');
  console.log('matches', n, 'picks', picks);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
