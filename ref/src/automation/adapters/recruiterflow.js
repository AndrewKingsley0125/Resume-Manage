// Recruiterflow career pages (recruiterflow.com/<company>/jobs/<id>).
// JD is in JSON-LD. "Apply To Job" reveals the form on the same page.
// Each question is a "*-wrapper" div whose `p.form-label` holds the question
// (`span.required` when required). One question can hold several inputs
// (Full Name: first/last; Location: city/state/country/zip; compensation:
// min/max), which get "<question> — <placeholder>" labels. Widgets:
//   yes/no      `.yes-no-inputs` with Yes/No buttons
//   dropdowns   react-select comboboxes ("Click to view options", Country)
//   currency    react-select preset to USD: skipped
//   phone       intl-tel-input, country preset to +1
// The "Candidate Profile" block (summary, experience, education) is optional
// and comes from the résumé, so it is left out. The closing EEO statement has
// an acknowledgment checkbox.
// Sample: samples/recruiterflow-rfs
const generic = require('./generic');

const FORM = '.basic-info-inputs-container, .additional-info-inputs-container';

async function openApplication(page, cursor) {
  const form = page.locator('#rf-application-form-first-name');
  if (!(await form.isVisible().catch(() => false))) {
    const button = await generic.helpers.firstVisible(page.locator('#job-details-apply-now-button'));
    if (button) await cursor.click(button);
  }
  await form.waitFor({ state: 'visible', timeout: 15000 });
  await form.scrollIntoViewIfNeeded();
  return page;
}

/* eslint-disable no-undef -- body runs in the browser */
function scanInPage() {
  const text = el => (el ? el.innerText || el.textContent || '' : '').replace(/\s+/g, ' ').trim();
  const visible = el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  const fields = [];
  let n = 0;
  const add = (el, field) => {
    const id = `f${n++}`;
    el.setAttribute('data-aa-field', id);
    fields.push({ id, name: el.getAttribute('name') || '', done: el.hasAttribute('data-aa-done'), ...field });
    return id;
  };

  // The résumé upload sits above the sections.
  const file = document.querySelector('.form-dnd-container input[type="file"]');
  if (file) {
    const head = file.closest('.form-dnd-container').querySelector('p.form-label');
    add(file, { type: 'file', label: text(head).replace(/\s*\*$/, ''), required: !!head.querySelector('.required'), accept: file.accept });
  }

  const labels = [...document.querySelectorAll('.basic-info-inputs-container p.form-label, .additional-info-inputs-container p.form-label')];
  for (const head of labels) {
    const wrap = head.parentElement;
    if (!visible(wrap)) continue;
    const question = text(head).replace(/\s*\*$/, '');
    const required = !!head.querySelector('.required');

    const yesno = wrap.querySelector('.yes-no-inputs');
    if (yesno) {
      const buttons = [...yesno.querySelectorAll('button')];
      const id = add(yesno, { type: 'radio', label: question, required, options: buttons.map(text) });
      buttons.forEach((b, i) => b.setAttribute('data-aa-option', `${id}:${i}`));
      continue;
    }
    const controls = [...wrap.querySelectorAll('input:not([type="hidden"]), textarea')]
      .filter(el => !el.closest('.flag-currency-select, .iti__country-container') && el.type !== 'checkbox');
    const many = controls.length > 1;
    for (const el of controls) {
      const combo = el.getAttribute('role') === 'combobox';
      // react-select shows its placeholder in a sibling div, not on the input.
      const holder = combo ? text(el.closest('[class*="control"]') && el.closest('[class*="control"]').querySelector('[class*="placeholder"]')) : el.placeholder;
      const part = /^min$/i.test(holder) ? 'min' : /^max$/i.test(holder) ? 'max' : undefined;
      add(el, {
        type: combo ? 'combobox' : el.tagName === 'TEXTAREA' ? 'textarea' : (el.type || 'text').toLowerCase(),
        label: many && holder && !/click to view/i.test(holder) ? `${question} — ${holder}` : question,
        required,
        options: combo ? [] : undefined,
        part,
      });
    }
  }

  // Acknowledgment checkbox under the EEO statement (not the "currently working" one).
  for (const box of document.querySelectorAll('.custom-checkbox-container input[type="checkbox"]')) {
    if (!visible(box.parentElement)) continue;
    const statement = text(box.parentElement);
    const id = add(box, { type: 'checkbox', label: statement, required: true, options: [statement] });
    box.setAttribute('data-aa-option', `${id}:0`);
  }
  return fields;
}
/* eslint-enable no-undef */

async function scan(page) {
  const fields = await page.evaluate(scanInPage);
  for (const field of fields) {
    if (field.type !== 'combobox' || field.done) continue;
    // Drop junk entries some boards have in their option lists (file URLs).
    field.options = (await generic.helpers.readComboboxOptions(page, field)).filter(o => !/^https?:\/\//.test(o));
  }
  return fields;
}

async function fill(page, field, value, cursor) {
  if (field.type === 'combobox' && value) {
    return generic.helpers.pickSuggestion(page, page.locator(`[data-aa-field="${field.id}"]`), String(value), cursor, { listed: field.options.length > 0 });
  }
  if (field.type === 'checkbox') {
    // A styled box: the input itself takes the click; skip it when already ticked.
    const box = page.locator(`[data-aa-field="${field.id}"]`);
    if (value && !(await box.isChecked())) await cursor.click(box.locator('xpath=..'));
    return;
  }
  return generic.fill(page, field, value, cursor);
}

module.exports = {
  ...generic,
  id: 'recruiterflow',
  matches: url => /(^|\.)recruiterflow\.com$/i.test(url.hostname) && /\/jobs\//.test(url.pathname),
  openApplication,
  scan,
  fill,
  nextStep: async () => false, // single-page form
  findSubmit: page => generic.helpers.firstVisible(page.locator('button').filter({ hasText: /^\s*submit application\s*$/i })),
};
