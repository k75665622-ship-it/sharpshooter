'use strict';

/* ============================================================
   Sharpshooter — Tiers tab
   Every methodology pick of the day, grouped by its chance of winning:
   Diamond 80%+, Gold 70-80%, Silver 60-70%, Bronze 50-60%, and the long shots.
   Each tier opens to the methodologies and the matches under it.

   Loaded after app.js; reads the day's predictions (state.preds, /api/predictions) and uses
   app.js's helpers ($, $$, esc, pct, dec, fmtTime, fmtDateLong, loadingBlock, openMatch,
   statusBadge, mark, scoreTag).
   ============================================================ */

(function () {
  // open: the tiers shown open; touched: the visitor has opened or closed one (until then the
  // first tier with picks opens by itself, also when picks arrive later in the day)
  const TV = { open: new Set(), touched: false, method: 'all', date: null };
  // used until the server sends its own list (lib/methodology/core.js TIERS, lib/backtest.json)
  const DEFAULT_TIERS = [
    { name: 'Diamond', min: 0.8, label: '80%+ chance' },
    { name: 'Gold', min: 0.7, label: '70-80% chance' },
    { name: 'Silver', min: 0.6, label: '60-70% chance' },
    { name: 'Bronze', min: 0.5, label: '50-60% chance' },
    { name: 'Long shot', min: 0, label: 'under 50% chance' },
  ];
  const CLS = { Diamond: 'diamond', Gold: 'gold', Silver: 'silver', Bronze: 'bronze', 'Long shot': 'long' };
  const p0 = (v) => (v == null ? '—' : Math.round(v * 100) + '%');

  const tiersOf = (d) => (d.tiers && d.tiers.length ? d.tiers : DEFAULT_TIERS);
  const tierOf = (tiers, prob) => tiers.find((t) => (prob || 0) >= t.min - 1e-9) || tiers[tiers.length - 1];

  /** Every qualifying methodology pick of the day (not paper-only ones). */
  function allPicks(d) {
    const out = [];
    for (const list of Object.values(d.byMethod || {})) {
      for (const it of list || []) {
        const p = it.prediction;
        if (!p || !p.pick || (p.status !== 'LOCK' && p.status !== 'PREDICT')) continue;
        out.push(it);
      }
    }
    return out;
  }

  function tally(list) {
    const t = { won: 0, lost: 0, live: 0, toPlay: 0 };
    for (const it of list) {
      const o = it.outcome;
      if (!o) t.toPlay++;
      else if (!o.final) t.live++;
      else if (o.hit === 1) t.won++;
      else if (o.hit === 0) t.lost++;
    }
    return t;
  }

  function row(it) {
    const m = it.match;
    const p = it.prediction;
    const started = m.state && m.state !== 'pre';
    const take = p.price && p.price.valuePrice != null ? ` · take ≥ <b>${dec(p.price.valuePrice)}</b>` : '';
    return `<button class="tr-row" data-id="${esc(m.id)}" data-league="${esc(m.league)}" data-year="${esc(m.seasonYear || '')}" title="Open the full match analysis">
      <span class="tr-time">${started ? scoreTag(m) : esc(fmtTime(m.date))}</span>
      <span class="tr-match"><b>${esc(m.home.name)} <i>v</i> ${esc(m.away.name)}</b><small>${esc(m.leagueFlag || '')} ${esc(m.leagueName || '')}</small></span>
      <span class="tr-pick">${esc(p.pick.label)} ${it.outcome ? mark(it.outcome.hit, it.outcome.final) : ''}</span>
      <span class="tr-num"><b>${p0(p.prob)}</b><small>fair ${dec(p.fairOdds)}${take}</small></span>
      <span class="tr-st">${statusBadge(p)}</span>
    </button>`;
  }

  function tierBlock(t, list, open) {
    const cls = CLS[t.name] || 'long';
    const rec = t.heldOut;
    const tl = tally(list);
    // methodologies in this tier, the most picks first; matches by kick-off
    const byMethod = new Map();
    for (const it of list) {
      const k = it.prediction.name;
      if (!byMethod.has(k)) byMethod.set(k, []);
      byMethod.get(k).push(it);
    }
    const groups = [...byMethod.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    for (const [, g] of groups) g.sort((a, b) => new Date(a.match.date) - new Date(b.match.date) || b.prediction.prob - a.prediction.prob);
    const done = tl.won + tl.lost;
    return `<section class="tr-tier tr-${cls}${open ? ' is-open' : ''}${list.length ? '' : ' is-empty'}">
      <button class="tr-head" data-tier="${esc(t.name)}" aria-expanded="${open}" aria-controls="tr-body-${cls}">
        <span class="tr-gem" aria-hidden="true"></span>
        <span class="tr-name"><b>${esc(t.name)}</b><small>${esc(t.label)}</small></span>
        <span class="tr-rec">${rec ? `won <b>${pct(rec.hitRate, 1)}</b> on past matches` : ''}</span>
        <span class="tr-count"><b>${list.length}</b><small>${list.length === 1 ? 'pick' : 'picks'}${done ? ` · ${tl.won} ✓ ${tl.lost} ✕` : ''}</small></span>
        <span class="tr-chev" aria-hidden="true"></span>
      </button>
      <div class="tr-body" id="tr-body-${cls}"${open ? '' : ' hidden'}>
        ${rec ? `<p class="tr-note">${esc(t.name)} picks won <b>${pct(rec.hitRate, 1)}</b> of ${rec.n.toLocaleString('en-GB')} on 2023-26 matches the models never saw (they said ${pct(rec.statedProb, 1)}).
          ${t.name === 'Long shot' ? 'Draws, correct scores and a team failing to score: they lose more often than they win.' : `${pct(1 - rec.hitRate, 0)} of them still lost.`}</p>` : ''}
        ${list.length ? `${groups.map(([name, g]) => `<div class="tr-group">
            <div class="tr-gh">${esc(name)} <span class="pill">${g.length}</span></div>
            <div class="tr-rows">${g.map(row).join('')}</div>
          </div>`).join('')}
          <div class="tr-actions"><button class="tr-copy" data-copy="${esc(t.name)}">Copy ${esc(t.name)} picks</button></div>`
        : `<p class="tr-none">No ${esc(t.name)} pick${TV.method === 'all' ? '' : ' for this market'} on this date.</p>`}
      </div>
    </section>`;
  }

  function copyText(d, t, list) {
    const lines = [`Sharpshooter ${t.name} picks (${t.label}) — ${fmtDateLong(d.date || state.date)}`];
    for (const it of [...list].sort((a, b) => new Date(a.match.date) - new Date(b.match.date))) {
      lines.push(`${fmtTime(it.match.date)} ${it.match.home.name} v ${it.match.away.name}: ${it.prediction.pick.label} (${p0(it.prediction.prob)}, fair ${dec(it.prediction.fairOdds)}) — ${it.prediction.name}`);
    }
    lines.push('Probabilities, not guarantees. 18+, bet responsibly.');
    return lines.join('\n');
  }

  function coverageLine(d) {
    const c = d.dayCoverage;
    if (!c || !c.toPlay) return '';
    if (c.pending > 0) return `<p class="tr-cov is-busy">Analysed <b>${c.analysed}</b> of the ${c.toPlay} matches still to play — the other ${c.pending} are being analysed now and will appear here in a few minutes.</p>`;
    return `<p class="tr-cov">Every match still to play was analysed: <b>${c.analysed}</b> of ${c.toPlay}.</p>`;
  }

  function render() {
    const el = $('#board');
    const d = state.preds;
    if (!d) {
      el.innerHTML = loadingBlock('Sorting every methodology pick into its tier…', 'Every match of the day goes through the thirteen methodologies first. The first run of the day takes a moment.');
      return;
    }
    const tiers = tiersOf(d);
    const all = allPicks(d);
    const methods = new Map();
    for (const it of all) methods.set(it.prediction.id, { name: it.prediction.name, n: (methods.get(it.prediction.id) || { n: 0 }).n + 1 });
    if (TV.method !== 'all' && !methods.has(TV.method)) TV.method = 'all';
    const shown = all.filter((it) => TV.method === 'all' || it.prediction.id === TV.method);
    const byTier = new Map(tiers.map((t) => [t.name, []]));
    for (const it of shown) byTier.get(tierOf(tiers, it.prediction.prob).name).push(it);
    if (!TV.touched) {
      const first = tiers.find((t) => byTier.get(t.name).length);
      TV.open = new Set(first ? [first.name] : []);
    }
    const counts = tiers.filter((t) => t.name !== 'Long shot');
    const rec = (t) => (t.heldOut ? pct(t.heldOut.hitRate, 0) : '—');

    el.innerHTML = `<div class="m-intro tr-intro">
        <div class="tr-kicker">Tiers · ${esc(fmtDateLong(d.date || state.date))}</div>
        <h2>Every methodology pick, by its chance of winning</h2>
        <p>All thirteen methodologies — Over / Under 2.5, both teams to score, team goals, home / draw / away, double chance,
        handicaps and the rest — run on every match. Each pick that falls under one lands in a tier by its chance:
        ${counts.map((t) => `<b>${esc(t.name)}</b> ${esc(t.label.replace(' chance', ''))}`).join(', ')}.
        The chances are measured: on 2023-26 matches the models never saw, ${counts.map((t) => `${esc(t.name)} picks won ${rec(t)}`).join(', ')}.
        Open a tier to see its methodologies and matches.</p>
        ${coverageLine(d)}
      </div>
      ${all.length ? `<div class="filters tr-filters" role="group" aria-label="Market">
          <button class="fchip ${TV.method === 'all' ? 'is-active' : ''}" data-m="all">All markets <b>${all.length}</b></button>
          ${[...methods.entries()].sort((a, b) => b[1].n - a[1].n).map(([id, x]) => `<button class="fchip ${TV.method === id ? 'is-active' : ''}" data-m="${esc(id)}">${esc(x.name)} <b>${x.n}</b></button>`).join('')}
        </div>`
      : `<p class="tr-empty">${d.dayCoverage && d.dayCoverage.pending ? 'No methodology pick yet: the day\'s matches are still being analysed.' : `No match on ${esc(fmtDateLong(state.date))} falls under a methodology.`}</p>`}
      <div class="tr-list">${tiers.map((t) => tierBlock(t, byTier.get(t.name), TV.open.has(t.name))).join('')}</div>
      <p class="muted-t tr-foot">A tier is a chance, not a promise: even a Diamond pick loses about one time in seven. Only take a price at or above the fair odds. 18+. Bet responsibly.</p>`;

    $$('.tr-head', el).forEach((b) => b.addEventListener('click', () => {
      const name = b.dataset.tier;
      TV.touched = true;
      if (TV.open.has(name)) TV.open.delete(name);
      else TV.open.add(name);
      const sec = b.closest('.tr-tier');
      const open = TV.open.has(name);
      sec.classList.toggle('is-open', open);
      b.setAttribute('aria-expanded', String(open));
      const body = sec.querySelector('.tr-body');
      if (body) body.hidden = !open;
    }));
    $$('.tr-row', el).forEach((r) => r.addEventListener('click', () => openMatch(r.dataset.id, r.dataset.league, r.dataset.year)));
    $$('[data-m]', el).forEach((b) => b.addEventListener('click', () => { TV.method = b.dataset.m; render(); }));
    $$('[data-copy]', el).forEach((b) => b.addEventListener('click', () => {
      const t = tiers.find((x) => x.name === b.dataset.copy);
      const text = copyText(d, t, byTier.get(t.name));
      const done = () => { b.textContent = 'Copied'; setTimeout(() => { b.textContent = `Copy ${t.name} picks`; }, 1800); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => window.prompt('Copy the picks:', text));
      else window.prompt('Copy the picks:', text);
    }));
  }

  /** Called by app.js (renderPredView) whenever the day's predictions change. */
  window.renderTiers = function () {
    if (state.preds && TV.date !== state.preds.date) {
      TV.date = state.preds.date;
      TV.touched = false;
    }
    render();
  };
})();
