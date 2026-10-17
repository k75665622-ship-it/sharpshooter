/* Walk-forward backtest of the methodology layer on real results.

   For every match in the test seasons, ONLY results dated before that match are
   used to build the fixture view, then the real methodology code is run and the
   actual score settles each pick. No future information leaks in.

   What this CAN tell you
     - whether a methodology's gates pick outcomes that happen more often than the
       base rate of that market (lift), and whether the stated probability is honest.
   What it CANNOT tell you (be clear-eyed about it)
     - Price edge / profit. No historical odds are reachable, so "would it have made
       money" is untested. A methodology can be right 80% of the time and still lose
       money at 1.15.
     - Team news, Elo, ESPN xG. They are absent in the past, so the gates that use
       them are waived or fail closed. This is a test of the RESULTS-EVIDENCE half.
     - λ here comes from goals only (no xG), a weaker input than production uses.

   Run:  node backtest_methodology.js [seasonStart ...]    (default 2024 2025)  */

const M = require('./lib/model');
const MI = require('./lib/methodology');
const H = require('./lib/history');

const LEAGUES = (process.env.BT_LEAGUES || 'eng.1,ger.1,esp.1,ita.1,eng.2,aut.1').split(',');
const SEASONS = process.argv.slice(2).map(Number).filter(Boolean);
if (!SEASONS.length) SEASONS.push(2023, 2024, 2025);

// -------------------------------------------------------------- settlement
/** 1 = win, 0 = lose, null = push/void. */
function settle(key, hg, ag) {
  const tot = hg + ag;
  let m;
  switch (true) {
    case key === 'O2.5': return tot > 2 ? 1 : 0;
    case key === 'U2.5': return tot <= 2 ? 1 : 0;
    case key === 'BTTS_Y': return hg > 0 && ag > 0 ? 1 : 0;
    case key === 'BTTS_N': return hg > 0 && ag > 0 ? 0 : 1;
    case key === 'GG2P': return hg >= 2 && ag >= 2 ? 1 : 0;
    case key === '1': return hg > ag ? 1 : 0;
    case key === 'X': return hg === ag ? 1 : 0;
    case key === '2': return hg < ag ? 1 : 0;
    case key === 'DNB_H': return hg === ag ? null : hg > ag ? 1 : 0;
    case key === 'DNB_A': return hg === ag ? null : ag > hg ? 1 : 0;
    case (m = /^TT([HA])_([OU])(\d+(?:\.\d+)?)$/.exec(key)) !== null: {
      const g = m[1] === 'H' ? hg : ag;
      const line = Number(m[3]);
      return m[2] === 'O' ? (g > line ? 1 : 0) : g < line ? 1 : 0;
    }
    case (m = /^AH_([HA])_(-?\d+(?:\.\d+)?)$/.exec(key)) !== null: {
      const line = Number(m[2]);
      const d = m[1] === 'H' ? hg - ag + line : ag - hg - line;
      return d > 1e-9 ? 1 : d < -1e-9 ? 0 : null;
    }
    default: return null;
  }
}

// -------------------------------------------------------------- λ from results only
function lambdasFromResults(matches, before, hName, aName) {
  const prior = matches.filter((m) => m.date < before);
  const win = prior.slice(-380);
  if (win.length < 60) return null;
  const lgGoals = win.reduce((a, m) => a + m.hg + m.ag, 0) / (win.length * 2);
  const homeGoals = win.reduce((a, m) => a + m.hg, 0);
  const homeShare = homeGoals / win.reduce((a, m) => a + m.hg + m.ag, 0);

  const row = (name) => {
    const g = prior.filter((m) => m.home === name || m.away === name).slice(-38);
    if (g.length < 6) return null;
    let gf = 0, ga = 0, hgl = 0, agl = 0;
    for (const m of g) {
      if (m.home === name) { gf += m.hg; ga += m.ag; hgl += m.hg; } else { gf += m.ag; ga += m.hg; agl += m.ag; }
    }
    return { gp: g.length, xg: null, xga: null, gf, ga, homeGoals: hgl, awayGoals: agl };
  };
  const home = row(hName);
  const away = row(aName);
  if (!home || !away) return null;
  const est = M.estimateLambdas({
    home, away,
    league: { xg: 0, goalsPerTeamPerGame: lgGoals, homeShare },
    form: null, h2h: null, homeStrength: 1, awayStrength: 1,
  });
  return est;
}

