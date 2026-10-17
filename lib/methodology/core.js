'use strict';

/**
 * methodology/core.js — the shared machinery behind every market methodology.
 *
 * A methodology is a *spec*: a named set of HARD GATES (any failure removes the
 * pick, no averaging) plus a scored CHECKLIST, evaluated against one `View` of
 * the fixture. The View is built once per match and holds everything a rule might
 * ask: the score-matrix probabilities, per-side evidence over the last 5-10
 * games, head-to-head, team news, rest days, the book favourite, an independent
 * Elo read, and data coverage.
 *
 * Status ladder (what a pick can end as):
 *
 *   LOCK     every gate and the checklist pass AND a real bookmaker price shows
 *            the edge the methodology demands.
 *   PREDICT  every gate and the checklist pass — the match genuinely "falls under"
 *            this methodology — but the price is unavailable, too short, or shows
 *            no edge. It is a prediction, not a verified value bet.
 *   PAPER    the structural gates pass but the market has no obtainable price at
 *            all and the methodology itself demands a paper-trade record first
 *            (GG/NG 2+). Shown for tracking, never as a bet.
 *   WATCH    no hard gate failed, but the checklist is short of the bar.
 *   REMOVE   a hard gate failed (or the checklist is far short). Reasons kept.
 *
 * Nothing here guesses. Where evidence is missing the gate says so ("unknown")
 * and an unknown on a hard gate fails closed.
 */

const M = require('../model');

// ============================================================ configuration

const CFG = {
  /** Minimum games per side before any evidence-based rule may carry a pick (Rule 5). */
  minSample: 5,
  /** Games per side that count as a STRONG sample. */
  strongSample: 8,
  /**
   * Checklist standard, matching the original playbooks: each item is a binary
   * pass at its stated criterion (an item "passes" at score >= 0.5, the midpoint
   * of its ramp), and 6/7 ~ 0.86 qualifies, 5/7 ~ 0.71 is "investigate".
   * The continuous score only ranks picks that already qualify.
   */
  qualify: 0.85,
  watch: 0.70,
  /**
   * Share of checklist items that must have real evidence behind them. Unknown
   * items are EXCLUDED from the ratio rather than given half credit: "no data"
   * is not "half good". But a pick judged on two items out of nine has not been
   * checked, so too many unknowns caps the status at WATCH.
   */
  minKnown: 0.6,
  /**
   * Edge-scaling rule (generalises v3.1 Rule 28). The probability must beat the
   * book's implied probability by a MULTIPLE that grows with the price:
   *     requiredRatio = max(spec.minRatio, 1 + 0.05 * price)
   * At 1.80 that is +9% (about the old "+5 points"); at 4.00 it is +20%; at 8.00
   * +40%. A flat "+5 percentage points" is generous at 1.80 and meaningless at 8.
   */
  edgeSlope: 0.05,
  /** Shortest price worth calling a bet (Rule 7). Below it the pick may be right but there is nothing to win. */
  minPrice: 1.25,
  /** A side counts as a "heavy favourite" below this book price (v3.0 Rule 25). */
  heavyFavPrice: 1.6,
  /** Games within this many days of the last one = rotation / congestion risk (Rule 15). */
  rotationDays: 3,
  /** Game-script covariance haircut on P(both sides 2+) (v3.1 Rule 30). */
  gg2Haircut: 0.88,
};

const clamp01 = (x) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
const pct = (v, dp = 0) => (v == null || !Number.isFinite(v) ? '—' : (v * 100).toFixed(dp) + '%');
const f2 = (v) => (v == null || !Number.isFinite(v) ? '—' : Number(v).toFixed(2));

// ============================================================ result builders

/**
 * A hard gate.
 * @param {string} id   short id, e.g. "O3"
 * @param {string} label
 * @param {boolean|null} pass  true / false, or null when the evidence is missing
 * @param {*} value     what was measured (for display)
 * @param {*} need      what was required (for display)
 * @param {{rule?:string, note?:string}} [extra]
 */
function G(id, label, pass, value, need, extra = {}) {
  const unknown = pass == null;
  return {
    id,
    label,
    pass: unknown ? false : !!pass, // unknown fails closed
    unknown,
    value: value == null ? null : value,
    need: need == null ? null : need,
    rule: extra.rule || null,
    note: extra.note || null,
  };
}

