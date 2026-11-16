// Everything the Discovery screen asks for. Runs inside the discovery worker
// thread (see worker.js), so the app window never waits on SQLite or the network.
// Long tasks (finding boards, collecting jobs) run one at a time, report
// progress through `emit`, and can be stopped.
const { openStore } = require('./store');
const { createHttp } = require('./http');
const { syncBoards, loadDetails } = require('./collect');
const { detectSource } = require('./providers');
const { discoverBoards } = require('./sources/commoncrawl');
const { profileTargets, scoreJob, titleScore } = require('./fit');
const { verifyJob } = require('./verify');
const { VERIFICATION } = require('./normalize');

const DEFAULTS = { minScore: 55, days: 30, places: 'any', includeUnverified: true };
const clampNumber = (value, min, max, fallback) => {const number = Number(value);return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;};
// Trimmed, without blanks or repeats (the first spelling wins), at most `max`.
function cleanList(list, max) {
  const seen = new Map();
  for (const item of [].concat(list || []).map(value => String(value || '').trim())) {
    if (item && item.length <= 80 && !seen.has(item.toLowerCase())) seen.set(item.toLowerCase(), item);
  }
  return [...seen.values()].slice(0, max);
}

function createService({ dbPath, emit = () => {}, http: injectedHttp, discoveryHttp, now = () => new Date() }) {
  const store = openStore(dbPath);
  // Each provider's API is one host: up to 6 requests at a time to it, still backing off on 429.
  const http = injectedHttp || createHttp({ perHost: 6, minIntervalMs: 100 });
  // The Common Crawl index is a shared free service: one request at a time, patient retries.
  const indexHttp = discoveryHttp || createHttp({ perHost: 1, minIntervalMs: 1500, retries: 5, timeoutMs: 180000 });
  let task = null;

  function status() {
    const boards = store.db.prepare(`SELECT provider, COUNT(*) AS boards, SUM(active) AS active, SUM(last_success_at IS NOT NULL) AS synced FROM boards GROUP BY provider`).all().map(row => ({ ...row }));
    const recent = store.db.prepare(`SELECT status, COUNT(*) AS n FROM collection_runs WHERE started_at >= ? GROUP BY status`).all(new Date(now().getTime() - 86400000).toISOString());
    const newJobs = store.db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE status = 'active' AND first_seen_at >= ?`).get(new Date(now().getTime() - 86400000).toISOString()).n;
    return { ...store.stats(), newJobs, boardsByProvider: boards, runsLastDay: Object.fromEntries(recent.map(row => [row.status, row.n])), task: task && { kind: task.kind, startedAt: task.startedAt, progress: task.progress } };
  }

  function startTask(kind, work) {
    if (task) throw new Error(`Already ${task.kind === 'discover' ? 'finding boards' : 'collecting jobs'}. Stop it first.`);
    const controller = new AbortController();
    task = { kind, startedAt: now().toISOString(), progress: {}, controller };
    const report = progress => {task.progress = progress;emit({ event: 'progress', kind, progress });};
    Promise.resolve().then(() => work(controller.signal, report))
      .then(result => emit({ event: 'done', kind, result, stopped: controller.signal.aborted }))
      .catch(error => emit({ event: 'done', kind, error: error.message }))
      .finally(() => {task = null;});
    return { started: kind };
  }

  function discover({ crawls = 4 } = {}) {
    return startTask('discover', (signal, report) => {
      const totals = { requests: 0, added: 0, failed: 0 };
      return discoverBoards({ http: indexHttp, store, crawls: clampNumber(crawls, 1, 12, 4), signal, onProgress: item => {
        if (item.error) totals.failed++;else totals.added += item.added || 0;
        report({ ...totals, crawl: item.crawl, pattern: item.pattern, page: item.page, pages: item.pages, error: item.error || null });
      } });
    });
  }

  // Jobs worth loading a description for: listed without one, in (or remote
  // to) the US, and in the role family of some profile's saved search.
  function detailCandidates() {
    const titles = store.db.prepare('SELECT filters FROM search_profiles').all().flatMap(row => {try {return JSON.parse(row.filters).titles || [];} catch (_) {return [];}});
    if (!titles.length) return [];
    return store.pendingDetails()
      .filter(row => row.countries.includes('US') || row.remote && row.remote_scope !== 'NON_US')
      .filter(row => titleScore(row.title, titles) > 0)
      .map(row => row.id);
  }

  // Stage 1: every board's job list (boards with jobs first, then new boards,
  // providers in turn; boards collected in the last `freshHours` skipped).
  // Stage 2: descriptions and pay for the jobs that fit a saved search.
  function sync({ limit, freshHours = 2 } = {}) {
    return startTask('sync', async (signal, report) => {
      const boards = store.boardsToSync({ freshHours: clampNumber(freshHours, 0, 168, 2), nowTime: now().getTime() }).slice(0, limit ? clampNumber(limit, 1, 100000, undefined) : undefined);
      const totals = { phase: 'boards', boards: boards.length, done: 0, ok: 0, unchanged: 0, gone: 0, failed: 0, inserted: 0, expired: 0, details: 0, detailsDone: 0 };
      await syncBoards(store, http, boards, { concurrency: 16, signal, onProgress: ({ done, result }) => {
        totals.done = done;
        if (result.ok) {totals.ok++;if (result.listingUnchanged) totals.unchanged++;totals.inserted += result.inserted;totals.expired += result.expired;}
        else if (result.status === 404) totals.gone++;else totals.failed++;
        if (done % 5 === 0 || done === boards.length) report({ ...totals, board: result.board });
      } });
      if (signal.aborted) return totals;
      const pending = detailCandidates();
      Object.assign(totals, { phase: 'details', details: pending.length });
      report(totals);
      await loadDetails(store, http, pending, { concurrency: 6, signal, onProgress: progress => {
        totals.detailsDone = progress.done;
        if (progress.done % 10 === 0 || progress.done === progress.total) report({ ...totals });
      } });
      report(totals);
      return totals;
    });
  }

  function stop() {
    if (!task) return { stopped: false };
    task.controller.abort();
    return { stopped: true };
  }

  function addBoard({ url }) {
    const found = detectSource(String(url || ''));
    if (!found) throw new Error('Paste a Greenhouse, Lever or Ashby job or board link.');
    return store.addBoard({ ...found, url: String(url) });
  }

  // The saved search for one applicant, created from the profile and resume
  // the first time and then only changed by the user.
  function searchProfile({ profile, resume }) {
    const saved = store.getSearchProfile(profile.id);
    if (saved) return saved;
    const seed = profileTargets(profile, resume);
    return store.saveSearchProfile(profile.id, seed.name || profile.id, { ...DEFAULTS, titles: seed.titles, skills: seed.skills.slice(0, 40), seededAt: now().toISOString() });
  }
  function saveSearchProfile({ profile, search }) {
    const current = store.getSearchProfile(profile.id) || {};
    const next = {
      ...current,
      titles: cleanList(search.titles, 20),
      skills: cleanList(search.skills, 60),
      minScore: clampNumber(search.minScore, 0, 100, DEFAULTS.minScore),
      days: search.days === null || search.days === '' ? null : clampNumber(search.days, 1, 365, DEFAULTS.days),
      places: ['any', 'remote-or-local', 'remote'].includes(search.places) ? search.places : DEFAULTS.places,
      includeUnverified: search.includeUnverified !== false,
    };
    delete next.createdAt;delete next.updatedAt;
    return store.saveSearchProfile(profile.id, [profile.firstName, profile.lastName].filter(Boolean).join(' ') || profile.id, next);
  }

  // Best jobs for one applicant. A first pass scores only titles over every
  // active job; full postings are read only for jobs in the right role family.
  function matches({ profile, resume, limit = 100, showHidden = false }) {
    const search = searchProfile({ profile, resume });
    const targets = { ...profileTargets(profile, null), titles: search.titles, skills: search.skills };
    if (!targets.titles.length) return { search, targets, jobs: [], note: 'Add at least one target job title to this search.' };
    const marks = store.profileJobs(profile.id);
    const since = search.days ? now().getTime() - search.days * 86400000 : null;
    const all = store.jobTitles();
    const candidates = all.filter(row => titleScore(row.title, targets.titles) > 0);
    // How many jobs each step keeps, so the screen can show which filter narrows the list.
    const funnel = { jobs: all.length, titles: candidates.length, recent: 0, eligible: 0, place: 0, verified: 0, score: 0, hidden: 0 };
    const results = [];
    for (const { id } of candidates) {
      const job = store.getJob(id);
      if (!job) continue;
      const mark = marks.get(id);
      if (mark === 'hidden' && !showHidden) {funnel.hidden++;continue;}
      if (since && new Date(job.publishedAt || job.firstSeenAt || 0).getTime() < since) continue;
      funnel.recent++;
      const fit = scoreJob(job, targets);
      if (!fit.eligible) continue;
      funnel.eligible++;
      // All modes are US-only (see fit.js). "remote": remote work open to the US;
      // "remote-or-local": that, or a job in the applicant's own state.
      if (search.places === 'remote' && !fit.usRemote) continue;
      if (search.places === 'remote-or-local' && !fit.usRemote && !fit.local) continue;
      funnel.place++;
      if (!search.includeUnverified && job.verification !== VERIFICATION.VERIFIED_ORIGINAL) continue;
      funnel.verified++;
      if (fit.score < search.minScore) continue;
      funnel.score++;
      results.push({ job: summary(job), fit, mark: mark || null });
    }
    results.sort((a, b) => b.fit.score - a.fit.score || String(b.job.publishedAt || '').localeCompare(String(a.job.publishedAt || '')));
    return { search, targets: { years: targets.years, homeState: targets.homeState, needsSponsorship: targets.needsSponsorship }, total: results.length, candidates: candidates.length, funnel, jobs: results.slice(0, clampNumber(limit, 1, 500, 100)) };
  }

  function summary(job) {
    return {
      id: job.id, provider: job.provider, board: job.board, companyName: job.companyName || job.board, title: job.title, locationText: job.locationText,
      remote: job.remote, remoteScope: job.remoteScope, workArrangement: job.workArrangement, employmentType: job.employmentType, seniority: job.seniority,
      salaryMin: job.salaryMin, salaryMax: job.salaryMax, salaryCurrency: job.salaryCurrency, salaryPeriod: job.salaryPeriod,
      publishedAt: job.publishedAt, publishedAtSource: job.publishedAtSource, firstSeenAt: job.firstSeenAt, sourceUrl: job.sourceUrl, applyUrl: job.applyUrl,
      verification: job.verification, verifiedAt: job.verifiedAt,
    };
  }

  async function job({ id }) {
    let record = store.getJob(String(id));
    if (!record) throw new Error('This job is no longer stored.');
    // Listed without its description: load it now.
    if (record.detailsLoaded === false) {
      await loadDetails(store, http, [record.id]);
      record = store.getJob(record.id);
    }
    return { ...summary(record), description: record.description, department: record.department, places: record.places };
  }

  async function verify({ id }) {
    const record = store.getJob(String(id));
    if (!record) throw new Error('This job is no longer stored.');
    const result = await verifyJob(record, { http });
    store.setVerification(record.id, result.status);
    if (result.status === VERIFICATION.EXPIRED) store.db.prepare(`UPDATE jobs SET status = 'expired' WHERE id = ?`).run(record.id);
    return result;
  }

  function mark({ profileId, id, status }) {
    if (status && !['applied', 'hidden', 'saved'].includes(status)) throw new Error('Unknown job mark.');
    store.setProfileJob(String(profileId), String(id), status || null);
    return { ok: true };
  }

  return { status, discover, sync, stop, addBoard, searchProfile, saveSearchProfile, matches, job, verify, mark, close: () => {stop();store.close();} };
}

module.exports = { createService, DEFAULTS };
