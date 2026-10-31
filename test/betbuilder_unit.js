'use strict';

/**
 * test/betbuilder_unit.js — the Bet Builder: joint chances, the rule, the day.
 *
 *   node test/betbuilder_unit.js
 */

const BB = require('../public/betbuilder-core');
const BL = require('../lib/betbuilder');
const M = require('../lib/model');
const MAR = require('../lib/strongest/markets');
const C = require('../lib/strongest/config');

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
const near = (a, b, tol = 1e-9) => a != null && b != null && Math.abs(a - b) <= tol;

// a match priced the way lib/strongest prices it on the site
function match(lh, la, o = {}) {
  const fx = {
    names: { home: 'Chelsea', away: 'Wolves' },
    goalViews: [
      { name: 'market', lamH: lh, lamA: la, rho: -0.05 },
      { name: 'stats', lamH: lh * 0.97, lamA: la * 1.04, rho: -0.05 },
      { name: 'factors', lamH: lh * 1.02, lamA: la * 0.98, rho: -0.05 },
    ],
    timing: MAR.defaultTiming(0.44),
    cornerViews: o.noCorners ? [] : [
      { name: 'model', home: 4.5 + lh, away: 3 + la, r: 12.7 },
      { name: 'season', home: 4.4 + lh, away: 3.1 + la, r: 9 },
      { name: 'recent', home: 4.6 + lh, away: 2.9 + la, r: 9 },
    ],
    cardViews: o.noCards ? [] : [
      { name: 'model', mu: o.cards || 3.9, r: 38 },
      { name: 'season', mu: (o.cards || 3.9) * 0.97, r: 9 },
      { name: 'recent', mu: (o.cards || 3.9) * 1.05, r: 9 },
    ],
    players: o.players || [{ name: 'Striker', side: 'home', share: 0.33, involvement: 0.9 }],
  };
  return { fx, sels: MAR.price(fx) };
}
const ctxOk = { hasMarket: true, started: false, avoid: new Set(), ruleTraps: new Set(), shift: {}, news: { home: { highs: 0 }, away: { highs: 0 } }, statsGames: { home: 20, away: 20 } };

