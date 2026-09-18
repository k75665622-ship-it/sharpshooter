'use strict';

/**
 * signals.js — patterns, hidden signals, trap detection and market scoring.
 *
 * This is the "sharpshooter" stage. It runs AFTER the model has produced
 * probabilities, and its job is to decide which of those probabilities are
 * actually trustworthy — and which are bookmaker bait.
 */

const M = require('./model');
const news = require('./news');

// ============================================================ market metadata

/**
 * Minimum probability a market must clear to even be considered for banker.
 * These are per-market because a 55% home win is a strong call, while a
 * 55% "over 2.5" is merely average.
 */
const BANKER_FLOOR = {
  '1X2': 0.56,
  'Double Chance': 0.78,
  BTTS: 0.58,
  Totals: 0.62,
  'Asian Handicap': 0.62,
  'Draw No Bet': 0.68,
  'Team Totals': 0.63,
  'Half Time': 0.62,
  'Correct Score': 0.13,
};

/**
 * Markets a banker may be elected from.
 *
 * Deliberately curated. Extreme handicaps (+2 / -2), Over 0.5 and correct
 * scores are excluded: they carry very high probabilities but pay almost
 * nothing, so they would dominate any scoring that rewards raw probability
 * while offering no genuine value. A banker should be a meaningful, priceable
 * selection.
 */
const BANKER_ELIGIBLE = [
  /^1$/, /^X$/, /^2$/,
  /^1X$/, /^12$/, /^X2$/,
  /^DNB_H$/, /^DNB_A$/,
  /^BTTS_Y$/, /^BTTS_N$/,
  /^[OU](1\.5|2\.5|3\.5)$/,
  /^AH_[HA]_(-1|-0\.5|0\.5|1)$/,
  /^TT[HA]_[OU]1\.5$/,
];

/** Lowest price we would ever call a banker. Below this it is not worth the risk. */
const BANKER_MIN_PRICE = 1.25;

/** Probability ceiling used to normalise the safety term. */
const SAFETY_CEILING = 0.82;

function isBankerEligible(key) {
  return BANKER_ELIGIBLE.some((re) => re.test(key));
}

// ============================================================ price mapping

/**
 * Attach real bookmaker prices to our derived markets where ESPN quotes them,
 * and synthetic (fair-derived) prices where it does not.
 */
/**
 * Resolve a market against the InferSports (Asian books + Pinnacle) consensus.
 *
 * ESPN quotes one book and three market types, so most derived markets have no
 * price at all. This supplies a real, multi-book price where one exists.
 *
 * We deliberately take the MEDIAN across books, not the best available. The
 * median is the honest read of where the market is; using the best price would
 * flatter expected value. The best price is kept alongside for reference.
 *
 * @returns {{dec:number, best:number, books:number, median:number}|null}
 */
function consensusPrice(mk, c) {
  if (!c) return null;
  const pick = (slot) => {
    if (!slot || !slot.median || slot.median <= 1) return null;
    return { dec: slot.median, best: slot.best, median: slot.median, books: slot.books };
  };

  const mTotals = /^([OU])(\d+(?:\.\d+)?)$/.exec(mk.key);
  if (mTotals) {
    const line = Number(mTotals[2]);
    const slot = c.totals && c.totals[line];
    if (!slot) return null;
    return pick(mTotals[1] === 'O' ? slot.over : slot.under);
  }

  const mAh = /^AH_([HA])_(-?\d+(?:\.\d+)?)$/.exec(mk.key);
  if (mAh) {
    const line = Number(mAh[2]);
    const slot = c.ah && c.ah[line];
    if (!slot) return null;
    return pick(mAh[1] === 'H' ? slot.home : slot.away);
  }

  const mHt = /^HT_([1X2])$/.exec(mk.key);
  if (mHt) {
    const h = c.ht && c.ht.h2h;
    if (!h) return null;
    const slot = mHt[1] === '1' ? h.home : mHt[1] === 'X' ? h.draw : h.away;
    return pick(slot);
  }

  return null;
}

/**
 * Attach prices to every derived market.
 *
 * Priority: ESPN/DraftKings first (it is the source the fixture is built from),
 * then the InferSports Asian consensus to fill the markets ESPN does not quote,
 * then our own fair odds as a clearly-labelled synthetic fallback.
 */
