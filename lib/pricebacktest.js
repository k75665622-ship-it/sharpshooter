'use strict';

/**
 * pricebacktest.js — walk-forward backtest WITH real historical bookmaker prices.
 *
 * The earlier backtest (backtest_methodology.js) could show hit rates and
 * calibration but not profit, because no historical odds were reachable.
 * football-data.co.uk publishes closing odds, so this answers the question that
 * matters: would betting the methodology's picks at the real price have made money?
 *
 * Method (no future information is used):
 *   - For each match in the test window, only earlier results build the evidence view.
 *   - Markets quoted that day (1X2, Over/Under 2.5, the main Asian handicap line) are
 *     given their REAL closing price, so the methodology's own price test
 *     (edge multiple, 1.25 floor, LOCK vs PREDICT) runs exactly as in production.
 *   - Each qualifying pick that has a real price is a 1-unit flat bet, settled on the
 *     actual score. Pushes return the stake.
 *   - Comparisons are reported next to the picks so the result can be judged:
 *       blind    the same method's best candidate bet on every priced fixture
 *       edgeOnly price edge present but gates ignored (do the gates add anything?)
 *
 * Honest limits: closing prices are sharp (a hard test, not a flattering one);
 * team news, Elo and xG do not exist historically, so those gates are waived or fail
 * closed; BTTS, team totals and GG/NG 2+ have no historical price and cannot be
 * profit-tested at all.
 */

const M = require('./model');
const MI = require('./methodology');
const FD = require('./fdata');

// -------------------------------------------------------------- settlement
/** 1 win, 0 lose, null push/void. */
function settle(key, hg, ag) {
  const tot = hg + ag;
  let m;
  switch (true) {
    case key === 'O2.5': return tot > 2 ? 1 : 0;
    case key === 'U2.5': return tot <= 2 ? 1 : 0;
    case key === 'BTTS_Y': return hg > 0 && ag > 0 ? 1 : 0;
    case key === 'BTTS_N': return hg > 0 && ag > 0 ? 0 : 1;
    case key === 'GG2P': return hg >= 2 && ag >= 2 ? 1 : 0;
    case key === '1': return hg > ag ? 1 : 0;
    case key === 'X': return hg === ag ? 1 : 0;
    case key === '2': return hg < ag ? 1 : 0;
    case (m = /^TT([HA])_([OU])(\d+(?:\.\d+)?)$/.exec(key)) !== null: {
      const g = m[1] === 'H' ? hg : ag;
      const line = Number(m[3]);
      return m[2] === 'O' ? (g > line ? 1 : 0) : g < line ? 1 : 0;
    }
    case (m = /^AH_([HA])_(-?\d+(?:\.\d+)?)$/.exec(key)) !== null: {
      const line = Number(m[2]);
      const d = m[1] === 'H' ? hg - ag + line : ag - hg - line;
      return d > 1e-9 ? 1 : d < -1e-9 ? 0 : null;
    }
    default: return null;
  }
}

const profitOf = (hit, price) => (hit == null ? 0 : hit ? price - 1 : -1);

