/* Live diagnostic: what did the team-news scanner find across the day's fixtures? */
const A = require('./lib/analysis');
const E = require('./lib/engine');
const espn = require('./lib/espn');
const leagues = require('./lib/leagues');

const DATE = process.argv[2] || '2026-09-17';
const ymd = DATE.replace(/-/g, '');

(async () => {
  console.log('=========================================================');
  console.log(' TEAM-NEWS SCANNER — live run for ' + DATE);
  console.log('=========================================================\n');

  const slugs = leagues.CORE_SLUGS;
  const found = [];
  for (const slug of slugs) {
    let raw;
    try { raw = await espn.scoreboardRaw(slug, ymd); } catch { continue; }
    for (const ev of raw.events || []) {
      if (ev.competitions && ev.competitions[0].status && ev.competitions[0].status.type
          && ev.competitions[0].status.type.state === 'post') continue;
      found.push({ slug, ev, year: raw.season });
    }
  }
  console.log(`Scanning ${found.length} fixtures…\n`);

  let withRisk = 0, highRisk = 0, vetoed = 0, scannedTotal = 0;
  const rows = [];

  for (const f of found) {
    const match = A.normaliseEvent(f.ev, f.slug);
    if (!match) continue;
    let rep;
    try { rep = await E.analyseMatch(match, f.year || 2026); } catch { continue; }
    if (!rep.analysable) continue;

    const nr = rep.newsRisk;
    scannedTotal += nr.scanned;
    const anyRisk = nr.home.level !== 'none' || nr.away.level !== 'none' || nr.neutral.length;
    if (anyRisk) withRisk++;
    if (nr.home.level === 'high' || nr.away.level === 'high') highRisk++;
    const newsVeto = (rep.markets || []).some((m) => (m.traps || []).some((t) => t.source === 'news' && t.severity === 'veto'));
    if (newsVeto) vetoed++;

    rows.push({
      name: `${match.home.name} v ${match.away.name}`,
      scanned: nr.scanned,
      home: nr.home.level,
      away: nr.away.level,
      neutral: nr.neutral.length,
      banker: rep.banker ? rep.banker.label : (rep.lean ? 'lean: ' + rep.lean.label : '—'),
      newsTraps: (rep.banker ? rep.banker.traps : []).filter((t) => t.source === 'news'),
      veto: newsVeto,
      items: [...nr.home.items.map((i) => ({ side: match.home.short, ...i })),
              ...nr.away.items.map((i) => ({ side: match.away.short, ...i })),
              ...nr.neutral.map((i) => ({ side: '—', ...i }))],
    });
  }

  const RANK = { high: 3, medium: 2, info: 1, none: 0 };
  const weight = (r) => RANK[r.home] + RANK[r.away];
  rows.sort((a, b) => weight(b) - weight(a));

  for (const r of rows) {
    const tag = r.home === 'high' || r.away === 'high' ? 'HIGH' :
                r.home === 'medium' || r.away === 'medium' ? 'MED ' :
                (r.home !== 'none' || r.away !== 'none' || r.neutral) ? 'LOW ' : '    ';
    console.log(`[${tag}] ${r.name.padEnd(44)} news:${String(r.scanned).padStart(2)}  home:${r.home.padEnd(6)} away:${r.away.padEnd(6)} neutral:${r.neutral}${r.veto ? '  ** NEWS VETO **' : ''}`);
    console.log(`       banker: ${r.banker}`);
    for (const it of r.items.slice(0, 3)) {
      console.log(`         · [${it.side}] ${it.severity}/${it.kind}: ${it.headline.slice(0, 96)}`);
    }
  }

  console.log('\n=========================================================');
  console.log(` fixtures analysed     : ${rows.length}`);
  console.log(` headlines scanned     : ${scannedTotal}`);
  console.log(` fixtures with any risk: ${withRisk}`);
  console.log(` fixtures with HIGH    : ${highRisk}`);
  console.log(` fixtures news-vetoed  : ${vetoed}`);
  console.log('=========================================================');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