function attachPrices(markets, odds, consensus) {
  // Note: we deliberately do NOT bail out when both sources are missing. Every
  // market must leave here with a price and a labelled `priceSource`, otherwise
  // the board renders blanks and the provenance chips lose their meaning. With
  // no book quote the fair price is attached and tagged `synthetic`, which the
  // UI already refuses to present as a verified value bet.
  for (const mk of markets) {
    let dec = null;
    let source = null;
    let books = null;

    if (odds) {
      switch (true) {
        case mk.key === '1':
          dec = odds.homeClose;
          source = 'book';
          break;
        case mk.key === 'X':
          dec = odds.drawClose;
          source = 'book';
          break;
        case mk.key === '2':
          dec = odds.awayClose;
          source = 'book';
          break;
        case /^O(\d)/.test(mk.key) && mk.line === odds.totalLine:
          dec = odds.overClose;
          source = 'book';
          break;
        case /^U(\d)/.test(mk.key) && mk.line === odds.totalLine:
          dec = odds.underClose;
          source = 'book';
          break;
        case mk.key.startsWith('AH_H_') && odds.spread && sameLine(mk.line, odds.spread.line):
          dec = odds.spread.home;
          source = 'book';
          break;
        case mk.key.startsWith('AH_A_') && odds.spread && sameLine(-mk.line, odds.spread.line):
          dec = odds.spread.away;
          source = 'book';
          break;
        default:
          dec = null;
      }
    }

    // Second source: Asian books, for everything ESPN does not quote.
    if (!dec && consensus) {
      const is = consensusPrice(mk, consensus);
      if (is) {
        dec = is.dec;
        source = 'book-asian';
        books = is.books;
        mk.priceBest = is.best;
        mk.priceBooks = is.books;
      }
    }

    if (dec) {
      mk.price = dec;
      mk.priceSource = source;
      mk.impliedProb = M.impliedProb(dec);
    } else {
      // Synthetic price: the fair price from our own model. Clearly labelled so
      // the UI never presents an unquoted market as a verified value bet.
      mk.price = mk.fairOdds;
      mk.priceSource = 'synthetic';
      mk.impliedProb = null;
    }
  }

  // ---- Synthetic combination prices for markets books price directly ----
  const byKey = Object.fromEntries(markets.map((m) => [m.key, m]));
  const combine = (keys, targetKey) => {
    const parts = keys.map((k) => byKey[k]).filter((m) => m && m.priceSource && m.priceSource.startsWith('book'));
    const target = byKey[targetKey];
    if (!target || parts.length !== keys.length) return;
    const dec = 1 / parts.reduce((acc, m) => acc + 1 / m.price, 0);
    if (Number.isFinite(dec) && dec > 1) {
      target.price = dec;
      target.priceSource = 'book-combined';
      target.impliedProb = M.impliedProb(dec);
    }
  };
  combine(['1', 'X'], '1X');
  combine(['1', '2'], '12');
  combine(['X', '2'], 'X2');

  // Draw-no-bet is a genuine two-way market: split the 1/2 probabilities
  // after removing the draw, then invert back to a price.
  // Guarded on `odds` because a ratable fixture can still have no ESPN quote.
  if (odds && byKey.DNB_H && byKey.DNB_A && odds.homeClose && odds.awayClose) {
    const inv1 = 1 / odds.homeClose;
    const inv2 = 1 / odds.awayClose;
    const s = inv1 + inv2;
    byKey.DNB_H.price = s / inv1;
    byKey.DNB_A.price = s / inv2;
    byKey.DNB_H.priceSource = 'book-combined';
    byKey.DNB_A.priceSource = 'book-combined';
    byKey.DNB_H.impliedProb = M.impliedProb(byKey.DNB_H.price);
    byKey.DNB_A.impliedProb = M.impliedProb(byKey.DNB_A.price);
  }

  // ---- Value / edge, only where a real book price exists ----
  for (const mk of markets) {
    if (mk.impliedProb != null && mk.priceSource && mk.priceSource.startsWith('book')) {
      mk.edge = mk.prob - mk.impliedProb;
      mk.ev = mk.prob * (mk.price - 1) - (1 - mk.prob);
      mk.valuePct = mk.ev * 100;
      mk.verified = true;
    } else {
      mk.edge = null;
      mk.ev = null;
      mk.valuePct = null;
      mk.verified = false;
    }
  }
  return markets;
}

function sameLine(a, b) {
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 0.01;
}

// ============================================================ line movement

/**
 * Read the open -> close drift. Shortening = money arriving.
 * Lengthening on a favourite = a classic sharp signal AGAINST that side.
 */
function analyseLineMovement(odds) {
  if (!odds) return null;
  const out = { moves: [], flags: [] };
  const pct = (open, close) => {
    if (!open || !close || open <= 1 || close <= 1) return null;
    return (close - open) / open; // negative = shortened
  };

  const add = (label, open, close, side) => {
    const change = pct(open, close);
    if (change == null) return;
    out.moves.push({ label, side, open, close, changePct: change * 100 });
    if (change <= -0.06) out.flags.push({ type: 'steam', side, label, changePct: change * 100 });
    if (change >= 0.06) out.flags.push({ type: 'drift', side, label, changePct: change * 100 });
  };

  add('Home', odds.homeOpen, odds.homeClose, 'home');
  add('Away', odds.awayOpen, odds.awayClose, 'away');
  add('Draw', odds.drawOpen, odds.drawClose, 'draw');
  add('Over', odds.overOpen, odds.overClose, 'over');
  add('Under', odds.underOpen, odds.underClose, 'under');
  return out;
}

// ============================================================ patterns

