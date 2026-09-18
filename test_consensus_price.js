/**
 * test_consensus_price.js — Asian consensus -> market key mapping.
 *
 * Deterministic, offline. ESPN publishes exactly one total line, one spread
 * line and three moneyline prices from a single book. Everything else on the
 * 63-market board is unquoted, and an unquoted market can never be
 * value-verified — so it can never be elected banker. This test proves the
 * second odds source actually reaches those markets.
 *
 * It also pins down two edge cases that used to be masked by an early return:
 * a ratable fixture whose ESPN odds are missing must still produce a fully
 * labelled board, and must not crash the draw-no-bet block.
 */

const S = require('./lib/signals');

let pass = 0;
let fail = 0;

function ok(label, cond, detail) {
  if (cond) { pass += 1; console.log('  PASS  ' + label + (detail ? ' — ' + detail : '')); }
  else { fail += 1; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}

/** A plausible multi-book consensus: median across books, best price too. */
const consensus = {
  asOf: Date.now(),
  books: 4,
  h2h: { home: { median: 2.10, best: 2.16, books: 4 }, draw: { median: 3.40, best: 3.50, books: 4 }, away: { median: 3.60, best: 3.70, books: 4 } },
  totals: {
    1.5: { over: { median: 1.22, best: 1.25, books: 4 }, under: { median: 4.60, best: 4.80, books: 4 } },
    2.5: { over: { median: 1.80, best: 1.85, books: 4 }, under: { median: 2.05, best: 2.10, books: 4 } },
    3.5: { over: { median: 2.90, best: 2.95, books: 3 }, under: { median: 1.42, best: 1.45, books: 3 } },
    4.5: { over: { median: 5.50, best: 5.70, books: 2 }, under: { median: 1.16, best: 1.18, books: 2 } },
  },
  ah: {
    '-1': { home: { median: 2.60, best: 2.65, books: 3 }, away: { median: 1.52, best: 1.55, books: 3 } },
    '-0.5': { home: { median: 2.00, best: 2.05, books: 4 }, away: { median: 1.90, best: 1.95, books: 4 } },
    '0': { home: { median: 1.55, best: 1.58, books: 4 }, away: { median: 2.55, best: 2.60, books: 4 } },
    '1': { home: { median: 1.30, best: 1.33, books: 3 }, away: { median: 3.80, best: 3.90, books: 3 } },
  },
  ht: {
    h2h: { home: { median: 2.70, best: 2.75, books: 3 }, draw: { median: 2.15, best: 2.20, books: 3 }, away: { median: 4.60, best: 4.70, books: 3 } },
  },
};

/** Market stubs mirror the real construction: fairOdds always present. */
const mk = (key, line, fair = 2.0) => ({
  key, line, label: key, group: 'test', fairOdds: fair, prob: 1 / fair,
});

console.log('='.repeat(57));
console.log(' ASIAN CONSENSUS -> MARKET KEY MAPPING');
console.log('='.repeat(57));

// 1. Totals at lines ESPN does not publish.
console.log('\n1. totals beyond the single ESPN line');
{
  const ms = [mk('O3.5', 3.5), mk('U3.5', 3.5), mk('O4.5', 4.5), mk('U4.5', 4.5), mk('O1.5', 1.5)];
  S.attachPrices(ms, null, consensus);
  ok('Over 3.5 priced', ms[0].price === 2.90 && ms[0].priceSource === 'book-asian', 'p=' + ms[0].price);
  ok('Under 3.5 priced', ms[1].price === 1.42, 'p=' + ms[1].price);
  ok('Over 4.5 priced', ms[2].price === 5.50, 'p=' + ms[2].price);
  ok('Under 4.5 priced', ms[3].price === 1.16, 'p=' + ms[3].price);
  ok('Over 1.5 priced', ms[4].price === 1.22, 'p=' + ms[4].price);
  ok('book count recorded', ms[0].priceBooks === 3, 'books=' + ms[0].priceBooks);
  ok('best price recorded for outlier detection', ms[0].priceBest === 2.95, 'best=' + ms[0].priceBest);
  ok('implied prob derived from the real price', Math.abs(ms[0].impliedProb - 1 / 2.90) < 1e-9);
}

// 2. Asian handicaps.
console.log('\n2. asian handicap lines');
{
  const ms = [mk('AH_H_-1', -1), mk('AH_A_-1', -1), mk('AH_H_1', 1), mk('AH_A_0', 0)];
  S.attachPrices(ms, null, consensus);
  ok('Home -1 priced', ms[0].price === 2.60, 'p=' + ms[0].price);
  ok('Away -1 priced', ms[1].price === 1.52, 'p=' + ms[1].price);
  ok('Home +1 priced', ms[2].price === 1.30, 'p=' + ms[2].price);
  ok('Away 0 (level) priced', ms[3].price === 2.55, 'p=' + ms[3].price);
  ok('all sourced to asian books', ms.every((m) => m.priceSource === 'book-asian'));
}

// 3. Half-time markets — never quoted by ESPN at all.
console.log('\n3. half-time markets');
{
  const ms = [mk('HT_1'), mk('HT_X'), mk('HT_2')];
  S.attachPrices(ms, null, consensus);
  ok('HT home priced', ms[0].price === 2.70, 'p=' + ms[0].price);
  ok('HT draw priced', ms[1].price === 2.15, 'p=' + ms[1].price);
  ok('HT away priced', ms[2].price === 4.60, 'p=' + ms[2].price);
  ok('HT markets are electable for the first time', ms.every((m) => m.priceSource === 'book-asian'));
}

// 4. ESPN must always win when it has a price.
console.log('\n4. ESPN priority is preserved');
{
  const odds = { homeClose: 2.00, drawClose: 3.30, awayClose: 3.90, totalLine: 2.5, overClose: 1.75, underClose: 2.15, spread: { line: -0.5, home: 1.95, away: 1.95 } };
  const ms = [mk('1'), mk('X'), mk('2'), mk('O2.5', 2.5), mk('U2.5', 2.5), mk('AH_H_-0.5', -0.5)];
  S.attachPrices(ms, odds, consensus);
  ok('1X2 from ESPN', ms[0].price === 2.00 && ms[0].priceSource === 'book', 'p=' + ms[0].price);
  ok('draw from ESPN', ms[1].price === 3.30 && ms[1].priceSource === 'book');
  ok('away from ESPN', ms[2].price === 3.90 && ms[2].priceSource === 'book');
  ok('the published total line stays ESPN', ms[3].price === 1.75 && ms[3].priceSource === 'book', 'p=' + ms[3].price + ' src=' + ms[3].priceSource);
  ok('under same line stays ESPN', ms[4].price === 2.15 && ms[4].priceSource === 'book');
  ok('the published spread stays ESPN', ms[5].price === 1.95 && ms[5].priceSource === 'book');
  ok('no market was silently re-priced from the second source',
    ms.every((m) => m.priceSource === 'book'));
}

// 5. Degradation.
console.log('\n5. graceful degradation');
{
  const ms = [mk('O2.5', 2.5, 2.10)];
  S.attachPrices(ms, null, null);
  ok('null consensus does not throw', true);
  ok('market still gets a labelled synthetic price', ms[0].priceSource === 'synthetic', 'src=' + ms[0].priceSource);
  ok('synthetic price is the model fair price', ms[0].price === 2.10, 'p=' + ms[0].price);
  ok('synthetic price carries no implied prob', ms[0].impliedProb === null);
  ok('synthetic market is not marked verified', !ms[0].verified);

  const ms2 = [mk('HT_1'), mk('O2.5', 2.5)];
  S.attachPrices(ms2, null, { books: 1 }); // no ht, no totals
  ok('partial consensus leaves gaps unquoted', ms2.every((m) => m.priceSource === 'synthetic'));

  // A zero/one price is a suspended quote and must never be used.
  const bad = { books: 2, totals: { 2.5: { over: { median: 0, best: 0, books: 2 }, under: { median: 0, best: 0, books: 2 } } } };
  const ms3 = [mk('O2.5', 2.5)];
  S.attachPrices(ms3, null, bad);
  ok('suspended (0.00) quotes are rejected', ms3[0].priceSource === 'synthetic', 'src=' + ms3[0].priceSource);
}

// 6. No ESPN odds — the case that used to be masked by an early return.
console.log('\n6. ratable fixture with no ESPN odds');
{
  const ms = [mk('1'), mk('X'), mk('2'), mk('DNB_H', null, 1.40), mk('DNB_A', null, 3.20), mk('O2.5', 2.5)];
  let threw = null;
  try { S.attachPrices(ms, null, consensus); } catch (e) { threw = e; }
  ok('does not throw on the draw-no-bet block', threw === null, threw ? String(threw.message) : 'no throw');
  ok('every market leaves with a priceSource',
    ms.every((m) => typeof m.priceSource === 'string' && m.priceSource.length > 0),
    ms.map((m) => m.key + ':' + m.priceSource).join(' '));
  const synthetic = ms.filter((m) => m.priceSource === 'synthetic');
  const quoted = ms.filter((m) => m.priceSource.startsWith('book'));
  ok('unquoted markets are never marked verified',
    synthetic.every((m) => !m.verified), synthetic.length + ' synthetic markets');
  ok('unquoted markets never show an EV',
    synthetic.every((m) => m.valuePct === null));
  ok('markets the second source did quote ARE verified',
    quoted.length > 0 && quoted.every((m) => m.verified),
    quoted.map((m) => m.key).join(',') || 'none');
  ok('totals still get an asian price when available',
    ms[5].priceSource === 'book-asian', 'src=' + ms[5].priceSource);
  ok('DNB falls back to synthetic rather than a fabricated combined price',
    ms[3].priceSource === 'synthetic', 'src=' + ms[3].priceSource);
}

console.log('\n' + '='.repeat(57));
console.log(' ' + pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(57));
process.exit(fail ? 1 : 0);
