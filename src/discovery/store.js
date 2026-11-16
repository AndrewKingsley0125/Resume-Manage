// Job discovery storage: SQLite through Node's built-in node:sqlite (no new
// dependency), in its own file beside the app's JSON data. The app's profiles,
// resumes and assigned jobs stay where they are.
const { DatabaseSync } = require('node:sqlite');

const MIGRATIONS = [
  `CREATE TABLE companies (
     id TEXT PRIMARY KEY, name TEXT NOT NULL, website TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE boards (
     id TEXT PRIMARY KEY, provider TEXT NOT NULL, board TEXT NOT NULL, region TEXT, company_id TEXT REFERENCES companies(id),
     url TEXT, origin TEXT NOT NULL DEFAULT 'manual', active INTEGER NOT NULL DEFAULT 1,
     last_synced_at TEXT, last_success_at TEXT, last_error TEXT, consecutive_failures INTEGER NOT NULL DEFAULT 0,
     job_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, UNIQUE(provider, board));
   CREATE TABLE jobs (
     id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES boards(id), provider TEXT NOT NULL, external_id TEXT NOT NULL,
     company_name TEXT, title TEXT NOT NULL, normalized_title TEXT NOT NULL, seniority TEXT NOT NULL,
     location_text TEXT, countries TEXT NOT NULL, states TEXT NOT NULL, city TEXT,
     remote INTEGER NOT NULL, remote_scope TEXT, work_arrangement TEXT NOT NULL, employment_type TEXT NOT NULL,
     salary_min REAL, salary_max REAL, salary_currency TEXT, salary_period TEXT,
     published_at TEXT, published_at_source TEXT, updated_at TEXT, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
     source_url TEXT, apply_url TEXT, canonical_url TEXT, verification TEXT NOT NULL, verified_at TEXT,
     status TEXT NOT NULL, content_hash TEXT NOT NULL, description TEXT, record TEXT NOT NULL);
   CREATE UNIQUE INDEX jobs_canonical ON jobs(canonical_url) WHERE canonical_url IS NOT NULL;
   CREATE INDEX jobs_status_published ON jobs(status, published_at DESC);
   CREATE INDEX jobs_first_seen ON jobs(first_seen_at DESC);
   CREATE INDEX jobs_board ON jobs(board_id, status);
   CREATE INDEX jobs_title ON jobs(normalized_title);
   CREATE TABLE job_sources (
     job_id TEXT NOT NULL REFERENCES jobs(id), source TEXT NOT NULL, url TEXT, seen_at TEXT NOT NULL, PRIMARY KEY(job_id, source));
   CREATE TABLE collection_runs (
     id INTEGER PRIMARY KEY AUTOINCREMENT, board_id TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
     status TEXT NOT NULL, fetched INTEGER NOT NULL DEFAULT 0, inserted INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL DEFAULT 0,
     unchanged INTEGER NOT NULL DEFAULT 0, expired INTEGER NOT NULL DEFAULT 0, error TEXT);
   CREATE INDEX runs_board ON collection_runs(board_id, started_at DESC);
   CREATE TABLE search_profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, filters TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE saved_jobs (job_id TEXT PRIMARY KEY REFERENCES jobs(id), note TEXT, status TEXT, saved_at TEXT NOT NULL);`,
  // v2: resumable discovery steps (one row per finished crawl/pattern/page).
  `CREATE TABLE discovery_tasks (key TEXT PRIMARY KEY, found INTEGER NOT NULL DEFAULT 0, done_at TEXT NOT NULL);
   CREATE INDEX boards_active ON boards(active, last_synced_at);`,
  // v3: what each applicant did with a job (sent to the extension, hidden, saved).
  `CREATE TABLE profile_jobs (profile_id TEXT NOT NULL, job_id TEXT NOT NULL REFERENCES jobs(id), status TEXT NOT NULL,
     note TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(profile_id, job_id));`,
  // v4: a fingerprint of each board's listing (job ids and update times), so an
  // unchanged board is recognised without downloading every description again.
  `ALTER TABLE boards ADD COLUMN listing_hash TEXT;`,
  // v5: jobs listed without their description and pay (loaded later, only for jobs that matter).
  `ALTER TABLE jobs ADD COLUMN details_loaded INTEGER NOT NULL DEFAULT 1;
   CREATE INDEX jobs_pending_details ON jobs(details_loaded, status, published_at DESC);`,
];

