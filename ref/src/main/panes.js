// The embedded browsers: job site (middle) and ChatGPT (right). Each has
// a persistent session so logins survive restarts. The job pane uses one
// session per profile, so job-site accounts never mix between candidates;
// ChatGPT is shared. The renderer owns the layout and reports each pane's
// rectangle; this module positions the native views over those rectangles.
//
// Views come in slots of { job, chat }. Slot 'home' is for browsing and
// logging in by hand; every application run gets a slot of its own, so runs
// can go in parallel. Only the shown slot is visible; the others keep the
// same size and keep running (no background throttling) behind it.
const { WebContentsView, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const CHATGPT_URL = 'https://chatgpt.com/';
const PLACEHOLDER = path.join(__dirname, '..', 'renderer', 'job-placeholder.html');
const HOME = 'home';

const jobPartition = profileId => `persist:jobs-${String(profileId).replace(/[^a-zA-Z0-9_-]/g, '_')}`;

function createView(win, partition, onUrl) {
  const view = new WebContentsView({
    webPreferences: { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.contentView.addChildView(view);
  const wc = view.webContents;
  // Keep everything inside the pane: popups and target=_blank load here instead.
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) wc.loadURL(url);
    else shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  const report = () => onUrl(wc.getURL(), wc.getTitle());
  wc.on('did-navigate', report);
  wc.on('did-navigate-in-page', report);
  wc.on('page-title-updated', report);
  return view;
}

function closeView(win, view) {
  if (!view) return;
  win.contentView.removeChildView(view);
  if (!view.webContents.isDestroyed()) view.webContents.close();
}

/**
 * @param {BrowserWindow} win
 * @param {(slot: string, pane: 'job'|'chat', url: string, title: string) => void} onUrl
 */
function createPanes(win, onUrl) {
  const rects = {};
  const slots = new Map();
  let shown = HOME;
  let covered = false; // a modal in the control panel is open: native views would sit on top of it
  const home = { job: null, chat: createView(win, 'persist:chatgpt', (u, t) => onUrl(HOME, 'chat', u, t)), profileId: null };
  slots.set(HOME, home);
  home.chat.webContents.loadURL(CHATGPT_URL);

  function place(slotId, name) {
    const view = slots.get(slotId)[name], rect = rects[name];
    if (!view) return;
    if (!rect || rect.width < 10 || rect.height < 10) return view.setVisible(false);
    // Hidden slots keep the pane's size so their pages lay out (and take clicks) as if shown.
    view.setBounds({ x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) });
    view.setVisible(slotId === shown && !covered);
  }
  const placeAll = () => { for (const id of slots.keys()) for (const name of ['job', 'chat']) place(id, name); };

  return {
    get job() { return home.job; },
    get chat() { return home.chat; },
    get profileId() { return home.profileId; },
    get shown() { return shown; },

    /** Switch the home job pane to `profileId`'s own session. Returns true if it changed. */
    useProfile(profileId) {
      if (home.profileId === profileId && home.job) return false;
      closeView(win, home.job);
      home.job = createView(win, jobPartition(profileId), (u, t) => onUrl(HOME, 'job', u, t));
      home.job.webContents.loadFile(PLACEHOLDER);
      home.profileId = profileId;
      placeAll();
      return true;
    },

    /**
     * A new slot for one run: a job view in the profile's session and a ChatGPT
     * view. Both start on a URL unique to the slot so Playwright can tell them apart.
     */
    async createSlot(slotId, profileId) {
      const slot = {
        job: createView(win, jobPartition(profileId), (u, t) => onUrl(slotId, 'job', u, t)),
        chat: createView(win, 'persist:chatgpt', (u, t) => onUrl(slotId, 'chat', u, t)),
        profileId,
      };
      slots.set(slotId, slot);
      placeAll();
      const start = `${pathToFileURL(PLACEHOLDER).href}#slot-${slotId}`;
      await Promise.all([slot.job.webContents.loadURL(`${start}-job`), slot.chat.webContents.loadURL(`${start}-chat`)]);
      return slot;
    },

    slot: slotId => slots.get(slotId),

    closeSlot(slotId) {
      const slot = slots.get(slotId);
      if (!slot || slotId === HOME) return;
      closeView(win, slot.job);
      closeView(win, slot.chat);
      slots.delete(slotId);
      if (shown === slotId) this.show(HOME);
    },

    /** Show one slot's views in the panes; returns their current URLs for the pane bars. */
    show(slotId) {
      if (!slots.has(slotId)) slotId = HOME;
      shown = slotId;
      placeAll();
      const slot = slots.get(slotId);
      const info = name => (slot[name] ? { url: slot[name].webContents.getURL(), title: slot[name].webContents.getTitle() } : null);
      return { slot: slotId, job: info('job'), chat: info('chat') };
    },

    /** Hide the panes while the control panel shows a modal over them (false: show again). */
    cover(on) {
      covered = !!on;
      placeAll();
    },

    /** rect in window content coordinates (CSS px), or null to hide */
    setBounds(name, rect) {
      rects[name] = rect;
      for (const id of slots.keys()) place(id, name);
    },

    /** Back / reload / home in the pane that is showing. */
    navigate(name, action) {
      const view = slots.get(shown)[name];
      const wc = view && view.webContents;
      if (!wc) return;
      if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
      else if (action === 'reload') wc.reload();
      else if (action === 'home') name === 'chat' ? wc.loadURL(CHATGPT_URL) : wc.loadFile(PLACEHOLDER);
    },
  };
}

module.exports = { createPanes, CHATGPT_URL, jobPartition, HOME };
