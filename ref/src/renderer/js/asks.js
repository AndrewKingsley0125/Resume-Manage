// Questions from the runs: paste a ChatGPT reply (manual mode), review
// answers, confirm Submit, a manual step (CAPTCHA, code, sign-in), or a
// failure with Rescan. Each question's content is kept per tab, so switching
// tabs keeps what was typed.
import { $, el } from './dom.js';
import { STEP_LABELS, runs, state, shownRun, log, onScreen } from './state.js';
import { select, refresh, profileRuns } from './workspace.js';
import { loadProfiles } from './profiles.js';

const showAsk = (...children) => el('div', { class: 'ask-body' }, ...children);

function answer(id, value) {
  const run = [...runs.values()].find(r => r.ask && r.ask.id === id);
  if (run) {
    run.ask = null;
    run.askNode = null;
  }
  window.api.respond(id, value);
  // Next tab waiting for you, if any.
  const next = !shownRun()?.ask && profileRuns().find(r => r.ask);
  if (next) select(next.id);
  else refresh(state.selected);
}

function askLlm(req) {
  const reply = el('textarea', { rows: 8, placeholder: 'Paste the ChatGPT reply here' });
  const request = el('textarea', { rows: 6, readonly: true });
  request.value = req.text;
  return showAsk(
    el('h3', {}, req.purpose === 'resume' ? 'Generate resume in ChatGPT' : 'Answer questions in ChatGPT'),
    el('p', { class: 'muted' }, 'Send the prompt to Chrome, review it and press Send in ChatGPT. When the response finishes, import it here. Copy/paste also works.'),
    request,
    el('div', { class: 'row' },
      el('button', { class: 'btn ghost', type: 'button', onclick: async () => {
        try { await window.api.sendChatPrompt(req.runId, req.text); log('Prompt placed in Chrome. Review and press Send in ChatGPT.', req.runId); }
        catch (err) { log(err.message, req.runId); }
      } }, 'Send prompt to Chrome'),
      el('button', { class: 'btn ghost', type: 'button', onclick: async () => {
        try { reply.value = await window.api.importChatReply(req.runId); }
        catch (err) { log(err.message, req.runId); }
      } }, 'Import reply from Chrome')),
    el('div', { class: 'row' },
      el('button', { class: 'btn ghost', type: 'button', onclick: () => navigator.clipboard.writeText(req.text).then(() => log('Request copied', req.runId)) }, 'Copy request'),
      el('button', { class: 'btn ghost', type: 'button', onclick: async () => { reply.value = await navigator.clipboard.readText(); } }, 'Paste reply')),
    reply,
    el('button', { class: 'btn primary', type: 'button', onclick: () => reply.value.trim() && answer(req.id, reply.value) }, 'Use reply'),
  );
}

function inputFor(f, current) {
  if (current.source === 'blocked') return el('input', { disabled: true, value: 'Blocked — fill manually if needed' });
  if (f.type === 'file') return el('input', { readonly: true, value: current.value || '' });
  if (f.options && f.options.length) {
    const select = el('select', {}, el('option', { value: '' }, '—'));
    for (const o of f.options) select.append(el('option', { value: o, selected: o === current.value ? 'selected' : null }, o));
    return select;
  }
  const node = el(f.type === 'textarea' ? 'textarea' : 'input', { rows: f.type === 'textarea' ? 3 : null });
  node.value = current.value || '';
  return node;
}

function askReview(req) {
  const rows = req.fields.map(f => {
    const current = req.answers.find(a => a.id === f.id) || { id: f.id, value: null, source: 'unknown' };
    const control = inputFor(f, current);
    return { field: f, current, input: control, node: el('div', { class: `review-row src-${current.source}` },
      el('div', { class: 'review-label' }, (f.label || f.name || f.id).replace(/\s*\*\s*$/, ''), f.required ? ' *' : '',
        el('span', { class: 'badge' }, current.source)),
      control) };
  });
  const collect = () => rows.map(({ field: f, current, input: control }) => {
    if (current.source === 'blocked' || f.type === 'file') return current;
    const value = control.value === '' ? null : control.value;
    return value === current.value ? current : { id: f.id, value, source: 'user' };
  });
  return showAsk(
    el('h3', {}, req.followUp ? `Follow-up questions — form step ${req.step}` : `Review answers — form step ${req.step}`),
    el('p', { class: 'muted' }, 'Edit anything that looks wrong. Approved values are typed into the form.'),
    ...rows.map(r => r.node),
    el('div', { class: 'row' },
      el('button', { class: 'btn primary', type: 'button', onclick: () => answer(req.id, collect()) }, 'Approve & fill'),
      el('button', { class: 'btn danger', type: 'button', onclick: () => answer(req.id, null) }, 'Cancel run')),
  );
}

function askConfirmSubmit(req) {
  return showAsk(
    el('h3', {}, 'Submit application?'),
    el('p', { class: 'muted' }, 'Check the form in the browser window first.'),
    el('div', { class: 'row' },
      el('button', { class: 'btn primary', type: 'button', onclick: () => answer(req.id, true) }, 'Submit'),
      el('button', { class: 'btn danger', type: 'button', onclick: () => answer(req.id, false) }, 'Don\'t submit')),
  );
}

