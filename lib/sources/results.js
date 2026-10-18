'use strict';

/**
 * sources/results.js — verified per-game results for a whole league, from up to
 * three free, key-less sources, cross-checked against each other.
 *
 *   1. ESPN scoreboard date ranges   every ESPN league; names identical to fixtures
 *   2. openfootball (GitHub)         football.json for 19+ leagues, never rate limited
 *   3. football-data.co.uk CSVs      ~38 leagues, also carries closing odds
 *
 * VERIFICATION (v3.0 Rule 16 — "cross-check 3 times", made mechanical)
 * -------------------------------------------------------------------
 * One source is PRIMARY (ESPN when it has the season, since its team names are
 * the fixture's own names). Every primary result is then looked up in each other
 * source, after team names are mapped by lib/sources/names.js:
 *
 *   verified     another source has the same fixture with the same score
 *   disputed     another source has the same fixture with a DIFFERENT score —
 *                the result is dropped from the evidence (wrong data is worse
 *                than missing data); with three sources, the majority wins
 *   single       only one source has it — kept, and counted separately
 *
 * The provenance block reports how much of the evidence is verified, so the UI
 * and the methodology coverage gates can say exactly how solid the data is.
 *
 * Failure-safe: every source returns [] on any error, and is never cached empty.
 */

const espn = require('../espn');
const FD = require('../fdata');
const H = require('../history');
const N = require('./names');
const L = require('../leagues');

const RAW = 'https://raw.githubusercontent.com/openfootball/football.json/master';

/** ESPN slug -> openfootball football.json code. Verified present on GitHub (Oct 2026). */
const OF_JSON = {
  'eng.1': 'en.1', 'eng.2': 'en.2', 'eng.3': 'en.3', 'eng.4': 'en.4',
  'ger.1': 'de.1', 'ger.2': 'de.2', 'esp.1': 'es.1', 'esp.2': 'es.2',
  'ita.1': 'it.1', 'ita.2': 'it.2', 'fra.1': 'fr.1', 'fra.2': 'fr.2',
  'ned.1': 'nl.1', 'por.1': 'pt.1', 'bel.1': 'be.1', 'aut.1': 'at.1',
  'sco.1': 'sco.1', 'tur.1': 'tr.1', 'gre.1': 'gr.1',
  'bra.1': 'br.1', 'arg.1': 'ar.1', 'jpn.1': 'jp.1', 'chn.1': 'cn.1',
};

/** ESPN slug -> football-data.co.uk code. */
const FD_CODE = {
  'eng.1': 'E0', 'eng.2': 'E1', 'eng.3': 'E2', 'eng.4': 'E3', 'sco.1': 'SC0',
  'ger.1': 'D1', 'ger.2': 'D2', 'esp.1': 'SP1', 'esp.2': 'SP2', 'ita.1': 'I1', 'ita.2': 'I2',
  'fra.1': 'F1', 'fra.2': 'F2', 'ned.1': 'N1', 'bel.1': 'B1', 'por.1': 'P1', 'tur.1': 'T1', 'gre.1': 'G1',
  'nor.1': 'NOR', 'swe.1': 'SWE', 'den.1': 'DNK', 'aut.1': 'AUT', 'sui.1': 'SWZ', 'usa.1': 'USA',
  'bra.1': 'BRA', 'arg.1': 'ARG', 'jpn.1': 'JPN', 'chn.1': 'CHN', 'mex.1': 'MEX', 'rus.1': 'RUS',
  'pol.1': 'POL', 'rou.1': 'ROU',
};

/** Leagues whose season is a calendar year. */
const CALENDAR = new Set(['bra.1', 'bra.2', 'arg.1', 'usa.1', 'jpn.1', 'chn.1', 'nor.1', 'swe.1', 'kor.1', 'col.1', 'chi.1', 'per.1', 'uru.1', 'irl.1', 'fin.1']);

const TTL_CURRENT = 3 * 60 * 60 * 1000;
const TTL_PAST = 14 * 24 * 60 * 60 * 1000;

