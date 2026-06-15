const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const PROFILES_FILE = 'profiles.json';
const RESUMES_DIR = 'resumes';
const PROMPTS_DIR = 'prompts';
const JDS_DIR = 'jds';
const PROCESSES_DIR = 'processes';
const PROCESS_STATUSES = ['Pending', 'Intro', 'HR', 'Tech', 'Panel', 'Final'];

function getProfilesPath() {
  return path.join(app.getPath('userData'), PROFILES_FILE);
}

function getResumesDir() {
  return path.join(app.getPath('userData'), RESUMES_DIR);
}

function getPromptsDir() {
  return path.join(app.getPath('userData'), PROMPTS_DIR);
}

function getJdsDir() {
  return path.join(app.getPath('userData'), JDS_DIR);
}

function safeId(profileId) {
  const safe = String(profileId || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  return safe || null;
}

function getResumePath(profileId) {
  const id = safeId(profileId);
  if (!id) return null;
  return path.join(getResumesDir(), `${id}.json`);
}

function getPromptPath(profileId) {
  const id = safeId(profileId);
  if (!id) return null;
  return path.join(getPromptsDir(), `${id}.txt`);
}

function getJdPath(profileId) {
  const id = safeId(profileId);
  if (!id) return null;
  return path.join(getJdsDir(), `${id}.txt`);
}

function readProfiles() {
  const filePath = getProfilesPath();
  try {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to read profiles:', err);
    return [];
  }
}

function writeProfiles(profiles) {
  const filePath = getProfilesPath();
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(profiles, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Failed to write profiles:', err);
    return false;
  }
}

function readResume(profileId) {
  const filePath = getResumePath(profileId);
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    console.error('Failed to read resume:', err);
    return null;
  }
}

function writeResume(profileId, data) {
  const filePath = getResumePath(profileId);
  if (!filePath) return false;
  try {
    fs.mkdirSync(getResumesDir(), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Failed to write resume:', err);
    return false;
  }
}

function deleteResume(profileId) {
  const filePath = getResumePath(profileId);
  if (!filePath) return false;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return true;
  } catch (err) {
    console.error('Failed to delete resume:', err);
    return false;
  }
}

function readPrompt(profileId) {
  const filePath = getPromptPath(profileId);
  if (!filePath || !fs.existsSync(filePath)) return '';
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.error('Failed to read prompt:', err);
    return '';
  }
}

function writePrompt(profileId, text) {
  const filePath = getPromptPath(profileId);
  if (!filePath) return false;
  try {
    fs.mkdirSync(getPromptsDir(), { recursive: true });
    fs.writeFileSync(filePath, String(text == null ? '' : text), 'utf-8');
    return true;
  } catch (err) {
    console.error('Failed to write prompt:', err);
    return false;
  }
}

function deletePrompt(profileId) {
  const filePath = getPromptPath(profileId);
  if (!filePath) return false;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return true;
  } catch (err) {
    console.error('Failed to delete prompt:', err);
    return false;
  }
}

function readJd(profileId) {
  const filePath = getJdPath(profileId);
  if (!filePath || !fs.existsSync(filePath)) return '';
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    console.error('Failed to read JD:', err);
    return '';
  }
}

function writeJd(profileId, text) {
  const filePath = getJdPath(profileId);
  if (!filePath) return false;
  try {
    fs.mkdirSync(getJdsDir(), { recursive: true });
    fs.writeFileSync(filePath, String(text == null ? '' : text), 'utf-8');
    return true;
  } catch (err) {
    console.error('Failed to write JD:', err);
    return false;
  }
}

function deleteJd(profileId) {
  const filePath = getJdPath(profileId);
  if (!filePath) return false;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return true;
  } catch (err) {
    console.error('Failed to delete JD:', err);
    return false;
  }
}

// ----------------------------------------------------------------------------
// Process tracking (job application stages)
// ----------------------------------------------------------------------------

function getProcessesDir() {
  return path.join(app.getPath('userData'), PROCESSES_DIR);
}

function getProcessesPath(profileId) {
  const id = safeId(profileId);
  if (!id) return null;
  return path.join(getProcessesDir(), `${id}.json`);
}

