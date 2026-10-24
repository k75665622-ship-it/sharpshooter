'use strict';

/* ============================================================
   Sharpshooter — front-end
   Vanilla JS. No frameworks, no CDN, no build step.
   ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  date: null,          // 'YYYY-MM-DD'
  view: 'matches',
  board: null,
  analysis: null,      // current match report
  selectedId: null,
  preds: null,
  method: null,
  filter: { method: 'all', status: 'all', conf: 'all' },
  bankersOnly: false,
  autoRefresh: true,
  loadingDetail: false,
};

/* ---------------------------------------------------------- utils */

function todayISO() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
}

function shiftDate(iso, days) {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtDateLong(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  return d.toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const pct = (v, dp = 1) => (v == null ? '—' : (v * 100).toFixed(dp) + '%');
const dec = (v, dp = 2) => (v == null ? '—' : Number(v).toFixed(dp));

function oddsFromDecimal(d) {
  if (d == null) return '—';
  return Number(d).toFixed(2);
}

function formChips(form) {
  if (!form) return '';
  return `<span class="mr-form">${[...form].slice(-5).map((c) =>
    `<span class="fb ${esc(c)}">${esc(c)}</span>`).join('')}</span>`;
}

function setStatus(text, cls) {
  $('#statusText').textContent = text;
  $('#statusDot').className = 'dot ' + (cls || '');
}

async function api(path) {
  const res = await fetch(path);
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error('Bad response: ' + text.slice(0, 120)); }
  if (!res.ok) throw new Error(body.error || ('HTTP ' + res.status));
  return body;
}

/* ---------------------------------------------------------- board render */

function renderBoard() {
  const board = state.board;
  const el = $('#board');

  if (!board) return;
  if (!board.leagues.length) {
    el.innerHTML = `<div class="empty"><h3>No fixtures found</h3>
      <p>Nothing scheduled in the tracked competitions on ${esc(fmtDateLong(state.date))}.</p></div>`;
    return;
  }

  const bankerMap = new Map(); // fixture id -> its strongest methodology prediction
  if (state.preds && state.preds.headline) {
    for (const b of state.preds.headline) bankerMap.set(String(b.match.id), b);
  }
  const genMap = new Map(); // fixture id -> general prediction
  if (state.preds && state.preds.general) {
    for (const g of state.preds.general) genMap.set(String(g.match.id), g.general);
  }

  let html = '';
  let shown = 0;

  for (const lg of board.leagues) {
    let matches = lg.matches;
    if (state.bankersOnly) matches = matches.filter((m) => bankerMap.has(String(m.id)));
    if (!matches.length) continue;
    shown += matches.length;

    html += `<div class="league-group">
      <div class="league-head">
        <span class="flag">${esc(lg.flag || '')}</span>
        <span>${esc(lg.name)}</span>
        <span class="cc">${esc(lg.country)}</span>
        <span class="count">${matches.length} ${matches.length === 1 ? 'match' : 'matches'}</span>
      </div>
      <div class="match-list">`;

    for (const m of matches) {
      const bk = bankerMap.get(String(m.id));
      const isLive = m.state === 'in';
      const isPost = m.state === 'post';

      let timeCell;
      if (isLive) timeCell = `<div class="live">${esc(m.clock || 'LIVE')}</div><div class="ft">LIVE</div>`;
      else if (isPost) timeCell = `<div class="ft">FT</div>`;
      else timeCell = `<div>${fmtTime(m.date)}</div>`;

      const hWin = isPost && m.home.winner;
      const aWin = isPost && m.away.winner;

      const o = m.odds || {};
      const oddsHtml = o.homeClose
        ? `<div class="mr-odds">
             <span class="odd">${oddsFromDecimal(o.homeClose)}</span>
             <span class="odd">${oddsFromDecimal(o.drawClose)}</span>
             <span class="odd">${oddsFromDecimal(o.awayClose)}</span>
           </div>`
        : '';

      let badge = '';
      const gp = genMap.get(String(m.id));
      const scoreChip = gp && !isPost && !isLive
        ? `<span class="sc-chip" title="Predicted final score · ${esc(gp.result.label)} ${pct(gp.result.prob, 0)}">${gp.score.predicted.home}–${gp.score.predicted.away}</span>` : '';
      if (isLive) badge = `<span class="badge live">live</span>`;
      else if (bk) {
        const sm = statusMeta(bk.prediction.status);
        badge = `<span class="badge st-${sm.cls}" title="${esc(bk.prediction.name)}">${esc(bk.prediction.pick.label)}</span>`;
      }

      html += `<div class="match-row ${state.selectedId === String(m.id) ? 'is-open' : ''}" data-id="${esc(m.id)}" data-league="${esc(m.league)}" data-year="${esc(m.seasonYear || '')}">
        <div class="mr-time">${timeCell}</div>
        <div class="mr-teams">
          <div class="mr-team ${hWin ? 'win' : ''}">
            ${m.home.logo ? `<img src="${esc(m.home.logo)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
            <span class="nm">${esc(m.home.name)}</span>
            ${isPost || isLive ? `<span class="score">${m.home.score ?? ''}</span>` : formChips(m.home.form)}
          </div>
          <div class="mr-team ${aWin ? 'win' : ''}">
            ${m.away.logo ? `<img src="${esc(m.away.logo)}" alt="" loading="lazy" onerror="this.style.display='none'">` : ''}
            <span class="nm">${esc(m.away.name)}</span>
            ${isPost || isLive ? `<span class="score">${m.away.score ?? ''}</span>` : formChips(m.away.form)}
          </div>
        </div>
        <div class="mr-right">
          <div class="mr-badges">${scoreChip}${badge}</div>
          ${oddsHtml}
        </div>
      </div>`;
    }

    html += `</div></div>`;
  }

  if (!shown) {
    el.innerHTML = `<div class="empty"><h3>No predictions qualify</h3>
      <p>No fixture on ${esc(fmtDateLong(state.date))} fits any methodology. Try another date or untick “Predicted only”.</p></div>`;
    return;
  }

  el.innerHTML = html;

  $$('.match-row', el).forEach((row) => {
    row.addEventListener('click', () => openMatch(row.dataset.id, row.dataset.league, row.dataset.year));
  });
}

/* ---------------------------------------------------------- detail */

async function openMatch(id, league, year) {
  state.selectedId = String(id);
  state.loadingDetail = true;
  renderBoard();
  document.querySelector('.layout').classList.add('detail-open');
  const detail = $('#detail');
  detail.classList.add('open');
  detail.setAttribute('aria-hidden', 'false');

  $('#detailInner').innerHTML = `<div class="loading"><div class="spinner"></div>
    <p>Running the full analysis pipeline…</p>
    <p style="font-size:11px;max-width:280px;text-align:center;color:var(--text-3)">
      Fetching xG/xGA, form, head-to-head, line movement and running the Dixon-Coles model.</p></div>`;

  try {
    // The date must be sent: the server rebuilds the fixture from that day's
    // scoreboard, so omitting it makes every non-today fixture unresolvable.
    const url = `/api/analysis?league=${encodeURIComponent(league)}&event=${encodeURIComponent(id)}` +
      `&date=${encodeURIComponent(state.date)}` +
      (year ? `&year=${encodeURIComponent(year)}` : '');
    const rep = await api(url);
    state.analysis = rep;
    renderDetail(rep);
    setStatus('analysis ready', 'ok');
  } catch (err) {
    $('#detailInner').innerHTML = `<div class="err-box"><strong>Analysis failed</strong><br>${esc(err.message)}</div>`;
    setStatus('analysis error', 'err');
  } finally {
    state.loadingDetail = false;
  }
}

function closeDetail() {
  state.selectedId = null;
  $('#detail').classList.remove('open');
  $('#detail').setAttribute('aria-hidden', 'true');
  document.querySelector('.layout').classList.remove('detail-open');
  renderBoard();
}

function scoreClass(s) {
  if (s >= 80) return 'hi';
  if (s >= 65) return 'mid';
  return 'lo';
}

function renderDetail(rep) {
  const m = rep.match;
  const el = $('#detailInner');

  const head = `
    <button class="d-close" id="dClose" title="Close">×</button>
    <div class="d-head">
      <div class="d-league">${esc(m.leagueFlag || '')} ${esc(m.leagueName)}${m.country ? ' · ' + esc(m.country) : ''}</div>
      <div class="d-score">
        <div class="d-team">
          ${m.home.logo ? `<img src="${esc(m.home.logo)}" alt="">` : ''}
          <div class="nm">${esc(m.home.name)}</div>
          <div class="sub">${esc(m.home.record || '')}${m.home.form ? ' · ' + esc(m.home.form) : ''}</div>
        </div>
        <div class="d-vs">${m.state === 'pre' ? fmtTime(m.date) : (m.home.score ?? 0) + ' – ' + (m.away.score ?? 0)}</div>
        <div class="d-team">
          ${m.away.logo ? `<img src="${esc(m.away.logo)}" alt="">` : ''}
          <div class="nm">${esc(m.away.name)}</div>
          <div class="sub">${esc(m.away.record || '')}${m.away.form ? ' · ' + esc(m.away.form) : ''}</div>
        </div>
      </div>
      <div class="d-meta">${esc(fmtDateLong(m.date.slice(0, 10)))} · ${esc(fmtTime(m.date))}${m.venue ? ' · ' + esc(m.venue) : ''}</div>
    </div>`;

  if (!rep.analysable) {
    el.innerHTML = head + `<div class="no-banker"><strong>No prediction issued</strong> ${esc(rep.reason || '')}</div>`
      + newsSection(rep);
    bindDetail();
    return;
  }

  el.innerHTML = head + generalSection(rep) + intelSection(rep) + intelTrapsSection(rep) + methodologySection(rep) + ensembleSection(rep)
    + availabilitySection(rep) + modelSection(rep) + marketSection(rep)
    + patternSection(rep) + trapSection(rep) + lineMovementSection(rep)
    + h2hSection(rep) + formSection(rep) + provenanceSection(rep) + newsSection(rep);

  bindDetail();
}

/* ---------------------------------------------------------- v5 detail sections */

function scoreGrid(g, home, away) {
  // a compact 5x5 exact-score heat grid from the top scores list
  const top = new Map((g.score.top || []).map((t) => [t.score, t.prob]));
  if (g.score.grid5) g.score.grid5.forEach((row, h) => row.forEach((p, a) => top.set(`${h}-${a}`, p)));
  const max = Math.max(...top.values(), 0.01);
  let rows = '<div class="sg"><div class="sg-corner"></div>';
  for (let a = 0; a <= 4; a++) rows += `<div class="sg-h">${a}</div>`;
  for (let h = 0; h <= 4; h++) {
    rows += `<div class="sg-h">${h}</div>`;
    for (let a = 0; a <= 4; a++) {
      const k = `${h}-${a}`;
      const p = top.get(k);
      const isPred = k === g.score.predicted.score;
      rows += `<div class="sg-c ${isPred ? 'is-pred' : ''}" style="${p ? `--w:${(p / max).toFixed(2)}` : ''}" title="${k}${p ? ' · ' + pct(p, 1) : ''}">${p >= 0.005 ? pct(p, 0) : ''}</div>`;
    }
  }
  rows += '</div>';
  return `<div class="sg-wrap"><div class="sg-axis">${esc(home)} goals ↓ · ${esc(away)} goals →</div>${rows}</div>`;
}

function generalSection(rep) {
  const g = rep.general;
  if (!g || g.error) return '';
  const m = rep.match;
  const sp = g.score;
  const cc = CONF_CLS[g.confidence.level] || 'watch';
  const bb = g.bestBet;
  return `<div class="sec"><div class="sec-title">Prediction <span class="pill">general · v${esc(g.version)}</span>
      <span class="badge st-${cc}" title="${esc(g.confidence.reasons.join(' · '))}">${esc(g.confidence.level)} confidence</span></div>
    <div class="gp">
      <div class="gp-score">
        <div class="gp-k">Predicted final score</div>
        <div class="gp-sc">${esc(m.home.short || m.home.name)} <b>${sp.predicted.home} – ${sp.predicted.away}</b> ${esc(m.away.short || m.away.name)}</div>
        <div class="gp-sub">${pct(sp.predicted.prob, 1)} exact · half-time ${esc(sp.halfTime.score)} · xG ${dec(sp.expected.home)}–${dec(sp.expected.away)}</div>
        ${sp.mostLikely.score !== sp.predicted.score ? `<div class="gp-sub">Single likeliest score: <b>${esc(sp.mostLikely.score)}</b> (${pct(sp.mostLikely.prob, 1)})</div>` : ''}
        <div class="gp-sub">Score band (${pct(sp.band.prob, 0)}): ${esc(sp.band.scores.join(', '))}</div>
      </div>
      <div class="gp-calls">
        <div class="gp-call"><span>Result</span><b>${esc(g.result.label)}</b><em>${pct(g.result.prob, 0)}</em></div>
        <div class="gp-call"><span>Double chance</span><b>${esc(g.doubleChance ? g.doubleChance.label : '—')}</b><em>${g.doubleChance ? pct(g.doubleChance.prob, 0) : ''}</em></div>
        <div class="gp-call"><span>Goals</span><b>${esc(g.goals.call)} 2.5</b><em>${pct(g.goals.prob, 0)}</em></div>
        <div class="gp-call"><span>Both score</span><b>${esc(g.btts.call)}</b><em>${pct(g.btts.prob, 0)}</em></div>
        ${(g.goals.extra || []).map((x) => `<div class="gp-call"><span>Also</span><b>${esc(x.label)}</b><em>${pct(x.prob, 0)}</em></div>`).join('')}
      </div>
    </div>
    ${bb ? `<div class="gp-best">
      <div class="gp-k">${g.version === '6.0' ? 'Main pick · v6 match decision' : g.source === 'methodology' ? `Best bet · from ${esc(bb.methodology)} (${esc(statusMeta(bb.status).label)})` : 'Best bet · most likely selection paying ≥ 1.30'}</div>
      <div class="gp-bb">${esc(bb.label)} <em>${pct(bb.prob, 0)}</em></div>
      <div class="gp-sub">Fair odds ${dec(bb.fairOdds)} · take it at <b>${dec(bb.valuePrice)}</b> or better${bb.best ? ` · best seen ${dec(bb.best)} (${esc(bb.bestBook || '')})` : ''}${bb.modelProb != null ? ` · independent model ${pct(bb.modelProb, 0)}` : ''}${bb.baseProb != null ? ` · price alone ${pct(bb.baseProb, 0)}` : ''}</div>
      ${g.confidence && g.confidence.measured ? `<div class="gp-sub">${esc(g.confidence.level)}-confidence picks won <b>${pct(g.confidence.measured.hit, 1)}</b> (stated ${pct(g.confidence.measured.stated, 1)}) on ${g.confidence.measured.n.toLocaleString()} held-out matches.</div>` : ''}
      ${g.methodologyPick ? `<div class="gp-sub">${g.methodologyPick.agrees ? '✓ Also qualifies' : 'Methodology pick'}: <b>${esc(g.methodologyPick.label)}</b> — ${esc(g.methodologyPick.name)} (${esc(statusMeta(g.methodologyPick.status).label)})</div>` : ''}
    </div>` : ''}
    ${(g.alternatives || []).length && !(rep.intel && rep.intel.available) ? `<div class="gp-alts">${g.alternatives.map((a) => `<div class="gp-alt ${esc(a.role)}"><span>${a.role === 'value' ? 'Value pick' : a.role === 'safer' ? 'Safer pick' : 'Also'}</span><b>${esc(a.label)}</b> <em>${pct(a.prob, 0)}</em>
      <small>${a.role === 'value' && a.best ? `best ${dec(a.best)}${a.bestBook ? ' (' + esc(a.bestBook) + ')' : ''} vs fair ${dec(a.fairOdds)}${a.ev != null ? ' · edge ' + signed(a.ev * 100, 1) + '%' : ''}` : `take at ≥ ${dec(a.valuePrice)}`}</small></div>`).join('')}</div>` : ''}
    ${(g.avoid || []).length && !(rep.intel && rep.intel.available) ? `<div class="gp-avoid"><span>Avoid</span>${g.avoid.map((a) => `<b title="price ${pct(a.baseProb, 0)} vs factors ${pct(a.prob, 0)}">${esc(a.label)} <small>${signed((a.shift || 0) * 100, 1)} pts</small></b>`).join('')}</div>` : ''}
    ${scoreGrid(g, m.home.short || m.home.name, m.away.short || m.away.name)}
    <div class="gp-sum">${esc(g.summary)}</div>
  </div>`;
}

/* ---------------------------------------------------------- v6 match intelligence */

const VERDICT = {
  trap: { cls: 'v-trap', label: 'Confirmed trap' },
  edge: { cls: 'v-edge', label: 'Confirmed edge' },
  weak: { cls: 'v-weak', label: 'Weak signal' },
  unstable: { cls: 'v-weak', label: 'Unstable' },
  'priced-in': { cls: 'v-priced', label: 'Priced in' },
  untested: { cls: 'v-priced', label: 'Untested' },
};
const TRAP_KIND = { model: 'Factors', rule: 'Pattern', data: 'Data', context: 'Context' };

function decisionCard(x, title, cls) {
  if (!x) return '';
  return `<div class="dc ${cls}"><div class="dc-k">${esc(title)}</div><div class="dc-l">${esc(x.label)} <em>${pct(x.prob, 0)}</em></div>
    <div class="dc-s">${x.base != null ? `price alone ${pct(x.base, 0)} · factors ${signed((x.prob - x.base) * 100, 1)} pts · ` : ''}fair ${dec(x.fair)} · take at <b>${dec(x.takeAt)}</b>${x.best ? ` · best seen ${dec(x.best)}${x.bestBook ? ' (' + esc(x.bestBook) + ')' : ''}` : ''}${/value/.test(cls) && x.ev != null ? ` · edge <b class="pos">${signed(x.ev * 100, 1)}%</b>` : ''}</div></div>`;
}

function trendTable(rows, name) {
  if (!rows || !rows.length) return `<div class="tr-side"><div class="tr-h">${esc(name)}</div><div class="muted-t">No archived games.</div></div>`;
  const chips = rows.slice().reverse().map((g) => `<span class="fb ${g.res}" title="${esc(g.date)} ${g.venue === 'H' ? 'v' : '@'} ${esc(g.opp)} ${g.gf}-${g.ga}">${g.res}</span>`).join('');
  return `<div class="tr-side"><div class="tr-h">${esc(name)} <span class="mr-form">${chips}</span></div>
    <div class="tr-t"><div class="tr-r head"><span>Date</span><span>Opponent</span><span>Score</span><span>HT</span><span>Shots on tgt</span><span>vs odds</span></div>
    ${rows.map((g) => `<div class="tr-r"><span>${esc(String(g.date).slice(5))}</span><span>${g.venue === 'H' ? 'v' : '@'} ${esc(g.opp)}</span>
      <span class="sc ${g.res}">${g.gf}-${g.ga}</span><span>${g.htgf != null ? g.htgf + '-' + g.htga : '—'}</span>
      <span>${g.sotf != null ? g.sotf + '-' + g.sota : '—'}</span><span class="${g.pve > 0 ? 'pos' : g.pve < 0 ? 'neg' : ''}">${g.pve == null ? '—' : signed(g.pve, 1)}</span></div>`).join('')}</div></div>`;
}

function intelSection(rep) {
  const I = rep.intel;
  if (!I) return '';
  if (!I.available) {
    return `<div class="sec"><div class="sec-title">Match intelligence <span class="pill">v6</span></div><div class="src-note">${esc(I.reason || 'Not available for this fixture.')}</div></div>`;
  }
  const m = rep.match;
  const d = I.decision || {};
  const conf = d.confidence || {};
  const why = (I.topPull || []).length
    ? `<div class="why"><div class="why-h">What moved the forecast for <b>${esc(d.main ? d.main.label : 'the pick')}</b> (vs the price alone)</div>
      ${I.topPull.map((p) => `<div class="why-r"><span>${esc(p.label)}</span><span class="why-bar"><i class="${p.pts >= 0 ? 'up' : 'dn'}" style="width:${Math.min(100, Math.abs(p.pts) * 30).toFixed(0)}%"></i></span><b class="${p.pts >= 0 ? 'pos' : 'neg'}">${signed(p.pts, 1)}</b></div>`).join('')}</div>`
    : '';
  const fams = (I.families || []).map((g) => {
    const iw = g.importance ? g.importance.withMarket : null;
    const io = g.importance ? g.importance.factorsOnly : null;
    return `<details class="fam"><summary><span class="fam-n">${esc(g.name)}</span>
      <span class="fam-imp" title="Measured share of the model's decisions on held-out seasons — with a price / with no price">
        <span class="imp-bar"><i style="width:${Math.round((iw || 0) * 300)}%"></i></span>${iw != null ? pct(iw, 0) : '—'}<small> / ${io != null ? pct(io, 0) : '—'}</small></span>
      <span class="fam-pull ${g.pull > 0 ? 'pos' : g.pull < 0 ? 'neg' : ''}">${g.pull == null ? '' : signed(g.pull, 1) + ' pts'}</span></summary>
      <div class="fam-b"><div class="fam-blurb">${esc(g.blurb)}</div>${g.facts.length ? g.facts.map((f) => `<div class="fact">${esc(f)}</div>`).join('') : '<div class="fact muted-t">Not enough data for this family.</div>'}</div></details>`;
  }).join('');
  const w = I.context && I.context.weather;
  const rest = I.context && I.context.restAllComps;
  const arch = I.data && I.data.archive ? Object.values(I.data.archive) : [];
  return `<div class="sec"><div class="sec-title">Match intelligence <span class="pill">v6 · ${esc(I.source === 'market+factors' ? 'price + factors' : 'factors only')}</span>
      <span class="badge st-${CONF_CLS[conf.level] || 'watch'}" title="${esc((conf.reasons || []).join(' · '))}">${esc(conf.level || '—')}</span></div>
    <div class="dcs">
      ${decisionCard(d.main, d.value && d.main && d.value.key === d.main.key ? 'Main pick · also the value pick' : 'Main pick', d.value && d.main && d.value.key === d.main.key ? 'main value' : 'main')}
      ${decisionCard(d.safer, 'Safer pick', 'safer')}
      ${d.value && (!d.main || d.value.key !== d.main.key) ? decisionCard(d.value, 'Value pick (best price beats fair)', 'value') : ''}
    </div>
    ${(d.avoid || []).length ? `<div class="dc avoid"><div class="dc-k">Avoid — the factors say the price overrates these</div>${d.avoid.map((a) => `<div class="dc-s"><b>${esc(a.label)}</b> — price ${pct(a.base, 0)}, factors ${pct(a.prob, 0)} (${signed((a.shift || 0) * 100, 1)} pts)${a.rule ? ' · confirmed trap pattern' : ''}</div>`).join('')}</div>` : ''}
    ${conf.measured ? `<div class="meas-note">${esc(conf.level)}-confidence main picks won <b>${pct(conf.measured.hit, 1)}</b> (stated ${pct(conf.measured.stated, 1)}) on ${conf.measured.n.toLocaleString()} held-out matches.${(conf.reasons || []).length ? ' ' + esc(conf.reasons.join(' · ')) + '.' : ''}</div>` : ''}
    ${why}
    <div class="fam-h"><span>Factor family</span><span>Weight <small>with price / without</small></span><span>Pull</span></div>
    ${fams}
    <div class="trends">${trendTable(I.trends && I.trends.home, m.home.name)}${trendTable(I.trends && I.trends.away, m.away.name)}</div>
    ${I.h2h && I.h2h.length ? `<div class="h2h6"><div class="tr-h">Head-to-head (league, 6 years)</div>${I.h2h.map((x) => `<div class="h2h6-r"><span>${esc(x.date)}</span><span>${esc(x.home)} <b>${x.hg}-${x.ag}</b> ${esc(x.away)}</span></div>`).join('')}</div>` : ''}
    <div class="ctx">
      ${w ? `<span>☁ ${esc(w.place)}: ${w.tempC != null ? Math.round(w.tempC) + '°C' : ''} ${esc(w.description || '')}${w.precipMm != null ? ', ' + w.precipMm + ' mm rain' : ''}${w.windKmh != null ? ', wind ' + Math.round(w.windKmh) + ' km/h' : ''} <small>(context only — not in the model)</small></span>` : ''}
      ${rest && (rest.home != null || rest.away != null) ? `<span>Days since last game, any competition: ${esc(m.home.short || m.home.name)} ${rest.home ?? '—'}, ${esc(m.away.short || m.away.name)} ${rest.away ?? '—'}</span>` : ''}
      <span>${I.factorsKnown}/${I.factorsTotal} factors measured · price: ${esc(I.priceSource || 'none')}</span>
      ${arch.length ? `<span>Archive: ${arch.map((a) => `${esc(a.div || a.slug)} ${a.matches || 0} games (${a.withStats || 0} with shots)`).join(' · ')}</span>` : ''}
    </div>
  </div>`;
}

function intelTrapsSection(rep) {
  const I = rep.intel;
  if (!I || !I.available) return '';
  const traps = I.traps || [];
  const pats = I.patterns || [];
  if (!traps.length && !pats.length) return '';
  return `<div class="sec"><div class="sec-title">Patterns &amp; traps <span class="pill">every claim tested on past seasons</span></div>
    ${traps.length ? `<div class="traps6">${traps.map((t) => `<div class="trap6 k-${esc(t.kind)}"><span class="tk">${esc(TRAP_KIND[t.kind] || t.kind)}</span><div><b>${esc(t.label)}</b><div class="dc-s">${esc(t.detail || '')}</div></div></div>`).join('')}</div>` : '<div class="src-note">No trap flags on this fixture.</div>'}
    ${pats.length ? `<div class="pats">${pats.map((p) => {
      const v = VERDICT[p.verdict] || VERDICT.untested;
      const e = p.evidence;
      return `<div class="pat"><span class="verdict ${v.cls}">${esc(v.label)}</span><div><b>${esc(p.desc)}</b>
        <div class="dc-s">${esc(p.plain)}${e && e.n ? ` — since 2023 the price said ${pct(e.said, 1)}, it won ${pct(e.won, 1)} (${e.n.toLocaleString()} matches)` : ''}</div></div></div>`;
    }).join('')}</div>` : ''}
  </div>`;
}

function ensembleSection(rep) {
  const e = rep.model && rep.model.ensemble;
  if (!e) return '';
  const comp = e.components || {};
  const names = { market: 'Bookmaker consensus', ratings: 'Results ratings (Dixon-Coles)', xg: 'ESPN xG formula', elo: 'ClubElo' };
  const rows = Object.entries(names).map(([k, label]) => {
    const c = comp[k];
    const w = k === 'market' ? e.weights.market : (e.weights.parts && e.weights.parts[k] != null ? e.weights.parts[k] * e.weights.model / Object.values(e.weights.parts).reduce((a, b) => a + b, 0) : 0);
    return `<div class="en-row ${c ? '' : 'is-off'}"><span>${esc(label)}</span>
      <span class="num">${c ? dec(c.lamH) + ' – ' + dec(c.lamA) : 'not available'}</span>
      <span class="en-bar"><span style="width:${c ? Math.round(w * 100) : 0}%"></span></span><span class="num">${c ? Math.round(w * 100) + '%' : ''}</span></div>`;
  }).join('');
  const cons = rep.consensus;
  const x = cons && cons.x12;
  const ag = e.agreement || {};
  return `<div class="sec"><div class="sec-title">How the probabilities were built <span class="pill">${esc(e.calibrationSet === 'withMarket' ? 'market-anchored' : 'model only')} · calibrated</span></div>
    <div class="en-head"><span>Component</span><span class="num">Expected goals</span><span></span><span class="num">Weight</span></div>
    ${rows}
    <div class="en-final">Final: <b>${dec(rep.model.lambda.home)} – ${dec(rep.model.lambda.away)}</b> expected goals${ag.supremacySpread != null ? ` · witnesses differ by ${dec(ag.supremacySpread)} goals on supremacy` : ''}</div>
    ${x ? `<div class="en-cons"><b>Bookmaker consensus</b> (${cons.nBooks} source${cons.nBooks === 1 ? '' : 's'}: ${esc(cons.books.join(', '))}) — fair
      ${esc(rep.match.home.short)} ${pct(x.fair.home, 0)} · draw ${pct(x.fair.draw, 0)} · ${esc(rep.match.away.short)} ${pct(x.fair.away, 0)}
      ${x.best && x.best.h ? `<br>Best prices: ${dec(x.best.h.price)} (${esc(x.best.h.book)}) · ${x.best.d ? dec(x.best.d.price) + ' (' + esc(x.best.d.book) + ')' : '—'} · ${x.best.a ? dec(x.best.a.price) + ' (' + esc(x.best.a.book) + ')' : '—'}` : ''}
      ${x.spread != null && x.spread >= 0.04 ? `<br><span class="warn-t">Books disagree by ${pct(x.spread, 0)} on one outcome — one price is an outlier.</span>` : ''}</div>` : ''}
    <div class="src-note">Probabilities are calibrated on real results (38,700 matches with every model input, from a 46,121-match research set). With a price, the market carries 90% of the weight because in testing it was the most accurate forecast; the independent model is shown alongside as a second witness.</div>
  </div>`;
}

function availabilitySection(rep) {
  const f = rep.fpl;
  if (!f || !f.home || !f.away) return '';
  const side = (r, name) => `<div class="av-side"><div class="av-h">${esc(name)} <span>${pct(r.attackLoss, 0)} of attacking output unavailable${r.gkOut ? ' · keeper out' : ''}</span></div>
    ${r.keyOut.length ? r.keyOut.map((p) => `<div class="av-p out"><b>${esc(p.name)}</b> ${esc(p.pos)} · ${p.chance}% <em>${esc(p.news || '')}</em></div>`).join('') : '<div class="av-p">No regular ruled out.</div>'}
    ${r.doubtful.map((p) => `<div class="av-p doubt"><b>${esc(p.name)}</b> ${esc(p.pos)} · ${p.chance}% <em>${esc(p.news || '')}</em></div>`).join('')}
  </div>`;
  return `<div class="sec"><div class="sec-title">Availability <span class="pill">Fantasy Premier League · club-fed</span></div>
    <div class="av">${side(f.home, rep.match.home.name)}${side(f.away, rep.match.away.name)}</div></div>`;
}

function modelSection(rep) {
  const { pHome, pDraw, pAway } = rep.model.oneXtwo;
  const lam = rep.model.lambda;
  return `<div class="sec">
    <div class="sec-title">Model output <span class="pill">Dixon-Coles</span></div>
    <div class="probbars">
      <div class="pb"><span class="pb-label">${esc(rep.match.home.short)} win</span>
        <span class="pb-track"><span class="pb-fill" style="width:${(pHome * 100).toFixed(1)}%"></span></span>
        <span class="pb-val">${pct(pHome)}</span></div>
      <div class="pb"><span class="pb-label">Draw</span>
        <span class="pb-track"><span class="pb-fill draw" style="width:${(pDraw * 100).toFixed(1)}%"></span></span>
        <span class="pb-val">${pct(pDraw)}</span></div>
      <div class="pb"><span class="pb-label">${esc(rep.match.away.short)} win</span>
        <span class="pb-track"><span class="pb-fill away" style="width:${(pAway * 100).toFixed(1)}%"></span></span>
        <span class="pb-val">${pct(pAway)}</span></div>
    </div>
    <div class="xgbox">
      <div class="xgcell"><div class="v">${dec(lam.home)}</div><div class="k">${esc(rep.match.home.short)} xG</div></div>
      <div class="xgcell"><div class="v">${dec(lam.home + lam.away)}</div><div class="k">Total goals</div></div>
      <div class="xgcell"><div class="v">${dec(lam.away)}</div><div class="k">${esc(rep.match.away.short)} xG</div></div>
    </div>
    <div style="margin-top:10px;font-size:11.5px;color:var(--text-2);line-height:1.6">
      ${rep.verdict.keyFactors.map((f) => '· ' + esc(f)).join('<br>')}
    </div>
  </div>`;
}

/**
 * Where a market's price came from.
 *
 * Three real sources are possible, and the distinction matters: a price quoted
 * by several independent Asian books is a far stronger reference than our own
 * model's fair odds, which is why only real book prices can be value-verified.
 */
function priceLabel(mk) {
  switch (mk.priceSource) {
    case 'book': return 'Book price';
    case 'book-combined': return 'Derived from books';
    case 'book-asian': return mk.priceBooks ? `Consensus of ${mk.priceBooks} Asian books` : 'Asian books';
    default: return 'Fair odds — unquoted';
  }
}

/** Short provenance tag for dense table rows. */
function priceTag(mk) {
  switch (mk.priceSource) {
    case 'book': return { text: 'DK', cls: 'src-book' };
    case 'book-combined': return { text: 'derived', cls: 'src-derived' };
    case 'book-asian': return { text: mk.priceBooks ? `ASIAN×${mk.priceBooks}` : 'ASIAN', cls: 'src-asian' };
    default: return { text: 'model', cls: 'src-model' };
  }
}

function marketSection(rep) {
  const groups = new Map();
  for (const mk of rep.markets) {
    if (!groups.has(mk.group)) groups.set(mk.group, []);
    groups.get(mk.group).push(mk);
  }
  // Show a focused set of groups to keep the panel readable.
  const order = ['1X2', 'Double Chance', 'Draw No Bet', 'Asian Handicap', 'Totals', 'BTTS', 'Team Totals', 'Half Time', 'Correct Score'];

  const verified = rep.markets.filter((m) => m.verified).length;
  let html = `<div class="sec"><div class="sec-title">Market board <span class="pill">${rep.markets.length} markets · ${verified} price-verified</span></div>`;
  html += `<div class="mkt-row head"><span>Market</span><span class="num">Prob</span><span class="num">Price</span><span class="num">EV</span><span class="sc">Score</span></div>`;

  for (const g of order) {
    const list = groups.get(g);
    if (!list) continue;
    const shown = g === 'Correct Score' ? [...list].sort((a, b) => b.score - a.score).slice(0, 6) : list;
    html += `<div class="mkt-group"><h4>${esc(g)}</h4>`;
    for (const mk of shown) {
      const evCls = mk.valuePct == null ? '' : mk.valuePct > 0 ? 'pos' : 'neg';
      const veto = mk.vetoed ? '<span class="veto-tag">vetoed</span>' : '';
      const tag = priceTag(mk);
      html += `<div class="mkt-row ${mk.isBanker ? 'is-banker' : ''} ${mk.vetoed ? 'is-vetoed' : ''}">
        <span class="lbl">${mk.isBanker ? '★ ' : ''}${esc(mk.label)} ${veto}</span>
        <span class="num">${pct(mk.prob, 0)}</span>
        <span class="num">${dec(mk.price)}<span class="src ${tag.cls}" title="${esc(priceLabel(mk))}">${esc(tag.text)}</span></span>
        <span class="num ${evCls}">${mk.valuePct == null ? '—' : (mk.valuePct > 0 ? '+' : '') + mk.valuePct.toFixed(0) + '%'}</span>
        <span class="sc ${scoreClass(mk.score)}">${mk.score.toFixed(0)}</span>
      </div>`;
    }
    html += `</div>`;
  }
  // Be explicit when the secondary odds source is missing. Silently showing
  // ESPN-only pricing would overstate how much of the board we could verify.
  const pv = rep.dataProvenance || {};
  const srcNote = pv.asianNote
    ? `<div class="src-note">⚠ Asian book pricing unavailable — ${esc(pv.asianNote)}.
        Multi-line handicap, half-time and higher/lower totals are unquoted on this fixture,
        so they cannot be value-verified or elected.</div>`
    : '';

  html += `<div style="font-size:11px;color:var(--text-3);margin-top:6px">
    <b>DK</b> = ESPN/DraftKings quote · <b>ASIAN×n</b> = consensus of n Asian books (Infersports) ·
    <b>derived</b> = combined from quoted legs · <b>model</b> = our own fair price, no book quote.
    EV is shown only where a real book price exists, so an unquoted market can never be presented as value.</div>`;
  html += srcNote;
  html += `</div>`;
  return html;
}

function patternSection(rep) {
  const p = rep.patterns;
  const render = (arr, hidden) => arr.map((x) => `
    <div class="pat">
      <span class="pat-ico ${hidden ? 'hidden' : ''}">${hidden ? 'H' : 'V'}</span>
      <span class="pat-body"><span class="pat-t">${esc(x.label)}</span><br><span class="pat-d">${esc(x.detail)}</span></span>
      <span class="pat-w">${(x.weight * 100).toFixed(0)}%</span>
    </div>`).join('');

  if (!p.visible.length && !p.hidden.length) return '';
  return `<div class="sec"><div class="sec-title">Patterns
      <span class="pill">${p.visible.length} visible · ${p.hidden.length} hidden</span></div>
    ${render(p.visible, false)}
    ${p.hidden.length ? `<div style="margin-top:9px;font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3)">Hidden signals</div>${render(p.hidden, true)}` : ''}
  </div>`;
}

function trapSection(rep) {
  // Collect the distinct traps that affected the banker / best markets.
  const all = [];
  const seen = new Set();
  for (const mk of rep.markets) {
    for (const t of mk.traps || []) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      all.push({ ...t, market: mk.label });
    }
  }
  if (!all.length) {
    return `<div class="sec"><div class="sec-title">Bookmaker trap screening</div>
      <div class="trap medium"><span>✓</span><span><span class="tt">No traps detected</span><br>
      <span class="td">Margin, line movement, model/market divergence, sample size and xG-regression checks all passed.</span></span></div></div>`;
  }
  const order = { veto: 0, high: 1, medium: 2 };
  all.sort((a, b) => order[a.severity] - order[b.severity]);
  return `<div class="sec"><div class="sec-title">Bookmaker trap screening <span class="pill">${all.length} flagged</span></div>
    ${all.map((t) => `<div class="trap ${esc(t.severity)}">
      <span>${t.severity === 'veto' ? '✕' : t.severity === 'high' ? '!' : '·'}</span>
      <span><span class="tt">${esc(t.label)}</span><br><span class="td">${esc(t.detail)}</span>
      <br><span class="td" style="font-size:10.5px">Affects: ${esc(t.market)}</span></span></div>`).join('')}
  </div>`;
}

function lineMovementSection(rep) {
  const lm = rep.lineMovement;
  if (!lm || !lm.moves.length) return '';
  return `<div class="sec"><div class="sec-title">Line movement <span class="pill">open → close</span></div>
    <div class="lm-row head" style="font-size:9.5px;text-transform:uppercase;color:var(--text-3);font-weight:700">
      <span>Side</span><span></span><span class="num">Open</span><span class="num">Close</span></div>
    ${lm.moves.map((mv) => {
      const cls = mv.changePct <= -1 ? 'steam' : mv.changePct >= 1 ? 'drift' : '';
      return `<div class="lm-row">
        <span>${esc(mv.label)}</span>
        <span></span>
        <span class="num">${dec(mv.open)}</span>
        <span class="chg ${cls}">${dec(mv.close)} (${mv.changePct > 0 ? '+' : ''}${mv.changePct.toFixed(1)}%)</span>
      </div>`;
    }).join('')}
    <div style="font-size:11px;color:var(--text-3);margin-top:6px">
      Green = price shortened (money arriving). Red = drifted (money going the other way — a sharp warning on that side).</div>
  </div>`;
}

function h2hSection(rep) {
  const h = rep.h2h;
  if (!h) return '';
  return `<div class="sec"><div class="sec-title">Head to head <span class="pill">last ${h.n}</span></div>
    <div class="h2h-grid">
      <div class="h2h-cell"><div class="v">${h.homeWins}</div><div class="k">${esc(rep.match.home.short)} wins</div></div>
      <div class="h2h-cell"><div class="v">${h.draws}</div><div class="k">Draws</div></div>
      <div class="h2h-cell"><div class="v">${h.awayWins}</div><div class="k">${esc(rep.match.away.short)} wins</div></div>
    </div>
    <div class="h2h-grid">
      <div class="h2h-cell"><div class="v">${(h.bttsRate * 100).toFixed(0)}%</div><div class="k">BTTS</div></div>
      <div class="h2h-cell"><div class="v">${(h.over25Rate * 100).toFixed(0)}%</div><div class="k">Over 2.5</div></div>
      <div class="h2h-cell"><div class="v">${h.homeGoalsPerGame.toFixed(1)}-${h.awayGoalsPerGame.toFixed(1)}</div><div class="k">Avg score</div></div>
    </div>
    <div class="h2h-list">
      ${h.recent.map((r) => `<div class="h2h-item">
        <span class="sc">${esc(r.label)}</span>
        <span class="ha">${esc(r.homeAway)}</span>
        <span class="dt">${esc(String(r.date).slice(0, 10))}</span>
      </div>`).join('')}
    </div>
  </div>`;
}

function formSection(rep) {
  const f = rep.form;
  if (!f || (!f.home && !f.away)) return '';
  const line = (team, fd) => {
    if (!fd) return '';
    return `<div class="formline">
      <span class="nm">${esc(team.name)}</span>
      ${formChips(fd.seq)}
      <span class="pp">${fd.w}W ${fd.d}D ${fd.l}L · ${fd.ppg.toFixed(1)} ppg · ${fd.gfPerGame.toFixed(1)}-${fd.gaPerGame.toFixed(1)}</span>
    </div>`;
  };
  return `<div class="sec"><div class="sec-title">Recent form <span class="pill">last 5</span></div>
    ${line(rep.match.home, f.home)}${line(rep.match.away, f.away)}</div>`;
}

function provenanceSection(rep) {
  const p = rep.dataProvenance;
  const s = rep.baseline.source || '';
  const rs = p.results && p.results.home;
  const vs = p.historyVerifiedShare;
  return `<div class="sec"><div class="sec-title">Data provenance</div>
    <div class="prov">
      ${rs ? `<span class="${rs.verifiedShare >= 0.7 ? 'ok' : 'warn'}">${rs.n} league results · ${pct(rs.verifiedShare, 0)} verified by 2+ sources (${esc((rs.sources || []).join(', '))})</span>` : '<span class="warn">no verified results history</span>'}
      ${vs != null ? `<span class="${vs >= 0.7 ? 'ok' : 'warn'}">team evidence ${pct(vs, 0)} cross-verified</span>` : ''}
      <span class="${p.hasRatings ? 'ok' : 'warn'}">${p.hasRatings ? 'results ratings fitted' : 'no results ratings'}</span>
      <span class="${p.nBooks >= 2 ? 'ok' : p.nBooks ? '' : 'warn'}">${p.nBooks ? p.nBooks + ' bookmaker source(s)' : 'no bookmaker price'}</span>
      ${p.hasFpl ? '<span class="ok">FPL availability</span>' : ''}
      <span class="${p.hasXg ? 'ok' : 'warn'}">${p.hasXg ? 'xG/xGA available' : 'goals-based only (no xG in this league)'}</span>
      <span class="${p.hasH2h ? 'ok' : 'warn'}">${p.hasH2h ? 'H2H loaded' : 'no H2H history'}</span>
      <span class="${p.hasForm ? 'ok' : 'warn'}">${p.hasForm ? 'form loaded' : 'no recent form'}</span>
      <span class="${p.hasOdds ? 'ok' : 'warn'}">${p.hasOdds ? 'book odds loaded' : 'no book odds'}</span>
      <span>sample: ${p.statsSample.home} & ${p.statsSample.away} games</span>
      <span>baseline: ${esc(s)}</span>
    </div>
  </div>`;
}

function newsSection(rep) {
  const news = rep.news;
  const risk = rep.newsRisk;
  const items = risk ? [...(risk.home.items || []), ...(risk.away.items || []), ...(risk.neutral || [])] : [];

  if ((!news || !news.length) && !items.length) return '';

  const sevRank = { high: 3, medium: 2, info: 1 };
  const worst = (lvl) => (lvl === 'high' ? 'sev-high' : lvl === 'medium' ? 'sev-medium' : lvl === 'info' ? 'sev-info' : '');

  return `<div class="sec"><div class="sec-title">Team news &amp; context <span class="pill">verify before betting</span></div>
    ${risk ? `<div class="news-risk">
      <span class="nr-pill ${worst(risk.home.level)}">${esc(rep.match.home.name)}: ${esc(risk.home.level)}</span>
      <span class="nr-pill ${worst(risk.away.level)}">${esc(rep.match.away.name)}: ${esc(risk.away.level)}</span>
      <span class="nr-pill">${risk.scanned} headline${risk.scanned === 1 ? '' : 's'} scanned</span>
    </div>` : ''}
    ${risk && risk.note ? `<p style="font-size:11.5px;color:var(--text-3);margin:0 0 10px">${esc(risk.note)}</p>` : ''}
    ${items.length ? `<div style="margin-bottom:12px">
      ${items.slice(0, 6).sort((a, b) => (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0)).map((i) => `
        <div class="nr-item">
          <span class="nr-pill ${worst(i.severity)}" style="margin-right:6px">${esc(i.label)}</span>
          ${esc(i.headline)}
          ${i.evidence ? `<span class="ev"> · matched: "${esc(i.evidence)}"</span>` : ''}
          ${i.published ? ` <span class="ev">· ${esc(i.published)}</span>` : ''}
        </div>`).join('')}
    </div>` : ''}
    ${(news || []).map((a) => `<a class="news-item" href="${esc(a.links && a.links.web ? a.links.web.href : '#')}" target="_blank" rel="noopener">
      <div class="nt">${esc(a.headline || '')}</div>
      <div class="nd">${esc(a.description ? String(a.description).slice(0, 130) : '')}${a.published ? ' · ' + esc(String(a.published).slice(0, 10)) : ''}</div>
    </a>`).join('')}
  </div>`;
}

function bindDetail() {
  const btn = $('#dClose');
  if (btn) btn.addEventListener('click', closeDetail);
}

/* ---------------------------------------------------------- methodology helpers */

const STATUS_META = {
  LOCK:    { cls: 'lock',    label: 'Lock',       blurb: 'Every gate passed AND a real bookmaker price beats the multi-book fair price by 3% or more.' },
  PREDICT: { cls: 'predict', label: 'Predict',    blurb: 'Every gate passed. Only bet it at your bookmaker if the price is at or above the "take at" price.' },
  PAPER:   { cls: 'paper',   label: 'Paper only', blurb: 'Qualifies on the data, but this market has not earned real stakes. Track it first.' },
  WATCH:   { cls: 'watch',   label: 'Watch',      blurb: 'Close, but not enough evidence to call it.' },
  REMOVE:  { cls: 'remove',  label: 'No',         blurb: 'Fails a hard gate or too few checks.' },
};
const CONF_CLS = { 'Very high': 'lock', High: 'lock', Medium: 'predict', Low: 'watch', None: 'remove' };
const statusMeta = (s) => STATUS_META[s] || STATUS_META.REMOVE;
const signed = (v, dp = 1) => (v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(dp));

function statusBadge(p) {
  const m = statusMeta(p.status);
  return `<span class="badge st-${m.cls}" title="${esc(m.blurb)}">${esc(m.label)}</span>`;
}

function priceLine(p) {
  const pr = p.price || {};
  if (pr.valuePrice != null) {
    // v5: the number that matters to the user is the price they need at THEIR bookmaker.
    const best = pr.best ? ` · best <b>${dec(pr.best)}</b>${pr.bestBook ? ' ' + esc(pr.bestBook) : ''}` : '';
    const tag = pr.state === 'value' ? ' · <b class="pos">value</b>' : pr.state === 'too-short' ? ' · too short' : '';
    return `take at <b>≥ ${dec(pr.valuePrice)}</b>${best}${tag}`;
  }
  if (pr.state === 'edge') return `<b>${dec(pr.price)}</b> · edge ${dec(pr.ratio)}x`;
  if (pr.price) return `<b>${dec(pr.price)}</b> · ${esc(pr.state === 'too-short' ? 'too short' : 'no edge')}`;
  return `fair <b>${dec(p.fairOdds)}</b> · no quote`;
}

function predCard(item, withMethod) {
  const p = item.prediction;
  const m = item.match;
  const why = (p.support && p.support[0]) || '';
  return `<div class="pcard st-${statusMeta(p.status).cls}" data-id="${esc(m.id)}" data-league="${esc(m.league)}" data-year="${esc(m.seasonYear || '')}">
    <div class="pc-top">
      <span class="pc-league">${esc(m.leagueFlag || '')} ${esc(m.leagueName)} · ${esc(fmtTime(m.date))}</span>
      ${statusBadge(p)}
      <span class="pc-score" title="Methodology score, 0–100">${p.score}</span>
    </div>
    <div class="pc-match">${esc(m.home.name)} <span>vs</span> ${esc(m.away.name)}</div>
    <div class="pc-pick">${esc(p.pick.label)}</div>
    ${withMethod ? `<div class="pc-method">${esc(p.name)} · v${esc(p.version)}</div>` : ''}
    <div class="pc-stats">
      <span>Prob <b>${pct(p.prob, 0)}</b></span>
      <span>Fair <b>${dec(p.fairOdds)}</b></span>
      <span>${priceLine(p)}</span>
      <span>Checks <b>${p.checklist.passed}/${p.checklist.known}</b></span>
      ${p.modelProb != null ? `<span title="Independent model (ratings + xG + Elo, no bookmaker price)">Model <b>${pct(p.modelProb, 0)}</b></span>` : ''}
    </div>
    ${why ? `<div class="pc-why">${esc(why)}</div>` : ''}
    ${p.paperOnly ? `<div class="pc-paper">Paper only: log it, do not stake.</div>` : ''}
    ${p.flags && p.flags.length ? `<div class="pc-flags">${p.flags.slice(0, 2).map((f) => `<span>${esc(f)}</span>`).join('')}</div>` : ''}
  </div>`;
}

function bindCards(el) {
  $$('.pcard, .bcard', el).forEach((c) => {
    c.addEventListener('click', () => openMatch(c.dataset.id, c.dataset.league, c.dataset.year));
  });
}

function loadingBlock(msg, sub) {
  return `<div class="loading"><div class="spinner"></div><p>${esc(msg)}</p>
    ${sub ? `<p style="font-size:11px;max-width:340px;text-align:center;color:var(--text-3)">${esc(sub)}</p>` : ''}</div>`;
}

/* ---------------------------------------------------------- detail: methodology verdicts */

function gateList(gates) {
  return (gates || []).map((g) => `<div class="gt ${g.unknown ? 'unk' : g.pass ? 'ok' : 'no'}">
    <span class="gt-i">${g.unknown ? '?' : g.pass ? '✓' : '✕'}</span>
    <span class="gt-b"><b>${esc(g.label)}</b><br><span>${g.value != null ? esc(String(g.value)) : 'no data'}${g.need ? ' · needs ' + esc(String(g.need)) : ''}${g.unknown ? ' · unknown, so it fails' : ''}</span></span>
  </div>`).join('');
}

function checkList(items) {
  return (items || []).map((c) => `<div class="ck ${c.unknown ? 'unk' : c.score >= 0.5 ? 'ok' : 'no'}">
    <span class="ck-i">${c.unknown ? '?' : c.score >= 0.5 ? '✓' : '✕'}</span>
    <span class="ck-b"><b>${esc(c.label)}</b>${c.value != null ? ' <em>' + esc(String(c.value)) + '</em>' : ''}${c.note ? '<br><span>' + esc(c.note) + '</span>' : ''}</span>
  </div>`).join('');
}

function methodologySection(rep) {
  const mt = rep.methodology;
  if (!mt || mt.error) {
    return `<div class="sec"><div class="sec-title">Methodology verdicts</div>
      <div class="no-banker"><strong>Methodology layer unavailable</strong>${esc(mt && mt.error ? mt.error : 'No methodology data for this fixture.')}</div></div>`;
  }
  const h = mt.headline;
  const cov = mt.coverage || {};
  let html = `<div class="sec"><div class="sec-title">Methodology verdict <span class="pill">${mt.predictions.length} of ${mt.all.length} fit</span></div>`;

  if (!h) {
    html += `<div class="no-banker"><strong>No market qualifies</strong>
      This match does not fall under any of the ${mt.all.length} methodologies. Nothing has been forced — the general prediction above still gives the engine's view.</div>`;
  } else {
    const m = statusMeta(h.status);
    html += `<div class="verdict st-${m.cls}">
      <div class="v-top"><span class="v-tag">${esc(m.label)} · ${esc(h.tier)}</span><span class="v-score">${h.score}<small>/100</small></span></div>
      <div class="v-pick">${esc(h.pick.label)}</div>
      <div class="v-sub">${esc(h.name)} · model ${pct(h.prob)} (calibrated) · fair odds ${dec(h.fairOdds)}</div>
      <div class="v-stats">
        <div><div class="v">${pct(h.prob, 0)}</div><div class="k">Probability</div></div>
        <div><div class="v">${h.price && h.price.valuePrice ? '≥ ' + dec(h.price.valuePrice) : h.price && h.price.price ? dec(h.price.price) : '—'}</div><div class="k">${h.price && h.price.valuePrice ? 'Take at' : h.price && h.price.price ? 'Book price' : 'No quote'}</div></div>
        <div><div class="v">${h.checklist.passed}/${h.checklist.known}</div><div class="k">Checks passed</div></div>
      </div>
      ${h.line35 ? `<div class="v-line35">${esc(h.line35)}</div>` : ''}
      <div class="v-note">${esc(m.blurb)} ${h.price && h.price.note ? esc(h.price.note) : ''}</div>
      ${h.paperOnly ? `<div class="v-paper">Paper only: record the result, do not stake real money until the sample proves it.${h.stake ? ' If tracking, ' + esc(h.stake) + '.' : ''}</div>` : ''}
    </div>`;
    const others = mt.predictions.filter((p) => p.id !== h.id);
    if (others.length) {
      html += `<div class="v-others"><b>Also qualifies:</b> ${others.map((p) => `${esc(p.pick.label)} <i>(${esc(statusMeta(p.status).label)}, ${pct(p.prob, 0)})</i>`).join(' · ')}</div>`;
    }
  }
  if (mt.dropped && mt.dropped.length) {
    html += `<div class="v-dropped">${mt.dropped.map((d) => `Set aside <b>${esc(d.pick)}</b>: ${esc(d.reason)}`).join('<br>')}</div>`;
  }
  const lowCov = [];
  if (!cov.history) lowCov.push('no per-game history for this league, so evidence uses ESPN form only');
  if (!cov.elo) lowCov.push('no Elo rating found, so the independent-witness check is waived');
  if (lowCov.length) html += `<div class="src-note">Data note: ${esc(lowCov.join('; '))}.</div>`;
  html += `</div>`;

  // every methodology, with its gates and checklist on demand
  html += `<div class="sec"><div class="sec-title">All ${mt.all.length} methodologies <span class="pill">tap to inspect</span></div>`;
  for (const r of mt.all) {
    const m = statusMeta(r.status);
    html += `<details class="mrow st-${m.cls}">
      <summary>
        <span class="mr-name">${esc(r.name)}</span>
        <span class="mr-pick">${esc(r.pick.label)}</span>
        <span class="badge st-${m.cls}">${esc(m.label)}</span>
        <span class="mr-prob">${r.prob == null ? '—' : pct(r.prob, 0)}</span>
      </summary>
      <div class="mbody">
        ${r.line35 ? `<div class="v-line35">${esc(r.line35)}</div>` : ''}
        ${r.failedGates && r.failedGates.length ? `<div class="mfail">Failed hard gate: ${esc(r.failedGates.join(', '))}</div>` : ''}
        <div class="mh">Hard gates</div>${gateList(r.gates)}
        <div class="mh">Checklist <span>${r.checklist.passed}/${r.checklist.known} passed · needs ${Math.round(r.checklist.need * 100)}%${r.checklist.thin ? ' · too few known items' : ''}</span></div>${checkList(r.checklist.items)}
        ${r.failure && r.failure.length ? `<div class="mh">Why it could lose</div>${r.failure.map((f) => `<div class="mnote">${esc(f)}</div>`).join('')}` : ''}
        ${r.flags && r.flags.length ? `<div class="mh">Flags</div>${r.flags.map((f) => `<div class="mnote">${esc(f)}</div>`).join('')}` : ''}
      </div>
    </details>`;
  }
  html += `</div>`;
  return html;
}

/* ---------------------------------------------------------- predictions view */

async function loadPredictions(force) {
  if (state.preds && !force && state.preds.date === state.date) return state.preds;
  setStatus('analysing the day…', 'busy');
  state.preds = await api(`/api/predictions?date=${encodeURIComponent(state.date)}&limit=60`);
  setStatus(`${(state.preds.general || []).length} fixtures predicted · ${state.preds.predicted} methodology picks`, 'ok');
  return state.preds;
}

function summaryStrip(d) {
  const sc = d.statusCounts || {};
  const chip = (k, n, lab) => `<div class="ss-cell st-${k}"><div class="v">${n}</div><div class="k">${lab}</div></div>`;
  return `<div class="sumstrip">
    ${chip('lock', sc.LOCK || 0, 'Lock')}${chip('predict', sc.PREDICT || 0, 'Predict')}${chip('paper', sc.PAPER || 0, 'Paper only')}
    <div class="ss-cell"><div class="v">${d.analysable}</div><div class="k">Fixtures analysed</div></div>
    <div class="ss-cell"><div class="v">${d.skipped}</div><div class="k">No market fits</div></div>
    <div class="ss-cell small"><div class="k">Per-game history ${d.coverage.withHistory}/${d.analysable}<br>Elo ${d.coverage.withElo}/${d.analysable}</div></div>
  </div>`;
}

function renderPredictions() {
  const el = $('#board');
  const d = state.preds;
  if (!d) { el.innerHTML = loadingBlock('Running every methodology on every fixture…', 'Builds history and Elo evidence per match, then screens eleven markets. First run takes a moment.'); return; }

  const f = state.filter;
  let html = summaryStrip(d);

  if (!d.predicted) {
    el.innerHTML = html + `<div class="empty"><h3>No fixture qualifies</h3>
      <p>Nothing on ${esc(fmtDateLong(state.date))} cleared the gates of any methodology. That is a valid result, since predictions are never forced.</p></div>`;
    return;
  }

  html += `<div class="filters">
    <button class="fchip ${f.method === 'all' ? 'is-active' : ''}" data-m="all">All markets <b>${d.predicted}</b></button>
    ${d.methods.filter((m) => m.count).map((m) => `<button class="fchip ${f.method === m.id ? 'is-active' : ''}" data-m="${esc(m.id)}">${esc(m.name)} <b>${m.count}</b></button>`).join('')}
  </div>
  <div class="filters sub">
    ${['all', 'LOCK', 'PREDICT', 'PAPER'].map((s) => `<button class="fchip ${f.status === s ? 'is-active' : ''}" data-s="${s}">${s === 'all' ? 'Any status' : statusMeta(s).label}</button>`).join('')}
  </div>`;

  const keep = (it) => f.status === 'all' || it.prediction.status === f.status;
  let shown = 0;
  if (f.method === 'all') {
    const list = d.headline.filter(keep);
    shown = list.length;
    html += `<div class="sec-title">Strongest prediction per fixture <span class="pill">${list.length}</span></div>
      <div class="pgrid">${list.map((it) => predCard(it, true)).join('')}</div>`;
  } else {
    const list = (d.byMethod[f.method] || []).filter(keep);
    shown = list.length;
    const meta = d.methods.find((m) => m.id === f.method);
    html += `<div class="sec-title">${esc(meta ? meta.name : f.method)} <span class="pill">${list.length}</span></div>
      <div class="pgrid">${list.map((it) => predCard(it, false)).join('')}</div>`;
  }
  if (!shown) html += `<div class="empty"><h3>Nothing matches this filter</h3><p>Try “Any status” or another market.</p></div>`;

  el.innerHTML = html;
  $$('.fchip', el).forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.m) state.filter.method = b.dataset.m;
    if (b.dataset.s) state.filter.status = b.dataset.s;
    renderPredictions();
  }));
  bindCards(el);
}