function seasonStartFor(slug, date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getUTCFullYear();
  if (CALENDAR.has(slug)) return y;
  return d.getUTCMonth() >= 6 ? y : y - 1;
}
function seasonLabel(slug, start) {
  return CALENDAR.has(slug) ? String(start) : `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}
function seasonRange(slug, start) {
  return CALENDAR.has(slug)
    ? { from: `${start}-01-01`, to: `${start}-12-31` }
    : { from: `${start}-07-01`, to: `${start + 1}-06-30` };
}

async function fetchText(url, timeout = 20000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': 'sharpshooter/5.0' } });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function cachedList(key, ttl, loader) {
  const hit = espn.memGet(key);
  if (hit !== undefined) return hit;
  const disk = espn.diskGet(key, ttl);
  if (Array.isArray(disk) && disk.length) {
    espn.memSet(key, disk, Math.min(ttl, 60 * 60 * 1000));
    return disk;
  }
  return espn.cached(key + ':load', 60 * 1000, async () => {
    let list = [];
    try {
      list = (await loader()) || [];
    } catch {
      list = [];
    }
    if (list.length) {
      espn.diskSet(key, list);
      espn.memSet(key, list, Math.min(ttl, 60 * 60 * 1000));
    }
    return list; // an empty list is returned but never cached
  });
}

// ------------------------------------------------------------------ openfootball JSON
/** Parse a football.json league file into completed matches (regular-time scores only). */
function parseFootballJson(text) {
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    return [];
  }
  const rows = [];
  const list = Array.isArray(j.matches) ? j.matches : Array.isArray(j.rounds) ? j.rounds.flatMap((r) => r.matches || []) : [];
  for (const m of list) {
    const ft = m.score && Array.isArray(m.score.ft) ? m.score.ft : Array.isArray(m.score) ? m.score : null;
    if (!ft || ft.length !== 2 || !Number.isFinite(ft[0]) || !Number.isFinite(ft[1])) continue;
    if (m.score && (m.score.et || m.score.p)) continue; // extra time / penalties are not regular-time results
    const t1 = typeof m.team1 === 'string' ? m.team1 : m.team1 && m.team1.name;
    const t2 = typeof m.team2 === 'string' ? m.team2 : m.team2 && m.team2.name;
    if (!t1 || !t2 || !m.date) continue;
    rows.push({ date: String(m.date).slice(0, 10), home: t1, away: t2, hg: ft[0], ag: ft[1], src: 'openfootball' });
  }
  return rows;
}

async function openfootball(slug, start) {
  const code = OF_JSON[slug];
  if (!code) {
    // older text files (lib/history.js) cover a few leagues the JSON mirror may lag on
    if (!H.covers(slug)) return [];
    const ms = await H.loadSeason(slug, start);
    return ms.map((m) => ({ date: m.date, home: m.home, away: m.away, hg: m.hg, ag: m.ag, src: 'openfootball' }));
  }
  const isCurrent = start === seasonStartFor(slug, new Date());
  return cachedList(`res:of:v5:${slug}:${start}`, isCurrent ? TTL_CURRENT : TTL_PAST, async () => {
    const text = await fetchText(`${RAW}/${seasonLabel(slug, start)}/${code}.json`);
    return text ? parseFootballJson(text) : [];
  });
}

// ------------------------------------------------------------------ football-data.co.uk
// football-data's "extra leagues" ship every season in ONE file; fetch it once, not once per season.
const fdAllSeasons = new Map(); // code -> { at, promise }
function fdLoad(code, start) {
  if (FD.MAIN[code]) return FD.loadLeague(code, [start]);
  const hit = fdAllSeasons.get(code);
  if (hit && Date.now() - hit.at < TTL_CURRENT) return hit.promise;
  const promise = FD.loadLeague(code, []).catch((e) => {
    fdAllSeasons.delete(code);
    throw e;
  });
  fdAllSeasons.set(code, { at: Date.now(), promise });
  return promise;
}

async function footballData(slug, start) {
  const code = FD_CODE[slug];
  if (!code) return [];
  const isCurrent = start === seasonStartFor(slug, new Date());
  return cachedList(`res:fd:v5:${slug}:${start}`, isCurrent ? TTL_CURRENT : TTL_PAST, async () => {
    const all = await fdLoad(code, start);
    const r = seasonRange(slug, start);
    return all
      .filter((m) => m.date >= r.from && m.date <= r.to)
      .map((m) => ({ date: m.date, home: m.home, away: m.away, hg: m.hg, ag: m.ag, src: 'football-data', odds: m.odds }));
  });
}

// ------------------------------------------------------------------ ESPN date ranges
function ymdCompact(iso) {
  return iso.replace(/-/g, '');
}
function monthChunks(from, to) {
  const out = [];
  let cur = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (cur <= end) {
    const a = cur.toISOString().slice(0, 10);
    const next = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 1));
    const lastDay = new Date(next.getTime() - 86400000);
    const b = (lastDay < end ? lastDay : end).toISOString().slice(0, 10);
    out.push([a, b]);
    cur = next;
  }
  return out;
}

/** Parse ESPN events (scoreboard shape) into completed matches. Score may be a string or an object. */
function parseEspnEvents(events) {
  const rows = [];
  for (const ev of events || []) {
    const comp = (ev.competitions || [])[0];
    if (!comp) continue;
    const st = (comp.status && comp.status.type) || (ev.status && ev.status.type) || {};
    if (!st.completed && st.state !== 'post') continue;
    const desc = String(st.description || st.detail || st.shortDetail || '');
    if (/pen|aet|extra|abandon|postpon|cancel/i.test(desc) && !/full time/i.test(desc)) continue;
    const h = (comp.competitors || []).find((c) => c.homeAway === 'home');
    const a = (comp.competitors || []).find((c) => c.homeAway === 'away');
    if (!h || !a) continue;
    const sc = (x) => {
      const s = x.score;
      const v = s && typeof s === 'object' ? (s.value != null ? s.value : s.displayValue) : s;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const hg = sc(h);
    const ag = sc(a);
    if (hg == null || ag == null) continue;
    rows.push({
      date: String(ev.date).slice(0, 10),
      home: (h.team && h.team.displayName) || '',
      away: (a.team && a.team.displayName) || '',
      homeId: h.team ? String(h.team.id) : null,
      awayId: a.team ? String(a.team.id) : null,
      hg,
      ag,
      src: 'espn',
      id: ev.id,
    });
  }
  return rows;
}

async function espnRange(slug, start, asOf) {
  const r = seasonRange(slug, start);
  const to = asOf && asOf < r.to ? asOf : r.to;
  if (to < r.from) return [];
  const today = new Date().toISOString().slice(0, 10);
  const chunks = monthChunks(r.from, to);
  const parts = await Promise.all(chunks.map(([a, b]) => {
    const closed = b < today.slice(0, 8) + '01';
    return cachedList(`res:espn:v5:${slug}:${a}:${b}`, closed ? TTL_PAST : TTL_CURRENT, async () => {
      const url = `${espn.SITE}/${slug}/scoreboard?dates=${ymdCompact(a)}-${ymdCompact(b)}&limit=1000`;
      const j = await espn.fetchJSON(url, { timeout: 20000, retries: 1 }).catch(() => null);
      return j ? parseEspnEvents(j.events) : [];
    });
  }));
  const seen = new Set();
  const out = [];
  for (const m of parts.flat()) {
    const k = m.id || `${m.date}|${m.home}|${m.away}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  return out;
}