/** A scored checklist item, 0..1. `score` null = unknown (counts as neutral 0.5). */
function C(id, label, score, value, note) {
  const unknown = score == null || !Number.isFinite(score);
  return {
    id,
    label,
    score: unknown ? 0.5 : clamp01(score),
    unknown,
    value: value == null ? null : value,
    note: note || null,
  };
}

// ============================================================ side evidence

/**
 * Summarise a side's recent games (newest first) into the 0/1/2+ goal
 * distribution and the rates the rules ask about. Admissible evidence per v3.1
 * Rule 29 — counts of goals scored, not narrative tags.
 *
 * @param {Array<{gf:number, ga:number, venue?:string, date?:string}>} games
 */
function sideEvidence(games, maxGames = 10) {
  const g = (games || []).filter((x) => x && Number.isFinite(x.gf) && Number.isFinite(x.ga)).slice(0, maxGames);
  const n = g.length;
  const ev = {
    n,
    sample: n >= CFG.strongSample ? 'STRONG' : n >= CFG.minSample ? 'LIMITED' : 'TINY',
    games: g,
    gf: 0, ga: 0,
    gf0: 0, gf1: 0, gf2p: 0, gf3p: 0, ga2p: 0,
    cs: 0, fts: 0,
    btts: 0, o25: 0, u25: 0, big4: 0, low: 0,
    wins: 0, draws: 0, losses: 0,
    wonBy1: 0, wonBy2p: 0, lostBy1: 0, lostBy2p: 0, lostBy3p: 0,
    scoreStreak: 0, ftsStreak: 0, o25Streak: 0, u25Streak: 0,
    form: '',
  };
  const emptyVenue = { n: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0 };
  if (!n) return { ...ev, rate: () => null, gfpg: null, gapg: null, totpg: null, atHome: emptyVenue, away: emptyVenue };

  let scoring = true;
  let blanking = true;
  let overStk = true;
  let underStk = true;
  for (const x of g) {
    const tot = x.gf + x.ga;
    ev.gf += x.gf;
    ev.ga += x.ga;
    if (x.gf === 0) ev.gf0++;
    if (x.gf === 1) ev.gf1++;
    if (x.gf >= 2) ev.gf2p++;
    if (x.gf >= 3) ev.gf3p++;
    if (x.ga >= 2) ev.ga2p++;
    if (x.ga === 0) ev.cs++;
    if (x.gf === 0) ev.fts++;
    if (x.gf > 0 && x.ga > 0) ev.btts++;
    if (tot > 2) ev.o25++;
    else ev.u25++;
    if (tot >= 4) ev.big4++;
    if (tot <= 1) ev.low++;
    const d = x.gf - x.ga;
    if (d > 0) {
      ev.wins++;
      if (d === 1) ev.wonBy1++;
      else ev.wonBy2p++;
    } else if (d === 0) ev.draws++;
    else {
      ev.losses++;
      if (d === -1) ev.lostBy1++;
      else ev.lostBy2p++;
      if (d <= -3) ev.lostBy3p++;
    }
    ev.form += d > 0 ? 'W' : d === 0 ? 'D' : 'L';

    scoring = scoring && x.gf > 0;
    blanking = blanking && x.gf === 0;
    overStk = overStk && tot > 2;
    underStk = underStk && tot <= 2;
    if (scoring) ev.scoreStreak++;
    if (blanking) ev.ftsStreak++;
    if (overStk) ev.o25Streak++;
    if (underStk) ev.u25Streak++;
  }

  ev.gfpg = ev.gf / n;
  ev.gapg = ev.ga / n;
  ev.totpg = (ev.gf + ev.ga) / n;
  /** rate('o25') -> o25 / n. */
  ev.rate = (k) => (n ? ev[k] / n : null);

  // Venue-specific record (a home side's HOME games, an away side's AWAY games).
  const venue = (v) => {
    const gv = g.filter((x) => x.venue === v);
    const r = { n: gv.length, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0 };
    for (const x of gv) {
      r.gf += x.gf;
      r.ga += x.ga;
      if (x.gf > x.ga) r.wins++;
      else if (x.gf === x.ga) r.draws++;
      else r.losses++;
    }
    return r;
  };
  ev.atHome = venue('H');
  ev.away = venue('A');
  return ev;
}