// ------------------------------------------------------------------ 1. the core
console.log('\n1. Joint model core');
{
  let d = 0;
  for (const [l, m, r] of [[1.9, 0.8, -0.05], [0.6, 2.4, -0.1], [1.4, 1.3, 0]]) {
    const a = BB.scoreMatrix(l, m, r);
    const b = M.scoreMatrix(l, m, r).m;
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) d = Math.max(d, Math.abs(a[i][j] - b[i][j]));
  }
  t('score matrix identical to lib/model.js (browser and server agree)', d < 1e-15, d);
  const { fx, sels } = match(1.9, 0.8);
  const model = BL.modelFor(fx, sels);
  const prep = BB.prepare(model);
  const X = MAR.goalContext({ lamH: 1.9, lamA: 0.8, rho: -0.05 }, MAR.defaultTiming(0.44));
  const keys = ['1', 'X', '2', '1X', 'X2', '12', 'O2.5', 'U3.5', 'BTTS_Y', 'TTH_O1.5', 'TTA_U0.5'];
  t('one leg alone = the Strongest pricer\'s raw probability', keys.every((k) => near(BB.rawJoint(prep, [k]), MAR.rawGoal(k, X), 1e-12)));
  const cv = fx.cornerViews[0];
  const tot = MAR.convolve(MAR.nbPmf(cv.home, cv.r), MAR.nbPmf(cv.away, cv.r));
  t('corner line alone matches the Strongest corners pricer', near(BB.rawJoint(prep, ['C_O9.5']), MAR.over(tot, 9.5), 2e-4), `${BB.rawJoint(prep, ['C_O9.5'])} ${MAR.over(tot, 9.5)}`);
  const kv = fx.cardViews[0];
  t('card line alone matches the Strongest cards pricer', near(BB.rawJoint(prep, ['K_O3.5']), MAR.over(MAR.nbPmf(kv.mu, kv.r), 3.5), 2e-4));
  // correlation
  const P = (ks) => BB.rawJoint(prep, ks);
  t('a win guarantees the winner scored: home win + home to score = home win', near(P(['1', 'TTH_O0.5']), P(['1']), 1e-12));
  t('contradictions are impossible: under 1.5 + both teams score = 0', P(['U1.5', 'BTTS_Y']) === 0 && BB.impossible(prep, ['U1.5', 'BTTS_Y']));
  t('home win and draw cannot both land', P(['1', 'X']) === 0);
  t('a strong favourite winning and over 2.5 go together (more than multiplied)', P(['1', 'O2.5']) > P(['1']) * P(['O2.5']));
  t('a strong favourite winning and both teams scoring pull apart (less than multiplied)', P(['1', 'BTTS_Y']) < P(['1']) * P(['BTTS_Y']));
  t('corners and goals are combined as independent', near(P(['1', 'C_O9.5']), P(['1']) * P(['C_O9.5']), 1e-12));
  t('two corner lines are joint on one grid', near(P(['C_O8.5', 'C_O9.5']), P(['C_O9.5']), 1e-12) && P(['CH_O4.5', 'C_U9.5']) < P(['CH_O4.5']) * P(['C_U9.5']));
}
{
  // scorers
  t('one scorer given n team goals: 1 - (1 - s)^n', near(BB.scorersGiven([0.3], 2), 1 - 0.7 * 0.7, 1e-12) && BB.scorersGiven([0.3], 0) === 0);
  t('two team-mates both scoring (inclusion-exclusion)', near(BB.scorersGiven([0.3, 0.2], 2), 2 * 0.3 * 0.2, 1e-12) && BB.scorersGiven([0.3, 0.2], 1) === 0);
  const { fx, sels } = match(1.9, 0.8);
  const model = BL.modelFor(fx, sels);
  const prep = BB.prepare(model);
  const s = model.players[0].share * model.players[0].involvement;
  const p = BB.rawJoint(prep, [model.players[0].key]);
  t('a scorer alone ~ 1 - e^(-team xG x share) (Poisson thinning)', Math.abs(p - (1 - Math.exp(-1.9 * s))) < 0.02, `${p} vs ${1 - Math.exp(-1.9 * s)}`);
  t('the striker scoring goes with his team winning', BB.rawJoint(prep, ['1', model.players[0].key]) > BB.rawJoint(prep, ['1']) * p);
  t('the striker scoring and his team failing to score cannot both happen', BB.rawJoint(prep, ['TTH_U0.5', model.players[0].key]) === 0);
}
{
  // measured chances and calibration
  const { fx, sels } = match(1.6, 1.0);
  const model = BL.modelFor(fx, sels);
  const prep = BB.prepare(model);
  const j = BB.joint(prep, ['1X', 'O1.5', 'C_O8.5'], null);
  t('combined chance never above its weakest leg', j.chance <= Math.min(...['1X', 'O1.5', 'C_O8.5'].map((k) => model.legs[k].chance)) + 1e-12);
  t('legs priced exactly at the model: chance = raw', (() => {
    const p2 = BB.prepare({ ...model, legs: Object.fromEntries(['1X', 'O1.5'].map((k) => [k, { chance: BB.rawJoint(prep, [k]), measured: true }])) });
    const jj = BB.joint(p2, ['1X', 'O1.5'], null);
    return near(jj.chance, jj.raw, 1e-12);
  })());
  t('a leg the others make certain changes nothing, not even by its measured nudge', near(BB.joint(prep, ['1', 'TTH_O0.5', 'C_O8.5'], null).chance, BB.joint(prep, ['1', 'C_O8.5'], null).chance, 1e-12));
  const cal = { a: -0.1, b: 1 };
  t('a builder calibration moves the combined chance', BB.joint(prep, ['1X', 'O1.5', 'C_O8.5'], cal).chance < j.chance);
  t('product is the legs multiplied (shown for comparison)', near(j.product, ['1X', 'O1.5', 'C_O8.5'].reduce((a, k) => a * model.legs[k].chance, 1), 1e-12));
  t('families: two lines of one market are one family', BB.legOf('O1.5').family === BB.legOf('U3.5').family && BB.legOf('TTH_O0.5').family !== BB.legOf('TTA_O0.5').family && BB.legOf('C_MOST_H').family === 'cornersMost');
}

