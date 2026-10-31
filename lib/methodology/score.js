'use strict';

/**
 * methodology/score.js — Final Score (correct score) methodology, v5 (new).
 *
 * Every analysable fixture gets a predicted final score in the general prediction
 * (lib/general.js). THIS methodology decides when that score is strong enough to
 * be called a pick in its own right.
 *
 * The evidence (research/score_study.js, 19,991 held-out fixtures): the coherent
 * predicted score hits exactly 11.8% of the time on average, and the stated
 * probability is honest. A correct-score market typically pays 6.0-9.0, so an
 * average exact-score pick is a long-odds bet with a ~1-in-8 hit rate. The rules
 * below keep only the fixtures where the score distribution is CONCENTRATED — a
 * clear result, a clear goals band, and most of the probability on few scorelines.
 *
 * Rules
 *   CS1  Concentration: P(predicted score) ≥ 12%                (universal MODEL gate)
 *   CS2  Clear result: the predicted result is ≥ 52% likely
 *   CS3  Clear goals band: the predicted O/U 2.5 side is ≥ 56% likely
 *   CS4  Top-three scores hold ≥ 33% of the probability
 *   CS5  No witness conflict on the RESULT (model-only predicts the same result)
 *   CS6  Never in a slip: a correct score is a single, at a quarter stake
 * Price: no free feed quotes correct scores. Take it only at ≥ 1.03 × fair odds.
 */

const { G, C, clamp01, pct, f2 } = require('./core');
const SL = require('../scoreline');
const M = require('../model');

const ramp = (x, lo, hi) => (x == null || !Number.isFinite(x) ? null : clamp01((x - lo) / (hi - lo)));

function calls(V) {
  return { home: V.pr.home, draw: V.pr.draw, away: V.pr.away, over25: V.pr.o25 };
}

const correctScore = {
  id: 'correctScore',
  name: 'Final Score (Correct Score)',
  version: '5.0',
  family: 'Score',
  floor: 0.12,
  minRatio: 1.03,
  ceiling: 0.2,
  canLock: false,
  headline: false, // shown in the Final Score panel; never displaces a market pick as the fixture headline
  stake: 'quarter unit, single only',
  // v5.1: keeps the 0.85 checklist bar (the audit could not tell whether its checklist helps:
  // the 0.70-0.85 picks won 3.1 points under their chance on 2019-22 and 3.7 over on 2023-26)
  qualify: 0.85,
  priceNote: 'No free feed quotes correct scores. Take it only at 1.03 × the fair odds or better, as a single.',

  candidates(V) {
    const sp = SL.predict(V.lam.home, V.lam.away, calls(V));
    V._score = sp;
    // the independent witness: the same scoreline's probability under the model-only expected goals
    let modelProb = null;
    let modelOutcome = null;
    if (V.ens && V.ens.model) {
      const ms = SL.predict(V.ens.model.lamH, V.ens.model.lamA);
      modelProb = ms.grid[sp.predicted.home] ? ms.grid[sp.predicted.home][sp.predicted.away] : null;
      modelOutcome = ms.outcome;
    }
    V._scoreWitness = { modelProb, modelOutcome };
    return [{
      key: `CS_${sp.predicted.score}`,
      label: `Final score ${V.names.home} ${sp.predicted.home}-${sp.predicted.away} ${V.names.away}`,
      group: 'Correct Score',
      prob: sp.predicted.prob,
      modelProb,
    }];
  },

  build(V) {
    const sp = V._score;
    const w = V._scoreWitness || {};
    const gates = [];
    const items = [];
    const resName = { H: `${V.names.home} win`, D: 'draw', A: `${V.names.away} win` };

    gates.push(G('RESULT', 'Clear result call', sp.outcomeProb >= 0.52, `${resName[sp.outcome]} ${pct(sp.outcomeProb, 1)}`, '≥ 52%', { rule: 'CS2' }));
    gates.push(G('GOALS', 'Clear goals band', sp.over25Prob >= 0.56, `${sp.over25 ? 'Over' : 'Under'} 2.5 ${pct(sp.over25Prob, 1)}`, '≥ 56%', { rule: 'CS3' }));
    gates.push(G('CONC', 'Probability concentrated on few scores', sp.concentration >= 0.33, `top three ${pct(sp.concentration, 1)}`, '≥ 33%', { rule: 'CS4' }));
    gates.push(G('WIT', 'Independent model predicts the same result', w.modelOutcome == null ? null : w.modelOutcome === sp.outcome,
      w.modelOutcome == null ? 'no independent model' : `model-only: ${resName[w.modelOutcome]}`, 'same result', { rule: 'CS5 / Rule 13' }));

    items.push(C('TEMPO', 'Low expected total (scores are more predictable)', ramp(V.lam.total, 3.1, 2.2), f2(V.lam.total), ''));
    items.push(C('CLEAR', 'Result margin over the next outcome', ramp(sp.outcomeProb - Math.max(...['home', 'draw', 'away'].map((k) => V.pr[k]).filter((p) => Math.abs(p - sp.outcomeProb) > 1e-9)), 0.05, 0.35),
      pct(sp.outcomeProb, 0), ''));
    items.push(C('TOP2', 'Predicted score is one of the two likeliest', sp.top.slice(0, 2).some((t) => t.score === sp.predicted.score) ? 1 : 0.2,
      sp.top.slice(0, 3).map((t) => `${t.score} ${pct(t.prob, 1)}`).join(', '), ''));
    items.push(C('SAMPLE', 'Strong evidence sample', V.sides.home.n >= 8 && V.sides.away.n >= 8 ? 1 : V.sides.home.n >= 5 && V.sides.away.n >= 5 ? 0.6 : 0.2, `${V.sides.home.n} / ${V.sides.away.n} games`, ''));
    items.push(C('MARKET', 'Bookmaker price behind the expected goals', V.coverage.market ? 1 : 0.3, V.coverage.market ? `${V.coverage.books} book(s)` : 'model only', ''));

    const lose = 1 - sp.predicted.prob;
    return {
      gates,
      checklist: items,
      support: [
        `Predicted final score ${sp.predicted.score} (${pct(sp.predicted.prob, 1)}, fair odds ${f2(1 / sp.predicted.prob)}). Most likely single score: ${sp.mostLikely.score} (${pct(sp.mostLikely.prob, 1)}).`,
        `Expected goals ${f2(sp.expected.home)} - ${f2(sp.expected.away)}; half-time ${sp.halfTime.score}.`,
        `Score band covering ${pct(sp.band.prob, 0)}: ${sp.band.scores.join(', ')}.`,
      ],
      failure: [`An exact score misses ${pct(lose, 0)} of the time even when every rule passes — one goal anywhere changes it.`],
      flags: ['Correct score is a single at a quarter stake. Never in an accumulator (Rule 34 applies a fortiori).'],
    };
  },
};

module.exports = { correctScore, M };
