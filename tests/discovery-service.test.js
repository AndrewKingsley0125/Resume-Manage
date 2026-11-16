const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {Worker} = require('node:worker_threads');
const {createService} = require('../src/discovery/service');
const {verifyJob} = require('../src/discovery/verify');
const {byId} = require('../src/discovery/providers');

const fixture = name => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/discovery', name), 'utf8'));
// Greenhouse answers its listing without descriptions, and one job at a time with them.
const greenhouse = fixture('greenhouse-smartsheet.json');
const light = {jobs: greenhouse.jobs.map(({content, pay_input_ranges, ...job}) => job), meta: greenhouse.meta};
const routes = {
  'https://api.lever.co/v0/postings/palantir': fixture('lever-palantir.json'),
  'https://api.ashbyhq.com/posting-api/job-board/ramp': fixture('ashby-ramp.json'),
};
const pages = new Map();
const fakeHttp = {
  getJson: async url => {
    if (url === 'https://boards-api.greenhouse.io/v1/boards/smartsheet/jobs') return JSON.parse(JSON.stringify(light));
    const single = /boards\/smartsheet\/jobs\/(\d+)\?pay_transparency=true$/.exec(url);
    if (single) {const job = greenhouse.jobs.find(item => String(item.id) === single[1]);if (job) return JSON.parse(JSON.stringify(job));}
    const key = Object.keys(routes).find(prefix => url.startsWith(prefix));if (!key) throw Object.assign(new Error('HTTP 404'), {status: 404});return JSON.parse(JSON.stringify(routes[key]));
  },
  getText: async url => pages.get(url) || {ok: false, status: 404, url, text: ''},
};
const tony = {id: 'tony', firstName: 'Tony', lastName: 'Zhao', title: 'Senior Software Engineer', location: 'Berkeley CA', applicationMode: 'extension',
  workHistory: [{period: 'May 2016 - Oct 2026'}], applicationDetails: {authorizedToWork: 'Yes', sponsorshipNow: 'No'}};
const resume = {experience: [{title: 'Senior Software Engineer - ML Infrastructure'}], skills: [{Languages: ['Python', 'Go', 'Kubernetes']}]};
const waitFor = async (check, ms = 2000) => {const until = Date.now() + ms;while (Date.now() < until) {if (check()) return true;await new Promise(resolve => setTimeout(resolve, 10));}return false;};

async function collected() {
  const events = [];
  const service = createService({dbPath: ':memory:', http: fakeHttp, emit: event => events.push(event), now: () => new Date('2026-11-10T12:00:00Z')});
  for (const url of ['https://job-boards.greenhouse.io/smartsheet', 'https://jobs.lever.co/palantir', 'https://jobs.ashbyhq.com/ramp']) service.addBoard({url});
  service.sync();
  assert.ok(await waitFor(() => events.some(event => event.event === 'done')));
  return {service, events};
}

test('collecting jobs runs as one stoppable task and reports progress and a summary', async () => {
  const {service, events} = await collected();
  const done = events.find(event => event.event === 'done');
  assert.equal(done.kind, 'sync');assert.deepEqual([done.result.ok, done.result.inserted], [3, 8]);
  assert.ok(events.some(event => event.event === 'progress'));
  assert.equal(service.status().activeJobs, 8);assert.equal(service.status().task, null);
  assert.throws(() => service.addBoard({url: 'https://www.linkedin.com/jobs/view/1'}), /Greenhouse, Lever or Ashby/);
  service.close();
});

test('a search profile is created once from the profile and resume, then only the user changes it', async () => {
  const {service} = await collected();
  const first = service.searchProfile({profile: tony, resume});
  assert.deepEqual(first.titles, ['Senior Software Engineer', 'Senior Software Engineer - ML Infrastructure']);
  assert.deepEqual(first.skills, ['Python', 'Go', 'Kubernetes']);
  // A newly tailored resume does not move the saved search.
  const tailored = {experience: [{title: 'Data Engineer'}], skills: ['dbt', 'Snowflake']};
  assert.deepEqual(service.searchProfile({profile: tony, resume: tailored}).titles, first.titles);
  const saved = service.saveSearchProfile({profile: tony, search: {titles: ['Security Engineer', ' security engineer ', ''], skills: ['Python'], minScore: 500, days: null, places: 'nowhere'}});
  assert.deepEqual([saved.titles, saved.minScore, saved.days, saved.places], [['Security Engineer'], 100, null, 'any']);
  service.close();
});

test('matches come only from eligible jobs in the role family, and marks hide or flag them', async () => {
  const {service} = await collected();
  service.saveSearchProfile({profile: tony, search: {titles: ['Security Engineer', 'Software Engineer'], skills: ['Python', 'AWS'], minScore: 30, days: null, places: 'any'}});
  const result = service.matches({profile: tony, resume});
  const titles = result.jobs.map(item => item.job.title);
  assert.ok(titles.includes('Commercial GRC Engineer - Sr. Security Engineer I'), titles.join(' | '));
  assert.ok(titles.includes(' Security Engineer, Cloud'.trim()) || titles.includes(' Security Engineer, Cloud'), titles.join(' | '));
  assert.ok(!titles.some(title => /Administrative|Account Executive/.test(title)));
  assert.ok(result.jobs.every(item => item.fit.eligible));
  assert.ok(!result.jobs.some(item => item.job.locationText.includes('INDIA') || item.job.locationText === 'Singapore, SGP'));
  const first = result.jobs[0].job.id;
  service.mark({profileId: 'tony', id: first, status: 'applied'});
  assert.equal(service.matches({profile: tony, resume}).jobs.find(item => item.job.id === first).mark, 'applied');
  service.mark({profileId: 'tony', id: first, status: 'hidden'});
  assert.ok(!service.matches({profile: tony, resume}).jobs.some(item => item.job.id === first));
  assert.throws(() => service.mark({profileId: 'tony', id: first, status: 'deleted'}), /Unknown/);
  const remoteOnly = service.saveSearchProfile({profile: tony, search: {titles: ['Security Engineer', 'Software Engineer'], skills: ['Python'], minScore: 30, days: null, places: 'remote'}});
  assert.equal(remoteOnly.places, 'remote');
  assert.ok(service.matches({profile: tony, resume}).jobs.every(item => item.job.remote));
  service.close();
});

