'use strict';

/**
 * history.js — free, key-less match history from the openfootball project.
 *
 * Source: https://github.com/openfootball  (public-domain results, served from
 * raw.githubusercontent.com). No key, no quota, and — unlike the odds source —
 * no daily limit to burn.
 *
 * Why this exists
 * ---------------
 * ESPN's summary endpoint exposes only the last FIVE games per team, and only
 * as an aggregate. The methodologies need real per-game evidence over 8-10
 * matches: the 0 / 1 / 2+ goal distribution, clean-sheet and failed-to-score
 * rates, how a favourite actually wins (1-0 or 3-0?), and how an underdog
 * actually loses. This module supplies that, for the leagues openfootball
 * covers, and says plainly when it cannot.
 *
 * It also gives us league scoring environment (Over 2.5 rate, BTTS rate, home /
 * draw / away shares) computed from real results rather than assumed.
 *
 * Design rules
 * ------------
 *  - Purely additive. Every function returns null / [] on failure; the engine
 *    must run exactly as before when this source is unreachable.
 *  - Never throws into the caller.
 *  - Parsed seasons are cached in memory and on disk, so a restart is free.
 */

const espn = require('./espn');
const IS = require('./infersports');

const RAW = 'https://raw.githubusercontent.com/openfootball';

/**
 * ESPN league slug -> openfootball repo + file.
 * Only paths verified to exist are listed. A league absent from this table is
 * simply "no history coverage" — the methodologies treat that as a coverage
 * gap, never as a reason to guess.
 */
const SOURCES = {
  'eng.1': { repo: 'england', file: '1-premierleague.txt' },
  'eng.2': { repo: 'england', file: '2-championship.txt' },
  'ger.1': { repo: 'deutschland', file: '1-bundesliga.txt' },
  'ger.2': { repo: 'deutschland', file: '2-bundesliga2.txt' },
  'esp.1': { repo: 'espana', file: '1-liga.txt' },
  'esp.2': { repo: 'espana', file: '2-liga2.txt' },
  'ita.1': { repo: 'italy', file: '1-seriea.txt' },
  'ita.2': { repo: 'italy', file: '2-serieb.txt' },
  'aut.1': { repo: 'austria', file: '1-bundesliga.txt' },
};

const TTL_CURRENT = 3 * 60 * 60 * 1000; // current season changes weekly
const TTL_PAST = 7 * 24 * 60 * 60 * 1000; // a finished season never changes

// ---------------------------------------------------------------- seasons

