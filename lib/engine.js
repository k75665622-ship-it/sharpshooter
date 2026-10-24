'use strict';

/**
 * engine.js — the orchestrator.
 *
 * Full pipeline for one match:
 *
 *   data  ->  ratings  ->  expected goals  ->  Dixon-Coles score matrix
 *         ->  every market priced
 *         ->  patterns (visible + hidden)
 *         ->  line-movement / sharp-money read
 *         ->  bookmaker trap vetoes
 *         ->  sharpshooter scoring
 *         ->  ONE banker market elected
 *
 * Nothing here guesses. If a required input is missing, the market is vetoed
 * and the reason is surfaced to the UI.
 */

const A = require('./analysis');
const M = require('./model');
const S = require('./signals');
const news = require('./news');
const L = require('./leagues');
const MI = require('./methodology');
const ENS = require('./ensemble');
const ODDS = require('./sources/odds');
const FPL = require('./sources/fpl');
const PR = require('./pricing');
const GEN = require('./general');
const INTEL = require('./intel');

const BANKER_TIERS = [
  { min: 88, name: 'Platinum', label: 'Platinum Banker', blurb: 'Every gate cleared with room to spare.' },
  { min: 80, name: 'Gold', label: 'Gold Banker', blurb: 'Strong across model, market and pattern checks.' },
  { min: 70, name: 'Silver', label: 'Silver Lean', blurb: 'Solid but with a minor caveat attached.' },
];

