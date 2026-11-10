// Lever job boards (jobs.lever.co/<company>/<posting-id>[/apply]).
// The JD is on the posting page; the form is on <posting>/apply (one page,
// form#application-form). Given the /apply URL, the posting page is fetched
// (same origin GET) for the JD. Posting page: .posting-headline h2 (title),
// .posting-categories (.location / .department / .commitment / .workplaceTypes),
// description in .section-wrapper .section blocks (pay: [data-qa="salary-range"]),
// company in the JSON-LD hiringOrganization / document title "<Company> - <Title>".
// Every question is an .application-question (li, or div in the EEO section):
//   label    .application-label (custom cards: .application-label .text),
//            "✱" (span.required) when required
//   controls inputs named name/email/phone/org/urls[...], custom questions
//            cards[<uuid>][fieldN], surveys surveysResponses[...], EEO selects eeo[...]
//   location "Current location" is a search box: suggestions are
//            .dropdown-location divs (GET /searchLocations), picking one sets
//            the hidden selectedLocation input
// The US EEO section (.eeo-section) is hidden until a "Which location are you
// applying for?" option is picked, so it shows up on the follow-up scan.
// Attaching the résumé POSTs /parseResume (Lever autofills from it), so files
// go first. The "Apply with LinkedIn" widget is skipped.
// hCaptcha (invisible) runs on submit (#btn-submit) and on focusing the location box.
// Sample: samples/lever-captivateiq
const generic = require('./generic');

const FORM = '#application-form';

