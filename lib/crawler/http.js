'use strict';

/**
 * crawler/http.js — the polite fetcher every v6 data source goes through.
 *
 *   - robots.txt honoured for websites (football-data.co.uk); documented open APIs
 *     (ESPN, ClubElo, FPL, Open-Meteo) are called as APIs
 *   - per-host rate limits and concurrency caps, so no source is hammered
 *   - retries with back-off; Retry-After respected on 429 / 503
 *   - conditional requests (ETag / Last-Modified): an unchanged file costs a 304, not a download
 *   - disk cache with a time-to-live; on any failure the last good copy is served (marked stale)
 *     and a failure is NEVER cached
 *   - per-host circuit breaker: 5 failures in a row pause that host for 10 minutes
 *   - identical requests in flight are coalesced
 *   - per-host statistics for /api/crawler and /api/health
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UA = 'Sharpshooter/6.0 (+https://github.com/k75665622-ship-it/sharpshooter; football prediction research)';
const DATA_DIR = process.env.SHARPSHOOTER_DATA_DIR ? path.resolve(process.env.SHARPSHOOTER_DATA_DIR) : path.join(__dirname, '..', '..', 'data');
const CACHE_DIR = path.join(DATA_DIR, 'crawl');

/** Host policy. minInterval = ms between request starts; robots = check robots.txt first. */
const HOSTS = {
  'www.football-data.co.uk': { minInterval: 1000, concurrency: 1, robots: true },
  'football-data.co.uk': { minInterval: 1000, concurrency: 1, robots: true },
  'api.clubelo.com': { minInterval: 800, concurrency: 1, robots: false },
  'site.api.espn.com': { minInterval: 120, concurrency: 4, robots: false },
  'sports.core.api.espn.com': { minInterval: 120, concurrency: 4, robots: false },
  'site.web.api.espn.com': { minInterval: 120, concurrency: 4, robots: false },
  'fantasy.premierleague.com': { minInterval: 1000, concurrency: 1, robots: false },
  'api.open-meteo.com': { minInterval: 150, concurrency: 2, robots: false },
  'geocoding-api.open-meteo.com': { minInterval: 150, concurrency: 2, robots: false },
  'raw.githubusercontent.com': { minInterval: 50, concurrency: 4, robots: false },
};
const DEFAULT_HOST = { minInterval: 1500, concurrency: 1, robots: true };
const BREAKER_FAILS = 5;
const BREAKER_MS = 10 * 60 * 1000;

let fetchImpl = (...a) => fetch(...a);
/** Tests swap the network for a stub. */
function setFetch(fn) {
  fetchImpl = fn || ((...a) => fetch(...a));
}

const hostState = new Map();
function state(host) {
  if (!hostState.has(host)) {
    hostState.set(host, {
      policy: HOSTS[host] || DEFAULT_HOST,
      lastStart: 0,
      active: 0,
      queue: [],
      fails: 0,
      openUntil: 0,
      stats: { requests: 0, ok: 0, notModified: 0, cacheHits: 0, staleServed: 0, errors: 0, robotsBlocked: 0, bytes: 0, lastError: null, lastOk: null },
    });
  }
  return hostState.get(host);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait for a slot on this host (rate limit + concurrency). */
function acquire(host) {
  const s = state(host);
  return new Promise((resolve) => {
    s.queue.push(resolve);
    pump(host);
  });
}
function pump(host) {
  const s = state(host);
  if (!s.queue.length || s.active >= s.policy.concurrency) return;
  const wait = Math.max(0, s.lastStart + s.policy.minInterval - Date.now());
  if (wait > 0) {
    if (!s.timer) s.timer = setTimeout(() => { s.timer = null; pump(host); }, wait);
    return;
  }
  s.active++;
  s.lastStart = Date.now();
  const next = s.queue.shift();
  next(() => {
    s.active--;
    pump(host);
  });
  pump(host);
}

// ------------------------------------------------------------------ disk cache
function cachePath(url) {
  const h = crypto.createHash('sha1').update(url).digest('hex');
  return path.join(CACHE_DIR, h.slice(0, 2), h + '.json');
}
function readCache(url) {
  try {
    return JSON.parse(fs.readFileSync(cachePath(url), 'utf8'));
  } catch {
    return null;
  }
}
function writeCache(url, entry) {
  try {
    const p = cachePath(url);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = p + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(entry));
    fs.renameSync(tmp, p);
  } catch {
    /* a read-only or full disk only costs us the cache */
  }
}