// -------------------------------------------------------------- evidence from past results
function lambdasFromResults(prior, hName, aName) {
  const win = prior.slice(-380);
  if (win.length < 60) return null;
  const lgGoals = win.reduce((a, m) => a + m.hg + m.ag, 0) / (win.length * 2);
  const homeShare = win.reduce((a, m) => a + m.hg, 0) / win.reduce((a, m) => a + m.hg + m.ag, 0);
  const row = (name) => {
    const g = prior.filter((m) => m.home === name || m.away === name).slice(-38);
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
  return M.estimateLambdas({ home, away, league: { xg: 0, goalsPerTeamPerGame: lgGoals, homeShare }, form: null, h2h: null, homeStrength: 1, awayStrength: 1 });
}

function seasonStart(date, calendar) {
  const y = Number(date.slice(0, 4));
  const mo = Number(date.slice(5, 7));
  return calendar ? `${y}-01-01` : mo >= 7 ? `${y}-07-01` : `${y - 1}-07-01`;
}

function tableRanks(prior, date, calendar) {
  const from = seasonStart(date, calendar);
  const pts = {}, gd = {};
  for (let i = prior.length - 1; i >= 0; i--) {
    const m = prior[i];
    if (m.date < from) break;
    for (const [t, f, a] of [[m.home, m.hg, m.ag], [m.away, m.ag, m.hg]]) {
      pts[t] = (pts[t] || 0) + (f > a ? 3 : f === a ? 1 : 0);
      gd[t] = (gd[t] || 0) + f - a;
    }
  }
  const order = Object.keys(pts).sort((x, y) => pts[y] - pts[x] || gd[y] - gd[x]);
  const rank = {};
  order.forEach((t, i) => { rank[t] = i + 1; });
  return rank;
}

function teamGames(prior, name, limit) {
  const out = [];
  for (let i = prior.length - 1; i >= 0 && out.length < limit; i--) {
    const m = prior[i];
    if (m.home === name) out.push({ gf: m.hg, ga: m.ag, venue: 'H', date: m.date, opp: m.away });
    else if (m.away === name) out.push({ gf: m.ag, ga: m.hg, venue: 'A', date: m.date, opp: m.home });
  }
  return out;
}

function h2h(prior, hName, aName, limit) {
  const out = [];
  for (let i = prior.length - 1; i >= 0 && out.length < limit; i--) {
    const m = prior[i];
    if (m.home === hName && m.away === aName) out.push({ hg: m.hg, ag: m.ag, date: m.date });
    else if (m.home === aName && m.away === hName) out.push({ hg: m.ag, ag: m.hg, date: m.date });
  }
  return out;
}

function leagueRates(prior) {
  const win = prior.slice(-380);
  const n = win.length;
  if (n < 20) return null;
  let goals = 0, o25 = 0, btts = 0, hw = 0, dr = 0, aw = 0, hgSum = 0;
  for (const m of win) {
    const t = m.hg + m.ag;
    goals += t; hgSum += m.hg;
    if (t > 2) o25++;
    if (m.hg && m.ag) btts++;
    if (m.hg > m.ag) hw++; else if (m.hg === m.ag) dr++; else aw++;
  }
  return { n, goalsPerGame: goals / n, over25Rate: o25 / n, bttsRate: btts / n, homeWinRate: hw / n, drawRate: dr / n, awayWinRate: aw / n, homeGoalShare: goals ? hgSum / goals : 0.55 };
}

// -------------------------------------------------------------- statistics
function roi(list) {
  const n = list.length;
  if (!n) return null;
  const profits = list.map((b) => b.profit);
  const mean = profits.reduce((a, x) => a + x, 0) / n;
  const variance = n > 1 ? profits.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1) : 0;
  const se = Math.sqrt(variance / n);
  const settled = list.filter((b) => b.hit != null);
  return {
    n,
    hit: settled.length ? settled.reduce((a, b) => a + b.hit, 0) / settled.length : null,
    avgPrice: list.reduce((a, b) => a + b.price, 0) / n,
    roi: mean,
    lo: mean - 1.96 * se,
    hi: mean + 1.96 * se,
    units: profits.reduce((a, x) => a + x, 0),
  };
}

// -------------------------------------------------------------- run
/** Strategies compared in one pass. `baseline` is what the site does today. */
const VARIANTS = [
  { id: 'baseline', label: 'Baseline (today)', agree: false, gap: 0 },
  { id: 'agree05', label: 'Do not fight the market (model <= market + 5 pts)', agree: true, gap: 0.05 },
  { id: 'agree02', label: 'Strict agreement (model <= market + 2 pts)', agree: true, gap: 0.02 },
];

const tick = () => new Promise((r) => setImmediate(r));

/**
 * @param {object} o
 * @param {string[]} o.leagues     football-data codes
 * @param {string}   o.testFrom    ISO date; earlier matches are history only
 * @param {function} [o.load]      (code) => Promise<match[]>   (injectable for tests)
 * @param {function} [o.progress]  ({league, done, total}) => void
 */
