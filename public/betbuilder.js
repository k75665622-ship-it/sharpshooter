'use strict';

/* ============================================================
   Sharpshooter — Bet Builder tab
   Loaded after app.js and betbuilder-core.js. Uses app.js's helpers ($, $$, esc, pct, dec,
   api, fmtTime, fmtDateLong, loadingBlock, openMatch, setStatus) and its `state.date`.

   The day's bet builders are chosen on the server (lib/betbuilder.js). "Build your own"
   works out the combined chance of any selections of a match in the browser, with the same
   joint model the server uses (public/betbuilder-core.js).
   ============================================================ */

(function () {
  const BB = { data: null, date: null, loading: false, error: null, seq: 0, poll: null, open: null, picks: [], showAll: false, prep: new Map() };
  const GROUPS = ['Match', 'Goals', 'Team', 'Corners', 'Bookings', 'Players'];
  const GROUP_NAME = { Match: 'Result', Goals: 'Goals', Team: 'Team goals', Corners: 'Corners', Bookings: 'Cards', Players: 'Scorers' };
  const FAMILY_NAME = { result: 'Result', btts: 'Goals', total: 'Goals', homeGoals: 'Team goals', awayGoals: 'Team goals', corners: 'Corners', cornersMost: 'Corners', homeCorners: 'Corners', awayCorners: 'Corners', cards: 'Cards' };
  const KINDS = { 'cards+corners+goals': 'Goals + corners + cards', 'corners+goals': 'Goals + corners', 'cards+goals': 'Goals + cards', 'cards+corners': 'Corners + cards', goals: 'Goals only', corners: 'Corners only', cards: 'Cards only' };
  const MAX_PICKS = 10;
  const MORE_SHOWN = 6;

  const core = () => window.BBCore;
  const p0 = (v) => (v == null || !Number.isFinite(v) ? '—' : Math.round(v * 100) + '%');
  const n0 = (v) => Number(v || 0).toLocaleString('en-GB');
  const oneIn = (p) => (p > 0 ? `1 time in ${Math.max(1, Math.round(1 / p))}` : 'never');
  const legKind = (key) => {
    const l = core() && core().legOf(key);
    return l ? (l.kind === 'player' ? 'Scorer' : FAMILY_NAME[l.family] || '') : '';
  };
  const famOf = (key) => {
    const l = core() && core().legOf(key);
    return l ? l.family : key;
  };
  const isPlayer = (key) => /^PL_/.test(key);
  const matchAttrs = (m) => `data-id="${esc(m.id)}" data-league="${esc(m.league)}" data-year="${esc(m.seasonYear || '')}"`;
  const league = (m) => `${m.leagueFlag ? `${esc(m.leagueFlag)} ` : ''}${esc(m.leagueName || m.league || '')}`;

  // ---------------------------------------------------------------- data
  /**
   * Keep this morning's builders once their matches kick off: a builder the newer copy no
   * longer lists (its match has started) moves to "Already kicked off".
   */
  function merge(older, newer, now) {
    const t = now == null ? Date.now() : now;
    if (!newer) return older || null;
    if (!older || older.date !== newer.date) return newer;
    const have = new Set([...(newer.builders || []).map((b) => String(b.match.id)), ...(newer.earlier || []).map((e) => String(e.fixture))]);
    const carried = [];
    for (const it of older.builders || []) {
      const id = String(it.match.id);
      if (have.has(id) || !(Date.parse(it.match.date) <= t)) continue;
      have.add(id);
      carried.push({
        fixture: id, date: it.match.date, league: it.match.leagueName || it.match.league,
        home: it.match.home && it.match.home.name, away: it.match.away && it.match.away.name,
        label: it.builder.legs.map((l) => l.label).join(' + '), prob: it.builder.chance, fairOdds: it.builder.fairOdds,
        legs: it.builder.legs.map((l) => ({ key: l.key, label: l.label, chance: l.chance, hit: null })),
        result: null, hit: null, savedInBrowser: true,
      });
    }
    for (const e of older.earlier || []) {
      const id = String(e.fixture);
      if (have.has(id)) continue;
      have.add(id);
      carried.push({ ...e, savedInBrowser: true });
    }
    if (!carried.length) return newer;
    return { ...newer, earlier: [...(newer.earlier || []), ...carried].sort((a, b) => Date.parse(a.date) - Date.parse(b.date)) };
  }

  /** @param {boolean} force rebuild on the server; @param {boolean} again ask the server again */
  async function load(force, again) {
    const date = state.date;
    if (!force && !again && BB.data && BB.date === date) return BB.data;
    // this browser's saved copy of the day (public/daycache.js): shown at once
    if (!force && !again && window.DayCache && (!BB.data || BB.date !== date)) {
      const saved = await window.DayCache.getPayload('betbuilder', date);
      if (saved && state.date === date && (!BB.data || BB.date !== date)) {
        BB.data = saved;
        BB.date = date;
        if (state.view === 'betbuilder') render();
      }
    }
    const seq = ++BB.seq;
    BB.loading = true;
    BB.error = null;
    try {
      const d = await api(`/api/betbuilder?date=${encodeURIComponent(date)}${force ? '&refresh=1' : ''}`);
      if (seq !== BB.seq) return null;
      const merged = merge(BB.data && BB.date === date ? BB.data : null, d);
      BB.data = merged;
      BB.date = date;
      BB.prep.clear(); // the match models may have changed
      if (window.DayCache) window.DayCache.putPayload('betbuilder', date, merged);
      // the server answered from its day book and is rebuilding: ask again shortly
      clearTimeout(BB.poll);
      if (d.cache && d.cache.refreshing) {
        BB.poll = setTimeout(() => {
          if (state.view !== 'betbuilder' || state.date !== date) return;
          load(false, true).then((x) => { if (x && state.view === 'betbuilder') render(); }).catch(() => {});
        }, 20000);
      }
      return merged;
    } catch (err) {
      if (seq === BB.seq) BB.error = err;
      throw err;
    } finally {
      if (seq === BB.seq) BB.loading = false;
    }
  }

  const entryOf = (id) => ((BB.data && BB.data.matches) || []).find((mt) => String(mt.match.id) === String(id)) || null;
  function prepFor(mt) {
    if (!mt || !mt.model || !core()) return null;
    const id = String(mt.match.id);
    if (!BB.prep.has(id)) BB.prep.set(id, core().prepare(mt.model));
    return BB.prep.get(id);
  }

  // ---------------------------------------------------------------- pieces
  function legsList(legs) {
    return `<ul class="bb-legs">${(legs || []).map((l) => {
      const st = l.hit === 1 ? ' is-won' : l.hit === 0 ? ' is-lost' : '';
      const mark = l.hit === 1 ? ' <b class="pos" aria-label="won">✓</b>' : l.hit === 0 ? ' <b class="neg" aria-label="lost">✕</b>' : '';
      return `<li class="${st.trim()}"><span class="bb-leg-l">${esc(l.label)}<small>${esc(GROUP_NAME[l.group] || legKind(l.key))}</small></span><span class="bb-leg-p">${p0(l.chance)}${mark}</span></li>`;
    }).join('')}</ul>`;
  }

  function weakest(b) {
    return Math.min(...b.legs.map((l) => l.chance));
  }

  function builderCard(it, rank, top) {
    const m = it.match;
    const b = it.builder;
    const lift = b.chance - b.product;
    const kinds = new Set(b.legs.map((l) => (l.group === 'Corners' ? 'c' : l.group === 'Bookings' ? 'k' : 'g')));
    const mult = Math.abs(lift) >= 0.005
      ? (lift > 0 ? `Multiplying the legs would say ${p0(b.product)}: they back each other, so together they land more often.` : `Multiplying the legs would say ${p0(b.product)}.`)
      : kinds.size === b.legs.length ? 'Goals, corners and cards move separately (checked on past matches), so these legs simply multiply.' : `Multiplying the legs gives about the same: ${p0(b.product)}.`;
    return `<article class="bb-card${top ? ' is-top' : ''}">
      <div class="bb-card-h">
        <div class="bb-meta">${rank ? `<span class="bb-rank">#${rank}</span>` : ''}<span>${esc(fmtTime(m.date))}</span><span>${league(m)}</span><span>${b.size} legs</span></div>
        <button class="bb-match" ${matchAttrs(m)} title="Open the full match analysis">${esc(m.home.name)} <span>v</span> ${esc(m.away.name)}</button>
      </div>
      ${legsList(b.legs)}
      <div class="bb-card-f">
        <div class="bb-num"><div class="v bb-big">${p0(b.chance)}</div><div class="k">Combined chance</div></div>
        <div class="bb-num"><div class="v">${dec(b.fairOdds)}</div><div class="k">Fair odds</div></div>
        <div class="bb-num"><div class="v">${p0(weakest(b))}</div><div class="k">Weakest leg</div></div>
      </div>
      <div class="bb-note"><span>Take it at <b>${dec(b.takeAt)}</b> or better. ${esc(mult)}</span>
        <button class="bb-open" data-open="${esc(m.id)}" data-suggest="1">Change the legs</button></div>
    </article>`;
  }

  function matchRow(mt) {
    const m = mt.match;
    const b = mt.builder;
    const open = BB.open === String(m.id);
    const s = mt.started ? '<em>Kicked off</em>' : b ? `Builder <b>${p0(b.chance)}</b> · ${b.size} legs · fair ${dec(b.fairOdds)}` : 'No builder reaches the bar — build your own';
    return `<button class="bb-mrow${open ? ' is-open' : ''}${mt.started ? ' is-started' : ''}" data-open="${esc(m.id)}" aria-expanded="${open}">
      <span class="t">${esc(fmtTime(m.date))} · ${league(m)}</span>
      <span class="n">${esc(m.home.name)} v ${esc(m.away.name)}</span>
      <span class="s">${s}</span>
    </button>`;
  }

  /** Each market group's selections in a fixed, readable order (not the payload's). */
  function rank(o) {
    const k = o.key;
    let m;
    const MATCH = ['1', 'X', '2', '1X', 'X2', '12'];
    if (MATCH.includes(k)) return [0, MATCH.indexOf(k)];
    if ((m = /^([OU])(\d\.5)$/.exec(k))) return [1, m[1] === 'O' ? 0 : 1, +m[2]];
    if (k === 'BTTS_Y' || k === 'BTTS_N') return [2, k === 'BTTS_Y' ? 0 : 1];
    if ((m = /^TT([HA])_([OU])(\d\.5)$/.exec(k))) return [3, m[1] === 'H' ? 0 : 1, m[2] === 'O' ? 0 : 1, +m[3]];
    if ((m = /^C_([OU])(\d+\.5)$/.exec(k))) return [4, m[1] === 'O' ? 0 : 1, +m[2]];
    if (k === 'C_MOST_H' || k === 'C_MOST_A') return [5, k === 'C_MOST_H' ? 0 : 1];
    if ((m = /^C([HA])_O(\d+\.5)$/.exec(k))) return [6, m[1] === 'H' ? 0 : 1, +m[2]];
    if ((m = /^K_([OU])(\d+\.5)$/.exec(k))) return [7, m[1] === 'O' ? 0 : 1, +m[2]];
    if ((m = /^PL_([HA])_(\d+)$/.exec(k))) return [8, m[1] === 'H' ? 0 : 1, -(o.chance || 0)];
    return [9];
  }
  function byRank(a, b) {
    const x = rank(a);
    const y = rank(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] == null ? -1 : x[i]) - (y[i] == null ? -1 : y[i]);
      if (d) return d;
    }
    return 0;
  }

  /** The "build your own" menu: every selection the match model prices (lib/betbuilder.js modelFor). */
  function optionsOf(mt) {
    const players = Object.fromEntries(((mt.model && mt.model.players) || []).map((p) => [p.key, p]));
    return Object.entries((mt.model && mt.model.legs) || {})
      .filter(([, l]) => GROUPS.includes(l.group))
      .map(([key, l]) => ({ key, label: l.label, group: l.group, chance: l.chance, measured: l.measured, lineup: players[key] ? players[key].lineup : null }));
  }

  function buildPanel(mt) {
    const m = mt.match;
    const opts = optionsOf(mt).sort(byRank);
    const groups = GROUPS.map((g) => [g, opts.filter((o) => o.group === g)]).filter(([, l]) => l.length);
    const excluded = config().excluded || [];
    const team = (o) => (isPlayer(o.key)
      ? (/^PL_H/.test(o.key) ? m.home.name : m.away.name) + (o.lineup === 'start' ? ' · starts' : o.lineup === 'bench' ? ' · on the bench' : '')
      : excluded.includes(o.key) ? 'weak record: kept off the lists' : '');
    return `<div class="bb-build" id="bbBuild" data-match="${esc(m.id)}">
      <div class="bb-build-h">
        <div>
          <h3>Build your own · ${esc(m.home.name)} v ${esc(m.away.name)}</h3>
          <p>${esc(fmtTime(m.date))} · ${league(m)}${mt.started ? ' · <b>kicked off</b>' : ''} · tick up to ${MAX_PICKS} selections, one line of each market</p>
        </div>
        <div class="bb-build-a">
          ${mt.builder ? '<button class="bb-close" data-act="suggest">Our builder</button>' : ''}
          <button class="bb-close" data-act="clear">Clear</button>
          <button class="bb-close" data-act="close">Close</button>
        </div>
      </div>
      <div class="bb-build-b">
        <div class="bb-opts">${groups.map(([g, list]) => `<fieldset class="bb-og"><legend>${esc(GROUP_NAME[g] || g)}${g === 'Players' ? ' <small>not measured</small>' : ''}</legend>
          <div class="bb-og-l">${list.map((o) => `<label class="bb-opt" data-key="${esc(o.key)}"><input type="checkbox" value="${esc(o.key)}" /><span class="l">${esc(o.label)}${team(o) ? `<small>${esc(team(o))}</small>` : ''}</span><span class="p">${p0(o.chance)}</span></label>`).join('')}</div>
        </fieldset>`).join('')}</div>
        <div class="bb-stick" id="bbStick"></div>
        <aside class="bb-slip" id="bbSlip" aria-live="polite"></aside>
      </div>
    </div>`;
  }

  /** The slip of "build your own": the combined chance and what to watch for. */
  function slipHtml(mt, prep, keys, cfg) {
    if (!keys.length) {
      return `<div class="bb-slip-t">Your builder</div>
        <p class="bb-empty-slip">Tick selections on the left. The combined chance comes from one model of the whole match, so selections that go together are not multiplied as if they were unrelated.</p>`;
    }
    const C = core();
    const lab = (k) => (mt.model.legs[k] && mt.model.legs[k].label) || k;
    const j = prep ? C.joint(prep, keys, cfg.cal) : null;
    const impossible = !j || !(j.raw > 1e-9);
    const notes = [];
    if (impossible) {
      let pair = null;
      for (let a = 0; a < keys.length && !pair; a++) for (let b = a + 1; b < keys.length && !pair; b++) if (C.impossible(prep, [keys[a], keys[b]])) pair = [keys[a], keys[b]];
      notes.push({ cls: 'is-bad', html: pair ? `<b>${esc(lab(pair[0]))}</b> and <b>${esc(lab(pair[1]))}</b> cannot both happen.` : 'These selections cannot all happen together.' });
    } else {
      const suggested = mt.builder && mt.builder.legs.length === keys.length && mt.builder.legs.every((l) => keys.includes(l.key));
      if (suggested) notes.push({ cls: 'is-ok', html: 'This is the builder chosen for this match.' });
      if (keys.length > 1) {
        const implied = keys.filter((k) => Math.abs(C.rawJoint(prep, keys.filter((x) => x !== k)) - j.raw) < 1e-9);
        if (implied.length) notes.push({ cls: '', html: `${implied.map((k) => `<b>${esc(lab(k))}</b>`).join(', ')} add${implied.length > 1 ? '' : 's'} nothing: the other selections already make ${implied.length > 1 ? 'them' : 'it'} certain.` });
        const apart = keys.reduce((a, k) => a * C.rawJoint(prep, [k]), 1);
        if (j.raw < apart * (1 - (cfg.maxPull == null ? 0.01 : cfg.maxPull))) {
          notes.push({ cls: '', html: `These selections pull against each other: by the model they land together ${p0(j.raw)} of the time, against ${p0(apart)} if they were unrelated. A hedge, not one story of the match.` });
        }
      }
      const unmeasured = keys.filter((k) => !(mt.model.legs[k] && mt.model.legs[k].measured));
      if (unmeasured.length) {
        notes.push({ cls: '', html: `${unmeasured.map((k) => `<b>${esc(lab(k))}</b>`).join(', ')}: not measured. ${unmeasured.some(isPlayer) ? 'There is no scorer history to check scorer chances against, and they hang on the line-up.' : 'The chance is the model\'s, not a measured one.'}` });
      }
      const weak = keys.filter((k) => (cfg.excluded || []).includes(k));
      if (weak.length) notes.push({ cls: '', html: `${weak.map((k) => `<b>${esc(lab(k))}</b>`).join(', ')}: kept off the Strongest Picks and the daily builders for ${weak.length > 1 ? 'their' : 'its'} record. On past matches it won less often than its stated chance.` });
      if (keys.length > cfg.maxLegs) notes.push({ cls: '', html: `More than ${cfg.maxLegs} legs: each one costs bookmaker margin and is one more thing to go wrong.` });
      if (j.fairOdds < cfg.target - 1e-9) notes.push({ cls: '', html: `Fair odds ${dec(j.fairOdds)}: under ${dec(cfg.target, 1)}. Add a selection to reach ${dec(cfg.target, 1)}+.` });
      else if (j.fairOdds > cfg.maxOdds + 1e-9) notes.push({ cls: '', html: `Fair odds ${dec(j.fairOdds)}: a long shot. It lands about ${oneIn(j.chance)}.` });
      else notes.push({ cls: 'is-ok', html: `Take it only at <b>${dec(j.fairOdds)}</b> or better: a bookmaker's bet builder price is usually lower than fair.` });
    }
    return `<div class="bb-slip-t">Your builder · ${keys.length} leg${keys.length === 1 ? '' : 's'}</div>
      <ul class="bb-slip-legs">${keys.map((k) => `<li><b>${esc(lab(k))}</b><span>${p0(mt.model.legs[k] && mt.model.legs[k].chance)}</span><button class="bb-x" data-remove="${esc(k)}" aria-label="Remove ${esc(lab(k))}">×</button></li>`).join('')}</ul>
      <div class="bb-slip-n">
        <div class="bb-num"><div class="v bb-big">${impossible ? '0%' : p0(j.chance)}</div><div class="k">Combined chance</div></div>
        <div class="bb-num"><div class="v">${impossible ? '—' : dec(j.fairOdds)}</div><div class="k">Fair odds</div></div>
      </div>
      ${keys.length > 1 && !impossible ? `<div class="bb-mult">Multiplied as if unrelated: ${p0(j.product)}</div>` : ''}
      ${notes.map((n) => `<div class="bb-warn ${n.cls}">${n.html}</div>`).join('')}
      ${impossible ? '' : '<button class="bb-open" id="bbCopyOwn">Copy this builder</button>'}`;
  }

  /** Update "build your own" in place (keeps the scroll position of the list). */
  function paint() {
    const panel = $('#bbBuild');
    const mt = entryOf(BB.open);
    if (!panel || !mt) return;
    const cfg = config();
    const prep = prepFor(mt);
    const keys = BB.picks;
    const C = core();
    $$('.bb-opt', panel).forEach((el) => {
      const k = el.dataset.key;
      const on = keys.includes(k);
      el.classList.toggle('is-on', on);
      el.querySelector('input').checked = on;
      // would ticking it make the builder impossible?
      let off = false;
      if (!on && prep && C) {
        const rest = keys.filter((x) => famOf(x) !== famOf(k));
        off = rest.length > 0 && C.impossible(prep, [...rest, k]);
      }
      el.classList.toggle('is-off', off);
      el.title = off ? 'Cannot happen together with your other selections' : '';
    });
    $('#bbSlip').innerHTML = slipHtml(mt, prep, keys, cfg);
    // phones: the slip sits under a long list, so a bar keeps the combined chance in view
    const stick = $('#bbStick');
    if (stick) {
      const j = keys.length && prep && C ? C.joint(prep, keys, cfg.cal) : null;
      const go = '<button class="bb-stick-go" data-act="slip">Slip ↓</button>';
      stick.innerHTML = !keys.length
        ? '<span aria-hidden="true">Tick selections to build</span>'
        : j && j.raw > 1e-9
          ? `<span aria-hidden="true">${keys.length} leg${keys.length === 1 ? '' : 's'} · <b>${p0(j.chance)}</b> · fair <b>${dec(j.fairOdds)}</b></span>${go}`
          : `<span aria-hidden="true">${keys.length} legs · cannot all happen</span>${go}`;
    }
    const cp = $('#bbCopyOwn');
    if (cp) cp.addEventListener('click', () => copy(cp, ownText(mt, prep, keys, cfg), 'Copy this builder'));
  }

  function toggle(key, on) {
    let keys = BB.picks.filter((k) => k !== key);
    if (on) {
      // one line of each market: the new line replaces the old one
      keys = keys.filter((k) => famOf(k) !== famOf(key));
      if (keys.length < MAX_PICKS) keys.push(key);
    }
    BB.picks = keys;
    paint();
  }

  function openBuild(id, suggest) {
    const mt = entryOf(id);
    if (!mt) return;
    const same = BB.open === String(id);
    BB.open = String(id);
    if (suggest && mt.builder) BB.picks = mt.builder.legs.map((l) => l.key);
    else if (!same) BB.picks = [];
    render();
    const panel = $('#bbBuild');
    if (panel && panel.scrollIntoView) {
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      panel.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    }
  }

  // ---------------------------------------------------------------- copy
  function copy(btn, text, label) {
    const done = () => {
      btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = label; }, 1800);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => window.prompt('Copy:', text));
    else window.prompt('Copy:', text);
  }
  function dayText(d, list) {
    const lines = [`Sharpshooter Bet Builders — ${fmtDateLong(d.date || state.date)}`];
    for (const it of list) {
      lines.push('', `${fmtTime(it.match.date)} ${it.match.home.name} v ${it.match.away.name}`);
      for (const l of it.builder.legs) lines.push(`  • ${l.label} (${p0(l.chance)})`);
      lines.push(`  Combined ${p0(it.builder.chance)} · fair odds ${dec(it.builder.fairOdds)} — take at ${dec(it.builder.takeAt)}+`);
    }
    lines.push('', 'Probabilities, not guarantees. 18+, bet responsibly.');
    return lines.join('\n');
  }
  function ownText(mt, prep, keys, cfg) {
    const m = mt.match;
    const j = core().joint(prep, keys, cfg.cal);
    const lines = [`Bet builder — ${m.home.name} v ${m.away.name}, ${fmtTime(m.date)} (${m.leagueName || m.league})`];
    for (const k of keys) lines.push(`  • ${mt.model.legs[k].label} (${p0(mt.model.legs[k].chance)})`);
    if (j) lines.push(`  Combined ${p0(j.chance)} · fair odds ${dec(j.fairOdds)}`);
    lines.push('Worked out on Sharpshooter. Probabilities, not guarantees. 18+, bet responsibly.');
    return lines.join('\n');
  }

  // ---------------------------------------------------------------- records
  function earlierBlock(rows) {
    if (!rows || !rows.length) return '';
    const res = (e) => (e.hit === 1 ? '<b class="pos">✓ Landed</b>' : e.hit === 0 ? '<b class="neg">✕ Lost</b>' : e.result === 'void' ? '<span class="muted-t">Void</span>' : '<span class="muted-t">In play / waiting</span>');
    return `<div class="sec-title bb-sec">Already kicked off <span class="pill">${rows.length}</span></div>
      <div class="bb-list">${rows.map((e) => `<article class="bb-card is-done">
        <div class="bb-card-h">
          <div class="bb-meta"><span>${esc(fmtTime(e.date))}</span><span>${esc(e.league || '')}</span>${e.result && e.result !== 'void' ? `<span>Full time ${esc(e.result)}</span>` : ''}</div>
          <div class="bb-match is-static">${esc(e.home)} <span>v</span> ${esc(e.away)}</div>
        </div>
        ${legsList(e.legs)}
        <div class="bb-card-f">
          <div class="bb-num"><div class="v">${p0(e.prob)}</div><div class="k">Combined chance</div></div>
          <div class="bb-num"><div class="v">${dec(e.fairOdds)}</div><div class="k">Fair odds</div></div>
          <div class="bb-num"><div class="v bb-res">${res(e)}</div><div class="k">Result</div></div>
        </div>
      </article>`).join('')}</div>`;
  }

  function measuredBlock(cfg) {
    const m = cfg && cfg.measured;
    if (!m || !m.all) return '';
    const small = (n) => (n < 100 ? ' <small>small sample</small>' : '');
    const kinds = Object.entries(m.kinds || {}).sort((a, b) => b[1].n - a[1].n);
    const sizes = Object.entries(m.size || {}).sort((a, b) => Number(a[0]) - Number(b[0]));
    const row = (name, v) => `<div class="bt-row"><span>${name}${small(v.n)}</span><span>${n0(v.n)}</span><span><b>${pct(v.landed, 1)}</b></span><span>${pct(v.stated, 1)}</span></div>`;
    return `<div class="sec-title bb-sec">Measured on past matches <span class="pill">${esc(m.window || '')}</span></div>
      <p class="muted-t bb-p">The same rules replayed on ${n0(m.matches)} matches the models never saw (${esc(m.window || '')}): ${n0(m.builders)} builders (${pct(m.share, 0)} of matches, about ${Math.round(m.perMatchDay || 0)} a match day), every leg settled on the real result.
        A builder stated at ${pct(m.all.stated, 1)} should land about that often, and it did: <b>${pct(m.all.landed, 1)}</b>.
        That also means about two in three lose. A 3.0 builder only pays over time when it is taken at or above its fair odds.</p>
      <div class="bt-table bb-bt">
        <div class="bt-row head"><span>Builders</span><span>Number</span><span>Landed</span><span>Stated</span></div>
        ${row('<b>All bet builders</b>', m.all)}
        ${kinds.length ? `<div class="bt-row bb-sub"><span>By kind of legs</span><span></span><span></span><span></span></div>${kinds.map(([k, v]) => row(esc(KINDS[k] || k), v)).join('')}` : ''}
        ${sizes.length ? `<div class="bt-row bb-sub"><span>By number of legs</span><span></span><span></span><span></span></div>${sizes.map(([k, v]) => row(`${esc(k)} legs`, v)).join('')}` : ''}
      </div>`;
  }

  function recordBlock(r) {
    if (!r) return '';
    const B = r.builders || {};
    const recent = (r.recent || []).slice(0, 12);
    return `<div class="sec-title bb-sec">Track record <span class="pill">${B.n || 0} settled</span></div>
      <div class="sumstrip">
        <div class="ss-cell"><div class="v">${B.hitRate == null ? '—' : pct(B.hitRate, 1)}</div><div class="k">Builders landed</div></div>
        <div class="ss-cell"><div class="v">${B.stated == null ? '—' : pct(B.stated, 1)}</div><div class="k">Average stated chance</div></div>
        <div class="ss-cell"><div class="v">${B.won || 0}/${B.n || 0}</div><div class="k">Landed / settled</div></div>
        <div class="ss-cell"><div class="v">${B.pending || 0}</div><div class="k">Waiting for a result</div></div>
      </div>
      <p class="muted-t bb-p">Every builder is written down before kick-off and settled leg by leg from ESPN and football-data.co.uk results; nothing is edited afterwards. <a class="dl" href="/api/betbuilder/record?format=csv">Download CSV</a></p>
      ${recent.length ? `<div class="bt-table bb-bt">
        <div class="bt-row head"><span>Recent builders</span><span>Chance</span><span>Score</span><span>Result</span></div>
        ${recent.map((e) => `<div class="bt-row"><span>${esc(e.label)} <small>${esc(e.home)} v ${esc(e.away)} · ${esc(String(e.date).slice(0, 10))}</small></span><span>${p0(e.prob)}</span><span>${e.result && e.result !== 'void' ? esc(e.result) : e.result === 'void' ? 'void' : '<small>pending</small>'}</span><span>${e.hit === 1 ? '<b class="pos">✓</b>' : e.hit === 0 ? '<b class="neg">✕</b>' : ''}</span></div>`).join('')}
      </div>` : ''}`;
  }

  // ---------------------------------------------------------------- the page
  function config() {
    const d = BB.data || {};
    return { target: 3, maxOdds: 4.5, minLegs: 3, maxLegs: 5, minLegChance: 0.55, maxPull: 0.01, featured: 3, cal: null, ...(d.config || {}) };
  }

  function render() {
    const el = $('#board');
    const d = BB.data;
    if (!d || BB.date !== state.date) {
      el.innerHTML = BB.error
        ? `<div class="err-box"><strong>Could not build the bet builders</strong><br>${esc(BB.error.message || BB.error)}</div>`
        : loadingBlock('Building the bet builders…', 'Every match gets one model of its goals, corners and cards. The first load of the day takes a little while.');
      return;
    }
    const cfg = config();
    const builders = d.builders || [];
    const matches = d.matches || [];
    const upcoming = matches.filter((m) => !m.started);
    const top = builders.slice(0, cfg.featured);
    const more = builders.slice(top.length);
    const moreShown = BB.showAll ? more : more.slice(0, MORE_SHOWN);
    const meas = cfg.measured;
    const rec = d.record && d.record.builders;
    if (BB.open && !entryOf(BB.open)) {
      BB.open = null;
      BB.picks = [];
    }
    const openEntry = BB.open ? entryOf(BB.open) : null;
    const T = dec(cfg.target, 1);

    el.innerHTML = `<div class="m-intro bb-intro">
        <div class="bb-kicker">Bet Builder · ${esc(fmtDateLong(d.date || state.date))}</div>
        <h2>Several selections from one match, one bet at ${T}+ odds</h2>
        <p>Say a team to win, both teams to score and over 8.5 corners, all on one slip. Selections from one match
        depend on each other, so their chances cannot simply be multiplied: each builder is priced by <b>one model of the whole match</b>
        (the bookmakers' score model for goals, the form + price models for corners and cards). Every leg is a <b>measured</b> selection,
        ${p0(cfg.minLegChance)}+ on its own with no trap flagged, and the combined chance was checked on
        ${meas && meas.all ? `<b>${n0(meas.all.n)} past builders</b>: they landed <b>${pct(meas.all.landed, 1)}</b> of the time against a stated ${pct(meas.all.stated, 1)}` : 'past matches'}.</p>
        <p class="bb-warnline">A ${T} builder still loses about two times in three. Take one only when the bookmaker's price is at or above its fair odds.</p>
        <details class="bb-rules"><summary>How a builder is made</summary><ul class="rules">${(d.rules || []).map((r) => `<li>${esc(r)}</li>`).join('')}</ul></details>
      </div>
      ${d.error ? `<div class="err-box"><strong>The bet builders could not be built</strong><br>${esc(d.error)}</div>` : ''}
      <div class="sumstrip">
        <div class="ss-cell bb-lock"><div class="v">${builders.length}</div><div class="k">Bet builders today</div></div>
        <div class="ss-cell"><div class="v">${upcoming.length}</div><div class="k">Matches still to play</div></div>
        <div class="ss-cell"><div class="v">${meas && meas.all ? pct(meas.all.landed, 1) : '—'}</div><div class="k">${meas && meas.all ? `Landed on ${n0(meas.all.n)} past builders` : 'Measured record'}</div></div>
        <div class="ss-cell"><div class="v">${rec && rec.hitRate != null ? pct(rec.hitRate, 0) : '—'}</div><div class="k">${rec && rec.n ? `Live: ${rec.won}/${rec.n} landed` : 'Live record starts today'}</div></div>
      </div>
      ${builders.length ? `<div class="bb-bar">
          <div class="sec-title bb-sec">Today's top builders <span class="pill">${top.length}</span></div>
          <button class="bb-copy" id="bbCopyDay">Copy builders</button>
        </div>
        <p class="muted-t bb-p">Chosen the way each builder is: the fewest legs that reach ${T}, then the strongest weakest leg. Click a match for its full analysis, or change the legs.</p>
        <div class="bb-list">${top.map((it, i) => builderCard(it, i + 1, true)).join('')}</div>
        ${more.length ? `<div class="sec-title bb-sec">More builders <span class="pill">${more.length}</span></div>
          <div class="bb-list">${moreShown.map((it, i) => builderCard(it, top.length + i + 1, false)).join('')}</div>
          ${more.length > MORE_SHOWN ? `<button class="bb-open bb-more" id="bbMore">${BB.showAll ? 'Show fewer' : `Show all ${more.length}`}</button>` : ''}` : ''}`
      : `<div class="empty bb-empty"><h3>No bet builder ${upcoming.length ? 'yet' : 'today'}</h3>
          <p>${upcoming.length ? `None of the ${upcoming.length} upcoming matches has ${cfg.minLegs} measured selections that reach ${T} together without a trap against them. You can still build your own below.` : 'No upcoming matches were analysed for this date.'}</p></div>`}
      ${earlierBlock(d.earlier)}
      ${matches.length ? `<div class="sec-title bb-sec" id="bbMatches">Every match · build your own <span class="pill">${matches.length}</span></div>
        <p class="muted-t bb-p">Pick a match and tick any selections: the combined chance updates from the same model of the match. Scorers are offered here only: there is no scorer history to measure them.</p>
        ${openEntry ? buildPanel(openEntry) : ''}
        <div class="bb-matches">${matches.map(matchRow).join('')}</div>` : ''}
      ${measuredBlock(cfg)}
      ${recordBlock(d.record)}
      <p class="muted-t bb-foot">Probabilities, not guarantees. Fair odds = 100 ÷ chance: only take a price at or above them. 18+. Bet responsibly.</p>`;

    $$('.bb-match[data-id]', el).forEach((b) => b.addEventListener('click', () => openMatch(b.dataset.id, b.dataset.league, b.dataset.year)));
    $$('[data-open]', el).forEach((b) => b.addEventListener('click', () => openBuild(b.dataset.open, b.dataset.suggest === '1')));
    const moreBtn = $('#bbMore', el);
    if (moreBtn) moreBtn.addEventListener('click', () => { BB.showAll = !BB.showAll; render(); });
    const cp = $('#bbCopyDay', el);
    if (cp) cp.addEventListener('click', () => copy(cp, dayText(d, top.concat(moreShown)), 'Copy builders'));
    const panel = $('#bbBuild', el);
    if (panel) {
      panel.addEventListener('change', (e) => {
        const inp = e.target.closest('input[type="checkbox"]');
        if (inp) toggle(inp.value, inp.checked);
      });
      panel.addEventListener('click', (e) => {
        const act = e.target.closest('[data-act]');
        const rm = e.target.closest('[data-remove]');
        if (rm) return toggle(rm.dataset.remove, false);
        if (!act) return;
        if (act.dataset.act === 'close') {
          BB.open = null;
          BB.picks = [];
          render();
          const anchor = $('#bbMatches');
          if (anchor && anchor.scrollIntoView) anchor.scrollIntoView({ block: 'start' });
        } else if (act.dataset.act === 'clear') {
          BB.picks = [];
          paint();
        } else if (act.dataset.act === 'slip') {
          const s = $('#bbSlip');
          if (s && s.scrollIntoView) s.scrollIntoView({ block: 'start' });
        } else if (act.dataset.act === 'suggest') {
          const mt = entryOf(BB.open);
          BB.picks = mt && mt.builder ? mt.builder.legs.map((l) => l.key) : [];
          paint();
        }
      });
      paint();
    }
  }

  /** Called by app.js when the tab is shown, the date changes or Refresh is pressed. */
  window.renderBetBuilder = function (force) {
    if (BB.date !== state.date) {
      BB.data = null;
      BB.open = null;
      BB.picks = [];
      BB.showAll = false;
      BB.prep.clear();
    }
    render();
    if (BB.loading && !force) return;
    load(!!force)
      .then((d) => {
        if (!d || state.view !== 'betbuilder') return;
        render();
        const n = (d.builders || []).length;
        setStatus(`${n} bet builder${n === 1 ? '' : 's'} · ${(d.matches || []).length} matches`, 'ok');
      })
      .catch(() => { if (state.view === 'betbuilder') render(); });
  };

  // for test/e2e_offline.js
  window.BBPage = { merge };
})();