// The process store is the source of truth for the manage-process table.
// It is a JSON object: { version, seeded, entries: { [companyName]: row } }.
// `seeded` means we have already built the list from the save folder at least
// once, so subsequent loads can skip the (slow) directory scan and read the
// list directly. The list is kept in sync incrementally by export / rename /
// delete; an explicit "Refresh" reconciles it with the disk again.
const PROCESS_STORE_VERSION = 2;

function emptyProcessStore() {
  return { version: PROCESS_STORE_VERSION, seeded: false, entries: {} };
}

/**
 * Coerce a stored (or scanned) value into a complete process row. `companyName`
 * is the folder/list key. Unknown/invalid fields fall back to safe defaults.
 */
function normalizeProcessEntry(companyName, val) {
  const v = val && typeof val === 'object' ? val : {};
  const status = PROCESS_STATUSES.includes(v.status) ? v.status : 'Pending';
  const stepNum = Number(v.step);
  const step = isFinite(stepNum) && stepNum >= 0 ? Math.floor(stepNum) : 0;
  const dateNum = Number(v.date);
  const date = isFinite(dateNum) && dateNum > 0 ? dateNum : 0;
  const pdfPath = typeof v.pdfPath === 'string' && v.pdfPath ? v.pdfPath : null;
  const jdPath = typeof v.jdPath === 'string' && v.jdPath ? v.jdPath : null;
  return {
    companyName,
    date,
    pdfPath,
    jdPath,
    hasJd: v.hasJd != null ? !!v.hasJd : !!jdPath,
    hasResume: v.hasResume != null ? !!v.hasResume : !!pdfPath,
    status,
    step,
    updatedAt: Number(v.updatedAt) || 0,
  };
}

/**
 * Read the process store for a profile. Handles the legacy flat format
 * (`{ [company]: { status, step } }`) by converting it and marking the result
 * as not-yet-seeded so the next load enriches it from disk once.
 */
function readProcessStore(profileId) {
  const p = getProcessesPath(profileId);
  if (!p || !fs.existsSync(p)) return emptyProcessStore();
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (err) {
    console.error('Failed to read processes:', err);
    return emptyProcessStore();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return emptyProcessStore();
  }
  // New (v2+) format.
  if (parsed.entries && typeof parsed.entries === 'object') {
    const entries = {};
    for (const [company, val] of Object.entries(parsed.entries)) {
      entries[company] = normalizeProcessEntry(company, val);
    }
    return {
      version: PROCESS_STORE_VERSION,
      seeded: parsed.seeded === true,
      entries,
    };
  }
  // Legacy flat format: keep status/step, but treat as unseeded so the next
  // load performs a one-time scan to fill in date / paths / file presence.
  const entries = {};
  for (const [company, val] of Object.entries(parsed)) {
    if (!val || typeof val !== 'object') continue;
    entries[company] = normalizeProcessEntry(company, val);
  }
  return { version: PROCESS_STORE_VERSION, seeded: false, entries };
}

