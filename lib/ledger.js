'use strict';

/**
 * ledger.js — the live track record.
 *
 * Every prediction the site publishes for a fixture that has NOT kicked off is
 * written down at that moment (probability, fair odds, value price, best price
 * seen, status). After the match the entry is settled from ESPN's final score.
 * Nothing is ever re-written after kick-off, so the record cannot flatter itself.
 *
 * It enforces the discipline rules that need a record:
 *   Rule 17   stop-loss — 3 consecutive losing days on the daily top pick => 5-day cooldown
 *   Rule 27   streak anchoring — after 3+ consecutive wins, the next pick's confidence drops a level
 *   Rule 34   GG/NG 2+ stays paper-only until 40 settled legs show a hit rate at or above the
 *             average stated probability AND a profit at recorded prices (v5 wording: the v3.1
 *             wording, "≥ 55% hit rate", is unreachable for a 22-35% market)
 *
 * Storage: JSON files under data/ledger (one per month). On hosts with an
 * ephemeral disk (e.g. Render free tier) the file survives restarts but not
 * redeploys; GET /api/ledger?format=csv exports it so nothing is lost.
 */

const fs = require('fs');
const path = require('path');
const espn = require('./espn');
const { settle } = require('./settle');

const DIR = path.join(espn.DATA_DIR, 'ledger');

function monthFile(ym) {
  return path.join(DIR, `ledger-${ym}.json`);
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
    /* best effort */
  }
}
function months() {
  try {
    return fs.readdirSync(DIR).filter((f) => /^ledger-\d{4}-\d{2}\.json$/.test(f)).map((f) => f.slice(7, 14)).sort();
  } catch {
    return [];
  }
}

function entryFrom(kind, match, p, extra = {}) {
  return {
    kind, // 'headline' | 'method' | 'general' | 'score'
    fixture: String(match.id),
    league: match.league,
    leagueName: match.leagueName || match.league,
    date: String(match.date),
    home: match.home.name,
    away: match.away.name,
    method: p.id || kind,
    methodName: p.name || kind,
    key: p.key || (p.pick && p.pick.key),
    label: p.label || (p.pick && p.pick.label),
    status: p.status || null,
    prob: p.prob,
    fairOdds: p.prob ? 1 / p.prob : null,
    valuePrice: p.price && p.price.valuePrice ? p.price.valuePrice : p.valuePrice || null,
    bestPrice: p.price && p.price.best ? p.price.best : p.best || null,
    bestBook: p.price && p.price.bestBook ? p.price.bestBook : p.bestBook || null,
    recordedAt: new Date().toISOString(),
    result: null,
    hit: null,
    ...extra,
  };
}

/**
 * Record the predictions in a set of analysed reports. Only pre-match fixtures are
 * recorded, and an entry already on file is never overwritten.
 */
function record(reports) {
  const byMonth = new Map();
  let added = 0;
  for (const r of reports || []) {
    if (!r || !r.analysable || !r.match || r.match.state !== 'pre') continue;
    const ym = String(r.match.date).slice(0, 7);
    if (!byMonth.has(ym)) byMonth.set(ym, readMonth(ym));
    const book = byMonth.get(ym);
    const put = (e) => {
      if (!e.key) return;
      const id = `${e.fixture}|${e.kind}|${e.method}|${e.key}`;
      if (book[id]) return;
      book[id] = e;
      added++;
    };
    const mt = r.methodology;
    if (mt && mt.headline) put(entryFrom('headline', r.match, mt.headline));
    if (mt && mt.predictions) for (const p of mt.predictions) put(entryFrom('method', r.match, p));
    const g = r.general;
    if (g && g.bestBet) put(entryFrom('general', r.match, { ...g.bestBet, id: 'bestBet', name: g.version === '6.0' ? 'Match decision — main pick' : 'General best bet' }));
    const vp = g && g.alternatives ? g.alternatives.find((a) => a.role === 'value') : null;
    if (vp) put(entryFrom('value', r.match, { ...vp, id: 'valuePick', name: 'Match decision — value pick' }));
    if (g && g.score && g.score.predicted) {
      put(entryFrom('score', r.match, { id: 'finalScore', name: 'Predicted final score', key: `CS_${g.score.predicted.score}`, label: `${g.score.predicted.score}`, prob: g.score.predicted.prob }));
    }
  }
  for (const [ym, book] of byMonth) writeMonth(ym, book);
  return added;
}

/**
 * Record a day's double-confirmed accumulators (lib/intel/accumulator.js) before kick-off.
 * One entry per size per day; never overwritten.
 */