// ------------------------------------------------------------------ 2. the rule
console.log('\n2. The rule');
function brute(prep, pool, cfg) {
  const byFam = {};
  for (const l of pool) (byFam[l.family] = byFam[l.family] || []).push(l);
  const fams = Object.values(byFam).map((ls) => ls.sort((a, b) => b.chance - a.chance).slice(0, cfg.linesPerFamily));
  const strength = (l) => l.chance - (l.kind === 'goals' ? 0 : cfg.statsOnlyPenalty);
  const raw1 = (k) => BB.rawJoint(prep, [k]);
  let best = null;
  const rec = (i, ch) => {
    if (ch.length >= cfg.minLegs) {
      const keys = ch.map((l) => l.key);
      const j = BB.joint(prep, keys, null);
      // every leg must lower the chance (no passengers), no prefix may already reach the odds,
      // no two legs of one kind may pull apart, and the set must not pull apart
      let ok = j.chance <= 1 / cfg.target + 1e-9 && j.chance >= 1 / cfg.maxOdds - 1e-9;
      for (let k = 0; ok && k < ch.length; k++) if (BB.rawJoint(prep, keys.filter((_, i) => i !== k)) - j.raw < 1e-9) ok = false;
      for (let k = cfg.minLegs; ok && k < ch.length; k++) if (BB.joint(prep, keys.slice(0, k), null).chance <= 1 / cfg.target + 1e-9) ok = false;
      for (let a = 0; ok && a < ch.length; a++) for (let b = a + 1; ok && b < ch.length; b++) {
        if (ch[a].kind === ch[b].kind && BB.rawJoint(prep, [ch[a].key, ch[b].key]) < raw1(ch[a].key) * raw1(ch[b].key) * (1 - cfg.maxPull)) ok = false;
      }
      if (ok && j.raw < keys.reduce((x, k) => x * raw1(k), 1) * (1 - cfg.maxPull)) ok = false;
      if (ok) {
        const minLeg = Math.min(...ch.map(strength));
        const better = !best || ch.length < best.keys.length || (ch.length === best.keys.length && (minLeg > best.minLeg + 1e-9 || (Math.abs(minLeg - best.minLeg) <= 1e-9 && j.chance > best.chance)));
        if (better) best = { keys, chance: j.chance, minLeg };
      }
    }
    if (ch.length >= cfg.maxLegs) return;
    for (let f = i; f < fams.length; f++) for (const l of fams[f]) rec(f + 1, [...ch, l]);
  };
  rec(0, []);
  return best;
}
{
  // BB.rawJoint(prep, []) is 1: an empty set always lands
  let agree = 0;
  let total = 0;
  let found = 0;
  const seeds = [[2.1, 0.7], [1.5, 1.1], [1.2, 1.3], [0.9, 1.9], [2.8, 0.5], [1.6, 1.5], [1.0, 1.0], [2.3, 1.2]];
  for (const [lh, la] of seeds) {
    const { fx, sels } = match(lh, la);
    const r = BL.forMatch({ fx, sels, ctx: ctxOk });
    const prep = BB.prepare(r.model);
    const pool = BL.eligibleLegs(sels, ctxOk);
    const b = brute(prep, pool, BL.CFG);
    total++;
    if (r.builder) found++;
    const same = (!b && !r.builder) || (b && r.builder && near(b.chance, r.builder.chance, 1e-4) && b.keys.length === r.builder.size);
    if (same) agree++;
  }
  t(`the search finds the same builder as brute force (${agree}/${total} matches)`, agree === total);
  t('every test match gets a builder', found === seeds.length, found);
}
{
  const { fx, sels } = match(1.8, 0.9);
  const r = BL.forMatch({ fx, sels, ctx: ctxOk });
  const b = r.builder;
  t(`a builder reaches ${BL.CFG.target}+ fair odds and stays under ${BL.CFG.maxOdds}`, b && b.fairOdds >= BL.CFG.target - 1e-6 && b.fairOdds <= BL.CFG.maxOdds + 1e-6, b && b.fairOdds);
  t(`${BL.CFG.minLegs}-${BL.CFG.maxLegs} legs, one per market family`, b && b.size >= BL.CFG.minLegs && b.size <= BL.CFG.maxLegs && new Set(b.legs.map((l) => BB.legOf(l.key).family)).size === b.size);
  t(`every leg at least ${BL.CFG.minLegChance * 100}% on its own`, b && b.legs.every((l) => l.chance >= BL.CFG.minLegChance));
  const prep = BB.prepare(r.model);
  const raw1 = (k) => BB.rawJoint(prep, [k]);
  t('the legs back each other or are unrelated (one story, not a hedge)', b && b.raw >= b.legs.reduce((a, l) => a * raw1(l.key), 1) * (1 - BL.CFG.maxPull));
  t('take-at price is at least the target and the fair odds', b && b.takeAt >= BL.CFG.target && b.takeAt >= b.fairOdds - 1e-9);
  t('every leg matters: none is made certain by the others (no padding to the minimum)', b && b.legs.every((l) => BB.rawJoint(prep, b.legs.filter((x) => x !== l).map((x) => x.key)) - b.raw > 1e-9));
  {
    // a pool where the only three legs that reach the odds (here 2.0, to force it) are a home win,
    // a corners line and "home to score", which the home win makes certain: no builder
    const pool = BL.eligibleLegs(sels, ctxOk).filter((l) => ['TTH_O0.5', '1', 'C_O7.5'].includes(l.key));
    const f = BL.search(prep, pool, { ...BL.CFG, target: 2, maxOdds: 3 }, null);
    t('the search never pads a builder with a passenger leg', pool.length === 3 && f === null, f && f.keys.join(' + '));
  }
  t('the menu offers goals, team, match, corners, cards and scorers', ['Match', 'Goals', 'Team', 'Corners', 'Bookings', 'Players'].every((g) => r.options.some((o) => o.group === g)));
  t('scorers are offered but never measured', r.options.filter((o) => o.group === 'Players').every((o) => o.measured === false && o.chance > 0));
}
{
  // eligibility
  const { fx, sels } = match(1.8, 0.9);
  const pool = BL.eligibleLegs(sels, ctxOk);
  t('no half, minute, special or scorer legs in a daily builder', pool.every((l) => ['Match', 'Goals', 'Team', 'Corners', 'Bookings'].includes(l.group)));
  t('team under 1.5 goals stays out (kept off the Strongest list for its record)', !pool.some((l) => /^TT[HA]_U1\.5$/.test(l.key)) && C.excluded.includes('TTA_U1.5'));
  const key = pool.find((l) => l.kind === 'goals').key;
  t('a leg the v6 layer calls a trap is left out', !BL.eligibleLegs(sels, { ...ctxOk, avoid: new Set([key]) }).some((l) => l.key === key));
  t('the factors rating it below the price leaves it out', !BL.eligibleLegs(sels, { ...ctxOk, shift: { [key]: -0.03 } }).some((l) => l.key === key));
  t('nothing once the match has kicked off', BL.eligibleLegs(sels, { ...ctxOk, started: true }).length === 0);
  t('unmeasured selections are left out', !BL.eligibleLegs(sels.map((s) => ({ ...s, measured: false })), ctxOk).length);
  const noC = match(1.8, 0.9, { noCorners: true, noCards: true });
  t('without corner and card models the builder uses goal legs only', (() => {
    const r = BL.forMatch({ fx: noC.fx, sels: noC.sels, ctx: ctxOk });
    return !r.builder || r.builder.legs.every((l) => !['Corners', 'Bookings'].includes(l.group));
  })());
}

