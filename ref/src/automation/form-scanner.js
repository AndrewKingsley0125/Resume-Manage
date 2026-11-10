// Generic form scanner. Runs inside the page, finds every fillable control,
// resolves its human-readable label, and tags it with data-aa-field (and
// data-aa-option for radio/checkbox choices) so later steps can find it
// again without relying on site-generated ids.

/* eslint-disable no-undef -- body runs in the browser */
function scanInPage(rootSelector) {
  const root = document.querySelector(rootSelector) || document.body;
  const text = el => (el ? el.innerText || el.textContent || '' : '').replace(/\s+/g, ' ').trim();
  const visible = el => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };

  function labelFor(el) {
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = by.split(/\s+/).map(id => text(document.getElementById(id))).filter(Boolean).join(' ');
      if (t) return t;
    }
    if (el.labels && el.labels.length) return text(el.labels[0]);
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    // Nearest ancestor that contains a label/legend-like element.
    for (let p = el.parentElement, depth = 0; p && depth < 5; p = p.parentElement, depth++) {
      const l = p.querySelector('label, legend, [class*="label" i], [class*="question" i]');
      if (l && !l.contains(el) && text(l)) return text(l);
    }
    return el.getAttribute('placeholder') || el.getAttribute('name') || '';
  }

  const groupLabel = el => {
    const fs = el.closest('fieldset, [role="radiogroup"], [role="group"]');
    if (fs) {
      const legend = fs.querySelector('legend') || (fs.getAttribute('aria-labelledby') && document.getElementById(fs.getAttribute('aria-labelledby')));
      if (legend) return text(legend);
      if (fs.getAttribute('aria-label')) return fs.getAttribute('aria-label');
    }
    return labelFor(el.closest('div') || el);
  };

  // "-- No answer --", "Select...", "Please choose an option"
  const PLACEHOLDER = /^\s*--.*--\s*$|^\s*(please\s+)?(select|choose)(\s+(an?\s+)?(option|one))?\s*\.{0,3}\s*$/i;
  const fields = [];
  const elements = new Map(); // field id → element, for the shared-label pass below
  const seenGroups = new Set();
  let n = 0;
  const controls = root.querySelectorAll('input, select, textarea, [role="combobox"]:not(input)');

  for (const el of controls) {
    const tag = el.tagName.toLowerCase();
    let type = tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : (el.getAttribute('type') || 'text').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image', 'search'].includes(type)) continue;
    // Validation shadows of custom widgets (e.g. react-select's required input).
    if (el.getAttribute('aria-hidden') === 'true') continue;
    // Honeypots ("Please leave this field blank") hide in aria-hidden boxes; file inputs may too.
    if (type !== 'file' && el.closest('[aria-hidden="true"]')) continue;
    // ... or are labelled for robots (Workday's "beecatcher": "This input is for robots only").
    if (/beecatcher|honeypot/i.test(el.getAttribute('data-automation-id') || el.name || '')
      || /robots only|leave (this|it) (field )?(blank|empty)/i.test(labelFor(el))) continue;
    if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete')) type = type === 'select' ? 'select' : 'combobox';
    if (type !== 'file' && type !== 'radio' && type !== 'checkbox' && !visible(el)) continue;

    const id = `f${n++}`;
    const required = el.required || el.getAttribute('aria-required') === 'true';
    const done = el.hasAttribute('data-aa-done'); // filled in an earlier pass (see markFilled)

    if (type === 'radio' || type === 'checkbox') {
      const key = `${type}:${el.name || id}`;
      if (el.name && seenGroups.has(key)) continue;
      seenGroups.add(key);
      const members = el.name ? [...root.querySelectorAll(`input[type="${type}"][name="${CSS.escape(el.name)}"]`)] : [el];
      members.forEach((m, i) => m.setAttribute('data-aa-option', `${id}:${i}`));
      el.setAttribute('data-aa-field', id);
      const single = members.length === 1;
      fields.push({
        id, type, done, required: required || /\*\s*$/.test(groupLabel(el)),
        label: single ? labelFor(el) : groupLabel(el),
        name: el.name || '',
        options: members.map(m => labelFor(m) || m.value),
      });
      continue;
    }

    el.setAttribute('data-aa-field', id);
    elements.set(id, el);
    // File inputs usually sit behind an "Attach" button; the real label is on the upload group.
    const uploadGroup = type === 'file' && el.closest('[role="group"][aria-labelledby]');
    const label = (uploadGroup && text(document.getElementById(uploadGroup.getAttribute('aria-labelledby')))) || labelFor(el);
    fields.push({
      id, type, done, label, name: el.getAttribute('name') || '',
      required: required || /\*\s*$/.test(label),
      options: tag === 'select' ? [...el.options].filter(o => o.value !== '' && !PLACEHOLDER.test(text(o))).map(o => text(o)) : undefined,
      accept: type === 'file' ? el.getAttribute('accept') || '' : undefined,
    });
  }

  // Several boxes under one label (Address: street / city / state / zip) are
  // told apart by their placeholders: "Address — City".
  const count = {};
  for (const f of fields) if (elements.has(f.id)) count[f.label] = (count[f.label] || 0) + 1;
  for (const f of fields) {
    const hint = elements.has(f.id) && (elements.get(f.id).getAttribute('placeholder') || '').trim();
    if (count[f.label] > 1 && hint && hint.toLowerCase() !== f.label.toLowerCase()) f.label = `${f.label} — ${hint}`;
  }
  return fields;
}
/* eslint-enable no-undef */

/** @returns {Promise<Array<{id,type,done,label,name,required,options?}>>} */
function scanFields(page, rootSelector = 'body') {
  return page.evaluate(scanInPage, rootSelector);
}

/**
 * Mark every field found by the last scan as handled, so the next scan can
 * tell follow-up questions that appeared after filling (field.done === false).
 */
function markFilled(page) {
  return page.evaluate(() => {
    document.querySelectorAll('[data-aa-field], [data-aa-option]').forEach(el => el.setAttribute('data-aa-done', ''));
  });
}

module.exports = { scanFields, markFilled };