/* eslint-disable no-undef -- body runs in the browser */
async function jobInPage() {
  const postingUrl = location.href.split(/[?#]/)[0].replace(/\/apply\/?$/, '');
  const html = /\/apply\/?$/.test(location.pathname)
    ? await (await fetch(postingUrl, { credentials: 'include' })).text()
    : document.documentElement.outerHTML;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const text = el => (el ? el.textContent : '').replace(/\s+/g, ' ').trim();
  let org = '';
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try { org = JSON.parse(s.textContent).hiringOrganization.name || org; } catch (_) { /* not a JobPosting */ }
  }
  const title = text(doc.querySelector('.posting-headline h2'));
  const company = org || (/ - /.test(doc.title) ? doc.title.split(' - ')[0].trim() : ''); // "<Company> - <Title>"
  const cat = sel => text(doc.querySelector(`.posting-categories ${sel}`)).replace(/\s*\/\s*$/, '');
  const where = cat('.location');
  const workplace = cat('.workplaceTypes');
  const sections = [...doc.querySelectorAll('.content-wrapper .section-wrapper .section')]
    .filter(s => !s.matches('.posting-header, .last-section-apply'));
  // innerText needs layout for line breaks.
  const div = document.createElement('div');
  div.style.cssText = 'position:absolute;left:-10000px;top:0;width:800px';
  div.innerHTML = sections.map(s => s.outerHTML).join('\n');
  document.body.append(div);
  const description = div.innerText.replace(/\n{3,}/g, '\n\n').trim();
  div.remove();
  return {
    title,
    company,
    location: workplace && !where.toLowerCase().includes(workplace.toLowerCase()) ? `${where} (${workplace})` : where,
    remote: /remote/i.test(`${where} ${workplace}`) || null,
    description,
    source: 'lever',
  };
}
/* eslint-enable no-undef */

async function extractJob(page) {
  const job = await page.evaluate(jobInPage).catch(() => null);
  return job && job.description ? job : generic.extractJob(page);
}

async function openApplication(page, cursor) {
  if (!(await page.locator(FORM).count())) {
    const button = await generic.helpers.firstVisible(page.locator('a.postings-btn[href$="/apply"]'));
    if (button) await cursor.click(button);
    else await page.goto(`${page.url().split(/[?#]/)[0].replace(/\/$/, '')}/apply`, { waitUntil: 'domcontentloaded' });
  }
  await page.locator(FORM).waitFor({ timeout: 20000 });
  return page;
}

/* eslint-disable no-undef -- body runs in the browser */
function scanInPage(formSelector) {
  const text = el => (el ? el.innerText || el.textContent || '' : '').replace(/\s+/g, ' ').trim();
  const visible = el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const entries = [...document.querySelectorAll(`${formSelector} .application-question`)]
    .filter((e, i, all) => visible(e) && !all.some(o => o !== e && o.contains(e)));

  const fields = [];
  let n = 0;
  for (const entry of entries) {
    const head = entry.querySelector('.application-label .text') || entry.querySelector('.application-label');
    const raw = text(head);
    const label = raw.replace(/\s*✱\s*$/, '').trim();
    const starred = /✱/.test(raw) || !!entry.querySelector('.application-label .required');
    const seen = new Set();
    for (const el of entry.querySelectorAll('input, select, textarea')) {
      const tag = el.tagName.toLowerCase();
      let type = tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : (el.getAttribute('type') || 'text').toLowerCase();
      if (['hidden', 'submit', 'button'].includes(type)) continue;
      if (type !== 'file' && type !== 'radio' && type !== 'checkbox' && !visible(el)) continue;
      if (el.name && seen.has(el.name)) continue;
      seen.add(el.name);
      if (el.name === 'location') type = 'combobox'; // location search box
      const id = `f${n++}`;
      el.setAttribute('data-aa-field', id);
      const field = {
        id, type, label, name: el.name || '', done: el.hasAttribute('data-aa-done'),
        required: starred || el.required,
      };
      if (type === 'radio' || type === 'checkbox') {
        const members = [...entry.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`)];
        members.forEach((m, i) => m.setAttribute('data-aa-option', `${id}:${i}`));
        const optionText = m => text(m.closest('label') && m.closest('label').querySelector('.application-answer-alternative')) || text(m.closest('label')) || m.value;
        // A lone checkbox ("I agree ...") is labelled by its own text.
        field.options = members.map(optionText);
        if (!label && members.length === 1) field.label = field.options[0];
      } else if (type === 'select') {
        field.options = [...el.options].filter(o => o.value !== '').map(o => text(o));
      } else if (type === 'combobox') {
        field.options = [];
      } else if (type === 'file') {
        field.accept = el.getAttribute('accept') || '';
      }
      fields.push(field);
    }
  }
  return fields;
}
/* eslint-enable no-undef */

const scan = page => page.evaluate(scanInPage, FORM);

/** "Current location": type, then click the closest .dropdown-location suggestion. */
async function fillLocation(page, el, value, cursor) {
  const { matchOption } = require('../../answers/answer-engine');
  const options = page.locator('.dropdown-results .dropdown-location');
  for (const query of [...new Set([value, value.split(',')[0].trim()])]) {
    await cursor.type(el, query);
    try { await options.first().waitFor({ state: 'visible', timeout: 5000 }); } catch (_) { continue; }
    const texts = (await options.allInnerTexts()).map(t => t.trim());
    const best = matchOption(texts, value) || matchOption(texts, query) || texts[0];
    return cursor.click(options.nth(texts.indexOf(best)));
  }
  // No suggestion: leave the typed text, Lever accepts free-text locations.
  await page.keyboard.press('Escape').catch(() => {});
}

async function fill(page, field, value, cursor) {
  if (field.type === 'combobox' && value) return fillLocation(page, page.locator(`[data-aa-field="${field.id}"]`), String(value), cursor);
  return generic.fill(page, field, value, cursor);
}

/**
 * Attaching a résumé makes Lever parse it and autofill fields, which could
 * overwrite answers set earlier. So files go first; text fields are set once
 * the parse is done. Returns the ids handled here (files + text batch).
 */
async function fillTextBatch(page, items) {
  const files = items.filter(({ field }) => field.type === 'file');
  for (const { field, value } of files) {
    const parsed = field.name === 'resume'
      ? page.waitForResponse(r => /\/parseResume\b/.test(r.url()), { timeout: 20000 }).catch(() => null)
      : null;
    await page.locator(`[data-aa-field="${field.id}"]`).setInputFiles(value);
    if (parsed && (await parsed)) await page.waitForTimeout(1000); // let the parsed values render
  }
  return [...files.map(({ field }) => field.id), ...(await generic.fillTextBatch(page, items))];
}

module.exports = {
  ...generic,
  id: 'lever',
  matches: url => /(^|\.)lever\.co$/i.test(url.hostname),
  extractJob,
  openApplication,
  scan,
  fill,
  fillTextBatch,
  nextStep: async () => false, // single-page form
  findSubmit: page => generic.helpers.firstVisible(page.locator('#btn-submit')),
};
