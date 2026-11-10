// Fallback adapter for any site. Site-specific adapters reuse these
// functions and override only what differs (see index.js for the contract).
const { scanFields, markFilled } = require('../form-scanner');

const APPLY_TEXT = /^\s*(apply|apply now|apply for this (job|position|role)|start application|easy apply)\s*$/i;
const NEXT_TEXT = /^\s*(next|continue|save (and|&) continue|review)\s*$/i;
const SUBMIT_TEXT = /^\s*(submit|submit application|send application|apply|finish)\s*$/i;

/** Job data from schema.org JobPosting JSON-LD, which most job pages embed for search engines. */
async function fromJsonLd(page) {
  const blocks = await page.locator('script[type="application/ld+json"]').allTextContents();
  for (const raw of blocks) {
    let data;
    try { data = JSON.parse(raw); } catch (_) { continue; }
    const items = [data, ...(Array.isArray(data) ? data : []), ...(data['@graph'] || [])];
    const job = items.find(x => x && x['@type'] === 'JobPosting');
    if (!job) continue;
    const description = await page.evaluate(html => {
      const div = document.createElement('div');
      div.innerHTML = html;
      document.body.append(div); // innerText needs layout for line breaks
      const text = div.innerText;
      div.remove();
      return text;
    }, String(job.description || ''));
    const place = [].concat(job.jobLocation || [])[0];
    const address = place && place.address;
    return {
      title: job.title || '',
      company: (job.hiringOrganization && job.hiringOrganization.name) || '',
      location: address ? [address.addressLocality, address.addressRegion, address.addressCountry].filter(Boolean).join(', ') : '',
      remote: job.jobLocationType === 'TELECOMMUTE',
      description,
      source: 'json-ld',
    };
  }
  return null;
}

/** Largest text block among common description containers. */
async function fromDom(page) {
  return page.evaluate(() => {
    const candidates = document.querySelectorAll('[class*="description" i], [id*="description" i], [class*="job-details" i], article, main');
    let best = null;
    for (const el of candidates) if (!best || el.innerText.length > best.innerText.length) best = el;
    const h1 = document.querySelector('h1');
    return {
      title: h1 ? h1.innerText.trim() : document.title,
      company: '',
      location: '',
      remote: null,
      description: best ? best.innerText.trim() : document.body.innerText.trim(),
      source: 'dom',
    };
  });
}

async function extractJob(page) {
  return (await fromJsonLd(page)) || fromDom(page);
}

async function firstVisible(locator) {
  const count = await locator.count();
  for (let i = 0; i < count; i++) if (await locator.nth(i).isVisible()) return locator.nth(i);
  return null;
}

const buttonByText = (page, re) => page.locator('button, a, input[type="submit"], [role="button"]').filter({ hasText: re });

/** Get to the application form. Returns the page that holds it (may be a popup). */
async function openApplication(page, cursor) {
  if (await page.locator('input[type="file"]').count()) return page; // form is already on the page
  const button = await firstVisible(buttonByText(page, APPLY_TEXT));
  if (!button) throw new Error('Could not find an Apply button');
  // The form may open in a popup, replace this page, or appear in place.
  const before = page.url();
  const popup = page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null);
  const navigated = page.waitForURL(u => u.href !== before, { timeout: 5000 }).then(() => page, () => null);
  await cursor.click(button);
  const target = (await Promise.race([popup, navigated])) || page;
  await target.waitForLoadState('domcontentloaded');
  return target;
}

/** Listbox options of a combobox; custom dropdowns only render them while open. */
function optionLocator(page, listId) {
  return listId ? page.locator(`[id="${listId}"] [role="option"]`) : page.locator('[role="listbox"] [role="option"]');
}

/**
 * Make sure an open dropdown list is gone before touching the next control:
 * a list left open (or still closing) covers the fields below it and its
 * options get mistaken for the next dropdown's. Escape does not close every
 * widget, so a click on an empty spot of the page follows.
 */
async function closeList(page) {
  const open = page.locator('[role="listbox"]:visible');
  await page.keyboard.press('Escape').catch(() => {});
  if (!(await open.count())) return;
  await open.first().waitFor({ state: 'hidden', timeout: 800 }).catch(() => {});
  if (await open.count()) {
    await page.mouse.click(2, 2).catch(() => {});
    await open.first().waitFor({ state: 'hidden', timeout: 1500 }).catch(() => {});
  }
}

async function readComboboxOptions(page, field) {
  const input = page.locator(`[data-aa-field="${field.id}"]`);
  try {
    await input.scrollIntoViewIfNeeded();
    await input.click();
    const listId = (await input.getAttribute('aria-controls')) || (await input.getAttribute('aria-owns'));
    const options = optionLocator(page, listId);
    await options.first().waitFor({ timeout: 1500 });
    return (await options.allInnerTexts()).map(t => t.trim()).filter(Boolean);
  } catch (_) {
    return []; // free-text or async (search-as-you-type) combobox
  } finally {
    await closeList(page);
  }
}

async function scan(page, rootSelector = 'body') {
  const fields = await scanFields(page, rootSelector);
  for (const field of fields) {
    if (field.type === 'combobox' && !field.done) field.options = await readComboboxOptions(page, field);
  }
  return fields;
}