/** Analyse a single match end-to-end. */
async function analyseMatch(match, year) {
  const ctx = await A.buildContext(match, year);
  const hasStats = !!(ctx.homeRow && ctx.awayRow);
  const evRatings = ctx.evidence && ctx.evidence.ratings ? ctx.evidence.ratings : null;

  // ---- v5 components ----
  // xG component: the v4 season formula. Needs ESPN team statistics.
  let lambdas = null;
  if (hasStats) {
    lambdas = M.estimateLambdas({
      home: ctx.homeRow,
      away: ctx.awayRow,
      league: ctx.baseline,
      form: ctx.form,
      h2h: ctx.h2h,
      homeStrength: ctx.homeStrength,
      awayStrength: ctx.awayStrength,
    });
  }
  // Premier League availability (FPL) adjusts the MODEL components only — the market
  // already prices published team news.
  const adj = FPL.lambdaAdjust(ctx.fpl);
  const xgComp = lambdas ? { lamH: lambdas.lamH * adj.home, lamA: lambdas.lamA * adj.away } : null;
  const ratingsComp = evRatings ? { lamH: evRatings.lamH * adj.home, lamA: evRatings.lamA * adj.away, confidence: evRatings.confidence } : null;
  const priorTotal = ctx.baseline && ctx.baseline.goalsPerGame ? ctx.baseline.goalsPerGame : 2.6;
  const marketComp = ODDS.impliedLambdas(ctx.consensus, priorTotal);
  const eloDiff = ctx.elo ? ctx.elo.home - ctx.elo.away : null;
  const ens = ENS.combine({ market: marketComp, ratings: ratingsComp, xg: xgComp, eloDiff });

  // ---- If nothing can rate the fixture, say so, and say why. ----
  if (!ens) {
    const missing = [];
    if (!ctx.homeRow) missing.push(match.home.name);
    if (!ctx.awayRow) missing.push(match.away.name);
    const uncovered = new Set(L.UNCOVERED_SLUGS);
    const hints = [];
    for (const side of ['home', 'away']) {
      const row = side === 'home' ? ctx.homeRow : ctx.awayRow;
      if (row) continue;
      const league = side === 'home' ? ctx.homeStatsLeague : ctx.awayStatsLeague;
      const name = side === 'home' ? match.home.name : match.away.name;
      if (league && uncovered.has(league)) hints.push(`${name} plays in a league ESPN does not cover`);
      else hints.push(`${name} has no season statistics on file`);
    }
    return {
      match,
      analysable: false,
      reason: `No prediction issued — ${missing.length ? missing.join(' and ') + ' could not be rated' : 'the fixture could not be rated'}, `
        + 'and no verified results history or bookmaker price was available to rate it another way. '
        + (hints.length ? hints.join('; ') + '. ' : '')
        + 'Rather than estimate from nothing, the engine stands down on this fixture.',
      missingTeams: missing,
      baseline: ctx.baseline,
      news: ctx.news,
      asian: ctx.asian,
      patterns: { visible: [], hidden: [] },
      markets: [],
      banker: null,
      methodology: null,
      general: null,
    };
  }

  const sm = ens.sm;
  const lamH = ens.lamH;
  const lamA = ens.lamA;
  const rho = sm.rho;

  // ---- Markets: every market from ONE matrix, then calibrated (lib/calibration.json) ----
  let markets = ENS.deriveMarkets(ens);
  const byKey = Object.fromEntries(markets.map((m) => [m.key, m]));
  const pHome = byKey['1'].prob;
  const pDraw = byKey.X.prob;
  const pAway = byKey['2'].prob;

  const model = {
    lambda: { home: lamH, away: lamA },
    rho,
    oneXtwo: { pHome, pDraw, pAway },
    totalGoals: M.totalGoalsDist(sm),
    ratings: lambdas ? lambdas.ratings : null,
    sampleConfidence: lambdas ? lambdas.sampleConfidence : evRatings ? evRatings.confidence : 0,
    components: lambdas ? lambdas.components : {},
    crossLeague: lambdas ? lambdas.crossLeague : null,
    baseline: ctx.baseline,
    statsLeague: { home: ctx.homeStatsLeague, away: ctx.awayStatsLeague },
    ensemble: {
      components: ens.components,
      weights: ens.weights,
      calibrationSet: ens.calibrationSet,
      agreement: { supremacySpread: ens.agreement.supremacySpread, totalSpread: ens.agreement.totalSpread },
      modelLambda: ens.model,
      fplAdjust: ctx.fpl ? adj : null,
    },
  };

  // Priced from ESPN/DraftKings first, then the Asian consensus for the markets
  // ESPN does not quote, then our own fair odds as a labelled fallback (v4), and
  // then the v5 multi-book consensus / best price / value price on top.
  markets = S.attachPrices(markets, match.odds, ctx.asian);
  PR.attach(markets, ctx.consensus);

  // ---- Patterns & sharp-money read ----
  const patterns = S.detectPatterns(ctx);
  const lineMovement = S.analyseLineMovement(match.odds);

  // ---- Team news ----
  // Scanned once per fixture, then applied per market so that a reported absence
  // only penalises the markets it actually threatens.
  const newsRisk = news.scanNews(ctx.news, ctx);

  // ---- Score every market ----
  for (const mk of markets) {
    const res = S.scoreMarket(ctx, mk, model, match.odds, patterns, newsRisk, ctx.asian);
    mk.score = res.score;
    mk.vetoed = res.vetoed;
    mk.traps = res.traps;
    mk.components = res.components;
    mk.isBanker = false;
  }

  // ---- Methodology layer ----
  // Every market methodology (Over/Under 2.5, BTTS Yes/No, GG/NG 2+, Team Goals,
  // Home/Draw/Away, Underdog + and Favourite − handicaps) is evaluated against
  // this fixture. A fixture is predicted on a market when, and only when, it
  // clears that market's hard gates and checklist. This is the PRIMARY output.
  let methodology = null;
  try {
    methodology = MI.summarise(MI.evaluateFixture({ match, sm, model, markets, ctx, newsRisk, hist: ctx.hist, elo: ctx.elo, ens, fpl: ctx.fpl, consensus: ctx.consensus }));
  } catch (err) {
    // A methodology fault must never take the fixture down; say so instead.
    methodology = { error: String(err && err.message ? err.message : err), predictions: [], headline: null, all: [], dropped: [] };
  }

  // ---- Legacy sharpshooter banker (kept for API compatibility; superseded by `methodology`) ----
  const banker = electBanker(markets, model, ctx);

  // If nothing qualified as a banker, surface the best available candidate as a
  // clearly-labelled LEAN. This is never presented as a banker — it exists so a
  // day with no qualifying fixture still produces something honest and useful.
  const lean = banker ? null : electLean(markets);

  const verdict = buildVerdict(ctx, model, patterns, lineMovement, banker, newsRisk);

  // ---- v6 match intelligence: 170 measured factors, the decision, traps and patterns ----
  let intel = null;
  try {
    intel = await INTEL.analyse(match, ctx, markets);
  } catch (err) {
    intel = { available: false, version: '6.0', reason: `match intelligence failed: ${String(err && err.message ? err.message : err)}` };
  }

  // ---- general prediction for EVERY analysable fixture (v6 when the intelligence is available) ----
  let general = null;
  try {
    general = GEN.predict({ match, ens, markets, model, ctx, methodology, intel });
  } catch (err) {
    general = { error: String(err && err.message ? err.message : err) };
  }

  return {
    match,
    analysable: true,
    model,
    patterns,
    lineMovement,
    markets,
    methodology,
    banker,
    lean,
    verdict,
    news: ctx.news,
    newsRisk,
    fpl: ctx.fpl || null,
    consensus: ctx.consensus || null,
    general,
    intel,
    asian: ctx.asian,
    pickcenter: ctx.pickcenter,
    h2h: ctx.h2h,
    form: ctx.form,
    standings: ctx.standings,
    baseline: ctx.baseline,
    dataProvenance: {
      baselineSource: ctx.baseline.source,
      hasStats,
      hasXg: !!(hasStats && ctx.homeRow.xg && ctx.awayRow.xg),
      hasH2h: !!ctx.h2h,
      hasForm: !!(ctx.form.home && ctx.form.away),
      hasOdds: !!match.odds,
      statsSample: { home: ctx.homeRow ? ctx.homeRow.gp : 0, away: ctx.awayRow ? ctx.awayRow.gp : 0 },
      newsScanned: newsRisk.scanned,
      newsRisk: { home: newsRisk.home.level, away: newsRisk.away.level },
      asianBooks: ctx.asian ? ctx.asian.books.length : 0,
      asianLines: ctx.asian ? { totals: ctx.asian.lines.totals, ah: ctx.asian.lines.ah } : null,
      asianNote: ctx.asian ? null : (ctx.asianNote || null),
      hasHistory: !!ctx.hist,
      historySource: ctx.hist ? ctx.hist.source : null,
      historySample: ctx.hist ? { home: ctx.hist.home.games.length, away: ctx.hist.away.games.length } : null,
      hasElo: !!ctx.elo,
      // v5 evidence and pricing provenance
      results: ctx.evidence ? ctx.evidence.provenance : null,
      historyVerifiedShare: ctx.hist && ctx.hist.provenance ? ctx.hist.provenance.verifiedShare : null,
      hasRatings: !!evRatings,
      hasFpl: !!ctx.fpl,
      books: ctx.consensus ? ctx.consensus.books : [],
      nBooks: ctx.consensus ? ctx.consensus.nBooks : 0,
      ensemble: { weights: ens.weights, calibration: ens.calibrationSet },
      verifiedMarkets: markets.filter((m) => m.verified).length,
      totalMarkets: markets.length,
    },
  };
}

