const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const AdmZip = require('adm-zip');

const PROFILES_FILE = 'profiles.json';
const RESUMES_DIR = 'resumes';
const PROMPTS_DIR = 'prompts';
const JDS_DIR = 'jds';
const PROCESSES_DIR = 'processes';
const PROCESS_EXPORT_SCHEMA = 'resume-manager-process-export';
const PROCESS_EXPORT_VERSION = 1;

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
// Manage list (read from the profile save folder on disk)
// ----------------------------------------------------------------------------

function getProcessesDir() {
  return path.join(app.getPath('userData'), PROCESSES_DIR);
}

function getProcessesPath(profileId) {
  const id = safeId(profileId);
  if (!id) return null;
  return path.join(getProcessesDir(), `${id}.json`);
}

/** Remove legacy per-profile process JSON (applications live in the save folder). */
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

function processRowFromDisk(companyName, relativePath, disk, folderPath) {
  return {
    companyName,
    relativePath,
    folderPath,
    date: disk.date,
    pdfPath: disk.pdfPath,
    jdPath: disk.jdPath,
    hasJd: disk.hasJd,
    hasResume: disk.hasResume,
  };
}

function normalizeCompanyKey(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  return prev[n];
}

const COMPANY_DUPLICATE_MAX_EDITS = 2;
const COMPANY_DUPLICATE_MIN_FUZZY_LEN = 3;

/**
 * Compare company names for export/rename duplicate detection:
 * 1. Normalize: lowercase, strip spaces/punctuation/special chars.
 * 2. Exact match on normalized form.
 * 3. Otherwise allow up to two character edits (missing/extra/swapped letters).
 */
function companyNamesAreDuplicate(candidate, existing) {
  const a = normalizeCompanyKey(candidate);
  const b = normalizeCompanyKey(existing);
  if (!a || !b) return false;
  if (a === b) return true;
  const minLen = Math.min(a.length, b.length);
  const maxLen = Math.max(a.length, b.length);
  if (minLen < COMPANY_DUPLICATE_MIN_FUZZY_LEN) return false;
  if (maxLen - minLen > COMPANY_DUPLICATE_MAX_EDITS) return false;
  return levenshtein(a, b) <= COMPANY_DUPLICATE_MAX_EDITS;
}

function* iterateCompanyFolders(saveFolder) {
  if (!saveFolder || !fs.existsSync(saveFolder)) return;
  let entries;
  try {
    entries = fs.readdirSync(saveFolder, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    yield { name: e.name, path: path.join(saveFolder, e.name) };
  }
}

function findExistingCompanyFolder(saveFolder, companyName, exceptPath = null) {
  if (!saveFolder || !companyName) return null;
  const exceptResolved = exceptPath ? path.resolve(exceptPath) : null;
  for (const entry of iterateCompanyFolders(saveFolder)) {
    if (exceptResolved && path.resolve(entry.path) === exceptResolved) continue;
    if (companyNamesAreDuplicate(companyName, entry.name)) return entry.path;
  }
  return null;
}

function duplicateCompanyMessage(candidate, existingPath) {
  const existingName = path.basename(existingPath);
  if (companyNamesAreDuplicate(candidate, existingName) &&
      normalizeCompanyKey(candidate) === normalizeCompanyKey(existingName)) {
    return (
      `A folder named "${existingName}" already exists in this save folder. ` +
      'Rename it or choose a different company name.'
    );
  }
  return (
    `A folder named "${existingName}" already exists and matches "${candidate}" ` +
    '(ignoring spaces, punctuation, or up to two letter differences). ' +
    'Rename the existing folder or choose a different company name.'
  );
}

/** Check save folder for a fuzzy duplicate before export or rename. */
function checkCompanyDuplicate(saveFolder, companyNameRaw, exceptPath = null) {
  const company = safePathSegment(companyNameRaw);
  if (!company) {
    return { duplicate: false };
  }
  const existingPath = findExistingCompanyFolder(saveFolder, company, exceptPath);
  if (!existingPath) {
    return { duplicate: false };
  }
  return {
    duplicate: true,
    path: existingPath,
    existingName: path.basename(existingPath),
    message: duplicateCompanyMessage(company, existingPath),
  };
}

function scanCompanyFolder(folderPath) {
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
  } catch (_) {
    return null;
  }
  let stat;
  try {
    stat = fs.statSync(folderPath);
  } catch (_) {
    return null;
  }
  const date = stat.birthtimeMs || stat.ctimeMs || stat.mtimeMs || 0;
  return { date, pdfPath, jdPath, hasJd: !!jdPath, hasResume: !!pdfPath };
}

