'use strict';

/**
 * strongest/reasons.js — why a pick is strong, in plain English, from the data only.
 *
 * Every sentence is built from numbers the engine actually holds (prices, expected goals,
 * the archive's last-10 games, head-to-head, table, referee, players, team news). When a
 * number is missing the sentence is left out; nothing is invented.
 *
 * Pure. No I/O.
 */

const pct = (p, dp = 0) => (p == null ? '—' : `${(p * 100).toFixed(dp)}%`);
const f1 = (v) => (v == null ? '—' : Number(v).toFixed(1));
const f2 = (v) => (v == null ? '—' : Number(v).toFixed(2));
const VIEW_NAME = { market: 'Market', stats: 'Stats model', factors: 'v6 factors', season: 'Season', recent: 'Last 6' };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;

/** "Market 82% · Stats model 79% · v6 factors 84%" */
function viewsLine(sel) {
  return Object.entries(sel.views).map(([k, p]) => `${VIEW_NAME[k] || k} ${pct(p)}`).join(' · ');
}

function teamName(names, side) {
  return side === 'home' ? names.home : names.away;
}

function priceLine(report, names) {
  const x = report.consensus && report.consensus.x12;
  if (x && x.fair) {
    return `Bookmakers (${x.books || report.consensus.nBooks || 1} book${(x.books || 1) > 1 ? 's' : ''}, margin removed): ${names.home} ${pct(x.fair.home)} · draw ${pct(x.fair.draw)} · ${names.away} ${pct(x.fair.away)}.`;
  }
  const o = report.model && report.model.oneXtwo;
  return o ? `Model: ${names.home} ${pct(o.pHome)} · draw ${pct(o.pDraw)} · ${names.away} ${pct(o.pAway)} (no bookmaker price found).` : null;
}

function xgLine(fx, names) {
  const v = fx.goalViews || [];
  if (!v.length) return null;
  const part = (x) => `${f2(x.lamH)}–${f2(x.lamA)} (${(VIEW_NAME[x.name] || x.name).toLowerCase()})`;
  return `Expected goals ${names.home} v ${names.away}: ${v.map(part).join(', ')}.`;
}

function recordLine(t, name, scope) {
  if (!t || !t.n) return null;
  return `${name}: ${t.w}W ${t.d}D ${t.l}L in the last ${t.n}${scope ? ' ' + scope : ''}, scored ${t.gf}, conceded ${t.ga}.`;
}

function tableLine(facts, names) {
  const t = facts.table;
  if (!t || !t.home || !t.away) return null;
  const ord = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
  return `Table: ${names.home} ${ord(t.home.pos)} (${t.home.pts} pts from ${t.home.gp}), ${names.away} ${ord(t.away.pos)} (${t.away.pts} pts from ${t.away.gp}).`;
}

function h2hLine(h, names) {
  if (!h || h.n < 3) return null;
  return `Head-to-head, last ${h.n}: ${names.home} ${plural(h.homeWins, 'win')}, ${plural(h.draws, 'draw')}, ${names.away} ${plural(h.awayWins, 'win')}; ${f1(h.goalsPerGame)} goals a game, over 2.5 in ${h.over25}.`;
}

/** Only worth saying when one side is short of rest. */
function restLine(facts, names) {
  const r = facts.rest;
  if (!r || r.home == null || r.away == null) return null;
  if (Math.min(r.home, r.away) > 4 || Math.abs(r.home - r.away) < 2) return null;
  return `Rest since the last game: ${names.home} ${plural(r.home, 'day')}, ${names.away} ${plural(r.away, 'day')}.`;
}