// Company name modal: the resume JSON had no company, so the save folder needs
// a name (as in Resume Manager). One modal at a time; other tabs wait in line.
const companyQueue = [];

function openCompanyModal() {
  const req = companyQueue[0];
  if (!req || $('company-modal').open) return;
  const run = runs.get(req.runId);
  $('company-modal-job').textContent = [req.jobTitle, run && run.url].filter(Boolean).join(' — ');
  $('company-modal-error').textContent = '';
  const input = $('company-modal-input');
  input.value = req.suggested || '';
  window.api.coverPanes(true); // the native panes would sit on top of the modal
  $('company-modal').showModal();
  input.focus();
  input.select();
}

function closeCompanyModal(value) {
  const req = companyQueue.shift();
  $('company-modal').close();
  window.api.coverPanes(false);
  if (req) answer(req.id, value);
  openCompanyModal();
}

function initCompanyModal() {
  const save = () => {
    // Same characters the save folder drops (export.js safePathSegment).
    const name = $('company-modal-input').value.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/^\.+|\.+$/g, '').trim();
    if (!name) return void ($('company-modal-error').textContent = 'Enter a company name.');
    log(`Company name: ${name}`, companyQueue[0] && companyQueue[0].runId);
    closeCompanyModal(name);
  };
  $('company-modal-save').addEventListener('click', save);
  $('company-modal-input').addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  $('company-modal-cancel').addEventListener('click', () => closeCompanyModal(null));
  $('company-modal').addEventListener('cancel', e => { e.preventDefault(); closeCompanyModal(null); }); // Esc
}

/** In the tab's panel while its modal is open or waiting for another tab's. */
function askCompanyName(req) {
  companyQueue.push(req);
  openCompanyModal();
  return showAsk(
    el('h3', { class: 'notice-title' }, 'Company name needed'),
    el('p', {}, 'The generated resume has no company name, so the save folder needs one.'),
    el('div', { class: 'row' },
      el('button', { class: 'btn primary', type: 'button', onclick: () => {
        // Bring this tab's request to the front if another modal is not open.
        const i = companyQueue.indexOf(req);
        if (i > 0 && !$('company-modal').open) companyQueue.unshift(...companyQueue.splice(i, 1));
        openCompanyModal();
      } }, 'Enter company name')),
  );
}

const NOTICE_TITLES = { captcha: 'Solve the CAPTCHA', 'verification-code': 'Enter the email security code', chatgpt: 'ChatGPT needs you', login: 'Sign in to the job site', unknown: 'Check the job page' };

function askNotice(req) {
  log(`Waiting for you: ${req.message}`, req.runId);
  return showAsk(
    el('h3', { class: 'notice-title' }, NOTICE_TITLES[req.blocker] || 'Action needed'),
    el('p', {}, req.message),
    el('div', { class: 'row' },
      el('button', { class: 'btn primary', type: 'button', onclick: () => answer(req.id, true) }, 'Continue — I did it'),
      el('button', { class: 'btn danger', type: 'button', onclick: () => answer(req.id, null) }, 'Cancel run')),
  );
}

/** A step failed: the user fixes it in the job pane and presses Rescan to carry on. */
function askFailed(req) {
  return showAsk(
    el('h3', { class: 'notice-title' }, `${STEP_LABELS[req.step] || 'Step'} failed`),
    el('p', { class: 'error-text' }, req.error),
    el('p', {}, req.message),
    el('div', { class: 'row' },
      el('button', { class: 'btn primary', type: 'button', onclick: () => answer(req.id, true) }, 'Rescan and continue'),
      el('button', { class: 'btn danger', type: 'button', onclick: () => answer(req.id, null) }, 'Stop run')),
  );
}

function askChromeNext(req) {
  return showAsk(el('h3', {}, 'Review in Chrome'), el('p', {}, req.message),
    el('button', { class: 'btn primary', type: 'button', onclick: () => answer(req.id, 'scan') }, 'Scan again'),
    el('button', { class: 'btn ghost', type: 'button', onclick: () => answer(req.id, 'ready') }, 'Ready to submit'),
    el('button', { class: 'btn danger', type: 'button', onclick: () => answer(req.id, null) }, 'Cancel run'));
}
const BUILDERS = { 'chrome-next': askChromeNext, llm: askLlm, failed: askFailed, review: askReview, 'confirm-submit': askConfirmSubmit, 'company-name': askCompanyName };

export function initAsks() {
  initCompanyModal();
  window.api.onAsk(req => {
    const run = runs.get(req.runId);
    if (!run) return;
    run.ask = req;
    run.askNode = (BUILDERS[req.kind] || askNotice)(req);
    // Jump to it unless you are answering another tab right now (or are on another screen).
    const here = onScreen('workspace') && state.profile && run.profileId === state.profile.id;
    if (here && req.runId !== state.selected && !shownRun()?.ask) select(req.runId);
    else refresh(req.runId);
    if (onScreen('profiles')) loadProfiles(); // the profile card shows it is waiting
  });
}
