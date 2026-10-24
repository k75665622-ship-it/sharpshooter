'use strict';

/**
 * strongest/inputs.js — everything one fixture needs beyond the site's own analysis.
 *
 * Starts from the engine report (lib/engine.js analyseMatch) and adds, from free key-less
 * sources the site already crawls:
 *
 *   football-data.co.uk archive   corners won / conceded, cards, half-time goals per team,
 *                                 the league's baselines, its first-half goal share, the
 *                                 referee's card rate (England / Scotland name referees),
 *                                 head-to-head corners and cards
 *   Fantasy Premier League        each Premier League player's expected goals (xG), minutes,
 *                                 chance of playing
 *   ESPN match summary            each club's top scorers (every league) and the confirmed
 *                                 line-ups once they are published
 *
 * Every source is optional: a missing one leaves its views out, and the page says so.
 */

const espn = require('../espn');
const MK = require('../market');
const LG = require('../leagues');
const FDS = require('../crawler/sources/footballdata');
const WH = require('../crawler/warehouse');
const N = require('../sources/names');
const C = require('./config');
const MAR = require('./markets');

const DAY = 86400000;
const r3 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 1000);
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const shrink = (ratio, n, k) => (ratio == null || !Number.isFinite(ratio) ? 1 : (n * ratio + k) / (n + k));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ------------------------------------------------------------------ league environment

const envCache = new Map();

/** League baselines over the last year: corners, cards, first-half share, referees, dispersions. */
function leagueEnv(hist, div, day) {
  const key = `${div}|${day}`;
  if (envCache.has(key)) return envCache.get(key);
  const arr = (hist && hist.league && hist.league.get(div)) || [];
  const from = new Date(Date.parse(day + 'T00:00:00Z') - C.leagueDays * DAY).toISOString().slice(0, 10);
  const refFrom = new Date(Date.parse(day + 'T00:00:00Z') - 2 * C.leagueDays * DAY).toISOString().slice(0, 10);
  let n = 0;
  let goals = 0;
  let htGoals = 0;
  let htGoalsFt = 0;
  let htN = 0;
  const hc = [];
  const ac = [];
  const tc = [];
  const hk = [];
  const ak = [];
  const tk = [];
  const refs = new Map();
  for (const m of arr) {
    if (m.date >= day) break;
    const cardsH = m.hy != null ? m.hy + (m.hr || 0) : null;
    const cardsA = m.ay != null ? m.ay + (m.ar || 0) : null;
    if (m.date >= refFrom && m.referee && cardsH != null && cardsA != null) {
      const r = refs.get(m.referee) || { n: 0, cards: 0 };
      r.n++;
      r.cards += cardsH + cardsA;
      refs.set(m.referee, r);
    }
    if (m.date < from) continue;
    n++;
    goals += m.hg + m.ag;
    if (m.hthg != null && m.htag != null) {
      htN++;
      htGoals += m.hthg + m.htag;
      htGoalsFt += m.hg + m.ag;
    }
    if (m.hc != null && m.ac != null) {
      hc.push(m.hc);
      ac.push(m.ac);
      tc.push(m.hc + m.ac);
    }
    if (cardsH != null && cardsA != null) {
      hk.push(cardsH);
      ak.push(cardsA);
      tk.push(cardsH + cardsA);
    }
  }
  const variance = (xs) => {
    const mu = avg(xs);
    return xs.length > 1 ? xs.reduce((a, x) => a + (x - mu) * (x - mu), 0) / (xs.length - 1) : null;
  };
  const cornersOk = tc.length >= C.leagueMinMatches;
  const cardsOk = tk.length >= C.leagueMinMatches;
  const LH = cornersOk ? avg(hc) : null;
  const LA = cornersOk ? avg(ac) : null;
  let rCorners = C.cornersDispersion;
  if (cornersOk) {
    const v = variance(tc);
    const m = avg(tc);
    if (v != null && v > m) rCorners = clamp((LH * LH + LA * LA) / (v - m), C.dispersionRange[0], C.dispersionRange[1]);
    else rCorners = C.dispersionRange[1];
  }
  let rCards = C.cardsDispersion;
  if (cardsOk) {
    const v = variance(tk);
    const m = avg(tk);
    if (v != null && v > m) rCards = clamp((m * m) / (v - m), C.dispersionRange[0], C.dispersionRange[1]);
    else rCards = C.dispersionRange[1];
  }
  const share = htN >= 30 && htGoalsFt > 0 ? htGoals / htGoalsFt : null;
  const s1 = share != null ? (htN * share + C.firstHalfPrior * C.firstHalfShare) / (htN + C.firstHalfPrior) : C.firstHalfShare;
  const out = {
    div,
    n,
    goalsPerGame: n ? goals / n : null,
    firstHalf: { measured: share, matches: htN, used: s1 },
    corners: cornersOk ? { home: LH, away: LA, total: LH + LA, matches: tc.length, dispersion: rCorners } : null,
    cards: cardsOk ? { home: avg(hk), away: avg(ak), total: avg(tk), matches: tk.length, dispersion: rCards } : null,
    referees: refs,
  };
  envCache.set(key, out);
  if (envCache.size > 200) envCache.delete(envCache.keys().next().value);
  return out;
}