// ============================================================ calibration

/**
 * Logistic recalibration of the raw model's goals-market probabilities:
 *     p' = sigmoid(a + b * logit(p))
 *
 * WHY: a walk-forward backtest (backtest_methodology.js, 6,289 fixtures across six
 * leagues) showed the raw Over 2.5 / BTTS probabilities are too spread out. A
 * claimed 70% Over 2.5 happens ~64% of the time; a claimed 64% Under 2.5 ~56%.
 * Parameters below were fitted on the 2023-24 seasons ONLY and verified on the
 * held-out 2025 season (log-loss and Brier both improved) — see calibrate_fit.js.
 *
 * Over/Under and Yes/No are calibrated on ONE side and the other is defined as
 * 1 - p', so complementary markets always sum to 1.
 *
 * Caveat, stated plainly: the backtest model used goals-only lambdas, while
 * production blends xG, form and H2H. If those inputs are better, this shrink is
 * somewhat too aggressive — the safe direction (it only makes picks pickier).
 * Markets not measured (other O/U lines, team totals, results, handicaps) are
 * left untouched; the raw 1X2 probabilities were found to be well calibrated.
 */
const CALIBRATION = {
  'O2.5': { a: 0.05, b: 0.65, pair: 'U2.5' },
  'BTTS_Y': { a: 0.105, b: 0.62, pair: 'BTTS_N' },
};

const logit = (p) => {
  const q = Math.min(0.999, Math.max(0.001, p));
  return Math.log(q / (1 - q));
};
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

function calibrateProb(key, p) {
  const c = CALIBRATION[key];
  return c ? sigmoid(c.a + c.b * logit(p)) : p;
}

/** Copies of the markets with calibrated `prob` (raw kept as `rawProb`). Input is not mutated. */
function calibrateMarkets(markets) {
  const out = [];
  const pairs = {};
  for (const [k, c] of Object.entries(CALIBRATION)) pairs[c.pair] = k;
  const byKey = Object.fromEntries((markets || []).map((m) => [m.key, m]));
  for (const mk of markets || []) {
    let prob = mk.prob;
    if (CALIBRATION[mk.key]) prob = calibrateProb(mk.key, mk.prob);
    else if (pairs[mk.key] && byKey[pairs[mk.key]]) prob = 1 - calibrateProb(pairs[mk.key], byKey[pairs[mk.key]].prob);
    out.push(prob === mk.prob ? mk : { ...mk, rawProb: mk.prob, prob, fairOdds: 1 / prob, calibrated: true });
  }
  return out;
}

// ============================================================ view

const NEWS_POS = {
  def: /\b(defender|centre-?back|center-?back|full-?back|left-?back|right-?back|wing-?back)\b/i,
  gk: /\b(goalkeeper|keeper)\b/i,
  att: /\b(striker|forward|winger|attacker|centre-?forward|top scorer|talisman)\b/i,
  mid: /\bmidfielder\b/i,
};

/** Count positional absences per side from the headlines news.js already attributed. */
function newsPositions(newsRisk) {
  const out = {
    home: { def: 0, gk: 0, att: 0, mid: 0, absences: 0, departures: 0 },
    away: { def: 0, gk: 0, att: 0, mid: 0, absences: 0, departures: 0 },
  };
  if (!newsRisk) return out;
  for (const side of ['home', 'away']) {
    for (const it of (newsRisk[side] && newsRisk[side].items) || []) {
      const text = `${it.headline || ''} ${it.evidence || ''}`;
      const kind = it.kind || '';
      if (/suspension|injury|doubt/.test(kind)) {
        out[side].absences++;
        for (const k of Object.keys(NEWS_POS)) if (NEWS_POS[k].test(text)) out[side][k]++;
      } else if (/transfer|depart|sold|sack|manager/.test(kind) || /sold|transferred|departed|sacked/i.test(text)) {
        out[side].departures++;
      }
    }
  }
  return out;
}

function daysBetween(a, b) {
  if (!a || !b) return null;
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return Math.abs(tb - ta) / 86400000;
}

