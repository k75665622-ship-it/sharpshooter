'use strict';

/**
 * betbuilder.js — the Bet Builder: several selections from ONE match, combined at 3.0+ odds.
 *
 * Built on the Strongest Picks analysis of the match (lib/strongest: the bookmaker-anchored
 * score model, the form + price corner and card models, every selection's measured chance and
 * its trap checks). For each match:
 *
 *   1  LEGS     every selection that may go into a builder: a full-time goal, result, team,
 *               corner or card market (the ones a bookmaker's bet builder offers), with a
 *               measured chance of at least CFG.minLegChance, every view at CFG.minLegFloor+,
 *               and none of the Strongest Picks' trap checks against it (v6 trap, factors
 *               below the price, serious team news, a market kept off for its record)
 *   2  SEARCH   of every combination of CFG.minLegs..maxLegs legs (one per market family) whose
 *               fair odds reach CFG.target (3.0) and stay under CFG.maxOdds, and whose legs never
 *               pull against each other (one story of the match, not a hedge): the FEWEST legs,
 *               then the strongest weakest leg, then the highest combined chance. Every such
 *               builder lands about as often as its odds say, so fewer legs (less bookmaker
 *               margin, fewer things to go wrong) and stronger legs decide. Combined = one joint
 *               model of the match
 *               (public/betbuilder-core.js): legs that back each other ("home win" + "home
 *               to score") are not multiplied as if independent, a leg the others already
 *               guarantee adds nothing and is left out, and contradictory legs are impossible
 *   3  MEASURE  the combined chance is calibrated on what bet builders built this way actually
 *               did on 2019-26 matches (research/v6/betbuilder_study.js; lib/strongest/models.json
 *               "builder")
 *
 * The day: one builder per match where one exists, the most likely first. Scorer legs are never
 * in the day's builders (no scorer history to measure them, and they hang on the line-up), but
 * the page's "build your own" offers them with the same joint model, marked as unmeasured.
 */

const BB = require('../public/betbuilder-core');
const PK = require('./strongest/picks');
const CAL = require('./strongest/calibrate');
const SC = require('./strongest/config');

const CFG = {
  version: '1.0',
  target: 3.0, // fair odds a builder must reach...
  maxOdds: 4.5, // ...and not pass: a 3+ builder, not a long shot
  minLegs: 3,
  maxLegs: 5,
  minLegChance: 0.55, // every leg's own measured chance
  minLegFloor: 0.45, // every view of every leg
  linesPerFamily: 2, // the two likeliest lines of each market are tried
  maxPull: 0.01, // legs may land together at most 1% less often than if they were unrelated
  statsOnlyPenalty: 0.03, // corners and cards give way to bookmaker-anchored legs (Strongest Picks)
  featured: 3, // the day's list always shows at least this many when they exist
  groups: ['Match', 'Goals', 'Team', 'Corners', 'Bookings'],
};

// the pick rules' bars are not the builder's (a builder leg needs 55%, not 84%)
const BAR = /under the \d+% bar|Pays too little/;

const r4 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10000) / 10000);

/** The measured calibration of a builder's combined chance (lib/strongest/models.json). */
function builderCal() {
  const m = CAL.models();
  return m && m.builder && m.builder.cal ? m.builder.cal : null;
}

/** The selections of one match that may go into a builder. */
function eligibleLegs(sels, ctx, cfg = CFG) {
  const groups = new Set(cfg.groups);
  const out = [];
  for (const s of sels || []) {
    if (!groups.has(s.group) || !s.measured) continue;
    const leg = BB.legOf(s.key);
    if (!leg || leg.kind === 'player') continue;
    if (!(s.prob >= cfg.minLegChance) || !(s.floor >= cfg.minLegFloor)) continue;
    const why = PK.blockers(s, ctx || {}).filter((w) => !BAR.test(w));
    if (why.length) continue;
    out.push({ key: s.key, label: s.label, group: s.group, family: leg.family, kind: leg.kind, chance: s.prob, views: s.views });
  }
  return out;
}