// ------------------------------------------------------------------ team summaries

const cardsOf = (g) => (g.yf != null ? g.yf + (g.rf || 0) : null);

/** Plain numbers about a team's recent games (newest first log), for the reasons and views. */
function teamFacts(log, venue) {
  const last = log.slice(0, 10);
  const atVenue = log.filter((g) => g.venue === venue).slice(0, 10);
  const res = (gs) => ({
    n: gs.length,
    w: gs.filter((g) => g.gf > g.ga).length,
    d: gs.filter((g) => g.gf === g.ga).length,
    l: gs.filter((g) => g.gf < g.ga).length,
    gf: gs.reduce((a, g) => a + g.gf, 0),
    ga: gs.reduce((a, g) => a + g.ga, 0),
    over25: gs.filter((g) => g.gf + g.ga > 2.5).length,
    over15: gs.filter((g) => g.gf + g.ga > 1.5).length,
    under35: gs.filter((g) => g.gf + g.ga < 3.5).length,
    btts: gs.filter((g) => g.gf > 0 && g.ga > 0).length,
    cleanSheets: gs.filter((g) => g.ga === 0).length,
    blanks: gs.filter((g) => g.gf === 0).length,
    scored2: gs.filter((g) => g.gf >= 2).length,
    scored3: gs.filter((g) => g.gf >= 3).length,
    conceded2: gs.filter((g) => g.ga >= 2).length,
    conceded3: gs.filter((g) => g.ga >= 3).length,
  });
  const withHt = last.filter((g) => g.htgf != null && g.htga != null);
  const withC = last.filter((g) => g.cf != null && g.ca != null);
  const withK = last.filter((g) => cardsOf(g) != null);
  const form = last.slice(0, 6).map((g) => (g.gf > g.ga ? 'W' : g.gf === g.ga ? 'D' : 'L')).join('');
  return {
    games: log.length,
    form,
    last10: res(last),
    venue10: res(atVenue),
    firstHalfGoals: withHt.length ? avg(withHt.map((g) => g.htgf + g.htga)) : null,
    firstHalfScored: withHt.filter((g) => g.htgf > 0).length,
    firstHalfN: withHt.length,
    cornersFor: withC.length ? avg(withC.map((g) => g.cf)) : null,
    cornersAgainst: withC.length ? avg(withC.map((g) => g.ca)) : null,
    cards: withK.length ? avg(withK.map(cardsOf)) : null,
    statsGames: withC.length,
    lastDate: log[0] ? log[0].date : null,
  };
}

// ------------------------------------------------------------------ corners and cards views

const mean = (gs, f) => {
  const xs = gs.map(f).filter((v) => v != null && Number.isFinite(v));
  return xs.length ? { v: avg(xs), n: xs.length } : { v: null, n: 0 };
};

