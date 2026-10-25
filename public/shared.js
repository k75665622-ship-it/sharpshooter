/* ============================================================
   Sharpshooter — day logic shared by the server and the browser
   ------------------------------------------------------------
   One file, loaded by Node (require) and by the page (<script>), so the
   server's day book and the browser's day database behave identically:

     dayKey()            the prediction day a moment belongs to. A day runs from
                         05:00 to 05:00 Ghana time (Africa/Accra); both stores are
                         wiped when it changes.
     msToReset()         milliseconds until the next 05:00.
     mergePredictions()  combine an earlier copy of a day's predictions with a newer
                         one. A match that has kicked off keeps the prediction made
                         BEFORE kick-off (frozen); a match still to play takes the
                         newest; a match the newer copy no longer lists is kept.
     attachResults()     live and final scores onto every prediction, with a tick or
                         cross for each pick, and the day's running scoreboard.
     mergeStrongest()    keep the morning's Strongest Picks once their matches start.
     settle()            settle any market key on a final score (same rules as
                         lib/settle.js; test/daybook_unit.js checks they agree).
   ============================================================ */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SS = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RESET = { tz: 'Africa/Accra', hour: 5 };

  // ---------------------------------------------------------------- the day
  function zoned(ms, tz) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(ms));
    const get = (t) => (parts.find((p) => p.type === t) || {}).value;
    return { date: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) % 24 };
  }

  /** The prediction day of a moment: the local date, minus one before the reset hour. */
  function dayKey(ms, cfg) {
    const c = cfg || RESET;
    const z = zoned(ms == null ? Date.now() : ms, c.tz);
    if (z.hour >= c.hour) return z.date;
    return new Date(Date.parse(z.date + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
  }

  /** Milliseconds until the prediction day changes (the next 05:00 local). */
  function msToReset(ms, cfg) {
    const now = ms == null ? Date.now() : ms;
    const k = dayKey(now, cfg);
    let lo = now;
    let hi = now + 15 * 60000;
    while (dayKey(hi, cfg) === k && hi - now < 27 * 3600000) {
      lo = hi;
      hi += 15 * 60000;
    }
    while (hi - lo > 1000) {
      const mid = Math.floor((lo + hi) / 2);
      if (dayKey(mid, cfg) === k) lo = mid;
      else hi = mid;
    }
    return hi - now;
  }

  // ---------------------------------------------------------------- settle (mirror of lib/settle.js)
  function settle(key, hg, ag) {
    const t = hg + ag;
    let m;
    switch (true) {
      case key === '1': return hg > ag ? 1 : 0;
      case key === 'X': return hg === ag ? 1 : 0;
      case key === '2': return hg < ag ? 1 : 0;
      case key === '1X': return hg >= ag ? 1 : 0;
      case key === 'X2': return hg <= ag ? 1 : 0;
      case key === '12': return hg !== ag ? 1 : 0;
      case key === 'DNB_H': return hg === ag ? null : hg > ag ? 1 : 0;
      case key === 'DNB_A': return hg === ag ? null : ag > hg ? 1 : 0;
      case key === 'BTTS_Y': return hg > 0 && ag > 0 ? 1 : 0;
      case key === 'BTTS_N': return hg > 0 && ag > 0 ? 0 : 1;
      case key === 'GG2P': return hg >= 2 && ag >= 2 ? 1 : 0;
      case (m = /^([OU])(\d\.5)$/.exec(key)) !== null: return m[1] === 'O' ? (t > Number(m[2]) ? 1 : 0) : t < Number(m[2]) ? 1 : 0;
      case (m = /^TT([HA])_([OU])(\d\.5)$/.exec(key)) !== null: {
        const g = m[1] === 'H' ? hg : ag;
        return m[2] === 'O' ? (g > Number(m[3]) ? 1 : 0) : g < Number(m[3]) ? 1 : 0;
      }
      case (m = /^AH_([HA])_(-?\d+(?:\.\d+)?)$/.exec(key)) !== null: {
        const line = Number(m[2]);
        const d = m[1] === 'H' ? hg - ag + line : ag - hg - line;
        return d > 1e-9 ? 1 : d < -1e-9 ? 0 : null;
      }
      case (m = /^CS_(\d+)-(\d+)$/.exec(key)) !== null: return hg === Number(m[1]) && ag === Number(m[2]) ? 1 : 0;
      default: return null;
    }
  }

  // ---------------------------------------------------------------- helpers
  const idOf = (e) => String(e && e.match ? e.match.id : e && e.id);
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

  /** Light fixture rows (state and score) from a board's matches. */
  function fixturesFrom(matches) {
    return (matches || []).map((m) => ({
      id: String(m.id),
      league: m.league,
      date: m.date,
      state: m.state || 'pre',
      completed: !!m.completed,
      statusDetail: m.statusDetail || null,
      clock: m.clock || null,
      home: { name: m.home && m.home.name, score: num(m.home && m.home.score) },
      away: { name: m.away && m.away.name, score: num(m.away && m.away.score) },
    }));
  }

  /** Newest known state per fixture: the newer list wins, the older fills gaps. */
  function fixtureMap(newer, older) {
    const map = new Map();
    for (const f of older || []) map.set(String(f.id), f);
    for (const f of newer || []) {
      const prev = map.get(String(f.id));
      // a state never goes backwards (post -> in -> pre would be a stale copy)
      const rank = { pre: 0, in: 1, post: 2 };
      if (prev && rank[prev.state] > rank[f.state]) continue;
      map.set(String(f.id), f);
    }
    return map;
  }

  /** Was this entry predicted before its match kicked off? */
  function predictedPreMatch(e) {
    if (!e || !e.match) return false;
    if (e.pre === false) return false;
    if (!e.at) return true;
    return Date.parse(e.at) < Date.parse(e.match.date);
  }

  /** Choose between an older and a newer prediction for one fixture. */
  function choose(a, b, started) {
    if (!a) return b;
    if (!b) return a;
    if (!started) return b; // still to play: the newest prediction
    const pa = predictedPreMatch(a);
    const pb = predictedPreMatch(b);
    if (pb && (!pa || String(b.at || '') >= String(a.at || ''))) return b;
    if (pa) return a;
    return b;
  }

  function mergeList(older, newer, startedOf) {
    const out = new Map();
    for (const e of older || []) out.set(idOf(e), e);
    for (const e of newer || []) {
      const id = idOf(e);
      out.set(id, choose(out.get(id), e, startedOf(id, e)));
    }
    return [...out.values()];
  }

  // ---------------------------------------------------------------- merge
  /**
   * @param {object|null} older  an earlier copy of the day's /api/predictions payload
   * @param {object|null} newer  a newer copy
   * @param {number} [now]
   */
  function mergePredictions(older, newer, now) {
    const t = now == null ? Date.now() : now;
    if (!newer) return older ? attachResults(clone(older), t) : null;
    if (!older || older.date !== newer.date) return attachResults(clone(newer), t);
    const a = clone(older);
    const b = clone(newer);
    const fx = fixtureMap(b.fixtures, a.fixtures);
    const startedOf = (id, e) => {
      const f = fx.get(id);
      if (f) return f.state !== 'pre';
      const ko = e && e.match ? Date.parse(e.match.date) : NaN;
      return Number.isFinite(ko) && ko <= t;
    };
    const out = { ...b };
    out.fixtures = [...fx.values()];
    out.general = mergeList(a.general, b.general, startedOf).sort((x, y) => Date.parse(x.match.date) - Date.parse(y.match.date));
    out.headline = mergeList(a.headline, b.headline, startedOf);
    const rank = { LOCK: 5, PREDICT: 4, PAPER: 3, WATCH: 2, REMOVE: 1 };
    out.headline.sort((x, y) => (rank[y.prediction.status] || 0) - (rank[x.prediction.status] || 0) || (y.prediction.score || 0) - (x.prediction.score || 0));
    out.byMethod = {};
    for (const k of new Set([...Object.keys(a.byMethod || {}), ...Object.keys(b.byMethod || {})])) {
      out.byMethod[k] = mergeList((a.byMethod || {})[k], (b.byMethod || {})[k], startedOf)
        .sort((x, y) => (rank[y.prediction.status] || 0) - (rank[x.prediction.status] || 0) || (y.prediction.score || 0) - (x.prediction.score || 0));
    }
    out.methods = (b.methods || a.methods || []).map((m) => ({ ...m, count: (out.byMethod[m.id] || []).length }));
    out.predicted = out.headline.length;
    out.statusCounts = {};
    for (const h of out.headline) out.statusCounts[h.prediction.status] = (out.statusCounts[h.prediction.status] || 0) + 1;
    out.analysable = Math.max(b.analysable || 0, out.general.length);
    out.skipped = Math.max(0, out.analysable - out.predicted);
    // The accumulator is frozen once one of its legs has kicked off: the morning's acca keeps
    // its legs (and their results); a newer acca for the matches still to play sits beside it.
    const accStarted = (acc) => !!(acc && acc.options && acc.options.some((o) => (o.legs || []).some((l) => startedOf(String(l.fixtureId), { match: { date: l.kickoff } }))));
    if (a.accumulator && accStarted(a.accumulator)) {
      out.accumulator = { ...a.accumulator, frozen: true };
      const later = b.accumulator && b.accumulator.options && b.accumulator.options.length && !accStarted(b.accumulator) ? b.accumulator : null;
      if (later && JSON.stringify(later.options.map((o) => o.legs.map((l) => l.key + l.fixtureId))) !== JSON.stringify(a.accumulator.options.map((o) => o.legs.map((l) => l.key + l.fixtureId)))) out.accumulator.later = later;
    }
    return attachResults(out, t);
  }

  // ---------------------------------------------------------------- results
  function liveMatch(m, fx) {
    const f = fx.get(String(m.id));
    if (!f) return m;
    return {
      ...m,
      state: f.state,
      completed: f.completed,
      statusDetail: f.statusDetail,
      clock: f.clock,
      home: { ...m.home, score: f.home ? f.home.score : null },
      away: { ...m.away, score: f.away ? f.away.score : null },
    };
  }

  /** Outcome of one market key on a match: null before kick-off. */
  function outcomeOf(key, m) {
    if (!m || !key || m.state === 'pre' || m.state == null) return null;
    const hg = num(m.home && m.home.score);
    const ag = num(m.away && m.away.score);
    if (hg == null || ag == null) return { final: m.state === 'post', score: null, hit: null };
    const hit = settle(key, hg, ag);
    return { final: m.state === 'post', score: `${hg}-${ag}`, hit };
  }

  /** Outcome of a general (normal) prediction: every call it made. */
  function outcomeGeneral(g, m) {
    if (!g || !m || m.state === 'pre' || m.state == null) return null;
    const hg = num(m.home && m.home.score);
    const ag = num(m.away && m.away.score);
    if (hg == null || ag == null) return { final: m.state === 'post', score: null };
    const res = hg > ag ? 'H' : hg === ag ? 'D' : 'A';
    const value = (g.alternatives || []).find((x) => x.role === 'value');
    return {
      final: m.state === 'post',
      score: `${hg}-${ag}`,
      main: g.bestBet ? settle(g.bestBet.key, hg, ag) : null,
      value: value ? settle(value.key, hg, ag) : null,
      result: g.result ? (g.result.call === res ? 1 : 0) : null,
      goals: g.goals ? ((g.goals.call === 'Over') === (hg + ag > 2.5) ? 1 : 0) : null,
      btts: g.btts ? ((g.btts.call === 'Yes') === (hg > 0 && ag > 0) ? 1 : 0) : null,
      exact: g.score && g.score.predicted ? (g.score.predicted.score === `${hg}-${ag}` ? 1 : 0) : null,
    };
  }

  /**
   * Put live / final scores on every entry and a tick or cross on every pick.
   * Adds payload.summary: the day's running scoreboard.
   */
  function attachResults(payload, now) {
    if (!payload) return payload;
    const fx = fixtureMap(payload.fixtures, []);
    const tally = () => ({ won: 0, lost: 0, void: 0, live: 0, upcoming: 0 });
    const S = { main: tally(), value: tally(), methodology: tally(), result: tally(), goals: tally(), btts: tally(), exact: tally() };
    const add = (t, o, key) => {
      if (!o) return t.upcoming++;
      if (!o.final) return t.live++;
      const h = key ? o[key] : o.hit;
      if (h === 1) t.won++;
      else if (h === 0) t.lost++;
      else t.void++;
    };
    for (const e of payload.general || []) {
      e.match = liveMatch(e.match, fx);
      e.outcome = outcomeGeneral(e.general, e.match);
      if (e.general && e.general.bestBet) add(S.main, e.outcome, 'main');
      if (e.general && (e.general.alternatives || []).some((x) => x.role === 'value')) add(S.value, e.outcome, 'value');
      add(S.result, e.outcome, 'result');
      add(S.goals, e.outcome, 'goals');
      add(S.btts, e.outcome, 'btts');
      add(S.exact, e.outcome, 'exact');
    }
    for (const e of payload.headline || []) {
      e.match = liveMatch(e.match, fx);
      e.outcome = outcomeOf(e.prediction && e.prediction.pick && e.prediction.pick.key, e.match);
      add(S.methodology, e.outcome);
    }
    for (const list of Object.values(payload.byMethod || {})) {
      for (const e of list) {
        e.match = liveMatch(e.match, fx);
        e.outcome = outcomeOf(e.prediction && e.prediction.pick && e.prediction.pick.key, e.match);
      }
    }
    const accOutcome = (acc) => {
      if (!acc || !acc.options) return;
      const legFx = (l) => fx.get(String(l.fixtureId)) || { state: Date.parse(l.kickoff) <= (now || Date.now()) ? 'in' : 'pre' };
      for (const op of acc.options) {
        for (const l of op.legs || []) {
          const f = legFx(l);
          l.outcome = outcomeOf(l.key, { state: f.state, home: f.home || {}, away: f.away || {} });
        }
        const os = (op.legs || []).map((l) => l.outcome);
        const lost = os.some((o) => o && o.final && o.hit === 0);
        const done = os.every((o) => o && o.final);
        op.outcome = lost ? 'lost' : done ? (os.some((o) => o.hit === 1) ? 'won' : 'void') : os.some((o) => o) ? 'live' : 'pending';
      }
      if (acc.later) accOutcome(acc.later);
    };
    accOutcome(payload.accumulator);
    let finished = 0;
    let live = 0;
    let upcoming = 0;
    for (const f of fx.values()) {
      if (f.state === 'post') finished++;
      else if (f.state === 'in') live++;
      else upcoming++;
    }
    payload.summary = { finished, live, upcoming, ...S };
    return payload;
  }

  // ---------------------------------------------------------------- Strongest Picks
  /** Keep this morning's Strongest Picks once their matches have started. */
  function mergeStrongest(older, newer, now) {
    const t = now == null ? Date.now() : now;
    if (!newer) return older || null;
    if (!older || older.date !== newer.date) return newer;
    const have = new Set([...(newer.picks || []).map((p) => String(p.match.id)), ...(newer.earlier || []).map((e) => String(e.fixture))]);
    const carried = [];
    // this morning's picks whose matches have kicked off but which the newer copy no longer lists
    for (const p of older.picks || []) {
      const id = String(p.match.id);
      if (have.has(id) || !(Date.parse(p.match.date) <= t)) continue;
      have.add(id);
      carried.push({
        fixture: id, date: p.match.date, league: p.match.leagueName || p.match.league,
        home: p.match.home && p.match.home.name, away: p.match.away && p.match.away.name,
        group: p.pick.group, label: p.pick.label, prob: p.pick.prob, floor: p.pick.floor, tier: p.pick.tier,
        result: null, hit: null, savedInBrowser: true,
      });
    }
    // and anything already in the older "kicked off" list (e.g. the server lost its ledger in a restart)
    for (const e of older.earlier || []) {
      const id = String(e.fixture);
      if (have.has(id)) continue;
      have.add(id);
      carried.push({ ...e, savedInBrowser: true });
    }
    if (!carried.length) return newer;
    const earlier = [...(newer.earlier || []), ...carried].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
    return { ...newer, earlier };
  }

  return { RESET, dayKey, msToReset, zoned, settle, fixturesFrom, fixtureMap, mergePredictions, attachResults, mergeStrongest, outcomeOf, outcomeGeneral, predictedPreMatch };
});