/**
 * Build the fixture View.
 *
 * @param {object} i
 * @param {object} i.match       normalised fixture
 * @param {object} i.sm          score matrix from M.scoreMatrix
 * @param {object} i.model       { lambda:{home,away}, oneXtwo, crossLeague, ... }
 * @param {Array}  i.markets     derived + priced markets
 * @param {object} [i.ctx]       analysis context (rows, form, h2h, standings, baseline)
 * @param {object} [i.newsRisk]  result of news.scanNews
 * @param {object} [i.hist]      history bundle (openfootball)
 * @param {object} [i.elo]       Elo summary
 */
function buildView(i) {
  const { match, sm, model } = i;
  const ctx = i.ctx || {};
  const lamH = sm.lambda;
  const lamA = sm.mu;

  // ---------------------------------------------------------- score-matrix probabilities
  const S = (pred) => M.sumIf(sm, pred);
  const pr = {
    home: S((a, b) => a > b),
    draw: S((a, b) => a === b),
    away: S((a, b) => a < b),
    h0: S((a) => a === 0), h1: S((a) => a === 1), h2: S((a) => a >= 2), h3: S((a) => a >= 3),
    a0: S((_a, b) => b === 0), a1: S((_a, b) => b === 1), a2: S((_a, b) => b >= 2), a3: S((_a, b) => b >= 3),
    btts: S((a, b) => a >= 1 && b >= 1),
    o15: S((a, b) => a + b > 1), o25: S((a, b) => a + b > 2), o35: S((a, b) => a + b > 3),
    tot4: S((a, b) => a + b >= 4),
    p00: sm.m[0][0], p11: sm.m[1][1], p10: sm.m[1][0], p01: sm.m[0][1],
    p20: sm.m[2][0], p02: sm.m[0][2], p21: sm.m[2][1], p12: sm.m[1][2], p22: sm.m[2][2],
  };
  pr.bttsNo = 1 - pr.btts;
  pr.u25 = 1 - pr.o25;
  pr.gg2Raw = S((a, b) => a >= 2 && b >= 2);
  pr.gg2 = pr.gg2Raw * CFG.gg2Haircut;
  // Scorelines that all LOSE GG/NG 2+: the modal cluster the book itself leans on (Rule 36).
  pr.gg2Kill = S((a, b) => (a <= 1 && b <= 1) || (a === 2 && b <= 1) || (b === 2 && a <= 1));

  // ---------------------------------------------------------- market lookup
  const byKey = {};
  for (const mk of calibrateMarkets(i.markets)) byKey[mk.key] = mk;

  // ---------------------------------------------------------- per-side evidence
  const hist = i.hist || null;
  const form = ctx.form || {};
  let basis = 'none';
  let homeGames = [];
  let awayGames = [];
  if (hist && hist.home && hist.away && hist.home.games.length >= CFG.minSample && hist.away.games.length >= CFG.minSample) {
    basis = hist.source || 'history';
    homeGames = hist.home.games;
    awayGames = hist.away.games;
  } else {
    if (form.home && form.home.games && form.home.games.length) homeGames = form.home.games;
    if (form.away && form.away.games && form.away.games.length) awayGames = form.away.games;
    if (homeGames.length || awayGames.length) basis = 'espn-last5';
  }
  const sides = { home: sideEvidence(homeGames), away: sideEvidence(awayGames) };

  // ---------------------------------------------------------- head to head
  let h2hGames = [];
  if (hist && hist.h2h && hist.h2h.length) h2hGames = hist.h2h;
  else if (ctx.h2h && ctx.h2h.games && ctx.h2h.games.length) h2hGames = ctx.h2h.games;
  let h2h = null;
  if (h2hGames.length) {
    const n = h2hGames.length;
    const c = (f) => h2hGames.filter(f).length;
    h2h = {
      n,
      games: h2hGames,
      btts: c((x) => x.hg > 0 && x.ag > 0) / n,
      bttsNo: c((x) => !(x.hg > 0 && x.ag > 0)) / n,
      o25: c((x) => x.hg + x.ag > 2) / n,
      u25: c((x) => x.hg + x.ag <= 2) / n,
      draw: c((x) => x.hg === x.ag) / n,
      homeWin: c((x) => x.hg > x.ag) / n,
      awayWin: c((x) => x.hg < x.ag) / n,
    };
  } else if (ctx.h2h && ctx.h2h.n) {
    // Aggregate-only fallback (no scorelines): enough for the headline rates.
    const n = ctx.h2h.n;
    h2h = {
      n,
      games: [],
      btts: ctx.h2h.bttsRate,
      bttsNo: 1 - ctx.h2h.bttsRate,
      o25: ctx.h2h.over25Rate,
      u25: 1 - ctx.h2h.over25Rate,
      draw: ctx.h2h.draws / n,
      homeWin: ctx.h2h.homeWins / n,
      awayWin: ctx.h2h.awayWins / n,
    };
  }

  // ---------------------------------------------------------- favourite / underdog
  const odds = match.odds || null;
  let market1x2 = null;
  if (odds && odds.homeClose > 1 && odds.awayClose > 1 && odds.drawClose > 1) {
    const vig = M.removeVig([odds.homeClose, odds.drawClose, odds.awayClose]);
    if (vig) market1x2 = { home: vig.fair[0], draw: vig.fair[1], away: vig.fair[2], margin: vig.margin };
  }
  const src = market1x2 || { home: pr.home, draw: pr.draw, away: pr.away };
  let favSide = null;
  if (Math.abs(src.home - src.away) >= 0.06) favSide = src.home > src.away ? 'home' : 'away';
  const bookPrice = (side) => (odds ? (side === 'home' ? odds.homeClose : odds.awayClose) : null);
  const favPrice = favSide ? bookPrice(favSide) || 1 / (favSide === 'home' ? pr.home : pr.away) : null;
  const fav = {
    side: favSide,
    dog: favSide ? (favSide === 'home' ? 'away' : 'home') : null,
    price: favPrice,
    source: favSide ? (bookPrice(favSide) ? 'book' : 'model') : null,
    prob: favSide ? src[favSide] : null,
    heavy: !!(favPrice && favPrice < CFG.heavyFavPrice),
    gap: Math.abs(src.home - src.away),
  };

  // ---------------------------------------------------------- news, rest, coverage
  const newsRisk = i.newsRisk || null;
  const positions = newsPositions(newsRisk);
  const kickoff = match.date;
  const lastDate = (side) => {
    const g = sides[side].games[0];
    if (g && g.date) return g.date;
    const f = form[side];
    return f && f.lastGameDate ? f.lastGameDate : null;
  };
  const rest = {
    home: daysBetween(lastDate('home'), kickoff),
    away: daysBetween(lastDate('away'), kickoff),
  };

  const homeRow = ctx.homeRow || null;
  const awayRow = ctx.awayRow || null;
  const coverage = {
    basis,
    xg: !!(homeRow && awayRow && homeRow.xg && awayRow.xg),
    sample: { home: sides.home.n, away: sides.away.n },
    odds1x2: !!market1x2,
    asian: !!ctx.asian,
    newsScanned: !!(newsRisk && newsRisk.scanned),
    elo: !!i.elo,
    history: !!hist,
  };

  const league =
    hist && hist.leagueRates
      ? {
          source: 'results',
          o25: hist.leagueRates.over25Rate,
          btts: hist.leagueRates.bttsRate,
          goals: hist.leagueRates.goalsPerGame,
          homeWin: hist.leagueRates.homeWinRate,
          draw: hist.leagueRates.drawRate,
          awayWin: hist.leagueRates.awayWinRate,
        }
      : ctx.baseline && ctx.baseline.goalsPerGame
        ? { source: 'espn', o25: null, btts: null, goals: ctx.baseline.goalsPerGame, homeWin: null, draw: null, awayWin: null }
        : { source: 'none', o25: null, btts: null, goals: null, homeWin: null, draw: null, awayWin: null };

  const view = {
    match,
    names: { home: match.home.name, away: match.away.name },
    lam: { home: lamH, away: lamA, total: lamH + lamA },
    sm,
    pr,
    markets: byKey,
    sides,
    h2h,
    fav,
    market1x2,
    elo: i.elo || null,
    news: newsRisk,
    positions,
    rest,
    coverage,
    league,
    standings: ctx.standings || { home: null, away: null },
    xg: {
      home: homeRow && homeRow.xg ? homeRow.xg : null,
      away: awayRow && awayRow.xg ? awayRow.xg : null,
      homeA: homeRow && homeRow.xga ? homeRow.xga : null,
      awayA: awayRow && awayRow.xga ? awayRow.xga : null,
    },
    crossLeague: model.crossLeague || null,
  };

  /** Asian handicap probabilities for `side` taking handicap `line` (e.g. home -1). */
  view.ah = (side, line) => {
    const sign = side === 'home' ? 1 : -1;
    let win = 0;
    let push = 0;
    let lose = 0;
    for (let a = 0; a <= M.MAX_GOALS; a++) {
      for (let b = 0; b <= M.MAX_GOALS; b++) {
        const d = sign * (a - b) + line;
        const p = sm.m[a][b];
        if (d > 0.0001) win += p;
        else if (d < -0.0001) lose += p;
        else push += p;
      }
    }
    const dec = win + lose;
    return { win, push, lose, probExPush: dec > 0 ? win / dec : 0 };
  };

  /** Top scorelines (i-j) matching `pred`, most likely first. */
  view.topScores = (pred, n = 3) => {
    const rows = [];
    for (let a = 0; a <= 6; a++) for (let b = 0; b <= 6; b++) if (pred(a, b)) rows.push({ s: `${a}-${b}`, p: sm.m[a][b] });
    rows.sort((x, y) => y.p - x.p);
    return rows.slice(0, n);
  };
  view.mass = (pred) => S(pred);

  return view;
}

