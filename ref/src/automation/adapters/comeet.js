// Comeet / Spark Hire Recruit (www.comeet.com/jobs/<company>/<uid>/<slug>/<pos-uid>).
// JD page is AngularJS; the job is in the inline `POSITION_DATA` global
// (name, companyName, location {name, isRemote}, workplaceType, and the JD
// as HTML sections in customFields.details [{name, value}]).
// "Apply for this job" (#showApplyForm) injects an iframe
// www.comeet.co/jobs/<company-uid>/<pos-uid>/apply?token=...; the form works
// as a top-level page, so openApplication navigates the tab to that URL
// (the cursor needs a Page, not a Frame). One page, form#applyForm:
//   built-in fields  .form-group.field-<name> with label.control-label
//                    (span.required-asterisk when required); files are
//                    input[type=file] (cv, coverLetter, portfolio)
//   questionnaires   li.question: legend.question-title (+ asterisk);
//                    TEXT input / TEXT_AREA / RADIO_LIST radios /
//                    MULTI_SELECT checkboxes (label.checkboxLabel > .option-title) /
//                    DROPDOWN = bootstrap dropdown (a.dropdown-toggle + ul.dropdown-menu a)
// The "Apply with LinkedIn" widget above the form is ignored.
// Submit: button.applyButton ("Submit application"); invisible reCAPTCHA v3.
// Sample: samples/comeet-cellebrite
const generic = require('./generic');

async function extractJob(page) {
  const job = await page.evaluate(() => {
    const pos = window.POSITION_DATA;
    if (!pos || !pos.customFields) return null;
    const sections = (pos.customFields.details || []).filter(d => d.value);
    const div = document.createElement('div');
    div.innerHTML = sections.map(d => (sections.length > 1 ? `<h3>${d.name}</h3>` : '') + d.value).join('\n');
    document.body.append(div); // innerText needs layout for line breaks
    const description = div.innerText.replace(/ /g, ' ').replace(/\n[ \t]+\n/g, '\n\n').replace(/\n{3,}/g, '\n\n').trim();
    div.remove();
    const loc = pos.location || {};
    return {
      title: pos.name || '',
      company: pos.companyName || (window.COMPANY_DATA && window.COMPANY_DATA.name) || '',
      location: loc.name || [loc.city, loc.state, loc.country].filter(Boolean).join(', '),
      remote: pos.workplaceType ? /remote/i.test(pos.workplaceType) : (loc.isRemote ?? null),
      description,
      source: 'comeet',
    };
  });
  return job && job.description ? job : generic.extractJob(page);
}

async function openApplication(page, cursor) {
  if (!/\/apply$/.test(new URL(page.url()).pathname)) {
    let frame = page.locator('iframe[src*="/apply?"]');
    if (!(await frame.count())) {
      const button = await generic.helpers.firstVisible(page.locator('#showApplyForm'));
      if (!button) throw new Error('Could not find the Apply for this job button');
      await cursor.click(button);
      frame = page.locator('iframe[src*="/apply?"]');
      await frame.first().waitFor({ state: 'attached', timeout: 15000 });
    }
    await page.goto(await frame.first().getAttribute('src'), { waitUntil: 'domcontentloaded' });
  }
  await page.locator('#applyForm input').first().waitFor({ state: 'visible', timeout: 20000 });
  // Questionnaires (custom questions) load in a second request.
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  return page;
}

