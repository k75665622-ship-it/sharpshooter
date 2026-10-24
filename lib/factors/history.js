'use strict';

/**
 * factors/history.js — an in-memory match store with the queries the factor engine
 * needs: a team's log, head-to-head, the league table on a date, and the league's
 * scoring environment. Research fills it with 238k historical records; the live site
 * fills it with crawled records for the leagues on today's board.
 *
 * Records must be added in date order (addAll sorts for you). Only completed matches
 * (both scores known) enter the logs and tables.
 */

const RC = require('./records');

const DAY = 86400000;
const dnum = (d) => Date.parse(d + 'T00:00:00Z');

/** Country of a league code / ESPN slug — team keys are per-country so namesakes never merge. */
function countryOf(league) {
  const l = String(league || '');
  if (l.includes('.')) return l.split('.')[0].toUpperCase();
  if (/^E[0-3]$|^EC$/.test(l)) return 'ENG';
  if (/^SC[0-3]$/.test(l)) return 'SCO';
  if (/^D[12]$/.test(l)) return 'GER';
  if (/^SP[12]$/.test(l)) return 'ESP';
  if (/^I[12]$/.test(l)) return 'ITA';
  if (/^F[12]$/.test(l)) return 'FRA';
  return { N1: 'NED', B1: 'BEL', P1: 'POR', T1: 'TUR', G1: 'GRE' }[l] || l;
}

/** first index i with arr[i].date >= date (arr ascending by date) */
function lowerBound(arr, date) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid].date < date) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

class History {
  constructor() {
    this.team = new Map(); // country|team -> TL[] ascending
    this.pair = new Map(); // sorted pair key -> MR[] ascending
    this.season = new Map(); // league|season -> MR[] ascending
    this.league = new Map(); // league -> MR[] ascending
    this._tableCache = new Map();
    this._envCache = new Map();
  }

  static key(league, team) {
    return countryOf(league) + '|' + team;
  }

  add(mr) {
    if (!mr || mr.hg == null || mr.ag == null) return;
    const c = countryOf(mr.league);
    for (const t of [mr.home, mr.away]) {
      const k = c + '|' + t;
      if (!this.team.has(k)) this.team.set(k, []);
      this.team.get(k).push(RC.teamEntry(mr, t));
    }
    const pk = c + '|' + [mr.home, mr.away].sort().join('|');
    if (!this.pair.has(pk)) this.pair.set(pk, []);
    this.pair.get(pk).push(mr);
    const sk = mr.league + '|' + mr.season;
    if (!this.season.has(sk)) this.season.set(sk, []);
    this.season.get(sk).push(mr);
    if (!this.league.has(mr.league)) this.league.set(mr.league, []);
    this.league.get(mr.league).push(mr);
  }

  addAll(list) {
    const sorted = [...list].filter(Boolean).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (const mr of sorted) this.add(mr);
    this._tableCache.clear();
    this._envCache.clear();
    return this;
  }

  /** Team log before `before`, newest first. */
  teamLog(league, team, before, n = 40) {
    const arr = this.team.get(History.key(league, team));
    if (!arr) return [];
    const end = lowerBound(arr, before);
    const out = [];
    for (let i = end - 1; i >= 0 && out.length < n; i--) out.push(arr[i]);
    return out;
  }

  hasTeam(league, team) {
    return this.team.has(History.key(league, team));
  }

  /** Meetings before `before`, newest first, within `years`. */
  h2h(league, a, b, before, years = 6, n = 10) {
    const arr = this.pair.get(countryOf(league) + '|' + [a, b].sort().join('|'));
    if (!arr) return [];
    const end = lowerBound(arr, before);
    const from = new Date(dnum(before) - years * 365.25 * DAY).toISOString().slice(0, 10);
    const out = [];
    for (let i = end - 1; i >= 0 && out.length < n; i--) {
      if (arr[i].date < from) break;
      out.push(arr[i]);
    }
    return out;
  }

  teamsInSeason(league, season) {
    const arr = this.season.get(league + '|' + season);
    if (!arr) return null;
    const memo = this._memo || (this._memo = new Map());
    const mk = `t|${league}|${season}|${arr.length}`;
    if (memo.has(mk)) return memo.get(mk);
    const s = new Set();
    for (const m of arr) {
      s.add(m.home);
      s.add(m.away);
    }
    if (memo.size > 2000) memo.clear();
    memo.set(mk, s);
    return s;
  }

