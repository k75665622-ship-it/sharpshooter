'use strict';

/**
 * strongest/config.js — every number the Strongest Picks section uses, in one place.
 *
 * Change a threshold here and the whole section follows: the API, the page and the
 * track record. Nothing in lib/strongest hard-codes these values.
 */

module.exports = {
  version: '2.0',

  // ---- the Strongest Picks list (one pick per match, no fixed number of picks)
  // The MEASURED chance (lib/strongest/calibrate.js: what selections like it actually won on
  // past matches) must reach this... Chosen on 2019-23 (research/v6/strongest_report.js --sim):
  // every bar from 75% to 84% was honest there, so the bar only sets how strong "strongest" is;
  // at 84% picks won 86.9% (stated 86.7%) on about 22 a match day, at 75% 85.3% on 34.
  minChance: 0.84,
  // ...and corners and bookings, which have no bookmaker price of their own, this.
  minChanceStatsOnly: 0.86,
  // Every independent view must still rate the pick at least this likely (agreement).
  floor: 0.75,
  // Corners and bookings: every view (form + price, season, last 6) at least this.
  floorStatsOnly: 0.75,
  // When a match has both kinds of qualifying pick, corners and bookings rank this far below
  // a bookmaker-anchored one.
  statsOnlyPenalty: 0.03,
  // Above this the selection pays too little to be worth a place (fair odds under 1.14). For
  // goal markets it is the bookmakers' own probability that counts: they set the price.
  maxProb: 0.88,
  // Markets kept off the list because they did not hold their stated chance on past matches
  // (research/v6/strongest_context.js), whatever their figures say on the day. They stay on
  // the match cards.
  //   Team under 1.5 goals: at 84%+ measured it won 1-3 points less than stated in BOTH
  //   periods (2019-23: -0.9 to -1.6 points on 2,359 selections; 2023-26: -1.7 to -4.4 on
  //   1,270, worst against a heavy favourite). Added after the held-out check, so its effect
  //   on the measured record is not a clean out-of-sample test (research/v6/RESULTS.md, 7).
  excluded: ['TTH_U1.5', 'TTA_U1.5'],
  // At least this many independent views must exist for a pick to qualify.
  minViews: 2,
  // Archive games each team needs before corners and bookings can qualify.
  minGamesStatsOnly: 8,
  // The v6 factors say the bookmakers overrate a selection when v6 - price <= this.
  // Same threshold the site's main pick uses (lib/intel/decision.js trapShift).
  trapShift: -0.015,
  // Near misses shown when a match has no qualifying pick but its measured chance is close.
  nearMissFloor: 0.8,

  // Strength labels on the list, by the measured chance.
  tiers: [
    { min: 0.87, name: 'Elite' },
    { min: 0.84, name: 'Strong' },
    { min: 0.8, name: 'Solid' },
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
