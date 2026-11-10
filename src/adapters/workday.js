// Workday (<tenant>.wd<N>.myworkdayjobs.com/<site>/job/...).
// JD in JSON-LD. Apply (adventureButton) → "Apply Manually" (applyManually)
// starts an 8-step wizard whose step 1 is Create Account / Sign In: a
// password field, handed to the user as a 'login' step (blockers.js). Then:
// My Information, My Experience, Application Questions, Voluntary
// Disclosures, Self Identify, Review. Markup is the same on every tenant:
//   question     [data-automation-id^="formField-"] with a <label> (or legend), "*" = required
//   dropdown     button[aria-haspopup="listbox"] → [role=listbox] [role=option]
//   multiselect  input[data-automation-id="searchBox"] (type + Enter → promptOption items),
//                e.g. "How Did You Hear About Us?", "Country Phone Code"
//   date         dateSectionMonth/Day/Year-input spinbuttons (typed as MMDDYYYY)
//   resume       input[data-automation-id="file-upload-input-ref"] (My Experience)
//   next/submit  button[data-automation-id="pageFooterNextButton"] or "bottom-navigation-next-button"
//                (newer tenants): "Continue" / "Save and Continue" / "Submit"
//   errors       [data-automation-id="errorBanner"]
// Work history / education entries ("Add") are left to the résumé.
// Progress: progressBarActiveStep's label reads "current step X of N". The run
// is finished only on step N (Review) with a Submit button; before that a
// missing Continue button is an error, never "the form is done".
// Sign-in may also be a separate page (/login?redirect=...) that returns to
// the job posting; ready() then presses Apply again to get back into the flow.
// Every step loads in pieces at varying speed: settle() waits for loading
// indicators to clear and the form to stop changing before anything is read.
// Sample: samples/workday-genmills (job page and sign-in step only)
const generic = require('./generic');
const { matchOption } = require('../../answers/answer-engine');

const FLOW = '[data-automation-id="applyFlowPage"]';
const NEXT = 'button[data-automation-id="pageFooterNextButton"], button[data-automation-id="bottom-navigation-next-button"]';
const NEXT_TEXT = /^\s*(continue|save and continue|next|submit)\s*$/i;
const id = name => `[data-automation-id="${name}"]`;

async function dismissCookies(page) {
  const decline = page.locator(id('legalNoticeDeclineButton'));
  if (await decline.isVisible().catch(() => false)) await decline.click().catch(() => {});
}

// Loading indicators: Workday's "loading" element, Canvas loading dots and
// skeletons, spinners, busy regions, upload progress bars.
const BUSY = [
  '[data-automation-id*="loading" i]', '[data-automation-id*="spinner" i]', '[data-automation-id*="skeleton" i]',
  '[class*="skeleton" i]', '[class*="loadingdots" i]', '[aria-busy="true"]', '[role="progressbar"]',
].join(', ');

/**
 * Wait until the step has finished loading: no loading indicator showing and
 * the form unchanged (same questions, inputs, buttons and text) for `quietMs`.
 * Workday renders a step in pieces at varying speed, so one check is not enough.
 */
async function settle(page, { timeoutMs = 30000, quietMs = 1500 } = {}) {
  const end = Date.now() + timeoutMs;
  let last = null, since = Date.now();
  while (Date.now() < end) {
    const now = await page.evaluate(([flow, busy]) => {
      const shown = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
      const root = document.querySelector(flow) || document.body;
      return {
        busy: [...document.querySelectorAll(busy)].some(shown),
        shape: [
          root.querySelectorAll('[data-automation-id^="formField-"]').length,
          [...root.querySelectorAll('input, textarea, select, button')].filter(shown).length,
          [...document.querySelectorAll('button')].filter(shown).length,
          (root.innerText || '').length,
        ].join('/'),
      };
    }, [FLOW, BUSY]).catch(() => ({ busy: true, shape: 'navigating' }));
    if (now.busy || now.shape !== last) {
      last = now.shape;
      since = Date.now();
    } else if (Date.now() - since >= quietMs) {
      return true;
    }
    await page.waitForTimeout(250);
  }
  return false; // still changing after timeoutMs: go on with what is there
}

/** "current step 3 of 9" → { at: 3, of: 9 }; null when there is no progress bar. */
async function progress(page) {
  const label = await page.locator(id('progressBarActiveStep')).first().innerText().catch(() => '');
  const m = /step\s+(\d+)\s+of\s+(\d+)/i.exec(label);
  return m ? { at: Number(m[1]), of: Number(m[2]) } : null;
}

async function openApplication(page, cursor) {
  if (!(await page.locator(FLOW).count())) {
    // The posting renders after load; the Apply button shows up late.
    const apply = page.locator(id('adventureButton')).first();
    await apply.waitFor({ timeout: 45000 }).catch(() => { throw new Error('Could not find the Apply button'); });
    await dismissCookies(page);
    await cursor.click(apply);
    // "Autofill with Resume": Workday reads the uploaded résumé and pre-fills
    // My Information / My Experience. "Apply Manually" if a site lacks it.
    const autofill = page.locator(id('autofillWithResume'));
    const manual = page.locator(id('applyManually'));
    await autofill.or(manual).first().waitFor({ timeout: 10000 });
    await cursor.click((await autofill.count()) ? autofill : manual);
  }
  await page.locator(FLOW).waitFor({ timeout: 45000 }); // Workday can be slow
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  return page;
}

