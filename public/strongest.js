'use strict';

/* ============================================================
   Sharpshooter — Strongest Picks tab
   Loaded after app.js; uses its helpers ($, $$, esc, pct, dec, api, fmtTime,
   fmtDateLong, loadingBlock, openMatch, setStatus) and its `state.date`.
   ============================================================ */

(function () {
  const SP = { data: null, date: null, loading: false, error: null, sort: 'strength', group: 'all', seq: 0 };
  const GROUPS = ['Goals', 'Corners', 'Half', 'Players', 'Minutes', 'Team', 'Match', 'Bookings', 'Special'];
  const VIEW = { market: 'Market', stats: 'Stats', factors: 'Factors', pace: 'Possession', model: 'Form + price', season: 'Season', recent: 'Last 6' };

  const tierCls = (t) => (t ? String(t).toLowerCase() : 'none');
  const p0 = (v) => (v == null ? '—' : Math.round(v * 100) + '%');

  /** @param {boolean} force rebuild on the server; @param {boolean} again ask the server again */
  async function load(force, again) {
    const date = state.date;
    if (!force && !again && SP.data && SP.date === date) return SP.data;
    // this browser's saved copy of the day (public/daycache.js): shown at once
    if (!force && !again && window.DayCache && (!SP.data || SP.date !== date)) {
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
      SP.at = Date.now();
      if (window.DayCache) window.DayCache.putPayload('strongest', date, merged);
      // the server answered from its day book and is rebuilding: look again shortly
      clearTimeout(SP.poll);
      // (it asks the server again: the copy in memory is the stale one)
      if (d.cache && d.cache.refreshing) {
        SP.poll = setTimeout(() => {
          if (state.view !== 'strongest' || state.date !== date) return;
          load(false, true).then((x) => { if (x && state.view === 'strongest') render(); }).catch(() => {});
        }, 20000);
      }
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
        <div class="sp-fair">${s.measured ? 'measured chance · ' : ''}fair ${dec(s.fair)}</div>
        <span class="sp-tier t-${tierCls(s.tier)}">${esc(s.tier || '')}</span>
        <div class="sp-price">${priceBit(s)}</div>
      </div>
    </article>`;
  }

  const SLIP = {
    safe: ['Safe slip', 'The strongest picks while the combined chance stays at {t}+'],
    long: ['Longer slip', 'More legs for bigger odds, combined chance still {t}+'],
    all: ['Every pick on one slip', 'Shown so you can see what it costs — not recommended'],
  };

  /** One slip of the day's Strongest Picks, with how slips built that way did on past matches. */
  function slipCard(sl) {
    const [name, sub] = SLIP[sl.id] || [sl.id, ''];
    const mm = sl.measured;
    const oneIn = sl.prob > 0 ? Math.max(1, Math.round(1 / sl.prob)) : null;
    return `<div class="sp-slip s-${esc(sl.id)}">
        <div class="sp-slip-h">
          <span class="sp-slip-t">${esc(name)}</span>
          <div class="sp-slip-f"><span>Chance</span><b>${p0(sl.prob)}</b></div>
          <div class="sp-slip-f"><span>Fair odds</span><b>${dec(sl.fairOdds)}</b></div>
        </div>
        <div class="sp-slip-sub">${esc(sub.replace('{t}', p0(sl.target)))} · ${sl.size} legs</div>
        <ol class="sp-slip-legs">${sl.legs.map((l) => `<li><span>${esc(fmtTime(l.kickoff))}</span><span><b>${esc(l.label)}</b> <small>${esc(l.home)} v ${esc(l.away)}</small></span><span>${p0(l.prob)}</span></li>`).join('')}</ol>
        <div class="sp-slip-m">${mm && mm.n
          ? `Slips built this way on past matches: <b>${pct(mm.landed, 1)}</b> landed (stated ${pct(mm.stated, 1)}, ${mm.n.toLocaleString('en-GB')} match days${mm.legs ? `, ${dec(mm.legs, 1)} legs on average` : ''}).`
          : sl.id === 'all' && oneIn ? `About 1 chance in ${oneIn} that all ${sl.size} land.` : ''}
          ${sl.id === 'all' ? ' Each extra pick is one more way to lose the whole slip.' : ''}
          Bookmakers usually pay a little under the fair odds.</div>
      </div>`;
  }

  /** The live guard (lib/strongest/guard.js): what it has paused, and what it is watching. */
  function guardBlock(g) {
    if (!g) return '';
    const sus = g.suspended || [];
    const watch = g.watch || [];
    if (!sus.length && !watch.length) return '';
    const line = (x) => `<b>${esc(x.name)}</b> won ${p0(x.won)} of its last ${x.n} picks (they said ${p0(x.stated)})`;
    return `<div class="meas-note sp-guard">${sus.length ? `<b>Paused by the live guard.</b> ${sus.map((x) => `${line(x)}, so it gives no pick until ${esc(String(x.until || '').slice(0, 10))}`).join('; ')}. ` : ''}
      ${watch.length ? `Being watched: ${watch.map(line).join('; ')}.` : ''}</div>`;
  }

  /**
   * The day's safe slip as first published (lib/strongest/record.js slipFor), once one of its legs
   * has kicked off: the slip that was played, leg by leg, rather than one rebuilt from what is left.
   */
  function publishedCard(ps) {
    if (!ps || !ps.legs || !ps.legs.length) return '';
    const now = Date.now();
    if (!ps.legs.some((l) => Date.parse(l.kickoff) <= now) && ps.hit == null) return '';
    const st = ps.hit === 1 ? '<b class="pos">✓ Won</b>' : ps.hit === 0 ? '<b class="neg">✕ Lost</b>' : ps.result === 'void' ? 'void' : '<em class="muted-t">in play</em>';
    const mark = (l) => (l.hit === 1 ? '<b class="pos">✓</b>' : l.hit === 0 ? '<b class="neg">✕</b>' : l.result === 'void' ? 'void' : Date.parse(l.kickoff) <= now ? '<small>…</small>' : '<small>to play</small>');
    return `<div class="sp-slip s-safe s-published">
        <div class="sp-slip-h">
          <span class="sp-slip-t">Safe slip as published</span>
          <div class="sp-slip-f"><span>Chance</span><b>${p0(ps.prob)}</b></div>
          <div class="sp-slip-f"><span>Result</span><b class="sp-slip-st">${st}</b></div>
        </div>
        <div class="sp-slip-sub">Written down before its first kick-off (${esc(fmtTime(ps.recordedAt))}) and kept as it was · ${ps.size} legs · fair odds ${dec(ps.fairOdds)}</div>
        <ol class="sp-slip-legs">${ps.legs.map((l) => `<li><span>${esc(fmtTime(l.kickoff))}</span><span><b>${esc(l.label)}</b> <small>${esc(l.home)} v ${esc(l.away)}${l.result && l.result !== 'void' ? ` · ${esc(l.result)}` : ''}</small></span><span>${mark(l)}</span></li>`).join('')}</ol>
      </div>`;
  }

  /** The day's slips (lib/strongest/picks.js slips) with how slips built that way did. */
  function slipsBlock(list, cfg) {
    if (!list || !list.length) return '';
    const m = cfg && cfg.measured;
    const by = (m && m.slips && m.slips.bySize) || {};
    const sizes = Object.entries(by).sort((x, y) => Number(x[0]) - Number(y[0]));
    const card = slipCard;
    return `<div class="sec-title sp-sec">Slips from today's picks <span class="pill">${list.length}</span></div>
      <p class="muted-t sp-note">Picks come from different matches, so on one slip their chances <b>multiply</b>. Even ${p0(cfg.minChance || 0.88)} picks lose together fast:
        ten of them land only ${p0(Math.pow(cfg.minChance || 0.88, 10))} of the time. If you want to win often, keep slips short.</p>
      <div class="sp-slips">${list.map(card).join('')}</div>
      ${sizes.length ? `<details class="sp-more sp-bysize"><summary>How often a slip of N Strongest Picks landed on past matches</summary>
        <div class="bt-table sp-bt"><div class="bt-row head"><span>Picks on the slip</span><span>Match days</span><span>Landed</span><span>Stated</span></div>
        ${sizes.map(([k, v]) => `<div class="bt-row"><span>${esc(k)}</span><span>${v.n.toLocaleString('en-GB')}</span><span><b>${pct(v.landed, 1)}</b></span><span>${pct(v.stated, 1)}</span></div>`).join('')}</div>
        <p class="muted-t">${esc(m.window || '')}, strongest picks first. The odds always tell the truth: a slip at 2.0 odds cannot land much more than half the time, however strong its legs.</p></details>` : ''}`;
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
      <p class="muted-t sp-note">Close, but the measured chance or one view stays under the bar. Shown for information; not Strongest Picks.</p>
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

  /** The rule's measured record on held-out seasons (lib/strongest/models.json, research/v6). */
  function measuredBlock(cfg) {
    const m = cfg && cfg.measured;
    if (!m || !m.all) return '';
    const fams = Object.entries(m.families || {}).filter(([, v]) => v.n >= 30).sort((a, b) => b[1].n - a[1].n);
    return `<div class="sec-title sp-sec">Measured on past matches <span class="pill">${esc(m.window || '')}</span></div>
      <p class="muted-t sp-note">The same rules replayed on ${(m.matches || 0).toLocaleString('en-GB')} matches the models never saw (${esc(m.window || '')}), every pick settled on the real result${m.perMatchDay != null ? ` — about ${Math.round(m.perMatchDay)} picks a match day` : ''}${m.method ? ' (the replay rebuilds the bookmaker-anchored half of the rule; the site adds checks it cannot replay)' : ''}.
        A pick at ${p0(m.all.stated)} should win about ${p0(m.all.stated)} — and that is what happened: <b>${pct(m.all.hit, 1)}</b> of ${m.all.n.toLocaleString('en-GB')} won.
        Even so, roughly ${Math.round((1 - m.all.hit) * 100)} in 100 lose: a strong pick is not a certain one.</p>
      <div class="bt-table sp-bt sp-meas">
        <div class="bt-row head"><span>Market</span><span>Picks</span><span>Won</span><span>Stated</span></div>
        <div class="bt-row"><span><b>All Strongest Picks</b></span><span>${m.all.n.toLocaleString('en-GB')}</span><span><b>${pct(m.all.hit, 1)}</b></span><span>${pct(m.all.stated, 1)}</span></div>
        ${fams.map(([k, v]) => `<div class="bt-row"><span>${esc(v.label || k)}</span><span>${v.n.toLocaleString('en-GB')}</span><span>${pct(v.hit, 1)}</span><span>${pct(v.stated, 1)}</span></div>`).join('')}
      </div>`;
  }

  function recordBlock(r, cfg) {
    if (!r) return '';
    // the current rule's own record; picks chosen under earlier versions are listed apart
    const P = r.current || r.picks || {};
    const older = Object.entries(r.byRule || {}).filter(([k, v]) => k !== r.rule && v.n);
    const SL = r.slips || {};
    const tiers = (cfg.tiers || []).map((t) => {
      const s = (r.byTier || {})[t.name] || {};
      return `<div class="bt-row"><span><span class="sp-tier t-${tierCls(t.name)}">${esc(t.name)}</span> chance ${p0(t.min)}+</span><span>${s.n || 0}</span><span>${s.hitRate == null ? '—' : pct(s.hitRate, 1)}</span><span>${s.stated == null ? '—' : pct(s.stated, 1)}</span><span>${s.pending || 0}</span></div>`;
    }).join('');
    const groups = Object.entries(r.cards || {}).sort((a, b) => GROUPS.indexOf(a[0]) - GROUPS.indexOf(b[0]));
    return `<div class="sec-title sp-sec">Track record${r.rule ? ` · rule v${esc(r.rule)}` : ''} <span class="pill">${P.n || 0} settled</span></div>
      <div class="sumstrip sp-rec">
        <div class="ss-cell"><div class="v">${P.hitRate == null ? '—' : pct(P.hitRate, 1)}</div><div class="k">Strongest Picks won</div></div>
        <div class="ss-cell"><div class="v">${P.stated == null ? '—' : pct(P.stated, 1)}</div><div class="k">Average stated chance</div></div>
        <div class="ss-cell"><div class="v">${P.won || 0}/${P.n || 0}</div><div class="k">Won / settled</div></div>
        <div class="ss-cell"><div class="v">${SL.n ? `${SL.won}/${SL.n}` : '—'}</div><div class="k">${SL.n ? 'Safe slips landed' : 'Safe slips: none settled yet'}</div></div>
      </div>
      ${older.length ? `<p class="muted-t sp-note">Picks chosen under earlier versions of the rule are kept apart: ${older.map(([k, v]) => `v${esc(k)} ${v.won}/${v.n} won (${pct(v.hitRate, 1)}, stated ${pct(v.stated, 1)})`).join(' · ')}.</p>` : ''}
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
    // the tiers a pick can carry (at or above the list's bar)
    const listTiers = (cfg.tiers || []).filter((t) => t.min >= (cfg.minChance || 0) - 1e-9);
    const rec = d.record && (d.record.current || d.record.picks);
    const upcoming = (d.matches || []).filter((m) => !m.started);

    el.innerHTML = `<div class="m-intro sp-intro">
        <div class="sp-kicker">${esc(fmtDateLong(d.date || state.date))}</div>
        <h2>The strongest pick of each match</h2>
        <p>A pick is listed only when its <b>measured chance is ${p0(cfg.minChance || 0.88)} or better</b>: what picks like it actually won on past matches.
        Every independent view of the match has to agree, the bookmakers' price has to be behind it, and the league has to be one the rule was tested on.
        There is no fixed number: a weak day gives few picks.</p>
        <details class="sp-rules"><summary>How a pick qualifies</summary>
          <p class="muted-t">Each match is priced across nine market groups (goals, corners, halves, players, minutes, team goals, result, bookings, specials) by up to four views that do not share their inputs:
          the bookmakers' price, a stats model, the measured factors and a possession model (shots a game × goals per shot).</p>
          <ul class="rules">${(d.rules || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul></details>
      </div>
      <div class="sumstrip">
        <div class="ss-cell st-lock"><div class="v">${picks.length}</div><div class="k">Strongest Picks</div></div>
        <div class="ss-cell"><div class="v">${listTiers.map((t) => tierCount(t.name)).join(' · ')}</div><div class="k">${listTiers.map((t) => `${esc(t.name)} ${p0(t.min)}+`).join(' · ')}</div></div>
        <div class="ss-cell"><div class="v">${upcoming.length}</div><div class="k">Matches still to play</div></div>
        <div class="ss-cell"><div class="v">${rec && rec.hitRate != null ? pct(rec.hitRate, 0) : '—'}</div><div class="k">${rec && rec.n ? `Record: ${rec.won}/${rec.n} won` : 'Record starts today'}</div></div>
      </div>
      ${guardBlock(d.guard)}
      ${publishedCard(d.publishedSlip) ? `<div class="sp-slips sp-pub">${publishedCard(d.publishedSlip)}</div>` : ''}
      ${d.counts && d.counts.untested ? `<p class="muted-t sp-note">${d.counts.untested} upcoming match${d.counts.untested === 1 ? ' is' : 'es are'} in leagues the rule was never measured on, so ${d.counts.untested === 1 ? 'it gets' : 'they get'} no Strongest Pick. ${d.counts.untested === 1 ? 'Its' : 'Their'} markets still show on the match cards below.</p>` : ''}
      ${picks.length ? `<div class="sp-bar">
          <div class="filters sp-sort" role="group" aria-label="Sort picks">
            <button class="fchip ${SP.sort === 'strength' ? 'is-active' : ''}" data-sort="strength">Strongest first</button>
            <button class="fchip ${SP.sort === 'kickoff' ? 'is-active' : ''}" data-sort="kickoff">By kick-off</button>
          </div>
          <button class="sp-copy" id="spCopy">Copy picks</button>
        </div>
        <div class="sp-list">${picks.map((it, i) => pickCard(it, SP.sort === 'strength' ? i + 1 : null, cfg)).join('')}</div>
        ${slipsBlock(d.slips, cfg)}`
      : `<div class="empty sp-empty"><h3>No Strongest Pick ${upcoming.length ? 'yet' : 'today'}</h3>
          <p>${upcoming.length ? `None of the ${upcoming.length} upcoming matches has a selection with a measured chance of ${p0(cfg.minChance || 0.88)} that every view backs. That is the filter working: a weak day gives no picks rather than forced ones.` : 'No upcoming matches were analysed for this date.'}</p></div>`}
      ${earlierBlock(d.earlier)}
      ${nearBlock(d.nearMisses)}
      ${(d.matches || []).length ? `<div class="sec-title sp-sec">Every match · nine markets <span class="pill">${d.matches.length}</span></div>
        <p class="muted-t sp-note">The strongest selection of each market group for every match, with its chance and fair odds. ★ marks the match's Strongest Pick. Click a match for the full analysis.</p>
        <div class="filters sp-groups" role="group" aria-label="Market group">
          ${['all', ...GROUPS].map((g) => `<button class="fchip ${SP.group === g ? 'is-active' : ''}" data-group="${esc(g)}">${g === 'all' ? 'All nine' : esc(g)}</button>`).join('')}
        </div>
        <div class="sp-mgrid">${d.matches.map((mt) => matchCard(mt, cfg)).join('')}</div>` : ''}
      ${measuredBlock(cfg)}
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

  /** The day's Strongest Picks for other tabs (the High Banker leads with their safe slip). */
  window.strongestDay = function (force) {
    // a copy under five minutes old is used as it is; older, the server is asked again
    const fresh = SP.at && Date.now() - SP.at < 5 * 60 * 1000;
    if (!force && fresh && SP.data && SP.date === state.date && !SP.loading) return Promise.resolve(SP.data);
    return load(!!force, !force && !!SP.data && SP.date === state.date).then((d) => d || (SP.date === state.date ? SP.data : null));
  };
  window.strongestSlipCard = slipCard;
  window.strongestPublishedCard = publishedCard;

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
