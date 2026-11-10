// Dover inbound applications (app.dover.com/apply/<company>/<job-id>).
// JD (with pay) is in JSON-LD; the form sits beside it on the same page,
// one step, a MUI <form>. Each question is a div whose first child is a
// plain div with the question text ("Email *", "*" = required) and whose
// second child holds the control; the inputs have no <label>. Widgets:
//   text        MUI TextField (name=firstName|lastName|email|linkedinUrl|phoneNumber)
//   résumé      hidden input[type=file] in a dropzone (uploaded with the submit)
//   yes/no      MUI radiogroup, name = question uuid, value = option text
// The "Autofill from resume" dropzone at the top of the form is skipped.
// Cloudflare Turnstile runs invisibly (1x1 iframe in a closed shadow root).
// Sample: samples/dover-conveyor
const generic = require('./generic');

const FORM = 'form:has(input[name="firstName"])';

/** Remote jobs have no jobLocation, only applicantLocationRequirements; pay is in baseSalary. */
async function extractJob(page) {
  const job = await generic.extractJob(page);
  const extra = await page.evaluate(() => {
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      let d;
      try { d = JSON.parse(s.textContent); } catch (_) { continue; }
      if (!d || d['@type'] !== 'JobPosting') continue;
      const places = [].concat(d.applicantLocationRequirements || []).map(p => p && p.name).filter(Boolean).join(', ');
      const v = d.baseSalary && d.baseSalary.value;
      const money = n => `$${Number(n).toLocaleString('en-US')}`;
      const pay = v && v.minValue ? `${money(v.minValue)}${v.maxValue ? ` - ${money(v.maxValue)}` : ''} per ${String(v.unitText || 'year').toLowerCase()}` : '';
      return { places, pay };
    }
    return null;
  });
  if (extra && !job.location && extra.places) job.location = job.remote ? `Remote (${extra.places})` : extra.places;
  if (extra && extra.pay && !job.description.includes(extra.pay.split(' per ')[0])) job.description = `${job.description.trim()}\n\nCompensation: ${extra.pay}`;
  return { ...job, source: `dover/${job.source}` };
}

async function openApplication(page) {
  await page.locator(FORM).first().waitFor({ timeout: 20000 });
  return page;
}

/* eslint-disable no-undef -- body runs in the browser */
function scanInPage(formSelector) {
  const form = document.querySelector(formSelector);
  if (!form) return [];
  const text = el => (el ? el.innerText || el.textContent || '' : '').replace(/[\s​]+/g, ' ').trim();
  const CONTROLS = 'input:not([type="hidden"]), textarea, select, [role="combobox"]';
  // The question is the nearest earlier sibling (of the control or an ancestor) holding text and no control.
  const questionOf = el => {
    for (let a = el; a && a !== form; a = a.parentElement) {
      const prev = a.previousElementSibling;
      if (prev && !prev.querySelector(CONTROLS) && text(prev)) return text(prev);
    }
    return '';
  };
  const fields = [];
  let n = 0;
  const add = (el, label, field) => {
    const id = `f${n++}`;
    el.setAttribute('data-aa-field', id);
    fields.push({ id, name: el.getAttribute('name') || '', done: el.hasAttribute('data-aa-done'), label: label.replace(/\s*\*$/, ''), required: /\*$/.test(label), ...field });
    return id;
  };
  const groups = new Set();
  for (const el of form.querySelectorAll(CONTROLS)) {
    if (/autofill from resume/i.test(text(el.closest('[role="button"]')))) continue;
    const type = el.tagName === 'TEXTAREA' ? 'textarea' : el.tagName === 'SELECT' ? 'select'
      : el.getAttribute('role') === 'combobox' ? 'combobox' : (el.getAttribute('type') || 'text').toLowerCase();
    const label = questionOf(el);
    if (type === 'radio' || type === 'checkbox') {
      const group = el.closest('[role="radiogroup"], [role="group"], .MuiFormGroup-root') || el.parentElement;
      if (groups.has(group)) continue;
      groups.add(group);
      const choices = [...group.querySelectorAll(`input[type="${type}"]`)];
      const optionText = c => text(c.closest('label')) || c.value;
      const lone = choices.length === 1 && type === 'checkbox';
      const id = add(choices[0], label || optionText(choices[0]), { type, options: lone ? [optionText(choices[0]) || label] : choices.map(optionText) });
      choices.forEach((c, i) => c.setAttribute('data-aa-option', `${id}:${i}`));
      if (choices.some(c => c.required)) fields[fields.length - 1].required = true;
      continue;
    }
    add(el, label, {
      type,
      options: type === 'select' ? [...el.options].filter(o => o.value !== '').map(text) : type === 'combobox' ? [] : undefined,
      accept: type === 'file' ? el.getAttribute('accept') || '' : undefined,
    });
    if (el.required) fields[fields.length - 1].required = true;
  }
  return fields;
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
  if (field.type === 'combobox' && value) {
    return generic.helpers.pickSuggestion(page, page.locator(`[data-aa-field="${field.id}"]`), String(value), cursor, { listed: field.options.length > 0 });
  }
  if (field.type === 'radio' || field.type === 'checkbox') {
    // MUI hides the input under a styled span; the surrounding <label> takes the click.
    for (const v of [].concat(value)) {
      const index = field.options.indexOf(v);
      if (index < 0) continue;
      const option = page.locator(`[data-aa-option="${field.id}:${index}"]`);
      if (!(await option.isChecked())) await cursor.click(option.locator('xpath=ancestor::label[1]'));
    }
    return;
  }
  return generic.fill(page, field, value, cursor);
}

module.exports = {
  ...generic,
  id: 'dover',
  matches: url => /(^|\.)dover\.com$/i.test(url.hostname) && /^\/apply\//.test(url.pathname),
  extractJob,
  openApplication,
  scan,
  fill,
  nextStep: async () => false, // single-page form
  findSubmit: page => generic.helpers.firstVisible(page.locator(`${FORM} button[type="submit"]`)),
};
