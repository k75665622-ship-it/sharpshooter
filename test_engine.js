const espn = require('./lib/espn');
const A = require('./lib/analysis');
const E = require('./lib/engine');

(async () => {
  const ymd = espn.ymd(new Date());
  console.log('Date:', ymd);
  const raw = await espn.scoreboardRaw('uefa.europa', ymd);
  console.log('Europa events:', raw.events.length, 'season:', raw.season);
  if (!raw.events.length) return;
  const ev = raw.events[0];
  const m = A.normaliseEvent(ev, 'uefa.europa');
  console.log('Match:', m.home.name, 'vs', m.away.name, '| ids', m.home.id, m.away.id);
  console.log('Odds:', JSON.stringify(m.odds));

  const baseline = await A.buildLeagueBaseline('uefa.europa', raw.season);
  console.log('Baseline:', JSON.stringify(baseline));

  const hs = await espn.teamStats('uefa.europa', raw.season, m.home.id);
  console.log('Home stats fields:', hs ? Object.keys(hs).length : 'NULL');
  if (hs) console.log('  xG', hs.avgExpectedGoals, 'xGA', hs.avgExpectedGoalsConceded, 'gp', hs.appearances);

  const rep = await E.analyseMatch(m, raw.season);
  console.log('\n=== ANALYSABLE:', rep.analysable, rep.reason || '');
  if (rep.analysable) {
    console.log('Lambda:', JSON.stringify(rep.model.lambda), 'rho', rep.model.rho);
    console.log('1X2:', JSON.stringify(rep.model.oneXtwo));
    console.log('Markets:', rep.markets.length);
    if (rep.banker) {
      console.log('BANKER:', rep.banker.label, '| prob', (rep.banker.prob * 100).toFixed(1) + '%',
        '| score', rep.banker.score, '| tier', rep.banker.tier, '| price', rep.banker.price);
    } else {
      console.log('BANKER: NONE');
    }
    console.log('Verdict:', rep.verdict.summary);
    console.log('Patterns visible:', rep.patterns.visible.length, 'hidden:', rep.patterns.hidden.length);
    console.log('\nTop 8 markets by score:');
    [...rep.markets].filter(x => !x.vetoed).sort((a, b) => b.score - a.score).slice(0, 8).forEach(x => {
      console.log('  ', x.score.toFixed(1), x.label, '| prob', (x.prob * 100).toFixed(1) + '%',
        '| price', x.price ? x.price.toFixed(2) : '-', '| src', x.priceSource, '| ev', x.ev != null ? (x.ev * 100).toFixed(1) + '%' : '-');
    });
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
