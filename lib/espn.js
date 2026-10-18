'use strict';

/**
 * ESPN data layer.
 *
 * Four free, key-less endpoints are used:
 *   1. site  /scoreboard   -> fixtures, live state, form string, embedded book odds (open + close)
 *   2. site  /summary      -> H2H series, last-5 games, standings, news, multi-book odds, venue
 *   3. core  /statistics   -> REAL xG / xGA, shots, cards, clean sheets  (the model's engine fuel)
 *   4. core  /teams        -> league team list, used to build league baselines
 *
 * Everything is cached in-process (TTL) and optionally on disk (long TTL) so the
 * app stays fast and stays inside polite request budgets.
 */

const fs = require('fs');
const path = require('path');

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
const CORE = 'https://sports.core.api.espn.com/v2/sports/soccer/leagues';

const DATA_DIR = process.env.SHARPSHOOTER_DATA_DIR
  ? path.resolve(process.env.SHARPSHOOTER_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const DISK_TTL_MS = 12 * 60 * 60 * 1000; // 12h for slow-moving data (team stats, baselines)

// ---------------------------------------------------------------- caches

const mem = new Map(); // key -> { at, ttl, value }
const inflight = new Map(); // key -> Promise  (request coalescing / stampede guard)

function memGet(key) {
  const hit = mem.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > hit.ttl) {
    mem.delete(key);
    return undefined;
  }
  return hit.value;
}

function memSet(key, value, ttl) {
  mem.set(key, { at: Date.now(), ttl, value });
  return value;
}

function diskPath(key) {
  const safe = key.replace(/[^a-z0-9._-]+/gi, '_').slice(0, 120);
  return path.join(DATA_DIR, safe + '.json');
}

function diskGet(key, ttl = DISK_TTL_MS) {
  try {
    const p = diskPath(key);
    if (!fs.existsSync(p)) return undefined;
    const st = fs.statSync(p);
    if (Date.now() - st.mtimeMs > ttl) return undefined;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return undefined;
  }
}

function diskSet(key, value) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(diskPath(key), JSON.stringify(value));
  } catch {
    /* disk cache is best-effort */
  }
}

// ---------------------------------------------------------------- fetch

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

/**
 * Global concurrency limiter. The engine fans out aggressively (league
 * baselines alone can touch hundreds of endpoints), so we cap in-flight
 * requests to stay polite and avoid socket exhaustion.
 */
const MAX_INFLIGHT = 12;
let inflightCount = 0;
const waiters = [];

/** Diagnostics: how many real network calls have we made? */
const netStats = { requests: 0, errors: 0, retries: 0, byHost: {} };

function resetNetStats() {
  netStats.requests = 0;
  netStats.errors = 0;
  netStats.retries = 0;
  netStats.byHost = {};
}

function acquire() {
  if (inflightCount < MAX_INFLIGHT) {
    inflightCount++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(resolve));
}

function release() {
  const next = waiters.shift();
  if (next) next();
  else inflightCount--;
}

async function fetchJSON(url, { timeout = 15000, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await acquire();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      netStats.requests++;
      try {
        const host = new URL(url).host;
        netStats.byHost[host] = (netStats.byHost[host] || 0) + 1;
      } catch { /* ignore */ }
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': UA, Accept: 'application/json' },
      });
      clearTimeout(timer);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      if (!text) return null;
      return JSON.parse(text);
    } catch (err) {
      clearTimeout(timer);
      netStats.errors++;
      lastErr = err;
      if (attempt < retries) {
        netStats.retries++;
        await sleep(250 * (attempt + 1));
      }
    } finally {
      release();
    }
  }
  throw lastErr;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Cached + coalesced fetch. */
