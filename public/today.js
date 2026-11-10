'use strict';

/* ============================================================
   Sharpshooter — Today
   The first screen. One ticket shows the slip you choose, from the safest to the biggest odds:

     Safe slip            the strongest picks while the combined chance stays 75%+   (about 1.3)
     Methodology double   two picks that pass a methodology AND the normal prediction (about 1.5)
     Methodology treble   three of them                                               (about 1.9)
     2.0+ banker slip     the High Banker's safer slip
     3.0+ High Banker     the High Banker's main slip

   Each comes with its chance, its odds, how often slips built that way landed on past matches,
   and the lowest odds worth taking. Below: the day's methodology picks, the strongest picks and
   how the last days went.

   It reads what the other tabs already load: the Strongest Picks (public/strongest.js
   strongestDay) and the day's predictions (app.js loadPredictions: methodology picks, the
   accumulator, the High Banker). Uses app.js helpers ($, $$, esc, pct, dec, fmtTime, fmtDateLong,
   setView, setDate, openMatch, state).
   ============================================================ */

(function () {
  const TD = { date: null, sp: null, spErr: null, spLoading: false, predsLoading: false, seq: 0, choice: null, userOdds: {} };
  const p0 = (v) => (v == null ? '—' : Math.round(v * 100) + '%');
  const WEEKDAY = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  try { TD.choice = localStorage.getItem('ss-slip') || null; } catch { TD.choice = null; }

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
          if (state.view === 'today' && state.date === date && seq <= TD.seq) render(true);
        });
    }
    // methodology picks, the accumulator and the High Banker come with the day's predictions
    if ((!state.preds || state.preds.date !== date || force) && !TD.predsLoading && typeof loadPredictions === 'function') {
      TD.predsLoading = true;
      loadPredictions(!!force)
        .catch(() => null)
        .finally(() => {
          TD.predsLoading = false;
          if (state.view === 'today' && state.date === date) render(true);
        });
    }
  }

  const preds = () => (state.preds && state.preds.date === state.date ? state.preds : null);

  // ------------------------------------------------------------------ the day's slips, in one shape

  /**
   * Every slip of the day: { id, name, sub, legs:[{time, label, match, prob, hit, final, started}],
   * prob, odds, real (are the odds real prices?), takeAt, landed, landedN, state, view }.
   */
  function slipsOfDay(sp, pr) {
    const now = Date.now();
    const out = [];
    const stateOf = (legs, hit) => (hit === 1 ? 'won' : hit === 0 ? 'lost' : legs.some((l) => l.started) ? 'live' : 'open');

    // the safe slip: the published one once it has started, otherwise today's
    if (sp) {
      const pub = sp.publishedSlip && sp.publishedSlip.legs && sp.publishedSlip.legs.length ? sp.publishedSlip : null;
      const started = pub && (pub.hit != null || pub.legs.some((l) => Date.parse(l.kickoff) <= now));
      const live = (sp.slips || []).find((x) => x.id === 'safe');
      const sl = started ? pub : live || pub;
      const m = sp.config && sp.config.measured && sp.config.measured.slips && sp.config.measured.slips.safe;
      if (sl) {
        const legs = sl.legs.map((l) => ({ time: l.kickoff, label: l.label, match: `${l.home} v ${l.away}`, prob: l.prob, hit: l.hit == null ? null : l.hit, final: l.hit != null, result: l.result || null, started: Date.parse(l.kickoff) <= now }));
        out.push({
          id: 'safe', name: 'Safe slip', sub: started ? 'Published before the first kick-off and kept as it was.' : `The ${legs.length} strongest picks of the day. Short odds, lands most often.`,
          legs, prob: sl.prob, odds: sl.fairOdds, real: false, takeAt: sl.fairOdds, landed: m && m.landed, landedN: m && m.n, state: stateOf(legs, sl.hit), view: 'strongest',
        });
      }
    }
    // the methodology double and treble: the double-confirmed accumulator
    const acc = pr && pr.accumulator;
    for (const [size, id, name] of [[2, 'mdouble', 'Methodology double'], [3, 'mtreble', 'Methodology treble']]) {
      const op = acc && (acc.options || []).find((o) => o.size === size);
      if (!op || !op.legs || !op.legs.length) continue;
      const legs = op.legs.map((l) => ({
        time: l.kickoff, label: l.label, match: `${l.home} v ${l.away}`, prob: l.prob, method: l.methodology && l.methodology.name,
        hit: l.outcome && l.outcome.final ? l.outcome.hit : null, final: !!(l.outcome && l.outcome.final), started: Date.parse(l.kickoff) <= now,
      }));
      out.push({
        id, name, sub: `${size === 2 ? 'Two' : 'Three'} picks that pass a methodology and that the normal prediction also backs.`,
        legs, prob: op.prob, odds: op.bestOdds || op.fairOdds, real: !!op.bestOdds, takeAt: op.takeAt || op.fairOdds,
        landed: op.measured && op.measured.hit, landedN: op.measured && op.measured.n, roiBest: op.measured && op.measured.roiBest,
        state: op.outcome === 'won' ? 'won' : op.outcome === 'lost' ? 'lost' : stateOf(legs, null), view: 'acca',
      });
    }
    // the High Banker's two slips
    const bk = pr && pr.banker;
    const h = bk && bk.record && bk.record.heldOut;
    for (const [sl, id, m] of [[bk && bk.safer, 'banker2', h && h.safer], [bk && bk.slip, 'banker3', h && h.slip]]) {
      if (!sl || !sl.legs || !sl.legs.length) continue;
      const legs = sl.legs.map((l) => ({
        time: l.kickoff, label: l.label, match: `${l.home} v ${l.away}`, prob: l.prob,
        hit: l.outcome && l.outcome.final ? l.outcome.hit : null, final: !!(l.outcome && l.outcome.final), started: Date.parse(l.kickoff) <= now,
      }));
      const target = id === 'banker2' ? (sl.target || 2) : (bk.target || 3);
      out.push({
        id, name: `${dec(target, 1)}+ banker slip`, sub: `The most likely set of bankers that reaches ${dec(target, 1)} odds.`,
        legs, prob: sl.prob, odds: sl.odds, real: !sl.estimated, takeAt: sl.fairOdds, landed: m && m.hit, landedN: m && (m.slips || m.n),
        state: sl.outcome === 'won' ? 'won' : sl.outcome === 'lost' ? 'lost' : stateOf(legs, null), view: 'banker',
      });
    }
    // the lowest odds worth taking: the slip's own bar where it has one (the methodology slips),
    // otherwise 2% above the odds at which it only breaks even; rounded up, never down
    for (const s of out) {
      s.fair = 1 / s.prob;
      s.takeAt = Math.ceil(Math.max(s.takeAt || 0, s.fair * 1.02) * 100 - 1e-9) / 100;
    }
    return out.sort((a, b) => b.prob - a.prob);
  }

  /** The slip the ticket shows: the one last chosen if the day has it, else the methodology double, else the safest. */
  function chosen(slips) {
    return slips.find((s) => s.id === TD.choice) || slips.find((s) => s.id === 'mdouble') || slips[0] || null;
  }

  // ------------------------------------------------------------------ pieces

  function stamp(st) {
    if (st === 'won') return '<span class="stamp won" role="img" aria-label="Won">Won</span>';
    if (st === 'lost') return '<span class="stamp lost" role="img" aria-label="Lost">Lost</span>';
    return '';
  }

  const legMark = (l) => (l.hit === 1 ? '<b class="pos" aria-label="won">✓</b>' : l.hit === 0 ? '<b class="neg" aria-label="lost">✕</b>'
    : l.result === 'void' ? '<small>void</small>' : l.started ? '<small>playing</small>' : `<span>${p0(l.prob)}</span>`);

  /** "Is my bookmaker's price good enough?" — the verdict for the odds typed in. */
  function oddsVerdict(sl, typed) {
    const o = Number(typed);
    if (!(o > 1)) return '';
    const even = (Math.ceil(sl.fair * 100 - 1e-9) / 100).toFixed(2); // break-even odds, rounded up
    if (o >= sl.takeAt - 1e-9) return `<p class="tk-verdict good"><b>Good price.</b> At ${dec(o)} you are paid more than the risk: this slip breaks even at ${even} and is worth taking from ${dec(sl.takeAt)}.</p>`;
    if (o >= sl.fair - 1e-9) return `<p class="tk-verdict ok"><b>Fair, but only just.</b> At ${dec(o)} you about break even over time. Hold out for ${dec(sl.takeAt)} or better.</p>`;
    return `<p class="tk-verdict bad"><b>Too low — skip it.</b> At ${dec(o)} you lose money over time: this slip needs ${even} just to break even, and ${dec(sl.takeAt)} to be worth taking.</p>`;
  }

  function ticket(sl, sp) {
    if (!sl) {
      const one = sp && (sp.picks || []).length === 1 ? sp.picks[0] : null;
      return `<section class="ticket is-empty" aria-label="Slip">
        <header class="ticket-head"><div><h2>No slip ${state.date === todayISO() ? 'today' : 'on this day'}</h2>
          <p>${one ? `Only one pick clears the bar: <b>${esc(one.pick.label)}</b> (${esc(one.match.home.name)} v ${esc(one.match.away.name)}, ${p0(one.pick.prob)}).`
    : 'No two picks are strong enough to put on one slip. A day without a bet beats a forced one.'}</p>
          ${state.date >= todayISO() ? '<button class="btn btn-quiet" id="tdNext">Look at the next day</button>' : ''}</div></header>
      </section>`;
    }
    const started = sl.state !== 'open';
    const legs = sl.legs.map((l) => `<li>
        <span class="tk-t">${esc(fmtTime(l.time))}</span>
        <span class="tk-l"><b>${esc(l.label)}</b><small>${esc(l.match)}${l.method ? ` · ${esc(l.method)}` : ''}${l.result && l.result !== 'void' ? ` · ${esc(l.result)}` : ''}</small></span>
        <span class="tk-p">${legMark(l)}</span>
      </li>`).join('');
    const typed = TD.userOdds[sl.id] || '';
    return `<section class="ticket is-${sl.state}" aria-label="${esc(sl.name)}">
      <header class="ticket-head">
        <div><h2>${esc(sl.name)}</h2><p>${esc(sl.sub)}</p></div>
        <div class="ticket-chance"><b>${p0(sl.prob)}</b><span>chance all ${sl.legs.length} win</span></div>
      </header>
      <ol class="ticket-legs">${legs}</ol>
      <footer class="ticket-foot">
        <div><span>${sl.real ? 'Best odds seen' : 'Fair odds'}</span><b>${dec(sl.odds)}</b></div>
        ${sl.landed != null ? `<div><span>Slips like this landed</span><b>${pct(sl.landed, 0)}${sl.landedN ? ` <small>of ${Number(sl.landedN).toLocaleString('en-GB')} days</small>` : ''}</b></div>` : ''}
        ${started ? stamp(sl.state) : '<button class="btn" id="tdCopy">Copy slip</button>'}
      </footer>
      ${started ? '' : `<div class="ticket-check">
        <label for="tdOdds">Worth taking at <b>${dec(sl.takeAt)}</b> or better. Your bookmaker's odds for this slip:</label>
        <input id="tdOdds" type="number" inputmode="decimal" min="1.01" step="0.01" placeholder="${dec(sl.takeAt)}" value="${esc(typed)}" />
        <div id="tdVerdict">${oddsVerdict(sl, typed)}</div>
      </div>`}
    </section>`;
  }

  /** Choose the slip: safest first. A bar for the chance, so the trade is visible at a glance. */
  function chooser(slips, cur) {
    if (slips.length < 2) return '';
    return `<section class="td-block">
      <h3>Choose your slip</h3>
      <div class="td-ladder" role="radiogroup" aria-label="Choose your slip">${slips.map((r) => `<button class="td-rung ${cur && r.id === cur.id ? 'is-on' : ''}" role="radio" aria-checked="${cur && r.id === cur.id}" data-slip="${esc(r.id)}">
        <span class="td-r-name"><b>${esc(r.name)}</b><small>${r.legs.length} legs · odds ${r.real ? '' : 'about '}${dec(r.odds)}</small></span>
        <span class="td-r-bar" aria-hidden="true"><i style="width:${Math.max(4, Math.round(r.prob * 100))}%"></i></span>
        <span class="td-r-num"><b>${p0(r.prob)}</b>${r.landed != null ? `<small>landed ${pct(r.landed, 0)} in testing</small>` : ''}</span>
      </button>`).join('')}</div>
      <p class="td-note">Bigger odds always mean a smaller chance: a slip at 3.0 cannot land much more than 1 day in 3, however strong its legs.
        Very short odds are poor value too, because the bookmaker's margin eats most of the small profit. The methodology double sits in between.</p>
    </section>`;
  }

  /** The day's methodology picks: the ones the normal prediction also backs first. */
  function methodologyPicks(pr) {
    if (!pr) return `<section class="td-block"><h3>Methodology picks</h3><p class="td-note">Running the thirteen methodologies on the day's matches…</p></section>`;
    const acc = pr.accumulator || {};
    const confirmed = (acc.legs || []).map((l) => ({
      id: l.fixtureId, league: l.league, time: l.kickoff, label: l.label, match: `${l.home} v ${l.away}`, method: l.methodology && l.methodology.name,
      prob: l.prob, best: l.best || null, confirmed: true, outcome: l.outcome || null,
    }));
    const seen = new Set(confirmed.map((c) => String(c.id)));
    const rest = (pr.headline || [])
      .filter((h) => h.prediction && ['LOCK', 'PREDICT'].includes(h.prediction.status) && !seen.has(String(h.match.id)))
      .map((h) => ({
        id: h.match.id, league: h.match.league, time: h.match.date, label: h.prediction.pick.label, match: `${h.match.home.name} v ${h.match.away.name}`, method: h.prediction.name,
        prob: h.prediction.prob, best: h.prediction.price && h.prediction.price.best ? h.prediction.price.best.price || h.prediction.price.best : null, confirmed: false, outcome: h.outcome || null,
      }));
    const all = [...confirmed.sort((a, b) => b.prob - a.prob), ...rest.sort((a, b) => b.prob - a.prob)];
    if (!all.length) {
      return `<section class="td-block"><h3>Methodology picks</h3>
        <p class="td-note">No match ${state.date === todayISO() ? 'today' : 'on this day'} passes a methodology. The thirteen methodologies only speak when their rules are met.</p>
        <button class="btn btn-quiet" data-view="method">Read the methodology rules</button></section>`;
    }
    const mark = (o) => (o && o.final ? (o.hit === 1 ? '<b class="pos" aria-label="won">✓</b>' : o.hit === 0 ? '<b class="neg" aria-label="lost">✕</b>' : '') : '');
    const rows = all.slice(0, 6).map((it) => `<li><button class="td-pick td-pick-m" data-id="${esc(it.id)}" data-league="${esc(it.league)}" data-year="">
        <span class="tk-t">${esc(fmtTime(it.time))}</span>
        <span class="tk-l"><b>${esc(it.label)}</b><small>${esc(it.match)} · ${esc(it.method || '')}${it.confirmed ? '<em class="td-tag">double-confirmed</em>' : ''}</small></span>
        <span class="tk-p">${mark(it.outcome) || `<span>${p0(it.prob)}</span>`}${typeof it.best === 'number' && it.best > 1 ? `<small class="tk-odds">odds ${dec(it.best)}</small>` : ''}</span>
      </button></li>`).join('');
    return `<section class="td-block">
      <h3>Methodology picks</h3>
      <ol class="td-picks">${rows}</ol>
      <p class="td-note">${all.length} match${all.length === 1 ? '' : 'es'} pass a methodology${confirmed.length ? `; ${confirmed.length} ${confirmed.length === 1 ? 'is' : 'are'} <b>double-confirmed</b> (the normal prediction backs the same pick). On past matches double-confirmed picks won 72.5%, the ones the normal prediction disagreed with 66.6%.` : '.'}</p>
      <button class="btn btn-quiet" data-view="predictions">All methodology picks</button>
    </section>`;
  }

  /** How the last days went: picks won and lost as marks, and what became of each day's slips. */
  function lastDays(sp, pr) {
    const rec = (sp && sp.record) || {};
    const hist = new Map(((pr && pr.slipHistory) || []).map((d) => [d.day, d]));
    const byDay = new Map();
    for (const d of rec.daily || []) byDay.set(d.day, { ...d });
    for (const [day, h] of hist) byDay.set(day, { ...(byDay.get(day) || { day, picks: 0, won: 0, lost: 0, pending: 0, slip: null }), hist: h });
    const days = [...byDay.values()]
      .filter((d) => d.won + d.lost > 0 || (d.slip && d.slip.result !== 'pending') || (d.hist && Object.values(d.hist).some((v) => v === 'won' || v === 'lost')))
      .sort((a, b) => (a.day < b.day ? 1 : -1));
    const persist = rec.persist || {};
    const saved = persist.mode === 'token' || persist.mode === 'read';
    if (!days.length) {
      return `<section class="td-block">
        <h3>How the last days went</h3>
        <p class="td-note">No settled picks yet. Every pick and every slip is written down before kick-off and marked won or lost afterwards; the list fills from today.
        ${saved ? 'The record is saved automatically through the day, so a restart of the server does not wipe it.' : ''}</p>
      </section>`;
    }
    const cur = rec.current && rec.current.n ? rec.current : rec.picks || {};
    const tag = (label, r) => (r === 'won' ? `<span class="td-slip won">${label} won</span>` : r === 'lost' ? `<span class="td-slip lost">${label} lost</span>` : '');
    const row = (d) => {
      const marks = '<i class="m w"></i>'.repeat(Math.min(d.won, 14)) + '<i class="m l"></i>'.repeat(Math.min(d.lost, 14)) + (d.pending ? '<i class="m p"></i>'.repeat(Math.min(d.pending, 6)) : '');
      const h = d.hist || {};
      const slips = [d.slip ? tag('safe slip', d.slip.result) : '', tag('methodology double', h.double), tag('treble', h.treble), tag('2.0 slip', h.banker2), tag('3.0 slip', h.banker3)].filter(Boolean).join('');
      return `<li><button class="td-day" data-day="${esc(d.day)}"><span class="td-d">${esc(WEEKDAY(d.day))}</span><span class="td-marks" aria-hidden="true">${marks}</span><span class="td-score">${d.won + d.lost ? `${d.won} of ${d.won + d.lost} won` : ''}</span>${slips ? `<span class="td-slips">${slips}</span>` : ''}</button></li>`;
    };
    return `<section class="td-block">
      <h3>How the last days went</h3>
      <ul class="td-days">${days.slice(0, 7).map(row).join('')}</ul>
      <p class="td-note">${cur.n ? `Strongest picks so far: <b>${cur.won} of ${cur.n} won</b> (${pct(cur.hitRate, 0)}, they said ${pct(cur.stated, 0)}). ` : ''}A green mark is a strongest pick that won, a red one a pick that lost.
        ${saved ? '' : ' This record lives on the server\'s disk and restarts when the host does.'}</p>
    </section>`;
  }

  function picksList(sp) {
    const picks = (sp && sp.picks) || [];
    const earlier = (sp && sp.earlier) || [];
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
      <h3>Strongest picks</h3>
      ${settled ? `<p class="td-note td-note-top">Already played: <b>${won} of ${settled} won</b>.</p>` : ''}
      <ol class="td-picks">${rows}${done}</ol>
      <p class="td-note">Measured chance of 88% or better. They pay very little one by one (about 1.08 to 1.14), so use them as legs of a slip, not as single bets.</p>
      ${picks.length ? `<button class="btn btn-quiet" data-view="strongest">${picks.length > 5 ? `See all ${picks.length} strongest picks and why` : 'See the reasons behind each pick'}</button>` : ''}
    </section>`;
  }

  function guardLine(sp) {
    const g = sp && sp.guard;
    if (!g) return '';
    const sus = g.suspended || [];
    if (!sus.length) {
      return `<p class="td-guard ok"><b>Live guard: all clear.</b> ${g.checked ? `${g.checked.toLocaleString('en-GB')} settled picks checked against what they promised.` : 'It starts checking as soon as picks are settled.'}</p>`;
    }
    return `<p class="td-guard warn"><b>Live guard:</b> ${sus.map((s) => `${esc(s.name)} is paused until ${esc(WEEKDAY(s.until))} (won ${p0(s.won)} of its last ${s.n}, said ${p0(s.stated)})`).join('; ')}. Its picks are left out until it recovers.</p>`;
  }

  function copyText(sl) {
    const lines = [`Sharpshooter ${sl.name.toLowerCase()} — ${fmtDateLong(state.date)}`];
    for (const l of sl.legs) lines.push(`${fmtTime(l.time)} ${l.match}: ${l.label} (${p0(l.prob)})`);
    lines.push(`Chance all ${sl.legs.length} win: ${p0(sl.prob)} · take at ${dec(sl.takeAt)} or better`);
    lines.push('A chance, not a promise. 18+.');
    return lines.join('\n');
  }

  // ------------------------------------------------------------------ the page

  function render(keepTyping) {
    const el = $('#board');
    if (!el || state.view !== 'today') return;
    // a background refresh must not pull the odds box from under the thumb
    const ae = document.activeElement;
    if (keepTyping && ae && ae.id === 'tdOdds') return;
    const sp = TD.sp && TD.date === state.date ? TD.sp : null;
    const pr = preds();
    const isToday = state.date === todayISO();
    const title = isToday ? 'Today\'s best bets' : fmtDateLong(state.date);
    if (!sp && !pr) {
      el.innerHTML = `<div class="td">
        <header class="td-head"><h1>${esc(title)}</h1></header>
        ${TD.spErr ? `<div class="err-box"><strong>The picks could not be loaded.</strong><br>${esc(TD.spErr.message || TD.spErr)}<br>Check your connection and tap the refresh button.</div>`
    : `<section class="ticket is-loading" aria-busy="true"><header class="ticket-head"><div><h2>Today's slip</h2><p>Working out the day's picks. The first visit of the day takes up to a minute.</p></div></header>
          <ol class="ticket-legs"><li class="sk"></li><li class="sk"></li><li class="sk"></li></ol></section>`}
      </div>`;
      return;
    }
    const slips = slipsOfDay(sp, pr);
    const cur = chosen(slips);
    const picks = (sp && sp.picks) || [];
    const c = (sp && sp.counts) || {};
    const nMeth = pr ? (pr.headline || []).filter((h) => h.prediction && ['LOCK', 'PREDICT'].includes(h.prediction.status)).length : null;
    const checked = c.priced != null ? c.priced : pr ? pr.analysable : null;
    el.innerHTML = `<div class="td">
      <header class="td-head">
        <h1>${esc(title)}</h1>
        <p>${[nMeth != null ? `${nMeth} methodology pick${nMeth === 1 ? '' : 's'}` : null, sp ? `${picks.length} strongest pick${picks.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' and ')}${checked != null ? ` from ${checked} matches checked` : ''}${c.withPrice != null ? ` (${c.withPrice} with a bookmaker price)` : ''}.</p>
      </header>
      <div class="td-grid">
        <div class="td-main">
          ${ticket(cur, sp)}
          ${chooser(slips, cur)}
          ${methodologyPicks(pr)}
        </div>
        <div class="td-side">
          ${lastDays(sp, pr)}
          ${picksList(sp)}
          ${guardLine(sp)}
        </div>
      </div>
      <p class="td-foot">Every chance here was measured on past matches. A slip that lands 2 days in 3 still loses the third, so bet small, and only what you can afford to lose. 18+.</p>
    </div>`;

    $$('.td-pick[data-id]', el).forEach((b) => b.addEventListener('click', () => openMatch(b.dataset.id, b.dataset.league, b.dataset.year)));
    $$('[data-view]', el).forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    $$('.td-day', el).forEach((b) => b.addEventListener('click', () => { if (b.dataset.day) setDate(b.dataset.day); }));
    $$('[data-slip]', el).forEach((b) => b.addEventListener('click', () => {
      TD.choice = b.dataset.slip;
      try { localStorage.setItem('ss-slip', TD.choice); } catch { /* private window */ }
      render();
      const t = $('.ticket', el);
      if (t && t.scrollIntoView) t.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }));
    const inp = $('#tdOdds', el);
    if (inp && cur) {
      inp.addEventListener('input', () => {
        TD.userOdds[cur.id] = inp.value;
        const v = $('#tdVerdict', el);
        if (v) v.innerHTML = oddsVerdict(cur, inp.value);
      });
    }
    const nx = $('#tdNext', el);
    if (nx) nx.addEventListener('click', () => setDate(shiftDate(state.date, 1)));
    const cp = $('#tdCopy', el);
    if (cp && cur) {
      cp.addEventListener('click', () => {
        const text = copyText(cur);
        const done = () => { cp.textContent = 'Copied'; setTimeout(() => { cp.textContent = 'Copy slip'; }, 1800); };
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => {});
      });
    }
    if (typeof setStatus === 'function' && sp) setStatus(`${picks.length + (nMeth || 0)} picks · ${checked || 0} matches`, (sp.cache && sp.cache.refreshing) || (pr && pr.cache && pr.cache.refreshing) ? 'busy' : 'ok');
  }

  /** Called by app.js when the view is shown, the date changes or Refresh is pressed. */
  window.renderToday = function (force) {
    if (TD.date !== state.date) {
      TD.sp = null;
      TD.spErr = null;
    }
    render(!force);
    load(!!force);
  };
})();
