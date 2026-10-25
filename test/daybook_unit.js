'use strict';
// Day database: the 05:00 Ghana reset, settle parity with lib/settle.js, merge / freeze rules, the server day book.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.SHARPSHOOTER_DATA_DIR = process.env.SHARPSHOOTER_DATA_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'ss-daybook-'));
const SS = require('../public/shared.js');
const SETTLE = require('../lib/settle');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

// --- the day: 05:00 Africa/Accra (UTC+0)
ok(SS.dayKey(Date.parse('2026-10-25T04:59:00Z')) === '2026-10-24', '04:59 belongs to the previous day');
ok(SS.dayKey(Date.parse('2026-10-25T05:00:00Z')) === '2026-10-25', '05:00 starts the new day');
ok(SS.dayKey(Date.parse('2026-01-01T02:00:00Z')) === '2025-12-31', 'year boundary');
const ms = SS.msToReset(Date.parse('2026-10-25T21:23:00Z'));
ok(Math.abs(ms - (7 * 3600000 + 37 * 60000)) < 2000, `msToReset ${ms}`);

// --- settle mirror agrees with lib/settle.js
const keys = ['1', 'X', '2', '1X', 'X2', '12', 'DNB_H', 'DNB_A', 'BTTS_Y', 'BTTS_N', 'GG2P', 'O0.5', 'O1.5', 'O2.5', 'O3.5', 'U2.5', 'U3.5', 'TTH_O0.5', 'TTA_U1.5', 'AH_H_-1', 'AH_A_-1', 'AH_H_-1.5', 'AH_H_0', 'AH_A_0.5', 'CS_1-0', 'CS_2-2'];
const sfn = SETTLE.settle || SETTLE.settleKey || SETTLE;
for (const k of keys) for (let h = 0; h <= 4; h++) for (let a = 0; a <= 4; a++) {
  const ref = typeof sfn === 'function' ? sfn(k, h, a) : undefined;
  if (ref === undefined) continue;
  const r = ref && typeof ref === 'object' ? (ref.hit != null ? ref.hit : ref.result === 'won' ? 1 : ref.result === 'lost' ? 0 : null) : ref;
  ok(SS.settle(k, h, a) === (r === true ? 1 : r === false ? 0 : r), `settle ${k} ${h}-${a}: ${SS.settle(k, h, a)} vs ${JSON.stringify(ref)}`);
}

// --- merge: a played match keeps its pre-match prediction; a dropped match is kept; results attached
const T = Date.parse('2026-10-25T18:00:00Z');
const fx = (id, state, hs, as, date) => ({ id, league: 'eng.1', date, state, completed: state === 'post', home: { name: 'H' + id, score: hs }, away: { name: 'A' + id, score: as } });
const gen = (id, date, at, key, label) => ({ match: { id, league: 'eng.1', date, home: { name: 'H' + id }, away: { name: 'A' + id }, state: 'pre' }, at,
  general: { bestBet: { key, label }, result: { call: 'H' }, goals: { call: 'Over' }, btts: { call: 'Yes' }, score: { predicted: { score: '2-1' } }, alternatives: [] } });
const head = (id, date, at, key) => ({ match: { id, date }, at, prediction: { status: 'LOCK', score: 80, pick: { key, label: key } } });
const morning = { date: '2026-10-25', fixtures: [fx('1', 'pre', null, null, '2026-10-25T14:00:00Z'), fx('2', 'pre', null, null, '2026-10-25T20:00:00Z')],
  general: [gen('1', '2026-10-25T14:00:00Z', '2026-10-25T08:00:00Z', 'O2.5', 'Over 2.5'), gen('2', '2026-10-25T20:00:00Z', '2026-10-25T08:00:00Z', '1', 'Home')],
  headline: [head('1', '2026-10-25T14:00:00Z', '2026-10-25T08:00:00Z', 'O2.5')], byMethod: { o25: [head('1', '2026-10-25T14:00:00Z', '2026-10-25T08:00:00Z', 'O2.5')] },
  methods: [{ id: 'o25', count: 1 }], accumulator: { options: [{ legs: [{ fixtureId: '1', key: 'O2.5', kickoff: '2026-10-25T14:00:00Z' }, { fixtureId: '2', key: '1', kickoff: '2026-10-25T20:00:00Z' }] }] } };
