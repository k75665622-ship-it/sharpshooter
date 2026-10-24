'use strict';

/**
 * factors/records.js — one normalised match record for every data source.
 *
 * The v6 factor engine is computed by the SAME code in research (238,858 historical
 * matches) and on the live site (crawled football-data.co.uk / ESPN / ClubElo data),
 * so a factor's measured value is the value of the factor the site actually shows.
 * Every source is converted into this shape first:
 *
 *   MR (match record)
 *   { league, season, date, home, away,
 *     hg, ag,                 full-time goals
 *     hthg, htag,             half-time goals            (null when unpublished)
 *     hs, as, hst, ast,       shots, shots on target     (null when unpublished)
 *     hc, ac, hf, af,         corners, fouls             (null when unpublished)
 *     hy, ay, hr, ar,         yellow / red cards         (null when unpublished)
 *     eloH, eloA,             ClubElo before kick-off    (null when unrated)
 *     odds: { h, d, a, maxH, maxD, maxA, o25, u25, maxO25, maxU25, ahLine, ahH, ahA,
 *             close: { h, d, a, o25, u25 } | null }       Bet365 pre-closing, best of ~17 books,
 *                                                         and closing prices when published
 *     src }
 *
 * Pure. No I/O.
 */

const MK = require('../market');

const num = (v) => {
  if (v === '' || v == null) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};
const odd = (v) => {
  const x = num(v);
  return x != null && x > 1.0001 ? x : null;
};

/** Leagues whose season is a calendar year (dataset codes, football-data codes and ESPN slugs). */
const CALENDAR = new Set([
  'ARG', 'BRA', 'USA', 'JAP', 'JPN', 'CHN', 'NOR', 'SWE', 'FIN', 'IRL',
  'arg.1', 'bra.1', 'bra.2', 'usa.1', 'jpn.1', 'chn.1', 'nor.1', 'swe.1', 'fin.1', 'irl.1', 'kor.1', 'col.1', 'chi.1', 'per.1', 'uru.1',
]);

function seasonOf(date, league) {
  const y = Number(String(date).slice(0, 4));
  if (CALENDAR.has(league)) return y;
  return Number(String(date).slice(5, 7)) >= 7 ? y : y - 1;
}

/** Relegation places (bottom N, plus play-off places counted as danger). Approximate, per league code. */
const DROP = {
  E0: 3, E1: 3, E2: 4, E3: 2, EC: 2, SC0: 2, SC1: 2, SC2: 2, SC3: 1,
  D1: 3, D2: 3, SP1: 3, SP2: 4, I1: 3, I2: 4, F1: 3, F2: 3, N1: 3, B1: 3, P1: 3, T1: 4, G1: 3,
  'eng.1': 3, 'eng.2': 3, 'eng.3': 4, 'eng.4': 2, 'sco.1': 2, 'ger.1': 3, 'ger.2': 3, 'esp.1': 3, 'esp.2': 4,
  'ita.1': 3, 'ita.2': 4, 'fra.1': 3, 'fra.2': 3, 'ned.1': 3, 'bel.1': 3, 'por.1': 3, 'tur.1': 4, 'gre.1': 3,
};
const dropPlaces = (league) => DROP[league] || 2;

/** Dataset (github.com/xgabora/Club-Football-Match-Data) row -> MR. */
function fromDatasetRow(r) {
  const hg = num(r.FTHome);
  const ag = num(r.FTAway);
  const date = r.MatchDate;
  if (!date || !r.HomeTeam || !r.AwayTeam) return null;
  const league = r.Division;
  return {
    league,
    season: seasonOf(date, league),
    date,
    time: r.MatchTime || null,
    home: r.HomeTeam,
    away: r.AwayTeam,
    hg,
    ag,
    hthg: num(r.HTHome),
    htag: num(r.HTAway),
    hs: num(r.HomeShots),
    as: num(r.AwayShots),
    hst: num(r.HomeTarget),
    ast: num(r.AwayTarget),
    hc: num(r.HomeCorners),
    ac: num(r.AwayCorners),
    hf: num(r.HomeFouls),
    af: num(r.AwayFouls),
    hy: num(r.HomeYellow),
    ay: num(r.AwayYellow),
    hr: num(r.HomeRed),
    ar: num(r.AwayRed),
    eloH: num(r.HomeElo),
    eloA: num(r.AwayElo),
    odds: {
      h: odd(r.OddHome), d: odd(r.OddDraw), a: odd(r.OddAway),
      maxH: odd(r.MaxHome), maxD: odd(r.MaxDraw), maxA: odd(r.MaxAway),
      o25: odd(r.Over25), u25: odd(r.Under25), maxO25: odd(r.MaxOver25), maxU25: odd(r.MaxUnder25),
      ahLine: num(r.HandiSize), ahH: odd(r.HandiHome), ahA: odd(r.HandiAway),
      close: null,
    },
    src: 'dataset',
  };
}

