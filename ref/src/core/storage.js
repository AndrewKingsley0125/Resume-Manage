// JSON persistence under a base directory (Electron userData in the app,
// a temp dir in tests). Profiles keep the Resume Manager shape plus the
// application fields defined in `defaultApplicationInfo`.
const fs = require('node:fs');
const path = require('node:path');
const { resolveTemplateId, DEFAULT_TEMPLATE } = require('./render');

/** Extra profile data used to answer application questions. */
function defaultApplicationInfo() {
  return {
    address: { line1: '', line2: '', city: '', state: '', postalCode: '', country: 'United States' },
    workAuthorization: '', // e.g. "US Citizen", "Green Card", "H-1B"
    requiresSponsorship: null, // true | false | null (unknown → ask)
    willingToRelocate: null,
    salaryExpectation: '',
    noticePeriod: '',
    eeo: { pronouns: '', gender: '', race: '', hispanicLatino: '', veteran: '', disability: '' }, // '' → standard answer (standard-answers.js)
    personal: {}, // overrides for standard-answers.js PERSONAL, e.g. { gender: 'Female' }
    /** Saved question/answer pairs reused across applications. */
    answerBank: [], // [{ question, answer, updatedAt }]
  };
}

function createStorage(baseDir) {
  const file = name => path.join(baseDir, name);

  function readJson(name, fallback) {
    try {
      return JSON.parse(fs.readFileSync(file(name), 'utf8'));
    } catch (_) {
      return fallback;
    }
  }

  function writeJson(name, value) {
    fs.mkdirSync(path.dirname(file(name)), { recursive: true });
    fs.writeFileSync(file(name), JSON.stringify(value, null, 2), 'utf8');
  }

  function normalizeProfile(p) {
    const base = defaultApplicationInfo();
    const app = p.application || {};
    return {
      ...p,
      templateId: resolveTemplateId(p.templateId),
      application: {
        ...base,
        ...app,
        address: { ...base.address, ...(app.address || {}) },
        eeo: { ...base.eeo, ...(app.eeo || {}) },
        answerBank: Array.isArray(app.answerBank) ? app.answerBank : [],
      },
    };
  }

  const listProfiles = () => {
    const list = readJson('profiles.json', []);
    return Array.isArray(list) ? list.map(normalizeProfile) : [];
  };
  const saveProfiles = profiles => writeJson('profiles.json', profiles);

  /**
   * Create or update one profile from the editor. Fields the editor does not
   * show (color, template choice, answer bank) are kept from the stored copy.
   */
  function saveProfile(edited) {
    const profiles = listProfiles();
    const i = profiles.findIndex(p => p.id === edited.id);
    const before = i >= 0 ? profiles[i] : { id: `p${Date.now().toString(36)}`, createdAt: Date.now(), templateId: DEFAULT_TEMPLATE };
    const merged = normalizeProfile({
      ...before, ...edited, id: before.id,
      application: { ...before.application, ...edited.application, answerBank: (before.application || {}).answerBank || [] },
    });
    if (i >= 0) profiles[i] = merged;
    else profiles.push(merged);
    saveProfiles(profiles);
    return merged;
  }

  function deleteProfile(id) {
    saveProfiles(listProfiles().filter(p => p.id !== id));
  }
  const getProfile = id => listProfiles().find(p => p.id === id) || null;

  function addProfiles(incoming) {
    const current = listProfiles();
    const known = new Set(current.map(p => p.id));
    const added = incoming.filter(p => p && p.id && !known.has(p.id)).map(normalizeProfile);
    saveProfiles([...current, ...added]);
    return added.length;
  }

  /** Template styles keyed "<profileId>:<templateId>", as Resume Manager stores them. */
  const getStyles = () => readJson('styles.json', {});
  const getStyle = (profileId, templateId) => getStyles()[`${profileId}:${templateId}`] || null;

  /** Merge styles over existing ones. Keys without a template are Resume Manager's legacy styles, which it moves to Classic. */
  function addStyles(incoming) {
    const styles = getStyles();
    let count = 0;
    for (const [key, value] of Object.entries(incoming || {})) {
      if (!value || typeof value !== 'object') continue;
      const target = key.includes(':') ? key : `${key}:${DEFAULT_TEMPLATE}`;
      if (target !== key && incoming[target]) continue; // the explicit entry wins
      styles[target] = value;
      count++;
    }
    writeJson('styles.json', styles);
    return count;
  }

  /**
   * Import from Resume Manager: either its profiles.json (a list) or a backup
   * file (profiles + template styles). Profiles already present are skipped;
   * styles are always updated.
   */
  function importProfiles(sourceFile) {
    const data = JSON.parse(fs.readFileSync(sourceFile, 'utf8'));
    if (Array.isArray(data)) return { profiles: addProfiles(data), styles: 0 };
    if (data && data.$schema === 'resume-manager-backup' && Array.isArray(data.profiles)) {
      return { profiles: addProfiles(data.profiles), styles: addStyles(data.styles) };
    }
    throw new Error('Not a Resume Manager profiles.json or backup file');
  }

  const defaultSettings = {
    llmProvider: 'chrome-chat',
    browserAutomation: true,
    reviewAnswers: false,
    browserChannel: 'chrome',
    humanCursor: true, // cursor movement for clicks outside form filling (Apply, ChatGPT)
    fillMode: 'fast', // 'fast': fill approved answers at once | 'human': field by field with the cursor
    autoSubmit: false,
  };
  const getSettings = () => ({ ...defaultSettings, ...readJson('settings.json', {}) });
  const saveSettings = s => writeJson('settings.json', { ...getSettings(), ...s });

  /** One line per run (including skipped and failed jobs, which have no folder). */
  function appendRunLog(entry) {
    fs.mkdirSync(baseDir, { recursive: true });
    fs.appendFileSync(file('runs.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n', 'utf8');
  }

  /** Add or update answers the user confirmed, so the next application reuses them. */
  function rememberAnswers(profileId, pairs) {
    const profiles = listProfiles();
    const profile = profiles.find(p => p.id === profileId);
    if (!profile) return;
    const bank = profile.application.answerBank;
    for (const { question, answer } of pairs) {
      const existing = bank.find(b => b.question === question);
      if (existing) Object.assign(existing, { answer, updatedAt: Date.now() });
      else bank.push({ question, answer, updatedAt: Date.now() });
    }
    saveProfiles(profiles);
  }

  return { listProfiles, saveProfiles, saveProfile, deleteProfile, getProfile, importProfiles, getStyle, getSettings, saveSettings, normalizeProfile, appendRunLog, rememberAnswers };
}

module.exports = { createStorage, defaultApplicationInfo };
