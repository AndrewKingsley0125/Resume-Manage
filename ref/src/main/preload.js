const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  importProfiles: () => ipcRenderer.invoke('profiles:import'),
  saveProfile: profile => ipcRenderer.invoke('profiles:save', profile),
  deleteProfile: id => ipcRenderer.invoke('profiles:delete', id),
  pickFolder: current => ipcRenderer.invoke('dialog:folder', current),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: s => ipcRenderer.invoke('settings:save', s),

  chatStatus: () => ipcRenderer.invoke('chat:status'),
  sendChatPrompt: (runId, text) => ipcRenderer.invoke('chat:prompt', runId, text),
  importChatReply: runId => ipcRenderer.invoke('chat:reply', runId),
  focusBrowser: runId => ipcRenderer.invoke('browser:focus', runId),
  selectProfile: profileId => ipcRenderer.invoke('profile:select', profileId),
  startRuns: (profileId, urls) => ipcRenderer.invoke('run:start', profileId, urls),
  cancelRun: runId => ipcRenderer.invoke('run:cancel', runId),
  closeRun: runId => ipcRenderer.invoke('run:close', runId),
  showRun: runId => ipcRenderer.invoke('run:show', runId),
  capacity: () => ipcRenderer.invoke('runs:capacity'),
  setParallel: n => ipcRenderer.invoke('runs:set-parallel', n),
  respond: (id, value) => ipcRenderer.invoke('run:respond', id, value),

  setPaneBounds: (name, rect) => ipcRenderer.invoke('pane:bounds', name, rect),
  navigatePane: (name, action) => ipcRenderer.invoke('pane:nav', name, action),
  coverPanes: on => ipcRenderer.invoke('panes:cover', on),

  onRunEvent: cb => ipcRenderer.on('run:event', (_e, ev) => cb(ev)),
  onAsk: cb => ipcRenderer.on('run:ask', (_e, req) => cb(req)),
  onPaneUrl: cb => ipcRenderer.on('pane:url', (_e, info) => cb(info)),
});
