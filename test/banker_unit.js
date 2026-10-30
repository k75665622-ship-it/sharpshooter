'use strict';
// High Banker (lib/banker.js): every check, the red flags, the slip optimiser, merge/freeze, ledger, record.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.SHARPSHOOTER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-banker-'));
const BK = require('../lib/banker');
const SS = require('../public/shared.js');
const LEDGER = require('../lib/ledger');

let n = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  n++;
};

// a match where Home are clear favourites and every check passes for "Home or draw"
const future = (h) => new Date(Date.now() + h * 3600000).toISOString();
function input(over = {}) {
  const base = {
    id: '1', league: 'eng.1', leagueName: 'Premier League', kickoff: future(5), home: 'Home FC', away: 'Away FC',
    p: { '1': 0.62, X: 0.22, '2': 0.16, '1X': 0.84, X2: 0.38, DNB_H: 0.79, DNB_A: 0.21, 'O1.5': 0.7, 'O2.5': 0.45, 'U2.5': 0.55, 'U3.5': 0.76, BTTS_Y: 0.48, BTTS_N: 0.52, 'TTH_O0.5': 0.82, 'TTA_O0.5': 0.55, 'TTH_O1.5': 0.5, 'TTA_O1.5': 0.18 },
    base: { '1': 0.61, X: 0.23, '2': 0.16, '1X': 0.835, X2: 0.39, DNB_H: 0.78, DNB_A: 0.22, 'O1.5': 0.71, 'O2.5': 0.46, 'U2.5': 0.54, 'U3.5': 0.77, BTTS_Y: 0.49, BTTS_N: 0.51, 'TTH_O0.5': 0.815, 'TTA_O0.5': 0.56, 'TTH_O1.5': 0.49, 'TTA_O1.5': 0.18 },
    pr: { '1X': [1.17, 1.19] },
    ovrOU: 0.06,
    main: '1', safer: '1X', avoid: [], pat: [],
    f: { h_ppg5: 2.2, a_ppg5: 1.0, h_ppgV5: 2.4, a_ppgV5: 0.8, h_ftsr: 0.1, a_ftsr: 0.3, h_csr: 0.4, a_csr: 0.1, h_o25r: 0.5, a_o25r: 0.5, h2hN: 4, h2hPpg: 2.0, h2hDraw: 0.25, h2hGoals: 2.5, eloExp: 0.66, p1: 0.61, p2: 0.16, pX: 0.23 },
    cov: 0.9,
    m: [],
  };
  return { ...base, ...over, p: { ...base.p, ...(over.p || {}) }, base: { ...base.base, ...(over.base || {}) }, f: { ...base.f, ...(over.f || {}) } };
}
const cfg = BK.CFG;

// ---- every check
let c = BK.check(input(), '1X', cfg);
ok(c.pass && c.checks.every((k) => k.ok), `clean selection passes: ${JSON.stringify(c.checks.filter((k) => !k.ok))}`);
ok(c.agreement === 'safer' && c.price.odds === 1.19 && !c.price.estimated, 'safer form of the main pick, best price used');
ok(BK.check(input({ p: { '1X': 0.7 } }), '1X', cfg).failed === 'strength', 'model below the bar -> strength');
ok(BK.check(input({ base: { '1X': 0.7 } }), '1X', cfg).failed === 'strength', 'price below the bar -> strength');
ok(BK.check(input({ base: { '1X': 0.86 } }), '1X', cfg).failed === 'trap', 'factors below the price -> trap');
ok(BK.check(input({ avoid: ['1X'] }), '1X', cfg).failed === 'trap', 'on the avoid list -> trap');
ok(BK.check(input({ p: { '1X': 0.95 }, base: { '1X': 0.85 } }), '1X', cfg).failed === 'trap', 'wild disagreement -> trap');
ok(BK.check(input({ main: 'O2.5', safer: 'O1.5' }), '1X', cfg).failed === 'agrees', 'normal prediction picks something else -> agrees');
ok(BK.check(input({ f: { a_ppg5: 2.6 } }), '1X', cfg).failed === 'trends', 'opponent on fire -> trends');
ok(BK.check(input({ f: { h_ppg5: 0.8 } }), '1X', cfg).failed === 'trends', 'own slump -> trends');
ok(BK.check(input({ f: { h2hPpg: 0.6, h2hN: 5 } }), '1X', cfg).failed === 'trends', 'bogey head-to-head -> trends');
ok(BK.check(input({ pr: { '1X': [1.08, 1.1] } }), '1X', cfg).failed === 'price', 'pays too little -> price');
ok(BK.check(input({ cov: 0.4 }), '1X', cfg).failed === 'data', 'thin factors -> data');
const live = (lv) => input({ live: { started: false, games: { home: 20, away: 20 }, crossLeague: false, news: { home: 'none', away: 'none' }, moves: {}, ...lv } });
ok(BK.check(live({}), '1X', cfg).pass, 'live: clean');
ok(BK.check(live({ started: true }), '1X', cfg).failed === 'live', 'live: kicked off');
ok(BK.check(live({ news: { home: 'high', away: 'none' } }), '1X', cfg).failed === 'live', 'live: absence on the backed side');
ok(BK.check(live({ news: { home: 'none', away: 'high' } }), '1X', cfg).pass, 'live: absence on the other side does not count');
ok(BK.check(live({ moves: { home: 0.1 } }), '1X', cfg).failed === 'live', 'live: price drifting 10% against it');
ok(BK.check(live({ crossLeague: true }), '1X', cfg).failed === 'data', 'live: cup tie');
ok(BK.check(live({ games: { home: 4, away: 20 } }), '1X', cfg).failed === 'data', 'live: short history');