// ------------------------------------------------------------------ verification
function teamsOf(ms) {
  const s = new Set();
  for (const m of ms) {
    s.add(m.home);
    s.add(m.away);
  }
  return [...s];
}

/**
 * Cross-check `primary` against each list in `others`.
 * @returns {{matches:Array, stats:object}}
 */
function crossCheck(primary, others) {
  const checks = others.filter((o) => o.matches.length).map((o) => {
    const mapping = N.learnMapping(primary, o.matches);
    const names = teamsOf(o.matches);
    const idx = new Map();
    for (const m of o.matches) {
      const k = `${m.home}|${m.away}`;
      if (!idx.has(k)) idx.set(k, []);
      idx.get(k).push(m);
    }
    return { src: o.src, mapping, names, idx };
  });
  const stats = { checked: primary.length, verified: 0, disputed: 0, single: 0, sources: checks.map((c) => c.src), mapped: {} };
  for (const c of checks) stats.mapped[c.src] = c.mapping.size;

  const out = [];
  for (const m of primary) {
    let agree = 0;
    let disagree = 0;
    const alt = [];
    for (const c of checks) {
      const h = N.resolve(m.home, c.mapping, c.names);
      const a = N.resolve(m.away, c.mapping, c.names);
      if (!h || !a) continue;
      const cands = (c.idx.get(`${h}|${a}`) || []).filter((x) => Math.abs(Date.parse(x.date) - Date.parse(m.date)) <= 2 * 86400000);
      if (!cands.length) continue;
      const x = cands[0];
      if (x.hg === m.hg && x.ag === m.ag) agree++;
      else {
        disagree++;
        alt.push({ src: c.src, hg: x.hg, ag: x.ag });
      }
    }
    let row = m;
    let status;
    if (agree && !disagree) status = 'verified';
    else if (!agree && !disagree) status = 'single';
    // the primary itself is one vote: primary + one agreeing source beats one dissenter
    else if (agree >= 1 && 1 + agree > disagree) status = 'verified-majority';
    else if (disagree >= 2 && alt.length >= 2 && alt[0].hg === alt[1].hg && alt[0].ag === alt[1].ag) {
      // two independent sources agree against the primary: take theirs
      row = { ...m, hg: alt[0].hg, ag: alt[0].ag };
      status = 'corrected';
    } else status = 'disputed';
    if (status === 'verified' || status === 'verified-majority' || status === 'corrected') stats.verified++;
    else if (status === 'single') stats.single++;
    else stats.disputed++;
    if (status !== 'disputed') out.push({ ...row, check: status });
  }
  stats.verifiedShare = primary.length ? stats.verified / primary.length : 0;
  // primary-name -> other-source-name, per source (used to put older seasons into one spelling)
  const mappings = Object.fromEntries(checks.map((c) => [c.src, c.mapping]));
  return { matches: out, stats, mappings };
}

