'use strict';

/**
 * sources/odds.js — every free bookmaker price we can reach, normalised to
 * decimal odds per book, plus the consensus the v5 engine prices against.
 *
 * Sources
 *   ESPN summary `odds` array    DraftKings (American) and Bet365 (fractional +
 *                                decimal `value`): 1X2, double chance, one goal line
 *   football-data fixtures.csv   weekly 1X2, O/U 2.5 and Asian handicap from Bet365,
 *                                Pinnacle and the market average / maximum
 *   InferSports (lib/infersports) Asian books' medians (already used in v4)
 *
 * The consensus is built the way professional modellers do it: de-vig EACH book
 * separately, then average the fair probabilities (Pinnacle double-weighted, it is
 * the sharpest book). The best available price per outcome is kept next to it,
 * because the only value signal that survived the v5 backtest is a price that
 * beats the consensus (research/shop_study.js) — not a model that disagrees with
 * it (research/edge_study.js).
 */

const M = require('../model');
const MK = require('../market');
const N = require('./names');
const RS = require('./results');
const espn = require('../espn');

// ------------------------------------------------------------------ number parsing
function frac(s) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/.exec(String(s == null ? '' : s));
  if (!m) return null;
  const d = 1 + Number(m[1]) / Number(m[2]);
  return Number.isFinite(d) && d > 1 ? d : null;
}
function american(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (/^EVEN$/i.test(s)) return 2;
  const n = Number(s.replace('+', ''));
  if (!Number.isFinite(n) || Math.abs(n) < 100) return null;
  return M.americanToDecimal(n);
}
function decimal(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 1.001 && n < 1000 ? n : null;
}
/** First usable decimal from a list of [kind, value] candidates. */
function firstPrice(cands) {
  for (const [kind, v] of cands) {
    if (v == null) continue;
    const d = kind === 'frac' ? frac(v) : kind === 'am' ? american(v) : decimal(v);
    if (d) return d;
  }
  return null;
}
const get = (o, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), o);

// ------------------------------------------------------------------ ESPN summary odds
/**
 * Parse the ESPN summary `odds` (and `pickcenter`) arrays.
 * @returns {Array<{book:string, h?:number, d?:number, a?:number, line?:number, over?:number, under?:number}>}
 */
function parseEspnOdds(summary) {
  const entries = [...((summary && summary.odds) || []), ...((summary && summary.pickcenter) || [])].filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    const book = String((e.provider && e.provider.name) || 'unknown');
    if (seen.has(book)) continue;
    const t = get(e, 'bettingOdds.teamOdds') || {};
    const h = firstPrice([
      ['dec', get(e, 'homeTeamOdds.odds.value')],
      ['frac', get(e, 'homeTeamOdds.odds.summary')],
      ['frac', get(t, 'preMatchFullTimeResultHome.value')],
      ['am', get(e, 'moneyline.home.close.odds')],
      ['am', get(e, 'homeTeamOdds.moneyLine')],
      ['am', get(e, 'moneyline.home.open.odds')],
    ]);
    const a = firstPrice([
      ['dec', get(e, 'awayTeamOdds.odds.value')],
      ['frac', get(e, 'awayTeamOdds.odds.summary')],
      ['frac', get(t, 'preMatchFullTimeResultAway.value')],
      ['am', get(e, 'moneyline.away.close.odds')],
      ['am', get(e, 'awayTeamOdds.moneyLine')],
      ['am', get(e, 'moneyline.away.open.odds')],
    ]);
    const d = firstPrice([
      ['dec', get(e, 'drawOdds.value')],
      ['frac', get(e, 'drawOdds.summary')],
      ['frac', get(t, 'preMatchFullTimeResultDraw.value')],
      ['am', get(e, 'moneyline.draw.close.odds')],
      ['am', get(e, 'drawOdds.moneyLine')],
      ['am', get(e, 'drawOdds.moneyline')],
    ]);
    let line = Number(get(e, 'overUnder'));
    if (!Number.isFinite(line)) line = Number(get(t, 'preMatchOverUnderHandicap.value'));
    if (!Number.isFinite(line)) line = null;
    const over = firstPrice([
      ['am', get(e, 'total.over.close.odds')],
      ['am', get(e, 'overOdds')],
      ['frac', get(t, 'preMatchGoalLineOver.value')],
      ['dec', get(t, 'preMatchGoalLineOver.decimal')],
    ]);
    const under = firstPrice([
      ['am', get(e, 'total.under.close.odds')],
      ['am', get(e, 'underOdds')],
      ['frac', get(t, 'preMatchGoalLineUnder.value')],
      ['dec', get(t, 'preMatchGoalLineUnder.decimal')],
    ]);
    const dc = {
      '1X': firstPrice([['frac', get(t, 'preMatchDoubleChanceHomeOrDraw.value')]]),
      '12': firstPrice([['frac', get(t, 'preMatchDoubleChanceHomeOrAway.value')]]),
      X2: firstPrice([['frac', get(t, 'preMatchDoubleChanceDrawOrAway.value')]]),
    };
    const q = { book, src: 'espn' };
    if (h && d && a) Object.assign(q, { h, d, a });
    if (line != null && over && under) Object.assign(q, { line, over, under });
    if (dc['1X'] || dc['12'] || dc.X2) q.dc = dc;
    if (q.h || q.over) {
      seen.add(book);
      out.push(q);
    }
  }
  return out;
}

