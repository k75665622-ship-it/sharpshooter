'use strict';

/**
 * crawler/warehouse.js — crawled match data, organised for the factor engine.
 *
 *   store(slug)        six seasons of one league from football-data.co.uk (stats + prices),
 *                      cached per day, coalesced, kept for at most MAX_STORES leagues
 *   historyFor(slugs)  a lib/factors History over one or more leagues — a promoted or
 *                      relegated club's games in the neighbouring division are included, as
 *                      they were in research (a club's form does not reset when it changes division)
 *   resolveTeam()      ESPN fixture name -> football-data name: mapping LEARNED from identical
 *                      same-day results (lib/sources/names.js), conservative string match as fallback
 *   fixtureRow()       football-data's own row for an upcoming fixture (Bet365 + best prices) —
 *                      the exact price definition the model was trained on
 */

const FDS = require('./sources/footballdata');
const { History } = require('../factors/history');
const N = require('../sources/names');

const DAY_MS = 86400000;
const MAX_STORES = 16;
const NEIGHBOURS = {
  E0: ['E1'], E1: ['E0', 'E2'], E2: ['E1', 'E3'], E3: ['E2'], D1: ['D2'], D2: ['D1'], SP1: ['SP2'], SP2: ['SP1'],
  I1: ['I2'], I2: ['I1'], F1: ['F2'], F2: ['F1'], SC0: [], SC1: [],
};
const SLUG_OF_DIV = Object.fromEntries(Object.entries(FDS.LEAGUES).map(([s, l]) => [l.div, s]));

const stores = new Map(); // slug|day -> { at, promise }
const histories = new Map(); // key -> { at, value }
const mappings = new Map(); // slug|day -> Map(espn -> fd)
let fixturesCache = null; // { at, promise }

const today = () => new Date().toISOString().slice(0, 10);

function store(slug, day, seasons = 6) {
  const d = day || today();
  const key = `${slug}|${d}|${seasons}`;
  const hit = stores.get(key) || (seasons < 6 ? stores.get(`${slug}|${d}|6`) : null);
  if (hit) return hit.promise;
  const promise = FDS.league(slug, { asOf: d, seasons }).then((r) => {
    const names = new Set();
    for (const m of r.records) {
      names.add(m.home);
      names.add(m.away);
    }
    return { slug, div: FDS.LEAGUES[slug] ? FDS.LEAGUES[slug].div : null, records: r.records, provenance: r.provenance, names };
  }).catch((err) => ({ slug, div: null, records: [], provenance: { slug, error: String(err && err.message) }, names: new Set() }));
  stores.set(key, { at: Date.now(), promise });
  // an empty store (source down) is retried after 15 minutes, not kept all day
  promise.then((s) => {
    if (!s.records.length) setTimeout(() => { if (stores.get(key) && stores.get(key).promise === promise) stores.delete(key); }, 15 * 60 * 1000).unref?.();
  });
  if (stores.size > MAX_STORES) {
    const oldest = [...stores.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) stores.delete(oldest[0]);
  }
  return promise;
}

/**
 * A History over the given leagues (six seasons each) and, on request, their neighbouring
 * divisions (two seasons: enough for a promoted or relegated club's recent form).
 */
async function historyFor(slugs, day, { neighbours = false } = {}) {
  const d = day || today();
  const main = new Set(slugs.filter((s) => FDS.LEAGUES[s]));
  const extra = new Set();
  if (neighbours) {
    for (const s of main) for (const nd of NEIGHBOURS[FDS.LEAGUES[s].div] || []) if (SLUG_OF_DIV[nd] && !main.has(SLUG_OF_DIV[nd])) extra.add(SLUG_OF_DIV[nd]);
  }
  const list = [...main].sort();
  if (!list.length) return null;
  const key = list.join(',') + (extra.size ? '+' + [...extra].sort().join(',') : '') + '|' + d;
  const hit = histories.get(key);
  if (hit) return hit.value;
  const value = (async () => {
    const parts = await Promise.all([...list.map((s) => store(s, d, 6)), ...[...extra].map((s) => store(s, d, 2))]);
    const h = new History().addAll(parts.flatMap((p) => p.records));
    h.provenance = Object.fromEntries(parts.map((p) => [p.slug, p.provenance]));
    h.names = Object.fromEntries(parts.map((p) => [p.slug, p.names]));
    return h;
  })();
  histories.set(key, { at: Date.now(), value });
  if (histories.size > MAX_STORES) {
    const oldest = [...histories.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) histories.delete(oldest[0]);
  }
  return value;
}

/**
 * ESPN name -> football-data name for a league.
 * @param {string} slug
 * @param {string} espnName
 * @param {object[]} [espnResults]  completed ESPN results for the league (ESPN spellings)
 */
async function resolveTeam(slug, espnName, espnResults, day) {
  const s = await store(slug, day);
  if (!s.records.length) return null;
  if (s.names.has(espnName)) return espnName;
  const key = `${slug}|${day || today()}`;
  let map = mappings.get(key);
  if (!map && espnResults && espnResults.length) {
    const since = new Date(Date.now() - 400 * DAY_MS).toISOString().slice(0, 10);
    map = N.learnMapping(espnResults, s.records.filter((m) => m.date >= since));
    mappings.set(key, map);
    if (mappings.size > 64) mappings.delete(mappings.keys().next().value);
  }
  // current-season names first (a namesake from years ago is the wrong club)
  const recent = new Set(s.records.slice(-600).flatMap((m) => [m.home, m.away]));
  return N.resolve(espnName, map || null, [...recent]) || N.matchName(espnName, [...s.names]);
}

function fixtures() {
  if (fixturesCache && Date.now() - fixturesCache.at < 45 * 60 * 1000) return fixturesCache.promise;
  const promise = FDS.fixtures().catch(() => ({ fixtures: [], provenance: [] }));
  fixturesCache = { at: Date.now(), promise };
  return promise;
}

/** football-data's upcoming-fixture row (prices) for a fixture, by football-data names. */
async function fixtureRow(div, date, home, away) {
  const { fixtures: list } = await fixtures();
  const d = String(date).slice(0, 10);
  const near = (x) => Math.abs(Date.parse(x + 'T00:00:00Z') - Date.parse(d + 'T00:00:00Z')) <= DAY_MS;
  return list.find((m) => m.league === div && m.home === home && m.away === away && near(m.date)) || null;
}

/** Warm the caches for the leagues on a board (background, never throws). */
async function warm(slugs) {
  const list = [...new Set(slugs)].filter((s) => FDS.LEAGUES[s]);
  for (const s of list) {
    try {
      await store(s);
    } catch {
      /* best effort */
    }
  }
  try {
    await fixtures();
  } catch {
    /* best effort */
  }
  return list.length;
}

function status() {
  return {
    leaguesLoaded: [...stores.keys()],
    histories: histories.size,
    fixturesLoadedAt: fixturesCache ? new Date(fixturesCache.at).toISOString() : null,
  };
}

function _reset() {
  stores.clear();
  histories.clear();
  mappings.clear();
  fixturesCache = null;
}

module.exports = { store, historyFor, resolveTeam, fixtureRow, fixtures, warm, status, NEIGHBOURS, SLUG_OF_DIV, _reset };