/**
 * Verified results for a league: current season and `back` previous seasons,
 * everything strictly before `asOf`.
 *
 * @returns {Promise<{matches:Array, provenance:object}>}
 */
async function leagueResults(slug, asOf, opts = {}) {
  const back = opts.back != null ? opts.back : 2;
  const asOfISO = String(asOf instanceof Date ? asOf.toISOString() : asOf || new Date().toISOString()).slice(0, 10);
  const cur = seasonStartFor(slug, asOfISO);
  // Current season FIRST: its primary source defines the one spelling every season is
  // translated into (ESPN's, when ESPN has the season — the fixture's own names).
  const seasons = [];
  for (let s = cur; s >= cur - back; s--) seasons.push(s);

  const all = [];
  const prov = { slug, seasons: [], sources: new Set() };
  let canon = null; // { src, names:Set, toCanon: { [src]: Map(srcName -> canonName) } }
  for (const s of seasons) {
    const isCur = s === cur;
    const [es, of, fd] = await Promise.all([
      // ESPN ranges are spent on the current season only; older seasons come from static files
      isCur || !(OF_JSON[slug] || FD_CODE[slug] || H.covers(slug)) ? espnRange(slug, s, asOfISO) : Promise.resolve([]),
      openfootball(slug, s),
      opts.skipFootballData ? Promise.resolve([]) : footballData(slug, s),
    ]);
    const lists = [
      { src: 'espn', matches: es },
      { src: 'openfootball', matches: of },
      { src: 'football-data', matches: fd },
    ].map((l) => ({ ...l, matches: l.matches.filter((m) => m.date < asOfISO) }));
    // Primary: ESPN if it has a real share of the season, else the fullest source.
    const espnOk = lists[0].matches.length >= 0.6 * Math.max(lists[1].matches.length, lists[2].matches.length, 1);
    const primary = espnOk && lists[0].matches.length ? lists[0] : [...lists].sort((a, b) => b.matches.length - a.matches.length)[0];
    if (!primary.matches.length) {
      prov.seasons.push({ season: s, primary: null, n: 0 });
      continue;
    }
    const others = lists.filter((l) => l !== primary);
    const { matches, stats, mappings } = crossCheck(primary.matches, others);

    if (!canon) {
      // invert primary->other mappings: other-source spelling -> canonical spelling
      canon = { src: primary.src, names: new Set(teamsOf(primary.matches)), toCanon: {} };
      for (const [src, m] of Object.entries(mappings)) {
        const inv = new Map();
        for (const [a, b] of m) inv.set(b, a);
        canon.toCanon[src] = inv;
      }
    }
    let rename = (n) => n;
    if (primary.src !== canon.src) {
      const inv = canon.toCanon[primary.src] || new Map();
      const canonNames = [...canon.names];
      const memo = new Map();
      rename = (n) => {
        if (memo.has(n)) return memo.get(n);
        // learned mapping first; then a conservative string match against current-season names;
        // a club not in the current season (relegated) keeps its own spelling
        const r = inv.get(n) || N.matchName(n, canonNames) || n;
        memo.set(n, r);
        return r;
      };
    }
    for (const m of matches) all.push({ ...m, home: rename(m.home), away: rename(m.away), season: s, primarySrc: primary.src });
    prov.seasons.push({ season: s, primary: primary.src, n: matches.length, ...stats });
    for (const l of lists) if (l.matches.length) prov.sources.add(l.src);
  }
  all.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  prov.seasons.sort((a, b) => a.season - b.season);
  const n = all.length;
  const verified = all.filter((m) => m.check !== 'single').length;
  return {
    matches: all,
    provenance: {
      slug,
      n,
      verified,
      verifiedShare: n ? verified / n : 0,
      sources: [...prov.sources],
      canonicalSource: canon ? canon.src : null,
      seasons: prov.seasons,
    },
  };
}

module.exports = {
  OF_JSON, FD_CODE, CALENDAR,
  seasonStartFor, seasonLabel, seasonRange,
  parseFootballJson, parseEspnEvents, monthChunks,
  openfootball, footballData, espnRange,
  crossCheck, leagueResults,
  _league: L,
};
