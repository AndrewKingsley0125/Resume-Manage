// Rippling Recruiting (ats.rippling.com/<company>/jobs/<job-id>).
// JD page is a Next.js app: title, company, locations and the description
// HTML (company + role parts) are in the __NEXT_DATA__ script. "Apply now"
// moves the same tab to <job>/apply?...&step=application; one page.
// Every control sits in a [data-testid="field"] block:
//   built-in fields  header span id="field-N-label" (+ "*" span when required)
//   custom questions question text in <p> blocks just above the field block
//                    (wrapper div.marginY--36), "*" when required
//   dropdowns        searchable comboboxes ([data-testid="select-controller"])
//   radio groups     [role=radiogroup] of [role=radio][data-value] divs
// The phone country code combobox is preset (+1 US) and skipped.
// Sample: samples/rippling-torus
const generic = require('./generic');

async function extractJob(page) {
  const job = await page.evaluate(() => {
    const el = document.getElementById('__NEXT_DATA__');
    let post;
    try { post = JSON.parse(el.textContent).props.pageProps.apiData.jobPost; } catch (_) { return null; }
    if (!post || !post.description) return null;
    const div = document.createElement('div');
    div.innerHTML = [post.description.company, post.description.role].filter(Boolean).join('\n');
    document.body.append(div); // innerText needs layout for line breaks
    const description = div.innerText.trim();
    div.remove();
    const locations = post.workLocations || [];
    return {
      title: post.name || '',
      company: post.companyName || '',
      location: locations.join(' / '),
      remote: locations.some(l => /remote/i.test(l)) || null,
      description,
      source: 'rippling',
    };
  });
  return job && job.description ? job : generic.extractJob(page);
}

async function openApplication(page, cursor) {
  if (!/\/apply\b/.test(new URL(page.url()).pathname)) {
    const button = await generic.helpers.firstVisible(page.locator('button, a').filter({ hasText: /^\s*apply now\s*$/i }));
    if (!button) throw new Error('Could not find the Apply now button');
    await cursor.click(button);
  }
  await page.locator('[data-testid="field"]').first().waitFor({ timeout: 20000 });
  return page;
}

/* eslint-disable no-undef -- body runs in the browser */
function scanInPage() {
  const text = el => (el ? el.innerText || el.textContent || '' : '').replace(/\s+/g, ' ').trim();
  const visible = el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  };
  const blocks = [...document.querySelectorAll('[data-testid="field"]')].filter(visible);
  const fields = [];
  let n = 0;
  const add = (el, field) => {
    const id = `f${n++}`;
    el.setAttribute('data-aa-field', id);
    fields.push({ id, name: '', done: el.hasAttribute('data-aa-done'), ...field });
    return id;
  };

  for (const block of blocks) {
    // Label: the field's own header, or the custom question text above it.
    const header = block.querySelector('[id$="-label"]');
    let label = text(header);
    let required = !!(header && /\*/.test(text(header.parentElement)));
    if (!label) {
      const wrap = block.closest('.marginY--36');
      const question = wrap && wrap.querySelector('.paddingX--16 p');
      label = text(question).replace(/\s*\*\s*$/, '');
      // The red "*" is drawn by CSS (::after) on an empty div at the end of the
      // question <p>; a saved/re-parsed page has that div right after the <p>.
      const mark = question && (question.querySelector('div') || question.nextElementSibling);
      required = !!mark && mark.tagName === 'DIV' && !text(mark);
    }
    if (!label) {
      // e.g. the SMS consent radios: the instruction paragraph just above.
      const prev = block.previousElementSibling;
      label = text(prev).slice(0, 200);
    }

    const group = block.querySelector('[role="radiogroup"]');
    if (group) {
      const radios = [...group.querySelectorAll('[role="radio"]')];
      const id = add(group, { type: 'radio', label, required, options: radios.map(r => text(r) || r.getAttribute('data-value')) });
      radios.forEach((r, i) => r.setAttribute('data-aa-option', `${id}:${i}`));
      continue;
    }
    for (const el of block.querySelectorAll('input, textarea, [role="combobox"]:not(input)')) {
      const isCombo = el.getAttribute('role') === 'combobox' || el.hasAttribute('aria-autocomplete');
      const type = isCombo ? 'combobox' : (el.getAttribute('type') || (el.tagName === 'TEXTAREA' ? 'textarea' : 'text')).toLowerCase();
      if (['hidden', 'radio', 'checkbox'].includes(type)) continue;
      const wrapper = el.parentElement.closest('[data-testid]:not([data-testid="select-search-input"]):not([data-testid="select-controller"])');
      if (wrapper && /-code$/.test(wrapper.getAttribute('data-testid'))) continue; // phone country code
      if (type !== 'file' && !visible(el)) continue;
      add(el, {
        type, label,
        required: required || el.required || el.getAttribute('aria-required') === 'true',
        options: isCombo ? [] : undefined,
        accept: type === 'file' ? el.getAttribute('accept') || '' : undefined,
      });
    }
  }
  return fields;
}
/* eslint-enable no-undef */

async function scan(page) {
  const fields = await page.evaluate(scanInPage);
  for (const field of fields) {
    if (field.type === 'combobox' && !field.done) field.options = await generic.helpers.readComboboxOptions(page, field);
  }
  return fields;
}

async function fill(page, field, value, cursor) {
  if (field.type !== 'combobox' || !value) return generic.fill(page, field, value, cursor);
  const el = page.locator(`[data-aa-field="${field.id}"]`);
  // Dropdowns with a fixed list: open, filter by the value, click that option.
  // Search boxes (Location): pick the closest suggestion.
  return generic.helpers.pickSuggestion(page, el, String(value), cursor, { listed: field.options.length > 0 });
}

/**
 * Rippling parses an uploaded résumé and fills fields from it, which would
 * overwrite answers set earlier. So files go first; text fields are set once
 * the parse is done. Returns the ids handled here (files + text batch).
 */
async function fillTextBatch(page, items) {
  const files = items.filter(({ field }) => field.type === 'file');
  for (const { field, value } of files) {
    const parsed = /r[ée]sum[ée]|\bcv\b/i.test(field.label)
      ? page.waitForResponse(r => /parse_resume/.test(r.url()), { timeout: 20000 }).catch(() => null)
      : null;
    await page.locator(`[data-aa-field="${field.id}"]`).setInputFiles(value);
    if (parsed && (await parsed)) await page.waitForTimeout(1000); // let the parsed values render
  }
  return [...files.map(({ field }) => field.id), ...(await generic.fillTextBatch(page, items))];
}

/** The "Apply" button that sends the form. */
const findSubmit = page => generic.helpers.firstVisible(page.locator('button[type="submit"], button').filter({ hasText: /^\s*(apply|submit( application)?)\s*$/i }));

module.exports = {
  ...generic,
  id: 'rippling',
  matches: url => /(^|\.)rippling\.com$/i.test(url.hostname) && /\/jobs\//.test(url.pathname),
  extractJob,
  openApplication,
  scan,
  fill,
  fillTextBatch,
  nextStep: async () => false, // single-page form
  findSubmit,
};
