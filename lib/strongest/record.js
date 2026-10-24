'use strict';

/**
 * strongest/record.js — the Strongest Picks track record.
 *
 * Every Strongest Pick (and the nine-market card of every match) is written down BEFORE
 * kick-off, the first time the page is built, and never rewritten. After the match it is
 * settled from free sources:
 *
 *   ESPN scoreboard           final score; goal times, scorers and cards when ESPN lists them
 *   football-data.co.uk       half-time score, corners and cards (published a few days later)
 *
 * A pick whose result cannot be found within C.voidAfterDays is marked void, never guessed.
 * Storage: JSON per month under data/strongest. Kept apart from the site's main ledger.
 */

const fs = require('fs');
const path = require('path');
const espn = require('../espn');
const FDS = require('../crawler/sources/footballdata');
const WH = require('../crawler/warehouse');
const { settle: settleScore } = require('../settle');
const C = require('./config');

const DIR = path.join(espn.DATA_DIR, 'strongest');

function monthFile(ym) {
  return path.join(DIR, `strongest-${ym}.json`);
}
function readMonth(ym) {
  try {
    return JSON.parse(fs.readFileSync(monthFile(ym), 'utf8'));
  } catch {
    return {};
  }
}
function writeMonth(ym, data) {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const tmp = monthFile(ym) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, monthFile(ym));
  } catch {
    /* best effort: the record must never break the page */
  }
}
function months() {
  try {
    return fs.readdirSync(DIR).filter((f) => /^strongest-\d{4}-\d{2}\.json$/.test(f)).map((f) => f.slice(10, 17)).sort();
  } catch {
    return [];
  }
}

function entry(kind, m, sel, extra = {}) {
  const name = (t) => (t && typeof t === 'object' ? t.name : t);
  return {
    kind, // 'pick' (a Strongest Pick) | 'card' (one of a match's nine market picks)
    fixture: String(m.id),
    league: m.league,
    leagueName: m.leagueName || null,
    date: m.date,
    home: name(m.home),
    away: name(m.away),
    fd: m.fd || null,
    group: sel.group,
    key: sel.key,
    label: sel.label,
    prob: sel.prob,
    floor: sel.floor,
    views: sel.views,
    tier: sel.tier || null,
    level: sel.level || null,
    player: sel.player ? { name: sel.player.name, fullName: sel.player.fullName || sel.player.name } : null,
    recordedAt: new Date().toISOString(),
    result: null,
    hit: null,
    ...extra,
  };
}

/**
 * Write the day's picks before kick-off. First write wins.
 * @param {{picks:object[], matches:object[]}} day  output of strongest/index.js
 */
function record(day) {
  if (!day) return 0;
  const byMonth = new Map();
  let added = 0;
  const put = (e) => {
    if (!e.date || Date.parse(e.date) <= Date.now()) return;
    const ym = String(e.date).slice(0, 7);
    if (!byMonth.has(ym)) byMonth.set(ym, readMonth(ym));
    const book = byMonth.get(ym);
    const id = e.kind === 'pick' ? `${e.fixture}|pick` : `${e.fixture}|card|${e.group}`;
    if (book[id]) return;
    book[id] = e;
    added++;
  };
  for (const p of day.picks || []) put(entry('pick', p.match, p.pick));
  for (const mt of day.matches || []) {
    if (mt.started) continue;
    for (const c of mt.cards || []) if (!c.none) put(entry('card', mt.match, c));
  }
  for (const [ym, book] of byMonth) writeMonth(ym, book);
  return added;
}

// ------------------------------------------------------------------ settlement

/** "45'+2'" -> 45, "67'" -> 67; falls back to the clock in seconds. */
function minuteOf(clock) {
  if (!clock) return null;
  const m = /^(\d{1,3})/.exec(String(clock.displayValue || ''));
  if (m) return Number(m[1]);
  const v = Number(clock.value);
  return Number.isFinite(v) && v > 0 ? Math.ceil(v / 60) : null;
}

