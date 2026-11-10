// Desktop control panel. Job sites and ChatGPT run in normal Chrome / Edge
// through the Native Messaging companion extension.
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const { createStorage } = require('../core/storage');
const { createBrowserBridge } = require('./browser-bridge');
const { checkBrowserCompatibility } = require('./browser-protocol');
const { createPrompts } = require('./prompts');
const { createRunManager } = require('./runs');


app.setAppUserModelId('com.autoapply.app'); // Windows shows notifications only with an app id

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1000,
    minHeight: 600,
    title: 'Auto Apply',
    backgroundColor: '#0f1115',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.setMenuBarVisibility(false);
  win.maximize();
  win.on('focus', () => win.flashFrame(false));
}

app.whenReady().then(async () => {
  const storage = createStorage(app.getPath('userData'));
  createWindow();
  const send = (channel, payload) => win && !win.isDestroyed() && win.webContents.send(channel, payload);
  const bridge = await createBrowserBridge(path.join(__dirname, '..', '..', '.bridge'));
  app.once('before-quit', () => bridge.close());
  const panes = { useProfile() {}, setBounds() {}, cover() {}, navigate() {} };
  const prompts = createPrompts(() => win);
  const runs = createRunManager({ storage, panes, prompts, send, bridge });

  // Profiles
  ipcMain.handle('profiles:list', () => storage.listProfiles());
  ipcMain.handle('profiles:import', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Import from Resume Manager: profiles.json or a backup file (includes styles)',
      defaultPath: path.join(app.getPath('appData'), 'Resume Manager'),
      filters: [{ name: 'Resume Manager profiles or backup', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    try {
      return storage.importProfiles(result.filePaths[0]);
    } catch (err) {
      return { error: err.message };
    }
  });
  ipcMain.handle('profiles:save', (_e, profile) => storage.saveProfile(profile));
  ipcMain.handle('profiles:delete', (_e, id) => {
    if (runs.profileBusy(id)) throw new Error('This profile has applications running');
    storage.deleteProfile(id);
  });
  ipcMain.handle('dialog:folder', async (_e, current) => {
    const result = await dialog.showOpenDialog(win, { title: 'Save folder for exported resumes', defaultPath: current || undefined, properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  // Candidate selection does not change the browser?s signed-in account.
  ipcMain.handle('profile:select', (_e, profileId) => {
    if (!storage.getProfile(profileId)) throw new Error('Profile not found');
    panes.useProfile(profileId);
  });

  // Settings and ChatGPT
  ipcMain.handle('settings:get', () => storage.getSettings());
  ipcMain.handle('settings:save', (_e, s) => storage.saveSettings(s));
  ipcMain.handle('chat:status', async () => {
    if (!bridge.connected()) return { connected: false };
    try {
      const capabilities = await checkBrowserCompatibility(bridge);
      return { connected: true, compatible: true, version: capabilities.version };
    } catch (error) { return { connected: bridge.connected(), compatible: false, error: error.message }; }
  });
  ipcMain.handle('chat:prompt', (_e, runId, text) => bridge.request('chatPrompt', { runId, text }));
  ipcMain.handle('chat:reply', (_e, runId) => bridge.request('chatReply', { runId }));

  // Runs (one tab per job link)
  ipcMain.handle('run:start', (_e, profileId, urls) => runs.startRuns(profileId, urls));
  ipcMain.handle('run:cancel', (_e, runId) => runs.cancelRun(runId));
  ipcMain.handle('run:close', (_e, runId) => runs.closeRun(runId));
  ipcMain.handle('run:show', () => ({}));
  ipcMain.handle('browser:focus', (_e, runId) => bridge.request('focus', { runId }));
  ipcMain.handle('run:respond', (_e, id, value) => prompts.respond(id, value));
  ipcMain.handle('runs:capacity', () => runs.capacity());
  ipcMain.handle('runs:set-parallel', (_e, n) => runs.setParallel(n));

  // Pane layout and navigation
  ipcMain.handle('pane:bounds', (_e, name, rect) => panes.setBounds(name, rect));
  ipcMain.handle('pane:nav', (_e, name, action) => panes.navigate(name, action));
  ipcMain.handle('panes:cover', (_e, on) => panes.cover(on));

  // Load the control panel once every handler it calls is registered.
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
});

app.on('window-all-closed', () => app.quit());
