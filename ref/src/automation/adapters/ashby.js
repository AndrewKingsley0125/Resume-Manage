// Ashby job boards (jobs.ashbyhq.com/<company>/<job-id>[/application]).
// The JD is on the Overview tab (also in JSON-LD); the form is on the
// Application tab (<job-url>/application), one page, no steps.
// Every question is a `.ashby-application-form-field-entry` div or a
// radio/checkbox-group fieldset with a `.ashby-application-form-question-title`
// label; required ones carry a `_required_` class. Widgets:
//   yes/no      two buttons (data-option="yes|no") + hidden checkbox
//   radio group fieldset of radios, checkbox group fieldset of checkboxes
//   location    search-as-you-type combobox (options appear after typing)
// The "Autofill from resume" uploader above the form is skipped: it would
// overwrite answers with Ashby's own parse of the resume.
// Compensation is shown only in the sidebar, so it is appended to the JD.
// reCAPTCHA Enterprise (invisible) runs at submit.
// Sample: samples/ashby-headway
const generic = require('./generic');

const FORM = '.ashby-application-form-container';
const SUBMIT = 'button.ashby-application-form-submit-button';

async function extractJob(page) {
  const job = await generic.extractJob(page);
  const pay = await page.evaluate(() => {
    for (const h of document.querySelectorAll('h2')) {
      if (/compensation/i.test(h.innerText) && h.nextElementSibling) return h.nextElementSibling.innerText.trim();
    }
    return '';
  });
  if (pay && !job.description.includes(pay)) job.description = `${job.description.trim()}\n\nCompensation: ${pay}`;
  return { ...job, source: `ashby/${job.source}` };
}

async function openApplication(page, cursor) {
  if (!(await page.locator(FORM).count())) {
    const tab = await generic.helpers.firstVisible(page.locator('a#job-application-form, a[href$="/application"]'));
    if (tab) await cursor.click(tab);
    else await page.goto(`${page.url().split(/[?#]/)[0].replace(/\/$/, '')}/application`, { waitUntil: 'domcontentloaded' });
  }
  await page.locator(FORM).first().waitFor({ timeout: 20000 });
  return page;
}

/* eslint-disable no-undef -- body runs in the browser */
function scanInPage(formSelector) {
  const text = el => (el ? el.innerText || el.textContent || '' : '').replace(/\s+/g, ' ').trim();
  const visible = el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  const optionLabel = input => text(document.querySelector(`label[for="${CSS.escape(input.id)}"]`)) || input.value;
  const entries = [...document.querySelectorAll(`${formSelector} .ashby-application-form-field-entry, ${formSelector} fieldset[class*="ashby-application-form-input-"]`)]
    .filter((e, i, all) => visible(e) && !all.some(o => o !== e && o.contains(e)));

  const fields = [];
  let n = 0;
  for (const entry of entries) {
    const title = entry.querySelector('.ashby-application-form-question-title');
    const label = text(title);
    const required = !!title && /_required_/.test(title.className);
    const id = `f${n++}`;
    const hint = text(entry.querySelector('.ashby-application-form-question-description')); // e.g. "Please upload a PDF version"
    const base = { id, label, required, name: '', ...(hint ? { hint } : {}) };
    const tagOptions = els => els.forEach((el, i) => el.setAttribute('data-aa-option', `${id}:${i}`));

    const yesno = entry.querySelector('.ashby-application-form-input-yesno');
    if (yesno) {
      const buttons = [...yesno.querySelectorAll('button')];
      yesno.setAttribute('data-aa-field', id);
      tagOptions(buttons);
      fields.push({ ...base, type: 'radio', done: yesno.hasAttribute('data-aa-done'), options: buttons.map(text) });
      continue;
    }
    const choices = [...entry.querySelectorAll('input[type="radio"], input[type="checkbox"]')];
    if (choices.length) {
      const type = choices[0].type;
      choices[0].setAttribute('data-aa-field', id);
      tagOptions(choices);
      // A lone checkbox ("I agree ...") is labelled by the question itself.
      const options = choices.length === 1 && type === 'checkbox' ? [optionLabel(choices[0]) || label] : choices.map(optionLabel);
      fields.push({ ...base, type, done: choices[0].hasAttribute('data-aa-done'), options });
      continue;
    }
    const el = entry.querySelector('input[type="file"], textarea, select, input[role="combobox"], input:not([type="hidden"])');
    if (!el) continue;
    const tag = el.tagName.toLowerCase();
    const type = tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea'
      : el.getAttribute('role') === 'combobox' ? 'combobox' : (el.getAttribute('type') || 'text').toLowerCase();
    el.setAttribute('data-aa-field', id);
    fields.push({
      ...base, type, done: el.hasAttribute('data-aa-done'),
      required: required || el.required,
      options: type === 'select' ? [...el.options].filter(o => o.value !== '').map(text) : type === 'combobox' ? [] : undefined,
      accept: type === 'file' ? el.getAttribute('accept') || '' : undefined,
    });
  }
  return fields;
}
/* eslint-enable no-undef */

const scan = page => page.evaluate(scanInPage, FORM);

/** The location box is a search: type the value, pick the closest suggestion. */
async function fill(page, field, value, cursor) {
  if (field.type === 'combobox' && value) return generic.helpers.pickSuggestion(page, page.locator(`[data-aa-field="${field.id}"]`), String(value), cursor);
  return generic.fill(page, field, value, cursor);
}

module.exports = {
  ...generic,
  id: 'ashby',
  matches: url => /(^|\.)ashbyhq\.com$/i.test(url.hostname),
  extractJob,
  openApplication,
  scan,
  fill,
  nextStep: async () => false, // single-page form
  findSubmit: page => generic.helpers.firstVisible(page.locator(SUBMIT)),
};