async function cached(key, ttl, loader) {
  const hit = memGet(key);
  if (hit !== undefined) return hit;

  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    try {
      const value = await loader();
      memSet(key, value, ttl);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}

// ---------------------------------------------------------------- endpoints

const TTL = {
  scoreboard: 60 * 1000,
  summary: 4 * 60 * 1000,
  teamStats: 6 * 60 * 60 * 1000,
  teamList: 24 * 60 * 60 * 1000,
  news: 10 * 60 * 1000,
};

/** YYYYMMDD from a Date (UTC-based, matching ESPN's `dates` param). */
function ymd(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}

/**
 * Raw scoreboard payload for one league on one day.
 * Always resolves to an object (never throws) so a single dead league
 * can never break the daily board.
 *
 * The season year lives in different places depending on the competition
 * (league vs cup), so we probe every location ESPN uses.
 */
async function scoreboardRaw(slug, yyyymmdd) {
  return cached(`sb:${slug}:${yyyymmdd}`, TTL.scoreboard, async () => {
    try {
      const j = await fetchJSON(`${SITE}/${slug}/scoreboard?dates=${yyyymmdd}`);
      if (!j) return { events: [], season: null, seasonType: null };
      const events = j.events || [];
      const year =
        (j.season && j.season.year) ||
        (j.leagues && j.leagues[0] && j.leagues[0].season && j.leagues[0].season.year) ||
        (events[0] && events[0].season && events[0].season.year) ||
        new Date().getUTCFullYear();
      const seasonType =
        (events[0] && events[0].season && events[0].season.type) ||
        (j.leagues && j.leagues[0] && j.leagues[0].season && j.leagues[0].season.type && j.leagues[0].season.type.id) ||
        1;
      return { events, season: year, seasonType };
    } catch {
      return { events: [], season: null, seasonType: null };
    }
  });
}

/** Fixtures for one league on one day. */
async function scoreboard(slug, yyyymmdd) {
  const raw = await scoreboardRaw(slug, yyyymmdd);
  return raw.events || [];
}

/** Full match summary (H2H, form, standings, news, odds). */
async function summary(slug, eventId) {
  return cached(`sum:${slug}:${eventId}`, TTL.summary, async () => {
    try {
      return await fetchJSON(`${SITE}/${slug}/summary?event=${eventId}`);
    } catch {
      return null;
    }
  });
}

/** Season type used by the core API. Regular season = 1. */
async function seasonYear(slug, fallbackYear) {
  // The scoreboard already carries season.year; callers pass it in.
  return fallbackYear;
}

/** Team list for a league/season (ids only, used to build baselines). */
async function teamList(slug, year) {
  return cached(`tl:${slug}:${year}`, TTL.teamList, async () => {
    try {
      const j = await fetchJSON(`${CORE}/${slug}/seasons/${year}/teams?limit=100`);
      if (!j || !j.items) return [];
      return j.items
        .map((it) => {
          const m = /\/(\d+)\?/.exec(it.$ref || '');
          return m ? m[1] : null;
        })
        .filter(Boolean);
    } catch {
      return [];
    }
  });
}

/** Full season statistics for one team, flattened into a plain object. */
async function teamStats(slug, year, teamId) {
  return cached(`ts:${slug}:${year}:${teamId}`, TTL.teamStats, async () => {
    const diskKey = `teamstats_${slug}_${year}_${teamId}`;
    const fromDisk = diskGet(diskKey);
    if (fromDisk) return fromDisk;

    try {
      const j = await fetchJSON(`${CORE}/${slug}/seasons/${year}/types/1/teams/${teamId}/statistics`);
      if (!j || !j.splits) return null;
      const flat = {};
      for (const cat of j.splits.categories || []) {
        for (const s of cat.stats || []) {
          if (typeof s.value === 'number') flat[s.name] = s.value;
          else if (s.displayValue != null) flat[s.name] = s.displayValue;
        }
      }
      diskSet(diskKey, flat);
      return flat;
    } catch {
      return null;
    }
  });
}

/** Convenience: many team stats in parallel with a concurrency cap. */
async function teamStatsMany(slug, year, teamIds, concurrency = 8) {
  const out = {};
  const queue = [...teamIds];
  async function worker() {
    while (queue.length) {
      const id = queue.shift();
      out[id] = await teamStats(slug, year, id);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, worker));
  return out;
}

/**
 * Site-level team list for a league. Unlike the core endpoint this works for
 * cup competitions too, which is what lets us map a cup team back to the
 * domestic league where its statistics actually live.
 */
async function siteTeamList(slug) {
  return cached(`stl:${slug}`, TTL.teamList, async () => {
    try {
      const j = await fetchJSON(`${SITE}/${slug}/teams`);
      if (!j || !j.sports || !j.sports[0] || !j.sports[0].leagues) return [];
      const teams = j.sports[0].leagues[0].teams || [];
      return teams
        .map((t) => t.team)
        .filter(Boolean)
        .map((t) => ({ id: String(t.id), name: t.displayName, slug: t.slug || null }));
    } catch {
      return [];
    }
  });
}

module.exports = {
  SITE,
  CORE,
  scoreboard,
  scoreboardRaw,
  summary,
  teamStats,
  teamStatsMany,
  teamList,
  siteTeamList,
  fetchJSON,
  ymd,
  addDays,
  cached,
  memGet,
  memSet,
  diskGet,
  diskSet,
  TTL,
  DATA_DIR,
  netStats,
  resetNetStats,
};
