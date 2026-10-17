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
  filter: { method: 'all', status: 'all' },
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
          ${badge}
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

  el.innerHTML = head + methodologySection(rep) + modelSection(rep) + marketSection(rep)
    + patternSection(rep) + trapSection(rep) + lineMovementSection(rep)
    + h2hSection(rep) + formSection(rep) + provenanceSection(rep) + newsSection(rep);

  bindDetail();
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
  return `<div class="sec"><div class="sec-title">Data provenance</div>
    <div class="prov">
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
  LOCK:    { cls: 'lock',    label: 'Lock',       blurb: 'Every gate passed and the price shows a real edge.' },
  PREDICT: { cls: 'predict', label: 'Predict',    blurb: 'Every gate passed. No verified price edge, so check your own bookmaker.' },
  PAPER:   { cls: 'paper',   label: 'Paper only', blurb: 'Qualifies on the data, but this market has not earned real stakes. Track it first.' },
  WATCH:   { cls: 'watch',   label: 'Watch',      blurb: 'Close, but not enough evidence to call it.' },
  REMOVE:  { cls: 'remove',  label: 'No',         blurb: 'Fails a hard gate or too few checks.' },
};
const statusMeta = (s) => STATUS_META[s] || STATUS_META.REMOVE;
const signed = (v, dp = 1) => (v == null ? '—' : (v > 0 ? '+' : '') + v.toFixed(dp));

function statusBadge(p) {
  const m = statusMeta(p.status);
  return `<span class="badge st-${m.cls}" title="${esc(m.blurb)}">${esc(m.label)}</span>`;
}

function priceLine(p) {
  const pr = p.price || {};
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
      <span>${priceLine(p)}</span>
      <span>Checks <b>${p.checklist.passed}/${p.checklist.known}</b></span>
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
      This match does not fall under any of the eleven methodologies. Nothing has been forced.</div>`;
  } else {
    const m = statusMeta(h.status);
    html += `<div class="verdict st-${m.cls}">
      <div class="v-top"><span class="v-tag">${esc(m.label)} · ${esc(h.tier)}</span><span class="v-score">${h.score}<small>/100</small></span></div>
      <div class="v-pick">${esc(h.pick.label)}</div>
      <div class="v-sub">${esc(h.name)} · model ${pct(h.prob)} (calibrated) · fair odds ${dec(h.fairOdds)}</div>
      <div class="v-stats">
        <div><div class="v">${pct(h.prob, 0)}</div><div class="k">Probability</div></div>
        <div><div class="v">${h.price && h.price.price ? dec(h.price.price) : '—'}</div><div class="k">${h.price && h.price.price ? 'Book price' : 'No quote'}</div></div>
        <div><div class="v">${h.checklist.passed}/${h.checklist.known}</div><div class="k">Checks passed</div></div>
      </div>
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
  html += `<div class="sec"><div class="sec-title">All eleven methodologies <span class="pill">tap to inspect</span></div>`;
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
  setStatus(`${state.preds.predicted} predictions from ${state.preds.analysable} fixtures`, 'ok');
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
        <div><div class="v">${p.price && p.price.price ? dec(p.price.price) : '—'}</div><div class="k">${p.price && p.price.price ? 'Book price' : 'No quote'}</div></div>
        <div><div class="v">${p.checklist.passed}/${p.checklist.known}</div><div class="k">Checks</div></div>
      </div>
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
  const fam = {};
  for (const m of d.methods) (fam[m.family] = fam[m.family] || []).push(m);
  el.innerHTML = `<div class="m-intro">
      <h2>How predictions are made</h2>
      <p>Every fixture is run through <b>${d.methods.length} market methodologies</b>. A methodology only speaks when the match
      genuinely falls under it: all hard gates must pass (unknown evidence counts as a fail), then at least
      <b>${Math.round((c.qualify || 0.85) * 100)}%</b> of its checklist must pass. Where two qualifying picks contradict, the weaker is set aside.</p>
      <div class="ladder">
        ${['LOCK', 'PREDICT', 'PAPER', 'WATCH', 'REMOVE'].map((s) => `<div class="lad st-${statusMeta(s).cls}"><b>${statusMeta(s).label}</b><span>${esc(statusMeta(s).blurb)}</span></div>`).join('')}
      </div>
    </div>
    <div class="sec-title">The methodologies <span class="pill">${d.methods.length}</span></div>
    <div class="mgrid">${d.methods.map((m) => `<div class="mcard">
      <div class="mc-top"><b>${esc(m.name)}</b><span>v${esc(m.version)}</span></div>
      <div class="mc-fam">${esc(m.family)}</div>
      <div class="mc-stats">
        <span>Probability floor <b>${m.floor != null ? pct(m.floor, 0) : '—'}</b></span>
        <span>Sample <b>≥ ${m.minSample}</b></span>
        ${m.paperOnly ? '<span class="mc-paper">Paper only</span>' : ''}
        ${m.maxLegs ? `<span>Max legs <b>${m.maxLegs}</b></span>` : ''}
      </div></div>`).join('')}</div>
    <div class="m-honest">
      <h3>What the evidence says</h3>
      <ul>
        <li><b>Probabilities are calibrated.</b> Goal-market probabilities are recalibrated on 2023–24 results and checked on held-out 2025 matches. Stated 66.8% hit 66.5% in testing.</li>
        <li><b>Draw is paper only.</b> In the walk-forward backtest the draw model had no predictive value, so it never produces a stake-worthy pick.</li>
        <li><b>The gates add real value for BTTS</b> and little for Over/Under 2.5. They are kept because they stop obviously bad spots.</li>
        <li><b>GG/NG 2+ stays on paper</b> until 40 tracked legs prove it. It cannot be tested from results alone.</li>
        <li><b>Price edge is untested.</b> There is no free historical odds feed, so profit is not proven. Use fair odds as a guide and compare with your own bookmaker.</li>
        <li><b>No outcome is guaranteed.</b> Analytical output only.</li>
      </ul>
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
}

async function refresh() {
  if (state.view === 'matches') return loadBoard();
  if (state.view === 'method') return renderMethod();
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
  $('.datebar').classList.toggle('is-muted', view === 'method');

  if (view === 'matches') { loadBoard(); return; }
  if (view === 'method') { renderMethod(); return; }

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