/** Expected corners for one side under one window of games. */
function cornerRates(log, venue, base, n, venueWeight) {
  const all = log.slice(0, n);
  const ven = log.filter((g) => g.venue === venue).slice(0, Math.ceil(n / 2));
  const k = C.shrinkGames;
  const bVen = venue === 'H' ? base.home : base.away; // corners a side at this venue wins on average
  const bOpp = venue === 'H' ? base.away : base.home; // corners its opponent wins on average
  const bAll = (base.home + base.away) / 2;
  const cfA = mean(all, (g) => g.cf);
  const caA = mean(all, (g) => g.ca);
  const cfV = mean(ven, (g) => g.cf);
  const caV = mean(ven, (g) => g.ca);
  const att = venueWeight > 0
    ? venueWeight * shrink(cfV.v / bVen, cfV.n, k) + (1 - venueWeight) * shrink(cfA.v / bAll, cfA.n, k)
    : shrink(cfA.v / bAll, cfA.n, k);
  const def = venueWeight > 0
    ? venueWeight * shrink(caV.v / bOpp, caV.n, k) + (1 - venueWeight) * shrink(caA.v / bAll, caA.n, k)
    : shrink(caA.v / bAll, caA.n, k);
  return { att, def, games: cfA.n };
}

function cardRate(log, venue, base, n, venueWeight) {
  const all = log.slice(0, n);
  const ven = log.filter((g) => g.venue === venue).slice(0, Math.ceil(n / 2));
  const k = C.shrinkGames;
  const bVen = venue === 'H' ? base.home : base.away;
  const bAll = (base.home + base.away) / 2;
  const a = mean(all, cardsOf);
  const v = mean(ven, cardsOf);
  const rate = venueWeight > 0
    ? venueWeight * shrink(v.v / bVen, v.n, k) + (1 - venueWeight) * shrink(a.v / bAll, a.n, k)
    : shrink(a.v / bAll, a.n, k);
  return { rate, games: a.n };
}

function refereeFactor(env, name) {
  if (!env || !env.cards || !name) return null;
  const r = env.referees.get(name);
  if (!r || r.n < C.refereeMinGames) return { name, games: r ? r.n : 0, perGame: r && r.n ? r.cards / r.n : null, factor: 1, used: false };
  const ratio = r.cards / r.n / env.cards.total;
  const f = clamp(shrink(ratio, r.n, C.refereeShrinkGames), C.refereeRange[0], C.refereeRange[1]);
  return { name, games: r.n, perGame: r.cards / r.n, factor: f, used: true };
}

function h2hFacts(meetings, home, env) {
  if (!meetings || !meetings.length) return null;
  const n = meetings.length;
  let hw = 0;
  let dr = 0;
  let aw = 0;
  let goals = 0;
  const corners = [];
  const cards = [];
  for (const m of meetings) {
    const homeSide = m.home === home;
    const gH = homeSide ? m.hg : m.ag;
    const gA = homeSide ? m.ag : m.hg;
    if (gH > gA) hw++;
    else if (gH === gA) dr++;
    else aw++;
    goals += m.hg + m.ag;
    if (m.hc != null && m.ac != null) corners.push(m.hc + m.ac);
    if (m.hy != null && m.ay != null) cards.push(m.hy + m.ay + (m.hr || 0) + (m.ar || 0));
  }
  const cardsAvg = avg(cards);
  const cardFactor = env && env.cards && cards.length >= 2
    ? clamp(shrink(cardsAvg / env.cards.total, cards.length, C.h2hShrinkGames), C.h2hRange[0], C.h2hRange[1])
    : 1;
  return {
    n,
    homeWins: hw,
    draws: dr,
    awayWins: aw,
    goalsPerGame: goals / n,
    over25: meetings.filter((m) => m.hg + m.ag > 2.5).length,
    btts: meetings.filter((m) => m.hg > 0 && m.ag > 0).length,
    corners: corners.length ? { n: corners.length, perGame: avg(corners) } : null,
    cards: cards.length ? { n: cards.length, perGame: cardsAvg, factor: cardFactor } : null,
    last: meetings.slice(0, 5).map((m) => ({ date: m.date, home: m.home, away: m.away, score: `${m.hg}-${m.ag}` })),
  };
}