/** Visible + hidden pattern extraction. */
function detectPatterns(ctx) {
  const visible = [];
  const hidden = [];
  const { homeRow, awayRow, form, h2h, standings, baseline, match } = ctx;

  const add = (arr, id, label, detail, weight, supports) =>
    arr.push({ id, label, detail, weight, supports });

  // ---------- VISIBLE ----------

  // Form strings from the scoreboard (e.g. "WDDDW")
  if (match.home.form) {
    const f = match.home.form;
    const pts = f.split('').reduce((a, c) => a + (c === 'W' ? 3 : c === 'D' ? 1 : 0), 0);
    add(visible, 'form_home', `${match.home.name} form: ${f}`, `${pts} pts from last ${f.length}`, pts / (f.length * 3), 'home');
  }
  if (match.away.form) {
    const f = match.away.form;
    const pts = f.split('').reduce((a, c) => a + (c === 'W' ? 3 : c === 'D' ? 1 : 0), 0);
    add(visible, 'form_away', `${match.away.name} form: ${f}`, `${pts} pts from last ${f.length}`, pts / (f.length * 3), 'away');
  }

  // Last-5 goal output
  if (form.home && form.away) {
    add(visible, 'goals_recent', 'Recent goal output',
      `${match.home.short} ${form.home.gfPerGame.toFixed(1)} GF / ${form.home.gaPerGame.toFixed(1)} GA per game vs ${match.away.short} ${form.away.gfPerGame.toFixed(1)} / ${form.away.gaPerGame.toFixed(1)}`,
      Math.min(1, (form.home.gfPerGame + form.away.gfPerGame) / 4), 'over');
  }

  // H2H record
  if (h2h) {
    add(visible, 'h2h', `H2H last ${h2h.n}: ${h2h.homeWins}-${h2h.draws}-${h2h.awayWins}`,
      `avg ${h2h.homeGoalsPerGame.toFixed(2)}-${h2h.awayGoalsPerGame.toFixed(2)}`,
      Math.min(1, h2h.n / 6), h2h.homeWins > h2h.awayWins ? 'home' : h2h.awayWins > h2h.homeWins ? 'away' : 'draw');
    add(visible, 'h2h_btts', `H2H both scored in ${(h2h.bttsRate * 100).toFixed(0)}%`,
      `${(h2h.over25Rate * 100).toFixed(0)}% went over 2.5`, h2h.bttsRate, h2h.bttsRate > 0.55 ? 'btts_yes' : 'btts_no');
  }

  // League position gap
  if (standings.home && standings.away && standings.home.rank && standings.away.rank) {
    const gap = Math.abs(standings.home.rank - standings.away.rank);
    add(visible, 'table_gap', `Table: ${standings.home.rank} vs ${standings.away.rank}`,
      `gap of ${gap} places`, Math.min(1, gap / 12), standings.home.rank < standings.away.rank ? 'home' : 'away');
  }

  // Season goals profile
  if (homeRow && awayRow) {
    const expTotal = (homeRow.xg || 1.35) + (awayRow.xg || 1.35);
    add(visible, 'xg_total', `Combined xG ${expTotal.toFixed(2)}`,
      `${match.home.short} ${(homeRow.xg || 0).toFixed(2)} + ${match.away.short} ${(awayRow.xg || 0).toFixed(2)}`,
      Math.min(1, Math.abs(expTotal - 2.6) / 1.4), expTotal > 2.9 ? 'over' : expTotal < 2.3 ? 'under' : null);
  }

  // ---------- HIDDEN ----------

  // 1. Regression signal: goals scored vs xG. Big positive gap = luck, expect a dip.
  if (homeRow && homeRow.gp >= 4 && homeRow.xg) {
    const actual = homeRow.gf / homeRow.gp;
    const gap = actual - homeRow.xg;
    if (Math.abs(gap) >= 0.3) {
      add(hidden, 'regression_home',
        `${match.home.name} ${gap > 0 ? 'over-performing' : 'under-performing'} xG`,
        `scoring ${actual.toFixed(2)} vs xG ${homeRow.xg.toFixed(2)} (${gap > 0 ? '+' : ''}${gap.toFixed(2)}/game)`,
        Math.min(1, Math.abs(gap) / 0.8),
        gap > 0 ? 'against_home' : 'home');
    }
  }
  if (awayRow && awayRow.gp >= 4 && awayRow.xg) {
    const actual = awayRow.gf / awayRow.gp;
    const gap = actual - awayRow.xg;
    if (Math.abs(gap) >= 0.3) {
      add(hidden, 'regression_away',
        `${match.away.name} ${gap > 0 ? 'over-performing' : 'under-performing'} xG`,
        `scoring ${actual.toFixed(2)} vs xG ${awayRow.xg.toFixed(2)} (${gap > 0 ? '+' : ''}${gap.toFixed(2)}/game)`,
        Math.min(1, Math.abs(gap) / 0.8),
        gap > 0 ? 'against_away' : 'away');
    }
  }

  // 2. Defensive regression: goals conceded vs xGA.
  if (homeRow && homeRow.gp >= 4 && homeRow.xga) {
    const actual = homeRow.ga / homeRow.gp;
    const gap = actual - homeRow.xga;
    if (Math.abs(gap) >= 0.3) {
      add(hidden, 'def_regression_home', `${match.home.name} defence ${gap < 0 ? 'flattered' : 'unlucky'}`,
        `conceding ${actual.toFixed(2)} vs xGA ${homeRow.xga.toFixed(2)}`,
        Math.min(1, Math.abs(gap) / 0.8), gap < 0 ? 'against_home' : 'home');
    }
  }
  if (awayRow && awayRow.gp >= 4 && awayRow.xga) {
    const actual = awayRow.ga / awayRow.gp;
    const gap = actual - awayRow.xga;
    if (Math.abs(gap) >= 0.3) {
      add(hidden, 'def_regression_away', `${match.away.name} defence ${gap < 0 ? 'flattered' : 'unlucky'}`,
        `conceding ${actual.toFixed(2)} vs xGA ${awayRow.xga.toFixed(2)}`,
        Math.min(1, Math.abs(gap) / 0.8), gap < 0 ? 'against_away' : 'away');
    }
  }

  // 3. Momentum shift: last 3 vs full last-5 window.
  for (const [side, f, team] of [['home', form.home, match.home], ['away', form.away, match.away]]) {
    if (f && f.n >= 5 && f.seq) {
      const last3 = f.seq.slice(-3);
      const pts3 = last3.split('').reduce((a, c) => a + (c === 'W' ? 3 : c === 'D' ? 1 : 0), 0) / 9;
      const pts5 = f.ppg / 3;
      const delta = pts3 - pts5;
      if (Math.abs(delta) >= 0.3) {
        add(hidden, `momentum_${side}`,
          `${team.name} momentum ${delta > 0 ? 'rising' : 'falling'}`,
          `last 3 form ${last3} (${(pts3 * 100).toFixed(0)}% of pts) vs last 5 (${(pts5 * 100).toFixed(0)}%)`,
          Math.min(1, Math.abs(delta)), delta > 0 ? side : `against_${side}`);
      }
    }
  }

  // 4. Clean-sheet / failed-to-score streaks.
  for (const [side, f, team] of [['home', form.home, match.home], ['away', form.away, match.away]]) {
    if (f && f.seq) {
      if (f.ga === 0 && f.n >= 3) {
        add(hidden, `cs_streak_${side}`, `${team.name} clean sheets in all last ${f.n}`,
          'defensive solidity', 0.7, `under`);
      }
      if (f.gf === 0 && f.n >= 3) {
        add(hidden, `fts_streak_${side}`, `${team.name} failed to score in all last ${f.n}`,
          'attacking drought', 0.7, `against_${side}`);
      }
    }
  }

  // 5. Home fortress / travel weakness.
  if (homeRow && homeRow.gp >= 4 && homeRow.homeGoals > 0) {
    const homeRate = homeRow.homeGoals / Math.max(1, homeRow.gp / 2);
    const overall = homeRow.gf / homeRow.gp;
    if (overall > 0 && homeRate / overall >= 1.25) {
      add(hidden, 'home_fortress', `${match.home.name} much stronger at home`,
        `${homeRate.toFixed(2)} goals/game at home vs ${overall.toFixed(2)} overall`,
        Math.min(1, homeRate / overall - 1), 'home');
    }
  }
  if (awayRow && awayRow.gp >= 4 && awayRow.awayGoals > 0) {
    const awayRate = awayRow.awayGoals / Math.max(1, awayRow.gp / 2);
    const overall = awayRow.gf / awayRow.gp;
    if (overall > 0 && awayRate / overall <= 0.78) {
      add(hidden, 'travel_weak', `${match.away.name} struggles on the road`,
        `${awayRate.toFixed(2)} goals/game away vs ${overall.toFixed(2)} overall`,
        Math.min(1, 1 - awayRate / overall), 'home');
    }
  }

  // 6. Shot quality / volume edge.
  if (homeRow && awayRow && homeRow.shots && awayRow.shots && homeRow.gp && awayRow.gp) {
    const hSot = (homeRow.shotsOnTarget || 0) / homeRow.shots;
    const aSot = (awayRow.shotsOnTarget || 0) / awayRow.shots;
    if (Math.abs(hSot - aSot) >= 0.08) {
      add(hidden, 'shot_quality', 'Shot quality differential',
        `${match.home.short} ${(hSot * 100).toFixed(0)}% on target vs ${match.away.short} ${(aSot * 100).toFixed(0)}%`,
        Math.min(1, Math.abs(hSot - aSot) * 5), hSot > aSot ? 'home' : 'away');
    }
    const hVol = homeRow.shots / homeRow.gp;
    const aVol = awayRow.shots / awayRow.gp;
    if (Math.abs(hVol - aVol) >= 4) {
      add(hidden, 'shot_volume', 'Shot volume differential',
        `${match.home.short} ${hVol.toFixed(1)} vs ${match.away.short} ${aVol.toFixed(1)} shots/game`,
        Math.min(1, Math.abs(hVol - aVol) / 12), hVol > aVol ? 'home' : 'away');
    }
  }

  // 7. Discipline risk — cards and suspensions.
  for (const [side, row, team] of [['home', homeRow, match.home], ['away', awayRow, match.away]]) {
    if (row && ((row.red || 0) > 0 || (row.suspensions || 0) > 0)) {
      add(hidden, `discipline_${side}`, `${team.name} discipline concern`,
        `${row.red || 0} red card(s), ${row.suspensions || 0} suspension(s) this season`,
        Math.min(1, ((row.red || 0) + (row.suspensions || 0)) / 3), `against_${side}`);
    }
  }

  // 8. Possession style clash.
  if (homeRow && awayRow && homeRow.possession && awayRow.possession) {
    const gap = Math.abs(homeRow.possession - awayRow.possession);
    if (gap >= 12) {
      add(hidden, 'style_clash', 'Contrasting possession styles',
        `${match.home.short} ${homeRow.possession.toFixed(1)}% vs ${match.away.short} ${awayRow.possession.toFixed(1)}%`,
        Math.min(1, gap / 30), null);
    }
  }

  // 9. League scoring environment (hidden, league-level).
  if (baseline && baseline.games > 20) {
    add(hidden, 'league_env', `${ctx.match.leagueName} scoring environment`,
      `${baseline.goalsPerGame.toFixed(2)} goals/game, home share ${(baseline.homeShare * 100).toFixed(0)}%`,
      0.4, baseline.goalsPerGame > 2.9 ? 'over' : baseline.goalsPerGame < 2.4 ? 'under' : null);
  }

  return { visible, hidden };
}

