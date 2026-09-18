/* How many markets can now be price-verified, with and without the Asian source? */
const A = require('./lib/analysis');
const E = require('./lib/engine');
const espn = require('./lib/espn');

const SLUG = process.argv[2] || 'uefa.europa';
const DATE = process.argv[3] || '2026-09-17';

(async () => {
  const ymd = DATE.replace(/-/g, '');
  const sb = await espn.scoreboardRaw(SLUG, ymd);
  const fixtures = (sb.events || []).map((ev) => A.normaliseEvent(ev, SLUG)).filter(Boolean);

  console.log('=========================================================');
  console.log(' VERIFIED-MARKET COVERAGE  ·  ' + SLUG + '  ' + DATE);
  console.log('=========================================================\n');

  let totMarkets = 0, totVerified = 0, totAsian = 0;
  const newMarkets = {};

  for (const m of fixtures) {
    const rep = await E.analyseMatch(m, sb.season || 2026);
    const name = `${m.home.name} v ${m.away.name}`;
    if (!rep.analysable) {
      console.log(`${name.padEnd(40)} NOT ANALYSABLE — ${rep.reason}`);
      continue;
    }
    const markets = rep.markets || [];
    const verified = markets.filter((x) => x.verified);
    const asian = markets.filter((x) => x.priceSource === 'book-asian');
    const pv = rep.dataProvenance || {};

    totMarkets += markets.length;
    totVerified += verified.length;
    totAsian += asian.length;

    // Which keys are verified ONLY because of the Asian source?
    const onlyAsian = asian.map((x) => x.key);
    for (const k of onlyAsian) newMarkets[k] = (newMarkets[k] || 0) + 1;

    console.log(`${name.padEnd(40)} markets ${String(markets.length).padStart(3)} | verified ${String(verified.length).padStart(3)} | via Asian ${String(asian.length).padStart(3)} | books ${pv.asianBooks}`);
    if (pv.asianLines) {
      console.log(`   Asian lines: O/U ${JSON.stringify(pv.asianLines.totals)}  AH ${JSON.stringify(pv.asianLines.ah)}`);
    }
    const fit = markets.find((x) => x.marketLambda != null);
    if (fit) console.log(`   market λ ${fit.marketLambda.toFixed(3)} vs model λ ${fit.modelLambda.toFixed(3)}`);
    console.log(`   banker: ${rep.banker ? rep.banker.label + ' @ ' + rep.banker.price.toFixed(2) + ' (' + rep.banker.priceSource + ')' : (rep.lean ? 'lean: ' + rep.lean.label : '—')}`);
  }

  console.log('\n=========================================================');
  console.log(` markets total            : ${totMarkets}`);
  console.log(` markets price-verified   : ${totVerified}  (${totMarkets ? (100 * totVerified / totMarkets).toFixed(0) : 0}%)`);
  console.log(` of which via Asian books : ${totAsian}`);
  console.log('');
  console.log(' market keys newly verifiable thanks to the Asian source:');
  const sorted = Object.entries(newMarkets).sort((a, b) => b[1] - a[1]);
  for (const [k, n] of sorted) console.log(`   ${k.padEnd(12)} on ${n} fixture(s)`);
  console.log('=========================================================');
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