function writeProcessStore(profileId, store) {
  const p = getProcessesPath(profileId);
  if (!p) return false;
  try {
    fs.mkdirSync(getProcessesDir(), { recursive: true });
    const payload = {
      version: PROCESS_STORE_VERSION,
      seeded: store && store.seeded === true,
      entries: (store && store.entries) || {},
    };
    fs.writeFileSync(p, JSON.stringify(payload, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.error('Failed to write processes:', err);
    return false;
  }
}

function deleteProcessesData(profileId) {
  const p = getProcessesPath(profileId);
  if (!p) return false;
  try {
    if (fs.existsSync(p)) fs.unlinkSync(p);
    return true;
  } catch (err) {
    console.error('Failed to delete processes:', err);
    return false;
  }
}

function storeToList(store) {
  return Object.values((store && store.entries) || {});
}

/**
 * Scan a save folder and return a Map of companyName -> disk info
 * (date, pdfPath, jdPath, hasJd, hasResume). This is the only place that
 * touches the file system for discovery; it is used to seed and to re-sync.
 */
function scanSaveFolder(saveFolder) {
  const map = new Map();
  if (!saveFolder || typeof saveFolder !== 'string' || !fs.existsSync(saveFolder)) {
    return map;
  }
  let entries;
  try {
    entries = fs.readdirSync(saveFolder, { withFileTypes: true });
  } catch (err) {
    console.error('scanSaveFolder: cannot read save folder:', err);
    return map;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const folderPath = path.join(saveFolder, e.name);
    let stat;
    try { stat = fs.statSync(folderPath); } catch (_) { continue; }

    let pdfPath = null;
    let jdPath = null;
    try {
      const sub = fs.readdirSync(folderPath, { withFileTypes: true });
      for (const f of sub) {
        if (!f.isFile()) continue;
        const lower = f.name.toLowerCase();
        if (!pdfPath && lower.endsWith('.pdf')) pdfPath = path.join(folderPath, f.name);
        if (!jdPath && lower === 'jd.txt') jdPath = path.join(folderPath, f.name);
      }
    } catch (_) { /* unreadable subfolder, skip files */ }

    const date = stat.birthtimeMs || stat.ctimeMs || stat.mtimeMs || 0;
    map.set(e.name, { date, pdfPath, jdPath, hasJd: !!jdPath, hasResume: !!pdfPath });
  }
  return map;
}

/**
 * Re-scan the save folder and reconcile it with the persisted store: add new
 * folders, refresh file presence / paths for existing ones, and drop entries
 * whose folder no longer exists. Persists and returns the resulting list.
 * This is the heavy path — only called on first seed and on explicit Refresh.
 */
function syncProcesses(profileId, saveFolder) {
  const store = readProcessStore(profileId);
  if (!saveFolder || typeof saveFolder !== 'string' || !fs.existsSync(saveFolder)) {
    // Nothing to scan; return whatever we already have without wiping it.
    return storeToList(store);
  }
  const scan = scanSaveFolder(saveFolder);
  const nextEntries = {};
  for (const [company, info] of scan.entries()) {
    const prev = store.entries[company] || {};
    nextEntries[company] = normalizeProcessEntry(company, {
      status: prev.status,
      step: prev.step,
      updatedAt: prev.updatedAt,
      date: prev.date || info.date,
      pdfPath: info.pdfPath,
      jdPath: info.jdPath,
      hasJd: info.hasJd,
      hasResume: info.hasResume,
    });
  }
  const next = { version: PROCESS_STORE_VERSION, seeded: true, entries: nextEntries };
  writeProcessStore(profileId, next);
  return storeToList(next);
}

/**
 * Fast load for the manage-process table. Reads the persisted list directly
 * (no directory scan) once it has been seeded. Only the very first load (or a
 * legacy store) triggers a one-time scan.
 */
function loadProcesses(profileId, saveFolder) {
  const store = readProcessStore(profileId);
  if (store.seeded) return storeToList(store);
  return syncProcesses(profileId, saveFolder);
}

/**
 * Add (or replace) a single entry in the store without scanning the folder.
 * Called right after a successful export so the in-memory list stays in sync
 * with the file system.
 */
function addProcessEntry(profileId, companyName, info) {
  if (typeof companyName !== 'string' || !companyName) return false;
  const store = readProcessStore(profileId);
  const prev = store.entries[companyName] || {};
  store.entries[companyName] = normalizeProcessEntry(companyName, {
    status: prev.status || 'Pending',
    step: prev.step,
    date: (info && info.date) || prev.date || Date.now(),
    pdfPath: (info && info.pdfPath) || null,
    jdPath: (info && info.jdPath) || null,
    hasJd: info ? !!info.jdPath : false,
    hasResume: info ? !!info.pdfPath : false,
    updatedAt: Date.now(),
  });
  // An add implies the list is now initialized.
  store.seeded = true;
  return writeProcessStore(profileId, store);
}

function saveProcessEntry(profileId, companyName, patch) {
  if (typeof companyName !== 'string' || !companyName) return false;
  const store = readProcessStore(profileId);
  const cur = store.entries[companyName] || {};
  const next = { ...cur };
  if (patch && typeof patch === 'object') {
    if (typeof patch.status === 'string' && PROCESS_STATUSES.includes(patch.status)) {
      next.status = patch.status;
    }
    if (patch.step !== undefined && patch.step !== null) {
      const n = Number(patch.step);
      if (isFinite(n) && n >= 0) next.step = Math.floor(n);
    }
  }
  next.updatedAt = Date.now();
  store.entries[companyName] = normalizeProcessEntry(companyName, next);
  return writeProcessStore(profileId, store);
}

function readJdFile(filePath) {
  if (typeof filePath !== 'string' || !filePath) {
    return { error: 'Invalid path' };
  }
  try {
    return { content: fs.readFileSync(filePath, 'utf-8') };
  } catch (err) {
    return { error: err && err.message ? err.message : String(err) };
  }
}

function readResumeFile(filePath) {
  if (typeof filePath !== 'string' || !filePath) {
    return { error: 'Invalid path' };
  }
  try {
    return { data: fs.readFileSync(filePath) };
  } catch (err) {
    return { error: err && err.message ? err.message : String(err) };
  }
}

/**
 * Confirm `child` resolves to a path that is strictly inside `parent`.
 * Used to prevent rename/delete from escaping the configured save folder.
 */
function isPathInside(parent, child) {
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function deleteProcessFolder(profileId, saveFolder, companyName) {
  if (!saveFolder || typeof saveFolder !== 'string') {
    return { error: 'No save folder configured.', code: 'NO_SAVE_FOLDER' };
  }
  if (!companyName || typeof companyName !== 'string') {
    return { error: 'Invalid company name.', code: 'INVALID_NAME' };
  }
  const folderPath = path.join(saveFolder, companyName);
  if (!isPathInside(saveFolder, folderPath)) {
    return { error: 'Refused to delete a path outside the save folder.', code: 'INVALID_PATH' };
  }
  if (!fs.existsSync(folderPath)) {
    // Folder is already gone - still scrub the persisted state so the
    // table no longer shows a stale entry.
    const store = readProcessStore(profileId);
    if (Object.prototype.hasOwnProperty.call(store.entries, companyName)) {
      delete store.entries[companyName];
      writeProcessStore(profileId, store);
    }
    return { ok: true, alreadyGone: true };
  }
  try {
    fs.rmSync(folderPath, { recursive: true, force: true });
  } catch (err) {
    return {
      error: err && err.message ? err.message : String(err),
      code: 'DELETE_FAILED',
    };
  }
  const store = readProcessStore(profileId);
  if (Object.prototype.hasOwnProperty.call(store.entries, companyName)) {
    delete store.entries[companyName];
    writeProcessStore(profileId, store);
  }
  return { ok: true };
}

function renameProcessFolder(profileId, saveFolder, oldName, newNameRaw) {
  if (!saveFolder || typeof saveFolder !== 'string') {
    return { error: 'No save folder configured.', code: 'NO_SAVE_FOLDER' };
  }
  if (!oldName || typeof oldName !== 'string') {
    return { error: 'Invalid current name.', code: 'INVALID_NAME' };
  }
  const newName = safePathSegment(newNameRaw);
  if (!newName) {
    return { error: 'New name is empty or invalid.', code: 'EMPTY_NAME' };
  }
  if (newName === oldName) {
    return {
      ok: true,
      path: path.join(saveFolder, oldName),
      name: oldName,
      unchanged: true,
    };
  }

  const oldPath = path.join(saveFolder, oldName);
  const newPath = path.join(saveFolder, newName);
  if (!isPathInside(saveFolder, oldPath) || !isPathInside(saveFolder, newPath)) {
    return { error: 'Refused to rename outside the save folder.', code: 'INVALID_PATH' };
  }

  if (!fs.existsSync(oldPath)) {
    return { error: 'Original folder no longer exists.', code: 'NOT_FOUND' };
  }
  // Treat name conflict case-sensitively (case-only renames are still allowed
  // because some filesystems treat them as the same and renameSync handles it).
  if (newName !== oldName && fs.existsSync(newPath)) {
    return {
      error: `A folder named "${newName}" already exists in this location.`,
      code: 'DUPLICATE',
      path: newPath,
    };
  }

  try {
    fs.renameSync(oldPath, newPath);
  } catch (err) {
    return {
      error: err && err.message ? err.message : String(err),
      code: 'RENAME_FAILED',
    };
  }

  // Move the store entry to the new key and repoint its stored file paths,
  // which embed the (now renamed) folder name.
  const store = readProcessStore(profileId);
  const prev = store.entries[oldName];
  if (prev) {
    const moved = { ...prev, companyName: newName, updatedAt: Date.now() };
    if (prev.pdfPath) moved.pdfPath = path.join(newPath, path.basename(prev.pdfPath));
    if (prev.jdPath) moved.jdPath = path.join(newPath, path.basename(prev.jdPath));
    delete store.entries[oldName];
    store.entries[newName] = normalizeProcessEntry(newName, moved);
    writeProcessStore(profileId, store);
  }
  return { ok: true, path: newPath, name: newName };
}

/**
 * Render the given HTML to a PDF buffer using a hidden BrowserWindow.
 * Used by the live preview - returns the PDF data instead of saving it.
 */
async function renderPdfBuffer(html) {
  if (!html || typeof html !== 'string') {
    return { error: 'Empty HTML' };
  }

  const tmpFile = path.join(
    app.getPath('temp'),
    `resume-preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`
  );

  let win;
  try {
    fs.writeFileSync(tmpFile, html, 'utf-8');

    win = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: false,
      },
    });

    await win.loadFile(tmpFile);

    const pdfBuffer = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'Letter',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });

    return { data: pdfBuffer };
  } catch (err) {
    console.error('renderPdfBuffer failed:', err);
    return { error: err && err.message ? err.message : String(err) };
  } finally {
    if (win && !win.isDestroyed()) win.close();
    try { fs.unlinkSync(tmpFile); } catch (_) { /* ignore */ }
  }
}

