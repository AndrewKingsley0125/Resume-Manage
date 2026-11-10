// Screen 3: one profile's workspace. Every job link is a tab with its own
// job page and ChatGPT page; the left panel shows the selected tab's steps,
// question and log. The "Browser" tab (null) is for logging in by hand.
import { $, el, fullName } from './dom.js';
import { STEP_LABELS, FINISHED, runs, state, shownRun, logLines, log, showScreen, syncPaneBounds } from './state.js';
import { loadProfiles } from './profiles.js';

const STATE_TEXT = { queued: 'waiting', running: 'running', submitted: 'submitted', 'submitted-unconfirmed': 'submitted?', failed: 'failed', cancelled: 'cancelled', skipped: 'skipped' };
const host = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return url; } };
export const tabName = run => (run.company || run.title ? [run.company, run.title].filter(Boolean).join(' · ') : host(run.url));
export const profileRuns = () => [...runs.values()].filter(r => state.profile && r.profileId === state.profile.id);

export async function openWorkspace(p) {
  state.profile = p;
  $('ws-profile').textContent = fullName(p);
  try {
    await window.api.selectProfile(p.id); // the "Browser" tab uses this profile's job-site session
  } catch (err) {
    log(`Could not switch profile: ${err.message}`);
  }
  showScreen('workspace');
  const mine = profileRuns();
  const waiting = mine.find(r => r.ask);
  await select(waiting ? waiting.id : mine.some(r => r.id === state.selected) ? state.selected : null);
  loadCapacity();
  refreshChatStatus();
}

// ---------- Tabs and the left panel ----------

function renderTabs() {
  const tabs = [el('button', { class: `tab home${state.selected == null ? ' selected' : ''}`, type: 'button', title: 'Browse and log in to job sites by hand', onclick: () => select(null) },
    el('span', { class: 'tab-name' }, 'Browser'))];
  for (const run of profileRuns()) {
    const cls = run.ask ? 'needs' : run.status === 'submitted-unconfirmed' ? 'submitted' : run.status;
    tabs.push(el('div', { class: `tab ${cls}${run.id === state.selected ? ' selected' : ''}`, role: 'tab', tabindex: '0', title: `${run.url}\n${run.ask ? 'Needs you' : STATE_TEXT[run.status] || run.status}`, onclick: () => select(run.id) },
      el('span', { class: 'dot' }),
      el('span', { class: 'tab-name' }, tabName(run)),
      FINISHED.has(run.status) ? el('button', { class: 'close', type: 'button', title: 'Close tab (files are kept)', onclick: e => { e.stopPropagation(); closeRun(run.id); } }, '×') : null));
  }
  $('tabs').replaceChildren(...tabs);
}

function renderSteps() {
  const run = shownRun();
  $('steps-card').classList.toggle('hidden', !run);
  if (!run) return;
  $('tab-heading').textContent = `${tabName(run)} — ${run.ask ? 'needs you' : STATE_TEXT[run.status] || run.status}`;
  $('steps').replaceChildren(...Object.entries(STEP_LABELS).map(([key, label]) => el('li', { class: run.steps[key] || 'pending' }, label)));
}

function renderAsk() {
  const run = shownRun();
  if (run && run.askNode) {
    $('ask').replaceChildren(run.askNode);
    $('ask').classList.remove('hidden');
  } else {
    $('ask').classList.add('hidden');
    $('ask').replaceChildren();
  }
}

export function renderAll() {
  renderTabs();
  renderSteps();
  renderAsk();
  const run = shownRun();
  $('cancel-btn').classList.toggle('hidden', !run || FINISHED.has(run.status));
  $('log').textContent = logLines().map(l => `${l}\n`).join('');
  $('log').scrollTop = $('log').scrollHeight;
}

/** Re-render after a change to run `runId` (only the tab strip when it is not shown). */
export function refresh(runId) {
  if (runId === state.selected) renderAll();
  else renderTabs();
}

/** Show a tab (or the Browser tab, null) in the panel and the panes. */
export async function select(runId) {
  state.selected = runId;
  renderAll();
  const info = await window.api.showRun(runId);
  for (const pane of ['job', 'chat']) setPaneUrl(pane, info && info[pane] ? info[pane].url : '');
}

async function closeRun(runId) {
  try {
    await window.api.closeRun(runId);
    runs.delete(runId);
    if (state.selected === runId) await select(null);
    else renderTabs();
  } catch (err) {
    log(err.message, runId);
  }
}

// ---------- How many at once ----------

