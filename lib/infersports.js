'use strict';

/**
 * infersports.js — secondary odds source (Asian books + Pinnacle).
 *
 * Why this exists:
 *   ESPN publishes exactly ONE bookmaker (DraftKings) and exactly THREE market
 *   types — moneyline, one total line, one spread line. That means most of the
 *   ~63 markets the model derives can never be price-verified, so they are
 *   barred from banker election. The result was a banker that always landed on
 *   the same two or three market types.
 *
 *   InferSports (https://api.infersports.dev) is keyless on its free tier and
 *   publishes decimal odds from ~6 Asian books plus Pinnacle across
 *   1x2 / asian_handicap / totals, at MULTIPLE lines, full-time AND half-time.
 *   Asian books are the sharpest soccer prices available, so this both widens
 *   market coverage and improves trap detection via cross-book dispersion.
 *
 * Design rules — this service is third-party and has no SLA:
 *   1. NOTHING here throws. Every export returns null / empty on any failure.
 *   2. ESPN stays the backbone. If InferSports is down, rate-limited, or does
 *      not cover a fixture, the engine behaves exactly as it did before.
 *   3. Aggressive caching (events 15m, odds 5m) to stay well inside the free
 *      tier, plus backoff on 429/5xx.
 *
 * Attribution is done LOCALLY by fuzzy team-pair matching against the day's
 * event list — no extra resolve round-trips.
 */

const fs = require('fs');
const path = require('path');

const BASE = 'https://api.infersports.dev';
const TIMEOUT_MS = 9000;

/**
 * Cache TTLs. Overridable so a deployment can trade freshness for coverage —
 * the daily budget is the hard constraint, not the model.
 *
 * These exist to protect a 200-request-per-DAY free quota, not just to save
 * latency. A full board is ~115 fixtures but only ~60 of them are ratable (see
 * the guard in analysis.js), so a cold board costs ~60 odds calls + a handful
 * of events calls.
 *
 * Note on why the full board is unavoidable: a pre-screen on ESPN-only scores
 * was measured and rejected. It would have skipped 5 of 9 real bankers —
 * including the Banker of the Day — because the ESPN-only ranking is dominated
 * by fixtures whose high score comes from *unverified synthetic* prices, which
 * can never be elected anyway. There is no cheap safe subset.
 *
 * Asian prices are a secondary verification source — the price actually used
 * for value detection is ESPN's DraftKings close, refreshed independently — so
 * the window costs little in accuracy.
 */
const TTL = {
  events: Number(process.env.IS_TTL_EVENTS || 30 * 60 * 1000),
  odds: Number(process.env.IS_TTL_ODDS || 15 * 60 * 1000),
};

const mem = new Map();     // key -> { at, value }
const inflight = new Map(); // key -> Promise

/**
 * Disk mirror of the cache.
 *
 * The quota is daily, so an in-memory-only cache means every server restart
 * re-spends the whole board (~60 calls) against a budget that cannot refresh
 * until the next day. Persisting means a restart inside the TTL window is free.
 * Writes are fire-and-forget: a cache failure must never break a request.
 */
const PERSIST = process.env.IS_PERSIST !== '0';
const DATA_DIR = process.env.IS_CACHE_DIR || path.join(__dirname, '..', 'data', 'infersports');

let dirReady = false;
function ensureDir() {
  if (dirReady) return true;
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); dirReady = true; return true; }
  catch { return false; }
}

function fileFor(key) {
  return path.join(DATA_DIR, key.replace(/[^a-z0-9_.-]/gi, '_').slice(0, 140) + '.json');
}

/** Returns { at, value } or undefined. Preserves the original timestamp so a
 *  disk hit does not silently restart the TTL clock. */
function diskGet(key, ttl) {
  if (!PERSIST) return undefined;
  try {
    const rec = JSON.parse(fs.readFileSync(fileFor(key), 'utf8'));
    if (!rec || typeof rec.at !== 'number') return undefined;
    if (Date.now() - rec.at >= ttl) return undefined;
    return rec;
  } catch { return undefined; }
}

