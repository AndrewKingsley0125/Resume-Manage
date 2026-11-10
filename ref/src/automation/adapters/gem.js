// Gem job boards (jobs.gem.com/<board>/<job-id>).
// A React app: the job, then the form, are loaded through POSTs to
// /api/public/graphql/batch (queries). JD is in JSON-LD; the form is below it
// on the same page, one step. Class names carry build hashes ("flex-30",
// "bodyImportant-52"), so only their prefixes are used. Each question is a
// `bodyImportant*` span/div (the question; `requiredAsterisk*` child when
// required) followed by its control; nothing uses <label for> except radios:
//   text        input[type=text] (email/phone/location too; location is free text)
//   file        hidden input[type=file] in a dropzone (Resume, Cover letter)
//   radio       input.radioInput* + label[for] per option
//   textarea    salary and other free-text questions
//   dropdown    EEO Gender/Race: button "Please select" opening li[role=menuitem]
// Two submit buttons: "Apply and save" (saves a Gem profile) and
// "Apply without saving"; the latter is used.
// Sample: samples/gem-felix
const generic = require('./generic');

const ROOT = 'div[class^="formLayout"]:has([class^="primaryApplicationContainer"])';
const MENU_ITEM = '[role="menuitem"]';

async function extractJob(page) {
  await page.locator('script[type="application/ld+json"]').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
  const job = await generic.extractJob(page);
  return { ...job, source: `gem/${job.source}` };
}

async function openApplication(page) {
  await page.locator(ROOT).first().waitFor({ timeout: 20000 });
  return page;
}

/* eslint-disable no-undef -- body runs in the browser */
function scanInPage(rootSelector) {
  const root = document.querySelector(rootSelector);
  if (!root) return [];
  const text = el => (el ? el.innerText || el.textContent || '' : '').replace(/\s+/g, ' ').trim();
  const CONTROLS = 'input:not([type="hidden"]), textarea, select, button';
  // Ids are handed out afresh on every scan; drop the previous pass's tags (data-aa-done stays).
  root.querySelectorAll('[data-aa-field], [data-aa-option]').forEach(e => { e.removeAttribute('data-aa-field'); e.removeAttribute('data-aa-option'); });
  const fields = [];
  let n = 0;
  for (const head of root.querySelectorAll('[class^="bodyImportant"]')) {
    // Smallest ancestor that also holds a control is the question's block.
    let block = head.parentElement;
    while (block && block !== root && !block.querySelector(CONTROLS)) block = block.parentElement;
    if (!block || block === root) continue;
    const label = text(head).replace(/\s*\*$/, '');
    const required = !!head.querySelector('[class^="requiredAsterisk"]');
    const id = `f${n++}`;
    const base = { id, label, required, name: '' };

    const choices = [...block.querySelectorAll('input[type="radio"], input[type="checkbox"]')];
    if (choices.length) {
      const type = choices[0].type;
      const optionText = c => text(document.querySelector(`label[for="${CSS.escape(c.id)}"]`)) || text(c.parentElement) || c.value;
      choices[0].setAttribute('data-aa-field', id);
      choices.forEach((c, i) => c.setAttribute('data-aa-option', `${id}:${i}`));
      const options = choices.length === 1 && type === 'checkbox' ? [optionText(choices[0]) || label] : choices.map(optionText);
      fields.push({ ...base, type, done: choices[0].hasAttribute('data-aa-done'), options });
      continue;
    }
    // After an upload the dropzone also shows a remove button, so the file input is looked for first.
    const el = ['input[type="file"]', 'textarea', 'select', 'input:not([type="hidden"])', 'button[type="button"]'].map(s => block.querySelector(s)).find(Boolean);
    if (!el) { n--; continue; }
    const type = el.tagName === 'BUTTON' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : el.tagName === 'SELECT' ? 'select'
      : (el.getAttribute('type') || 'text').toLowerCase();
    el.setAttribute('data-aa-field', id);
    fields.push({
      ...base, type, done: el.hasAttribute('data-aa-done'),
      dropdown: el.tagName === 'BUTTON' || undefined,
      options: el.tagName === 'SELECT' ? [...el.options].filter(o => o.value !== '').map(text) : type === 'select' ? [] : undefined,
      accept: type === 'file' ? el.getAttribute('accept') || '' : undefined,
    });
  }
  return fields;
}
/* eslint-enable no-undef */

/** The dropdown menu only exists while open. */
async function openMenu(page, button, cursor) {
  await page.keyboard.press('Escape').catch(() => {});
  if (cursor) await cursor.click(button);
  else { await button.scrollIntoViewIfNeeded(); await button.click(); }
  const items = page.locator(`${MENU_ITEM}:visible`);
  await items.first().waitFor({ timeout: 3000 });
  return items;
}

async function scan(page) {
  const fields = await page.evaluate(scanInPage, ROOT);
  for (const field of fields) {
    if (!field.dropdown || field.done) continue;
    try {
      const items = await openMenu(page, page.locator(`[data-aa-field="${field.id}"]`));
      field.options = (await items.allInnerTexts()).map(t => t.trim()).filter(Boolean);
    } catch (_) {
      field.options = [];
    } finally {
      await page.keyboard.press('Escape').catch(() => {});
      await page.locator(`${MENU_ITEM}:visible`).first().waitFor({ state: 'hidden', timeout: 1500 }).catch(() => page.mouse.click(2, 2));
    }
  }
  return fields;
}

async function fill(page, field, value, cursor) {
  if (field.dropdown && value) {
    const items = await openMenu(page, page.locator(`[data-aa-field="${field.id}"]`), cursor);
    const texts = (await items.allInnerTexts()).map(t => t.trim());
    const index = texts.indexOf(String(value));
    if (index < 0) {
      await page.keyboard.press('Escape');
      throw new Error(`No option matching "${value}"`);
    }
    return cursor.click(items.nth(index));
  }
  return generic.fill(page, field, value, cursor);
}

module.exports = {
  ...generic,
  id: 'gem',
  matches: url => /^jobs\.gem\.com$/i.test(url.hostname),
  extractJob,
  openApplication,
  scan,
  fill,
  nextStep: async () => false, // single-page form
  findSubmit: page => generic.helpers.firstVisible(page.locator('button[type="submit"]').filter({ hasText: /^\s*apply without saving\s*$/i })),
};
