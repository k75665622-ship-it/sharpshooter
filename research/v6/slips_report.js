'use strict';

/**
 * research/v6/slips_report.js — how the Strongest Picks rule does pick by pick, by market, and
 * on slips of several picks, on research/v6/slips_study.js output.
 *
 *   node research/v6/slips_report.js <slips.jsonl> [out.json] [--rule=name] [--models=<models.json>]
 *
 *   --models=<file>  writes the held-out record of the "site" rule (lib/strongest/config.js as it
 *                    stands) into <file> (lib/strongest/models.json "measured"), for the page
 *
 * Tuning seasons (2019-07..2023-06) and held-out seasons (2023-07..) side by side. A rule is a
 * set of bars (chance, lowest view, the bookmakers' probability, markets kept off); the report
 * replays each rule in RULES on every match (one pick per match, the strongest), then builds each
 * day's slips from that day's picks, strongest first.
 */

const fs = require('fs');
const SC = require('../../lib/strongest/config');
const CAL = require('../../lib/strongest/calibrate');

const args = process.argv.slice(2);
const [file, outFile] = args.filter((a) => !a.startsWith('--'));
const SPLIT = '2023-07-01';
const statsOnly = (g) => g === 'Corners' || g === 'Bookings';
const TEAM_UNDER = /^TT[HA]_U\d\.5$/;

const RULES = {
  // the site as configured (lib/strongest/config.js)
  site: { chance: SC.minChance, chanceStats: SC.minChanceStatsOnly, floor: SC.floor, maxPay: SC.maxProb, excluded: SC.excluded },
  // the v6.0-v6.1 site (84% bar, team unders under 1.5 kept off)
  current: { chance: 0.84, chanceStats: 0.86, floor: 0.75, maxPay: 0.88, excluded: ['TTH_U1.5', 'TTA_U1.5'] },
  noTeamUnders: { chance: 0.84, chanceStats: 0.86, floor: 0.75, maxPay: 0.88, excluded: [], excludeRe: TEAM_UNDER },
  bar87: { chance: 0.87, chanceStats: 0.88, floor: 0.78, maxPay: 0.9, excluded: [], excludeRe: TEAM_UNDER },
  bar88: { chance: 0.88, chanceStats: 0.89, floor: 0.8, maxPay: 0.92, excluded: [], excludeRe: TEAM_UNDER },
  bar90: { chance: 0.9, chanceStats: 0.91, floor: 0.82, maxPay: 0.94, excluded: [], excludeRe: TEAM_UNDER },
  // the v6.2 rule: 88%+, no team unders, and the markets that won clearly less than stated at
  // 84%+ in BOTH periods kept off (BTTS No, double chance X2 + over 1.5, total corners under)
  v62f75: { chance: 0.88, chanceStats: 0.89, floor: 0.75, maxPay: 0.93, excluded: ['BTTS_N', 'DCX2_O1.5'], excludeRe: /^TT[HA]_U\d\.5$|^C_U\d+\.5$/ },
  v62: { chance: 0.88, chanceStats: 0.89, floor: 0.8, maxPay: 0.93, excluded: ['BTTS_N', 'DCX2_O1.5'], excludeRe: /^TT[HA]_U\d\.5$|^C_U\d+\.5$/ },
};
const ONLY = (args.find((a) => a.startsWith('--rule=')) || '').slice(7);
const MODELS = (args.find((a) => a.startsWith('--models=')) || '').slice(9);
if (MODELS && ONLY && ONLY !== 'site') throw new Error('--models writes the "site" rule');
if (ONLY || MODELS) for (const k of Object.keys(RULES)) if (k !== (ONLY || 'site')) delete RULES[k];
const TARGETS = [...new Set([0.85, 0.8, SC.safeSlipChance, 0.7, SC.longSlipChance, 0.6, 0.5])].sort((a, b) => b - a);
const tierOf = (p) => (SC.tiers.find((t) => p >= t.min - 1e-9) || { name: 'below' }).name;

const rows = [];
for (const line of fs.readFileSync(file, 'utf8').split('\n')) if (line) rows.push(JSON.parse(line));

