/* ============================================================
   Sharpshooter — High Banker tab
   The day's safest selections (every check passed) and the most likely slip that reaches
   3.0+ odds. Data: state.preds.banker (lib/banker.js via /api/predictions, kept in the day
   database). Uses app.js helpers (esc, pct, dec, fmtTime, mark, scoreTag, openMatch...).
   ============================================================ */

(function () {
  'use strict';

  const CHECK = {
    data: 'Data', strength: 'Strength', trap: 'No trap', agrees: 'Agrees', trends: 'Trends', price: 'Price', live: 'Live',
  };
  const CHECK_LONG = {
    data: 'Real bookmaker price, enough history, league match',
    strength: 'Model and bookmakers both rate it very likely',
    trap: 'Factors do not rate it below the price; not on the avoid list',
    agrees: 'Same view as the normal prediction for the match',
    trends: 'No red flag in form, venue form, scoring trends, head-to-head or patterns',
    price: 'Still pays something',
    live: 'Not started, no confirmed absence, price not drifting',
  };
  const OUT = { won: ['Won', 'won'], lost: ['Lost', 'lost'], live: ['In play', 'live'], void: ['Void', 'void'], pending: ['To play', 'pending'] };

  const TIERS = [[0.85, 'Elite', 't-elite'], [0.8, 'Strong', 't-strong'], [0, 'Solid', 't-solid']];
  const tierOf = (p) => TIERS.find((t) => p >= t[0]);

  function legMatch(l) {
    const m = typeof liveFixture === 'function' ? liveFixture(l.fixtureId) : null;
    return m && m.state && m.state !== 'pre' ? m : null;
  }

  function checksRow(l) {
    return `<div class="bk-checks">${(l.checks || []).map((c) => `<span class="bk-chk ${c.ok ? 'ok' : 'no'}" title="${esc(CHECK_LONG[c.id] || c.id)}: ${esc(c.text)}">${c.ok ? '✓' : '✕'} ${esc(CHECK[c.id] || c.id)}</span>`).join('')}${l.tripleConfirmed ? '<span class="bk-chk tri" title="A market methodology also qualifies it">★ Methodology</span>' : ''}</div>`;
  }

  function whyList(l) {
    const rows = (l.checks || []).map((c) => `<li class="${c.ok ? 'ok' : 'no'}"><b>${esc(CHECK[c.id] || c.id)}</b> ${esc(c.text)}</li>`);
    if (l.methods && l.methods.length) rows.push(`<li class="ok"><b>Methodology</b> also qualifies under ${esc(l.methods.map((m) => m.name || m.id).join(', '))}</li>`);
    return `<details class="bk-why"><summary>Why it is a banker</summary><ul>${rows.join('')}</ul></details>`;
  }

  function legCard(l, i) {
    const m = legMatch(l);
    const o = l.outcome;
    const tr = tierOf(l.prob || 0);
    return `<div class="bk-leg ${tr[2]} ${o && o.final ? (o.hit === 1 ? 'is-won' : o.hit === 0 ? 'is-lost' : '') : ''}" data-id="${esc(l.fixtureId)}" data-league="${esc(l.league)}">
      <div class="bk-n">${i + 1}</div>
      <div class="bk-body">
        <div class="bk-meta"><span>${esc(fmtTime(l.kickoff))}</span><span>${esc(l.leagueName || l.league || '')}</span>${m ? scoreTag(m) : ''}</div>
        <div class="bk-match">${esc(l.home)} <span>v</span> ${esc(l.away)}</div>
        <div class="bk-pick"><b>${esc(l.label)}</b>${o ? ' ' + mark(o.hit, o.final) : ''}</div>
        <div class="bk-views">Model <b>${pct(l.prob, 0)}</b> · Bookmakers <b>${l.base != null ? pct(l.base, 0) : '—'}</b> · ${l.agreement === 'main' ? 'the normal main pick' : 'safer form of the normal main pick'}</div>
        ${checksRow(l)}
        ${whyList(l)}
      </div>
      <div class="bk-price"><span>${l.estimated ? 'odds ≈' : 'odds'}</span><b>${dec(l.odds)}</b><small>${pct(l.prob, 0)} chance</small><em class="bk-tier">${tr[1]}</em></div>
    </div>`;
  }

  function slipCard(s, title, sub) {
    const st = s.outcome && OUT[s.outcome] && s.outcome !== 'pending' ? OUT[s.outcome] : null;
    return `<div class="bk-slip ${s.outcome === 'won' ? 'is-won' : s.outcome === 'lost' ? 'is-lost' : ''}">
      <div class="bk-slip-h">
        <div class="bk-slip-t"><span class="bk-badge">${esc(title)}</span>${st ? ` <span class="bk-state ${st[1]}">${st[0]}</span>` : ''}<div class="bk-slip-sub">${esc(sub)}</div></div>
        <div class="bk-fig"><span>Total odds</span><b>${s.estimated ? '≈' : ''}${dec(s.odds)}</b></div>
        <div class="bk-fig"><span>Chance</span><b>${pct(s.prob, 0)}</b></div>
      </div>
      <div class="bk-legs">${s.legs.map(legCard).join('')}</div>
      <div class="bk-slip-f">Fair odds ${dec(s.fairOdds)} · ${s.value >= 0 ? `<span class="pos">${signed(s.value * 100, 1)}% value at these odds</span>` : `<span class="neg">${signed(s.value * 100, 1)}% below fair at these odds</span>`}${s.estimated ? ' · ≈ marks an odds estimate where no bookmaker price was quoted: check your bookmaker' : ''}</div>
    </div>`;
  }

  function biggerBlock(list, measured) {
    if (!list || !list.length) return '';
    return `<div class="sec-title bk-sec">Want bigger odds? <span class="pill">${list.length}</span></div>
      <p class="muted-t bk-near-p">Built from today's bankers only — the most likely way to each target. More legs, bigger odds, smaller chance: the chance shown is the honest one.</p>
      <div class="bk-bigger">${list.map((o) => {
        const m = measured && measured[String(o.target)];
        const st = o.outcome && OUT[o.outcome] && o.outcome !== 'pending' ? OUT[o.outcome] : null;
        return `<details class="bk-big ${o.outcome === 'won' ? 'is-won' : o.outcome === 'lost' ? 'is-lost' : ''}"><summary>
          <span class="bk-big-t">${dec(o.target, 0)}+ odds</span>
          <span class="bk-big-f"><b>${o.estimated ? '≈' : ''}${dec(o.odds)}</b> odds · <b>${pct(o.prob, 1)}</b> chance · ${o.size} legs${st ? ` · <span class="bk-state ${st[1]}">${st[0]}</span>` : ''}</span>
          ${m ? `<span class="bk-big-m">landed ${pct(m.hit, 1)} in testing (stated ${pct(m.stated, 1)})</span>` : ''}</summary>
          <div class="bk-legs">${o.legs.map(legCard).join('')}</div></details>`;
      }).join('')}</div>`;
  }

  function recordBlock(rec) {
    if (!rec || !rec.heldOut) return '';
    const h = rec.heldOut;
    const t = rec.tuning;
    return `<div class="bk-record">
      <div class="bk-rec-h">Tested on ${esc(String(h.window[0]).slice(0, 4))}–26 seasons the rule never saw (${(h.slip.days || 0).toLocaleString()} match days)</div>
      <div class="bk-rec-cells">
        <div><b>${pct(h.legs.hit, 1)}</b><span>bankers won<br><small>stated ${pct(h.legs.stated, 1)} · ${h.legs.n.toLocaleString()} legs</small></span></div>
        <div><b>${pct(h.slip.hit, 1)}</b><span>3.0+ slips landed<br><small>stated ${pct(h.slip.stated, 1)} · ${h.slip.slips.toLocaleString()} slips</small></span></div>
        <div><b>${dec(h.slip.avgOdds)}</b><span>average slip odds<br><small>${dec(h.slip.avgLegs, 1)} legs on average</small></span></div>
        <div><b>${pct(h.slip.coverage, 0)}</b><span>of days had a 3.0+ slip<br><small>the rest: not enough bankers</small></span></div>
      </div>
      ${h.safer ? `<div class="muted-t">Safer ${dec(h.safer.target || 2, 1)}+ slips, same test: <b>${pct(h.safer.hit, 1)}</b> landed (stated ${pct(h.safer.stated, 1)}, ${dec(h.safer.avgLegs, 1)} legs, average odds ${dec(h.safer.avgOdds)}). Fewer legs, fewer things to go wrong.</div>` : ''}
      <div class="muted-t">Bigger slips, same test: ${Object.entries(h.bigger || {}).map(([t, g]) => `${t}+ landed ${pct(g.hit, 1)} (stated ${pct(g.stated, 1)}, ${dec(g.avgLegs, 0)} legs)`).join(' · ')}.</div>
      <div class="muted-t">Same rule on the 2019–23 seasons used to set it: bankers ${pct(t.legs.hit, 1)} (stated ${pct(t.legs.stated, 1)}), slips ${pct(t.slip.hit, 1)} (stated ${pct(t.slip.stated, 1)}). ${h.slip.fullyPriced && h.slip.fullyPriced.n ? `Slips with a real price on every leg (${h.slip.fullyPriced.n.toLocaleString()}): landed ${pct(h.slip.fullyPriced.hit, 1)}, return at the best price ${signed(h.slip.fullyPriced.roiBest * 100, 1)}%, at Bet365 ${signed(h.slip.fullyPriced.roiBet365 * 100, 1)}%.` : ''}</div>
    </div>`;
  }

  /** The safer slip: the same bankers, the most likely way to the smaller target. */
  function saferBlock(b, target) {
    const sl = b.safer;
    if (!sl || !sl.legs || !sl.legs.length) return '';
    const t = sl.target || (b.config && b.config.safer) || 2;
    const h = b.record && b.record.heldOut;
    const sf = h && h.safer;
    return `<div class="sec-title bk-sec">Safer slip <span class="pill">${dec(t, 1)}+</span></div>
      <p class="muted-t bk-near-p">The same bankers, fewer legs. Every leg is one more thing that can go wrong, so a shorter slip lands more often${sf && h.slip
        ? `: on the seasons the rule never saw, <b>${pct(sf.hit, 1)}</b> of ${dec(t, 1)}+ slips landed against ${pct(h.slip.hit, 1)} of ${dec(target, 1)}+ slips` : ''}.
        ${b.saferFrozen ? 'Published before its first kick-off and kept unchanged.' : ''}</p>
      ${slipCard(sl, 'Safer slip', `${sl.size} banker${sl.size === 1 ? '' : 's'} · the most likely way to ${dec(t, 1)}+ odds today`)}`;
  }

  function nearBlock(list) {
    if (!list || !list.length) return '';
    return `<div class="sec-title bk-sec">Looked strong, left out <span class="pill">${list.length}</span></div>
      <p class="muted-t bk-near-p">These cleared the strength bar but failed a later check — the kind of pick that looks like a banker and is not.</p>
      <div class="bk-near">${list.map((n) => {
        const f = (n.checks || []).find((c) => !c.ok);
        return `<div class="bk-nr" data-id="${esc(n.fixtureId)}" data-league="${esc(n.league)}"><span>${esc(fmtTime(n.kickoff))}</span><span><b>${esc(n.label)}</b> <small>${esc(n.home)} v ${esc(n.away)}</small></span><span>${pct(n.prob, 0)}</span><span class="bk-nr-why">✕ ${esc(f ? CHECK[f.id] || f.id : '')}: ${esc(f ? f.text : '')}</span></div>`;
      }).join('')}</div>`;
  }

  window.renderBanker = function () {
    const el = $('#board');
    const d = state.preds;
    if (!d) {
      el.innerHTML = loadingBlock('Finding today\'s bankers…', 'Every match goes through seven checks; only the selections that pass them all are bankers.');
      return;
    }
    const b = d.banker || { bankers: [], slip: null, all: null, near: [], target: 3, reached: false };
    const target = b.target || 3;
    const cfg = b.config || {};
    const bankers = b.bankers || [];
    const slipIds = new Set(((b.slip && b.slip.legs) || []).map((l) => String(l.fixtureId)));
    const extra = bankers.filter((l) => !slipIds.has(String(l.fixtureId))).sort((x, y) => y.prob - x.prob);
    el.innerHTML = `<div class="m-intro bk-intro">
        <div class="bk-kicker">High Banker · ${esc(fmtDateLong(d.date || state.date))}</div>
        <h2>The day's bankers — ${dec(target, 1)}+ odds, nothing padded</h2>
        <p>Only selections that pass <b>every one of seven checks</b> are bankers: the model and the bookmakers' own price both rate it at least
        ${pct(cfg.minProb || 0.78, 0)}/${pct(cfg.minBase || 0.75, 0)}, the factors do not flag it as a bookmaker trap, it agrees with the normal prediction,
        neither team's record raises a red flag, it still pays, and nothing changed before kick-off. The slip is the <b>most likely set of bankers</b> that
        reaches ${dec(target, 1)} odds. There is no upper limit and no padding: some days give ${dec(target, 1)}, some give far more, some give none.
        A ${dec(target, 1)}+ slip needs about five legs, so on most days one of them lets it down — the <b>safer ${dec(cfg.safer || 2, 1)}+ slip</b> below uses fewer.</p>
        <details class="sp-rules"><summary>The seven checks</summary><ul class="rules">${(b.rules || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul></details>
        ${recordBlock(b.record)}
      </div>
      ${b.error ? `<div class="err-box">${esc(b.error)}</div>` : ''}
      ${b.frozen ? '<div class="meas-note">This slip was published before its first kick-off and is kept unchanged; legs are ticked or crossed as results come in.</div>' : ''}
      ${b.slip ? slipCard(b.slip, 'High Banker', `${b.slip.size} banker${b.slip.size === 1 ? '' : 's'} · the most likely way to ${dec(target, 1)}+ odds today`)
        : `<div class="empty bk-empty"><h3>No ${dec(target, 1)}+ High Banker today</h3><p>${bankers.length
          ? `Today's ${bankers.length} banker${bankers.length === 1 ? '' : 's'} reach${bankers.length === 1 ? 'es' : ''} only ${dec(b.all ? b.all.odds : 1)} odds together. Weaker picks are never added to make up the odds — that is the point of a banker. They are listed below.`
          : 'No selection passes every check today. That is the filter doing its job: on days like this the safest bet is no bet.'}</p></div>`}
      ${saferBlock(b, target)}
      ${b.later && b.later.slip ? `<div class="sec-title bk-sec">For the matches still to play <span class="pill">newer</span></div>${slipCard(b.later.slip, 'Later slip', 'built after the first slip had started')}` : ''}
      ${b.later && b.later.bigger && b.later.bigger.length ? biggerBlock(b.later.bigger, b.record && b.record.heldOut && b.record.heldOut.bigger) : ''}
      ${biggerBlock(b.bigger, b.record && b.record.heldOut && b.record.heldOut.bigger)}
      ${extra.length ? `<div class="sec-title bk-sec">Every other banker today <span class="pill">${extra.length}</span></div>
        <p class="muted-t bk-near-p">They passed every check too. The slip above uses the combination most likely to reach ${dec(target, 1)} — very short bankers add little to the odds, so it often prefers fewer, slightly longer ones.</p>
        <div class="bk-legs bk-extra">${extra.slice(0, 10).map(legCard).join('')}${extra.length > 10 ? `<details class="bk-more"><summary>Show the other ${extra.length - 10} bankers</summary><div class="bk-legs">${extra.slice(10).map((l, i) => legCard(l, i + 10)).join('')}</div></details>` : ''}</div>` : ''}
      ${nearBlock(b.near)}
      <p class="muted-t sp-foot">A ${dec(target, 1)}-odds slip is still roughly a 1-in-${Math.max(2, Math.round(1 / Math.max(0.05, (b.slip && b.slip.prob) || 1 / target)))} shot even when every leg is a banker — odds always tell the truth about the chance. Probabilities, not guarantees. 18+. Bet responsibly.</p>`;
    $$('.bk-leg, .bk-nr', el).forEach((c) => c.addEventListener('click', (e) => {
      if (e.target.closest('details')) return;
      openMatch(c.dataset.id, c.dataset.league, '');
    }));
  };
})();
