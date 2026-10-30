'use strict';

/**
 * research/v6/strongest_report.js — how the Strongest Picks rule did on history.
 *
 *   node research/v6/strongest_report.js <strongest_dump.jsonl> [out.json]
 *
 * Reads research/v6/strongest_study.js output and reports, for the tuning seasons
 * (2019-07..2023-06) and the held-out seasons (2023-07 on) separately:
 *
 *   picks      stated probability vs what happened, overall / by group / by market / by tier
 *   all        every selection with a view of 75%+ (not only the chosen one), per market and
 *              per view, so a miscalibrated view or market shows up even when it is rarely picked
 *   selection  the same markets when chosen as the match's pick vs when not (the cost of taking
 *              the best of ~70 noisy numbers)
 */

const fs = require('fs');

const argv = process.argv.slice(2);
const mi = argv.indexOf('--measured');
const measuredInto = mi >= 0 ? argv.splice(mi, 2)[1] : null;
const si = argv.indexOf('--sim');
const simGrid = si >= 0 ? argv.splice(si, 1) && true : false;
const [file, outFile] = argv;
const SPLIT = '2023-07-01';
const GROUP = (k) => {
  if (/^(O|U)\d|^BTTS/.test(k)) return 'Goals';
  if (/^TT/.test(k)) return 'Team';
  if (/^(1|X|2|1X|X2|12)$/.test(k)) return 'Match';
  if (/^(H1|H2|HT|HSH)/.test(k)) return 'Half';
  if (/^M\d/.test(k)) return 'Minutes';
  if (/^C/.test(k)) return 'Corners';
  if (/^K_/.test(k)) return 'Bookings';
  return 'Special';
};
const FAMILY = (k) => {
  let m;
  if ((m = /^TT([HA])_([OU])(\d\.5)$/.exec(k))) return `TT_${m[2]}${m[3]}`;
  if ((m = /^C([HA])_O/.exec(k))) return 'C_TEAM_O';
  if (/^C_MOST/.test(k)) return 'C_MOST';
  if ((m = /^C_([OU])/.exec(k))) return `C_${m[1]}`;
  if ((m = /^K_([OU])/.exec(k))) return `K_${m[1]}`;
  if (k === '1X' || k === 'X2') return 'DC';
  if (k === '1' || k === '2') return 'WIN';
  return k;
};

function acc() {
  return { n: 0, w: 0, p: 0, f: 0, ll: 0 };
}
function add(a, p, f, r) {
  a.n++;
  a.w += r;
  a.p += p;
  a.f += f;
  const q = Math.min(0.999, Math.max(0.001, p));
  a.ll += r ? -Math.log(q) : -Math.log(1 - q);
}
const show = (a) => (a.n ? { n: a.n, hit: +(a.w / a.n * 100).toFixed(1), stated: +(a.p / a.n * 100).toFixed(1), floor: +(a.f / a.n * 100).toFixed(1), gap: +((a.w - a.p) / a.n * 100).toFixed(1) } : { n: 0 });

const R = { tune: newPart(), test: newPart() };
function newPart() {
  return {
    matches: 0,
    withPick: 0,
    days: new Map(),
    picks: { all: acc(), group: {}, key: {}, family: {}, tier: {}, live: { 1: acc(), 0: acc() } },
    sel: { key: {}, view: {} },
    chosen: {},
    notChosen: {},
  };
}
const get = (o, k) => (o[k] = o[k] || acc());
// the production tiers, by the pick's stated (measured) chance
const TIERS = require('../../lib/strongest/config').tiers;
const tierOf = (p) => (TIERS.find((t) => p >= t.min - 1e-9) || { name: 'below' }).name;
const bin = (p) => (p >= 0.85 ? '85-88' : p >= 0.8 ? '80-85' : p >= 0.75 ? '75-80' : '<75');

const lines = fs.readFileSync(file, 'utf8').split('\n');

/**
 * --sim: re-run the pick choice from the recorded selections under other bars (the replay
 * records every blocker except the chance / lowest-view / price bars), on both periods.
 */