// ============================================================ price discipline

/**
 * Judge a market's price against the methodology's edge standard.
 * @returns {{state:'edge'|'no-edge'|'too-short'|'unpriced', price?:number, source?:string, implied?:number, ratio?:number, reqRatio?:number, ev?:number, books?:number, note:string}}
 */
function priceState(mk, spec) {
  if (!mk) return { state: 'unpriced', note: 'Market not derived for this fixture.' };
  const real = mk.priceSource && String(mk.priceSource).startsWith('book');
  if (!real || !(mk.price > 1)) {
    return {
      state: 'unpriced',
      note: 'No bookmaker quote is available for this market. Compare the fair odds below with your own bookmaker\'s price.',
    };
  }
  const implied = 1 / mk.price;
  const reqRatio = Math.max(spec.minRatio || 1.05, 1 + CFG.edgeSlope * mk.price);
  const ratio = mk.prob / implied;
  const base = {
    price: mk.price,
    source: mk.priceSource,
    implied,
    ratio,
    reqRatio,
    ev: mk.prob * mk.price - 1,
    books: mk.priceBooks || null,
  };
  const minPrice = spec.minPrice != null ? spec.minPrice : CFG.minPrice;
  if (mk.price < minPrice) {
    return { ...base, state: 'too-short', note: `Price ${f2(mk.price)} is below the ${f2(minPrice)} floor — right or wrong, there is nothing to win (Rule 7).` };
  }
  if (ratio >= reqRatio) {
    return { ...base, state: 'edge', note: `Model ${pct(mk.prob, 1)} is ${f2(ratio)}x the price-implied ${pct(implied, 1)} (needs ${f2(reqRatio)}x).` };
  }
  return { ...base, state: 'no-edge', note: `Model ${pct(mk.prob, 1)} is only ${f2(ratio)}x the price-implied ${pct(implied, 1)}; this methodology needs ${f2(reqRatio)}x.` };
}

