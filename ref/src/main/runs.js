// Queue and manage application runs in external Chrome / Edge tabs.
const os = require('node:os');
const { createLlm } = require('../llm');
const { ChromeRun } = require('../automation/chrome-run');
const { htmlToPdf } = require('./pdf');
const { checkBrowserCompatibility } = require('./browser-protocol');

// Each tab holds a job page and a ChatGPT page: about 1–1.2 GB of memory.
const GB = 1024 ** 3;
const MAX_PARALLEL = 10; // highest fixed choice offered; 0 = all links at once

/**
 * @param {object} deps
 * @param {object} deps.storage
 * @param {object} deps.panes      from createPanes()
 * @param {object} deps.prompts    from createPrompts()
 * @param {(channel: string, payload: object) => void} deps.send  to the control panel
 */
function createRunManager({ storage, panes, prompts, send, bridge }) {
  const runs = new Map(); // run id → { run, slot, status }
  const queue = []; // { runId, profileId, url } waiting for room
  let nextRunId = Date.now(); // avoid reusing extension tab mappings after app restart

  const sendRun = (runId, type, payload) => send('run:event', { runId, type, payload });
  const activeCount = () => [...runs.values()].filter(r => r.status === 'running').length;

  /** How many tabs this computer handles comfortably, from free memory and CPU threads. */
  function capacity() {
    const free = os.freemem(), cpus = os.cpus().length;
    const byMemory = Math.floor((free - 1.5 * GB) / (1.2 * GB));
    const recommended = Math.max(1, Math.min(byMemory, Math.floor(cpus / 2)));
    const chosen = Number(storage.getSettings().parallel) || 0;
    return {
      recommended, max: MAX_PARALLEL, chosen,
      limit: chosen ? Math.max(1, chosen) : Infinity,
      freeGb: Math.round((free / GB) * 10) / 10, totalGb: Math.round(os.totalmem() / GB), cpus,
    };
  }

  function setParallel(n) {
    storage.saveSettings({ parallel: Number(n) || 0 }); // 0: all links at once
    pump();
    return capacity();
  }

  /** Queue job URLs for a profile; each becomes a tab, started while there is room. */
  async function startRuns(profileId, urls) {
    const profile = storage.getProfile(profileId);
    if (!profile) throw new Error('Profile not found');
    const list = [].concat(urls).map(u => String(u).trim()).filter(Boolean);
    if (!list.length) throw new Error('Enter at least one job URL');
    if (!bridge.connected()) throw new Error('Connect the Auto Apply Chrome extension first.');
    for (const url of list) if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error('Use HTTP or HTTPS job links');
    // Reject stale loaded workers before queueing runs or opening browser tabs.
    await checkBrowserCompatibility(bridge);
    for (const url of list) {
      const runId = nextRunId++;
      queue.push({ runId, profileId, url });
      sendRun(runId, 'queued', { url, profileId, profile: [profile.firstName, profile.lastName].filter(Boolean).join(' ') });
    }
    pump();
    return true;
  }

  function pump() {
    while (queue.length && activeCount() < capacity().limit) {
      const next = queue.shift();
      runs.set(next.runId, { status: 'running' }); // reserve the place before the async start
      startRun(next).catch(err => {
        sendRun(next.runId, 'log', `Could not start: ${err.message}`);
        finishRun(next.runId, { status: 'failed', error: err.message });
      });
    }
  }

  async function startRun({ runId, profileId, url }) {
    const profile = storage.getProfile(profileId);
    if (!profile) throw new Error('Profile not found');
    const slot = { profileId };
    const settings = storage.getSettings();
    const askUser = request => prompts.askUser(runId, request);
    let run;
    const llm = createLlm(settings.llmProvider === 'manual' && settings.browserAutomation === false ? 'manual' : 'chrome-chat', {
      askUser, settings, bridge, runId, cancelled: () => !!run?.cancelled,
    });
    run = new ChromeRun({ profile, url, settings, llm, askUser, htmlToPdf, storage, bridge, runId });
    runs.set(runId, { run, slot, status: 'running' });
    sendRun(runId, 'started', { url });
    run.on('step', st => sendRun(runId, 'step', st));
    run.on('log', m => sendRun(runId, 'log', m));
    run.on('job', j => sendRun(runId, 'job', j));
    run.on('done', r => sendRun(runId, 'done', r));
    run.run().then(record => finishRun(runId, record), err => finishRun(runId, { status: 'failed', error: err.message }));
  }

  function finishRun(runId, record) {
    const entry = runs.get(runId);
    if (entry) entry.status = record.status || 'finished';
    prompts.resolveRun(runId, null);
    if (!entry || !entry.run) sendRun(runId, 'done', record); // never started: the run did not report it
    pump();
  }

  function cancelRun(runId) {
    const queued = queue.findIndex(q => q.runId === runId);
    if (queued >= 0) {
      queue.splice(queued, 1);
      sendRun(runId, 'done', { status: 'cancelled' });
      return;
    }
    const entry = runs.get(runId);
    if (entry && entry.run) entry.run.cancel();
    prompts.resolveRun(runId, null);
  }

  /** Close a finished run's tab (its browser views); its files and record stay. */
  function closeRun(runId) {
    const entry = runs.get(runId);
    if (entry && entry.status === 'running') throw new Error('Cancel the run before closing it');
    runs.delete(runId);
    bridge.request('close', { runId }).catch(() => {});
  }

  const profileBusy = profileId => [...runs.values()].some(r => r.status === 'running' && r.slot && r.slot.profileId === profileId)
    || queue.some(q => q.profileId === profileId);

  return { startRuns, cancelRun, closeRun, capacity, setParallel, profileBusy };
}

module.exports = { createRunManager };
