'use strict';

/**
 * sources/fpl.js — Premier League availability from the official Fantasy Premier
 * League API (free, key-less): every player's status, chance of playing and the
 * club's own injury note, plus season minutes and expected goal involvements.
 *
 * Why it matters: v4 inferred absences from ESPN headlines with regular
 * expressions. That is a guess. FPL is the club-fed availability list, with a
 * percentage. v5 turns it into numbers the methodologies can gate on:
 *
 *   attackLoss   share of the team's expected goal involvements (xGI) that is
 *                unavailable, weighted by (1 - chance of playing)
 *   defLoss      regular defenders / goalkeepers out, weighted the same way
 *   keyOut       named regulars likely to miss the match, with the club's note
 *
 * Premier League only (FPL covers nothing else). Every other league keeps the
 * headline scanner, and the UI says which one was used.
 *
 * Field names verified against the live endpoint (Oct 2026): teams[].{id,name,
 * short_name}; elements[].{web_name, team, element_type (1 GK, 2 DEF, 3 MID,
 * 4 FWD), status (a/d/i/s/u/n), chance_of_playing_next_round, news, minutes,
 * starts, expected_goal_involvements}.
 */

const espn = require('../espn');
const N = require('./names');

const URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';
const TTL = 60 * 60 * 1000;
const POS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };

async function bootstrap() {
  const key = 'fpl:bootstrap:v5';
  const hit = espn.memGet(key);
  if (hit !== undefined) return hit;
  const disk = espn.diskGet(key, TTL);
  if (disk && disk.teams) {
    espn.memSet(key, disk, TTL);
    return disk;
  }
  return espn.cached(key + ':load', 60 * 1000, async () => {
    try {
      const res = await fetch(URL, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Sharpshooter/5.0)' } });
      if (!res.ok) return null;
      const j = await res.json();
      if (!j || !Array.isArray(j.teams) || !Array.isArray(j.elements)) return null;
      // keep only what we use: the full payload is ~1.5 MB
      const slim = {
        teams: j.teams.map((t) => ({ id: t.id, name: t.name, short: t.short_name })),
        elements: j.elements.map((e) => ({
          name: e.web_name,
          team: e.team,
          pos: e.element_type,
          status: e.status,
          chance: e.chance_of_playing_next_round,
          news: e.news || '',
          newsAdded: e.news_added || null,
          minutes: Number(e.minutes) || 0,
          starts: Number(e.starts) || 0,
          xgi: Number(e.expected_goal_involvements) || 0,
        })),
        fetchedAt: new Date().toISOString(),
      };
      espn.diskSet(key, slim);
      espn.memSet(key, slim, TTL);
      return slim;
    } catch {
      return null;
    }
  });
}

/** Probability a player is available, from status + chance of playing. */
function availability(p) {
  if (p.status === 'a') return p.chance == null ? 1 : p.chance / 100;
  if (p.chance != null) return Math.max(0, Math.min(1, p.chance / 100));
  if (p.status === 'd') return 0.5;
  return 0; // i (injured), s (suspended), u (unavailable), n (not in squad)
}

/**
 * Availability summary for one club.
 * @returns {null | {source:'fpl', team:string, attackLoss:number, defLoss:number, gkOut:boolean, keyOut:Array, doubtful:Array, fetchedAt:string}}
 */
function teamReport(boot, teamName) {
  if (!boot || !teamName) return null;
  const names = boot.teams.flatMap((t) => [t.name, t.short]);
  const hit = N.matchName(teamName, names);
  if (!hit) return null;
  const team = boot.teams.find((t) => t.name === hit || t.short === hit);
  const squad = boot.elements.filter((e) => e.team === team.id);
  if (!squad.length) return null;
  const maxMin = Math.max(...squad.map((p) => p.minutes), 1);
  const teamXgi = squad.reduce((a, p) => a + p.xgi, 0) || 1;

  let attackLoss = 0;
  let defLoss = 0;
  let gkOut = false;
  const keyOut = [];
  const doubtful = [];
  for (const p of squad) {
    const av = availability(p);
    if (av >= 0.999) continue;
    const share = p.minutes / maxMin;
    const xgiShare = p.xgi / teamXgi;
    const regular = share >= 0.45;
    attackLoss += (1 - av) * xgiShare;
    if (regular && (p.pos === 1 || p.pos === 2)) defLoss += 1 - av;
    if (regular && p.pos === 1 && av < 0.5) gkOut = true;
    const row = { name: p.name, pos: POS[p.pos] || '?', chance: Math.round(av * 100), news: p.news, regular, xgiShare: Math.round(xgiShare * 1000) / 1000 };
    if ((regular || xgiShare >= 0.08) && av < 0.5) keyOut.push(row);
    else if ((regular || xgiShare >= 0.08) && av < 0.9) doubtful.push(row);
  }
  keyOut.sort((a, b) => b.xgiShare - a.xgiShare);
  return {
    source: 'fpl',
    team: team.name,
    attackLoss: Math.min(0.7, attackLoss),
    defLoss,
    gkOut,
    keyOut,
    doubtful,
    fetchedAt: boot.fetchedAt,
  };
}

/** Both sides of a fixture. Premier League only; null elsewhere or on any failure. */
async function fixtureReport(slug, homeName, awayName) {
  if (slug !== 'eng.1') return null;
  try {
    const boot = await bootstrap();
    if (!boot) return null;
    const home = teamReport(boot, homeName);
    const away = teamReport(boot, awayName);
    if (!home || !away) return null;
    return { home, away };
  } catch {
    return null;
  }
}

/**
 * Expected-goals multipliers from availability. Deliberately conservative:
 * replacements score too, so only half of the missing xGI share is removed, and a
 * depleted back line adds at most 12% to the opponent.
 */
function lambdaAdjust(rep) {
  if (!rep) return { home: 1, away: 1 };
  const att = (r) => 1 - 0.5 * Math.min(0.6, r.attackLoss);
  const leak = (r) => 1 + Math.min(0.12, 0.04 * r.defLoss + (r.gkOut ? 0.04 : 0));
  return {
    home: att(rep.home) * leak(rep.away),
    away: att(rep.away) * leak(rep.home),
  };
}

module.exports = { bootstrap, availability, teamReport, fixtureReport, lambdaAdjust };