  /** Most games any team played in a season (the season length, including splits). */
  seasonLength(league, season) {
    const arr = this.season.get(league + '|' + season);
    if (!arr || !arr.length) return null;
    const memo = this._memo || (this._memo = new Map());
    const mk = `l|${league}|${season}|${arr.length}`;
    if (memo.has(mk)) return memo.get(mk);
    const gp = new Map();
    for (const m of arr) {
      gp.set(m.home, (gp.get(m.home) || 0) + 1);
      gp.set(m.away, (gp.get(m.away) || 0) + 1);
    }
    const v = Math.max(...gp.values());
    if (memo.size > 2000) memo.clear();
    memo.set(mk, v);
    return v;
  }

  /**
   * League table before `before`: rows sorted by points, goal difference, goals for.
   * @returns {{rows:Map<string,object>, order:object[], n:number, totalGames:number}|null}
   */
  table(league, season, before) {
    const ck = `${league}|${season}|${before}`;
    if (this._tableCache.has(ck)) return this._tableCache.get(ck);
    const arr = this.season.get(league + '|' + season) || [];
    const rows = new Map();
    const row = (t) => {
      if (!rows.has(t)) rows.set(t, { team: t, gp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, hgp: 0, hpts: 0, agp: 0, apts: 0 });
      return rows.get(t);
    };
    for (const m of arr) {
      if (m.date >= before) break;
      const h = row(m.home);
      const a = row(m.away);
      const ph = RC.pts(m.hg, m.ag);
      const pa = RC.pts(m.ag, m.hg);
      h.gp++; a.gp++;
      h.gf += m.hg; h.ga += m.ag; a.gf += m.ag; a.ga += m.hg;
      h.pts += ph; a.pts += pa;
      h.hgp++; h.hpts += ph; a.agp++; a.apts += pa;
      if (ph === 3) { h.w++; a.l++; } else if (ph === 1) { h.d++; a.d++; } else { h.l++; a.w++; }
    }
    // teams known for this season (all fixtures of the season, played or not, plus last season's size)
    const known = this.teamsInSeason(league, season);
    if (known) for (const t of known) row(t);
    const order = [...rows.values()].sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf || (x.team < y.team ? -1 : 1));
    order.forEach((r, i) => { r.pos = i + 1; });
    const n = order.length;
    const prevLen = this.seasonLength(league, season - 1);
    const totalGames = prevLen && prevLen >= 2 * (n - 1) - 4 ? prevLen : 2 * (n - 1);
    const out = n ? { rows, order, n, totalGames } : null;
    if (this._tableCache.size > 400) this._tableCache.clear();
    this._tableCache.set(ck, out);
    return out;
  }

  /** The league's scoring environment over the `days` before `before`. */
  env(league, before, days = 365) {
    const ck = `${league}|${before}|${days}`;
    if (this._envCache.has(ck)) return this._envCache.get(ck);
    const arr = this.league.get(league) || [];
    const end = lowerBound(arr, before);
    const from = new Date(dnum(before) - days * DAY).toISOString().slice(0, 10);
    const start = lowerBound(arr, from);
    let n = 0, goals = 0, home = 0, draw = 0, o25 = 0, btts = 0, sot = 0, sotGoals = 0, sotN = 0;
    for (let i = start; i < end; i++) {
      const m = arr[i];
      n++;
      goals += m.hg + m.ag;
      if (m.hg > m.ag) home++;
      else if (m.hg === m.ag) draw++;
      if (m.hg + m.ag > 2.5) o25++;
      if (m.hg > 0 && m.ag > 0) btts++;
      if (m.hst != null && m.ast != null) {
        sot += m.hst + m.ast;
        sotGoals += m.hg + m.ag;
        sotN++;
      }
    }
    const out = n >= 30
      ? {
          n,
          goals: goals / n,
          home: home / n,
          draw: draw / n,
          o25: o25 / n,
          btts: btts / n,
          gPerSot: sotN >= 30 && sot > 0 ? sotGoals / sot : null,
        }
      : null;
    if (this._envCache.size > 400) this._envCache.clear();
    this._envCache.set(ck, out);
    return out;
  }
}

module.exports = { History, countryOf, lowerBound, DAY, dnum };
