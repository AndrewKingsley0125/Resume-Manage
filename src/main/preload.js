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
  checkCompanyDuplicate: (saveFolder, companyName, exceptPath) =>
    ipcRenderer.invoke('process:checkDuplicate', saveFolder, companyName, exceptPath),
  deleteProcesses: (profileId) =>
    ipcRenderer.invoke('process:delete', profileId),
  readJdFile: (filePath) => ipcRenderer.invoke('process:readJd', filePath),
  readResumeFile: (filePath) =>
    ipcRenderer.invoke('process:readResume', filePath),
  openFolder: (folderPath) =>
    ipcRenderer.invoke('process:openFolder', folderPath),
  renameProcess: (profileId, saveFolder, relativePath, newName) =>
    ipcRenderer.invoke('process:rename', profileId, saveFolder, relativePath, newName),
  deleteProcessFolder: (profileId, saveFolder, relativePath) =>
    ipcRenderer.invoke('process:deleteFolder', profileId, saveFolder, relativePath),
  exportProcessesZip: (saveFolder, dateKey, firstName, lastName) =>
    ipcRenderer.invoke('process:exportZip', saveFolder, dateKey, firstName, lastName),
  pickImportZip: () => ipcRenderer.invoke('process:pickImportZip'),
  analyzeImportZip: (saveFolder, zipPath) =>
    ipcRenderer.invoke('process:analyzeImportZip', saveFolder, zipPath),
  importProcessesZip: (saveFolder, zipPath, importNames) =>
    ipcRenderer.invoke('process:importZip', saveFolder, zipPath, importNames),

  gatherBackup: () => ipcRenderer.invoke('backup:gather'),
  saveBackup: (payload) => ipcRenderer.invoke('backup:save', payload),
  pickBackup: () => ipcRenderer.invoke('backup:pick'),
  applyBackup: (payload) => ipcRenderer.invoke('backup:apply', payload),
});
