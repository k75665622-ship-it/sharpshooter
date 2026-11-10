'use strict';

/**
 * test/persist_unit.js — the opt-in record mirror (lib/persist.js), offline.
 *
 *   node test/persist_unit.js
 *
 * Stubs the GitHub REST API in memory: branches, refs and the contents endpoints.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-persist-'));
process.env.SHARPSHOOTER_DATA_DIR = TMP;
delete process.env.SHARPSHOOTER_RECORDS_REPO;
delete process.env.SHARPSHOOTER_RECORDS_TOKEN;

const PERSIST = require('../lib/persist');
const REC = require('../lib/strongest/record');

let pass = 0;
let fail = 0;
function t(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail != null ? ' — ' + detail : ''}`);
  }
}

// ------------------------------------------------------------------ a GitHub API in memory
const TOKEN = 'github_pat_TEST_0123456789abcdefghij';
const GH = { refs: { main: 'c0ffee' }, files: new Map(), calls: [], conflictOnce: false, seq: 0 };
const realFetch = global.fetch;
global.fetch = async (input, init = {}) => {
  const u = new URL(String(input));
  const method = (init.method || 'GET').toUpperCase();
  const reply = (status, body) => new Response(body == null ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  GH.calls.push({ method, path: u.pathname, auth: init.headers && init.headers.authorization });
  if (u.hostname !== 'api.github.com') return reply(599, { message: 'not GitHub' });
  if (!init.headers || init.headers.authorization !== `Bearer ${TOKEN}`) return reply(401, { message: 'Bad credentials' });
  const base = '/repos/me/sharpshooter';
  const p = u.pathname;
  if (p === base && method === 'GET') return reply(200, { default_branch: 'main' });
  let m;
  if ((m = /^\/repos\/me\/sharpshooter\/git\/ref\/heads\/(.+)$/.exec(p)) && method === 'GET') {
    const b = decodeURIComponent(m[1]);
    return GH.refs[b] ? reply(200, { object: { sha: GH.refs[b] } }) : reply(404, { message: 'Not Found' });
  }
  if (p === `${base}/git/refs` && method === 'POST') {
    const body = JSON.parse(init.body);
    GH.refs[body.ref.replace('refs/heads/', '')] = body.sha;
    return reply(201, { ref: body.ref });
  }
  if ((m = /^\/repos\/me\/sharpshooter\/contents\/(.+)$/.exec(p))) {
    const fp = decodeURIComponent(m[1]);
    if (method === 'GET') {
      if (fp === 'records') {
        const list = [...GH.files.keys()].filter((k) => k.startsWith('records/')).map((k) => ({ name: k.slice(8), path: k, type: 'file', sha: GH.files.get(k).sha }));
        return list.length ? reply(200, list) : reply(404, { message: 'Not Found' });
      }
      const f = GH.files.get(fp);
      return f ? reply(200, { sha: f.sha, encoding: 'base64', content: Buffer.from(f.text).toString('base64') }) : reply(404, { message: 'Not Found' });
    }
    if (method === 'PUT') {
      const body = JSON.parse(init.body);
      const f = GH.files.get(fp);
      if (GH.conflictOnce) {
        GH.conflictOnce = false;
        return reply(409, { message: 'sha does not match' });
      }
      if (f && body.sha !== f.sha) return reply(409, { message: 'sha does not match' });
      if (!f && body.sha) return reply(422, { message: 'sha given for a new file' });
      if (body.branch !== 'records') return reply(422, { message: 'wrong branch' });
      const sha = `s${++GH.seq}`;
      GH.files.set(fp, { sha, text: Buffer.from(body.content, 'base64').toString('utf8') });
      return reply(f ? 200 : 201, { content: { sha } });
    }
  }
  return reply(404, { message: 'Not Found' });
};

const iso = (ms) => new Date(ms).toISOString();
const future = iso(Date.now() + 3 * 3600 * 1000);
const day = {
  date: future.slice(0, 10),
  picks: [
    { match: { id: 'm1', league: 'eng.1', leagueName: 'Premier League', date: future, home: { name: 'Arsenal' }, away: { name: 'Everton' } }, pick: { key: '1X', group: 'Match', label: 'Arsenal or draw', prob: 0.91, floor: 0.88, views: {}, tier: 'Elite' } },
    { match: { id: 'm2', league: 'eng.1', leagueName: 'Premier League', date: future, home: { name: 'Leeds' }, away: { name: 'Fulham' } }, pick: { key: 'TTH_O0.5', group: 'Team', label: 'Leeds to score', prob: 0.89, floor: 0.85, views: {}, tier: 'Strong' } },
  ],
  slips: [{ id: 'safe', size: 2, prob: 0.81, fairOdds: 1.235, legs: [{ fixture: 'm1', key: '1X' }, { fixture: 'm2', key: 'TTH_O0.5' }] }],
  matches: [{ started: false, match: { id: 'm1', league: 'eng.1', date: future, home: { name: 'Arsenal' }, away: { name: 'Everton' } }, cards: [{ group: 'Goals', key: 'O1.5', label: 'Over 1.5', prob: 0.8, floor: 0.75, views: {} }] }],
};
const ym = future.slice(0, 7);
const localFile = path.join(TMP, 'strongest', `strongest-${ym}.json`);
const remoteFile = `records/strongest-${ym}.json`;

(async () => {
  try {
    console.log('\n1. Off unless both variables are set');
    t('disabled without the variables', !PERSIST.enabled());
    t('restore does nothing', (await PERSIST.restore()).enabled === false && GH.calls.length === 0);
    REC.record(day);
    t('recording works as before and nothing is sent', fs.existsSync(localFile) && GH.calls.length === 0 && (await PERSIST.flush()) === 0);

    console.log('\n2. Mirroring to the records branch');
    process.env.SHARPSHOOTER_RECORDS_REPO = 'me/sharpshooter';
    process.env.SHARPSHOOTER_RECORDS_TOKEN = TOKEN;
    PERSIST._reset();
    PERSIST.C.flushSeconds = 3600; // flushed by hand below
    t('enabled with a repository and a token', PERSIST.enabled());
    const r0 = await PERSIST.restore();
    t('the records branch is created from the default branch', GH.refs.records === 'c0ffee' && r0.files === 0 && !r0.error, JSON.stringify(r0));
    PERSIST.touch('strongest', ym);
    const n1 = await PERSIST.flush();
    const remote = GH.files.get(remoteFile);
    const kinds = remote ? Object.values(JSON.parse(remote.text)).map((e) => e.kind).sort().join(',') : '';
    t('the month file is pushed', n1 === 1 && !!remote, n1);
    t('only the Strongest Picks and the safe slip are mirrored, not the nine match-card picks', kinds === 'pick,pick,slip', kinds);
    t('nothing changed -> nothing pushed', (await PERSIST.flush()) === 0);
    t('the token goes to api.github.com only and never into the status', GH.calls.every((c) => c.auth === `Bearer ${TOKEN}`) && !JSON.stringify(PERSIST.status()).includes(TOKEN));
    t('status reports the repository, branch and pushes', PERSIST.status().repo === 'me/sharpshooter' && PERSIST.status().branch === 'records' && PERSIST.status().pushed === 1);

    console.log('\n3. A wiped disk gets its record back');
    fs.rmSync(path.join(TMP, 'strongest'), { recursive: true, force: true });
    t('the local record is gone', REC.all().length === 0);
    PERSIST._reset();
    const r1 = await PERSIST.restore();
    const back = REC.all();
    t('restore brings back the picks and the slip', r1.files === 1 && back.filter((e) => e.kind === 'pick').length === 2 && back.some((e) => e.kind === 'slip'), JSON.stringify(r1));
    t('the record summary reads them again', REC.summary().current.pending === 2 || REC.summary().picks.pending === 2, JSON.stringify(REC.summary().picks));

    console.log('\n4. Merging: first write wins, a settled copy wins');
    const A = { x: { kind: 'pick', recordedAt: '2026-11-08T08:00:00Z', hit: null, result: null, key: '1X' } };
    const later = { x: { kind: 'pick', recordedAt: '2026-11-08T09:00:00Z', hit: null, result: null, key: 'O1.5' } };
    const settled = { x: { kind: 'pick', recordedAt: '2026-11-08T08:00:00Z', hit: 1, result: '2-0', key: '1X' } };
    const a1 = JSON.parse(JSON.stringify(A));
    t('a later recording of the same entry does not replace the first', PERSIST.merge(a1, later) === 0 && a1.x.key === '1X');
    const a2 = JSON.parse(JSON.stringify(later));
    t('an earlier recording replaces a later one', PERSIST.merge(a2, A) === 1 && a2.x.key === '1X');
    const a3 = JSON.parse(JSON.stringify(A));
    t('the settled copy of the same recording wins', PERSIST.merge(a3, settled) === 1 && a3.x.hit === 1);
    const a4 = JSON.parse(JSON.stringify(settled));
    t('an unsettled copy never undoes a result', PERSIST.merge(a4, A) === 0 && a4.x.hit === 1);
    t('only the mirrored kinds are kept', Object.keys(PERSIST.mirrored('strongest', { a: { kind: 'pick' }, b: { kind: 'card' }, c: { kind: 'builder' } })).join(',') === 'a,c');

    console.log('\n5. A stale copy on GitHub');
    const book = JSON.parse(fs.readFileSync(localFile, 'utf8'));
    book['m1|pick'].hit = 1;
    book['m1|pick'].result = '2-0';
    fs.writeFileSync(localFile, JSON.stringify(book));
    GH.conflictOnce = true;
    PERSIST.touch('strongest', ym);
    const n2 = await PERSIST.flush();
    const after = JSON.parse(GH.files.get(remoteFile).text);
    t('a rejected write reads the file again and retries once', n2 === 1 && after['m1|pick'].hit === 1 && !PERSIST.status().error, PERSIST.status().error);
    process.env.SHARPSHOOTER_RECORDS_TOKEN = 'github_pat_WRONG_0123456789abcdefghij';
    PERSIST._reset();
    const bad = await PERSIST.restore();
    t('a bad token is reported, not thrown', !!bad.error && /401/.test(bad.error), JSON.stringify(bad));

    console.log('\n6. No token: the scheduled backup saves, the site reads the public branch');
    delete process.env.SHARPSHOOTER_RECORDS_TOKEN;
    delete process.env.SHARPSHOOTER_RECORDS_REPO;
    PERSIST._reset();
    t('off without a token or a repository', PERSIST.mode() === 'off' && (await PERSIST.restore()).enabled === false);
    const exported = PERSIST.exportAll();
    const expKinds = Object.values(exported.files[`strongest-${ym}.json`] || {}).map((e) => e.kind).sort().join(',');
    t('the export holds the mirrored entries only (what GET /api/records/export returns)', expKinds === 'pick,pick,slip' && !!exported.generatedAt, expKinds);
    // the backup tool merges the export into the folder of the records branch
    const BK = require('../tools/records_backup');
    const dir = path.join(TMP, 'branch', 'records');
    const s1 = BK.save(dir, exported);
    const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
    t('the backup writes the month files and an index', s1.changed && index.files.includes(`strongest-${ym}.json`) && fs.existsSync(path.join(dir, `strongest-${ym}.json`)), JSON.stringify(index));
    t('the same records again change nothing (no empty commits)', BK.save(dir, exported).changed === false);
    const wiped = BK.save(dir, { files: { [`strongest-${ym}.json`]: {} } });
    const kept = JSON.parse(fs.readFileSync(path.join(dir, `strongest-${ym}.json`), 'utf8'));
    t('a site that has just been wiped does not erase the saved record', wiped.changed === false && Object.keys(kept).length === 3);
    t('a file name that is not a record is ignored', BK.save(dir, { files: { '../../evil.json': { a: 1 }, 'notes.json': { a: 1 } } }).changed === false && !fs.existsSync(path.join(TMP, 'evil.json')));
    // the site, restarted on an empty disk, reads the public branch (Render names the repository itself)
    fs.rmSync(path.join(TMP, 'strongest'), { recursive: true, force: true });
    process.env.RENDER_GIT_REPO_SLUG = 'me/sharpshooter';
    PERSIST._reset();
    const before = GH.calls.length;
    const prevFetch = global.fetch;
    const rawCalls = [];
    global.fetch = async (input, init) => {
      const u = new URL(String(input));
      if (u.hostname !== 'raw.githubusercontent.com') return prevFetch(input, init);
      rawCalls.push(u.pathname);
      const m = /^\/me\/sharpshooter\/records\/records\/(.+)$/.exec(u.pathname);
      const file = m ? path.join(dir, m[1]) : null;
      if (!file || !fs.existsSync(file)) return new Response('404: Not Found', { status: 404 });
      return new Response(fs.readFileSync(file, 'utf8'), { status: 200 });
    };
    t('read mode: a public repository needs no token', PERSIST.mode() === 'read' && PERSIST.status().repo === 'me/sharpshooter' && PERSIST.status().enabled === false);
    const r2 = await PERSIST.restore();
    t('the wiped site gets its picks and slip back from the public branch', r2.mode === 'read' && r2.files === 1 && r2.entries === 3 && REC.all().filter((e) => e.kind === 'pick').length === 2, JSON.stringify(r2));
    t('it read the index and the month file, nothing else', rawCalls.length === 2 && rawCalls[0].endsWith('/index.json'), rawCalls.join(' '));
    PERSIST.touch('strongest', ym);
    t('read mode never writes to GitHub (the scheduled backup does)', (await PERSIST.flush()) === 0 && GH.calls.length === before);
    global.fetch = async () => new Response('404: Not Found', { status: 404 });
    PERSIST._reset();
    const none = await PERSIST.restore();
    t('no saved record yet -> nothing restored, no error', none.files === 0 && !none.error, JSON.stringify(none));
    delete process.env.RENDER_GIT_REPO_SLUG;
    PERSIST._reset();
    t('off the host, no repository is assumed', PERSIST.mode() === 'off');
    process.env.RENDER = 'true';
    t('on Render without the variable, package.json names the repository', PERSIST.mode() === 'read' && /^[\w.-]+\/[\w.-]+$/.test(PERSIST.publicRepo()), String(PERSIST.publicRepo()));
    delete process.env.RENDER;
    global.fetch = prevFetch;
    delete process.env.RENDER_GIT_REPO_SLUG;
  } catch (err) {
    t('persist test completed', false, err.stack);
  } finally {
    global.fetch = realFetch;
    fs.rmSync(TMP, { recursive: true, force: true });
    console.log('\n=========================================================');
    console.log(` ${pass} passed, ${fail} failed`);
    console.log('=========================================================');
    process.exit(fail ? 1 : 0);
  }
})();