function pickOf(r, rule) {
  let best = null;
  for (const [key, group, prob, floor, pay, res] of r.sels) {
    if (rule.excluded.includes(key) || (rule.excludeRe && rule.excludeRe.test(key))) continue;
    const so = statsOnly(group);
    if (prob < (so ? rule.chanceStats : rule.chance) - 1e-9) continue;
    if (floor < rule.floor - 1e-9) continue;
    if (pay > rule.maxPay + 1e-9) continue;
    const strength = prob - (so ? 0.03 : 0);
    if (!best || strength > best.strength) best = { key, group, prob, floor, pay, res, strength, d: r.d, div: r.div, fav: r.fav };
  }
  return best;
}

const acc = () => ({ n: 0, w: 0, p: 0 });
const add = (a, res, p) => {
  if (res == null) return;
  a.n++;
  a.w += res;
  a.p += p;
};
const show = (a) => (a.n ? `${String(a.n).padStart(6)} won ${(a.w / a.n * 100).toFixed(1).padStart(5)}% stated ${(a.p / a.n * 100).toFixed(1)}%` : '     0');
const frac = (a) => (a.n ? { n: a.n, won: +(a.w / a.n).toFixed(4), stated: +(a.p / a.n).toFixed(4) } : { n: 0 });

const report = {};
for (const [name, rule] of Object.entries(RULES)) {
  const part0 = () => ({ picks: acc(), fam: {}, fav: {}, tier: {}, market: {}, slips: {}, days: 0, perDay: 0, matches: 0 });
  const R = { tune: part0(), held: part0() };
  const byDay = new Map();
  for (const r of rows) {
    (r.d < SPLIT ? R.tune : R.held).matches++;
    const p = pickOf(r, rule);
    if (!p) continue;
    const part = r.d < SPLIT ? R.tune : R.held;
    add(part.picks, p.res, p.prob);
    add((part.tier[tierOf(p.prob)] = part.tier[tierOf(p.prob)] || acc()), p.res, p.prob);
    add((part.market[CAL.family(p.key)] = part.market[CAL.family(p.key)] || acc()), p.res, p.prob);
    const fam = TEAM_UNDER.test(p.key) ? 'team under' : /^TT[HA]_O/.test(p.key) ? 'team over' : p.group;
    add((part.fam[fam] = part.fam[fam] || acc()), p.res, p.prob);
    const fb = p.fav >= 0.7 ? 'favourite 70%+' : p.fav >= 0.55 ? 'favourite 55-70%' : 'no big favourite';
    add((part.fav[fb] = part.fav[fb] || acc()), p.res, p.prob);
    if (!byDay.has(p.d)) byDay.set(p.d, []);
    byDay.get(p.d).push(p);
  }
  // slips: each day's picks, strongest first; void legs (push) drop out of the slip
  for (const [d, picks] of byDay) {
    const part = d < SPLIT ? R.tune : R.held;
    part.days++;
    part.perDay += picks.length;
    picks.sort((a, b) => b.strength - a.strength);
    const settled = picks.filter((p) => p.res != null);
    // safe slips: strongest first, while the combined chance stays at the target (at least two legs)
    for (const T of TARGETS) {
      const legs = [];
      let p = 1;
      for (const l of settled) {
        if (legs.length >= 2 && p * l.prob < T - 1e-9) break;
        legs.push(l);
        p *= l.prob;
      }
      if (legs.length < 2 || p < T - 1e-9) continue;
      const s = (part.slips[`target ${T}`] = part.slips[`target ${T}`] || { n: 0, w: 0, p: 0, legs: 0, odds: 0 });
      s.n++;
      s.w += legs.every((l) => l.res === 1) ? 1 : 0;
      s.p += p;
      s.legs += legs.length;
      s.odds += legs.reduce((a, l) => a / Math.max(l.pay, 0.01), 1); // the bookmakers' fair odds, before their margin
    }
    for (const k of [1, 2, 3, 4, 5, 6, 8, 10, 15, 'all']) {
      const size = k === 'all' ? settled.length : k;
      if (settled.length < size || size < 1) continue;
      const legs = settled.slice(0, size);
      const s = (part.slips[k] = part.slips[k] || { n: 0, w: 0, p: 0, legs: 0 });
      s.n++;
      s.w += legs.every((l) => l.res === 1) ? 1 : 0;
      s.p += legs.reduce((a, l) => a * l.prob, 1);
      s.legs += legs.length;
    }
  }
  console.log(`\n================ RULE ${name} ${JSON.stringify(rule, (k, v) => (v instanceof RegExp ? String(v) : v))}`);
  report[name] = {};
  for (const [pn, part] of Object.entries(R)) {
    console.log(`\n-- ${pn === 'tune' ? 'TUNING 2019-23' : 'HELD-OUT 2023-26'}: ${part.days} match days, ${(part.perDay / Math.max(1, part.days)).toFixed(1)} picks a day`);
    console.log('  every pick       ', show(part.picks));
    for (const [k, a] of Object.entries(part.fam).sort((x, y) => y[1].n - x[1].n)) console.log(`  ${k.padEnd(17)}`, show(a));
    for (const [k, a] of Object.entries(part.fav)) console.log(`  ${k.padEnd(17)}`, show(a));
    for (const [k, a] of Object.entries(part.tier)) console.log(`  tier ${k.padEnd(12)}`, show(a));
    console.log('  slips (strongest first):');
    for (const [k, s] of Object.entries(part.slips)) console.log(`    ${String(k).padStart(11)} ${/target/.test(k) ? '' : 'legs'} ${String(s.n).padStart(5)} days  landed ${(s.w / s.n * 100).toFixed(1).padStart(5)}%  stated ${(s.p / s.n * 100).toFixed(1)}%  (avg ${(s.legs / s.n).toFixed(1)} legs${s.odds ? `, fair odds ${(s.odds / s.n).toFixed(2)}` : ''})`);
    report[name][pn] = {
      days: part.days,
      perDay: +(part.perDay / Math.max(1, part.days)).toFixed(1),
      matches: part.matches,
      picks: frac(part.picks),
      tiers: Object.fromEntries(Object.entries(part.tier).map(([k, a]) => [k, frac(a)])),
      markets: Object.fromEntries(Object.entries(part.market).map(([k, a]) => [k, frac(a)])),
      families: Object.fromEntries(Object.entries(part.fam).map(([k, a]) => [k, frac(a)])),
      favourite: Object.fromEntries(Object.entries(part.fav).map(([k, a]) => [k, frac(a)])),
      slips: Object.fromEntries(Object.entries(part.slips).map(([k, s]) => [k, { n: s.n, landed: +(s.w / s.n).toFixed(4), stated: +(s.p / s.n).toFixed(4), legs: +(s.legs / s.n).toFixed(1), ...(s.odds ? { fairOdds: +(s.odds / s.n).toFixed(2) } : {}) }])),
    };
  }
}

