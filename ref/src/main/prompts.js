// Questions a run asks the user (review answers, confirm submit, manual
// steps, failures). They go to the control panel as 'run:ask' and come back
// through respond(id, value).
const { Notification } = require('electron');

/** @param {() => import('electron').BrowserWindow} getWin */
function createPrompts(getWin) {
  const pending = new Map(); // request id → { resolve, runId }
  let nextId = 1;

  /** System notification + taskbar flash, for manual steps while the user may be elsewhere. */
  function alertUser(message) {
    const win = getWin();
    if (Notification.isSupported()) new Notification({ title: 'Auto Apply needs you', body: message }).show();
    if (win && !win.isFocused()) win.flashFrame(true);
  }

  /** Ask the user something on behalf of run `runId`. */
  function askUser(runId, request) {
    return new Promise(resolve => {
      const id = nextId++;
      pending.set(id, { resolve, runId });
      getWin().webContents.send('run:ask', { id, runId, ...request });
      if (request.kind === 'notice') alertUser(request.message);
      if (request.kind === 'failed') alertUser(`Failed: ${request.error}`);
    });
  }

  /** The panel's answer to request `id`. */
  function respond(id, value) {
    const p = pending.get(id);
    pending.delete(id);
    if (p) p.resolve(value);
  }

  /** Answer every open request of one run (e.g. with null when it is cancelled). */
  function resolveRun(runId, value) {
    for (const [id, p] of pending) {
      if (p.runId !== runId) continue;
      pending.delete(id);
      p.resolve(value);
    }
  }

  return { askUser, respond, resolveRun };
}

module.exports = { createPrompts };