/** Goals and cards from an ESPN scoreboard event's `details`, or null when it lists none. */
function espnEvents(comp) {
  const home = (comp.competitors || []).find((c) => c.homeAway === 'home');
  const away = (comp.competitors || []).find((c) => c.homeAway === 'away');
  const sideOf = (tid) => (home && String(home.id) === String(tid) ? 'home' : away && String(away.id) === String(tid) ? 'away' : null);
  const det = Array.isArray(comp.details) ? comp.details : [];
  if (!det.length) return null;
  const goals = [];
  const cards = { home: 0, away: 0 };
  let sawCard = false;
  for (const d of det) {
    if (!d) continue;
    const side = sideOf(d.team && d.team.id);
    const type = String((d.type && d.type.text) || '');
    const minute = minuteOf(d.clock);
    if (d.scoringPlay || /goal/i.test(type)) {
      if (d.shootout || /shootout/i.test(type)) continue;
      const own = !!d.ownGoal || /own goal/i.test(type);
      const who = Array.isArray(d.athletesInvolved) && d.athletesInvolved[0] ? d.athletesInvolved[0].displayName || d.athletesInvolved[0].fullName : null;
      goals.push({ minute, side, scorer: own ? null : who, ownGoal: own });
    }
    if (d.yellowCard || d.redCard || /card/i.test(type)) {
      sawCard = true;
      if (side) cards[side]++;
    }
  }
  return { goals, cards: sawCard ? cards : null };
}

function score(c) {
  const v = Number(c && c.score && typeof c.score === 'object' ? c.score.value : c && c.score);
  return Number.isFinite(v) ? v : null;
}

/**
 * Settle one selection key on what is known about the match.
 * @returns {1|0|null|undefined}  1 won, 0 lost, null void / push, undefined = data not available yet
 */
function settleKey(key, o, player) {
  if (!o || o.hg == null || o.ag == null) return undefined;
  const hg = o.hg;
  const ag = o.ag;
  const ht = o.hthg != null && o.htag != null;
  const h1 = ht ? o.hthg + o.htag : null;
  const h2 = ht ? hg + ag - h1 : null;
  const sh = ht ? { h: hg - o.hthg, a: ag - o.htag } : null;
  const b = (x) => (x ? 1 : 0);
  let m;
  switch (true) {
    case /^(1|X|2|1X|X2|12|BTTS_Y|BTTS_N)$/.test(key) || /^[OU]\d\.5$/.test(key) || /^TT[HA]_[OU]\d\.5$/.test(key): return settleScore(key, hg, ag);
    case key === 'WO15_H': return b(hg > ag && hg + ag >= 2);
    case key === 'WO15_A': return b(ag > hg && hg + ag >= 2);
    case key === 'WTN_H': return b(hg > ag && ag === 0);
    case key === 'WTN_A': return b(ag > hg && hg === 0);
    case key === 'GG_O2.5': return b(hg > 0 && ag > 0 && hg + ag >= 3);
    case key === 'DC1X_U3.5': return b(hg >= ag && hg + ag <= 3);
    case key === 'DCX2_U3.5': return b(ag >= hg && hg + ag <= 3);
    case key === 'DC1X_O1.5': return b(hg >= ag && hg + ag >= 2);
    case key === 'DCX2_O1.5': return b(ag >= hg && hg + ag >= 2);
    case /^(H1_|H2_|HT_|HSH_|WEH_|WBH_|HTFT_)/.test(key): {
      if (!ht) return undefined;
      switch (key) {
        case 'H1_O0.5': return b(h1 > 0);
        case 'H1_U1.5': return b(h1 <= 1);
        case 'H2_O0.5': return b(h2 > 0);
        case 'H2_O1.5': return b(h2 >= 2);
        case 'HT_1': return b(o.hthg > o.htag);
        case 'HT_X': return b(o.hthg === o.htag);
        case 'HT_2': return b(o.hthg < o.htag);
        case 'HSH_2': return b(h2 > h1);
        case 'WEH_H': return b(o.hthg > o.htag || sh.h > sh.a);
        case 'WEH_A': return b(o.htag > o.hthg || sh.a > sh.h);
        case 'WBH_H': return b(o.hthg > o.htag && sh.h > sh.a);
        case 'WBH_A': return b(o.htag > o.hthg && sh.a > sh.h);
        case 'HTFT_HH': return b(o.hthg > o.htag && hg > ag);
        case 'HTFT_AA': return b(o.htag > o.hthg && ag > hg);
        default: return null;
      }
    }
    case (m = /^M(15|30)_([YN])$/.exec(key)) !== null: {
      if (hg + ag === 0) return m[2] === 'N' ? 1 : 0;
      if (!o.goals || o.goals.length !== hg + ag || o.goals.some((g) => g.minute == null)) return undefined;
      const early = o.goals.some((g) => g.minute <= Number(m[1]));
      return m[2] === 'Y' ? b(early) : b(!early);
    }
    case (m = /^C_([OU])(\d+\.5)$/.exec(key)) !== null: {
      if (!o.corners) return undefined;
      const t = o.corners.home + o.corners.away;
      return m[1] === 'O' ? b(t > Number(m[2])) : b(t < Number(m[2]));
    }
    case key === 'C_MOST_H': return o.corners ? b(o.corners.home > o.corners.away) : undefined;
    case key === 'C_MOST_A': return o.corners ? b(o.corners.away > o.corners.home) : undefined;
    case (m = /^C([HA])_O(\d+\.5)$/.exec(key)) !== null: return o.corners ? b((m[1] === 'H' ? o.corners.home : o.corners.away) > Number(m[2])) : undefined;
    case (m = /^K_([OU])(\d+\.5)$/.exec(key)) !== null: {
      if (!o.cards) return undefined;
      const t = o.cards.home + o.cards.away;
      return m[1] === 'O' ? b(t > Number(m[2])) : b(t < Number(m[2]));
    }
    case /^PL_/.test(key): {
      if (hg + ag === 0) return 0;
      if (!o.goals || o.goals.length !== hg + ag) return undefined;
      const want = [player && player.fullName, player && player.name].filter(Boolean).map(foldName);
      const sur = want.map((w) => w.split(' ').pop());
      return b(o.goals.some((g) => {
        if (g.ownGoal || !g.scorer) return false;
        const s = foldName(g.scorer);
        return want.includes(s) || sur.includes(s.split(' ').pop());
      }));
    }
    default: return null;
  }
}

