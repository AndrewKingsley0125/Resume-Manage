// Starts the real app (src/main/main.js) with a temporary data folder holding a
// test profile and fixture jobs, then drives the Find jobs screen in a hidden window.
// Usage: node scripts/verify-discovery-ui.cjs [screenshot-folder]
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
if (!process.versions.electron) {
  const {spawnSync} = require('node:child_process');
  const env = {...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [__filename, ...process.argv.slice(2)], {env, stdio: 'inherit', windowsHide: true});
  process.exit(result.status || (result.error ? 1 : 0));
}
process.removeAllListeners('warning');
const {app, BrowserWindow} = require('electron');
const root = path.join(__dirname, '..');
const shots = process.argv.find(arg => arg !== __filename && !arg.startsWith('-') && fs.existsSync(arg) && fs.statSync(arg).isDirectory() && arg !== root);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-ui-'));
app.setPath('userData', temp);

// Test data: one extension-mode profile with a saved resume, and the fixture jobs.
const profile = {id: 'p-tony', firstName: 'Tony', lastName: 'Test', title: 'Senior Software Engineer', location: 'Berkeley CA', applicationMode: 'extension', extensionJobLinks: [],
  workHistory: [{company: 'A', title: 'Senior Software Engineer', period: 'May 2016 - Oct 2026'}], education: [], certifications: [], applicationDetails: {authorizedToWork: 'Yes', sponsorshipNow: 'No'}};
fs.writeFileSync(path.join(temp, 'profiles.json'), JSON.stringify([profile]));
fs.mkdirSync(path.join(temp, 'resumes'));
fs.writeFileSync(path.join(temp, 'resumes', 'p-tony.json'), JSON.stringify({experience: [{title: 'Security Engineer'}], skills: [{Core: ['Python', 'AWS', 'Kubernetes']}]}));
const {openStore} = require(path.join(root, 'src/discovery/store'));
const {byId} = require(path.join(root, 'src/discovery/providers'));
const fixture = name => JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/discovery', name), 'utf8'));
const store = openStore(path.join(temp, 'discovery.db'));
for (const [provider, board, file, pick] of [['greenhouse', 'smartsheet', 'greenhouse-smartsheet.json', d => d.jobs], ['lever', 'palantir', 'lever-palantir.json', d => d], ['ashby', 'ramp', 'ashby-ramp.json', d => d.jobs]]) {
  const saved = store.addBoard({provider, board, companyName: board[0].toUpperCase() + board.slice(1)});
  // Recent dates, so the default "posted within 30 days" keeps them.
  store.saveBoardJobs(saved.id, pick(fixture(file)).map(raw => ({...byId[provider].normalizeJob(raw, saved), publishedAt: new Date(Date.now() - 2 * 86400000).toISOString()})));
}
store.close();

require(path.join(root, 'src/main/main.js'));