/** Facts specific to the selection's market. */
function specific(sel, fx, report) {
  const n = fx.names;
  const F = fx.facts || {};
  const H = F.home;
  const A = F.away;
  const out = [];
  const k = sel.key;
  let m;

  // a team's scoring and the other side's defending, measured at the selection's own line
  const scoring = (t, name, venue, line) => {
    if (!t) return null;
    const l = t.last10;
    const at = venue && t.venue10.n ? `; ${t.venue10.gf} in the last ${t.venue10.n} ${venue}` : '';
    const per = f1(l.gf / Math.max(1, l.n));
    if (line === 0.5) return `${name} failed to score in ${l.blanks} of their last ${l.n} (${l.gf} goals, ${per} a game)${at}.`;
    const hits = line === 1.5 ? l.scored2 : l.scored3;
    return `${name} scored ${Math.ceil(line)}+ in ${hits} of their last ${l.n} (${l.gf} goals, ${per} a game)${at}.`;
  };
  const defending = (t, name, line) => {
    if (!t) return null;
    const l = t.last10;
    if (line === 0.5) return `${name} kept ${plural(l.cleanSheets, 'clean sheet')} in their last ${l.n} and conceded ${l.ga}.`;
    const hits = line === 1.5 ? l.conceded2 : l.conceded3;
    return `${name} conceded ${Math.ceil(line)}+ in ${hits} of their last ${l.n} (${l.ga} conceded, ${plural(l.cleanSheets, 'clean sheet')}).`;
  };

  switch (true) {
    case (m = /^TT([HA])_([OU])(\d\.5)$/.exec(k)) !== null: {
      const side = m[1] === 'H' ? 'home' : 'away';
      const t = side === 'home' ? H : A;
      const o = side === 'home' ? A : H;
      const line = Number(m[3]);
      out.push(scoring(t, teamName(n, side), side === 'home' ? 'at home' : 'away', line));
      out.push(defending(o, teamName(n, side === 'home' ? 'away' : 'home'), line));
      break;
    }
    case /^O\d/.test(k) || /^U\d/.test(k) || k === 'BTTS_Y' || k === 'BTTS_N' || k === 'GG_O2.5': {
      const line = /(\d\.5)/.exec(k);
      const L = line ? Number(line[1]) : 2.5;
      const cnt = (t) => (L === 1.5 ? (k[0] === 'O' ? t.last10.over15 : t.last10.n - t.last10.over15) : L === 3.5 ? (k[0] === 'O' ? t.last10.n - t.last10.under35 : t.last10.under35) : k[0] === 'O' ? t.last10.over25 : t.last10.n - t.last10.over25);
      if (/BTTS|GG/.test(k)) {
        if (H && A) out.push(`Both teams scored in ${H.last10.btts} of ${n.home}'s last ${H.last10.n} and ${A.last10.btts} of ${n.away}'s last ${A.last10.n}.`);
        if (H && A) out.push(`Clean sheets: ${n.home} ${H.last10.cleanSheets}, ${n.away} ${A.last10.cleanSheets}; blanks: ${n.home} ${H.last10.blanks}, ${n.away} ${A.last10.blanks}.`);
      } else if (H && A) {
        out.push(`${k[0] === 'O' ? 'Over' : 'Under'} ${L} landed in ${cnt(H)} of ${n.home}'s last ${H.last10.n} and ${cnt(A)} of ${n.away}'s last ${A.last10.n}.`);
      }
      if (F.league && F.league.goalsPerGame) out.push(`${F.league.name} averages ${f2(F.league.goalsPerGame)} goals a game this year.`);
      break;
    }
    case ['1', '2', '1X', 'X2', '12', 'X'].includes(k) || /^W(EH|BH|O15|TN)_/.test(k) || /^DC/.test(k) || /^HTFT/.test(k): {
      out.push(recordLine(H && H.venue10, n.home, 'at home'));
      out.push(recordLine(A && A.venue10, n.away, 'away'));
      if (/^WTN|^DC.*U3\.5|^HTFT/.test(k)) {
        const backH = /_H$|1X|HH/.test(k);
        out.push(defending(backH ? H : A, backH ? n.home : n.away, /^WTN/.test(k) ? 0.5 : 1.5));
      }
      break;
    }
    case /^H[12]_|^HT_|^HSH/.test(k): {
      const fh = F.league && F.league.firstHalf;
      if (fh && fh.measured != null) out.push(`In ${F.league.name}, ${pct(fh.measured)} of goals come before half-time (${fh.matches} matches; ${pct(fh.used)} used after shrinking toward 44%).`);
      if (H && A && H.firstHalfGoals != null && A.firstHalfGoals != null) out.push(`First-half goals per game in their last 10: ${n.home} ${f1(H.firstHalfGoals)}, ${n.away} ${f1(A.firstHalfGoals)}.`);
      break;
    }
    case /^M(15|30)_/.test(k): {
      const v = (fx.goalViews || [])[0];
      const T = v ? v.lamH + v.lamA : null;
      const share = /^M15/.test(k) ? fx.timing.s15 : fx.timing.s30;
      if (T != null) out.push(`${f2(T)} expected goals; about ${pct(share)} of goals fall in minutes 1-${/^M15/.test(k) ? 15 : 30}, so ${f2(T * share)} are expected in that window.`);
      if (H && A && H.firstHalfGoals != null && A.firstHalfGoals != null) out.push(`First-half goals per game in their last 10: ${n.home} ${f1(H.firstHalfGoals)}, ${n.away} ${f1(A.firstHalfGoals)}.`);
      break;
    }
    case /^C/.test(k): {
      const lc = F.league && F.league.corners;
      if (H && A && H.cornersFor != null && A.cornersFor != null) {
        out.push(`Corners per game in the last 10: ${n.home} win ${f1(H.cornersFor)}, concede ${f1(H.cornersAgainst)}; ${n.away} win ${f1(A.cornersFor)}, concede ${f1(A.cornersAgainst)}.`);
      }
      const e = sel.expected || {};
      if (e.season) out.push(`Expected corners ${f1(e.season.home)}–${f1(e.season.away)} (season)${e.recent ? `, ${f1(e.recent.home)}–${f1(e.recent.away)} (last 6)` : ''}${lc ? `; league average ${f1(lc.home + lc.away)} a match` : ''}.`);
      if (F.h2h && F.h2h.corners) out.push(`Head-to-head: ${f1(F.h2h.corners.perGame)} corners a game over the last ${F.h2h.corners.n} meetings.`);
      break;
    }
    case /^K_/.test(k): {
      const lk = F.league && F.league.cards;
      if (H && A && H.cards != null && A.cards != null) out.push(`Cards per game in the last 10: ${n.home} ${f1(H.cards)}, ${n.away} ${f1(A.cards)}${lk ? `; league average ${f1(lk.total)} a match` : ''}.`);
      const e = sel.expected || {};
      if (e.season) out.push(`Expected cards ${f1(e.season.total)} (season)${e.recent ? `, ${f1(e.recent.total)} (last 6)` : ''}.`);
      if (F.referee && F.referee.perGame != null) out.push(`Referee ${F.referee.name}: ${f1(F.referee.perGame)} cards a game over ${F.referee.games} matches${F.referee.used ? '' : ' (too few to use)'}.`);
      if (F.h2h && F.h2h.cards) out.push(`Head-to-head: ${f1(F.h2h.cards.perGame)} cards a game over the last ${F.h2h.cards.n} meetings.`);
      break;
    }
    case /^PL_/.test(k): {
      const p = sel.player || {};
      if (p.source === 'Fantasy Premier League xG') {
        out.push(`${p.fullName || p.name}: ${p.goals} league goals, ${f1(p.xg)} xG — ${pct(p.share)} of ${p.team}'s expected goals${p.penalties ? '; first-choice penalty taker' : ''}.`);
        out.push(p.lineup === 'start' ? 'Named in the starting line-up.' : p.lineup === 'bench' ? 'Named on the bench.' : `Chance of playing: ${pct(p.availability)} (Fantasy Premier League).`);
      } else {
        out.push(`${p.name}: ${p.goals} of ${p.team}'s ${p.teamGoals} league goals (ESPN).`);
        out.push(p.lineup === 'start' ? 'Named in the starting line-up.' : p.lineup === 'bench' ? 'Named on the bench.' : 'Line-up not published yet.');
      }
      break;
    }
    default:
      break;
  }
  return out.filter(Boolean);
}

