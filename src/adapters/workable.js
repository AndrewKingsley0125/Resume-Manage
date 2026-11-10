// Workable job boards (apply.workable.com/<account>/j/<shortcode>[/apply]).
// React app with two tabs on the same page: OVERVIEW (JD) and APPLICATION
// (<job>/apply/, form[data-ui="application-form"], one page). The /apply view
// has neither the JD nor JSON-LD, so the JD comes from Workable's own
// same-origin API: /api/v2/accounts/<account>/jobs/<shortcode> (description,
// requirements, benefits HTML; location, workplace, salary_from/to) and the
// company name from /api/v1/accounts/<account>.
// Every control is labelled through aria-labelledby (an id ending in _label;
// generated ids change on every render), required ones carry aria-required
// and a separate "*" span. Widgets:
//   yes/no + single choice  fieldset[role=radiogroup] of div[role=radio][data-ui=option]
//                           (aria-checked; the inner radio input is not checked)
//   multiple choice         fieldset of div[role=checkbox] (same pattern)
//   phone                   input[name=phone] + country picker button ("+1"), left as is
//   address                 plain text, prefilled from geo-IP; hidden aria-hidden
//                           city/postcode/country inputs are skipped
//   résumé                  file input; attaching uploads it at once (GET a signed
//                           URL from /form/upload/resume, then POST to S3)
// A cookie banner with a backdrop covers the form; "Decline all" closes it.
// Submit: button[data-ui="apply-button"] ("Submit application").
// Sample: samples/workable-valis
const generic = require('./generic');

const FORM = 'form[data-ui="application-form"]';

