// BambooHR careers (<company>.bamboohr.com/careers/<id>).
// JD in JSON-LD. "Apply for This Job" shows `form#job-application-form` on the
// same page. Plain inputs/radios/checkboxes work with the generic scanner.
// Dropdowns (State, Country, some questions) are fabric selects: a toggle
// button (aria-label "<label> <current value>", data-menu-id) opening
// `#<menu-id>[role=menu]` of `[role=menuitem]` items; the native <select>
// beside it is aria-hidden and empty. A honeypot input ("Please leave this
// field blank") sits in an aria-hidden box and is skipped by the scanner.
// reCAPTCHA v2 checkbox ("I'm not a robot") above the submit button.
// Sample: samples/bamboohr-newschools
const generic = require('./generic');
const { matchOption } = require('../../answers/answer-engine');

const FORM = '#job-application-form';

async function openApplication(page, cursor) {
  if (!(await page.locator(FORM).count())) {
    const button = await generic.helpers.firstVisible(page.locator('button, a').filter({ hasText: /^\s*apply for this job\s*$/i }));
    if (!button) return generic.openApplication(page, cursor);
    await cursor.click(button);
  }
  // The form animates in; scan only once its text boxes are showing.
  await page.locator(`${FORM} input[type="text"]`).first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(500);
  return page;
}

/* eslint-disable no-undef -- body runs in the browser */
function tagMenus({ form, start }) {
  const text = el => (el ? el.innerText || el.textContent || '' : '').replace(/\s+/g, ' ').trim();
  return [...document.querySelectorAll(`${form} [data-fabric-component="SelectField InputWrapper"]`)].map((wrap, i) => {
    const id = `m${start + i}`;
    const toggle = wrap.querySelector('button[data-menu-id]');
    toggle.setAttribute('data-aa-field', id);
    const label = text(wrap.querySelector('label'));
    // aria-label is "<label> <current value>", e.g. "Country United States", "State –Select–".
    const current = (toggle.getAttribute('aria-label') || '').slice(label.replace(/\s*\*\s*$/, '').length).trim();
    return {
      id, type: 'combobox', name: '', menu: true,
      label: label.replace(/\s*\*\s*$/, ''),
      required: /\*\s*$/.test(label) || !!wrap.querySelector('select[required], [aria-required="true"]'),
      done: toggle.hasAttribute('data-aa-done'),
      current: /select/i.test(current) ? '' : current,
    };
  });
}
/* eslint-enable no-undef */

const menuItems = (page, toggle) => toggle.getAttribute('data-menu-id').then(id => page.locator(`[id="${id}"] [role="menuitem"]`));

async function readMenu(page, field) {
  const toggle = page.locator(`[data-aa-field="${field.id}"]`);
  try {
    await toggle.scrollIntoViewIfNeeded();
    await toggle.click();
    const items = await menuItems(page, toggle);
    await items.first().waitFor({ timeout: 2000 });
    return (await items.allInnerTexts()).map(t => t.trim()).filter(Boolean);
  } catch (_) {
    return [];
  } finally {
    await page.keyboard.press('Escape').catch(() => {});
  }
}

async function scan(page) {
  const fields = await generic.scan(page, FORM);
  const menus = await page.evaluate(tagMenus, { form: FORM, start: 0 });
  for (const m of menus) if (!m.done) m.options = await readMenu(page, m);
  // Changing Country resets State, so Country is filled first.
  menus.sort((a, b) => /country/i.test(b.label) - /country/i.test(a.label));
  return [...fields, ...menus];
}

async function fill(page, field, value, cursor) {
  if (!field.menu) return generic.fill(page, field, value, cursor);
  if (!value || field.current === value) return;
  const toggle = page.locator(`[data-aa-field="${field.id}"]`);
  await cursor.click(toggle);
  const items = await menuItems(page, toggle);
  await items.first().waitFor({ timeout: 3000 });
  const texts = (await items.allInnerTexts()).map(t => t.trim());
  const best = matchOption(texts, value);
  if (!best) {
    await page.keyboard.press('Escape').catch(() => {});
    throw new Error(`No option matching "${value}"`);
  }
  await cursor.click(items.nth(texts.indexOf(best)));
}

/**
 * The résumé uploads on attach (attachTemporary.php) and the form re-renders
 * when it finishes, which clears dropdowns picked before. So files go first.
 */
async function fillTextBatch(page, items) {
  const files = items.filter(({ field }) => field.type === 'file');
  for (const { field, value } of files) {
    const uploaded = page.waitForResponse(r => /attachTemporary/.test(r.url()), { timeout: 20000 }).catch(() => null);
    await page.locator(`[data-aa-field="${field.id}"]`).setInputFiles(value);
    if (await uploaded) await page.waitForTimeout(800);
  }
  return [...files.map(({ field }) => field.id), ...(await generic.fillTextBatch(page, items))];
}

module.exports = {
  ...generic,
  id: 'bamboohr',
  fillTextBatch,
  matches: url => /(^|\.)bamboohr\.com$/i.test(url.hostname),
  openApplication,
  scan,
  fill,
  nextStep: async () => false, // single-page form
  findSubmit: page => generic.helpers.firstVisible(page.locator('button').filter({ hasText: /^\s*submit application\s*$/i })),
};
