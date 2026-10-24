'use strict';

/**
 * test/strongest_record.js — the Strongest Picks track record, offline.
 *
 *   node test/strongest_record.js
 *
 * Writes picks to a temporary data directory, stubs ESPN and football-data.co.uk with
 * finished matches in their live shapes, settles, and checks every result.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-strongest-'));
process.env.SHARPSHOOTER_DATA_DIR = TMP;

const REC = require('../lib/strongest/record');

let pass = 0;
let fail = 0;
function t(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail != null ? ' — ' + detail : ''}`);
  }
}

const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const past = new Date(Date.now() - 3 * DAY);
const old = new Date(Date.now() - 12 * DAY);
const dayISO = iso(past);
const kick = `${dayISO}T15:00:00Z`;
const ymd = (s) => s.replace(/-/g, '');
const ddmmyyyy = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;

// ------------------------------------------------------------------ stubbed internet
const scoreboard = {
  events: [
    {
      id: 'f1',
      competitions: [{
        status: { type: { state: 'post', completed: true } },
        competitors: [{ id: '1', homeAway: 'home', score: '2' }, { id: '2', homeAway: 'away', score: '0' }],
        details: [
          { type: { text: 'Goal' }, scoringPlay: true, clock: { value: 700, displayValue: "12'" }, team: { id: '1' }, athletesInvolved: [{ displayName: 'Erling Haaland' }] },
          { type: { text: 'Yellow Card' }, yellowCard: true, clock: { displayValue: "30'" }, team: { id: '2' }, athletesInvolved: [{ displayName: 'A Defender' }] },
          { type: { text: 'Goal' }, scoringPlay: true, clock: { displayValue: "70'" }, team: { id: '1' }, athletesInvolved: [{ displayName: 'Phil Foden' }] },
        ],
      }],
    },
    {
      id: 'f2',
      competitions: [{
        status: { type: { state: 'post', completed: true } },
        competitors: [{ id: '3', homeAway: 'home', score: { value: 1, displayValue: '1' } }, { id: '4', homeAway: 'away', score: { value: 1, displayValue: '1' } }],
        details: [],
      }],
    },
  ],
};
const FD_CSV = [
  'Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,HTHG,HTAG,HTR,HS,AS,HST,AST,HF,AF,HC,AC,HY,AY,HR,AR,B365H,B365D,B365A',
  `E0,${ddmmyyyy(dayISO)},15:00,Arsenal,Everton,1,1,D,0,1,A,15,6,5,2,9,12,9,2,1,3,0,0,1.44,4.2,7.0`,
].join('\n');

const realFetch = global.fetch;
global.fetch = async (input) => {
  const u = new URL(String(input && input.url ? input.url : input));
  const reply = (status, body, type = 'application/json') => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': type } });
  if (u.hostname === 'site.api.espn.com') {
    if (/\/eng\.1\/scoreboard$/.test(u.pathname) && u.searchParams.get('dates') === ymd(dayISO)) return reply(200, scoreboard);
    return reply(200, { events: [] });
  }
  if (u.hostname === 'www.football-data.co.uk') {
    if (u.pathname === '/robots.txt') return reply(200, 'User-agent: *\nDisallow: /cgi-bin/\n', 'text/plain');
    if (u.pathname === '/mmz4281/2627/E0.csv') return reply(200, FD_CSV, 'text/csv');
    return reply(404, 'not found', 'text/plain');
  }
  return reply(404, {});
};

// ------------------------------------------------------------------ entries
const base = (o) => ({ league: 'eng.1', leagueName: 'Premier League', date: kick, prob: 0.8, floor: 0.78, views: {}, recordedAt: new Date().toISOString(), result: null, hit: null, fd: null, player: null, ...o });
const entries = {
  a: base({ kind: 'pick', fixture: 'f1', home: 'Man City', away: 'Aston Villa', group: 'Half', key: 'H2_O0.5', label: '2nd half over 0.5 goals', tier: 'Strong' }),
  b: base({ kind: 'card', fixture: 'f1', home: 'Man City', away: 'Aston Villa', group: 'Minutes', key: 'M15_Y', label: 'Goal in minutes 1-15: Yes' }),
  c: base({ kind: 'card', fixture: 'f1', home: 'Man City', away: 'Aston Villa', group: 'Players', key: 'PL_H_0', label: 'Haaland to score', player: { name: 'Haaland', fullName: 'Erling Haaland' } }),
  d: base({ kind: 'card', fixture: 'f1', home: 'Man City', away: 'Aston Villa', group: 'Bookings', key: 'K_U3.5', label: 'Under 3.5 cards' }),
  e: base({ kind: 'pick', fixture: 'f2', home: 'Arsenal', away: 'Everton', fd: { home: 'Arsenal', away: 'Everton' }, group: 'Corners', key: 'C_O8.5', label: 'Over 8.5 corners', tier: 'Strong' }),
  f: base({ kind: 'card', fixture: 'f2', home: 'Arsenal', away: 'Everton', fd: { home: 'Arsenal', away: 'Everton' }, group: 'Half', key: 'HT_X', label: 'Half-time: Draw' }),
  g: base({ kind: 'card', fixture: 'f2', home: 'Arsenal', away: 'Everton', fd: { home: 'Arsenal', away: 'Everton' }, group: 'Bookings', key: 'K_O3.5', label: 'Over 3.5 cards' }),
  h: base({ kind: 'card', fixture: 'f2', home: 'Arsenal', away: 'Everton', fd: { home: 'Arsenal', away: 'Everton' }, group: 'Minutes', key: 'M30_N', label: 'Goal in minutes 1-30: No' }),
  i: base({ kind: 'card', fixture: 'f2', home: 'Arsenal', away: 'Everton', fd: { home: 'Arsenal', away: 'Everton' }, group: 'Match', key: 'X', label: 'Draw' }),
  j: base({ kind: 'pick', fixture: 'f9', home: 'Lost FC', away: 'Nowhere', date: `${iso(old)}T15:00:00Z`, group: 'Match', key: '1', label: 'Lost FC to win', tier: 'Solid' }),
};
const byMonth = {};
for (const [k, e] of Object.entries(entries)) {
  const ym = e.date.slice(0, 7);
  (byMonth[ym] = byMonth[ym] || {})[`${e.fixture}|${k}`] = e;
}
fs.mkdirSync(REC.DIR, { recursive: true });
for (const [ym, book] of Object.entries(byMonth)) fs.writeFileSync(path.join(REC.DIR, `strongest-${ym}.json`), JSON.stringify(book));

(async () => {
  try {
    console.log('\n1. Settling finished matches');
    const n = await REC.settleAll({ force: true });
    const got = Object.fromEntries(REC.all().map((e) => [`${e.fixture}|${e.key}`, e]));
    const hit = (k) => got[k] && got[k].hit;
    t('settled the entries the free sources can answer', n === 8, n);
    t('2nd half over 0.5 won (goal on 70 minutes, half-time from ESPN goal times)', hit('f1|H2_O0.5') === 1 && got['f1|H2_O0.5'].ht === '1-0', JSON.stringify(got['f1|H2_O0.5']));
    t('goal in 1-15 won (12th minute)', hit('f1|M15_Y') === 1);
    t('Haaland to score won (matched by full name)', hit('f1|PL_H_0') === 1);
    t('under 3.5 cards won (cards counted from ESPN details)', hit('f1|K_U3.5') === 1);
    t('over 8.5 corners won (11 corners from the football-data archive)', hit('f2|C_O8.5') === 1 && got['f2|C_O8.5'].corners && got['f2|C_O8.5'].corners.home === 9);
    t('half-time draw lost (0-1 at half-time from the archive)', hit('f2|HT_X') === 0 && got['f2|HT_X'].ht === '0-1');
    t('over 3.5 cards won (4 cards from the archive)', hit('f2|K_O3.5') === 1);
    t('draw won on the final score', hit('f2|X') === 1 && got['f2|X'].result === '1-1');
    t('no goal times for a 1-1 -> minutes pick waits, not guessed', got['f2|M30_N'].hit == null && got['f2|M30_N'].result == null);
    t('a waiting pick keeps ESPN\'s final result, so the scoreboard is not fetched again', got['f2|M30_N'].espn && got['f2|M30_N'].espn.hg === 1 && got['f2|M30_N'].espn.ag === 1);
    t('a match no source can find is void after the waiting period', got['f9|1'].result === 'void' && got['f9|1'].hit == null && /not published/.test(got['f9|1'].note || ''));

    console.log('\n2. Reading the record');
    const s = REC.summary();
    t('summary counts settled Strongest Picks only', s.picks.n === 2 && s.picks.won === 2 && s.picks.void === 1, JSON.stringify(s.picks));
    t('summary per tier', s.byTier.Strong.n === 2 && s.byTier.Solid.void === 1);
    t('summary per market group for match-card picks', s.cards.Minutes && s.cards.Minutes.n === 1 && s.cards.Minutes.pending === 1);
    t('recent list is newest first and carries the result', s.recent.length === 3 && s.recent.every((e) => 'hit' in e));
    t('picks for a date', REC.forDate(dayISO).length === 2);
    t('CSV export', REC.toCsv().startsWith('date,kind,league') && REC.toCsv().split('\n').length === 11);

    console.log('\n3. Recording before kick-off');
    const future = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
    const day = {
      picks: [{ match: { id: 'f20', league: 'eng.1', leagueName: 'Premier League', date: future, home: { name: 'Chelsea' }, away: { name: 'Spurs' }, fd: { home: 'Chelsea', away: 'Tottenham' } }, pick: { key: 'O1.5', group: 'Goals', label: 'Over 1.5 goals', prob: 0.8, floor: 0.77, views: { market: 0.8, stats: 0.77 }, tier: 'Solid' } }],
      matches: [
        { started: false, match: { id: 'f20', league: 'eng.1', date: future, home: { name: 'Chelsea' }, away: { name: 'Spurs' } }, cards: [{ group: 'Goals', key: 'O1.5', label: 'Over 1.5 goals', prob: 0.8, floor: 0.77, views: {} }, { group: 'Players', none: true }] },
        { started: true, match: { id: 'f21', league: 'eng.1', date: kick, home: { name: 'A' }, away: { name: 'B' } }, cards: [{ group: 'Goals', key: 'O2.5', label: 'Over 2.5 goals', prob: 0.6, floor: 0.55, views: {} }] },
      ],
    };
    const added = REC.record(day);
    t('a pick and its match card are written before kick-off', added === 2, added);
    t('names are stored as plain text', REC.all().find((e) => e.fixture === 'f20' && e.kind === 'pick').home === 'Chelsea');
    t('writing again changes nothing (first write wins)', REC.record(day) === 0);
    t('a match that has kicked off is never written', !REC.all().some((e) => e.fixture === 'f21'));
  } catch (err) {
    t('record test completed', false, err.stack);
  } finally {
    global.fetch = realFetch;
    fs.rmSync(TMP, { recursive: true, force: true });
    console.log('\n=========================================================');
    console.log(` ${pass} passed, ${fail} failed`);
    console.log('=========================================================');
    process.exit(fail ? 1 : 0);
  }
})();