/**
 * Strip / collapse characters that aren't valid for a folder or file name on
 * Windows / macOS / Linux. Returns a trimmed string capped to a sane length.
 */
function safePathSegment(name) {
  return String(name == null ? '' : name)
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_') // illegal on Windows + control chars
    .replace(/^\.+|\.+$/g, '') // leading/trailing dots
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/**
 * Render `html` to a PDF and save it under
 * `{saveFolder}/{companyName}/{fileName}`. The company subfolder must NOT
 * already exist - if it does we surface a `DUPLICATE_FOLDER` error so the
 * renderer can show a clear warning. All errors are returned as
 * `{ error, code? }` rather than thrown.
 */
async function exportPdf(args) {
  const html = (args && typeof args.html === 'string') ? args.html : '';
  if (!html) return { error: 'Empty HTML', code: 'EMPTY_HTML' };

  const saveFolder = (args && typeof args.saveFolder === 'string') ? args.saveFolder.trim() : '';
  const companyRaw = (args && typeof args.companyName === 'string') ? args.companyName : '';
  const fileNameRaw = (args && typeof args.fileName === 'string') ? args.fileName : 'resume.pdf';
  const jd = (args && typeof args.jd === 'string') ? args.jd : '';
  const profileId = (args && typeof args.profileId === 'string') ? args.profileId : '';

  if (!saveFolder) {
    return {
      error: 'No save folder is configured for this profile. Set one in the profile editor.',
      code: 'NO_SAVE_FOLDER',
    };
  }
  if (!fs.existsSync(saveFolder)) {
    return {
      error: `Save folder does not exist: ${saveFolder}`,
      code: 'SAVE_FOLDER_MISSING',
    };
  }
  let saveStat;
  try { saveStat = fs.statSync(saveFolder); } catch (_) { saveStat = null; }
  if (!saveStat || !saveStat.isDirectory()) {
    return {
      error: `Save path is not a folder: ${saveFolder}`,
      code: 'SAVE_FOLDER_NOT_DIR',
    };
  }

  const company = safePathSegment(companyRaw);
  if (!company) {
    return {
      error: 'Company name is empty or invalid.',
      code: 'EMPTY_COMPANY',
    };
  }

  let fileName = safePathSegment(fileNameRaw.replace(/\.pdf$/i, '')) + '.pdf';
  if (fileName === '.pdf') fileName = 'resume.pdf';

  const companyFolder = path.join(saveFolder, company);
  if (fs.existsSync(companyFolder)) {
    return {
      error: `A folder named "${company}" already exists in this location. Rename it or choose a different company name.`,
      code: 'DUPLICATE_FOLDER',
      path: companyFolder,
    };
  }

  const tmpFile = path.join(
    app.getPath('temp'),
    `resume-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.html`
  );

  let win;
  let folderCreated = false;
  try {
    fs.mkdirSync(companyFolder, { recursive: false });
    folderCreated = true;

    fs.writeFileSync(tmpFile, html, 'utf-8');

    win = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: false,
      },
    });

    await win.loadFile(tmpFile);

    const pdfBuffer = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'Letter',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });

    const outPath = path.join(companyFolder, fileName);
    fs.writeFileSync(outPath, pdfBuffer);

    let jdPath = null;
    let jdError = null;
    if (jd && jd.trim()) {
      jdPath = path.join(companyFolder, 'JD.txt');
      try {
        fs.writeFileSync(jdPath, jd, 'utf-8');
      } catch (jdErr) {
        // Don't fail the whole export if the JD file can't be written;
        // surface it via the result so the renderer can warn the user.
        console.error('Failed to write JD.txt:', jdErr);
        jdError = jdErr && jdErr.message ? jdErr.message : String(jdErr);
        jdPath = null;
      }
    }

    // Keep the process list in sync without re-scanning the folder: record
    // this freshly-created application directly in the persisted store.
    if (profileId) {
      try {
        addProcessEntry(profileId, company, {
          date: Date.now(),
          pdfPath: outPath,
          jdPath,
        });
      } catch (storeErr) {
        console.error('Failed to record process entry:', storeErr);
      }
    }

    return { path: outPath, folder: companyFolder, jdPath, jdError: jdError || undefined };
  } catch (err) {
    console.error('exportPdf failed:', err);
    // Clean up the empty folder we just created so the user can retry.
    if (folderCreated) {
      try {
        const entries = fs.readdirSync(companyFolder);
        if (entries.length === 0) fs.rmdirSync(companyFolder);
      } catch (_) { /* ignore cleanup failure */ }
    }
    return {
      error: err && err.message ? err.message : String(err),
      code: 'PDF_RENDER_FAILED',
    };
  } finally {
    if (win && !win.isDestroyed()) win.close();
    try { fs.unlinkSync(tmpFile); } catch (_) { /* ignore */ }
  }
}