async function fillCombobox(page, el, value, cursor) {
  await cursor.type(el, value);
  const listId = (await el.getAttribute('aria-controls')) || (await el.getAttribute('aria-owns'));
  const options = optionLocator(page, listId);
  await options.first().waitFor({ timeout: 3000 }).catch(() => {});
  const exact = options.filter({ hasText: new RegExp(`^\\s*${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) });
  if (await exact.count()) return cursor.click(exact.first());
  return page.keyboard.press('Enter');
}

/**
 * Type into a searchable dropdown and click the closest suggestion.
 * `listed`: the dropdown has a fixed option list, so only an option matching
 * `value` is accepted. Otherwise (location search) "Austin, TX" may find
 * nothing, so the city alone is tried next and the best suggestion is taken.
 */
async function pickSuggestion(page, el, value, cursor, { listed = false } = {}) {
  const { matchOption } = require('../../answers/answer-engine');
  // A dropdown that is not a text box (div role=combobox) can only be opened.
  const typable = await el.evaluate(e => e.tagName === 'INPUT');
  if (typable) await closeList(page);
  // It may not open on the first click while the previous dropdown is still closing.
  const queries = !typable ? ['', ''] : listed ? [value, ''] : [...new Set([value, value.split(',')[0].trim()])];
  for (const query of queries) {
    if (typable) await cursor.type(el, query);
    if (!query) {
      await closeList(page);
      await cursor.click(el);
    }
    // Some widgets set aria-controls only while open; read it now.
    const listId = (await el.getAttribute('aria-controls')) || (await el.getAttribute('aria-owns'));
    const options = optionLocator(page, listId);
    try { await options.first().waitFor({ timeout: 4000 }); } catch (_) { continue; }
    const texts = (await options.allInnerTexts()).map(t => t.trim());
    const best = matchOption(texts, value) || (listed ? null : matchOption(texts, query) || texts[0]);
    if (best) {
      await cursor.click(options.nth(texts.indexOf(best)));
      return options.first().waitFor({ state: 'detached', timeout: 1500 }).catch(() => closeList(page));
    }
  }
  await closeList(page);
  throw new Error(`No option matching "${value}"`);
}

async function fill(page, field, value, cursor) {
  if (value == null || value === '') return;
  const el = page.locator(`[data-aa-field="${field.id}"]`);
  switch (field.type) {
    case 'file':
      return el.setInputFiles(value);
    case 'select':
      await cursor.pointAt(el);
      return el.selectOption({ label: value });
    case 'radio':
    case 'checkbox': {
      const values = [].concat(value);
      for (const v of values) {
        const index = field.options.indexOf(v);
        if (index < 0) continue;
        const option = page.locator(`[data-aa-option="${field.id}:${index}"]`);
        // Inputs are often visually hidden behind a styled label.
        const label = page.locator(`label[for="${await option.getAttribute('id')}"]`);
        if ((await option.isVisible()) || !(await label.count())) await cursor.click(option);
        else await cursor.click(label.first());
      }
      return;
    }
    case 'combobox':
      return fillCombobox(page, el, value, cursor);
    default:
      return cursor.type(el, value);
  }
}

const BATCH_TYPES = new Set(['text', 'email', 'tel', 'url', 'number', 'textarea']);

/**
 * Fill plain text fields in one go: set each value through the element's
 * native value setter and fire input/change, which React and other frameworks
 * pick up. Values are read back afterwards; returns the ids that kept their
 * value, so the caller can fill any others the normal way.
 * @param {Array<{field: object, value: string}>} items
 */
async function fillTextBatch(page, items) {
  const batch = items.filter(({ field }) => BATCH_TYPES.has(field.type)).map(({ field, value }) => ({ id: field.id, value: String(value) }));
  if (!batch.length) return [];
  await page.evaluate(list => {
    for (const { id, value } of list) {
      const el = document.querySelector(`[data-aa-field="${id}"]`);
      if (!el) continue;
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      el.focus();
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
    }
  }, batch);
  await page.waitForTimeout(150); // let frameworks re-render before checking
  // A field counts as filled if it still holds the value (formatting such as
  // "(512) 555-0100" for "5125550100" is fine: compare digits/letters only).
  return page.evaluate(list => {
    const core = s => String(s).replace(/[^0-9a-z]/gi, '').toLowerCase();
    return list.filter(({ id, value }) => {
      const el = document.querySelector(`[data-aa-field="${id}"]`);
      return el && core(el.value) === core(value);
    }).map(({ id }) => id);
  }, batch);
}

/** Click Next/Continue if present. Returns false when this is the last step. */
async function nextStep(page, cursor) {
  const button = await firstVisible(buttonByText(page, NEXT_TEXT));
  if (!button) return false;
  await cursor.click(button);
  await page.waitForLoadState('domcontentloaded');
  return true;
}

/** Locate the final submit button. The orchestrator clicks it only after approval. */
const findSubmit = page => firstVisible(buttonByText(page, SUBMIT_TEXT));

module.exports = {
  id: 'generic',
  helpers: { firstVisible, buttonByText, readComboboxOptions, pickSuggestion },
  matches: () => true,
  extractJob,
  openApplication,
  scan,
  fill,
  fillTextBatch,
  markFilled,
  nextStep,
  findSubmit,
};
