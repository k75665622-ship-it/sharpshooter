/* ============================================================
   Sharpshooter — the browser's day database
   ------------------------------------------------------------
   The day's predictions, fixture board, Strongest Picks and every match
   report you open are kept in this browser (IndexedDB). Come back later —
   even after closing the browser — and they show at once, while a fresh
   copy loads quietly in the background.

   Everything is wiped when the prediction day changes at 05:00 Ghana time
   (the same clock as the server's day book: public/shared.js dayKey).

   If the browser blocks storage (private windows, some in-app browsers)
   the site simply works as before, from the server.
   ============================================================ */

(function () {
  'use strict';

  const NAME = 'sharpshooter-day';
  const VERSION = 1;
  const STORES = ['payloads', 'reports', 'meta'];
  const mem = new Map(); // same-session fallback when IndexedDB is unavailable
  let available = typeof indexedDB !== 'undefined';
  let dbp = null;

  function open() {
    if (!available) return Promise.resolve(null);
    if (dbp) return dbp;
    dbp = new Promise((resolve) => {
      let req;
      try {
        req = indexedDB.open(NAME, VERSION);
      } catch {
        available = false;
        resolve(null);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        available = false;
        resolve(null);
      };
      req.onblocked = () => resolve(null);
    });
    return dbp;
  }

  /** One IndexedDB request in its own transaction; never throws, resolves undefined on failure. */
  function op(store, mode, make) {
    return open().then((db) => new Promise((resolve) => {
      if (!db) return resolve(undefined);
      try {
        const tx = db.transaction(store, mode);
        const req = make(tx.objectStore(store));
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => resolve(undefined);
        tx.onabort = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    }));
  }
  const idbGet = (store, key) => op(store, 'readonly', (st) => st.get(key));
  const idbPut = (store, key, value) => op(store, 'readwrite', (st) => st.put(value, key));
  const idbClear = (store) => op(store, 'readwrite', (st) => st.clear());

  const listeners = [];
  let wipeTimer = null;
  let current = null;

  /** Open the database for today, wiping anything left from an earlier prediction day. */
  async function init() {
    const today = SS.dayKey();
    const stored = await idbGet('meta', 'day');
    const changed = stored !== undefined && stored !== today;
    if (stored !== today) {
      await idbClear('payloads');
      await idbClear('reports');
      await idbPut('meta', 'day', today);
      mem.clear();
    }
    const wasSet = current;
    current = today;
    schedule();
    if ((changed || (wasSet && wasSet !== today)) && listeners.length) listeners.forEach((fn) => { try { fn(today); } catch { /* a listener must not stop the others */ } });
    return today;
  }

  /** Wake up at the next 05:00 Ghana time and start a clean day. */
  function schedule() {
    clearTimeout(wipeTimer);
    const ms = SS.msToReset();
    wipeTimer = setTimeout(init, Math.min(ms + 1500, 2147483000));
  }

  // a phone or laptop that slept through 05:00 checks again when the page is shown
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && current && SS.dayKey() !== current) init();
    });
  }

  async function get(store, key) {
    const v = await idbGet(store, key);
    if (v !== undefined && v !== null) return v;
    return mem.has(`${store}|${key}`) ? mem.get(`${store}|${key}`) : null;
  }
  async function put(store, key, value) {
    mem.set(`${store}|${key}`, value);
    if (current && SS.dayKey() !== current) await init(); // never write into a finished day
    await idbPut(store, key, value);
  }

  window.DayCache = {
    init,
    /** fn(newDay) is called when 05:00 passes while the page is open */
    onNewDay(fn) {
      listeners.push(fn);
    },
    getPayload: (kind, date) => get('payloads', `${kind}|${date}`),
    putPayload: (kind, date, value) => put('payloads', `${kind}|${date}`, value),
    getReport: (league, id) => get('reports', `${league}|${id}`),
    putReport: (league, id, report) => put('reports', `${league}|${id}`, { ...report, savedInBrowserAt: new Date().toISOString() }),
    available: () => available,
    day: () => current,
  };
})();
