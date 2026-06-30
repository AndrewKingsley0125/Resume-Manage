/**
 * Manage-process view: lists every company subfolder under the active
 * profile's save folder and opens inline viewers for JD.txt and resume PDF.
 *
 * Exposes window.App.Process.
 */
(function () {
  const $ = (id) => document.getElementById(id);

  /** @type {{id:string, saveFolder:string}|null} */
  let currentProfile = null;
  /** @type {Array<any>} */
  let processes = [];
  /** 'asc' | 'desc' */
  let sortDir = 'desc';
  let searchCompany = '';
  let searchDate = '';
  let resumeBlobUrl = null;
  let bound = false;
  /** @type {any|null} */
  let pendingRename = null;
  /** @type {any|null} */
  let pendingDelete = null;
  /** @type {string|null} */
  let pendingImportZipPath = null;
  /** @type {Array<{name:string,status:string,existingName?:string}>} */
  let pendingImportCompanies = [];
  /** @type {string} */
  let pendingImportDate = '';

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
  }

  // ---------- Loading ----------

  /** Scan the save folder on disk (source of truth for company list). */
  async function refresh() {
    await load();
  }

  async function resync() {
    await load();
  }

  async function load() {
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
      const list = await window.api.listProcesses(currentProfile.id, sf);
      processes = Array.isArray(list) ? list : [];
      emptyEl.textContent = processes.length === 0
        ? 'No applications found in the save folder. Export a resume to add one, or click Refresh to scan the folder.'
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

    rows.sort((a, b) => {
      const sign = sortDir === 'asc' ? 1 : -1;
      return sign * ((a.date || 0) - (b.date || 0));
    });

    updateSortHeaders();
    rows.forEach((p, i) => tbody.appendChild(buildRow(p, i + 1)));
  }

  function updateSortHeaders() {
    document.querySelectorAll('.process-table thead th.sortable').forEach((th) => {
      const arrow = th.querySelector('.sort-arrow');
      th.classList.toggle('active', true);
      if (arrow) arrow.textContent = sortDir === 'asc' ? '↑' : '↓';
    });
  }

  function buildRow(p, idx) {
    const tr = document.createElement('tr');
    tr.appendChild(td(String(idx), 'col-no'));
    tr.appendChild(makeCompanyCell(p));
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

    // Actions cell (edit / delete)
    const aTd = document.createElement('td');
    aTd.className = 'col-actions';
    aTd.appendChild(makeActionBtn('✎', 'Edit company name', () => openRenameModal(p)));
    aTd.appendChild(makeActionBtn('✕', 'Delete this application', () => openDeleteModal(p), true));
    tr.appendChild(aTd);

    return tr;
  }

  function makeCompanyCell(p) {
    const cell = document.createElement('td');
    cell.className = 'col-company';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'company-folder-link';
    btn.textContent = p.companyName;
    btn.title = 'Open folder in file explorer';
    btn.setAttribute('aria-label', `Open folder for ${p.companyName}`);
    btn.addEventListener('click', () => openCompanyFolder(p));
    cell.appendChild(btn);
    return cell;
  }

  async function openCompanyFolder(p) {
    if (!p.folderPath) {
      toast('Folder path not available', { kind: 'error' });
      return;
    }
    try {
      const res = await window.api.openFolder(p.folderPath);
      if (res && res.error) {
        toast(`Could not open folder: ${res.error}`, { kind: 'error' });
      }
    } catch (err) {
      toast(`Could not open folder: ${err.message || err}`, { kind: 'error' });
    }
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

  function todayDateKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function localDateKey(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function getExportDate() {
    const el = $('process-export-date');
    const v = el && el.value ? el.value.trim() : '';
    return v || todayDateKey();
  }

  function companiesForExportDate(dateKey) {
    return processes.filter((p) => localDateKey(p.date) === dateKey);
  }

  // ---------- Export / import ----------

  async function openExportModal() {
    if (!currentProfile) return;
    const sf = (currentProfile.saveFolder || '').trim();
    if (!sf) {
      toast('No save folder configured for this profile.', { kind: 'error' });
      return;
    }
    await resync();
    const dateEl = $('process-export-date');
    if (dateEl) dateEl.value = todayDateKey();
    updateExportPreview();
    showModal($('process-export-modal'));
  }

  function closeExportModal() {
    hideModal($('process-export-modal'));
  }

  function updateExportPreview() {
    const dateKey = getExportDate();
    const companies = companiesForExportDate(dateKey);
    const summary = $('process-export-summary');
    const list = $('process-export-list');
    const confirmBtn = $('process-export-confirm');

    if (summary) {
      summary.textContent = companies.length === 0
        ? `No applications found for ${dateKey}.`
        : `${companies.length} application(s) for ${dateKey}:`;
    }

    if (list) {
      list.innerHTML = '';
      companies.forEach((c) => {
        const li = document.createElement('li');
        li.textContent = c.companyName;
        list.appendChild(li);
      });
    }

    if (confirmBtn) confirmBtn.disabled = companies.length === 0;
  }

  async function confirmExportZip() {
    if (!currentProfile) return;
    const sf = (currentProfile.saveFolder || '').trim();
    const dateKey = getExportDate();
    const companies = companiesForExportDate(dateKey);
    if (!companies.length) return;

    const confirmBtn = $('process-export-confirm');
    const original = confirmBtn ? confirmBtn.textContent : '';
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Exporting…';
    }
    try {
      const res = await window.api.exportProcessesZip(
        sf,
        dateKey,
        currentProfile.firstName || '',
        currentProfile.lastName || ''
      );
      if (!res || res.canceled) return;
      if (res.error) {
        toast(res.error, { kind: 'error' });
        return;
      }
      closeExportModal();
      toast(
        `Exported ${res.count} application(s) for ${res.date}`,
        {
          actionLabel: res.path ? 'Reveal' : undefined,
          onAction: res.path ? () => window.api.revealInFolder(res.path) : undefined,
        }
      );
    } catch (err) {
      toast(`Export failed: ${err.message || err}`, { kind: 'error' });
    } finally {
      if (confirmBtn) {
        confirmBtn.disabled = companiesForExportDate(getExportDate()).length === 0;
        confirmBtn.textContent = original;
      }
    }
  }

  async function openImportModal() {
    if (!currentProfile) return;
    const sf = (currentProfile.saveFolder || '').trim();
    if (!sf) {
      toast('No save folder configured for this profile.', { kind: 'error' });
      return;
    }
    await resync();
    resetImportPreview();
    showModal($('process-import-modal'));
  }

  function closeImportModal() {
    hideModal($('process-import-modal'));
    resetImportPreview();
  }

  function resetImportPreview() {
    pendingImportZipPath = null;
    pendingImportCompanies = [];
    pendingImportDate = '';
    const fileEl = $('process-import-file');
    const summary = $('process-import-summary');
    const tbody = $('process-import-tbody');
    const tableWrap = $('process-import-table-wrap');
    const legend = $('process-import-legend');
    const confirmBtn = $('process-import-confirm');
    if (fileEl) fileEl.textContent = 'No file selected';
    if (summary) summary.textContent = '';
    if (tbody) tbody.innerHTML = '';
    if (tableWrap) tableWrap.classList.add('hidden');
    if (legend) legend.classList.add('hidden');
    if (confirmBtn) confirmBtn.disabled = true;
  }

  function importCounts() {
    const total = pendingImportCompanies.length;
    const newCount = pendingImportCompanies.filter((c) => c.status === 'new').length;
    return { total, newCount, duplicateCount: total - newCount };
  }

  function updateImportSummary() {
    const summary = $('process-import-summary');
    const confirmBtn = $('process-import-confirm');
    const { total, newCount, duplicateCount } = importCounts();
    if (summary) {
      const datePart = pendingImportDate ? ` · ${pendingImportDate}` : '';
      summary.textContent =
        `Total: ${total} · New: ${newCount} · Duplicates: ${duplicateCount}${datePart}`;
    }
    if (confirmBtn) confirmBtn.disabled = newCount === 0;
  }

  function toggleImportStatus(index) {
    const company = pendingImportCompanies[index];
    if (!company) return;
    company.status = company.status === 'new' ? 'duplicate' : 'new';
    renderImportRows();
    updateImportSummary();
  }

  function renderImportRows() {
    const tbody = $('process-import-tbody');
    const tableWrap = $('process-import-table-wrap');
    const legend = $('process-import-legend');
    if (!tbody) return;

    tbody.innerHTML = '';
    pendingImportCompanies.forEach((c, index) => {
      const tr = document.createElement('tr');
      tr.className = c.status === 'new' ? 'import-new' : 'import-duplicate';

      const nameTd = document.createElement('td');
      nameTd.className = 'col-import-company';
      let label = c.name;
      if (c.status === 'duplicate' && c.existingName && c.existingName !== c.name) {
        label += ` (matches "${c.existingName}")`;
      }
      nameTd.textContent = label;
      tr.appendChild(nameTd);

      const statusTd = document.createElement('td');
      statusTd.className = 'col-import-status';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'import-status-toggle ' + (c.status === 'new' ? 'is-new' : 'is-duplicate');
      btn.textContent = c.status === 'new' ? 'New' : 'Duplicate';
      btn.title = c.status === 'new'
        ? 'Mark as duplicate (skip on import)'
        : 'Mark as new (include on import)';
      btn.addEventListener('click', () => toggleImportStatus(index));
      statusTd.appendChild(btn);
      tr.appendChild(statusTd);

      tbody.appendChild(tr);
    });

    if (tableWrap) tableWrap.classList.toggle('hidden', pendingImportCompanies.length === 0);
    if (legend) legend.classList.toggle('hidden', pendingImportCompanies.length === 0);
  }

  function renderImportPreview(preview) {
    const fileEl = $('process-import-file');

    if (fileEl) {
      fileEl.textContent = preview.fileName || pathBasename(pendingImportZipPath);
    }

    pendingImportDate = preview.date || '';
    pendingImportCompanies = (preview.companies || []).map((c) => ({
      name: c.name,
      status: c.status === 'new' ? 'new' : 'duplicate',
      existingName: c.existingName,
    }));

    renderImportRows();
    updateImportSummary();
  }

  function pathBasename(p) {
    if (!p) return '';
    const parts = String(p).replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || p;
  }

  async function pickImportZip() {
    if (!currentProfile) return;
    const sf = (currentProfile.saveFolder || '').trim();
    if (!sf) return;

    const pickBtn = $('process-import-pick');
    const original = pickBtn ? pickBtn.textContent : '';
    if (pickBtn) {
      pickBtn.disabled = true;
      pickBtn.textContent = 'Reading…';
    }

    try {
      const pick = await window.api.pickImportZip();
      if (!pick || pick.canceled) return;

      pendingImportZipPath = pick.path;
      const preview = await window.api.analyzeImportZip(sf, pick.path);
      if (!preview || preview.error) {
        pendingImportZipPath = null;
        toast(preview && preview.error ? preview.error : 'Failed to read ZIP', {
          kind: 'error',
        });
        resetImportPreview();
        return;
      }
      renderImportPreview(preview);
    } catch (err) {
      pendingImportZipPath = null;
      toast(`Failed to read ZIP: ${err.message || err}`, { kind: 'error' });
      resetImportPreview();
    } finally {
      if (pickBtn) {
        pickBtn.disabled = false;
        pickBtn.textContent = original;
      }
    }
  }

  async function confirmImportZip() {
    if (!currentProfile || !pendingImportZipPath) return;
    const sf = (currentProfile.saveFolder || '').trim();

    const confirmBtn = $('process-import-confirm');
    const original = confirmBtn ? confirmBtn.textContent : '';
    if (confirmBtn) {
      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Importing…';
    }

    try {
      const importNames = pendingImportCompanies
        .filter((c) => c.status === 'new')
        .map((c) => c.name);
      const res = await window.api.importProcessesZip(
        sf,
        pendingImportZipPath,
        importNames
      );
      if (!res || res.error) {
        toast(res && res.error ? res.error : 'Import failed', { kind: 'error' });
        return;
      }
      closeImportModal();
      const dup = res.skipped || 0;
      const neu = res.imported || 0;
      toast(`Import complete · ${neu} new, ${dup} duplicate(s) skipped`);
      if (neu > 0) await refresh();
    } catch (err) {
      toast(`Import failed: ${err.message || err}`, { kind: 'error' });
    } finally {
      if (confirmBtn) {
        confirmBtn.textContent = original;
        confirmBtn.disabled = !pendingImportZipPath;
      }
    }
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

    try {
      const res = await window.api.renameProcess(
        currentProfile.id,
        sf,
        pendingRename.relativePath,
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
    const relativePath = pendingDelete.relativePath || pendingDelete.companyName;
    closeDeleteModal();
    try {
      const res = await window.api.deleteProcessFolder(
        currentProfile.id,
        sf,
        relativePath
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
    document.querySelectorAll('[data-export-close]').forEach((el) => {
      el.addEventListener('click', closeExportModal);
    });
    document.querySelectorAll('[data-import-close]').forEach((el) => {
      el.addEventListener('click', closeImportModal);
    });

    const exportConfirmBtn = $('process-export-confirm');
    if (exportConfirmBtn) exportConfirmBtn.addEventListener('click', confirmExportZip);

    const exportDateInput = $('process-export-date');
    if (exportDateInput) {
      exportDateInput.addEventListener('change', updateExportPreview);
      exportDateInput.addEventListener('input', updateExportPreview);
    }

    const importPickBtn = $('process-import-pick');
    if (importPickBtn) importPickBtn.addEventListener('click', pickImportZip);

    const importConfirmBtn = $('process-import-confirm');
    if (importConfirmBtn) importConfirmBtn.addEventListener('click', confirmImportZip);

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
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
        render();
      });
    });

    const refreshBtn = $('process-refresh');
    if (refreshBtn) refreshBtn.addEventListener('click', resync);

    const exportBtn = $('process-export-zip');
    if (exportBtn) exportBtn.addEventListener('click', openExportModal);

    const importBtn = $('process-import-zip');
    if (importBtn) importBtn.addEventListener('click', openImportModal);

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const dm = $('process-delete-modal');
      const im = $('process-import-modal');
      const em = $('process-export-modal');
      const rm = $('process-rename-modal');
      const r = $('resume-modal');
      const j = $('jd-modal');
      const p = $('process-modal');
      if (dm && !dm.classList.contains('hidden')) { closeDeleteModal(); return; }
      if (im && !im.classList.contains('hidden')) { closeImportModal(); return; }
      if (em && !em.classList.contains('hidden')) { closeExportModal(); return; }
      if (rm && !rm.classList.contains('hidden')) { closeRenameModal(); return; }
      if (r && !r.classList.contains('hidden')) { closeResumeModal(); return; }
      if (j && !j.classList.contains('hidden')) { closeJdModal(); return; }
      if (p && !p.classList.contains('hidden')) { close(); }
    });
  }

  window.App = window.App || {};
  window.App.Process = { open, close };
})();