/**
 * Open the native folder picker so the user can choose where to save PDFs
 * for a given profile.
 */
async function pickFolder(parentWin, defaultPath) {
  const opts = {
    title: 'Choose folder for exported PDFs',
    properties: ['openDirectory', 'createDirectory'],
  };
  if (defaultPath && typeof defaultPath === 'string') {
    opts.defaultPath = defaultPath;
  }
  const result = await dialog.showOpenDialog(parentWin || null, opts);
  if (result.canceled || !result.filePaths || !result.filePaths[0]) {
    return { canceled: true };
  }
  return { path: result.filePaths[0] };
}

// ----------------------------------------------------------------------------
// Backup / Restore
// ----------------------------------------------------------------------------

const BACKUP_SCHEMA = 'resume-manager-backup';
const BACKUP_VERSION = 1;

/**
 * Read every text file in a directory (non-recursive) into a key/value map
 * keyed by the file's basename (sans extension). Returns {} if the dir
 * doesn't exist or can't be read.
 */
function readDirToMap(dir, ext) {
  if (!fs.existsSync(dir)) return {};
  const out = {};
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return {};
  }
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (ext && !e.name.toLowerCase().endsWith(ext)) continue;
    const id = ext ? e.name.slice(0, -ext.length) : e.name;
    try {
      out[id] = fs.readFileSync(path.join(dir, e.name), 'utf-8');
    } catch (_) { /* skip unreadable */ }
  }
  return out;
}

