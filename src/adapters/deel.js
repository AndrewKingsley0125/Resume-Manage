// Deel ATS job boards (jobs.deel.com/<company>/job-details/<job-id>/overview).
// JD is in JSON-LD (JobPosting: title, hiringOrganization, jobLocation,
// employmentType). Its description is flat text, so the JD is read from the
// overview tab's rendered rich text ([class*=richTextDisplay]) when present.
// "Apply" switches the same tab to <job>/application (client-side route);
// one page, MUI components:
//   built-in fields  form#application-form: TextFields (label[for] + input,
//                    `.Mui-required` / asterisk span when required),
//                    phone = "Dial code" autocomplete (options "US +1", filtered
//                    by country name) + tel input, résumé = hidden
//                    input[type=file] whose aria-label is the question
//   custom questions next form, one [data-field-id] block each: question
//                    in the first <p> ("*" when required); radiogroup of
//                    label[data-text] > input[type=radio], textarea, ...
//   consent          privacy-policy checkbox below the AI disclaimer
// The "Upload your resume to autofill" button above the form is ignored.
// Submit: the "Apply" button below the consent (disabled until valid).
// Sample: samples/deel-xcite
const generic = require('./generic');

async function extractJob(page) {
  const job = await page.evaluate(() => {
    let post;
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      try { const d = JSON.parse(s.textContent); if (d['@type'] === 'JobPosting') post = d; } catch (_) { /* not JSON */ }
    }
    if (!post || !post.description) return null;
    const div = document.createElement('div');
    div.innerHTML = post.description;
    document.body.append(div); // innerText needs layout for line breaks
    // The JSON-LD copy is plain text; the overview tab renders the HTML.
    const shown = document.querySelector('[class*="richTextDisplay"]');
    const description = (shown || div).innerText.replace(/\n{3,}/g, '\n\n').trim();
    div.remove();
    const address = ([].concat(post.jobLocation || [])[0] || {}).address || {};
    return {
      title: post.title || '',
      company: (post.hiringOrganization && post.hiringOrganization.name) || '',
      location: [address.addressLocality, address.addressRegion, address.addressCountry].filter(Boolean).join(', '),
      remote: post.jobLocationType ? post.jobLocationType === 'TELECOMMUTE' : null,
      description,
      source: 'deel',
    };
  });
  return job || generic.extractJob(page);
}

async function openApplication(page, cursor) {
  if (!/\/application$/.test(new URL(page.url()).pathname)) {
    const button = await generic.helpers.firstVisible(page.locator('button').filter({ hasText: /^\s*apply\s*$/i }));
    if (!button) throw new Error('Could not find the Apply button');
    await cursor.click(button);
  }
  await page.locator('#application-form input[name="firstName"]').waitFor({ state: 'visible', timeout: 20000 });
  return page;
}

