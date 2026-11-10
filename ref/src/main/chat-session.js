// ChatGPT login for accounts that sign in with Google (Google blocks sign-in
// inside embedded browsers): the session cookie copied from the user's normal
// Chrome is installed into the shared ChatGPT session. All tabs use it.
const { CHATGPT_URL } = require('./panes');
const { parseSessionInput, SESSION_COOKIE } = require('../core/chatgpt-session');

/** Who the ChatGPT pane is logged in as, from ChatGPT's own session endpoint. */
async function chatSessionStatus(chatView) {
  const wc = chatView.webContents;
  if (!wc.getURL().startsWith('https://chatgpt.com')) return { loggedIn: false };
  try {
    const s = await wc.executeJavaScript("fetch('/api/auth/session', { credentials: 'include' }).then(r => (r.ok ? r.json() : {})).catch(() => ({}))");
    return s && s.user ? { loggedIn: true, email: s.user.email || s.user.name || '' } : { loggedIn: false };
  } catch (_) {
    return { loggedIn: false };
  }
}

/**
 * Install a session copied from the user's normal browser. Chromium keeps it
 * in the ChatGPT session's cookie store (encrypted by Windows).
 */
async function connectChatSession(chatView, input) {
  const cookies = parseSessionInput(input);
  const ses = chatView.webContents.session;
  for (const c of await ses.cookies.get({ domain: 'chatgpt.com' })) {
    if (SESSION_COOKIE.test(c.name)) await ses.cookies.remove(CHATGPT_URL, c.name);
  }
  const expirationDate = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
  for (const c of cookies) {
    await ses.cookies.set({
      url: CHATGPT_URL, domain: '.chatgpt.com', path: '/', name: c.name, value: c.value,
      secure: true, httpOnly: true, sameSite: 'lax', expirationDate,
    });
  }
  await ses.cookies.flushStore();
  await chatView.webContents.loadURL(CHATGPT_URL);
  return chatSessionStatus(chatView);
}

module.exports = { chatSessionStatus, connectChatSession };