function gatherBackup() {
  const profilesPath = getProfilesPath();
  let profilesText = '[]';
  if (fs.existsSync(profilesPath)) {
    try { profilesText = fs.readFileSync(profilesPath, 'utf-8'); } catch (_) { /* ignore */ }
  }
  let profiles = [];
  try {
    const parsed = JSON.parse(profilesText);
    if (Array.isArray(parsed)) profiles = parsed;
  } catch (_) { /* ignore */ }

  const resumesText = readDirToMap(getResumesDir(), '.json');
  const resumes = {};
  for (const [id, raw] of Object.entries(resumesText)) {
    try { resumes[id] = JSON.parse(raw); } catch (_) { /* skip corrupt */ }
  }

  const prompts = readDirToMap(getPromptsDir(), '.txt');
  const jds = readDirToMap(getJdsDir(), '.txt');

  const processesText = readDirToMap(getProcessesDir(), '.json');
  const processes = {};
  for (const [id, raw] of Object.entries(processesText)) {
    try { processes[id] = JSON.parse(raw); } catch (_) { /* skip corrupt */ }
  }

  return {
    $schema: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    app: { name: 'Resume Manager', version: app.getVersion() },
    profiles,
    resumes,
    prompts,
    jds,
    processes,
    // `styles` is a renderer-side concept (localStorage) - the renderer
    // injects it before sending the payload to `backup:save`.
  };
}