/** Caveats worth reading before betting the pick. */
function caveats(sel, fx, report) {
  const out = [];
  const n = fx.names;
  const ctx = fx.ctx || {};
  if (sel.kind === 'corners' || sel.kind === 'cards') out.push('Statistics-only market: no bookmaker price on free data, so it is priced from the archive alone.');
  const sides = sel.side === 'both' ? ['home', 'away'] : sel.side ? [sel.side] : [];
  const fpl = report.fpl;
  for (const sd of sides) {
    if (fpl && fpl[sd] && fpl[sd].keyOut && fpl[sd].keyOut.length) {
      out.push(`${teamName(n, sd)} missing: ${fpl[sd].keyOut.slice(0, 3).map((p) => `${p.name}${p.news ? ` (${p.news})` : ''}`).join(', ')}.`);
    }
    if (ctx.news && ctx.news[sd] && ctx.news[sd].level === 'high') out.push(`${teamName(n, sd)}: a serious team-news report in the headlines — check the line-up.`);
  }
  for (const t of (fx.facts && fx.facts.traps) || []) {
    if (t.kind === 'model' || t.kind === 'rule') {
      if (t.key && t.key !== sel.key) continue;
    }
    out.push(`${t.label}${t.detail ? ` — ${t.detail}` : ''}`);
  }
  if (sel.group === 'Players' && !(sel.player && sel.player.lineup === 'start')) out.push('Confirm the line-up about an hour before kick-off.');
  if (sel.prob > 0.84) out.push(`Short price: fair odds ${(1 / sel.prob).toFixed(2)}. Best used inside a small accumulator.`);
  return [...new Set(out)].slice(0, 5);
}

/** The full explanation for one selection. */
function explain(sel, fx, report) {
  const n = fx.names;
  const facts = fx.facts || {};
  const lines = [];
  const goalKind = sel.kind === 'goals' || sel.kind === 'players';
  if (goalKind) {
    const p = priceLine(report, n);
    if (p) lines.push(p);
  }
  lines.push(...specific(sel, fx, report));
  if (goalKind) {
    const x = xgLine(fx, n);
    if (x) lines.push(x);
  }
  const h = h2hLine(facts.h2h, n);
  if (h && /^(1|2|1X|X2|12|O|U|BTTS|W|DC|HT|TT)/.test(sel.key)) lines.push(h);
  const tl = tableLine(facts, n);
  if (tl) lines.push(tl);
  const rl = restLine(facts, n);
  if (rl) lines.push(rl);
  return {
    checks: viewsLine(sel),
    reasons: [...new Set(lines.filter(Boolean))].slice(0, 6),
    caveats: caveats(sel, fx, report),
  };
}

module.exports = { explain, viewsLine, priceLine, xgLine, specific, caveats, VIEW_NAME };