/**
 * After sign-in or Save and Continue: wait for the step's questions (or the
 * Review page) to render. Back on the job posting (sign-in redirects there): Apply again.
 */
async function ready(page, cursor) {
  const flow = page.locator(FLOW);
  const apply = page.locator(id('adventureButton'));
  await flow.or(apply).first().waitFor({ timeout: 45000 }).catch(() => {}); // Workday can be slow
  if (!(await flow.count()) && (await apply.count()) && cursor) await openApplication(page, cursor);
  await flow.waitFor({ timeout: 45000 });
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  await page.locator(`${FLOW} [data-automation-id^="formField-"], ${FLOW} input[type="file"], ${NEXT}`).first().waitFor({ timeout: 15000 }).catch(() => {});
  await settle(page);
}

/* eslint-disable no-undef -- body runs in the browser */
function scanInPage(flow) {
  const text = el => (el ? el.innerText || el.textContent || '' : '').replace(/\s+/g, ' ').trim();
  const visible = el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  const fields = [];
  let n = 0;
  const add = (el, field) => {
    const fid = `f${n++}`;
    el.setAttribute('data-aa-field', fid);
    fields.push({ id: fid, name: '', done: el.hasAttribute('data-aa-done'), ...field });
    return fid;
  };
  const blocks = [...document.querySelectorAll(`${flow} [data-automation-id^="formField-"]`)]
    .filter((b, i, all) => visible(b) && !all.some(o => o !== b && o.contains(b)));
  for (const block of blocks) {
    const head = block.querySelector('legend, label');
    const raw = text(head);
    const label = raw.replace(/\s*\*\s*$/, '').replace(/\s*\*$/, '');
    const req = control => /\*\s*$/.test(raw) || (control && (control.required || control.getAttribute('aria-required') === 'true'));

    const radios = [...block.querySelectorAll('input[type="radio"]')];
    if (radios.length) {
      const fid = add(radios[0], { type: 'radio', label, required: req(radios[0]), options: radios.map(r => text(document.querySelector(`label[for="${CSS.escape(r.id)}"]`)) || r.value) });
      radios.forEach((r, i) => r.setAttribute('data-aa-option', `${fid}:${i}`));
      continue;
    }
    const boxes = [...block.querySelectorAll('input[type="checkbox"]')];
    if (boxes.length) {
      const opts = boxes.map(b => text(document.querySelector(`label[for="${CSS.escape(b.id)}"]`)) || label);
      const fid = add(boxes[0], { type: 'checkbox', label: label || opts[0], required: req(boxes[0]), options: opts });
      boxes.forEach((b, i) => b.setAttribute('data-aa-option', `${fid}:${i}`));
      continue;
    }
    const month = block.querySelector('[data-automation-id="dateSectionMonth-input"]');
    if (month) {
      add(month, { type: 'date', label, required: req(month) });
      continue;
    }
    const dropdown = block.querySelector('button[aria-haspopup="listbox"]');
    if (dropdown) {
      const current = text(dropdown);
      add(dropdown, { type: 'combobox', widget: 'dropdown', label, required: req(dropdown), options: [], current: /^select one$/i.test(current) ? '' : current });
      continue;
    }
    const search = block.querySelector('input[data-automation-id="searchBox"]');
    if (search) {
      const chosen = text(block.querySelector('[data-automation-id="selectedItem"]'));
      add(search, { type: 'combobox', widget: 'search', label, required: req(search), options: [], current: chosen });
      continue;
    }
    const file = block.querySelector('input[type="file"]');
    if (file) {
      add(file, { type: 'file', label: label || 'Resume', required: req(file) });
      continue;
    }
    const input = block.querySelector('textarea, input:not([type="hidden"])');
    if (input && visible(input)) {
      add(input, { type: input.tagName === 'TEXTAREA' ? 'textarea' : (input.type || 'text').toLowerCase(), label, required: req(input) });
    }
  }
  // The résumé drop zone on My Experience is not always inside a formField block.
  const drop = document.querySelector(`${flow} input[data-automation-id="file-upload-input-ref"]:not([data-aa-field])`);
  if (drop && !fields.some(f => f.type === 'file')) add(drop, { type: 'file', label: 'Resume/CV', required: true });
  return fields;
}
/* eslint-enable no-undef */

async function readDropdown(page, field) {
  const button = page.locator(`[data-aa-field="${field.id}"]`);
  try {
    await button.scrollIntoViewIfNeeded();
    await button.click();
    const options = page.locator('[role="listbox"] [role="option"]');
    await options.first().waitFor({ timeout: 3000 });
    return (await options.allInnerTexts()).map(t => t.trim()).filter(t => t && !/^select one$/i.test(t));
  } catch (_) {
    return [];
  } finally {
    await page.keyboard.press('Escape').catch(() => {});
  }
}

