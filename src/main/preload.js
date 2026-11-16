const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  extensionState: profileId => ipcRenderer.invoke('extension:state', profileId),
  extensionRotateCode: profileId => ipcRenderer.invoke('extension:rotateCode', profileId),
  extensionUnlink: id => ipcRenderer.invoke('extension:unlink', id),
  extensionAssign: args => ipcRenderer.invoke('extension:assign', args),
  extensionCommand: args => ipcRenderer.invoke('extension:command', args),

  discoveryStatus: () => ipcRenderer.invoke('discovery:status'),
  discoveryDiscover: args => ipcRenderer.invoke('discovery:discover', args),
  discoverySync: () => ipcRenderer.invoke('discovery:sync'),
  discoveryStop: () => ipcRenderer.invoke('discovery:stop'),
  discoveryAddBoard: url => ipcRenderer.invoke('discovery:addBoard', url),
  discoverySearchProfile: profileId => ipcRenderer.invoke('discovery:searchProfile', profileId),
  discoverySaveSearchProfile: (profileId, search) => ipcRenderer.invoke('discovery:saveSearchProfile', profileId, search),
  discoveryMatches: (profileId, options) => ipcRenderer.invoke('discovery:matches', profileId, options),
  discoveryJob: id => ipcRenderer.invoke('discovery:job', id),
  discoveryVerify: id => ipcRenderer.invoke('discovery:verify', id),
  discoveryMark: (profileId, id, status) => ipcRenderer.invoke('discovery:mark', profileId, id, status),
  discoveryOpen: url => ipcRenderer.invoke('discovery:open', url),
  onDiscoveryEvent: callback => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('discovery:event', listener);
    return () => ipcRenderer.removeListener('discovery:event', listener);
  },
  generatePrompt: (profileId) => ipcRenderer.invoke('prompt:generate', profileId),
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
