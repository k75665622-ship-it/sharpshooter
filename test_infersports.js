/* Live test of the InferSports client: fixture matching + consensus. */
const IS = require('./lib/infersports');
const A = require('./lib/analysis');
const espn = require('./lib/espn');

const DATE = process.argv[2] || '2026-09-17';
const ymd = DATE.replace(/-/g, '');

(async () => {
  console.log('=========================================================');
  console.log(' INFERSPORTS CLIENT — live test for ' + DATE);
  console.log('=========================================================\n');

  const raw = await espn.scoreboardRaw('uefa.europa', ymd);
  const fixtures = (raw.events || []).map((ev) => A.normaliseEvent(ev, 'uefa.europa')).filter(Boolean);
  console.log(`ESPN UEL fixtures: ${fixtures.length}\n`);

  let matched = 0;
  const consensuses = [];
  for (const m of fixtures) {
    const c = await IS.consensusFor(DATE, m.home.name, m.away.name);
    if (c) {
      matched++;
      consensuses.push({ m, c });
      console.log(`[MATCH ${c.matchScore}] ${m.home.name} v ${m.away.name}  ->  ${c.eventId} (${c.league})`);
      console.log(`   books: ${c.books.join(', ')}`);
      if (c.h2h) console.log(`   1X2   : home ${c.h2h.home.best}/${c.h2h.home.median}  draw ${c.h2h.draw.best}/${c.h2h.draw.median}  away ${c.h2h.away.best}/${c.h2h.away.median}`);
      const tl = c.lines.totals;
      for (const l of tl) {
        const t = c.totals[l];
        console.log(`   O/U ${String(l).padEnd(5)}: over ${t.over ? t.over.best + '/' + t.over.median : '—'}  under ${t.under ? t.under.best + '/' + t.under.median : '—'}  (${t.books.length} books)`);
      }
      const al = c.lines.ah;
      for (const l of al) {
        const t = c.ah[l];
        console.log(`   AH ${String(l).padEnd(6)}: home ${t.home ? t.home.best + '/' + t.home.median : '—'}  away ${t.away ? t.away.best + '/' + t.away.median : '—'}  (${t.books.length} books)`);
      }
      if (c.ht.h2h) console.log(`   HT 1X2: home ${c.ht.h2h.home.median}  draw ${c.ht.h2h.draw.median}  away ${c.ht.h2h.away.median}`);
      console.log('');
    } else {
      console.log(`[no match] ${m.home.name} v ${m.away.name}`);
    }
  }

  console.log('=========================================================');
  console.log(` matched ${matched}/${fixtures.length} fixtures`);
  const s = IS.netStats();
  console.log(` requests ${s.requests} | errors ${s.errors} | rate-limited ${s.rateLimited}`);
  console.log('=========================================================');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