function diskSet(key, at, value) {
  if (!PERSIST || value === null || value === undefined) return;
  if (!ensureDir()) return;
  try { fs.writeFile(fileFor(key), JSON.stringify({ at, value }), () => {}); }
  catch { /* never surface a cache write failure */ }
}

function diskClear() {
  if (!PERSIST) return;
  try {
    for (const f of fs.readdirSync(DATA_DIR)) {
      if (f.endsWith('.json')) fs.unlinkSync(path.join(DATA_DIR, f));
    }
  } catch { /* nothing to clear */ }
}

function cacheGet(key, ttl) {
  const hit = mem.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;

  const fromDisk = diskGet(key, ttl);
  if (fromDisk) {
    mem.set(key, fromDisk); // keep the ORIGINAL timestamp
    return fromDisk.value;
  }
  return undefined;
}

function cacheSet(key, value) {
  const at = Date.now();
  mem.set(key, { at, value });
  diskSet(key, at, value);
  // Keep the map from growing without bound on a long-running server.
  if (mem.size > 400) {
    const oldest = [...mem.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 100);
    for (const [k] of oldest) mem.delete(k);
  }
}

/** Diagnostics. */
const stats = {
  requests: 0,
  errors: 0,
  rateLimited: 0,
  skipped: 0,
  events: 0,
  odds: 0,
  matched: 0,
  lastError: null,
};
function netStats() { return { ...stats, quota: quotaSnapshot() }; }

/**
 * Daily-quota state machine.
 *
 * The free tier is 200 requests per *day* (`X-Ratelimit-Scope: daily`), which is
 * a completely different animal from a per-second burst limit. Retrying with a
 * 600ms backoff against a 23-hour window is not just useless, it is actively
 * harmful: it burns the remaining budget on requests that cannot succeed.
 *
 * So we read the headers, and when the window is closed we stop calling
 * altogether until `Retry-After` elapses. Callers get `null`, which every export
 * already treats as "source unavailable" — ESPN pricing carries the slate alone.
 */
const quota = {
  limit: null,
  remaining: null,
  scope: null,
  resetAt: 0,        // epoch ms the window rolls over
  blockedUntil: 0,   // epoch ms we refuse to call before
  exhausted: false,
  reserve: Number(process.env.IS_RESERVE || 4),
};

function quotaSnapshot() {
  const now = Date.now();
  return {
    limit: quota.limit,
    remaining: quota.remaining,
    scope: quota.scope,
    exhausted: quota.exhausted,
    open: now >= quota.blockedUntil,
    resumesInSec: quota.blockedUntil > now ? Math.ceil((quota.blockedUntil - now) / 1000) : 0,
    reserve: quota.reserve,
  };
}

/**
 * Rate-limit reset headers come in two dialects and confusing them is
 * catastrophic in both directions:
 *
 *   - a DELTA in seconds — RFC 9239 style. This API's daily quota sent
 *     `Ratelimit-Reset: 85020` (≈23.6 h).
 *   - an ABSOLUTE Unix epoch. The same API's windowed limiter sends
 *     `X-Ratelimit-Reset: 1789721612`.
 *
 * Read a delta as an epoch and you block for ~57 years; read an epoch as a
 * delta and you add ~57 years to now. Detect by magnitude — anything above
 * 1e9 is an epoch (i.e. after 2001-09), anything below is a delta.
 *
 * `nowSec` is injectable so this stays a pure function under test.
 */
function resetSeconds(value, nowSec) {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  if (value > 1e9) {
    const now = nowSec == null ? Math.floor(Date.now() / 1000) : nowSec;
    const delta = value - now;
    return delta > 0 ? delta : 0;
  }
  return value;
}

/** Fold the rate-limit headers into our state.
 *
 *  Two traps live here:
 *
 *  1. `Headers.get` is case-insensitive but NOT prefix-insensitive. This API has
 *     used both `Ratelimit-Limit` and `X-Ratelimit-Limit` — different header
 *     names, so both spellings must be read.
 *  2. `Number(null)` is 0, and `Number.isFinite(0)` is true. A missing header
 *     naively parsed becomes a hard 0, and `remaining = 0` trips the reserve
 *     guard in `budgetOpen()` — silently disabling the source entirely. Missing
 *     must mean `null`, never 0.
 */