const wait = async (win, expression, ms = 15000) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await win.webContents.executeJavaScript(`!!(${expression})`)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for: ${expression}`);
};
const run = (win, code) => win.webContents.executeJavaScript(code);

app.whenReady().then(async () => {
  let failed = false;
  try {
    let win;
    for (let i = 0; i < 100 && !(win = BrowserWindow.getAllWindows()[0]); i++) await new Promise(resolve => setTimeout(resolve, 100));
    win.hide();
    await new Promise(resolve => win.webContents.once('did-finish-load', resolve)).catch(() => {});
    await wait(win, `document.getElementById('discovery-btn')`);
    await run(win, `document.getElementById('discovery-btn').click()`);
    await wait(win, `document.body.dataset.view === 'discovery'`);
    assert.equal(await run(win, `getComputedStyle(document.getElementById('discovery-view')).display`), 'block');
    assert.equal(await run(win, `getComputedStyle(document.getElementById('list-view')).display`), 'none');
    assert.equal(await run(win, `getComputedStyle(document.getElementById('new-profile-btn')).display`), 'none');
    await wait(win, `document.getElementById('discovery-jobs').textContent === '8'`);
    assert.equal(await run(win, `document.getElementById('discovery-boards').textContent`), '3');
    assert.equal(await run(win, `getComputedStyle(document.getElementById('discovery-stop')).display`), 'none', 'Stop shows only while a task runs');
    console.log('PASS: Find jobs opens from the profile list and shows the collected boards and jobs.');

    // The saved search is created from the profile and its resume.
    await wait(win, `document.getElementById('discovery-titles').value.includes('Security Engineer')`);
    assert.equal(await run(win, `document.getElementById('discovery-skills').value`), 'Python, AWS, Kubernetes');
    await wait(win, `document.querySelectorAll('#discovery-list .discovery-item').length > 0`);
    const titles = await run(win, `[...document.querySelectorAll('#discovery-list h4')].map(h => h.firstChild.textContent)`);
    assert.ok(titles.some(title => /Security Engineer/.test(title)), titles.join(' | '));
    assert.ok(!titles.some(title => /Bangalore|Administrative|Account Executive/.test(title)), titles.join(' | '));
    assert.match(await run(win, `document.getElementById('discovery-funnel').textContent`), /^Of 8 jobs: \d+ fit the titles → \d+ posted within 30 days → \d+ open to you in the US → \d+ scored 55 or more\.$/);
    console.log(`PASS: matches are ranked for the profile (${titles.length}): ${titles.join(' | ')}`);

    if (shots) {
      win.setBounds({x: -4000, y: -4000, width: 1280, height: 1400});win.showInactive();await new Promise(resolve => setTimeout(resolve, 500));
      for (const theme of ['dark', 'light']) {
        await run(win, `document.documentElement.dataset.theme = '${theme}';window.scrollTo(0, 0)`);await new Promise(resolve => setTimeout(resolve, 400));
        fs.writeFileSync(path.join(shots, `discovery-${theme}.png`), (await win.webContents.capturePage()).toPNG());
      }
      win.hide();
      console.log(`Screenshots in ${shots}`);
    }
    // Editing the search changes the matches and is kept.
    await run(win, `document.getElementById('discovery-titles').value = 'Backend Software Engineer';document.getElementById('discovery-min').value = '30';document.getElementById('discovery-save-search').click()`);
    await wait(win, `[...document.querySelectorAll('#discovery-list h4')].some(h => /Backend Software Engineer/.test(h.textContent))`);
    await wait(win, `document.getElementById('discovery-titles').value === 'Backend Software Engineer'`);
    assert.equal(await run(win, `[...document.querySelectorAll('#discovery-list h4')].some(h => /Security Engineer, Cloud/.test(h.textContent))`), false, 'results from the previous search are replaced, not added to');
    console.log('PASS: editing the search saves it and replaces the results.');

    // Filters apply on change, without Save. "US remote only" drops the on-site D.C. job.
    const setPlaces = value => run(win, `(() => {const s = document.getElementById('discovery-places');s.value = '${value}';s.dispatchEvent(new Event('change'));})()`);
    await setPlaces('remote');
    await wait(win, `/No matches/.test(document.getElementById('discovery-empty').textContent) && document.querySelectorAll('#discovery-list .discovery-item').length === 0`);
    await setPlaces('any');
    await wait(win, `[...document.querySelectorAll('#discovery-list h4')].some(h => /Backend Software Engineer/.test(h.textContent))`);
    console.log('PASS: changing "Where" applies at once; "US remote only" excludes on-site jobs.');

    // Sending needs a linked extension; the message says so instead of failing silently.
    await run(win, `[...document.querySelectorAll('#discovery-list button')].find(b => b.textContent === 'Send to extension').click()`);
    await wait(win, `/Link a Chrome extension/.test(document.getElementById('discovery-send-status').textContent)`);
    console.log('PASS: Send to extension explains what is missing before doing anything.');

    // Job description loads on demand; Hide removes the job.
    await run(win, `document.querySelector('#discovery-list details').open = true`);
    await wait(win, `document.querySelector('#discovery-list details pre') && !/Loading/.test(document.querySelector('#discovery-list details pre').textContent)`);
    const before = await run(win, `document.querySelectorAll('#discovery-list .discovery-item').length`);
    await run(win, `[...document.querySelectorAll('#discovery-list button')].find(b => b.textContent === 'Hide').click()`);
    await wait(win, `document.querySelectorAll('#discovery-list .discovery-item').length === ${before - 1}`);
    console.log('PASS: job descriptions load on demand and Hide removes a job.');

    // A non-ATS link is refused; a Lever board is registered.
    await run(win, `document.getElementById('discovery-board-url').value = 'https://www.linkedin.com/jobs/view/1';document.getElementById('discovery-add-board').click()`);
    await wait(win, `/Greenhouse, Lever or Ashby/.test(document.getElementById('discovery-board-status').textContent)`);
    await run(win, `document.getElementById('discovery-board-url').value = 'https://jobs.lever.co/newco';document.getElementById('discovery-add-board').click()`);
    await wait(win, `/lever board "newco"/.test(document.getElementById('discovery-board-status').textContent)`);
    await wait(win, `document.getElementById('discovery-boards').textContent === '4'`);
    console.log('PASS: boards can be added by link; other links are refused.');

    await run(win, `window.location.hash = '#/'`);
    await wait(win, `document.body.dataset.view === 'list'`);
    assert.equal(await run(win, `getComputedStyle(document.getElementById('discovery-view')).display`), 'none');
    console.log('PASS: leaving the screen returns to the profile list.');
  } catch (error) {
    failed = true;console.error(error);
  } finally {
    app.exit(failed ? 1 : 0);
  }
});
