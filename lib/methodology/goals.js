'use strict';

/**
 * methodology/goals.js — the goals-market methodologies.
 *
 *   over25     Over 2.5 Goals              (v2.0 rules + v3.0 favourite / low-block / streak rules)
 *   under25    Under 2.5 Goals             (v2.5 UNDER, inverted)
 *   bttsNo     Both Teams To Score — No    (v2.5 BTTS NO, inverted; the "1-1 trap")
 *   bttsYes    Both Teams To Score — Yes   (new; mirror of BTTS No)
 *   gg2        GG/NG 2+  (both teams 2+)   (v3.1 — paper-trade only)
 *   teamGoals  Team Total Goals            (new; over/under 1.5, team-to-fail-to-score)
 *
 * Each spec is `{ id, name, floor, build(V, cand) -> { gates, checklist, support, failure } }`.
 * The universal gates (MODEL probability floor, SAMPLE size) are added by core.
 * See methodology/*.md for the rule text; rule numbers in comments point there.
 */

const { CFG, G, C, clamp01, pct, f2, lossCase } = require('./core');

const rate = (S, k) => (S && S.n ? S[k] / S.n : null);
const avg = (...xs) => {
  const v = xs.filter((x) => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const nm = (V, side) => V.names[side];
const other = (side) => (side === 'home' ? 'away' : 'home');
/** Linear 0..1 ramp: `lo` -> 0, `hi` -> 1 (works for hi < lo too). */
const ramp = (x, lo, hi) => (x == null || !Number.isFinite(x) ? null : clamp01((x - lo) / (hi - lo)));
const rotated = (V, side) => V.rest[side] != null && V.rest[side] < CFG.rotationDays;
const newsLevel = (V, side) => (V.news && V.news[side] ? V.news[side].level : 'none');
const absences = (V, side) => V.positions[side].absences;
const defLoss = (V, side) => V.positions[side].def + V.positions[side].gk;

/** Which side has the lower expected goals (the "weak attack"). */
const weakAttack = (V) => (V.lam.home <= V.lam.away ? 'home' : 'away');

// ====================================================================== OVER 2.5

const over25 = {
  id: 'over25',
  name: 'Over 2.5 Goals',
  version: '4.0',
  family: 'Goals',
  marketKey: 'O2.5',
  floor: 0.57,
  minRatio: 1.08,
  ceiling: 0.8,

  build(V) {
    const { pr, lam } = V;
    const H = V.sides.home;
    const A = V.sides.away;
    const gates = [];
    const items = [];

    // O3 — Rule 4: two credible scoring pathways.
    const both = lam.home >= 1.0 && lam.away >= 1.0;
    const dominant = Math.max(lam.home, lam.away) >= 2.2;
    gates.push(G('PATH', 'Two credible scoring pathways', both || dominant,
      `λ ${f2(lam.home)} / ${f2(lam.away)}`, 'both ≥ 1.00, or one ≥ 2.20', { rule: 'Rule 4' }));

    // O4 — v3.0 Rule 25: a heavy favourite must have shown it pushes for a 3rd goal.
    if (V.fav.heavy && V.fav.side) {
      const F = V.sides[V.fav.side];
      const r3 = rate(F, 'gf3p');
      gates.push(G('FAV', 'Heavy favourite has pushed for 3+ goals',
        r3 == null ? null : r3 >= 0.35, `${nm(V, V.fav.side)} 3+ goals in ${F.gf3p}/${F.n}`, '≥ 35% of games',
        { rule: 'Rule 25', note: `Priced ${f2(V.fav.price)} — a side that wins 1-0 / 2-0 caps the total.` }));
    } else {
      gates.push(G('FAV', 'No heavy favourite capping the total', true, V.fav.side ? `${nm(V, V.fav.side)} @ ${f2(V.fav.price)}` : 'balanced', '—', { rule: 'Rule 25' }));
    }

    // O5 — v3.0 Rule 26: low-block signature on either side kills the Over.
    const lowBlock = (S) => S.n >= CFG.minSample && S.u25 / S.n >= 0.7 && S.fts / S.n >= 0.3;
    const lbSide = ['home', 'away'].find((s) => lowBlock(V.sides[s]));
    gates.push(G('LOWBLOCK', 'No low-block / bus-parking side', !lbSide,
      lbSide ? `${nm(V, lbSide)}: Under 2.5 in ${V.sides[lbSide].u25}/${V.sides[lbSide].n}, blanked ${V.sides[lbSide].fts}` : 'none',
      'Under rate < 70% or blanks < 30%', { rule: 'Rule 26' }));

    // O6 — Rules 15/18/19: rotation and attacker-less games.
    const rot = ['home', 'away'].filter((s) => rotated(V, s));
    const attBoth = V.positions.home.att >= 1 && V.positions.away.att >= 1;
    const heavyAbs = ['home', 'away'].find((s) => absences(V, s) >= 3);
    gates.push(G('NEWS', 'No rotation risk, no attackers missing on both sides',
      rot.length === 0 && !attBoth && !heavyAbs,
      rot.length ? `${rot.map((s) => nm(V, s)).join(' & ')} played < ${CFG.rotationDays} days ago`
        : attBoth ? 'attackers reported out on both sides' : heavyAbs ? `${nm(V, heavyAbs)}: ${absences(V, heavyAbs)} absences` : 'clean',
      'clean', { rule: 'Rules 15, 18, 19' }));

    // O7 — Rules 20 / 27: a streak is not evidence.
    const stk = ['home', 'away'].find((s) => V.sides[s].o25Streak >= 4);
    gates.push(G('STREAK', 'Not anchored on an Over streak the model does not support',
      !(stk && V.lam.total < 2.6),
      stk ? `${nm(V, stk)} Over in last ${V.sides[stk].o25Streak}; model total ${f2(V.lam.total)}` : 'no streak anchor',
      'streak must be backed by λ ≥ 2.6', { rule: 'Rules 20, 27' }));

    // ---- checklist
    items.push(C('FORM', 'Both sides trending Over 2.5', ramp(avg(rate(H, 'o25'), rate(A, 'o25')), 0.4, 0.65),
      `${pct(rate(H, 'o25'))} / ${pct(rate(A, 'o25'))}`, 'last games, each side'));
    items.push(C('TEMPO', 'Expected total goals', ramp(lam.total, 2.4, 2.9), f2(lam.total), 'λ home + λ away'));
    items.push(C('H2H', 'Head-to-head Over rate', V.h2h && V.h2h.n >= 3 ? ramp(V.h2h.o25, 0.35, 0.6) : null,
      V.h2h ? `${pct(V.h2h.o25)} of ${V.h2h.n}` : 'no H2H', 'need > 50%'));
    const leak = avg(H.gapg, A.gapg);
    const defHit = defLoss(V, 'home') + defLoss(V, 'away') > 0;
    items.push(C('LEAK', 'Defensive leakiness / disruption', leak == null ? null : clamp01((leak - 1.0) / 0.45 + (defHit ? 0.15 : 0)),
      `${f2(H.gapg)} / ${f2(A.gapg)} conceded per game${defHit ? ' + defender/keeper absence reported' : ''}`, 'Rule 12'));
    items.push(C('ATTACK', 'Both attacks in intent', ramp(avg(H.gfpg, A.gfpg), 1.1, 1.6), `${f2(H.gfpg)} / ${f2(A.gfpg)} scored per game`, ''));
    items.push(C('NOCAP', 'No cautious profile', 1 - (ramp(Math.max(rate(H, 'u25') || 0, rate(A, 'u25') || 0), 0.4, 0.75) || 0),
      `max Under rate ${pct(Math.max(rate(H, 'u25') || 0, rate(A, 'u25') || 0))}`, ''));
    items.push(C('LEAGUE', 'League goals environment', V.league.o25 == null ? null : ramp(V.league.o25, 0.42, 0.54),
      V.league.o25 == null ? 'unknown' : `${pct(V.league.o25)} of league games go Over`, ''));
    if (V.pr.o25 >= 0.6 && V.xg.home && V.xg.away) {
      // Rule 20 regression check, informational through the checklist: scoring far above xG fades.
    }

    return {
      gates,
      checklist: items,
      support: [
        `Model expects ${f2(lam.total)} goals; Over 2.5 at ${pct(pr.o25, 1)} (fair odds ${f2(1 / pr.o25)}).`,
        both ? 'Both sides project to score — two independent goal pathways.' : 'One dominant attack carries the total.',
      ],
      failure: [
        lossCase(V, (a, b) => a + b <= 2, 'Over 2.5'),
        V.fav.side ? `Failure case: ${nm(V, V.fav.side)} scores first and manages the game to a 1-0 / 2-0 (Rule 25).` : 'Failure case: an early goal makes both sides cautious.',
      ],
    };
  },
};

// ====================================================================== UNDER 2.5

const under25 = {
  id: 'under25',
  name: 'Under 2.5 Goals',
  version: '4.0',
  family: 'Goals',
  marketKey: 'U2.5',
  floor: 0.57,
  minRatio: 1.08,
  ceiling: 0.8,

  build(V) {
    const { pr, lam } = V;
    const H = V.sides.home;
    const A = V.sides.away;
    const gates = [];
    const items = [];
    const F = V.fav.side ? V.sides[V.fav.side] : null;
    const D = V.fav.dog ? V.sides[V.fav.dog] : null;

    // U3 — Rule 4 (inverted): WHY does this stay under three? One named path.
    const paths = [];
    if (F && D && lam[V.fav.side] <= 1.9 && lam[V.fav.dog] <= 0.85 && F.gapg != null && F.gapg <= 1.0) paths.push('A: favourite suffocates');
    if (lam.home <= 1.25 && lam.away <= 1.25 && H.totpg != null && A.totpg != null && H.totpg <= 2.5 && A.totpg <= 2.5) paths.push('B: both cautious');
    if (F && D && rate(D, 'u25') != null && rate(D, 'u25') >= 0.65 && lam[V.fav.side] <= 1.7) paths.push('C: low-block underdog');
    gates.push(G('PATH', 'A named route to under 3 goals', paths.length > 0, paths.length ? paths.join('; ') : 'none found',
      'A, B or C', { rule: 'Rule 4' }));

    // U4 — Rule 19 (Under version): a heavy favourite must NOT be a 3-0 / 3-1 side.
    if (V.fav.heavy && F) {
      const r3 = rate(F, 'gf3p');
      gates.push(G('FAV', 'Heavy favourite settles for 1-0 / 2-0 wins',
        r3 == null ? null : r3 <= 0.25, `${nm(V, V.fav.side)} 3+ goals in ${F.gf3p}/${F.n}`, '≤ 25% of games', { rule: 'Rule 19' }));
    } else {
      gates.push(G('FAV', 'No heavy favourite pushing for goals', true, V.fav.side ? `${nm(V, V.fav.side)} @ ${f2(V.fav.price)}` : 'balanced', '—', { rule: 'Rule 19' }));
    }

    // U5 — no attacking chaos.
    const bigH = rate(H, 'big4');
    const bigA = rate(A, 'big4');
    const leakyBoth = H.gapg != null && A.gapg != null && H.gapg >= 1.6 && A.gapg >= 1.6;
    gates.push(G('CHAOS', 'No attacking chaos', (bigH == null || bigH <= 0.25) && (bigA == null || bigA <= 0.25) && !leakyBoth,
      `4+ goal games ${pct(bigH)} / ${pct(bigA)}; conceding ${f2(H.gapg)} / ${f2(A.gapg)}`, '≤ 25% each, not both ≥ 1.6 conceded', { rule: 'Rule 12' }));

    // U6 — Rule 15 (inverted): defensive absences on both sides are chaos.
    const dh = defLoss(V, 'home');
    const da = defLoss(V, 'away');
    gates.push(G('NEWS', 'No defender / keeper disruption', !((dh >= 1 && da >= 1) || dh >= 2 || da >= 2),
      `defensive absences ${dh} / ${da}`, 'not on both sides', { rule: 'Rule 15' }));

    // U7 — Mistake 11: a side that always scores will score again.
    const stk = ['home', 'away'].find((s) => V.sides[s].scoreStreak >= 6 && lam[s] >= 1.2);
    gates.push(G('STREAK', 'No long scoring streak the model backs', !stk,
      stk ? `${nm(V, stk)} scored in last ${V.sides[stk].scoreStreak}` : 'none', '< 6 and model-backed', { rule: 'Mistake 11' }));

    // ---- checklist
    items.push(C('DEF', 'Defensive strength on both', ramp(avg(H.gapg, A.gapg), 1.5, 0.9), `${f2(H.gapg)} / ${f2(A.gapg)} conceded`, 'Rule 3'));
    items.push(C('TEMPO', 'Low expected total', ramp(lam.total, 2.9, 2.3), f2(lam.total), ''));
    items.push(C('FORM', 'Both sides trending Under', ramp(avg(rate(H, 'u25'), rate(A, 'u25')), 0.4, 0.7),
      `${pct(rate(H, 'u25'))} / ${pct(rate(A, 'u25'))}`, ''));
    items.push(C('H2H', 'Head-to-head Under rate', V.h2h && V.h2h.n >= 3 ? ramp(V.h2h.u25, 0.35, 0.65) : null,
      V.h2h ? `${pct(V.h2h.u25)} of ${V.h2h.n}` : 'no H2H', 'need > 50%'));
    items.push(C('CS', 'Clean-sheet habit', ramp(avg(rate(H, 'cs'), rate(A, 'cs')), 0.2, 0.45), `${pct(rate(H, 'cs'))} / ${pct(rate(A, 'cs'))}`, ''));
    items.push(C('ATTACK', 'Limited firepower', ramp(avg(H.gfpg, A.gfpg), 1.6, 1.0), `${f2(H.gfpg)} / ${f2(A.gfpg)} scored`, ''));
    items.push(C('LEAGUE', 'League environment', V.league.o25 == null ? null : ramp(V.league.o25, 0.6, 0.45),
      V.league.o25 == null ? 'unknown' : `${pct(1 - V.league.o25)} of league games stay Under`, ''));

    return {
      gates,
      checklist: items,
      support: [`Model expects ${f2(lam.total)} goals; Under 2.5 at ${pct(pr.u25, 1)} (fair ${f2(1 / pr.u25)}).`, paths.length ? `Route: ${paths[0]}.` : ''].filter(Boolean),
      failure: [
        lossCase(V, (a, b) => a + b >= 3, 'Under 2.5'),
        'Rule 1 test: if this finished 3-1, would that be a surprise? '
          + `P(4+ goals) is ${pct(pr.tot4, 1)}.`,
        V.fav.dog ? `Failure case: ${nm(V, V.fav.dog)} scores first, ${nm(V, V.fav.side)} must chase and the game opens.` : '',
      ].filter(Boolean),
    };
  },
};

// ====================================================================== BTTS NO

const bttsNo = {
  id: 'bttsNo',
  name: 'Both Teams To Score — No',
  version: '4.0',
  family: 'BTTS',
  marketKey: 'BTTS_N',
  floor: 0.57,
  minRatio: 1.08,
  ceiling: 0.8,

  build(V) {
    const { pr, lam } = V;
    const H = V.sides.home;
    const A = V.sides.away;
    const gates = [];
    const items = [];
    const W = weakAttack(V); // the side that must fail to score
    const WS = V.sides[W];
    const FS = V.sides[other(W)];
    const pWeakBlank = W === 'home' ? pr.h0 : pr.a0;

    // B3 — Rule 4: one named shutout path, with evidence on the side that must blank.
    const blankRate = rate(WS, 'fts');
    const weakEvidence = (blankRate != null && blankRate >= 0.25) || (WS.gfpg != null && WS.gfpg <= 1.0) || (V.xg[W] != null && V.xg[W] <= 1.0);
    gates.push(G('PATH', 'The weaker attack can realistically blank', pWeakBlank >= 0.38 && weakEvidence,
      `${nm(V, W)} blank ${pct(pWeakBlank)} (model); scored 0 in ${WS.fts}/${WS.n}, ${f2(WS.gfpg)}/game`,
      'model ≥ 38% and (blanked ≥ 25% or < 1.0/game or xG < 1.0)', { rule: 'Rule 4' }));

    // B4 — Rule 1: THE 1-1 TRAP. 1-1 is a BTTS-Yes result.
    gates.push(G('TRAP11', 'The 1-1 trap is not live', pr.p11 <= 0.12 && pr.btts <= 0.4,
      `P(1-1) ${pct(pr.p11, 1)}, P(both score) ${pct(pr.btts, 1)}`, 'P(1-1) ≤ 12%, P(BTTS) ≤ 40%', { rule: 'Rule 1' }));

    // B5 — Mistake 11: the underdog must not be in a scoring run.
    gates.push(G('DOGFORM', 'Weaker side is not in a scoring run', !(WS.scoreStreak >= 3 && (rate(WS, 'gf2p') || 0) >= 0.4),
      `${nm(V, W)} scored in last ${WS.scoreStreak}`, 'streak < 3, or rarely 2+', { rule: 'Mistake 11' }));

    // B6 — Rule 19: a heavy favourite needs either a strong defence or a toothless opponent.
    if (V.fav.heavy && V.fav.side) {
      const F = V.sides[V.fav.side];
      const D = V.sides[V.fav.dog];
      const csOk = rate(F, 'cs') != null && rate(F, 'cs') >= 0.4;
      const dogWeak = D.gfpg != null && D.gfpg <= 1.05;
      gates.push(G('FAV', 'Heavy favourite: strong defence or toothless underdog', csOk || dogWeak,
        `${nm(V, V.fav.side)} clean sheets ${pct(rate(F, 'cs'))}; ${nm(V, V.fav.dog)} ${f2(D.gfpg)} scored/game`, 'clean sheets ≥ 40% or underdog ≤ 1.05/game', { rule: 'Rule 19' }));
    } else {
      gates.push(G('FAV', 'No heavy-favourite structure to verify', true, 'n/a', '—', { rule: 'Rule 19' }));
    }

    // B7 — no chaos: not both leaking.
    gates.push(G('CHAOS', 'Not both defences leaking', !(H.gapg >= 1.4 && A.gapg >= 1.4),
      `${f2(H.gapg)} / ${f2(A.gapg)} conceded`, 'not both ≥ 1.4', { rule: 'Rule 12' }));

    // B8 — team news: a leaky favourite defence is a BTTS-Yes risk; a gutted underdog attack helps.
    const favDef = defLoss(V, other(W));
    gates.push(G('NEWS', 'No defender / keeper loss on the favourite side', favDef === 0,
      `${nm(V, other(W))} defensive absences ${favDef}`, '0', { rule: 'Rule 15' }));

    // ---- checklist
    items.push(C('DOGATK', 'Underdog attack verified weak', avg(ramp(WS.gfpg, 1.5, 0.8), ramp(V.xg[W], 1.4, 0.8)),
      `${f2(WS.gfpg)}/game${V.xg[W] ? `, xG ${f2(V.xg[W])}` : ''}`, 'Rule 3'));
    items.push(C('FAVDEF', 'Opposing defence holds', ramp(rate(FS, 'cs'), 0.15, 0.45), `clean sheets ${pct(rate(FS, 'cs'))}`, ''));
    items.push(C('BLANKS', 'Blank frequency in the games that matter',
      ramp(avg(rate(H, 'fts'), rate(A, 'fts')), 0.1, 0.35), `${pct(rate(H, 'fts'))} / ${pct(rate(A, 'fts'))} failed to score`, ''));
    items.push(C('NOBTTS', 'Sides rarely both score', ramp(avg(rate(H, 'btts'), rate(A, 'btts')), 0.65, 0.35),
      `${pct(rate(H, 'btts'))} / ${pct(rate(A, 'btts'))} BTTS`, 'Rule 13: counted once, not alongside Under'));
    items.push(C('H2H', 'Head-to-head BTTS-No rate', V.h2h && V.h2h.n >= 3 ? ramp(V.h2h.bttsNo, 0.35, 0.65) : null,
      V.h2h ? `${pct(V.h2h.bttsNo)} of ${V.h2h.n}` : 'no H2H', 'need > 50%'));
    items.push(C('TEMPO', 'Low expected total', ramp(lam.total, 3.0, 2.3), f2(lam.total), ''));
    items.push(C('ATTNEWS', 'Underdog attackers reported out', V.positions[W].att >= 1 ? 1 : null,
      `${V.positions[W].att} reported`, 'bonus only'));

    return {
      gates,
      checklist: items,
      support: [`${nm(V, W)} fails to score ${pct(pWeakBlank, 1)} of the time; BTTS No at ${pct(pr.bttsNo, 1)} (fair ${f2(1 / pr.bttsNo)}).`],
      failure: [
        lossCase(V, (a, b) => a >= 1 && b >= 1, 'BTTS No'),
        `Rule 1: 1-1 alone is ${pct(pr.p11, 1)}. If ${nm(V, W)} scores once on a counter or set piece, this loses.`,
      ],
    };
  },
};

// ====================================================================== BTTS YES

const bttsYes = {
  id: 'bttsYes',
  name: 'Both Teams To Score — Yes',
  version: '4.0',
  family: 'BTTS',
  marketKey: 'BTTS_Y',
  floor: 0.57,
  minRatio: 1.08,
  ceiling: 0.8,

  build(V) {
    const { pr, lam } = V;
    const H = V.sides.home;
    const A = V.sides.away;
    const gates = [];
    const items = [];

    // Y3 — both sides need their own route to a goal.
    const okH = pr.h1 + pr.h2 >= 0.7;
    const okA = pr.a1 + pr.a2 >= 0.7;
    const ftsH = rate(H, 'fts');
    const ftsA = rate(A, 'fts');
    gates.push(G('PATH', 'Both sides have a scoring route', okH && okA && (ftsH == null || ftsH <= 0.3) && (ftsA == null || ftsA <= 0.3),
      `P(score) ${pct(pr.h1 + pr.h2)} / ${pct(pr.a1 + pr.a2)}; blanked ${pct(ftsH)} / ${pct(ftsA)}`, 'each ≥ 70%, blanks ≤ 30%', { rule: 'Rule 4' }));

    // Y4 — no fortress: a side that keeps clean sheets caps the other.
    const fort = ['home', 'away'].find((s) => rate(V.sides[s], 'cs') != null && rate(V.sides[s], 'cs') >= 0.4);
    gates.push(G('FORTRESS', 'No clean-sheet fortress', !fort,
      fort ? `${nm(V, fort)} kept clean sheets in ${pct(rate(V.sides[fort], 'cs'))}` : 'none', '< 40% each', { rule: 'Rule 12' }));

    // Y5 — the 1-0 trap: low-total shutout results.
    const shut = pr.p00 + pr.p10 + pr.p01;
    gates.push(G('TRAP10', 'The 1-0 / 0-0 trap is not live', shut <= 0.28, `P(0-0, 1-0, 0-1) ${pct(shut, 1)}`, '≤ 28%', { rule: 'Rule 1' }));

    // Y6 — a heavy favourite that wins to nil is the standard BTTS-Yes loser.
    if (V.fav.heavy && V.fav.side) {
      const D = V.sides[V.fav.dog];
      const dogScores = D.n ? 1 - D.fts / D.n : null;
      gates.push(G('FAV', 'Heavy favourite does not shut out the underdog', dogScores == null ? null : dogScores >= 0.6,
        `${nm(V, V.fav.dog)} scored in ${D.n - D.fts}/${D.n}`, '≥ 60% of games', { rule: 'Rule 25' }));
    } else {
      gates.push(G('FAV', 'No heavy favourite shutting the game down', true, V.fav.side ? `${nm(V, V.fav.side)} @ ${f2(V.fav.price)}` : 'balanced', '—', { rule: 'Rule 25' }));
    }

    // Y7 — Rule 15: rotation, and attackers out.
    const rot = ['home', 'away'].filter((s) => rotated(V, s));
    const attOut = ['home', 'away'].find((s) => V.positions[s].att >= 2);
    gates.push(G('NEWS', 'No rotation, no key attackers out', rot.length === 0 && !attOut,
      rot.length ? `${rot.map((s) => nm(V, s)).join(' & ')} played < ${CFG.rotationDays} days ago` : attOut ? `${nm(V, attOut)}: ${V.positions[attOut].att} attackers out` : 'clean',
      'clean', { rule: 'Rules 15, 18' }));

    items.push(C('LAM', 'Both attacks project', ramp(Math.min(lam.home, lam.away), 0.95, 1.4), `λ ${f2(lam.home)} / ${f2(lam.away)}`, ''));
    items.push(C('LEAK', 'Both defences concede', ramp(Math.min(H.gapg ?? 0, A.gapg ?? 0), 0.9, 1.4), `${f2(H.gapg)} / ${f2(A.gapg)} conceded`, 'Rule 12'));
    items.push(C('BTTSFORM', 'Both sides trending BTTS', ramp(avg(rate(H, 'btts'), rate(A, 'btts')), 0.4, 0.7),
      `${pct(rate(H, 'btts'))} / ${pct(rate(A, 'btts'))}`, ''));
    items.push(C('H2H', 'Head-to-head BTTS rate', V.h2h && V.h2h.n >= 3 ? ramp(V.h2h.btts, 0.35, 0.65) : null,
      V.h2h ? `${pct(V.h2h.btts)} of ${V.h2h.n}` : 'no H2H', 'need > 50%'));
    items.push(C('TEMPO', 'Open expected total', ramp(lam.total, 2.3, 3.0), f2(lam.total), ''));
    items.push(C('LEAGUE', 'League environment', V.league.btts == null ? null : ramp(V.league.btts, 0.42, 0.54),
      V.league.btts == null ? 'unknown' : `${pct(V.league.btts)} of league games`, ''));
    items.push(C('DEFNEWS', 'Defender / keeper disruption', defLoss(V, 'home') + defLoss(V, 'away') > 0 ? Math.min(1, 0.6 + 0.2 * (defLoss(V, 'home') + defLoss(V, 'away'))) : null,
      `${defLoss(V, 'home')} / ${defLoss(V, 'away')} reported`, 'bonus only'));

    return {
      gates,
      checklist: items,
      support: [`Both sides project to score: BTTS Yes ${pct(pr.btts, 1)} (fair ${f2(1 / pr.btts)}).`],
      failure: [
        lossCase(V, (a, b) => a === 0 || b === 0, 'BTTS Yes'),
        'Failure case: one side scores first, then protects the lead with a deep block.',
      ],
    };
  },
};

// ====================================================================== GG / NG 2+

const gg2 = {
  id: 'gg2',
  name: 'GG/NG 2+ — Both Teams 2+ Goals',
  version: '3.1',
  family: 'GG/NG 2+',
  floor: 0.22,
  minRatio: 1.3,
  ceiling: 0.4,
  minSample: CFG.strongSample, // Rule 32: 8+ games per side, no exceptions
  paperOnly: true, // Rule 34 + no obtainable price source
  maxLegs: 2,
  stake: '1 unit, fixed (no Kelly)',
  priceNote:
    'Rules 28 & 33 need a corroborated price for this market, and no free feed quotes it. '
    + 'Enter your bookmaker\'s price: fair odds must be ≤ 0.77 × offered, and a second book or the correct-score ladder must agree.',

  candidates(V) {
    return [{ key: 'GG2P', label: 'GG/NG 2+ — Yes (both teams score 2+)', group: 'GG/NG 2+', prob: V.pr.gg2 }];
  },

  build(V) {
    const { pr, lam } = V;
    const H = V.sides.home;
    const A = V.sides.away;
    const gates = [];
    const items = [];

    // GG3 — Rule 30: the convolution gate. The tightest gate in the system.
    gates.push(G('GG3', 'Both sides can score 2+ (convolution)', pr.h2 >= 0.45 && pr.a2 >= 0.45,
      `P(home ≥ 2) ${pct(pr.h2, 1)}, P(away ≥ 2) ${pct(pr.a2, 1)}; × 0.88 = ${pct(pr.gg2, 1)}`, 'each ≥ 45%', { rule: 'Rule 30' }));

    // GG4 — Rule 32: coverage floor.
    const newsOk = V.coverage.newsScanned || V.coverage.newsWaived;
    const dataOk = V.coverage.xg || V.coverage.basis === 'openfootball';
    gates.push(G('GG4', 'Coverage floor: xG or full results, plus team news', dataOk && newsOk,
      `${V.coverage.xg ? 'xG' : 'no xG'}, results ${V.coverage.basis}, news ${V.coverage.newsScanned ? 'scanned' : V.coverage.newsWaived ? 'waived' : 'none'}`,
      'xG or 8+ results, and news', { rule: 'Rule 32' }));

    // GG5 — Rule 36: the modal cluster must not sit on the losing side.
    gates.push(G('GG5', 'Scoreline mass is not on 1-1 / 2-0 / 2-1 / 1-2', pr.gg2Kill <= 0.45,
      `losing cluster ${pct(pr.gg2Kill, 1)}`, '≤ 45%', { rule: 'Rule 36', note: 'Uses the model; the book\'s correct-score prices are not available.' }));

    // GG6 — Rule 31: a heavy favourite is a structural kill.
    if (V.fav.heavy && V.fav.side) {
      const F = V.sides[V.fav.side];
      const D = V.sides[V.fav.dog];
      const exc = rate(F, 'gf3p') >= 0.375 && rate(D, 'gf2p') >= 0.375;
      gates.push(G('GG6', 'No favourite priced < 1.60 (or both exceptions hold)', exc,
        `${nm(V, V.fav.side)} @ ${f2(V.fav.price)}; fav 3+ in ${F.gf3p}/${F.n}, dog 2+ in ${D.gf2p}/${D.n}`, 'fav 3+ ≥ 3/8 and dog 2+ ≥ 3/8', { rule: 'Rule 31' }));
    } else {
      gates.push(G('GG6', 'No favourite priced < 1.60', true, V.fav.side ? `${nm(V, V.fav.side)} @ ${f2(V.fav.price)}` : 'balanced', '—', { rule: 'Rule 31' }));
    }

    // GG7 — v3.0 Rules 15/18/19.
    const rot = ['home', 'away'].filter((s) => rotated(V, s));
    const dep = ['home', 'away'].find((s) => V.positions[s].departures > 0);
    gates.push(G('GG7', 'No rotation, debutants or key departures', rot.length === 0 && !dep && newsLevel(V, 'home') !== 'veto' && newsLevel(V, 'away') !== 'veto',
      rot.length ? 'rotation risk' : dep ? `${nm(V, dep)} departure reported` : 'clean', 'clean', { rule: 'Rules 15, 18, 19' }));

    // Rule 29 — admissible evidence: the 0 / 1 / 2+ distribution per side.
    const r2H = rate(H, 'gf2p');
    const r2A = rate(A, 'gf2p');
    const r3H = rate(H, 'gf3p');
    const r3A = rate(A, 'gf3p');
    gates.push(G('R29', 'Each side scores 2+ in ≥ half, 3+ in ≥ quarter of games',
      r2H == null || r2A == null ? null : r2H >= 0.5 && r2A >= 0.5 && r3H >= 0.25 && r3A >= 0.25,
      `2+: ${H.gf2p}/${H.n} & ${A.gf2p}/${A.n}; 3+: ${H.gf3p}/${H.n} & ${A.gf3p}/${A.n}`, '2+ ≥ 4/8, 3+ ≥ 2/8 each', { rule: 'Rule 29', note: 'BTTS form is inadmissible on this market (a 1-0 win is BTTS-positive and GG 2+-negative).' }));

    items.push(C('CONV', 'Convolution probability', ramp(pr.gg2, 0.2, 0.3), pct(pr.gg2, 1), 'need ≥ 22%'));
    items.push(C('LAMS', 'Both blended λ ≥ 1.9', ramp(Math.min(lam.home, lam.away), 1.5, 1.9), `λ ${f2(lam.home)} / ${f2(lam.away)}`, 'survivor profile'));
    items.push(C('FORM2', '2+ goal frequency', ramp(Math.min(r2H ?? 0, r2A ?? 0), 0.4, 0.6), `${pct(r2H)} / ${pct(r2A)}`, ''));
    items.push(C('LEAGUE', 'League average ≥ 2.8 goals', V.league.goals == null ? null : ramp(V.league.goals, 2.5, 3.0), V.league.goals == null ? 'unknown' : f2(V.league.goals), ''));
    items.push(C('BAL', 'Balanced, draw-live game', ramp(pr.draw, 0.18, 0.24), `P(draw) ${pct(pr.draw, 1)}`, '2-2 is a draw'));
    items.push(C('XG', 'Real xG on both sides', V.coverage.xg ? 1 : 0.3, V.coverage.xg ? 'yes' : 'no', 'Rule 32'));
    items.push(C('SKEW', 'Low losing-cluster mass', ramp(pr.gg2Kill, 0.5, 0.35), pct(pr.gg2Kill, 1), ''));
    items.push(C('FAIR', 'Fair odds vs offered (Rule 28)', null, 'enter your price', 'fair ≤ 0.77 × offered'));
    items.push(C('CORR', 'Corroborated second price (Rule 33)', null, 'enter your price', 'second source needed'));

    return {
      gates,
      checklist: items,
      support: [`Both sides ≥ 2 goals: ${pct(pr.gg2, 1)} after the 0.88 haircut (fair ${f2(1 / pr.gg2)}).`],
      flags: ['Paper-trade only: v3.1 requires a 40-leg record at ≥ 55% before real money.', 'Maximum 2 legs on any slip (Rule 34). 1 unit, fixed stake.'],
      failure: [
        `The modal cluster (1-1, 2-0, 2-1, 1-2 ...) loses this bet: ${pct(pr.gg2Kill, 1)} of outcomes.`,
        lossCase(V, (a, b) => !(a >= 2 && b >= 2), 'GG/NG 2+'),
      ],
    };
  },
};

// ====================================================================== TEAM TOTAL GOALS

const TEAM_KINDS = [
  { kind: 'O', line: 1.5, floor: 0.55, name: 'Over 1.5' },
  { kind: 'U', line: 1.5, floor: 0.62, name: 'Under 1.5' },
  { kind: 'U', line: 0.5, floor: 0.42, name: 'Under 0.5 (fails to score)' },
];

const teamGoals = {
  id: 'teamGoals',
  name: 'Team Total Goals',
  version: '4.0',
  family: 'Team Totals',
  floor: 0.55,
  minRatio: 1.08,
  ceiling: 0.8,

  candidates(V) {
    const out = [];
    for (const side of ['home', 'away']) {
      for (const t of TEAM_KINDS) {
        const key = `TT${side === 'home' ? 'H' : 'A'}_${t.kind}${t.line}`;
        if (!V.markets[key]) continue;
        out.push({ key, side, kind: t.kind, line: t.line, floor: t.floor, label: `${nm(V, side)} ${t.name}`, group: 'Team Totals' });
      }
    }
    return out;
  },

  build(V, cand) {
    const { lam } = V;
    const side = cand.side;
    const opp = other(side);
    const S = V.sides[side];
    const O = V.sides[opp];
    const gates = [];
    const items = [];
    const prob = V.markets[cand.key].prob;
    const lamS = lam[side];

    if (cand.kind === 'O' && cand.line === 1.5) {
      // Over 1.5 team goals: the side must score 2+ and the opponent must let it.
      gates.push(G('SCORE2', `${nm(V, side)} scores 2+ regularly`, rate(S, 'gf2p') == null ? null : rate(S, 'gf2p') >= 0.5 && rate(S, 'fts') <= 0.15,
        `2+ in ${S.gf2p}/${S.n}, blanked ${S.fts}/${S.n}`, '2+ ≥ 50%, blanks ≤ 15%', { rule: 'Rule 29' }));
      gates.push(G('LEAKS', `${nm(V, opp)} concedes`, O.n ? (O.gapg >= 1.2 || O.ga2p / O.n >= 0.375) : null,
        `${f2(O.gapg)} conceded/game, 2+ in ${O.ga2p}/${O.n}`, '≥ 1.2/game or 2+ in ≥ 3/8', { rule: 'Rule 12' }));
      gates.push(G('LAM', 'Expected goals support it', lamS >= 1.7, `λ ${f2(lamS)}`, '≥ 1.70', { rule: 'Rule 3' }));
      const lb = O.n >= CFG.minSample && O.u25 / O.n >= 0.7 && O.fts / O.n >= 0.3;
      gates.push(G('LOWBLOCK', 'Opponent is not a low block', !lb, lb ? `${nm(V, opp)} Under in ${O.u25}/${O.n}` : 'no', '—', { rule: 'Rule 26' }));
      const heavyDog = V.fav.dog === side && V.fav.heavy;
      gates.push(G('NEWS', 'No rotation, no attackers out, not a heavy underdog',
        !rotated(V, side) && V.positions[side].att < 2 && !heavyDog,
        rotated(V, side) ? 'rotation risk' : V.positions[side].att >= 2 ? `${V.positions[side].att} attackers out` : heavyDog ? 'heavy underdog' : 'clean', 'clean', { rule: 'Rules 15, 18' }));
      items.push(C('GF', 'Scoring rate', ramp(S.gfpg, 1.2, 1.9), `${f2(S.gfpg)}/game`, ''));
      items.push(C('GA', 'Opposition leakiness', ramp(O.gapg, 1.0, 1.7), `${f2(O.gapg)}/game`, ''));
      items.push(C('XG', 'xG supports the scoring', V.xg[side] ? ramp(V.xg[side], 1.2, 1.9) : null, V.xg[side] ? f2(V.xg[side]) : 'no xG', ''));
      items.push(C('HOME', 'Venue profile', side === 'home' ? ramp(S.atHome.n ? S.atHome.gf / S.atHome.n : null, 1.2, 2.0) : ramp(S.away.n ? S.away.gf / S.away.n : null, 1.0, 1.7),
        side === 'home' ? `${S.atHome.gf}/${S.atHome.n} at home` : `${S.away.gf}/${S.away.n} away`, ''));
      items.push(C('NOFADE', 'No regression risk (goals vs xG)', V.xg[side] && S.gfpg ? ramp(S.gfpg / V.xg[side], 1.45, 1.0) : null, V.xg[side] ? `${f2(S.gfpg)} scored vs ${f2(V.xg[side])} xG` : 'no xG', 'Rule 20'));
      items.push(C('SPREAD', 'Three-goal upside', ramp(rate(S, 'gf3p'), 0, 0.3), `3+ in ${S.gf3p}/${S.n}`, ''));
      items.push(C('NEWS', 'Opposing defence disrupted', defLoss(V, opp) > 0 ? 0.6 + 0.2 * Math.min(2, defLoss(V, opp)) : null, `${defLoss(V, opp)} reported`, 'bonus only'));
    } else if (cand.kind === 'U' && cand.line === 1.5) {
      // Under 1.5 team goals: scores 0 or 1.
      const low = S.n ? (S.gf0 + S.gf1) / S.n : null;
      gates.push(G('LOW', `${nm(V, side)} rarely scores 2+`, low == null ? null : low >= 0.62, `0-1 goals in ${S.gf0 + S.gf1}/${S.n}`, '≥ 62% of games', { rule: 'Rule 29' }));
      gates.push(G('LAM', 'Expected goals support it', lamS <= 1.15, `λ ${f2(lamS)}`, '≤ 1.15', { rule: 'Rule 3' }));
      gates.push(G('DEF', `${nm(V, opp)} defends`, O.n ? O.gapg <= 1.15 : null, `${f2(O.gapg)} conceded/game`, '≤ 1.15', { rule: 'Rule 12' }));
      const heavyFavSide = V.fav.side === side && V.fav.heavy;
      gates.push(G('FAV', 'Not a heavy favourite', !heavyFavSide, heavyFavSide ? `${nm(V, side)} @ ${f2(V.fav.price)}` : 'no', '—', { rule: 'Rule 25' }));
      gates.push(G('BIG', 'No big-score habit', S.n ? S.gf3p / S.n <= 0.12 : null, `3+ in ${S.gf3p}/${S.n}`, '≤ 12%', { rule: 'Rule 19' }));
      items.push(C('GF', 'Scoring rate', ramp(S.gfpg, 1.6, 0.9), `${f2(S.gfpg)}/game`, ''));
      items.push(C('GA', 'Opposition defence', ramp(O.gapg, 1.5, 0.9), `${f2(O.gapg)}/game`, ''));
      items.push(C('XG', 'xG agrees', V.xg[side] ? ramp(V.xg[side], 1.6, 0.9) : null, V.xg[side] ? f2(V.xg[side]) : 'no xG', ''));
      items.push(C('BLANK', 'Blank frequency', ramp(rate(S, 'fts'), 0.1, 0.35), `${S.fts}/${S.n}`, ''));
      items.push(C('ATT', 'Attackers reported out', V.positions[side].att >= 1 ? 1 : null, `${V.positions[side].att}`, 'bonus only'));
      items.push(C('VENUE', 'Venue profile', side === 'home' ? ramp(S.atHome.n ? S.atHome.gf / S.atHome.n : null, 1.6, 0.9) : ramp(S.away.n ? S.away.gf / S.away.n : null, 1.4, 0.7),
        side === 'home' ? `${S.atHome.gf}/${S.atHome.n} at home` : `${S.away.gf}/${S.away.n} away`, ''));
      items.push(C('TEMPO', 'Low expected total', ramp(lam.total, 2.8, 2.2), f2(lam.total), ''));
    } else {
      // Under 0.5: the side fails to score (the shutout leg of BTTS No).
      gates.push(G('BLANKS', `${nm(V, side)} fails to score regularly`, rate(S, 'fts') == null ? null : rate(S, 'fts') >= 0.25, `${S.fts}/${S.n} blanks`, '≥ 25%', { rule: 'Rule 4' }));
      gates.push(G('WEAK', 'Weak attack confirmed', (S.gfpg != null && S.gfpg <= 1.0) || (V.xg[side] != null && V.xg[side] <= 1.0), `${f2(S.gfpg)}/game${V.xg[side] ? `, xG ${f2(V.xg[side])}` : ''}`, '≤ 1.0/game or xG ≤ 1.0', { rule: 'Rule 3' }));
      gates.push(G('SHUT', `${nm(V, opp)} can keep a clean sheet`, rate(O, 'cs') == null ? null : rate(O, 'cs') >= 0.3, `${O.cs}/${O.n} clean sheets`, '≥ 30%', { rule: 'Rule 19' }));
      gates.push(G('RUN', 'Not in a scoring run', S.scoreStreak < 3, `scored in last ${S.scoreStreak}`, '< 3', { rule: 'Mistake 11' }));
      gates.push(G('NEWS', 'No rotation on the shutting side', !rotated(V, opp) && defLoss(V, opp) === 0, defLoss(V, opp) ? `${defLoss(V, opp)} defensive absences` : 'clean', '—', { rule: 'Rule 15' }));
      items.push(C('GF', 'Weak attack', ramp(S.gfpg, 1.4, 0.7), `${f2(S.gfpg)}/game`, ''));
      items.push(C('CS', 'Opposing clean-sheet rate', ramp(rate(O, 'cs'), 0.2, 0.5), `${pct(rate(O, 'cs'))}`, ''));
      items.push(C('LAM', 'Expected goals', ramp(lamS, 1.2, 0.7), f2(lamS), ''));
      items.push(C('XG', 'xG agrees', V.xg[side] ? ramp(V.xg[side], 1.3, 0.8) : null, V.xg[side] ? f2(V.xg[side]) : 'no xG', ''));
      items.push(C('ATT', 'Attackers reported out', V.positions[side].att >= 1 ? 1 : null, `${V.positions[side].att}`, 'bonus only'));
      items.push(C('DOG', 'Underdog side', V.fav.dog === side ? 1 : V.fav.side === side ? 0.1 : 0.5, V.fav.dog === side ? 'underdog' : V.fav.side === side ? 'favourite' : 'balanced', ''));
      items.push(C('H2H', 'Head-to-head blanks', V.h2h && V.h2h.n >= 3 ? ramp(V.h2h.bttsNo, 0.3, 0.6) : null, V.h2h ? `${pct(V.h2h.bttsNo)} of ${V.h2h.n}` : 'no H2H', ''));
    }

    return {
      gates,
      checklist: items,
      support: [`${cand.label}: model ${pct(prob, 1)} (fair ${f2(1 / prob)}); λ ${f2(lamS)}.`],
      failure: [
        lossCase(V, cand.kind === 'O' ? (a, b) => (side === 'home' ? a : b) <= 1 : cand.line === 1.5 ? (a, b) => (side === 'home' ? a : b) >= 2 : (a, b) => (side === 'home' ? a : b) >= 1, cand.label),
      ],
    };
  },
};

module.exports = { over25, under25, bttsNo, bttsYes, gg2, teamGoals };