function noteQuotaHeaders(res) {
  const num = (h) => {
    const raw = res.headers.get(h);
    if (raw == null || raw === '') return null;
    const v = Number(raw);
    return Number.isFinite(v) ? v : null;
  };
  const pick = (...names) => {
    for (const n of names) { const v = num(n); if (v != null) return v; }
    return null;
  };

  const limit = pick('ratelimit-limit', 'x-ratelimit-limit');
  const remaining = pick('ratelimit-remaining', 'x-ratelimit-remaining');
  const scope = res.headers.get('x-ratelimit-scope') || res.headers.get('ratelimit-scope');
  const reset = pick('ratelimit-reset', 'x-ratelimit-reset');
  const retryAfter = pick('retry-after', 'x-retry-after');

  if (limit != null) quota.limit = limit;
  if (remaining != null) quota.remaining = remaining;
  if (scope) quota.scope = scope;

  // `Retry-After` is always a delta; the reset header needs dialect detection.
  const wait = retryAfter != null && retryAfter > 0 ? retryAfter : resetSeconds(reset);
  if (wait != null) quota.resetAt = Date.now() + wait * 1000;
}

/** True when we are allowed to spend a request right now. */
function budgetOpen() {
  if (Date.now() < quota.blockedUntil) return false;
  // The reserve exists to protect an UNRECOVERABLE budget: with a daily quota,
  // spending the last calls on low-value fixtures means going dark until
  // tomorrow. A rolling window refills within seconds, so holding calls back
  // there just starves the board for no benefit.
  const reserve = quota.scope === 'daily' ? quota.reserve : 0;
  if (quota.remaining != null && quota.remaining <= reserve) return false;
  return true;
}

/** Never block for longer than a day, whatever a malformed header claims. */
const MAX_BLOCK_MS = 24 * 60 * 60 * 1000;

/** Close the window and log why. */
function closeWindow(reason) {
  const waitMs = quota.resetAt > Date.now() ? quota.resetAt - Date.now() : 60 * 1000;
  quota.blockedUntil = Date.now() + Math.min(waitMs, MAX_BLOCK_MS);
  quota.exhausted = true;
  quota.remaining = 0;
  stats.lastError = reason;
}