// ------------------------------------------------------------------ football-data fixtures.csv
const FD_URL = 'https://www.football-data.co.uk/fixtures.csv';
const FD_BOOKS = [
  { book: 'Bet365', h: 'B365H', d: 'B365D', a: 'B365A', o: 'B365>2.5', u: 'B365<2.5', ahH: 'B365AHH', ahA: 'B365AHA' },
  { book: 'Pinnacle', h: 'PSH', d: 'PSD', a: 'PSA', o: 'P>2.5', u: 'P<2.5', ahH: 'PAHH', ahA: 'PAHA' },
  { book: 'William Hill', h: 'WHH', d: 'WHD', a: 'WHA' },
  { book: 'Bwin', h: 'BWH', d: 'BWD', a: 'BWA' },
  { book: 'Market average', h: 'AvgH', d: 'AvgD', a: 'AvgA', o: 'Avg>2.5', u: 'Avg<2.5', ahH: 'AvgAHH', ahA: 'AvgAHA', aggregate: 'avg' },
  { book: 'Best price', h: 'MaxH', d: 'MaxD', a: 'MaxA', o: 'Max>2.5', u: 'Max<2.5', ahH: 'MaxAHH', ahA: 'MaxAHA', aggregate: 'max' },
];
const FD_REVERSE = Object.fromEntries(Object.entries(RS.FD_CODE).map(([slug, code]) => [code, slug]));

function parseFdFixtures(text) {
  const FD = require('../fdata');
  const rows = FD.parseCsv(text || '');
  const out = [];
  for (const r of rows) {
    const slug = FD_REVERSE[r.Div];
    const date = FD.parseDate(r.Date);
    const home = r.HomeTeam || r.Home;
    const away = r.AwayTeam || r.Away;
    if (!slug || !date || !home || !away) continue;
    const quotes = [];
    for (const b of FD_BOOKS) {
      const q = { book: b.book, src: 'football-data', aggregate: b.aggregate || null };
      const h = decimal(r[b.h]);
      const d = decimal(r[b.d]);
      const a = decimal(r[b.a]);
      if (h && d && a) Object.assign(q, { h, d, a });
      if (b.o) {
        const o = decimal(r[b.o]);
        const u = decimal(r[b.u]);
        if (o && u) Object.assign(q, { line: 2.5, over: o, under: u });
      }
      if (b.ahH) {
        const line = Number(r.AHh);
        const ah = decimal(r[b.ahH]);
        const aa = decimal(r[b.ahA]);
        if (Number.isFinite(line) && ah && aa) q.ah = { line, home: ah, away: aa };
      }
      if (q.h || q.over || q.ah) quotes.push(q);
    }
    if (quotes.length) out.push({ slug, date, home, away, quotes });
  }
  return out;
}

async function fdFixtures() {
  const key = 'odds:fdfix:v5';
  const hit = espn.memGet(key);
  if (hit !== undefined) return hit;
  return espn.cached(key + ':load', 60 * 1000, async () => {
    let text = null;
    try {
      const res = await fetch(FD_URL, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Sharpshooter/5.0)' } });
      if (res.ok) text = await res.text();
    } catch {
      text = null;
    }
    const rows = text ? parseFdFixtures(text) : [];
    if (rows.length) espn.memSet(key, rows, 2 * 60 * 60 * 1000);
    return rows;
  });
}

/**
 * football-data quotes for one fixture. Team names are matched with a mapping
 * learned from the two sources' results (ESPN names -> football-data names), so
 * "Nottingham Forest" finds "Nott'm Forest" without an alias table.
 */
async function fdQuotesFor(match, espnResults) {
  const rows = await fdFixtures();
  if (!rows.length) return [];
  const day = String(match.date).slice(0, 10);
  const pool = rows.filter((r) => r.slug === match.league && Math.abs(Date.parse(r.date) - Date.parse(day)) <= 1.5 * 86400000);
  if (!pool.length) return [];
  let mapping = null;
  if (espnResults && espnResults.length) {
    const fdRes = await RS.footballData(match.league, RS.seasonStartFor(match.league, day)).catch(() => []);
    if (fdRes.length) mapping = N.learnMapping(espnResults, fdRes);
  }
  const names = [...new Set(pool.flatMap((r) => [r.home, r.away]))];
  const h = N.resolve(match.home.name, mapping, names);
  const a = N.resolve(match.away.name, mapping, names);
  if (!h || !a) return [];
  const row = pool.find((r) => r.home === h && r.away === a);
  return row ? row.quotes : [];
}