// ============================================================ evaluation

const STATUS_RANK = { LOCK: 5, PREDICT: 4, PAPER: 3, WATCH: 2, REMOVE: 1 };

function tierFor(score) {
  if (score >= 88) return 'Platinum';
  if (score >= 80) return 'Gold';
  if (score >= 70) return 'Silver';
  return 'Bronze';
}

/**
 * Evaluate ONE candidate selection of a spec.
 *
 * @param {object} spec
 * @param {object} V      fixture view
 * @param {object} cand   { key, label, group, ...anything spec.build wants }
 */
function evaluateCandidate(spec, V, cand) {
  const mk = V.markets[cand.key] || null;
  const prob = cand.prob != null ? cand.prob : mk ? mk.prob : null;
  const built = spec.build(V, cand, mk) || { gates: [], checklist: [] };

  // The universal gates every methodology carries, in a fixed order.
  const gates = [];
  const floor = cand.floor != null ? cand.floor : spec.floor;
  gates.push(
    G('MODEL', 'Model probability clears the market floor',
      prob == null ? null : prob >= floor,
      prob == null ? null : pct(prob, 1), `≥ ${pct(floor)}`,
      { rule: 'Gate 1 / Rule 28' })
  );
  const minN = spec.minSample || CFG.minSample;
  const nH = V.sides.home.n;
  const nA = V.sides.away.n;
  gates.push(
    G('SAMPLE', `Both sides have ≥ ${minN} games of evidence`,
      nH >= minN && nA >= minN, `${nH} / ${nA} (${V.coverage.basis})`, `≥ ${minN} each`,
      { rule: 'Rule 5', note: spec.minSample ? 'This market needs a larger sample than the default.' : null })
  );
  for (const g of built.gates) gates.push(g);

  const items = built.checklist || [];
  const known = items.filter((c) => !c.unknown);
  const max = known.length;
  const total = known.reduce((a, c) => a + c.score, 0);
  const passed = known.filter((c) => c.score >= 0.5).length;
  const ratio = max ? passed / max : 0; // pass ratio: the qualification test
  const quality = max ? total / max : 0; // mean item score: ranking only
  const knownShare = items.length ? known.length / items.length : 0;
  const thin = knownShare < CFG.minKnown;
  const failed = gates.filter((g) => !g.pass);
  const hardOk = failed.length === 0;

  const price = priceState(mk, spec);
  if (price.state === 'unpriced' && spec.priceNote) price.note = spec.priceNote;

  let status;
  if (!hardOk) status = 'REMOVE';
  else if (ratio >= CFG.qualify && thin) status = 'WATCH';
  else if (ratio >= CFG.qualify) {
    if (spec.paperOnly) status = 'PAPER';
    else if (price.state === 'edge' && spec.canLock !== false) status = 'LOCK';
    else status = 'PREDICT';
  } else if (ratio >= CFG.watch) status = 'WATCH';
  else status = 'REMOVE';

  // ---- score 0-100 -------------------------------------------------------
  // Probability margin over the floor (how comfortably it clears), checklist
  // quality, data coverage, and price standing. Deliberately transparent.
  const ceil = spec.ceiling || 0.85;
  const margin = prob == null ? 0 : clamp01((prob - floor) / Math.max(0.05, ceil - floor));
  const cover =
    (V.coverage.sample.home >= CFG.strongSample && V.coverage.sample.away >= CFG.strongSample ? 0.5 : 0.25) +
    (V.coverage.xg ? 0.25 : 0) +
    (V.coverage.newsScanned ? 0.15 : 0) +
    (V.coverage.odds1x2 ? 0.1 : 0);
  const priceScore = price.state === 'edge' ? 1 : price.state === 'unpriced' ? 0.45 : price.state === 'no-edge' ? 0.3 : 0.15;
  const score = Math.round(100 * (0.4 * (0.5 * ratio + 0.5 * quality) + 0.3 * margin + 0.18 * clamp01(0.5 * cover + 0.5 * knownShare) + 0.12 * priceScore));

  const support = [];
  const failure = [];
  const flags = [...(built.flags || [])];
  if (prob && 1 / prob < (spec.minPrice != null ? spec.minPrice : CFG.minPrice) && price.state === 'unpriced') {
    flags.push(`Fair odds are only ${f2(1 / prob)} — below the ${f2(CFG.minPrice)} floor, so this is likely too short to be worth a stake (Rule 7).`);
  }
  if (thin) flags.push(`Only ${known.length} of ${items.length} checklist items have evidence — too thin to qualify (needs ${Math.round(CFG.minKnown * 100)}%).`);
  if (built.support) support.push(...built.support);
  if (built.failure) failure.push(...built.failure);

  return {
    id: spec.id,
    name: spec.name,
    version: spec.version,
    family: spec.family,
    pick: {
      key: cand.key,
      label: cand.label || (mk && mk.label) || cand.key,
      group: cand.group || (mk && mk.group) || spec.family,
    },
    status,
    qualifies: status === 'LOCK' || status === 'PREDICT' || status === 'PAPER',
    prob,
    fairOdds: prob ? 1 / prob : null,
    floor,
    price,
    score,
    tier: tierFor(score),
    gates,
    failedGates: failed.map((g) => g.id),
    checklist: {
      items,
      total: Math.round(total * 100) / 100,
      max,
      ratio,
      need: CFG.qualify,
      passed,
      quality,
      known: known.length,
      of: items.length,
      thin,
    },
    support,
    failure,
    flags,
    sample: { home: V.sides.home.sample, away: V.sides.away.sample, basis: V.coverage.basis },
    maxLegs: spec.maxLegs || null,
    stake: spec.stake || null,
    paperOnly: !!spec.paperOnly,
    candidates: cand.siblings || null,
  };
}