async function loadCapacity() {
  const c = await window.api.capacity();
  const pick = $('parallel-select');
  pick.replaceChildren(el('option', { value: '0' }, 'All links at once'),
    ...Array.from({ length: c.max }, (_, i) => el('option', { value: String(i + 1) }, `${i + 1} at a time`)));
  pick.value = String(c.chosen || 0);
  $('capacity').textContent = `This PC: ${c.freeGb} of ${c.totalGb} GB memory free, ${c.cpus} CPU threads → about ${c.recommended} tabs run comfortably (each needs ~1.2 GB).`;
}

// ---------- ChatGPT login status ----------

function showChatStatus(s) {
  const node = $('chat-status');
  node.textContent = s?.error || (s?.connected ? `Chrome extension connected${s.version ? ` (v${s.version})` : ''}` : 'Extension disconnected: start Chrome and connect from the extension popup');
  node.className = s?.connected && s.compatible !== false ? 'ok' : 'warn';
}

let statusTimer = null;
function refreshChatStatus(delay = 0) {
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => window.api.chatStatus().then(showChatStatus, () => {}), delay);
}

// ---------- Panes ----------

function setPaneUrl(pane, url) {
  const span = document.querySelector(`.pane[data-pane="${pane}"] [data-url]`);
  if (!span) return;
  span.textContent = !url || url.startsWith('file:') ? '' : url;
  span.title = url || '';
}

// ---------- Wiring ----------

export function initWorkspace() {
  $('back-btn').addEventListener('click', async () => {
    await loadProfiles();
    showScreen('profiles');
  });

  $('start-btn').addEventListener('click', async () => {
    const urls = $('url-input').value.split(/\s+/).map(u => u.trim()).filter(Boolean);
    if (!state.profile || !urls.length) return log('Enter at least one job link.');
    try {
      await window.api.startRuns(state.profile.id, urls);
      $('url-input').value = '';
    } catch (err) {
      log(`Could not start: ${err.message}`);
    }
  });
  $('cancel-btn').addEventListener('click', () => state.selected != null && window.api.cancelRun(state.selected));
  $('parallel-select').addEventListener('change', async e => { await window.api.setParallel(Number(e.target.value)); loadCapacity(); });

  $('chat-connect-btn').addEventListener('click', () => refreshChatStatus());
  window.api.getSettings().then(settings => {
    $('automation-mode').value = settings.browserAutomation === false ? 'manual' : 'automatic';
    $('review-answers').checked = !!settings.reviewAnswers;
  });
  $('automation-mode').addEventListener('change', e => window.api.saveSettings({ browserAutomation: e.target.value === 'automatic', llmProvider: e.target.value === 'automatic' ? 'chrome-chat' : 'manual' }));
  $('review-answers').addEventListener('change', e => window.api.saveSettings({ reviewAnswers: e.target.checked }));
  $('focus-browser').addEventListener('click', () => {
    if (state.selected != null) window.api.focusBrowser(state.selected).catch(err => log(err.message));
  });
  setInterval(() => { if (document.visibilityState === 'visible') refreshChatStatus(); }, 5000);

  // Panes
  new ResizeObserver(syncPaneBounds).observe(document.body);
  window.addEventListener('resize', syncPaneBounds);
  document.querySelectorAll('.pane [data-nav]').forEach(btn => {
    btn.addEventListener('click', () => window.api.navigatePane(btn.closest('.pane').dataset.pane, btn.dataset.nav));
  });
  window.api.onPaneUrl(({ slot, pane, url }) => {
    if (pane === 'chat' && slot === 'home') refreshChatStatus(1500); // e.g. logged out or in through the pane itself
    if (String(slot) === String(state.selected == null ? 'home' : state.selected)) setPaneUrl(pane, url);
  });

  // Run events
  window.api.onRunEvent(({ runId, type, payload }) => {
    if (type === 'queued') {
      runs.set(runId, { id: runId, url: payload.url, profileId: payload.profileId, profile: payload.profile, title: '', company: '', status: 'queued', steps: {}, log: [], ask: null, askNode: null });
      log(`Queued: ${payload.url}`, runId);
      if (state.selected == null || !runs.has(state.selected)) select(runId);
      else renderTabs();
      return;
    }
    const run = runs.get(runId);
    if (!run) return;
    if (type === 'started') {
      run.status = 'running';
    } else if (type === 'job') {
      run.title = payload.title || '';
      run.company = payload.company || '';
    } else if (type === 'step') {
      run.steps[payload.name] = payload.status;
      if (payload.error) log(`${STEP_LABELS[payload.name]}: ${payload.error}`, runId);
    } else if (type === 'log') {
      log(payload, runId);
    } else if (type === 'done') {
      run.status = payload.status;
      run.ask = null;
      run.askNode = null;
      log(`Finished: ${payload.status}${payload.folder ? ` → ${payload.folder}` : ''}`, runId);
    }
    refresh(runId);
  });
}