/* eslint-disable no-undef -- body runs in the browser */
async function jobInPage() {
  const m = /^\/([^/]+)\/j\/([^/]+)/.exec(location.pathname);
  if (!m) return null;
  const get = url => fetch(url, { credentials: 'include' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const [job, account] = await Promise.all([
    get(`/api/v2/accounts/${m[1]}/jobs/${m[2]}`),
    get(`/api/v1/accounts/${m[1]}`),
  ]);
  if (!job) return null;
  // innerText needs layout for line breaks.
  const div = document.createElement('div');
  div.style.cssText = 'position:absolute;left:-10000px;top:0;width:800px';
  div.innerHTML = [
    job.description,
    job.requirements && `<h3>Requirements</h3>${job.requirements}`,
    job.benefits && `<h3>Benefits</h3>${job.benefits}`,
  ].filter(Boolean).join('\n');
  document.body.append(div);
  let description = div.innerText.replace(/\n{3,}/g, '\n\n').trim();
  div.remove();
  if (job.salary_from || job.salary_to) {
    const money = n => (n ? Number(n).toLocaleString('en-US') : '?');
    const pay = `${money(job.salary_from)} - ${money(job.salary_to)} ${job.salary_currency_iso_code || ''} per ${job.salary_frequency || 'year'}`;
    description += `\n\nSalary: ${pay.replace(/\s+/g, ' ')}`;
  }
  const places = (job.locations && job.locations.length ? job.locations : [job.location]).filter(Boolean)
    .map(l => [l.city, l.region, l.country].filter(Boolean).join(', '));
  const remote = job.workplace === 'remote' || !!job.remote;
  const where = places.join(' / ');
  return {
    title: job.title || '',
    company: (account && account.name) || '',
    location: job.workplace && job.workplace !== 'on_site' ? `${where} (${job.workplace.replace('_', '-')})` : where,
    remote: remote || null,
    description,
    source: 'workable',
  };
}
/* eslint-enable no-undef */

async function extractJob(page) {
  const job = await page.evaluate(jobInPage).catch(() => null);
  return job && job.description ? job : generic.extractJob(page);
}

/** The cookie banner's backdrop sits over the form and catches clicks. */
async function closeCookieBanner(page, cursor) {
  const decline = page.locator('[data-ui="cookie-consent-decline"]');
  if (await decline.isVisible().catch(() => false)) await cursor.click(decline);
}

async function openApplication(page, cursor) {
  await closeCookieBanner(page, cursor);
  if (!(await page.locator(FORM).count())) {
    const tab = await generic.helpers.firstVisible(page.locator('[data-ui="application-form-tab"], a[data-ui="apply-button"]'));
    if (tab) await cursor.click(tab);
    else await page.goto(`${page.url().split(/[?#]/)[0].replace(/\/$/, '')}/apply/`, { waitUntil: 'domcontentloaded' });
  }
  await page.locator(FORM).waitFor({ timeout: 20000 });
  await closeCookieBanner(page, cursor);
  return page;
}

/* eslint-disable no-undef -- body runs in the browser */
function scanInPage(formSelector) {
  const form = document.querySelector(formSelector);
  if (!form) return [];
  const text = el => (el ? el.innerText || el.textContent || '' : '').replace(/\s+/g, ' ').trim();
  const visible = el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  // aria-labelledby may list the question label and the option/description; the first one is the question.
  const labelOf = el => {
    const first = (el.getAttribute('aria-labelledby') || '').split(/\s+/)[0];
    const t = first && text(document.getElementById(first));
    if (t) return t.replace(/\s*\(optional\)\s*$/i, '').replace(/^\*\s*/, '');
    const l = el.closest('label');
    return l ? text(l).replace(/^\*\s*/, '') : el.getAttribute('placeholder') || el.name || '';
  };
  const fields = [];
  let n = 0;
  const add = (el, field) => {
    const id = `f${n++}`;
    el.setAttribute('data-aa-field', id);
    fields.push({ id, name: '', done: el.hasAttribute('data-aa-done'), ...field });
    return id;
  };

  // Choice groups: custom div[role=radio|checkbox] options inside a fieldset.
  const groups = [...form.querySelectorAll('fieldset')].filter(fs => fs.querySelector('[role="radio"], [role="checkbox"]') && visible(fs));
  for (const fs of groups) {
    const options = [...fs.querySelectorAll('[role="radio"], [role="checkbox"]')];
    const type = options[0].getAttribute('role');
    const input = fs.querySelector('input');
    const required = options.some(o => o.getAttribute('aria-required') === 'true') || !!(input && input.required);
    const label = labelOf(fs);
    const id = add(fs, {
      type, label, required,
      name: fs.getAttribute('data-ui') || (input && input.name) || '',
      // A lone checkbox ("I agree ...") is labelled by its own text.
      options: options.map(o => text(o)).map((t, i, all) => (all.length === 1 && !t ? label : t)),
    });
    options.forEach((o, i) => o.setAttribute('data-aa-option', `${id}:${i}`));
  }

  for (const el of form.querySelectorAll('input, textarea, select, [role="combobox"]:not(input)')) {
    if (groups.some(fs => fs.contains(el))) continue;
    const tag = el.tagName.toLowerCase();
    let type = tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : (el.getAttribute('type') || 'text').toLowerCase();
    if (['hidden', 'submit', 'button', 'search'].includes(type)) continue;
    if (el.getAttribute('aria-hidden') === 'true') continue; // address parts (city/postcode/country)
    if (type !== 'file' && !visible(el)) continue;
    if (el.closest('[role="listbox"], [role="dialog"]')) continue; // phone country search
    const isCombo = tag !== 'select' && (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox' || el.hasAttribute('aria-autocomplete'));
    if (isCombo) type = 'combobox';
    const label = labelOf(el);
    const required = el.required || el.getAttribute('aria-required') === 'true';
    if (type === 'checkbox' || type === 'radio') {
      // A plain consent checkbox; click its label (the input is often hidden).
      const target = visible(el) ? el : el.closest('label') || el;
      const id = add(el, { type, label: label || text(target), required, name: el.name || '', options: [text(target) || label] });
      target.setAttribute('data-aa-option', `${id}:0`);
      continue;
    }
    add(el, {
      type, label, required,
      name: el.getAttribute('name') || el.getAttribute('data-ui') || '',
      options: type === 'select' ? [...el.options].filter(o => o.value !== '').map(o => text(o)) : type === 'combobox' ? [] : undefined,
      accept: type === 'file' ? el.getAttribute('accept') || '' : undefined,
    });
  }
  // Keep page order (groups were collected first).
  const order = [...form.querySelectorAll('[data-aa-field]')].map(e => e.getAttribute('data-aa-field'));
  return fields.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}
/* eslint-enable no-undef */

async function scan(page) {
  const fields = await page.evaluate(scanInPage, FORM);
  for (const field of fields) {
    if (field.type === 'combobox' && !field.done) field.options = await generic.helpers.readComboboxOptions(page, field);
  }
  return fields;
}

async function fill(page, field, value, cursor) {
  if (field.type !== 'combobox' || !value) return generic.fill(page, field, value, cursor);
  const el = page.locator(`[data-aa-field="${field.id}"]`);
  return generic.helpers.pickSuggestion(page, el, String(value), cursor, { listed: field.options.length > 0 });
}

/**
 * Attaching a file uploads it right away; wait for the upload so the form
 * holds the stored file before moving on. Returns the ids handled here.
 */
async function fillTextBatch(page, items) {
  const files = items.filter(({ field }) => field.type === 'file');
  for (const { field, value } of files) {
    const isUpload = q => /amazonaws\.com/.test(q.url()) && q.method() === 'POST';
    const uploaded = Promise.race(['requestfinished', 'requestfailed']
      .map(event => page.waitForEvent(event, { predicate: isUpload, timeout: 20000 }))).catch(() => null);
    await page.locator(`[data-aa-field="${field.id}"]`).setInputFiles(value);
    await uploaded;
  }
  return [...files.map(({ field }) => field.id), ...(await generic.fillTextBatch(page, items))];
}

module.exports = {
  ...generic,
  id: 'workable',
  matches: url => /^apply\.workable\.com$/i.test(url.hostname),
  extractJob,
  openApplication,
  scan,
  fill,
  fillTextBatch,
  nextStep: async () => false, // single-page form
  findSubmit: page => generic.helpers.firstVisible(page.locator(`${FORM} button[data-ui="apply-button"], ${FORM} button[type="submit"]`)),
};