const slug = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const json = value => JSON.stringify(value ?? null);

function openStore(file = ':memory:', { now = () => new Date().toISOString() } = {}) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const current = db.prepare('SELECT MAX(version) AS v FROM schema_version').get().v || 0;
  for (let version = current; version < MIGRATIONS.length; version++) {
    transaction(() => {db.exec(MIGRATIONS[version]);db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version + 1);});
  }

  function transaction(work) {
    db.exec('BEGIN IMMEDIATE');
    try {const result = work();db.exec('COMMIT');return result;}
    catch (error) {db.exec('ROLLBACK');throw error;}
  }

  function upsertCompany(name, website = null) {
    const id = slug(name) || slug(website);
    db.prepare(`INSERT INTO companies (id, name, website, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET website = COALESCE(excluded.website, companies.website), updated_at = excluded.updated_at`)
      .run(id, name, website, now(), now());
    return id;
  }

  // Registering the same board twice is a no-op that keeps its history.
  function addBoard({ provider, board, region = null, companyName = null, url = null, origin = 'manual' }) {
    const id = `${provider}:${board}`;
    const companyId = companyName ? upsertCompany(companyName) : null;
    db.prepare(`INSERT INTO boards (id, provider, board, region, company_id, url, origin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider, board) DO UPDATE SET company_id = COALESCE(boards.company_id, excluded.company_id), url = COALESCE(boards.url, excluded.url), active = 1`)
      .run(id, provider, board, region, companyId, url, origin, now());
    return getBoard(id);
  }
  const getBoard = id => {
    const row = db.prepare('SELECT b.*, c.name AS company_name FROM boards b LEFT JOIN companies c ON c.id = b.company_id WHERE b.id = ?').get(id);
    return row ? { ...row, companyName: row.company_name } : null;
  };
  const listBoards = ({ activeOnly = true } = {}) => db.prepare(`SELECT b.*, c.name AS company_name FROM boards b LEFT JOIN companies c ON c.id = b.company_id
      ${activeOnly ? 'WHERE b.active = 1' : ''} ORDER BY b.last_success_at IS NULL DESC, b.last_synced_at ASC`).all().map(row => ({ ...row, companyName: row.company_name }));
  // Collection order: boards already known to have jobs first (largest first),
  // then the rest of the collected boards, then never-collected boards with the
  // providers taken in turn, so Ashby and Lever are not stuck behind thousands
  // of Greenhouse boards. Boards collected within `freshHours` are left out.
  function boardsToSync({ freshHours = 2, nowTime = Date.now() } = {}) {
    const cutoff = new Date(nowTime - freshHours * 3600000).toISOString();
    const rows = db.prepare(`SELECT b.*, c.name AS company_name FROM boards b LEFT JOIN companies c ON c.id = b.company_id
        WHERE b.active = 1 AND (b.last_synced_at IS NULL OR b.last_synced_at < ?)
        ORDER BY b.last_success_at IS NULL, b.job_count DESC, b.last_synced_at, b.rowid`).all(cutoff).map(row => ({ ...row, companyName: row.company_name }));
    const known = rows.filter(row => row.last_success_at), fresh = rows.filter(row => !row.last_success_at);
    const byProvider = new Map();
    for (const row of fresh) {if (!byProvider.has(row.provider)) byProvider.set(row.provider, []);byProvider.get(row.provider).push(row);}
    const queues = [...byProvider.values()], interleaved = [];
    for (let index = 0; queues.some(queue => index < queue.length); index++) for (const queue of queues) if (index < queue.length) interleaved.push(queue[index]);
    return [...known, ...interleaved];
  }
  // Board listing unchanged since last time: keep its jobs, just note they were seen.
  function markBoardUnchanged(boardId) {
    const stamp = now();
    return transaction(() => {
      db.prepare(`UPDATE jobs SET last_seen_at = ? WHERE board_id = ? AND status = 'active'`).run(stamp, boardId);
      db.prepare(`UPDATE boards SET last_synced_at = ?, last_success_at = ?, last_error = NULL, consecutive_failures = 0 WHERE id = ?`).run(stamp, stamp, boardId);
      return { fetched: 0, inserted: 0, updated: 0, unchanged: db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE board_id = ? AND status = 'active'`).get(boardId).n, expired: 0 };
    });
  }
  const setListingHash = (boardId, hash) => db.prepare('UPDATE boards SET listing_hash = ? WHERE id = ?').run(hash || null, boardId);

  // Writes one board's full listing: new and changed jobs are stored, jobs the
  // board no longer lists become EXPIRED. Idempotent for an unchanged listing.
  function saveBoardJobs(boardId, jobs, { complete = true } = {}) {
    const stamp = now();
    return transaction(() => {
      const counts = { fetched: jobs.length, inserted: 0, updated: 0, unchanged: 0, expired: 0 };
      const existing = db.prepare('SELECT id, content_hash, status, title, updated_at, details_loaded FROM jobs WHERE id = ?');
      const byUrl = db.prepare('SELECT id FROM jobs WHERE canonical_url = ? AND id != ?');
      const insert = db.prepare(`INSERT INTO jobs (id, board_id, provider, external_id, company_name, title, normalized_title, seniority, location_text,
          countries, states, city, remote, remote_scope, work_arrangement, employment_type, salary_min, salary_max, salary_currency, salary_period,
          published_at, published_at_source, updated_at, first_seen_at, last_seen_at, source_url, apply_url, canonical_url, verification, status,
          content_hash, description, record, details_loaded)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`);
      const update = db.prepare(`UPDATE jobs SET company_name = ?, title = ?, normalized_title = ?, seniority = ?, location_text = ?, countries = ?, states = ?,
          city = ?, remote = ?, remote_scope = ?, work_arrangement = ?, employment_type = ?, salary_min = ?, salary_max = ?, salary_currency = ?,
          salary_period = ?, published_at = ?, published_at_source = ?, updated_at = ?, last_seen_at = ?, source_url = ?, apply_url = ?,
          canonical_url = ?, status = 'active', content_hash = ?, description = ?, record = ?, details_loaded = ?,
          verification = CASE WHEN content_hash = ? AND status = 'active' THEN verification ELSE 'UNVERIFIED' END
        WHERE id = ?`);
      const touch = db.prepare(`UPDATE jobs SET last_seen_at = ? WHERE id = ?`);
      const rehash = db.prepare(`UPDATE jobs SET last_seen_at = ?, content_hash = ? WHERE id = ?`);
      const source = db.prepare(`INSERT INTO job_sources (job_id, source, url, seen_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(job_id, source) DO UPDATE SET seen_at = excluded.seen_at, url = excluded.url`);
      const seen = new Set();
      for (const job of jobs) {
        if (seen.has(job.id)) continue;
        seen.add(job.id);
        // Another source already holds this exact posting URL: record the extra source, not a second job.
        const twin = job.canonicalUrl && byUrl.get(job.canonicalUrl, job.id);
        if (twin) {source.run(twin.id, `${job.provider}:${job.board}`, job.sourceUrl, stamp);counts.unchanged++;continue;}
        const row = existing.get(job.id);
        const values = [job.companyName, job.title, job.normalizedTitle, job.seniority, job.locationText, json(job.countries), json(job.states), job.city,
          job.remote ? 1 : 0, job.remoteScope, job.workArrangement, job.employmentType, job.salaryMin, job.salaryMax, job.salaryCurrency, job.salaryPeriod,
          job.publishedAt, job.publishedAtSource, job.updatedAt];
        const loaded = job.detailsLoaded === false ? 0 : 1;
        if (!row) {
          insert.run(job.id, boardId, job.provider, job.externalId, ...values, stamp, stamp, job.sourceUrl, job.applyUrl, job.canonicalUrl, job.verification,
            job.contentHash, job.description, json(job), loaded);
          counts.inserted++;
        } else if (!loaded && row.status === 'active' && row.title === job.title && row.updated_at === job.updatedAt) {
          // Listed without details, but the posting has not changed: keep the description already stored.
          rehash.run(stamp, job.contentHash, job.id);counts.unchanged++;
        } else if (row.content_hash !== job.contentHash || row.status !== 'active') {
          update.run(...values, stamp, job.sourceUrl, job.applyUrl, job.canonicalUrl, job.contentHash, job.description, json(job), loaded, job.contentHash, job.id);
          counts.updated++;
        } else {touch.run(stamp, job.id);counts.unchanged++;}
        source.run(job.id, `${job.provider}:${job.board}`, job.sourceUrl, stamp);
      }
      // A partial listing (paging stopped early) cannot prove a job is gone.
      if (complete) {
        const active = db.prepare(`SELECT id FROM jobs WHERE board_id = ? AND status = 'active'`).all(boardId);
        const expire = db.prepare(`UPDATE jobs SET status = 'expired', verification = 'EXPIRED' WHERE id = ?`);
        for (const { id } of active) if (!seen.has(id)) {expire.run(id);counts.expired++;}
      }
      db.prepare(`UPDATE boards SET last_synced_at = ?, last_success_at = ?, last_error = NULL, consecutive_failures = 0,
          job_count = (SELECT COUNT(*) FROM jobs WHERE board_id = ? AND status = 'active') WHERE id = ?`).run(stamp, stamp, boardId, boardId);
      return counts;
    });
  }

  // Jobs still waiting for their description, newest first (light rows for filtering).
  const pendingDetails = () => db.prepare(`SELECT id, title, countries, remote, remote_scope, published_at, first_seen_at FROM jobs
      WHERE details_loaded = 0 AND status = 'active' ORDER BY published_at DESC`).all()
    .map(row => ({ ...row, countries: JSON.parse(row.countries || '[]'), remote: !!row.remote }));
  // Description and pay arrived for a listed job. Its change fingerprint and dates stay as listed.
  function saveJobDetails(job) {
    const current = db.prepare('SELECT record, content_hash, status FROM jobs WHERE id = ?').get(job.id);
    if (!current || current.status !== 'active') return false;
    const record = { ...JSON.parse(current.record), ...job, contentHash: current.content_hash, detailsLoaded: true };
    db.prepare(`UPDATE jobs SET description = ?, record = ?, details_loaded = 1, salary_min = ?, salary_max = ?, salary_currency = ?, salary_period = ?,
        employment_type = ?, work_arrangement = ?, remote = ?, remote_scope = ? WHERE id = ?`)
      .run(record.description, json(record), record.salaryMin, record.salaryMax, record.salaryCurrency, record.salaryPeriod,
        record.employmentType, record.workArrangement, record.remote ? 1 : 0, record.remoteScope, job.id);
    return true;
  }
  const expireJob = id => db.prepare(`UPDATE jobs SET status = 'expired', verification = 'EXPIRED' WHERE id = ?`).run(id);

  // A board the provider says does not exist (404) is switched off; it comes
  // back only if registered again. Other failures are retried on later syncs.
  function recordFailure(boardId, error, { gone = false } = {}) {
    db.prepare(`UPDATE boards SET last_synced_at = ?, last_error = ?, consecutive_failures = consecutive_failures + 1,
        active = CASE WHEN ? THEN 0 ELSE active END WHERE id = ?`).run(now(), String(error), gone ? 1 : 0, boardId);
  }
  const taskDone = key => !!db.prepare('SELECT 1 FROM discovery_tasks WHERE key = ?').get(key);
  const markTask = (key, found = 0) => db.prepare(`INSERT INTO discovery_tasks (key, found, done_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET found = excluded.found, done_at = excluded.done_at`).run(key, found, now());
  // Registers many discovered boards in one transaction; returns how many were new.
  function addBoards(boards, origin) {
    return transaction(() => {
      const known = db.prepare('SELECT 1 FROM boards WHERE provider = ? AND board = ?');
      const insert = db.prepare(`INSERT OR IGNORE INTO boards (id, provider, board, region, origin, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
      let added = 0;
      for (const board of boards) {
        if (known.get(board.provider, board.board)) continue;
        insert.run(`${board.provider}:${board.board}`, board.provider, board.board, board.region || null, origin, now());
        added++;
      }
      return added;
    });
  }
  // Search settings per applicant profile (id = profile id). Stored once and
  // edited by the user; resume tailoring never changes them.
  function getSearchProfile(id) {
    const row = db.prepare('SELECT filters, created_at, updated_at FROM search_profiles WHERE id = ?').get(id);
    return row ? { ...JSON.parse(row.filters), createdAt: row.created_at, updatedAt: row.updated_at } : null;
  }
  function saveSearchProfile(id, name, filters) {
    db.prepare(`INSERT INTO search_profiles (id, name, filters, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, filters = excluded.filters, updated_at = excluded.updated_at`).run(id, name, json(filters), now(), now());
    return getSearchProfile(id);
  }
  const setProfileJob = (profileId, jobId, status) => status
    ? db.prepare(`INSERT INTO profile_jobs (profile_id, job_id, status, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(profile_id, job_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`).run(profileId, jobId, status, now())
    : db.prepare('DELETE FROM profile_jobs WHERE profile_id = ? AND job_id = ?').run(profileId, jobId);
  const profileJobs = profileId => new Map(db.prepare('SELECT job_id, status FROM profile_jobs WHERE profile_id = ?').all(profileId).map(row => [row.job_id, row.status]));
  // Light rows for a first pass over every active job; full records are loaded only for candidates.
  const jobTitles = () => db.prepare(`SELECT id, title FROM jobs WHERE status = 'active'`).all();
  const listJobs = ({ status = 'active' } = {}) => db.prepare(`SELECT record, first_seen_at, verification FROM jobs WHERE status = ?`).all(status)
    .map(row => ({ ...JSON.parse(row.record), firstSeenAt: row.first_seen_at, verification: row.verification }));
  function startRun(boardId) {
    return Number(db.prepare(`INSERT INTO collection_runs (board_id, started_at, status) VALUES (?, ?, 'running')`).run(boardId, now()).lastInsertRowid);
  }
  function finishRun(runId, { status, error = null, ...counts }) {
    db.prepare(`UPDATE collection_runs SET finished_at = ?, status = ?, error = ?, fetched = ?, inserted = ?, updated = ?, unchanged = ?, expired = ? WHERE id = ?`)
      .run(now(), status, error, counts.fetched || 0, counts.inserted || 0, counts.updated || 0, counts.unchanged || 0, counts.expired || 0, runId);
  }
  const getJob = id => {const row = db.prepare('SELECT record, status, verification, verified_at, first_seen_at, last_seen_at FROM jobs WHERE id = ?').get(id);return row ? { ...JSON.parse(row.record), status: row.status, verification: row.verification, verifiedAt: row.verified_at, firstSeenAt: row.first_seen_at, lastSeenAt: row.last_seen_at } : null;};
  const setVerification = (id, verification) => db.prepare('UPDATE jobs SET verification = ?, verified_at = ? WHERE id = ?').run(verification, now(), id);
  const stats = () => db.prepare(`SELECT (SELECT COUNT(*) FROM companies) AS companies, (SELECT COUNT(*) FROM boards) AS boards,
      (SELECT COUNT(*) FROM jobs) AS jobs, (SELECT COUNT(*) FROM jobs WHERE status = 'active') AS activeJobs,
      (SELECT COUNT(*) FROM jobs WHERE verification = 'VERIFIED_ORIGINAL') AS verified, (SELECT MAX(last_success_at) FROM boards) AS lastSync`).get();

  return { db, transaction, upsertCompany, addBoard, addBoards, getBoard, listBoards, boardsToSync, markBoardUnchanged, setListingHash, pendingDetails, saveJobDetails, expireJob, saveBoardJobs, recordFailure, taskDone, markTask, listJobs, jobTitles,
    getSearchProfile, saveSearchProfile, setProfileJob, profileJobs, startRun, finishRun, getJob, setVerification, stats, close: () => db.close() };
}

module.exports = { openStore, MIGRATIONS };