// ------------------------------------------------------------------ players

const FPL_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';
const FPL_TTL = 60 * 60 * 1000;

/** Premier League players with expected goals (Fantasy Premier League, key-less). */
async function fplPlayers() {
  const key = 'fpl:strongest:v1';
  const hit = espn.memGet(key);
  if (hit !== undefined) return hit;
  const disk = espn.diskGet(key, FPL_TTL);
  if (disk && disk.teams) {
    espn.memSet(key, disk, FPL_TTL);
    return disk;
  }
  return espn.cached(key + ':load', 60 * 1000, async () => {
    try {
      const res = await fetch(FPL_URL, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Sharpshooter/6.0)' } });
      if (!res.ok) return null;
      const j = await res.json();
      if (!j || !Array.isArray(j.teams) || !Array.isArray(j.elements)) return null;
      const slim = {
        teams: j.teams.map((t) => ({ id: t.id, name: t.name, short: t.short_name })),
        elements: j.elements.map((e) => ({
          web: e.web_name,
          first: e.first_name || '',
          second: e.second_name || '',
          team: e.team,
          pos: e.element_type,
          status: e.status,
          chance: e.chance_of_playing_next_round,
          news: e.news || '',
          minutes: Number(e.minutes) || 0,
          starts: Number(e.starts) || 0,
          xg: Number(e.expected_goals) || 0,
          goals: Number(e.goals_scored) || 0,
          pens: e.penalties_order != null ? Number(e.penalties_order) : null,
        })),
        fetchedAt: new Date().toISOString(),
      };
      espn.diskSet(key, slim);
      espn.memSet(key, slim, FPL_TTL);
      return slim;
    } catch {
      return null;
    }
  });
}

function availability(p) {
  if (p.status === 'a') return p.chance == null ? 1 : p.chance / 100;
  if (p.chance != null) return clamp(p.chance / 100, 0, 1);
  if (p.status === 'd') return 0.5;
  return 0;
}

const fold = (s) => N.fold(String(s || '')).replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
const surname = (s) => {
  const t = fold(s).split(' ').filter(Boolean);
  return t.length ? t[t.length - 1] : '';
};

/** Is this player in a confirmed line-up? 'start' | 'bench' | 'out' | null (no line-up yet). */
function lineupStatus(lineup, names) {
  if (!lineup) return null;
  const want = names.map(fold).filter(Boolean);
  const sur = names.map(surname).filter(Boolean);
  const hit = (list) => list.some((n) => {
    const f = fold(n);
    return want.includes(f) || sur.includes(surname(n)) || want.some((w) => w && f.includes(w));
  });
  if (hit(lineup.starters)) return 'start';
  if (hit(lineup.bench)) return 'bench';
  return 'out';
}

function involvementFrom(base, status) {
  if (status === 'start') return Math.max(base, 0.95);
  if (status === 'bench') return C.benchInvolvement;
  if (status === 'out') return 0;
  return base;
}

/** Top scorers per team from an ESPN summary (or scoreboard competitor) "leaders" block. */
function espnScorers(block, teamId) {
  const list = Array.isArray(block) ? block : [];
  const entry = list.find((x) => x && x.team && String(x.team.id) === String(teamId)) || null;
  const cats = entry ? entry.leaders || [] : list; // a scoreboard competitor's leaders is already the category list
  const goals = (cats || []).find((c) => c && /^goals/i.test(c.name || '')) || (cats || []).find((c) => c && /goal/i.test(c.displayName || ''));
  const rows = goals && Array.isArray(goals.leaders) ? goals.leaders : [];
  const out = [];
  for (const l of rows) {
    const a = l && l.athlete;
    const g = Number(l && l.value);
    if (!a || !(g > 0)) continue;
    const name = a.displayName || a.fullName || a.shortName;
    if (name && !out.some((x) => x.name === name)) out.push({ name, goals: g, id: a.id || null });
  }
  return out;
}

