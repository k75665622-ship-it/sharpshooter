/**
 * news.js — team-news risk scanner.
 *
 * ESPN's match summary ships a handful of editorial headlines per fixture.
 * Those headlines are the only free, key-less source of team news available,
 * so they are treated as a RISK SIGNAL, never as ground truth.
 *
 * What this module does:
 *   1. Scans each headline + description for risk language (suspension, injury,
 *      doubt, transfer, rotation).
 *   2. Attributes the risk to the home side, the away side, or neither, by
 *      matching distinctive team-name tokens inside the article text.
 *   3. Returns a per-side risk level plus the matched evidence.
 *
 * What it deliberately does NOT do:
 *   - It never claims a player is definitely out. It reports what the headline
 *     says and marks the finding as needing verification.
 *   - It never invents a player name or a team. If no team is named, the item is
 *     filed as neutral rather than guessed at.
 *
 * The trap wiring lives in signals.js / engine.js: a risk only penalises a
 * market when it lands on the side that market actually depends on.
 */

/** Risk vocabulary, ordered most-severe first. First match wins. */
const RISK_PATTERNS = [
  {
    kind: 'suspension',
    sev: 'high',
    label: 'Suspension or red card',
    re: /\b(red card|sent off|suspension|suspended|banned|booking amnesty)\b/i,
  },
  {
    kind: 'injury_long',
    sev: 'high',
    label: 'Serious injury',
    re: /\b(acl|anterior cruciate|cruciate|broken leg|fracture|out for the season|season[- ]ending|long[- ]term (?:injury|absent)|surgery|operated)\b/i,
  },
  {
    kind: 'doubt',
    sev: 'high',
    label: 'Ruled out or doubtful',
    re: /\b(ruled out|will miss|misses (?:the|this|out)|out of (?:the|this)|sidelined|unavailable|doubtful|a doubt|in doubt|fitness test|late fitness|face(?:s)? a late)\b/i,
  },
  {
    kind: 'injury',
    sev: 'medium',
    label: 'Injury concern',
    re: /\b(injur(?:y|ed|ies)|hamstring|groin|ankle|knee|calf|thigh|muscle|knock|concussion|illness|strain|tightness)\b/i,
  },
  {
    kind: 'transfer',
    sev: 'medium',
    label: 'Squad departure',
    re: /\b(sold|transfer(?:red|s)?|departed|departure|left the club|leaves the club|exit|loan move|signed for|joins)\b/i,
  },
  {
    kind: 'rotation',
    sev: 'info',
    label: 'Possible rotation',
    re: /\b(rotation|rotated|rested|rest(?:ing)? key|squad rotation)\b/i,
  },
];

/** Words too generic to identify a team on their own. */
const STOPWORDS = new Set([
  'real', 'club', 'city', 'town', 'united', 'sporting', 'atletico', 'atlético',
  'deportivo', 'athletic', 'rovers', 'wanderers', 'county', 'albion', 'olympique',
  'olympiacos', 'dynamo', 'dinamo', 'sport', 'sportif', 'fc', 'cf', 'sc', 'ac',
  'as', 'ss', 'sv', 'vfl', 'vfb', 'tsg', 'rb', 'fk', 'sk', 'nk', 'hnk', 'if',
]);