if (simGrid) {
  const statsOnly = (k) => /^(C|K_)/.test(k);
  const rows = [];
  for (const line of lines) {
    if (!line) continue;
    const r = JSON.parse(line);
    rows.push({ d: r.d, s: r.s.filter((x) => x[4] != null && x[5] === 0 && x[6] === 1) });
  }
  const sim = (cfg) => {
    const R = { tune: { m: 0, n: 0, w: 0, p: 0, days: new Map(), so: { n: 0, w: 0, p: 0 } }, test: { m: 0, n: 0, w: 0, p: 0, days: new Map(), so: { n: 0, w: 0, p: 0 } } };
    for (const r of rows) {
      const P = r.d < SPLIT ? R.tune : R.test;
      P.m++;
      let best = null;
      let bs = -1;
      for (const x of r.s) {
        const [key, prob, floor, v] = x;
        const so = statsOnly(key);
        if (so && cfg.noStats) continue;
        if (prob < (so ? cfg.minChanceStatsOnly : cfg.minChance) - 1e-9) continue;
        if (floor < (so ? cfg.floorStatsOnly : cfg.floor) - 1e-9) continue;
        const pay = !so && v.m != null ? v.m : prob;
        if (pay > cfg.maxProb + 1e-9) continue;
        const st = prob - (so ? cfg.penalty : 0);
        if (st > bs) {
          bs = st;
          best = x;
        }
      }
      P.days.set(r.d, (P.days.get(r.d) || 0) + (best ? 1 : 0));
      if (!best) continue;
      P.n++;
      P.w += best[4];
      P.p += best[1];
      if (statsOnly(best[0])) {
        P.so.n++;
        P.so.w += best[4];
        P.so.p += best[1];
      }
    }
    const f = (P) => ({
      picks: P.n,
      share: +(P.n / P.m * 100).toFixed(1),
      perDay: +([...P.days.values()].reduce((a, b) => a + b, 0) / P.days.size).toFixed(1),
      hit: +(P.w / P.n * 100).toFixed(1),
      stated: +(P.p / P.n * 100).toFixed(1),
      cornersCards: P.so.n ? { n: P.so.n, hit: +(P.so.w / P.so.n * 100).toFixed(1), stated: +(P.so.p / P.so.n * 100).toFixed(1) } : null,
    });
    return { tune: f(R.tune), test: f(R.test) };
  };
  const out = [];
  const base = { minChance: 0.8, minChanceStatsOnly: 0.82, floor: 0.75, floorStatsOnly: 0.75, maxProb: 0.88, penalty: 0.03, noStats: false };
  const grid = [];
  for (const mc of [0.75, 0.78, 0.8, 0.82, 0.84]) {
    for (const extra of [0, 0.02]) grid.push({ ...base, minChance: mc, minChanceStatsOnly: Math.min(0.88, mc + extra) });
    grid.push({ ...base, minChance: mc, noStats: true });
  }
  for (const fl of [0.7, 0.8]) grid.push({ ...base, floor: fl, floorStatsOnly: fl });
  for (const cfg of grid) {
    const r = sim(cfg);
    out.push({ cfg, ...r });
    const c = (x) => (x ? `c/c ${x.n} ${x.hit}/${x.stated}` : 'c/c —');
    // the grid is for CHOOSING: tuning seasons only (the held-out seasons are reported once,
    // for the chosen bars, by the normal report on the production replay)
    console.log(`chance ${cfg.minChance} stats ${cfg.noStats ? 'off ' : cfg.minChanceStatsOnly} floor ${cfg.floor} | TUNE ${r.tune.picks} picks (${r.tune.perDay}/match day, ${r.tune.share}% of matches) hit ${r.tune.hit} stated ${r.tune.stated} ${c(r.tune.cornersCards)}`);
    delete r.test;
  }
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(out.map((o) => ({ cfg: o.cfg, tune: o.tune })), null, 1));
  process.exit(0);
}
for (const line of lines) {
  if (!line) continue;
  const r = JSON.parse(line);
  const P = r.d < SPLIT ? R.tune : R.test;
  P.matches++;
  P.days.set(r.d, (P.days.get(r.d) || 0) + (r.pick ? 1 : 0));
  for (const s of r.s) {
    const [key, prob, floor, views, res, blocked] = s;
    if (res == null) continue;
    const fam = FAMILY(key);
    if (floor >= 0.75 && prob <= 0.88) {
      // every candidate in the pick band, chosen or not
      get(P.sel.key, `${fam}|${bin(floor)}`);
      add(P.sel.key[`${fam}|${bin(floor)}`], prob, floor, res);
      const chosen = r.pick === key;
      add(get(chosen ? P.chosen : P.notChosen, fam), prob, floor, res);
    }
    for (const [v, p] of Object.entries(views)) {
      if (p == null || p < 0.75 || p > 0.9) continue;
      add(get(P.sel.view, `${GROUP(key)}|${v}|${bin(p)}`), p, p, res);
    }
  }
  if (!r.pick) continue;
  const s = r.s.find((x) => x[0] === r.pick);
  if (!s || s[4] == null) continue;
  P.withPick++;
  const [key, prob, floor, , res] = s;
  add(P.picks.all, prob, floor, res);
  add(get(P.picks.group, GROUP(key)), prob, floor, res);
  add(get(P.picks.key, key), prob, floor, res);
  add(get(P.picks.family, FAMILY(key)), prob, floor, res);
  add(get(P.picks.tier, tierOf(prob)), prob, floor, res);
  add(P.picks.live[r.live ? 1 : 0], prob, floor, res);
}