/**
 * Banker election.
 *
 * A market must clear ALL of these to be eligible:
 *   1. not vetoed by any hard trap
 *   2. model probability above its market-specific floor
 *   3. sharpshooter score above the eligibility threshold
 *   4. if a real price exists, expected value not meaningfully negative
 *   5. no HIGH-severity trap, unless the score is exceptional
 *
 * Exactly one market is elected per match — the safest one, not the most
 * profitable one.
 */
function electBanker(markets, model, ctx) {
  const MIN_SCORE = 70;

  const eligible = markets.filter((mk) => {
    // Must be a market we would actually call a banker.
    if (!S.isBankerEligible(mk.key)) return false;
    if (mk.vetoed) return false;
    // Must have a real, checkable bookmaker price — synthetic-only markets
    // cannot be value-verified, so they are never elected.
    if (!mk.verified) return false;
    if (!(mk.price >= S.BANKER_MIN_PRICE)) return false;

    const floor = S.BANKER_FLOOR[mk.group] || 0.6;
    if (mk.prob < floor) return false;
    if (mk.score < MIN_SCORE) return false;
    if (mk.ev != null && mk.ev < -0.03) return false;

    const highTraps = (mk.traps || []).filter((t) => t.severity === 'high');
    if (highTraps.length >= 2) return false;
    if (highTraps.length === 1 && mk.score < 78) return false;
    return true;
  });

  if (!eligible.length) {
    // Report the best near-miss so the UI can explain why nothing qualified.
    const best = markets
      .filter((mk) => !mk.vetoed)
      .sort((a, b) => b.score - a.score)[0];
    return null;
  }

  eligible.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.prob - a.prob;
  });

  const pick = eligible[0];
  pick.isBanker = true;

  const tier = BANKER_TIERS.find((t) => pick.score >= t.min) || BANKER_TIERS[BANKER_TIERS.length - 1];

  // Honesty note on price. A banker is chosen for SAFETY, so when our model
  // broadly agrees with the book the expected value sits near zero or slightly
  // negative once the margin is paid. Say so rather than implying value.
  const notes = [...(pick.traps || [])];
  if (pick.valuePct != null) {
    if (pick.valuePct <= -1) {
      notes.push({
        id: 'negative_ev',
        label: 'No value at this price',
        detail: `Expected value is ${pick.valuePct.toFixed(1)}% at ${pick.price.toFixed(2)}. Selected for safety, not value — the model essentially agrees with the book.`,
        severity: 'info',
      });
    } else if (pick.valuePct >= 1) {
      notes.push({
        id: 'positive_ev',
        label: 'Positive expected value',
        detail: `Expected value is +${pick.valuePct.toFixed(1)}% at ${pick.price.toFixed(2)} — the model rates this above the market.`,
        severity: 'info',
      });
    }
  }

  return {
    key: pick.key,
    label: pick.label,
    group: pick.group,
    prob: pick.prob,
    fairOdds: pick.fairOdds,
    price: pick.price,
    priceSource: pick.priceSource,
    verified: pick.verified,
    edge: pick.edge,
    ev: pick.ev,
    valuePct: pick.valuePct,
    score: pick.score,
    tier: tier.name,
    tierLabel: tier.label,
    tierBlurb: tier.blurb,
    traps: notes,
    components: pick.components,
    alternatives: eligible.slice(1, 4).map((m) => ({
      key: m.key,
      label: m.label,
      group: m.group,
      prob: m.prob,
      price: m.price,
      score: m.score,
    })),
  };
}

