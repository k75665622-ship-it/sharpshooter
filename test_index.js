const espn = require('./lib/espn');
const A = require('./lib/analysis');

(async () => {
  const ymd = espn.ymd(new Date());
  const raw = await espn.scoreboardRaw('uefa.europa', ymd);
  const idx = await A.buildTeamIndex();

  for (const ev of raw.events) {
    const m = A.normaliseEvent(ev, 'uefa.europa');
    if (!m) continue;
    const h = idx[String(m.home.id)];
    const a = idx[String(m.away.id)];
    console.log(m.home.name, '(' + m.home.id + ') ->', h ? h.slug : 'NOT INDEXED',
      '||', m.away.name, '(' + m.away.id + ') ->', a ? a.slug : 'NOT INDEXED');
  }
  console.log('\n--- index size', Object.keys(idx).length);
  console.log('--- sample ids for ita.1 teams ---');
  const ita = await espn.siteTeamList('ita.1');
  console.log(ita.slice(0, 5).map(t => t.id + ':' + t.name).join(', '));
  console.log('--- does index contain juventus id? ---');
  const juv = ita.find(t => /Juventus/i.test(t.name));
  console.log('Juve:', juv, '=>', juv ? idx[juv.id] : 'n/a');
})().catch(e => { console.error(e); process.exit(1); });