/** The joint model of one match for public/betbuilder-core.js, from the Strongest inputs. */
function modelFor(fx, sels) {
  const gv = (fx.goalViews || []).find((v) => v && v.name === 'market') || (fx.goalViews || [])[0];
  if (!gv || !(gv.lamH > 0) || !(gv.lamA > 0)) return null;
  const cv = (fx.cornerViews || []).find((v) => v && v.name === 'model');
  const kv = (fx.cardViews || []).find((v) => v && v.name === 'model');
  const legs = {};
  for (const s of sels || []) {
    const leg = BB.legOf(s.key);
    if (!leg) continue;
    if ((leg.kind === 'corners' && !cv) || (leg.kind === 'cards' && !kv)) continue;
    legs[s.key] = { chance: r4(s.prob), measured: !!s.measured, label: s.label, group: s.group };
  }
  const players = [];
  (fx.players || []).forEach((p, i) => {
    if (!p || !(p.share > 0) || !(p.involvement > 0)) return;
    players.push({ key: `PL_${p.side === 'home' ? 'H' : 'A'}_${i}`, name: p.name, side: p.side, share: r4(Math.min(0.5, p.share)), involvement: r4(p.involvement), lineup: p.lineup || null, source: p.source || null });
  });
  return {
    goals: { lamH: r4(gv.lamH), lamA: r4(gv.lamA), rho: gv.rho != null ? r4(gv.rho) : null },
    corners: cv ? { home: r4(cv.home), away: r4(cv.away), r: r4(cv.r) } : null,
    cards: kv ? { mu: r4(kv.mu), r: r4(kv.r) } : null,
    players,
    legs,
  };
}

/**
 * The most likely builder of CFG.minLegs..maxLegs legs (one per family) whose fair odds reach
 * the target. Depth-first over market families; adding a leg can only lower the combined
 * chance, so a branch stops once it reaches the target, and branches that cannot beat the best
 * found are cut.
 * @returns {null|{keys:string[], raw:number, chance:number}}
 */
