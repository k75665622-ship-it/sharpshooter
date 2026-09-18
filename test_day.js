const espn = require('./lib/espn');
const A = require('./lib/analysis');
const E = require('./lib/engine');
const S = require('./lib/signals');

const DATE = process.argv[2] || '20260919';
const SLUGS = (process.argv[3] || 'eng.1,esp.1,ita.1,ger.1,fra.1,eng.2,ned.1,por.1').split(',');

(async () => {
  const board = [];
  for (const s of SLUGS) {
    const raw = await espn.scoreboardRaw(s, DATE);
    for (const ev of raw.events) {
      const m = A.normaliseEvent(ev, s);
      if (m) { m.seasonYear = raw.season; board.push(m); }
    }
  }
  console.log('DATE ' + DATE + ' — ' + board.length + ' matches across ' + SLUGS.length + ' leagues\n');

  const reports = [];
  const queue = [...board];
  async function worker() {
    while (queue.length) {
      const m = queue.shift();
      try { reports.push(await E.analyseMatch(m, m.seasonYear)); }
      catch (e) { console.log('ERR', m.name, e.message); }
    }
  }
  await Promise.all(Array.from({ length: 5 }, worker));

  const ok = reports.filter(r => r.analysable);
  const withB = ok.filter(r => r.banker);
  console.log('analysable ' + ok.length + '/' + reports.length + ' | bankers ' + withB.length + '\n');

  withB.sort((a, b) => b.banker.score - a.banker.score);
  for (const r of withB) {
    const b = r.banker;
    console.log('  ' + String(b.score).padStart(5) + '  ' + b.tier.padEnd(8) + ' ' +
      (r.match.home.name + ' v ' + r.match.away.name).padEnd(42) +
      b.label.padEnd(26) + ' p=' + (b.prob * 100).toFixed(1) + '% px=' + b.price.toFixed(2) +
      ' ev=' + (b.valuePct == null ? '-' : b.valuePct.toFixed(1) + '%'));
  }

  // Top ELIGIBLE markets, to see how close the engine got to a banker.
  const rows = [];
  for (const r of ok) {
    if (r.banker) continue;
    for (const mk of r.markets) {
      if (!S.isBankerEligible(mk.key) || mk.vetoed) continue;
      rows.push({ r, mk });
    }
  }
  rows.sort((a, b) => b.mk.score - a.mk.score);
  console.log('\nTop ELIGIBLE non-banker markets:');
  for (const { r, mk } of rows.slice(0, 14)) {
    const c = mk.components;
    console.log('  ' + String(mk.score).padStart(5) + '  ' + (r.match.home.short + ' v ' + r.match.away.short).padEnd(14) +
      mk.label.padEnd(24) + ' p=' + (mk.prob * 100).toFixed(1).padStart(5) + '%' +
      (mk.verified ? ' px=' + mk.price.toFixed(2) : ' (unquoted)') +
      ' floor=' + (S.BANKER_FLOOR[mk.group] || 0.6) +
      ' [p' + c.prob + ' ag' + c.agreement + ' xg' + c.xg + ' fm' + c.form + ' pt' + c.pattern + ' sm' + c.sample + ']' +
      ' ' + (mk.traps || []).map(t => t.id).join(','));
  }
})();
