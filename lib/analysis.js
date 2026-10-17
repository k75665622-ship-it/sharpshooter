'use strict';

/**
 * analysis.js — the "sharpshooter" layer.
 *
 * Responsibilities:
 *   1. Build a league baseline from real team data (cached 12h on disk).
 *   2. Normalise an ESPN event into a clean match object.
 *   3. Assemble a full context (xG/xGA, form, H2H, standings, news, odds).
 *   4. Detect patterns — visible AND hidden.
 *   5. Detect bookmaker traps and hard-veto the affected markets.
 *   6. Score every market on the sharpshooter scale.
 *   7. Elect ONE banker market per match, and a daily Banker of the Day.
 */

const espn = require('./espn');
const M = require('./model');
const L = require('./leagues');
const IS = require('./infersports');
const HIST = require('./history');
const ELO = require('./elo');

/**
 * In-flight coalescing.
 *
 * Under concurrency several matches can request the same league baseline or
 * the team index at the same moment. Without this, each would independently
 * fire ~20 identical requests. Keyed by cache key, this guarantees one.
 */
const pending = new Map();

function coalesce(key, fn) {
  if (pending.has(key)) return pending.get(key);
  const p = (async () => {
    try {
      return await fn();
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, p);
  return p;
}

// ============================================================ league baseline

/**
 * Compute a league's scoring baseline from EVERY team in it.
 *
 * Caching strategy matters a lot here, because a naive implementation makes
 * hundreds of pointless requests:
 *   - Cup competitions never publish team statistics, so we skip the probe
 *     entirely and hand back a prior (the caller then blends the participants'
 *     domestic baselines instead).
 *   - Successful baselines are cached on disk for 12h.
 *   - Failed/prior baselines are cached too, but only for 1h, so we retry
 *     reasonably soon without hammering the API on every match.
 */
async function buildLeagueBaseline(slug, year) {
  const meta = L.get(slug);
  const cacheKey = `baseline:${slug}:${year}`;

  const cached = espn.diskGet(cacheKey);
  if (cached) {
    const isPrior = String(cached.source || '').startsWith('prior');
    const age = Date.now() - new Date(cached.builtAt || 0).getTime();
    if (!isPrior || age < 60 * 60 * 1000) return { ...cached, fromCache: true };
  }

  return coalesce(cacheKey, () => buildLeagueBaselineUncached(slug, year, cacheKey, meta));
}

async function buildLeagueBaselineUncached(slug, year, cacheKey, meta) {
  // Cups are never a statistics source — do not probe.
  if (meta.cup) {
    const p = priorBaseline(slug, 'prior-cup');
    espn.diskSet(cacheKey, p);
    return p;
  }

  const ids = await espn.teamList(slug, year);
  if (!ids.length) {
    const p = priorBaseline(slug, 'prior-no-teams');
    espn.diskSet(cacheKey, p);
    return p;
  }

  const stats = await espn.teamStatsMany(slug, year, ids, 10);
  const rows = Object.values(stats).filter(Boolean);
  if (rows.length < 4) {
    const p = priorBaseline(slug, 'prior-thin-data');
    espn.diskSet(cacheKey, p);
    return p;
  }

  let sumXg = 0;
  let sumXga = 0;
  let sumGf = 0;
  let sumGa = 0;
  let sumGp = 0;
  let sumHomeGoals = 0;
  let sumAwayGoals = 0;
  let n = 0;
  let xgTeams = 0;

  for (const r of rows) {
    const gp = num(r.appearances);
    if (!gp || gp < 1) continue;
    // Some leagues (e.g. Austria, smaller divisions) publish xG as 0.0 rather
    // than omitting it. Treat <= 0 as "not available" so it never poisons the
    // baseline or the ratings.
    const xgRaw = num(r.avgExpectedGoals);
    const xgaRaw = num(r.avgExpectedGoalsConceded);
    const xg = xgRaw && xgRaw > 0 ? xgRaw : null;
    const xga = xgaRaw && xgaRaw > 0 ? xgaRaw : null;
    const gf = num(r.totalGoals);
    const ga = num(r.goalsConceded);
    if (xg == null && gf == null) continue;

    if (xg != null) {
      sumXg += xg;
      sumXga += xga != null ? xga : xg;
      xgTeams++;
    }
    sumGf += gf != null ? gf : 1.35 * gp;
    sumGa += ga != null ? ga : 1.35 * gp;
    sumGp += gp;
    sumHomeGoals += num(r.homeGoals) || 0;
    sumAwayGoals += num(r.awayGoals) || 0;
    n++;
  }
  if (n < 4 || sumGp === 0) {
    const p = priorBaseline(slug, 'prior-insufficient');
    espn.diskSet(cacheKey, p);
    return p;
  }

  const goalsPerTeamPerGame = sumGf / sumGp;
  const totalGoals = sumHomeGoals + sumAwayGoals;
  const homeShare = totalGoals > 0 ? sumHomeGoals / totalGoals : 0.55;

  const baseline = {
    // xg is the mean across teams that actually publish it. When nobody does,
    // we fall back to the goals-based average and flag xgAvailable:false.
    xg: xgTeams > 0 ? sumXg / xgTeams : goalsPerTeamPerGame,
    xga: xgTeams > 0 ? sumXga / xgTeams : goalsPerTeamPerGame,
    xgAvailable: xgTeams >= Math.max(2, n * 0.5),
    goalsPerTeamPerGame,
    goalsPerGame: goalsPerTeamPerGame * 2,
    homeShare: clampRange(homeShare, 0.45, 0.65),
    teams: n,
    games: sumGp,
    source: 'espn-team-stats',
    builtAt: new Date().toISOString(),
  };
  espn.diskSet(cacheKey, baseline);
  return baseline;
}

function priorBaseline(slug, source) {
  // Empirical long-run priors. Used ONLY when the live feed is unavailable,
  // and flagged as such in the UI so the user always knows the provenance.
  const tier = L.get(slug).tier;
  const goalsPerGame = tier <= 2 ? 2.72 : tier === 3 ? 2.55 : 2.45;
  return {
    xg: goalsPerGame / 2,
    xga: goalsPerGame / 2,
    xgAvailable: false,
    goalsPerTeamPerGame: goalsPerGame / 2,
    goalsPerGame,
    homeShare: 0.55,
    teams: 0,
    games: 0,
    source,
    builtAt: new Date().toISOString(),
  };
}

// ============================================================ event normalising

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function clampRange(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

/** Normalise one ESPN scoreboard event into our match shape. */
function normaliseEvent(event, slug) {
  const comp = (event.competitions || [])[0];
  if (!comp) return null;
  const league = L.get(slug);

  const competitors = comp.competitors || [];
  const home = competitors.find((c) => c.homeAway === 'home');
  const away = competitors.find((c) => c.homeAway === 'away');
  if (!home || !away) return null;

  const status = comp.status || event.status || {};
  const state = status.type ? status.type.state : 'pre';

  return {
    id: event.id,
    league: slug,
    leagueName: league.name,
    leagueFlag: league.flag,
    leagueTier: league.tier,
    country: league.country,
    date: event.date,
    name: event.name,
    shortName: event.shortName,
    venue: (comp.venue && comp.venue.fullName) || (event.venue && event.venue.fullName) || null,
    city: comp.venue && comp.venue.address ? comp.venue.address.city : null,
    state,
    completed: !!(status.type && status.type.completed),
    statusDetail: status.type ? status.type.shortDetail : '',
    clock: status.displayClock || null,
    home: {
      id: home.id || (home.team && home.team.id),
      name: (home.team && home.team.displayName) || 'Home',
      short: (home.team && home.team.abbreviation) || 'HOM',
      logo: (home.team && home.team.logo) || null,
      color: (home.team && home.team.color) || null,
      form: home.form || null,
      record: firstRecord(home),
      score: home.score != null ? num(home.score) : null,
      winner: !!home.winner,
    },
    away: {
      id: away.id || (away.team && away.team.id),
      name: (away.team && away.team.displayName) || 'Away',
      short: (away.team && away.team.abbreviation) || 'AWY',
      logo: (away.team && away.team.logo) || null,
      color: (away.team && away.team.color) || null,
      form: away.form || null,
      record: firstRecord(away),
      score: away.score != null ? num(away.score) : null,
      winner: !!away.winner,
    },
    odds: extractOdds(comp.odds),
    broadcasts: (comp.broadcasts || []).map((b) => (b.names || []).join('/')).filter(Boolean),
  };
}

function firstRecord(comp) {
  const recs = comp.records || [];
  const all = recs.find((r) => r.type === 'total') || recs[0];
  return all ? all.summary : null;
}

/**
 * Pull the book odds out of the scoreboard payload, keeping BOTH the open and
 * the close price — the open->close drift is one of the strongest sharp-money
 * signals available for free.
 */
function extractOdds(oddsArr) {
  if (!Array.isArray(oddsArr) || !oddsArr.length) return null;
  // ESPN occasionally emits a null placeholder in the odds array.
  const o = oddsArr.find((x) => x && (x.moneyline || x.total || x.pointSpread || x.provider));
  if (!o) return null;
  const out = {
    provider: (o.provider && o.provider.name) || 'Unknown',
    homeOpen: null,
    homeClose: null,
    awayOpen: null,
    awayClose: null,
    drawOpen: null,
    drawClose: null,
    totalLine: null,
    totalOpen: null,
    overOpen: null,
    overClose: null,
    underOpen: null,
    underClose: null,
    spread: null,
    details: o.details || null,
  };

  const ml = o.moneyline || {};
  if (ml.home) {
    out.homeOpen = M.americanToDecimal(ml.home.open && ml.home.open.odds);
    out.homeClose = M.americanToDecimal((ml.home.close && ml.home.close.odds) || (ml.home.open && ml.home.open.odds));
  }
  if (ml.away) {
    out.awayOpen = M.americanToDecimal(ml.away.open && ml.away.open.odds);
    out.awayClose = M.americanToDecimal((ml.away.close && ml.away.close.odds) || (ml.away.open && ml.away.open.odds));
  }
  if (o.drawOdds) {
    out.drawClose = M.americanToDecimal(o.drawOdds.moneyLine);
    out.drawOpen = out.drawClose;
  }

  if (o.total) {
    const ov = o.total.over || {};
    const un = o.total.under || {};
    const lineStr = (ov.close && ov.close.line) || (ov.open && ov.open.line) || null;
    if (lineStr) {
      const m = /([ou])(\d+(?:\.\d+)?)/.exec(String(lineStr));
      if (m) out.totalLine = parseFloat(m[2]);
    }
    out.overOpen = M.americanToDecimal(ov.open && ov.open.odds);
    out.overClose = M.americanToDecimal((ov.close && ov.close.odds) || (ov.open && ov.open.odds));
    out.underOpen = M.americanToDecimal(un.open && un.open.odds);
    out.underClose = M.americanToDecimal((un.close && un.close.odds) || (un.open && un.open.odds));
    if (o.overUnder != null) out.totalLine = num(o.overUnder);
  }

  if (o.pointSpread) {
    out.spread = {
      home: o.pointSpread.home ? M.americanToDecimal((o.pointSpread.home.close || o.pointSpread.home.open || {}).odds) : null,
      away: o.pointSpread.away ? M.americanToDecimal((o.pointSpread.away.close || o.pointSpread.away.open || {}).odds) : null,
      line: o.pointSpread.home ? num((o.pointSpread.home.close || o.pointSpread.home.open || {}).line) : null,
    };
  }
  return out;
}

// ============================================================ team resolution

/**
 * Global index: teamId -> domestic league slug.
 *
 * Needed because cup competitions (Champions League, Europa League, domestic
 * cups) do NOT publish per-team season statistics. A club's real statistical
 * profile lives in its domestic league, so we resolve it from there.
 *
 * Two rules matter here:
 *   - Cup competitions are skipped entirely. They are not a stats source, and
 *     including them would map clubs to a competition with no data.
 *   - When a club appears in several leagues, the highest-priority league in
 *     the registry wins (domestic divisions are listed before secondary ones).
 *     Because fetches run concurrently, priority is resolved AFTER collection,
 *     never by arrival order.
 *
 * Built once and cached on disk for 24h.
 */
async function buildTeamIndex() {
  const cacheKey = 'teamIndex:v2';
  const cached = espn.diskGet(cacheKey, 24 * 60 * 60 * 1000);
  if (cached) return cached;
  return coalesce(cacheKey, () => buildTeamIndexUncached(cacheKey));
}

async function buildTeamIndexUncached(cacheKey) {
  const registry = L.all();
  const priority = new Map(registry.map((l, i) => [l.slug, i]));
  const candidates = registry.filter((l) => !l.cup).map((l) => l.slug);

  const collected = []; // { teamId, slug, name }
  const queue = [...candidates];

  async function worker() {
    while (queue.length) {
      const slug = queue.shift();
      const teams = await espn.siteTeamList(slug);
      for (const t of teams) collected.push({ teamId: String(t.id), slug, name: t.name });
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));

  const index = {};
  for (const c of collected) {
    const prev = index[c.teamId];
    if (!prev || (priority.get(c.slug) ?? 999) < (priority.get(prev.slug) ?? 999)) {
      index[c.teamId] = { slug: c.slug, name: c.name };
    }
  }

  espn.diskSet(cacheKey, index);
  return index;
}

/**
 * Resolve where a team's real season statistics live.
 * Returns { slug, stats } or null.
 */
async function resolveTeamStats(competitionSlug, year, teamId, teamIndex) {
  // 1. Same competition — works for domestic leagues.
  const direct = await espn.teamStats(competitionSlug, year, teamId);
  if (direct && num(direct.appearances) > 0) return { slug: competitionSlug, stats: direct, via: 'competition' };

  // 2. Fall back to the club's domestic league.
  const idx = teamIndex || (await buildTeamIndex());
  const entry = idx[String(teamId)];
  if (entry && entry.slug !== competitionSlug) {
    const alt = await espn.teamStats(entry.slug, year, teamId);
    if (alt && num(alt.appearances) > 0) return { slug: entry.slug, stats: alt, via: 'domestic:' + entry.slug };
  }

  return direct ? { slug: competitionSlug, stats: direct, via: 'competition-empty' } : null;
}

// ============================================================ context assembly

/** Team season stats -> the model's input row. */
function toModelRow(stats) {
  if (!stats) return null;
  const gp = num(stats.appearances);
  if (!gp) return null;
  const xgRaw = num(stats.avgExpectedGoals);
  const xgaRaw = num(stats.avgExpectedGoalsConceded);
  return {
    gp,
    // Treat 0.0 as unavailable, not as a genuine zero.
    xg: xgRaw && xgRaw > 0 ? xgRaw : null,
    xga: xgaRaw && xgaRaw > 0 ? xgaRaw : null,
    gf: num(stats.totalGoals),
    ga: num(stats.goalsConceded),
    homeGoals: num(stats.homeGoals),
    awayGoals: num(stats.awayGoals),
    shots: num(stats.totalShots),
    shotsOnTarget: num(stats.shotsOnTarget),
    possession: num(stats.possessionPct),
    passPct: num(stats.passPct),
    cleanSheets: num(stats.cleanSheet),
    saves: num(stats.saves),
    yellow: num(stats.yellowCards),
    red: num(stats.redCards),
    suspensions: num(stats.suspensions),
    bigChances: num(stats.bigChanceCreated),
    conversion: num(stats.goalConversion),
    penaltyConceded: num(stats.penaltyKickConceded),
    fouls: num(stats.foulsCommitted),
  };
}

/** Last-5 form from the summary endpoint. */
function parseLastFive(lastFiveGames, teamId) {
  const block = (lastFiveGames || []).find((b) => String(b.team && b.team.id) === String(teamId));
  if (!block || !block.events) return null;
  let gf = 0;
  let ga = 0;
  let w = 0;
  let d = 0;
  let l = 0;
  const seq = [];
  const dates = [];
  const games = [];
  for (const ev of block.events) {
    const isHome = ev.homeTeamId === String(teamId) || ev.atVs === 'vs';
    const sc = String(ev.score || '').split('-').map((x) => parseInt(x, 10));
    if (sc.length !== 2 || sc.some((x) => !Number.isFinite(x))) continue;
    if (ev.gameDate) dates.push(ev.gameDate);
    const [hs, as] = sc;
    const own = isHome ? hs : as;
    const opp = isHome ? as : hs;
    games.push({ gf: own, ga: opp, venue: isHome ? 'H' : 'A', date: ev.gameDate || null });
    gf += own;
    ga += opp;
    if (own > opp) {
      w++;
      seq.push('W');
    } else if (own === opp) {
      d++;
      seq.push('D');
    } else {
      l++;
      seq.push('L');
    }
  }
  const n = seq.length;
  if (!n) return null;
  dates.sort((a, b) => new Date(b) - new Date(a));
  return {
    n,
    gf,
    ga,
    w,
    d,
    l,
    ppg: (w * 3 + d) / n,
    gfPerGame: gf / n,
    gaPerGame: ga / n,
    seq: seq.reverse().join(''),
    lastGameDate: dates[0] || null,
    // Per-game rows, newest first — the methodology layer needs the 0/1/2+ goal
    // distribution, which an aggregate cannot give.
    games: games.sort((a, b) => (b.date ? new Date(b.date) : 0) - (a.date ? new Date(a.date) : 0)),
  };
}

/** Head-to-head history from the seasonseries block. */
function parseH2H(seasonseries, homeId, awayId) {
  const series = (seasonseries || []).find((s) => s.type === 'head-to-head');
  if (!series || !series.events) return null;
  let homeGoals = 0;
  let awayGoals = 0;
  let n = 0;
  let btts = 0;
  let over25 = 0;
  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;
  const recent = [];
  const allGames = [];

  for (const ev of series.events) {
    if (ev.statusType && ev.statusType.state && ev.statusType.state !== 'post') continue;
    const comps = ev.competitors || [];
    const h = comps.find((c) => c.homeAway === 'home');
    const a = comps.find((c) => c.homeAway === 'away');
    if (!h || !a) continue;
    const hs = num(h.score);
    const as = num(a.score);
    if (hs == null || as == null) continue;

    // Orient every historical match to the CURRENT home/away teams.
    const currentHomeWasHome = String(h.team.id) === String(homeId);
    const curHomeGoals = currentHomeWasHome ? hs : as;
    const curAwayGoals = currentHomeWasHome ? as : hs;

    homeGoals += curHomeGoals;
    awayGoals += curAwayGoals;
    n++;
    if (hs > 0 && as > 0) btts++;
    if (hs + as > 2.5) over25++;
    if (curHomeGoals > curAwayGoals) homeWins++;
    else if (curHomeGoals < curAwayGoals) awayWins++;
    else draws++;

    recent.push({
      date: ev.date,
      label: `${curHomeGoals}-${curAwayGoals}`,
      homeAway: currentHomeWasHome ? 'H' : 'A',
    });
    allGames.push({ hg: curHomeGoals, ag: curAwayGoals, date: ev.date || null });
  }
  if (!n) return null;
  return {
    n,
    homeGoals,
    awayGoals,
    homeGoalsPerGame: homeGoals / n,
    awayGoalsPerGame: awayGoals / n,
    bttsRate: btts / n,
    over25Rate: over25 / n,
    homeWins,
    awayWins,
    draws,
    recent: recent.slice(0, 5),
    games: allGames,
    summary: series.summary || null,
  };
}

/** Standings row for a team. */
function parseStanding(standings, teamId) {
  const groups = (standings && standings.groups) || [];
  for (const g of groups) {
    const entries = (g.standings && g.standings.entries) || [];
    const e = entries.find((x) => String(x.id) === String(teamId));
    if (e) {
      const get = (n) => {
        const s = (e.stats || []).find((st) => st.name === n);
        return s ? s.value : null;
      };
      return {
        rank: get('rank'),
        gp: get('gamesPlayed'),
        w: get('wins'),
        d: get('ties'),
        l: get('losses'),
        pts: get('points'),
        gd: get('pointDifferential'),
      };
    }
  }
  return null;
}

/** Build the full analysis context for one match. */
async function buildContext(match, year) {
  const slug = match.league;

  const [summary, homeRes, awayRes] = await Promise.all([
    espn.summary(slug, match.id),
    resolveTeamStats(slug, year, match.home.id),
    resolveTeamStats(slug, year, match.away.id),
  ]);

  // Baseline: prefer the competition's own. For cups (which have no published
  // team stats) average the domestic baselines of the two participants, which
  // is the most defensible environment estimate available.
  let baseline = await buildLeagueBaseline(slug, year);
  if (baseline.source !== 'espn-team-stats') {
    const sources = [homeRes, awayRes]
      .filter((r) => r && r.via && r.via.startsWith('domestic:'))
      .map((r) => r.via.split(':')[1]);
    const uniq = [...new Set(sources)];
    if (uniq.length) {
      const baselines = await Promise.all(uniq.map((s) => buildLeagueBaseline(s, year)));
      const valid = baselines.filter((b) => b.source === 'espn-team-stats');
      if (valid.length) {
        baseline = {
          ...valid[0],
          xg: valid.reduce((a, b) => a + b.xg, 0) / valid.length,
          xga: valid.reduce((a, b) => a + b.xga, 0) / valid.length,
          goalsPerTeamPerGame: valid.reduce((a, b) => a + b.goalsPerTeamPerGame, 0) / valid.length,
          goalsPerGame: valid.reduce((a, b) => a + b.goalsPerGame, 0) / valid.length,
          homeShare: valid.reduce((a, b) => a + b.homeShare, 0) / valid.length,
          source: 'espn-team-stats:blended(' + uniq.join('+') + ')',
        };
      }
    }
  }

  const homeRow = toModelRow(homeRes && homeRes.stats);
  const awayRow = toModelRow(awayRes && awayRes.stats);

  const form = summary
    ? {
        home: parseLastFive(summary.lastFiveGames, match.home.id),
        away: parseLastFive(summary.lastFiveGames, match.away.id),
      }
    : { home: null, away: null };

  const h2h = summary ? parseH2H(summary.seasonseries, match.home.id, match.away.id) : null;

  const standings = summary
    ? {
        home: parseStanding(summary.standings, match.home.id),
        away: parseStanding(summary.standings, match.away.id),
      }
    : { home: null, away: null };

  const news = summary && summary.news && summary.news.articles ? summary.news.articles.slice(0, 6) : [];
  const pickcenter = summary && summary.pickcenter ? summary.pickcenter : [];

  // Secondary odds source: Asian books + Pinnacle, keyless. Supplies multi-line
  // handicap/total prices and half-time markets that ESPN does not publish.
  // Purely additive — a null here means the engine runs exactly as before.
  //
  // This costs one request from a 200/day free quota, so we only spend it on a
  // fixture we can actually rate. An unratable fixture can never produce a
  // prediction, so its odds would be pure waste. We also record *why* the
  // source is absent so the UI can be honest about it rather than silently
  // showing ESPN-only pricing.
  let asian = null;
  let asianNote = null;
  if (!homeRow || !awayRow) {
    asianNote = 'not requested — fixture is not ratable';
  } else if (!IS.quotaSnapshot().open) {
    asianNote = 'daily quota exhausted — ESPN pricing only';
  } else {
    try {
      const dateYmd = String(match.date || '').slice(0, 10);
      if (dateYmd && match.home && match.away) {
        asian = await IS.consensusFor(dateYmd, match.home.name, match.away.name);
        if (!asian) {
          // Distinguish "this fixture isn't covered" from "we just ran out of
          // quota". The fixture that trips the breaker would otherwise be
          // mislabelled as having no coverage at all.
          asianNote = IS.quotaSnapshot().open
            ? 'no Asian book coverage for this fixture'
            : 'daily quota exhausted — ESPN pricing only';
        }
      }
    } catch {
      asian = null;
      asianNote = 'Asian book request failed';
    }
  }

  // Which league each team's statistics actually came from. For a domestic
  // league match this is the competition itself; for a cup tie it is the
  // club's home division. This is what makes cross-league strength correction
  // possible.
  const statsLeague = (res) => {
    if (!res) return slug;
    if (res.via && res.via.startsWith('domestic:')) return res.via.slice('domestic:'.length);
    return res.slug || slug;
  };
  const homeStatsLeague = statsLeague(homeRes);
  const awayStatsLeague = statsLeague(awayRes);

  // Free, key-less extra evidence for the methodology layer. Both are purely
  // additive and return null on any failure, so the engine behaves exactly as
  // before when they are unreachable.
  //   - hist: real per-game results (0/1/2+ goal distribution over 8-12 games)
  //   - elo:  an independent strength rating, used as a corroborating witness
  const kickoff = match.date ? new Date(match.date) : new Date();
  const histHome = HIST.covers(slug) ? slug : homeStatsLeague;
  const histAway = HIST.covers(slug) ? slug : awayStatsLeague;
  const [hist, elo] = await Promise.all([
    HIST.bundleFor(histHome, match.home.name, match.away.name, kickoff, histAway).catch(() => null),
    ELO.eloFor(slug, match.home.name, match.away.name, kickoff.toISOString()).catch(() => null),
  ]);

  return {
    match,
    baseline,
    homeRow,
    awayRow,
    homeVia: homeRes ? homeRes.via : null,
    awayVia: awayRes ? awayRes.via : null,
    homeStatsLeague,
    awayStatsLeague,
    homeStrength: L.strength(homeStatsLeague),
    awayStrength: L.strength(awayStatsLeague),
    form,
    h2h,
    hist,
    elo,
    standings,
    news,
    pickcenter,
    asian,
    asianNote,
    summaryOdds: summary && summary.odds ? summary.odds : [],
    gameInfo: summary && summary.gameInfo ? summary.gameInfo : null,
  };
}

module.exports = {
  buildLeagueBaseline,
  buildTeamIndex,
  resolveTeamStats,
  normaliseEvent,
  extractOdds,
  buildContext,
  parseLastFive,
  parseH2H,
  parseStanding,
  toModelRow,
  num,
  clampRange,
  priorBaseline,
};
