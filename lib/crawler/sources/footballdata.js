'use strict';

/**
 * crawler/sources/footballdata.js — football-data.co.uk, the richest free match archive.
 *
 * Per match: full-time and half-time scores, shots, shots on target, corners, fouls,
 * cards, referee (England/Scotland), and Bet365 / Pinnacle / best-of-market prices,
 * pre-closing AND closing. This is the same source (and the same columns) the v6
 * factors were measured on, so the live factors mean exactly what the research says.
 *
 *   main leagues  /mmz4281/{2526}/{E0}.csv   one file per season (we take 6 seasons:
 *                                             form needs this one, head-to-head needs 6 years)
 *   other leagues /new/{NOR}.csv             every season in one file
 *   upcoming      /fixtures.csv, /new_league_fixtures.csv   next fixtures with prices
 *
 * Everything goes through crawler/http.js (robots.txt, rate limit, conditional GET, cache).
 */

const HTTP = require('../http');
const FD = require('../../fdata');
const RC = require('../../factors/records');

const BASE = 'https://www.football-data.co.uk';

/** ESPN slug -> research division code (the model's league category) and football-data file code. */
const LEAGUES = {
  'eng.1': { div: 'E0', fd: 'E0' }, 'eng.2': { div: 'E1', fd: 'E1' }, 'eng.3': { div: 'E2', fd: 'E2' }, 'eng.4': { div: 'E3', fd: 'E3' },
  'eng.5': { div: 'EC', fd: 'EC' },
  'sco.1': { div: 'SC0', fd: 'SC0' }, 'sco.2': { div: 'SC1', fd: 'SC1' }, 'sco.3': { div: 'SC2', fd: 'SC2' }, 'sco.4': { div: 'SC3', fd: 'SC3' },
  'ger.1': { div: 'D1', fd: 'D1' }, 'ger.2': { div: 'D2', fd: 'D2' },
  'esp.1': { div: 'SP1', fd: 'SP1' }, 'esp.2': { div: 'SP2', fd: 'SP2' },
  'ita.1': { div: 'I1', fd: 'I1' }, 'ita.2': { div: 'I2', fd: 'I2' },
  'fra.1': { div: 'F1', fd: 'F1' }, 'fra.2': { div: 'F2', fd: 'F2' },
  'ned.1': { div: 'N1', fd: 'N1' }, 'bel.1': { div: 'B1', fd: 'B1' }, 'por.1': { div: 'P1', fd: 'P1' },
  'tur.1': { div: 'T1', fd: 'T1' }, 'gre.1': { div: 'G1', fd: 'G1' },
  'arg.1': { div: 'ARG', fd: 'ARG', fdNew: true }, 'usa.1': { div: 'USA', fd: 'USA', fdNew: true },
  'bra.1': { div: 'BRA', fd: 'BRA', fdNew: true }, 'jpn.1': { div: 'JAP', fd: 'JPN', fdNew: true },
  'mex.1': { div: 'MEX', fd: 'MEX', fdNew: true }, 'rou.1': { div: 'ROM', fd: 'ROU', fdNew: true },
  'pol.1': { div: 'POL', fd: 'POL', fdNew: true }, 'swe.1': { div: 'SWE', fd: 'SWE', fdNew: true },
  'nor.1': { div: 'NOR', fd: 'NOR', fdNew: true }, 'rus.1': { div: 'RUS', fd: 'RUS', fdNew: true },
  'den.1': { div: 'DEN', fd: 'DNK', fdNew: true }, 'chn.1': { div: 'CHN', fd: 'CHN', fdNew: true },
  'aut.1': { div: 'AUT', fd: 'AUT', fdNew: true }, 'sui.1': { div: 'SUI', fd: 'SWZ', fdNew: true },
  'irl.1': { div: 'IRL', fd: 'IRL', fdNew: true }, 'fin.1': { div: 'FIN', fd: 'FIN', fdNew: true },
};
const DIV_OF_FD = Object.fromEntries(Object.values(LEAGUES).map((l) => [l.fd, l.div]));