function toRelativePath(saveFolder, absolutePath) {
  return path.relative(saveFolder, absolutePath).split(path.sep).join('/');
}

function resolveRelativePath(saveFolder, relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) return null;
  const abs = path.join(saveFolder, ...normalized.split('/'));
  if (!isPathInside(saveFolder, abs)) return null;
  return abs;
}

function removeEmptyParentDirs(dirPath, stopAt) {
  let current = dirPath;
  while (current && current !== stopAt && isPathInside(stopAt, current)) {
    try {
      if (fs.readdirSync(current).length > 0) break;
      fs.rmdirSync(current);
      current = path.dirname(current);
    } catch (_) {
      break;
    }
  }
}

/**
 * Scan `{saveFolder}/{company}/` folders on disk.
 */
function scanSaveFolder(saveFolder) {
  const items = [];
  if (!saveFolder || typeof saveFolder !== 'string' || !fs.existsSync(saveFolder)) {
    return items;
  }

  let entries;
  try {
    entries = fs.readdirSync(saveFolder, { withFileTypes: true });
  } catch (err) {
    console.error('scanSaveFolder: cannot read save folder:', err);
    return items;
  }

  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const companyPath = path.join(saveFolder, e.name);
    const disk = scanCompanyFolder(companyPath);
    if (!disk) continue;
    items.push(processRowFromDisk(
      e.name,
      toRelativePath(saveFolder, companyPath),
      disk,
      companyPath
    ));
  }

  items.sort((a, b) => (b.date || 0) - (a.date || 0));
  return items;
}

/** Scan the save folder; company rows come from disk only (no local store). */
function loadProcesses(_profileId, saveFolder) {
  if (!saveFolder || typeof saveFolder !== 'string' || !fs.existsSync(saveFolder)) {
    return [];
  }
  return scanSaveFolder(saveFolder);
}

