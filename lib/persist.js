'use strict';

/**
 * persist.js — keep the track records when the host's disk is wiped (opt-in).
 *
 * Render's free tier (and hosts like it) start every deploy, restart and wake-up from sleep on an
 * empty disk, so the Strongest Picks record, the safe slips, the bet builders and the High Banker
 * ledger were lost every time and the site could never show its own live record. With two
 * environment variables set, those records are mirrored to a branch of a GitHub repository:
 *
 *   SHARPSHOOTER_RECORDS_REPO    owner/repo the records go to (e.g. your own sharpshooter repo)
 *   SHARPSHOOTER_RECORDS_TOKEN   a fine-grained GitHub token for THAT repository only, with
 *                                "Contents: read and write" and nothing else
 *   SHARPSHOOTER_RECORDS_BRANCH  optional, default "records" (created from the default branch
 *                                if missing; never the branch the host deploys from, so a record
 *                                write never triggers a redeploy)
 *
 * What is mirrored (one JSON file per source and month under records/ on that branch):
 *   strongest   the Strongest Picks, the day's safe slip and the bet builders (not the nine
 *               match-card picks of every match: too many to mirror, and not part of any record
 *               the site claims)
 *   ledger      the High Banker legs and slips and each fixture's headline methodology pick
 *
 * On start, restore() merges the mirrored entries into the local month files (first write wins:
 * the earlier recording of an entry is kept, and a settled copy replaces an unsettled one of the
 * same recording). Every write to a month file marks it; flush() pushes the marked files at most
 * every C.flushSeconds. Never throws; without the variables it does nothing at all. The token is
 * only ever sent to api.github.com and never logged or returned by the API.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const espn = require('./espn');

const C = {
  flushSeconds: 120,
  timeoutMs: 20000,
  dir: 'records',
  sources: {
    strongest: { dir: 'strongest', prefix: 'strongest-', kinds: new Set(['pick', 'slip', 'builder']) },
    ledger: { dir: 'ledger', prefix: 'ledger-', kinds: new Set(['banker', 'acca', 'headline']) },
  },
};

const API = 'https://api.github.com';
const env = () => ({
  repo: (process.env.SHARPSHOOTER_RECORDS_REPO || '').trim(),
  token: (process.env.SHARPSHOOTER_RECORDS_TOKEN || '').trim(),
  branch: (process.env.SHARPSHOOTER_RECORDS_BRANCH || 'records').trim(),
});

const state = {
  restored: false,
  restoredFiles: 0,
  restoredEntries: 0,
  lastFlush: null,
  pushed: 0,
  error: null,
  dirty: new Set(), // `${source}|${ym}`
  sha: new Map(), // remote path -> blob sha
  pushedHash: new Map(), // remote path -> hash of the content last pushed or restored
  branchReady: false,
  timer: null,
  flushing: null,
};

function enabled() {
  const e = env();
  return /^[\w.-]+\/[\w.-]+$/.test(e.repo) && e.token.length >= 20;
}

function localFile(source, ym) {
  const s = C.sources[source];
  return path.join(espn.DATA_DIR, s.dir, `${s.prefix}${ym}.json`);
}
const remotePath = (source, ym) => `${C.dir}/${C.sources[source].prefix}${ym}.json`;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file);
}

/** The entries of a month file that are mirrored. */
function mirrored(source, book) {
  const kinds = C.sources[source].kinds;
  const out = {};
  for (const [id, e] of Object.entries(book || {})) if (e && kinds.has(e.kind)) out[id] = e;
  return out;
}

const settledOf = (e) => e && (e.hit === 0 || e.hit === 1 || e.result != null);

/**
 * Merge mirrored entries into a local book. First write wins: an entry recorded earlier is kept;
 * for the same recording, the settled copy wins.
 * @returns {number} entries added or replaced
 */
function merge(local, remote) {
  let n = 0;
  for (const [id, r] of Object.entries(remote || {})) {
    const l = local[id];
    if (!l) {
      local[id] = r;
      n++;
      continue;
    }
    const lt = Date.parse(l.recordedAt || '') || Infinity;
    const rt = Date.parse(r.recordedAt || '') || Infinity;
    if (rt < lt || (rt === lt && !settledOf(l) && settledOf(r))) {
      local[id] = r;
      n++;
    }
  }
  return n;
}

