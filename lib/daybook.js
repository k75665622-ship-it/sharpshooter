'use strict';

/**
 * daybook.js — the server's 24-hour prediction store.
 *
 * A prediction day runs from 05:00 to 05:00 Ghana time (Africa/Accra; change with
 * DAYBOOK_TZ / DAYBOOK_RESET_HOUR). Everything saved during the day lives in
 * data/daybook/<day>/ and the whole folder is deleted when the next day starts.
 *
 *   reports/<league>_<id>.json   the full pre-match analysis of a fixture, overwritten while the
 *                                match is still to play and FROZEN once it kicks off — so a played
 *                                match keeps the prediction that was made before it started
 *   <kind>-<date>.json           the last /api/predictions or /api/strongest answer for a date,
 *                                so a returning visitor gets it instantly
 *
 * Memory holds the same with a small LRU; disk lets it survive a restart. (On hosts whose
 * disk is wiped on restart, the browser's own day database — public/daycache.js — keeps
 * the day on the visitor's device.)
 */

const fs = require('fs');
const path = require('path');
const espn = require('./espn');
const SS = require('../public/shared.js');

const ROOT = path.join(espn.DATA_DIR, 'daybook');
const CFG = {
  tz: process.env.DAYBOOK_TZ || 'Africa/Accra',
  hour: process.env.DAYBOOK_RESET_HOUR != null && process.env.DAYBOOK_RESET_HOUR !== '' ? Number(process.env.DAYBOOK_RESET_HOUR) : 5,
};
const MEM_REPORTS = 240;

let active = null;
const mem = { reports: new Map(), payloads: new Map() };

function dayKey(ms) {
  return SS.dayKey(ms == null ? Date.now() : ms, CFG);
}
function dir() {
  return path.join(ROOT, active);
}
const safe = (s) => String(s).replace(/[^a-zA-Z0-9._-]/g, '_');

/** Switch to the current day, deleting every earlier day. Called on every access. */
function ensureDay() {
  const k = dayKey();
  if (k === active) return k;
  active = k;
  mem.reports.clear();
  mem.payloads.clear();
  try {
    for (const d of fs.readdirSync(ROOT)) if (d !== k) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
  } catch {
    /* nothing stored yet */
  }
  return k;
}

function writeJson(file, obj) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, file);
    return true;
  } catch {
    return false;
  }
}
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- reports
const reportFile = (league, id) => path.join(dir(), 'reports', `${safe(league)}_${safe(id)}.json`);

/**
 * Save a fixture's analysis — only while the match is still to play. Once it kicks
 * off, the saved report is the one that stands.
 * @returns {boolean} saved
 */
function saveReport(report) {
  ensureDay();
  if (!report || !report.match || !report.match.id) return false;
  const m = report.match;
  if (m.state && m.state !== 'pre') return false;
  if (Date.parse(m.date) <= Date.now()) return false;
  const entry = { savedAt: Date.now(), report };
  mem.reports.set(`${m.league}|${m.id}`, entry);
  if (mem.reports.size > MEM_REPORTS) mem.reports.delete(mem.reports.keys().next().value);
  writeJson(reportFile(m.league, m.id), entry);
  return true;
}

/** @returns {{savedAt:number, report:object}|null} */
function getReport(league, id) {
  ensureDay();
  const k = `${league}|${id}`;
  if (mem.reports.has(k)) return mem.reports.get(k);
  const e = readJson(reportFile(league, id));
  if (e && e.report) {
    mem.reports.set(k, e);
    if (mem.reports.size > MEM_REPORTS) mem.reports.delete(mem.reports.keys().next().value);
    return e;
  }
  return null;
}

/** A saved report with the fixture's current state and score laid over it. */
function withLive(report, current) {
  if (!report || !current) return report;
  const m = report.match;
  const started = current.state && current.state !== 'pre';
  return {
    ...report,
    match: {
      ...m,
      state: current.state,
      completed: !!current.completed,
      statusDetail: current.statusDetail || m.statusDetail,
      clock: current.clock || null,
      home: { ...m.home, score: current.home ? current.home.score : m.home.score, winner: current.home ? !!current.home.winner : m.home.winner },
      away: { ...m.away, score: current.away ? current.away.score : m.away.score, winner: current.away ? !!current.away.winner : m.away.winner },
    },
    frozen: started ? { at: report.analysedAt || null, note: 'Prediction made before kick-off and kept unchanged.' } : null,
  };
}

// ---------------------------------------------------------------- payloads
const payloadFile = (kind, date) => path.join(dir(), `${safe(kind)}-${safe(date)}.json`);

function savePayload(kind, date, payload) {
  ensureDay();
  const entry = { savedAt: Date.now(), payload };
  mem.payloads.set(`${kind}|${date}`, entry);
  writeJson(payloadFile(kind, date), entry);
  return entry;
}

/** @returns {{savedAt:number, payload:object}|null} */
function getPayload(kind, date) {
  ensureDay();
  const k = `${kind}|${date}`;
  if (mem.payloads.has(k)) return mem.payloads.get(k);
  const e = readJson(payloadFile(kind, date));
  if (e && e.payload) {
    mem.payloads.set(k, e);
    return e;
  }
  return null;
}

function status() {
  ensureDay();
  let reports = 0;
  let payloads = [];
  try {
    reports = fs.readdirSync(path.join(dir(), 'reports')).length;
  } catch {
    /* none yet */
  }
  try {
    payloads = fs.readdirSync(dir()).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, ''));
  } catch {
    /* none yet */
  }
  return {
    day: active,
    timezone: CFG.tz,
    resetHour: CFG.hour,
    resetsAt: new Date(Date.now() + SS.msToReset(Date.now(), CFG)).toISOString(),
    reportsSaved: reports,
    payloads,
  };
}

function _reset() {
  active = null;
  mem.reports.clear();
  mem.payloads.clear();
}

module.exports = { CFG, ROOT, dayKey, ensureDay, saveReport, getReport, withLive, savePayload, getPayload, status, _reset };