const TTL_CURRENT = 3 * 3600 * 1000;
const TTL_PAST = 7 * 24 * 3600 * 1000;
const TTL_FIXTURES = 45 * 60 * 1000;

function seasonStart(slug, date) {
  const d = new Date(date || Date.now());
  const y = d.getUTCFullYear();
  const L = LEAGUES[slug];
  if (L && RC.CALENDAR.has(L.div)) return y;
  return d.getUTCMonth() >= 6 ? y : y - 1;
}

function toRecords(text, div) {
  const rows = FD.parseCsv(text || '');
  const out = [];
  for (const r of rows) {
    const mr = RC.fromFootballDataRow(r, div);
    if (mr) out.push(mr);
  }
  return out;
}

/**
 * Every completed match for a league over the last `seasons` seasons (records.js shape).
 * @returns {Promise<{records:object[], provenance:object}>}
 */
async function league(slug, { seasons = 6, asOf } = {}) {
  const L = LEAGUES[slug];
  if (!L) return { records: [], provenance: { slug, covered: false } };
  const prov = { slug, covered: true, div: L.div, files: [] };
  let records = [];
  if (L.fdNew) {
    const url = `${BASE}/new/${L.fd}.csv`;
    const r = await HTTP.get(url, { ttl: TTL_CURRENT });
    prov.files.push({ url, ok: r.ok, stale: r.stale, fromCache: r.fromCache, error: r.error || null });
    if (r.ok) {
      const cur = seasonStart(slug, asOf);
      records = toRecords(r.body, L.div).filter((m) => m.season >= cur - seasons + 1);
    }
  } else {
    const cur = seasonStart(slug, asOf);
    for (let s = cur; s > cur - seasons; s--) {
      const url = `${BASE}/mmz4281/${FD.seasonCode(s)}/${L.fd}.csv`;
      const r = await HTTP.get(url, { ttl: s === cur ? TTL_CURRENT : TTL_PAST });
      prov.files.push({ url, season: s, ok: r.ok, stale: r.stale, fromCache: r.fromCache, error: r.error || null });
      if (r.ok) records.push(...toRecords(r.body, L.div));
    }
  }
  const done = records.filter((m) => m.hg != null && m.ag != null);
  done.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  prov.matches = done.length;
  prov.withStats = done.filter((m) => m.hst != null).length;
  prov.withOdds = done.filter((m) => m.odds && m.odds.h).length;
  prov.latest = done.length ? done[done.length - 1].date : null;
  return { records: done, provenance: prov };
}

/** Upcoming fixtures with prices (both fixture files), as records with null scores. */
async function fixtures() {
  const out = [];
  const prov = [];
  for (const [file, isNew] of [['fixtures.csv', false], ['new_league_fixtures.csv', true]]) {
    const url = `${BASE}/${file}`;
    const r = await HTTP.get(url, { ttl: TTL_FIXTURES });
    prov.push({ url, ok: r.ok, stale: r.stale, error: r.error || null });
    if (!r.ok) continue;
    for (const row of FD.parseCsv(r.body)) {
      const code = row.Div || row.Country || null;
      const div = isNew ? DIV_OF_FD[mapNewCountry(row.Country, row.League)] || null : code;
      const mr = RC.fromFootballDataRow(row, div);
      if (mr && div) out.push(mr);
    }
  }
  return { fixtures: out, provenance: prov };
}

/** new_league_fixtures.csv carries a Country column, not a file code. */
function mapNewCountry(country) {
  const c = String(country || '').toLowerCase();
  const M = {
    argentina: 'ARG', usa: 'USA', brazil: 'BRA', japan: 'JPN', mexico: 'MEX', romania: 'ROU', poland: 'POL',
    sweden: 'SWE', norway: 'NOR', russia: 'RUS', denmark: 'DNK', china: 'CHN', austria: 'AUT', switzerland: 'SWZ',
    ireland: 'IRL', finland: 'FIN',
  };
  return M[c] || null;
}

module.exports = { league, fixtures, LEAGUES, DIV_OF_FD, seasonStart, toRecords, BASE };