/**
 * Best available candidate when nothing clears the banker bar.
 *
 * Deliberately stricter than "highest score": it still refuses vetoed markets
 * and still requires a sensible price and probability, so a lean is a genuine
 * near-miss rather than the least-bad option on a bad match.
 */
function electLean(markets) {
  const pool = markets.filter((mk) => {
    if (mk.vetoed) return false;
    if (!S.isBankerEligible(mk.key)) return false;
    const floor = S.BANKER_FLOOR[mk.group] || 0.6;
    // Allow a slightly lower bar than the banker floor, but not by much.
    if (mk.prob < floor * 0.94) return false;
    if (mk.price != null && mk.price < 1.2) return false;
    return true;
  });
  if (!pool.length) return null;
  pool.sort((a, b) => b.score - a.score);
  const p = pool[0];
  return {
    key: p.key,
    label: p.label,
    group: p.group,
    prob: p.prob,
    fairOdds: p.fairOdds,
    price: p.price,
    priceSource: p.priceSource,
    verified: p.verified,
    edge: p.edge,
    valuePct: p.valuePct,
    score: p.score,
    traps: p.traps || [],
    note: 'Did not clear every banker gate — shown as a lean only.',
  };
}

/** Human-readable verdict assembled from the machine output. */
function buildVerdict(ctx, model, patterns, lineMovement, banker, newsRisk) {
  const { match } = ctx;
  const { pHome, pDraw, pAway } = model.oneXtwo;

  const mostLikely = [
    { k: '1', label: `${match.home.name} win`, p: pHome },
    { k: 'X', label: 'Draw', p: pDraw },
    { k: '2', label: `${match.away.name} win`, p: pAway },
  ].sort((a, b) => b.p - a.p)[0];

  const keyFactors = [];
  if (model.components && model.components.form) keyFactors.push('Recent form blended into expected goals');
  if (ctx.h2h) keyFactors.push(`Head-to-head history across ${ctx.h2h.n} meetings`);
  if (model.ratings) {
    const h = model.ratings.home;
    const a = model.ratings.away;
    keyFactors.push(
      `Attack/defence ratings — ${match.home.short} ${h.attack.toFixed(2)}/${h.defence.toFixed(2)}, ${match.away.short} ${a.attack.toFixed(2)}/${a.defence.toFixed(2)}`
    );
  }
  keyFactors.push(`Dixon-Coles low-score correction applied (rho ${model.rho.toFixed(3)})`);

  const risks = [];
  if (patterns.hidden.length) risks.push(...patterns.hidden.slice(0, 3).map((h) => h.label));
  if (lineMovement && lineMovement.flags.length) {
    risks.push(...lineMovement.flags.slice(0, 2).map((f) => `${f.type === 'drift' ? 'Drifting' : 'Steam on'} ${f.label}`));
  }
  if (banker && banker.traps.length) risks.push(...banker.traps.map((t) => t.label));

  // Team news, stated plainly. Only flagged when a side was actually identified.
  const newsNotes = [];
  if (newsRisk) {
    for (const side of ['home', 'away']) {
      const r = newsRisk[side];
      if (r.level === 'none') continue;
      const who = side === 'home' ? match.home.name : match.away.name;
      const worst = r.items.slice().sort((a, b) =>
        ({ high: 3, medium: 2, info: 1 }[b.severity] || 0) - ({ high: 3, medium: 2, info: 1 }[a.severity] || 0))[0];
      newsNotes.push(`${who}: ${r.items.length} report${r.items.length > 1 ? 's' : ''} (${worst.label.toLowerCase()})`);
      risks.push(`${who} team news — ${worst.label.toLowerCase()}`);
    }
    if (!newsNotes.length && newsRisk.scanned) {
      newsNotes.push('No injury, suspension or transfer language found in the published headlines.');
    }
  }

  return {
    mostLikely,
    keyFactors,
    risks,
    newsNotes,
    summary:
      `Model: ${mostLikely.label} ${(mostLikely.p * 100).toFixed(1)}%. ` +
      `Expected goals ${model.lambda.home.toFixed(2)} - ${model.lambda.away.toFixed(2)} ` +
      `(${(model.lambda.home + model.lambda.away).toFixed(2)} total). ` +
      (banker
        ? `Banker: ${banker.label} at ${(banker.prob * 100).toFixed(1)}% (${banker.tier} tier).`
        : 'No market cleared every gate — no banker issued for this fixture.'),
  };
}

