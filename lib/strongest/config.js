'use strict';

/**
 * strongest/config.js — every number the Strongest Picks section uses, in one place.
 *
 * Change a threshold here and the whole section follows: the API, the page and the
 * track record. Nothing in lib/strongest hard-codes these values.
 */

module.exports = {
  version: '1.0',

  // ---- the Strongest Picks list (one pick per match, no fixed number of picks)
  // A pick joins the list only when EVERY independent view rates it at least this likely.
  floor: 0.75,
  // Corners and bookings have no bookmaker price on free data, so both of their views
  // must clear a higher bar...
  floorStatsOnly: 0.8,
  // ...and when a match has both kinds of qualifying pick, they rank this far below a
  // bookmaker-anchored one (their views share one archive, so they are less independent).
  statsOnlyPenalty: 0.03,
  // Above this the selection pays too little to be worth a place (fair odds under 1.14).
  maxProb: 0.88,
  // At least this many independent views must exist for a pick to qualify.
  minViews: 2,
  // Archive games each team needs before corners and bookings can qualify.
  minGamesStatsOnly: 8,
  // The v6 factors say the bookmakers overrate a selection when v6 - price <= this.
  // Same threshold the site's main pick uses (lib/intel/decision.js trapShift).
  trapShift: -0.015,
  // Near misses shown when a match has no qualifying pick but its best view is close.
  nearMissFloor: 0.68,

  // Strength labels on the list, by the LOWEST view.
  tiers: [
    { min: 0.85, name: 'Elite' },
    { min: 0.8, name: 'Strong' },
    { min: 0.75, name: 'Solid' },
  ],

  // ---- the nine-market card for each match
  cardMinProb: 0.4,
  cardMinProbPlayers: 0.15,
  // Confidence labels on the match cards, by the lowest view.
  cardLevels: [
    { min: 0.7, name: 'High' },
    { min: 0.55, name: 'Medium' },
    { min: 0, name: 'Low' },
  ],

  // ---- goal timing
  // Share of goals scored before half-time when a league's own share cannot be measured.
  // The site's half-time markets use the same default (lib/model.js deriveMarkets).
  firstHalfShare: 0.44,
  // A league's measured first-half share is shrunk toward the default with this many matches.
  firstHalfPrior: 200,
  // Goals in minutes 1-15 and 1-30 as a share of first-half goals (large-sample goal timing:
  // about 13% of all goals come in 1-15, 28% in 1-30 and 45% before half-time).
  min15OfFirstHalf: 0.289,
  min30OfFirstHalf: 0.622,

  // ---- corners and bookings (football-data.co.uk archive)
  seasonGames: 20, // games in the season view (venue split uses up to 10 at the venue)
  recentGames: 6, // games in the recent-form view
  shrinkGames: 6, // team rates are shrunk toward the league average with this many games
  leagueDays: 365, // league baselines use the last year of matches
  leagueMinMatches: 100,
  cornersDispersion: 8, // negative-binomial dispersion when the league's cannot be measured
  cardsDispersion: 6,
  dispersionRange: [3, 40],
  refereeMinGames: 8,
  refereeShrinkGames: 10,
  refereeRange: [0.8, 1.25],
  h2hShrinkGames: 6,
  h2hRange: [0.85, 1.2],

  // ---- players
  // Players' xG shares (FPL) or goal shares (ESPN) are capped, so one hot streak cannot
  // claim most of a team's goals.
  maxShare: 0.5,
  // Chance a player is involved when nothing is known about his availability.
  defaultInvolvement: 0.85,
  benchInvolvement: 0.35,

  // ---- track record
  settleGraceHours: 2.5,
  voidAfterDays: 10,
  settleEveryMinutes: 10,

  // ---- caching
  dayCacheMinutes: 5,
};
