// Screen 2: the profile editor. Same fields as Resume Manager, plus the
// details used to answer application questions (address parts, education
// with major, work authorization, self-identification).
import { $, el, fullName } from './dom.js';
import { showScreen } from './state.js';
import { loadProfiles } from './profiles.js';

const PERSONAL_FIELDS = [
  ['firstName', 'First name'], ['lastName', 'Last name'],
  ['dob', 'Date of birth', 'date'], ['location', 'Location', 'text', 'City, State'],
  ['phone', 'Phone', 'tel', '+1 (555) 123-4567'], ['email', 'Email', 'email', 'you@gmail.com'],
  ['ssn', 'SSN (kept for you; never filled automatically)', 'text', 'XXX-XX-XXXX'], ['dl', "Driver's license # (never filled automatically)"],
  ['dlIssuedDate', 'DL issued date', 'date'], ['dlExpireDate', 'DL expire date', 'date'],
];
const LIST_FIELDS = {
  workHistory: { title: 'Work history', add: '+ Add work history', fields: [['company', 'Company'], ['title', 'Title'], ['period', 'Period (e.g. Jan 2020 - Present)'], ['location', 'Location'], ['workType', 'Work type (Full-time, Contract, Part-time)'], ['workArrangement', 'Work arrangement (Remote, Hybrid, Onsite)'], ['bulletsCount', 'Bullets (number, optional)', 'number']] },
  education: { title: 'Education', add: '+ Add education', fields: [['institution', 'Institution name'], ['degree', "Degree (e.g. Bachelor's Degree)"], ['major', 'Major (e.g. Computer Science)'], ['period', 'Period (e.g. 2013 - 2017)']] },
  certifications: { title: 'Certifications', add: '+ Add certification', fields: [['institution', 'Issuer'], ['certification', 'Certification'], ['date', 'Date']] },
};
const ADDRESS_FIELDS = [['line1', 'Address line 1', '1 Main St'], ['line2', 'Address line 2', 'Apt, suite (optional)'], ['city', 'City'], ['state', 'State', 'TX or Texas'], ['postalCode', 'ZIP code'], ['country', 'Country', 'United States']];
const EEO_FIELDS = [['gender', 'Gender', 'Male'], ['race', 'Race / ethnicity', 'Asian'], ['hispanicLatino', 'Hispanic or Latino', 'No'], ['veteran', 'Veteran', 'No'], ['disability', 'Disability', 'No']];
const YES_NO = [['', 'Not set (ask me)'], ['yes', 'Yes'], ['no', 'No']];

let editing = null; // profile being edited ({} for a new one)
const form = () => $('editor-form');
const scroller = () => $('view-editor').querySelector('.screen-body');

const input = (name, value, type = 'text', placeholder = '') => {
  const node = el('input', { name, type, placeholder });
  node.value = value == null ? '' : value;
  return node;
};
const field = (label, control, cls = '') => el('label', { class: `field ${cls}` }, el('span', {}, label), control);
const section = (title, ...children) => el('fieldset', { class: 'card editor-section' }, el('legend', {}, title), ...children);
const yesNo = (name, value) => {
  const select = el('select', { name }, ...YES_NO.map(([v, t]) => el('option', { value: v }, t)));
  select.value = value === true ? 'yes' : value === false ? 'no' : '';
  return select;
};

/** A repeating list (work history, education, certifications) with add/remove. */
function entryList(key, entries) {
  const spec = LIST_FIELDS[key];
  const list = el('div', { class: 'entry-list', 'data-list': key });
  const addEntry = (entry = {}) => {
    const row = el('div', { class: 'entry' },
      el('div', { class: 'form-grid' }, ...spec.fields.map(([name, label, type]) => field(label, input(name, entry[name], type || 'text')))),
      el('button', { class: 'btn ghost', type: 'button', onclick: () => row.remove() }, 'Remove'));
    list.append(row);
  };
  (entries || []).forEach(addEntry);
  return section(spec.title, list, el('button', { class: 'btn ghost', type: 'button', onclick: () => addEntry() }, spec.add));
}