const out = {};
for (const [name, P] of Object.entries(R)) {
  const perDay = [...P.days.values()];
  const o = {
    matches: P.matches,
    picks: P.withPick,
    pickShare: +(P.withPick / P.matches * 100).toFixed(1),
    picksPerMatchDay: +(perDay.reduce((a, b) => a + b, 0) / perDay.length).toFixed(1),
    all: show(P.picks.all),
    live: { mirrored: show(P.picks.live[1]), proxy: show(P.picks.live[0]) },
    group: Object.fromEntries(Object.entries(P.picks.group).sort((a, b) => b[1].n - a[1].n).map(([k, a]) => [k, show(a)])),
    tier: Object.fromEntries(Object.entries(P.picks.tier).map(([k, a]) => [k, show(a)])),
    family: Object.fromEntries(Object.entries(P.picks.family).sort((a, b) => b[1].n - a[1].n).map(([k, a]) => [k, show(a)])),
    key: Object.fromEntries(Object.entries(P.picks.key).sort((a, b) => b[1].n - a[1].n).slice(0, 40).map(([k, a]) => [k, show(a)])),
    candidates: Object.fromEntries(Object.entries(P.sel.key).sort().map(([k, a]) => [k, show(a)])),
    views: Object.fromEntries(Object.entries(P.sel.view).sort().map(([k, a]) => [k, show(a)])),
    chosenVsNot: Object.fromEntries(Object.keys(P.chosen).sort((a, b) => P.chosen[b].n - P.chosen[a].n).map((k) => [k, { chosen: show(P.chosen[k]), notChosen: show(P.notChosen[k] || acc()) }])),
  };
  out[name] = o;
}

const fmt = (a) => (a.n ? `${String(a.n).padStart(6)}  hit ${a.hit.toFixed(1).padStart(5)}  stated ${a.stated.toFixed(1).padStart(5)}  gap ${(a.gap >= 0 ? '+' : '') + a.gap.toFixed(1)}` : '     0');
for (const [name, o] of Object.entries(out)) {
  console.log(`\n=== ${name === 'tune' ? 'TUNING 2019-07..2023-06' : 'HELD-OUT 2023-07..'}  matches ${o.matches}, picks ${o.picks} (${o.pickShare}% of matches, ${o.picksPerMatchDay} per match day)`);
  console.log('ALL picks       ', fmt(o.all));
  console.log('  live-mirrored ', fmt(o.live.mirrored));
  console.log('  proxy views   ', fmt(o.live.proxy));
  console.log('-- by tier');
  for (const [k, a] of Object.entries(o.tier)) console.log('  ' + k.padEnd(14), fmt(a));
  console.log('-- by group');
  for (const [k, a] of Object.entries(o.group)) console.log('  ' + k.padEnd(14), fmt(a));
  console.log('-- by family');
  for (const [k, a] of Object.entries(o.family)) console.log('  ' + k.padEnd(14), fmt(a));
}
if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1));

// the held-out record, for the page (lib/strongest/models.json "measured")
const LABELS = {
  TT_U2: 'Team under goals', 'TT_U2.5': 'Team under 2.5 goals', 'TT_U1.5': 'Team under 1.5 goals', 'TT_O0.5': 'Team to score',
  'TT_O1.5': 'Team over 1.5 goals', DC: 'Double chance', WIN: 'Match winner', 12: 'Either team to win', 'U3.5': 'Under 3.5 goals',
  'O1.5': 'Over 1.5 goals', 'O2.5': 'Over 2.5 goals', 'H2_O0.5': 'Goal in the 2nd half', 'H1_O0.5': 'Goal in the 1st half',
  C_TEAM_O: 'Team corners over', C_O: 'Total corners over', C_U: 'Total corners under', C_MOST: 'Most corners',
  K_O: 'Cards over', K_U: 'Cards under', BTTS_N: 'Both teams to score: No', BTTS_Y: 'Both teams to score',
  WEH_H: 'Home to win either half', WEH_A: 'Away to win either half', 'DC1X_O1.5': 'Home or draw & over 1.5', 'DCX2_O1.5': 'Away or draw & over 1.5',
};
if (measuredInto) {
  const t = out.test;
  const frac = (a) => ({ n: a.n, hit: +(a.hit / 100).toFixed(4), stated: +(a.stated / 100).toFixed(4) });
  const models = JSON.parse(fs.readFileSync(measuredInto, 'utf8'));
  let last = '';
  for (const line of lines) if (line) last = line.slice(6, 16);
  models.measured = {
    window: `Jul 2023 – ${new Date(last + 'T00:00:00Z').toLocaleString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`,
    matches: t.matches,
    perMatchDay: t.picksPerMatchDay,
    pickShare: +(t.pickShare / 100).toFixed(4),
    all: frac(t.all),
    tiers: Object.fromEntries(Object.entries(t.tier).map(([k, a]) => [k, frac(a)])),
    families: Object.fromEntries(Object.entries(t.family).map(([k, a]) => [k, { ...frac(a), label: LABELS[k] || k }])),
  };
  fs.writeFileSync(measuredInto, JSON.stringify(models, null, 1) + '\n');
  console.log(`\nheld-out record written into ${measuredInto}`);
}
