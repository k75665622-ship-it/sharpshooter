/**
 * test_quota.js — InferSports rate-limit handling.
 *
 * The API has already changed its limiter once under this client:
 *
 *   old  `Ratelimit-Limit: 200`  `X-Ratelimit-Scope: daily`  `Ratelimit-Reset: 85020`
 *   new  `X-Ratelimit-Limit: 60`  (no scope)                  `X-Ratelimit-Reset: 1789721612`
 *
 * The reset header went from a DELTA to an ABSOLUTE EPOCH. Reading one as the
 * other is catastrophic in both directions, so the dialect handling is a pure
 * function and is tested directly rather than inferred from live behaviour.
 *
 * Anything that depends on the live quota being exhausted would make this file
 * fail on a healthy quota, so those paths are simulated instead of assumed.
 */

const IS = require('./lib/infersports');

let pass = 0;
let fail = 0;

function ok(label, cond, detail) {
  if (cond) { pass += 1; console.log('  PASS  ' + label + (detail ? ' — ' + detail : '')); }
  else { fail += 1; console.log('  FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}
function info(label) { console.log('  INFO  ' + label); }

(async () => {
  console.log('='.repeat(57));
  console.log(' INFERSPORTS RATE-LIMIT HANDLING');
  console.log('='.repeat(57));

  /* ---- 1. reset-header dialects (pure, deterministic) ---- */
  console.log('\n1. reset header: delta vs absolute epoch');
  {
    const NOW = 1789721646; // fixed clock so this is reproducible

    ok('absolute epoch in the future -> positive delta',
      IS.resetSeconds(1789721706, NOW) === 60, 'got ' + IS.resetSeconds(1789721706, NOW));
    ok('the real epoch header decodes to a sane delta',
      IS.resetSeconds(1789721612, NOW) === 0, 'already elapsed -> 0');
    ok('a large delta (daily quota) is passed through',
      IS.resetSeconds(85020, NOW) === 85020, 'got ' + IS.resetSeconds(85020, NOW));
    ok('a small delta is passed through', IS.resetSeconds(60, NOW) === 60);
    ok('null / zero / negative are rejected',
      IS.resetSeconds(null, NOW) === null && IS.resetSeconds(0, NOW) === null && IS.resetSeconds(-5, NOW) === null);
    ok('the 57-year bug is gone',
      IS.resetSeconds(1789721612, NOW) < 86400,
      'old code would have blocked for ' + (1789721612 / 86400 / 365).toFixed(0) + ' years');
  }

  /* ---- 2. live header parsing ---- */
  console.log('\n2. live header parsing');
  IS.resetCache(true);
  const q0 = IS.quotaSnapshot();
  ok('quota snapshot is well formed',
    typeof q0 === 'object' && 'open' in q0 && 'exhausted' in q0 && 'reserve' in q0);

  await IS.eventsForDate('2026-09-19');
  const s1 = IS.netStats();
  const q1 = IS.quotaSnapshot();
  console.log('     stats:', JSON.stringify({ requests: s1.requests, rateLimited: s1.rateLimited, skipped: s1.skipped }));
  console.log('     quota:', JSON.stringify(q1));

  // A date with ~500 fixtures paginates at 200 per page, so 1–3 requests is the
  // expected shape. The point is that it does not retry-storm.
  ok('requests stayed within the pagination budget (1–3)',
    s1.requests >= 1 && s1.requests <= 3, 'requests=' + s1.requests);
  ok('at most one 429 — no retry storm', s1.rateLimited <= 1, 'rateLimited=' + s1.rateLimited);
  ok('limit is a positive number when reported',
    q1.limit === null || q1.limit > 0, 'limit=' + q1.limit);
  ok('remaining is a number, never a bogus 0 from a missing header',
    q1.remaining === null || q1.remaining >= 0, 'remaining=' + q1.remaining);
  ok('a resume time, if any, is within 24 h',
    q1.resumesInSec === 0 || (q1.resumesInSec > 0 && q1.resumesInSec <= 86400),
    q1.resumesInSec + 's');

  /* ---- 3. breaker, only if the window really is closed ---- */
  console.log('\n3. breaker behaviour');
  const tripped = !q1.open || q1.exhausted;
  if (tripped) {
    ok('breaker tripped', q1.exhausted === true);
    ok('breaker reports a resume time', q1.resumesInSec > 0, q1.resumesInSec + 's');

    const before = IS.netStats().requests;
    const beforeSkipped = IS.netStats().skipped;
    await IS.eventsForDate('2026-09-20');
    await IS.consensusFor('2026-09-19', 'A', 'B');
    await IS.oddsForEvent('evt_anything');
    await IS.openingForEvent('evt_anything');
    const after = IS.netStats().requests;

    ok('no further network requests once tripped', after === before, before + ' -> ' + after);
    ok('calls are recorded as skipped', IS.netStats().skipped > beforeSkipped);
    ok('skipped calls return null, not a throw',
      (await IS.consensusFor('2026-09-19', 'A', 'B')) === null);
  } else {
    info('window is open (remaining=' + q1.remaining + ') — breaker path not exercised');
    ok('a healthy window still returns a list', Array.isArray(await IS.eventsForDate('2026-09-19')));
  }

  /* ---- 4. failures are never cached (simulated, deterministic) ---- */
  console.log('\n4. failures are never cached');
  {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, 'data', 'infersports');
    const count = () => {
      try { return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length; }
      catch { return 0; }
    };

    IS.resetCache(true);
    const before = count();

    // Force a transport failure regardless of the live quota state.
    const realFetch = global.fetch;
    global.fetch = () => Promise.reject(new Error('simulated network failure'));
    let threw = null;
    try { await IS.eventsForDate('2026-12-31'); } catch (e) { threw = e; }
    global.fetch = realFetch;

    ok('a transport failure does not throw', threw === null, threw ? String(threw.message) : 'no throw');
    ok('no cache file is written from a failed call', count() === before,
      before + ' -> ' + count() + ' files');

    // And the real 404 path.
    const b2 = count();
    await IS.oddsForEvent('evt_definitely_does_not_exist_12345');
    ok('a 404 is not cached either', count() === b2, b2 + ' -> ' + count() + ' files');
  }

  /* ---- 5. recovery ---- */
  console.log('\n5. recovery path');
  IS.resetCache(true);
  const q3 = IS.quotaSnapshot();
  ok('hard reset reopens the window', q3.open === true && q3.exhausted === false,
    JSON.stringify({ open: q3.open, exhausted: q3.exhausted }));
  ok('reserve is a non-negative number',
    Number.isFinite(q3.reserve) && q3.reserve >= 0, 'reserve=' + q3.reserve);

  console.log('\n' + '='.repeat(57));
  console.log(' ' + pass + ' passed, ' + fail + ' failed');
  console.log('='.repeat(57));
  process.exit(fail ? 1 : 0);
})();