// ---- red flags for goal markets
ok(BK.redFlags('O1.5', { h_ftsr: 0.4, a_ftsr: 0.5 }, { home: 'H', away: 'A' }).length === 1, 'O1.5: both sides often blank');
ok(BK.redFlags('TTH_O0.5', { h_ftsr: 0.4 }, { home: 'H', away: 'A' })[0].includes('H failed to score'), 'home to score: home often blank');
ok(BK.redFlags('U3.5', { h_o25r: 0.8, a_o25r: 0.7 }, { home: 'H', away: 'A' }).length === 1, 'U3.5: both sides high-scoring');
ok(BK.redFlags('U3.5', { h_o25r: 0.3, a_o25r: 0.4 }, { home: 'H', away: 'A' }).length === 0, 'U3.5: no flag when trends agree');

// ---- measured patterns: direction-aware
const fav = { p1: 0.6, p2: 0.2 };
ok(BK.patternEffect('dog_elo_rising', '1', fav) > 0, 'trap on the underdog helps the favourite');
ok(BK.patternEffect('dog_elo_rising', '2', fav) < 0, 'trap on the underdog counts against the underdog');
ok(BK.patternEffect('fav_win_streak', '1', fav) === 0, 'priced-in patterns carry no weight');
ok(BK.redFlags('2', { ...fav }, { home: 'H', away: 'A' }, ['dog_elo_rising']).some((t) => /measured pattern/.test(t)), 'adverse confirmed pattern is a red flag');

// ---- the slip optimiser vs brute force
function brute(legs, t) {
  let best = null;
  for (let m = 1; m < 1 << legs.length; m++) {
    let o = 1;
    let p = 1;
    for (let i = 0; i < legs.length; i++) if ((m >> i) & 1) {
      o *= legs[i].odds;
      p *= legs[i].prob;
    }
    if (o >= t && (!best || p > best.p)) best = { p, o };
  }
  return best;
}
let wrong = 0;
for (let k = 0; k < 400; k++) {
  const legs = Array.from({ length: 1 + (k % 10) }, (_, i) => ({ i, prob: 0.72 + ((k * 7 + i * 13) % 20) / 100, odds: 1.12 + ((k * 3 + i * 11) % 30) / 100 }));
  const t = 1.6 + (k % 5) * 0.5;
  const s = BK.bestSlip(legs, t);
  const b = brute(legs, t);
  if (!b) { if (s) wrong++; continue; }
  if (!s) { if (Math.log(b.o / t) > legs.length * 1e-4) wrong++; continue; }
  const so = s.reduce((a, l) => a * l.odds, 1);
  const sp = s.reduce((a, l) => a * l.prob, 1);
  if (so < t - 1e-9 || (sp < b.p - 1e-9 && Math.log(b.o / t) > legs.length * 1e-4)) wrong++;
}
ok(wrong === 0, `optimiser matches brute force (${wrong} wrong)`);
ok(BK.bestSlip([{ prob: 0.8, odds: 1.2 }], 3) === null, 'unreachable target -> no slip');