async function fetchJSON(path, attempt = 0) {
  if (!budgetOpen()) {
    stats.skipped += 1;
    return null; // never throw — callers treat null as "source unavailable"
  }

  const url = BASE + path;
  stats.requests += 1;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'user-agent': 'sharpshooter/1.0' },
    });
    noteQuotaHeaders(res);

    if (res.status === 429) {
      stats.rateLimited += 1;
      const waitMs = quota.resetAt > Date.now() ? quota.resetAt - Date.now() : null;

      // A long window (a daily quota) will not reopen in the next second, so
      // retrying merely burns budget on a request that cannot succeed. Close it.
      if (quota.scope === 'daily' || (waitMs != null && waitMs > 60000)) {
        closeWindow('quota exhausted');
        return null;
      }

      // A short window: wait it out rather than hammering, then retry once.
      if (attempt < 2) {
        clearTimeout(timer);
        const backoff = waitMs != null
          ? Math.min(waitMs + 250, 15000)
          : 600 * Math.pow(2, attempt);
        await sleep(backoff);
        return fetchJSON(path, attempt + 1);
      }
      throw new Error('rate limited');
    }
    if (res.status >= 500 && attempt < 2) {
      clearTimeout(timer);
      await sleep(500 * Math.pow(2, attempt));
      return fetchJSON(path, attempt + 1);
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);

    // A successful call means the window is open again.
    quota.exhausted = false;
    return await res.json();
  } catch (err) {
    stats.errors += 1;
    stats.lastError = String(err && err.message ? err.message : err);
    return null; // never throw — callers treat null as "source unavailable"
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/* ------------------------------------------------------------ name matching */

/** Club noise that carries no identifying information. */
const NOISE = new Set([
  'fc', 'afc', 'cf', 'sc', 'ac', 'as', 'ss', 'sv', 'vfb', 'vfl', 'tsg', 'rb',
  'fk', 'sk', 'nk', 'hnk', 'if', 'bk', 'ik', 'ff', 'ca', 'cd', 'ud', 'rc',
  'rcd', 'sd', 'cs', 'us', 'sp', 'se', 'ec', 'cr', 'csd', 'kf', 'cfr', 'aik',
  'real', 'atletico', 'atlético', 'athletic', 'deportivo', 'sporting', 'club',
  'city', 'town', 'united', 'utd', 'rovers', 'wanderers', 'county', 'albion',
  'olympique', 'olympiacos', 'olympiakos', 'dynamo', 'dinamo', 'sport',
  'sportif', 'football', 'municipal', 'women', 'womens', 'w',
]);

/** Fold a team name down to its identifying tokens. */
function tokens(name) {
  const folded = String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')      // "China (W)" -> "China"
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const out = [];
  for (const w of folded.split(/\s+/)) {
    if (!w) continue;
    if (NOISE.has(w)) continue;
    out.push(w);
  }
  // If noise removal stripped everything, fall back to the raw tokens so the
  // team is still matchable at all.
  return out.length ? out : folded.split(/\s+/).filter(Boolean);
}

/**
 * Do two name tokens refer to the same club?
 *
 * Feeds spell the same club differently — "Ferencvaros" vs "Ferencvarosi",
 * "Plzen" vs "Viktoria Plzen", "Salzburg" vs "Red Bull Salzburg". Exact
 * equality misses those, so accept a shared stem: a long common prefix where
 * one token is essentially the other plus a suffix.
 */
function tokenMatch(a, b) {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 5) return false;
  // Stem match: the shorter token is a prefix of the longer one.
  if (long.startsWith(short)) return true;
  // Shared prefix of >= 6 chars with a similar length is close enough.
  let p = 0;
  while (p < short.length && short[p] === long[p]) p += 1;
  if (p >= 6 && p >= short.length - 2) return true;
  return false;
}

/**
 * Containment similarity: how much of the smaller token set is covered by the
 * larger one. "bournemouth" vs "afc bournemouth" scores 1.0.
 */
function similarity(a, b) {
  if (!a.length || !b.length) return 0;
  const B = new Set(b);
  let inter = 0;
  let longHit = false;
  for (const t of a) {
    for (const u of B) {
      if (tokenMatch(t, u)) {
        inter += 1;
        if (Math.min(t.length, u.length) >= 6) longHit = true;
        break;
      }
    }
  }
  const denom = Math.min(a.length, b.length);
  let score = denom ? inter / denom : 0;
  // Reward a distinctive name match.
  if (longHit) score = Math.min(1, score + 0.15);
  return score;
}

/**
 * Score an ESPN fixture against an InferSports event.
 * Both sides must match, so a shared opponent can never cause a false pairing.
 */
function pairScore(homeName, awayName, ev) {
  const h = similarity(tokens(homeName), tokens(ev.home_team && ev.home_team.name));
  const a = similarity(tokens(awayName), tokens(ev.away_team && ev.away_team.name));
  // Also allow a reversed fixture (some feeds flip home/away).
  const hRev = similarity(tokens(homeName), tokens(ev.away_team && ev.away_team.name));
  const aRev = similarity(tokens(awayName), tokens(ev.home_team && ev.home_team.name));
  const fwd = Math.min(h, a);
  const rev = Math.min(hRev, aRev);
  const best = Math.max(fwd, rev);
  return { score: best, reversed: rev > fwd };
}

/* ------------------------------------------------------------------ events */

/**
 * All football events on a UTC date, cached. Returns [] on failure.
 */