// ------------------------------------------------------------------ 3. the day
console.log('\n3. The day');
{
  const items = [[2.1, 0.7], [1.2, 1.3], [0.9, 1.9], [1.6, 1.5]].map(([lh, la], i) => {
    const { fx, sels } = match(lh, la);
    return { match: { id: String(i), home: { name: 'H' + i }, away: { name: 'A' + i }, date: '2026-11-01T15:00:00Z' }, fx, sels, ctx: { ...ctxOk, started: i === 3 } };
  });
  const day = BL.forDay(items);
  t('one builder per match that has one; kicked-off matches have none', day.builders.length === 3 && day.matches.find((m) => m.match.id === '3').builder === null);
  t('ordered as chosen: fewest legs first', day.builders.every((b, i, a) => i === 0 || a[i - 1].builder.size <= b.builder.size));
  t('every match keeps its joint model and the legs for "build your own"', day.matches.length === 4 && day.matches.every((m) => m.model && Object.keys(m.model.legs).length > 10 && Object.values(m.model.legs).every((l) => l.label && l.group && l.chance > 0)));
  t('scorers are in the day\'s legs (unmeasured) but never in its builders', day.matches.every((m) => Object.entries(m.model.legs).filter(([k]) => /^PL_/.test(k)).every(([, l]) => l.group === 'Players' && l.measured === false)) && day.builders.every((b) => b.builder.legs.every((l) => !/^PL_/.test(l.key))));
  t('rules and public settings published', BL.rules().length >= 5 && BL.publicConfig().target === BL.CFG.target);
}

console.log('\n=========================================================');
console.log(` ${pass} passed, ${fail} failed`);
console.log('=========================================================');
process.exit(fail ? 1 : 0);