function syncProcesses(profileId, saveFolder) {
  return loadProcesses(profileId, saveFolder);
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

function openFolder(folderPath) {
  if (typeof folderPath !== 'string' || !folderPath) {
    return { error: 'Invalid path' };
  }
  try {
    if (!fs.existsSync(folderPath)) {
      return { error: 'Folder not found' };
    }
    if (!fs.statSync(folderPath).isDirectory()) {
      return { error: 'Not a folder' };
    }
  } catch (err) {
    return { error: err && err.message ? err.message : String(err) };
  }
  const openErr = shell.openPath(folderPath);
  return openErr ? { error: openErr } : { ok: true };
}

function localDateKey(ms) {
  const d = new Date(ms);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateKey(str) {
  if (typeof str !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const test = new Date(y, mo - 1, d);
  if (test.getFullYear() !== y || test.getMonth() !== mo - 1 || test.getDate() !== d) {
    return null;
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function filterProcessesByDate(saveFolder, dateKey) {
  return scanSaveFolder(saveFolder).filter((p) => localDateKey(p.date) === dateKey);
}

function isIgnoredImportDir(name) {
  return !name || name === '__MACOSX' || name.startsWith('.');
}

function nameSlugPart(raw) {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Build `firstname-lastname-YYYY-MM-DD` (no extension). */
function buildApplicationsZipBaseName(firstName, lastName, dateKey) {
  const first = nameSlugPart(firstName);
  const last = nameSlugPart(lastName);
  if (!first || !last) return null;
  return `${first}-${last}-${dateKey}`;
}

function dateKeyFromZipPath(zipPath) {
  const base = path.basename(zipPath, path.extname(zipPath));
  const dated = /-(\d{4}-\d{2}-\d{2})$/i.exec(base);
  if (dated) {
    const key = parseDateKey(dated[1]);
    if (key) return key;
  }
  const legacy = /^applications-(\d{4}-\d{2}-\d{2})$/i.exec(base);
  if (legacy) return parseDateKey(legacy[1]);
  return null;
}

async function exportProcessesZip(parentWin, saveFolder, dateKeyRaw, firstName, lastName) {
  if (!saveFolder || typeof saveFolder !== 'string') {
    return { error: 'No save folder configured.', code: 'NO_SAVE_FOLDER' };
  }
  if (!fs.existsSync(saveFolder)) {
    return { error: 'Save folder does not exist.', code: 'SAVE_FOLDER_MISSING' };
  }
  const dateKey = parseDateKey(dateKeyRaw);
  if (!dateKey) {
    return { error: 'Invalid date. Use YYYY-MM-DD.', code: 'INVALID_DATE' };
  }

  const companies = filterProcessesByDate(saveFolder, dateKey);
  if (companies.length === 0) {
    return {
      error: `No applications found for ${dateKey}.`,
      code: 'EMPTY',
    };
  }

  const zipBaseName = buildApplicationsZipBaseName(firstName, lastName, dateKey);
  if (!zipBaseName) {
    return {
      error: 'Set first and last name on this profile before exporting.',
      code: 'NO_PROFILE_NAME',
    };
  }

  const result = await dialog.showSaveDialog(parentWin || null, {
    title: 'Export applications',
    defaultPath: `${zipBaseName}.zip`,
    filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
  });
  if (result.canceled || !result.filePath) return { canceled: true };

  try {
    const zip = new AdmZip();
    const manifest = {
      $schema: PROCESS_EXPORT_SCHEMA,
      version: PROCESS_EXPORT_VERSION,
      exportDate: dateKey,
      exportedAt: new Date().toISOString(),
      firstName: nameSlugPart(firstName),
      lastName: nameSlugPart(lastName),
      fileName: `${zipBaseName}.zip`,
      companies: companies.map((p) => ({
        name: p.companyName,
        date: localDateKey(p.date),
      })),
    };

    for (const p of companies) {
      zip.addLocalFolder(p.folderPath, p.companyName);
    }
    zip.addFile(
      'manifest.json',
      Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8')
    );
    zip.writeZip(result.filePath);

    return {
      ok: true,
      path: result.filePath,
      count: companies.length,
      date: dateKey,
    };
  } catch (err) {
    return {
      error: err && err.message ? err.message : String(err),
      code: 'WRITE_FAILED',
    };
  }
}

async function pickImportZipFile(parentWin) {
  const result = await dialog.showOpenDialog(parentWin || null, {
    title: 'Choose applications ZIP',
    filters: [{ name: 'ZIP archive', extensions: ['zip'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths || !result.filePaths.length) {
    return { canceled: true };
  }
  return { ok: true, path: result.filePaths[0] };
}

function resolveImportDateKey(zipPath, manifest) {
  if (manifest && manifest.exportDate) {
    const fromManifest = parseDateKey(manifest.exportDate);
    if (fromManifest) return fromManifest;
  }
  return dateKeyFromZipPath(zipPath);
}

function readImportZipContents(saveFolder, zipPath) {
  if (!saveFolder || typeof saveFolder !== 'string') {
    return { error: 'No save folder configured.', code: 'NO_SAVE_FOLDER' };
  }
  if (!fs.existsSync(saveFolder)) {
    return { error: 'Save folder does not exist.', code: 'SAVE_FOLDER_MISSING' };
  }
  if (typeof zipPath !== 'string' || !zipPath || !fs.existsSync(zipPath)) {
    return { error: 'ZIP file not found.', code: 'NOT_FOUND' };
  }

  let tmpDir = null;
  try {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-import-'));
    const zip = new AdmZip(zipPath);
    zip.extractAllTo(tmpDir, true);

    let manifest = null;
    const manifestPath = path.join(tmpDir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      } catch (_) {
        manifest = null;
      }
    }

    const dateKey = resolveImportDateKey(zipPath, manifest);
    if (!dateKey) {
      return {
        error:
          'Could not determine the archive date. Name the file firstname-lastname-YYYY-MM-DD.zip ' +
          'or use a ZIP exported from Resume Manager.',
        code: 'NO_DATE',
      };
    }

    const allowedNames = new Set();
    if (manifest && Array.isArray(manifest.companies)) {
      for (const c of manifest.companies) {
        if (!c || typeof c.name !== 'string') continue;
        if (c.date && c.date !== dateKey) continue;
        allowedNames.add(c.name);
      }
    }

    const entries = fs.readdirSync(tmpDir, { withFileTypes: true });
    const companyDirs = entries
      .filter((e) => e.isDirectory() && !isIgnoredImportDir(e.name))
      .map((e) => e.name)
      .filter((name) => allowedNames.size === 0 || allowedNames.has(name));

    if (companyDirs.length === 0) {
      return {
        error: `No company folders found in the archive for ${dateKey}.`,
        code: 'EMPTY_ARCHIVE',
      };
    }

    const companies = [];
    const newItems = [];

    for (const name of companyDirs) {
      const safeName = safePathSegment(name);
      const srcPath = path.join(tmpDir, name);

      if (!safeName) {
        companies.push({ name, status: 'duplicate', reason: 'invalid name' });
        continue;
      }
      if (!isPathInside(tmpDir, srcPath)) {
        companies.push({ name: safeName, status: 'duplicate', reason: 'invalid path' });
        continue;
      }

      const existing = findExistingCompanyFolder(saveFolder, safeName);
      const dupInBatch = newItems.find((t) => companyNamesAreDuplicate(t.name, safeName));

      if (existing || dupInBatch) {
        companies.push({
          name: safeName,
          status: 'duplicate',
          existingName: existing ? path.basename(existing) : dupInBatch.name,
          srcPath,
        });
        continue;
      }

      newItems.push({ name: safeName, srcPath });
      companies.push({ name: safeName, status: 'new', srcPath });
    }

    return {
      ok: true,
      date: dateKey,
      fileName: path.basename(zipPath),
      companies,
      newCount: newItems.length,
      duplicateCount: companies.filter((c) => c.status === 'duplicate').length,
      newItems,
      tmpDir,
    };
  } catch (err) {
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    }
    return {
      error: err && err.message ? err.message : String(err),
      code: 'READ_FAILED',
    };
  }
}

function cleanupImportTemp(tmpDir) {
  if (!tmpDir) return;
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
}

function analyzeZipForImport(saveFolder, zipPath) {
  const result = readImportZipContents(saveFolder, zipPath);
  if (result.error) return result;
  cleanupImportTemp(result.tmpDir);
  return {
    ok: true,
    date: result.date,
    fileName: result.fileName,
    zipPath,
    companies: result.companies,
    newCount: result.newCount,
    duplicateCount: result.duplicateCount,
  };
}

function importProcessesZip(saveFolder, zipPath, importNames) {
  const result = readImportZipContents(saveFolder, zipPath);
  if (result.error) return result;

  const { tmpDir, date, companies } = result;
  const srcByName = new Map();
  for (const c of companies) {
    if (c.srcPath && c.name) srcByName.set(c.name, c.srcPath);
  }

  const selectedNames = Array.isArray(importNames)
    ? importNames.filter((n) => typeof n === 'string' && n)
    : companies.filter((c) => c.status === 'new').map((c) => c.name);

  const skipped = companies.length - selectedNames.length;

  try {
    let imported = 0;
    const importedNames = [];
    for (const name of selectedNames) {
      const srcPath = srcByName.get(name);
      if (!srcPath) continue;
      const destPath = path.join(saveFolder, name);
      if (!isPathInside(saveFolder, destPath)) continue;
      if (fs.existsSync(destPath)) continue;
      fs.cpSync(srcPath, destPath, { recursive: true });
      imported += 1;
      importedNames.push(name);
    }

    return {
      ok: true,
      imported,
      skipped,
      importedNames,
      date,
    };
  } catch (err) {
    return {
      error: err && err.message ? err.message : String(err),
      code: 'IMPORT_FAILED',
    };
  } finally {
    cleanupImportTemp(tmpDir);
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

function deleteProcessFolder(profileId, saveFolder, relativePath) {
  if (!saveFolder || typeof saveFolder !== 'string') {
    return { error: 'No save folder configured.', code: 'NO_SAVE_FOLDER' };
  }
  if (!relativePath || typeof relativePath !== 'string') {
    return { error: 'Invalid folder path.', code: 'INVALID_PATH' };
  }
  const folderPath = resolveRelativePath(saveFolder, relativePath);
  if (!folderPath) {
    return { error: 'Refused to delete a path outside the save folder.', code: 'INVALID_PATH' };
  }
  if (!fs.existsSync(folderPath)) {
    return { ok: true, alreadyGone: true };
  }
  try {
    fs.rmSync(folderPath, { recursive: true, force: true });
    removeEmptyParentDirs(path.dirname(folderPath), saveFolder);
  } catch (err) {
    return {
      error: err && err.message ? err.message : String(err),
      code: 'DELETE_FAILED',
    };
  }
  return { ok: true };
}

function renameProcessFolder(profileId, saveFolder, relativePath, newNameRaw) {
  if (!saveFolder || typeof saveFolder !== 'string') {
    return { error: 'No save folder configured.', code: 'NO_SAVE_FOLDER' };
  }
  if (!relativePath || typeof relativePath !== 'string') {
    return { error: 'Invalid folder path.', code: 'INVALID_PATH' };
  }
  const oldPath = resolveRelativePath(saveFolder, relativePath);
  if (!oldPath) {
    return { error: 'Refused to rename outside the save folder.', code: 'INVALID_PATH' };
  }
  const oldName = path.basename(oldPath);
  const newName = safePathSegment(newNameRaw);
  if (!newName) {
    return { error: 'New name is empty or invalid.', code: 'EMPTY_NAME' };
  }
  if (newName === oldName) {
    return {
      ok: true,
      path: oldPath,
      name: oldName,
      relativePath: toRelativePath(saveFolder, oldPath),
      unchanged: true,
    };
  }

  const parentDir = path.dirname(oldPath);
  const newPath = path.join(parentDir, newName);
  if (!isPathInside(saveFolder, oldPath) || !isPathInside(saveFolder, newPath)) {
    return { error: 'Refused to rename outside the save folder.', code: 'INVALID_PATH' };
  }

  if (!fs.existsSync(oldPath)) {
    return { error: 'Original folder no longer exists.', code: 'NOT_FOUND' };
  }
  if (fs.existsSync(newPath)) {
    return {
      error: duplicateCompanyMessage(newName, newPath),
      code: 'DUPLICATE',
      path: newPath,
    };
  }

  const conflicting = findExistingCompanyFolder(saveFolder, newName, oldPath);
  if (conflicting) {
    return {
      error: duplicateCompanyMessage(newName, conflicting),
      code: 'DUPLICATE',
      path: conflicting,
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

  const newRelativePath = toRelativePath(saveFolder, newPath);

  return { ok: true, path: newPath, name: newName, relativePath: newRelativePath };
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
 * `{saveFolder}/{companyName}/{fileName}`.
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
  const existingCompanyFolder = findExistingCompanyFolder(saveFolder, company);
  if (existingCompanyFolder) {
    return {
      error: duplicateCompanyMessage(company, existingCompanyFolder),
      code: 'DUPLICATE_FOLDER',
      path: existingCompanyFolder,
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

    return { path: outPath, folder: companyFolder, jdPath, jdError: jdError || undefined };
  } catch (err) {
    console.error('exportPdf failed:', err);
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

  return {
    $schema: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    app: { name: 'Resume Manager', version: app.getVersion() },
    profiles,
    resumes,
    prompts,
    jds,
    // Manage process / company applications live in each profile's save
    // folder on disk — not included in backup.
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
 * Wipe-and-restore. Replaces per-profile app data and `profiles.json`.
 * Company applications are read from each profile's save folder, not restored here.
 */
function applyBackup(payload) {
  const validation = validateBackup(payload);
  if (!validation.valid) {
    return { error: validation.error, code: 'INVALID_BACKUP' };
  }

  const counts = { profiles: 0, resumes: 0, prompts: 0, jds: 0 };

  try {
    fs.mkdirSync(path.dirname(getProfilesPath()), { recursive: true });
    fs.writeFileSync(
      getProfilesPath(),
      JSON.stringify(payload.profiles, null, 2),
      'utf-8'
    );
    counts.profiles = payload.profiles.length;

    for (const [dir, ext, dataKey, mode] of [
      [getResumesDir(), '.json', 'resumes', 'json'],
      [getPromptsDir(), '.txt', 'prompts', 'text'],
      [getJdsDir(), '.txt', 'jds', 'text'],
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

    // Drop legacy local process metadata; Manage reads the save folder instead.
    try { fs.rmSync(getProcessesDir(), { recursive: true, force: true }); } catch (_) { /* ignore */ }
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
  ipcMain.handle('process:checkDuplicate', (_event, saveFolder, companyName, exceptPath) =>
    checkCompanyDuplicate(saveFolder, companyName, exceptPath)
  );
  ipcMain.handle('process:delete', (_event, profileId) =>
    deleteProcessesData(profileId)
  );
  ipcMain.handle('process:readJd', (_event, filePath) => readJdFile(filePath));
  ipcMain.handle('process:readResume', (_event, filePath) =>
    readResumeFile(filePath)
  );
  ipcMain.handle('process:openFolder', (_event, folderPath) =>
    openFolder(folderPath)
  );
  ipcMain.handle('process:rename', (_event, profileId, saveFolder, relativePath, newName) =>
    renameProcessFolder(profileId, saveFolder, relativePath, newName)
  );
  ipcMain.handle('process:deleteFolder', (_event, profileId, saveFolder, relativePath) =>
    deleteProcessFolder(profileId, saveFolder, relativePath)
  );
  ipcMain.handle('process:exportZip', async (event, saveFolder, dateKey, firstName, lastName) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    return exportProcessesZip(parent, saveFolder, dateKey, firstName, lastName);
  });
  ipcMain.handle('process:pickImportZip', async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    return pickImportZipFile(parent);
  });
  ipcMain.handle('process:analyzeImportZip', (_event, saveFolder, zipPath) =>
    analyzeZipForImport(saveFolder, zipPath)
  );
  ipcMain.handle('process:importZip', (_event, saveFolder, zipPath, importNames) =>
    importProcessesZip(saveFolder, zipPath, importNames)
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
