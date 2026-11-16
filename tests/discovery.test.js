const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {detectSource, byId} = require('../src/discovery/providers');
const {parseLocations, remoteScope} = require('../src/discovery/locations');
const {canonicalUrl, seniorityOf} = require('../src/discovery/normalize');
const {createHttp} = require('../src/discovery/http');
const {openStore} = require('../src/discovery/store');
const {syncBoard, syncBoards} = require('../src/discovery/collect');

const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/discovery', name), 'utf8'));
const normalizeAll = (provider, raw, board) => raw.map(item => byId[provider].normalizeJob(item, board));
// An http stand-in answering from fixtures by URL.
const fakeHttp = routes => ({getJson: async url => {
  const route = Object.keys(routes).find(prefix => url.startsWith(prefix));
  if (!route) throw Object.assign(new Error(`HTTP 404 for ${url}`), {status: 404});
  const value = routes[route];
  return typeof value === 'function' ? value(url) : JSON.parse(JSON.stringify(value));
}});

test('ATS boards are detected from posting, board, embed and API URLs', () => {
  assert.deepEqual(detectSource('https://job-boards.greenhouse.io/embed/job_app?for=smartsheet&token=8167496'), {provider: 'greenhouse', board: 'smartsheet'});
  assert.deepEqual(detectSource('https://boards.greenhouse.io/Affirm/jobs/123?gh_src=x'), {provider: 'greenhouse', board: 'affirm'});
  assert.deepEqual(detectSource('https://boards-api.greenhouse.io/v1/boards/smartsheet/jobs'), {provider: 'greenhouse', board: 'smartsheet'});
  assert.deepEqual(detectSource('https://jobs.lever.co/palantir/6ed76ce8/apply'), {provider: 'lever', board: 'palantir', region: 'us'});
  assert.deepEqual(detectSource('https://jobs.eu.lever.co/acme'), {provider: 'lever', board: 'acme', region: 'eu'});
  assert.deepEqual(detectSource('https://jobs.ashbyhq.com/ramp/34413f8d'), {provider: 'ashby', board: 'ramp'});
  assert.equal(detectSource('https://www.linkedin.com/jobs/view/123'), null);
  assert.equal(detectSource('https://evil.example/greenhouse.io/acme'), null);
  assert.equal(detectSource('not a url'), null);
});

test('locations are parsed without guessing a country or US-wide remote eligibility', () => {
  const place = text => parseLocations(text).map(item => [item.city, item.states, item.country, item.remote]);
  assert.deepEqual(place('Bellevue, WA, USA'), [['Bellevue', ['WA'], 'US', false]]);
  assert.deepEqual(place('Washington, D.C.'), [['Washington', ['DC'], 'US', false]]);
  assert.deepEqual(place('Winston-Salem, NC'), [['Winston-Salem', ['NC'], 'US', false]]);
  assert.deepEqual(place('Bangalore, INDIA'), [['Bangalore', [], 'IN', false]]);
  const scope = text => remoteScope(parseLocations(text), {remoteFlag: true});
  assert.equal(scope('Remote - US'), 'US_NATIONWIDE');
  assert.equal(scope('Remote (US)'), 'US_NATIONWIDE');
  assert.equal(scope('Remote - California, Texas'), 'US_STATES');
  assert.equal(scope('Remote - US: CA, NY'), 'US_STATES');
  assert.equal(scope('Remote (Canada)'), 'NON_US');
  assert.equal(scope('Remote'), 'UNKNOWN', 'a bare "Remote" does not say the whole US');
  assert.equal(scope('North America'), 'UNKNOWN');
});