async function gh(method, url, body) {
  const e = env();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), C.timeoutMs);
  try {
    const res = await fetch(url.startsWith('http') ? url : API + url, {
      method,
      headers: {
        authorization: `Bearer ${e.token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'sharpshooter-records',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

const repoUrl = () => `/repos/${env().repo}`;
const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

/** Make sure the records branch exists (created from the repository's default branch). */
async function ensureBranch() {
  if (state.branchReady) return true;
  const { branch } = env();
  const got = await gh('GET', `${repoUrl()}/git/ref/heads/${encodeURIComponent(branch)}`);
  if (got.status === 200) {
    state.branchReady = true;
    return true;
  }
  if (got.status !== 404) throw new Error(`GitHub ${got.status} reading the ${branch} branch`);
  const repo = await gh('GET', repoUrl());
  if (repo.status !== 200 || !repo.data || !repo.data.default_branch) throw new Error(`GitHub ${repo.status} reading the repository`);
  const base = await gh('GET', `${repoUrl()}/git/ref/heads/${encodeURIComponent(repo.data.default_branch)}`);
  if (base.status !== 200 || !base.data || !base.data.object) throw new Error(`GitHub ${base.status} reading ${repo.data.default_branch}`);
  const made = await gh('POST', `${repoUrl()}/git/refs`, { ref: `refs/heads/${branch}`, sha: base.data.object.sha });
  if (made.status !== 201 && made.status !== 422) throw new Error(`GitHub ${made.status} creating the ${branch} branch`);
  state.branchReady = true;
  return true;
}

const hashOf = (s) => crypto.createHash('sha1').update(s).digest('hex');

/** Download the mirrored records and merge them into the local month files. */
async function restore() {
  if (!enabled()) return { enabled: false };
  try {
    await ensureBranch();
    const { branch } = env();
    const list = await gh('GET', `${repoUrl()}/contents/${enc(C.dir)}?ref=${encodeURIComponent(branch)}`);
    if (list.status === 404) {
      state.restored = true;
      return { enabled: true, files: 0, entries: 0 };
    }
    if (list.status !== 200 || !Array.isArray(list.data)) throw new Error(`GitHub ${list.status} listing ${C.dir}/`);
    let files = 0;
    let entries = 0;
    for (const f of list.data) {
      const src = Object.keys(C.sources).find((k) => f.name.startsWith(C.sources[k].prefix));
      const m = /(\d{4}-\d{2})\.json$/.exec(f.name);
      if (!src || !m || f.type !== 'file') continue;
      const got = await gh('GET', `${repoUrl()}/contents/${enc(f.path)}?ref=${encodeURIComponent(branch)}`);
      if (got.status !== 200 || !got.data) continue;
      let text = null;
      if (got.data.content && got.data.encoding === 'base64') text = Buffer.from(got.data.content, 'base64').toString('utf8');
      else if (got.data.download_url) {
        // files over 1 MB come without content: fetch the blob instead
        const blob = await gh('GET', `${repoUrl()}/git/blobs/${got.data.sha}`);
        if (blob.status === 200 && blob.data && blob.data.content) text = Buffer.from(blob.data.content, 'base64').toString('utf8');
      }
      if (text == null) continue;
      let remote;
      try {
        remote = JSON.parse(text);
      } catch {
        continue;
      }
      state.sha.set(f.path, got.data.sha);
      state.pushedHash.set(f.path, hashOf(JSON.stringify(remote)));
      const file = localFile(src, m[1]);
      const local = readJson(file) || {};
      const n = merge(local, remote);
      if (n) writeJson(file, local);
      // entries recorded here before the restore finished go up with the next flush
      if (hashOf(JSON.stringify(mirrored(src, local))) !== state.pushedHash.get(f.path)) touch(src, m[1]);
      files++;
      entries += n;
    }
    state.restored = true;
    state.restoredFiles = files;
    state.restoredEntries = entries;
    state.error = null;
    return { enabled: true, files, entries };
  } catch (err) {
    state.error = String((err && err.message) || err);
    return { enabled: true, error: state.error };
  }
}

/** A month file of a mirrored source changed: push it with the next flush. */
function touch(source, ym) {
  if (!enabled() || !C.sources[source] || !/^\d{4}-\d{2}$/.test(ym)) return;
  state.dirty.add(`${source}|${ym}`);
  if (!state.timer) {
    state.timer = setTimeout(() => {
      state.timer = null;
      flush().catch(() => null);
    }, C.flushSeconds * 1000);
    if (state.timer.unref) state.timer.unref();
  }
}

/** Push every marked month file whose mirrored entries changed. */
async function flush() {
  if (!enabled()) return 0;
  if (state.flushing) return state.flushing;
  state.flushing = (async () => {
    let pushed = 0;
    try {
      await ensureBranch();
      const { branch } = env();
      for (const key of [...state.dirty]) {
        state.dirty.delete(key);
        const [source, ym] = key.split('|');
        const book = mirrored(source, readJson(localFile(source, ym)) || {});
        const rp = remotePath(source, ym);
        const text = JSON.stringify(book);
        const h = hashOf(text);
        if (state.pushedHash.get(rp) === h) continue;
        if (!Object.keys(book).length && !state.sha.has(rp)) continue;
        for (let attempt = 0; attempt < 2; attempt++) {
          if (!state.sha.has(rp)) {
            const cur = await gh('GET', `${repoUrl()}/contents/${enc(rp)}?ref=${encodeURIComponent(branch)}`);
            if (cur.status === 200 && cur.data && cur.data.sha) {
              state.sha.set(rp, cur.data.sha);
              // someone else's copy (another instance) is merged in before overwriting it
              if (cur.data.content) {
                try {
                  const remote = JSON.parse(Buffer.from(cur.data.content, 'base64').toString('utf8'));
                  const file = localFile(source, ym);
                  const local = readJson(file) || {};
                  if (merge(local, remote)) writeJson(file, local);
                } catch {
                  /* keep ours */
                }
              }
            }
          }
          const body = mirrored(source, readJson(localFile(source, ym)) || {});
          const out = JSON.stringify(body);
          const put = await gh('PUT', `${repoUrl()}/contents/${enc(rp)}`, {
            message: `records: ${source} ${ym}`,
            content: Buffer.from(out).toString('base64'),
            branch,
            ...(state.sha.has(rp) ? { sha: state.sha.get(rp) } : {}),
          });
          if (put.status === 200 || put.status === 201) {
            state.sha.set(rp, put.data && put.data.content ? put.data.content.sha : state.sha.get(rp));
            state.pushedHash.set(rp, hashOf(out));
            pushed++;
            break;
          }
          if (put.status === 409 || put.status === 422) {
            state.sha.delete(rp); // stale sha: read it again and retry once
            continue;
          }
          throw new Error(`GitHub ${put.status} writing ${rp}`);
        }
      }
      state.lastFlush = new Date().toISOString();
      state.pushed += pushed;
      state.error = null;
    } catch (err) {
      state.error = String((err && err.message) || err);
    } finally {
      state.flushing = null;
    }
    return pushed;
  })();
  return state.flushing;
}

/** Public status (never the token). */
function status() {
  const e = env();
  return {
    enabled: enabled(),
    repo: enabled() ? e.repo : null,
    branch: enabled() ? e.branch : null,
    restored: state.restored,
    restoredFiles: state.restoredFiles,
    restoredEntries: state.restoredEntries,
    lastFlush: state.lastFlush,
    pushed: state.pushed,
    pending: state.dirty.size,
    error: state.error,
  };
}

function _reset() {
  if (state.timer) clearTimeout(state.timer);
  Object.assign(state, {
    restored: false, restoredFiles: 0, restoredEntries: 0, lastFlush: null, pushed: 0, error: null,
    dirty: new Set(), sha: new Map(), pushedHash: new Map(), branchReady: false, timer: null, flushing: null,
  });
}

module.exports = { enabled, restore, touch, flush, status, merge, mirrored, C, _reset };
