'use strict';

/**
 * crawler/sources/clubelo.js — ClubElo ratings now, 30 days ago and 90 days ago.
 *
 * Three daily snapshots (shared by every fixture of the day) give each club's rating and
 * its momentum — the "Elo change" factors the v6 model was trained on. Name matching is
 * lib/elo.js's conservative matcher (aliases, then unique containment; ambiguity = no read).
 */

const ELO = require('../../elo');
const L = require('../../leagues');

const DAY = 86400000;
const shift = (iso, days) => new Date(Date.parse(String(iso).slice(0, 10) + 'T00:00:00Z') - days * DAY).toISOString().slice(0, 10);

/**
 * @returns {Promise<null | {home:{club,now,d30,d90}, away:{club,now,d30,d90}, asOf:string}>}
 */
async function trend(slug, homeName, awayName, dateISO) {
  const day = String(dateISO || new Date().toISOString()).slice(0, 10);
  try {
    const [r0, r30, r90] = await Promise.all([ELO.ratingsOn(day), ELO.ratingsOn(shift(day, 30)), ELO.ratingsOn(shift(day, 90))]);
    if (!r0 || !r0.length) return null;
    const lg = L.get(slug);
    const cc = lg && !lg.cup && lg.cc ? String(lg.cc).replace(/\d+$/, '') : null;
    const side = (name) => {
      const row = ELO.findClub(r0, name, cc) || ELO.findClub(r0, name, null);
      if (!row) return null;
      const at = (rows) => {
        const x = (rows || []).find((r) => r.club === row.club && (!row.country || r.country === row.country));
        return x ? x.elo : null;
      };
      return { club: row.club, country: row.country || null, now: row.elo, d30: at(r30), d90: at(r90) };
    };
    const home = side(homeName);
    const away = side(awayName);
    if (!home && !away) return null;
    if (home && away && home.club === away.club) return null;
    return { home, away, asOf: day };
  } catch {
    return null;
  }
}

module.exports = { trend, shift };