// ---- a day: one banker per match, the slip reaches 3.0, bigger targets, never padded
const day = [];
for (let i = 0; i < 9; i++) {
  day.push(input({ id: String(100 + i), home: `H${i}`, away: `A${i}`, kickoff: future(2 + i), pr: { '1X': [1.24 + i * 0.01, 1.26 + i * 0.01] } }));
}
day.push(input({ id: '999', home: 'Weak', away: 'Side', p: { '1X': 0.7, DNB_H: 0.7, 'TTH_O0.5': 0.7, 'U3.5': 0.7 }, base: { '1X': 0.69, DNB_H: 0.69, 'TTH_O0.5': 0.69, 'U3.5': 0.69 } })); // nothing reaches the bar
const out = BK.build(day, cfg);
ok(out.bankers.length === 9 && new Set(out.bankers.map((l) => l.fixtureId)).size === 9, 'one banker per match; the weak match has none');
ok(out.slip && out.slip.odds >= 3 && out.reached, `slip reaches 3.0 (${out.slip && out.slip.odds.toFixed(2)})`);
ok(out.slip.prob === out.slip.legs.reduce((a, l) => a * l.prob, 1), 'slip chance is the product of its legs');
ok(out.bigger.length >= 1 && out.bigger.every((o, i, a) => o.odds >= o.target && (i === 0 || o.target > a[i - 1].target)), 'bigger slips reach their targets in order');
ok(out.near.some((l) => l.fixtureId === '999') === false, 'a match under the strength bar is not a near miss');
const two = BK.build(day.slice(0, 2), cfg);
ok(!two.slip && !two.reached && two.bankers.length === 2 && two.bigger.length === 0, 'two bankers cannot reach 3.0: no slip, nothing padded');
// the safer slip: the same bankers, the most likely way to the smaller target
ok(out.safer && out.safer.target === cfg.safer && out.safer.odds >= cfg.safer, `safer slip reaches ${cfg.safer} (${out.safer && out.safer.odds.toFixed(2)})`);
ok(out.safer.size < out.slip.size && out.safer.prob > out.slip.prob, `the safer slip has fewer legs and a bigger chance (${out.safer.size} legs ${(out.safer.prob * 100).toFixed(0)}% vs ${out.slip.size} legs ${(out.slip.prob * 100).toFixed(0)}%)`);
ok(out.safer.legs.every((l) => out.bankers.some((b) => b.fixtureId === l.fixtureId && b.key === l.key)), 'the safer slip uses only the day\'s bankers');
ok(two.safer && two.safer.odds >= cfg.safer || (two.all && two.all.odds < cfg.safer), 'two bankers can still make a safer slip when they reach its target');
ok(BK.build([], cfg).safer === null, 'no bankers -> no safer slip');
// the measured-chance and possession switches (off in production: research/v6/banker_pace.js)
const sw = input({ id: '55', mc: { '1X': 0.7 }, pv: { '1X': 0.7 }, mv: { '1X': 0.84 } });
ok(BK.forMatch(sw, cfg).best && BK.forMatch(sw, cfg).best.key === '1X', 'switches off: the v6 probability decides, the possession view is ignored');
ok(BK.check(sw, '1X', { ...cfg, useMeasured: true }).failed === 'strength', 'useMeasured: the measured chance decides the strength check');
ok(BK.check(sw, '1X', { ...cfg, paceGap: 0.05 }).failed === 'possession', 'paceGap: the possession model rating it well below the price fails the leg');
ok(BK.check(input(), '1X', { ...cfg, paceGap: 0.05 }).pass, 'paceGap: no possession data -> the check passes (not used)');
const nearDay = BK.build([input({ id: '7', f: { a_ppg5: 2.6, h_ftsr: 0.5 } })], cfg); // the opponent on fire AND Home often blank
ok(nearDay.near.length === 1 && nearDay.near[0].failed === 'trends', 'a strong pick failing a check is listed as a near miss with the reason');

