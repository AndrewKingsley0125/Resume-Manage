# Job Discovery: progress

Living record of the Job Discovery work, so it can continue across sessions.
Start each session by reading this file, then continue from **Next steps**.

Last updated: 2026-11-10

## 1. Repository assessment (Phase 1)

### What exists
| Area | Implementation |
|---|---|
| App | Electron 42 (Node 24.15), CommonJS, plain JS. No frontend framework, no build step, no TypeScript. Entry `src/main/main.js`, preload `src/main/preload.js`, renderer `src/renderer/*.js` + `index.html`. |
| Persistence | JSON files in `app.getPath('userData')`: `profiles.json`, `resumes/`, `prompts/`, `jds/`, `extension-bridge.json`. No database. |
| Profiles | One profile per applicant: contact, work history, education, `applicationDetails` (address, work authorization, EEO answers). |
| Resume generation | Prompt built by `src/main/prompt.js`; ChatGPT (driven by the extension) returns resume JSON; `src/main/extension-render.js` + `docx.js` export PDF/DOCX. |
| Application tasks and tracking | `src/main/extension-bridge.js`: a local HTTP bridge on `127.0.0.1:17373`. `assign(profileId, url, connectionId, style)` creates a job; statuses move through `assigned → tabs-opened → tabs-ready → questions-scanned → answers-reviewed → filled → completed`. IPC: `extension:assign`, `extension:state`. |
| Chrome extension | MV3, `chrome-extension/`. Watches the bridge for assigned jobs, opens the job beside ChatGPT, scans and fills forms (`page-tools.js`). Site adapters: Greenhouse, Ashby, Lever, Workday, Workable, BambooHR, Rippling, Recruiterflow, Dover, Gem, Comeet, Deel, plus a generic fallback. The user always submits. |
| Tests | `node --test tests/*.test.js`; real-DOM and real-Chrome checks in `scripts/verify-*.cjs`. |
| Unused | `src/adapters/*` are Playwright-era page adapters; nothing loads them. They are not job collectors. |

### Integration points
- **Apply:** call the existing `extensionBridge.assign(profileId, verifiedUrl, connectionId)`. The extension then opens and fills the job exactly as for a manually assigned job. No second auto-apply engine.
- **Resume:** the existing flow generates a tailored resume from the job description in ChatGPT once the job is assigned. Discovery only needs to hand over the URL and the JD text.
- **Status:** read back from the bridge's job list (`extension:state`); discovery stores only a link from its job id to the bridge job id.
- **UI:** a new view in `src/renderer`, styled from `styles.css`, talking to main over new validated `discovery:*` IPC handlers exposed in `preload.js`.

### Decisions
- **Language:** plain JavaScript (CommonJS), to match the repository. TypeScript would add a build step the project does not have.
- **Storage:** SQLite through Node's built-in `node:sqlite` (works in this Electron; verified), in a separate `discovery.db` in userData. The existing JSON files are not touched. Reasons: tens of thousands of jobs need indexed queries, upserts and transactions, and it adds no dependency.
- **Collection runs off the UI process:** `node:sqlite` is synchronous, so collection must run in a worker thread or Electron `utilityProcess` (Phase 10). Nothing is wired into `main.js` yet.
- **Original URLs:** ATS API URLs are stored as **UNVERIFIED** until a verifier fetches the page and confirms it is this job (Phase 5). An ATS domain alone never counts as verification.
- **Remote eligibility:** `US_NATIONWIDE` only when the posting text names the US without state limits. A bare "Remote", "North America", or a provider's country field gives `UNKNOWN`.
- **Deduplication:** deterministic only (provider + board + job id; canonical posting URL). Title + company never merges two postings.

### Risks and constraints
- **Search-engine discovery needs a paid or keyed API.** Bing Web Search API was retired (2025), and Google's Custom Search JSON API is closed to new customers. Brave Search API needs a key. Confirm the current terms before Phase 4. **This needs a decision from the user** (which API, and their key).
- **LinkedIn and Indeed** offer no permitted public job API. Plan: no crawling. A pasted LinkedIn or Indeed link is resolved by searching the company's own ATS boards for the same title, and stays UNRESOLVED otherwise.
- **Lever's API is slow:** about 30 s for a 300-posting board (measured 2026-11-10). Hence 500-posting pages and a 60 s timeout.
- `node:sqlite` prints an ExperimentalWarning under Node 24. The API used here is stable in practice, but this must be rechecked on Electron upgrades.

