const espn = require('./lib/espn');
const A = require('./lib/analysis');
const E = require('./lib/engine');

(async () => {
  const ymd = espn.ymd(new Date());
  const raw = await espn.scoreboardRaw('uefa.europa', ymd);
  for (const ev of raw.events) {
    const m = A.normaliseEvent(ev, 'uefa.europa');
    if (!m) continue;
    if (!/OFI|Besiktas|Málaga|Real Sociedad/.test(m.home.name)) continue;

    console.log('\n================ ' + m.home.name + ' vs ' + m.away.name);
    console.log('ids:', m.home.id, m.away.id);
    const comp = ev.competitions[0];
    console.log('RAW odds entries:', comp.odds ? comp.odds.length : 0);
    if (comp.odds) {
      comp.odds.forEach((o, i) => {
        if (!o) { console.log('  [' + i + '] null'); return; }
        console.log('  [' + i + '] provider=' + (o.provider && o.provider.name) +
          ' details=' + JSON.stringify(o.details) +
          ' homeML=' + JSON.stringify(o.moneyline && o.moneyline.home && o.moneyline.home.close && o.moneyline.home.close.odds) +
          ' awayML=' + JSON.stringify(o.moneyline && o.moneyline.away && o.moneyline.away.close && o.moneyline.away.close.odds) +
          ' draw=' + JSON.stringify(o.drawOdds && o.drawOdds.moneyLine));
      });
    }
    console.log('PARSED:', JSON.stringify(m.odds));

    const ctx = await A.buildContext(m, raw.season);
    console.log('home stats via:', ctx.homeVia, '| away via:', ctx.awayVia);
    console.log('home row:', JSON.stringify(ctx.homeRow));
    console.log('away row:', JSON.stringify(ctx.awayRow));
    console.log('baseline:', ctx.baseline.source, 'xg', ctx.baseline.xg.toFixed(3), 'goalsPerTeam', ctx.baseline.goalsPerTeamPerGame.toFixed(3), 'homeShare', ctx.baseline.homeShare.toFixed(3));
  }
})();
