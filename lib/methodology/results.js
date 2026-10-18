'use strict';

/**
 * methodology/results.js — result and handicap methodologies.
 *
 *   homeWin    Home Win                       (v2.0 Rules 2, 20, 21-23 + v3.0 favourite rules)
 *   draw       Draw                           (Rule 21 "draw machine" test, generalised)
 *   awayWin    Away Win
 *   dogPlus    Underdog / weak-team handicap +  (+0.5, +1, +1.5)
 *   favMinus   Favourite handicap −           (−1, −1.5)
 *
 * The originals only cover goals markets, and v2.0 Rule 23 actively tells the
 * user to prefer goals markets because result markets have three outcomes. These
 * specs therefore carry HIGHER floors and an extra independent witness (Elo)
 * than the goals specs — that is Rule 23 applied, not ignored.
 *
 * Elo is optional: when the feed is unreachable the Elo gate is waived (and the
 * waiver is shown), because "no data" must never be mistaken for "data against".
 */

const { CFG, G, C, clamp01, pct, f2, lossCase } = require('./core');

const rate = (S, k) => (S && S.n ? S[k] / S.n : null);
const avg = (...xs) => {
  const v = xs.filter((x) => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
const ramp = (x, lo, hi) => (x == null || !Number.isFinite(x) ? null : clamp01((x - lo) / (hi - lo)));
const nm = (V, side) => V.names[side];
const other = (side) => (side === 'home' ? 'away' : 'home');
const rotated = (V, side) => V.rest[side] != null && V.rest[side] < CFG.rotationDays;
const absences = (V, side) => V.positions[side].absences;
const ppg = (S) => (S && S.n ? (S.wins * 3 + S.draws) / S.n : null);
const winStreak = (S) => {
  let k = 0;
  for (const ch of S.form || '') {
    if (ch === 'W') k++;
    else break;
  }
  return k;
};
const winlessStreak = (S) => {
  let k = 0;
  for (const ch of S.form || '') {
    if (ch !== 'W') k++;
    else break;
  }
  return k;
};
const drawsOf = (S) => (S && S.n ? S.draws / S.n : null);

/** Elo gate, waived when the feed is unavailable. `side` = the side the pick needs to be stronger. */
function eloGate(V, side, minExpectancy) {
  if (!V.elo) return G('ELO', 'Independent Elo read agrees (waived: feed unavailable)', true, 'not available', '—', { rule: 'Rule 13', note: 'Waived, not passed: one fewer independent witness.' });
  const exp = side === 'home' ? V.elo.expectancy : 1 - V.elo.expectancy;
  return G('ELO', 'Independent Elo read agrees', exp >= minExpectancy,
    `${nm(V, side)} expectancy ${pct(exp)} (Elo ${V.elo.home} v ${V.elo.away}, home adv. included)`, `≥ ${pct(minExpectancy)}`, { rule: 'Rule 13' });
}

/** Rule 22 — don't fight the favourite without evidence. */
function notFightingFav(V, side) {
  const against = V.fav.side && V.fav.side !== side;
  return G('FIGHT', "Not fighting the bookmaker's favourite", !against,
    against ? `book favours ${nm(V, V.fav.side)} @ ${f2(V.fav.price)}` : V.fav.side ? `with the favourite (${f2(V.fav.price)})` : 'no clear favourite', 'back the favourite, or no clear favourite', { rule: 'Rule 22' });
}

/** v5: share of a side's expected goal involvements unavailable (FPL), or null. */
const attLoss = (V, side) => (V.positions[side].attackLoss != null ? V.positions[side].attackLoss : null);
const newsSrc = (V) => (V.positions.home.source === 'fpl' ? 'FPL availability' : 'headlines');

/** Rules 15 / 18 / 19 on one side. v5: FPL availability (Premier League) when present. */
function teamNewsGate(V, side) {
  const rot = rotated(V, side);
  const abs = absences(V, side);
  const dep = V.positions[side].departures;
  const veto = V.news && V.news[side] && V.news[side].level === 'veto';
  const al = attLoss(V, side);
  const gutted = al != null && al >= 0.3;
  const keeper = V.fpl && V.fpl[side] && V.fpl[side].gkOut;
  return G('NEWS', `${nm(V, side)}: no rotation, mass absences or key departure`, !rot && abs < 3 && dep === 0 && !veto && !gutted && !keeper,
    rot ? `played ${V.rest[side] != null ? V.rest[side].toFixed(1) : '?'} days ago`
      : gutted ? `${pct(al)} of attacking output unavailable` : keeper ? 'first-choice keeper out'
        : abs >= 3 ? `${abs} absences` : dep ? 'key departure reported' : `clean (${newsSrc(V)})`,
    'clean', { rule: 'Rules 15, 18, 19' });
}

/**
 * Rule 20 — a record streak is a reason to look harder, not a reason to bet.
 *
 * IMPROVEMENT over the original: v2.0 says streaks "WILL break" and to avoid
 * them outright. Streaks are not predictive of a reversal, and that wording
 * would disqualify exactly the dominant sides these markets are about. What the
 * rule really guards against is paying for a reputation. So the gate fails only
 * when a 5+ streak is NOT backed by the underlying numbers: the model must rate
 * the side comfortably, or the independent Elo read must agree.
 */
function streakGate(V, side, minEloGap, minModel = 0.62) {
  const S = V.sides[side];
  const k = winStreak(S);
  const pWin = side === 'home' ? V.pr.home : V.pr.away;
  const eloOk = V.elo && Math.abs(V.elo.diff) >= minEloGap && V.elo.favourite === side;
  const backed = pWin >= minModel || eloOk;
  return G('STREAK', 'Any win streak is backed by the numbers', !(k >= 5 && !backed),
    `${k} straight wins; model ${pct(pWin)}${eloOk ? ', Elo gap supports' : ''}`,
    `< 5, or model ≥ ${pct(minModel)} / Elo gap ≥ ${minEloGap}`, { rule: 'Rule 20' });
}

// ====================================================================== WIN (home / away)

function winSpec(side) {
  const isHome = side === 'home';
  const opp = other(side);
  return {
    id: isHome ? 'homeWin' : 'awayWin',
    name: isHome ? 'Home Win' : 'Away Win',
    version: '5.0',
    family: 'Result',
    floor: isHome ? 0.55 : 0.5,
    minRatio: 1.1,
    ceiling: 0.8,
    minSample: 6,

    candidates(V) {
      const key = isHome ? '1' : '2';
      const out = [{ key, label: `${nm(V, side)} to win`, group: '1X2' }];
      // Draw-no-bet is a legitimate safer expression (Rule 11): same methodology, stakes returned on a draw.
      const dnb = isHome ? 'DNB_H' : 'DNB_A';
      if (V.markets[dnb]) out.push({ key: dnb, label: `${nm(V, side)} (Draw No Bet)`, group: 'Draw No Bet', floor: isHome ? 0.65 : 0.62 });
      return out;
    },

    build(V, cand) {
      const S = V.sides[side];
      const O = V.sides[opp];
      const gates = [];
      const items = [];
      const pWin = isHome ? V.pr.home : V.pr.away;

      gates.push(notFightingFav(V, side));
      gates.push(eloGate(V, side, isHome ? 0.55 : 0.5));
      gates.push(teamNewsGate(V, side));
      gates.push(streakGate(V, side, 120));

      // Rule 2 — underdog attack test. If the underdog scores freely the favourite's win is exposed to a draw.
      const oppScores = O.n ? 1 - O.fts / O.n : null;
      gates.push(G('DOGATK', 'Opponent cannot keep scoring through the game', oppScores == null ? null : !(oppScores >= 0.85 && (O.gfpg || 0) >= 1.6 && V.lam[opp] >= 1.4),
        `${nm(V, opp)} scored in ${O.n - O.fts}/${O.n}, ${f2(O.gfpg)}/game, λ ${f2(V.lam[opp])}`, 'not (scores freely AND λ ≥ 1.4)', { rule: 'Rule 2' }));

      // Venue form: a home side must not be a poor home side, an away side not a poor travelling side.
      const venue = isHome ? S.atHome : S.away;
      gates.push(G('VENUE', `${nm(V, side)} is not poor ${isHome ? 'at home' : 'away'}`, venue.n < 4 ? null : venue.wins / venue.n >= (isHome ? 0.4 : 0.3),
        `${venue.wins}W-${venue.draws}D-${venue.losses}L in ${venue.n}`, `wins ≥ ${isHome ? '40%' : '30%'}`, { rule: 'Rule 21', note: 'A side that does not win in its own venue type does not carry a win pick.' }));

      // Rule 23 — result markets are binary-hostile; the model must lead the draw by a wide margin.
      gates.push(G('LEAD', 'Win probability well clear of the draw', pWin >= V.pr.draw * 1.9, `${pct(pWin, 1)} v draw ${pct(V.pr.draw, 1)}`, 'win ≥ 1.9 × draw', { rule: 'Rule 23' }));

      items.push(C('PPG', 'Points per game', ramp(ppg(S), 1.1, 2.1), `${f2(ppg(S))} (${S.form || '—'})`, ''));
      items.push(C('VENUE', 'Venue record', venue.n ? ramp(venue.wins / venue.n, 0.3, 0.75) : null, `${venue.wins}-${venue.draws}-${venue.losses}`, ''));
      // Goal-difference-per-game gap: a plain, model-independent measure of who has been better (Rule 13).
      const gd = (X) => (X.n ? (X.gf - X.ga) / X.n : null);
      items.push(C('GDIFF', 'Goal-difference gap', gd(S) != null && gd(O) != null ? ramp(gd(S) - gd(O), 0.1, 0.9) : null, `${f2(gd(S))} v ${f2(gd(O))} per game`, 'recent results'));
      items.push(C('XG', 'xG advantage', V.xg[side] && V.xg[opp] ? ramp(V.xg[side] - V.xg[opp], 0, 0.7) : null, V.xg[side] && V.xg[opp] ? `${f2(V.xg[side])} v ${f2(V.xg[opp])}` : 'no xG', ''));
      items.push(C('ELO', 'Elo advantage', V.elo ? ramp(isHome ? V.elo.diff : -V.elo.diff, 0, 200) : null, V.elo ? `diff ${isHome ? V.elo.diff : -V.elo.diff}` : 'no Elo', 'independent witness'));
      items.push(C('H2H', 'Head-to-head record', V.h2h && V.h2h.n >= 3 ? ramp(isHome ? V.h2h.homeWin : V.h2h.awayWin, 0.25, 0.6) : null, V.h2h ? `${pct(isHome ? V.h2h.homeWin : V.h2h.awayWin)} of ${V.h2h.n}` : 'no H2H', ''));
      items.push(C('CS', 'Clean-sheet habit (limits the draw)', ramp(rate(S, 'cs'), 0.15, 0.45), pct(rate(S, 'cs')), ''));
      items.push(C('REST', 'Rest advantage', V.rest[side] != null && V.rest[opp] != null && Math.abs(V.rest[side] - V.rest[opp]) >= 1 ? ramp(V.rest[side] - V.rest[opp], -2, 2) : null, V.rest[side] != null ? `${V.rest[side].toFixed(0)}d v ${V.rest[opp] != null ? V.rest[opp].toFixed(0) : '?'}d` : 'unknown', ''));
      items.push(C('NEWSADV', 'Availability advantage', attLoss(V, opp) != null && attLoss(V, side) != null
        ? ramp(attLoss(V, opp) - attLoss(V, side), -0.15, 0.15)
        : absences(V, opp) + absences(V, side) > 0 ? ramp(absences(V, opp) - absences(V, side), -2, 2) : null,
        attLoss(V, opp) != null ? `xGI unavailable ${pct(attLoss(V, side))} v ${pct(attLoss(V, opp))}` : `${absences(V, opp)} v ${absences(V, side)} absences`, newsSrc(V)));

      const loseFn = isHome ? (a, b) => a <= b : (a, b) => b <= a;
      return {
        gates,
        checklist: items,
        support: [`${nm(V, side)} win ${pct(pWin, 1)} (fair ${f2(1 / pWin)}); λ ${f2(V.lam[side])} v ${f2(V.lam[opp])}.`],
        failure: [
          lossCase(V, loseFn, `${nm(V, side)} to win`),
          V.pr.draw >= 0.26 ? `The draw alone is ${pct(V.pr.draw, 1)} — consider Draw No Bet (Rule 11).` : '',
        ].filter(Boolean),
      };
    },
  };
}

const homeWin = winSpec('home');
const awayWin = winSpec('away');

// ====================================================================== DRAW

const draw = {
  id: 'draw',
  name: 'Draw',
  version: '5.0',
  family: 'Result',
  floor: 0.29,
  minRatio: 1.15,
  ceiling: 0.4,
  minSample: 6,
  // v4 backtest (6,289 fixtures): the v4 Draw profile drew 19.7% of the time while the
  // model claimed ~31% — dishonest probabilities, so it was paper-only.
  // v5 backtest (46,075 fixtures, held-out 2023-26): qualifying draws hit 31.4% against a
  // stated 32.2% (26.1% base rate). The probability is now honest, so Draw is a real
  // prediction again — but never the fixture headline, and at a half stake: a 31% event
  // still loses about two times in three.
  paperOnly: false,
  headline: false,
  stake: 'half unit',
  priceNote: 'Draws are only worth it at your bookmaker\'s price ≥ 1.03 × fair odds.',

  candidates() {
    return [{ key: 'X', label: 'Draw', group: '1X2' }];
  },

  build(V) {
    const H = V.sides.home;
    const A = V.sides.away;
    const gates = [];
    const items = [];
    const dh = drawsOf(H);
    const da = drawsOf(A);

    // Rule 21 — the Draw Machine Test.
    gates.push(G('MACHINE', 'Both sides draw often (Draw Machine Test)', dh == null || da == null ? null : dh >= 0.25 && da >= 0.25,
      `${H.draws}/${H.n} and ${A.draws}/${A.n} draws`, '≥ 25% each', { rule: 'Rule 21', note: 'Sample of 5+ games needed; 4 in 5 is not enough.' }));
    gates.push(G('BAL', 'Genuinely balanced, no clear favourite', V.fav.gap <= 0.12 && !V.fav.heavy,
      `home/away gap ${pct(V.fav.gap, 1)}`, '≤ 12 points, no heavy favourite', { rule: 'Rule 22' }));
    gates.push(G('LOW', 'Low expected total', V.lam.total <= 2.6, f2(V.lam.total), '≤ 2.60', { rule: 'Rule 12' }));
    // Rule 21 sub-test: draws at fortress vs struggling away are different animals. Check the venue split.
    const hDrawVenue = H.atHome.n ? H.atHome.draws / H.atHome.n : null;
    const aDrawVenue = A.away.n ? A.away.draws / A.away.n : null;
    gates.push(G('VENUE', 'Draws hold at the relevant venues', hDrawVenue == null || aDrawVenue == null ? null : (hDrawVenue + aDrawVenue) / 2 >= 0.22,
      `home draws at home ${pct(hDrawVenue)}, away draws away ${pct(aDrawVenue)}`, 'average ≥ 22%', { rule: 'Rule 21' }));
    gates.push(G('SCORE', 'Neither side is a scoring machine', !(V.lam.home >= 1.9 || V.lam.away >= 1.9), `λ ${f2(V.lam.home)} / ${f2(V.lam.away)}`, 'both < 1.90', { rule: 'Rule 12' }));
    const must = V.standings.home && V.standings.away ? Math.abs((V.standings.home.rank || 0) - (V.standings.away.rank || 0)) : null;
    gates.push(G('GAP', 'Table positions are close', must == null ? null : must <= 8, must == null ? 'unknown' : `${must} places apart`, '≤ 8', { rule: 'Rule 9' }));

    items.push(C('DRAWS', 'Draw frequency', ramp(avg(dh, da), 0.2, 0.4), `${pct(dh)} / ${pct(da)}`, ''));
    items.push(C('BALANCE', 'Balance', ramp(0.2 - V.fav.gap, 0, 0.2), pct(V.fav.gap, 1), ''));
    items.push(C('H2H', 'Head-to-head draw rate', V.h2h && V.h2h.n >= 3 ? ramp(V.h2h.draw, 0.2, 0.45) : null, V.h2h ? `${pct(V.h2h.draw)} of ${V.h2h.n}` : 'no H2H', ''));
    items.push(C('LOW', 'Low scoring', ramp(V.lam.total, 2.7, 2.1), f2(V.lam.total), ''));
    items.push(C('LEAGUE', 'League draw rate', V.league.draw == null ? null : ramp(V.league.draw, 0.22, 0.32), V.league.draw == null ? 'unknown' : pct(V.league.draw), ''));
    items.push(C('P11', '0-0 / 1-1 mass', ramp(V.pr.p00 + V.pr.p11, 0.14, 0.24), pct(V.pr.p00 + V.pr.p11, 1), ''));
    items.push(C('ELO', 'Elo says even', V.elo ? ramp(120 - Math.abs(V.elo.diff), 0, 120) : null, V.elo ? `diff ${V.elo.diff}` : 'no Elo', 'independent witness'));
    items.push(C('NEWS', 'No rotation either side', !rotated(V, 'home') && !rotated(V, 'away') ? 1 : 0.2, '', ''));

    return {
      gates,
      checklist: items,
      support: [`Draw ${pct(V.pr.draw, 1)} (fair ${f2(1 / V.pr.draw)}); 0-0 ${pct(V.pr.p00, 1)}, 1-1 ${pct(V.pr.p11, 1)}.`],
      failure: [lossCase(V, (a, b) => a !== b, 'Draw'), 'A draw is a three-way outcome: it needs both sides to cancel out, and one early goal usually ends that.'],
      flags: ['A draw pick loses about two times in three even when every rule passes. Half stake, single only.'],
    };
  },
};

// ====================================================================== UNDERDOG HANDICAP +

const DOG_LINES = [
  { line: 0.5, floor: 0.55, name: '+0.5' },
  { line: 1, floor: 0.66, name: '+1' },
  { line: 1.5, floor: 0.74, name: '+1.5' },
];

/** AH market key for a side taking a handicap (`line` is from THAT side's perspective). */
function ahKey(side, line) {
  return side === 'home' ? `AH_H_${line}` : `AH_A_${-line}`;
}

const dogPlus = {
  id: 'dogPlus',
  name: 'Underdog Handicap (+)',
  version: '5.0',
  family: 'Handicap',
  floor: 0.6,
  minRatio: 1.08,
  ceiling: 0.88,
  minSample: 6,

  candidates(V) {
    // The underdog is the side the book/model rates lower; with no clear favourite the model's weaker side.
    const dog = V.fav.dog || (V.pr.home <= V.pr.away ? 'home' : 'away');
    const out = [];
    for (const t of DOG_LINES) {
      const key = ahKey(dog, t.line);
      if (!V.markets[key]) continue;
      out.push({ key, dog, line: t.line, floor: t.floor, label: `${nm(V, dog)} +${t.line} (AH)`, group: 'Asian Handicap' });
    }
    return out;
  },

  build(V, cand) {
    const dog = cand.dog;
    const fav = other(dog);
    const D = V.sides[dog];
    const F = V.sides[fav];
    const line = cand.line;
    const gates = [];
    const items = [];
    const ah = V.ah(dog, line);
    // P(favourite wins by MORE than the handicap) = P(dog loses the bet).
    const blowout = V.mass((a, b) => (fav === 'home' ? a - b : b - a) > line);

    // Rule 2 (reversed): the dog must not leak heavy defeats.
    const heavyLoss = D.n ? (line >= 1.5 ? D.lostBy3p / D.n : D.lostBy2p / D.n) : null;
    gates.push(G('LOSSES', `${nm(V, dog)} avoids heavy defeats`, heavyLoss == null ? null : heavyLoss <= (line >= 1.5 ? 0.12 : line >= 1 ? 0.25 : 0.3),
      `lost by ${line >= 1.5 ? '3+' : '2+'} in ${line >= 1.5 ? D.lostBy3p : D.lostBy2p}/${D.n}`, line >= 1.5 ? '≤ 12%' : line >= 1 ? '≤ 25%' : '≤ 30%', { rule: 'Rule 2' }));

    // The favourite must not be a margin machine (Rule 19 reversed: "does it win big?").
    const margin = F.n ? F.wonBy2p / F.n : null;
    gates.push(G('MARGIN', `${nm(V, fav)} is not a big-margin side`, margin == null ? null : margin <= (line >= 1.5 ? 0.3 : 0.4),
      `won by 2+ in ${F.wonBy2p}/${F.n}`, line >= 1.5 ? '≤ 30%' : '≤ 40%', { rule: 'Rule 19' }));

    gates.push(G('BLOW', 'Model: heavy-defeat chance is small', blowout <= (line >= 1.5 ? 0.18 : line >= 1 ? 0.26 : 0.45),
      `P(${nm(V, fav)} wins by > ${line}) ${pct(blowout, 1)}`, line >= 1.5 ? '≤ 18%' : line >= 1 ? '≤ 26%' : '≤ 45%', { rule: 'Rule 14' }));

    // The dog must be able to score — a side that cannot score cannot draw or steal.
    gates.push(G('SCORES', `${nm(V, dog)} can score`, D.n ? D.fts / D.n <= 0.4 : null, `blanked ${D.fts}/${D.n}`, '≤ 40% of games', { rule: 'Rule 4' }));

    // News: the dog's defence must be intact; a heavy underdog with defensive absences is a blowout candidate.
    const dDef = V.positions[dog].def + V.positions[dog].gk;
    gates.push(G('NEWS', `${nm(V, dog)}: defence intact, no rotation or mass absences`, dDef === 0 && !rotated(V, dog) && absences(V, dog) < 3,
      dDef ? `${dDef} defensive absences` : rotated(V, dog) ? 'rotation risk' : absences(V, dog) >= 3 ? `${absences(V, dog)} absences` : 'clean', 'clean', { rule: 'Rules 15, 18' }));

    // Dog must not be in freefall (Rule 20 reversed: streaks break, but a long losing run with a leaky defence does not).
    const lossRun = winlessStreak(D);
    gates.push(G('FALL', `${nm(V, dog)} is not in freefall`, !(lossRun >= 6 && (D.gapg || 0) >= 2), `${lossRun} without a win, ${f2(D.gapg)} conceded/game`, 'not 6+ winless with 2.0+ conceded', { rule: 'Rule 20' }));

    items.push(C('HANDICAP', 'Handicap covers the typical margin', ramp(line - (F.n ? (F.gf - F.ga) / F.n : 0.8), -0.4, 0.6), `fav avg margin ${f2(F.n ? (F.gf - F.ga) / F.n : null)}`, ''));
    items.push(C('DOGDEF', "Underdog's defence holds", ramp(D.gapg, 2.0, 1.1), `${f2(D.gapg)}/game`, ''));
    items.push(C('DOGLOSS', 'Narrow-defeat profile', D.n ? ramp(1 - D.lostBy2p / D.n, 0.7, 0.95) : null, `${D.lostBy2p}/${D.n} heavy losses`, ''));
    items.push(C('FAVATK', 'Favourite attack not elite', ramp(F.gfpg, 2.4, 1.4), `${f2(F.gfpg)}/game`, ''));
    items.push(C('TEMPO', 'Low expected total (caps margins)', ramp(V.lam.total, 3.1, 2.3), f2(V.lam.total), ''));
    items.push(C('ELO', 'Elo gap is modest', V.elo ? ramp(260 - Math.abs(V.elo.diff), 0, 220) : null, V.elo ? `diff ${V.elo.diff}` : 'no Elo', 'independent witness'));
    items.push(C('LOWBLOCK', 'Low-block tendency', D.n ? ramp(D.u25 / D.n, 0.4, 0.75) : null, `${D.u25}/${D.n} Under`, 'Rule 20 (Under version)'));
    items.push(C('FAVCS', "Favourite doesn't keep many clean sheets", ramp(1 - (rate(F, 'cs') || 0), 0.5, 0.8), pct(rate(F, 'cs')), ''));
    items.push(C('H2H', 'H2H margins', null, 'n/a', ''));

    return {
      gates,
      checklist: items,
      support: [`${cand.label}: covers ${pct(ah.win + ah.push, 1)} of outcomes (win ${pct(ah.win, 1)}, push ${pct(ah.push, 1)}).`],
      failure: [`Loses only when ${nm(V, fav)} wins by ${line === 0.5 ? '1+' : `more than ${line}`}: ${pct(blowout, 1)}.`,
        `Failure case: ${nm(V, fav)} scores early, ${nm(V, dog)} must open up and concedes late.`],
      flags: line === 1 ? ['+1 pushes (stake returned) if the favourite wins by exactly one.'] : [],
    };
  },
};

// ====================================================================== FAVOURITE HANDICAP −

const FAV_LINES = [
  { line: 1, floor: 0.5, name: '-1' },
  { line: 1.5, floor: 0.42, name: '-1.5' },
];

const favMinus = {
  id: 'favMinus',
  name: 'Favourite Handicap (−)',
  version: '5.0',
  family: 'Handicap',
  floor: 0.45,
  minRatio: 1.1,
  ceiling: 0.75,
  minSample: 6,

  candidates(V) {
    if (!V.fav.side) return [];
    const fav = V.fav.side;
    const out = [];
    for (const t of FAV_LINES) {
      const key = ahKey(fav, -t.line);
      if (!V.markets[key]) continue;
      out.push({ key, fav, line: t.line, floor: t.floor, label: `${nm(V, fav)} -${t.line} (AH)`, group: 'Asian Handicap' });
    }
    return out;
  },

  notApplicable: () => 'no clear favourite — a minus handicap needs a side that dominates',

  build(V, cand) {
    const fav = cand.fav;
    const dog = other(fav);
    const F = V.sides[fav];
    const D = V.sides[dog];
    const line = cand.line;
    const gates = [];
    const items = [];
    const ah = V.ah(fav, -line);
    const win2 = V.mass((a, b) => (fav === 'home' ? a - b : b - a) >= 2);

    // The favourite must be an actual margin side — the original rules say "check how it wins".
    const margin = F.n ? F.wonBy2p / F.n : null;
    gates.push(G('MARGIN', `${nm(V, fav)} wins by 2+ regularly`, margin == null ? null : margin >= (line >= 1.5 ? 0.4 : 0.3),
      `won by 2+ in ${F.wonBy2p}/${F.n}`, line >= 1.5 ? '≥ 40%' : '≥ 30%', { rule: 'Rule 19' }));

    gates.push(G('SCORE2', `${nm(V, fav)} scores 2+ regularly`, F.n ? F.gf2p / F.n >= 0.55 : null, `2+ in ${F.gf2p}/${F.n}`, '≥ 55%', { rule: 'Rule 4' }));

    // The underdog must concede, and must not be a low block that caps the margin (Rule 26).
    const lb = D.n >= CFG.minSample && D.u25 / D.n >= 0.7 && D.fts / D.n >= 0.3;
    gates.push(G('DOGLEAK', `${nm(V, dog)} concedes and is not a low block`, D.n ? D.gapg >= 1.3 && !lb : null,
      `${f2(D.gapg)} conceded/game${lb ? '; low-block profile' : ''}`, '≥ 1.3/game and not a low block', { rule: 'Rule 26' }));

    gates.push(G('PUSH', 'Model: a 2+ goal win is realistic', win2 >= (line >= 1.5 ? 0.3 : 0.3),
      `P(win by 2+) ${pct(win2, 1)}`, '≥ 30%', { rule: 'Rule 14' }));

    gates.push(eloGate(V, fav, 0.68));
    gates.push(teamNewsGate(V, fav));
    // Rotation of an obvious favourite before/after a bigger game is the classic -1 killer.
    gates.push(G('ATT', `${nm(V, fav)} attack is intact`, attLoss(V, fav) != null ? attLoss(V, fav) < 0.2 : V.positions[fav].att < 2,
      attLoss(V, fav) != null ? `${pct(attLoss(V, fav))} of attacking output unavailable (FPL)` : `${V.positions[fav].att} attackers reported out`, attLoss(V, fav) != null ? '< 20%' : '< 2', { rule: 'Rule 15' }));
    gates.push(streakGate(V, fav, 150));

    items.push(C('GF', 'Scoring rate', ramp(F.gfpg, 1.4, 2.3), `${f2(F.gfpg)}/game`, ''));
    items.push(C('MARGINS', 'Margin habit', ramp(margin, 0.2, 0.55), `${F.wonBy2p}/${F.n}`, ''));
    items.push(C('DOGGA', "Underdog's defence leaks", ramp(D.gapg, 1.2, 2.0), `${f2(D.gapg)}/game`, ''));
    items.push(C('DOGGF', "Underdog can't reply", ramp(1.4 - (D.gfpg || 0), 0, 0.8), `${f2(D.gfpg)}/game`, ''));
    items.push(C('LAM', 'Expected-goal gap', ramp(V.lam[fav] - V.lam[dog], 0.7, 1.6), `${f2(V.lam[fav])} v ${f2(V.lam[dog])}`, ''));
    items.push(C('XG', 'xG gap', V.xg[fav] && V.xg[dog] ? ramp(V.xg[fav] - V.xg[dog], 0.3, 1.0) : null, V.xg[fav] && V.xg[dog] ? `${f2(V.xg[fav])} v ${f2(V.xg[dog])}` : 'no xG', ''));
    items.push(C('ELO', 'Elo gap', V.elo ? ramp(fav === 'home' ? V.elo.diff : -V.elo.diff, 80, 320) : null, V.elo ? `diff ${fav === 'home' ? V.elo.diff : -V.elo.diff}` : 'no Elo', 'independent witness'));
    items.push(C('PRICE', 'Favourite is a genuine favourite', ramp(1.9 - (V.fav.price || 2), -0.2, 0.6), f2(V.fav.price), ''));
    items.push(C('DOGNEWS', 'Underdog absences', absences(V, dog) > 0 ? ramp(absences(V, dog), 0, 2) : null, `${absences(V, dog)}`, 'bonus only'));

    return {
      gates,
      checklist: items,
      support: [`${cand.label}: covers ${pct(ah.win, 1)} outright${ah.push ? `, ${pct(ah.push, 1)} push` : ''}.`],
      failure: [`Loses if ${nm(V, fav)} wins by one, draws or loses: ${pct(1 - ah.win - ah.push, 1)}.`,
        `Failure case: ${nm(V, fav)} scores once, ${nm(V, dog)} sits deep and the game is managed to 1-0.`],
      flags: line === 1 ? ['−1 pushes (stake returned) on an exact one-goal win.'] : [],
    };
  },
};

// ====================================================================== DOUBLE CHANCE (v5, new)

/**
 * Double Chance — the popular "safety" market, held to Rule 11: it is NOT automatically
 * the safest choice, and Rule 7: the price must still be worth taking. In practice this
 * only qualifies in genuinely competitive games, because a clear favourite's 1X / X2 is
 * priced below 1.25.
 */
const doubleChance = {
  id: 'doubleChance',
  name: 'Double Chance',
  version: '5.0',
  family: 'Result',
  floor: 0.72,
  minRatio: 1.05,
  ceiling: 0.86,
  minSample: 6,
  minPrice: 1.25,

  candidates(V) {
    const out = [];
    for (const [key, side, label] of [['1X', 'home', `${nm(V, 'home')} or Draw`], ['X2', 'away', `Draw or ${nm(V, 'away')}`]]) {
      if (!V.markets[key]) continue;
      out.push({ key, side, label, group: 'Double Chance' });
    }
    return out;
  },

  build(V, cand) {
    const side = cand.side;
    const opp = other(side);
    const S = V.sides[side];
    const O = V.sides[opp];
    const gates = [];
    const items = [];
    const p = V.markets[cand.key].prob;
    const pLose = side === 'home' ? V.pr.away : V.pr.home;

    // Rule 7: a DC below 1.25 is not a bet.
    gates.push(G('PRICE', 'Worth taking (fair odds ≥ 1.25)', 1 / p >= 1.25, `fair ${f2(1 / p)}`, '≥ 1.25', { rule: 'Rule 7 / Rule 11' }));
    // Not covering a side the book rates as a clear underdog
    gates.push(G('SIDE', `${nm(V, side)} is not a clear underdog`, !(V.fav.side === opp && V.fav.gap >= 0.2),
      V.fav.side ? `${nm(V, V.fav.side)} favoured by ${pct(V.fav.gap)}` : 'balanced', 'gap < 20 pts against', { rule: 'Rule 22' }));
    gates.push(teamNewsGate(V, side));
    gates.push(eloGate(V, side, 0.42));
    // the opponent must not be a winning machine
    gates.push(G('OPPWIN', `${nm(V, opp)} is not winning at will`, O.n ? O.wins / O.n <= 0.65 : null, `${O.wins}/${O.n} wins`, '≤ 65%', { rule: 'Rule 2' }));
    // Rule 20: a losing run with a leaky defence is not a draw-or-win candidate
    gates.push(G('FORM', `${nm(V, side)} is not in freefall`, !(S.losses >= 0.6 * S.n && (S.gapg || 0) >= 1.8), `${S.form || '—'}, ${f2(S.gapg)} conceded/game`, 'not 60%+ losses with 1.8+ conceded', { rule: 'Rule 20' }));

    items.push(C('UNBEATEN', 'Unbeaten rate', ramp(S.n ? (S.wins + S.draws) / S.n : null, 0.5, 0.8), `${S.wins + S.draws}/${S.n} unbeaten`, ''));
    const venue = side === 'home' ? S.atHome : S.away;
    items.push(C('VENUE', 'Venue record', venue.n >= 3 ? ramp((venue.wins + venue.draws) / venue.n, 0.45, 0.8) : null, `${venue.wins}-${venue.draws}-${venue.losses}`, ''));
    items.push(C('DRAWS', 'Draw-live game', ramp(V.pr.draw, 0.24, 0.31), `P(draw) ${pct(V.pr.draw)}`, ''));
    items.push(C('DEF', 'Concedes little', ramp(S.gapg, 1.6, 0.9), `${f2(S.gapg)}/game`, ''));
    items.push(C('OPPATK', 'Opponent attack is modest', ramp(O.gfpg, 2.0, 1.1), `${f2(O.gfpg)}/game`, ''));
    items.push(C('H2H', 'Head-to-head avoid-defeat rate', V.h2h && V.h2h.n >= 3 ? ramp(side === 'home' ? 1 - V.h2h.awayWin : 1 - V.h2h.homeWin, 0.5, 0.85) : null,
      V.h2h ? `${pct(side === 'home' ? 1 - V.h2h.awayWin : 1 - V.h2h.homeWin)} of ${V.h2h.n}` : 'no H2H', ''));
    items.push(C('ELO', 'Elo gap is small or favourable', V.elo ? ramp((side === 'home' ? V.elo.diff : -V.elo.diff), -150, 50) : null, V.elo ? `diff ${side === 'home' ? V.elo.diff : -V.elo.diff}` : 'no Elo', 'independent witness'));

    return {
      gates,
      checklist: items,
      support: [`${cand.label}: ${pct(p, 1)} (fair ${f2(1 / p)}). Loses only if ${nm(V, opp)} wins: ${pct(pLose, 1)}.`],
      failure: [lossCase(V, side === 'home' ? (a, b) => a < b : (a, b) => a > b, cand.label), 'Rule 11: compare with Draw No Bet and the Asian +0.5 line before taking a Double Chance.'],
    };
  },
};

module.exports = { homeWin, awayWin, draw, dogPlus, favMinus, doubleChance, ahKey };