function search(prep, pool, cfg = CFG, cal = builderCal()) {
  if (!prep || !pool.length) return null;
  const NG = BB.MAX_GOALS + 1;
  const NC = BB.MAX_CORNERS + 1;
  const NK = BB.MAX_CARDS + 1;
  // base distributions, flattened
  const G0 = new Float64Array(NG * NG);
  for (let i = 0; i < NG; i++) for (let j = 0; j < NG; j++) G0[i * NG + j] = prep.sm[i][j];
  const C0 = prep.ch ? new Float64Array(NC * NC) : null;
  if (C0) for (let h = 0; h < NC; h++) for (let a = 0; a < NC; a++) C0[h * NC + a] = prep.ch[h] * prep.ca[a];
  const K0 = prep.kp ? Float64Array.from(prep.kp) : null;
  const sum = (v) => {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i];
    return s;
  };
  const legs = [];
  for (const l of pool) {
    const t = BB.legOf(l.key).test;
    let mask;
    if (l.kind === 'goals') {
      mask = new Float64Array(NG * NG);
      for (let i = 0; i < NG; i++) for (let j = 0; j < NG; j++) mask[i * NG + j] = t(i, j) ? 1 : 0;
    } else if (l.kind === 'corners') {
      if (!C0) continue;
      mask = new Float64Array(NC * NC);
      for (let h = 0; h < NC; h++) for (let a = 0; a < NC; a++) mask[h * NC + a] = t(h, a) ? 1 : 0;
    } else if (l.kind === 'cards') {
      if (!K0) continue;
      mask = new Float64Array(NK);
      for (let c = 0; c < NK; c++) mask[c] = t(c) ? 1 : 0;
    } else continue;
    const base = l.kind === 'goals' ? G0 : l.kind === 'corners' ? C0 : K0;
    let r1 = 0;
    for (let i = 0; i < base.length; i++) r1 += base[i] * mask[i];
    if (!(r1 > 1e-9)) continue;
    legs.push({ ...l, mask, r1, f: l.chance / r1 });
  }
  // Coherence: no two legs may pull against each other. Two legs of one kind (both goals, or
  // both corners) must land together at least as often as if they were unrelated; legs of
  // different kinds are unrelated in the model. A builder then tells one story of the match.
  const together = (x, y) => {
    if (x.kind !== y.kind) return true;
    let p = 0;
    for (let i = 0; i < x.mask.length; i++) p += (x.kind === 'goals' ? G0[i] : x.kind === 'corners' ? C0[i] : K0[i]) * x.mask[i] * y.mask[i];
    return p >= x.r1 * y.r1 * (1 - cfg.maxPull);
  };
  for (const x of legs) x.ok = new Set();
  for (let i = 0; i < legs.length; i++) {
    for (let k = i + 1; k < legs.length; k++) {
      if (together(legs[i], legs[k])) {
        legs[i].ok.add(legs[k]);
        legs[k].ok.add(legs[i]);
      }
    }
  }
  // families: the likeliest lines of each, families with the likeliest leg first
  const byFam = new Map();
  for (const l of legs) {
    if (!byFam.has(l.family)) byFam.set(l.family, []);
    byFam.get(l.family).push(l);
  }
  const fams = [...byFam.values()]
    .map((ls) => ls.sort((a, b) => b.chance - a.chance).slice(0, cfg.linesPerFamily))
    .sort((a, b) => b[0].chance - a[0].chance);
  const lo = 1 / cfg.maxOdds;
  const hi = 1 / cfg.target;
  let best = null;
  // Every builder that reaches the odds lands about as often as its odds say, so the rule
  // prefers (1) the FEWEST legs — each leg costs bookmaker margin and is one more thing to go
  // wrong — then (2) the strongest weakest leg, then (3) the higher combined chance.
  // a leg's strength for the comparison: corners and cards, with no bookmaker price of their
  // own, give way to bookmaker-anchored legs (as on the Strongest Picks list)
  const strength = (l) => l.chance - (l.kind === 'goals' ? 0 : cfg.statsOnlyPenalty);
  const better = (c, chosen) => {
    if (!best) return true;
    if (chosen.length !== best.keys.length) return chosen.length < best.keys.length;
    const minLeg = Math.min(...chosen.map(strength));
    if (Math.abs(minLeg - best.minLeg) > 1e-9) return minLeg > best.minLeg;
    return c > best.chance;
  };
  const vec = { goals: G0, corners: C0, cards: K0 };
  const sums = { goals: 1, corners: 1, cards: 1 };
  const chosen = [];
  // one scratch vector per depth and kind: no allocation inside the search
  const bufs = Array.from({ length: cfg.maxLegs + 1 }, () => ({
    goals: new Float64Array(G0.length),
    corners: C0 ? new Float64Array(C0.length) : null,
    cards: K0 ? new Float64Array(K0.length) : null,
  }));
  // With l added (its kind's mass is s; `rest` = the other kinds' combined chance), does some
  // chosen leg stop mattering, i.e. would the builder's chance be the same without it? Kinds
  // are independent in the model, so only a leg of l's kind can be made certain by l.
  function passenger(l, s, rest) {
    const base = l.kind === 'goals' ? G0 : l.kind === 'corners' ? C0 : K0;
    const same = chosen.filter((c) => c.kind === l.kind);
    for (const c of same) {
      let s2 = 0;
      for (let i = 0; i < base.length; i++) {
        let v = base[i] * l.mask[i];
        for (let k = 0; v && k < same.length; k++) if (same[k] !== c) v *= same[k].mask[i];
        s2 += v;
      }
      if ((s2 - s) * rest < 1e-9) return true;
    }
    return false;
  }
  function dfs(start, factor, cap) {
    const raw0 = sums.goals * sums.corners * sums.cards;
    const depth = chosen.length;
    for (let fi = start; fi < fams.length; fi++) {
      for (const l of fams[fi]) {
        if (chosen.some((c) => !c.ok.has(l))) continue; // pulls against a leg already in
        const prev = vec[l.kind];
        const next = bufs[depth][l.kind];
        let s = 0;
        for (let i = 0; i < prev.length; i++) {
          const v = prev[i] * l.mask[i];
          next[i] = v;
          s += v;
        }
        const prevSum = sums[l.kind];
        const raw = raw0 / prevSum * s;
        if (raw < 1e-9 || raw >= raw0 - 1e-9) continue; // impossible together, or already guaranteed
        // ...and no leg already in may become a passenger: "home win" makes an earlier "home to
        // score" certain, so that leg would only pad the builder to its minimum size
        if (passenger(l, s, raw0 / prevSum)) continue;
        const f2 = factor * l.f;
        const cap2 = Math.min(cap, l.chance);
        const adj = Math.max(0, Math.min(cap2, raw * f2));
        const fin = cal ? BB.calibrate(adj, cal) : adj;
        chosen.push(l);
        if (chosen.length >= cfg.minLegs && fin <= hi + 1e-9) {
          // the whole set must not pull against itself either
          const apart = chosen.reduce((a, x) => a * x.r1, 1);
          const coherent = raw >= apart * (1 - cfg.maxPull);
          if (coherent && fin >= lo - 1e-9 && better(fin, chosen)) best = { keys: chosen.map((x) => x.key), raw, chance: fin, minLeg: Math.min(...chosen.map(strength)) };
        } else if (chosen.length < cfg.maxLegs && (!best || chosen.length < best.keys.length)) {
          vec[l.kind] = next;
          sums[l.kind] = s;
          dfs(fi + 1, f2, cap2);
          vec[l.kind] = prev;
          sums[l.kind] = prevSum;
        }
        chosen.pop();
      }
    }
  }
  dfs(0, 1, 1);
  return best;
}