/** Strip diacritics so "Málaga" matches "Malaga". */
function fold(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Build the distinctive match tokens for a team.
 * Uses the full name plus any word of 5+ characters that is not a stopword,
 * so "Real Sociedad" contributes "sociedad" but not "real".
 */
function teamTokens(team) {
  if (!team || !team.name) return [];
  const full = fold(team.name).trim();
  const toks = new Set();
  if (full.length >= 5) toks.add(full);
  for (const w of full.split(/[^a-z0-9]+/)) {
    if (w.length >= 5 && !STOPWORDS.has(w)) toks.add(w);
  }
  return [...toks];
}

/**
 * Which side does this text refer to? Returns 'home' | 'away' | null.
 *
 * Word order carries the meaning. Headlines routinely name BOTH teams, as in
 * "Besiktas key midfielder suspended for Marseille clash" — the risk word
 * ("suspended") sits immediately after the team it applies to, and the second
 * team is just the upcoming opponent. So when both sides are named, the team
 * whose token appears closest BEFORE the risk word owns the risk.
 *
 * If a team is only mentioned after the risk word, or the ordering is
 * ambiguous, we return null rather than guess.
 *
 * @param {string} text   folded article text
 * @param {number} riskAt index of the risk match inside `text`
 */
function attribute(text, homeTokens, awayTokens, riskAt) {
  const firstIndexOf = (toks) => {
    let best = -1;
    for (const k of toks) {
      const i = text.indexOf(k);
      if (i >= 0 && (best < 0 || i < best)) best = i;
    }
    return best;
  };
  const h = firstIndexOf(homeTokens);
  const a = firstIndexOf(awayTokens);

  if (h < 0 && a < 0) return null;   // no team named
  if (h >= 0 && a < 0) return 'home';
  if (a >= 0 && h < 0) return 'away';

  // Both named — use proximity to the risk word.
  const idx = typeof riskAt === 'number' && riskAt >= 0 ? riskAt : text.length;
  const hBefore = h < idx;
  const aBefore = a < idx;
  if (hBefore && !aBefore) return 'home';
  if (aBefore && !hBefore) return 'away';
  if (hBefore && aBefore) {
    // Both teams precede the risk word. If they are joined by a conjunction in a
    // short span ("Besiktas and Marseille both lose key men"), the report is
    // about BOTH sides — that is a joint statement, not a single-side risk.
    const lo = Math.min(h, a);
    const hi = Math.max(h, a);
    const between = text.slice(lo, hi);
    if (hi - lo < 30 && /(?:\band\b|&|,|\bboth\b)/.test(between)) return null;
    return h <= a ? 'home' : 'away'; // otherwise nearest to the risk word wins
  }
  return null; // both follow the risk word — genuinely ambiguous
}

/**
 * Scan the fixture's news.
 *
 * @returns {{
 *   home: {level: string, items: Array},
 *   away: {level: string, items: Array},
 *   neutral: Array,
 *   scanned: number,
 *   note: string
 * }}
 */
function scanNews(news, ctx) {
  const out = {
    home: { level: 'none', items: [] },
    away: { level: 'none', items: [] },
    neutral: [],
    scanned: 0,
    note: '',
  };
  if (!Array.isArray(news) || !news.length) {
    out.note = 'No team news published for this fixture.';
    return out;
  }

  const homeTokens = teamTokens(ctx && ctx.home);
  const awayTokens = teamTokens(ctx && ctx.away);
  const RANK = { none: 0, info: 1, medium: 2, high: 3 };

  for (const a of news) {
    out.scanned += 1;
    const headline = a.headline || '';
    const desc = a.description || '';
    const text = fold(headline + ' ' + desc);
    if (!text.trim()) continue;

    // Locate the risk word so attribution can use word order.
    let hit = null;
    let riskAt = -1;
    for (const p of RISK_PATTERNS) {
      const m = p.re.exec(text);
      if (m) { hit = p; riskAt = m.index; break; }
    }
    if (!hit) continue;

    const side = attribute(text, homeTokens, awayTokens, riskAt);
    const item = {
      kind: hit.kind,
      severity: hit.sev,
      label: hit.label,
      headline: String(headline).slice(0, 180),
      published: a.published ? String(a.published).slice(0, 10) : null,
      url: a.links && a.links.web ? a.links.web.href : null,
      // The matched fragment, so a human can check the claim in one glance.
      evidence: (text.slice(riskAt).match(hit.re) || [])[0] || null,
    };

    if (side === 'home' || side === 'away') {
      out[side].items.push(item);
      if (RANK[hit.sev] > RANK[out[side].level]) out[side].level = hit.sev;
    } else {
      // No team named — keep it visible but never let it drive a trap.
      out.neutral.push(item);
    }
  }

  if (!out.scanned) out.note = 'No team news published for this fixture.';
  else if (!out.home.items.length && !out.away.items.length && !out.neutral.length) {
    out.note = 'No injury, suspension or transfer language found in the published headlines.';
  } else {
    out.note = 'Headline-derived signal only — confirm with the official team sheet before acting.';
  }
  return out;
}

/**
 * Turn a news scan into trap objects for one market.
 *
 * A risk only counts against a market when it lands on the side that market
 * depends on. Risk on the OPPOSITE side is surfaced as information, never as a
 * penalty, because it may in fact help the selection.
 *
 * @param {object} risk  result of scanNews()
 * @param {object} market the market being scored
 * @param {string} side  marketSide(market)
 */
function newsTraps(risk, market, side) {
  const traps = [];
  if (!risk) return traps;

  const push = (sev, id, label, detail, extra) =>
    traps.push({ id, label, detail, severity: sev, ...(extra || {}) });

  const home = risk.home;
  const away = risk.away;

  // Which side does the market depend on?
  let own = null;      // risk here hurts the pick
  let other = null;    // risk here may help the pick
  if (side === 'home') { own = home; other = away; }
  else if (side === 'away') { own = away; other = home; }
  else if (side === 'draw') { own = null; other = null; }
  else if (side === 'over' || side === 'btts_yes') { own = null; other = null; }
  else if (side === 'under' || side === 'btts_no') { own = null; other = null; }

  const ev = (items) => items.slice(0, 2).map((i) => i.headline).join(' | ');

  // 1. Risk on the side the pick depends on.
  if (own && own.level !== 'none') {
    const items = own.items;
    const serious = items.filter((i) => i.kind === 'suspension' || i.kind === 'injury_long');
    const doubts = items.filter((i) => i.kind === 'doubt' || i.kind === 'injury');

    if (serious.length >= 2) {
      // Two independent confirmed absences on the same side is systematic
      // disruption, not a one-off knock. Veto this market so the engine has to
      // re-elect a different option.
      push('veto', 'news_disruption', 'Multiple confirmed absences',
        `${serious.length} separate reports of suspension or serious injury on the side this pick depends on. Headlines: ${ev(serious)}`,
        { source: 'news' });
    } else if (serious.length === 1) {
      push('high', 'news_absence', 'Confirmed absence',
        `Report of ${serious[0].label.toLowerCase()} affecting the side this pick depends on. Headline: ${serious[0].headline}`,
        { source: 'news' });
    }

    if (doubts.length) {
      push('medium', 'news_doubt', 'Fitness doubt',
        `${doubts.length} report${doubts.length > 1 ? 's' : ''} of injury or doubt on the side this pick depends on. Headlines: ${ev(doubts)}`,
        { source: 'news' });
    }
  }

  // 2. Totals / BTTS markets: an absence anywhere blunts (or sharpens) the goals
  //    outlook, so it is a caveat rather than a blocker.
  if (side === 'over' || side === 'btts_yes') {
    const hurt = [home, away].filter((s) => s.level === 'high');
    if (hurt.length) {
      push('info', 'news_goals_risk', 'Attacking personnel in doubt',
        'A confirmed absence in this fixture may reduce the goals outlook, which works against this pick. Confirm the line-up.',
        { source: 'news' });
    }
  }

  // 3. Risk on the other side — informational only, never a penalty.
  if (other && other.level === 'high') {
    push('info', 'news_opponent_weak', 'Opponent disruption noted',
      `Reported absence on the opposing side. This may strengthen the selection — noted for completeness, not penalised.`,
      { source: 'news' });
  }

  // 4. If nothing could be attributed to a team, say so plainly.
  if (risk.neutral.length && !traps.length) {
    push('info', 'news_unattributed', 'Team news needs review',
      `${risk.neutral.length} news item${risk.neutral.length > 1 ? 's' : ''} contain risk language but do not name a team, so no side could be inferred.`,
      { source: 'news' });
  }

  return traps;
}

module.exports = { scanNews, newsTraps, teamTokens, fold, RISK_PATTERNS };
