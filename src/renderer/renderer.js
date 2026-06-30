(() => {
  const grid = document.getElementById('grid');
  const emptyState = document.getElementById('empty-state');
  const newProfileBtn = document.getElementById('new-profile-btn');
  const emptyCreateBtn = document.getElementById('empty-create-btn');

  const modal = document.getElementById('modal');
  const modalTitle = document.getElementById('modal-title');
  const previewAvatar = document.getElementById('preview-avatar');
  const rerollBtn = document.getElementById('reroll-color');
  const saveBtn = document.getElementById('save-profile');

  const fieldIds = {
    firstName: 'first-name',
    lastName: 'last-name',
    dob: 'dob',
    location: 'location',
    phone: 'phone',
    email: 'email',
    ssn: 'ssn',
    dl: 'dl',
    dlIssuedDate: 'dl-issued',
    dlExpireDate: 'dl-expire',
    linkedin: 'linkedin',
    github: 'github',
    title: 'profile-title',
    saveFolder: 'save-folder',
  };
  const boolFieldIds = {
    linkedinVisible: 'linkedin-visible',
    githubVisible: 'github-visible',
    roleBasedWork: 'role-based-work',
    lastCompanyTailor: 'last-company-tailor',
  };
  const fieldEls = Object.fromEntries(
    Object.entries(fieldIds).map(([key, id]) => [key, document.getElementById(id)])
  );
  const boolFieldEls = Object.fromEntries(
    Object.entries(boolFieldIds).map(([key, id]) => [key, document.getElementById(id)])
  );

  const confirmModal = document.getElementById('confirm');
  const confirmText = document.getElementById('confirm-text');
  const confirmDeleteBtn = document.getElementById('confirm-delete');

  const themeToggleBtn = document.getElementById('theme-toggle');

  /**
   * @typedef {Object} Profile
   * @property {string} id
   * @property {string} color
   * @property {number} createdAt
   * @property {string} firstName
   * @property {string} lastName
   * @property {string} dob
   * @property {string} location
   * @property {string} phone
   * @property {string} email
   * @property {string} ssn
   * @property {string} dl
   * @property {string} dlIssuedDate
   * @property {string} dlExpireDate
   * @property {string} linkedin
   * @property {boolean} linkedinVisible
   * @property {string} github
   * @property {boolean} githubVisible
   * @property {boolean} roleBasedWork
   * @property {boolean} lastCompanyTailor
   * @property {string} title
   * @property {string} saveFolder
   * @property {string} templateId
   * @property {Array<{company:string,title:string,period:string,location:string,bulletsCount:(number|null)}>} workHistory
   * @property {Array<{institution:string,degree:string,period:string}>} education
   * @property {Array<{institution:string,certification:string,date:string}>} certifications
   */
  /** @type {Profile[]} */
  let profiles = [];

  /** Editor state */
  let editor = {
    mode: 'create', // 'create' | 'edit'
    targetId: null,
    color: '#6c8cff',
  };

  /** Pending delete state */
  let pendingDeleteId = null;

  // ---------- Theme ----------

  function getCurrentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light'
      ? 'light'
      : 'dark';
  }

  function applyTheme(theme, persist) {
    const next = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    if (persist) {
      try {
        localStorage.setItem('theme', next);
      } catch (_) {
        /* ignore */
      }
    }
    updateThemeButton(next);
  }

  function updateThemeButton(theme) {
    if (!themeToggleBtn) return;
    const next = theme === 'light' ? 'dark' : 'light';
    themeToggleBtn.setAttribute('aria-label', `Switch to ${next} theme`);
    themeToggleBtn.title = `Switch to ${next} theme`;
  }

  function initTheme() {
    updateThemeButton(getCurrentTheme());

    if (themeToggleBtn) {
      themeToggleBtn.addEventListener('click', () => {
        applyTheme(getCurrentTheme() === 'light' ? 'dark' : 'light', true);
      });
    }

    // Follow the OS theme until the user has made an explicit choice.
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: light)');
      const handler = (e) => {
        let saved = null;
        try {
          saved = localStorage.getItem('theme');
        } catch (_) {
          /* ignore */
        }
        if (saved !== 'light' && saved !== 'dark') {
          applyTheme(e.matches ? 'light' : 'dark', false);
        }
      };
      if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', handler);
      } else if (typeof mq.addListener === 'function') {
        mq.addListener(handler);
      }
    }
  }

  // ---------- Utilities ----------

  function uid() {
    return (
      Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    );
  }

  /**
   * Generate a pleasant random color using HSL.
   * High saturation + medium lightness keeps white text readable.
   */
  function randomColor() {
    const hue = Math.floor(Math.random() * 360);
    const sat = 60 + Math.floor(Math.random() * 25); // 60-85%
    const light = 45 + Math.floor(Math.random() * 12); // 45-57%
    return hslToHex(hue, sat, light);
  }

  function hslToHex(h, s, l) {
    s /= 100;
    l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const color =
        l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      return Math.round(255 * color)
        .toString(16)
        .padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  function initialFor(profile) {
    const source = (profile.firstName || profile.lastName || '').trim();
    if (!source) return '?';
    return source.charAt(0).toUpperCase();
  }

  function normalizeCount(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    if (!isFinite(n) || n < 0) return null;
    return Math.floor(n);
  }

  function fullName(profile) {
    return `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
  }

  function displayName(profile) {
    return fullName(profile) || 'Unnamed profile';
  }

  /**
   * Migrate any older profile shape (e.g. `{ name }`) into the new schema.
   * Always returns a fully-populated profile so the rest of the code can
   * assume every field exists.
   */
  function normalizeProfile(p) {
    if (!p || typeof p !== 'object') return null;
    let firstName = typeof p.firstName === 'string' ? p.firstName : '';
    let lastName = typeof p.lastName === 'string' ? p.lastName : '';
    if (!firstName && !lastName && typeof p.name === 'string') {
      const parts = p.name.trim().split(/\s+/);
      firstName = parts[0] || '';
      lastName = parts.slice(1).join(' ');
    }
    return {
      id: p.id || uid(),
      color: p.color || randomColor(),
      createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
      firstName,
      lastName,
      dob: p.dob || '',
      location: p.location || '',
      phone: p.phone || '',
      email: p.email || '',
      ssn: p.ssn || '',
      dl: p.dl || '',
      dlIssuedDate: p.dlIssuedDate || '',
      dlExpireDate: p.dlExpireDate || '',
      linkedin: p.linkedin || '',
      linkedinVisible:
        typeof p.linkedinVisible === 'boolean' ? p.linkedinVisible : true,
      github: p.github || '',
      githubVisible:
        typeof p.githubVisible === 'boolean' ? p.githubVisible : true,
      roleBasedWork:
        typeof p.roleBasedWork === 'boolean' ? p.roleBasedWork : false,
      lastCompanyTailor:
        typeof p.lastCompanyTailor === 'boolean' ? p.lastCompanyTailor : false,
      // Migrated from the older `seniorityLevel` field.
      title: p.title || p.seniorityLevel || '',
      saveFolder: typeof p.saveFolder === 'string' ? p.saveFolder : '',
      templateId: typeof p.templateId === 'string' && p.templateId ? p.templateId : 'modern',
      // Whether the user has explicitly confirmed a resume template. When
      // false, selecting the profile routes through the template picker once;
      // afterwards it goes straight to the workspace.
      templateChosen: typeof p.templateChosen === 'boolean' ? p.templateChosen : false,
      workHistory: Array.isArray(p.workHistory)
        ? p.workHistory.map((w) => ({
            company: (w && w.company) || '',
            title: (w && w.title) || '',
            period: (w && w.period) || '',
            location: (w && w.location) || '',
            bulletsCount: normalizeCount(w && w.bulletsCount),
          }))
        : [],
      education: Array.isArray(p.education)
        ? p.education.map((e) => ({
            institution: (e && e.institution) || '',
            degree: (e && e.degree) || '',
            period: (e && e.period) || '',
          }))
        : [],
      certifications: Array.isArray(p.certifications)
        ? p.certifications.map((c) => ({
            institution: (c && c.institution) || '',
            certification: (c && c.certification) || '',
            date: (c && c.date) || '',
          }))
        : [],
    };
  }

  // ---------- Persistence ----------

  async function loadProfiles() {
    try {
      const list = await window.api.listProfiles();
      const incoming = Array.isArray(list) ? list : [];
      profiles = incoming.map(normalizeProfile).filter(Boolean);
    } catch (err) {
      console.error(err);
      profiles = [];
    }
    migrateLegacyStyleKeys();
    render();
  }

  /**
   * One-time per-session migration: existing per-profile style was stored
   * as `style:{profileId}`. Templates are now per-(profile, template), so
   * copy any legacy entry to `style:{profileId}:modern` (the previous
   * default template). The legacy key is left untouched so older builds
   * still work if the data is opened in them.
   */
  function migrateLegacyStyleKeys() {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const m = key.match(/^style:([^:]+)$/);
        if (!m) continue;
        const target = `style:${m[1]}:modern`;
        if (localStorage.getItem(target) != null) continue;
        const val = localStorage.getItem(key);
        if (val != null) localStorage.setItem(target, val);
      }
    } catch (_) { /* ignore */ }
  }

  async function persist() {
    try {
      await window.api.saveProfiles(profiles);
    } catch (err) {
      console.error('Failed to save profiles', err);
    }
  }

  // ---------- Rendering ----------

  function render() {
    grid.innerHTML = '';

    if (profiles.length === 0) {
      emptyState.classList.remove('hidden');
      grid.classList.add('hidden');
      return;
    }

    emptyState.classList.add('hidden');
    grid.classList.remove('hidden');

    for (const p of profiles) {
      grid.appendChild(buildTile(p));
    }
  }

  function buildTile(profile) {
    const label = displayName(profile);

    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.tabIndex = 0;
    tile.setAttribute('role', 'button');
    tile.setAttribute('aria-label', `Open profile ${label}`);

    const actions = document.createElement('div');
    actions.className = 'tile-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'icon-btn';
    editBtn.title = 'Edit';
    editBtn.setAttribute('aria-label', `Edit ${label}`);
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditor('edit', profile);
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn danger';
    delBtn.title = 'Delete';
    delBtn.setAttribute('aria-label', `Delete ${label}`);
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openConfirmDelete(profile);
    });

    actions.append(editBtn, delBtn);

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.style.backgroundColor = profile.color;
    avatar.textContent = initialFor(profile);

    const name = document.createElement('div');
    name.className = 'tile-name';
    name.textContent = label;
    name.title = label;

    tile.append(actions, avatar, name);

    tile.addEventListener('click', () => selectProfile(profile));
    tile.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        selectProfile(profile);
      }
    });

    return tile;
  }

  function selectProfile(profile) {
    // Skip the template picker for profiles that have already confirmed a
    // template; only first-timers go through the picker. Users can still
    // change the template later via "Change template" in the workspace.
    if (profile.templateChosen) {
      window.location.hash = `#/profile/${encodeURIComponent(profile.id)}`;
    } else {
      window.location.hash = `#/profile/${encodeURIComponent(profile.id)}/template`;
    }
  }

  // ---------- Router ----------

  function setView(view, profile) {
    document.body.dataset.view = view;
    const subtitle = document.getElementById('subtitle');
    if (subtitle) {
      if (view === 'list') subtitle.textContent = 'Choose a profile to continue';
      else if (view === 'picker') subtitle.textContent = 'Choose a resume template';
    }
    if (view !== 'workspace' && window.App && window.App.Workspace) {
      window.App.Workspace.close();
    }
    if (view === 'picker' && profile) {
      renderPicker(profile);
    }
    if (view === 'workspace' && profile && window.App && window.App.Workspace) {
      window.App.Workspace.open(profile);
    }
  }

  function handleRoute() {
    const hash = window.location.hash || '#/';
    const mt = hash.match(/^#\/profile\/([^/]+)\/template$/);
    if (mt) {
      const id = decodeURIComponent(mt[1]);
      const profile = profiles.find((p) => p.id === id);
      if (!profile) { window.location.hash = '#/'; return; }
      setView('picker', profile);
      return;
    }
    const m = hash.match(/^#\/profile\/([^/]+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const profile = profiles.find((p) => p.id === id);
      if (!profile) { window.location.hash = '#/'; return; }
      setView('workspace', profile);
      return;
    }
    setView('list');
  }

  // ---------- Template picker ----------

  let pickerSelectedId = null;
  let pickerProfile = null;

  function renderPicker(profile) {
    pickerProfile = profile;
    pickerSelectedId = profile.templateId || 'modern';
    const grid = document.getElementById('template-grid');
    const nameEl = document.getElementById('picker-profile-name');
    if (nameEl) nameEl.textContent = displayName(profile);
    if (!grid) return;
    grid.innerHTML = '';
    const templates = (window.App && window.App.Templates && window.App.Templates.list()) || [];
    for (const tpl of templates) {
      grid.appendChild(buildTemplateTile(tpl));
    }
    updatePickerSelection();
  }

  function buildTemplateTile(tpl) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'template-tile';
    tile.dataset.templateId = tpl.id;
    tile.setAttribute('aria-label', `Choose template ${tpl.name}`);

    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'template-thumb-wrap';
    if (typeof tpl.thumbnail === 'function') {
      thumbWrap.innerHTML = tpl.thumbnail();
    } else {
      thumbWrap.innerHTML = '<div class="tpl-thumb tpl-thumb-modern"></div>';
    }

    const meta = document.createElement('div');
    meta.className = 'template-meta';
    const name = document.createElement('div');
    name.className = 'template-name';
    name.textContent = tpl.name || tpl.id;
    const desc = document.createElement('div');
    desc.className = 'template-desc muted small';
    desc.textContent = tpl.description || '';
    meta.append(name, desc);

    tile.append(thumbWrap, meta);
    tile.addEventListener('click', () => {
      pickerSelectedId = tpl.id;
      updatePickerSelection();
    });
    tile.addEventListener('dblclick', () => {
      pickerSelectedId = tpl.id;
      confirmPickerSelection();
    });
    return tile;
  }

  function updatePickerSelection() {
    document.querySelectorAll('.template-tile').forEach((el) => {
      el.classList.toggle('selected', el.dataset.templateId === pickerSelectedId);
    });
    const nextBtn = document.getElementById('picker-next');
    if (nextBtn) nextBtn.disabled = !pickerSelectedId;
  }

  async function confirmPickerSelection() {
    if (!pickerProfile || !pickerSelectedId) return;
    const idx = profiles.findIndex((p) => p.id === pickerProfile.id);
    if (idx >= 0) {
      const changed =
        profiles[idx].templateId !== pickerSelectedId ||
        profiles[idx].templateChosen !== true;
      profiles[idx].templateId = pickerSelectedId;
      // Mark the template as confirmed so future selections skip the picker.
      profiles[idx].templateChosen = true;
      if (changed) await persist();
    }
    window.location.hash = `#/profile/${encodeURIComponent(pickerProfile.id)}`;
  }

  // ---------- Editor (create / edit) ----------

  function readForm() {
    const out = {};
    for (const key of Object.keys(fieldIds)) {
      const el = fieldEls[key];
      out[key] = el ? el.value.trim() : '';
    }
    for (const key of Object.keys(boolFieldIds)) {
      const el = boolFieldEls[key];
      out[key] = el ? !!el.checked : false;
    }
    return out;
  }

  function writeForm(profile) {
    for (const key of Object.keys(fieldIds)) {
      const el = fieldEls[key];
      if (el) el.value = profile[key] || '';
    }
    for (const key of Object.keys(boolFieldIds)) {
      const el = boolFieldEls[key];
      // Default to true when the value is undefined (existing profiles get
      // visibility on by default).
      if (el) el.checked = profile[key] !== false;
    }
  }

  function clearForm() {
    for (const key of Object.keys(fieldIds)) {
      const el = fieldEls[key];
      if (el) el.value = '';
    }
    for (const key of Object.keys(boolFieldIds)) {
      const el = boolFieldEls[key];
      // Visibility toggles default on; the work-mode toggles default off.
      if (el) {
        el.checked = key !== 'roleBasedWork' && key !== 'lastCompanyTailor';
      }
    }
  }

  // ---------- Repeating list helpers (work history / edu / cert) ----------

  const workListEl = document.getElementById('work-history-list');
  const eduListEl = document.getElementById('education-list');
  const certListEl = document.getElementById('certifications-list');

  function makeInput(key, placeholder, value, opts) {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.dataset.k = key;
    inp.placeholder = placeholder;
    inp.autocomplete = 'off';
    inp.value = value || '';
    if (opts && opts.spanFull) inp.classList.add('span-2');
    return inp;
  }

  function makeNumberInput(key, placeholder, value, opts) {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.dataset.k = key;
    inp.placeholder = placeholder || '';
    inp.autocomplete = 'off';
    inp.min = '0';
    inp.step = '1';
    if (opts && typeof opts.max === 'number') inp.max = String(opts.max);
    if (value !== null && value !== undefined && value !== '') {
      inp.value = String(value);
    }
    if (opts && opts.spanFull) inp.classList.add('span-2');
    return inp;
  }

  function makeRemoveBtn(onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'remove-entry';
    btn.title = 'Remove entry';
    btn.setAttribute('aria-label', 'Remove entry');
    btn.textContent = '×';
    btn.addEventListener('click', onClick);
    return btn;
  }

  function buildEntryRow(inputs, onRemove) {
    const row = document.createElement('div');
    row.className = 'entry-row';
    const fields = document.createElement('div');
    fields.className = 'entry-fields';
    for (const inp of inputs) fields.append(inp);
    row.append(makeRemoveBtn(() => onRemove(row)), fields);
    return row;
  }

  /**
   * Work history: company + title + period + location. The title input is
   * always present in the DOM so its value survives toggling role-based off
   * and on; CSS hides it (via `#work-history-list:not(.role-based)`) and the
   * `company` input expands to span two columns when title is hidden.
   */
  function buildWorkRow(entry) {
    const fields = [
      makeInput('company', 'Company name', entry.company),
      makeInput('title', 'Job title', entry.title),
      makeInput('period', 'Period (e.g. 2020 – Present)', entry.period),
      makeInput('location', 'Location', entry.location),
      makeNumberInput(
        'bulletsCount',
        'Number of bullets (leave empty for all)',
        entry.bulletsCount
      ),
    ];
    return buildEntryRow(fields, (row) => row.remove());
  }

  function buildEduRow(entry) {
    const inputs = [
      makeInput('institution', 'Institution', entry.institution, { spanFull: true }),
      makeInput('degree', 'Degree', entry.degree),
      makeInput('period', 'Period', entry.period),
    ];
    return buildEntryRow(inputs, (row) => row.remove());
  }

  function buildCertRow(entry) {
    const inputs = [
      makeInput('certification', 'Certification', entry.certification, { spanFull: true }),
      makeInput('institution', 'Institution', entry.institution),
      makeInput('date', 'Date', entry.date),
    ];
    return buildEntryRow(inputs, (row) => row.remove());
  }

  function readEntries(listEl) {
    const out = [];
    listEl.querySelectorAll('.entry-row').forEach((row) => {
      const entry = {};
      row.querySelectorAll('[data-k]').forEach((el) => {
        const k = el.dataset.k;
        const raw = (el.value || '').trim();
        if (el.type === 'number') {
          entry[k] = raw === '' ? null : normalizeCount(raw);
        } else {
          entry[k] = raw;
        }
      });
      // Keep entries that have at least one meaningful field.
      const hasContent = Object.entries(entry).some(([, v]) => {
        if (v === null || v === undefined) return false;
        if (typeof v === 'number') return v > 0;
        return !!v;
      });
      if (hasContent) out.push(entry);
    });
    return out;
  }

  function setWorkRoleBasedClass(on) {
    workListEl.classList.toggle('role-based', !!on);
  }

  function setWorkTailorClass(on) {
    // In tailor mode the LATEST (first / most recent) work row's company name is
    // chosen by the LLM, so its company input is hidden via CSS.
    workListEl.classList.toggle('last-company-tailor', !!on);
  }

  function populateWorkList(entries, roleBased, tailor) {
    workListEl.innerHTML = '';
    setWorkRoleBasedClass(roleBased);
    setWorkTailorClass(tailor);
    const items = entries && entries.length ? entries : [{}];
    for (const it of items) workListEl.append(buildWorkRow(it));
  }

  function populateEduList(entries) {
    eduListEl.innerHTML = '';
    const items = entries && entries.length ? entries : [{}];
    for (const it of items) eduListEl.append(buildEduRow(it));
  }

  function populateCertList(entries) {
    certListEl.innerHTML = '';
    const items = entries && entries.length ? entries : [{}];
    for (const it of items) certListEl.append(buildCertRow(it));
  }

  function onRoleBasedToggle() {
    setWorkRoleBasedClass(!!boolFieldEls.roleBasedWork.checked);
  }

  function onLastCompanyTailorToggle() {
    setWorkTailorClass(!!boolFieldEls.lastCompanyTailor.checked);
  }

  function openEditor(mode, profile) {
    editor.mode = mode;
    editor.targetId = profile ? profile.id : null;
    editor.color = profile ? profile.color : randomColor();

    modalTitle.textContent = mode === 'edit' ? 'Edit profile' : 'New profile';
    if (profile) writeForm(profile);
    else clearForm();

    const roleBased = !!boolFieldEls.roleBasedWork.checked;
    const tailor = !!boolFieldEls.lastCompanyTailor.checked;
    populateWorkList(profile ? profile.workHistory : [], roleBased, tailor);
    populateEduList(profile ? profile.education : []);
    populateCertList(profile ? profile.certifications : []);

    fieldEls.firstName.style.borderColor = '';
    updatePreview();
    showModal(modal);
    setTimeout(() => fieldEls.firstName.focus(), 0);
  }

  function updatePreview() {
    previewAvatar.style.backgroundColor = editor.color;
    const fn = fieldEls.firstName.value.trim();
    const ln = fieldEls.lastName.value.trim();
    previewAvatar.textContent = initialFor({ firstName: fn, lastName: ln });
  }

  async function saveFromEditor() {
    const data = readForm();
    data.workHistory = readEntries(workListEl);
    data.education = readEntries(eduListEl);
    data.certifications = readEntries(certListEl);

    if (!data.firstName) {
      fieldEls.firstName.focus();
      fieldEls.firstName.style.borderColor = 'var(--danger)';
      return;
    }
    fieldEls.firstName.style.borderColor = '';

    if (editor.mode === 'create') {
      profiles.push({
        id: uid(),
        color: editor.color,
        createdAt: Date.now(),
        ...data,
      });
    } else if (editor.mode === 'edit' && editor.targetId) {
      const idx = profiles.findIndex((p) => p.id === editor.targetId);
      if (idx >= 0) {
        profiles[idx] = {
          ...profiles[idx],
          ...data,
          color: editor.color,
        };
      }
    }

    await persist();
    hideModal(modal);
    render();
  }

  // ---------- Delete confirmation ----------

  function openConfirmDelete(profile) {
    pendingDeleteId = profile.id;
    confirmText.textContent = `"${displayName(profile)}" will be permanently removed. This action cannot be undone.`;
    showModal(confirmModal);
  }

  async function performDelete() {
    if (!pendingDeleteId) return;
    const idToDelete = pendingDeleteId;
    profiles = profiles.filter((p) => p.id !== idToDelete);
    pendingDeleteId = null;
    await persist();
    try {
      await window.api.deleteResume(idToDelete);
    } catch (err) {
      console.error('Failed to delete resume file', err);
    }
    try {
      await window.api.deletePrompt(idToDelete);
    } catch (err) {
      console.error('Failed to delete prompt file', err);
    }
    try {
      await window.api.deleteJd(idToDelete);
    } catch (err) {
      console.error('Failed to delete JD file', err);
    }
    try {
      await window.api.deleteProcesses(idToDelete);
    } catch (err) {
      console.error('Failed to delete processes file', err);
    }
    hideModal(confirmModal);
    render();
  }

  // ---------- Modal helpers ----------

  function showModal(el) {
    el.classList.remove('hidden');
  }

  function hideModal(el) {
    el.classList.add('hidden');
  }

  // ---------- Event wiring ----------

  newProfileBtn.addEventListener('click', () => openEditor('create'));
  emptyCreateBtn.addEventListener('click', () => openEditor('create'));

  const backBtn = document.getElementById('back-btn');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      // "← Profiles" always returns to the profile list. Template changes
      // are available via "Change template" inside the workspace.
      window.location.hash = '#/';
    });
  }

  const pickerBackBtn = document.getElementById('picker-back-btn');
  if (pickerBackBtn) {
    pickerBackBtn.addEventListener('click', () => {
      window.location.hash = '#/';
    });
  }
  const pickerNextBtn = document.getElementById('picker-next');
  if (pickerNextBtn) {
    pickerNextBtn.addEventListener('click', confirmPickerSelection);
  }

  window.addEventListener('hashchange', handleRoute);

  rerollBtn.addEventListener('click', () => {
    editor.color = randomColor();
    updatePreview();
  });

  fieldEls.firstName.addEventListener('input', updatePreview);
  fieldEls.lastName.addEventListener('input', updatePreview);

  // Submit on Enter from any text-like field (skip date inputs, which use Enter natively).
  for (const [key, el] of Object.entries(fieldEls)) {
    if (!el) continue;
    if (key === 'dob' || key === 'dlIssuedDate' || key === 'dlExpireDate') {
      continue;
    }
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveFromEditor();
      }
    });
  }

  saveBtn.addEventListener('click', saveFromEditor);

  // Repeating-list controls
  boolFieldEls.roleBasedWork.addEventListener('change', onRoleBasedToggle);
  boolFieldEls.lastCompanyTailor.addEventListener('change', onLastCompanyTailorToggle);

  // Save folder picker (uses native folder dialog via IPC).
  const saveFolderPickBtn = document.getElementById('save-folder-pick');
  if (saveFolderPickBtn) {
    saveFolderPickBtn.addEventListener('click', async () => {
      const current = (fieldEls.saveFolder && fieldEls.saveFolder.value) || '';
      try {
        const result = await window.api.pickFolder(current || undefined);
        if (result && !result.canceled && result.path) {
          fieldEls.saveFolder.value = result.path;
        }
      } catch (err) {
        console.error('pickFolder failed', err);
      }
    });
  }
  const saveFolderClearBtn = document.getElementById('save-folder-clear');
  if (saveFolderClearBtn) {
    saveFolderClearBtn.addEventListener('click', () => {
      if (fieldEls.saveFolder) fieldEls.saveFolder.value = '';
    });
  }

  document.getElementById('add-work').addEventListener('click', () => {
    workListEl.append(buildWorkRow({}));
    const last = workListEl.lastElementChild;
    if (last) last.querySelector('input')?.focus();
  });
  document.getElementById('add-education').addEventListener('click', () => {
    eduListEl.append(buildEduRow({}));
    eduListEl.lastElementChild?.querySelector('input')?.focus();
  });
  document.getElementById('add-certification').addEventListener('click', () => {
    certListEl.append(buildCertRow({}));
    certListEl.lastElementChild?.querySelector('input')?.focus();
  });

  modal.querySelectorAll('[data-close]').forEach((el) =>
    el.addEventListener('click', () => hideModal(modal))
  );
  confirmModal.querySelectorAll('[data-confirm-close]').forEach((el) =>
    el.addEventListener('click', () => {
      pendingDeleteId = null;
      hideModal(confirmModal);
    })
  );

  confirmDeleteBtn.addEventListener('click', performDelete);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!modal.classList.contains('hidden')) hideModal(modal);
      if (!confirmModal.classList.contains('hidden')) {
        pendingDeleteId = null;
        hideModal(confirmModal);
      }
    }
  });

  // ---------- Backup / Restore ----------

  const backupBtn = document.getElementById('backup-btn');
  const restoreBtn = document.getElementById('restore-btn');
  const restoreModal = document.getElementById('restore-modal');
  const restoreSummary = document.getElementById('restore-summary');
  const restoreConfirmBtn = document.getElementById('restore-confirm');

  /** Pending restore payload (set when the user picks a file). */
  let pendingRestorePayload = null;

  /**
   * Read every `style:<id>` entry from localStorage so it travels with
   * the backup. Theme preference is intentionally excluded - it's a
   * personal UI choice rather than profile data.
   */
  function gatherStylesFromLocalStorage() {
    const styles = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith('style:')) continue;
        const id = key.slice('style:'.length);
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        try {
          styles[id] = JSON.parse(raw);
        } catch (_) {
          // Keep the raw string if it's not JSON (shouldn't happen).
          styles[id] = raw;
        }
      }
    } catch (_) { /* localStorage may be unavailable */ }
    return styles;
  }

  function applyStylesToLocalStorage(styles) {
    if (!styles || typeof styles !== 'object') return 0;
    let count = 0;
    try {
      // Drop existing style:* entries first so removed profiles disappear.
      const drop = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('style:')) drop.push(key);
      }
      for (const k of drop) localStorage.removeItem(k);

      for (const [id, value] of Object.entries(styles)) {
        const safe = String(id).replace(/[^a-zA-Z0-9_:-]/g, '_');
        if (!safe) continue;
        const text = typeof value === 'string' ? value : JSON.stringify(value);
        localStorage.setItem(`style:${safe}`, text);
        count++;
      }
    } catch (_) { /* ignore */ }
    return count;
  }

  function showBackupToast(text, opts) {
    const ws = window.App && window.App.Workspace;
    if (ws && typeof ws.showToast === 'function') {
      ws.showToast(text, opts);
    } else {
      console.log('[backup]', text);
    }
  }

  async function runBackup() {
    if (!backupBtn) return;
    const original = backupBtn.textContent;
    backupBtn.disabled = true;
    backupBtn.textContent = 'Backing up…';
    try {
      const payload = await window.api.gatherBackup();
      if (!payload || typeof payload !== 'object') {
        showBackupToast('Backup failed: empty payload from main process.', { kind: 'error' });
        return;
      }
      payload.styles = gatherStylesFromLocalStorage();

      const result = await window.api.saveBackup(payload);
      if (!result || result.canceled) return;
      if (result.error) {
        showBackupToast(`Backup failed: ${result.error}`, { kind: 'error' });
        return;
      }
      const counts =
        `${(payload.profiles || []).length} profile(s), ` +
        `${Object.keys(payload.resumes || {}).length} resume(s), ` +
        `${Object.keys(payload.prompts || {}).length} prompt(s), ` +
        `${Object.keys(payload.jds || {}).length} JD(s)`;
      showBackupToast(`Backup saved · ${counts}`, {
        actionLabel: 'Reveal',
        onAction: () => window.api.revealInFolder(result.path),
      });
    } catch (err) {
      console.error('runBackup failed:', err);
      showBackupToast(`Backup failed: ${err.message || err}`, { kind: 'error' });
    } finally {
      backupBtn.disabled = false;
      backupBtn.textContent = original;
    }
  }

  async function startRestore() {
    try {
      const result = await window.api.pickBackup();
      if (!result || result.canceled) return;
      if (result.error) {
        showBackupToast(`Restore failed: ${result.error}`, { kind: 'error' });
        return;
      }
      pendingRestorePayload = result.payload;
      const created = pendingRestorePayload.createdAt
        ? new Date(pendingRestorePayload.createdAt).toLocaleString()
        : 'unknown date';
      const counts =
        `${(pendingRestorePayload.profiles || []).length} profile(s), ` +
        `${Object.keys(pendingRestorePayload.resumes || {}).length} resume(s), ` +
        `${Object.keys(pendingRestorePayload.prompts || {}).length} prompt(s), ` +
        `${Object.keys(pendingRestorePayload.jds || {}).length} JD(s)`;
      if (restoreSummary) {
        restoreSummary.textContent =
          `Backup created ${created} · ${counts}`;
      }
      showModal(restoreModal);
    } catch (err) {
      console.error('startRestore failed:', err);
      showBackupToast(`Restore failed: ${err.message || err}`, { kind: 'error' });
    }
  }

  function closeRestoreModal() {
    pendingRestorePayload = null;
    hideModal(restoreModal);
  }

  async function confirmRestore() {
    if (!pendingRestorePayload) {
      closeRestoreModal();
      return;
    }
    const payload = pendingRestorePayload;
    pendingRestorePayload = null;
    hideModal(restoreModal);

    // Force-close the workspace so it stops referencing about-to-be-replaced
    // resume/prompt/style state. Then bounce back to the list view.
    if (window.App && window.App.Workspace) {
      try { window.App.Workspace.close(); } catch (_) { /* ignore */ }
    }
    if (window.location.hash !== '#/' && window.location.hash !== '') {
      window.location.hash = '#/';
    }

    try {
      const result = await window.api.applyBackup(payload);
      if (!result || result.error) {
        showBackupToast(
          `Restore failed: ${(result && result.error) || 'unknown error'}`,
          { kind: 'error' }
        );
        return;
      }
      const styleCount = applyStylesToLocalStorage(payload.styles || {});
      const c = result.counts || {};
      const summary =
        `Restored ${c.profiles || 0} profile(s), ` +
        `${c.resumes || 0} resume(s), ` +
        `${c.prompts || 0} prompt(s), ` +
        `${c.jds || 0} JD(s)` +
        (styleCount ? `, ${styleCount} style(s)` : '');
      await loadProfiles();
      handleRoute();
      showBackupToast(summary);
    } catch (err) {
      console.error('confirmRestore failed:', err);
      showBackupToast(`Restore failed: ${err.message || err}`, { kind: 'error' });
    }
  }

  if (backupBtn) backupBtn.addEventListener('click', runBackup);
  if (restoreBtn) restoreBtn.addEventListener('click', startRestore);
  if (restoreConfirmBtn) restoreConfirmBtn.addEventListener('click', confirmRestore);
  if (restoreModal) {
    restoreModal.querySelectorAll('[data-restore-close]').forEach((el) => {
      el.addEventListener('click', closeRestoreModal);
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && restoreModal && !restoreModal.classList.contains('hidden')) {
      closeRestoreModal();
    }
  });

  initTheme();
  loadProfiles().then(() => handleRoute());
})();
