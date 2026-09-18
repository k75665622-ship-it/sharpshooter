/* Unit tests for the team-news risk scanner.
   Uses synthetic headlines so every branch is exercised deterministically,
   including the user's stated scenario: a key midfielder suspended or sold. */
const N = require('./lib/news');

let pass = 0, fail = 0;
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); }
}

const ctx = {
  home: { name: 'Besiktas', short: 'BES' },
  away: { name: 'Marseille', short: 'OLM' },
};

/* ---------- 1. token extraction ---------- */
console.log('\n1. team token extraction');
t('single-word name yields itself', N.teamTokens(ctx.home).includes('besiktas'));
t('multi-word name drops the generic word', (() => {
  const toks = N.teamTokens({ name: 'Real Sociedad' });
  return toks.includes('sociedad') && !toks.includes('real');
})(), JSON.stringify(N.teamTokens({ name: 'Real Sociedad' })));
t('diacritics are folded', N.teamTokens({ name: 'Málaga' }).includes('malaga'),
  JSON.stringify(N.teamTokens({ name: 'Málaga' })));

/* ---------- 2. side attribution ---------- */
console.log('\n2. side attribution');
const s1 = N.scanNews([{ headline: 'Besiktas midfielder ruled out for six weeks' }], ctx);
t('home-only mention -> home', s1.home.level === 'high' && s1.away.level === 'none',
  `home=${s1.home.level} away=${s1.away.level}`);
const s2 = N.scanNews([{ headline: 'Marseille star suspended after red card' }], ctx);
t('away-only mention -> away', s2.away.level === 'high' && s2.home.level === 'none',
  `home=${s2.home.level} away=${s2.away.level}`);

// Real headlines name BOTH teams; word order must decide which one the risk
// attaches to, because the second name is usually just the upcoming opponent.
const s3 = N.scanNews([{ headline: 'Besiktas key midfielder suspended for Marseille clash' }], ctx);
t('both named, risk after home -> home', s3.home.level === 'high' && s3.away.level === 'none',
  `home=${s3.home.level} away=${s3.away.level}`);
const s3b = N.scanNews([{ headline: 'Marseille striker injured ahead of Besiktas trip' }], ctx);
t('both named, risk after away -> away', s3b.away.level === 'medium' && s3b.home.level === 'none',
  `home=${s3b.home.level} away=${s3b.away.level}`);

// A joint statement about both sides must NOT be pinned on one team.
const s4 = N.scanNews([{ headline: 'Besiktas and Marseille both lose key men to injury' }], ctx);
t('joint statement about both -> neutral', s4.neutral.length === 1 && s4.home.items.length === 0 && s4.away.items.length === 0,
  `neutral=${s4.neutral.length} home=${s4.home.items.length} away=${s4.away.items.length}`);
const s5 = N.scanNews([{ headline: 'Referee appointment announced for the tie' }], ctx);
t('no risk language -> nothing flagged', s5.home.items.length === 0 && s5.neutral.length === 0);

/* ---------- 3. severity classification ---------- */
console.log('\n3. severity classification');
const cases = [
  ['Besiktas man sent off', 'high', 'suspension'],
  ['Besiktas player banned for three games', 'high', 'suspension'],
  ['Besiktas defender suffers ACL injury', 'high', 'injury_long'],
  ['Besiktas forward ruled out', 'high', 'doubt'],
  ['Besiktas winger a doubt for the trip', 'high', 'doubt'],
  ['Besiktas midfielder picks up hamstring problem', 'medium', 'injury'],
  ['Besiktas captain sold to rivals', 'medium', 'transfer'],
  ['Besiktas set for squad rotation', 'info', 'rotation'],
];
for (const [headline, sev, kind] of cases) {
  const s = N.scanNews([{ headline }], ctx);
  const it = s.home.items[0];
  t(`"${headline}" -> ${sev}/${kind}`, it && it.severity === sev && it.kind === kind,
    it ? `${it.severity}/${it.kind}` : 'no item');
}

/* ---------- 4. the user's scenario: does it block the pick? ---------- */
console.log('\n4. trap generation for the side a market depends on');
const suspension = N.scanNews([{ headline: 'Besiktas key midfielder suspended for Marseille clash' }], ctx);
const homeWin = { key: '1', group: '1X2', label: 'Besiktas win' };
const awayWin = { key: '2', group: '1X2', label: 'Marseille win' };
const overMkt = { key: 'O2.5', group: 'Totals', label: 'Over 2.5', side: 'over' };

const trHome = N.newsTraps(suspension, homeWin, 'home');
const trAway = N.newsTraps(suspension, awayWin, 'away');
const trOver = N.newsTraps(suspension, overMkt, 'over');

t('suspension on the backed side -> high trap', trHome.some((x) => x.severity === 'high'),
  JSON.stringify(trHome.map((x) => x.severity)));
t('same news on the OTHER side -> info only, no penalty', trAway.every((x) => x.severity === 'info'),
  JSON.stringify(trAway.map((x) => x.severity)));
t('totals market gets a caveat, not a block', trOver.every((x) => x.severity === 'info'),
  JSON.stringify(trOver.map((x) => x.severity)));

/* ---------- 5. two independent absences -> veto ---------- */
console.log('\n5. systematic disruption -> veto');
const two = N.scanNews([
  { headline: 'Besiktas defender suspended after red card' },
  { headline: 'Besiktas striker out for the season with ACL injury' },
], ctx);
const trTwo = N.newsTraps(two, homeWin, 'home');
t('two confirmed absences on one side -> veto', trTwo.some((x) => x.severity === 'veto'),
  JSON.stringify(trTwo.map((x) => x.severity)));
t('veto names the evidence', (() => {
  const v = trTwo.find((x) => x.severity === 'veto');
  return v && /Headlines:/.test(v.detail);
})(), JSON.stringify(trTwo.find((x) => x.severity === 'veto')?.detail));

/* ---------- 6. graceful degradation ---------- */
console.log('\n6. graceful degradation');
t('empty news array is safe', N.scanNews([], ctx).scanned === 0);
t('null news is safe', N.scanNews(null, ctx).scanned === 0);
t('missing ctx teams is safe', N.scanNews([{ headline: 'Someone injured' }], {}).scanned === 1);
t('null newsTraps input returns empty', N.newsTraps(null, homeWin, 'home').length === 0);
t('article with no headline is skipped', N.scanNews([{}], ctx).scanned === 1);

console.log('\n=========================================================');
console.log(` ${pass} passed, ${fail} failed`);
console.log('=========================================================');
process.exit(fail ? 1 : 0);