/** Confirmed line-ups from an ESPN summary, keyed by ESPN team id. */
function espnLineups(summary) {
  const out = {};
  const R = summary && Array.isArray(summary.rosters) ? summary.rosters : [];
  for (const r of R) {
    const tid = r && r.team && r.team.id;
    const list = r && Array.isArray(r.roster) ? r.roster : [];
    if (!tid || !list.length) continue;
    const nm = (p) => (p && p.athlete ? p.athlete.displayName || p.athlete.fullName || '' : '');
    const starters = list.filter((p) => p && p.starter).map(nm).filter(Boolean);
    const bench = list.filter((p) => p && !p.starter).map(nm).filter(Boolean);
    if (starters.length >= 11) out[String(tid)] = { starters, bench };
  }
  return out;
}

async function playersFor(report, summary, table, fd) {
  const m = report.match;
  const out = [];
  const lineups = espnLineups(summary);
  const lineupKnown = { home: !!lineups[String(m.home.id)], away: !!lineups[String(m.away.id)] };
  let source = null;

  // Premier League: every player's xG share from FPL
  if (m.league === 'eng.1') {
    const boot = await fplPlayers().catch(() => null);
    if (boot) {
      const names = boot.teams.flatMap((t) => [t.name, t.short]);
      for (const side of ['home', 'away']) {
        const hit = N.matchName(m[side].name, names);
        const team = hit ? boot.teams.find((t) => t.name === hit || t.short === hit) : null;
        if (!team) continue;
        const squad = boot.elements.filter((e) => e.team === team.id && e.pos !== 1);
        const teamXg = squad.reduce((a, p) => a + p.xg, 0);
        if (!(teamXg > 0)) continue;
        source = 'fpl';
        const lu = lineups[String(m[side].id)] || null;
        const rows = squad
          .map((p) => {
            const share = p.xg / teamXg;
            const av = availability(p);
            const st = lineupStatus(lu, [`${p.first} ${p.second}`, p.web]);
            return {
              name: p.web,
              fullName: `${p.first} ${p.second}`.trim(),
              side,
              team: m[side].name,
              share,
              involvement: involvementFrom(av, st),
              lineup: st,
              availability: av,
              xg: p.xg,
              goals: p.goals,
              minutes: p.minutes,
              penalties: p.pens === 1,
              news: p.news || '',
              source: 'Fantasy Premier League xG',
            };
          })
          .filter((p) => p.involvement > 0)
          .sort((a, b) => b.share * b.involvement - a.share * a.involvement)
          .slice(0, 3);
        out.push(...rows);
      }
    }
  }

  // Everywhere else (and as a fallback): ESPN's top scorers, as a share of the team's goals
  for (const side of ['home', 'away']) {
    if (out.some((p) => p.side === side)) continue;
    const tid = m[side].id;
    let scorers = summary ? espnScorers(summary.leaders, tid) : [];
    if (!scorers.length) {
      try {
        const raw = await espn.scoreboardRaw(m.league, espn.ymd(new Date(m.date)));
        const ev = (raw.events || []).find((e) => String(e.id) === String(m.id));
        const comp = ev && ev.competitions && ev.competitions[0];
        const c = comp ? (comp.competitors || []).find((x) => String(x.id) === String(tid) || (x.team && String(x.team.id) === String(tid))) : null;
        if (c) scorers = espnScorers(c.leaders, tid);
      } catch {
        /* optional */
      }
    }
    if (!scorers.length) continue;
    const row = table && fd && fd[side] ? table.rows.get(fd[side]) : null;
    const teamGoals = row && row.gf > 0 ? row.gf : boxGoals(summary, tid);
    if (!(teamGoals > 0)) continue;
    source = source || 'espn';
    const lu = lineups[String(tid)] || null;
    for (const s of scorers.slice(0, 2)) {
      const share = (s.goals + 0.5) / (teamGoals + 2);
      const st = lineupStatus(lu, [s.name]);
      const inv = involvementFrom(C.defaultInvolvement, st);
      if (inv <= 0) continue;
      out.push({ name: s.name, fullName: s.name, side, team: m[side].name, share, involvement: inv, lineup: st, goals: s.goals, teamGoals, source: 'ESPN top scorers' });
    }
  }
  return { players: out, source, lineupKnown };
}

