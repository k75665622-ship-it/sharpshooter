'use strict';

/**
 * elo.js — club Elo ratings from clubelo.com (free, key-less CSV API).
 *
 * Purpose: an INDEPENDENT read on who is the stronger side.
 *
 * Methodology Rule 13 says correlated evidence is not independent confirmation.
 * Our model, ESPN form and the bookmaker price all lean on the same recent
 * results, so agreement between them proves less than it appears to. A rating
 * that is built from a long, opponent-adjusted results history and knows nothing
 * about this week's odds is a genuinely different witness. The result-market
 * methodologies (Home / Draw / Away / handicaps) use it as a corroboration gate.
 *
 * It is used ONLY directionally — which side is stronger and by roughly how
 * much. It is never converted into a price-edge probability.
 *
 * Failure-safe by construction: every export returns null on any problem
 * (network, format change, unknown club), and the methodologies treat "no Elo"
 * as "one fewer witness", never as an error.
 *
 * NOTE: the parser is header-driven (it looks columns up by name) so a column
 * reorder does not break it, but the endpoint itself could not be exercised from
 * the build sandbox (only GitHub-hosted hosts are reachable there). It is
 * covered by an offline fixture test; the first live run is the real check.
 */

const espn = require('./espn');
const L = require('./leagues');

const BASE = 'http://api.clubelo.com';
const TTL = 12 * 60 * 60 * 1000;

/** Home advantage in Elo points (clubelo.com uses ~65-100 depending on league). */
const HOME_ADV = 70;

/** ESPN display name (folded) -> ClubElo short name. Only clubs whose names differ materially. */
const ALIAS = {
  'manchester united': 'Man United',
  'manchester city': 'Man City',
  'newcastle united': 'Newcastle',
  'tottenham hotspur': 'Tottenham',
  'wolverhampton wanderers': 'Wolves',
  'nottingham forest': 'Forest',
  'west ham united': 'West Ham',
  'leeds united': 'Leeds',
  'brighton and hove albion': 'Brighton',
  'sheffield united': 'Sheffield Utd',
  'bayern munich': 'Bayern',
  'borussia dortmund': 'Dortmund',
  'bayer leverkusen': 'Leverkusen',
  'borussia monchengladbach': 'Gladbach',
  'eintracht frankfurt': 'Frankfurt',
  'rb leipzig': 'RB Leipzig',
  'fc cologne': 'Koeln',
  'atletico madrid': 'Atletico',
  'athletic club': 'Bilbao',
  'real sociedad': 'Sociedad',
  'inter milan': 'Inter',
  'ac milan': 'Milan',
  'paris saint germain': 'Paris SG',
  'olympique marseille': 'Marseille',
  'olympique lyonnais': 'Lyon',
  'sporting cp': 'Sporting',
};

function fold(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Parse a clubelo.com CSV into rows. Header-driven; tolerant of column order,
 * quoting and CRLF.
 * @returns {Array<{club:string, country:string, level:number|null, elo:number}>}
 */
function parseCsv(text) {
  if (!text) return [];
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const head = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/"/g, ''));
  const idx = (...names) => {
    for (const n of names) {
      const i = head.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iClub = idx('club', 'team');
  const iElo = idx('elo');
  const iCountry = idx('country');
  const iLevel = idx('level');
  if (iClub < 0 || iElo < 0) return [];

  const out = [];
  for (let k = 1; k < lines.length; k++) {
    const cells = lines[k].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
    const elo = Number(cells[iElo]);
    const club = cells[iClub];
    if (!club || !Number.isFinite(elo) || elo < 500 || elo > 3000) continue;
    out.push({
      club,
      country: iCountry >= 0 ? cells[iCountry] : '',
      level: iLevel >= 0 && cells[iLevel] !== '' ? Number(cells[iLevel]) : null,
      elo,
    });
  }
  return out;
}

async function fetchText(url, timeout = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'sharpshooter/1.0' } });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** All club ratings on a date (YYYY-MM-DD). Cached; a failure is never cached. */
async function ratingsOn(dateISO) {
  const day = String(dateISO || new Date().toISOString()).slice(0, 10);
  const key = `elo:v1:${day}`;
  const hit = espn.memGet(key);
  if (hit !== undefined) return hit;
  const disk = espn.diskGet(key, TTL);
  if (Array.isArray(disk) && disk.length) {
    espn.memSet(key, disk, TTL);
    return disk;
  }
  return espn.cached(key + ':load', 30 * 1000, async () => {
    const rows = parseCsv(await fetchText(`${BASE}/${day}`));
    if (rows.length) {
      espn.diskSet(key, rows);
      espn.memSet(key, rows, TTL);
    }
    return rows;
  });
}

/** Resolve an ESPN team name against ClubElo rows, optionally restricted to a country. */
function findClub(rows, espnName, country) {
  if (!rows || !rows.length) return null;
  const pool = country ? rows.filter((r) => !r.country || r.country === country) : rows;
  const f = fold(espnName);
  const want = fold(ALIAS[f] || espnName);

  // 1. exact (after aliasing)
  const exact = pool.filter((r) => fold(r.club) === want);
  if (exact.length === 1) return exact[0];

  // 2. one name wholly contained in the other, accepted only when unique
  const wt = new Set(want.split(' '));
  const contained = pool.filter((r) => {
    const ct = new Set(fold(r.club).split(' '));
    const [s, l] = wt.size <= ct.size ? [wt, ct] : [ct, wt];
    return s.size > 0 && [...s].every((t) => l.has(t));
  });
  if (contained.length === 1) return contained[0];
  return null; // ambiguous or unknown: one fewer witness, never a guess
}

/**
 * Elo read for a fixture.
 * @returns {Promise<null | {home:number, away:number, diff:number, expectancy:number, favourite:'home'|'away'|'even', club:{home:string,away:string}}>}
 */
async function eloFor(leagueSlug, homeName, awayName, dateISO) {
  try {
    const rows = await ratingsOn(dateISO);
    if (!rows.length) return null;
    const lg = L.get(leagueSlug);
    // Registry codes like "ENG2" -> "ENG". European cups have no single country.
    const cc = lg && !lg.cup && lg.cc ? String(lg.cc).replace(/\d+$/, '') : null;
    const h = findClub(rows, homeName, cc) || findClub(rows, homeName, null);
    const a = findClub(rows, awayName, cc) || findClub(rows, awayName, null);
    if (!h || !a || h.club === a.club) return null;
    return summarise(h, a);
  } catch {
    return null;
  }
}

/** Pure: build the directional summary from two resolved rows. */
function summarise(h, a) {
  const diff = h.elo + HOME_ADV - a.elo;
  const expectancy = 1 / (1 + Math.pow(10, -diff / 400)); // expected score, draws = half
  // "even" band: within ~25 Elo points (≈ 3.5pp of expectancy) there is no real favourite.
  const favourite = Math.abs(diff) < 25 ? 'even' : diff > 0 ? 'home' : 'away';
  return {
    home: h.elo,
    away: a.elo,
    diff,
    expectancy,
    favourite,
    club: { home: h.club, away: a.club },
  };
}

module.exports = { parseCsv, ratingsOn, findClub, eloFor, summarise, HOME_ADV };