/* eslint-disable no-undef -- body runs in the browser */
function scanInPage() {
  const text = el => (el ? el.innerText || el.textContent || '' : '').replace(/\s+/g, ' ').trim();
  const visible = el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  const form = document.getElementById('application-form');
  if (!form) return [];
  const root = form.parentElement; // both forms, the consent box and the Apply button
  const fields = [];
  let n = 0;
  const add = (el, field) => {
    const id = `f${n++}`;
    el.setAttribute('data-aa-field', id);
    fields.push({ id, name: el.getAttribute('name') || '', done: el.hasAttribute('data-aa-done'), ...field });
    return id;
  };
  const strip = s => s.replace(/\s*\*$/, '');
  const typeOf = el => (el.getAttribute('role') === 'combobox' ? 'combobox'
    : el.tagName === 'TEXTAREA' ? 'textarea' : (el.getAttribute('type') || 'text').toLowerCase());

  // Built-in fields.
  for (const el of form.querySelectorAll('input, textarea')) {
    const type = typeOf(el);
    if (type === 'hidden' || el.getAttribute('aria-hidden') === 'true' || (type !== 'file' && !visible(el))) continue;
    if (type === 'file') {
      add(el, { type, label: strip(el.getAttribute('aria-label') || ''), required: /\*\s*$/.test(el.getAttribute('aria-label') || ''), accept: el.accept });
      continue;
    }
    const head = el.id && form.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    const dial = el.name === 'phoneNumber_dialCode';
    add(el, {
      type,
      // Named so the answer engine fills the profile country ("United States"),
      // which the list filters to "US +1".
      label: dial ? 'Country dial code' : strip(text(head)),
      name: dial ? '' : el.name, // "phoneNumber_dialCode" would match the phone number
      required: !!head && head.classList.contains('Mui-required'),
      options: type === 'combobox' ? [] : undefined,
    });
  }

  // Custom questions.
  for (const block of root.querySelectorAll('[data-field-id]')) {
    if (!visible(block)) continue;
    const q = text(block.querySelector('p'));
    const label = strip(q);
    const required = /\*$/.test(q);
    const choices = [...block.querySelectorAll('input[type="radio"], input[type="checkbox"]')];
    if (choices.length) {
      const id = add(choices[0], {
        type: choices[0].type, label, required,
        options: choices.map(c => { const l = c.closest('label'); return (l && (l.getAttribute('data-text') || text(l))) || c.value; }),
      });
      choices.forEach((c, i) => c.setAttribute('data-aa-option', `${id}:${i}`));
      continue;
    }
    for (const el of block.querySelectorAll('input, textarea')) {
      const type = typeOf(el);
      if (type === 'hidden' || el.getAttribute('aria-hidden') === 'true' || (type !== 'file' && !visible(el))) continue;
      add(el, { type, label, required, options: type === 'combobox' ? [] : undefined, accept: type === 'file' ? el.accept : undefined });
    }
  }

  // Privacy-policy consent (the Apply button stays disabled until it is ticked).
  for (const box of root.querySelectorAll('input[type="checkbox"]')) {
    if (box.closest('[data-field-id]') || box.closest('#application-form')) continue;
    const cell = box.closest('.MuiListItem-root') || box.parentElement;
    const statement = text(cell);
    const id = add(box, { type: 'checkbox', label: statement, required: true, options: [statement] });
    box.setAttribute('data-aa-option', `${id}:0`);
  }
  return fields;
}
/* eslint-enable no-undef */

async function scan(page) {
  const fields = await page.evaluate(scanInPage);
  for (const field of fields) {
    // The dial code list has every country: leave it to search-as-you-type.
    if (field.type === 'combobox' && !field.done && field.label !== 'Country dial code') {
      field.options = await generic.helpers.readComboboxOptions(page, field);
    }
  }
  return fields;
}

async function fill(page, field, value, cursor) {
  if (value == null || value === '') return;
  if (field.type === 'combobox') {
    return generic.helpers.pickSuggestion(page, page.locator(`[data-aa-field="${field.id}"]`), String(value), cursor, { listed: field.options.length > 0 });
  }
  if (field.type === 'radio' || field.type === 'checkbox') {
    // MUI hides the input under its icon: click the wrapping label; skip ticked ones.
    for (const v of [].concat(value)) {
      const index = field.options.indexOf(v);
      if (index < 0) continue;
      const option = page.locator(`[data-aa-option="${field.id}:${index}"]`);
      if (await option.isChecked()) continue;
      const label = option.locator('xpath=ancestor::label[1]');
      await cursor.click((await label.count()) ? label : option);
    }
    return;
  }
  return generic.fill(page, field, value, cursor);
}

/**
 * The résumé uploads as soon as it is attached (upload request + S3 POST)
 * and the form is locked ("Uploading and processing...") until that is done,
 * so files go first and text fields are set afterwards.
 * Returns the ids handled here (files + text batch).
 */
async function fillTextBatch(page, items) {
  const files = items.filter(({ field }) => field.type === 'file');
  for (const { field, value } of files) {
    await page.locator(`[data-aa-field="${field.id}"]`).setInputFiles(value);
    const busy = page.getByText(/uploading and processing/i);
    await busy.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    await busy.first().waitFor({ state: 'hidden', timeout: 30000 }).catch(() => {});
  }
  return [...files.map(({ field }) => field.id), ...(await generic.fillTextBatch(page, items))];
}

module.exports = {
  ...generic,
  id: 'deel',
  matches: url => /^jobs\.deel\.com$/i.test(url.hostname),
  extractJob,
  openApplication,
  scan,
  fill,
  fillTextBatch,
  nextStep: async () => false, // single-page form
  findSubmit: page => generic.helpers.firstVisible(page.locator('button').filter({ hasText: /^\s*apply\s*$/i })),
};
