'use strict';

/**
 * pace.js — the possession model: football's version of the NBA total formula
 *
 *     points = offensive efficiency x possessions per game
 *     (each side once from its own offence, once from the opponent's defence, averaged)
 *
 * Basketball counts possessions; football's nearest free equivalent is the SHOT (an attack
 * that got somewhere), and its efficiency is GOALS PER SHOT. For each side:
 *
 *   volume       shots per game: its own shots taken, and the shots its opponent concedes
 *   efficiency   goals per shot: its own finishing, and the finishing its opponent allows
 *
 *   expected goals = average(volume for, opponent's volume against)
 *                  x average(efficiency for, opponent's efficiency against)
 *
 * Every rate is a ratio to the league average at the same venue, from the team's last 20
 * league games (half the weight on its games at the same venue), shrunk toward the league
 * so a short or lucky run cannot run away: shot volume with C.volumeShrinkGames games,
 * finishing with C.efficiencyShrinkShots shots (goals per shot is the noisy part).
 *
 * Inputs are the football-data.co.uk archive the site already crawls (shots, shots on target,
 * goals per match). Pure. No I/O. research/v6/strongest_study.js runs this same code on history.
 */

const C = {
  games: 20,
  venueWeight: 0.5,
  volumeShrinkGames: 4,
  efficiencyShrinkShots: 120,
  minGames: 6,
};

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sum = (xs, f) => xs.reduce((a, g) => a + f(g), 0);

/** League baselines per match at each venue: shots, shots on target, goals (from match records). */
function leagueBase(matches) {
  const ok = matches.filter((m) => m.hs != null && m.as != null && m.hg != null && m.ag != null);
  if (ok.length < 50) return null;
  const hs = avg(ok.map((m) => m.hs));
  const as = avg(ok.map((m) => m.as));
  const hg = avg(ok.map((m) => m.hg));
  const ag = avg(ok.map((m) => m.ag));
  const sot = ok.filter((m) => m.hst != null && m.ast != null);
  return {
    matches: ok.length,
    home: { shots: hs, goals: hg, sot: sot.length ? avg(sot.map((m) => m.hst)) : null },
    away: { shots: as, goals: ag, sot: sot.length ? avg(sot.map((m) => m.ast)) : null },
    goalsPerShot: (hg + ag) / (hs + as),
  };
}

/** One side's volume and efficiency ratios (1 = league average) from its newest-first log. */
function teamRates(log, venue, base) {
  const withShots = (g) => g.sf != null && g.sa != null && g.gf != null && g.ga != null;
  const all = log.filter(withShots).slice(0, C.games);
  const ven = log.filter((g) => withShots(g) && g.venue === venue).slice(0, Math.ceil(C.games / 2));
  if (all.length < C.minGames) return null;
  const b = (v) => (v === 'H' ? base.home : base.away);
  const kV = C.volumeShrinkGames;
  const kE = C.efficiencyShrinkShots;
  const gps = base.goalsPerShot;
  // volume: shots taken / conceded relative to what an average side takes / concedes there
  const vol = (games, own) => {
    if (!games.length) return 1;
    const n = games.length;
    const exp = sum(games, (g) => (own ? b(g.venue).shots : b(g.venue === 'H' ? 'A' : 'H').shots));
    const got = sum(games, (g) => (own ? g.sf : g.sa));
    return (got + kV * (exp / n)) / (exp + kV * (exp / n));
  };
  // efficiency: goals per shot scored / allowed relative to the league, shrunk by shots
  const eff = (games, own) => {
    if (!games.length) return 1;
    const shots = sum(games, (g) => (own ? g.sf : g.sa));
    const goals = sum(games, (g) => (own ? g.gf : g.ga));
    return (goals + kE * gps) / ((shots + kE) * gps);
  };
  const blend = (f) => (ven.length ? C.venueWeight * f(ven) + (1 - C.venueWeight) * f(all) : f(all));
  return {
    games: all.length,
    attack: blend((gs) => vol(gs, true)), // shots taken vs average
    defence: blend((gs) => vol(gs, false)), // shots conceded vs average
    finishing: blend((gs) => eff(gs, true)), // goals per shot vs average
    keeping: blend((gs) => eff(gs, false)), // goals per shot allowed vs average
    perGame: {
      shotsFor: avg(all.map((g) => g.sf)),
      shotsAgainst: avg(all.map((g) => g.sa)),
      conversion: sum(all, (g) => g.gf) / Math.max(1, sum(all, (g) => g.sf)),
      conversionAllowed: sum(all, (g) => g.ga) / Math.max(1, sum(all, (g) => g.sa)),
    },
  };
}

/**
 * Expected goals for both sides from the possession model.
 * @param {{homeLog:object[], awayLog:object[], base:object}} x  base = leagueBase(...)
 * @returns {null | {lamH:number, lamA:number, home:object, away:object, shots:{home:number, away:number}, efficiency:{home:number, away:number}}}
 */
function lambdas({ homeLog, awayLog, base }) {
  if (!base || !homeLog || !awayLog) return null;
  const H = teamRates(homeLog, 'H', base);
  const A = teamRates(awayLog, 'A', base);
  if (!H || !A) return null;
  const gps = base.goalsPerShot;
  const shotsH = base.home.shots * (H.attack + A.defence) / 2;
  const shotsA = base.away.shots * (A.attack + H.defence) / 2;
  // home and away finishing differ a little in every league: keep each venue's own rate
  const gpsH = base.home.goals / base.home.shots;
  const gpsA = base.away.goals / base.away.shots;
  const effH = gpsH * (H.finishing + A.keeping) / 2;
  const effA = gpsA * (A.finishing + H.keeping) / 2;
  const lamH = shotsH * effH;
  const lamA = shotsA * effA;
  if (!(lamH > 0) || !(lamA > 0) || !Number.isFinite(gps)) return null;
  return { lamH, lamA, home: H, away: A, shots: { home: shotsH, away: shotsA }, efficiency: { home: effH, away: effA } };
}

/** League baselines from a lib/factors History over the `days` before `day`. */
function baseFromHistory(hist, div, day, days = 365) {
  const arr = (hist && hist.league && hist.league.get(div)) || [];
  const from = new Date(Date.parse(day + 'T00:00:00Z') - days * 86400000).toISOString().slice(0, 10);
  return leagueBase(arr.filter((m) => m.date >= from && m.date < day));
}

module.exports = { lambdas, teamRates, leagueBase, baseFromHistory, C };