/* ---------------------------------------------------------- top pick view */

function renderTop() {
  const el = $('#board');
  const d = state.preds;
  if (!d) { el.innerHTML = loadingBlock('Selecting the top pick…'); return; }
  const ranked = d.headline;
  if (!ranked.length) {
    el.innerHTML = `<div class="empty"><h3>No top pick</h3>
      <p>No fixture on ${esc(fmtDateLong(state.date))} qualifies under any methodology.</p></div>`;
    return;
  }
  const best = ranked[0];
  const p = best.prediction;
  const m = best.match;
  const sm = statusMeta(p.status);
  const downside = [...(p.failure || []), ...(p.flags || [])];
  el.innerHTML = `<div class="top-hero st-${sm.cls}">
      <div class="th-kicker">★ Top pick · ${esc(sm.label)} · ${esc(p.tier)}</div>
      <div class="th-match">${esc(m.home.name)} vs ${esc(m.away.name)}</div>
      <div class="th-league">${esc(m.leagueFlag || '')} ${esc(m.leagueName)} · ${esc(fmtTime(m.date))} · ${esc(fmtDateLong(m.date.slice(0, 10)))}</div>
      <div class="th-pick"><span>${esc(p.pick.label)}</span><em>${esc(p.name)}</em></div>
      <div class="th-grid">
        <div><div class="v">${p.score}</div><div class="k">Score</div></div>
        <div><div class="v">${pct(p.prob)}</div><div class="k">Probability</div></div>
        <div><div class="v">${dec(p.fairOdds)}</div><div class="k">Fair odds</div></div>
        <div><div class="v">${p.price && p.price.valuePrice ? '≥ ' + dec(p.price.valuePrice) : p.price && p.price.price ? dec(p.price.price) : '—'}</div><div class="k">${p.price && p.price.valuePrice ? 'Take at' : p.price && p.price.price ? 'Book price' : 'No quote'}</div></div>
        <div><div class="v">${p.checklist.passed}/${p.checklist.known}</div><div class="k">Checks</div></div>
      </div>
      ${p.line35 ? `<div class="v-line35">${esc(p.line35)}</div>` : ''}
      ${p.support && p.support.length ? `<div class="th-h">Why it qualifies</div><ul class="th-list ok">${p.support.slice(0, 6).map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
      ${downside.length ? `<div class="th-h">How it could lose</div><ul class="th-list no">${downside.slice(0, 6).map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
      <div class="th-foot">${esc(sm.blurb)}${p.price && p.price.note ? ' ' + esc(p.price.note) : ''}</div>
      <button class="th-open pcard" data-id="${esc(m.id)}" data-league="${esc(m.league)}" data-year="${esc(m.seasonYear || '')}">Open full methodology breakdown →</button>
    </div>
    <div class="sec-title" style="margin-top:22px">Next strongest <span class="pill">${Math.min(6, ranked.length - 1)}</span></div>
    <div class="pgrid">${ranked.slice(1, 7).map((it) => predCard(it, true)).join('')}</div>`;
  bindCards(el);
}

/* ---------------------------------------------------------- methodology view */

async function renderMethod() {
  const el = $('#board');
  el.innerHTML = loadingBlock('Loading methodologies…');
  try {
    if (!state.method) state.method = await api('/api/methodology');
  } catch (err) {
    el.innerHTML = `<div class="err-box"><strong>Could not load methodologies</strong><br>${esc(err.message)}</div>`;
    return;
  }
  const d = state.method;
  const c = d.config || {};
  const bt = d.backtest || {};
  const v6 = await researchBlock();
  const cell = (x) => (x ? `${pct(x.hitRate, 1)} <small>said ${pct(x.statedProb, 1)} · n ${x.n.toLocaleString()}</small>` : '<small>—</small>');
  const roi = (x) => (x && x.roiBestPrice != null ? `<span class="${x.roiBestPrice >= 0 ? 'pos' : 'neg'}">${(x.roiBestPrice * 100).toFixed(1)}%</span>` : '—');
  const roi365 = (x) => (x && x.roiBet365 != null ? `<span class="${x.roiBet365 >= 0 ? 'pos' : 'neg'}">${(x.roiBet365 * 100).toFixed(1)}%</span>` : '—');
  el.innerHTML = v6 + `<div class="m-intro">
      <h2>How predictions are made — methodologies v${esc(d.version)}</h2>
      <p>Every fixture gets a <b>general prediction</b> (result, goals, both-teams-to-score and a predicted final score) from one
      calibrated, market-anchored model. Then <b>${d.methods.length} market methodologies</b> decide which markets the match genuinely falls under:
      all hard gates must pass (unknown evidence counts as a fail), then at least <b>${Math.round((c.qualify || 0.85) * 100)}%</b> of the checklist.
      Contradicting picks are resolved; the weaker is set aside.</p>
      <p><b>What changed in v5, and why.</b> The probabilities now come from a blend of the multi-book bookmaker consensus (90%), a
      results-based Dixon-Coles rating fitted on cross-verified results, ESPN xG and ClubElo — then calibrated on real results and tested on seasons the calibration never saw.
      A <b>Lock</b> now needs a real price that beats the multi-book fair price; a model that merely disagrees with the bookmakers
      lost money in testing, so it no longer counts as an edge. Every prediction shows the price you need at your own bookmaker.</p>
      <div class="ladder">
        ${['LOCK', 'PREDICT', 'PAPER', 'WATCH', 'REMOVE'].map((st) => `<div class="lad st-${statusMeta(st).cls}"><b>${statusMeta(st).label}</b><span>${esc(statusMeta(st).blurb)}</span></div>`).join('')}
      </div>
    </div>
    ${bt.headline ? `<div class="sec-title">Tested on real results <span class="pill">${esc(bt.heldOut || '')}</span></div>
    <div class="bt-hero">
      <div><div class="v">${pct(bt.headline.v5.hitRate, 1)}</div><div class="k">Top pick per fixture hit rate (v5)<br>said ${pct(bt.headline.v5.statedProb, 1)} · ${bt.headline.v5.n.toLocaleString()} picks</div></div>
      <div><div class="v muted">${pct(bt.headline.v4.hitRate, 1)}</div><div class="k">Same test, v4 code<br>said ${pct(bt.headline.v4.statedProb, 1)} · ${bt.headline.v4.n.toLocaleString()} picks</div></div>
      <div><div class="v">${pct(bt.general.bestBet.hitRate, 1)}</div><div class="k">General best bet, every fixture<br>said ${pct(bt.general.bestBet.statedProb, 1)}</div></div>
      <div><div class="v">${pct(bt.general.predictedScore.exact, 1)}</div><div class="k">Predicted score exactly right<br>(single likeliest score ${pct(bt.general.mostLikelyScore.exact, 1)})</div></div>
    </div>
    <div class="bt-note">${esc(bt.dataset || '')}. Held-out seasons were never used to fit a v5 parameter. "Said" is the average stated probability: when hit ≈ said, the percentages on this site can be taken at face value.</div>` : ''}
    <div class="sec-title">The methodologies <span class="pill">${d.methods.length}</span></div>
    <div class="bt-table">
      <div class="bt-row head"><span>Methodology</span><span>Floor</span><span>v5 hit rate (held-out)</span><span>v4 hit rate</span><span>ROI Bet365</span><span>ROI best price</span></div>
      ${d.methods.map((m) => `<div class="bt-row">
        <span><b>${esc(m.name)}</b> <small>v${esc(m.version)}${m.paperOnly ? ' · paper only' : ''}${m.headline === false ? ' · not a headline' : ''}${m.stake ? ' · ' + esc(m.stake) : ''}</small></span>
        <span>${m.floor != null ? pct(m.floor, 0) : '—'}</span>
        <span>${cell(m.backtest && m.backtest.v5)}</span>
        <span>${cell(m.backtest && m.backtest.v4)}</span>
        <span>${roi365(m.backtest && m.backtest.v5)}</span>
        <span>${roi(m.backtest && m.backtest.v5)}</span>
      </div>`).join('')}
    </div>
    <div class="m-honest">
      <h3>What the evidence says — plainly</h3>
      <ul>
        <li><b>The percentages are honest.</b> Across every methodology the held-out hit rate sits close to the stated probability.</li>
        <li><b>Accuracy is not profit.</b> At Bet365 prices no methodology made a reliable profit; with the best price across ~17 books several are around break-even or slightly positive. Always shop for the price, and never bet below the "take at" price shown.</li>
        <li><b>The bookmakers are the sharpest forecast.</b> When our independent model disagrees with them, the bookmakers were usually right — so disagreement is shown as a warning, not as value.</li>
        <li><b>GG/NG 2+ stays paper-only</b> until the live track record shows 40 settled legs at or above their stated probability with a profit.</li>
        <li><b>Correct scores are long shots.</b> Even a qualifying final-score pick lands about one time in six. Quarter stake, single only.</li>
        <li><b>No outcome is guaranteed.</b> Analytical output only.</li>
      </ul>
    </div>`;
}

/* ---------------------------------------------------------- every-match (general) view */

function renderGeneral() {
  const el = $('#board');
  const d = state.preds;
  if (!d) { el.innerHTML = loadingBlock('Predicting every fixture…', 'General prediction, predicted score and best bet for each match.'); return; }
  const list = (d.general || []).filter((x) => state.filter.conf === 'all' || x.general.confidence.level === state.filter.conf);
  const counts = { High: 0, Medium: 0, Low: 0 };
  for (const x of d.general || []) counts[x.general.confidence.level]++;
  let html = `<div class="filters">
    ${['all', 'High', 'Medium', 'Low'].map((c) => `<button class="fchip ${state.filter.conf === c ? 'is-active' : ''}" data-c="${c}">${c === 'all' ? 'All fixtures' : c + ' confidence'} <b>${c === 'all' ? (d.general || []).length : counts[c]}</b></button>`).join('')}
  </div>`;
  if (!list.length) {
    el.innerHTML = html + `<div class="empty"><h3>No fixtures</h3><p>Nothing analysable for this filter on ${esc(fmtDateLong(state.date))}.</p></div>`;
  } else {
    html += `<div class="ggrid">${list.map((x) => {
      const g = x.general;
      const m = x.match;
      const bb = g.bestBet;
      return `<div class="gcard" data-id="${esc(m.id)}" data-league="${esc(m.league)}" data-year="${esc(m.seasonYear || '')}">
        <div class="pc-top"><span class="pc-league">${esc(m.leagueFlag || '')} ${esc(m.leagueName)} · ${esc(fmtTime(m.date))}</span>
          <span class="badge st-${CONF_CLS[g.confidence.level] || 'watch'}">${esc(g.confidence.level)}</span></div>
        <div class="gc-match"><span>${esc(m.home.name)}</span><b>${g.score.predicted.home} – ${g.score.predicted.away}</b><span>${esc(m.away.name)}</span></div>
        <div class="gc-calls">
          <span>${esc(g.result.label)} <b>${pct(g.result.prob, 0)}</b></span>
          <span>${esc(g.goals.call)} 2.5 <b>${pct(g.goals.prob, 0)}</b></span>
          <span>BTTS ${esc(g.btts.call)} <b>${pct(g.btts.prob, 0)}</b></span>
        </div>
        ${bb ? `<div class="gc-best"><span class="gc-k">${g.version === '6.0' ? 'Main pick' : g.source === 'methodology' ? esc(statusMeta(bb.status).label) + ' · ' + esc(bb.methodology) : 'Best bet'}</span>
          <b>${esc(bb.label)}</b> ${pct(bb.prob, 0)} · take at ≥ ${dec(bb.valuePrice)}</div>` : ''}
        ${g.version === '6.0' ? `<div class="gc-tags">${(g.alternatives || []).filter((a) => a.role === 'value').map((a) => `<span class="tag val" title="best ${dec(a.best)} vs fair ${dec(a.fairOdds)}">Value: ${esc(a.label)}</span>`).join('')}
          ${g.methodologyPick && g.methodologyPick.agrees ? `<span class="tag ok">✓ ${esc(g.methodologyPick.name)}</span>` : ''}
          ${(g.avoid || []).length ? `<span class="tag warn" title="${esc(g.avoid.map((a) => a.label).join(', '))}">Avoid ${g.avoid.length}</span>` : ''}</div>` : ''}
      </div>`;
    }).join('')}</div>`;
    el.innerHTML = html;
  }
  $$('.fchip', el).forEach((b) => b.addEventListener('click', () => { state.filter.conf = b.dataset.c; renderGeneral(); }));
  $$('.gcard', el).forEach((c) => c.addEventListener('click', () => openMatch(c.dataset.id, c.dataset.league, c.dataset.year)));
}

/* ---------------------------------------------------------- accumulator view (v6) */

function accaRecordLine(r, label) {
  if (!r || !r.n) return '';
  return `<span>${esc(label)}: won <b>${pct(r.hit, 1)}</b> (stated ${pct(r.stated, 1)}, ${r.n.toLocaleString()} days)${r.roiBet365 != null ? ` · Bet365 <span class="${r.roiBet365 >= 0 ? 'pos' : 'neg'}">${signed(r.roiBet365 * 100, 1)}%</span>` : ''}${r.roiBest != null ? ` · best price <span class="${r.roiBest >= 0 ? 'pos' : 'neg'}">${signed(r.roiBest * 100, 1)}%</span> <small>(${r.nPricedBest} fully priced)</small>` : ''}</span>`;
}

function renderAcca() {
  const el = $('#board');
  const d = state.preds;
  if (!d) { el.innerHTML = loadingBlock('Building the accumulator…', 'Every leg must pass a methodology AND the normal prediction.'); return; }
  const a = d.accumulator || { legs: [], options: [], rules: [] };
  const rec = a.record || null;
  const ho = rec && rec.heldOut;
  const legRow = (l) => `<div class="al" data-id="${esc(l.fixtureId)}" data-league="${esc(l.league)}">
      <div class="al-m"><b>${esc(l.home)} v ${esc(l.away)}</b> <small>${esc(l.leagueName || l.league)} · ${esc(fmtTime(l.kickoff))}</small></div>
      <div class="al-p"><b>${esc(l.label)}</b> <em>${pct(l.prob, 0)}</em>${l.best ? ` <small>best ${dec(l.best)}</small>` : ''}</div>
      <div class="al-w"><span class="badge st-${statusMeta(l.methodology.status).cls}">${esc(statusMeta(l.methodology.status).label)}</span> ${esc(l.methodology.name)}
        <span class="tag ok">${l.agreement === 'main' ? 'Normal: main pick' : l.agreement === 'safer' ? 'Normal: safer form of its pick' : 'Normal: agrees (' + esc([l.normal.calls.result, l.normal.calls.goals].filter(Boolean).join(', ')) + ')'}</span></div>
    </div>`;
  el.innerHTML = `<div class="m-intro"><h2>Accumulator — double-confirmed</h2>
      <p>A match only goes in when <b>two independent layers agree</b>: the selection <b>qualifies under a methodology</b> (Lock or Predict), and the
      <b>normal prediction says the same thing</b> — it is the normal main pick, a safer form of it, or it matches the normal prediction's result / goals / BTTS call
      with at least ${pct(0.6, 0)} probability. Anything the normal prediction flags as overrated by the bookmakers is left out.</p>
      <ul class="rules">${(a.rules || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
      ${ho ? `<div class="acca-rec"><div class="tr-h">Tested on held-out seasons (${esc(String((ho.window || [])[0] || '').slice(0, 4))}–26), never used to build the rule</div>
        ${['2', '3', '4', '5'].map((k) => accaRecordLine(ho.sizes && ho.sizes[k], { 2: 'Doubles', 3: 'Trebles', 4: 'Four-folds', 5: 'Five-folds' }[k])).join('<br>')}
        <div class="muted-t">Legs: won ${pct(ho.legs.hit, 1)} vs stated ${pct(ho.legs.stated, 1)}. Same rule on the 2019-23 seasons: ${rec.tuning && rec.tuning.sizes && rec.tuning.sizes['3'] ? `trebles won ${pct(rec.tuning.sizes['3'].hit, 1)} (stated ${pct(rec.tuning.sizes['3'].stated, 1)})` : '—'}. The combined probability is reliable; profit is not — margins multiply, so only take an accumulator at or above its take-at price.</div></div>` : ''}
    </div>
    ${a.error ? `<div class="err-box">${esc(a.error)}</div>` : ''}
    ${a.options && a.options.length ? `<div class="acca-opts">${a.options.map((op) => `<div class="acca ${op.recommended ? 'rec' : ''}">
        <div class="acca-h"><b>${esc(op.name)}</b>${op.recommended ? ' <span class="badge st-lock">Recommended</span>' : ''}<span class="acca-p">${pct(op.prob, 1)}</span></div>
        <div class="acca-o">Fair odds <b>${dec(op.fairOdds)}</b> · take at <b>${dec(op.takeAt)}</b>${op.bestOdds ? ` · best available <b>${dec(op.bestOdds)}</b>${op.value != null ? ` (<span class="${op.value >= 0 ? 'pos' : 'neg'}">${signed(op.value * 100, 1)}%</span>)` : ''}` : ' · not every leg has a price'}</div>
        ${op.measured ? `<div class="acca-m">In testing: won ${pct(op.measured.hit, 1)} (stated ${pct(op.measured.stated, 1)}, ${op.measured.n} days)</div>` : ''}
        <div class="acca-legs">${op.legs.map((l) => `<div><span>${esc(l.home)} v ${esc(l.away)}</span><b>${esc(l.label)}</b><em>${pct(l.prob, 0)}</em></div>`).join('')}</div>
      </div>`).join('')}</div>` : `<div class="empty"><h3>No accumulator today</h3><p>${(a.legs || []).length ? 'Only one double-confirmed leg — an accumulator needs at least two.' : 'No selection on this date passes both a methodology and the normal prediction.'} That is the filter working: legs are only added when both layers agree.</p></div>`}
    ${(a.legs || []).length ? `<div class="sec-title" style="margin-top:16px">All double-confirmed legs <span class="pill">${a.legs.length}</span></div><div class="acca-all">${a.legs.map(legRow).join('')}</div>` : ''}`;
  $$('.al', el).forEach((c) => c.addEventListener('click', () => openMatch(c.dataset.id, c.dataset.league, '')));
}

async function researchBlock() {
  try {
    if (!state.research) state.research = await api('/api/intel-research');
  } catch {
    return '';
  }
  const r = state.research;
  const rec = r.record && r.record.heldOut;
  const imp = r.importance || {};
  const fam = (o) => Object.entries(o || {}).filter(([k]) => k !== 'calendar').map(([k, v]) => `<div class="en-row"><span>${esc(FAMILY_NAMES[k] || k)}</span><span class="en-bar"><span style="width:${Math.round(v * 250)}%"></span></span><span class="num">${pct(v, 0)}</span></div>`).join('');
  const counts = {};
  for (const x of Object.values((r.patterns && r.patterns.rules) || {})) counts[x.status] = (counts[x.status] || 0) + 1;
  return `<div class="m-intro"><h2>v6 — the normal prediction, rebuilt</h2>
      <p>Every fixture is measured on <b>170 factors</b> in eleven families (form and trend, goal trends, shots and luck, results against the bookmakers'
      expectation, Elo momentum, head-to-head, table and motivation, schedule, discipline, league, market). The crawler collects them from free sources
      (football-data.co.uk match statistics and odds, ClubElo history, ESPN, Open-Meteo) and the model was trained on <b>134,579</b> matches (2005-19),
      tuned on 2019-23 and tested on <b>29,191</b> held-out matches (2023-26).</p>
      ${rec ? `<div class="bt-hero">
        <div><div class="v">${pct(rec.main.hit, 1)}</div><div class="k">Main pick hit rate (held-out)<br>stated ${pct(rec.main.stated, 1)} · ${rec.main.n.toLocaleString()} matches</div></div>
        <div><div class="v">${signed(rec.value.roiBest * 100, 1)}%</div><div class="k">Value picks at the best price<br>${rec.value.n.toLocaleString()} bets · Bet365 ${signed(rec.value.roiBet365 * 100, 1)}%</div></div>
        <div><div class="v">${pct(rec.avoid.won, 1)}</div><div class="k">"Avoid" selections won<br>vs ${pct(rec.avoid.marketSaid, 1)} the price implied</div></div>
        <div><div class="v">${counts.trap || 0} + ${counts.edge || 0}</div><div class="k">confirmed traps + edges<br>of ${Object.values(counts).reduce((x, y) => x + y, 0)} popular patterns tested</div></div>
      </div>` : ''}
      <div class="two">
        <div><div class="tr-h">What moves the forecast away from the price</div>${fam(imp.withMarket)}</div>
        <div><div class="tr-h">What predicts the result with no price</div>${fam(imp.factorsOnly)}</div>
      </div>
      <p class="muted-t">The bookmakers' price already contains most of what these factors know: with a price, the factors improve the forecast by a small,
      measurable amount (log-loss −0.03% to −0.32% depending on the market). Without a price they recover about 84% of what the price knows. The real gains are
      in what the site now <b>shows</b> you, the traps it keeps you out of, and the value it finds when a bookmaker's price beats the fair price.</p>
    </div>`;
}
const FAMILY_NAMES = { market: 'Market & price', form: 'Form & trend', goals: 'Goal trends', performance: 'Performance & luck', vsMarket: 'Beating the bookmakers', strength: 'Strength & momentum', h2h: 'Head-to-head', table: 'Table & motivation', schedule: 'Schedule & fatigue', discipline: 'Discipline & set pieces', league: 'League environment', calendar: 'Calendar' };

/* ---------------------------------------------------------- track record view */

async function renderRecord() {
  const el = $('#board');
  el.innerHTML = loadingBlock('Loading the track record…', 'Settling finished matches from ESPN results.');
  let d;
  try {
    d = await api('/api/ledger');
  } catch (err) {
    el.innerHTML = `<div class="err-box"><strong>Could not load the track record</strong><br>${esc(err.message)}</div>`;
    return;
  }
  const disc = d.discipline;
  const pm = Object.entries(d.perMethod || {}).sort((a, b) => b[1].n - a[1].n);
  const flag = (on, title, body) => `<div class="dflag ${on ? 'on' : ''}"><b>${esc(title)}</b><span>${body}</span></div>`;
  el.innerHTML = `<div class="m-intro"><h2>Track record</h2>
      <p>Every prediction is written down <b>before kick-off</b> and settled from the final score afterwards. Nothing is edited after a match starts.
      ${d.entries ? `${d.entries.toLocaleString()} entries so far.` : 'No entries yet — the record starts with the first day you load predictions.'}
      <a class="dl" href="/api/ledger?format=csv">Download CSV</a></p>
      <p class="muted-t">On free hosting the record survives restarts but not redeploys. Download the CSV regularly to keep it.</p></div>
    <div class="dflags">
      ${flag(disc.rule17.active, 'Rule 17 · stop-loss', disc.rule17.active ? `COOLDOWN until ${esc(disc.rule17.cooldownUntil)} — paper-trade only.` : `${disc.rule17.consecutiveLossDays} losing day(s) in a row on the daily top pick. 3 in a row triggers a 5-day cooldown.`)}
      ${flag(disc.rule27.active, 'Rule 27 · streak anchoring', disc.rule27.active ? `${disc.rule27.consecutiveWinDays} winning days in a row — drop the next pick's confidence one level. Same stake.` : `${disc.rule27.consecutiveWinDays} winning day(s) in a row.`)}
      ${flag(disc.rule34.readyForRealMoney, 'Rule 34 · GG/NG 2+ record', `${disc.rule34.legs}/40 legs settled${disc.rule34.hitRate != null ? ` · hit ${pct(disc.rule34.hitRate, 0)} v stated ${pct(disc.rule34.avgStatedProb, 0)}` : ''}. ${disc.rule34.readyForRealMoney ? 'Eligible for real stakes (1 unit, max 2 legs).' : 'Paper only.'}`)}
    </div>
    <div class="sec-title">By methodology</div>
    ${pm.length ? `<div class="bt-table">
      <div class="bt-row head"><span>Methodology</span><span>Settled</span><span>Hit rate</span><span>Stated</span><span>ROI at best price</span><span>Pending</span></div>
      ${pm.map(([k, v]) => `<div class="bt-row"><span><b>${esc(v.name)}</b></span><span>${v.n}</span><span>${v.hitRate == null ? '—' : pct(v.hitRate, 1)}</span><span>${v.avgProb == null ? '—' : pct(v.avgProb, 1)}</span>
        <span>${v.roiAtBestPrice == null ? '—' : `<span class="${v.roiAtBestPrice >= 0 ? 'pos' : 'neg'}">${(v.roiAtBestPrice * 100).toFixed(1)}%</span> <small>n ${v.priced}</small>`}</span><span>${v.pending}</span></div>`).join('')}
    </div>` : '<div class="empty"><p>No settled predictions yet.</p></div>'}
    <div class="sec-title" style="margin-top:18px">Latest entries</div>
    <div class="bt-table">
      <div class="bt-row head"><span>Match</span><span>Pick</span><span>Prob</span><span>Result</span><span></span><span></span></div>
      ${(d.recent || []).map((e) => `<div class="bt-row"><span>${esc(e.home)} v ${esc(e.away)} <small>${esc(String(e.date).slice(0, 10))} · ${esc(e.leagueName || '')}</small></span>
        <span>${esc(e.label || e.key)} <small>${esc(e.methodName || '')}</small></span><span>${pct(e.prob, 0)}</span>
        <span>${e.result ? esc(e.result) : '<small>pending</small>'}</span><span>${e.hit === 1 ? '<b class="pos">✓</b>' : e.hit === 0 ? '<b class="neg">✕</b>' : e.result ? 'void' : ''}</span><span></span></div>`).join('')}
    </div>`;
}

/* ---------------------------------------------------------- orchestration */

async function loadBoard() {
  setStatus('loading fixtures…', 'busy');
  try {
    state.board = await api(`/api/matches?date=${encodeURIComponent(state.date)}`);
    setStatus(`${state.board.totalMatches} fixtures · ${state.board.totalLeagues} competitions`, 'ok');
    renderBoard();
    // Prediction badges need the day's deep analysis. Load it in the background
    // so the fixture list stays fast, then re-render once the badges are known.
    if (!state.preds) {
      loadPredictions()
        .then(() => { if (state.view === 'matches') renderBoard(); })
        .catch(() => { /* badges are a progressive enhancement */ });
    }
  } catch (err) {
    $('#board').innerHTML = `<div class="err-box"><strong>Could not load fixtures</strong><br>${esc(err.message)}</div>`;
    setStatus('error', 'err');
  }
}

function renderPredView() {
  if (state.view === 'predictions') renderPredictions();
  else if (state.view === 'top') renderTop();
  else if (state.view === 'general') renderGeneral();
  else if (state.view === 'acca') renderAcca();
}

async function refresh() {
  if (state.view === 'matches') return loadBoard();
  if (state.view === 'strongest') return window.renderStrongest && window.renderStrongest(true);
  if (state.view === 'method') return renderMethod();
  if (state.view === 'record') return renderRecord();
  try {
    await loadPredictions(true);
    renderPredView();
  } catch (err) {
    $('#board').innerHTML = `<div class="err-box"><strong>Analysis failed</strong><br>${esc(err.message)}</div>`;
    setStatus('error', 'err');
  }
}

function setView(view) {
  state.view = view;
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === view));
  $('#bankersOnly').parentElement.style.display = view === 'matches' ? '' : 'none';
  $('.datebar').classList.toggle('is-muted', view === 'method' || view === 'record');

  if (view === 'matches') { loadBoard(); return; }
  if (view === 'method') { renderMethod(); return; }
  if (view === 'record') { renderRecord(); return; }
  if (view === 'strongest') { if (window.renderStrongest) window.renderStrongest(); return; }

  renderPredView(); // shows the loading block until data arrives
  loadPredictions(false)
    .then(() => { if (state.view === view) renderPredView(); })
    .catch((err) => {
      $('#board').innerHTML = `<div class="err-box"><strong>Analysis failed</strong><br>${esc(err.message)}</div>`;
      setStatus('error', 'err');
    });
}

function setDate(iso) {
  state.date = iso;
  state.preds = null;
  state.selectedId = null;
  closeDetail();
  $('#dateInput').value = iso;
  $('#dateLabel').textContent = fmtDateLong(iso);
  $$('.quick').forEach((q) => q.classList.toggle('is-active', shiftDate(todayISO(), Number(q.dataset.offset)) === iso));
  if (state.view === 'matches') loadBoard();
  else setView(state.view);
}

/* ---------------------------------------------------------- init */

function init() {
  state.date = todayISO();
  $('#dateInput').value = state.date;
  $('#dateLabel').textContent = fmtDateLong(state.date);

  $('#prevDay').addEventListener('click', () => setDate(shiftDate(state.date, -1)));
  $('#nextDay').addEventListener('click', () => setDate(shiftDate(state.date, 1)));
  $('#dateInput').addEventListener('change', (e) => e.target.value && setDate(e.target.value));
  $$('.quick').forEach((q) => q.addEventListener('click', () => setDate(shiftDate(todayISO(), Number(q.dataset.offset)))));
  $$('.tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));
  $('#scrim').addEventListener('click', closeDetail);

  $('#bankersOnly').addEventListener('change', (e) => {
    state.bankersOnly = e.target.checked;
    if (state.bankersOnly && !state.preds) {
      loadPredictions().then(() => renderBoard()).catch(() => renderBoard());
    } else {
      renderBoard();
    }
  });

  $('#liveRefresh').addEventListener('change', (e) => {
    state.autoRefresh = e.target.checked;
    scheduleRefresh();
  });

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDetail(); });

  loadBoard();
  scheduleRefresh();
}

let refreshTimer = null;
function scheduleRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  if (!state.autoRefresh) return;
  refreshTimer = setInterval(() => {
    if (document.hidden || state.loadingDetail) return;
    if (state.view === 'matches') loadBoard();
  }, 60000);
}

document.addEventListener('DOMContentLoaded', init);