async function run({ leagues, testFrom = '2024-08-01', load, progress }) {
  const seasons = [];
  const now = new Date().getUTCFullYear();
  for (let y = 2021; y <= now; y++) seasons.push(y);
  const loader = load || ((code) => FD.loadLeague(code, seasons));

  const bets = []; // every priced candidate evaluated
  const coverage = [];
  const specNames = Object.fromEntries(MI.SPECS.map((s) => [s.id, s.name]));

  let li = 0;
  for (const code of leagues) {
    li++;
    const info = { code, name: FD.nameOf(code), rows: 0, tested: 0, priced1x2: 0, pricedTotals: 0, pricedAH: 0, error: null };
    coverage.push(info);
    if (progress) progress({ league: code, done: li - 1, total: leagues.length });
    let matches;
    try { matches = await loader(code); } catch (e) { info.error = String((e && e.message) || e); continue; }
    info.rows = matches.length;
    const calendar = FD.CALENDAR.has(code);
    let startIdx = matches.findIndex((m) => m.date >= testFrom);
    if (startIdx < 0) continue;

    for (let i = startIdx; i < matches.length; i++) {
      const fx = matches[i];
      const prior = matches.slice(0, i);
      const lam = lambdasFromResults(prior, fx.home, fx.away);
      if (!lam) continue;
      info.tested++;
      if (fx.odds['1'] && fx.odds.X && fx.odds['2']) info.priced1x2++;
      if (fx.odds['O2.5'] && fx.odds['U2.5']) info.pricedTotals++;
      if (fx.ah) info.pricedAH++;

      const total = lam.lamH + lam.lamA;
      const rho = M.clamp(-0.05 * (2.6 / Math.max(1.8, total)), -0.1, -0.02);
      const sm = M.scoreMatrix(lam.lamH, lam.lamA, rho);
      const quote = { ...fx.odds };
      if (fx.ah) {
        quote[`AH_H_${fx.ah.line}`] = fx.ah.home;
        quote[`AH_A_${fx.ah.line}`] = fx.ah.away;
      }
      const markets = M.deriveMarkets(sm).map((m) => (quote[m.key] > 1
        ? { ...m, price: quote[m.key], priceSource: 'book' }
        : { ...m, price: m.fairOdds, priceSource: 'synthetic' }));

      const rk = tableRanks(prior, fx.date, calendar);
      const maxQuote = { ...fx.maxOdds };
      if (fx.ah) {
        if (fx.ah.maxHome) maxQuote[`AH_H_${fx.ah.line}`] = fx.ah.maxHome;
        if (fx.ah.maxAway) maxQuote[`AH_A_${fx.ah.line}`] = fx.ah.maxAway;
      }
      const input = {
        match: { date: `${fx.date}T15:00:00Z`, home: { name: fx.home }, away: { name: fx.away }, odds: null },
        sm,
        model: { lambda: { home: lam.lamH, away: lam.lamA } },
        markets,
        ctx: { standings: { home: rk[fx.home] ? { rank: rk[fx.home] } : null, away: rk[fx.away] ? { rank: rk[fx.away] } : null }, form: {}, homeRow: null, awayRow: null },
        newsRisk: null,
        hist: {
          source: 'results',
          leagueRates: leagueRates(prior),
          home: { name: fx.home, games: teamGames(prior, fx.home, 12) },
          away: { name: fx.away, games: teamGames(prior, fx.away, 12) },
          h2h: h2h(prior, fx.home, fx.away, 8),
        },
        elo: null,
      };

      for (const v of VARIANTS) {
        const saved = { a: MI.core.CFG.marketAgree, g: MI.core.CFG.maxMarketGap, l: MI.core.CFG.priceEdgeLocks };
        MI.core.CFG.marketAgree = v.agree; MI.core.CFG.maxMarketGap = v.gap; MI.core.CFG.priceEdgeLocks = false;
        let out;
        try { out = MI.evaluateFixture(input); } finally {
          MI.core.CFG.marketAgree = saved.a; MI.core.CFG.maxMarketGap = saved.g; MI.core.CFG.priceEdgeLocks = saved.l;
        }
        for (const r of out.results) {
          if (!r.pick.key || !r.price || !r.price.price || r.price.state === 'unpriced') continue;
          const hit = settle(r.pick.key, fx.hg, fx.ag);
          const best = Math.max(r.price.price, maxQuote[r.pick.key] || 0);
          bets.push({
            variant: v.id, league: code, date: fx.date, id: r.id, key: r.pick.key, status: r.status, state: r.price.state,
            kept: out.predictions.includes(r), price: r.price.price, bestPrice: best, prob: r.prob, hit,
            profit: profitOf(hit, r.price.price), profitBest: profitOf(hit, best),
          });
        }
      }
      if (i % 40 === 0) await tick();
    }
  }
  if (progress) progress({ league: null, done: leagues.length, total: leagues.length });
  return summarise(bets, coverage, specNames, testFrom);
}

const atBest = (list) => roi(list.map((b) => ({ ...b, profit: b.profitBest, price: b.bestPrice })));

function summarise(bets, coverage, specNames, testFrom) {
  const base = bets.filter((b) => b.variant === 'baseline');
  const variants = VARIANTS.map((v) => {
    const mine = bets.filter((b) => b.variant === v.id);
    const kept = mine.filter((b) => b.kept);
    const ids = [...new Set(mine.map((b) => b.id))];
    return {
      id: v.id,
      label: v.label,
      picked: roi(kept),
      pickedAtBest: atBest(kept),
      byMethod: ids.map((id) => {
        const k = kept.filter((b) => b.id === id);
        return { id, name: specNames[id] || id, picked: roi(k), pickedAtBest: atBest(k) };
      }),
      byLeague: [...new Set(kept.map((b) => b.league))].map((code) => ({ code, name: FD.nameOf(code), picked: roi(kept.filter((b) => b.league === code)) })),
    };
  });
  return {
    testFrom,
    generatedAt: new Date().toISOString(),
    reference: {
      edgeOnly: roi(base.filter((b) => b.state === 'edge')),
      edgeOnlyAtBest: atBest(base.filter((b) => b.state === 'edge')),
      blind: roi(base),
      blindAtBest: atBest(base),
    },
    variants,
    coverage,
    notes: [
      'Closing prices are sharp, so beating them is a hard test. "At best price" uses the highest closing price any tracked bookmaker offered, which is what line shopping could capture.',
      'Team news, Elo and xG do not exist historically; their gates are waived or fail closed.',
      'BTTS, team totals and GG/NG 2+ have no historical price and cannot be profit-tested.',
      'ROI is profit per 1-unit flat stake. A 95% interval that includes 0% means the result is not distinguishable from luck.',
    ],
  };
}