// ============================================================ trap detection

/**
 * Bookmaker trap detection.
 *
 * severity 'veto'   -> market is disqualified from banker entirely
 * severity 'high'   -> heavy score penalty, needs strong offsetting evidence
 * severity 'medium' -> moderate penalty
 */
function detectTraps(ctx, market, model, odds) {
  const traps = [];
  const t = (id, label, detail, severity) => traps.push({ id, label, detail, severity });

  // 1. Margin / overround trap on the 1X2 market.
  if (odds && odds.homeClose && odds.drawClose && odds.awayClose) {
    const vig = M.removeVig([odds.homeClose, odds.drawClose, odds.awayClose]);
    if (vig) {
      if (vig.margin > 0.10) {
        t('margin_trap', 'Heavy bookmaker margin',
          `1X2 overround ${(vig.overround * 100).toFixed(1)}% — the book is loading this market`, 'veto');
      } else if (vig.margin > 0.07) {
        t('margin_high', 'Above-average bookmaker margin',
          `1X2 overround ${(vig.overround * 100).toFixed(1)}%`, 'medium');
      }
    }
  }

  // 2. Short-price trap: an unbackable favourite the model does not rate.
  if (market.impliedProb != null) {
    const dec = market.price;
    if (dec <= 1.30 && market.prob < 0.60) {
      t('short_price_trap', 'Short-price trap',
        `Priced at ${dec.toFixed(2)} but the model only gives it ${(market.prob * 100).toFixed(1)}%`, 'veto');
    } else if (dec <= 1.40 && market.prob < 0.62) {
      t('short_price_soft', 'Thin value on a short price',
        `Priced at ${dec.toFixed(2)} vs model ${(market.prob * 100).toFixed(1)}%`, 'high');
    }
  }

  // 3. Model vs market conflict, net of vig — checked in BOTH directions.
  //
  //    market >> model : the market knows something we do not  -> dangerous
  //    model  >> market: we claim a huge edge                  -> almost always
  //                      a broken model rather than free money
  //
  //    A modest model edge is the whole point of the exercise, so only
  //    EXCESSIVE disagreement in our favour is penalised.
  if (market.impliedProb != null) {
    const signed = market.impliedProb - market.prob; // positive = market more confident
    const abs = Math.abs(signed);
    if (signed >= 0.12) {
      t('model_market_conflict', 'Market strongly disagrees with the model',
        `Fair market price implies ${(market.impliedProb * 100).toFixed(1)}% vs model ${(market.prob * 100).toFixed(1)}%`, 'veto');
    } else if (signed >= 0.07) {
      t('model_market_gap', 'Noticeable model/market gap',
        `Market ${(market.impliedProb * 100).toFixed(1)}% vs model ${(market.prob * 100).toFixed(1)}%`, 'medium');
    } else if (signed <= -0.25) {
      t('implausible_edge', 'Implausible model edge',
        `Model claims ${(market.prob * 100).toFixed(1)}% against a market price of ${(market.impliedProb * 100).toFixed(1)}% — treat as a model failure, not value`, 'veto');
    } else if (signed <= -0.16) {
      t('large_edge', 'Unusually large model edge',
        `Model ${(market.prob * 100).toFixed(1)}% vs market ${(market.impliedProb * 100).toFixed(1)}% — verify before trusting`, 'high');
    } else if (abs >= 0.08) {
      t('model_market_gap', 'Moderate model/market gap',
        `Model ${(market.prob * 100).toFixed(1)}% vs market ${(market.impliedProb * 100).toFixed(1)}%`, 'medium');
    }
  }

  // 3b. Cross-league fixture. The model normalises each team against its own
  //     league, so cross-league ties carry genuine extra uncertainty even
  //     after the strength correction.
  if (model && model.crossLeague) {
    t('cross_league', 'Cross-league fixture',
      `Teams come from different divisions (strength ${model.crossLeague.homeStrength.toFixed(2)} vs ${model.crossLeague.awayStrength.toFixed(2)}) — extra uncertainty beyond the strength correction`, 'medium');
  }

  // 4. Reverse line movement against the selection.
  if (odds && market.key) {
    const sideMap = { 1: 'home', 2: 'away', X: 'draw' };
    const side = sideMap[market.key] || (/^O/.test(market.key) ? 'over' : /^U/.test(market.key) ? 'under' : null);
    if (side) {
      const open = { home: odds.homeOpen, away: odds.awayOpen, draw: odds.drawOpen, over: odds.overOpen, under: odds.underOpen }[side];
      const close = { home: odds.homeClose, away: odds.awayClose, draw: odds.drawClose, over: odds.overClose, under: odds.underClose }[side];
      if (open && close && open > 1 && close > 1) {
        const drift = (close - open) / open;
        if (drift >= 0.07) {
          t('reverse_line_movement', 'Reverse line movement',
            `Price on this side drifted ${(drift * 100).toFixed(1)}% from open to close — money is going the other way`, 'high');
        } else if (drift >= 0.04) {
          t('line_drift', 'Mild adverse line movement',
            `Price drifted ${(drift * 100).toFixed(1)}% from open`, 'medium');
        }
      }
    }
  }

  // 5. xG over-performance on the side being backed (regression risk).
  const backHome = market.key === '1' || market.key === '1X' || market.key === 'DNB_H' || market.key === 'AH_H_-0.5';
  const backAway = market.key === '2' || market.key === 'X2' || market.key === 'DNB_A';
  const teamRow = backHome ? ctx.homeRow : backAway ? ctx.awayRow : null;
  const teamName = backHome ? ctx.match.home.name : backAway ? ctx.match.away.name : null;
  if (teamRow && teamRow.gp >= 4 && teamRow.xg) {
    const ratio = teamRow.gf / teamRow.gp / teamRow.xg;
    if (ratio >= 1.35) {
      t('xg_overperformance', `${teamName} is over-performing xG`,
        `Scoring ${(ratio * 100 - 100).toFixed(0)}% more than expected — results may be flattering`, 'high');
    } else if (ratio >= 1.20) {
      t('xg_overperformance_mild', `${teamName} running slightly hot vs xG`,
        `${(ratio * 100 - 100).toFixed(0)}% above expected goals`, 'medium');
    }
  }

  // 6. Small sample.
  //    Reported as information only: the sample size is already reflected in
  //    the model's shrinkage and in the 'sample' score component.
  const gp = Math.min(ctx.homeRow ? ctx.homeRow.gp : 0, ctx.awayRow ? ctx.awayRow.gp : 0);
  if (gp > 0 && gp < 3) {
    t('small_sample', 'Too few games played',
      `Only ${gp} matches of data — model output is not yet reliable`, 'veto');
  } else if (gp > 0 && gp < 5) {
    t('small_sample_soft', 'Limited sample',
      `${gp} games played; ratings are heavily shrunk toward the mean`, 'info');
  }

  // 7. Fixture congestion.
  const congestion = detectCongestion(ctx);
  if (congestion) {
    t('congestion', 'Fixture congestion',
      `${congestion} — fatigue is a real performance drag`, 'medium');
  }

  // 8. Unverifiable price. Informational: such markets are already barred from
  //    banker election by the verified-price requirement.
  if (!market.verified) {
    t('unverified_price', 'No bookmaker price available',
      'Model probability only — value cannot be independently verified', 'info');
  }

  // 9. Low-tier league liquidity.
  if (ctx.match.leagueTier >= 4 && !market.verified) {
    t('low_liquidity', 'Low-liquidity league',
      'Thin markets in this division are easier to manipulate and harder to price', 'medium');
  }

  // 10. Stale / missing data.
  if (!ctx.homeRow || !ctx.awayRow) {
    t('missing_stats', 'Incomplete team statistics',
      'One or both teams have no season statistics available', 'veto');
  }

  // 11. Draw trap: a very tight model spread where the draw is live.
  if ((market.key === '1' || market.key === '2') && model) {
    const { pHome, pDraw, pAway } = model.oneXtwo;
    const spread = Math.abs(pHome - pAway);
    if (spread <= 0.06 && pDraw >= 0.27 && market.key === '1') {
      t('draw_trap', 'Draw is very live in this fixture',
        `Model draw probability ${(pDraw * 100).toFixed(1)}% — a home/away single is riskier than it looks`, 'medium');
    }
  }

  return traps;
}