## 2. Done and verified

### Phase 2: core data architecture
`src/discovery/`, used by nothing else yet:
- `normalize.js`: one job record shape (title, normalized title, seniority, places, countries, states, remote and remote scope, work arrangement, employment type, salary min/max/currency/period from structured fields only, published date plus which field it came from, source/apply/canonical URLs, verification, status, content hash).
- `locations.js`: location text parsed into places; US states; remote scope.
- `store.js`: schema v1 (companies, boards, jobs, job_sources, collection_runs, search_profiles, saved_jobs) with indexes; migration table; idempotent board registration; transactional per-board sync (insert, update on content change, unchanged, expire jobs no longer listed, revive reposted jobs); a changed job loses its verification.
- `http.js`: timeouts, retries with backoff, Retry-After on 429, per-host concurrency and spacing, request stats.
- `collect.js`: per-board sync with run records; many boards with bounded concurrency and progress; a failing board is recorded and never stops the others; an empty answer from a board that had jobs does not expire them.

### Phase 3: Priority 1 collectors
| Provider | API (public, no key) | Detection from URL | Status |
|---|---|---|---|
| Greenhouse | `boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true&pay_transparency=true` | board pages, job pages, `embed/job_app?for=`, API | Working |
| Lever | `api.lever.co/v0/postings/{site}?mode=json&limit=500&skip=N` (and `api.eu.lever.co`) | jobs.lever.co, jobs.eu.lever.co, API | Working |
| Ashby | `api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true` | jobs.ashbyhq.com, API | Working |

### Validation
- `tests/discovery.test.js`: 12 tests on fixtures cut from real responses (`tests/fixtures/discovery/`), all passing.
- Live run on 2026-11-10: Smartsheet (Greenhouse, 72), Palantir (Lever, 304), Ramp (Ashby, 172) gave 548 jobs. A second sync gave 548 unchanged, 0 duplicates. Salary present: Ashby 166/172, Greenhouse 28/72, Lever 0/304 (the API had no salary data for these postings).
- Full suite (`npm test`) passing.