// -------------------------------------------------------------- plain-text report
const pc = (x, d = 1) => (x == null ? '  -  ' : (x * 100).toFixed(d) + '%');
const sg = (x) => (x == null ? '  -  ' : (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%');
function line(label, r) {
  if (!r) return label.padEnd(22) + '   no bets';
  return label.padEnd(22) + String(r.n).padStart(6) + ' bets  hit ' + pc(r.hit).padStart(6) + '  avg price ' + r.avgPrice.toFixed(2) + '  ROI ' + sg(r.roi).padStart(7) + '  (95%: ' + sg(r.lo) + ' to ' + sg(r.hi) + ')';
}

function formatReport(j) {
  if (j.status === 'idle') return 'No backtest has been run yet. Open /api/price-backtest?start=1 to begin.';
  const pg = j.progress || {};
  if (j.status === 'running') return `Running... ${pg.done}/${pg.total} leagues done${pg.league ? ' (now ' + pg.league + ')' : ''}. Refresh in a minute.`;
  if (j.status === 'error') return 'Backtest failed: ' + j.error;
  const r = j.result;
  const L = [];
  L.push(`PRICE BACKTEST v2  tests from ${r.testFrom}  (generated ${r.generatedAt})`);
  L.push('1-unit flat stakes. ROI = profit per unit staked. "close" = average closing price, "best" = highest closing price any bookmaker offered.\n');
  L.push('REFERENCE (no gates)');
  L.push(line('Model edge only, close', r.reference.edgeOnly));
  L.push(line('Model edge only, best', r.reference.edgeOnlyAtBest));
  L.push(line('Blind, close', r.reference.blind));
  L.push(line('Blind, best', r.reference.blindAtBest));
  for (const v of r.variants) {
    L.push('\n=== ' + v.label + ' ===');
    L.push(line('All picks, close', v.picked));
    L.push(line('All picks, best', v.pickedAtBest));
    for (const m of v.byMethod) { L.push(m.name); L.push('  ' + line('close', m.picked)); L.push('  ' + line('best', m.pickedAtBest)); }
    L.push('By league (close):');
    for (const x of v.byLeague.slice().sort((a, b) => (b.picked ? b.picked.n : 0) - (a.picked ? a.picked.n : 0)).slice(0, 12)) L.push('  ' + line(x.name, x.picked));
  }
  L.push('\nDATA COVERAGE');
  for (const c of r.coverage) L.push(c.name.padEnd(28) + (c.error ? 'FAILED: ' + c.error : `rows ${c.rows}  tested ${c.tested}  1X2 ${c.priced1x2}  totals ${c.pricedTotals}  handicap ${c.pricedAH}`));
  L.push('\nNOTES'); for (const n of r.notes) L.push('- ' + n);
  return L.join('\n');
}

// -------------------------------------------------------------- background job (for the server)
const DEFAULT_LEAGUES = ['E0', 'E1', 'SC0', 'D1', 'D2', 'SP1', 'I1', 'F1', 'N1', 'B1', 'P1', 'T1', 'NOR', 'SWE', 'DNK', 'AUT', 'USA', 'BRA', 'JPN'];
let job = { status: 'idle' };

function startJob(leagues) {
  if (job.status === 'running') return job;
  const list = leagues && leagues.length ? leagues : DEFAULT_LEAGUES;
  job = { status: 'running', startedAt: new Date().toISOString(), leagues: list, progress: { done: 0, total: list.length, league: null } };
  const mine = job;
  run({ leagues: list, progress: (p) => { mine.progress = p; } })
    .then((result) => { Object.assign(mine, { status: 'done', finishedAt: new Date().toISOString(), result }); })
    .catch((e) => { Object.assign(mine, { status: 'error', error: String((e && e.message) || e) }); });
  return job;
}
const getJob = () => job;

module.exports = { VARIANTS, formatReport, run, settle, roi, startJob, getJob, DEFAULT_LEAGUES, tableRanks, lambdasFromResults };