function validateBackup(payload) {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Backup file is not a valid JSON object.' };
  }
  if (payload.$schema !== BACKUP_SCHEMA) {
    return { valid: false, error: 'File is not a Resume Manager backup.' };
  }
  if (typeof payload.version !== 'number' || payload.version > BACKUP_VERSION) {
    return {
      valid: false,
      error: `Unsupported backup version: ${payload.version}. This app understands up to v${BACKUP_VERSION}.`,
    };
  }
  if (!Array.isArray(payload.profiles)) {
    return { valid: false, error: 'Backup is missing the profiles list.' };
  }
  return { valid: true };
}

/**
 * Wipe-and-restore. Replaces all per-profile files (resumes, prompts,
 * processes) and `profiles.json`. Returns counts so the caller can show
 * a summary toast.
 */
function applyBackup(payload) {
  const validation = validateBackup(payload);
  if (!validation.valid) {
    return { error: validation.error, code: 'INVALID_BACKUP' };
  }

  const counts = { profiles: 0, resumes: 0, prompts: 0, jds: 0, processes: 0 };

  try {
    fs.mkdirSync(path.dirname(getProfilesPath()), { recursive: true });
    fs.writeFileSync(
      getProfilesPath(),
      JSON.stringify(payload.profiles, null, 2),
      'utf-8'
    );
    counts.profiles = payload.profiles.length;

    // Wipe and re-create each per-profile dir so removed profiles disappear.
    for (const [dir, ext, dataKey, mode] of [
      [getResumesDir(), '.json', 'resumes', 'json'],
      [getPromptsDir(), '.txt', 'prompts', 'text'],
      [getJdsDir(), '.txt', 'jds', 'text'],
      [getProcessesDir(), '.json', 'processes', 'json'],
    ]) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
      fs.mkdirSync(dir, { recursive: true });
      const map = (payload[dataKey] && typeof payload[dataKey] === 'object')
        ? payload[dataKey]
        : {};
      for (const [rawId, value] of Object.entries(map)) {
        const id = safeId(rawId);
        if (!id) continue;
        const filePath = path.join(dir, `${id}${ext}`);
        const text = mode === 'json'
          ? JSON.stringify(value, null, 2)
          : String(value == null ? '' : value);
        try {
          fs.writeFileSync(filePath, text, 'utf-8');
          counts[dataKey]++;
        } catch (err) {
          console.error(`Failed to restore ${dataKey}/${id}:`, err);
        }
      }
    }
  } catch (err) {
    return {
      error: err && err.message ? err.message : String(err),
      code: 'WRITE_FAILED',
    };
  }

  return { ok: true, counts };
}