/**
 * Evaluate a spec: every candidate selection, keeping the best.
 * Candidate order of preference: status rank, then score.
 */
function evaluateSpec(spec, V) {
  let cands;
  try {
    cands = spec.candidates ? spec.candidates(V) : [{ key: spec.marketKey }];
  } catch (err) {
    cands = [];
  }
  if (!cands || !cands.length) {
    return {
      id: spec.id,
      name: spec.name,
      version: spec.version,
      family: spec.family,
      pick: { key: null, label: spec.name, group: spec.family },
      status: 'REMOVE',
      qualifies: false,
      prob: null,
      fairOdds: null,
      floor: spec.floor,
      price: { state: 'unpriced', note: '' },
      score: 0,
      tier: 'Bronze',
      gates: [G('APPLIES', 'Methodology applies to this fixture', false, spec.notApplicable ? spec.notApplicable(V) : 'no candidate selection', 'a clear candidate')],
      failedGates: ['APPLIES'],
      checklist: { items: [], total: 0, max: 0, ratio: 0, need: CFG.qualify, passed: 0, quality: 0, known: 0, of: 0, thin: true },
      support: [],
      failure: [],
      flags: [],
      sample: { home: V.sides.home.sample, away: V.sides.away.sample, basis: V.coverage.basis },
      maxLegs: spec.maxLegs || null,
      stake: spec.stake || null,
      paperOnly: !!spec.paperOnly,
      candidates: null,
    };
  }

  const results = [];
  for (const cand of cands) {
    try {
      results.push(evaluateCandidate(spec, V, cand));
    } catch (err) {
      // A bug in one rule must never take the fixture down; surface it as a gate.
      results.push({
        ...evaluateCandidate({ ...spec, build: () => ({ gates: [G('ERROR', 'Rule evaluation error', false, String(err.message || err), 'no error')], checklist: [] }) }, V, cand),
      });
    }
  }
  // Among candidates with the same status prefer one that actually pays: a pick whose
  // fair odds sit under the price floor is "right" but worthless (Rule 7), so it ranks
  // behind any alternative on the same methodology that clears the floor.
  const worth = (r) => (r.fairOdds && r.fairOdds >= (spec.minPrice != null ? spec.minPrice : CFG.minPrice) ? 1 : 0);
  results.sort((a, b) => STATUS_RANK[b.status] - STATUS_RANK[a.status] || worth(b) - worth(a) || b.score - a.score);
  const best = results[0];
  if (results.length > 1) {
    best.candidates = results.map((r) => ({ key: r.pick.key, label: r.pick.label, status: r.status, prob: r.prob, score: r.score }));
  }
  return best;
}

/** One-line explanation of how a market most likely loses (Rule 6 / Rule 14). */
function lossCase(V, losesFn, label) {
  const top = V.topScores(losesFn, 3);
  const mass = V.mass(losesFn);
  if (!top.length) return `${label}: no realistic losing scoreline.`;
  const list = top.map((t) => `${t.s} (${pct(t.p, 1)})`).join(', ');
  return `${label} loses ${pct(mass, 1)} of the time — most likely on ${list}.`;
}

module.exports = {
  CFG,
  G,
  C,
  clamp01,
  pct,
  f2,
  sideEvidence,
  newsPositions,
  buildView,
  CALIBRATION,
  calibrateProb,
  calibrateMarkets,
  priceState,
  evaluateCandidate,
  evaluateSpec,
  lossCase,
  tierFor,
  STATUS_RANK,
};
