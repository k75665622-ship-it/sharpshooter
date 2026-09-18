const espn = require('./lib/espn');
const A = require('./lib/analysis');
const E = require('./lib/engine');

(async () => {
  const ymd = espn.ymd(new Date());
  const board = [];
  for (const s of ['esp.1', 'rus.1', 'eng.3', 'uefa.europa']) {
    const raw = await espn.scoreboardRaw(s, ymd);
    for (const ev of raw.events) {
      const m = A.normaliseEvent(ev, s);
      if (m) { m.seasonYear = raw.season; board.push(m); }
    }
  }

  for (const m of board) {
    const rep = await E.analyseMatch(m, m.seasonYear);
    if (!rep.analysable) { console.log('SKIP', m.home.name, 'vs', m.away.name); continue; }
    const top = [...rep.markets].sort((a, b) => b.score - a.score).slice(0, 4);
    console.log('\n' + m.home.name + ' vs ' + m.away.name + '  [λ ' +
      rep.model.lambda.home.toFixed(2) + '-' + rep.model.lambda.away.toFixed(2) +
      '  1X2 ' + (rep.model.oneXtwo.pHome * 100).toFixed(0) + '/' + (rep.model.oneXtwo.pDraw * 100).toFixed(0) + '/' + (rep.model.oneXtwo.pAway * 100).toFixed(0) + ']');
    for (const k of top) {
      const c = k.components;
      console.log('   ' + k.score.toFixed(1).padStart(5) + '  ' + k.label.padEnd(30) +
        ' p=' + (k.prob * 100).toFixed(1).padStart(5) + '%' +
        (k.vetoed ? ' VETOED' : '') +
        '  [p' + c.prob + ' ag' + c.agreement + ' xg' + c.xg + ' fm' + c.form + ' h2h' + c.h2h + ' pt' + c.pattern + ' sm' + c.sample + ']' +
        '  traps:' + (k.traps || []).map(t => t.id + '/' + t.severity).join(','));
    }
  }
})();
