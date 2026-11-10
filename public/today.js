'use strict';

/* ============================================================
   Sharpshooter — Today
   The first screen: the day's safe slip as a ticket, the banker of the day, how the last days
   went, the ladder of bigger slips and the day's picks. It reads what the other tabs already
   load: the Strongest Picks (public/strongest.js strongestDay) and the day's predictions
   (app.js loadPredictions, for the High Banker slips). Loaded after app.js, strongest.js and
   banker.js; uses their helpers ($, $$, esc, pct, dec, fmtTime, fmtDateLong, setView, state).
   ============================================================ */

(function () {
  const TD = { date: null, sp: null, spErr: null, spLoading: false, predsLoading: false, seq: 0 };
  const p0 = (v) => (v == null ? '—' : Math.round(v * 100) + '%');
  const WEEKDAY = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

  function load(force) {
    const date = state.date;
    if (TD.date !== date) {
      TD.date = date;
      TD.sp = null;
      TD.spErr = null;
    }
    const seq = ++TD.seq;
    if (typeof window.strongestDay === 'function' && (!TD.spLoading || force)) {
      TD.spLoading = true;
      window.strongestDay(!!force)
        .then((d) => {
          if (state.date !== date) return;
          TD.sp = d || TD.sp;
          TD.spErr = null;
        })
        .catch((err) => { if (state.date === date) TD.spErr = err; })
        .finally(() => {
          TD.spLoading = false;
          if (state.view === 'today' && state.date === date && seq <= TD.seq) render();
        });
    }
    // the High Banker slips come with the day's predictions
    if ((!state.preds || state.preds.date !== date || force) && !TD.predsLoading && typeof loadPredictions === 'function') {
      TD.predsLoading = true;
      loadPredictions(!!force)
        .catch(() => null)
        .finally(() => {
          TD.predsLoading = false;
          if (state.view === 'today' && state.date === date) render();
        });
    }
  }

  // ------------------------------------------------------------------ pieces

  function stamp(hit, result) {
    if (hit === 1) return '<span class="stamp won" role="img" aria-label="Won">Won</span>';
    if (hit === 0) return '<span class="stamp lost" role="img" aria-label="Lost">Lost</span>';
    if (result === 'void') return '<span class="stamp void">Void</span>';
    return '';
  }

  const legMark = (l, now) => (l.hit === 1 ? '<b class="pos" aria-label="won">✓</b>' : l.hit === 0 ? '<b class="neg" aria-label="lost">✕</b>'
    : l.result === 'void' ? '<small>void</small>' : Date.parse(l.kickoff) <= now ? '<small>playing</small>' : `<span>${p0(l.prob)}</span>`);

  /** The safe slip as a ticket: the published one once it has started, otherwise today's. */
  function ticket(sp) {
    const now = Date.now();
    const pub = sp.publishedSlip && sp.publishedSlip.legs && sp.publishedSlip.legs.length ? sp.publishedSlip : null;
    const started = pub && (pub.hit != null || pub.legs.some((l) => Date.parse(l.kickoff) <= now));
    const live = (sp.slips || []).find((x) => x.id === 'safe');
    const sl = started ? pub : live || pub;
    const meas = sp.config && sp.config.measured && sp.config.measured.slips && sp.config.measured.slips.safe;
    const picks = sp.picks || [];
    if (!sl) {
      const one = picks.length === 1 ? picks[0] : null;
      return `<section class="ticket is-empty" aria-label="Safe slip">
        <header class="ticket-head"><div><h2>No safe slip ${state.date === todayISO() ? 'today' : 'on this day'}</h2>
          <p>${one ? `Only one pick clears the bar: <b>${esc(one.pick.label)}</b> (${esc(one.match.home.name)} v ${esc(one.match.away.name)}, ${p0(one.pick.prob)}). Play it on its own or wait for tomorrow.`
    : 'A safe slip needs two picks at ' + p0((sp.config && sp.config.minChance) || 0.88) + ' or better, and today has none. A day without a bet beats a forced one.'}</p></div></header>
      </section>`;
    }
    const legs = sl.legs.map((l) => `<li>
        <span class="tk-t">${esc(fmtTime(l.kickoff))}</span>
        <span class="tk-l"><b>${esc(l.label)}</b><small>${esc(l.home)} v ${esc(l.away)}${l.result && l.result !== 'void' ? ` · ${esc(l.result)}` : ''}</small></span>
        <span class="tk-p">${legMark(l, now)}</span>
      </li>`).join('');
    const state_ = started ? (sl.hit === 1 ? 'won' : sl.hit === 0 ? 'lost' : 'live') : 'open';
    return `<section class="ticket is-${state_}" aria-label="Safe slip">
      <header class="ticket-head">
        <div><h2>Safe slip</h2>
          <p>${started ? 'Published before the first kick-off and kept as it was.' : `The ${sl.legs.length} strongest picks of the day on one slip.`}</p></div>
        <div class="ticket-chance"><b>${p0(sl.prob)}</b><span>chance all ${sl.legs.length} win</span></div>
      </header>
      <ol class="ticket-legs">${legs}</ol>
      <footer class="ticket-foot">
        <div><span>Fair odds</span><b>${dec(sl.fairOdds)}</b></div>
        ${meas && meas.n ? `<div><span>Slips like this landed</span><b>${pct(meas.landed, 0)} <small>of ${meas.n.toLocaleString('en-GB')} days</small></b></div>` : ''}
        ${started ? stamp(sl.hit, sl.result) : '<button class="btn" id="tdCopy">Copy slip</button>'}
      </footer>
    </section>`;
  }

  function bankerOfDay(sp) {
    const top = (sp.picks || [])[0];
    if (!top) return '';
    const m = top.match;
    const s = top.pick;
    const one = sp.config && sp.config.measured && sp.config.measured.slips && sp.config.measured.slips.bySize && sp.config.measured.slips.bySize['1'];
    return `<section class="td-block">
      <h3>Banker of the day</h3>
      <button class="td-banker" data-id="${esc(m.id)}" data-league="${esc(m.league)}" data-year="${esc(m.seasonYear || '')}">
        <span class="td-b-main"><b>${esc(s.label)}</b><small>${esc(fmtTime(m.date))} · ${esc(m.home.name)} v ${esc(m.away.name)} · ${esc(m.leagueName)}</small></span>
        <span class="td-b-num"><b>${p0(s.prob)}</b><small>fair ${dec(s.fair)}</small></span>
      </button>
      <p class="td-note">The single strongest pick of the day${one && one.n ? `: on past matches the day's top pick won <b>${pct(one.landed, 0)}</b> of ${one.n.toLocaleString('en-GB')} days` : ''}. Short odds, and it still loses about 1 time in ${one && one.landed < 1 ? Math.max(2, Math.round(1 / (1 - one.landed))) : 12}.</p>
    </section>`;
  }

  /** How the last days went: picks won and lost as marks, and the safe slip's result. */
  function lastDays(sp) {
    const rec = sp.record || {};
    const days = (rec.daily || []).filter((d) => d.won + d.lost > 0 || (d.slip && d.slip.result !== 'pending'));
    const persist = rec.persist || {};
    const saved = persist.mode === 'token' || persist.mode === 'read';
    if (!days.length) {
      return `<section class="td-block">
        <h3>How the last days went</h3>
        <p class="td-note">No settled picks yet. Every pick and the safe slip are written down before kick-off and marked won or lost afterwards; the list fills from today.
        ${saved ? 'The record is saved every ten minutes, so a restart of the server does not lose it.' : ''}</p>
      </section>`;
    }
    const cur = rec.current && rec.current.n ? rec.current : rec.picks || {};
    const SL = rec.slips || {};
    const row = (d) => {
      const marks = '<i class="m w"></i>'.repeat(Math.min(d.won, 14)) + '<i class="m l"></i>'.repeat(Math.min(d.lost, 14)) + (d.pending ? '<i class="m p"></i>'.repeat(Math.min(d.pending, 6)) : '');
      const slip = d.slip ? (d.slip.result === 'won' ? '<span class="td-slip won">slip won</span>' : d.slip.result === 'lost' ? '<span class="td-slip lost">slip lost</span>' : d.slip.result === 'pending' ? '<span class="td-slip">slip running</span>' : '') : '';
      return `<li><button class="td-day" data-day="${esc(d.day)}"><span class="td-d">${esc(WEEKDAY(d.day))}</span><span class="td-marks" aria-hidden="true">${marks}</span><span class="td-score">${d.won} of ${d.won + d.lost} won</span>${slip}</button></li>`;
    };
    return `<section class="td-block">
      <h3>How the last days went</h3>
      <ul class="td-days">${days.slice(0, 7).map(row).join('')}</ul>
      <p class="td-note">${cur.n ? `Picks so far: <b>${cur.won} of ${cur.n} won</b> (${pct(cur.hitRate, 0)}, they said ${pct(cur.stated, 0)}).` : ''}
        ${SL.n ? ` Safe slips: <b>${SL.won} of ${SL.n} landed</b>.` : ''} A green mark is a pick that won, a red one a pick that lost.
        ${saved ? '' : ' This record lives on the server\'s disk and restarts when the host does.'}</p>
    </section>`;
  }

  /** The ladder: the bigger the odds, the smaller the chance. One row per slip, a bar for its chance. */
  function ladder(sp) {
    const rows = [];
    const meas = (sp.config && sp.config.measured && sp.config.measured.slips) || {};
    const slipOf = (id) => (sp.slips || []).find((x) => x.id === id);
    const safe = slipOf('safe');
    const long = slipOf('long');
    if (safe) rows.push({ name: 'Safe slip', legs: safe.size, odds: safe.fairOdds, prob: safe.prob, landed: meas.safe && meas.safe.landed, view: 'strongest', est: true });
    if (long) rows.push({ name: 'Longer slip', legs: long.size, odds: long.fairOdds, prob: long.prob, landed: meas.long && meas.long.landed, view: 'strongest', est: true });
    const bk = state.preds && state.preds.date === state.date ? state.preds.banker : null;
    const h = bk && bk.record && bk.record.heldOut;
    if (bk && bk.safer && bk.safer.legs && bk.safer.legs.length) rows.push({ name: `${dec(bk.safer.target || 2, 1)}+ banker slip`, legs: bk.safer.size, odds: bk.safer.odds, prob: bk.safer.prob, landed: h && h.safer && h.safer.hit, view: 'banker' });
    if (bk && bk.slip && bk.slip.legs && bk.slip.legs.length) rows.push({ name: `${dec(bk.target || 3, 1)}+ High Banker`, legs: bk.slip.size, odds: bk.slip.odds, prob: bk.slip.prob, landed: h && h.slip && h.slip.hit, view: 'banker' });
    if (rows.length < 2) return '';
    return `<section class="td-block">
      <h3>Bigger odds, smaller chance</h3>
      <div class="td-ladder" role="list">${rows.map((r) => `<button class="td-rung" role="listitem" data-view="${r.view}">
        <span class="td-r-name"><b>${esc(r.name)}</b><small>${r.legs} legs · odds ${r.est ? 'about ' : ''}${dec(r.odds)}</small></span>
        <span class="td-r-bar" aria-hidden="true"><i style="width:${Math.max(4, Math.round(r.prob * 100))}%"></i></span>
        <span class="td-r-num"><b>${p0(r.prob)}</b>${r.landed != null ? `<small>landed ${pct(r.landed, 0)} in testing</small>` : ''}</span>
      </button>`).join('')}</div>
      <p class="td-note">Odds tell the truth about the chance: a slip at 3.0 cannot land much more than 1 day in 3, however strong its legs. To win most days, stay near the top of this list.</p>
    </section>`;
  }

  function picksList(sp) {
    const picks = sp.picks || [];
    const earlier = sp.earlier || [];
    if (!picks.length && !earlier.length) return '';
    const rows = picks.slice(0, 5).map((it) => `<li><button class="td-pick" data-id="${esc(it.match.id)}" data-league="${esc(it.match.league)}" data-year="${esc(it.match.seasonYear || '')}">
        <span class="tk-t">${esc(fmtTime(it.match.date))}</span>
        <span class="tk-l"><b>${esc(it.pick.label)}</b><small>${esc(it.match.home.name)} v ${esc(it.match.away.name)} · ${esc(it.match.leagueName)}</small></span>
        <span class="tk-p"><span>${p0(it.pick.prob)}</span></span>
      </button></li>`).join('');
    // picks whose matches have kicked off: kept as they were published, with their result
    const done = earlier.slice(0, Math.max(0, 8 - Math.min(5, picks.length))).map((e) => `<li><div class="td-pick is-done">
        <span class="tk-t">${esc(fmtTime(e.date))}</span>
        <span class="tk-l"><b>${esc(e.label)}</b><small>${esc(e.home)} v ${esc(e.away)}${e.result && e.result !== 'void' ? ` · ${esc(e.result)}` : ''}</small></span>
        <span class="tk-p">${e.hit === 1 ? '<b class="pos" aria-label="won">✓</b>' : e.hit === 0 ? '<b class="neg" aria-label="lost">✕</b>' : e.result === 'void' ? '<small>void</small>' : '<small>playing</small>'}</span>
      </div></li>`).join('');
    const won = earlier.filter((e) => e.hit === 1).length;
    const settled = earlier.filter((e) => e.hit === 1 || e.hit === 0).length;
    return `<section class="td-block">
      <h3>${state.date === todayISO() ? 'Today\'s' : 'The day\'s'} strongest picks</h3>
      ${settled ? `<p class="td-note td-note-top">Already played: <b>${won} of ${settled} won</b>.</p>` : ''}
      <ol class="td-picks">${rows}${done}</ol>
      ${picks.length ? `<button class="btn btn-quiet" data-view="strongest">${picks.length > 5 ? `See all ${picks.length} picks and why` : 'See the reasons behind each pick'}</button>` : ''}
    </section>`;
  }

  function guardLine(sp) {
    const g = sp.guard;
    if (!g) return '';
    const sus = g.suspended || [];
    if (!sus.length) {
      return `<p class="td-guard ok"><b>Live guard: all clear.</b> ${g.checked ? `${g.checked.toLocaleString('en-GB')} settled picks checked against what they promised.` : 'It starts checking as soon as picks are settled.'}</p>`;
    }
    return `<p class="td-guard warn"><b>Live guard:</b> ${sus.map((s) => `${esc(s.name)} is paused until ${esc(WEEKDAY(s.until))} (won ${p0(s.won)} of its last ${s.n}, said ${p0(s.stated)})`).join('; ')}. Its picks are left out until it recovers.</p>`;
  }

  function copyText(sl) {
    const lines = [`Sharpshooter safe slip — ${fmtDateLong(state.date)}`];
    for (const l of sl.legs) lines.push(`${fmtTime(l.kickoff)} ${l.home} v ${l.away}: ${l.label} (${p0(l.prob)})`);
    lines.push(`Chance all ${sl.legs.length} win: ${p0(sl.prob)} · fair odds ${dec(sl.fairOdds)}`);
    lines.push('A chance, not a promise. 18+.');
    return lines.join('\n');
  }

  // ------------------------------------------------------------------ the page

  function render() {
    const el = $('#board');
    if (!el || state.view !== 'today') return;
    const sp = TD.sp && TD.date === state.date ? TD.sp : null;
    const isToday = state.date === todayISO();
    const title = isToday ? 'Today\'s safest bets' : fmtDateLong(state.date);
    if (!sp) {
      el.innerHTML = `<div class="td">
        <header class="td-head"><h1>${esc(title)}</h1></header>
        ${TD.spErr ? `<div class="err-box"><strong>The picks could not be loaded.</strong><br>${esc(TD.spErr.message || TD.spErr)}<br>Check your connection and tap the refresh button.</div>`
    : `<section class="ticket is-loading" aria-busy="true"><header class="ticket-head"><div><h2>Safe slip</h2><p>Working out the day's picks. The first visit of the day takes up to a minute.</p></div></header>
          <ol class="ticket-legs"><li class="sk"></li><li class="sk"></li><li class="sk"></li></ol></section>`}
      </div>`;
      return;
    }
    const picks = sp.picks || [];
    const c = sp.counts || {};
    el.innerHTML = `<div class="td">
      <header class="td-head">
        <h1>${esc(title)}</h1>
        <p>${picks.length ? `${picks.length} pick${picks.length === 1 ? '' : 's'} with a measured chance of ${p0((sp.config && sp.config.minChance) || 0.88)} or better, from ${c.priced || 0} matches checked` : `${c.priced || 0} matches checked`}${c.withPrice != null ? ` (${c.withPrice} with a bookmaker price)` : ''}.</p>
      </header>
      <div class="td-grid">
        <div class="td-main">
          ${ticket(sp)}
          ${bankerOfDay(sp)}
          ${ladder(sp)}
        </div>
        <div class="td-side">
          ${lastDays(sp)}
          ${picksList(sp)}
          ${guardLine(sp)}
        </div>
      </div>
      <p class="td-foot">A pick at 90% still loses 1 time in 10, and every extra pick on a slip is one more way to lose it. Bet small, and only what you can afford to lose. 18+.</p>
    </div>`;

    $$('.td-banker, .td-pick', el).forEach((b) => b.addEventListener('click', () => openMatch(b.dataset.id, b.dataset.league, b.dataset.year)));
    $$('[data-view]', el).forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    $$('.td-day', el).forEach((b) => b.addEventListener('click', () => { if (b.dataset.day) setDate(b.dataset.day); }));
    const cp = $('#tdCopy', el);
    if (cp) {
      cp.addEventListener('click', () => {
        const sl = (sp.slips || []).find((x) => x.id === 'safe');
        if (!sl) return;
        const text = copyText(sl);
        const done = () => { cp.textContent = 'Copied'; setTimeout(() => { cp.textContent = 'Copy slip'; }, 1800); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => {});
      });
    }
    if (typeof setStatus === 'function') setStatus(`${picks.length} pick${picks.length === 1 ? '' : 's'} · ${c.priced || 0} matches checked`, sp.cache && sp.cache.refreshing ? 'busy' : 'ok');
  }

  /** Called by app.js when the view is shown, the date changes or Refresh is pressed. */
  window.renderToday = function (force) {
    if (TD.date !== state.date) {
      TD.sp = null;
      TD.spErr = null;
    }
    render();
    load(!!force);
  };
})();