// every selection on its own, by market, at the chance bands that matter (what the match cards show)
console.log('\n================ EVERY SELECTION 84%+ (match cards), by market');
const mk = { tune: {}, held: {} };
for (const r of rows) {
  for (const [key, group, prob, , , res] of r.sels) {
    if (prob < 0.84 || res == null) continue;
    const fam = /^C|^K_/.test(key) ? key.replace(/\d+\.5$/, '') : key;
    const part = r.d < SPLIT ? mk.tune : mk.held;
    add((part[fam] = part[fam] || acc()), res, prob);
  }
}
const fams = [...new Set([...Object.keys(mk.tune), ...Object.keys(mk.held)])].sort((a, b) => ((mk.held[b] || {}).n || 0) - ((mk.held[a] || {}).n || 0));
for (const f of fams) {
  const t = mk.tune[f] || acc();
  const h = mk.held[f] || acc();
  const e = (a) => (a.n ? ((a.w - a.p) / a.n * 100).toFixed(1) : '');
  console.log(`  ${f.padEnd(10)} tune ${show(t)} (${e(t)})  |  held ${show(h)} (${e(h)})`);
}
report.markets = Object.fromEntries(fams.map((f) => [f, { tune: frac(mk.tune[f] || acc()), held: frac(mk.held[f] || acc()) }]));

