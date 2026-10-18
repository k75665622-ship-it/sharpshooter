'use strict';

/**
 * fdata.js — football-data.co.uk loader (free CSVs: results + bookmaker odds).
 *
 * Two layouts exist on the site:
 *   main  /mmz4281/{ssss}/{CODE}.csv   one file per season, big European leagues
 *                                      (columns Date, HomeTeam, AwayTeam, FTHG, FTAG, odds...)
 *   new   /new/{CODE}.csv              every season in one file, other countries
 *                                      (columns Date, Home, Away, HG, AG, odds...)
 *
 * The parser is header-driven and picks the best available price per market, so a
 * missing column just means that market is unpriced for that league — it never
 * throws. Closing average prices are preferred: they are the sharpest reference,
 * which makes the backtest a hard test rather than a flattering one.
 */

const BASE = 'https://www.football-data.co.uk';
const UA = 'Mozilla/5.0 (compatible; Sharpshooter/1.0)';

const MAIN = {
  E0: 'England Premier League', E1: 'England Championship', E2: 'England League One', E3: 'England League Two',
  SC0: 'Scotland Premiership', SC1: 'Scotland Championship',
  D1: 'Germany Bundesliga', D2: 'Germany 2. Bundesliga',
  SP1: 'Spain La Liga', SP2: 'Spain Segunda',
  I1: 'Italy Serie A', I2: 'Italy Serie B',
  F1: 'France Ligue 1', F2: 'France Ligue 2',
  N1: 'Netherlands Eredivisie', B1: 'Belgium Pro League', P1: 'Portugal Primeira Liga',
  T1: 'Turkey Super Lig', G1: 'Greece Super League',
};

const NEW = {
  NOR: 'Norway Eliteserien', SWE: 'Sweden Allsvenskan', DNK: 'Denmark Superliga', FIN: 'Finland Veikkausliiga',
  AUT: 'Austria Bundesliga', SWZ: 'Switzerland Super League', POL: 'Poland Ekstraklasa', ROU: 'Romania Liga 1',
  RUS: 'Russia Premier League', IRL: 'Ireland Premier Division', USA: 'USA MLS', BRA: 'Brazil Serie A',
  ARG: 'Argentina Primera', JPN: 'Japan J1', CHN: 'China Super League', MEX: 'Mexico Liga MX',
};

/** Leagues whose season runs within one calendar year (affects "this season's table"). */
const CALENDAR = new Set(['NOR', 'SWE', 'FIN', 'IRL', 'JPN', 'USA', 'BRA', 'CHN', 'ARG']);

function seasonCode(startYear) {
  return String(startYear % 100).padStart(2, '0') + String((startYear + 1) % 100).padStart(2, '0');
}

function parseCsv(text) {
  const rows = [];
  let cur = [];
  let f = '';
  let q = false;
  const src = String(text).replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { cur.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      cur.push(f); f = '';
      if (cur.length > 1 || cur[0] !== '') rows.push(cur);
      cur = [];
    } else f += c;
  }
  if (f !== '' || cur.length) { cur.push(f); rows.push(cur); }
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o = {};
    head.forEach((h, i) => { o[h] = (r[i] || '').trim(); });
    return o;
  });
}

/** dd/mm/yy or dd/mm/yyyy -> YYYY-MM-DD, or null. */
function parseDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s || '');
  if (!m) return null;
  let y = Number(m[3]);
  if (y < 100) y += y < 70 ? 2000 : 1900;
  return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

const num = (v) => {
  const x = Number(v);
  return v !== '' && Number.isFinite(x) ? x : null;
};
const price = (row, cols) => {
  for (const c of cols) { const x = num(row[c]); if (x != null && x > 1) return x; }
  return null;
};

const P = {
  H: ['AvgCH', 'PSCH', 'B365CH', 'AvgH', 'PSH', 'PH', 'B365H'],
  D: ['AvgCD', 'PSCD', 'B365CD', 'AvgD', 'PSD', 'PD', 'B365D'],
  A: ['AvgCA', 'PSCA', 'B365CA', 'AvgA', 'PSA', 'PA', 'B365A'],
  O: ['AvgC>2.5', 'PC>2.5', 'B365C>2.5', 'Avg>2.5', 'P>2.5', 'B365>2.5'],
  U: ['AvgC<2.5', 'PC<2.5', 'B365C<2.5', 'Avg<2.5', 'P<2.5', 'B365<2.5'],
};

/** One CSV row -> normalised match, or null when it is not a finished match. */
function toMatch(row) {
  const date = parseDate(row.Date);
  const home = row.HomeTeam || row.Home;
  const away = row.AwayTeam || row.Away;
  const hg = num(row.FTHG != null && row.FTHG !== '' ? row.FTHG : row.HG);
  const ag = num(row.FTAG != null && row.FTAG !== '' ? row.FTAG : row.AG);
  if (!date || !home || !away || hg == null || ag == null) return null;

  const odds = {
    '1': price(row, P.H), X: price(row, P.D), '2': price(row, P.A),
    'O2.5': price(row, P.O), 'U2.5': price(row, P.U),
  };
  // Asian handicap: the quoted line is the HOME line (e.g. -0.5 = home gives half a goal).
  const closing = num(row.AHCh) != null && price(row, ['AvgCAHH', 'B365CAHH']) != null;
  const line = closing ? num(row.AHCh) : num(row.AHh);
  const ah = line == null ? null : {
    line,
    home: closing ? price(row, ['AvgCAHH', 'B365CAHH']) : price(row, ['AvgAHH', 'B365AHH']),
    away: closing ? price(row, ['AvgCAHA', 'B365CAHA']) : price(row, ['AvgAHA', 'B365AHA']),
  };
  return { date, home, away, hg, ag, odds, ah: ah && ah.home && ah.away ? ah : null };
}

async function fetchText(url, timeout = 25000) {
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(timeout), redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/**
 * Load every available match for a league code, oldest first.
 * @param {string} code  e.g. 'E0' or 'NOR'
 * @param {number[]} seasons  start years, used for main leagues only
 */
async function loadLeague(code, seasons) {
  const out = [];
  if (MAIN[code]) {
    for (const y of seasons) {
      try {
        const rows = parseCsv(await fetchText(`${BASE}/mmz4281/${seasonCode(y)}/${code}.csv`));
        for (const r of rows) { const m = toMatch(r); if (m) out.push(m); }
      } catch (e) {
        if (!/HTTP 404/.test(String(e.message))) throw e; // a season that does not exist yet is fine
      }
    }
  } else if (NEW[code]) {
    const rows = parseCsv(await fetchText(`${BASE}/new/${code}.csv`));
    for (const r of rows) { const m = toMatch(r); if (m) out.push(m); }
  } else {
    throw new Error('unknown league code ' + code);
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

const nameOf = (code) => MAIN[code] || NEW[code] || code;

module.exports = { MAIN, NEW, CALENDAR, parseCsv, parseDate, toMatch, loadLeague, nameOf, seasonCode };