test('Greenhouse postings normalize with pay ranges, dates and canonical URLs from the API', () => {
  const jobs = normalizeAll('greenhouse', fixture('greenhouse-smartsheet.json').jobs, {board: 'smartsheet'});
  const bellevue = jobs.find(job => job.externalId === '8238594');
  assert.equal(bellevue.id, 'greenhouse:smartsheet:8238594');
  assert.equal(bellevue.companyName, 'Smartsheet');
  assert.deepEqual([bellevue.city, bellevue.states, bellevue.countries], ['Bellevue', ['WA'], ['US']]);
  assert.deepEqual([bellevue.salaryMin, bellevue.salaryMax, bellevue.salaryCurrency, bellevue.salaryPeriod], [145000, 193750, 'USD', 'year']);
  assert.equal(bellevue.publishedAt, '2026-09-28T22:46:26.000Z');
  assert.equal(bellevue.publishedAtSource, 'greenhouse.first_published');
  assert.equal(bellevue.canonicalUrl, 'https://job-boards.greenhouse.io/smartsheet/jobs/8238594');
  assert.equal(bellevue.verification, 'UNVERIFIED', 'an ATS domain alone does not verify a URL');
  assert.ok(!/&lt;|<p>/.test(bellevue.description));
  const india = jobs.find(job => job.externalId === '8232492');
  assert.deepEqual(india.countries, ['IN']);
  assert.equal(india.salaryMin, null);assert.equal(india.salaryPeriod, null, 'no salary is invented');
});

test('Lever postings normalize; a provider country alone never makes remote work US-wide', () => {
  const jobs = normalizeAll('lever', fixture('lever-palantir.json'), {board: 'palantir', companyName: 'Palantir'});
  const fellowship = jobs.find(job => job.locationText === 'North America');
  assert.equal(fellowship.remote, true);assert.deepEqual(fellowship.countries, ['US']);
  assert.equal(fellowship.remoteScope, 'UNKNOWN');
  const dc = jobs.find(job => job.city === 'Washington');
  assert.deepEqual([dc.workArrangement, dc.employmentType, dc.remote], ['onsite', 'full-time', false]);
  assert.equal(dc.publishedAtSource, 'lever.createdAt');
  assert.ok(jobs.every(job => job.companyName === 'Palantir' && job.sourceUrl.startsWith('https://jobs.lever.co/palantir/')));
});

test('Ashby postings normalize with structured compensation and every listed location', () => {
  const jobs = normalizeAll('ashby', fixture('ashby-ramp.json').jobs, {board: 'ramp', companyName: 'Ramp'});
  const security = jobs.find(job => job.title === 'Security Engineer, Cloud');
  assert.deepEqual(security.countries, ['US', 'CA']);assert.deepEqual(security.states, ['NY', 'FL']);
  assert.deepEqual([security.workArrangement, security.remoteScope], ['hybrid', 'US_NATIONWIDE']);
  assert.deepEqual([security.salaryMin, security.salaryMax, security.salaryCurrency, security.salaryPeriod], [211400, 290600, 'USD', 'year']);
  const canada = jobs.find(job => job.salaryCurrency === 'CAD');
  assert.equal(canada.remoteScope, 'NON_US');
});

test('titles and URLs normalize deterministically', () => {
  assert.equal(seniorityOf('Sr. Software Engineer'), 'senior');
  assert.equal(seniorityOf('Staff Engineer, Platform'), 'staff');
  assert.equal(seniorityOf('Software Engineering Intern'), 'intern');
  assert.equal(seniorityOf('Software Engineer'), 'unknown');
  assert.equal(canonicalUrl('https://Jobs.Lever.co/acme/1?lever-source=LinkedIn&utm_source=x#apply'), 'https://jobs.lever.co/acme/1');
  assert.equal(canonicalUrl('https://boards.greenhouse.io/acme/jobs/1?gh_jid=1&gh_src=abc'), 'https://boards.greenhouse.io/acme/jobs/1?gh_jid=1');
});

test('Lever pages until a short page and reports an incomplete listing when paging stops early', async () => {
  const all = Array.from({length: 1130}, (_, index) => ({id: `id${index}`, text: `Job ${index}`, hostedUrl: `https://jobs.lever.co/acme/id${index}`, categories: {}}));
  const http = fakeHttp({'https://api.lever.co/v0/postings/acme': url => {const skip = Number(new URL(url).searchParams.get("skip"));return all.slice(skip, skip + 500);}});
  const full = await byId.lever.fetchJobs({board: 'acme'}, {http});
  assert.equal(full.jobs.length, 1130);assert.equal(full.complete, true);
  const partial = await byId.lever.fetchJobs({board: 'acme'}, {http, maxPages: 2});
  assert.equal(partial.jobs.length, 1000);assert.equal(partial.complete, false);
});

