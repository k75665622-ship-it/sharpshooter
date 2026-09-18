const espn = require('./lib/espn');
const A = require('./lib/analysis');
const E = require('./lib/engine');
const L = require('./lib/leagues');

(async () => {
  const ymd = espn.ymd(new Date());
  const slugs = ['uefa.europa', 'esp.1', 'rus.1', 'eng.3'];
  const all = [];
  for (const s of slugs) {
    const raw = await espn.scoreboardRaw(s, ymd);
    for (const ev of raw.events) {
      const m = A.normaliseEvent(ev, s);
      if (m) { m.seasonYear = raw.season; all.push(m); }
    }
  }
  console.log('Total matches today:', all.length, '\n');

  // Build the team index once (this is the expensive one-time step)
  console.time('teamIndex');
  const idx = await A.buildTeamIndex();
  console.timeEnd('teamIndex');
  console.log('Indexed teams:', Object.keys(idx).length, '\n');

  for (const m of all) {
    const rep = await E.analyseMatch(m, m.seasonYear);
    const tag = rep.analysable ? 'OK ' : 'SKIP';
    let line = tag + ' ' + m.league.padEnd(14) + ' ' + m.home.name + ' vs ' + m.away.name;
    if (rep.analysable) {
      const b = rep.banker;
      line += '\n      xG ' + rep.model.lambda.home.toFixed(2) + '-' + rep.model.lambda.away.toFixed(2)
        + ' | 1X2 ' + (rep.model.oneXtwo.pHome * 100).toFixed(0) + '/' + (rep.model.oneXtwo.pDraw * 100).toFixed(0) + '/' + (rep.model.oneXtwo.pAway * 100).toFixed(0)
        + ' | baseline ' + rep.baseline.source;
      line += '\n      BANKER: ' + (b ? (b.label + ' @ ' + (b.prob * 100).toFixed(1) + '% score ' + b.score + ' [' + b.tier + ']') : 'none');
    } else {
      line += '\n      reason: ' + rep.reason;
    }
    console.log(line);
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
