'use strict';

/**
 * test/traps_unit.js — the Bookies' Trap scan (lib/traps.js). Offline, pure.
 *
 *   node test/traps_unit.js
 */

const T = require('../lib/traps');
const ACC = require('../lib/intel/accumulator');

let pass = 0;
let fail = 0;
function t(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail != null ? ' — ' + detail : ''}`);
  }
}
const codes = (r) => r.flags.map((f) => f.code).join(',');

console.log('\n1. Ratings and the verdict');
{
  const clear = T.scan({ key: '1X', prob: 0.8, price: 1.3 });
  t('nothing found: clear, score 0', clear.verdict === 'clear' && clear.score === 0 && clear.flags.length === 0);
  const minor = T.scan({ key: '1X', prob: 0.8, price: 1.3, market: { traps: [{ id: 'line_drift', detail: 'x' }] } });
  t('a Minor trap is a caution at -2', minor.verdict === 'caution' && minor.score === -2 && codes(minor) === 'T7');
  const two = T.scan({ key: '1', prob: 0.7, price: 1.5, market: { traps: [{ id: 'congestion' }, { id: 'xg_overperformance' }] } });
  t('two Medium traps add up to a withdrawal', two.verdict === 'trap' && two.score === -10, JSON.stringify(two));
  const dup = T.scan({ key: '1', prob: 0.7, price: 1.5, market: { traps: [{ id: 'low_liquidity' }, { id: 'missing_stats' }, { id: 'unverified_price' }] } });
  t('one trap is counted once, at its worst rating', dup.score === -5 && codes(dup) === 'T23', JSON.stringify(dup));
  t('Major first in the list', codes(T.scan({ key: 'O2.5', prob: 0.6, price: 1.7, market: { traps: [{ id: 'line_drift' }, { id: 'implausible_edge' }] } })) === 'T6,T7');
}

console.log('\n2. The protocol\'s own checks');
{
  const fb = T.scan({ key: 'O1.5', prob: 0.84, price: 1.06 });
  t('T24 false banker: priced as 94%, the numbers say 84%', fb.verdict === 'trap' && codes(fb) === 'T24' && /94%/.test(fb.flags[0].detail));
  t('T24 not raised when the numbers back the short price', T.scan({ key: 'O1.5', prob: 0.93, price: 1.06 }).verdict === 'clear');
  const model = { oneXtwo: { pHome: 0.72, pDraw: 0.18, pAway: 0.1 }, lambda: { home: 2.4, away: 0.7 } };
  t('T9 mismatch Under: a strong favourite expected to score two alone', codes(T.scan({ key: 'U3.5', prob: 0.7, price: 1.3, model })) === 'T9');
  t('T9 does not touch an Over or an even match', T.scan({ key: 'O1.5', prob: 0.85, price: 1.2, model }).verdict === 'clear'
    && T.scan({ key: 'U3.5', prob: 0.7, price: 1.3, model: { oneXtwo: { pHome: 0.4, pDraw: 0.3, pAway: 0.3 }, lambda: { home: 1.3, away: 1.1 } } }).verdict === 'clear');
  const b = T.scan({ key: '1', prob: 0.7, price: 1.5, match: { home: { name: 'Bayern Munich II' }, away: { name: 'Ulm' } } });
  t('T16 reserve side', b.verdict === 'trap' && codes(b) === 'T16' && codes(T.scan({ key: '1', prob: 0.7, price: 1.5, match: { home: { name: 'Jong Ajax' }, away: { name: 'Den Bosch' } } })) === 'T16');
  t('a first team is not a reserve side', T.scan({ key: '1', prob: 0.7, price: 1.5, match: { home: { name: 'Club Brugge' }, away: { name: 'Real Betis' } } }).verdict === 'clear');
  const cupIntel = { traps: [{ kind: 'data', label: 'Cup or cross-league tie' }] };
  t('T20 a short favourite in a cup tie is withdrawn', codes(T.scan({ key: '1', prob: 0.75, price: 1.3, intel: cupIntel })) === 'T20');
  t('T36 another market in a cup tie is a caution', T.scan({ key: 'O2.5', prob: 0.6, price: 1.8, intel: cupIntel }).verdict === 'caution');
  const rest = (h, a) => ({ context: { restAllComps: { home: h, away: a } } });
  t('T18 both sides back from a break', codes(T.scan({ key: 'O1.5', prob: 0.8, price: 1.25, intel: rest(14, 13) })) === 'T18');
  const tired = T.scan({ key: '1X', prob: 0.82, price: 1.18, intel: rest(3, 7) });
  t('T4 + T10: a 1.18 double chance on a side that played three days ago', tired.verdict === 'trap' && codes(tired) === 'T10,T4', JSON.stringify(tired));
  t('T4 on the other side is only a Minor', T.scan({ key: '1X', prob: 0.82, price: 1.18, intel: rest(7, 2) }).score === -2);
  const wx = { traps: [{ kind: 'context', label: 'Weather: strong wind' }] };
  t('T22 extreme weather withdraws a goals pick, not a result pick', T.scan({ key: 'O2.5', prob: 0.65, price: 1.6, intel: wx }).verdict === 'trap' && T.scan({ key: '1', prob: 0.7, price: 1.5, intel: wx }).verdict === 'caution');
  const v6 = { decision: { avoid: [{ key: '1' }] }, traps: [{ kind: 'model', key: 'O2.5', detail: 'd' }] };
  t('the v6 layer: an avoided pick is withdrawn, an overrated one is a caution', T.scan({ key: '1', prob: 0.6, price: 1.7, intel: v6 }).verdict === 'trap' && codes(T.scan({ key: 'O2.5', prob: 0.6, price: 1.7, intel: v6 })) === 'M3');
  t('T32 odds moving hard where little is known', codes(T.scan({ key: '1', prob: 0.6, price: 1.7, market: { traps: [{ id: 'reverse_line_movement' }, { id: 'low_liquidity' }] } })).startsWith('T32'));
}

console.log('\n3. On a report');
{
  const mk = (key, prob, price) => ({ id: 'm', name: 'M', status: 'PREDICT', prob, pick: { key, label: key }, price: { best: price } });
  const report = { match: { id: '1', home: { name: 'A' }, away: { name: 'B' } }, markets: [{ key: 'O1.5', traps: [] }], methodology: { predictions: [mk('O1.5', 0.84, 1.06), mk('1X', 0.8, 1.3)], headline: null }, intel: null, model: null };
  report.methodology.headline = report.methodology.predictions[0];
  t('every methodology pick gets its scan', T.attach(report) === 2 && report.methodology.predictions[0].trap.verdict === 'trap' && report.methodology.predictions[1].trap.verdict === 'clear' && report.methodology.headline.trap.verdict === 'trap');
  t('a report without picks is left alone', T.attach({ methodology: { error: 'x' } }) === 0 && T.attach(null) === 0);
  // a withdrawn pick is never a leg of a methodology slip
  const ko = new Date(Date.now() + 5 * 3600e3).toISOString();
  const rep = (id, trap) => ({
    analysable: true, match: { id, league: 'eng.1', date: ko, state: 'pre', home: { name: `H${id}` }, away: { name: `A${id}` } }, markets: [],
    methodology: { predictions: [{ id: 'doubleChance', name: 'Double Chance', status: 'PREDICT', prob: 0.8, pick: { key: '1X', label: '1X' }, checklist: { ratio: 1 }, trap }] },
    intel: { available: true, decision: { main: { key: '1X', label: '1X', prob: 0.8 }, avoid: [] }, probs: { '1X': 0.8, 1: 0.5, X: 0.3, 2: 0.2, 'O2.5': 0.5, BTTS_Y: 0.5 }, base: { '1X': 0.79 } },
  });
  const legs = ACC.legsFrom([rep('a', { verdict: 'clear', score: 0, flags: [] }), rep('b', { verdict: 'trap', score: -10, flags: [{ code: 'T24' }] }), rep('c', { verdict: 'caution', score: -2, flags: [{ code: 'T7' }] })]);
  t('the methodology slips leave withdrawn picks out and keep cautions', legs.map((l) => l.fixtureId).sort().join(',') === 'a,c' && legs.every((l) => l.trap), JSON.stringify(legs.map((l) => l.fixtureId)));
}

console.log('\n=========================================================');
console.log(` ${pass} passed, ${fail} failed`);
console.log('=========================================================');
process.exit(fail ? 1 : 0);