export function openEditor(p) {
  editing = p || {};
  const app = editing.application || {};
  const addr = app.address || {};
  const eeo = app.eeo || {};
  $('editor-title').textContent = p ? `Edit profile · ${fullName(p)}` : 'New profile';
  $('editor-delete').classList.toggle('hidden', !p);

  const folder = input('saveFolder', editing.saveFolder);
  folder.readOnly = true;
  const linkToggle = (name, on) => el('label', { class: 'toggle' }, el('input', { type: 'checkbox', name, checked: on !== false ? 'checked' : null }), 'Show on resume');

  form().replaceChildren(
    section('Personal',
      el('div', { class: 'form-grid' },
        ...PERSONAL_FIELDS.map(([name, label, type, ph]) => field(label, input(name, editing[name], type, ph))),
        field('LinkedIn', el('div', { class: 'row' }, input('linkedin', editing.linkedin, 'url', 'https://linkedin.com/in/...'), linkToggle('linkedinVisible', editing.linkedinVisible)), 'full'),
        field('GitHub', el('div', { class: 'row' }, input('github', editing.github, 'url', 'https://github.com/...'), linkToggle('githubVisible', editing.githubVisible)), 'full'),
        field('Save folder for exported resumes', el('div', { class: 'row' }, folder,
          el('button', { class: 'btn ghost', type: 'button', onclick: async () => { const f = await window.api.pickFolder(folder.value); if (f) folder.value = f; } }, 'Browse…')), 'full'),
        field('Target level / prompt guidance', input('title', editing.title, 'text', 'e.g. Senior DevOps Engineer'), 'full'))),
    entryList('workHistory', editing.workHistory),
    entryList('education', editing.education),
    entryList('certifications', editing.certifications),
    section('Answers for application questions',
      el('p', { class: 'muted small' }, 'Used to fill application forms. The address parts answer Address / City / State / ZIP / Country questions; the first education entry answers School / Degree / Major / Graduation questions.'),
      el('h4', {}, 'Full address'),
      el('div', { class: 'form-grid', 'data-group': 'address' }, ...ADDRESS_FIELDS.map(([name, label, ph]) => field(label, input(name, addr[name], 'text', ph)))),
      el('h4', {}, 'Work'),
      el('div', { class: 'form-grid' },
        field('Work authorization', input('workAuthorization', app.workAuthorization, 'text', 'U.S. Citizen, Green Card, H-1B…')),
        field('Requires visa sponsorship', yesNo('requiresSponsorship', app.requiresSponsorship)),
        field('Willing to relocate', yesNo('willingToRelocate', app.willingToRelocate)),
        field('Salary expectation (blank: from the job posting)', input('salaryExpectation', app.salaryExpectation, 'text', 'e.g. 150000')),
        field('Start date / notice period', input('noticePeriod', app.noticePeriod, 'text', 'e.g. Immediately, 2 weeks'))),
      el('h4', {}, 'Voluntary self-identification (blank: standard answer)'),
      el('div', { class: 'form-grid', 'data-group': 'eeo' }, ...EEO_FIELDS.map(([name, label, ph]) => field(label, input(name, eeo[name], 'text', `Standard: ${ph}`))))),
  );
  scroller().scrollTop = 0;
  showScreen('editor');
}

/** Read the editor back into a profile object (fields it does not show are kept by the main process). */
function readEditor() {
  const root = form();
  const val = (name, scope = root) => {
    const node = scope.querySelector(`[name="${name}"]`);
    return node ? node.value.trim() : '';
  };
  const out = { ...(editing.id ? { id: editing.id } : {}) };
  for (const [name] of PERSONAL_FIELDS) out[name] = val(name);
  for (const name of ['linkedin', 'github', 'saveFolder', 'title']) out[name] = val(name);
  out.linkedinVisible = root.querySelector('[name="linkedinVisible"]').checked;
  out.githubVisible = root.querySelector('[name="githubVisible"]').checked;
  for (const [key, spec] of Object.entries(LIST_FIELDS)) {
    out[key] = [...root.querySelectorAll(`[data-list="${key}"] .entry`)].map(row => {
      const entry = {};
      for (const [name, , type] of spec.fields) {
        const v = val(name, row);
        entry[name] = type === 'number' ? (v === '' ? null : Number(v)) : v;
      }
      return entry;
    }).filter(entry => Object.values(entry).some(v => v !== '' && v != null));
  }
  const group = name => root.querySelector(`[data-group="${name}"]`);
  const yn = name => ({ yes: true, no: false })[val(name)] ?? null;
  out.application = {
    address: Object.fromEntries(ADDRESS_FIELDS.map(([name]) => [name, val(name, group('address'))])),
    eeo: { ...((editing.application || {}).eeo || {}), ...Object.fromEntries(EEO_FIELDS.map(([name]) => [name, val(name, group('eeo'))])) },
    workAuthorization: val('workAuthorization'),
    requiresSponsorship: yn('requiresSponsorship'),
    willingToRelocate: yn('willingToRelocate'),
    salaryExpectation: val('salaryExpectation'),
    noticePeriod: val('noticePeriod'),
  };
  return out;
}

function alertInEditor(message) {
  const note = el('p', { class: 'error-text' }, message);
  form().prepend(note);
  setTimeout(() => note.remove(), 5000);
  scroller().scrollTop = 0;
}

export function initEditor() {
  $('editor-save').addEventListener('click', async () => {
    const data = readEditor();
    if (!data.firstName || !data.lastName) return alertInEditor('First and last name are required.');
    try {
      await window.api.saveProfile(data);
    } catch (err) {
      return alertInEditor(err.message);
    }
    await loadProfiles();
    showScreen('profiles');
  });
  $('editor-cancel').addEventListener('click', () => showScreen('profiles'));

  // Delete asks for a second click instead of a dialog.
  let armed = null;
  $('editor-delete').addEventListener('click', async () => {
    const btn = $('editor-delete');
    if (!armed) {
      btn.textContent = 'Click again to delete';
      armed = setTimeout(() => { armed = null; btn.textContent = 'Delete'; }, 4000);
      return;
    }
    clearTimeout(armed);
    armed = null;
    btn.textContent = 'Delete';
    try {
      await window.api.deleteProfile(editing.id);
      await loadProfiles();
      showScreen('profiles');
    } catch (err) {
      alertInEditor(err.message);
    }
  });
}