test('http retries 429 after Retry-After, backs off on 5xx, gives up, and limits requests per host', async () => {
  const slept = [];let calls = 0, active = 0, peak = 0;
  const responses = [{status: 429, headers: {get: () => '2'}}, {status: 503, headers: {get: () => null}}, {status: 200, ok: true, json: async () => ({ok: 1})}];
  const http = createHttp({fetch: async () => responses[calls++], sleep: async ms => {slept.push(ms);}, minIntervalMs: 0});
  assert.deepEqual(await http.getJson('https://api.example/x'), {ok: 1});
  assert.deepEqual(slept, [2000, 2000]);assert.equal(http.stats.rateLimited, 1);
  const failing = createHttp({fetch: async () => ({status: 500, headers: {get: () => null}}), sleep: async () => {}, retries: 2, minIntervalMs: 0});
  await assert.rejects(failing.getJson('https://api.example/y'), /HTTP 500/);
  const notFound = createHttp({fetch: async () => ({status: 404, ok: false}), sleep: async () => {}, minIntervalMs: 0});
  await assert.rejects(notFound.getJson('https://api.example/z'), error => error.status === 404);
  const limited = createHttp({perHost: 2, minIntervalMs: 0, fetch: async () => {active++;peak = Math.max(peak, active);await new Promise(resolve => setTimeout(resolve, 5));active--;return {status: 200, ok: true, json: async () => ({})};}});
  await Promise.all(Array.from({length: 6}, () => limited.getJson('https://one.example/a')));
  assert.equal(peak, 2);
});

test('the store syncs idempotently, keeps first-seen dates, updates changes and expires removed jobs', () => {
  let clock = '2026-11-10T00:00:00.000Z';
  const store = openStore(':memory:', {now: () => clock});
  const board = store.addBoard({provider: 'greenhouse', board: 'smartsheet', companyName: 'Smartsheet'});
  assert.equal(store.addBoard({provider: 'greenhouse', board: 'smartsheet'}).id, board.id, 'registering twice keeps one board');
  const jobs = normalizeAll('greenhouse', fixture('greenhouse-smartsheet.json').jobs, {board: 'smartsheet'});
  assert.deepEqual(store.saveBoardJobs(board.id, jobs), {fetched: 3, inserted: 3, updated: 0, unchanged: 0, expired: 0});
  clock = '2026-11-11T00:00:00.000Z';
  assert.deepEqual(store.saveBoardJobs(board.id, jobs), {fetched: 3, inserted: 0, updated: 0, unchanged: 3, expired: 0});
  const first = store.getJob(jobs[0].id);
  assert.equal(first.firstSeenAt, '2026-11-10T00:00:00.000Z');assert.equal(first.lastSeenAt, '2026-11-11T00:00:00.000Z');
  store.setVerification(jobs[1].id, 'VERIFIED_ORIGINAL');
  const changed = [{...jobs[1], title: jobs[1].title + ' (updated)', contentHash: 'new'}];
  // A listing cut short cannot prove the other jobs are gone.
  assert.equal(store.saveBoardJobs(board.id, changed, {complete: false}).expired, 0);
  assert.equal(store.getJob(jobs[1].id).verification, 'UNVERIFIED', 'changed content must be verified again');
  assert.equal(store.saveBoardJobs(board.id, changed).expired, 2);
  assert.equal(store.getJob(jobs[0].id).status, 'expired');assert.equal(store.getJob(jobs[0].id).verification, 'EXPIRED');
  assert.equal(store.saveBoardJobs(board.id, jobs).updated, 3, 'a reposted job becomes active again');
  assert.equal(store.stats().activeJobs, 3);
  store.close();
});