/** One match's builder (or null), its joint model and its "build your own" menu. */
function forMatch({ fx, sels, ctx }, cfg = CFG) {
  const model = modelFor(fx, sels);
  if (!model) return { builder: null, model: null, options: [] };
  const prep = BB.prepare(model);
  const cal = builderCal();
  const pool = eligibleLegs(sels, ctx, cfg);
  const found = search(prep, pool, cfg, cal);
  let builder = null;
  if (found) {
    const j = BB.joint(prep, found.keys, cal);
    const byKey = Object.fromEntries(pool.map((l) => [l.key, l]));
    const legs = found.keys.map((k) => ({ key: k, label: byKey[k].label, group: byKey[k].group, chance: r4(byKey[k].chance) }));
    builder = {
      legs,
      size: legs.length,
      chance: r4(j.chance),
      raw: r4(j.raw),
      product: r4(j.product),
      fairOdds: r4(1 / j.chance),
      takeAt: r4(Math.max(cfg.target, 1 / j.chance)),
      measured: true,
    };
  }
  // the menu for "build your own": every selection the joint model can price
  const options = [];
  for (const [key, l] of Object.entries(model.legs)) {
    const kind = BB.legOf(key).kind;
    if (kind === 'player') continue;
    if (!cfg.groups.includes(l.group)) continue;
    options.push({ key, label: l.label, group: l.group, chance: l.chance, measured: l.measured });
  }
  for (const p of model.players) {
    const c = BB.rawJoint(prep, [p.key]);
    options.push({ key: p.key, label: `${p.name} to score`, group: 'Players', chance: r4(c), measured: false, lineup: p.lineup });
    model.legs[p.key] = { chance: r4(c), measured: false, label: `${p.name} to score`, group: 'Players' };
  }
  return { builder, model, options };
}

/**
 * The day's bet builders.
 * @param {Array<{match:object, fx:object, sels:object[], ctx:object}>} items
 */
function forDay(items, cfg = CFG) {
  const matches = [];
  for (const it of items) {
    const r = forMatch(it, cfg);
    if (!r.model) continue;
    // the page builds the "build your own" menu from model.legs (r.options repeats it)
    matches.push({ match: it.match, started: !!(it.ctx && it.ctx.started), builder: it.ctx && it.ctx.started ? null : r.builder, model: r.model });
  }
  // every builder lands about as often as its odds say (measured), so the day is ordered the way
  // each builder was chosen: fewest legs, then the strongest weakest leg, then the chance
  const weakest = (b) => Math.min(...b.legs.map((l) => l.chance - (l.group === 'Corners' || l.group === 'Bookings' ? cfg.statsOnlyPenalty : 0)));
  const builders = matches
    .filter((m) => m.builder)
    .map((m) => ({ match: m.match, builder: m.builder }))
    .sort((a, b) => a.builder.size - b.builder.size || weakest(b.builder) - weakest(a.builder) || b.builder.chance - a.builder.chance);
  return { target: cfg.target, builders, matches };
}

function publicConfig(cfg = CFG) {
  const m = CAL.models();
  return {
    version: cfg.version,
    target: cfg.target,
    maxOdds: cfg.maxOdds,
    minLegs: cfg.minLegs,
    maxLegs: cfg.maxLegs,
    minLegChance: cfg.minLegChance,
    maxPull: cfg.maxPull,
    excluded: SC.excluded || [], // kept off the lists for their record; "build your own" says so
    featured: cfg.featured,
    calibrated: !!builderCal(),
    cal: builderCal(), // the page's "build your own" applies the same calibration
    measured: m && m.builder ? m.builder.measured || null : null,
  };
}

function rules(cfg = CFG) {
  const p = (v) => `${Math.round(v * 100)}%`;
  return [
    `Up to ${cfg.maxLegs} selections from ONE match — result, goals, both teams to score, team goals, corners, cards — reaching ${cfg.target.toFixed(1)}+ odds (and no more than ${cfg.maxOdds.toFixed(1)}).`,
    `Every leg is a measured selection on its own: at least ${p(cfg.minLegChance)}, every view agreeing, and none of the Strongest Picks' trap checks against it.`,
    'The legs depend on each other, so their chances are never multiplied: one score model of the match gives the chance that ALL of them land; a leg the others already guarantee is left out, contradictory legs are impossible.',
    'The legs tell one story of the match: no two of them pull against each other (a hedge that looks safe leg by leg but rarely lands as a whole).',
    'Of every combination that reaches the odds, the one with the fewest legs is chosen (each leg costs bookmaker margin and is one more thing to go wrong), then the one whose weakest leg is strongest.',
    'The combined chance is checked against what builders made this way actually did on past matches, and calibrated.',
    'Scorers are offered only in "build your own": there is no scorer history to measure them, and they hang on the line-up.',
  ];
}

module.exports = { CFG, eligibleLegs, modelFor, search, forMatch, forDay, publicConfig, rules, builderCal };