/** League table (rank) from results already played this season — gives the GAP gate real input. */
function tableRanks(matches, before, season) {
  const pts = {}, gd = {};
  for (const m of matches) {
    if (m.date >= before || H.seasonStartFor(m.date) !== season) continue;
    for (const [t, f, a] of [[m.home, m.hg, m.ag], [m.away, m.ag, m.hg]]) {
      pts[t] = (pts[t] || 0) + (f > a ? 3 : f === a ? 1 : 0);
      gd[t] = (gd[t] || 0) + f - a;
    }
  }
  const order = Object.keys(pts).sort((x, y) => pts[y] - pts[x] || gd[y] - gd[x]);
  const rank = {};
  order.forEach((t, i) => { rank[t] = i + 1; });
  return rank;
}

function bundle(matches, hName, aName, before) {
  const rates = H.leagueRates(matches, before);
  return {
    source: 'openfootball',
    leagueRates: rates,
    home: { name: hName, games: H.teamGames(matches, hName, before, 12) },
    away: { name: aName, games: H.teamGames(matches, aName, before, 12) },
    h2h: H.h2hGames(matches, hName, aName, before, 8),
  };
}

// -------------------------------------------------------------- run
(async () => {
  const rows = []; // one row per (fixture, method) evaluation
  const allFixtures = [];
  const raw = []; // raw model probabilities for every fixture, independent of any gate
  let skipped = 0;

  for (const slug of LEAGUES) {
    for (const season of SEASONS) {
      const asOf = new Date(Date.UTC(season, 11, 31)); // loads season-1 and season
      const matches = await H.loadRecent(slug, asOf);
      const test = matches.filter((m) => H.seasonStartFor(m.date) === season);
      for (const fx of test) {
        const lam = lambdasFromResults(matches, fx.date, fx.home, fx.away);
        if (!lam) { skipped++; continue; }
        const total = lam.lamH + lam.lamA;
        const rho = M.clamp(-0.05 * (2.6 / Math.max(1.8, total)), -0.1, -0.02);
        const sm = M.scoreMatrix(lam.lamH, lam.lamA, rho);
        const markets = M.deriveMarkets(sm).map((m) => ({ ...m, price: m.fairOdds, priceSource: 'synthetic' }));
        const match = { date: `${fx.date}T15:00:00Z`, home: { name: fx.home }, away: { name: fx.away }, odds: null };
        const out = MI.evaluateFixture({
          match, sm, model: { lambda: { home: lam.lamH, away: lam.lamA } }, markets,
          ctx: (() => {
            const rk = tableRanks(matches, fx.date, season);
            return { standings: { home: rk[fx.home] ? { rank: rk[fx.home] } : null, away: rk[fx.away] ? { rank: rk[fx.away] } : null }, form: {}, homeRow: null, awayRow: null };
          })(),
          newsRisk: null, hist: bundle(matches, fx.home, fx.away, fx.date), elo: null,
        });
        allFixtures.push({ hg: fx.hg, ag: fx.ag });
        for (const mk of markets) {
          if (['O2.5', 'U2.5', 'BTTS_Y', 'BTTS_N', '1', 'X', '2'].includes(mk.key)) raw.push({ key: mk.key, prob: mk.prob, hit: settle(mk.key, fx.hg, fx.ag), season });
        }
        for (const r of out.results) {
          if (!r.pick.key) continue;
          rows.push({ id: r.id, key: r.pick.key, status: r.status, prob: r.prob, hit: settle(r.pick.key, fx.hg, fx.ag), failed: r.failedGates, kept: out.predictions.includes(r), weak: r.checklist.items.filter((c) => !c.unknown && c.score < 0.5).map((c) => c.id), ratio: r.checklist.ratio, thin: r.checklist.thin });
        }
      }
    }
  }

  // base rate per pick key over ALL evaluated fixtures
  const base = {};
  const keys = new Set(rows.map((r) => r.key));
  for (const k of keys) {
    let n = 0, h = 0;
    for (const f of allFixtures) { const s = settle(k, f.hg, f.ag); if (s == null) continue; n++; h += s; }
    base[k] = n ? h / n : null;
  }

  const pct = (x, d = 1) => (x == null ? '  -  ' : (x * 100).toFixed(d) + '%');
  const agg = (list) => {
    const settled = list.filter((r) => r.hit != null);
    const n = settled.length;
    if (!n) return null;
    const hits = settled.reduce((a, r) => a + r.hit, 0);
    const meanProb = settled.reduce((a, r) => a + r.prob, 0) / n;
    const meanBase = settled.reduce((a, r) => a + (base[r.key] ?? 0), 0) / n;
    // Brier score of the stated probability on these picks
    const brier = settled.reduce((a, r) => a + (r.prob - r.hit) ** 2, 0) / n;
    return { n, hit: hits / n, meanProb, meanBase, brier, voids: list.length - n };
  };

  console.log(`\nWalk-forward backtest  |  ${LEAGUES.join(', ')}  |  seasons ${SEASONS.join(', ')}`);
  console.log(`fixtures evaluated: ${allFixtures.length}   (skipped, too little prior history: ${skipped})`);
  console.log('Evidence = past results only. No odds, Elo, team news or xG are available historically.\n');

  const ids = [...new Set(rows.map((r) => r.id))];
  const names = Object.fromEntries(MI.SPECS.map((s) => [s.id, s.name]));
  console.log('METHOD'.padEnd(26) + 'PICKED'.padStart(7) + 'HIT'.padStart(8) + 'MODEL'.padStart(8) + 'BASE'.padStart(8) + 'LIFT'.padStart(8) + '   | not picked: hit / model   (LIFT = picked - not picked)');
  console.log('-'.repeat(100));
  const summary = {};
  for (const id of ids) {
    const mine = rows.filter((r) => r.id === id);
    const picked = agg(mine.filter((r) => r.kept));
    const rest = agg(mine.filter((r) => !r.kept));
    summary[id] = { picked, rest };
    if (!picked) { console.log(names[id].padEnd(26) + '      0   (no fixture qualified)'); continue; }
    const lift = rest ? picked.hit - rest.hit : picked.hit - picked.meanBase;
    console.log(
      names[id].padEnd(26) + String(picked.n).padStart(7) + pct(picked.hit).padStart(8) + pct(picked.meanProb).padStart(8) +
      pct(picked.meanBase).padStart(8) + ((lift >= 0 ? '+' : '') + (lift * 100).toFixed(1) + 'pp').padStart(8) +
      `   | ${rest ? pct(rest.hit) + ' / ' + pct(rest.meanProb) : '-'}`);
  }

  // Aggregate across all methods, headline picks only (one per fixture is not enforced here)
  const allPicked = agg(rows.filter((r) => r.kept));
  console.log('-'.repeat(100));
  if (allPicked) console.log('ALL QUALIFYING PICKS'.padEnd(26) + String(allPicked.n).padStart(7) + pct(allPicked.hit).padStart(8) + pct(allPicked.meanProb).padStart(8) + pct(allPicked.meanBase).padStart(8) + (((allPicked.hit - allPicked.meanBase) * 100).toFixed(1) + 'pp').padStart(9));

  // Calibration of the stated probability for qualifying picks
  console.log('\nCalibration of qualifying picks (stated probability vs what happened)');
  const buckets = [[0, 0.4], [0.4, 0.5], [0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 1.01]];
  for (const [lo, hi] of buckets) {
    const a = agg(rows.filter((r) => r.kept && r.prob >= lo && r.prob < hi));
    if (a) console.log(`  model ${(lo * 100).toFixed(0)}-${Math.min(100, hi * 100).toFixed(0)}%`.padEnd(20) + `n=${String(a.n).padStart(4)}  stated ${pct(a.meanProb)}  actual ${pct(a.hit)}  gap ${((a.hit - a.meanProb) * 100).toFixed(1)}pp`);
  }

  // Do the gates add information beyond the model probability alone?
  console.log('\nDo the gates add value over the raw model probability?');
  console.log('  (same market, same probability band: gates-passed vs gates-failed)');
  for (const id of ['over25', 'under25', 'bttsYes', 'bttsNo', 'homeWin', 'awayWin']) {
    const mine = rows.filter((r) => r.id === id && r.prob >= 0.55);
    const pass = agg(mine.filter((r) => r.kept));
    const fail = agg(mine.filter((r) => !r.kept));
    if (pass && fail) {
      console.log(`  ${names[id].padEnd(26)} passed ${pct(pass.hit)} (n=${pass.n}, model ${pct(pass.meanProb)})   vs   failed ${pct(fail.hit)} (n=${fail.n}, model ${pct(fail.meanProb)})`);
    }
  }

  // Raw model calibration, ALL fixtures, no gates: is the model itself honest?
  console.log('\nRaw model calibration over ALL fixtures (no gates)');
  for (const key of ['O2.5', 'U2.5', 'BTTS_Y', 'BTTS_N', '1', 'X', '2']) {
    const mine = raw.filter((r) => r.key === key);
    const line = [];
    for (const [lo, hi] of [[0, 0.3], [0.3, 0.4], [0.4, 0.5], [0.5, 0.6], [0.6, 0.7], [0.7, 1.01]]) {
      const b = mine.filter((r) => r.prob >= lo && r.prob < hi);
      if (b.length >= 15) line.push(`${(lo * 100).toFixed(0)}-${Math.min(100, hi * 100).toFixed(0)}: ${pct(b.reduce((a, r) => a + r.prob, 0) / b.length, 0)}->${pct(b.reduce((a, r) => a + r.hit, 0) / b.length, 0)} (n${b.length})`);
    }
    const all = mine.reduce((a, r) => a + r.hit, 0) / mine.length;
    const mp = mine.reduce((a, r) => a + r.prob, 0) / mine.length;
    const brier = mine.reduce((a, r) => a + (r.prob - r.hit) ** 2, 0) / mine.length;
    console.log(`  ${key.padEnd(7)} mean model ${pct(mp)} actual ${pct(all)} brier ${brier.toFixed(4)}   ${line.join('  ')}`);
  }

  // GG/NG 2+ can never pass its coverage gate (GG4 needs team news, absent historically), so
  // test everything ELSE the methodology demands: the structural gates + the 22% floor.
  const gg = rows.filter((r) => r.id === 'gg2');
  const ggStruct = gg.filter((r) => r.failed.every((g) => g === 'GG4'));
  const ggAgg = agg(ggStruct);
  const ggBase = gg.filter((r) => r.prob >= 0.22);
  console.log('\nGG/NG 2+ structural test (all gates except the team-news coverage gate)');
  console.log(`  base rate of GG/NG 2+ over all fixtures: ${pct(base['GG2P'])}`);
  if (ggAgg) console.log(`  passed structural gates: n=${ggAgg.n}  hit ${pct(ggAgg.hit)}  model ${pct(ggAgg.meanProb)}   (fair odds ${(1 / ggAgg.hit).toFixed(2)} if the hit rate is real)`);
  else console.log('  no fixture passed the structural gates');
  const ggFloor = agg(ggBase);
  if (ggFloor) console.log(`  cleared only the 22% floor: n=${ggFloor.n}  hit ${pct(ggFloor.hit)}  model ${pct(ggFloor.meanProb)}`);

  if (process.env.BT_DUMP) require('fs').writeFileSync(process.env.BT_DUMP, JSON.stringify({ raw, base }));

  if (process.env.BT_DEBUG) {
    console.log('\nDEBUG: status counts, and weakest checklist items among fixtures with NO failed gate');
    for (const id of ids) {
      const mine = rows.filter((r) => r.id === id);
      const st = {};
      for (const r of mine) st[r.status] = (st[r.status] || 0) + 1;
      const noGate = mine.filter((r) => r.failed.length === 0);
      const cnt = {};
      for (const r of noGate) for (const w of r.weak) cnt[w] = (cnt[w] || 0) + 1;
      const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([g, c]) => `${g}:${c}`).join(' ');
      console.log(`  ${names[id].padEnd(26)} ${JSON.stringify(st)}  gate-clean ${noGate.length}  weak items: ${top}`);
    }
  }

  // Which gate does the most work (removes the most fixtures)
  console.log('\nGates that fire most (among fixtures where model probability cleared the floor)');
  for (const id of ids) {
    const mine = rows.filter((r) => r.id === id && !r.failed.includes('MODEL'));
    const cnt = {};
    for (const r of mine) for (const g of r.failed) cnt[g] = (cnt[g] || 0) + 1;
    const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g, c]) => `${g}:${c}`).join('  ');
    if (mine.length) console.log(`  ${names[id].padEnd(26)} cleared floor ${String(mine.length).padStart(4)}   top removals  ${top || '-'}`);
  }
  console.log('\nReminder: a high hit rate is not profit. Without historical odds the price side is untested.\n');
})();
