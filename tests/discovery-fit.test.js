const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {openStore} = require('../src/discovery/store');
const {boardsFromIndex, discoverBoards} = require('../src/discovery/sources/commoncrawl');
const {profileTargets, scoreJob, rankJobs, titleScore, homeState} = require('../src/discovery/fit');
const {buildJob} = require('../src/discovery/normalize');
const {byId} = require('../src/discovery/providers');

const line = url => JSON.stringify({url});

test('Common Crawl index lines become unique, valid boards', () => {
  const text = [
    line('https://boards.greenhouse.io/airbnb/jobs/123'), line('https://boards.greenhouse.io/airbnb'), line('https://job-boards.greenhouse.io/AirBnB/jobs/9'),
    line('https://boards.greenhouse.io/embed/job_board?for=stripe'), line('https://boards.greenhouse.io/embed/job_app'),
    line('https://jobs.ashbyhq.com/ramp/abc'), line('https://jobs.lever.co/palantir/xyz'), line('https://boards.greenhouse.io/1pyra)mid_health&care'),
    'not json', line('https://example.com/careers'),
  ].join('\n');
  assert.deepEqual(boardsFromIndex(text).map(board => `${board.provider}:${board.board}`).sort(),
    ['ashby:ramp', 'greenhouse:airbnb', 'greenhouse:stripe', 'lever:palantir']);
});

test('board discovery is resumable: finished pages are skipped and failed ones retried', async () => {
  const store = openStore();
  let fail = true;const asked = [];
  const http = {
    getText: async url => {
      asked.push(url);
      if (url.includes('showNumPages')) return url.includes('lever') ? {ok: false, status: 404, text: ''} : {ok: true, status: 200, text: JSON.stringify({pages: 2})};
      if (url.includes('page=1') && fail) throw new Error('HTTP 504');
      const token = url.includes('page=0') ? 'alpha' : 'beta';
      return {ok: true, status: 200, text: line(`https://boards.greenhouse.io/${token}/jobs/1`)};
    },
  };
  const patterns = ['boards.greenhouse.io/*', 'jobs.lever.co/*'];
  const first = await discoverBoards({http, store, crawls: ['CC-TEST'], patterns});
  assert.deepEqual([first.added, first.failed], [1, 1]);
  fail = false;asked.length = 0;
  const second = await discoverBoards({http, store, crawls: ['CC-TEST'], patterns});
  assert.deepEqual([second.added, second.skipped, second.failed], [1, 1, 0]);
  assert.ok(!asked.some(url => url.includes('page=0')), 'a finished page is not fetched again');
  assert.deepEqual(store.listBoards().map(board => board.id).sort(), ['greenhouse:alpha', 'greenhouse:beta']);
  assert.equal(store.listBoards()[0].origin, 'commoncrawl');
  store.close();
});

test('a board the provider no longer has is switched off', () => {
  const store = openStore();
  store.addBoard({provider: 'greenhouse', board: 'gone'});store.addBoard({provider: 'greenhouse', board: 'flaky'});
  store.recordFailure('greenhouse:gone', 'HTTP 404', {gone: true});
  store.recordFailure('greenhouse:flaky', 'HTTP 503');
  assert.deepEqual(store.listBoards().map(board => board.id), ['greenhouse:flaky']);
  store.close();
});

const tony = {
  id: 'p1', firstName: 'Tony', title: 'Senior Software Engineer', location: 'Berkeley CA',
  workHistory: [{period: 'May 2024 - Oct 2026'}, {period: 'Feb 2016 - May 2020'}],
  applicationDetails: {authorizedToWork: 'Yes', sponsorshipNow: 'No', sponsorshipFuture: 'No'},
};
const tonyResume = {experience: [{title: 'Senior Software Engineer - ML Infrastructure', technologies: ['Kubernetes']}, {title: 'Machine Learning Engineer'}],
  skills: [{'Languages': ['Python', 'SQL', 'C++']}, {'ML': ['PyTorch', 'Spark', 'MLOps']}]};
const job = fields => buildJob({provider: 'greenhouse', board: 'acme', externalId: Math.random().toString(36).slice(2), companyName: 'Acme', publishedAt: '2026-11-01T00:00:00Z', ...fields});

test('targets come from the profile and its saved resume', () => {
  const targets = profileTargets(tony, tonyResume, {now: new Date('2026-11-10')});
  assert.deepEqual(targets.titles, ['Senior Software Engineer', 'Senior Software Engineer - ML Infrastructure', 'Machine Learning Engineer']);
  assert.deepEqual(targets.skills, ['Python', 'SQL', 'C++', 'PyTorch', 'Spark', 'MLOps', 'Kubernetes']);
  assert.deepEqual([targets.years, targets.homeState, targets.needsSponsorship], [10, 'CA', false]);
  assert.equal(homeState('Forest Park, IL 60130'), 'IL');
});

test('title matching follows the role family, not shared generic words', () => {
  const targets = ['Senior Software Engineer - ML Infrastructure', 'Machine Learning Engineer'];
  assert.equal(titleScore('Staff Machine Learning Engineer', targets), 1);
  assert.equal(titleScore('Software Engineer, Backend (Remote - US)', targets) > 0.4, true);
  assert.equal(titleScore('Hardware Engineer', targets), 0);
  assert.equal(titleScore('Account Executive', targets), 0);
});