/** "2025-26" style season folder for the season that contains `date`. */
function seasonFolder(startYear) {
  const next = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${next}`;
}

/** Start year of the season that contains a date (seasons begin in July). */
function seasonStartFor(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getUTCFullYear();
  return d.getUTCMonth() >= 6 ? y : y - 1;
}

// ---------------------------------------------------------------- parsing

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

const DATE_RE = /^\s*(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+([A-Z][a-z]{2})\s+(\d{1,2})(?:\s+(\d{4}))?\s*$/;
// Two layouts exist across openfootball files and seasons:
//   A) "  19:00   Liverpool  4-2 (1-0)  Bournemouth"      score between the teams
//   B) "  20:00  Arsenal FC   v Coventry City FC   3-0 (2-0)"   "v" between, score last
// Teams are separated from the score by 2+ spaces in (A), which is what keeps
// names like "1. FC Koln" intact; (B) is split on a standalone " v ".
const MATCH_RE_A = /^\s*(?:(\d{1,2}[:.]\d{2})\s+)?(.+?)\s{2,}(\d+)-(\d+)(?:\s+\((\d+)-(\d+)\))?\s{2,}(.+?)\s*$/;
const MATCH_RE_B = /^\s*(?:(\d{1,2}[:.]\d{2})\s+)?(.+?)\s+v\s+(.+?)\s{2,}(\d+)-(\d+)(?:\s+\((\d+)-(\d+)\))?\s*$/;

/** Parse one result line into {home, away, hg, ag, hthg, htag} or null. */
function parseResultLine(line) {
  let m = MATCH_RE_B.exec(line);
  if (m) {
    return {
      home: m[2].trim(),
      away: m[3].trim(),
      hg: Number(m[4]),
      ag: Number(m[5]),
      hthg: m[6] != null ? Number(m[6]) : null,
      htag: m[7] != null ? Number(m[7]) : null,
    };
  }
  m = MATCH_RE_A.exec(line);
  if (m) {
    return {
      home: m[2].trim(),
      away: m[7].trim(),
      hg: Number(m[3]),
      ag: Number(m[4]),
      hthg: m[5] != null ? Number(m[5]) : null,
      htag: m[6] != null ? Number(m[6]) : null,
    };
  }
  return null;
}

/**
 * Parse an openfootball Football.TXT league file into completed matches.
 * Fixtures with no score yet are skipped. Extra-time / penalty annotations are
 * not expected in league files; a line that carries one is dropped rather than
 * risk recording a non-regular-time score.
 *
 * @param {string} text
 * @param {number} startYear season start year (to infer the year of each date)
 * @returns {Array<{date:string, home:string, away:string, hg:number, ag:number, hthg:?number, htag:?number}>}
 */
function parseSeasonText(text, startYear) {
  if (!text) return [];
  const out = [];
  let month = null;
  let day = null;
  let year = null;

  for (const line of String(text).split(/\r?\n/)) {
    const dm = DATE_RE.exec(line);
    if (dm) {
      month = MONTHS[dm[1].toLowerCase()];
      day = Number(dm[2]);
      if (dm[3]) year = Number(dm[3]);
      else if (month) year = month >= 7 ? startYear : startYear + 1;
      continue;
    }
    if (!month || !day || !year) continue;
    if (/a\.e\.t\.|pen\.|\bpen\b/i.test(line)) continue;
    const r = parseResultLine(line);
    if (!r) continue;
    if (!r.home || !r.away || /^\(/.test(r.home) || /^\(/.test(r.away)) continue;
    out.push({
      date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
      ...r,
    });
  }
  return out;
}

// ---------------------------------------------------------------- loading

async function fetchText(url, timeout = 20000) {
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

/**
 * Load one season of one league. Returns [] when the file does not exist or the
 * network is unavailable — and does NOT cache a failure (see README: a failed
 * fetch must never be remembered as an empty result).
 */
async function loadSeason(slug, startYear) {
  const src = SOURCES[slug];
  if (!src) return [];
  const isCurrent = startYear === seasonStartFor(new Date());
  const key = `hist:v1:${slug}:${startYear}`;
  const ttl = isCurrent ? TTL_CURRENT : TTL_PAST;

  const hit = espn.memGet(key);
  if (hit !== undefined) return hit;
  const disk = espn.diskGet(key, ttl);
  if (disk !== undefined && Array.isArray(disk)) {
    espn.memSet(key, disk, Math.min(ttl, 60 * 60 * 1000));
    return disk;
  }

  return espn.cached(key + ':load', 60 * 1000, async () => {
    const url = `${RAW}/${src.repo}/master/${seasonFolder(startYear)}/${src.file}`;
    const text = await fetchText(url);
    if (text == null) return [];
    const matches = parseSeasonText(text, startYear);
    if (matches.length) {
      espn.diskSet(key, matches);
      espn.memSet(key, matches, Math.min(ttl, 60 * 60 * 1000));
    }
    return matches;
  });
}

/**
 * Collapse spelling variants of one club into a single name.
 *
 * openfootball renames clubs between seasons ("Napoli" / "SSC Napoli",
 * "Milan" / "AC Milan", "Torino" / "Torino FC"). Left alone, a team's games
 * split across two names and its "last 8" silently becomes "last 3".
 *
 * Two names are the same club when one's identifying tokens are wholly
 * contained in the other's. Manchester United / Manchester City share a token
 * but neither contains the other, so they stay apart.
 */
function canonicalize(matches) {
  const count = new Map();
  const seasons = new Map(); // name -> Set(season start years it appears in)
  for (const m of matches) {
    const s = seasonStartFor(m.date);
    for (const n of [m.home, m.away]) {
      count.set(n, (count.get(n) || 0) + 1);
      if (!seasons.has(n)) seasons.set(n, new Set());
      seasons.get(n).add(s);
    }
  }
  const names = [...count.keys()];
  const info = names.map((n) => ({ n, tokens: new Set(foldName(n).split(' ').filter(Boolean)) }));

  // Two clubs that play in the same league in the same season are, by
  // definition, different clubs ("Barcelona" is contained in "Espanyol de
  // Barcelona", yet both are in LaLiga together). A rename only ever happens
  // BETWEEN seasons, so two groups may be merged only if their season sets are
  // disjoint. The check is made on whole groups, not single names, so a wrong
  // early merge cannot chain into a second one.
  const parent = new Map(names.map((n) => [n, n]));
  const groupSeasons = new Map(names.map((n) => [n, new Set(seasons.get(n))]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const subset = (a, b) => a.size > 0 && [...a].every((t) => b.has(t));
  const tryUnion = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    const sa = groupSeasons.get(ra);
    const sb = groupSeasons.get(rb);
    for (const s of sa) if (sb.has(s)) return; // same season => different clubs
    parent.set(ra, rb);
    for (const s of sa) sb.add(s);
  };

  // Pass 1: identical after folding ("Barcelona" / "FC Barcelona") — the safest merge, done first.
  for (let i = 0; i < info.length; i++) {
    for (let j = i + 1; j < info.length; j++) {
      if (foldName(info[i].n) === foldName(info[j].n)) tryUnion(info[i].n, info[j].n);
    }
  }
  // Pass 2: one name's tokens wholly inside the other's ("Napoli" / "SSC Napoli").
  for (let i = 0; i < info.length; i++) {
    for (let j = i + 1; j < info.length; j++) {
      if (subset(info[i].tokens, info[j].tokens) || subset(info[j].tokens, info[i].tokens)) {
        tryUnion(info[i].n, info[j].n);
      }
    }
  }

  // Representative = the most frequently used spelling in the cluster.
  const best = new Map();
  for (const n of names) {
    const root = find(n);
    const cur = best.get(root);
    if (!cur || count.get(n) > count.get(cur) || (count.get(n) === count.get(cur) && n.length > cur.length)) {
      best.set(root, n);
    }
  }
  const canon = (n) => best.get(find(n));
  return matches.map((m) => ({ ...m, home: canon(m.home), away: canon(m.away) }));
}

/** The current season plus the previous one, oldest first, with club names unified. */
async function loadRecent(slug, asOf) {
  if (!SOURCES[slug]) return [];
  const start = seasonStartFor(asOf || new Date());
  const [prev, cur] = await Promise.all([loadSeason(slug, start - 1), loadSeason(slug, start)]);
  const merged = [...prev, ...cur].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return canonicalize(merged);
}

function covers(slug) {
  return !!SOURCES[slug];
}

// ---------------------------------------------------------------- team lookup

/**
 * Resolve an ESPN team name to the name used in a history file.
 * Uses the same token matcher the odds source uses, restricted to the teams that
 * actually appear in this league's file, and refuses ambiguous matches.
 */

/** Tags that carry no identity. Deliberately NOT the odds matcher's list: that one
 *  strips "city" / "united" / "real", which makes Manchester City and Manchester
 *  United the same club. History needs to tell them apart. */
const CLUB_TAGS = new Set(['fc', 'afc', 'cf', 'sc', 'ac', 'as', 'sv', 'vfb', 'vfl', 'tsg', 'fk', 'sk', 'ssc', 'rcd', 'cd', 'ud', 'if', 'bk', 'ik', 'cfc', '1']);

/** Known spellings that differ between ESPN and openfootball (folded form -> folded form). */
const ALIASES = {
  'fc cologne': 'koln',
  cologne: 'koln',
  'bayern munich': 'bayern munchen',
  'borussia monchengladbach': 'monchengladbach',
  'borussia m gladbach': 'monchengladbach',
  'm gladbach': 'monchengladbach',
  gladbach: 'monchengladbach',
  'athletic club': 'athletic bilbao',
  'inter milan': 'internazionale milano',
  inter: 'internazionale milano',
  internazionale: 'internazionale milano',
  'ac milan': 'milan',
  'atletico de madrid': 'atletico madrid',
  'spurs': 'tottenham hotspur',
  'man city': 'manchester city',
  'man united': 'manchester united',
  'man utd': 'manchester united',
  wolves: 'wolverhampton wanderers',
  "nott'm forest": 'nottingham forest',
  'newcastle': 'newcastle united',
  'leeds': 'leeds united',
  'brighton': 'brighton and hove albion',
};

function foldName(name) {
  const base = String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !CLUB_TAGS.has(w))
    .join(' ');
  return ALIASES[base] || base;
}

function resolveName(espnName, matches) {
  const names = new Set();
  for (const m of matches) {
    names.add(m.home);
    names.add(m.away);
  }
  const folded = new Map(); // folded -> original
  for (const n of names) folded.set(foldName(n), n);

  const target = foldName(espnName);
  if (!target) return null;

  // 1. Exact folded equality — unambiguous.
  if (folded.has(target)) return folded.get(target);

  // 2. One name wholly contained in the other ("brighton" in "brighton and hove
  //    albion"), accepted only when exactly one club fits.
  const tTokens = new Set(target.split(' '));
  const contained = [];
  for (const [f, orig] of folded) {
    const fTokens = new Set(f.split(' '));
    const [small, large] = tTokens.size <= fTokens.size ? [tTokens, fTokens] : [fTokens, tTokens];
    if (small.size >= 1 && [...small].every((t) => large.has(t))) contained.push(orig);
  }
  if (contained.length === 1) return contained[0];

  // 3. Fuzzy stem match ("munich" / "munchen"), accepted only when clearly best.
  const tt = IS.tokens(espnName);
  let best = null;
  let second = 0;
  for (const n of names) {
    const s = IS.similarity(tt, IS.tokens(n));
    if (!best || s > best.score) {
      second = best ? best.score : 0;
      best = { name: n, score: s };
    } else if (s > second) {
      second = s;
    }
  }
  if (best && best.score >= 0.6 && best.score - second >= 0.2) return best.name;
  return null; // ambiguous or unknown — no history is better than the wrong club's
}

// ---------------------------------------------------------------- team evidence

/** Every completed match for a team before `before`, newest first, oriented to that team. */
function teamGames(matches, teamName, before, limit) {
  const out = [];
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    if (before && m.date >= before) continue;
    let g = null;
    if (m.home === teamName) g = { gf: m.hg, ga: m.ag, venue: 'H', date: m.date, opp: m.away };
    else if (m.away === teamName) g = { gf: m.ag, ga: m.hg, venue: 'A', date: m.date, opp: m.home };
    if (g) {
      out.push(g);
      if (limit && out.length >= limit) break;
    }
  }
  return out;
}

/** Head-to-head meetings (any venue), newest first, oriented to the CURRENT home/away teams. */
function h2hGames(matches, homeName, awayName, before, limit = 8) {
  const out = [];
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    if (before && m.date >= before) continue;
    if (m.home === homeName && m.away === awayName) out.push({ hg: m.hg, ag: m.ag, date: m.date });
    else if (m.home === awayName && m.away === homeName) out.push({ hg: m.ag, ag: m.hg, date: m.date });
    if (out.length >= limit) break;
  }
  return out;
}

/** League scoring environment from real results (all matches before `before`). */
function leagueRates(matches, before) {
  let n = 0;
  let goals = 0;
  let over25 = 0;
  let btts = 0;
  let home = 0;
  let draw = 0;
  let away = 0;
  let homeGoals = 0;
  for (const m of matches) {
    if (before && m.date >= before) continue;
    n++;
    const t = m.hg + m.ag;
    goals += t;
    homeGoals += m.hg;
    if (t > 2) over25++;
    if (m.hg > 0 && m.ag > 0) btts++;
    if (m.hg > m.ag) home++;
    else if (m.hg === m.ag) draw++;
    else away++;
  }
  if (n < 20) return null;
  return {
    n,
    goalsPerGame: goals / n,
    over25Rate: over25 / n,
    bttsRate: btts / n,
    homeWinRate: home / n,
    drawRate: draw / n,
    awayWinRate: away / n,
    homeGoalShare: goals ? homeGoals / goals : 0.55,
  };
}

/**
 * Build the per-fixture history bundle the methodology layer consumes.
 *
 * @returns {Promise<null | {
 *   source:string, leagueRates:object|null,
 *   home:{name:string, games:Array}, away:{name:string, games:Array},
 *   h2h:Array
 * }>}
 */
async function bundleFor(slug, homeName, awayName, asOf, awaySlug) {
  try {
    const aSlug = awaySlug || slug;
    if (!covers(slug) || !covers(aSlug)) return null;
    const before = asOf instanceof Date ? asOf.toISOString().slice(0, 10) : asOf ? String(asOf).slice(0, 10) : null;

    const homeMatches = await loadRecent(slug, asOf);
    const awayMatches = aSlug === slug ? homeMatches : await loadRecent(aSlug, asOf);
    if (!homeMatches.length || !awayMatches.length) return null;

    const hName = resolveName(homeName, homeMatches);
    const aName = resolveName(awayName, awayMatches);
    if (!hName || !aName || (aSlug === slug && hName === aName)) return null;

    return {
      source: 'openfootball',
      crossLeague: aSlug !== slug,
      leagueRates: leagueRates(homeMatches, before),
      home: { name: hName, games: teamGames(homeMatches, hName, before, 12) },
      away: { name: aName, games: teamGames(awayMatches, aName, before, 12) },
      // Meetings in two different domestic leagues cannot be in either file.
      h2h: aSlug === slug ? h2hGames(homeMatches, hName, aName, before, 8) : [],
    };
  } catch {
    return null;
  }
}

module.exports = {
  SOURCES,
  covers,
  seasonFolder,
  seasonStartFor,
  parseSeasonText,
  loadSeason,
  loadRecent,
  resolveName,
  teamGames,
  h2hGames,
  leagueRates,
  bundleFor,
};
