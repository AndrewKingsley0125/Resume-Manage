// Main-process side of Job Discovery: starts the discovery worker thread on
// first use, forwards requests to it, and passes progress events to the window.
// Profiles and resumes are read here (the worker never touches the app's JSON
// files) and sent along with each request that needs them.
const path = require('node:path');
const { Worker } = require('node:worker_threads');

// Inside a packaged app the worker script is unpacked beside app.asar (see package.json asarUnpack).
const workerFile = () => path.join(__dirname, '..', 'discovery', 'worker.js').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

function createDiscovery({ dbPath, onEvent = () => {} }) {
  let worker = null, seq = 0;
  const pending = new Map();
  const failAll = error => {for (const { reject } of pending.values()) reject(error);pending.clear();};
  function ensure() {
    if (worker) return worker;
    worker = new Worker(workerFile(), { workerData: { dbPath } });
    worker.on('message', message => {
      if (message.event) {onEvent(message);return;}
      const call = pending.get(message.id);
      if (!call) return;
      pending.delete(message.id);
      if (message.error) call.reject(new Error(message.error));else call.resolve(message.result);
    });
    worker.on('error', error => {failAll(error);worker = null;onEvent({ event: 'done', error: `Discovery stopped: ${error.message}` });});
    worker.on('exit', () => {failAll(new Error('Discovery worker stopped.'));worker = null;});
    return worker;
  }
  function call(method, args = {}) {
    const id = ++seq, target = ensure();
    return new Promise((resolve, reject) => {pending.set(id, { resolve, reject });target.postMessage({ id, method, args });});
  }
  async function close() {
    if (!worker) return;
    try {await call('stop');} catch (_) { /* already stopping */ }
    await worker.terminate();
    worker = null;
  }
  return { call, close };
}

const text = (value, max = 2000) => typeof value === 'string' ? value.slice(0, max) : '';
const list = value => Array.isArray(value) ? value.map(item => text(item, 80)).filter(Boolean).slice(0, 80) : [];

// IPC handlers. Every argument from the window is checked here before it reaches the worker.
function registerDiscoveryIpc(ipcMain, { discovery, readProfiles, readResume, openExternal }) {
  const profileFor = id => {
    const profile = readProfiles().find(item => item.id === id);
    if (!profile) throw new Error('This profile no longer exists.');
    return profile;
  };
  ipcMain.handle('discovery:status', () => discovery.call('status'));
  ipcMain.handle('discovery:discover', (_event, args = {}) => discovery.call('discover', { crawls: Number(args.crawls) || 4 }));
  ipcMain.handle('discovery:sync', () => discovery.call('sync'));
  ipcMain.handle('discovery:stop', () => discovery.call('stop'));
  ipcMain.handle('discovery:addBoard', (_event, url) => discovery.call('addBoard', { url: text(url) }));
  ipcMain.handle('discovery:searchProfile', (_event, profileId) => {
    const profile = profileFor(text(profileId, 100));
    return discovery.call('searchProfile', { profile, resume: readResume(profile.id) });
  });
  ipcMain.handle('discovery:saveSearchProfile', (_event, profileId, search = {}) => {
    const profile = profileFor(text(profileId, 100));
    return discovery.call('saveSearchProfile', { profile, search: {
      titles: list(search.titles), skills: list(search.skills), minScore: Number(search.minScore), days: search.days === null ? null : Number(search.days),
      places: text(search.places, 20), includeUnverified: search.includeUnverified !== false,
    } });
  });
  ipcMain.handle('discovery:matches', (_event, profileId, options = {}) => {
    const profile = profileFor(text(profileId, 100));
    return discovery.call('matches', { profile, resume: readResume(profile.id), limit: Number(options.limit) || 100, showHidden: options.showHidden === true });
  });
  ipcMain.handle('discovery:job', (_event, id) => discovery.call('job', { id: text(id, 300) }));
  ipcMain.handle('discovery:verify', (_event, id) => discovery.call('verify', { id: text(id, 300) }));
  ipcMain.handle('discovery:mark', (_event, profileId, id, status) => discovery.call('mark', { profileId: text(profileId, 100), id: text(id, 300), status: status ? text(status, 20) : null }));
  // Only job postings are opened, and only over http(s).
  ipcMain.handle('discovery:open', (_event, url) => {
    const parsed = new URL(text(url));
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Only web links can be opened.');
    return openExternal(parsed.href);
  });
}

module.exports = { createDiscovery, registerDiscoveryIpc };
