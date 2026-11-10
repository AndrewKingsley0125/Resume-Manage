// Launches the installed Chrome (or Edge) through Playwright with a
// persistent profile directory, so logins to job sites survive between runs.
const { chromium } = require('playwright-core');

/**
 * @param {{profileDir:string, channel?:'chrome'|'msedge', headless?:boolean}} opts
 */
async function launchBrowser({ profileDir, channel = 'chrome', headless = false }) {
  const context = await chromium.launchPersistentContext(profileDir, {
    channel,
    headless,
    viewport: null, // use the real window size
    args: ['--start-maximized'],
  });
  const page = context.pages()[0] || (await context.newPage());
  return { context, page, close: () => context.close() };
}

const connections = new Map(); // port → CDP-connected browser, reused across attaches

/**
 * Attach Playwright to the app's own embedded panes over the local DevTools
 * port, so adapters drive them like normal pages.
 * @param {number} port
 * @param {Record<string, () => string>} currentUrls  pane name → its current URL (from Electron)
 * @returns {Promise<Record<string, import('playwright-core').Page>>}
 */
async function connectToApp(port, currentUrls) {
  let browser = connections.get(port);
  if (!browser || !browser.isConnected()) {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    connections.set(port, browser);
  }
  const pages = () => browser.contexts().flatMap(c => c.pages());
  const found = {};
  for (let attempt = 0; attempt < 20 && Object.keys(found).length < Object.keys(currentUrls).length; attempt++) {
    for (const [name, url] of Object.entries(currentUrls)) {
      if (!found[name]) found[name] = pages().find(p => p.url() === url() && !Object.values(found).includes(p));
    }
    if (Object.keys(found).filter(k => found[k]).length < Object.keys(currentUrls).length) await new Promise(r => setTimeout(r, 250));
  }
  for (const name of Object.keys(currentUrls)) if (!found[name]) throw new Error(`Could not attach to the ${name} pane`);
  return found;
}

module.exports = { launchBrowser, connectToApp };