function foldName(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** ESPN's final result for a fixture: { hg, ag, goals?, cards? } or null while unfinished. */
async function espnFinal(e, cache) {
  const day = espn.ymd(new Date(e.date));
  const sbKey = `${e.league}|${day}`;
  if (!cache.sb.has(sbKey)) cache.sb.set(sbKey, espn.scoreboardRaw(e.league, day).then((r) => r.events || []).catch(() => []));
  const events = await cache.sb.get(sbKey);
  const ev = events.find((x) => String(x.id) === String(e.fixture));
  const comp = ev && ev.competitions && ev.competitions[0];
  const st = comp && comp.status && comp.status.type;
  if (!comp || !st || !st.completed) return null;
  const h = comp.competitors.find((c) => c.homeAway === 'home');
  const a = comp.competitors.find((c) => c.homeAway === 'away');
  const fin = { hg: score(h), ag: score(a) };
  if (fin.hg == null || fin.ag == null) return null;
  const evs = espnEvents(comp);
  if (evs) {
    fin.goals = evs.goals;
    if (evs.cards) fin.cards = evs.cards;
  }
  return fin;
}

/**
 * What is known about a finished match from ESPN and the football-data archive.
 * ESPN's final result is kept on the entry (`espn`), so a pick still waiting for the archive
 * (half-time, corners, cards) does not fetch the same scoreboard again.
 */
async function outcomeFor(e, cache) {
  const out = { hg: null, ag: null };
  let fin = e.espn || null;
  if (!fin) {
    fin = await espnFinal(e, cache);
    if (fin) e.espn = fin;
  }
  if (fin) {
    out.hg = fin.hg;
    out.ag = fin.ag;
    if (fin.goals) {
      out.goals = fin.goals;
      if (fin.goals.length === out.hg + out.ag && fin.goals.every((g) => g.minute != null && g.side)) {
        out.hthg = fin.goals.filter((g) => g.minute <= 45 && g.side === 'home').length;
        out.htag = fin.goals.filter((g) => g.minute <= 45 && g.side === 'away').length;
      }
    }
    if (fin.cards) out.cards = fin.cards;
  }
  // football-data archive: half-time, corners and cards (the authoritative statistics)
  if (e.fd && e.fd.home && e.fd.away && FDS.LEAGUES[e.league]) {
    if (!cache.fd.has(e.league)) cache.fd.set(e.league, WH.store(e.league).then((s) => s.records || []).catch(() => []));
    const recs = await cache.fd.get(e.league);
    const d0 = Date.parse(String(e.date).slice(0, 10) + 'T00:00:00Z');
    const r = recs.find((x) => x.home === e.fd.home && x.away === e.fd.away && Math.abs(Date.parse(x.date + 'T00:00:00Z') - d0) <= 86400000);
    if (r && r.hg != null) {
      if (out.hg == null) {
        out.hg = r.hg;
        out.ag = r.ag;
      }
      if (r.hthg != null && r.htag != null) {
        out.hthg = r.hthg;
        out.htag = r.htag;
      }
      if (r.hc != null && r.ac != null) out.corners = { home: r.hc, away: r.ac };
      if (r.hy != null && r.ay != null) out.cards = { home: r.hy + (r.hr || 0), away: r.ay + (r.ar || 0) };
    }
  }
  return out;
}

let lastSettle = 0;

/** Settle every entry whose match has finished. Throttled; never throws. */
async function settleAll({ force = false } = {}) {
  if (!force && Date.now() - lastSettle < C.settleEveryMinutes * 60 * 1000) return 0;
  lastSettle = Date.now();
  const now = Date.now();
  const grace = C.settleGraceHours * 3600 * 1000;
  const cache = { sb: new Map(), fd: new Map() };
  let settled = 0;
  for (const ym of months()) {
    const book = readMonth(ym);
    let changed = false;
    for (const e of Object.values(book)) {
      if (e.hit != null || e.result != null) continue;
      if (Date.parse(e.date) + grace > now) continue;
      let o = null;
      const hadEspn = !!e.espn;
      try {
        o = await outcomeFor(e, cache);
      } catch {
        o = null;
      }
      if (!hadEspn && e.espn) changed = true;
      const res = settleKey(e.key, o, e.player);
      if (res === undefined) {
        if (now - Date.parse(e.date) > C.voidAfterDays * 86400000) {
          e.result = 'void';
          e.hit = null;
          e.note = 'Result statistics were not published by the free sources.';
          e.settledAt = new Date().toISOString();
          changed = true;
        }
        continue;
      }
      e.result = res === null ? 'void' : `${o.hg}-${o.ag}`;
      e.hit = res;
      if (o.corners) e.corners = o.corners;
      if (o.cards) e.cards = o.cards;
      if (o.hthg != null) e.ht = `${o.hthg}-${o.htag}`;
      e.settledAt = new Date().toISOString();
      settled++;
      changed = true;
    }
    if (changed) writeMonth(ym, book);
  }
  return settled;
}

// ------------------------------------------------------------------ reading the record

function all() {
  const out = [];
  for (const ym of months()) out.push(...Object.values(readMonth(ym)));
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

function stats(list) {
  const done = list.filter((e) => e.hit === 1 || e.hit === 0);
  const won = done.filter((e) => e.hit === 1).length;
  return {
    n: done.length,
    won,
    hitRate: done.length ? won / done.length : null,
    stated: done.length ? done.reduce((a, e) => a + e.prob, 0) / done.length : null,
    pending: list.filter((e) => e.hit == null && e.result == null).length,
    void: list.filter((e) => e.result === 'void').length,
  };
}

function summary() {
  const list = all();
  const picks = list.filter((e) => e.kind === 'pick');
  const cards = list.filter((e) => e.kind === 'card');
  const byTier = {};
  for (const t of C.tiers) byTier[t.name] = stats(picks.filter((e) => e.tier === t.name));
  const byGroup = {};
  for (const e of cards) (byGroup[e.group] = byGroup[e.group] || []).push(e);
  return {
    picks: stats(picks),
    byTier,
    cards: Object.fromEntries(Object.entries(byGroup).map(([g, l]) => [g, stats(l)])),
    recent: picks.slice(-30).reverse().map((e) => ({
      date: e.date, league: e.leagueName || e.league, home: e.home, away: e.away, group: e.group, label: e.label,
      prob: e.prob, floor: e.floor, tier: e.tier, result: e.result, hit: e.hit, ht: e.ht || null, corners: e.corners || null, cards: e.cards || null,
    })),
  };
}

/** Strongest Picks recorded for matches on a date (YYYY-MM-DD). */
function forDate(dayISO) {
  return all().filter((e) => e.kind === 'pick' && String(e.date).slice(0, 10) === dayISO);
}

function toCsv() {
  const cols = ['date', 'kind', 'league', 'home', 'away', 'group', 'label', 'prob', 'floor', 'tier', 'level', 'result', 'ht', 'hit', 'recordedAt'];
  const q = (v) => {
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...all().map((e) => cols.map((c) => q(e[c])).join(','))].join('\n');
}

function _resetThrottle() {
  lastSettle = 0;
}

module.exports = { record, settleAll, settleKey, outcomeFor, espnFinal, espnEvents, minuteOf, summary, forDate, all, stats, toCsv, DIR, _resetThrottle };
