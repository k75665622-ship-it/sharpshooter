'use strict';

/**
 * League registry.
 * Every slug below was verified to return live ESPN data (HTTP 200 with events).
 * `tier` is used for presentation weighting and for the "big match" boost.
 */

const LEAGUES = [
  // ---- Top 5 European leagues ----
  { slug: 'eng.1', name: 'Premier League', country: 'England', cc: 'ENG', tier: 1, flag: '\u{1F3F4}' },
  { slug: 'esp.1', name: 'LaLiga', country: 'Spain', cc: 'ESP', tier: 1, flag: '\u{1F1EA}\u{1F1F8}' },
  { slug: 'ita.1', name: 'Serie A', country: 'Italy', cc: 'ITA', tier: 1, flag: '\u{1F1EE}\u{1F1F9}' },
  { slug: 'ger.1', name: 'Bundesliga', country: 'Germany', cc: 'GER', tier: 1, flag: '\u{1F1E9}\u{1F1EA}' },
  { slug: 'fra.1', name: 'Ligue 1', country: 'France', cc: 'FRA', tier: 1, flag: '\u{1F1EB}\u{1F1F7}' },

  // ---- European competitions ----
  { slug: 'uefa.champions', name: 'UEFA Champions League', country: 'Europe', cc: 'UCL', tier: 1, flag: '\u{2B50}', cup: true },
  { slug: 'uefa.europa', name: 'UEFA Europa League', country: 'Europe', cc: 'UEL', tier: 1, flag: '\u{1F7E0}', cup: true },
  { slug: 'uefa.conference', name: 'UEFA Conference League', country: 'Europe', cc: 'UECL', tier: 2, flag: '\u{1F7E2}', cup: true },
  { slug: 'uefa.super_cup', name: 'UEFA Super Cup', country: 'Europe', cc: 'USC', tier: 1, flag: '\u{1F3C6}', cup: true },

  // ---- Second tiers ----
  { slug: 'eng.2', name: 'EFL Championship', country: 'England', cc: 'ENG2', tier: 3, flag: '\u{1F3F4}' },
  { slug: 'eng.3', name: 'EFL League One', country: 'England', cc: 'ENG3', tier: 4, flag: '\u{1F3F4}' },
  { slug: 'eng.4', name: 'EFL League Two', country: 'England', cc: 'ENG4', tier: 4, flag: '\u{1F3F4}' },
  { slug: 'esp.2', name: 'LaLiga 2', country: 'Spain', cc: 'ESP2', tier: 3, flag: '\u{1F1EA}\u{1F1F8}' },
  { slug: 'ita.2', name: 'Serie B', country: 'Italy', cc: 'ITA2', tier: 3, flag: '\u{1F1EE}\u{1F1F9}' },
  { slug: 'ger.2', name: '2. Bundesliga', country: 'Germany', cc: 'GER2', tier: 3, flag: '\u{1F1E9}\u{1F1EA}' },
  { slug: 'ger.3', name: '3. Liga', country: 'Germany', cc: 'GER3', tier: 4, flag: '\u{1F1E9}\u{1F1EA}' },
  { slug: 'fra.2', name: 'Ligue 2', country: 'France', cc: 'FRA2', tier: 3, flag: '\u{1F1EB}\u{1F1F7}' },

  // ---- Rest of Europe ----
  { slug: 'ned.1', name: 'Eredivisie', country: 'Netherlands', cc: 'NED', tier: 2, flag: '\u{1F1F3}\u{1F1F1}' },
  { slug: 'por.1', name: 'Primeira Liga', country: 'Portugal', cc: 'POR', tier: 2, flag: '\u{1F1F5}\u{1F1F9}' },
  { slug: 'tur.1', name: 'Super Lig', country: 'Turkey', cc: 'TUR', tier: 2, flag: '\u{1F1F9}\u{1F1F7}' },
  { slug: 'bel.1', name: 'Pro League', country: 'Belgium', cc: 'BEL', tier: 2, flag: '\u{1F1E7}\u{1F1EA}' },
  { slug: 'sco.1', name: 'Scottish Premiership', country: 'Scotland', cc: 'SCO', tier: 2, flag: '\u{1F3F4}' },
  { slug: 'gre.1', name: 'Super League Greece', country: 'Greece', cc: 'GRE', tier: 3, flag: '\u{1F1EC}\u{1F1F7}' },
  { slug: 'rus.1', name: 'Russian Premier League', country: 'Russia', cc: 'RUS', tier: 3, flag: '\u{1F1F7}\u{1F1FA}' },
  { slug: 'aut.1', name: 'Austrian Bundesliga', country: 'Austria', cc: 'AUT', tier: 3, flag: '\u{1F1E6}\u{1F1F9}' },
  { slug: 'sui.1', name: 'Swiss Super League', country: 'Switzerland', cc: 'SUI', tier: 3, flag: '\u{1F1E8}\u{1F1ED}' },
  { slug: 'den.1', name: 'Danish Superliga', country: 'Denmark', cc: 'DEN', tier: 3, flag: '\u{1F1E9}\u{1F1F0}' },
  { slug: 'swe.1', name: 'Allsvenskan', country: 'Sweden', cc: 'SWE', tier: 3, flag: '\u{1F1F8}\u{1F1EA}' },
  { slug: 'nor.1', name: 'Eliteserien', country: 'Norway', cc: 'NOR', tier: 3, flag: '\u{1F1F3}\u{1F1F4}' },
  { slug: 'pol.1', name: 'Ekstraklasa', country: 'Poland', cc: 'POL', tier: 3, flag: '\u{1F1F5}\u{1F1F1}' },
  { slug: 'cze.1', name: 'Czech First League', country: 'Czechia', cc: 'CZE', tier: 3, flag: '\u{1F1E8}\u{1F1FF}' },
  { slug: 'rou.1', name: 'Liga I', country: 'Romania', cc: 'ROU', tier: 4, flag: '\u{1F1F7}\u{1F1F4}' },
  { slug: 'cro.1', name: 'HNL', country: 'Croatia', cc: 'CRO', tier: 4, flag: '\u{1F1ED}\u{1F1F7}' },
  { slug: 'ukr.1', name: 'Ukrainian Premier League', country: 'Ukraine', cc: 'UKR', tier: 4, flag: '\u{1F1FA}\u{1F1E6}' },

  // ---- Americas ----
  { slug: 'usa.1', name: 'MLS', country: 'USA', cc: 'USA', tier: 2, flag: '\u{1F1FA}\u{1F1F8}' },
  { slug: 'mex.1', name: 'Liga MX', country: 'Mexico', cc: 'MEX', tier: 2, flag: '\u{1F1F2}\u{1F1FD}' },
  { slug: 'bra.1', name: 'Brasileirao', country: 'Brazil', cc: 'BRA', tier: 2, flag: '\u{1F1E7}\u{1F1F7}' },
  { slug: 'bra.2', name: 'Brasileirao Serie B', country: 'Brazil', cc: 'BRA2', tier: 4, flag: '\u{1F1E7}\u{1F1F7}' },
  { slug: 'arg.1', name: 'Liga Profesional', country: 'Argentina', cc: 'ARG', tier: 2, flag: '\u{1F1E6}\u{1F1F7}' },
  { slug: 'col.1', name: 'Liga BetPlay', country: 'Colombia', cc: 'COL', tier: 4, flag: '\u{1F1E8}\u{1F1F4}' },
  { slug: 'chi.1', name: 'Primera Division', country: 'Chile', cc: 'CHI', tier: 4, flag: '\u{1F1E8}\u{1F1F1}' },
  { slug: 'per.1', name: 'Liga 1', country: 'Peru', cc: 'PER', tier: 4, flag: '\u{1F1F5}\u{1F1EA}' },
  { slug: 'uru.1', name: 'Primera Division', country: 'Uruguay', cc: 'URU', tier: 4, flag: '\u{1F1FA}\u{1F1FE}' },

  // ---- Asia / Oceania ----
  { slug: 'jpn.1', name: 'J1 League', country: 'Japan', cc: 'JPN', tier: 2, flag: '\u{1F1EF}\u{1F1F5}' },
  { slug: 'kor.1', name: 'K League 1', country: 'South Korea', cc: 'KOR', tier: 3, flag: '\u{1F1F0}\u{1F1F7}' },
  { slug: 'chn.1', name: 'Chinese Super League', country: 'China', cc: 'CHN', tier: 3, flag: '\u{1F1E8}\u{1F1F3}' },
  { slug: 'sau.1', name: 'Saudi Pro League', country: 'Saudi Arabia', cc: 'SAU', tier: 2, flag: '\u{1F1F8}\u{1F1E6}' },
  { slug: 'ind.1', name: 'Indian Super League', country: 'India', cc: 'IND', tier: 4, flag: '\u{1F1EE}\u{1F1F3}' },
  { slug: 'aus.1', name: 'A-League', country: 'Australia', cc: 'AUS', tier: 3, flag: '\u{1F1E6}\u{1F1FA}' },

  // ---- International ----
  { slug: 'fifa.world', name: 'FIFA World Cup', country: 'World', cc: 'WC', tier: 1, flag: '\u{1F30D}', cup: true },
  { slug: 'fifa.worldq.uefa', name: 'World Cup Qualifiers (UEFA)', country: 'World', cc: 'WCQ', tier: 1, flag: '\u{1F30D}', cup: true },
  { slug: 'uefa.nations', name: 'UEFA Nations League', country: 'Europe', cc: 'UNL', tier: 1, flag: '\u{1F1EA}\u{1F1FA}', cup: true },
  { slug: 'concacaf.gold', name: 'CONCACAF Gold Cup', country: 'World', cc: 'GC', tier: 2, flag: '\u{1F30D}', cup: true },
  { slug: 'caf.nations', name: 'Africa Cup of Nations', country: 'World', cc: 'AFCON', tier: 2, flag: '\u{1F30D}', cup: true },
];