function boxGoals(summary, tid) {
  const teams = summary && summary.boxscore && Array.isArray(summary.boxscore.teams) ? summary.boxscore.teams : [];
  const t = teams.find((x) => x && x.team && String(x.team.id) === String(tid));
  const st = t && Array.isArray(t.statistics) ? t.statistics.find((s) => s && s.name === 'totalGoals') : null;
  const v = st ? Number(st.displayValue != null ? st.displayValue : st.value) : null;
  return Number.isFinite(v) ? v : null;
}

// ------------------------------------------------------------------ goal views

function goalViews(report) {
  const out = [];
  const mdl = report.model || {};
  const ens = mdl.ensemble || {};
  const hasMarket = !!(ens.weights && ens.weights.market > 0);
  const byKey = Object.fromEntries((report.markets || []).map((mk) => [mk.key, mk]));
  if (hasMarket && mdl.lambda) {
    const cal = {};
    for (const [k, mk] of Object.entries(byKey)) if (mk.prob != null) cal[k] = mk.prob;
    out.push({ name: 'market', lamH: mdl.lambda.home, lamA: mdl.lambda.away, rho: mdl.rho, cal });
  }
  const ml = ens.modelLambda;
  if (ml && ml.lamH > 0 && ml.lamA > 0) {
    const cal = {};
    for (const [k, mk] of Object.entries(byKey)) if (mk.modelProb != null) cal[k] = mk.modelProb;
    out.push({ name: 'stats', lamH: ml.lamH, lamA: ml.lamA, rho: MK.rhoFor(ml.lamH + ml.lamA), cal });
  } else if (!hasMarket && mdl.lambda) {
    out.push({ name: 'stats', lamH: mdl.lambda.home, lamA: mdl.lambda.away, rho: mdl.rho, cal: Object.fromEntries(Object.entries(byKey).map(([k, mk]) => [k, mk.prob])) });
  }
  const I = report.intel;
  if (I && I.available && I.lam && I.lam.home > 0 && I.lam.away > 0) {
    const cal = {};
    for (const [k, p] of Object.entries(I.probs || {})) if (p != null) cal[k] = p;
    out.push({ name: 'factors', lamH: I.lam.home, lamA: I.lam.away, rho: MK.rhoFor(I.lam.home + I.lam.away), cal });
  }
  return { views: out, hasMarket };
}

// ------------------------------------------------------------------ one fixture

/**
 * @param {object} report  engine report for one fixture (analysable)
 * @returns {Promise<object>} the fixture's inputs: views for markets.price, context for the
 *                            pick rules, and facts for the reasons
 */
