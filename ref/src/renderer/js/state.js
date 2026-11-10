// State shared by the screens: the runs (one per tab), which tab is shown,
// which profile's workspace is open, and the logs.
import { $ } from './dom.js';

export const STEP_LABELS = {
  open: 'Open job page', extract: 'Read job description', prompt: 'Generate prompt from profile', generate: 'Generate resume (ChatGPT)',
  export: 'Save PDF / DOCX / JD', apply: 'Open application form', fill: 'Fill questions',
  submit: 'Submit',
};

export const FINISHED = new Set(['submitted', 'submitted-unconfirmed', 'failed', 'cancelled', 'skipped']);

/** run id → { id, url, profileId, profile, title, company, status, steps, log, ask, askNode } */
export const runs = new Map();

export const state = {
  selected: null, // shown run id, or null for the "Browser" tab
  profile: null, // profile of the open workspace
};

const generalLog = [];

export const shownRun = () => (state.selected != null ? runs.get(state.selected) : null);
export const logLines = () => (shownRun() ? shownRun().log : generalLog);

/** Add a line to a tab's log (or the general log); shown if that log is on screen. */
export function log(message, runId = null) {
  const line = `${new Date().toLocaleTimeString()}  ${message}`;
  const run = runId != null && runs.get(runId);
  (run ? run.log : generalLog).push(line);
  $('home-log').textContent = generalLog.slice(-20).join('\n');
  if ((run ? runId : null) === (shownRun() ? state.selected : null)) {
    $('log').textContent += `${line}\n`;
    $('log').scrollTop = $('log').scrollHeight;
  }
}

/** Show one screen: profiles, editor or workspace. The browser views only show on the workspace. */
export function showScreen(name) {
  for (const s of ['profiles', 'editor', 'workspace']) $(`view-${s}`).classList.toggle('hidden', s !== name);
  requestAnimationFrame(syncPaneBounds);
}

export const onScreen = name => !$(`view-${name}`).classList.contains('hidden');

/**
 * The native browser views sit on top of each .pane-body; keep them aligned
 * with the layout (a hidden screen reports an empty box, which hides them).
 */
export function syncPaneBounds() {
  document.querySelectorAll('.pane').forEach(pane => {
    const r = pane.querySelector('.pane-body').getBoundingClientRect();
    window.api.setPaneBounds(pane.dataset.pane, { x: r.left, y: r.top, width: r.width, height: r.height });
  });
}