test('the same posting URL from two sources is stored once, with both sources recorded', () => {
  const store = openStore();
  const a = store.addBoard({provider: 'greenhouse', board: 'smartsheet'}), b = store.addBoard({provider: 'greenhouse', board: 'smartsheet-embed'});
  const [job] = normalizeAll('greenhouse', fixture('greenhouse-smartsheet.json').jobs, {board: 'smartsheet'});
  const [twin] = normalizeAll('greenhouse', fixture('greenhouse-smartsheet.json').jobs, {board: 'smartsheet-embed'});
  store.saveBoardJobs(a.id, [job]);
  assert.equal(store.saveBoardJobs(b.id, [twin]).inserted, 0);
  assert.equal(store.stats().jobs, 1);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM job_sources WHERE job_id = ?').get(job.id).n, 2);
  store.close();
});

test('migrations run once and the database survives reopening', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-')), 'discovery.db');
  const first = openStore(file);first.addBoard({provider: 'ashby', board: 'ramp', companyName: 'Ramp'});first.close();
  const again = openStore(file);
  assert.equal(again.db.prepare('SELECT COUNT(*) AS n FROM schema_version').get().n, require('../src/discovery/store').MIGRATIONS.length);
  assert.equal(again.listBoards()[0].companyName, 'Ramp');
  again.close();
});

test('collection records each board run; one failing board never stops the others', async () => {
  const store = openStore();
  const boards = [store.addBoard({provider: 'greenhouse', board: 'smartsheet'}), store.addBoard({provider: 'ashby', board: 'gone'}), store.addBoard({provider: 'lever', board: 'palantir', companyName: 'Palantir'})];
  const http = fakeHttp({
    'https://boards-api.greenhouse.io/v1/boards/smartsheet/jobs': fixture('greenhouse-smartsheet.json'),
    'https://api.lever.co/v0/postings/palantir': fixture('lever-palantir.json'),
  });
  const progress = [];
  const results = await syncBoards(store, http, boards.map(board => store.getBoard(board.id)), {concurrency: 2, onProgress: item => progress.push(item.done)});
  assert.deepEqual(results.map(result => [result.board, result.ok]).sort(), [['ashby:gone', false], ['greenhouse:smartsheet', true], ['lever:palantir', true]]);
  assert.equal(progress.length, 3);
  assert.equal(store.getBoard('ashby:gone').consecutive_failures, 1);
  assert.match(store.getBoard('ashby:gone').last_error, /404/);
  assert.equal(store.stats().activeJobs, 6);
  const runs = store.db.prepare('SELECT board_id, status, inserted FROM collection_runs ORDER BY board_id').all().map(row => ({...row}));
  assert.deepEqual(runs, [{board_id: 'ashby:gone', status: 'failed', inserted: 0}, {board_id: 'greenhouse:smartsheet', status: 'ok', inserted: 3}, {board_id: 'lever:palantir', status: 'ok', inserted: 3}]);
  // A board that suddenly answers with nothing keeps its jobs until it lists them as gone for real.
  const empty = await syncBoard(store, fakeHttp({'https://boards-api.greenhouse.io/v1/boards/smartsheet/jobs': {jobs: []}}), store.getBoard('greenhouse:smartsheet'));
  assert.equal(empty.expired, 0);
  store.close();
});

test('collection order: boards with jobs first (largest first), then new boards with providers in turn; fresh boards skipped', () => {
  let clock = '2026-11-10T00:00:00.000Z';
  const store = openStore(':memory:', {now: () => clock});
  for (const [provider, board] of [['greenhouse', 'g1'], ['greenhouse', 'g2'], ['greenhouse', 'g3'], ['ashby', 'a1'], ['lever', 'l1'], ['greenhouse', 'big'], ['greenhouse', 'small'], ['greenhouse', 'fresh']]) store.addBoard({provider, board});
  const jobsFor = (board, count) => Array.from({length: count}, (_, index) => ({...normalizeAll('lever', [{id: `${board}${index}`, text: 'Engineer', hostedUrl: `https://jobs.lever.co/${board}/${index}`, categories: {}}], {board})[0], provider: 'greenhouse', id: `greenhouse:${board}:${index}`}));
  store.saveBoardJobs('greenhouse:small', jobsFor('small', 1));
  store.saveBoardJobs('greenhouse:big', jobsFor('big', 5));
  clock = '2026-11-10T05:00:00.000Z';
  store.saveBoardJobs('greenhouse:fresh', jobsFor('fresh', 9));
  const order = store.boardsToSync({freshHours: 2, nowTime: Date.parse('2026-11-10T06:00:00.000Z')}).map(board => board.id);
  assert.deepEqual(order, ['greenhouse:big', 'greenhouse:small', 'greenhouse:g1', 'ashby:a1', 'lever:l1', 'greenhouse:g2', 'greenhouse:g3']);
  store.close();
});