if (outFile) fs.writeFileSync(outFile, JSON.stringify(report, null, 1));

// the held-out record of the site's rule, for the page (lib/strongest/models.json "measured")
const LABELS = {
  'TT_O0.5': 'Team to score', 'TT_O1.5': 'Team over 1.5 goals', 'TT_O2.5': 'Team over 2.5 goals', DC: 'Double chance',
  WIN: 'Match winner', 12: 'Either team to win', 'U3.5': 'Under 3.5 goals', 'O1.5': 'Over 1.5 goals', 'O2.5': 'Over 2.5 goals',
  'H2_O0.5': 'Goal in the 2nd half', 'H1_O0.5': 'Goal in the 1st half', C_TEAM_O: 'Team corners over', C_O: 'Total corners over',
  C_MOST: 'Most corners', K_O: 'Cards over', K_U: 'Cards under', BTTS_Y: 'Both teams to score',
  WEH_H: 'Home to win either half', WEH_A: 'Away to win either half', 'DC1X_O1.5': 'Home or draw & over 1.5',
};
if (MODELS) {
  const site = report.site;
  const h = site.held;
  const t = site.tune;
  const fr = (a) => (a && a.n ? { n: a.n, hit: a.won, stated: a.stated } : null);
  const sl = (part, k) => {
    const s = part.slips[k];
    return s ? { n: s.n, landed: s.landed, stated: s.stated, legs: s.legs, ...(s.fairOdds ? { fairOdds: s.fairOdds } : {}) } : null;
  };
  const slipsOf = (part) => ({
    safe: { target: SC.safeSlipChance, ...sl(part, `target ${SC.safeSlipChance}`) },
    long: { target: SC.longSlipChance, ...sl(part, `target ${SC.longSlipChance}`) },
    all: sl(part, 'all'),
    bySize: Object.fromEntries(['1', '2', '3', '4', '5', '6', '8', '10', '15'].filter((k) => part.slips[k]).map((k) => [k, { n: part.slips[k].n, landed: part.slips[k].landed, stated: part.slips[k].stated }])),
  });
  let last = '';
  for (const r of rows) if (r.d > last) last = r.d;
  const models = JSON.parse(fs.readFileSync(MODELS, 'utf8'));
  models.measured = {
    rule: `v${SC.version}: ${Math.round(SC.minChance * 100)}% measured chance (${Math.round(SC.minChanceStatsOnly * 100)}% corners and bookings), every view ${Math.round(SC.floor * 100)}%+, bookmakers at most ${Math.round(SC.maxProb * 100)}%, ${SC.excluded.length} weak markets kept off`,
    method: 'price-anchored replay (research/v6/slips_study.js): the bookmaker-anchored and possession views; the v6 factor and stats views and the trap checks cannot be rebuilt on the archive, so the site adds checks the replay does not',
    window: `Jul 2023 – ${new Date(last + 'T00:00:00Z').toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`,
    matches: h.matches,
    matchDays: h.days,
    perMatchDay: h.perDay,
    pickShare: +(h.picks.n / Math.max(1, h.matches)).toFixed(4),
    all: fr(h.picks),
    tiers: Object.fromEntries(Object.entries(h.tiers).filter(([k]) => k !== 'below').map(([k, a]) => [k, fr(a)])),
    families: Object.fromEntries(Object.entries(h.markets).map(([k, a]) => [k, { ...fr(a), label: LABELS[k] || k }])),
    slips: slipsOf(h),
    tuning: { window: 'Jul 2019 – Jun 2023', matches: t.matches, perMatchDay: t.perDay, all: fr(t.picks), slips: slipsOf(t) },
  };
  fs.writeFileSync(MODELS, JSON.stringify(models, null, 1) + '\n');
  console.log(`\nheld-out record of the site rule written into ${MODELS}`);
}