async function scan(page) {
  await settle(page, { timeoutMs: 15000 }); // fills can load more questions (e.g. State after Country)
  const fields = await page.evaluate(scanInPage, FLOW);
  for (const f of fields) if (f.widget === 'dropdown' && !f.done) f.options = await readDropdown(page, f);
  return fields;
}

/** Search box: type, Enter, pick the closest prompt option (one level deep). */
async function fillSearch(page, el, value, cursor) {
  await cursor.type(el, value);
  await page.keyboard.press('Enter');
  const options = page.locator('[data-automation-id="promptOption"], [role="listbox"] [role="option"]');
  await options.first().waitFor({ timeout: 5000 });
  const texts = (await options.allInnerTexts()).map(t => t.trim());
  const best = matchOption(texts, value) || (texts.length === 1 ? texts[0] : null);
  if (!best) throw new Error(`No option matching "${value}"`);
  await cursor.click(options.nth(texts.indexOf(best)));
  await page.keyboard.press('Escape').catch(() => {});
}

/** MM/DD/YYYY (or "today") typed into the month spinbutton; Workday moves across day and year. */
async function fillDate(page, el, value, cursor) {
  const d = /^today$/i.test(value) ? new Date() : new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`Not a date: "${value}"`);
  const digits = [d.getMonth() + 1, d.getDate()].map(x => String(x).padStart(2, '0')).join('') + d.getFullYear();
  await cursor.click(el);
  await page.keyboard.type(digits, { delay: 30 });
}

/**
 * Résumé upload. Workday reads it (Autofill with Resume) and lists the file
 * name with a delete button once done; wait for that so Continue isn't
 * pressed mid-upload.
 */
async function fillFile(page, el, file) {
  await el.setInputFiles(file);
  const name = require('node:path').basename(file);
  // If it never shows, Continue still runs; Workday flags a missing required file itself.
  await page.locator(FLOW).getByText(name).first().waitFor({ timeout: 30000 }).catch(() => {});
  await settle(page, { timeoutMs: 60000 }); // the résumé is read and the fields refilled
}

async function fill(page, field, value, cursor) {
  if (value == null || value === '') return;
  const el = page.locator(`[data-aa-field="${field.id}"]`);
  if (field.type === 'file') return fillFile(page, el, String(value));
  if (field.type === 'date') return fillDate(page, el, String(value), cursor);
  if (field.widget === 'search') return field.current === value ? undefined : fillSearch(page, el, String(value), cursor);
  if (field.widget === 'dropdown') {
    if (field.current === value) return;
    return generic.helpers.pickSuggestion(page, el, String(value), cursor, { listed: true });
  }
  return generic.fill(page, field, value, cursor);
}

/**
 * The Continue / Save and Continue / Submit button (by automation id, else by
 * text). It can render a moment after the questions, so wait for it a while.
 */
async function footerButton(page, timeoutMs = 10000) {
  await settle(page, { timeoutMs: 15000 });
  const buttons = page.locator(NEXT).or(page.locator('button').filter({ hasText: NEXT_TEXT }));
  for (const end = Date.now() + timeoutMs; ;) {
    const button = await generic.helpers.firstVisible(buttons);
    if (button || Date.now() >= end) return button;
    await page.waitForTimeout(500);
  }
}

/** Which step is showing: the progress bar's active step and the page heading (some steps have no step label). */
const stepName = page => page.evaluate(flow => {
  const t = sel => (document.querySelector(sel) || {}).innerText || '';
  return `${t('[data-automation-id="progressBarActiveStep"]')}|${t(`${flow} h2`)}`.replace(/\s+/g, ' ').trim();
}, FLOW).catch(() => '');

/**
 * "Continue" / "Save and Continue". false only on the last step with a Submit
 * button. Fails if the button is missing before the last step or the step does not advance.
 */
async function nextStep(page, cursor) {
  const button = await footerButton(page);
  const step = await progress(page);
  const last = !step || step.at >= step.of;
  if (button && /submit/i.test(await button.innerText())) return false; // clicked only after confirmation
  if (!button) {
    if (!last) throw new Error(`Workday step ${step.at} of ${step.of}: no Continue button found`);
    return false;
  }
  await settle(page); // e.g. the résumé still uploading
  const before = await stepName(page);
  await cursor.click(button);
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(500);
    if ((await stepName(page)) !== before) return true; // ready() then waits for the new step to load
  }
  const errors = await page.locator(id('errorBanner')).innerText().catch(() => '');
  throw new Error(`Workday did not move past "${before.replace(/\s+/g, ' ').trim()}"${errors ? `: ${errors.replace(/\s+/g, ' ').trim()}` : ''}`);
}

async function findSubmit(page) {
  const button = await footerButton(page);
  return button && /submit/i.test(await button.innerText()) ? button : null;
}

module.exports = {
  ...generic,
  id: 'workday',
  matches: url => /\.myworkdayjobs\.com$|(^|\.)myworkdaysite\.com$/i.test(url.hostname),
  openApplication,
  ready,
  scan,
  fill,
  nextStep,
  findSubmit,
  settle,
};
