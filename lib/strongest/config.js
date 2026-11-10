'use strict';

/**
 * strongest/config.js — every number the Strongest Picks section uses, in one place.
 *
 * Change a threshold here and the whole section follows: the API, the page and the
 * track record. Nothing in lib/strongest hard-codes these values.
 */

module.exports = {
  version: '3.1',

  // ---- the Strongest Picks list (one pick per match, no fixed number of picks)
  // v3.0 (research/v6/slips_study.js + slips_report.js, rule "site"): the old 84% bar won what it
  // said (86.5% on 2023-26 matches) but gave about 20 picks a match day, half of them team
  // unders paying 1.10-1.15, and a slip of ten of them landed only 1 time in 4. At 88% with the
  // weak markets kept off, picks won 90.6% on the held-out seasons (stated 90.6%), about 8 a
  // match day, and the strongest-first slip held at 75%+ combined landed 80% of days.
  // The MEASURED chance (lib/strongest/calibrate.js: what selections like it actually won on
  // past matches) must reach this...
  minChance: 0.88,
  // ...and corners and bookings, which have no bookmaker price of their own, this.
  minChanceStatsOnly: 0.89,
  // Every independent view must still rate the pick at least this likely (agreement).
  floor: 0.75,
  // Corners and bookings: every view (form + price, season, last 6) at least this.
  floorStatsOnly: 0.75,
  // When a match has both kinds of qualifying pick, corners and bookings rank this far below
  // a bookmaker-anchored one.
  statsOnlyPenalty: 0.03,
  // Above this the selection pays too little to be worth a place (fair odds under 1.08). For
  // goal markets it is the bookmakers' own probability that counts: they set the price.
  maxProb: 0.93,
  // Markets kept off the list AND off the match cards and bet builders, whatever their figures
  // say on the day (research/v6/slips_report.js, every selection at 84%+, won minus stated):
  //   team unders (and clean sheets): half of all picks at the old bar, paying 1.10-1.15; under
  //     1.5 won 3.3-3.5 points less than stated on 2023-26 matches, under 2.5 0.4-0.5 less
  //   both teams to score: No: 62% won in 2019-23 and 68% in 2023-26 when stated 88%
  //   away or draw & over 1.5: 8 points under its stated chance in both periods
  //   total corners under: 1.4-1.5 points under in both periods
  excluded: [
    'TTH_U0.5', 'TTA_U0.5', 'TTH_U1.5', 'TTA_U1.5', 'TTH_U2.5', 'TTA_U2.5',
    'BTTS_N', 'DCX2_O1.5',
    'C_U7.5', 'C_U8.5', 'C_U9.5', 'C_U10.5', 'C_U11.5',
  ],
  // Only leagues the rule was measured on (research/v7/RESULTS.md, 2). The archive holds 38
  // divisions; the rule's picks were replayed in every one of them:
  //   the 18 main European divisions          90.8% won on 2019-23, 90.5% on 2023-26 (stated 90.7%)
  //   England 5 and Scotland 2-4              90.2% and 92.0% (stated 90.4%)
  //   12 leagues with a 1X2 price only        90.7% and 92.4% (stated 90.7%): USA, Mexico, Japan,
  //     China, Sweden, Norway, Denmark, Austria, Switzerland, Poland, Romania, Russia
  //   Brazil and Argentina                    82.2% and 86.8% (stated 90.4%): kept OFF
  // Anywhere else the measured chance is a guess, so no Strongest Pick.
  testedLeaguesOnly: true,
  testedLeagues: [
    'eng.1', 'eng.2', 'eng.3', 'eng.4', 'sco.1', 'ger.1', 'ger.2', 'ita.1', 'ita.2',
    'esp.1', 'esp.2', 'fra.1', 'fra.2', 'ned.1', 'bel.1', 'por.1', 'tur.1', 'gre.1',
    'eng.5', 'sco.2', 'sco.3', 'sco.4',
    'usa.1', 'mex.1', 'jpn.1', 'chn.1', 'swe.1', 'nor.1', 'den.1', 'aut.1', 'sui.1', 'pol.1', 'rou.1', 'rus.1',
  ],
  // Measured and failed: double chance there won 82.7% when it said 90.3%.
  failedLeagues: ['bra.1', 'bra.2', 'arg.1'],
  // At least this many independent views must exist for a pick to qualify.
  minViews: 2,
  // Archive games each team needs before corners and bookings can qualify.
  minGamesStatsOnly: 8,
  // The v6 factors say the bookmakers overrate a selection when v6 - price <= this.
  // Same threshold the site's main pick uses (lib/intel/decision.js trapShift).
  trapShift: -0.015,
  // Near misses shown when a match has no qualifying pick but its measured chance is close.
  nearMissFloor: 0.85,

  // Strength labels on the list, by the measured chance.
  tiers: [
    { min: 0.9, name: 'Elite' },
    { min: 0.88, name: 'Strong' },
  ],

  // ---- safe slips (several Strongest Picks on one slip; different matches, so the chances
  // multiply and every leg lowers the chance of landing)
  // The safe slip takes the strongest picks first while the combined chance stays at this
  // (2023-26 replay: landed 80.4% of 613 match days, 2.7 legs, fair odds 1.28)...
  safeSlipChance: 0.75,
  // ...and the longer slip while it stays at this (landed 67.9%, 4.3 legs, fair odds 1.51).
  longSlipChance: 0.6,

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