// ---- from a live engine report
const rep = {
  analysable: true,
  match: { id: 55, league: 'eng.1', leagueName: 'Premier League', date: future(3), state: 'pre', home: { name: 'Home FC' }, away: { name: 'Away FC' } },
  intel: {
    available: true, probs: input().p, base: input().base, coverage: 0.9, patterns: [], traps: [], factors: { ...input().f, ovrOU: 0.05 },
    decision: { main: { key: '1' }, safer: { key: '1X' }, avoid: [] }, data: { historyGames: { home: 30, away: 30 } },
  },
  methodology: { predictions: [{ id: 'homeWin', name: 'Home Win', status: 'PREDICT', pick: { key: '1' } }] },
  markets: [{ key: '1X', v5price: { best: { price: 1.2, book: 'x' } } }],
  newsRisk: { home: { level: 'none' }, away: { level: 'medium' } },
  lineMovement: { moves: [{ side: 'home', changePct: -3 }] },
};
const fr = BK.fromReport(rep);
ok(fr && fr.id === '55' && fr.pr['1X'][1] === 1.2 && fr.live.news.away === 'medium' && fr.live.moves.home === -0.03, 'live report mapped');
const lb = BK.forReports([rep]);
ok(lb.bankers.length === 1 && lb.bankers[0].key === '1X' && lb.bankers[0].tripleConfirmed, 'live banker found and triple-confirmed by the methodology');
ok(lb.record && lb.record.heldOut && lb.rules.length >= 5 && lb.config.target === 3, 'record, rules and config served');

// ---- merge: the morning slip is frozen once a leg kicks off; a played banker keeps its pre-match version
const T0 = Date.now();
const mkLeg = (id, ko, key = '1X') => ({ fixtureId: id, kickoff: new Date(T0 + ko * 3600000).toISOString(), key, prob: 0.8, odds: 1.25, score: 0.8, home: 'H' + id, away: 'A' + id, label: 'x' });
const morning = { date: 'd', fixtures: [{ id: 'a', state: 'post', home: { score: 2 }, away: { score: 0 } }, { id: 'b', state: 'pre' }, { id: 'c', state: 'pre' }], general: [], headline: [], byMethod: {},
  banker: { target: 3, bankers: [mkLeg('a', -2), mkLeg('b', 3), mkLeg('c', 4)], slip: { legs: [mkLeg('a', -2), mkLeg('b', 3), mkLeg('c', 4)], odds: 3.1, prob: 0.4 }, bigger: [] } };
const evening = { ...morning, banker: { target: 3, bankers: [mkLeg('b', 3, 'O1.5')], slip: null, bigger: [] } };
const mg = SS.mergePredictions(morning, evening, T0);
ok(mg.banker.frozen && mg.banker.slip.legs.length === 3, 'morning slip frozen after kick-off');
ok(mg.banker.bankers.find((l) => l.fixtureId === 'a').key === '1X' && mg.banker.bankers.find((l) => l.fixtureId === 'b').key === 'O1.5', 'played banker kept, unplayed one updated');
ok(mg.banker.slip.legs[0].outcome && mg.banker.slip.legs[0].outcome.hit === 1 && mg.banker.slip.outcome === 'live', 'slip legs ticked, slip still live');
ok(mg.summary.banker.won === 1, 'banker tally in the day summary');

// ---- ledger: singles + the slip recorded before kick-off, never overwritten
const L1 = BK.build(day, cfg);
const added = LEDGER.recordBanker(L1, new Date().toISOString().slice(0, 10));
ok(added >= L1.bankers.length + 2, `bankers, the slip and the safer slip recorded (${added})`);
ok(LEDGER.recordBanker(L1, new Date().toISOString().slice(0, 10)) === 0, 'nothing overwritten on a second publish');
const all = LEDGER.all();
ok(all.some((e) => e.kind === 'acca' && e.method === 'banker' && e.legs.length === L1.slip.size) && all.filter((e) => e.kind === 'banker').length === L1.bankers.length, 'ledger holds the slip and each banker');
const sum = LEDGER.summary();
ok(sum.perMethod && sum.perMethod.banker && /High Banker/.test(sum.perMethod.banker.name), 'track record lists the High Banker');

// ---- the measured record is honest
const R = require('../lib/banker_record.json');
ok(Math.abs(R.heldOut.legs.hit - R.heldOut.legs.stated) < 0.02 && R.heldOut.legs.n > 5000, 'held-out legs calibrated');
ok(R.heldOut.slip.slips > 300 && R.heldOut.slip.hit >= R.heldOut.slip.stated - 0.03, 'held-out slips land at least as often as stated');
ok(R.config.minProb === cfg.minProb && R.config.target === cfg.target, 'record matches the production settings');
ok(R.heldOut.safer && R.heldOut.safer.slips > 300 && R.heldOut.safer.hit > R.heldOut.slip.hit, 'held-out: the safer slip lands more often than the 3.0+ slip');

console.log(`banker_unit: ${n} checks passed`);