/** Best banker across a set of analysed matches. */
function dailyBanker(reports) {
  const withBanker = reports.filter((r) => r && r.analysable && r.banker);
  if (!withBanker.length) return null;
  withBanker.sort((a, b) => b.banker.score - a.banker.score);
  const top = withBanker[0];
  return {
    match: top.match,
    banker: top.banker,
    model: top.model,
    verdict: top.verdict,
    patterns: top.patterns,
    lineMovement: top.lineMovement,
    newsRisk: top.newsRisk,
    dataProvenance: top.dataProvenance,
  };
}

/**
 * Flatten a day's reports into per-methodology prediction lists.
 *
 * @returns {{ headline:Array, byMethod:Object<string,Array>, counts:Object }}
 */
function collectPredictions(reports) {
  const byMethod = {};
  const headline = [];
  for (const r of reports) {
    if (!r || !r.analysable || !r.methodology || !r.methodology.predictions) continue;
    for (const p of r.methodology.predictions) {
      (byMethod[p.id] = byMethod[p.id] || []).push({ match: brief(r.match), prediction: p, model: modelBrief(r.model) });
    }
    if (r.methodology.headline) headline.push({ match: brief(r.match), prediction: r.methodology.headline, model: modelBrief(r.model), dropped: r.methodology.dropped });
  }
  const rank = MI.core.STATUS_RANK;
  const sorter = (a, b) => rank[b.prediction.status] - rank[a.prediction.status] || b.prediction.score - a.prediction.score;
  headline.sort(sorter);
  const counts = {};
  for (const k of Object.keys(byMethod)) {
    byMethod[k].sort(sorter);
    counts[k] = byMethod[k].length;
  }
  return { headline, byMethod, counts };
}

function brief(m) {
  return {
    id: m.id, league: m.league, leagueName: m.leagueName, leagueFlag: m.leagueFlag, leagueTier: m.leagueTier,
    date: m.date, name: m.name, home: m.home, away: m.away, state: m.state, venue: m.venue, odds: m.odds,
    seasonYear: m.seasonYear,
  };
}

function modelBrief(m) {
  return m ? { lambda: m.lambda, oneXtwo: m.oneXtwo } : null;
}

module.exports = { analyseMatch, electBanker, dailyBanker, collectPredictions, buildVerdict, BANKER_TIERS };
