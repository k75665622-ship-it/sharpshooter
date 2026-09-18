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
  bankers: null,
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

  const bankerMap = new Map();
  if (state.bankers && state.bankers.bankers) {
    for (const b of state.bankers.bankers) bankerMap.set(String(b.match.id), b);
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
        const cls = bk.banker.tier === 'Platinum' ? 'plat' : bk.banker.tier === 'Gold' ? 'gold' : 'silver';
        badge = `<span class="badge ${cls}">★ ${esc(bk.banker.tier)} banker</span>`;
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
    el.innerHTML = `<div class="empty"><h3>No banker picks qualify</h3>
      <p>No fixture on ${esc(fmtDateLong(state.date))} cleared every gate. Try another date or untick “Bankers only”.</p></div>`;
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
    el.innerHTML = head + `<div class="no-banker"><strong>No prediction issued</strong>${esc(rep.reason || '')}</div>`
      + newsSection(rep);
    bindDetail();
    return;
  }

  el.innerHTML = head + bankerSection(rep) + modelSection(rep) + marketSection(rep)
    + patternSection(rep) + trapSection(rep) + lineMovementSection(rep)
    + h2hSection(rep) + formSection(rep) + provenanceSection(rep) + newsSection(rep);

  bindDetail();
}

function bankerSection(rep) {
  const b = rep.banker;
  if (!b) {
    const lean = rep.lean;
    return `<div class="sec"><div class="sec-title">Banker verdict</div>
      <div class="no-banker"><strong>No banker issued for this fixture</strong>
      No market cleared every gate — model confidence, trap screening, pattern alignment and price verification
      were not all satisfied at the same time. Nothing has been forced.</div>
      ${lean ? `<div class="lean-card">
        <div class="lc-top"><span class="lc-tag">Lean only — not a banker</span><span class="lc-score">${lean.score}/100</span></div>
        <div class="lc-pick">${esc(lean.label)}</div>
        <div class="lc-meta">${esc(lean.group)} · model ${pct(lean.prob)} · ${lean.verified ? 'price ' + dec(lean.price) : 'no quoted price'}
        ${lean.valuePct == null ? '' : ' · EV ' + (lean.valuePct > 0 ? '+' : '') + lean.valuePct.toFixed(1) + '%'}</div>
        <div class="lc-note">${esc(lean.note)}</div>
      </div>` : ''}
    </div>`;
  }
  const tierCls = b.tier === 'Platinum' ? 'platinum' : b.tier === 'Gold' ? 'gold' : 'silver';
  const evCls = b.valuePct == null ? '' : b.valuePct > 0 ? 'pos' : 'neg';
  return `<div class="sec">
    <div class="sec-title">Banker verdict <span class="pill">one market only</span></div>
    <div class="banker-card ${tierCls}">
      <div class="bc-top">
        <span class="bc-tier">${esc(b.tierLabel)}</span>
        <span class="bc-score">${b.score}<small>/100</small></span>
      </div>
      <div class="bc-pick">${esc(b.label)}</div>
      <div class="bc-market">${esc(b.group)} · model probability ${pct(b.prob)}</div>
      <div class="bc-stats">
        <div class="bc-stat"><div class="v">${dec(b.price)}</div><div class="k">${esc(priceLabel(b))}</div></div>
        <div class="bc-stat"><div class="v ${evCls}">${b.valuePct == null ? '—' : (b.valuePct > 0 ? '+' : '') + b.valuePct.toFixed(1) + '%'}</div><div class="k">Expected value</div></div>
        <div class="bc-stat"><div class="v">${b.edge == null ? '—' : (b.edge > 0 ? '+' : '') + (b.edge * 100).toFixed(1) + '%'}</div><div class="k">Edge vs market</div></div>
      </div>
      <div class="bc-note">${esc(b.tierBlurb)} ${b.traps.length ? 'Caveats: ' + esc(b.traps.map((t) => t.label).join('; ')) + '.' : 'No caveats flagged on this market.'}</div>
    </div>
    ${b.alternatives && b.alternatives.length ? `<div style="margin-top:10px;font-size:11.5px;color:var(--text-3)">
      Next-best qualifying markets: ${b.alternatives.map((a) => esc(a.label) + ' (' + (a.prob * 100).toFixed(0) + '%, score ' + a.score + ')').join(' · ')}</div>` : ''}
  </div>`;
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

/* ---------------------------------------------------------- bankers view */

async function loadBankers(force) {
  if (state.bankers && !force) return state.bankers;
  setStatus('analysing the day…', 'busy');
  state.bankers = await api(`/api/bankers?date=${encodeURIComponent(state.date)}&limit=60`);
  setStatus(state.bankers.withBanker + ' bankers from ' + state.bankers.analysed + ' fixtures', 'ok');
  return state.bankers;
}

function renderBankers() {
  const el = $('#board');
  const data = state.bankers;
  if (!data) {
    el.innerHTML = `<div class="loading"><div class="spinner"></div><p>Running deep analysis across every fixture…</p>
      <p style="font-size:11px;color:var(--text-3);max-width:320px;text-align:center">
      This builds league baselines from live xG data and screens every market on every match. First run takes a moment; results are then cached.</p></div>`;
    return;
  }

  const best = data.bankerOfTheDay;
  let html = '';

  if (best) {
    const b = best.banker;
    html += `<div class="banker-hero">
      <div class="bh-kicker">★ Banker of the Day · ${esc(b.tierLabel)}</div>
      <div class="bh-match">${esc(best.match.home.name)} vs ${esc(best.match.away.name)}</div>
      <div class="bh-league">${esc(best.match.leagueFlag || '')} ${esc(best.match.leagueName)} · ${esc(fmtTime(best.match.date))} · ${esc(fmtDateLong(best.match.date.slice(0, 10)))}</div>
      <div class="bh-pick"><span class="p">${esc(b.label)}</span><span class="pr">${dec(b.price)}</span></div>
      <div class="bh-grid">
        <div class="bh-cell"><div class="v">${b.score}</div><div class="k">Sharpshooter</div></div>
        <div class="bh-cell"><div class="v">${pct(b.prob)}</div><div class="k">Probability</div></div>
        <div class="bh-cell"><div class="v">${b.valuePct == null ? '—' : (b.valuePct > 0 ? '+' : '') + b.valuePct.toFixed(1) + '%'}</div><div class="k">Expected value</div></div>
        <div class="bh-cell"><div class="v">${esc(b.tier)}</div><div class="k">Tier</div></div>
      </div>
    </div>`;
  }

  if (!data.bankers.length) {
    html += `<div class="empty"><h3>No banker qualified today</h3>
      <p>Every market on every fixture failed at least one gate. That is the correct output — no forced picks.</p></div>`;
  } else {
    html += `<div class="sec-title">All qualifying bankers <span class="pill">${data.bankers.length}</span></div>
      <div class="banker-grid">`;

    for (const item of data.bankers) {
      const b = item.banker;
      const cls = b.tier === 'Platinum' ? 'plat' : b.tier === 'Gold' ? 'gold' : 'silver';
      html += `<div class="bcard" data-id="${esc(item.match.id)}" data-league="${esc(item.match.league)}" data-year="${esc(item.match.seasonYear || '')}">
        <div class="bcard-top">
          <span class="bcard-league">${esc(item.match.leagueFlag || '')} ${esc(item.match.leagueName)}</span>
          <span class="badge ${cls}">${esc(b.tier)}</span>
          <span class="bcard-score">${b.score}</span>
        </div>
        <div class="bcard-match">${esc(item.match.home.name)} vs ${esc(item.match.away.name)}</div>
        <div class="bcard-pick">
          <div class="p">${esc(b.label)}</div>
          <div class="m">${esc(b.group)} · ${esc(fmtTime(item.match.date))}</div>
        </div>
        <div class="bcard-stats">
          <span>Prob <b>${pct(b.prob)}</b></span>
          <span>Price <b>${dec(b.price)}</b></span>
          <span>EV <b>${b.valuePct == null ? '—' : (b.valuePct > 0 ? '+' : '') + b.valuePct.toFixed(1) + '%'}</b></span>
        </div>
        ${(b.traps && b.traps.length) ? `<div class="bcard-caveats">
          <span class="bcc-label">Caveats</span>
          ${b.traps.slice(0, 4).map((t) => `<span class="bcc sev-${esc(t.severity)}" title="${esc(t.detail || '')}">${esc(t.label)}</span>`).join('')}
        </div>` : ''}
      </div>`;
    }
    html += `</div>`;
  }

  // ---- Leans: near-misses, explicitly separated from bankers ----
  if (data.leans && data.leans.length) {
    html += `<div class="sec-title" style="margin-top:26px">Best leans
      <span class="pill">near-misses · not bankers</span></div>
      <p style="font-size:12px;color:var(--text-3);margin:-2px 0 12px">
        These did <strong>not</strong> clear every gate. They are shown for transparency only —
        treat them as weaker than any banker above.</p>
      <div class="banker-grid">`;
    for (const item of data.leans.slice(0, 12)) {
      const l = item.lean;
      html += `<div class="bcard" data-id="${esc(item.match.id)}" data-league="${esc(item.match.league)}" data-year="${esc(item.match.seasonYear || '')}">
        <div class="bcard-top">
          <span class="bcard-league">${esc(item.match.leagueFlag || '')} ${esc(item.match.leagueName)}</span>
          <span class="badge none">lean</span>
          <span class="bcard-score">${l.score}</span>
        </div>
        <div class="bcard-match">${esc(item.match.home.name)} vs ${esc(item.match.away.name)}</div>
        <div class="bcard-pick lean">
          <div class="p">${esc(l.label)}</div>
          <div class="m">${esc(l.group)} · ${pct(l.prob)} · ${esc(fmtTime(item.match.date))}</div>
        </div>
        <div class="bcard-stats">
          <span>Prob <b>${pct(l.prob)}</b></span>
          <span>${l.verified ? 'Price <b>' + dec(l.price) + '</b>' : 'no quoted price'}</span>
        </div>
      </div>`;
    }
    html += `</div>`;
  }

  el.innerHTML = html;

  $$('.bcard', el).forEach((c) => {
    c.addEventListener('click', () => openMatch(c.dataset.id, c.dataset.league, c.dataset.year));
  });
}

/* ---------------------------------------------------------- daily view */

/* ---------------------------------------------------- caveats & provenance */

/**
 * The caveats attached to an elected banker.
 *
 * A banker is only trustworthy if its weaknesses are stated next to it. This
 * renders, in order of severity: every trap that survived screening, the
 * team-news read, and any data-provenance gap (no xG, thin sample).
 */
function caveatBlock(b, rep) {
  if (!b) return '';
  const traps = (b.traps || []).slice().sort((a, c) => {
    const R = { veto: 4, high: 3, medium: 2, info: 1 };
    return (R[c.severity] || 0) - (R[a.severity] || 0);
  });

  const pv = rep && rep.dataProvenance;
  const prov = [];
  if (pv) {
    if (!pv.hasXg) prov.push('No xG published for these teams — the model fell back to goals-based ratings, which are less predictive.');
    if (pv.statsSample && Math.min(pv.statsSample.home, pv.statsSample.away) < 6) {
      prov.push(`Thin sample: ${pv.statsSample.home} and ${pv.statsSample.away} games played. Ratings are heavily shrunk toward the league mean.`);
    }
  }

  const newsNotes = (rep && rep.verdict && rep.verdict.newsNotes) || [];
  const nr = rep && rep.newsRisk;
  const newsItems = nr ? [...(nr.home.items || []), ...(nr.away.items || [])] : [];

  if (!traps.length && !prov.length && !newsNotes.length && !newsItems.length) return '';

  return `<div class="caveats">
    <div class="cv-title">Caveats — read before acting</div>
    ${traps.map((t) => `<div class="cv-row sev-${esc(t.severity)}">
      <span class="cv-dot"></span>
      <span class="cv-body"><b>${esc(t.label)}</b> ${esc(t.detail || '')}</span>
    </div>`).join('')}
    ${newsItems.map((n) => `<div class="cv-row sev-${esc(n.severity)}">
      <span class="cv-dot"></span>
      <span class="cv-body"><b>Team news · ${esc(n.label)}</b> ${esc(n.headline)}${n.published ? ' <i>(' + esc(n.published) + ')</i>' : ''}</span>
    </div>`).join('')}
    ${!newsItems.length && newsNotes.length ? `<div class="cv-row sev-info">
      <span class="cv-dot"></span>
      <span class="cv-body"><b>Team news</b> ${esc(newsNotes.join(' '))}</span>
    </div>` : ''}
    ${prov.map((p) => `<div class="cv-row sev-medium">
      <span class="cv-dot"></span>
      <span class="cv-body"><b>Data quality</b> ${esc(p)}</span>
    </div>`).join('')}
  </div>`;
}

function renderDaily() {
  const el = $('#board');
  const data = state.bankers;
  if (!data) {
    el.innerHTML = `<div class="loading"><div class="spinner"></div><p>Selecting the banker of the day…</p></div>`;
    return;
  }
  const best = data.bankerOfTheDay;
  if (!best) {
    el.innerHTML = `<div class="empty"><h3>No banker of the day</h3>
      <p>No fixture on ${esc(fmtDateLong(state.date))} produced a market that cleared every gate.</p></div>`;
    return;
  }
  const b = best.banker;
  const m = best.match;
  el.innerHTML = `<div class="banker-hero">
      <div class="bh-kicker">★ Banker of the Day · ${esc(b.tierLabel)}</div>
      <div class="bh-match">${esc(m.home.name)} vs ${esc(m.away.name)}</div>
      <div class="bh-league">${esc(m.leagueFlag || '')} ${esc(m.leagueName)} · ${esc(fmtTime(m.date))} · ${esc(fmtDateLong(m.date.slice(0, 10)))}</div>
      <div class="bh-pick"><span class="p">${esc(b.label)}</span><span class="pr">${dec(b.price)}</span></div>
      <div class="bh-grid">
        <div class="bh-cell"><div class="v">${b.score}</div><div class="k">Sharpshooter</div></div>
        <div class="bh-cell"><div class="v">${pct(b.prob)}</div><div class="k">Probability</div></div>
        <div class="bh-cell"><div class="v">${dec(b.fairOdds)}</div><div class="k">Fair odds</div></div>
        <div class="bh-cell"><div class="v">${b.edge == null ? '—' : (b.edge > 0 ? '+' : '') + (b.edge * 100).toFixed(1) + '%'}</div><div class="k">Edge</div></div>
        <div class="bh-cell"><div class="v">${b.valuePct == null ? '—' : (b.valuePct > 0 ? '+' : '') + b.valuePct.toFixed(1) + '%'}</div><div class="k">EV</div></div>
      </div>
      <div style="margin-top:14px;font-size:12.5px;line-height:1.65">
        <strong>Why this one:</strong> ${esc(best.verdict ? best.verdict.summary : '')}
      </div>
      ${caveatBlock(b, best)}
    </div>
    <div class="sec-title">Runner-up bankers <span class="pill">${Math.max(0, data.bankers.length - 1)}</span></div>
    <div class="banker-grid">
    ${data.bankers.slice(1, 7).map((item) => {
      const bb = item.banker;
      return `<div class="bcard" data-id="${esc(item.match.id)}" data-league="${esc(item.match.league)}" data-year="${esc(item.match.seasonYear || '')}">
        <div class="bcard-top">
          <span class="bcard-league">${esc(item.match.leagueName)}</span>
          <span class="bcard-score">${bb.score}</span>
        </div>
        <div class="bcard-match">${esc(item.match.home.name)} vs ${esc(item.match.away.name)}</div>
        <div class="bcard-pick"><div class="p">${esc(bb.label)}</div><div class="m">${esc(bb.group)} · ${pct(bb.prob)}</div></div>
      </div>`;
    }).join('')}
    </div>`;

  $$('.bcard', el).forEach((c) => {
    c.addEventListener('click', () => openMatch(c.dataset.id, c.dataset.league, c.dataset.year));
  });
}

/* ---------------------------------------------------------- orchestration */

async function loadBoard() {
  setStatus('loading fixtures…', 'busy');
  try {
    state.board = await api(`/api/matches?date=${encodeURIComponent(state.date)}`);
    setStatus(`${state.board.totalMatches} fixtures · ${state.board.totalLeagues} competitions`, 'ok');
    renderBoard();
    // Banker badges need the day's deep analysis. Load it in the background so
    // the fixture list stays fast, then re-render once the badges are known.
    if (!state.bankers) {
      loadBankers()
        .then(() => { if (state.view === 'matches') renderBoard(); })
        .catch(() => { /* badges are a progressive enhancement */ });
    }
  } catch (err) {
    $('#board').innerHTML = `<div class="err-box"><strong>Could not load fixtures</strong><br>${esc(err.message)}</div>`;
    setStatus('error', 'err');
  }
}

async function refresh() {
  if (state.view === 'matches') {
    await loadBoard();
  } else {
    try {
      await loadBankers(true);
      if (state.view === 'bankers') renderBankers();
      else renderDaily();
    } catch (err) {
      $('#board').innerHTML = `<div class="err-box"><strong>Analysis failed</strong><br>${esc(err.message)}</div>`;
      setStatus('error', 'err');
    }
  }
}

function setView(view) {
  state.view = view;
  $$('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.view === view));
  $('#bankersOnly').parentElement.style.display = view === 'matches' ? '' : 'none';

  if (view === 'matches') { loadBoard(); }
  else {
    $('#board').innerHTML = `<div class="loading"><div class="spinner"></div><p>Running deep analysis across every fixture…</p>
      <p style="font-size:11px;color:var(--text-3);max-width:320px;text-align:center">
      Building league baselines from live xG data and screening every market on every match.</p></div>`;
    loadBankers(state.bankers ? state.bankers.date !== state.date : true)
      .then(() => (view === 'bankers' ? renderBankers() : renderDaily()))
      .catch((err) => {
        $('#board').innerHTML = `<div class="err-box"><strong>Analysis failed</strong><br>${esc(err.message)}</div>`;
        setStatus('error', 'err');
      });
  }
}

function setDate(iso) {
  state.date = iso;
  state.bankers = null;
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
    if (state.bankersOnly && !state.bankers) {
      loadBankers().then(() => renderBoard()).catch(() => renderBoard());
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