// ------------------------------------------------------------------ consensus
const BOOK_WEIGHT = { Pinnacle: 2, 'Market average': 1.5 };

/**
 * Pool every book into one fair line per market.
 *
 * @param {Array} quotes  [{book, h,d,a, line,over,under, ah:{line,home,away}, aggregate}]
 * @param {object} [asian] InferSports consensus (lib/infersports buildConsensus shape)
 * @returns {null | Consensus}
 */
function buildConsensus(quotes, asian) {
  const q1 = [];
  const totals = new Map(); // line -> quotes
  const best = { h: null, d: null, a: null };
  const bestTot = new Map();
  const keep = (slot, price, book) => (!slot || price > slot.price ? { price, book } : slot);

  for (const q of quotes || []) {
    if (q.h && q.d && q.a) {
      if (q.aggregate !== 'max') q1.push({ book: q.book, prices: [q.h, q.d, q.a], weight: BOOK_WEIGHT[q.book] || 1 });
      if (q.aggregate !== 'avg') {
        best.h = keep(best.h, q.h, q.book);
        best.d = keep(best.d, q.d, q.book);
        best.a = keep(best.a, q.a, q.book);
      }
    }
    if (q.line != null && q.over && q.under) {
      if (!totals.has(q.line)) totals.set(q.line, []);
      if (q.aggregate !== 'max') totals.get(q.line).push({ book: q.book, prices: [q.over, q.under], weight: BOOK_WEIGHT[q.book] || 1 });
      if (q.aggregate !== 'avg') {
        const b = bestTot.get(q.line) || { over: null, under: null };
        b.over = keep(b.over, q.over, q.book);
        b.under = keep(b.under, q.under, q.book);
        bestTot.set(q.line, b);
      }
    }
  }
  // Asian books: add their 1X2 (if any) and every total line as one pooled "book"
  if (asian && asian.h2h) {
    const x = asian.h2h;
    if (x.home && x.draw && x.away && x.home.median && x.draw.median && x.away.median) {
      // InferSports sometimes lists the fixture the other way round; orient it to ours.
      const [hh, aa] = asian.reversed ? [x.away, x.home] : [x.home, x.away];
      q1.push({ book: `Asian books (${asian.books ? asian.books.length : '?'})`, prices: [hh.median, x.draw.median, aa.median], weight: 1 });
      best.h = keep(best.h, hh.best, 'Asian best');
      best.d = keep(best.d, x.draw.best, 'Asian best');
      best.a = keep(best.a, aa.best, 'Asian best');
    }
  }
  if (asian && asian.totals) {
    for (const [lineStr, slot] of Object.entries(asian.totals)) {
      const line = Number(lineStr);
      if (!slot || !slot.over || !slot.under || !slot.over.median || !slot.under.median) continue;
      if (!totals.has(line)) totals.set(line, []);
      totals.get(line).push({ book: 'Asian books', prices: [slot.over.median, slot.under.median], weight: 1 });
      const b = bestTot.get(line) || { over: null, under: null };
      if (slot.over.best) b.over = keep(b.over, slot.over.best, 'Asian best');
      if (slot.under.best) b.under = keep(b.under, slot.under.best, 'Asian best');
      bestTot.set(line, b);
    }
  }

  const x12 = MK.pool(q1);
  const tot = {};
  for (const [line, qs] of totals) {
    const p = MK.pool(qs);
    if (p) tot[line] = { fair: { over: p.probs[0], under: p.probs[1] }, books: p.books, spread: p.spread, best: bestTot.get(line) || null };
  }
  if (!x12 && !Object.keys(tot).length) return null;
  const books = new Set([...q1.map((q) => q.book), ...[...totals.values()].flat().map((q) => q.book)]);
  return {
    x12: x12 ? { fair: { home: x12.probs[0], draw: x12.probs[1], away: x12.probs[2] }, books: x12.books, spread: x12.spread, best, perBook: x12.perBook.map((b) => ({ book: b.book, margin: b.margin })) } : null,
    totals: tot,
    books: [...books],
    nBooks: books.size,
  };
}

/** Market-implied λ pair from a consensus (prefers the 2.5 line, else the line nearest it). */
function impliedLambdas(cons, priorTotal) {
  if (!cons || !cons.x12) return null;
  const lines = Object.keys(cons.totals || {}).map(Number).sort((a, b) => Math.abs(a - 2.5) - Math.abs(b - 2.5));
  const line = lines.length ? lines[0] : null;
  const total = line != null && Number.isInteger(line * 2) && line % 1 !== 0 ? { line, over: cons.totals[line].fair.over } : null;
  const s = MK.solveLambdas(cons.x12.fair, total, { priorTotal: priorTotal || 2.6 });
  return s ? { lamH: s.lamH, lamA: s.lamA, rms: s.rms, books: cons.nBooks, line: total ? total.line : null } : null;
}

module.exports = { frac, american, decimal, parseEspnOdds, parseFdFixtures, fdFixtures, fdQuotesFor, buildConsensus, impliedLambdas, FD_BOOKS };