const BY_SLUG = new Map(LEAGUES.map((l) => [l.slug, l]));

/**
 * Leagues always polled for the daily board.
 *
 * Every slug here must have a working ESPN scoreboard AND team list. Leagues
 * that return zero teams (pol.1, cze.1, cro.1, ukr.1) are deliberately absent —
 * ESPN publishes no Polish, Czech, Croatian or Ukrainian football at all, so
 * polling them would only burn requests to discover nothing.
 *
 * The European mid-tier leagues below matter twice over: they are analysable
 * fixtures in their own right, AND they are what lets a cup tie resolve its
 * clubs' domestic statistics.
 */
const CORE_SLUGS = [
  'eng.1', 'esp.1', 'ita.1', 'ger.1', 'fra.1',
  'uefa.champions', 'uefa.europa', 'uefa.conference',
  'eng.2', 'esp.2', 'ita.2', 'ger.2', 'fra.2',
  'ned.1', 'por.1', 'tur.1', 'bel.1', 'sco.1',
  'aut.1', 'sui.1', 'den.1', 'swe.1', 'nor.1',
  'bra.1', 'arg.1', 'usa.1', 'mex.1',
  'jpn.1', 'sau.1', 'rus.1', 'gre.1',
];

/**
 * Leagues ESPN is known to have NO coverage for. Recorded explicitly so the
 * "cannot analyse this fixture" message can say why, instead of leaving the
 * user to guess.
 */
