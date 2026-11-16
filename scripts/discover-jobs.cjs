#!/usr/bin/env node
// Job discovery from the command line, until the app has its Discovery screen.
//
//   node scripts/discover-jobs.cjs discover [--crawls 4]     find boards in Common Crawl (free, slow, resumable)
//   node scripts/discover-jobs.cjs add <job or board URL>     register one board
//   node scripts/discover-jobs.cjs sync [--limit 200]         collect jobs from registered boards
//   node scripts/discover-jobs.cjs match [--profile Tony] [--top 20] [--days 30] [--min 55] [--csv file]
//   node scripts/discover-jobs.cjs stats
//
// Data: discovery.db next to profiles.json in the app's data folder
// (%APPDATA%/Resume Manager), or --data <folder>.
process.removeAllListeners('warning');
process.on('warning', warning => {if (!/SQLite/i.test(warning.message)) console.warn(warning.message);});
const fs = require('node:fs');
const path = require('node:path');
const { openStore } = require('../src/discovery/store');
const { createHttp } = require('../src/discovery/http');
const { syncBoards } = require('../src/discovery/collect');
const { detectSource } = require('../src/discovery/providers');
const { discoverBoards } = require('../src/discovery/sources/commoncrawl');
const { profileTargets, rankJobs } = require('../src/discovery/fit');

const args = process.argv.slice(2);
const command = args[0];
const option = (name, fallback) => {const index = args.indexOf(`--${name}`);return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;};
const dataDir = option('data', path.join(process.env.APPDATA || path.join(require('node:os').homedir(), '.config'), 'Resume Manager'));

function profiles() {
  const file = path.join(dataDir, 'profiles.json');
  if (!fs.existsSync(file)) throw new Error(`No profiles found at ${file}. Use --data <folder>.`);
  return JSON.parse(fs.readFileSync(file, 'utf8')).map(profile => {
    const resumeFile = path.join(dataDir, 'resumes', `${profile.id}.json`);
    let resume = null;
    try {resume = JSON.parse(fs.readFileSync(resumeFile, 'utf8'));} catch (_) { /* no saved resume */ }
    return { profile, resume };
  });
}
const money = job => job.salaryMin == null ? '' : ` | ${job.salaryCurrency || ''} ${Math.round(job.salaryMin).toLocaleString('en-US')}${job.salaryMax ? '-' + Math.round(job.salaryMax).toLocaleString('en-US') : ''}${job.salaryPeriod && job.salaryPeriod !== 'unknown' ? '/' + job.salaryPeriod : ''}`;
const csvCell = value => `"${String(value ?? '').replace(/"/g, '""')}"`;

async function main() {
  const store = openStore(path.join(dataDir, 'discovery.db'));
  try {
    if (command === 'discover') {
      // One request at a time with long backoff: the index is a shared free service.
      const http = createHttp({ perHost: 1, minIntervalMs: 1500, retries: 5, timeoutMs: 180000, log: message => console.log('  ' + message) });
      const summary = await discoverBoards({ http, store, crawls: Number(option('crawls', 4)), onProgress: item => {
        console.log(item.error ? `  ${item.crawl} ${item.pattern} page ${item.page ?? '-'}: ${item.error} (will retry next run)` : `  ${item.crawl} ${item.pattern} page ${item.page + 1}/${item.pages}: ${item.found} boards, ${item.added} new`);
      } });
      console.log(`Done: ${summary.added} new boards (${summary.found} seen, ${summary.skipped} pages already done, ${summary.failed} failed and left for the next run).`);
    } else if (command === 'add') {
      const found = detectSource(args[1] || '');
      if (!found) throw new Error('Not a Greenhouse, Lever or Ashby URL.');
      const board = store.addBoard({ ...found, url: args[1] });
      console.log(`Registered ${board.id}. Run "sync" to collect its jobs.`);
    } else if (command === 'sync') {
      const limit = Number(option('limit', 0)) || undefined;
      const boards = store.boardsToSync({ freshHours: Number(option('fresh', 2)) }).slice(0, limit);
      const http = createHttp({ perHost: 6, minIntervalMs: 100 });
      console.log(`Syncing ${boards.length} boards...`);
      const results = await syncBoards(store, http, boards, { concurrency: 16, onProgress: ({ done, total, result }) => {
        if (done % 25 === 0 || !result.ok && result.status !== 404) console.log(`  ${done}/${total} ${result.board}: ${result.ok ? `${result.fetched} jobs (+${result.inserted})` : result.error}`);
      } });
      const ok = results.filter(result => result.ok), gone = results.filter(result => result.status === 404);
      console.log(`Done: ${ok.length} boards collected, ${gone.length} no longer exist (switched off), ${results.length - ok.length - gone.length} failed. +${ok.reduce((sum, r) => sum + r.inserted, 0)} new jobs, ${ok.reduce((sum, r) => sum + r.expired, 0)} expired.`);
    } else if (command === 'match') {
      const wanted = option('profile', null), top = Number(option('top', 20)), days = Number(option('days', 30)) || null, minScore = Number(option('min', 55));
      const jobs = store.listJobs();
      const rows = [];
      for (const { profile, resume } of profiles()) {
        if (wanted && !`${profile.firstName} ${profile.lastName}`.toLowerCase().includes(wanted.toLowerCase())) continue;
        const targets = profileTargets(profile, resume);
        const ranked = rankJobs(jobs, targets, { minScore, days, limit: top });
        console.log(`\n== ${targets.name}: ${ranked.length} matches (titles: ${targets.titles.slice(0, 3).join('; ') || 'none'}; ${targets.skills.length} skills; ${targets.years ?? '?'} yrs; home ${targets.homeState || '?'})`);
        if (!targets.titles.length) console.log('   This profile has no job titles. Add a title to the profile or save a resume with titles.');
        for (const { job, fit } of ranked) {
          console.log(`  ${String(fit.score).padStart(3)}  ${job.title} | ${job.companyName || job.board} | ${job.locationText || '?'}${money(job)} | ${job.publishedAt ? job.publishedAt.slice(0, 10) : 'date ?'}\n       ${job.sourceUrl}\n       ${fit.reasons.join(' | ')}`);
          rows.push([targets.name, fit.score, job.title, job.companyName || job.board, job.locationText, job.remoteScope || '', job.salaryMin ?? '', job.salaryMax ?? '', job.salaryCurrency || '', job.publishedAt || '', job.sourceUrl, job.verification, fit.reasons.join(' | ')]);
        }
      }
      const csv = option('csv', null);
      if (csv) {
        fs.writeFileSync(csv, [['profile', 'score', 'title', 'company', 'location', 'remote_scope', 'salary_min', 'salary_max', 'currency', 'published', 'url', 'verification', 'why'], ...rows].map(row => row.map(csvCell).join(',')).join('\n'));
        console.log(`\nWrote ${rows.length} rows to ${csv}`);
      }
    } else if (command === 'stats') {
      console.log(store.stats());
      console.table(store.db.prepare(`SELECT provider, origin, COUNT(*) AS boards, SUM(active) AS active, SUM(job_count) AS jobs FROM boards GROUP BY provider, origin`).all().map(row => ({ ...row })));
    } else {
      console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 12).join('\n').replace(/^\/\/ ?/gm, ''));
    }
  } finally {store.close();}
}

main().catch(error => {console.error(error.message);process.exit(1);});