test('"US remote only" keeps only remote work open to the US; "in my state" adds local jobs', async () => {
  const {service} = await collected();
  const search = places => {service.saveSearchProfile({profile: tony, search: {titles: ['Security Engineer', 'Software Engineer'], skills: ['Python'], minScore: 0, days: null, places}});return service.matches({profile: tony, resume}).jobs;};
  const remote = search('remote');
  assert.ok(remote.length > 0);
  assert.ok(remote.every(item => item.fit.usRemote), remote.map(item => item.job.locationText).join(' | '));
  const any = search('any');
  assert.ok(any.length > remote.length, 'anywhere in the US includes on-site jobs too');
  assert.ok(any.every(item => item.fit.eligible && !/Bangalore|Singapore|Canada\)$/.test(item.job.locationText)));
  const local = search('remote-or-local');
  assert.ok(local.every(item => item.fit.usRemote || item.fit.local));
  service.close();
});

test('matches report how many jobs each filter keeps', async () => {
  const {service} = await collected();
  service.saveSearchProfile({profile: tony, search: {titles: ['Security Engineer', 'Software Engineer'], skills: ['Python'], minScore: 50, days: null, places: 'remote'}});
  const {funnel, total} = service.matches({profile: tony, resume});
  assert.equal(funnel.jobs, 8);
  assert.ok(funnel.titles >= funnel.recent && funnel.recent >= funnel.eligible && funnel.eligible >= funnel.place && funnel.place >= funnel.score, JSON.stringify(funnel));
  assert.equal(funnel.recent, funnel.titles, 'no date limit keeps every title match');
  assert.equal(funnel.score, total);
  service.close();
});

test('a search with no titles explains what to add instead of guessing', async () => {
  const {service} = await collected();
  service.saveSearchProfile({profile: tony, search: {titles: [], skills: []}});
  const result = service.matches({profile: tony, resume});
  assert.deepEqual(result.jobs, []);assert.match(result.note, /job title/);
  service.close();
});

test('verification needs the live page at the job URL naming this job', async () => {
  const [job] = fixture('greenhouse-smartsheet.json').jobs.filter(item => item.id === 8238594).map(item => byId.greenhouse.normalizeJob(item, {board: 'smartsheet'}));
  const http = page => ({getText: async () => page});
  const live = {ok: true, status: 200, url: job.sourceUrl, text: `<html><title>Job Application for ${job.title} at Smartsheet</title></html>`};
  assert.equal((await verifyJob(job, {http: http(live)})).status, 'VERIFIED_ORIGINAL');
  // Greenhouse sends a closed job to the board page with ?error=true and status 200.
  assert.equal((await verifyJob(job, {http: http({ok: true, status: 200, url: 'https://job-boards.greenhouse.io/smartsheet?error=true', text: '<title>Jobs at Smartsheet</title>'})})).status, 'EXPIRED');
  assert.equal((await verifyJob(job, {http: http({ok: false, status: 404, url: job.sourceUrl, text: ''})})).status, 'EXPIRED');
  assert.equal((await verifyJob(job, {http: http({ok: false, status: 403, url: job.sourceUrl, text: ''})})).status, 'BLOCKED');
  assert.equal((await verifyJob(job, {http: http({ok: true, status: 200, url: job.sourceUrl, text: '<title>Careers</title>'})})).status, 'UNVERIFIED');
});

test('verifying through the service stores the result and closes expired jobs', async () => {
  const {service} = await collected();
  const id = 'greenhouse:smartsheet:8238594', url = 'https://job-boards.greenhouse.io/smartsheet/jobs/8238594';
  pages.set(url, {ok: true, status: 200, url, text: '<title>Job Application for Commercial GRC Engineer - Sr. Security Engineer I at Smartsheet</title>'});
  assert.equal((await service.verify({id})).status, 'VERIFIED_ORIGINAL');
  assert.equal((await service.job({id})).verification, 'VERIFIED_ORIGINAL');
  assert.equal(service.status().verified, 1);
  pages.set(url, {ok: false, status: 404, url, text: ''});
  assert.equal((await service.verify({id})).status, 'EXPIRED');
  assert.equal(service.status().activeJobs, 7);
  service.close();
});

test('the discovery worker thread answers requests and rejects unknown ones', async () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-worker-')), 'discovery.db');
  const worker = new Worker(path.join(__dirname, '../src/discovery/worker.js'), {workerData: {dbPath}});
  const ask = (id, method, args) => new Promise(resolve => {
    const listener = message => {if (message.id === id) {worker.off('message', listener);resolve(message);}};
    worker.on('message', listener);worker.postMessage({id, method, args});
  });
  try {
    const status = await ask(1, 'status');
    assert.equal(status.result.boards, 0);assert.equal(status.result.task, null);
    const added = await ask(2, 'addBoard', {url: 'https://jobs.ashbyhq.com/ramp'});
    assert.equal(added.result.id, 'ashby:ramp');
    assert.match((await ask(3, 'dropTables')).error, /Unknown discovery request/);
  } finally {await worker.terminate();}
});