/* eslint-disable no-undef -- body runs in the browser */
function scanInPage() {
  const text = el => (el ? el.innerText || el.textContent || '' : '').replace(/\s+/g, ' ').trim();
  const visible = el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  const form = document.getElementById('applyForm');
  if (!form) return [];
  const fields = [];
  let n = 0;
  const add = (el, field) => {
    const id = `f${n++}`;
    el.setAttribute('data-aa-field', id);
    fields.push({ id, name: el.getAttribute('name') || '', done: el.hasAttribute('data-aa-done'), ...field });
    return id;
  };
  const controlType = el => (el.tagName === 'TEXTAREA' ? 'textarea' : el.tagName === 'SELECT' ? 'select' : (el.getAttribute('type') || 'text').toLowerCase());

  // Built-in fields: one label + one control per .form-group.
  for (const group of form.querySelectorAll('.form-group')) {
    if (group.closest('.form-group-questionnaires') || group.classList.contains('form-group-questionnaires') || !visible(group)) continue;
    const head = group.querySelector('label.control-label');
    const el = group.querySelector('input:not([type="hidden"]), textarea, select');
    if (!head || !el) continue;
    const type = controlType(el);
    if (type !== 'file' && !visible(el)) continue;
    add(el, {
      type,
      label: text(head).replace(/\s*\*$/, ''),
      required: !!head.querySelector('.required-asterisk') || el.required,
      options: type === 'select' ? [...el.options].filter(o => o.value).map(o => text(o)) : undefined,
      accept: type === 'file' ? el.getAttribute('accept') || '' : undefined,
    });
  }

  // Questionnaire questions.
  for (const q of form.querySelectorAll('li.question')) {
    if (!visible(q)) continue;
    const head = q.querySelector('.question-title');
    if (!head) continue;
    const title = head.cloneNode(true);
    title.querySelectorAll('.error').forEach(e => e.remove()); // "Required" tip after a failed submit
    const label = text(title).replace(/\s*\*$/, '');
    const required = !!head.querySelector('.required-asterisk');
    const choices = [...q.querySelectorAll('input[type="radio"], input[type="checkbox"]')];
    if (choices.length) {
      const id = add(choices[0], {
        type: choices[0].type, label, required,
        options: choices.map(c => text(q.querySelector(`label[for="${CSS.escape(c.id)}"] .option-title`)) || c.value),
      });
      choices.forEach((c, i) => c.setAttribute('data-aa-option', `${id}:${i}`));
      continue;
    }
    const toggle = q.querySelector('a.dropdown-toggle');
    if (toggle) {
      const items = [...q.querySelectorAll('.dropdown-menu a')];
      const id = add(toggle, { type: 'select', label, required, options: items.map(a => text(a.querySelector('.option-title') || a)) });
      items.forEach((a, i) => a.setAttribute('data-aa-option', `${id}:${i}`));
      continue;
    }
    const el = q.querySelector('input:not([type="hidden"]), textarea');
    if (el && visible(el)) add(el, { type: controlType(el), label, required });
  }
  return fields;
}
/* eslint-enable no-undef */

const scan = page => page.evaluate(scanInPage);

async function fill(page, field, value, cursor) {
  const el = page.locator(`[data-aa-field="${field.id}"]`);
  if (field.type === 'select' && value && (await el.evaluate(e => e.tagName === 'A'))) {
    // Bootstrap dropdown: open it, click the option.
    const index = field.options.indexOf(String(value));
    if (index < 0) throw new Error(`No option matching "${value}"`);
    await cursor.click(el);
    return cursor.click(page.locator(`[data-aa-option="${field.id}:${index}"]`));
  }
  if (field.type === 'checkbox' || field.type === 'radio') {
    // Inputs are hidden behind a styled label; skip boxes already ticked.
    for (const v of [].concat(value || [])) {
      const index = field.options.indexOf(v);
      if (index < 0) continue;
      const option = page.locator(`[data-aa-option="${field.id}:${index}"]`);
      if (await option.isChecked()) continue;
      await cursor.click(page.locator(`label[for="${await option.getAttribute('id')}"]`).first());
    }
    return;
  }
  return generic.fill(page, field, value, cursor);
}

module.exports = {
  ...generic,
  id: 'comeet',
  matches: url => /(^|\.)comeet\.(com|co)$/i.test(url.hostname) && /\/jobs\//.test(url.pathname),
  extractJob,
  openApplication,
  scan,
  fill,
  nextStep: async () => false, // single-page form
  findSubmit: page => generic.helpers.firstVisible(page.locator('#applyForm button.applyButton')),
};