function recordAcca(acca, dayISO) {
  if (!acca || !acca.options || !acca.options.length) return 0;
  let added = 0;
  const ym = String(dayISO).slice(0, 7);
  const book = readMonth(ym);
  for (const op of acca.options) {
    const id = `acca|${dayISO}|${op.size}`;
    if (book[id]) continue;
    if (op.legs.some((l) => Date.parse(l.kickoff) <= Date.now())) continue;
    book[id] = {
      kind: 'acca',
      fixture: op.legs.map((l) => l.fixtureId).join('+'),
      league: 'multi',
      leagueName: 'Accumulator',
      date: op.legs.map((l) => l.kickoff).sort()[0],
      home: `${op.name} (${op.size} legs)`,
      away: '',
      method: `acca${op.size}`,
      methodName: `Accumulator — ${op.name.toLowerCase()}`,
      key: 'ACCA',
      label: op.legs.map((l) => l.label).join(' + '),
      status: op.recommended ? 'RECOMMENDED' : null,
      prob: op.prob,
      fairOdds: op.fairOdds,
      valuePrice: op.takeAt,
      bestPrice: op.bestOdds,
      bestBook: op.bestOdds ? 'best price per leg' : null,
      legs: op.legs.map((l) => ({ fixture: String(l.fixtureId), league: l.league, date: l.kickoff, key: l.key, label: l.label, prob: l.prob, best: l.best, result: null, hit: null })),
      recordedAt: new Date().toISOString(),
      result: null,
      hit: null,
    };
    added++;
  }
  if (added) writeMonth(ym, book);
  return added;
}

/** Settle every entry whose match has finished. Fetches each needed scoreboard once. */
async function settleAll(opts = {}) {
  const now = Date.now();
  const graceMs = 2.5 * 60 * 60 * 1000;
  let settled = 0;
  for (const ym of months()) {
    const book = readMonth(ym);
    const open = Object.values(book).filter((e) => e.kind !== 'acca' && e.hit == null && e.result == null && Date.parse(e.date) + graceMs < now);
    const accas = Object.values(book).filter((e) => e.kind === 'acca' && e.hit == null && e.result == null && Date.parse(e.date) + graceMs < now);
    if (!open.length && !accas.length) continue;
    const need = new Map(); // league|yyyymmdd -> events
    for (const e of open) need.set(`${e.league}|${espn.ymd(new Date(e.date))}`, null);
    for (const a of accas) for (const l of a.legs || []) if (l.hit == null && l.result == null && Date.parse(l.date) + graceMs < now) need.set(`${l.league}|${espn.ymd(new Date(l.date))}`, null);
    for (const k of need.keys()) {
      const [league, day] = k.split('|');
      try {
        const raw = await espn.scoreboardRaw(league, day);
        need.set(k, raw.events || []);
      } catch {
        need.set(k, []);
      }
      if (opts.maxFetch && need.size > opts.maxFetch) break;
    }
    let changed = false;
    const finalScore = (league, date, fixture) => {
      const evs = need.get(`${league}|${espn.ymd(new Date(date))}`) || [];
      const ev = evs.find((x) => String(x.id) === String(fixture));
      if (!ev) return null;
      const comp = (ev.competitions || [])[0];
      const st = comp && comp.status && comp.status.type;
      if (!st || !st.completed) return null;
      const h = comp.competitors.find((c) => c.homeAway === 'home');
      const a = comp.competitors.find((c) => c.homeAway === 'away');
      const sc = (c) => Number(c.score && typeof c.score === 'object' ? c.score.value : c.score);
      const hg = sc(h);
      const ag = sc(a);
      return Number.isFinite(hg) && Number.isFinite(ag) ? { hg, ag } : null;
    };
    for (const a of accas) {
      for (const l of a.legs || []) {
        if (l.hit != null || l.result != null) continue;
        const fs2 = finalScore(l.league, l.date, l.fixture);
        if (!fs2) continue;
        l.result = `${fs2.hg}-${fs2.ag}`;
        l.hit = settle(l.key, fs2.hg, fs2.ag);
        changed = true;
      }
      const legs = a.legs || [];
      const lost = legs.some((l) => l.hit === 0);
      const done = legs.every((l) => l.result != null);
      if (lost || done) {
        a.hit = lost ? 0 : legs.some((l) => l.hit === 1) ? 1 : null;
        a.result = lost ? 'lost' : a.hit === 1 ? 'won' : 'void';
        a.settledAt = new Date().toISOString();
        settled++;
        changed = true;
      }
    }
    for (const e of open) {
      const evs = need.get(`${e.league}|${espn.ymd(new Date(e.date))}`) || [];
      const ev = evs.find((x) => String(x.id) === e.fixture);
      if (!ev) continue;
      const comp = (ev.competitions || [])[0];
      const st = comp && comp.status && comp.status.type;
      if (!st || !st.completed) continue;
      const h = comp.competitors.find((c) => c.homeAway === 'home');
      const a = comp.competitors.find((c) => c.homeAway === 'away');
      const sc = (c) => Number(c.score && typeof c.score === 'object' ? c.score.value : c.score);
      const hg = sc(h);
      const ag = sc(a);
      if (!Number.isFinite(hg) || !Number.isFinite(ag)) continue;
      e.result = `${hg}-${ag}`;
      e.hit = settle(e.key, hg, ag);
      e.settledAt = new Date().toISOString();
      changed = true;
      settled++;
    }
    if (changed) writeMonth(ym, book);
  }
  return settled;
}

