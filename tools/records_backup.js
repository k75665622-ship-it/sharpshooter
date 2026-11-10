'use strict';

/**
 * tools/records_backup.js — save the site's track records into a folder of the `records` branch.
 *
 *   node tools/records_backup.js --site https://your-site.onrender.com --dir records-branch/records
 *
 * Run by .github/workflows/records.yml through the day. It asks the site for its mirrored
 * records (GET /api/records/export), MERGES them into the files already saved (the earlier
 * recording of an entry is kept, a settled copy replaces an unsettled one — lib/persist.js merge),
 * and writes an index. Merging matters: after the host wipes its disk the site knows only what
 * it has recorded since, and a plain overwrite would throw the saved record away.
 *
 * Exit code 0 with "changed" or "unchanged" on the last line; 1 when the site cannot be read
 * (nothing is written then).
 */

const fs = require('fs');
const path = require('path');
const { merge } = require('../lib/persist');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function fetchExport(site, { tries = 6, waitMs = 20000, timeoutMs = 100000 } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`${site.replace(/\/+$/, '')}/api/records/export`, { headers: { 'user-agent': 'sharpshooter-records-backup' }, signal: ctl.signal });
      if (res.ok) {
        const data = await res.json();
        if (data && data.files && typeof data.files === 'object') return data;
        last = new Error('the site answered without a "files" object');
      } else last = new Error(`the site answered ${res.status}`);
    } catch (err) {
      last = err; // a sleeping host takes up to a minute to wake: try again
    } finally {
      clearTimeout(timer);
    }
    if (i < tries - 1) await new Promise((r) => setTimeout(r, waitMs));
  }
  throw last || new Error('the site could not be read');
}

/** Merge exported files into `dir`. @returns {{changed:boolean, files:number, entries:number}} */
function save(dir, exported) {
  fs.mkdirSync(dir, { recursive: true });
  let changed = false;
  let entries = 0;
  for (const [name, book] of Object.entries(exported.files || {})) {
    if (!/^(strongest|ledger)-\d{4}-\d{2}\.json$/.test(name) || !book || typeof book !== 'object') continue;
    const file = path.join(dir, name);
    let saved = {};
    try {
      saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      saved = {};
    }
    const n = merge(saved, book);
    if (n || !fs.existsSync(file)) {
      // sorted keys: the same record always writes the same file
      fs.writeFileSync(file, JSON.stringify(Object.fromEntries(Object.entries(saved).sort(([a], [b]) => (a < b ? -1 : 1)))));
      changed = true;
      entries += n;
    }
  }
  const files = fs.readdirSync(dir).filter((f) => /^(strongest|ledger)-\d{4}-\d{2}\.json$/.test(f)).sort();
  const index = JSON.stringify({ files });
  const indexFile = path.join(dir, 'index.json');
  let before = null;
  try {
    before = JSON.stringify({ files: JSON.parse(fs.readFileSync(indexFile, 'utf8')).files });
  } catch {
    before = null;
  }
  if (before !== index) {
    fs.writeFileSync(indexFile, index);
    changed = true;
  }
  return { changed, files: files.length, entries };
}

async function main() {
  const site = arg('site', process.env.SITE_URL);
  const dir = arg('dir', 'records');
  if (!site) throw new Error('--site (or SITE_URL) is required');
  const exported = await fetchExport(site);
  const r = save(dir, exported);
  console.log(`${Object.keys(exported.files).length} files from the site, ${r.entries} new or updated entries, ${r.files} files saved`);
  console.log(r.changed ? 'changed' : 'unchanged');
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`backup failed: ${(err && err.message) || err}`);
    process.exit(1);
  });
}

module.exports = { fetchExport, save };