async function eventsForDate(dateYmd) {
  const key = 'events:' + dateYmd;
  const cached = cacheGet(key, TTL.events);
  if (cached !== undefined) return cached;
  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    const out = [];
    let cursor = null;
    let ok = false;
    // The free tier caps limit at 200; page until the day is exhausted.
    for (let page = 0; page < 3; page += 1) {
      const q = `/v1/events?sport=football&date=${encodeURIComponent(dateYmd)}&limit=200`
        + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
      const j = await fetchJSON(q);
      if (!j || !Array.isArray(j.data)) break;
      ok = true;
      out.push(...j.data);
      cursor = j.page && (j.page.next_cursor || j.page.nextCursor);
      if (!cursor || !j.data.length) break;
    }
    stats.events += out.length;
    // Only cache a response we actually received. Caching a failure as an empty
    // list would assert "this date has no fixtures" for the whole TTL — an
    // assumption dressed up as a fact, and one that would keep the board in
    // ESPN-only mode long after the source recovered.
    if (ok) cacheSet(key, out);
    return out;
  })();

  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
}

/**
 * Find the InferSports event for an ESPN fixture. Returns null when there is no
 * confident match — a wrong pairing would be far worse than no pairing.
 */
async function matchFixture(dateYmd, homeName, awayName) {
  const events = await eventsForDate(dateYmd);
  if (!events.length) return null;

  const MIN_SCORE = 0.6;
  let best = null;
  let second = null;
  for (const ev of events) {
    const s = pairScore(homeName, awayName, ev);
    if (!best || s.score > best.score) { second = best; best = { ev, ...s }; }
    else if (!second || s.score > second.score) { second = { ev, ...s }; }
  }
  if (!best || best.score < MIN_SCORE) return null;
  // Ambiguity guard: two plausible pairings means we cannot tell them apart.
  if (second && second.score >= MIN_SCORE && best.score - second.score < 0.08) return null;
  stats.matched += 1;
  return { event: best.ev, score: best.score, reversed: best.reversed };
}

/* -------------------------------------------------------------------- odds */

/**
 * Raw odds block for an event, cached. Returns null on failure.
 */
async function oddsForEvent(eventId) {
  const key = 'odds:' + eventId;
  const cached = cacheGet(key, TTL.odds);
  if (cached !== undefined) return cached;
  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    const j = await fetchJSON(`/v1/events/${encodeURIComponent(eventId)}/odds?format=decimal`);
    if (!j || !Array.isArray(j.odds)) return null;
    stats.odds += 1;
    cacheSet(key, j);
    return j;
  })();

  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
}

/**
 * Opening lines, for line-movement reads. Cached with the odds TTL.
 */
async function openingForEvent(eventId) {
  const key = 'open:' + eventId;
  const cached = cacheGet(key, TTL.odds);
  if (cached !== undefined) return cached;
  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    const j = await fetchJSON(`/v1/events/${encodeURIComponent(eventId)}/opening?format=decimal`);
    if (!j || !Array.isArray(j.odds)) return null; // never cache a failure
    cacheSet(key, j);
    return j;
  })();

  inflight.set(key, p);
  try { return await p; } finally { inflight.delete(key); }
}

/* --------------------------------------------------------------- consensus */

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** A price is usable only when the book has it open and quoted. */
function usable(q) {
  if (!q || q.status !== 'open') return false;
  const p = q.prices || {};
  const vals = Object.values(p).filter((v) => typeof v === 'number');
  return vals.length > 0 && vals.every((v) => v > 1.0);
}

/**
 * Collapse a raw odds block into a clean consensus structure.
 *
 * For each outcome we keep the BEST price (what you could actually take) and
 * the MEDIAN price (a robust read of where the market really is). The gap
 * between the two is itself a signal: a big spread means one book is an
 * outlier, which is exactly the kind of thing a trap screen should notice.
 */
