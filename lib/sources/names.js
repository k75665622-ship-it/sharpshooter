'use strict';

/**
 * sources/names.js — telling which names in two data sources are the same club.
 *
 * Every free source spells clubs differently: ESPN "Brighton & Hove Albion",
 * openfootball "Brighton & Hove Albion FC", football-data "Brighton", ClubElo
 * "Brighton". Hand-maintained alias tables rot. So v5 LEARNS the mapping from the
 * data itself:
 *
 *   Two results from different sources that fall within a day of each other and
 *   have the SAME score vote for "home A = home B" and "away A = away B". Over a
 *   season every club plays ~19 home games, so the true pairing collects a dozen
 *   or more votes, while coincidences collect one or two. A pairing is accepted
 *   only when it is the clear, mutual winner for both names.
 *
 * Names with no learned mapping fall back to a conservative string matcher that
 * refuses ambiguity (an unknown club is better than the wrong club).
 */

const CLUB_TAGS = new Set(['fc', 'afc', 'cf', 'sc', 'ac', 'as', 'sv', 'vfb', 'vfl', 'tsg', 'fk', 'sk', 'ssc', 'rcd', 'cd', 'ud', 'if', 'bk', 'ik', 'cfc', 'calcio', 'club', 'de', 'cp', 'sl', 'bc', 'ec', 'ca', 'rc', 'sd', 'aj', 'jk', 'kv', 'krc', 'rsc', 'osc', 'ogc', 'us']);

const ALIASES = {
  'man city': 'manchester city',
  'man united': 'manchester united',
  'man utd': 'manchester united',
  "nott m forest": 'nottingham forest',
  'nottm forest': 'nottingham forest',
  spurs: 'tottenham hotspur',
  tottenham: 'tottenham hotspur',
  wolves: 'wolverhampton wanderers',
  'west brom': 'west bromwich albion',
  'sheffield utd': 'sheffield united',
  'sheffield weds': 'sheffield wednesday',
  'bayern munich': 'bayern munchen',
  'fc cologne': 'koln',
  cologne: 'koln',
  'm gladbach': 'monchengladbach',
  gladbach: 'monchengladbach',
  'borussia monchengladbach': 'monchengladbach',
  'ein frankfurt': 'eintracht frankfurt',
  'athletic club': 'athletic bilbao',
  ath: 'athletic bilbao',
  'ath bilbao': 'athletic bilbao',
  'ath madrid': 'atletico madrid',
  'atletico de madrid': 'atletico madrid',
  'inter milan': 'inter',
  internazionale: 'inter',
  'ac milan': 'milan',
  'paris saint germain': 'paris sg',
  psg: 'paris sg',
  'sporting cp': 'sporting',
  'sporting lisbon': 'sporting',
};

function fold(name) {
  const base = String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !CLUB_TAGS.has(w) && !/^\d+$/.test(w))
    .join(' ')
    .replace(/\band\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return ALIASES[base] || base;
}

const tokens = (s) => new Set(fold(s).split(' ').filter(Boolean));

/**
 * Conservative string match of `name` against a list of candidate names.
 * Returns the candidate, or null when nothing (or more than one thing) fits.
 */
function matchName(name, candidates) {
  const target = fold(name);
  if (!target) return null;
  const list = [...new Set(candidates)];
  const exact = list.filter((c) => fold(c) === target);
  if (exact.length === 1) return exact[0];
  const tt = tokens(name);
  const contained = list.filter((c) => {
    const ct = tokens(c);
    const [s, l] = tt.size <= ct.size ? [tt, ct] : [ct, tt];
    return s.size > 0 && [...s].every((t) => l.has(t));
  });
  if (contained.length === 1) return contained[0];
  // prefix-stem match ("munich"/"munchen", "koeln"/"koln") on the longest token
  const stem = (w) => w.slice(0, 4);
  const ts = new Set([...tt].filter((w) => w.length >= 4).map(stem));
  if (ts.size) {
    const scored = list.map((c) => {
      const cs = new Set([...tokens(c)].filter((w) => w.length >= 4).map(stem));
      let inter = 0;
      for (const s of ts) if (cs.has(s)) inter++;
      return { c, s: inter / Math.max(ts.size, cs.size || 1) };
    }).sort((a, b) => b.s - a.s);
    if (scored[0] && scored[0].s >= 0.6 && (!scored[1] || scored[0].s - scored[1].s >= 0.25)) return scored[0].c;
  }
  return null;
}

/**
 * Learn A-name -> B-name from co-occurring identical results.
 * @param {Array<{date:string, home:string, away:string, hg:number, ag:number}>} A
 * @param {Array} B
 * @returns {Map<string,string>}
 */
function learnMapping(A, B) {
  const byDate = new Map();
  for (const m of B) {
    const k = String(m.date).slice(0, 10);
    if (!byDate.has(k)) byDate.set(k, []);
    byDate.get(k).push(m);
  }
  const shift = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
  const votes = new Map(); // a -> Map(b -> count)
  const vote = (a, b) => {
    if (!votes.has(a)) votes.set(a, new Map());
    const v = votes.get(a);
    v.set(b, (v.get(b) || 0) + 1);
  };
  for (const a of A) {
    const d = String(a.date).slice(0, 10);
    const cands = [...(byDate.get(d) || []), ...(byDate.get(shift(d, -1)) || []), ...(byDate.get(shift(d, 1)) || [])]
      .filter((b) => b.hg === a.hg && b.ag === a.ag);
    // A same-day, same-score coincidence is common in big leagues, so a unique
    // candidate counts double: it is far stronger evidence than one of several.
    for (const b of cands) {
      vote(a.home, b.home);
      vote(a.away, b.away);
      if (cands.length === 1) {
        vote(a.home, b.home);
        vote(a.away, b.away);
      }
    }
  }
  // best candidate per A-name, accepted when it clearly beats the runner-up
  const best = new Map();
  for (const [a, v] of votes) {
    const sorted = [...v.entries()].sort((x, y) => y[1] - x[1]);
    const [b, n] = sorted[0];
    const second = sorted[1] ? sorted[1][1] : 0;
    if (n >= 4 && n >= 2 * second) best.set(a, { b, n });
  }
  // mutual uniqueness: one B-name may not be claimed by two A-names
  const claimed = new Map();
  for (const [a, { b, n }] of best) {
    const prev = claimed.get(b);
    if (!prev || n > prev.n) claimed.set(b, { a, n });
  }
  const out = new Map();
  for (const [b, { a }] of claimed) out.set(a, b);
  return out;
}

/**
 * Resolve `name` (from source A) into source B's spelling, using the learned
 * mapping first and the conservative matcher second.
 */
function resolve(name, mapping, bNames) {
  if (mapping && mapping.has(name)) return mapping.get(name);
  return matchName(name, bNames);
}

module.exports = { fold, tokens, matchName, learnMapping, resolve, ALIASES };