function all() {
  const out = [];
  for (const ym of months()) out.push(...Object.values(readMonth(ym)));
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

function stats(list) {
  const s = list.filter((e) => e.hit === 0 || e.hit === 1);
  const n = s.length;
  const hits = s.filter((e) => e.hit === 1).length;
  const avgProb = n ? s.reduce((a, e) => a + e.prob, 0) / n : null;
  const priced = s.filter((e) => e.bestPrice > 1);
  const roi = priced.length ? priced.reduce((a, e) => a + (e.hit ? e.bestPrice - 1 : -1), 0) / priced.length : null;
  return { n, hits, hitRate: n ? hits / n : null, avgProb, roiAtBestPrice: roi, priced: priced.length, pending: list.filter((e) => e.hit == null && e.result == null).length };
}

/** Per-methodology record + discipline flags. */
function summary() {
  const list = all();
  const by = {};
  for (const e of list) {
    const k = e.kind === 'method' || e.kind === 'acca' ? e.method : e.kind;
    (by[k] = by[k] || []).push(e);
  }
  const KIND_NAMES = { headline: 'Headline pick (per fixture)', general: 'Match decision — main pick', value: 'Match decision — value pick', score: 'Predicted final score (exact)' };
  const perMethod = Object.fromEntries(Object.entries(by).map(([k, l]) => [k, { name: l[0].kind === 'method' || l[0].kind === 'acca' ? l[0].methodName : KIND_NAMES[k] || k, kind: l[0].kind, ...stats(l) }]));

  // Daily top pick: the highest-ranked headline of each day (what the "Top Pick" tab shows)
  const days = new Map();
  for (const e of list.filter((x) => x.kind === 'headline')) {
    const d = e.date.slice(0, 10);
    const cur = days.get(d);
    if (!cur || (e.status === 'LOCK' && cur.status !== 'LOCK') || (e.status === cur.status && e.prob > cur.prob)) days.set(d, e);
  }
  const daily = [...days.values()].filter((e) => e.hit === 0 || e.hit === 1).sort((a, b) => (a.date < b.date ? -1 : 1));
  let winStreak = 0;
  for (let i = daily.length - 1; i >= 0 && daily[i].hit === 1; i--) winStreak++;
  let lossStreak = 0;
  for (let i = daily.length - 1; i >= 0 && daily[i].hit === 0; i--) lossStreak++;
  const lastLoss = daily.length && daily[daily.length - 1].hit === 0 ? daily[daily.length - 1].date.slice(0, 10) : null;
  let cooldownUntil = null;
  if (lossStreak >= 3 && lastLoss) cooldownUntil = new Date(Date.parse(lastLoss) + 5 * 86400000).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  const gg = stats(by.gg2 ? by.gg2 : list.filter((e) => e.method === 'gg2'));
  const ggReady = gg.n >= 40 && gg.hitRate != null && gg.avgProb != null && gg.hitRate >= gg.avgProb && (gg.roiAtBestPrice == null || gg.roiAtBestPrice > 0);

  return {
    entries: list.length,
    perMethod,
    discipline: {
      rule17: {
        consecutiveLossDays: lossStreak,
        cooldownUntil,
        active: !!(cooldownUntil && today <= cooldownUntil),
        note: '3 consecutive losing days on the daily top pick => 5-day cooldown: no bets, paper-trade only.',
      },
      rule27: {
        consecutiveWinDays: winStreak,
        active: winStreak >= 3,
        note: 'After 3+ consecutive winning days, drop the next pick\'s confidence one level. Same stake, no escalation.',
      },
      rule34: {
        legs: gg.n,
        hitRate: gg.hitRate,
        avgStatedProb: gg.avgProb,
        roi: gg.roiAtBestPrice,
        readyForRealMoney: ggReady,
        note: 'GG/NG 2+ stays paper-only until 40 settled legs hit at or above their average stated probability, with a profit at recorded prices.',
      },
    },
    recent: list.slice(-60).reverse(),
  };
}

function toCsv() {
  const cols = ['date', 'leagueName', 'home', 'away', 'kind', 'methodName', 'label', 'status', 'prob', 'fairOdds', 'valuePrice', 'bestPrice', 'bestBook', 'result', 'hit', 'recordedAt'];
  const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return [cols.join(','), ...all().map((e) => cols.map((c) => esc(c === 'prob' && e.prob != null ? e.prob.toFixed(4) : c === 'fairOdds' && e.fairOdds ? e.fairOdds.toFixed(2) : e[c])).join(','))].join('\n');
}

module.exports = { record, recordAcca, settleAll, summary, all, toCsv, stats, DIR };