### Phase 4 (free sources only) and fit ranking
User decisions (2026-11-10): **no paid APIs**, **no seed company list**, goal is **as many good-fit jobs per profile as possible**.
- `sources/commoncrawl.js`: finds Greenhouse, Ashby and Lever boards in the free Common Crawl URL index (recent crawls, one request at a time, long backoff). Each finished crawl/pattern/page is recorded in `discovery_tasks`, so an interrupted or failed run continues where it stopped. Lever blocks Common Crawl's crawler, so Lever coverage from this source is thin.
- Boards that answer 404 are switched off (`active = 0`); other failures are retried on later syncs.
- `fit.js`: per-profile targets from the profile plus its saved resume (`resumes/<profileId>.json`): titles, skills (resume skills and experience technologies), years of experience, home state, sponsorship need, US work authorization. Score 0-100 = 45% title family, 30% skills named in the posting, 15% seniority, 10% location. US jobs only: jobs outside the US, remote with no country stated, remote only in other states, or refusing sponsorship the applicant needs are excluded, whatever their score. "US remote only" keeps remote work the posting opens to the US (nationwide, or states including the applicant's); "US remote, or in my state" adds on-site jobs in the applicant's state. Security-clearance requirements halve the score.
- `scripts/discover-jobs.cjs`: `discover`, `add <url>`, `sync`, `match [--profile] [--top] [--days] [--min] [--csv]`, `stats`. Uses `discovery.db` in the app data folder.
- Tests: `tests/discovery-fit.test.js` (8 tests).

### Phases 5, 7, 8 (first version): app screen, verification, hand-off
- **Find jobs screen** (`src/renderer/discovery.js`, `#/discovery`, topbar button on the profile list): source counts, Collect jobs / Find more boards / Stop with live progress, add a board by link, per-profile search (target titles, core skills, minimum score, posted within, where, include unverified), ranked matches with reasons, salary, posting date and verification badge, description on demand, Open posting, Hide, Send to extension.
- **Worker thread** (`src/discovery/worker.js` + `service.js`, started by `src/main/discovery.js`): all SQLite and network work runs off the main and window threads. IPC handlers validate every argument; only http(s) links can be opened. `asarUnpack: src/discovery/**` lets the packaged app start the worker (checked with a real `electron-builder --dir` build).
- **Saved search per profile:** created once from the profile and its resume, then changed only by the user, so tailoring resumes never moves the search.
- **Verification** (`verify.js`): VERIFIED_ORIGINAL only when the posting page loads at the job's own URL and its title names the job. 404/410 or a redirect away (Greenhouse sends closed jobs to `?error=true`) gives EXPIRED; 401/403/429 or a bot wall gives BLOCKED. Run on demand before sending.
- **Send to extension:** checks the profile is in extension mode and an extension is linked, verifies the posting, asks for confirmation, adds the link to the profile through the renderer's own profile list (so no later save drops it), then calls the existing `extension:assign`. The job is marked "Sent" for that profile.
- Tests: `tests/discovery-service.test.js` (7), `scripts/verify-discovery-ui.cjs` (real app, temporary data, 7 checks).

### Faster collection (2026-11-10)
Measured: Greenhouse takes about 10 s to produce a board's listing with descriptions (`?content=true`), minutes for the largest boards (downloads were cut off), and more requests at once only slowed it further. The listing without descriptions takes about 2 s even for 285 jobs; one job's details about 2 s.
- **Two stages.** Collect jobs lists every board first (Greenhouse without descriptions; Lever and Ashby unchanged), then loads descriptions and pay one job at a time, only for jobs that fit some profile's saved titles and are in or remote to the US, newest first. Opening a description in the app loads it on demand. Jobs without a description are scored on title, seniority and location (`Description not loaded yet`).
- **Order:** boards with jobs first (largest first), then new boards with the providers in turn; boards collected in the last 2 hours are skipped.
- **Unchanged boards:** a fingerprint of each Greenhouse listing (job ids and update times) skips boards with no changes; a job whose update time is unchanged keeps its loaded description.
- Limits: 6 requests at a time per provider, 16 boards in flight, 6 description requests at a time.
- Measured on a copy of the real database: 100 largest known Greenhouse boards 57 s with no failures (before: about 7 minutes, with cut-off downloads); the same 100 again 19 s; 60 new boards 39 s; 60 descriptions 13 s.
- `scripts/discover-jobs.cjs sync` lists boards but does not load descriptions; use the app for that.

## 3. Next steps (remaining phases)
1. **Scheduling:** collect automatically every few hours while the app runs; notify about new matches without repeats.
2. **More filters:** excluded keywords, salary minimum with an "include unknown" choice, employment type, seniority, companies to exclude; a "Sent" list per profile with the extension's application status.
3. **Background verification** of top matches, so most shown jobs are already verified.
4. **Company explorer and collection monitor:** list boards with their last sync, errors and job counts; retry failed boards.
6. **Phase 4, more free board sources:** company websites (career-page links, `JobPosting` JSON-LD, ATS links in the HTML), and boards named inside collected postings. Profile titles are missing for some applicants (Toby has none; Andrew's resume has no titles), which weakens matching for them.
7. **Phase 9, more collectors:** SmartRecruiters, Workable, Recruitee, Teamtailor, BambooHR, Workday (public JSON endpoints, to be checked one by one before claiming support).
8. **Phases 10–12:** schedules (hourly to daily, custom), notifications for new matches without duplicates, CSV/Excel/JSON export, packaging check with `electron-builder`.

## 4. Decisions
- Search APIs: none (no paid APIs). Discovery uses free public indexes and ATS APIs only.
- Seed list: none. Boards are found automatically, plus any URL the user pastes.