const first = (row, cols, f = odd) => {
  for (const c of cols) {
    const v = f(row[c]);
    if (v != null) return v;
  }
  return null;
};

/** dd/mm/yy or dd/mm/yyyy -> YYYY-MM-DD */
function fdDate(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(String(s || '').trim());
  if (!m) return null;
  let y = Number(m[3]);
  if (y < 100) y += y < 70 ? 2000 : 1900;
  return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}

/**
 * football-data.co.uk CSV row (main "mmz4281" layout or the "new" all-seasons layout) -> MR.
 * Uses the same columns the research dataset was built from (Bet365 pre-closing, best price),
 * so live factors are computed exactly as they were measured. Fixtures (no score yet) are kept
 * with hg/ag null — the fixtures.csv file uses the same layout.
 */
function fromFootballDataRow(row, league) {
  const date = fdDate(row.Date);
  const home = (row.HomeTeam || row.Home || '').trim();
  const away = (row.AwayTeam || row.Away || '').trim();
  if (!date || !home || !away) return null;
  const hg = num(row.FTHG != null && row.FTHG !== '' ? row.FTHG : row.HG);
  const ag = num(row.FTAG != null && row.FTAG !== '' ? row.FTAG : row.AG);
  const close = {
    h: first(row, ['B365CH', 'PSCH', 'AvgCH']),
    d: first(row, ['B365CD', 'PSCD', 'AvgCD']),
    a: first(row, ['B365CA', 'PSCA', 'AvgCA']),
    o25: first(row, ['B365C>2.5', 'PC>2.5', 'AvgC>2.5']),
    u25: first(row, ['B365C<2.5', 'PC<2.5', 'AvgC<2.5']),
  };
  const lg = league || row.Div || null;
  return {
    league: lg,
    season: seasonOf(date, lg),
    date,
    time: row.Time || null,
    home,
    away,
    hg,
    ag,
    hthg: num(row.HTHG),
    htag: num(row.HTAG),
    hs: num(row.HS),
    as: num(row.AS),
    hst: num(row.HST),
    ast: num(row.AST),
    hc: num(row.HC),
    ac: num(row.AC),
    hf: num(row.HF),
    af: num(row.AF),
    hy: num(row.HY),
    ay: num(row.AY),
    hr: num(row.HR),
    ar: num(row.AR),
    referee: row.Referee || null,
    eloH: null,
    eloA: null,
    odds: {
      // Bet365 pre-closing first (the research dataset's price), then Pinnacle / average
      h: first(row, ['B365H', 'PSH', 'AvgH', 'B365CH', 'PSCH', 'AvgCH']),
      d: first(row, ['B365D', 'PSD', 'AvgD', 'B365CD', 'PSCD', 'AvgCD']),
      a: first(row, ['B365A', 'PSA', 'AvgA', 'B365CA', 'PSCA', 'AvgCA']),
      maxH: first(row, ['MaxH', 'BbMxH', 'MaxCH']),
      maxD: first(row, ['MaxD', 'BbMxD', 'MaxCD']),
      maxA: first(row, ['MaxA', 'BbMxA', 'MaxCA']),
      o25: first(row, ['B365>2.5', 'P>2.5', 'Avg>2.5', 'BbAv>2.5']),
      u25: first(row, ['B365<2.5', 'P<2.5', 'Avg<2.5', 'BbAv<2.5']),
      maxO25: first(row, ['Max>2.5', 'BbMx>2.5']),
      maxU25: first(row, ['Max<2.5', 'BbMx<2.5']),
      ahLine: first(row, ['AHh', 'BbAHh'], num),
      ahH: first(row, ['B365AHH', 'PAHH', 'AvgAHH']),
      ahA: first(row, ['B365AHA', 'PAHA', 'AvgAHA']),
      close: close.h && close.d && close.a ? close : null,
    },
    src: 'football-data',
  };
}