async function gather(report) {
  const m = report.match;
  const day = String(m.date || new Date().toISOString()).slice(0, 10);
  const lg = LG.get(m.league) || {};
  const sl = (report.model && report.model.statsLeague) || {};
  const homeSlug = lg.cup ? sl.home || m.league : m.league;
  const awaySlug = lg.cup ? sl.away || m.league : m.league;
  const sameLeague = homeSlug === awaySlug && !lg.cup;
  const divH = FDS.LEAGUES[homeSlug] ? FDS.LEAGUES[homeSlug].div : null;
  const divA = FDS.LEAGUES[awaySlug] ? FDS.LEAGUES[awaySlug].div : null;
  const I = report.intel && report.intel.available ? report.intel : null;

  const { views, hasMarket } = goalViews(report);

  const [hist, summary] = await Promise.all([
    divH || divA ? WH.historyFor([homeSlug, awaySlug], day).catch(() => null) : null,
    espn.summary(m.league, m.id).catch(() => null),
  ]);

  let fdHome = I && I.names ? I.names.home : null;
  let fdAway = I && I.names ? I.names.away : null;
  if (hist && divH && !fdHome) fdHome = await WH.resolveTeam(homeSlug, m.home.name, null, day).catch(() => null);
  if (hist && divA && !fdAway) fdAway = await WH.resolveTeam(awaySlug, m.away.name, null, day).catch(() => null);

  const homeLog = hist && divH && fdHome ? hist.teamLog(divH, fdHome, day, 40) : [];
  const awayLog = hist && divA && fdAway ? hist.teamLog(divA, fdAway, day, 40) : [];
  const envH = hist && divH ? leagueEnv(hist, divH, day) : null;
  const envA = hist && divA ? (divA === divH ? envH : leagueEnv(hist, divA, day)) : null;
  const env = sameLeague ? envH : envH && envA ? mergeEnv(envH, envA) : envH || envA;

  // timing: the league's measured first-half goal share
  const s1 = env && env.firstHalf ? env.firstHalf.used : C.firstHalfShare;
  const timing = MAR.defaultTiming(s1);

  // referee (football-data names them for England and Scotland) and head-to-head
  let referee = null;
  if (hist && divH && sameLeague && fdHome && fdAway) {
    const row = await WH.fixtureRow(divH, day, fdHome, fdAway).catch(() => null);
    if (row && row.referee) referee = refereeFactor(env, row.referee);
  }
  const meetings = hist && sameLeague && fdHome && fdAway ? hist.h2h(divH, fdHome, fdAway, day, 6, 10) : [];
  const h2h = h2hFacts(meetings, fdHome, env);

  // corners
  const cornerViews = [];
  if (env && env.corners && homeLog.length && awayLog.length) {
    const base = env.corners;
    const seasonH = cornerRates(homeLog, 'H', base, C.seasonGames, 0.5);
    const seasonA = cornerRates(awayLog, 'A', base, C.seasonGames, 0.5);
    const recentH = cornerRates(homeLog, 'H', base, C.recentGames, 0);
    const recentA = cornerRates(awayLog, 'A', base, C.recentGames, 0);
    if (seasonH.games && seasonA.games) {
      cornerViews.push({ name: 'season', home: base.home * seasonH.att * seasonA.def, away: base.away * seasonA.att * seasonH.def, r: base.dispersion, games: Math.min(seasonH.games, seasonA.games) });
      cornerViews.push({ name: 'recent', home: base.home * recentH.att * recentA.def, away: base.away * recentA.att * recentH.def, r: base.dispersion, games: Math.min(recentH.games, recentA.games) });
    }
  }

  // bookings
  const cardViews = [];
  if (env && env.cards && homeLog.length && awayLog.length) {
    const base = env.cards;
    const ref = referee && referee.used ? referee.factor : 1;
    const hf = h2h && h2h.cards ? h2h.cards.factor : 1;
    const sH = cardRate(homeLog, 'H', base, C.seasonGames, 0.5);
    const sA = cardRate(awayLog, 'A', base, C.seasonGames, 0.5);
    const rH = cardRate(homeLog, 'H', base, C.recentGames, 0);
    const rA = cardRate(awayLog, 'A', base, C.recentGames, 0);
    if (sH.games && sA.games) {
      cardViews.push({ name: 'season', mu: (base.home * sH.rate + base.away * sA.rate) * ref * hf, r: base.dispersion, games: Math.min(sH.games, sA.games) });
      cardViews.push({ name: 'recent', mu: (base.home * rH.rate + base.away * rA.rate) * ref * hf, r: base.dispersion, games: Math.min(rH.games, rA.games) });
    }
  }

  // players
  let table = null;
  if (hist && divH && sameLeague) {
    try {
      const season = require('../factors/records').seasonOf(day, divH);
      table = hist.table(divH, season, day);
    } catch {
      table = null;
    }
  }
  const pl = await playersFor(report, summary, table, { home: fdHome, away: fdAway }).catch(() => ({ players: [], source: null, lineupKnown: { home: false, away: false } }));

  // context for the pick rules
  const avoid = new Set(I && I.decision && I.decision.avoid ? I.decision.avoid.map((a) => a.key) : []);
  const ruleTraps = new Set(I && I.traps ? I.traps.filter((t) => t.kind === 'rule' && t.key).map((t) => t.key) : []);
  const shift = {};
  if (I && I.probs && I.base) for (const [k, p] of Object.entries(I.probs)) if (p != null && I.base[k] != null) shift[k] = p - I.base[k];
  const nr = report.newsRisk || { home: { level: 'none', items: [] }, away: { level: 'none', items: [] } };
  const highs = (s) => ((nr[s] && nr[s].items) || []).filter((x) => x.severity === 'high').length;
  const fpl = report.fpl || null;

  return {
    names: { home: m.home.name, away: m.away.name },
    goalViews: views,
    timing,
    cornerViews,
    cardViews,
    players: pl.players,
    ctx: {
      hasMarket,
      started: !(m.state === 'pre' && (!m.date || Date.parse(m.date) > Date.now())),
      avoid,
      ruleTraps,
      shift,
      news: {
        home: { level: nr.home ? nr.home.level : 'none', highs: highs('home') },
        away: { level: nr.away ? nr.away.level : 'none', highs: highs('away') },
      },
      fplAttackLoss: fpl ? { home: fpl.home.attackLoss, away: fpl.away.attackLoss } : null,
      archiveGames: { home: homeLog.length, away: awayLog.length },
      statsGames: {
        home: homeLog.slice(0, C.seasonGames).filter((g) => g.cf != null).length,
        away: awayLog.slice(0, C.seasonGames).filter((g) => g.cf != null).length,
      },
      crossLeague: !sameLeague,
      lineupKnown: pl.lineupKnown,
      playersSource: pl.source,
    },
    facts: {
      fd: { home: fdHome, away: fdAway },
      league: env ? {
        name: m.leagueName || lg.name || m.league,
        goalsPerGame: r3(env.goalsPerGame),
        firstHalf: { measured: r3(env.firstHalf.measured), matches: env.firstHalf.matches, used: r3(env.firstHalf.used) },
        corners: env.corners ? { home: r3(env.corners.home), away: r3(env.corners.away), matches: env.corners.matches, dispersion: r3(env.corners.dispersion) } : null,
        cards: env.cards ? { home: r3(env.cards.home), away: r3(env.cards.away), total: r3(env.cards.total), matches: env.cards.matches, dispersion: r3(env.cards.dispersion) } : null,
      } : { name: m.leagueName || lg.name || m.league },
      home: homeLog.length ? teamFacts(homeLog, 'H') : null,
      away: awayLog.length ? teamFacts(awayLog, 'A') : null,
      referee,
      h2h,
      table: I && I.table ? I.table : null,
      rest: I && I.context ? I.context.restAllComps : null,
      weather: I && I.context && I.context.weather ? I.context.weather : null,
      traps: I && I.traps ? I.traps : [],
    },
  };
}