const evening = { date: '2026-10-25', fixtures: [fx('1', 'post', 2, 1, '2026-10-25T14:00:00Z'), fx('2', 'pre', null, null, '2026-10-25T20:00:00Z')],
  general: [gen('2', '2026-10-25T20:00:00Z', '2026-10-25T17:00:00Z', 'X2', 'Away or draw')], headline: [], byMethod: {}, methods: [{ id: 'o25', count: 0 }],
  accumulator: { options: [{ legs: [{ fixtureId: '2', key: 'X2', kickoff: '2026-10-25T20:00:00Z' }, { fixtureId: '3', key: '1', kickoff: '2026-10-25T21:00:00Z' }] }] } };
const m = SS.mergePredictions(morning, evening, T);
const g1 = m.general.find((e) => e.match.id === '1');
const g2 = m.general.find((e) => e.match.id === '2');
ok(g1 && g1.general.bestBet.key === 'O2.5', 'played match kept with its morning prediction');
ok(g1.outcome && g1.outcome.final && g1.outcome.main === 1 && g1.outcome.exact === 1, 'played match settled: Over 2.5 won, 2-1 exact');
ok(g2.general.bestBet.key === 'X2', 'match still to play takes the newest prediction');
ok(m.headline.length === 1 && m.headline[0].outcome.hit === 1 && m.methods[0].count === 1, 'methodology pick kept, settled, counted');
ok(m.accumulator.frozen && m.accumulator.options[0].legs[0].outcome.hit === 1 && m.accumulator.options[0].outcome === 'live', 'morning acca frozen, leg ticked');
ok(m.accumulator.later && m.accumulator.later.options[0].legs[0].key === 'X2', 'newer acca shown beside it');
ok(m.summary.finished === 1 && m.summary.main.won === 1 && m.summary.main.upcoming === 1, 'today-so-far tally');
const stale = SS.mergePredictions(evening, { ...evening, fixtures: [fx('1', 'pre', null, null, '2026-10-25T14:00:00Z')] }, T);
ok(stale.fixtures.find((f) => f.id === '1').state === 'post', 'a stale copy never moves a match backwards');
ok(SS.mergePredictions(morning, { ...evening, date: '2026-10-26' }, T).general.length === 1, 'another date is not merged');

// --- Strongest: morning picks of started matches are kept
const sp = (id, date) => ({ match: { id, date, home: { name: 'H' }, away: { name: 'A' } }, pick: { label: 'Over 1.5', prob: 0.8, group: 'Goals' } });
const s1 = SS.mergeStrongest({ date: 'd', picks: [sp('1', '2026-10-25T14:00:00Z'), sp('2', '2026-10-25T20:00:00Z')] }, { date: 'd', picks: [sp('2', '2026-10-25T20:00:00Z')], earlier: [] }, T);
ok(s1.earlier.length === 1 && s1.earlier[0].fixture === '1' && s1.earlier[0].savedInBrowser, 'started pick carried');
const s2 = SS.mergeStrongest(s1, { date: 'd', picks: [], earlier: [] }, T);
ok(s2.earlier.length === 1, 'carried pick survives the next merge too');

// --- the server day book
const DB = require('../lib/daybook');
DB._reset();
const day = DB.ensureDay();
const future = new Date(Date.now() + 3600000).toISOString();
const rep = { analysedAt: new Date().toISOString(), match: { id: '9', league: 'eng.1', date: future, state: 'pre', home: { name: 'H', score: null }, away: { name: 'A', score: null } } };
ok(DB.saveReport(rep) === true && DB.getReport('eng.1', '9').report.match.id === '9', 'pre-match report saved');
ok(DB.saveReport({ ...rep, match: { ...rep.match, id: '10', state: 'in' } }) === false, 'a started match is never saved over');
const live = DB.withLive(rep, { state: 'post', completed: true, home: { score: 3 }, away: { score: 0 } });
ok(live.frozen && live.match.home.score === 3 && live.match.state === 'post', 'frozen report with the final score');
DB.savePayload('predictions', '2026-10-25', { x: 1 });
ok(DB.getPayload('predictions', '2026-10-25').payload.x === 1, 'payload round-trip');
fs.mkdirSync(path.join(DB.ROOT, '2000-01-01'), { recursive: true });
DB._reset();
DB.ensureDay();
ok(!fs.existsSync(path.join(DB.ROOT, '2000-01-01')) && fs.existsSync(path.join(DB.ROOT, day)), 'old days deleted, today kept');
ok(DB.status().resetHour === 5 && DB.status().timezone === 'Africa/Accra', 'status');

console.log(`daybook_unit: ${n} checks passed`);