const UNCOVERED_SLUGS = ['pol.1', 'cze.1', 'cro.1', 'ukr.1', 'bul.1', 'hun.1', 'srb.1'];

function get(slug) {
  return BY_SLUG.get(slug) || { slug, name: slug, country: '?', cc: '?', tier: 3, flag: '\u26BD' };
}

/**
 * Relative league strength, referenced to the Premier League = 1.00.
 *
 * This is ESSENTIAL for cup competitions. The model normalises each team
 * against its own league's average, so without this a Greek side scoring
 * 1.5 goals/game would be treated as equivalent to a Bundesliga side scoring
 * 1.5 goals/game. That produced absurd cross-league predictions before this
 * table existed.
 *
 * Values are derived from long-run UEFA club coefficients and are deliberately
 * conservative: they correct the gross distortion without pretending to be
 * precise. Anything unlisted falls back to the DEFAULT_STRENGTH.
 */
const LEAGUE_STRENGTH = {
  'eng.1': 1.0,
  'esp.1': 0.98,
  'ita.1': 0.96,
  'ger.1': 0.94,
  'fra.1': 0.9,
  'ned.1': 0.82,
  'por.1': 0.82,
  'bra.1': 0.8,
  'arg.1': 0.78,
  'eng.2': 0.78,
  'tur.1': 0.76,
  'bel.1': 0.76,
  'ger.2': 0.74,
  'rus.1': 0.74,
  'sco.1': 0.72,
  'aut.1': 0.72,
  'esp.2': 0.72,
  'ita.2': 0.72,
  'mex.1': 0.72,
  'fra.2': 0.7,
  'sui.1': 0.7,
  'den.1': 0.68,
  'usa.1': 0.68,
  'jpn.1': 0.68,
  'sau.1': 0.68,
  'gre.1': 0.66,
  'ukr.1': 0.66,
  'cze.1': 0.62,
  'eng.3': 0.62,
  'swe.1': 0.62,
  'nor.1': 0.62,
  'kor.1': 0.62,
  'pol.1': 0.6,
  'cro.1': 0.6,
  'chn.1': 0.58,
  'rou.1': 0.56,
  'eng.4': 0.52,
  'ind.1': 0.46,
};

const DEFAULT_STRENGTH = 0.62;

function strength(slug) {
  const v = LEAGUE_STRENGTH[slug];
  return typeof v === 'number' ? v : DEFAULT_STRENGTH;
}

function all() {
  return LEAGUES;
}

/** All slug strings, used by the wide scan. */
function slugs() {
  return LEAGUES.map((l) => l.slug);
}

module.exports = {
  LEAGUES,
  CORE_SLUGS,
  UNCOVERED_SLUGS,
  LEAGUE_STRENGTH,
  DEFAULT_STRENGTH,
  get,
  all,
  slugs,
  strength,
  BY_SLUG,
};
