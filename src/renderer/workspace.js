/**
 * Profile workspace: JSON resume editor with live template preview, style
 * customization, and PDF export. Exposes window.App.Workspace.
 */
(function () {
  const $ = (id) => document.getElementById(id);

  let inited = false;
  let currentProfile = null;
  /** @type {any} */
  let currentResume = null;
  /** @type {Record<string, unknown>} */
  let currentStyle = {};
  let parseTimer = null;
  let saveTimer = null;
  let promptSaveTimer = null;
  let jdSaveTimer = null;
  let toastTimer = null;
  let workspaceToken = 0;

  // PDF preview state
  let currentPdfUrl = null;
  let pdfRenderInFlight = false;
  let pdfRenderQueued = false;
  let pdfRenderToken = 0;

  function init() {
    if (inited) return;
    inited = true;
    bindEvents();
  }

  function currentTemplateId() {
    return (currentProfile && currentProfile.templateId) || 'classic';
  }

  function currentTemplate() {
    return window.App.Templates.get(currentTemplateId());
  }

  function bindEvents() {
    const editor = $('resume-json');
    editor.addEventListener('input', () => {
      clearTimeout(parseTimer);
      parseTimer = setTimeout(parseAndRender, 250);
    });
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        const val = editor.value;
        editor.value = val.substring(0, start) + '  ' + val.substring(end);
        editor.selectionStart = editor.selectionEnd = start + 2;
        editor.dispatchEvent(new Event('input'));
      }
    });

    const promptInput = $('resume-prompt');
    promptInput.addEventListener('input', () => {
      setPromptStatus('Saving…');
      clearTimeout(promptSaveTimer);
      promptSaveTimer = setTimeout(persistPrompt, 350);
    });

    const jdInput = $('resume-jd');
    if (jdInput) {
      jdInput.addEventListener('input', () => {
        setJdStatus('Saving…');
        clearTimeout(jdSaveTimer);
        jdSaveTimer = setTimeout(persistJd, 350);
      });
    }

    const generateBtn = $('generate-prompt-btn');
    if (generateBtn) generateBtn.addEventListener('click', regeneratePrompt);

    const copyBtn = $('copy-prompt-btn');
    if (copyBtn) copyBtn.addEventListener('click', () => copyPromptToClipboard(copyBtn));

    const pasteJdBtn = $('paste-jd-btn');
    if (pasteJdBtn) pasteJdBtn.addEventListener('click', () => pasteJd(pasteJdBtn));

    const pasteJsonBtn = $('paste-json-btn');
    if (pasteJsonBtn) {
      pasteJsonBtn.addEventListener('click', () => pasteJsonAndExport(pasteJsonBtn));
    }

    $('export-pdf-btn').addEventListener('click', exportPdf);
    $('reset-resume-btn').addEventListener('click', resetFromProfile);

    const manageBtn = $('manage-process-btn');
    if (manageBtn) {
      manageBtn.addEventListener('click', () => {
        if (!currentProfile) return;
        if (window.App && window.App.Process) {
          window.App.Process.open(currentProfile);
        }
      });
    }

    const changeTplBtn = $('change-template-btn');
    if (changeTplBtn) {
      changeTplBtn.addEventListener('click', () => {
        if (!currentProfile) return;
        window.location.hash = `#/profile/${encodeURIComponent(currentProfile.id)}/template`;
      });
    }

    bindPaneToggles();
    bindCustomizeToggle();
    bindProfileDetail();
  }

  // ---------- Customize toolbar collapse ----------

  const CUSTOMIZE_STORAGE_KEY = 'customizeCollapsed';

  function bindCustomizeToggle() {
    const btn = $('customize-toggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const section = $('customize-section');
      const collapsed = !(section && section.classList.contains('is-collapsed'));
      applyCustomizeCollapsed(collapsed);
      try {
        localStorage.setItem(CUSTOMIZE_STORAGE_KEY, collapsed ? '1' : '0');
      } catch (_) {
        /* storage may be unavailable, just skip */
      }
    });

    let collapsed = false;
    try {
      collapsed = localStorage.getItem(CUSTOMIZE_STORAGE_KEY) === '1';
    } catch (_) {
      collapsed = false;
    }
    applyCustomizeCollapsed(collapsed);
  }

  function applyCustomizeCollapsed(collapsed) {
    const section = $('customize-section');
    const btn = $('customize-toggle');
    if (section) section.classList.toggle('is-collapsed', !!collapsed);
    if (btn) btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }

  // ---------- Profile detail modal ----------
  //
  // Clicking the workspace avatar opens a modal that shows the full profile
  // information (personal, online, settings, work history, education,
  // certifications). The modal is read-only — it just visualizes whatever
  // is on the currentProfile object.

  function bindProfileDetail() {
    const wsAvatar = $('ws-avatar');
    if (wsAvatar) {
      wsAvatar.setAttribute('role', 'button');
      wsAvatar.setAttribute('tabindex', '0');
      wsAvatar.setAttribute('aria-label', 'Show profile details');
      wsAvatar.title = 'Show profile details';
      wsAvatar.addEventListener('click', openProfileDetail);
      wsAvatar.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openProfileDetail();
        }
      });
    }

    document.querySelectorAll('[data-detail-close]').forEach((el) => {
      el.addEventListener('click', closeProfileDetail);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const m = $('profile-detail-modal');
      if (m && !m.classList.contains('hidden')) closeProfileDetail();
    });
  }

  function openProfileDetail() {
    if (!currentProfile) return;
    const modal = $('profile-detail-modal');
    if (!modal) return;

    const avatar = $('detail-avatar');
    const nameEl = $('detail-name');
    const subEl = $('detail-subtitle');
    const body = $('detail-body');

    if (avatar) {
      avatar.style.backgroundColor = currentProfile.color || '#6c8cff';
      avatar.textContent = (
        currentProfile.firstName ||
        currentProfile.lastName ||
        '?'
      )
        .charAt(0)
        .toUpperCase();
    }

    const fullName = `${currentProfile.firstName || ''} ${currentProfile.lastName || ''}`
      .trim() || 'Unnamed profile';
    if (nameEl) nameEl.textContent = fullName;

    if (subEl) {
      const sub = [];
      if (currentProfile.title) sub.push(currentProfile.title);
      const tpl = window.App.Templates.get(currentProfile.templateId || 'classic');
      if (tpl) sub.push(`Template: ${tpl.name}`);
      subEl.textContent = sub.join(' \u00B7 ');
    }

    if (body) body.innerHTML = renderProfileDetail(currentProfile);

    modal.classList.remove('hidden');
  }

  function closeProfileDetail() {
    const modal = $('profile-detail-modal');
    if (modal) modal.classList.add('hidden');
  }

  function renderProfileDetail(p) {
    const out = [];

    const personal = [
      ['Date of birth', formatDob(p.dob)],
      ['Location', p.location],
      ['Phone', p.phone],
      ['Email', p.email],
      ['SSN', p.ssn],
      ["Driver's license #", p.dl],
      ['DL issued', p.dlIssuedDate],
      ['DL expires', p.dlExpireDate],
    ].filter(([, v]) => v && String(v).trim());
    if (personal.length) {
      out.push(detailGridSection('Personal', personal));
    }

    const online = [];
    if (p.linkedin) {
      const tag = p.linkedinVisible === false
        ? ' <span class="muted small">(hidden on resume)</span>' : '';
      online.push([
        'LinkedIn',
        `<a href="${escAttr(p.linkedin)}" target="_blank" rel="noopener noreferrer">${escHtml(p.linkedin)}</a>${tag}`,
      ]);
    }
    if (p.github) {
      const tag = p.githubVisible === false
        ? ' <span class="muted small">(hidden on resume)</span>' : '';
      online.push([
        'GitHub',
        `<a href="${escAttr(p.github)}" target="_blank" rel="noopener noreferrer">${escHtml(p.github)}</a>${tag}`,
      ]);
    }
    if (online.length) {
      out.push(detailGridSection('Online', online, { rawHtml: true }));
    }

    const tpl = window.App.Templates.get(p.templateId || 'classic');
    const settings = [
      ['Title', p.title],
      ['Template', tpl ? tpl.name : 'Modern'],
      ['Save folder', p.saveFolder],
    ].filter(([, v]) => v != null && String(v).trim() !== '');
    out.push(detailGridSection('Settings', settings));

    const wh = Array.isArray(p.workHistory) ? p.workHistory : [];
    if (wh.length) {
      const items = wh
        .map((it) => {
          if (!it || typeof it !== 'object') return '';
          const titleParts = [it.title, it.company].filter(Boolean).map(escHtml);
          const heading = titleParts.length
            ? titleParts.join(' \u00B7 ')
            : '<span class="detail-empty">(empty entry)</span>';
          const meta = [it.period, it.location, it.workType, it.workArrangement].filter(Boolean).map(escHtml).join(' \u00B7 ');
          const bullets = (typeof it.bulletsCount === 'number' && it.bulletsCount >= 0)
            ? `${it.bulletsCount} bullet${it.bulletsCount === 1 ? '' : 's'}`
            : 'all bullets from JSON';
          return `<li>
            <div class="item-title">${heading}</div>
            ${meta ? `<div class="item-meta">${meta}</div>` : ''}
            <div class="item-meta">${escHtml(bullets)}</div>
          </li>`;
        })
        .filter(Boolean)
        .join('');
      if (items) {
        out.push(`<section class="detail-section"><h3>Work History</h3><ul class="detail-list">${items}</ul></section>`);
      }
    }

    const edu = Array.isArray(p.education) ? p.education : [];
    if (edu.length) {
      const items = edu
        .map((it) => {
          if (!it || typeof it !== 'object') return '';
          const heading = it.institution
            ? escHtml(it.institution)
            : '<span class="detail-empty">(empty entry)</span>';
          const meta = [it.degree, it.period].filter(Boolean).map(escHtml).join(' \u00B7 ');
          if (!it.institution && !it.degree && !it.period) return '';
          return `<li>
            <div class="item-title">${heading}</div>
            ${meta ? `<div class="item-meta">${meta}</div>` : ''}
          </li>`;
        })
        .filter(Boolean)
        .join('');
      if (items) {
        out.push(`<section class="detail-section"><h3>Education</h3><ul class="detail-list">${items}</ul></section>`);
      }
    }

    const certs = Array.isArray(p.certifications) ? p.certifications : [];
    if (certs.length) {
      const items = certs
        .map((it) => {
          if (!it || typeof it !== 'object') return '';
          const heading = it.certification || it.institution
            ? escHtml(it.certification || it.institution)
            : '<span class="detail-empty">(empty entry)</span>';
          const meta = [
            it.certification ? it.institution : '',
            it.date,
          ].filter(Boolean).map(escHtml).join(' \u00B7 ');
          if (!it.certification && !it.institution && !it.date) return '';
          return `<li>
            <div class="item-title">${heading}</div>
            ${meta ? `<div class="item-meta">${meta}</div>` : ''}
          </li>`;
        })
        .filter(Boolean)
        .join('');
      if (items) {
        out.push(`<section class="detail-section"><h3>Certifications</h3><ul class="detail-list">${items}</ul></section>`);
      }
    }

    return out.join('') || '<p class="muted">No details to show.</p>';
  }

  function detailGridSection(title, rows, opts) {
    if (!rows || !rows.length) return '';
    const rawHtml = !!(opts && opts.rawHtml);
    const cells = rows
      .map(([k, v]) => {
        const val = rawHtml ? String(v) : escHtml(String(v));
        return `<div class="detail-key">${escHtml(k)}</div><div class="detail-val">${val}</div>`;
      })
      .join('');
    return `<section class="detail-section"><h3>${escHtml(title)}</h3><div class="detail-grid">${cells}</div></section>`;
  }

  function formatDob(dob) {
    if (!dob) return '';
    const age = calcAge(dob);
    return age != null ? `${dob} (age ${age})` : dob;
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function escAttr(s) { return escHtml(s); }

  // ---------- Editor pane collapse / expand ----------
  //
  // Each editor pane (Prompt, JD, JSON) has a small chevron button in its
  // toolbar that hides the textarea and collapses the pane down to the
  // toolbar. The collapsed/expanded state is persisted globally (it's a UI
  // preference, not per-profile) so it survives reloads and profile changes.

  const PANE_KEYS = ['prompt', 'jd', 'json'];
  const PANE_STORAGE_KEY = 'paneCollapsed';

  function loadPaneState() {
    try {
      const raw = localStorage.getItem(PANE_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function savePaneState(state) {
    try {
      localStorage.setItem(PANE_STORAGE_KEY, JSON.stringify(state));
    } catch (_) {
      /* storage may be unavailable, just skip */
    }
  }

  function paneFor(key) {
    return document.querySelector(`.editor-pane[data-pane="${key}"]`);
  }

  function bindPaneToggles() {
    document.querySelectorAll('[data-pane-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-pane-toggle');
        const pane = paneFor(key);
        if (!pane) return;
        const collapsed = !pane.classList.contains('is-collapsed');
        applyPaneCollapsed(key, collapsed);
        const state = loadPaneState();
        state[key] = collapsed;
        savePaneState(state);
      });
    });
    // Restore on first init so the workspace opens in the user's last layout.
    applyPaneStateFromStorage();
  }

  function applyPaneCollapsed(key, collapsed) {
    const pane = paneFor(key);
    if (!pane) return;
    pane.classList.toggle('is-collapsed', !!collapsed);
    const btn = pane.querySelector(`[data-pane-toggle="${key}"]`);
    if (btn) {
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      const labelMap = { prompt: 'prompt', jd: 'job description', json: 'resume JSON' };
      const action = collapsed ? 'Show' : 'Hide';
      const label = `${action} ${labelMap[key] || key}`;
      btn.setAttribute('title', label);
      btn.setAttribute('aria-label', label);
    }
    updateRightStackRows();
  }

  function applyPaneStateFromStorage() {
    const state = loadPaneState();
    PANE_KEYS.forEach((k) => applyPaneCollapsed(k, state[k] === true));
  }

  /**
   * Rebalance the right-stack grid so collapsed panes only take their
   * toolbar height while expanded panes share the remaining space.
   * When nothing is collapsed we clear the inline style so the CSS
   * (including the responsive @media override) takes over again.
   */
  function updateRightStackRows() {
    const stack = document.querySelector('.right-stack');
    if (!stack) return;
    const anyCollapsed = PANE_KEYS.some((k) => {
      const pane = paneFor(k);
      return pane && pane.classList.contains('is-collapsed');
    });
    if (!anyCollapsed) {
      stack.style.gridTemplateRows = '';
      return;
    }
    const defaultRows = ['minmax(120px, 1fr)', 'minmax(120px, 1fr)', 'minmax(140px, 1.2fr)'];
    const rows = PANE_KEYS.map((k, i) => {
      const pane = paneFor(k);
      if (pane && pane.classList.contains('is-collapsed')) return 'auto';
      return defaultRows[i];
    });
    stack.style.gridTemplateRows = rows.join(' ');
  }

  // ---------- Dynamic customize bar (per template) ----------

  function buildCustomizeBar() {
    const bar = $('customize-bar');
    if (!bar) return;
    bar.innerHTML = '';
    const tpl = currentTemplate();
    const controls = (tpl && tpl.controls) || [];

    let lastGroup = null;
    for (const c of controls) {
      // Insert a small divider/label whenever the control group changes so the
      // (now long) toolbar reads as Name / Title / Headings / Body / etc.
      const g = c.group || '';
      if (g !== lastGroup) {
        lastGroup = g;
        if (g) {
          const gl = document.createElement('div');
          gl.className = 'customize-group-label';
          gl.textContent = g;
          bar.appendChild(gl);
        }
      }

      const group = document.createElement('div');
      group.className = 'customize-group';
      const label = document.createElement('label');
      label.className = 'field-label inline';
      label.textContent = c.label;

      if (c.type === 'color') {
        label.setAttribute('for', `style-${c.key}`);
        const inp = document.createElement('input');
        inp.type = 'color';
        inp.id = `style-${c.key}`;
        inp.dataset.styleKey = c.key;
        inp.value = String(currentStyle[c.key] != null ? currentStyle[c.key] : c.default);
        inp.addEventListener('input', (e) => {
          currentStyle[c.key] = e.target.value;
          saveStyle();
          updatePreview();
        });
        group.append(label, inp);
      } else if (c.type === 'font') {
        label.setAttribute('for', `style-${c.key}`);
        const sel = document.createElement('select');
        sel.id = `style-${c.key}`;
        sel.className = 'select';
        sel.dataset.styleKey = c.key;
        for (const f of window.App.Fonts.list()) {
          const opt = document.createElement('option');
          opt.value = f.id;
          opt.textContent = f.name;
          sel.appendChild(opt);
        }
        sel.value = String(currentStyle[c.key] != null ? currentStyle[c.key] : c.default);
        sel.addEventListener('change', (e) => {
          currentStyle[c.key] = e.target.value;
          saveStyle();
          updatePreview();
        });
        group.append(label, sel);
      } else if (c.type === 'range') {
        label.setAttribute('for', `style-${c.key}`);
        const step = c.step || 0.05;
        const initial = currentStyle[c.key] != null ? currentStyle[c.key] : c.default;

        // Editable number input so an exact size/spacing value can be typed.
        const num = document.createElement('input');
        num.type = 'number';
        num.id = `style-${c.key}`;
        num.className = 'style-range-input';
        num.dataset.styleKey = c.key;
        num.min = String(c.min);
        num.max = String(c.max);
        num.step = String(step);
        num.value = String(initial);

        const unitSpan = document.createElement('span');
        unitSpan.className = 'muted small style-range-unit';
        unitSpan.textContent = rangeUnitLabel(c.unit);

        // Clamp to the control's [min, max] so typed values stay valid.
        const clamp = (v) => Math.min(c.max, Math.max(c.min, v));
        const commit = (raw, normalize) => {
          let v = parseFloat(raw);
          if (!isFinite(v)) v = c.default;
          v = clamp(v);
          currentStyle[c.key] = v;
          if (normalize) num.value = String(v);
          saveStyle();
          updatePreview();
        };

        // Update live while typing; clamp/normalize on change (blur/enter).
        num.addEventListener('input', (e) => commit(e.target.value, false));
        num.addEventListener('change', (e) => commit(e.target.value, true));

        group.append(label, num, unitSpan);
      } else if (c.type === 'select') {
        label.setAttribute('for', `style-${c.key}`);
        const sel = document.createElement('select');
        sel.id = `style-${c.key}`;
        sel.className = 'select select-compact';
        sel.dataset.styleKey = c.key;
        for (const o of (c.options || [])) {
          const opt = document.createElement('option');
          opt.value = o.value;
          opt.textContent = o.label;
          sel.appendChild(opt);
        }
        sel.value = String(currentStyle[c.key] != null ? currentStyle[c.key] : c.default);
        sel.addEventListener('change', (e) => {
          currentStyle[c.key] = e.target.value;
          saveStyle();
          updatePreview();
        });
        group.append(label, sel);
      }
      bar.appendChild(group);
    }

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.id = 'style-reset-btn';
    resetBtn.className = 'btn btn-ghost btn-sm';
    resetBtn.textContent = 'Reset style';
    resetBtn.addEventListener('click', () => {
      currentStyle = window.App.Templates.defaultStyleFor(currentTemplateId());
      saveStyle();
      buildCustomizeBar();
      updatePreview();
    });
    bar.appendChild(resetBtn);
  }

  // Short unit label shown next to a range's number input (blank for unitless
  // controls like line-height).
  function rangeUnitLabel(unit) {
    if (unit === 'in') return 'in';
    if (unit === '%') return '%';
    if (unit === 'pt') return 'pt';
    if (unit === 'px') return 'px';
    return '';
  }

  function applyStyleToControls() {
    buildCustomizeBar();
  }

  /**
   * Load and display the resume for the given profile.
   */
  async function open(profile) {
    init();
    if (currentProfile) close();
    const token = ++workspaceToken;
    currentProfile = profile;
    populateProfileHeader(profile);

    let saved = null;
    try {
      saved = await window.api.getResume(profile.id);
    } catch (err) {
      console.error('getResume failed', err);
    }
    if (token !== workspaceToken) return;
    currentResume =
      window.App.Resume.migrate(saved, profile);

    $('resume-json').value = JSON.stringify(currentResume, null, 2);
    $('json-error').classList.add('hidden');
    setStatus('Loaded');

    let savedPrompt = '';
    try {
      savedPrompt = await window.api.getPrompt(profile.id);
    } catch (err) {
      console.error('getPrompt failed', err);
    }
    if (token !== workspaceToken) return;
    $('resume-prompt').value = typeof savedPrompt === 'string' ? savedPrompt : '';
    setPromptStatus('');

    let savedJd = '';
    try {
      savedJd = await window.api.getJd(profile.id);
    } catch (err) {
      console.error('getJd failed', err);
    }
    if (token !== workspaceToken) return;
    const jdEl = $('resume-jd');
    if (jdEl) jdEl.value = typeof savedJd === 'string' ? savedJd : '';
    setJdStatus('');

    currentStyle = loadStyle();
    applyStyleToControls();

    updateCompanyChip();
    updatePreview();
  }

  function close() {
    flushPendingEdits();
    workspaceToken++;
    currentProfile = null;
    currentResume = null;
    clearTimeout(parseTimer);
    clearTimeout(saveTimer);
    clearTimeout(promptSaveTimer);
    clearTimeout(jdSaveTimer);
    clearPdfPreview();
    setPreviewError(null);
    const promptEl = $('resume-prompt');
    if (promptEl) promptEl.value = '';
    const jdEl = $('resume-jd');
    if (jdEl) jdEl.value = '';
    if (window.App && window.App.Process) {
      try { window.App.Process.close(); } catch (_) { /* ignore */ }
    }
    closeProfileDetail();
  }

  function flushPendingEdits() {
    if (!currentProfile) return;
    const profile = currentProfile;
    const save = (promise) => Promise.resolve(promise).then(ok => {
      if (ok === false) throw new Error('Could not save pending edits');
    }).catch(err => console.error('Pending save failed', err));
    if (parseTimer || saveTimer) {
      try { save(window.api.saveResume(profile.id, window.App.Resume.parse($('resume-json').value, profile))); }
      catch (_) { /* Invalid drafts are never persisted as resumes. */ }
    }
    if (promptSaveTimer) save(window.api.savePrompt(profile.id, $('resume-prompt').value));
    if (jdSaveTimer) save(window.api.saveJd(profile.id, $('resume-jd').value));
    for (const timer of [parseTimer, saveTimer, promptSaveTimer, jdSaveTimer]) clearTimeout(timer);
    parseTimer = saveTimer = promptSaveTimer = jdSaveTimer = null;
  }

  function populateProfileHeader(profile) {
    const avatar = $('ws-avatar');
    avatar.style.backgroundColor = profile.color || '#6c8cff';
    avatar.textContent = (profile.firstName || profile.lastName || '?')
      .charAt(0)
      .toUpperCase();

    const fullName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
    $('ws-name').textContent = fullName || 'Unnamed profile';

    const tpl = window.App.Templates.get(profile.templateId || 'classic');
    const tplLabel = $('ws-template-label');
    if (tplLabel) tplLabel.textContent = tpl ? tpl.name : 'Modern';

    const dob = (profile.dob || '').trim();
    const age = calcAge(dob);
    const dobPart = dob ? (age != null ? `${dob} (${age})` : dob) : '';
    const meta = [dobPart, profile.location]
      .map((v) => (v == null ? '' : String(v).trim()))
      .filter(Boolean)
      .join(' \u00B7 ');
    $('ws-meta').textContent = meta;

    const subtitle = $('subtitle');
    if (subtitle) {
      subtitle.textContent = fullName
        ? `Editing ${fullName}'s resume`
        : 'Editing resume';
    }
  }

  function calcAge(dobStr) {
    if (!dobStr) return null;
    const d = new Date(dobStr);
    if (isNaN(d.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
    if (age < 0 || age > 200) return null;
    return age;
  }

  function updateCompanyChip() {
    const chip = $('ws-company');
    const labelEl = $('ws-company-label');
    if (!chip || !labelEl) return;
    const company =
      currentResume && typeof currentResume.company === 'string'
        ? currentResume.company.trim()
        : '';
    if (company) {
      labelEl.textContent = company;
      chip.classList.remove('hidden');
    } else {
      chip.classList.add('hidden');
    }
  }

  /**
   * Default seed matching the user's authoritative JSON shape.
   */
  function seedResume() {
    return window.App.Resume.seed(currentProfile || {});
  }

  function parseAndRender() {
    parseTimer = null;
    const text = $('resume-json').value;
    const errEl = $('json-error');
    let parsed;
    try {
      parsed = window.App.Resume.parse(text, currentProfile);
    } catch (e) {
      errEl.textContent = `JSON error: ${e.message}`;
      errEl.classList.remove('hidden');
      setStatus('Invalid JSON');
      return;
    }
    errEl.classList.add('hidden');
    currentResume = parsed;
    setStatus('Saving…');
    persistDebounced();
    updateCompanyChip();
    updatePreview();
  }

  function persistDebounced() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      if (!currentProfile || !currentResume) return;
      const profile = currentProfile;
      try {
        const ok = await window.api.saveResume(profile.id, currentResume);
        if (ok === false) throw new Error('Could not write resume');
        if (currentProfile === profile) setStatus('Saved');
      } catch (err) {
        console.error('saveResume failed', err);
        setStatus('Save failed');
      }
    }, 400);
  }

  async function persistPrompt() {
    promptSaveTimer = null;
    if (!currentProfile) return;
    const profile = currentProfile;
    const text = $('resume-prompt').value;
    try {
      const ok = await window.api.savePrompt(profile.id, text);
      if (ok === false) throw new Error('Could not write prompt');
      if (currentProfile === profile) setPromptStatus('Saved');
    } catch (err) {
      console.error('savePrompt failed', err);
      setPromptStatus('Save failed');
    }
  }

  async function persistJd() {
    jdSaveTimer = null;
    if (!currentProfile) return;
    const profile = currentProfile;
    const el = $('resume-jd');
    const text = el ? el.value : '';
    try {
      const ok = await window.api.saveJd(profile.id, text);
      if (ok === false) throw new Error('Could not write job description');
      if (currentProfile === profile) setJdStatus('Saved');
    } catch (err) {
      console.error('saveJd failed', err);
      setJdStatus('Save failed');
    }
  }

  // Read the clipboard as text. Returns null (and the caller warns) when the
  // Clipboard API is unavailable or permission is denied.
  async function readClipboardText() {
    try {
      return await navigator.clipboard.readText();
    } catch (_) {
      return null;
    }
  }

  // Briefly show a confirmation label on a button, then restore it.
  function flashButton(btn, label) {
    if (!btn) return;
    const original = btn.dataset.label || btn.textContent;
    btn.dataset.label = original;
    btn.textContent = label;
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = original;
      btn.disabled = false;
    }, 1200);
  }

  // Replace the Job Description with the clipboard contents and save it.
  async function pasteJd(btn) {
    const el = $('resume-jd');
    if (!el) return;
    const text = await readClipboardText();
    if (text == null) {
      showToast('Could not read the clipboard.', { kind: 'error' });
      return;
    }
    el.value = text;
    clearTimeout(jdSaveTimer);
    setJdStatus('Saving…');
    await persistJd();
    flashButton(btn, 'Pasted');
  }

  // Replace the resume JSON with the clipboard contents and, if it parses,
  // immediately export the PDF + JD. Invalid JSON aborts before exporting.
  async function pasteJsonAndExport(btn) {
    const el = $('resume-json');
    if (!el) return;
    const text = await readClipboardText();
    if (text == null) {
      showToast('Could not read the clipboard.', { kind: 'error' });
      return;
    }
    el.value = text;
    clearTimeout(parseTimer);
    // parseAndRender parses the textarea, updates currentResume + preview and
    // schedules a save. It only sets currentResume when the JSON is valid.
    parseAndRender();
    const errEl = $('json-error');
    if (errEl && !errEl.classList.contains('hidden')) {
      showToast('Clipboard is not valid JSON — fix it before exporting.', {
        kind: 'error',
      });
      return;
    }
    flashButton(btn, 'Pasted');
    await exportPdf();
  }

  async function copyPromptToClipboard(btn) {
    const text = $('resume-prompt').value || '';
    if (!text) {
      showToast('Prompt is empty', { kind: 'error' });
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      // Fallback when the async Clipboard API is unavailable.
      const ta = $('resume-prompt');
      ta.focus();
      ta.select();
      document.execCommand('copy');
      ta.setSelectionRange(ta.value.length, ta.value.length);
    }
    if (btn) {
      const original = btn.textContent;
      btn.textContent = 'Copied';
      btn.disabled = true;
      setTimeout(() => {
        btn.textContent = original;
        btn.disabled = false;
      }, 1200);
    }
  }

  // Build a fresh prompt from the current profile and place it in the
  // textarea (overwriting whatever was there). The auto-save handler picks
  // it up once the textarea fires its `input` event below. The previous
  // prompt is recoverable via the textarea's native undo (Ctrl+Z).
  async function regeneratePrompt() {
    if (!currentProfile) return;
    const profile = currentProfile;
    let text;
    try { text = await window.api.generatePrompt(profile.id); }
    catch (err) { showToast(`Prompt generation failed: ${err.message || err}`, {kind:'error'}); return; }
    if (currentProfile !== profile) return;
    const ta = $('resume-prompt');
    ta.value = text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    showToast('Resume prompt created using the latest default rules and profile');
  }

  function renderHtml() {
    const tpl = currentTemplate();
    if (!tpl || !currentResume) return '';
    try {
      return tpl.render({
        profile: currentProfile || {},
        data: currentResume,
        style: currentStyle,
      });
    } catch (err) {
      console.error('Template render failed', err);
      return `<pre style="padding:24px;color:#b00020;">Template render error:\n${(err && err.message) || err}</pre>`;
    }
  }

  // Live preview: render the template HTML to a real PDF in the main process,
  // then point the preview iframe at the resulting blob URL so the user sees
  // the same output Chromium produces for `Export PDF`.
  function updatePreview() {
    if (!currentResume) return;
    if (pdfRenderInFlight) {
      // A render is already running; mark that we should run again with the
      // latest content as soon as it finishes.
      pdfRenderQueued = true;
      return;
    }
    pdfRenderInFlight = true;
    runPdfRender();
  }

  async function runPdfRender() {
    const profileForRender = currentProfile;
    const html = renderHtml();
    if (!html) {
      pdfRenderInFlight = false;
      return;
    }
    const myToken = ++pdfRenderToken;
    setPreviewBusy(true);
    try {
      const result = await window.api.renderPdf(html);
      // Bail if a newer render has been requested or the workspace was closed
      // for a different profile in the meantime.
      if (myToken !== pdfRenderToken) return;
      if (currentProfile !== profileForRender) return;

      if (!result || result.error) {
        console.error('renderPdf error:', result && result.error);
        setPreviewError(result && result.error);
        return;
      }
      const blob = new Blob([result.data], { type: 'application/pdf' });
      const nextUrl = URL.createObjectURL(blob);
      const prevUrl = currentPdfUrl;
      currentPdfUrl = nextUrl;
      $('preview-frame').src = nextUrl;
      // Defer revoking the old URL until the iframe has had a chance to swap
      // sources, otherwise the visible page can briefly go blank.
      if (prevUrl) {
        setTimeout(() => URL.revokeObjectURL(prevUrl), 1500);
      }
      setPreviewError(null);
    } catch (err) {
      console.error('runPdfRender failed:', err);
      setPreviewError(err && err.message ? err.message : String(err));
    } finally {
      setPreviewBusy(false);
      pdfRenderInFlight = false;
      if (pdfRenderQueued) {
        pdfRenderQueued = false;
        updatePreview();
      }
    }
  }

  function setPreviewBusy(busy) {
    const wrap = document.querySelector('.preview-frame-wrap');
    if (!wrap) return;
    wrap.classList.toggle('is-busy', !!busy);
  }

  function setPreviewError(msg) {
    const errEl = document.getElementById('preview-error');
    if (!errEl) return;
    if (msg) {
      errEl.textContent = `Preview error: ${msg}`;
      errEl.classList.remove('hidden');
    } else {
      errEl.textContent = '';
      errEl.classList.add('hidden');
    }
  }

  function clearPdfPreview() {
    pdfRenderToken++;
    if (currentPdfUrl) {
      const url = currentPdfUrl;
      currentPdfUrl = null;
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
    const frame = $('preview-frame');
    if (frame) frame.removeAttribute('src');
  }

  function setStatus(msg) {
    $('json-status').textContent = msg || '';
  }

  function setPromptStatus(msg) {
    const el = $('prompt-status');
    if (el) el.textContent = msg || '';
  }

  function setJdStatus(msg) {
    const el = $('jd-status');
    if (el) el.textContent = msg || '';
  }

  function safeFileName(s) {
    return String(s || 'resume').replace(/[\\/:"*?<>|]+/g, '_').trim() || 'resume';
  }

  /**
   * Build the per-profile PDF file name as `firstName_lastName_resume.pdf`.
   * Falls back gracefully when one or both name parts are missing.
   */
  function buildResumeFileName(profile) {
    const fn = (profile && profile.firstName ? profile.firstName : '').trim();
    const ln = (profile && profile.lastName ? profile.lastName : '').trim();
    const nameParts = [fn, ln].filter(Boolean);
    const stem = nameParts.length
      ? safeFileName(nameParts.join('_'))
      : 'profile';
    return `${stem}_resume.pdf`;
  }

  /**
   * Show the "company name needed" modal and return a Promise that resolves
   * with the trimmed value the user typed, or `null` if they cancelled.
   * Only one prompt can be open at a time.
   */
  function promptCompanyName(initialValue) {
    return new Promise((resolve) => {
      const modal = $('company-modal');
      const input = $('company-input');
      const confirmBtn = $('company-confirm');
      if (!modal || !input || !confirmBtn) {
        resolve(null);
        return;
      }

      input.value = initialValue || '';

      let settled = false;
      const cleanup = () => {
        modal.classList.add('hidden');
        confirmBtn.removeEventListener('click', onConfirm);
        input.removeEventListener('keydown', onInputKey);
        document.removeEventListener('keydown', onDocKey);
        modal.querySelectorAll('[data-company-close]').forEach((el) => {
          el.removeEventListener('click', onCancel);
        });
      };
      const finish = (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      const onConfirm = () => {
        const v = (input.value || '').trim();
        if (!v) {
          input.focus();
          input.style.borderColor = 'var(--danger)';
          return;
        }
        finish(v);
      };
      const onCancel = () => finish(null);
      const onInputKey = (e) => {
        input.style.borderColor = '';
        if (e.key === 'Enter') {
          e.preventDefault();
          onConfirm();
        }
      };
      const onDocKey = (e) => {
        if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
          onCancel();
        }
      };

      confirmBtn.addEventListener('click', onConfirm);
      input.addEventListener('keydown', onInputKey);
      document.addEventListener('keydown', onDocKey);
      modal.querySelectorAll('[data-company-close]').forEach((el) => {
        el.addEventListener('click', onCancel);
      });

      input.style.borderColor = '';
      modal.classList.remove('hidden');
      setTimeout(() => {
        input.focus();
        input.select();
      }, 0);
    });
  }

  /**
   * Read the company name directly from the resume JSON currently in the
   * editor. Falls back to the parsed `currentResume` if the editor text isn't
   * valid JSON, so a transient typo never blanks out the company.
   */
  function companyFromJson() {
    const el = $('resume-json');
    if (el) {
      try {
        const parsed = JSON.parse(el.value);
        if (parsed && typeof parsed.company === 'string') {
          return parsed.company.trim();
        }
      } catch (_) {
        /* fall through to cached value */
      }
    }
    return currentResume && typeof currentResume.company === 'string'
      ? currentResume.company.trim()
      : '';
  }

  async function warnIfCompanyDuplicate(company) {
    const saveFolder = (currentProfile && currentProfile.saveFolder || '').trim();
    if (!saveFolder || !company) return false;
    try {
      const res = await window.api.checkCompanyDuplicate(saveFolder, company);
      if (!res || !res.duplicate) return false;
      showToast(res.message || 'A company folder with that name already exists.', {
        kind: 'error',
        actionLabel: res.path ? 'Open folder' : undefined,
        onAction: res.path ? () => window.api.revealInFolder(res.path) : undefined,
      });
      return true;
    } catch (err) {
      console.error('checkCompanyDuplicate failed:', err);
      return false;
    }
  }

  async function exportPdf() {
    clearTimeout(parseTimer);
    parseAndRender();
    if (!$('json-error').classList.contains('hidden')) return;
    if (!currentResume || !currentProfile) return;

    const saveFolder = (currentProfile.saveFolder || '').trim();
    if (!saveFolder) {
      showToast(
        'Set a "Save folder for exported PDFs" on this profile first.',
        { kind: 'error' }
      );
      return;
    }

    // Always pull the company name straight from the resume JSON in the editor
    // (the freshest source) rather than any cached value.
    let company = companyFromJson();
    if (!company) {
      const entered = await promptCompanyName('');
      if (!entered) {
        // User cancelled - silently abort, no error shown.
        return;
      }
      company = entered;
    }

    if (await warnIfCompanyDuplicate(company)) return;

    const html = renderHtml();
    if (!html) return;

    const fileName = buildResumeFileName(currentProfile);
    const jdEl = $('resume-jd');
    const jd = jdEl ? jdEl.value : '';

    showToast('Generating PDF + DOCX…', { sticky: true });
    try {
      const result = await window.api.exportPdf({
        html,
        saveFolder,
        companyName: company,
        fileName,
        jd,
        profileId: currentProfile.id,
        resumeData: currentResume,
        style: currentStyle,
      });
      if (!result) {
        showToast('Export failed: no response from main process.', { kind: 'error' });
        return;
      }
      if (result.error) {
        const reason = result.error;
        if (result.code === 'DUPLICATE_FOLDER' && result.path) {
          showToast(reason, {
            kind: 'error',
            actionLabel: 'Open folder',
            onAction: () => window.api.revealInFolder(result.path),
          });
        } else {
          showToast(`Export failed: ${reason}`, { kind: 'error' });
        }
        return;
      }
      if (result.path) {
        const successMsg = result.jdPath
          ? `Saved PDF, DOCX and JD.txt to ${result.folder || result.path}`
          : `Saved PDF and DOCX to ${result.folder || result.path}`;
        showToast(successMsg, {
          actionLabel: 'Reveal',
          onAction: () => window.api.revealInFolder(result.path),
        });
        if (result.jdError) {
          // The PDF saved fine but the JD file failed; warn so the user
          // doesn't assume the JD got captured. Keep the textarea contents
          // so they can retry without losing the text.
          setTimeout(() => {
            showToast(`JD.txt could not be written: ${result.jdError}`, {
              kind: 'error',
            });
          }, 600);
        } else if (jdEl && jdEl.value) {
          // Full success: blank out the JD pane and persist the empty value
          // so reopening the profile doesn't show stale text.
          jdEl.value = '';
          clearTimeout(jdSaveTimer);
          setJdStatus('Cleared');
          persistJd();
        }
      }
    } catch (err) {
      console.error(err);
      showToast(`Export failed: ${err.message || err}`, { kind: 'error' });
    }
  }

  function resetFromProfile() {
    if (!currentProfile) return;
    const ok = confirm(
      'Reset resume JSON to a fresh template? Your current JSON will be replaced.'
    );
    if (!ok) return;
    currentResume = seedResume();
    $('resume-json').value = JSON.stringify(currentResume, null, 2);
    $('json-error').classList.add('hidden');
    setStatus('Reset');
    persistDebounced();
    updateCompanyChip();
    updatePreview();
  }

  // ---------- Style persistence (per profile + template) ----------

  function styleKey() {
    if (!currentProfile) return null;
    const tid = currentTemplateId();
    return `style:${currentProfile.id}:${tid}`;
  }

  function loadStyle() {
    const defaults = window.App.Templates.defaultStyleFor(currentTemplateId());
    const key = styleKey();
    if (!key) return { ...defaults };
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return { ...defaults };
      const parsed = JSON.parse(raw);
      return { ...defaults, ...parsed };
    } catch (_) {
      return { ...defaults };
    }
  }

  function saveStyle() {
    const key = styleKey();
    if (!key) return;
    try {
      localStorage.setItem(key, JSON.stringify(currentStyle));
    } catch (_) {
      /* ignore */
    }
  }

  // ---------- Toast ----------

  function showToast(text, opts) {
    const toast = $('toast');
    toast.innerHTML = '';
    toast.classList.remove('error');
    if (opts && opts.kind === 'error') toast.classList.add('error');

    const span = document.createElement('span');
    span.textContent = text;
    toast.appendChild(span);

    if (opts && opts.actionLabel && typeof opts.onAction === 'function') {
      const btn = document.createElement('button');
      btn.className = 'toast-action';
      btn.textContent = opts.actionLabel;
      btn.addEventListener('click', () => {
        try {
          opts.onAction();
        } catch (_) {
          /* ignore */
        }
        hideToast();
      });
      toast.appendChild(btn);
    }

    toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    if (!opts || !opts.sticky) {
      toastTimer = setTimeout(hideToast, 4000);
    }
  }

  function hideToast() {
    $('toast').classList.add('hidden');
  }

  window.App = window.App || {};
  window.App.Workspace = { init, open, close, showToast };
})();