// ------------------------------------------------------------------ robots.txt
const robotsCache = new Map(); // origin -> { at, rules }
/** Parse robots.txt into allow/disallow rules for our agent (or *). */
function parseRobots(text) {
  const groups = [];
  let cur = null;
  let lastWasAgent = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const k = m[1].toLowerCase();
    const v = m[2].trim();
    if (k === 'user-agent') {
      if (!lastWasAgent || !cur) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(v.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (!cur) continue;
      if (k === 'allow' || k === 'disallow') cur.rules.push({ allow: k === 'allow', path: v });
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== '*' && 'sharpshooter'.includes(a.replace(/\/.*$/, ''))));
  const pick = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  return pick.flatMap((g) => g.rules);
}
/** Longest matching rule wins; an empty Disallow allows everything. Supports * and $. */
function robotsAllows(rules, pathname) {
  let best = null;
  for (const r of rules) {
    if (!r.path) {
      if (!r.allow) continue; // "Disallow:" (empty) means allow all
    }
    const re = new RegExp('^' + r.path.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(pathname) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}
async function allowedByRobots(u) {
  const origin = u.origin;
  const hit = robotsCache.get(origin);
  let rules;
  if (hit && Date.now() - hit.at < 24 * 3600 * 1000) rules = hit.rules;
  else {
    rules = [];
    try {
      const res = await fetchImpl(origin + '/robots.txt', { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(10000) });
      if (res.ok) rules = parseRobots(await res.text());
      // 4xx: no robots file -> everything allowed; 5xx/network: allow, but re-check sooner
    } catch {
      /* unreachable robots.txt: allowed, re-checked next time */
    }
    robotsCache.set(origin, { at: Date.now(), rules });
  }
  return robotsAllows(rules, u.pathname + u.search);
}

// ------------------------------------------------------------------ get
const inflight = new Map();

/**
 * @param {string} url
 * @param {object} [o]
 * @param {'text'|'json'} [o.type='text']
 * @param {number} [o.ttl=3600000]   serve from cache while younger than this
 * @param {number} [o.timeout=20000]
 * @param {number} [o.maxBytes=20e6]
 * @param {boolean} [o.force]       ignore the cache age (still conditional)
 * @returns {Promise<{ok:boolean, body:any, status:number, fromCache:boolean, stale:boolean, fetchedAt:number|null, error?:string}>}
 */
function get(url, o = {}) {
  const key = url + '|' + (o.type || 'text');
  if (inflight.has(key)) return inflight.get(key);
  const p = doGet(url, o).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function doGet(url, o) {
  const type = o.type || 'text';
  const ttl = o.ttl != null ? o.ttl : 3600 * 1000;
  const u = new URL(url);
  const s = state(u.host);
  const cached = readCache(url);
  const fresh = cached && !o.force && Date.now() - cached.fetchedAt < ttl;
  const finish = (entry, extra) => ({
    ok: true,
    body: type === 'json' ? safeJson(entry.body) : entry.body,
    status: entry.status || 200,
    fromCache: true,
    stale: false,
    fetchedAt: entry.fetchedAt,
    ...extra,
  });
  if (fresh) {
    s.stats.cacheHits++;
    return finish(cached);
  }
  const fail = (error) => {
    s.stats.errors++;
    s.stats.lastError = { at: new Date().toISOString(), url, error };
    if (cached) {
      s.stats.staleServed++;
      return finish(cached, { stale: true, error });
    }
    return { ok: false, body: null, status: 0, fromCache: false, stale: false, fetchedAt: null, error };
  };
  if (Date.now() < s.openUntil) return fail('host paused after repeated failures (circuit breaker)');
  if ((s.policy.robots || o.robots) && o.robots !== false) {
    const ok = await allowedByRobots(u);
    if (!ok) {
      s.stats.robotsBlocked++;
      return fail('disallowed by robots.txt');
    }
  }

  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const release = await acquire(u.host);
    let res;
    try {
      s.stats.requests++;
      const headers = { 'user-agent': UA, accept: type === 'json' ? 'application/json' : '*/*' };
      if (cached && cached.etag) headers['if-none-match'] = cached.etag;
      if (cached && cached.lastModified) headers['if-modified-since'] = cached.lastModified;
      res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(o.timeout || 20000), redirect: 'follow' });
      if (res.status === 304 && cached) {
        release();
        s.stats.notModified++;
        s.fails = 0;
        const entry = { ...cached, fetchedAt: Date.now() };
        writeCache(url, entry);
        return finish(entry, { fromCache: false, notModified: true });
      }
      if (res.ok) {
        const text = await res.text();
        release();
        if (text.length > (o.maxBytes || 20e6)) return fail('response too large');
        if (type === 'json' && safeJson(text) === undefined) {
          lastErr = 'invalid JSON';
          s.fails++;
          continue;
        }
        const entry = {
          url,
          status: res.status,
          fetchedAt: Date.now(),
          etag: res.headers.get('etag') || null,
          lastModified: res.headers.get('last-modified') || null,
          body: text,
        };
        writeCache(url, entry);
        s.stats.ok++;
        s.stats.bytes += text.length;
        s.stats.lastOk = new Date().toISOString();
        s.fails = 0;
        return { ok: true, body: type === 'json' ? safeJson(text) : text, status: res.status, fromCache: false, stale: false, fetchedAt: entry.fetchedAt };
      }
      release();
      lastErr = `HTTP ${res.status}`;
      if (res.status === 404 || res.status === 410 || res.status === 403 || res.status === 401) {
        // not retryable; a missing season file is normal and must not trip the breaker
        return fail(lastErr);
      }
      if (res.status === 429 || res.status === 503) {
        const ra = retryAfterMs(res.headers.get('retry-after'));
        await sleep(Math.min(ra != null ? ra : 2000 * (attempt + 1), 30000));
      } else await sleep(500 * Math.pow(3, attempt));
    } catch (err) {
      release();
      lastErr = String((err && err.message) || err);
      await sleep(400 * Math.pow(3, attempt));
    }
  }
  s.fails++;
  if (s.fails >= BREAKER_FAILS) {
    s.openUntil = Date.now() + BREAKER_MS;
    s.fails = 0;
  }
  return fail(lastErr || 'request failed');
}

function retryAfterMs(v) {
  if (!v) return null;
  const n = Number(v);
  if (Number.isFinite(n)) return n * 1000;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - Date.now()) : null;
}

function safeJson(t) {
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

function stats() {
  const out = {};
  for (const [h, s] of hostState) {
    out[h] = { ...s.stats, queued: s.queue.length, active: s.active, paused: Date.now() < s.openUntil, policy: s.policy };
  }
  return out;
}

function _reset() {
  hostState.clear();
  robotsCache.clear();
  inflight.clear();
}

module.exports = { get, stats, setFetch, parseRobots, robotsAllows, retryAfterMs, HOSTS, UA, CACHE_DIR, _reset, cachePath };
