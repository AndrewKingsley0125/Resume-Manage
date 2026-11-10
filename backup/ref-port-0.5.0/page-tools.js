// Page tools: question scanning, option reading, and filling.
// Ported from ref/src/automation (form-scanner.js, adapters/*.js,
// answers/answer-engine.js matchOption, blockers.js). The ref drives pages
// through Playwright; here the same steps run inside the page, with mouse and
// keyboard input emulated through DOM events. Elements are tagged with
// data-aa-field / data-aa-option exactly as in the ref.
// The previous implementation is kept in backup/chrome-extension-legacy-0.4.1.
(() => {
  const version = 18;
  if (globalThis.ResumeApplyPage && globalThis.ResumeApplyPage.version === version) return;

  // ---------------------------------------------------------------- helpers
  const text = el => (el ? el.innerText || el.textContent || '' : '').replace(/[\s​]+/g, ' ').trim();
  const visible = el => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function waitFor(read, ms = 1600) {
    const until = Date.now() + ms;
    do { const result = read(); if (result) return result; await pause(80); } while (Date.now() < until);
    return null;
  }
  const firstVisible = els => [...els].find(visible) || null;
  const byText = (selector, re, root = document) => [...root.querySelectorAll(selector)].filter(el => re.test(text(el) || el.value || ''));

  // ------------------------------------------- matchOption (answer-engine.js)
  const US_STATES = {
    AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
    DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
    IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
    MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
    NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
    NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
    PR: 'Puerto Rico', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
    UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  };
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  function aliases(value) {
    const s = String(value).trim();
    const code = s.toUpperCase();
    if (US_STATES[code]) return [US_STATES[code]];
    const entry = Object.entries(US_STATES).find(([, name]) => name.toLowerCase() === s.toLowerCase());
    return entry ? [entry[0]] : [];
  }
  function matchOne(options, value) {
    const v = norm(value);
    if (!v) return null;
    return options.find(o => norm(o) === v)
      || options.find(o => norm(o).startsWith(v))
      || options.find(o => norm(o).includes(v))
      || options.find(o => v.includes(norm(o)) && norm(o).length > 2)
      || null;
  }
  /** Pick the option that best matches `value`; null when nothing fits. */
  function matchOption(options, value) {
    if (!options || !options.length || value == null || value === '') return null;
    if (typeof value === 'boolean') value = value ? 'yes' : 'no';
    // Exact matches on any spelling first, so "TX" never fuzzy-matches "Texas City".
    for (const v of [value, ...aliases(value)]) {
      const exact = options.find(o => norm(o) === norm(v));
      if (exact) return exact;
    }
    for (const v of [value, ...aliases(value)]) {
      const fuzzy = matchOne(options, v);
      if (fuzzy) return fuzzy;
    }
    return null;
  }

  // ---------------------------------- input emulation (ref cursor.js, fast mode)
  const centre = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  const underPoint = el => {
    const { x, y } = centre(el);
    const hit = document.elementFromPoint(x, y);
    return !!hit && (el === hit || el.contains(hit) || hit.contains(el));
  };
  async function pointAt(el) {
    if (!el || !el.isConnected) throw new Error('Element is not on the page');
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    // "In view" can still mean under a sticky header/footer bar.
    if (!underPoint(el)) el.scrollIntoView({ block: 'center', inline: 'nearest' });
    // Menus slide or fade in: wait until the element stops moving before aiming.
    let box = el.getBoundingClientRect();
    for (let i = 0; i < 15; i++) {
      await pause(40);
      const next = el.getBoundingClientRect();
      if (Math.abs(next.x - box.x) < 1 && Math.abs(next.y - box.y) < 1) break;
      box = next;
    }
    if (!visible(el)) throw new Error('Element is not visible');
  }
  function mouseSequence(target, x, y) {
    const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, view: window };
    target.dispatchEvent(new PointerEvent('pointerover', base));
    target.dispatchEvent(new MouseEvent('mouseover', base));
    target.dispatchEvent(new PointerEvent('pointerdown', { ...base, buttons: 1, pointerType: 'mouse', isPrimary: true }));
    const down = target.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
    // A real mouse-down focuses the control unless the widget prevents it.
    if (down) {
      const focusable = target.closest('input,textarea,select,button,a[href],[tabindex],[contenteditable="true"]');
      if (focusable && document.activeElement !== focusable) focusable.focus({ preventScroll: true });
    }
    target.dispatchEvent(new PointerEvent('pointerup', { ...base, pointerType: 'mouse', isPrimary: true }));
    target.dispatchEvent(new MouseEvent('mouseup', base));
    target.dispatchEvent(new MouseEvent('click', base));
  }
  /**
   * Click the middle of the element, on whatever is drawn there if it belongs to it.
   * Choice buttons without a type are submit buttons to the browser, so form
   * submission is blocked during the click unless `allowSubmit` (Next buttons).
   */
  async function click(el, { allowSubmit = false } = {}) {
    await pointAt(el);
    const { x, y } = centre(el);
    let target = document.elementFromPoint(x, y);
    if (!target || !(target === el || el.contains(target) || target.contains(el))) target = el;
    const block = event => { event.preventDefault(); event.stopImmediatePropagation(); };
    if (!allowSubmit) document.addEventListener('submit', block, true);
    try { mouseSequence(target, x, y); }
    finally { if (!allowSubmit) document.removeEventListener('submit', block, true); }
  }
  function setNative(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
  }
  function insertText(el, value) {
    if (el.ownerDocument.activeElement !== el) el.focus({ preventScroll: true });
    let ok = false;
    if (value) { try { ok = document.execCommand('insertText', false, value); } catch (_) { ok = false; } }
    if (!ok || el.value !== value) {
      setNative(el, value);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: value }));
    }
  }
  /** Click into the field, clear it, then insert the whole value as one input (like a paste). */
  async function type(el, value) {
    await click(el);
    el.focus({ preventScroll: true });
    if (el.value) {
      setNative(el, '');
      el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'deleteContentBackward' }));
    }
    insertText(el, String(value));
  }
  const KEYS = { Escape: 27, Enter: 13, ArrowDown: 40, Tab: 9 };
  function press(key, target = document.activeElement || document.body) {
    const init = { key, code: key, keyCode: KEYS[key] || 0, which: KEYS[key] || 0, bubbles: true, cancelable: true, composed: true };
    target.dispatchEvent(new KeyboardEvent('keydown', init));
    if (key === 'Enter') target.dispatchEvent(new KeyboardEvent('keypress', init));
    target.dispatchEvent(new KeyboardEvent('keyup', init));
  }
  /** A click on an empty spot of the page: outside-click handlers close open menus. */
  function clickOutside() {
    const base = { bubbles: true, cancelable: true, composed: true, clientX: 2, clientY: 2, button: 0, view: window };
    for (const name of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      document.body.dispatchEvent(new (name.startsWith('pointer') ? PointerEvent : MouseEvent)(name, base));
    }
  }
  function selectOption(el, label) {
    const wanted = String(label).trim();
    const option = [...el.options].find(o => text(o) === wanted || (o.label || '').trim() === wanted)
      || [...el.options].find(o => norm(text(o)) === norm(wanted));
    if (!option) throw new Error(`No option matching "${label}"`);
    el.focus({ preventScroll: true });
    for (const o of el.options) o.selected = o === option || (el.multiple && o.selected);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  function setInputFiles(el, file) {
    const bytes = Uint8Array.from(atob(file.base64), c => c.charCodeAt(0));
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], file.name, { type: file.type || MIME }));
    el.files = transfer.files;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const isChecked = el => el.checked === true || el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true';
  /** Resolves true when a request whose URL matches `re` finishes within `ms` (Playwright waitForResponse). */
  function watchRequest(re, ms) {
    let observer, timer;
    return new Promise(resolve => {
      try {
        observer = new PerformanceObserver(list => { if (list.getEntries().some(e => re.test(e.name))) resolve(true); });
        observer.observe({ type: 'resource' });
      } catch (_) { resolve(false); }
      timer = setTimeout(() => resolve(false), ms);
    }).finally(() => { clearTimeout(timer); observer && observer.disconnect(); });
  }

  // --------------------------------------------- JD extraction (adapters)
  /** Text of untrusted HTML with line breaks (innerText needs layout), without running anything. */
  function htmlToText(html) {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    doc.querySelectorAll('script,style,iframe,object,embed,img,video,audio,link,meta').forEach(el => el.remove());
    doc.querySelectorAll('*').forEach(el => [...el.attributes].forEach(a => { if (/^on/i.test(a.name) || /^(src|href|style)$/i.test(a.name)) el.removeAttribute(a.name); }));
    const div = document.createElement('div');
    div.style.cssText = 'position:absolute;left:-10000px;top:0;width:800px';
    div.append(...[...doc.body.childNodes].map(node => document.adoptNode(node)));
    document.body.append(div);
    const out = div.innerText.replace(/\n{3,}/g, '\n\n').trim();
    div.remove();
    return out;
  }
  function jsonLdPosting(root = document) {
    for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try { data = JSON.parse(script.textContent); } catch (_) { continue; }
      const items = [data, ...(Array.isArray(data) ? data : []), ...((data && data['@graph']) || [])];
      const job = items.find(x => x && [].concat(x['@type'] || []).includes('JobPosting'));
      if (job) return job;
    }
    return null;
  }
  function fromJsonLd() {
    const job = jsonLdPosting();
    if (!job) return null;
    const place = [].concat(job.jobLocation || [])[0];
    const address = place && place.address;
    return {
      title: job.title || '',
      company: (job.hiringOrganization && job.hiringOrganization.name) || '',
      location: address ? [address.addressLocality, address.addressRegion, address.addressCountry].filter(Boolean).join(', ') : '',
      remote: job.jobLocationType === 'TELECOMMUTE',
      description: htmlToText(job.description || ''),
      source: 'json-ld',
    };
  }
  function fromDom() {
    let best = null;
    for (const el of document.querySelectorAll('[class*="description" i], [id*="description" i], [class*="job-details" i], article, main')) {
      if (!best || el.innerText.length > best.innerText.length) best = el;
    }
    const h1 = document.querySelector('h1');
    return {
      title: h1 ? h1.innerText.trim() : document.title,
      company: (/ at (.+)$/.exec(document.title.trim()) || [])[1] || '',
      location: '', remote: null,
      description: best ? best.innerText.trim() : (document.body.innerText || '').trim(),
      source: 'dom',
    };
  }
  const genericJob = () => { const j = fromJsonLd(); return j && j.description ? j : fromDom(); };

  // ------------------------------------------------- generic scanner (form-scanner.js)
  // A control nested in its own <label> must not add its option text to the question.
  function labelText(label) {
    if (!label.querySelector('select,textarea,[role="listbox"]')) return text(label);
    const copy = label.cloneNode(true);
    copy.querySelectorAll('select,textarea,[role="listbox"]').forEach(child => child.remove());
    return text(copy);
  }
  function labelFor(el) {
    const by = el.getAttribute('aria-labelledby');
    if (by) {
      const t = by.split(/\s+/).map(id => text(document.getElementById(id))).filter(Boolean).join(' ');
      if (t) return t;
    }
    if (el.labels && el.labels.length) return labelText(el.labels[0]);
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    // Nearest ancestor that contains a label/legend-like element.
    for (let p = el.parentElement, depth = 0; p && depth < 5; p = p.parentElement, depth++) {
      const l = p.querySelector('label, legend, [class*="label" i], [class*="question" i]');
      if (l && !l.contains(el) && text(l)) return labelText(l);
    }
    return el.getAttribute('placeholder') || el.getAttribute('name') || '';
  }
  function groupLabelOf(el) {
    const fs = el.closest('fieldset, [role="radiogroup"], [role="group"]');
    if (fs) {
      const legend = fs.querySelector('legend') || (fs.getAttribute('aria-labelledby') && document.getElementById(fs.getAttribute('aria-labelledby')));
      if (legend) return text(legend);
      if (fs.getAttribute('aria-label')) return fs.getAttribute('aria-label');
    }
    return labelFor(el.closest('div') || el);
  }
  // "-- No answer --", "Select...", "Please choose an option"
  const PLACEHOLDER = /^\s*--.*--\s*$|^\s*(please\s+)?(select|choose)(\s+(an?\s+)?(option|one))?\s*\.{0,3}\s*$/i;
  function genericScanInPage(rootSelector) {
    const root = document.querySelector(rootSelector) || document.body;
    const fields = [];
    const elements = new Map();
    const seenGroups = new Set();
    let n = 0;
    for (const el of root.querySelectorAll('input, select, textarea, [role="combobox"]:not(input)')) {
      const tag = el.tagName.toLowerCase();
      let type = tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : (el.getAttribute('type') || 'text').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image', 'search'].includes(type)) continue;
      // Validation shadows of custom widgets (e.g. react-select's required input).
      if (el.getAttribute('aria-hidden') === 'true') continue;
      // Honeypots hide in aria-hidden boxes; file inputs may too.
      if (type !== 'file' && el.closest('[aria-hidden="true"]')) continue;
      if (/beecatcher|honeypot/i.test(el.getAttribute('data-automation-id') || el.name || '')
        || /robots only|leave (this|it) (field )?(blank|empty)/i.test(labelFor(el))) continue;
      if (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete')) type = type === 'select' ? 'select' : 'combobox';
      if (type !== 'file' && type !== 'radio' && type !== 'checkbox' && !visible(el)) continue;
      if (el.disabled) continue;

      const id = `f${n++}`;
      const required = el.required || el.getAttribute('aria-required') === 'true';
      const done = el.hasAttribute('data-aa-done');

      if (type === 'radio' || type === 'checkbox') {
        const key = `${type}:${el.name || id}`;
        if (el.name && seenGroups.has(key)) continue;
        seenGroups.add(key);
        const members = el.name ? [...root.querySelectorAll(`input[type="${type}"][name="${CSS.escape(el.name)}"]`)] : [el];
        members.forEach((m, i) => m.setAttribute('data-aa-option', `${id}:${i}`));
        el.setAttribute('data-aa-field', id);
        const single = members.length === 1;
        fields.push({
          id, type, done, required: required || /\*\s*$/.test(groupLabelOf(el)),
          label: single ? labelFor(el) : groupLabelOf(el),
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
    // Several boxes under one label (Address: street / city / state / zip) are told apart by placeholder.
    const count = {};
    for (const f of fields) if (elements.has(f.id)) count[f.label] = (count[f.label] || 0) + 1;
    for (const f of fields) {
      const hint = elements.has(f.id) && (elements.get(f.id).getAttribute('placeholder') || '').trim();
      if (count[f.label] > 1 && hint && hint.toLowerCase() !== f.label.toLowerCase()) f.label = `${f.label} — ${hint}`;
    }
    return fields;
  }

  // ------------------------------------------- generic options and fill (generic.js)
  const tagged = id => document.querySelector(`[data-aa-field="${CSS.escape(id)}"]`);
  // Oracle Candidate Experience (no ref adapter) draws dropdown choices as grid
  // cells and clears a closed selection on Escape. Its cells count as options,
  // its menus are never opened to read them, and Escape is sent only to an open list.
  const OPTION = '[role="option"], [role="gridcell"].cx-select__list-item';
  const LIST = '[role="listbox"], .cx-select__list';
  const isGrid = el => el.getAttribute('aria-haspopup') === 'grid' || el.matches('.cx-select-input');
  const optionEls = listId => [...document.querySelectorAll(listId ? `[id="${CSS.escape(listId)}"] :is(${OPTION})` : `:is(${LIST}) :is(${OPTION})`)];
  const listIdOf = el => el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
  /**
   * Wait for the first option to show (Playwright waitFor on .first()), then
   * return all of them. aria-controls is reread: some widgets set it only once open.
   */
  async function waitOptions(el, ms) {
    const found = await waitFor(() => { const all = optionEls(listIdOf(el)); return all.length && visible(all[0]) ? all : null; }, ms);
    return found || [];
  }
  /**
   * Make sure an open dropdown list is gone before touching the next control:
   * a list left open covers the fields below it and its options get mistaken
   * for the next dropdown's. Escape does not close every widget, so a click on
   * an empty spot of the page follows.
   */
  async function closeList() {
    const open = () => [...document.querySelectorAll(LIST)].filter(visible);
    if (!open().length) return;
    press('Escape');
    if (await waitFor(() => !open().length, 800)) return;
    clickOutside();
    await waitFor(() => !open().length, 1500);
  }
  // Addition to the ref: a list the control already owns in the DOM (aria-controls)
  // is read even when it did not open, e.g. pre-rendered hidden listboxes.
  const ownedOptions = el => { const id = listIdOf(el); return id ? optionEls(id).map(o => text(o)).filter(Boolean) : []; };
  const ownsMultiList = el => { const id = listIdOf(el); const list = id && document.getElementById(id); return el.getAttribute('aria-multiselectable') === 'true' || !!(list && list.getAttribute('aria-multiselectable') === 'true'); };
  async function readComboboxOptions(el) {
    if (isGrid(el)) return []; // answered as text, then matched to a typed suggestion
    try {
      await click(el);
      const options = await waitOptions(el, 1500);
      return options.length ? options.map(o => text(o)).filter(Boolean) : ownedOptions(el);
    } catch (_) {
      return ownedOptions(el); // otherwise free-text or async (search-as-you-type) combobox
    } finally {
      await closeList();
    }
  }
  /** Addition to the ref: multi-select listboxes take each approved option in turn. */
  async function fillMultiCombobox(el, values) {
    for (const v of values) {
      await click(el);
      const options = await waitOptions(el, 3000);
      const texts = options.map(o => text(o));
      const best = matchOption(texts, v);
      if (!best) { await closeList(); throw new Error(`No option matching "${v}"`); }
      const option = options[texts.indexOf(best)];
      if (option.getAttribute('aria-selected') !== 'true') await click(option);
    }
    await closeList();
  }
  async function fillCombobox(el, value) {
    await type(el, value);
    const options = await waitOptions(el, 3000);
    const exact = options.find(o => text(o) === String(value).trim());
    if (exact) return click(exact);
    press('Enter', el);
  }
  /**
   * Type into a searchable dropdown and click the closest suggestion.
   * `listed`: the dropdown has a fixed option list, so only an option matching
   * `value` is accepted. Otherwise (location search) "Austin, TX" may find
   * nothing, so the city alone is tried next and the best suggestion is taken.
   */
  async function pickSuggestion(el, value, { listed = false } = {}) {
    // A dropdown that is not a text box (div role=combobox) can only be opened.
    const typable = el.tagName === 'INPUT';
    if (typable) await closeList();
    const queries = !typable ? ['', ''] : listed ? [value, ''] : [...new Set([value, value.split(',')[0].trim()])];
    for (const query of queries) {
      if (typable) await type(el, query);
      if (!query) {
        await closeList();
        await click(el);
      }
      // Some widgets set aria-controls only while open; read it now.
      const options = await waitOptions(el, 4000);
      if (!options.length) continue;
      const texts = options.map(o => text(o));
      const best = matchOption(texts, value) || (listed ? null : matchOption(texts, query) || texts[0]);
      if (best) {
        const option = options[texts.indexOf(best)];
        await click(option);
        if (!(await waitFor(() => !option.isConnected, 1500))) await closeList();
        return;
      }
    }
    await closeList();
    throw new Error(`No option matching "${value}"`);
  }
  async function clickChoice(option) {
    // Inputs are often visually hidden behind a styled label.
    const label = option.id && document.querySelector(`label[for="${CSS.escape(option.id)}"]`);
    if (visible(option) || !label) {
      if (!visible(option) && option.closest('label')) return click(option.closest('label'));
      return click(option);
    }
    return click(label);
  }
  async function genericFill(entry, value) {
    if (value == null || value === '') return;
    const { el, raw, members } = entry;
    switch (raw.type) {
      case 'select':
        await pointAt(el);
        return selectOption(el, value);
      case 'radio':
      case 'checkbox': {
        for (const v of [].concat(value)) {
          const index = raw.options.indexOf(v);
          if (index < 0) throw new Error(`No option matching "${v}"`);
          const option = members[index];
          if (!option) throw new Error('Option changed. Rescan.');
          if (isChecked(option)) continue; // already chosen: a click would undo it
          await clickChoice(option);
        }
        return;
      }
      case 'combobox':
        if (isGrid(el)) { await pickSuggestion(el, String(value)); el.blur(); return; } // Oracle commits on blur
        return Array.isArray(value) ? fillMultiCombobox(el, value) : fillCombobox(el, String(value));
      default:
        return type(el, value);
    }
  }
  const BATCH_TYPES = new Set(['text', 'email', 'tel', 'url', 'number', 'textarea']);
  /**
   * Fill plain text fields in one go through the element's native value setter
   * and input/change events, which React and other frameworks pick up. Values
   * are read back afterwards; returns the ids that kept their value, so the
   * caller can fill any others the normal way.
   */
  async function fillTextBatch(items) {
    const batch = items.filter(({ entry }) => BATCH_TYPES.has(entry.raw.type) && entry.el.matches('input,textarea'));
    for (const { entry, value } of batch) {
      const el = entry.el;
      el.focus({ preventScroll: true });
      setNative(el, String(value));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.blur();
    }
    if (!batch.length) return [];
    await pause(150); // let frameworks re-render before checking
    // Formatting such as "(512) 555-0100" for "5125550100" is fine: compare digits/letters only.
    const core = s => String(s).replace(/[^0-9a-z]/gi, '').toLowerCase();
    return batch.filter(({ entry, value }) => entry.el.isConnected && core(entry.el.value) === core(value)).map(({ entry }) => entry.raw.id);
  }
  const NEXT_TEXT = /^\s*(next|continue|save (and|&) continue|review)\s*$/i;
  const SUBMIT_TEXT = /^\s*(submit|submit application|send application|apply|finish)\s*$/i;
  const BUTTONS = 'button, a, input[type="submit"], [role="button"]';
  const genericNext = () => firstVisible(byText(BUTTONS, NEXT_TEXT));
  const genericSubmit = () => firstVisible(byText(BUTTONS, SUBMIT_TEXT));
  const genericScan = async (rootSelector = 'body') => {
    const fields = genericScanInPage(rootSelector);
    for (const field of fields) {
      if (field.type === 'combobox' && !field.done) field.options = await readComboboxOptions(tagged(field.id));
    }
    return fields;
  };
  const comboOptions = async (fields, filter = () => true) => {
    for (const field of fields) {
      if (field.type === 'combobox' && !field.done && filter(field)) field.options = await readComboboxOptions(tagged(field.id));
    }
    return fields;
  };
  const listedPick = (entry, value) => pickSuggestion(entry.el, String(value), { listed: entry.raw.options.length > 0 });

  // ------------------------------------------------------------------ Ashby
  function ashbyScanInPage(formSelector) {
    const optionLabel = input => text(document.querySelector(`label[for="${CSS.escape(input.id)}"]`)) || input.value;
    const entries = [...document.querySelectorAll(`${formSelector} .ashby-application-form-field-entry, ${formSelector} fieldset[class*="ashby-application-form-input-"]`)]
      .filter((e, i, all) => visible(e) && !all.some(o => o !== e && o.contains(e)));
    const fields = [];
    let n = 0;
    for (const entry of entries) {
      const title = entry.querySelector('.ashby-application-form-question-title');
      const label = text(title);
      const required = !!title && /_required_/.test(title.className);
      const id = `f${n++}`;
      const hint = text(entry.querySelector('.ashby-application-form-question-description'));
      const base = { id, label, required, name: '', ...(hint ? { hint } : {}) };
      const tagOptions = els => els.forEach((el, i) => el.setAttribute('data-aa-option', `${id}:${i}`));
      const yesno = entry.querySelector('.ashby-application-form-input-yesno');
      if (yesno) {
        const buttons = [...yesno.querySelectorAll('button')];
        yesno.setAttribute('data-aa-field', id);
        tagOptions(buttons);
        fields.push({ ...base, type: 'radio', done: yesno.hasAttribute('data-aa-done'), options: buttons.map(text) });
        continue;
      }
      const choices = [...entry.querySelectorAll('input[type="radio"], input[type="checkbox"]')];
      if (choices.length) {
        const kind = choices[0].type;
        choices[0].setAttribute('data-aa-field', id);
        tagOptions(choices);
        // A lone checkbox ("I agree ...") is labelled by the question itself.
        const options = choices.length === 1 && kind === 'checkbox' ? [optionLabel(choices[0]) || label] : choices.map(optionLabel);
        fields.push({ ...base, type: kind, done: choices[0].hasAttribute('data-aa-done'), options });
        continue;
      }
      const el = entry.querySelector('input[type="file"], textarea, select, input[role="combobox"], input:not([type="hidden"])');
      if (!el) continue;
      const tag = el.tagName.toLowerCase();
      const kind = tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea'
        : el.getAttribute('role') === 'combobox' ? 'combobox' : (el.getAttribute('type') || 'text').toLowerCase();
      el.setAttribute('data-aa-field', id);
      fields.push({
        ...base, type: kind, done: el.hasAttribute('data-aa-done'),
        required: required || el.required,
        options: kind === 'select' ? [...el.options].filter(o => o.value !== '').map(text) : kind === 'combobox' ? [] : undefined,
        accept: kind === 'file' ? el.getAttribute('accept') || '' : undefined,
      });
    }
    return fields;
  }

  // ------------------------------------------------------------------ Lever
  async function leverJob() {
    const postingUrl = location.href.split(/[?#]/)[0].replace(/\/apply\/?$/, '');
    const html = /\/apply\/?$/.test(location.pathname)
      ? await (await fetch(postingUrl, { credentials: 'include' })).text()
      : document.documentElement.outerHTML;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const t = el => (el ? el.textContent : '').replace(/\s+/g, ' ').trim();
    let org = '';
    for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
      try { org = JSON.parse(s.textContent).hiringOrganization.name || org; } catch (_) { /* not a JobPosting */ }
    }
    const title = t(doc.querySelector('.posting-headline h2'));
    const company = org || (/ - /.test(doc.title) ? doc.title.split(' - ')[0].trim() : '');
    const cat = sel => t(doc.querySelector(`.posting-categories ${sel}`)).replace(/\s*\/\s*$/, '');
    const where = cat('.location');
    const workplace = cat('.workplaceTypes');
    const sections = [...doc.querySelectorAll('.content-wrapper .section-wrapper .section')].filter(s => !s.matches('.posting-header, .last-section-apply'));
    return {
      title, company,
      location: workplace && !where.toLowerCase().includes(workplace.toLowerCase()) ? `${where} (${workplace})` : where,
      remote: /remote/i.test(`${where} ${workplace}`) || null,
      description: htmlToText(sections.map(s => s.outerHTML).join('\n')),
      source: 'lever',
    };
  }
  function leverScanInPage(formSelector) {
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
        let kind = tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : (el.getAttribute('type') || 'text').toLowerCase();
        if (['hidden', 'submit', 'button'].includes(kind)) continue;
        if (kind !== 'file' && kind !== 'radio' && kind !== 'checkbox' && !visible(el)) continue;
        if (el.name && seen.has(el.name)) continue;
        seen.add(el.name);
        if (el.name === 'location') kind = 'combobox'; // location search box
        const id = `f${n++}`;
        el.setAttribute('data-aa-field', id);
        const field = { id, type: kind, label, name: el.name || '', done: el.hasAttribute('data-aa-done'), required: starred || el.required };
        if (kind === 'radio' || kind === 'checkbox') {
          const members = [...entry.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`)];
          members.forEach((m, i) => m.setAttribute('data-aa-option', `${id}:${i}`));
          const optionText = m => text(m.closest('label') && m.closest('label').querySelector('.application-answer-alternative')) || text(m.closest('label')) || m.value;
          field.options = members.map(optionText);
          if (!label && members.length === 1) field.label = field.options[0];
        } else if (kind === 'select') {
          field.options = [...el.options].filter(o => o.value !== '').map(o => text(o));
        } else if (kind === 'combobox') {
          field.options = [];
        } else if (kind === 'file') {
          field.accept = el.getAttribute('accept') || '';
        }
        fields.push(field);
      }
    }
    return fields;
  }
  /** "Current location": type, then click the closest .dropdown-location suggestion. */
  async function leverLocation(el, value) {
    for (const query of [...new Set([value, value.split(',')[0].trim()])]) {
      await type(el, query);
      const options = await waitFor(() => { const all = [...document.querySelectorAll('.dropdown-results .dropdown-location')]; return all.length && visible(all[0]) ? all : null; }, 5000);
      if (!options) continue;
      const texts = options.map(o => text(o));
      const best = matchOption(texts, value) || matchOption(texts, query) || texts[0];
      return click(options[texts.indexOf(best)]);
    }
    // No suggestion: leave the typed text, Lever accepts free-text locations.
    press('Escape', el);
  }

  // ---------------------------------------------------------------- Workday
  const WD_FLOW = '[data-automation-id="applyFlowPage"]';
  const WD_NEXT = 'button[data-automation-id="pageFooterNextButton"], button[data-automation-id="bottom-navigation-next-button"]';
  const WD_NEXT_TEXT = /^\s*(continue|save and continue|next|submit)\s*$/i;
  const WD_BUSY = [
    '[data-automation-id*="loading" i]', '[data-automation-id*="spinner" i]', '[data-automation-id*="skeleton" i]',
    '[class*="skeleton" i]', '[class*="loadingdots" i]', '[aria-busy="true"]', '[role="progressbar"]',
  ].join(', ');
  /**
   * Wait until the step has finished loading: no loading indicator showing and
   * the form unchanged for `quietMs`. Workday renders a step in pieces.
   */
  async function workdaySettle({ timeoutMs = 30000, quietMs = 1500 } = {}) {
    const end = Date.now() + timeoutMs;
    const shown = el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
    let last = null, since = Date.now();
    while (Date.now() < end) {
      const root = document.querySelector(WD_FLOW) || document.body;
      const busy = [...document.querySelectorAll(WD_BUSY)].some(shown);
      const shape = [
        root.querySelectorAll('[data-automation-id^="formField-"]').length,
        [...root.querySelectorAll('input, textarea, select, button')].filter(shown).length,
        [...document.querySelectorAll('button')].filter(shown).length,
        (root.innerText || '').length,
      ].join('/');
      if (busy || shape !== last) { last = shape; since = Date.now(); }
      else if (Date.now() - since >= quietMs) return true;
      await pause(250);
    }
    return false; // still changing: go on with what is there
  }
  function workdayProgress() {
    const label = text(document.querySelector('[data-automation-id="progressBarActiveStep"]'));
    const m = /step\s+(\d+)\s+of\s+(\d+)/i.exec(label);
    return m ? { at: Number(m[1]), of: Number(m[2]) } : null;
  }
  function workdayScanInPage(flow) {
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
      if (month) { add(month, { type: 'date', widget: 'date', label, required: req(month) }); continue; }
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
      if (file) { add(file, { type: 'file', label: label || 'Resume', required: req(file) }); continue; }
      const input = block.querySelector('textarea, input:not([type="hidden"])');
      if (input && visible(input)) add(input, { type: input.tagName === 'TEXTAREA' ? 'textarea' : (input.type || 'text').toLowerCase(), label, required: req(input) });
    }
    // The résumé drop zone on My Experience is not always inside a formField block.
    const drop = document.querySelector(`${flow} input[data-automation-id="file-upload-input-ref"]:not([data-aa-field])`);
    if (drop && !fields.some(f => f.type === 'file')) add(drop, { type: 'file', label: 'Resume/CV', required: true });
    return fields;
  }
  async function workdayReadDropdown(button) {
    try {
      await click(button);
      const options = await waitFor(() => { const all = [...document.querySelectorAll('[role="listbox"] [role="option"]')]; return all.length && visible(all[0]) ? all : null; }, 3000);
      return (options || []).map(o => text(o)).filter(t => t && !/^select one$/i.test(t));
    } catch (_) {
      return [];
    } finally {
      press('Escape');
    }
  }
  /** Search box: type, Enter, pick the closest prompt option (one level deep). */
  async function workdaySearch(el, value) {
    await type(el, value);
    press('Enter', el);
    const options = await waitFor(() => { const all = [...document.querySelectorAll('[data-automation-id="promptOption"], [role="listbox"] [role="option"]')]; return all.length && visible(all[0]) ? all : null; }, 5000);
    if (!options) throw new Error(`No option matching "${value}"`);
    const texts = options.map(o => text(o));
    const best = matchOption(texts, value) || (texts.length === 1 ? texts[0] : null);
    if (!best) throw new Error(`No option matching "${value}"`);
    await click(options[texts.indexOf(best)]);
    press('Escape');
  }
  /** MM/DD/YYYY (or "today") into the month, day and year boxes. */
  async function workdayDate(el, value) {
    const d = /^today$/i.test(value) ? new Date() : new Date(value);
    if (Number.isNaN(d.getTime())) throw new Error(`Not a date: "${value}"`);
    const block = el.closest('[data-automation-id^="formField-"]') || el.parentElement;
    const parts = [
      ['dateSectionMonth-input', String(d.getMonth() + 1).padStart(2, '0')],
      ['dateSectionDay-input', String(d.getDate()).padStart(2, '0')],
      ['dateSectionYear-input', String(d.getFullYear())],
    ];
    for (const [name, digits] of parts) {
      const box = block.querySelector(`[data-automation-id="${name}"]`);
      if (box) { await type(box, digits); box.blur(); }
    }
  }
  async function workdayFooterButton(timeoutMs = 10000) {
    await workdaySettle({ timeoutMs: 15000 });
    const find = () => firstVisible([...document.querySelectorAll(WD_NEXT), ...byText('button', WD_NEXT_TEXT)]);
    return waitFor(find, timeoutMs);
  }
  const workdayStep = () => `${text(document.querySelector('[data-automation-id="progressBarActiveStep"]'))}|${text(document.querySelector(`${WD_FLOW} h2`))}`;
  /** Continue / Save and Continue. null on the last step with a Submit button (left to the user). */
  async function workdayNext() {
    const button = await workdayFooterButton();
    const step = workdayProgress();
    const last = !step || step.at >= step.of;
    if (button && /submit/i.test(text(button))) return null;
    if (!button) {
      if (!last) throw new Error(`Workday step ${step.at} of ${step.of}: no Continue button found`);
      return null;
    }
    await workdaySettle(); // e.g. the résumé still uploading
    const before = workdayStep();
    const name = text(button);
    await click(button, { allowSubmit: true });
    if (await waitFor(() => workdayStep() !== before, 30000)) return { clicked: name };
    const errors = text(document.querySelector('[data-automation-id="errorBanner"]'));
    throw new Error(`Workday did not move past "${before}"${errors ? `: ${errors}` : ''}`);
  }

  // --------------------------------------------------------------- Workable
  async function workableJob() {
    const m = /^\/([^/]+)\/j\/([^/]+)/.exec(location.pathname);
    if (!m) return null;
    const get = url => fetch(url, { credentials: 'include' }).then(r => (r.ok ? r.json() : null)).catch(() => null);
    const [job, account] = await Promise.all([get(`/api/v2/accounts/${m[1]}/jobs/${m[2]}`), get(`/api/v1/accounts/${m[1]}`)]);
    if (!job) return null;
    let description = htmlToText([job.description, job.requirements && `<h3>Requirements</h3>${job.requirements}`, job.benefits && `<h3>Benefits</h3>${job.benefits}`].filter(Boolean).join('\n'));
    if (job.salary_from || job.salary_to) {
      const money = v => (v ? Number(v).toLocaleString('en-US') : '?');
      description += `\n\nSalary: ${`${money(job.salary_from)} - ${money(job.salary_to)} ${job.salary_currency_iso_code || ''} per ${job.salary_frequency || 'year'}`.replace(/\s+/g, ' ')}`;
    }
    const places = (job.locations && job.locations.length ? job.locations : [job.location]).filter(Boolean).map(l => [l.city, l.region, l.country].filter(Boolean).join(', '));
    const where = places.join(' / ');
    return {
      title: job.title || '', company: (account && account.name) || '',
      location: job.workplace && job.workplace !== 'on_site' ? `${where} (${job.workplace.replace('_', '-')})` : where,
      remote: job.workplace === 'remote' || !!job.remote || null, description, source: 'workable',
    };
  }
  function workableScanInPage(formSelector) {
    const form = document.querySelector(formSelector);
    if (!form) return [];
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
    const groups = [...form.querySelectorAll('fieldset')].filter(fs => fs.querySelector('[role="radio"], [role="checkbox"]') && visible(fs));
    for (const fs of groups) {
      const options = [...fs.querySelectorAll('[role="radio"], [role="checkbox"]')];
      const kind = options[0].getAttribute('role');
      const input = fs.querySelector('input');
      const required = options.some(o => o.getAttribute('aria-required') === 'true') || !!(input && input.required);
      const label = labelOf(fs);
      const id = add(fs, {
        type: kind, label, required,
        name: fs.getAttribute('data-ui') || (input && input.name) || '',
        options: options.map(o => text(o)).map((t, i, all) => (all.length === 1 && !t ? label : t)),
      });
      options.forEach((o, i) => o.setAttribute('data-aa-option', `${id}:${i}`));
    }
    for (const el of form.querySelectorAll('input, textarea, select, [role="combobox"]:not(input)')) {
      if (groups.some(fs => fs.contains(el))) continue;
      const tag = el.tagName.toLowerCase();
      let kind = tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : (el.getAttribute('type') || 'text').toLowerCase();
      if (['hidden', 'submit', 'button', 'search'].includes(kind)) continue;
      if (el.getAttribute('aria-hidden') === 'true') continue; // address parts (city/postcode/country)
      if (kind !== 'file' && !visible(el)) continue;
      if (el.closest('[role="listbox"], [role="dialog"]')) continue; // phone country search
      const isCombo = tag !== 'select' && (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-haspopup') === 'listbox' || el.hasAttribute('aria-autocomplete'));
      if (isCombo) kind = 'combobox';
      const label = labelOf(el);
      const required = el.required || el.getAttribute('aria-required') === 'true';
      if (kind === 'checkbox' || kind === 'radio') {
        // A plain consent checkbox; click its label (the input is often hidden).
        const target = visible(el) ? el : el.closest('label') || el;
        const id = add(el, { type: kind, label: label || text(target), required, name: el.name || '', options: [text(target) || label] });
        target.setAttribute('data-aa-option', `${id}:0`);
        continue;
      }
      add(el, {
        type: kind, label, required,
        name: el.getAttribute('name') || el.getAttribute('data-ui') || '',
        options: kind === 'select' ? [...el.options].filter(o => o.value !== '').map(o => text(o)) : kind === 'combobox' ? [] : undefined,
        accept: kind === 'file' ? el.getAttribute('accept') || '' : undefined,
      });
    }
    const order = [...form.querySelectorAll('[data-aa-field]')].map(e => e.getAttribute('data-aa-field'));
    return fields.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  }

  // --------------------------------------------------------------- BambooHR
  function bambooMenus(form) {
    return [...document.querySelectorAll(`${form} [data-fabric-component="SelectField InputWrapper"]`)].map((wrap, i) => {
      const id = `m${i}`;
      const toggle = wrap.querySelector('button[data-menu-id]');
      if (!toggle) return null;
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
        options: [],
      };
    }).filter(Boolean);
  }
  const bambooItems = toggle => [...document.querySelectorAll(`[id="${CSS.escape(toggle.getAttribute('data-menu-id') || '')}"] [role="menuitem"]`)];
  async function bambooReadMenu(toggle) {
    try {
      await click(toggle);
      const items = await waitFor(() => { const all = bambooItems(toggle); return all.length && visible(all[0]) ? all : null; }, 2000);
      return (items || []).map(o => text(o)).filter(Boolean);
    } catch (_) {
      return [];
    } finally {
      press('Escape');
    }
  }

  // ---------------------------------------------------------------- Rippling
  function ripplingJob() {
    let post;
    try { post = JSON.parse(document.getElementById('__NEXT_DATA__').textContent).props.pageProps.apiData.jobPost; } catch (_) { return null; }
    if (!post || !post.description) return null;
    const locations = post.workLocations || [];
    return {
      title: post.name || '', company: post.companyName || '', location: locations.join(' / '),
      remote: locations.some(l => /remote/i.test(l)) || null,
      description: htmlToText([post.description.company, post.description.role].filter(Boolean).join('\n')),
      source: 'rippling',
    };
  }
  function ripplingScanInPage() {
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
      const header = block.querySelector('[id$="-label"]');
      let label = text(header);
      let required = !!(header && /\*/.test(text(header.parentElement)));
      if (!label) {
        const wrap = block.closest('.marginY--36');
        const question = wrap && wrap.querySelector('.paddingX--16 p');
        label = text(question).replace(/\s*\*\s*$/, '');
        const mark = question && (question.querySelector('div') || question.nextElementSibling);
        required = !!mark && mark.tagName === 'DIV' && !text(mark);
      }
      if (!label) label = text(block.previousElementSibling).slice(0, 200);
      const group = block.querySelector('[role="radiogroup"]');
      if (group) {
        const radios = [...group.querySelectorAll('[role="radio"]')];
        const id = add(group, { type: 'radio', label, required, options: radios.map(r => text(r) || r.getAttribute('data-value')) });
        radios.forEach((r, i) => r.setAttribute('data-aa-option', `${id}:${i}`));
        continue;
      }
      for (const el of block.querySelectorAll('input, textarea, [role="combobox"]:not(input)')) {
        const isCombo = el.getAttribute('role') === 'combobox' || el.hasAttribute('aria-autocomplete');
        const kind = isCombo ? 'combobox' : (el.getAttribute('type') || (el.tagName === 'TEXTAREA' ? 'textarea' : 'text')).toLowerCase();
        if (['hidden', 'radio', 'checkbox'].includes(kind)) continue;
        const wrapper = el.parentElement && el.parentElement.closest('[data-testid]:not([data-testid="select-search-input"]):not([data-testid="select-controller"])');
        if (wrapper && /-code$/.test(wrapper.getAttribute('data-testid'))) continue; // phone country code
        if (kind !== 'file' && !visible(el)) continue;
        add(el, {
          type: kind, label,
          required: required || el.required || el.getAttribute('aria-required') === 'true',
          options: isCombo ? [] : undefined,
          accept: kind === 'file' ? el.getAttribute('accept') || '' : undefined,
        });
      }
    }
    return fields;
  }

  // ----------------------------------------------------------- Recruiterflow
  function recruiterflowScanInPage() {
    const fields = [];
    let n = 0;
    const add = (el, field) => {
      const id = `f${n++}`;
      el.setAttribute('data-aa-field', id);
      fields.push({ id, name: el.getAttribute('name') || '', done: el.hasAttribute('data-aa-done'), ...field });
      return id;
    };
    const file = document.querySelector('.form-dnd-container input[type="file"]');
    if (file) {
      const head = file.closest('.form-dnd-container').querySelector('p.form-label');
      add(file, { type: 'file', label: text(head).replace(/\s*\*$/, ''), required: !!(head && head.querySelector('.required')), accept: file.accept });
    }
    for (const head of document.querySelectorAll('.basic-info-inputs-container p.form-label, .additional-info-inputs-container p.form-label')) {
      const wrap = head.parentElement;
      if (!visible(wrap)) continue;
      const question = text(head).replace(/\s*\*$/, '');
      const required = !!head.querySelector('.required');
      const yesno = wrap.querySelector('.yes-no-inputs');
      if (yesno) {
        const buttons = [...yesno.querySelectorAll('button')];
        const id = add(yesno, { type: 'radio', label: question, required, options: buttons.map(text) });
        buttons.forEach((b, i) => b.setAttribute('data-aa-option', `${id}:${i}`));
        continue;
      }
      const controls = [...wrap.querySelectorAll('input:not([type="hidden"]), textarea')]
        .filter(el => !el.closest('.flag-currency-select, .iti__country-container') && el.type !== 'checkbox');
      const many = controls.length > 1;
      for (const el of controls) {
        const combo = el.getAttribute('role') === 'combobox';
        const control = combo && el.closest('[class*="control"]');
        const holder = combo ? text(control && control.querySelector('[class*="placeholder"]')) : el.placeholder;
        const part = /^min$/i.test(holder) ? 'min' : /^max$/i.test(holder) ? 'max' : undefined;
        add(el, {
          type: combo ? 'combobox' : el.tagName === 'TEXTAREA' ? 'textarea' : (el.type || 'text').toLowerCase(),
          label: many && holder && !/click to view/i.test(holder) ? `${question} — ${holder}` : question,
          required, options: combo ? [] : undefined, part,
        });
      }
    }
    for (const box of document.querySelectorAll('.custom-checkbox-container input[type="checkbox"]')) {
      if (!visible(box.parentElement)) continue;
      const statement = text(box.parentElement);
      const id = add(box, { type: 'checkbox', label: statement, required: true, options: [statement] });
      box.setAttribute('data-aa-option', `${id}:0`);
    }
    return fields;
  }

  // ------------------------------------------------------------------- Dover
  const DOVER_FORM = 'form:has(input[name="firstName"])';
  function doverJob() {
    const job = genericJob();
    const d = jsonLdPosting();
    if (d) {
      const places = [].concat(d.applicantLocationRequirements || []).map(p => p && p.name).filter(Boolean).join(', ');
      const v = d.baseSalary && d.baseSalary.value;
      const money = x => `$${Number(x).toLocaleString('en-US')}`;
      const pay = v && v.minValue ? `${money(v.minValue)}${v.maxValue ? ` - ${money(v.maxValue)}` : ''} per ${String(v.unitText || 'year').toLowerCase()}` : '';
      if (!job.location && places) job.location = job.remote ? `Remote (${places})` : places;
      if (pay && !job.description.includes(pay.split(' per ')[0])) job.description = `${job.description.trim()}\n\nCompensation: ${pay}`;
    }
    return { ...job, source: `dover/${job.source}` };
  }
  function doverScanInPage(formSelector) {
    const form = document.querySelector(formSelector);
    if (!form) return [];
    const CONTROLS = 'input:not([type="hidden"]), textarea, select, [role="combobox"]';
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
      const kind = el.tagName === 'TEXTAREA' ? 'textarea' : el.tagName === 'SELECT' ? 'select'
        : el.getAttribute('role') === 'combobox' ? 'combobox' : (el.getAttribute('type') || 'text').toLowerCase();
      const label = questionOf(el);
      if (kind === 'radio' || kind === 'checkbox') {
        const group = el.closest('[role="radiogroup"], [role="group"], .MuiFormGroup-root') || el.parentElement;
        if (groups.has(group)) continue;
        groups.add(group);
        const choices = [...group.querySelectorAll(`input[type="${kind}"]`)];
        const optionText = c => text(c.closest('label')) || c.value;
        const lone = choices.length === 1 && kind === 'checkbox';
        const id = add(choices[0], label || optionText(choices[0]), { type: kind, options: lone ? [optionText(choices[0]) || label] : choices.map(optionText) });
        choices.forEach((c, i) => c.setAttribute('data-aa-option', `${id}:${i}`));
        if (choices.some(c => c.required)) fields[fields.length - 1].required = true;
        continue;
      }
      add(el, label, {
        type: kind,
        options: kind === 'select' ? [...el.options].filter(o => o.value !== '').map(text) : kind === 'combobox' ? [] : undefined,
        accept: kind === 'file' ? el.getAttribute('accept') || '' : undefined,
      });
      if (el.required) fields[fields.length - 1].required = true;
    }
    return fields;
  }
  /** MUI hides the input under a styled span; the surrounding <label> takes the click. */
  async function labelChoiceFill(entry, value) {
    const { raw, members } = entry;
    if (raw.type !== 'radio' && raw.type !== 'checkbox') return genericFill(entry, value);
    for (const v of [].concat(value)) {
      const index = raw.options.indexOf(v);
      if (index < 0) throw new Error(`No option matching "${v}"`);
      const option = members[index];
      if (!option || isChecked(option)) continue;
      const label = option.closest('label');
      await click(label || option);
    }
  }

  // --------------------------------------------------------------------- Gem
  const GEM_ROOT = 'div[class^="formLayout"]:has([class^="primaryApplicationContainer"])';
  function gemScanInPage(rootSelector) {
    const root = document.querySelector(rootSelector);
    if (!root) return [];
    const CONTROLS = 'input:not([type="hidden"]), textarea, select, button';
    const fields = [];
    let n = 0;
    for (const head of root.querySelectorAll('[class^="bodyImportant"]')) {
      let block = head.parentElement;
      while (block && block !== root && !block.querySelector(CONTROLS)) block = block.parentElement;
      if (!block || block === root) continue;
      const label = text(head).replace(/\s*\*$/, '');
      const required = !!head.querySelector('[class^="requiredAsterisk"]');
      const id = `f${n++}`;
      const base = { id, label, required, name: '' };
      const choices = [...block.querySelectorAll('input[type="radio"], input[type="checkbox"]')];
      if (choices.length) {
        const kind = choices[0].type;
        const optionText = c => text(document.querySelector(`label[for="${CSS.escape(c.id)}"]`)) || text(c.parentElement) || c.value;
        choices[0].setAttribute('data-aa-field', id);
        choices.forEach((c, i) => c.setAttribute('data-aa-option', `${id}:${i}`));
        const options = choices.length === 1 && kind === 'checkbox' ? [optionText(choices[0]) || label] : choices.map(optionText);
        fields.push({ ...base, type: kind, done: choices[0].hasAttribute('data-aa-done'), options });
        continue;
      }
      // After an upload the dropzone also shows a remove button, so the file input is looked for first.
      const el = ['input[type="file"]', 'textarea', 'select', 'input:not([type="hidden"])', 'button[type="button"]'].map(s => block.querySelector(s)).find(Boolean);
      if (!el) { n--; continue; }
      const kind = el.tagName === 'BUTTON' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : el.tagName === 'SELECT' ? 'select' : (el.getAttribute('type') || 'text').toLowerCase();
      el.setAttribute('data-aa-field', id);
      fields.push({
        ...base, type: kind, done: el.hasAttribute('data-aa-done'),
        dropdown: el.tagName === 'BUTTON' || undefined,
        options: el.tagName === 'SELECT' ? [...el.options].filter(o => o.value !== '').map(text) : kind === 'select' ? [] : undefined,
        accept: kind === 'file' ? el.getAttribute('accept') || '' : undefined,
      });
    }
    return fields;
  }
  /** The dropdown menu only exists while open. */
  async function gemOpenMenu(button) {
    press('Escape');
    await click(button);
    const items = await waitFor(() => { const all = [...document.querySelectorAll('[role="menuitem"]')].filter(visible); return all.length ? all : null; }, 3000);
    if (!items) throw new Error('The dropdown did not open');
    return items;
  }
  async function gemCloseMenu() {
    press('Escape');
    if (!(await waitFor(() => ![...document.querySelectorAll('[role="menuitem"]')].some(visible), 1500))) clickOutside();
  }

  // ------------------------------------------------------------------ Comeet
  function comeetJob() {
    // POSITION_DATA is a page global; content scripts read it from the inline script.
    for (const script of document.querySelectorAll('script:not([src])')) {
      const at = script.textContent.indexOf('POSITION_DATA');
      if (at < 0) continue;
      const start = script.textContent.indexOf('{', at);
      if (start < 0) continue;
      let depth = 0, quoted = '', escaped = false, end = -1;
      const src = script.textContent;
      for (let i = start; i < src.length; i++) {
        const c = src[i];
        if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === quoted) quoted = ''; continue; }
        if (c === '"' || c === "'") quoted = c;
        else if (c === '{') depth++;
        else if (c === '}' && --depth === 0) { end = i; break; }
      }
      let pos;
      try { pos = JSON.parse(src.slice(start, end + 1)); } catch (_) { continue; }
      if (!pos || !pos.customFields) continue;
      const sections = (pos.customFields.details || []).filter(d => d.value);
      const loc = pos.location || {};
      return {
        title: pos.name || '', company: pos.companyName || '',
        location: loc.name || [loc.city, loc.state, loc.country].filter(Boolean).join(', '),
        remote: pos.workplaceType ? /remote/i.test(pos.workplaceType) : (loc.isRemote ?? null),
        description: htmlToText(sections.map(d => (sections.length > 1 ? `<h3>${d.name}</h3>` : '') + d.value).join('\n')),
        source: 'comeet',
      };
    }
    return null;
  }
  function comeetScanInPage() {
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
    for (const group of form.querySelectorAll('.form-group')) {
      if (group.closest('.form-group-questionnaires') || group.classList.contains('form-group-questionnaires') || !visible(group)) continue;
      const head = group.querySelector('label.control-label');
      const el = group.querySelector('input:not([type="hidden"]), textarea, select');
      if (!head || !el) continue;
      const kind = controlType(el);
      if (kind !== 'file' && !visible(el)) continue;
      add(el, {
        type: kind, label: text(head).replace(/\s*\*$/, ''),
        required: !!head.querySelector('.required-asterisk') || el.required,
        options: kind === 'select' ? [...el.options].filter(o => o.value).map(o => text(o)) : undefined,
        accept: kind === 'file' ? el.getAttribute('accept') || '' : undefined,
      });
    }
    for (const q of form.querySelectorAll('li.question')) {
      if (!visible(q)) continue;
      const head = q.querySelector('.question-title');
      if (!head) continue;
      const title = head.cloneNode(true);
      title.querySelectorAll('.error').forEach(e => e.remove());
      const label = text(title).replace(/\s*\*$/, '');
      const required = !!head.querySelector('.required-asterisk');
      const choices = [...q.querySelectorAll('input[type="radio"], input[type="checkbox"]')];
      if (choices.length) {
        const id = add(choices[0], { type: choices[0].type, label, required, options: choices.map(c => text(q.querySelector(`label[for="${CSS.escape(c.id)}"] .option-title`)) || c.value) });
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

  // -------------------------------------------------------------------- Deel
  function deelJob() {
    const post = jsonLdPosting();
    if (!post || !post.description) return null;
    const shown = document.querySelector('[class*="richTextDisplay"]');
    const address = ([].concat(post.jobLocation || [])[0] || {}).address || {};
    return {
      title: post.title || '', company: (post.hiringOrganization && post.hiringOrganization.name) || '',
      location: [address.addressLocality, address.addressRegion, address.addressCountry].filter(Boolean).join(', '),
      remote: post.jobLocationType ? post.jobLocationType === 'TELECOMMUTE' : null,
      description: shown ? shown.innerText.replace(/\n{3,}/g, '\n\n').trim() : htmlToText(post.description),
      source: 'deel',
    };
  }
  function deelScanInPage() {
    const form = document.getElementById('application-form');
    if (!form) return [];
    const root = form.parentElement;
    const fields = [];
    let n = 0;
    const add = (el, field) => {
      const id = `f${n++}`;
      el.setAttribute('data-aa-field', id);
      fields.push({ id, name: el.getAttribute('name') || '', done: el.hasAttribute('data-aa-done'), ...field });
      return id;
    };
    const strip = s => s.replace(/\s*\*$/, '');
    const typeOf = el => (el.getAttribute('role') === 'combobox' ? 'combobox' : el.tagName === 'TEXTAREA' ? 'textarea' : (el.getAttribute('type') || 'text').toLowerCase());
    for (const el of form.querySelectorAll('input, textarea')) {
      const kind = typeOf(el);
      if (kind === 'hidden' || el.getAttribute('aria-hidden') === 'true' || (kind !== 'file' && !visible(el))) continue;
      if (kind === 'file') {
        add(el, { type: kind, label: strip(el.getAttribute('aria-label') || ''), required: /\*\s*$/.test(el.getAttribute('aria-label') || ''), accept: el.accept });
        continue;
      }
      const head = el.id && form.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      const dial = el.name === 'phoneNumber_dialCode';
      add(el, {
        type: kind,
        label: dial ? 'Country dial code' : strip(text(head)),
        name: dial ? '' : el.name,
        required: !!head && head.classList.contains('Mui-required'),
        options: kind === 'combobox' ? [] : undefined,
      });
    }
    for (const block of root.querySelectorAll('[data-field-id]')) {
      if (!visible(block)) continue;
      const q = text(block.querySelector('p'));
      const label = strip(q);
      const required = /\*$/.test(q);
      const choices = [...block.querySelectorAll('input[type="radio"], input[type="checkbox"]')];
      if (choices.length) {
        const id = add(choices[0], { type: choices[0].type, label, required, options: choices.map(c => { const l = c.closest('label'); return (l && (l.getAttribute('data-text') || text(l))) || c.value; }) });
        choices.forEach((c, i) => c.setAttribute('data-aa-option', `${id}:${i}`));
        continue;
      }
      for (const el of block.querySelectorAll('input, textarea')) {
        const kind = typeOf(el);
        if (kind === 'hidden' || el.getAttribute('aria-hidden') === 'true' || (kind !== 'file' && !visible(el))) continue;
        add(el, { type: kind, label, required, options: kind === 'combobox' ? [] : undefined, accept: kind === 'file' ? el.accept : undefined });
      }
    }
    for (const box of root.querySelectorAll('input[type="checkbox"]')) {
      if (box.closest('[data-field-id]') || box.closest('#application-form')) continue;
      const cell = box.closest('.MuiListItem-root') || box.parentElement;
      const statement = text(cell);
      const id = add(box, { type: 'checkbox', label: statement, required: true, options: [statement] });
      box.setAttribute('data-aa-option', `${id}:0`);
    }
    return fields;
  }

  // --------------------------------------------------------- adapter registry
  // Same order and host rules as ref/src/automation/adapters/index.js.
  const ADAPTERS = [
    { id: 'greenhouse', matches: u => /(^|\.)greenhouse\.io$/i.test(u.hostname),
      job: () => {
        const company = / at (.+)$/.exec(document.title.trim());
        const where = text(document.querySelector('.job__location'));
        const description = (document.querySelector('.job__description') || {}).innerText || '';
        return { title: text(document.querySelector('.job__title h1')), company: company ? company[1].trim() : '', location: where, remote: /remote/i.test(where) || null, description: description.trim(), source: 'greenhouse' };
      },
      scan: () => genericScan('#application-form'),
      submit: () => firstVisible(document.querySelectorAll('#application-form button[type="submit"]')) },
    { id: 'ashby', matches: u => /(^|\.)ashbyhq\.com$/i.test(u.hostname), single: true,
      job: () => {
        const job = genericJob();
        let pay = '';
        for (const h of document.querySelectorAll('h2')) if (/compensation/i.test(h.innerText) && h.nextElementSibling) { pay = h.nextElementSibling.innerText.trim(); break; }
        if (pay && !job.description.includes(pay)) job.description = `${job.description.trim()}\n\nCompensation: ${pay}`;
        return { ...job, source: `ashby/${job.source}` };
      },
      scan: async () => ashbyScanInPage('.ashby-application-form-container'),
      fill: (entry, value) => (entry.raw.type === 'combobox' && value ? pickSuggestion(entry.el, String(value)) : genericFill(entry, value)),
      submit: () => firstVisible(document.querySelectorAll('button.ashby-application-form-submit-button')) },
    { id: 'rippling', matches: u => /(^|\.)rippling\.com$/i.test(u.hostname) && /\/jobs\//.test(u.pathname), single: true,
      job: ripplingJob,
      scan: async () => comboOptions(ripplingScanInPage()),
      fill: (entry, value) => (entry.raw.type === 'combobox' && value ? listedPick(entry, value) : genericFill(entry, value)),
      upload: { label: /r[ée]sum[ée]|\bcv\b/i, request: /parse_resume/, after: 1000 },
      submit: () => firstVisible(byText('button[type="submit"], button', /^\s*(apply|submit( application)?)\s*$/i)) },
    { id: 'recruiterflow', matches: u => /(^|\.)recruiterflow\.com$/i.test(u.hostname) && /\/jobs\//.test(u.pathname), single: true,
      scan: async () => {
        const fields = recruiterflowScanInPage();
        for (const field of fields) {
          if (field.type !== 'combobox' || field.done) continue;
          // Drop junk entries some boards have in their option lists (file URLs).
          field.options = (await readComboboxOptions(tagged(field.id))).filter(o => !/^https?:\/\//.test(o));
        }
        return fields;
      },
      fill: async (entry, value) => {
        if (entry.raw.type === 'combobox' && value) return listedPick(entry, value);
        if (entry.raw.type === 'checkbox') {
          // A styled box: the input itself takes the click; skip it when already ticked.
          if (value && [].concat(value).length && !entry.el.checked) await click(entry.el.parentElement);
          return;
        }
        return genericFill(entry, value);
      },
      submit: () => firstVisible(byText('button', /^\s*submit application\s*$/i)) },
    { id: 'bamboohr', matches: u => /(^|\.)bamboohr\.com$/i.test(u.hostname), single: true,
      scan: async () => {
        const fields = await genericScan('#job-application-form');
        const menus = bambooMenus('#job-application-form');
        for (const m of menus) if (!m.done) m.options = await bambooReadMenu(tagged(m.id));
        // Changing Country resets State, so Country is filled first.
        menus.sort((a, b) => /country/i.test(b.label) - /country/i.test(a.label));
        return [...fields, ...menus];
      },
      fill: async (entry, value) => {
        if (!entry.raw.menu) return genericFill(entry, value);
        if (!value || entry.raw.current === value) return;
        await click(entry.el);
        const items = await waitFor(() => { const all = bambooItems(entry.el); return all.length && visible(all[0]) ? all : null; }, 3000);
        if (!items) throw new Error('The dropdown did not open');
        const texts = items.map(o => text(o));
        const best = matchOption(texts, value);
        if (!best) { press('Escape'); throw new Error(`No option matching "${value}"`); }
        await click(items[texts.indexOf(best)]);
      },
      upload: { request: /attachTemporary/, after: 800 },
      submit: () => firstVisible(byText('button', /^\s*submit application\s*$/i)) },
    { id: 'dover', matches: u => /(^|\.)dover\.com$/i.test(u.hostname) && /^\/apply\//.test(u.pathname), single: true,
      job: doverJob,
      scan: async () => comboOptions(doverScanInPage(DOVER_FORM)),
      fill: (entry, value) => (entry.raw.type === 'combobox' && value ? listedPick(entry, value) : labelChoiceFill(entry, value)),
      submit: () => firstVisible(document.querySelectorAll(`${DOVER_FORM} button[type="submit"]`)) },
    { id: 'gem', matches: u => /^jobs\.gem\.com$/i.test(u.hostname), single: true,
      job: () => { const job = genericJob(); return { ...job, source: `gem/${job.source}` }; },
      scan: async () => {
        const fields = gemScanInPage(GEM_ROOT);
        for (const field of fields) {
          if (!field.dropdown || field.done) continue;
          try { field.options = (await gemOpenMenu(tagged(field.id))).map(o => text(o)).filter(Boolean); }
          catch (_) { field.options = []; }
          finally { await gemCloseMenu(); }
        }
        return fields;
      },
      fill: async (entry, value) => {
        if (!entry.raw.dropdown || !value) return genericFill(entry, value);
        const items = await gemOpenMenu(entry.el);
        const index = items.map(o => text(o)).indexOf(String(value));
        if (index < 0) { press('Escape'); throw new Error(`No option matching "${value}"`); }
        return click(items[index]);
      },
      submit: () => firstVisible(byText('button[type="submit"]', /^\s*apply without saving\s*$/i)) },
    { id: 'comeet', matches: u => /(^|\.)comeet\.(com|co)$/i.test(u.hostname) && /\/jobs\//.test(u.pathname), single: true,
      job: comeetJob,
      scan: async () => comeetScanInPage(),
      fill: async (entry, value) => {
        const { el, raw, members } = entry;
        if (raw.type === 'select' && value && el.tagName === 'A') {
          // Bootstrap dropdown: open it, click the option.
          const index = raw.options.indexOf(String(value));
          if (index < 0) throw new Error(`No option matching "${value}"`);
          await click(el);
          await waitFor(() => visible(members[index]), 1500);
          return click(members[index]);
        }
        if (raw.type === 'checkbox' || raw.type === 'radio') {
          // Inputs are hidden behind a styled label; skip boxes already ticked.
          for (const v of [].concat(value || [])) {
            const index = raw.options.indexOf(v);
            if (index < 0) throw new Error(`No option matching "${v}"`);
            const option = members[index];
            if (!option || option.checked) continue;
            await click(document.querySelector(`label[for="${CSS.escape(option.id)}"]`) || option.closest('label') || option);
          }
          return;
        }
        return genericFill(entry, value);
      },
      submit: () => firstVisible(document.querySelectorAll('#applyForm button.applyButton')) },
    { id: 'deel', matches: u => /^jobs\.deel\.com$/i.test(u.hostname), single: true,
      job: deelJob,
      // The dial code list has every country: leave it to search-as-you-type.
      scan: async () => comboOptions(deelScanInPage(), field => field.label !== 'Country dial code'),
      fill: (entry, value) => (entry.raw.type === 'combobox' && value ? listedPick(entry, value) : labelChoiceFill(entry, value)),
      upload: { busyText: /uploading and processing/i },
      submit: () => firstVisible(byText('button', /^\s*apply\s*$/i)) },
    { id: 'lever', matches: u => /(^|\.)lever\.co$/i.test(u.hostname), single: true,
      job: leverJob,
      scan: async () => leverScanInPage('#application-form'),
      fill: (entry, value) => (entry.raw.type === 'combobox' && value ? leverLocation(entry.el, String(value)) : genericFill(entry, value)),
      upload: { name: /^resume$/, request: /\/parseResume\b/, after: 1000 },
      submit: () => firstVisible(document.querySelectorAll('#btn-submit')) },
    { id: 'workable', matches: u => /^apply\.workable\.com$/i.test(u.hostname), single: true,
      job: workableJob,
      scan: async () => comboOptions(workableScanInPage('form[data-ui="application-form"]')),
      fill: (entry, value) => (entry.raw.type === 'combobox' && value ? listedPick(entry, value) : genericFill(entry, value)),
      upload: { request: /amazonaws\.com/ },
      submit: () => firstVisible(document.querySelectorAll('form[data-ui="application-form"] button[data-ui="apply-button"], form[data-ui="application-form"] button[type="submit"]')) },
    { id: 'workday', matches: u => /\.myworkdayjobs\.com$|(^|\.)myworkdaysite\.com$/i.test(u.hostname),
      scan: async () => {
        await workdaySettle({ timeoutMs: 15000 }); // fills can load more questions (e.g. State after Country)
        const fields = workdayScanInPage(WD_FLOW);
        for (const f of fields) if (f.widget === 'dropdown' && !f.done) f.options = await workdayReadDropdown(tagged(f.id));
        return fields;
      },
      fill: async (entry, value) => {
        if (value == null || value === '') return;
        const { el, raw } = entry;
        if (raw.widget === 'date') return workdayDate(el, String(value));
        if (raw.widget === 'search') return raw.current === value ? undefined : workdaySearch(el, String(value));
        if (raw.widget === 'dropdown') return raw.current === value ? undefined : pickSuggestion(el, String(value), { listed: true });
        return genericFill(entry, value);
      },
      next: workdayNext,
      settle: workdaySettle,
      submit: async () => { const b = await workdayFooterButton(2000); return b && /submit/i.test(text(b)) ? b : null; } },
  ];
  const GENERIC = { id: 'generic', matches: () => true, scan: () => genericScan('body') };
  const adapter = ADAPTERS.find(a => a.matches(new URL(location.href))) || GENERIC;

  // ------------------------------------------------------------ public API
  async function job() {
    let found = null;
    try { found = adapter.job ? await adapter.job() : null; } catch (_) { found = null; }
    if (!found || !found.description) found = genericJob();
    return { title: found.title || document.title, company: found.company || '', location: found.location || '', description: String(found.description || '').slice(0, 200000), source: found.source || adapter.id, url: location.href };
  }

  // Saved application values never go into these (answer-engine.js BLOCKED),
  // and consent / signature controls stay with the user.
  const BLOCKED = /social security|\bssn\b|driver'?s? licen[cs]e|passport|password|bank|routing|credit card|date of birth|\bdob\b|birth ?date/i;
  const MANUAL = /\bsignature\b|\bcertif(?:y|ication)\b|\bconsent\b|\bagree\b|\battest\b|\bterms\b|\bprivacy (?:policy|notice)\b|\bcaptcha\b/i;
  /** answer-engine.js: uploads that are not the résumé. */
  const isResumeUpload = label => !/cover/i.test(label) && !(/portfolio|work sample|writing sample|transcript|additional|other/i.test(label) && !/r[ée]sum[ée]|\bcv\b/i.test(label));

  let scanned = new Map(), scanUrl = '', scanId = '';
  function answeredNow(raw, el, members) {
    if (raw.current) return true;
    if (raw.type === 'radio' || raw.type === 'checkbox') return members.some(isChecked);
    if (raw.type === 'file') return !!(el.files && el.files.length);
    if (raw.dropdown) return !/please select/i.test(text(el)) && !!text(el);
    if (raw.type === 'combobox') {
      const control = el.closest('[class*="__control"],[class*="-control"]') || el.parentElement;
      return !!(el.value || text(control && control.querySelector('[class*="single-value"],[class*="singleValue"],[class*="multi-value__label"]')));
    }
    if (el.tagName === 'SELECT') return [...el.selectedOptions].some(o => o.value !== '' && !PLACEHOLDER.test(text(o)));
    if (el.tagName === 'A') return false;
    return !!String(el.value || '').trim();
  }
  function toField(raw, el, members) {
    const rawLabel = String(raw.label || '');
    const starred = /[*✱]\s*$/.test(rawLabel);
    const label = rawLabel.replace(/\s*[*✱]\s*$/, '').trim().slice(0, 1000) || raw.name || 'Unlabelled field';
    const kind = el.tagName === 'SELECT' && el.multiple ? 'multiselect' : raw.type;
    const options = Array.isArray(raw.options) ? raw.options.map(o => String(o == null ? '' : o).trim()) : [];
    const field = { id: raw.id, scanId, type: kind, name: raw.name || '', label, required: !!raw.required || starred, options, value: kind === 'password' ? '' : (el.value || raw.current || ''), done: !!raw.done, adapter: adapter.id };
    if (raw.hint) field.hint = raw.hint;
    if (raw.part) field.part = raw.part;
    if (el.matches('input,textarea')) {
      field.inputHints = Object.fromEntries(Object.entries({ placeholder: el.getAttribute('placeholder'), autocomplete: el.getAttribute('autocomplete'), inputMode: el.getAttribute('inputmode'), pattern: el.getAttribute('pattern'), maxLength: el.maxLength > 0 ? el.maxLength : null }).filter(([, v]) => v != null && v !== ''));
    }
    if (kind === 'checkbox' || kind === 'multiselect') field.answerFormat = 'multiple';
    else if (kind === 'radio' || kind === 'select') field.answerFormat = 'single';
    else if (kind === 'combobox') field.answerFormat = !options.length ? 'text' : ownsMultiList(el) ? 'multiple' : 'single';
    else field.answerFormat = 'text';
    if (field.answerFormat !== 'text') field.optionsStatus = options.length ? 'complete' : 'unavailable';
    else if (kind === 'combobox') { field.optionsStatus = 'not-applicable'; field.fillMode = 'search'; field.allowFreeText = true; }
    field.answered = answeredNow(raw, el, members);
    if (kind === 'file') {
      field.accept = raw.accept != null ? raw.accept : el.getAttribute('accept') || '';
      field.resumeUpload = isResumeUpload(`${label} ${field.name}`);
    }
    field.manualOnly = (kind === 'file' && !field.resumeUpload) || kind === 'password' || BLOCKED.test(`${label} ${field.name}`) || MANUAL.test(label);
    return field;
  }
  async function scan() {
    scanned = new Map(); scanUrl = location.href; scanId = crypto.randomUUID();
    // Ids are handed out afresh on every scan; drop the previous pass's tags (data-aa-done stays).
    document.querySelectorAll('[data-aa-field], [data-aa-option]').forEach(e => { e.removeAttribute('data-aa-field'); e.removeAttribute('data-aa-option'); });
    const raws = await adapter.scan();
    const fields = [];
    for (const raw of raws) {
      const el = tagged(raw.id);
      if (!el) continue;
      const members = [...document.querySelectorAll(`[data-aa-option^="${CSS.escape(raw.id)}:"]`)]
        .filter(m => m.getAttribute('data-aa-option').split(':')[0] === raw.id)
        .sort((a, b) => Number(a.getAttribute('data-aa-option').split(':')[1]) - Number(b.getAttribute('data-aa-option').split(':')[1]));
      const field = toField(raw, el, members);
      scanned.set(raw.id, { el, members, raw, field });
      fields.push(field);
    }
    return { scanId, url: scanUrl, adapter: adapter.id, fields };
  }
  /** Options are read during the scan (ref adapters); this only confirms the scan is current. */
  async function discoverOptions(ids) {
    if (location.href !== scanUrl || !scanId) throw new Error('The application page changed. Scan questions again before requesting answers.');
    const entries = ids ? ids.map(id => scanned.get(id)) : [...scanned.values()];
    if (entries.some(entry => !entry || !entry.el.isConnected)) throw new Error('An application question changed. Scan questions again.');
    return { scanId, url: scanUrl, fields: entries.map(entry => entry.field) };
  }
  /** Mark every scanned control as handled, so the next scan can tell follow-up questions apart. */
  function markFilled() {
    document.querySelectorAll('[data-aa-field], [data-aa-option]').forEach(el => el.setAttribute('data-aa-done', ''));
  }
  /**
   * Attaching a résumé makes several sites upload and parse it, then refill or
   * re-render the form. Wait for that, as each ref adapter does.
   */
  async function uploadFile(entry, file) {
    const { el, raw, field } = entry;
    if (!field.resumeUpload || !file || file.name !== 'resume.docx') throw new Error('Only the generated resume.docx can be uploaded here.');
    const accept = String(el.accept || '').toLowerCase().split(',').map(v => v.trim()).filter(Boolean);
    if (accept.length && !accept.some(v => ['.docx', MIME, 'application/*', '*/*'].includes(v))) throw new Error('This upload field does not accept DOCX. Choose a file manually.');
    const rule = adapter.upload || {};
    const applies = (!rule.name || rule.name.test(raw.name || '')) && (!rule.label || rule.label.test(raw.label || ''));
    const request = applies && rule.request ? watchRequest(rule.request, 20000) : null;
    entry.uploadArea = el.closest('.file-upload,[role="group"],fieldset,.form-group,[data-automation-id^="formField-"]') || el.parentElement;
    setInputFiles(el, file);
    if (request && (await request) && rule.after) await pause(rule.after);
    if (rule.busyText) {
      const busy = () => byText('div,span,p', rule.busyText).some(visible);
      if (await waitFor(busy, 5000)) await waitFor(() => !busy(), 30000);
    }
    if (adapter.id === 'workday') {
      // Workday lists the file name once read (Autofill with Resume), then refills the fields.
      await waitFor(() => /resume\.docx/i.test(text(document.querySelector(WD_FLOW))), 30000);
      await workdaySettle({ timeoutMs: 60000 });
    }
  }
  async function fill(items) {
    if (location.href !== scanUrl) throw new Error('The application page changed. Scan and review again.');
    const errors = new Map(), work = [];
    for (const item of items) {
      const entry = scanned.get(item.id);
      if (!entry || item.scanId !== scanId || !entry.el.isConnected || entry.field.manualOnly) { errors.set(item.id, 'Field changed or requires manual input. Rescan.'); continue; }
      // A follow-up scan does not reread a handled dropdown; use the options read before.
      if (!entry.raw.options?.length && Array.isArray(item.options) && item.options.length && entry.raw.type === 'combobox') entry.raw.options = item.options;
      work.push({ item, entry, value: item.file ? item.file : item.answer });
    }
    // Files first: an upload can make the site parse the résumé and refill fields.
    for (const { item, entry, value } of work.filter(w => w.entry.raw.type === 'file')) {
      try { await uploadFile(entry, value); } catch (error) { errors.set(item.id, error.message); }
    }
    const rest = work.filter(w => w.entry.raw.type !== 'file' && w.value != null && w.value !== '');
    const batched = new Set(await fillTextBatch(rest));
    for (const { item, entry, value } of rest) {
      if (batched.has(entry.raw.id)) continue;
      try { await (adapter.fill || genericFill)(entry, value); }
      catch (error) { errors.set(item.id, String(error.message || error).split('\n')[0]); } // one bad field doesn't stop the rest
    }
    markFilled();
    return items.map(item => (errors.has(item.id) ? { id: item.id, error: errors.get(item.id) } : { id: item.id, filled: true }));
  }
  // Attaching a file only starts the upload. Wait for the site to finish it.
  async function uploadFinished(id, ms = 45000) {
    const entry = scanned.get(id);
    if (!entry) return { status: 'failed', message: 'The upload field changed. Check it on the form.' };
    const area = () => (entry.uploadArea && entry.uploadArea.isConnected ? entry.uploadArea : document.body);
    const busy = () => [...area().querySelectorAll('[role="progressbar"],progress,[class*="progress" i]')].some(visible);
    await pause(300);
    const until = Date.now() + ms;
    while (busy() && Date.now() < until) await pause(200);
    if (busy()) return { status: 'stuck', message: 'The site started uploading resume.docx but did not finish.' };
    await pause(300);
    if (norm(text(area())).includes('resume docx') || (entry.el.isConnected && entry.el.files && entry.el.files[0] && entry.el.files[0].name === 'resume.docx')) return { status: 'done' };
    return { status: 'failed', message: 'The site did not keep resume.docx.' };
  }

  // ------------------------------------------------------ blockers.js
  const CAPTCHA_FRAMES = [
    'iframe[src*="recaptcha/api2/bframe"]', 'iframe[src*="recaptcha/enterprise/bframe"]',
    'iframe[src*="recaptcha/api2/anchor"]:not([src*="size=invisible"])', 'iframe[src*="recaptcha/enterprise/anchor"]:not([src*="size=invisible"])',
    'iframe[src*="hcaptcha.com"]', 'iframe[src*="challenges.cloudflare.com"]',
  ];
  const CODE_TEXT = /security code|verification code|enter the code|one[- ]time (pass)?code|code (was |has been )?sent|sent (you )?(a|an) (code|email)/i;
  const CODE_INPUT = /code|otp|verif|security|pin/i;
  // Screens only the user can get past. Invisible reCAPTCHA badges don't count.
  function blocker() {
    const shown = el => {
      if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
      const r = el.getBoundingClientRect();
      return r.width > 30 && r.height > 30 && r.right > 0 && r.left < innerWidth && r.top > -r.height;
    };
    const there = el => el.getBoundingClientRect().width > 0 && (!el.checkVisibility || el.checkVisibility({ visibilityProperty: true }));
    for (const sel of CAPTCHA_FRAMES) if ([...document.querySelectorAll(sel)].some(shown)) return { kind: 'captcha', message: 'Solve the CAPTCHA on the page. Auto-fill will continue by itself.' };
    if ([...document.querySelectorAll('input[type="password"]')].some(there)) return { kind: 'login', message: 'This site needs an account. Sign in or create one on the page. Auto-fill will continue by itself.' };
    if (CODE_TEXT.test(document.body ? document.body.innerText : '')) {
      const hint = i => [i.name, i.id, i.placeholder, i.getAttribute('aria-label'), i.autocomplete, i.labels && i.labels[0] && i.labels[0].innerText].join(' ');
      if ([...document.querySelectorAll('input:not([type=hidden])')].some(i => there(i) && CODE_INPUT.test(hint(i)))) return { kind: 'verification-code', message: 'Enter the code the site sent you. Auto-fill will continue by itself.' };
    }
    return null;
  }

  // ------------------------------------------------- navigation (orchestrator.fillForm)
  // Adapter Next first; a page with the adapter's Submit button is the last one
  // (Submit stays with the user); otherwise any visible Next / Continue button.
  async function clickNext() {
    if (adapter.next) return adapter.next();
    // Single-page adapters have no Next of their own (ref nextStep → false):
    // their Submit page is the last one. Generic adapters try Next first.
    let button = adapter.single ? null : genericNext();
    if (!button) {
      if (adapter.submit && (await adapter.submit())) return null;
      if (!adapter.single && genericSubmit()) return null;
      button = genericNext();
    }
    if (!button) return null;
    const name = text(button) || button.value || 'Next';
    // After returning, because the click can replace this page.
    setTimeout(() => { click(button, { allowSubmit: true }).catch(() => button.click()); }, 50);
    return { clicked: name };
  }
  async function settled() {
    if (document.readyState !== 'complete') throw new Error('Page is still loading. Retry after it finishes.');
    if (adapter.settle) return adapter.settle();
    return new Promise(resolve => {
      let quiet;
      const observer = new MutationObserver(() => schedule());
      const finish = () => { clearTimeout(quiet); clearTimeout(limit); observer.disconnect(); resolve(true); };
      const schedule = () => { clearTimeout(quiet); quiet = setTimeout(finish, 1000); };
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      const limit = setTimeout(() => { clearTimeout(quiet); observer.disconnect(); resolve(false); }, 12000);
      schedule();
    });
  }
  globalThis.ResumeApplyPage = { version, job, scan, fill, settled, discoverOptions, blocker, clickNext, uploadFinished, matchOption, adapter: adapter.id };
})();