async function saveBackupFile(parentWin, payload) {
  if (!payload || typeof payload !== 'object') {
    return { error: 'Empty backup payload.', code: 'EMPTY' };
  }
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const result = await dialog.showSaveDialog(parentWin || null, {
    title: 'Save backup',
    defaultPath: `resume-manager-backup-${stamp}.json`,
    filters: [{ name: 'Resume Manager backup', extensions: ['json'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  try {
    fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf-8');
    return { ok: true, path: result.filePath };
  } catch (err) {
    return {
      error: err && err.message ? err.message : String(err),
      code: 'WRITE_FAILED',
    };
  }
}

async function pickBackupFile(parentWin) {
  const result = await dialog.showOpenDialog(parentWin || null, {
    title: 'Open backup file',
    properties: ['openFile'],
    filters: [
      { name: 'Resume Manager backup', extensions: ['json'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths || !result.filePaths[0]) {
    return { canceled: true };
  }
  const filePath = result.filePaths[0];
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (err) {
    return {
      error: `Could not parse backup file: ${err.message || err}`,
      code: 'PARSE_FAILED',
    };
  }
  const validation = validateBackup(parsed);
  if (!validation.valid) {
    return { error: validation.error, code: 'INVALID_BACKUP' };
  }
  return { ok: true, path: filePath, payload: parsed };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 820,
    minHeight: 600,
    backgroundColor: '#0f1115',
    title: 'Resume Manager',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  ipcMain.handle('profiles:list', () => readProfiles());

  ipcMain.handle('profiles:save', (_event, profiles) => {
    if (!Array.isArray(profiles)) return false;
    return writeProfiles(profiles);
  });

  ipcMain.handle('resume:get', (_event, profileId) => readResume(profileId));

  ipcMain.handle('resume:save', (_event, profileId, data) =>
    writeResume(profileId, data)
  );

  ipcMain.handle('resume:delete', (_event, profileId) => deleteResume(profileId));

  ipcMain.handle('prompt:get', (_event, profileId) => readPrompt(profileId));

  ipcMain.handle('prompt:save', (_event, profileId, text) =>
    writePrompt(profileId, text)
  );

  ipcMain.handle('prompt:delete', (_event, profileId) => deletePrompt(profileId));

  ipcMain.handle('jd:get', (_event, profileId) => readJd(profileId));
  ipcMain.handle('jd:save', (_event, profileId, text) =>
    writeJd(profileId, text)
  );
  ipcMain.handle('jd:delete', (_event, profileId) => deleteJd(profileId));

  ipcMain.handle('pdf:export', async (_event, args) => {
    return exportPdf(args || {});
  });

  ipcMain.handle('pdf:render', async (_event, html) => {
    return renderPdfBuffer(html);
  });

  ipcMain.handle('pdf:reveal', (_event, filePath) => {
    if (typeof filePath !== 'string' || !filePath) return false;
    shell.showItemInFolder(filePath);
    return true;
  });

  ipcMain.handle('dialog:pickFolder', async (event, defaultPath) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    return pickFolder(parent, defaultPath);
  });

  ipcMain.handle('process:list', (_event, profileId, saveFolder) =>
    loadProcesses(profileId, saveFolder)
  );
  ipcMain.handle('process:sync', (_event, profileId, saveFolder) =>
    syncProcesses(profileId, saveFolder)
  );
  ipcMain.handle('process:save', (_event, profileId, companyName, patch) =>
    saveProcessEntry(profileId, companyName, patch)
  );
  ipcMain.handle('process:delete', (_event, profileId) =>
    deleteProcessesData(profileId)
  );
  ipcMain.handle('process:readJd', (_event, filePath) => readJdFile(filePath));
  ipcMain.handle('process:readResume', (_event, filePath) =>
    readResumeFile(filePath)
  );
  ipcMain.handle('process:rename', (_event, profileId, saveFolder, oldName, newName) =>
    renameProcessFolder(profileId, saveFolder, oldName, newName)
  );
  ipcMain.handle('process:deleteFolder', (_event, profileId, saveFolder, companyName) =>
    deleteProcessFolder(profileId, saveFolder, companyName)
  );

  ipcMain.handle('backup:gather', () => gatherBackup());
  ipcMain.handle('backup:save', async (event, payload) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    return saveBackupFile(parent, payload);
  });
  ipcMain.handle('backup:pick', async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    return pickBackupFile(parent);
  });
  ipcMain.handle('backup:apply', (_event, payload) => applyBackup(payload));

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
