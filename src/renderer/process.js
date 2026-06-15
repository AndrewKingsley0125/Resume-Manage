/**
 * Manage-process view: lists every company subfolder under the active
 * profile's save folder, lets the user track status / step, and opens
 * inline viewers for the JD.txt and resume PDF stored in each folder.
 *
 * Exposes window.App.Process.
 */
(function () {
  const $ = (id) => document.getElementById(id);

  const STATUSES = ['Pending', 'Intro', 'HR', 'Tech', 'Panel', 'Final'];

  /** @type {{id:string, saveFolder:string}|null} */
  let currentProfile = null;
  /** @type {Array<any>} */
  let processes = [];
  /** 'date' | 'step' */
  let sortKey = 'date';
  /** 'asc' | 'desc' */
  let sortDir = 'desc';
  let searchCompany = '';
  let searchDate = '';
  let statusFilter = '';
  /** @type {Map<string, number>} - debounce timers keyed by company name */
  const saveTimers = new Map();
  let resumeBlobUrl = null;
  let bound = false;
  /** @type {any|null} */
  let pendingRename = null;
  /** @type {any|null} */
  let pendingDelete = null;

  // ---------- Public API ----------

  async function open(profile) {
    if (!profile) return;
    bind();
    currentProfile = profile;
    showModal($('process-modal'));
    await refresh();
  }

  function close() {
    hideModal($('process-modal'));
    currentProfile = null;
    processes = [];
    saveTimers.forEach((t) => clearTimeout(t));
    saveTimers.clear();
  }

  // ---------- Loading ----------

  /**
   * Fast load: reads the persisted process list (no directory scan once it has
   * been seeded). Used when opening the modal and after in-app mutations
   * (export / rename / delete / status / step) which keep the list in sync.
   */
  async function refresh() {
    await load(false);
  }

  /**
   * Force a re-scan of the save folder and reconcile it with the stored list
   * (picks up folders added/removed outside the app). Wired to the Refresh
   * button only.
   */
  async function resync() {
    await load(true);
  }

  async function load(fromDisk) {
    if (!currentProfile) return;
    const sf = (currentProfile.saveFolder || '').trim();
    const emptyEl = $('process-empty');
    if (!sf) {
      processes = [];
      emptyEl.textContent =
        'No save folder is configured for this profile. Edit the profile to choose one.';
      render();
      return;
    }
    try {
      const list = fromDisk
        ? await window.api.syncProcesses(currentProfile.id, sf)
        : await window.api.listProcesses(currentProfile.id, sf);
      processes = Array.isArray(list) ? list : [];
      emptyEl.textContent = processes.length === 0
        ? 'No applications tracked yet. Export a resume to add one, or click Refresh to scan the folder.'
        : '';
    } catch (err) {
      console.error('load processes failed:', err);
      processes = [];
      emptyEl.textContent = `Failed to load processes: ${err.message || err}`;
    }
    render();
  }

  // ---------- Rendering ----------

  function render() {
    const tbody = $('process-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    let rows = processes.slice();

    if (searchCompany) {
      const q = searchCompany.toLowerCase();
      rows = rows.filter((p) => p.companyName.toLowerCase().includes(q));
    }
    if (searchDate) {
      const q = searchDate.toLowerCase();
      rows = rows.filter((p) => formatDate(p.date).toLowerCase().includes(q));
    }
    if (statusFilter) {
      rows = rows.filter((p) => p.status === statusFilter);
    }

    rows.sort((a, b) => {
      const sign = sortDir === 'asc' ? 1 : -1;
      if (sortKey === 'step') {
        const diff = (a.step || 0) - (b.step || 0);
        // Tie-break by date so equal-step rows stay grouped consistently.
        return diff !== 0 ? sign * diff : (b.date - a.date);
      }
      return sign * ((a.date || 0) - (b.date || 0));
    });

    updateSortHeaders();
    rows.forEach((p, i) => tbody.appendChild(buildRow(p, i + 1)));
  }

  function updateSortHeaders() {
    document.querySelectorAll('.process-table thead th.sortable').forEach((th) => {
      const key = th.getAttribute('data-sort');
      const arrow = th.querySelector('.sort-arrow');
      const isActive = key === sortKey;
      th.classList.toggle('active', isActive);
      if (arrow) arrow.textContent = isActive ? (sortDir === 'asc' ? '↑' : '↓') : '↕';
    });
  }

  function buildRow(p, idx) {
    const tr = document.createElement('tr');
    tr.appendChild(td(String(idx), 'col-no'));
    tr.appendChild(td(p.companyName, 'col-company'));
    tr.appendChild(td(formatDate(p.date), 'col-date'));

    // JD cell
    const jdTd = document.createElement('td');
    jdTd.className = 'col-jd';
    if (p.hasJd) {
      jdTd.appendChild(makeRowBtn('View', () => openJdModal(p)));
    } else {
      jdTd.textContent = '—';
      jdTd.classList.add('muted-cell');
    }
    tr.appendChild(jdTd);

    // Resume cell
    const rTd = document.createElement('td');
    rTd.className = 'col-resume';
    if (p.hasResume) {
      rTd.appendChild(makeRowBtn('View', () => openResumeModal(p)));
    } else {
      rTd.textContent = '—';
      rTd.classList.add('muted-cell');
    }
    tr.appendChild(rTd);

    // Status cell
    const sTd = document.createElement('td');
    sTd.className = 'col-status';
    const sel = document.createElement('select');
    for (const s of STATUSES) {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s;
      sel.appendChild(opt);
    }
    sel.value = p.status;
    applyStatusClass(sel, p.status);
    sel.addEventListener('change', () => {
      p.status = sel.value;
      applyStatusClass(sel, p.status);
      scheduleSave(p);
    });
    sTd.appendChild(sel);
    tr.appendChild(sTd);

    // Step cell
    const stTd = document.createElement('td');
    stTd.className = 'col-step';
    const stInp = document.createElement('input');
    stInp.type = 'number';
    stInp.min = '0';
    stInp.step = '1';
    stInp.className = 'step-input';
    stInp.value = String(p.step);
    stInp.addEventListener('input', () => {
      const n = Number(stInp.value);
      p.step = isFinite(n) && n >= 0 ? Math.floor(n) : 0;
      scheduleSave(p);
    });
    stTd.appendChild(stInp);
    tr.appendChild(stTd);

    // Actions cell (edit / delete)
    const aTd = document.createElement('td');
    aTd.className = 'col-actions';
    aTd.appendChild(makeActionBtn('✎', 'Edit company name', () => openRenameModal(p)));
    aTd.appendChild(makeActionBtn('✕', 'Delete this application', () => openDeleteModal(p), true));
    tr.appendChild(aTd);

    return tr;
  }

  function makeActionBtn(label, title, onClick, danger) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'row-action-btn' + (danger ? ' danger' : '');
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', onClick);
    return b;
  }

  function td(text, cls) {
    const cell = document.createElement('td');
    if (cls) cell.className = cls;
    cell.textContent = text;
    return cell;
  }

  function makeRowBtn(label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'row-link';
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function applyStatusClass(sel, status) {
    sel.className = '';
    sel.classList.add('status-' + String(status || 'Pending').toLowerCase());
  }

  function formatDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${mm}/${dd}/${yyyy} ${hh}:${mi}:${ss}`;
  }

  // ---------- Persistence ----------

  function scheduleSave(p) {
    if (!currentProfile) return;
    const key = p.companyName;
    if (saveTimers.has(key)) clearTimeout(saveTimers.get(key));
    const timer = setTimeout(async () => {
      saveTimers.delete(key);
      try {
        await window.api.saveProcess(currentProfile.id, p.companyName, {
          status: p.status,
          step: p.step,
        });
      } catch (err) {
        console.error('saveProcess failed:', err);
      }
    }, 350);
    saveTimers.set(key, timer);
  }

  // ---------- JD viewer ----------

  async function openJdModal(p) {
    const titleEl = $('jd-modal-title');
    const contentEl = $('jd-content');
    titleEl.textContent = `JD — ${p.companyName}`;
    contentEl.textContent = 'Loading…';
    showModal($('jd-modal'));
    try {
      const result = await window.api.readJdFile(p.jdPath);
      if (!result || result.error) {
        contentEl.textContent = `Failed to read JD: ${(result && result.error) || 'unknown error'}`;
        return;
      }
      contentEl.textContent = result.content || '(empty file)';
    } catch (err) {
      contentEl.textContent = `Failed to read JD: ${err.message || err}`;
    }
  }

  function closeJdModal() {
    hideModal($('jd-modal'));
  }

  // ---------- Rename ----------

  function openRenameModal(p) {
    pendingRename = p;
    const input = $('process-rename-input');
    const errEl = $('process-rename-error');
    if (errEl) {
      errEl.textContent = '';
      errEl.classList.add('hidden');
    }
    if (input) {
      input.value = p.companyName;
      input.style.borderColor = '';
    }
    showModal($('process-rename-modal'));
    setTimeout(() => {
      if (input) {
        input.focus();
        input.select();
      }
    }, 0);
  }

  function closeRenameModal() {
    hideModal($('process-rename-modal'));
    pendingRename = null;
  }

  async function confirmRename() {
    if (!currentProfile || !pendingRename) return;
    const input = $('process-rename-input');
    const errEl = $('process-rename-error');
    const newName = (input.value || '').trim();
    if (!newName) {
      input.style.borderColor = 'var(--danger)';
      input.focus();
      return;
    }
    if (newName === pendingRename.companyName) {
      closeRenameModal();
      return;
    }
    const sf = (currentProfile.saveFolder || '').trim();
    const oldName = pendingRename.companyName;

    try {
      const res = await window.api.renameProcess(
        currentProfile.id,
        sf,
        oldName,
        newName
      );
      if (!res || res.error) {
        const msg = (res && res.error) || 'Unknown error';
        if (errEl) {
          errEl.textContent = msg;
          errEl.classList.remove('hidden');
        }
        input.style.borderColor = 'var(--danger)';
        input.focus();
        return;
      }
      closeRenameModal();
      toast(`Renamed to "${res.name || newName}"`);
      await refresh();
    } catch (err) {
      const msg = (err && err.message) || String(err);
      if (errEl) {
        errEl.textContent = `Rename failed: ${msg}`;
        errEl.classList.remove('hidden');
      }
    }
  }

  // ---------- Delete ----------

  function openDeleteModal(p) {
    pendingDelete = p;
    const text = $('process-delete-text');
    if (text) {
      text.innerHTML =
        `The folder <strong>"${escapeHtml(p.companyName)}"</strong> and all of its files ` +
        `will be permanently removed. This action cannot be undone.`;
    }
    showModal($('process-delete-modal'));
  }

  function closeDeleteModal() {
    hideModal($('process-delete-modal'));
    pendingDelete = null;
  }

  async function confirmDelete() {
    if (!currentProfile || !pendingDelete) return;
    const sf = (currentProfile.saveFolder || '').trim();
    const name = pendingDelete.companyName;
    closeDeleteModal();
    try {
      const res = await window.api.deleteProcessFolder(
        currentProfile.id,
        sf,
        name
      );
      if (!res || res.error) {
        toast(`Delete failed: ${(res && res.error) || 'unknown error'}`, {
          kind: 'error',
        });
        return;
      }
      toast(
        res.alreadyGone
          ? `Removed stale entry "${name}"`
          : `Deleted "${name}"`
      );
      await refresh();
    } catch (err) {
      toast(`Delete failed: ${err.message || err}`, { kind: 'error' });
    }
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toast(text, opts) {
    const ws = window.App && window.App.Workspace;
    if (ws && typeof ws.showToast === 'function') {
      ws.showToast(text, opts);
    } else {
      console.log('[process]', text);
    }
  }

  // ---------- Resume viewer ----------

  async function openResumeModal(p) {
    const titleEl = $('resume-modal-title');
    const frame = $('resume-frame');
    const errEl = $('resume-frame-error');
    titleEl.textContent = `Resume — ${p.companyName}`;
    frame.removeAttribute('src');
    errEl.classList.add('hidden');
    errEl.textContent = '';
    showModal($('resume-modal'));
    try {
      const result = await window.api.readResumeFile(p.pdfPath);
      if (!result || result.error) {
        errEl.textContent = `Failed to read resume: ${(result && result.error) || 'unknown error'}`;
        errEl.classList.remove('hidden');
        return;
      }
      const blob = new Blob([result.data], { type: 'application/pdf' });
      releaseResumeUrl();
      resumeBlobUrl = URL.createObjectURL(blob);
      frame.src = resumeBlobUrl;
    } catch (err) {
      errEl.textContent = `Failed to read resume: ${err.message || err}`;
      errEl.classList.remove('hidden');
    }
  }

  function closeResumeModal() {
    hideModal($('resume-modal'));
    const frame = $('resume-frame');
    if (frame) frame.removeAttribute('src');
    releaseResumeUrl();
  }

  function releaseResumeUrl() {
    if (resumeBlobUrl) {
      const u = resumeBlobUrl;
      resumeBlobUrl = null;
      setTimeout(() => URL.revokeObjectURL(u), 1000);
    }
  }

  // ---------- Modal helpers ----------

  function showModal(el) { el.classList.remove('hidden'); }
  function hideModal(el) { el.classList.add('hidden'); }

  // ---------- Wiring ----------

  function bind() {
    if (bound) return;
    bound = true;

    document.querySelectorAll('[data-process-close]').forEach((el) => {
      el.addEventListener('click', close);
    });
    document.querySelectorAll('[data-jd-close]').forEach((el) => {
      el.addEventListener('click', closeJdModal);
    });
    document.querySelectorAll('[data-resume-close]').forEach((el) => {
      el.addEventListener('click', closeResumeModal);
    });
    document.querySelectorAll('[data-rename-close]').forEach((el) => {
      el.addEventListener('click', closeRenameModal);
    });
    document.querySelectorAll('[data-delete-close]').forEach((el) => {
      el.addEventListener('click', closeDeleteModal);
    });

    const renameBtn = $('process-rename-confirm');
    if (renameBtn) renameBtn.addEventListener('click', confirmRename);

    const renameInput = $('process-rename-input');
    if (renameInput) {
      renameInput.addEventListener('input', () => {
        renameInput.style.borderColor = '';
        const errEl = $('process-rename-error');
        if (errEl && !errEl.classList.contains('hidden')) {
          errEl.classList.add('hidden');
          errEl.textContent = '';
        }
      });
      renameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          confirmRename();
        }
      });
    }

    const deleteBtn = $('process-delete-confirm');
    if (deleteBtn) deleteBtn.addEventListener('click', confirmDelete);

    const sCompany = $('process-search-company');
    if (sCompany) {
      sCompany.addEventListener('input', (e) => {
        searchCompany = e.target.value.trim();
        render();
      });
    }
    const sDate = $('process-search-date');
    if (sDate) {
      sDate.addEventListener('input', (e) => {
        searchDate = e.target.value.trim();
        render();
      });
    }

    document.querySelectorAll('.process-table thead th.sortable').forEach((th) => {
      th.addEventListener('click', () => {
        const key = th.getAttribute('data-sort');
        if (!key) return;
        if (key === sortKey) {
          sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        } else {
          sortKey = key;
          // Sensible defaults: most-recent first for date, highest first for step.
          sortDir = 'desc';
        }
        render();
      });
    });

    const statusSel = $('process-status-filter');
    if (statusSel) {
      statusSel.addEventListener('change', (e) => {
        statusFilter = e.target.value || '';
        render();
      });
    }

    const refreshBtn = $('process-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', resync);

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const dm = $('process-delete-modal');
      const rm = $('process-rename-modal');
      const r = $('resume-modal');
      const j = $('jd-modal');
      const p = $('process-modal');
      if (dm && !dm.classList.contains('hidden')) { closeDeleteModal(); return; }
      if (rm && !rm.classList.contains('hidden')) { closeRenameModal(); return; }
      if (r && !r.classList.contains('hidden')) { closeResumeModal(); return; }
      if (j && !j.classList.contains('hidden')) { closeJdModal(); return; }
      if (p && !p.classList.contains('hidden')) { close(); }
    });
  }

  window.App = window.App || {};
  window.App.Process = { open, close };
})();
