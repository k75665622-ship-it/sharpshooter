'use strict';

/**
 * sourcecheck.js — probe candidate free data sources from WHERE THE SERVER RUNS.
 *
 * Why: many football sites block data-centre addresses, and the build sandbox
 * could only reach GitHub. Whether a source works from Render can only be
 * learned by asking from Render. This reports, per source: reachable or not,
 * HTTP status, latency, and whether the body actually looks like the data we
 * would parse (so a Cloudflare challenge page does not count as "working").
 *
 * Read-only, one request per source, no crawling. Exposed at /api/sources-check
 * and via `npm run check:sources`.
 */

const UA = 'Mozilla/5.0 (compatible; SharpshooterSourceCheck/1.0)';
const TIMEOUT = 12000;

function season(offset = 0) {
  const now = new Date();
  const y = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1; // season starts ~Aug
  const s = y + offset;
  return String(s % 100).padStart(2, '0') + String((s + 1) % 100).padStart(2, '0');
}

const lines = (t) => t.split(/\r?\n/).filter(Boolean);

const PROBES = [
  {
    id: 'footballdata-current',
    name: 'football-data.co.uk — current season CSV',
    fills: 'Historical + current results WITH bookmaker odds (lets us test price edge)',
    url: () => `https://www.football-data.co.uk/mmz4281/${season(0)}/E0.csv`,
    check: (t) => {
      const [h, ...rows] = lines(t);
      const ok = /HomeTeam/.test(h) && /FTHG/.test(h);
      return { ok, detail: ok ? `${rows.length} matches; odds columns: ${['B365H', 'PSH', 'AvgH', 'B365>2.5'].filter((c) => h.includes(c)).join(', ') || 'none'}` : 'not a results CSV' };
    },
  },
  {
    id: 'footballdata-last',
    name: 'football-data.co.uk — previous season CSV',
    fills: 'Same, finished season (for backtesting prices)',
    url: () => `https://www.football-data.co.uk/mmz4281/${season(-1)}/E0.csv`,
    check: (t) => {
      const [h, ...rows] = lines(t);
      const ok = /HomeTeam/.test(h) && /FTHG/.test(h);
      return { ok, detail: ok ? `${rows.length} matches` : 'not a results CSV' };
    },
  },
  {
    id: 'fpl',
    name: 'Fantasy Premier League API (bootstrap-static)',
    fills: 'Premier League injuries, suspensions, doubts with percentage chance (England only)',
    url: () => 'https://fantasy.premierleague.com/api/bootstrap-static/',
    check: (t) => {
      const j = JSON.parse(t);
      const els = j.elements || [];
      const flagged = els.filter((e) => e.news && e.news.length).length;
      return { ok: els.length > 100, detail: `${els.length} players, ${flagged} with injury/availability news` };
    },
  },
  {
    id: 'clubelo',
    name: 'ClubElo CSV API',
    fills: 'Independent team strength (already used as the Elo witness)',
    url: () => 'http://api.clubelo.com/Arsenal',
    check: (t) => {
      const [h, ...rows] = lines(t);
      const ok = /Elo/i.test(h) && rows.length > 10;
      return { ok, detail: ok ? `${rows.length} rating rows` : 'unexpected format' };
    },
  },
  {
    id: 'openfootball',
    name: 'openfootball on GitHub',
    fills: 'Per-game results (already used)',
    url: () => 'https://raw.githubusercontent.com/openfootball/england/master/2024-25/1-premierleague.txt',
    check: (t) => ({ ok: t.length > 5000, detail: `${t.length} bytes` }),
  },
  {
    id: 'espn',
    name: 'ESPN scoreboard API',
    fills: 'Fixtures, form, DraftKings odds (already used)',
    url: () => 'https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard',
    check: (t) => {
      const j = JSON.parse(t);
      return { ok: Array.isArray(j.events), detail: `${(j.events || []).length} events` };
    },
  },
  {
    id: 'infersports',
    name: 'InferSports events API',
    fills: 'Asian-book odds (already used)',
    url: () => `https://api.infersports.dev/v1/events?date=${new Date().toISOString().slice(0, 10)}`,
    check: (t) => {
      const j = JSON.parse(t);
      const n = Array.isArray(j) ? j.length : (j.events || j.data || []).length;
      return { ok: n >= 0, detail: `${n} events` };
    },
  },
  {
    id: 'understat',
    name: 'Understat league page (HTML scrape)',
    fills: 'Shot-level xG for the top 5 leagues + Russia. Scraping: check their terms before relying on it.',
    url: () => 'https://understat.com/league/EPL',
    check: (t) => {
      const ok = /teamsData/.test(t);
      return { ok, detail: ok ? 'page contains embedded team data' : 'no embedded data (blocked or changed)' };
    },
  },
];

async function probe(p) {
  const url = p.url();
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA, accept: '*/*' }, signal: AbortSignal.timeout(TIMEOUT), redirect: 'follow' });
    const body = await res.text();
    const ms = Date.now() - t0;
    if (!res.ok) return { id: p.id, name: p.name, fills: p.fills, url, ok: false, status: res.status, ms, detail: `HTTP ${res.status}${/cloudflare|captcha|challenge/i.test(body.slice(0, 2000)) ? ' (bot challenge page)' : ''}` };
    let c;
    try { c = p.check(body); } catch (e) { c = { ok: false, detail: 'could not parse: ' + e.message }; }
    return { id: p.id, name: p.name, fills: p.fills, url, ok: c.ok, status: res.status, ms, bytes: body.length, detail: c.detail };
  } catch (e) {
    return { id: p.id, name: p.name, fills: p.fills, url, ok: false, status: null, ms: Date.now() - t0, detail: String((e && e.cause && e.cause.code) || e.message || e) };
  }
}

async function checkSources() {
  const results = await Promise.all(PROBES.map(probe));
  return { checkedAt: new Date().toISOString(), working: results.filter((r) => r.ok).length, total: results.length, results };
}

module.exports = { checkSources, PROBES };

if (require.main === module) {
  checkSources().then((r) => {
    console.log(`\nSource check — ${r.working}/${r.total} usable from this machine\n`);
    for (const x of r.results) console.log(`${x.ok ? 'OK  ' : 'FAIL'}  ${x.name}\n      ${x.detail}${x.ms != null ? ` (${x.ms} ms)` : ''}\n      fills: ${x.fills}\n`);
  });
}