/**
 * Market view of a record: de-vigged 1X2 and Over 2.5, overround, book dispersion, and the
 * expected goals the prices imply (Levenberg-Marquardt, lib/market.js). Cached on the record.
 */
function marketOf(mr) {
  if (mr._mkt !== undefined) return mr._mkt;
  const o = mr.odds || {};
  let out = null;
  if (o.h && o.d && o.a) {
    const f = MK.fair([o.h, o.d, o.a]);
    if (f) {
      const p = f.probs;
      let pO = null;
      let ovrOU = null;
      if (o.o25 && o.u25) {
        const t = MK.fair([o.o25, o.u25]);
        if (t) {
          pO = t.probs[0];
          ovrOU = t.margin;
        }
      }
      const sol = MK.solveLambdas({ home: p[0], draw: p[1], away: p[2] }, pO != null ? { line: 2.5, over: pO } : null, { priorTotal: 2.6 });
      const disp = (mx, b) => (mx && b ? mx / b - 1 : null);
      out = {
        p1: p[0],
        pX: p[1],
        p2: p[2],
        pO25: pO,
        ovr: f.margin,
        ovrOU,
        disp1: disp(o.maxH, o.h),
        dispX: disp(o.maxD, o.d),
        disp2: disp(o.maxA, o.a),
        dispO: disp(o.maxO25, o.o25),
        dispU: disp(o.maxU25, o.u25),
        lamH: sol ? sol.lamH : null,
        lamA: sol ? sol.lamA : null,
      };
      if (o.close && o.close.h && o.close.d && o.close.a) {
        const c = MK.fair([o.close.h, o.close.d, o.close.a]);
        if (c) {
          out.move1 = c.probs[0] - p[0];
          out.moveX = c.probs[1] - p[1];
          out.move2 = c.probs[2] - p[2];
        }
      }
    }
  }
  Object.defineProperty(mr, '_mkt', { value: out, enumerable: false, writable: true });
  return out;
}

const pts = (gf, ga) => (gf > ga ? 3 : gf === ga ? 1 : 0);

/** A record seen from one team's side (TL entry). */
function teamEntry(mr, team) {
  const home = mr.home === team;
  const mk = marketOf(mr);
  const pick = (h, a) => (home ? h : a);
  return {
    date: mr.date,
    season: mr.season,
    league: mr.league,
    venue: home ? 'H' : 'A',
    opp: home ? mr.away : mr.home,
    gf: pick(mr.hg, mr.ag),
    ga: pick(mr.ag, mr.hg),
    htgf: pick(mr.hthg, mr.htag),
    htga: pick(mr.htag, mr.hthg),
    sf: pick(mr.hs, mr.as),
    sa: pick(mr.as, mr.hs),
    sotf: pick(mr.hst, mr.ast),
    sota: pick(mr.ast, mr.hst),
    cf: pick(mr.hc, mr.ac),
    ca: pick(mr.ac, mr.hc),
    ff: pick(mr.hf, mr.af),
    fa: pick(mr.af, mr.hf),
    yf: pick(mr.hy, mr.ay),
    rf: pick(mr.hr, mr.ar),
    elo: pick(mr.eloH, mr.eloA),
    oppElo: pick(mr.eloA, mr.eloH),
    pW: mk ? pick(mk.p1, mk.p2) : null,
    pD: mk ? mk.pX : null,
    pL: mk ? pick(mk.p2, mk.p1) : null,
    xF: mk && mk.lamH ? pick(mk.lamH, mk.lamA) : null,
    xA: mk && mk.lamA ? pick(mk.lamA, mk.lamH) : null,
    points: mr.hg == null ? null : pts(pick(mr.hg, mr.ag), pick(mr.ag, mr.hg)),
  };
}

module.exports = {
  num, odd, CALENDAR, seasonOf, dropPlaces, DROP,
  fromDatasetRow, fromFootballDataRow, fdDate, marketOf, teamEntry, pts,
};
