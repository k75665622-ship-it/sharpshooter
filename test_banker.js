const espn = require('./lib/espn');
const A = require('./lib/analysis');
const E = require('./lib/engine');
const S = require('./lib/signals');

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

  let bankers = 0;
  for (const m of board) {
    const rep = await E.analyseMatch(m, m.seasonYear);
    if (!rep.analysable) continue;
    const elig = rep.markets
      .filter((k) => S.isBankerEligible(k.key) && k.verified && k.price >= S.BANKER_MIN_PRICE)
      .sort((a, b) => b.score - a.score);
    console.log('\n' + m.home.short + ' v ' + m.away.short + '  [' +
      rep.model.lambda.home.toFixed(2) + '-' + rep.model.lambda.away.toFixed(2) + ']  ' +
      (rep.banker ? '>>> BANKER: ' + rep.banker.label + ' @' + rep.banker.price.toFixed(2) + ' score ' + rep.banker.score + ' [' + rep.banker.tier + ']' : 'no banker'));
    for (const k of elig.slice(0, 6)) {
      const c = k.components;
      console.log('   ' + k.score.toFixed(1).padStart(5) + ' ' + k.label.padEnd(26) +
        ' p=' + (k.prob * 100).toFixed(1).padStart(5) + '% px=' + k.price.toFixed(2) +
        ' ev=' + (k.valuePct == null ? '-' : k.valuePct.toFixed(1)) + '%' +
        ' [p' + c.prob + ' ag' + c.agreement + ' xg' + c.xg + ' fm' + c.form + ' h2h' + c.h2h + ' pt' + c.pattern + ' sm' + c.sample + ']' +
        ' ' + (k.traps || []).map(t => t.id + '/' + t.severity).join(','));
    }
    if (rep.banker) bankers++;
  }
  console.log('\n==> bankers: ' + bankers + ' / ' + board.length);
})();