/**
 * Fixture congestion: did either side play within 3 days of this match?
 * Short turnarounds are a genuine, measurable performance drag — and the
 * market does not always price them.
 */
function detectCongestion(ctx) {
  const { form, match } = ctx;
  if (!form || !match || !match.date) return null;
  const matchTime = new Date(match.date).getTime();
  if (!Number.isFinite(matchTime)) return null;

  const notes = [];
  for (const [side, f, team] of [['home', form.home, match.home], ['away', form.away, match.away]]) {
    if (!f || !f.lastGameDate) continue;
    const last = new Date(f.lastGameDate).getTime();
    if (!Number.isFinite(last)) continue;
    const days = (matchTime - last) / 86400000;
    if (days >= 0 && days < 3) {
      notes.push(`${team.name} played ${days < 1 ? 'today' : Math.round(days) + 'd ago'}`);
    }
  }
  if (!notes.length) return null;
  return notes.join('; ');
}

// ============================================================ scoring

/**
 * Trap severities and their score cost.
 *
 * 'veto'  disqualifies the market outright.
 * 'info'  is reported to the user but costs nothing, because the condition is
 *         already reflected in another score component — charging twice for
 *         the same weakness is what makes a scoring model systematically
 *         under-confident.
 */
const TRAP_PENALTY = { veto: 100, high: 10, medium: 4, info: 0 };

