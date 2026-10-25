'use strict';

/* ============================================================
   Sharpshooter — Strongest Picks tab
   Loaded after app.js; uses its helpers ($, $$, esc, pct, dec, api, fmtTime,
   fmtDateLong, loadingBlock, openMatch, setStatus) and its `state.date`.
   ============================================================ */

(function () {
  const SP = { data: null, date: null, loading: false, error: null, sort: 'strength', group: 'all', seq: 0 };
  const GROUPS = ['Goals', 'Corners', 'Half', 'Players', 'Minutes', 'Team', 'Match', 'Bookings', 'Special'];
  const VIEW = { market: 'Market', stats: 'Stats', factors: 'Factors', season: 'Season', recent: 'Last 6' };

  const tierCls = (t) => (t ? String(t).toLowerCase() : 'none');
  const p0 = (v) => (v == null ? '—' : Math.round(v * 100) + '%');

  async function load(force) {
    const date = state.date;
    if (!force && SP.data && SP.date === date) return SP.data;
    // this browser's saved copy of the day (public/daycache.js): shown at once
    if (!force && window.DayCache && (!SP.data || SP.date !== date)) {
      const saved = await window.DayCache.getPayload('strongest', date);
      if (saved && state.date === date && (!SP.data || SP.date !== date)) {
        SP.data = saved;
        SP.date = date;
        if (state.view === 'strongest') render();
      }
    }
    const seq = ++SP.seq;
    SP.loading = true;
    SP.error = null;
    try {
      const d = await api(`/api/strongest?date=${encodeURIComponent(date)}${force ? '&refresh=1' : ''}`);
      if (seq !== SP.seq) return null;
      // keep this morning's picks once their matches start (public/shared.js)
      const merged = window.SS ? window.SS.mergeStrongest(SP.data && SP.date === date ? SP.data : null, d) : d;
      SP.data = merged;
      SP.date = date;
      if (window.DayCache) window.DayCache.putPayload('strongest', date, merged);
      // the server answered from its day book and is rebuilding: look again shortly
      clearTimeout(SP.poll);
      if (d.cache && d.cache.refreshing) SP.poll = setTimeout(() => { if (state.view === 'strongest' && state.date === date) window.renderStrongest(); }, 20000);
      return merged;
    } catch (err) {
      if (seq === SP.seq) SP.error = err;
      throw err;
    } finally {
      if (seq === SP.seq) SP.loading = false;
    }
  }

  function checks(sel, bar) {
    return Object.entries(sel.views || {}).map(([k, v]) => {
      const ok = v >= bar - 1e-9;
      return `<span class="sp-chk ${ok ? 'ok' : 'no'}" title="${esc(VIEW[k] || k)} view">${ok ? '✓' : '✕'} ${esc(VIEW[k] || k)} <b>${p0(v)}</b></span>`;
    }).join('');
  }

  function barFor(sel, cfg) {
    return sel.kind === 'corners' || sel.kind === 'cards' ? cfg.floorStatsOnly : cfg.floor;
  }

  function priceBit(sel) {
    if (!sel.price || !sel.price.best) return `<span>take at ≥ <b>${dec(sel.takeAt)}</b></span>`;
    const e = sel.price.edge;
    return `<span>best seen <b>${dec(sel.price.best)}</b>${sel.price.book ? ` ${esc(sel.price.book)}` : ''} <em class="${e >= 0 ? 'pos' : 'neg'}">${e >= 0 ? '+' : ''}${(e * 100).toFixed(1)}%</em></span>`;
  }

  function pickCard(it, rank, cfg) {
    const m = it.match;
    const s = it.pick;
    const reasons = s.reasons || [];
    const shown = reasons.slice(0, 3);
    const more = reasons.slice(3);
    return `<article class="sp-pick t-${tierCls(s.tier)}${rank ? '' : ' no-rank'}">
      ${rank ? `<div class="sp-rank" aria-label="Rank ${rank}">${rank}</div>` : ''}
      <div class="sp-body">
        <div class="sp-meta"><span>${esc(fmtTime(m.date))}</span><span>${esc(m.leagueFlag || '')} ${esc(m.leagueName)}</span><span class="sp-grp">${esc(s.group)}</span></div>
        <div class="sp-sel">${esc(s.label)}</div>
        <button class="sp-match" data-id="${esc(m.id)}" data-league="${esc(m.league)}" data-year="${esc(m.seasonYear || '')}" title="Open the full match analysis">${esc(m.home.name)} <span>v</span> ${esc(m.away.name)} <i>→</i></button>
        <div class="sp-checks">${checks(s, barFor(s, cfg))}</div>
        <ul class="sp-why">${shown.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
        ${more.length || (s.caveats && s.caveats.length) ? `<details class="sp-more"><summary>${more.length ? `${more.length} more reason${more.length > 1 ? 's' : ''}` : ''}${more.length && s.caveats.length ? ' · ' : ''}${s.caveats.length ? `${s.caveats.length} caveat${s.caveats.length > 1 ? 's' : ''}` : ''}</summary>
          ${more.length ? `<ul class="sp-why">${more.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
          ${s.caveats.length ? `<ul class="sp-cav">${s.caveats.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
        </details>` : ''}
      </div>
      <div class="sp-num">
        <div class="sp-prob">${p0(s.prob)}</div>
        <div class="sp-fair">fair ${dec(s.fair)}</div>
        <span class="sp-tier t-${tierCls(s.tier)}">${esc(s.tier || '')}</span>
        <div class="sp-price">${priceBit(s)}</div>
      </div>
    </article>`;
  }

  function combinedStrip(list) {
    if (!list || !list.length) return '';
    return `<div class="sp-combo"><span class="sp-combo-k">Combine them</span>${list.map((c) => `<span class="sp-combo-i"><b>${c.all ? `All ${c.size}` : `Top ${c.size}`}</b> ${p0(c.prob)} <small>fair ${dec(c.fairOdds)}</small></span>`).join('')}
      <span class="sp-combo-n">Picks are from different matches, so their chances multiply. Every extra leg lowers the chance of landing.</span></div>`;
  }

  function earlierBlock(rows) {
    if (!rows || !rows.length) return '';
    const res = (e) => (e.hit === 1 ? '<b class="pos">✓ Won</b>' : e.hit === 0 ? '<b class="neg">✕ Lost</b>' : e.result === 'void' ? '<span class="muted-t">void</span>' : '<span class="muted-t">in play / pending</span>');
    return `<div class="sec-title sp-sec">Already kicked off <span class="pill">${rows.length}</span></div>
      <div class="sp-earlier">${rows.map((e) => `<div class="sp-er"><span>${esc(fmtTime(e.date))}</span><span><b>${esc(e.label)}</b> <small>${esc(e.home)} v ${esc(e.away)}</small></span><span>${p0(e.prob)}</span><span>${e.result && e.result !== 'void' ? esc(e.result) : ''}</span><span>${res(e)}</span></div>`).join('')}</div>`;
  }

  function nearBlock(list) {
    if (!list || !list.length) return '';
    return `<div class="sec-title sp-sec">Near misses <span class="pill">${list.length}</span></div>
      <p class="muted-t sp-note">Close, but one view stays under the bar. Shown for information; not Strongest Picks.</p>
      <div class="sp-near">${list.map((it) => `<button class="sp-nr" data-id="${esc(it.match.id)}" data-league="${esc(it.match.league)}" data-year="${esc(it.match.seasonYear || '')}">
        <span>${esc(fmtTime(it.match.date))}</span><span><b>${esc(it.pick.label)}</b> <small>${esc(it.match.home.name)} v ${esc(it.match.away.name)} · ${esc(it.pick.group)}</small></span>
        <span class="sp-nr-v">${Object.entries(it.pick.views).map(([k, v]) => `${esc(VIEW[k] || k)} ${p0(v)}`).join(' · ')}</span></button>`).join('')}</div>`;
  }

  function matchCard(mt, cfg) {
    const m = mt.match;
    const xg = mt.expectedGoals || {};
    const xgLine = Object.entries(xg).map(([k, v]) => `${esc(VIEW[k] || k)} ${dec(v.home)}–${dec(v.away)}`).join(' · ');
    const rows = mt.cards.filter((c) => SP.group === 'all' || c.group === SP.group);
    return `<div class="sp-mc ${mt.started ? 'is-started' : ''}">
      <button class="sp-mc-h" data-id="${esc(m.id)}" data-league="${esc(m.league)}" data-year="${esc(m.seasonYear || '')}">
        <span class="sp-mc-t">${esc(fmtTime(m.date))} · ${esc(m.leagueName)}${mt.started ? ' · <em>kicked off</em>' : ''}</span>
        <span class="sp-mc-n">${esc(m.home.name)} <span>v</span> ${esc(m.away.name)}</span>
        ${xgLine ? `<span class="sp-mc-x">Expected goals: ${xgLine}</span>` : ''}
      </button>
      <div class="sp-mc-rows">${rows.map((c) => (c.none
        ? `<div class="sp-row none"><span class="sp-row-g">${esc(c.group)}</span><span class="sp-row-l">${esc(c.note)}</span></div>`
        : `<div class="sp-row lv-${esc(String(c.level || '').toLowerCase())} ${mt.strongest === c.key ? 'is-strongest' : ''}" title="${esc(c.checks)}">
            <span class="sp-row-g">${esc(c.group)}${mt.strongest === c.key ? ' <i class="sp-star">★ Strongest Pick</i>' : ''}</span>
            <span class="sp-row-l">${esc(c.label)}</span>
            <span class="sp-row-n"><b class="sp-row-p">${p0(c.prob)}</b><small class="sp-row-f">fair ${dec(c.fair)}</small><span class="sp-row-lv"><i class="sp-dot"></i>${esc(c.level || '')}</span></span>
          </div>`)).join('')}</div>
    </div>`;
  }

  function recordBlock(r, cfg) {
    if (!r) return '';
    const P = r.picks || {};
    const tiers = (cfg.tiers || []).map((t) => {
      const s = (r.byTier || {})[t.name] || {};
      return `<div class="bt-row"><span><span class="sp-tier t-${tierCls(t.name)}">${esc(t.name)}</span> lowest view ${p0(t.min)}+</span><span>${s.n || 0}</span><span>${s.hitRate == null ? '—' : pct(s.hitRate, 1)}</span><span>${s.stated == null ? '—' : pct(s.stated, 1)}</span><span>${s.pending || 0}</span></div>`;
    }).join('');
    const groups = Object.entries(r.cards || {}).sort((a, b) => GROUPS.indexOf(a[0]) - GROUPS.indexOf(b[0]));
    return `<div class="sec-title sp-sec">Track record <span class="pill">${P.n || 0} settled</span></div>
      <div class="sumstrip sp-rec">
        <div class="ss-cell"><div class="v">${P.hitRate == null ? '—' : pct(P.hitRate, 1)}</div><div class="k">Strongest Picks won</div></div>
        <div class="ss-cell"><div class="v">${P.stated == null ? '—' : pct(P.stated, 1)}</div><div class="k">Average stated chance</div></div>
        <div class="ss-cell"><div class="v">${P.won || 0}/${P.n || 0}</div><div class="k">Won / settled</div></div>
        <div class="ss-cell"><div class="v">${P.pending || 0}</div><div class="k">Waiting for a result</div></div>
      </div>
      <p class="muted-t sp-note">Every pick is written down before kick-off and settled from ESPN and football-data.co.uk results; nothing is edited afterwards.
        A well-calibrated record wins about as often as its average stated chance. <a class="dl" href="/api/strongest/record?format=csv">Download CSV</a></p>
      <div class="bt-table sp-bt">
        <div class="bt-row head"><span>Strength</span><span>Settled</span><span>Won</span><span>Stated</span><span>Pending</span></div>
        ${tiers}
      </div>
      ${groups.length ? `<div class="bt-table sp-bt" style="margin-top:10px">
        <div class="bt-row head"><span>Match-card picks by market</span><span>Settled</span><span>Won</span><span>Stated</span><span>Pending</span></div>
        ${groups.map(([g, s]) => `<div class="bt-row"><span>${esc(g)}</span><span>${s.n}</span><span>${s.hitRate == null ? '—' : pct(s.hitRate, 1)}</span><span>${s.stated == null ? '—' : pct(s.stated, 1)}</span><span>${s.pending}</span></div>`).join('')}
      </div>` : ''}
      ${(r.recent || []).length ? `<div class="bt-table sp-bt" style="margin-top:10px">
        <div class="bt-row head"><span>Recent Strongest Picks</span><span>Chance</span><span>Strength</span><span>Score</span><span>Result</span></div>
        ${r.recent.slice(0, 12).map((e) => `<div class="bt-row"><span>${esc(e.label)} <small>${esc(e.home)} v ${esc(e.away)} · ${esc(String(e.date).slice(0, 10))}</small></span><span>${p0(e.prob)}</span><span>${esc(e.tier || '')}</span><span>${e.result && e.result !== 'void' ? esc(e.result) : e.result === 'void' ? 'void' : '<small>pending</small>'}</span><span>${e.hit === 1 ? '<b class="pos">✓</b>' : e.hit === 0 ? '<b class="neg">✕</b>' : ''}</span></div>`).join('')}
      </div>` : ''}`;
  }

  function copyText(d, list) {
    const lines = [`Sharpshooter Strongest Picks — ${fmtDateLong(d.date || state.date)}`];
    for (const it of list) lines.push(`${fmtTime(it.match.date)} ${it.match.home.name} v ${it.match.away.name}: ${it.pick.label} (${p0(it.pick.prob)}, fair ${dec(it.pick.fair)})`);
    lines.push('Probabilities, not guarantees. 18+, bet responsibly.');
    return lines.join('\n');
  }

  function render() {
    const el = $('#board');
    const d = SP.data;
    if (!d || SP.date !== state.date) {
      el.innerHTML = SP.error
        ? `<div class="err-box"><strong>Could not build the Strongest Picks</strong><br>${esc(SP.error.message || SP.error)}</div>`
        : loadingBlock('Finding the strongest picks…', 'Every match is priced across nine markets by up to three independent views. The first load of the day takes a little while.');
      return;
    }
    const cfg = d.config || { floor: 0.75, floorStatsOnly: 0.8, maxProb: 0.88, tiers: [] };
    const picks = [...(d.picks || [])];
    if (SP.sort === 'kickoff') picks.sort((a, b) => new Date(a.match.date) - new Date(b.match.date));
    const tierCount = (n) => picks.filter((p) => p.pick.tier === n).length;
    const rec = d.record && d.record.picks;
    const upcoming = (d.matches || []).filter((m) => !m.started);

    el.innerHTML = `<div class="m-intro sp-intro">
        <div class="sp-kicker">Strongest Picks · ${esc(fmtDateLong(d.date || state.date))}</div>
        <h2>The picks every view agrees on</h2>
        <p>Each match is priced across SportyBet's nine markets — Goals, Corners, Half, Players, Minutes, Team, Match, Bookings and Special — by up to three
        independent views. A pick only makes this list when <b>every view rates it at least ${p0(cfg.floor)}</b>, the bookmakers' price backs it, and nothing flags
        it as a trap. There is <b>no fixed number</b>: some days give none, some give twelve.</p>
        <details class="sp-rules"><summary>How a pick qualifies</summary><ul class="rules">${(d.rules || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul></details>
      </div>
      <div class="sumstrip">
        <div class="ss-cell st-lock"><div class="v">${picks.length}</div><div class="k">Strongest Picks</div></div>
        <div class="ss-cell"><div class="v">${tierCount('Elite')} · ${tierCount('Strong')} · ${tierCount('Solid')}</div><div class="k">Elite · Strong · Solid</div></div>
        <div class="ss-cell"><div class="v">${upcoming.length}</div><div class="k">Matches still to play</div></div>
        <div class="ss-cell"><div class="v">${rec && rec.hitRate != null ? pct(rec.hitRate, 0) : '—'}</div><div class="k">${rec && rec.n ? `Record: ${rec.won}/${rec.n} won` : 'Record starts today'}</div></div>
      </div>
      ${picks.length ? `<div class="sp-bar">
          <div class="filters sp-sort" role="group" aria-label="Sort picks">
            <button class="fchip ${SP.sort === 'strength' ? 'is-active' : ''}" data-sort="strength">Strongest first</button>
            <button class="fchip ${SP.sort === 'kickoff' ? 'is-active' : ''}" data-sort="kickoff">By kick-off</button>
          </div>
          <button class="sp-copy" id="spCopy">Copy picks</button>
        </div>
        <div class="sp-list">${picks.map((it, i) => pickCard(it, SP.sort === 'strength' ? i + 1 : null, cfg)).join('')}</div>
        ${combinedStrip(d.combined)}`
      : `<div class="empty sp-empty"><h3>No Strongest Pick ${upcoming.length ? 'yet' : 'today'}</h3>
          <p>${upcoming.length ? `None of the ${upcoming.length} upcoming matches has a selection that every view rates ${p0(cfg.floor)} or more. That is the filter working: a weak day gives no picks rather than forced ones.` : 'No upcoming matches were analysed for this date.'}</p></div>`}
      ${earlierBlock(d.earlier)}
      ${nearBlock(d.nearMisses)}
      ${(d.matches || []).length ? `<div class="sec-title sp-sec">Every match · nine markets <span class="pill">${d.matches.length}</span></div>
        <p class="muted-t sp-note">The strongest selection of each market group for every match, with its chance and fair odds. ★ marks the match's Strongest Pick. Click a match for the full analysis.</p>
        <div class="filters sp-groups" role="group" aria-label="Market group">
          ${['all', ...GROUPS].map((g) => `<button class="fchip ${SP.group === g ? 'is-active' : ''}" data-group="${esc(g)}">${g === 'all' ? 'All nine' : esc(g)}</button>`).join('')}
        </div>
        <div class="sp-mgrid">${d.matches.map((mt) => matchCard(mt, cfg)).join('')}</div>` : ''}
      ${recordBlock(d.record, cfg)}
      <p class="muted-t sp-foot">Probabilities, not guarantees. Fair odds = 100 ÷ chance: only take a price at or above the "take at" figure. 18+. Bet responsibly.</p>`;

    $$('.sp-match, .sp-mc-h, .sp-nr', el).forEach((b) => b.addEventListener('click', () => openMatch(b.dataset.id, b.dataset.league, b.dataset.year)));
    $$('[data-sort]', el).forEach((b) => b.addEventListener('click', () => { SP.sort = b.dataset.sort; render(); }));
    $$('[data-group]', el).forEach((b) => b.addEventListener('click', () => { SP.group = b.dataset.group; render(); }));
    const cp = $('#spCopy', el);
    if (cp) {
      cp.addEventListener('click', () => {
        const text = copyText(d, picks);
        const done = () => { cp.textContent = 'Copied'; setTimeout(() => { cp.textContent = 'Copy picks'; }, 1800); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => window.prompt('Copy the picks:', text));
        else window.prompt('Copy the picks:', text);
      });
    }
  }

  /** Called by app.js when the tab is shown, the date changes or Refresh is pressed. */
  window.renderStrongest = function (force) {
    if (SP.date !== state.date) SP.data = null;
    render();
    if (SP.loading && !force) return;
    load(!!force)
      .then((d) => {
        if (!d || state.view !== 'strongest') return;
        render();
        setStatus(`${d.picks.length} strongest pick${d.picks.length === 1 ? '' : 's'} · ${d.counts.priced} matches priced`, 'ok');
      })
      .catch(() => { if (state.view === 'strongest') render(); });
  };
})();
