'use strict';

/**
 * intel/decision.js — the v6 match decision.
 *
 * Inputs are two probability sets over the same markets:
 *   p     v6 (price + every factor)
 *   base  the price alone (null when the fixture has no price)
 * and, where known, real prices (best available and the reference book).
 *
 * Output
 *   main      the most likely selection that still pays a sensible price (fair odds >= 1.30)
 *             and that the factors do NOT flag as overrated by the market
 *   safer     a lower-odds, higher-probability version of the same view (for safety / accas)
 *   value     the selection whose best available price beats the v6 fair price by the most
 *             (only when a real price exists and the factors agree with the direction)
 *   avoid     popular selections the factors say the market overrates — the measured traps
 *   confidence  grade + the hit rate picks of that grade achieved on held-out seasons
 *
 * Every threshold here was chosen on the 2019-23 tuning seasons and reported on 2023-26
 * (research/v6/backtest_decision.js). The measured record is in lib/intel/record.json.
 */

const LABELS = {
  '1': 'Home win', X: 'Draw', '2': 'Away win', '1X': 'Home or draw', X2: 'Draw or away', '12': 'Home or away',
  DNB_H: 'Home (draw no bet)', DNB_A: 'Away (draw no bet)',
  'O0.5': 'Over 0.5 goals', 'O1.5': 'Over 1.5 goals', 'O2.5': 'Over 2.5 goals', 'O3.5': 'Over 3.5 goals', 'O4.5': 'Over 4.5 goals',
  'U0.5': 'Under 0.5 goals', 'U1.5': 'Under 1.5 goals', 'U2.5': 'Under 2.5 goals', 'U3.5': 'Under 3.5 goals', 'U4.5': 'Under 4.5 goals',
  BTTS_Y: 'Both teams to score', BTTS_N: 'Not both teams to score',
};

/** Selections the main / safer / value picks may choose from. */
const MAIN_KEYS = [
  '1', '2', '1X', 'X2', 'DNB_H', 'DNB_A',
  'O1.5', 'O2.5', 'U2.5', 'U3.5',
  'BTTS_Y', 'BTTS_N',
  'TTH_O0.5', 'TTA_O0.5', 'TTH_O1.5', 'TTA_O1.5', 'TTH_U1.5', 'TTA_U1.5',
];
const VALUE_KEYS = ['1', 'X', '2', '1X', 'X2', 'DNB_H', 'DNB_A', 'O2.5', 'U2.5', 'BTTS_Y', 'BTTS_N'];
const AVOID_KEYS = ['1', 'X', '2', '1X', 'X2', 'O2.5', 'U2.5', 'BTTS_Y', 'BTTS_N', 'O1.5', 'U3.5'];

const DEFAULTS = {
  minFair: 1.3, // main pick must be worth backing: fair odds of at least 1.30
  trapShift: -0.015, // factors say the market overrates this selection by 1.5+ points -> not a main pick
  saferMinFair: 1.12,
  valueEv: 0.05, // value pick: best price at least 5% above the v6 fair price (tuned 2019-23)
  valueBand: [0.3, 0.8],
  avoidShift: -0.02, // shown as "avoid" when the market overrates a 30%+ selection by 2+ points
  avoidMinProb: 0.3,
  takeAtMargin: 1.02, // "take at" = v6 fair odds x 1.02 (the price at which a pick is worth taking)
  shiftWeight: 2, // main pick ranking: prob + 2 x (v6 - price) — tuned 2019-23: ROI +0.4 pts for -0.7 pts hit rate vs pure probability
};

function label(key, H, A) {
  let m;
  if (key === '1') return `${H} to win`;
  if (key === '2') return `${A} to win`;
  if (key === 'X') return 'Draw';
  if (key === '1X') return `${H} or draw`;
  if (key === 'X2') return `Draw or ${A}`;
  if (key === '12') return `${H} or ${A}`;
  if (key === 'DNB_H') return `${H} (draw no bet)`;
  if (key === 'DNB_A') return `${A} (draw no bet)`;
  if ((m = /^TT([HA])_([OU])(\d\.5)$/.exec(key))) return `${m[1] === 'H' ? H : A} ${m[2] === 'O' ? 'over' : 'under'} ${m[3]} goals`;
  if ((m = /^AH_([HA])_(-?\d+(?:\.\d+)?)$/.exec(key))) {
    const line = Number(m[2]);
    const l = m[1] === 'H' ? line : -line;
    return `${m[1] === 'H' ? H : A} ${l > 0 ? '+' : ''}${l} (Asian handicap)`;
  }
  return LABELS[key] || key;
}

/**
 * @param {object} c
 * @param {Object<string,number>} c.p
 * @param {Object<string,number>|null} c.base
 * @param {Object<string,{best?:{price:number,book:string}, ref?:{price:number,book:string}}>} [c.prices]
 * @param {string} [c.home] @param {string} [c.away]
 * @param {object} [c.opts]
 */
