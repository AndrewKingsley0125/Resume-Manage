const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listProfiles: () => ipcRenderer.invoke('profiles:list'),
  saveProfiles: (profiles) => ipcRenderer.invoke('profiles:save', profiles),

  getResume: (profileId) => ipcRenderer.invoke('resume:get', profileId),
  saveResume: (profileId, data) =>
    ipcRenderer.invoke('resume:save', profileId, data),
  deleteResume: (profileId) => ipcRenderer.invoke('resume:delete', profileId),

  getPrompt: (profileId) => ipcRenderer.invoke('prompt:get', profileId),
  savePrompt: (profileId, text) =>
    ipcRenderer.invoke('prompt:save', profileId, text),
  deletePrompt: (profileId) => ipcRenderer.invoke('prompt:delete', profileId),

  getJd: (profileId) => ipcRenderer.invoke('jd:get', profileId),
  saveJd: (profileId, text) => ipcRenderer.invoke('jd:save', profileId, text),
  deleteJd: (profileId) => ipcRenderer.invoke('jd:delete', profileId),

  exportPdf: (args) => ipcRenderer.invoke('pdf:export', args),
  renderPdf: (html) => ipcRenderer.invoke('pdf:render', html),
  revealInFolder: (filePath) => ipcRenderer.invoke('pdf:reveal', filePath),

  pickFolder: (defaultPath) => ipcRenderer.invoke('dialog:pickFolder', defaultPath),

  listProcesses: (profileId, saveFolder) =>
    ipcRenderer.invoke('process:list', profileId, saveFolder),
  syncProcesses: (profileId, saveFolder) =>
    ipcRenderer.invoke('process:sync', profileId, saveFolder),
  saveProcess: (profileId, companyName, patch) =>
    ipcRenderer.invoke('process:save', profileId, companyName, patch),
  deleteProcesses: (profileId) =>
    ipcRenderer.invoke('process:delete', profileId),
  readJdFile: (filePath) => ipcRenderer.invoke('process:readJd', filePath),
  readResumeFile: (filePath) =>
    ipcRenderer.invoke('process:readResume', filePath),
  renameProcess: (profileId, saveFolder, oldName, newName) =>
    ipcRenderer.invoke('process:rename', profileId, saveFolder, oldName, newName),
  deleteProcessFolder: (profileId, saveFolder, companyName) =>
    ipcRenderer.invoke('process:deleteFolder', profileId, saveFolder, companyName),

  gatherBackup: () => ipcRenderer.invoke('backup:gather'),
  saveBackup: (payload) => ipcRenderer.invoke('backup:save', payload),
  pickBackup: () => ipcRenderer.invoke('backup:pick'),
  applyBackup: (payload) => ipcRenderer.invoke('backup:apply', payload),
});
