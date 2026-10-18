'use strict';
/** research/backtest_methods_lib.js — settlement, prices and evidence helpers shared by the backtests. */
// ------------------------------------------------------------------ settlement
const { settle } = require('../lib/settle');

/** Bet365 and best price for a key, where the dataset has one. */
function pricesFor(key, o) {
  const dc = (a, b) => (a > 1 && b > 1 ? 1 / (1 / a + 1 / b) : null);
  switch (key) {
    case '1': return [o.o1, o.m1];
    case 'X': return [o.oX, o.mX];
    case '2': return [o.o2, o.m2];
    case 'O2.5': return [o.oO, o.mO];
    case 'U2.5': return [o.oU, o.mU];
    case '1X': return [dc(o.o1, o.oX), dc(o.m1, o.mX)];
    case 'X2': return [dc(o.o2, o.oX), dc(o.m2, o.mX)];
    default: return [null, null];
  }
}

// ------------------------------------------------------------------ evidence helpers
function teamGames(prior, team, limit) {
  const out = [];
  for (let i = prior.length - 1; i >= 0 && out.length < limit; i--) {
    const m = prior[i];
    if (m.home === team) out.push({ gf: m.hg, ga: m.ag, venue: 'H', date: m.date });
    else if (m.away === team) out.push({ gf: m.ag, ga: m.hg, venue: 'A', date: m.date });
  }
  return out;
}
function h2h(prior, h, a, limit) {
  const out = [];
  for (let i = prior.length - 1; i >= 0 && out.length < limit; i--) {
    const m = prior[i];
    if (m.home === h && m.away === a) out.push({ hg: m.hg, ag: m.ag, date: m.date });
    else if (m.home === a && m.away === h) out.push({ hg: m.ag, ag: m.hg, date: m.date });
  }
  return out;
}
function leagueRates(prior) {
  const w = prior.slice(-380);
  if (w.length < 20) return null;
  const n = w.length;
  const c = (f) => w.filter(f).length / n;
  return {
    n,
    goalsPerGame: w.reduce((a, m) => a + m.hg + m.ag, 0) / n,
    over25Rate: c((m) => m.hg + m.ag > 2),
    bttsRate: c((m) => m.hg > 0 && m.ag > 0),
    homeWinRate: c((m) => m.hg > m.ag),
    drawRate: c((m) => m.hg === m.ag),
    awayWinRate: c((m) => m.hg < m.ag),
  };
}
function ranks(prior, date) {
  const y = Number(date.slice(0, 4));
  const start = Number(date.slice(5, 7)) >= 7 ? `${y}-07-01` : `${y - 1}-07-01`;
  const pts = {};
  const gd = {};
  for (const m of prior) {
    if (m.date < start) continue;
    for (const [t, f, a] of [[m.home, m.hg, m.ag], [m.away, m.ag, m.hg]]) {
      pts[t] = (pts[t] || 0) + (f > a ? 3 : f === a ? 1 : 0);
      gd[t] = (gd[t] || 0) + f - a;
    }
  }
  const order = Object.keys(pts).sort((x, z) => pts[z] - pts[x] || gd[z] - gd[x]);
  const r = {};
  order.forEach((t, i) => { r[t] = i + 1; });
  return r;
}


module.exports = { settle, pricesFor, teamGames, h2h, leagueRates, ranks };