/**
 * Sharpshooter score for one market.
 * Weighted blend of safety, agreement, xG consistency, form, H2H, patterns
 * and sample size, minus trap penalties.
 */
function scoreMarket(ctx, market, model, odds, patterns, newsRisk, consensus) {
  const traps = detectTraps(ctx, market, model, odds);

  // ---- Team-news risk.
  //
  // ESPN publishes a few editorial headlines per fixture. Those are scanned for
  // suspension / injury / doubt / transfer language and attributed to a side.
  // A finding only counts against THIS market when it lands on the side the
  // market depends on — risk on the opposing side may in fact help the pick, so
  // it is surfaced as information and never penalised.
  if (newsRisk) {
    for (const t of news.newsTraps(newsRisk, market, marketSide(market))) traps.push(t);
  }

  // ---- Cross-book outlier.
  //
  // Where several Asian books quote the same market, a single book sitting well
  // away from the consensus is a classic trap: the price looks generous but the
  // market as a whole disagrees. Penalise only when the book we priced from is
  // the outlier, and only when the gap is material.
  if (consensus && market.priceSource === 'book-asian' && market.priceBest && market.price
      && market.priceBooks >= 2) {
    const spread = market.priceBest / market.price - 1;
    if (spread >= 0.12) {
      traps.push({
        id: 'cross_book_outlier',
        label: 'Books disagree on this price',
        detail: `Best available ${market.priceBest.toFixed(2)} vs consensus ${market.price.toFixed(2)} across ${market.priceBooks} books — a ${(spread * 100).toFixed(0)}% spread. A single generous book is not the same as a good price.`,
        severity: 'medium',
        source: 'market',
      });
    }
  }

  const vetoed = traps.some((t) => t.severity === 'veto');

  const floor = BANKER_FLOOR[market.group] || 0.6;

  // ---- 1. Safety: how far above the market's meaningful floor.
  //
  // Calibration note: clearing the floor is the stated bar for a banker, so a
  // market sitting exactly on its floor with otherwise-good evidence should
  // land right around the banker threshold. Hence the 0.6 base: floor-level
  // safety earns 0.6, and only genuinely strong probabilities approach 1.0.
  const span = Math.max(0.05, SAFETY_CEILING - floor);
  const probScore = M.clamp(0.6 + 0.4 * ((market.prob - floor) / span), 0, 1);

  // ---- 2. Model/market agreement.
  let agreementScore = 0.5;
  if (market.impliedProb != null) {
    const gap = Math.abs(market.prob - market.impliedProb);
    agreementScore = M.clamp(1 - gap / 0.20, 0, 1);
  }

  // ---- 3. xG consistency: does the market's implied goal expectancy match ours?
  //
  // Preferred input is the whole Asian over/under ladder (2.5 → 3.5), fitted by
  // least squares. That uses every rung the books quote and is far more stable
  // than reading a single line. Falls back to the one ESPN total line when no
  // ladder is available.
  let xgScore = 0.5;
  let marketLambda = null;
  let fitRms = null;

  if (consensus && consensus.totals) {
    const rungs = [];
    for (const [lineStr, slot] of Object.entries(consensus.totals)) {
      if (!slot || !slot.over || !slot.under) continue;
      const vig = M.removeVig([slot.over.median, slot.under.median]);
      if (!vig) continue;
      rungs.push({ line: Number(lineStr), overProb: vig.fair[0] });
    }
    if (rungs.length >= 2) {
      const fit = M.fitTotalLambda(rungs);
      if (fit) { marketLambda = fit.lambda; fitRms = fit.rms; }
    }
  }

  if (marketLambda == null && odds && odds.totalLine && odds.overClose && odds.underClose) {
    const vig = M.removeVig([odds.overClose, odds.underClose]);
    if (vig) marketLambda = M.impliedTotalLambda(odds.totalLine, vig.fair[0]);
  }

  if (marketLambda != null) {
    const modelTotal = model.lambda.home + model.lambda.away;
    const diff = Math.abs(marketLambda - modelTotal);
    xgScore = M.clamp(1 - diff / 0.9, 0, 1);
    // A poor ladder fit means the books' own prices are not a clean Poisson
    // shape, so the implied total is less trustworthy — shade the score back
    // toward neutral rather than pretending to a precision we do not have.
    if (fitRms != null && fitRms > 0.035) {
      xgScore = M.clamp(0.5 + (xgScore - 0.5) * 0.6, 0, 1);
    }
    market.marketLambda = marketLambda;
    market.modelLambda = modelTotal;
  }

  // ---- 4. Form support for this selection.
  const formScore = supportScore({ visible: patterns.visible, hidden: [] }, market);

  // ---- 5. H2H support.
  let h2hScore = 0.5;
  if (ctx.h2h) {
    if (market.group === 'BTTS') h2hScore = market.key === 'BTTS_Y' ? ctx.h2h.bttsRate : 1 - ctx.h2h.bttsRate;
    else if (market.group === 'Totals' && market.line === 2.5) {
      h2hScore = market.side === 'over' ? ctx.h2h.over25Rate : 1 - ctx.h2h.over25Rate;
    } else if (market.key === '1') h2hScore = ctx.h2h.homeWins / ctx.h2h.n;
    else if (market.key === '2') h2hScore = ctx.h2h.awayWins / ctx.h2h.n;
    else if (market.key === 'X') h2hScore = ctx.h2h.draws / ctx.h2h.n;
  }

  // ---- 6. Pattern support (visible + hidden, directional).
  const patternScore = supportScore(patterns, market);

  // ---- 7. Sample confidence.
  const sampleScore = model.sampleConfidence != null ? model.sampleConfidence : 0.5;

  let score =
    100 *
    (0.32 * probScore +
      0.16 * agreementScore +
      0.12 * xgScore +
      0.10 * formScore +
      0.08 * h2hScore +
      0.12 * patternScore +
      0.10 * sampleScore);

  let penalty = 0;
  for (const tr of traps) penalty += TRAP_PENALTY[tr.severity] || 0;
  score = M.clamp(score - penalty, 0, 100);

  // Value is a bonus, never a substitute for safety.
  if (market.valuePct != null && market.valuePct > 0) score = Math.min(100, score + Math.min(6, market.valuePct / 2));

  return {
    score: Math.round(score * 10) / 10,
    vetoed,
    traps,
    components: {
      prob: round3(probScore),
      agreement: round3(agreementScore),
      xg: round3(xgScore),
      form: round3(formScore),
      h2h: round3(h2hScore),
      pattern: round3(patternScore),
      sample: round3(sampleScore),
    },
  };
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

/**
 * Which "side" a market backs. Used to compare against a pattern's direction.
 */
function marketSide(market) {
  const k = market.key;
  const g = market.group;
  if (k === 'X') return 'draw';
  if (k === '1' || k === '1X' || k === 'DNB_H' || /^AH_H_/.test(k) || /^TTH_O/.test(k)) return 'home';
  if (k === '2' || k === 'X2' || k === 'DNB_A' || /^AH_A_/.test(k) || /^TTA_O/.test(k)) return 'away';
  if (g === 'BTTS') return k === 'BTTS_Y' ? 'btts_yes' : 'btts_no';
  if (g === 'Totals') return market.side === 'over' ? 'over' : 'under';
  if (k === '12') return null; // both sides — no directional opinion
  return null;
}

/** Which side a detected pattern points at. */
function patternSide(supports) {
  switch (supports) {
    case 'home': return 'home';
    case 'away': return 'away';
    case 'draw': return 'draw';
    case 'over': return 'over';
    case 'under': return 'under';
    case 'btts_yes': return 'btts_yes';
    case 'btts_no': return 'btts_no';
    case 'against_home': return 'away';
    case 'against_away': return 'home';
    default: return null;
  }
}

/** Opposing pairs. */
const OPPOSITE = {
  home: 'away', away: 'home',
  over: 'under', under: 'over',
  btts_yes: 'btts_no', btts_no: 'btts_yes',
  draw: null,
};

/**
 * How well do the detected patterns support this market?
 *
 * Returns 0.5 (neutral) when there is NO relevant evidence. Only patterns that
 * actually point at a side count, and contradicting patterns push the score
 * down. An absence of patterns must not be treated as an absence of merit.
 */
function supportScore(patterns, market) {
  if (!patterns) return 0.5;
  const all = [...patterns.visible, ...patterns.hidden];
  const side = marketSide(market);
  if (!side) return 0.5;

  let net = 0;
  let total = 0;
  for (const p of all) {
    const ps = patternSide(p.supports);
    if (!ps) continue;
    if (ps === side) {
      total += p.weight;
      net += p.weight;
    } else if (OPPOSITE[side] && ps === OPPOSITE[side]) {
      total += p.weight;
      net -= p.weight;
    }
  }
  if (total === 0) return 0.5;
  return M.clamp(0.5 + 0.5 * (net / total), 0, 1);
}

module.exports = {
  attachPrices,
  analyseLineMovement,
  detectPatterns,
  detectTraps,
  scoreMarket,
  supportScore,
  marketSide,
  patternSide,
  isBankerEligible,
  BANKER_FLOOR,
  BANKER_ELIGIBLE,
  BANKER_MIN_PRICE,
  SAFETY_CEILING,
};