function decide(c) {
  const o = { ...DEFAULTS, ...(c.opts || {}) };
  const H = c.home || 'Home';
  const A = c.away || 'Away';
  const prices = c.prices || {};
  const row = (k) => {
    const prob = c.p[k];
    if (prob == null || !Number.isFinite(prob) || prob <= 0 || prob >= 1) return null;
    const base = c.base && c.base[k] != null ? c.base[k] : null;
    const pr = prices[k] || {};
    const best = pr.best && pr.best.price > 1 ? pr.best : null;
    return {
      key: k,
      label: label(k, H, A),
      prob,
      base,
      shift: base != null ? prob - base : null,
      fair: 1 / prob,
      takeAt: Math.max(1.05, (1 / prob) * o.takeAtMargin),
      best: best ? best.price : null,
      bestBook: best ? best.book : null,
      ev: best ? prob * best.price - 1 : null,
    };
  };
  const all = [...new Set([...MAIN_KEYS, ...VALUE_KEYS, ...AVOID_KEYS])].map(row).filter(Boolean);
  const by = Object.fromEntries(all.map((r) => [r.key, r]));
  // a selection a confirmed trap rule fires on (lib/intel/rules.js) is never picked
  const excluded = c.exclude instanceof Set ? c.exclude : new Set(c.exclude || []);
  const isTrap = (r) => excluded.has(r.key) || (r.shift != null && r.shift <= o.trapShift);

  const mainPool = MAIN_KEYS.map((k) => by[k]).filter((r) => r && r.fair >= o.minFair && !isTrap(r));
  const score = (r) => r.prob + o.shiftWeight * (r.shift || 0);
  mainPool.sort((x, y) => score(y) - score(x) || (y.shift || 0) - (x.shift || 0));
  const main = mainPool[0] || null;

  let safer = null;
  if (main) {
    const pool = MAIN_KEYS.map((k) => by[k]).filter((r) => r && r.key !== main.key && r.fair >= o.saferMinFair && r.prob > main.prob && !isTrap(r) && implies(main.key, r.key));
    pool.sort((x, y) => x.prob - y.prob); // the smallest step up in safety keeps the most value
    safer = pool[0] || null;
  }

  let value = null;
  const vPool = VALUE_KEYS.map((k) => by[k]).filter((r) => r && r.ev != null && r.ev >= o.valueEv && r.prob >= o.valueBand[0] && r.prob <= o.valueBand[1] && (r.shift == null || r.shift >= 0));
  vPool.sort((x, y) => y.ev - x.ev);
  value = vPool[0] || null;

  const avoid = AVOID_KEYS.map((k) => by[k])
    .filter((r) => r && r.base != null && r.base >= o.avoidMinProb && r.shift <= o.avoidShift)
    .sort((x, y) => x.shift - y.shift)
    .slice(0, 3);
  for (const k of excluded) {
    if (by[k] && !avoid.some((a) => a.key === k)) avoid.push({ ...by[k], rule: true });
  }

  return { main, safer, value, avoid, candidates: all.sort((x, y) => y.prob - x.prob), thresholds: o };
}

/** Does selection `a` winning guarantee selection `b` wins? (b is a safer form of a) */
function implies(a, b) {
  const W = {
    '1': ['1X', '12', 'DNB_H', 'TTH_O0.5'],
    '2': ['X2', '12', 'DNB_A', 'TTA_O0.5'],
    DNB_H: ['1X'],
    DNB_A: ['X2'],
    'O2.5': ['O1.5', 'O0.5'],
    'O1.5': ['O0.5'],
    'U2.5': ['U3.5', 'U4.5'],
    'U3.5': ['U4.5'],
    BTTS_Y: ['O1.5', 'TTH_O0.5', 'TTA_O0.5'],
    'TTH_O1.5': ['TTH_O0.5', 'O1.5'],
    'TTA_O1.5': ['TTA_O0.5', 'O1.5'],
    'TTH_U1.5': ['U3.5'],
    'TTA_U1.5': ['U3.5'],
    BTTS_N: [],
    '1X': [],
    X2: [],
  };
  return (W[a] || []).includes(b);
}

/**
 * Confidence grade for a main pick. Probability is the backbone (it is calibrated); the grade
 * drops a level when the evidence behind it is thin.
 * @param {object} main
 * @param {{hasMarket:boolean, coverage:number, crossLeague:boolean, agree:number|null}} ctx
 * @param {object|null} record  measured hit rate per grade (lib/intel/record.json)
 */
function confidence(main, ctx, record) {
  if (!main) return { level: 'None', reasons: ['no selection cleared the bar'] };
  const levels = ['Low', 'Medium', 'High', 'Very high'];
  let i = main.prob >= 0.8 ? 3 : main.prob >= 0.7 ? 2 : main.prob >= 0.6 ? 1 : 0;
  const reasons = [];
  if (!ctx.hasMarket) {
    i = Math.max(0, i - 1);
    reasons.push('no bookmaker price — factors only');
  }
  if (ctx.coverage != null && ctx.coverage < 0.5) {
    i = Math.max(0, i - 1);
    reasons.push(`only ${Math.round(ctx.coverage * 100)}% of factors could be measured`);
  }
  if (ctx.crossLeague) {
    i = Math.max(0, i - 1);
    reasons.push('cup or cross-league tie — form and table come from different competitions');
  }
  if (main.shift != null && main.shift > 0.01) reasons.push(`factors rate it ${(main.shift * 100).toFixed(1)} pts above the price`);
  if (main.shift != null && main.shift < -0.005) reasons.push(`factors rate it ${(-main.shift * 100).toFixed(1)} pts below the price`);
  const level = levels[i];
  const rec = record && record.grades && record.grades[level];
  return {
    level,
    reasons,
    measured: rec ? { hit: rec.hit, stated: rec.stated, n: rec.n } : null,
  };
}

module.exports = { decide, confidence, label, implies, MAIN_KEYS, VALUE_KEYS, AVOID_KEYS, DEFAULTS, LABELS };