test('Greenhouse boards are listed first; descriptions load per job, and an unchanged listing is skipped', async () => {
  const {loadDetails} = require('../src/discovery/collect');
  const store = openStore();
  const board = store.addBoard({provider: 'greenhouse', board: 'smartsheet'});
  const data = fixture('greenhouse-smartsheet.json');
  const listing = () => ({jobs: data.jobs.map(({content, pay_input_ranges, ...job}) => job)});
  const asked = [];
  const http = {getJson: async url => {
    asked.push(url);
    const single = /jobs\/(\d+)\?pay_transparency=true$/.exec(url);
    return single ? JSON.parse(JSON.stringify(data.jobs.find(job => String(job.id) === single[1]))) : listing();
  }};
  const first = await syncBoard(store, http, store.getBoard(board.id));
  assert.equal(first.inserted, 3);assert.deepEqual(asked, ['https://boards-api.greenhouse.io/v1/boards/smartsheet/jobs'], 'no descriptions are downloaded with the list');
  const id = 'greenhouse:smartsheet:8238594';
  assert.deepEqual([store.getJob(id).detailsLoaded, store.getJob(id).description, store.getJob(id).salaryMin], [false, '', null]);
  assert.deepEqual(store.pendingDetails().map(row => row.id).sort(), ['greenhouse:smartsheet:6299446', 'greenhouse:smartsheet:8232492', id]);
  asked.length = 0;
  const loaded = await loadDetails(store, http, [id]);
  assert.deepEqual([loaded.loaded, asked.length], [1, 1]);
  const detailed = store.getJob(id);
  assert.equal(detailed.detailsLoaded, true);assert.ok(detailed.description.length > 50);assert.equal(detailed.salaryMin, 145000);
  // Listing again: nothing changed, so nothing is saved and the description stays.
  asked.length = 0;
  const second = await syncBoard(store, http, store.getBoard(board.id));
  assert.deepEqual([second.listingUnchanged, asked.length], [true, 1]);
  assert.ok(store.getJob(id).description.length > 50);
  // A job's update time changed: the board is read again, that job needs its description again, the others keep theirs.
  data.jobs.find(job => job.id === 8232492).updated_at = '2026-11-11T00:00:00-05:00';
  const third = await syncBoard(store, http, store.getBoard(board.id));
  assert.equal(third.updated, 1);
  assert.equal(store.getJob(id).detailsLoaded, true, 'an unchanged job keeps its loaded description');
  assert.equal(store.getJob('greenhouse:smartsheet:8232492').detailsLoaded, false);
  // A job the provider no longer has is closed when its details are asked for.
  const gone = await loadDetails(store, {getJson: async () => {throw Object.assign(new Error('HTTP 404'), {status: 404});}}, ['greenhouse:smartsheet:8232492']);
  assert.equal(gone.closed, 1);assert.equal(store.getJob('greenhouse:smartsheet:8232492').status, 'expired');
  store.close();
});

test('a job listed without its description is scored on title, level and location, and says so', () => {
  const {profileTargets, scoreJob} = require('../src/discovery/fit');
  const targets = profileTargets({title: 'Security Engineer', location: 'Bellevue, WA', workHistory: [{period: '2016 - 2026'}]}, null, {now: new Date('2026-11-10')});
  const [listed] = normalizeAll('greenhouse', [{...fixture('greenhouse-smartsheet.json').jobs.find(job => job.id === 8238594), content: undefined}], {board: 'smartsheet'});
  assert.equal(listed.detailsLoaded, false);
  const fit = scoreJob(listed, targets);
  assert.ok(fit.reasons.includes('Description not loaded yet'));
  assert.ok(fit.score >= 55, JSON.stringify(fit));
});