function buildConsensus(raw, opts = {}) {
  if (!raw || !Array.isArray(raw.odds)) return null;
  const live = raw.odds.filter(usable);
  if (!live.length) return null;

  const out = {
    asOf: raw.as_of || null,
    stale: !!raw.stale,
    books: [...new Set(live.map((q) => q.bookmaker))].sort(),
    h2h: null,          // { home, draw, away } each { best, median, books }
    totals: {},         // line -> { over, under }
    ah: {},             // line -> { home, away }
    ht: { h2h: null, totals: {}, ah: {} },
    quotes: live.length,
  };

  const bucket = (mt, period) => live.filter((q) => q.market_type === mt && q.period === period);

  const collapse = (quotes, keys) => {
    const res = {};
    for (const k of keys) {
      const vals = quotes.map((q) => q.prices && q.prices[k]).filter((v) => typeof v === 'number' && v > 1);
      if (!vals.length) { res[k] = null; continue; }
      res[k] = { best: Math.max(...vals), median: median(vals), books: vals.length };
    }
    return res;
  };

  const linesOf = (quotes) => [...new Set(quotes.map((q) => q.line).filter((l) => l != null))];

  for (const period of ['full_time', 'half_time']) {
    const target = period === 'full_time' ? out : out.ht;

    const h = bucket('1x2', period);
    if (h.length) {
      const c = collapse(h, ['home', 'draw', 'away']);
      if (c.home && c.draw && c.away) target.h2h = c;
    }

    for (const q of bucket('totals', period)) {
      if (!target.totals[q.line]) target.totals[q.line] = { over: null, under: null, books: [] };
      const slot = target.totals[q.line];
      slot.books.push(q.bookmaker);
      for (const side of ['over', 'under']) {
        const v = q.prices && q.prices[side];
        if (typeof v !== 'number' || v <= 1) continue;
        if (!slot[side]) slot[side] = { best: v, median: v, books: 1 };
        else {
          slot[side].books += 1;
          slot[side].best = Math.max(slot[side].best, v);
          slot[side].median = median([slot[side].median, v]);
        }
      }
    }

    for (const q of bucket('asian_handicap', period)) {
      if (!target.ah[q.line]) target.ah[q.line] = { home: null, away: null, books: [] };
      const slot = target.ah[q.line];
      slot.books.push(q.bookmaker);
      for (const side of ['home', 'away']) {
        const v = q.prices && q.prices[side];
        if (typeof v !== 'number' || v <= 1) continue;
        if (!slot[side]) slot[side] = { best: v, median: v, books: 1 };
        else {
          slot[side].books += 1;
          slot[side].best = Math.max(slot[side].best, v);
          slot[side].median = median([slot[side].median, v]);
        }
      }
    }
  }

  out.lines = {
    totals: linesOf(bucket('totals', 'full_time')).sort((a, b) => a - b),
    ah: linesOf(bucket('asian_handicap', 'full_time')).sort((a, b) => a - b),
    totalsHT: linesOf(bucket('totals', 'half_time')).sort((a, b) => a - b),
  };

  if (!opts.keepRaw) delete out.raw;
  return out;
}

/**
 * Convenience: match an ESPN fixture and return its consensus in one call.
 * Returns null whenever anything is unavailable.
 */
async function consensusFor(dateYmd, homeName, awayName) {
  try {
    const m = await matchFixture(dateYmd, homeName, awayName);
    if (!m) return null;
    const raw = await oddsForEvent(m.event.id);
    const c = buildConsensus(raw);
    if (!c) return null;
    c.eventId = m.event.id;
    c.matchScore = Math.round(m.score * 100) / 100;
    c.league = m.event.league && m.event.league.name;
    c.reversed = m.reversed;
    return c;
  } catch {
    return null;
  }
}

/**
 * Clear caches. `hard` also forgets a tripped quota breaker and wipes the disk
 * mirror — only ever used by tests, because in production a tripped breaker is
 * *correct* and must persist until the daily window genuinely rolls over, and
 * the disk mirror is what stops a restart re-spending the board.
 */
function resetCache(hard) {
  mem.clear();
  inflight.clear();
  if (hard) {
    quota.blockedUntil = 0;
    quota.exhausted = false;
    quota.remaining = null;
    quota.resetAt = 0;
    diskClear();
  }
}

module.exports = {
  eventsForDate,
  matchFixture,
  oddsForEvent,
  openingForEvent,
  buildConsensus,
  consensusFor,
  netStats,
  quotaSnapshot,
  resetSeconds,
  resetCache,
  tokens,
  similarity,
  pairScore,
};