test('fit scores rank real role matches first and never list jobs the applicant cannot take', () => {
  const targets = profileTargets(tony, tonyResume, {now: new Date('2026-11-10')});
  const ml = job({title: 'Senior Machine Learning Engineer', locationText: 'Remote - US', description: 'Python, PyTorch, Spark and Kubernetes for MLOps.', workplaceType: 'remote'});
  const local = job({title: 'Software Engineer, ML Platform', locationText: 'San Francisco, CA', description: 'Python and SQL.'});
  const sales = job({title: 'Account Executive', locationText: 'Remote - US', description: 'Sell software.', workplaceType: 'remote'});
  const abroad = job({title: 'Machine Learning Engineer', locationText: 'Bangalore, INDIA', description: 'Python PyTorch'});
  const otherStates = job({title: 'Machine Learning Engineer', locationText: 'Remote - Texas, Florida', description: 'Python', workplaceType: 'remote'});
  const intern = job({title: 'Machine Learning Intern', locationText: 'Remote - US', description: 'Python PyTorch', workplaceType: 'remote'});
  assert.ok(scoreJob(ml, targets).score >= 80, JSON.stringify(scoreJob(ml, targets)));
  assert.ok(scoreJob(local, targets).eligible);
  assert.ok(scoreJob(sales, targets).score <= 25);
  assert.deepEqual(scoreJob(abroad, targets).blockers, ['Outside the US']);
  assert.deepEqual(scoreJob(otherStates, targets).blockers, ['Remote only in TX, FL']);
  assert.ok(scoreJob(intern, targets).score < scoreJob(ml, targets).score - 10);
  const ranked = rankJobs([sales, abroad, local, ml, otherStates], targets, {now: new Date('2026-11-10')}).map(item => item.job.title);
  assert.deepEqual(ranked, ['Senior Machine Learning Engineer', 'Software Engineer, ML Platform']);
});

test('applicants who need sponsorship do not see jobs that refuse it', () => {
  const targets = profileTargets({...tony, applicationDetails: {sponsorshipFuture: 'Yes'}}, tonyResume);
  const refuses = job({title: 'Machine Learning Engineer', locationText: 'Remote - US', workplaceType: 'remote', description: 'We are unable to provide visa sponsorship for this role.'});
  const silent = job({title: 'Machine Learning Engineer', locationText: 'Remote - US', workplaceType: 'remote', description: 'Python.'});
  assert.deepEqual(scoreJob(refuses, targets).blockers, ['Posting says no visa sponsorship']);
  assert.equal(scoreJob(silent, targets).eligible, true);
});

test('real fixture postings: only the US role is a candidate for a US applicant', () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/discovery/greenhouse-smartsheet.json'), 'utf8')).jobs;
  const jobs = raw.map(item => byId.greenhouse.normalizeJob(item, {board: 'smartsheet'}));
  const targets = profileTargets({...tony, title: 'Security Engineer'}, null);
  const eligible = jobs.filter(item => scoreJob(item, targets).eligible).map(item => item.locationText);
  assert.deepEqual(eligible, ['Bellevue, WA, USA']);
});

test('only US jobs are eligible: a bare "Remote" with no country is not counted as US', () => {
  const targets = profileTargets(tony, tonyResume, {now: new Date('2026-11-10')});
  const base = {title: 'Machine Learning Engineer', description: 'Python PyTorch'};
  const bare = scoreJob(job({...base, locationText: 'Remote', workplaceType: 'remote'}), targets);
  assert.deepEqual(bare.blockers, ['Remote; country not stated']);
  const usRemote = scoreJob(job({...base, locationText: 'Remote - US', workplaceType: 'remote'}), targets);
  assert.deepEqual([usRemote.eligible, usRemote.usRemote], [true, true]);
  // Remote in Canada with a New York office: a US job, but not US-remote work.
  const office = scoreJob(job({...base, locationText: 'Remote (Canada); New York, NY', workplaceType: 'remote'}), targets);
  assert.deepEqual([office.eligible, office.usRemote], [true, false]);
  const local = scoreJob(job({...base, locationText: 'Oakland, CA'}), targets);
  assert.deepEqual([local.eligible, local.usRemote, local.local, local.relocation], [true, false, true, false]);
  const away = scoreJob(job({...base, locationText: 'Austin, TX'}), targets);
  assert.deepEqual([away.eligible, away.local, away.relocation], [true, false, true]);
});

test('level numbers after the role set seniority, and scoring uses them for jobs stored earlier', () => {
  const {seniorityOf} = require('../src/discovery/normalize');
  assert.equal(seniorityOf('Software Engineer-1'), 'entry');
  assert.equal(seniorityOf('Software Engineer I'), 'entry');
  assert.equal(seniorityOf('Software Engineer II'), 'mid');
  assert.equal(seniorityOf('Data Scientist 2'), 'mid');
  assert.equal(seniorityOf('Software Engineer III'), 'senior');
  assert.equal(seniorityOf('Commercial GRC Engineer - Sr. Security Engineer I'), 'senior');
  const targets = profileTargets(tony, tonyResume, {now: new Date('2026-11-10')});
  // Stored before the rule existed: the record still says "unknown".
  const stored = {...job({title: 'Software Engineer-1', locationText: 'Remote - US', workplaceType: 'remote', description: 'Python'}), seniority: 'unknown'};
  const scored = scoreJob(stored, targets);
  assert.equal(scored.parts.seniority, 0.1);
  assert.ok(scored.score < 50 && scored.reasons.includes('Level does not match experience'), JSON.stringify(scored));
});
