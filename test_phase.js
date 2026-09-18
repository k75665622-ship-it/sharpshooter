const espn = require('./lib/espn');
const A = require('./lib/analysis');
const E = require('./lib/engine');

const t = () => Date.now();
const since = (t0) => ((Date.now() - t0) / 1000).toFixed(1) + 's';
const net = () => `[net: ${espn.netStats.requests} req, ${espn.netStats.errors} err, ${espn.netStats.retries} retry]`;

(async () => {
  const ymd = espn.ymd(new Date());

  let t0 = t();
  const board = [];
  for (const s of ['uefa.europa', 'esp.1', 'rus.1', 'eng.3']) {
    const raw = await espn.scoreboardRaw(s, ymd);
    for (const ev of raw.events) {
      const m = A.normaliseEvent(ev, s);
      if (m) { m.seasonYear = raw.season; board.push(m); }
    }
  }
  console.log(`scoreboards: ${since(t0)} ${net()}`);

  t0 = t();
  const idx = await A.buildTeamIndex();
  console.log(`team index (${Object.keys(idx).length} teams): ${since(t0)} ${net()}`);

  t0 = t();
  const bl = await A.buildLeagueBaseline('esp.1', 2026);
  console.log(`one baseline (esp.1): ${since(t0)} ${net()} -> ${bl.source} xg=${bl.xg.toFixed(3)}`);

  t0 = t();
  const rep = await E.analyseMatch(board.find((m) => m.league === 'esp.1'), 2026);
  console.log(`one full match analysis: ${since(t0)} ${net()}`);

  t0 = t();
  const all = [];
  for (const m of board) all.push(await E.analyseMatch(m, m.seasonYear));
  console.log(`all ${board.length} matches: ${since(t0)} ${net()}`);
  console.log(`  analysable: ${all.filter((r) => r.analysable).length}/${all.length}`);
  console.log(`  with banker: ${all.filter((r) => r.banker).length}`);
})();