/** Baselines for a cross-league tie: the mean of the two leagues. */
function mergeEnv(a, b) {
  const mid = (x, y) => (x != null && y != null ? (x + y) / 2 : x != null ? x : y);
  return {
    div: `${a.div}+${b.div}`,
    n: Math.min(a.n, b.n),
    goalsPerGame: mid(a.goalsPerGame, b.goalsPerGame),
    firstHalf: { measured: mid(a.firstHalf.measured, b.firstHalf.measured), matches: Math.min(a.firstHalf.matches, b.firstHalf.matches), used: mid(a.firstHalf.used, b.firstHalf.used) },
    corners: a.corners && b.corners ? { home: mid(a.corners.home, b.corners.home), away: mid(a.corners.away, b.corners.away), total: mid(a.corners.total, b.corners.total), matches: Math.min(a.corners.matches, b.corners.matches), dispersion: Math.min(a.corners.dispersion, b.corners.dispersion) } : null,
    cards: a.cards && b.cards ? { home: mid(a.cards.home, b.cards.home), away: mid(a.cards.away, b.cards.away), total: mid(a.cards.total, b.cards.total), matches: Math.min(a.cards.matches, b.cards.matches), dispersion: Math.min(a.cards.dispersion, b.cards.dispersion) } : null,
    referees: new Map(),
  };
}

function _reset() {
  envCache.clear();
}

module.exports = { gather, leagueEnv, teamFacts, cornerRates, cardRate, refereeFactor, h2hFacts, espnScorers, espnLineups, lineupStatus, fplPlayers, goalViews, availability, _reset };
