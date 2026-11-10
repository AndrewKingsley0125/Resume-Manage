// Drives chatgpt.com in the app's ChatGPT pane with mouse and keyboard
// events: new chat → click the input → insert the request as typed text
// → click Send → wait for the reply → click "Copy" and read it.
//
// ChatGPT serves a mobile layout when the pane is narrow and a desktop one
// when wide; selectors cover both. They depend on ChatGPT's page and may need
// updating when it changes.
const { createCursor } = require('../../automation/cursor');
const { Cancelled } = require('../../automation/cancelled');

const NEW_CHAT_URL = 'https://chatgpt.com/';
// Logged-out pages use a textarea; logged-in pages use a ProseMirror rich-text box.
const SEL = {
  input: [
    '#prompt-textarea', '#mobile-composer-prompt', 'textarea[aria-label="Chat with ChatGPT"]',
    '[contenteditable="true"][aria-label="Ask ChatGPT"]', 'div.ProseMirror[contenteditable="true"]',
  ].join(', '),
  send: 'button[data-testid="send-button"], button[aria-label^="Send"]',
  stop: 'button[data-testid="stop-button"], button[aria-label^="Stop"]',
  copyReply: 'button[data-testid="copy-turn-action-button"], button[aria-label="Copy response"], button[aria-label="Copy"]',
};
const REPLY_TIMEOUT_MS = 10 * 60 * 1000;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const visible = (page, selector) => page.locator(selector).filter({ visible: true });

/**
 * @param {object} deps
 * @param {() => Promise<import('playwright-core').Page>} deps.getChatPage
 * @param {(text: string) => Promise<void>} deps.paste  backup only: clipboard + Ctrl+V into the focused element
 * @param {(action: () => Promise<void>) => Promise<string>} deps.copyText  run a "copy" click, return what it put on the clipboard
 * @param {Function} deps.askUser
 * @param {object} deps.settings
 */
module.exports = function chatgptWeb({ getChatPage, paste, copyText, askUser, settings = {} }) {
  /** Wait for the chat input; hand login / verification screens to the user. */
  async function findInput(page) {
    for (let round = 0; round < 5; round++) {
      const input = visible(page, SEL.input).first();
      if (await input.waitFor({ timeout: 20000 }).then(() => true, () => false)) return input;
      const go = await askUser({
        kind: 'notice', blocker: 'chatgpt',
        message: 'ChatGPT is not ready. Log in or finish its check in the ChatGPT pane, then press Continue.',
      });
      if (!go) throw new Cancelled();
    }
    throw new Error('ChatGPT input not found');
  }

  const inputText = input => input.evaluate(el => (el.value !== undefined ? el.value : el.innerText) || '');

  /** A long paste becomes a "Pasted text" attachment chip; ChatGPT still reads it, so it counts as entered. */
  const attachmentAdded = page => page.getByText('Pasted text', { exact: true }).filter({ visible: true }).count().then(n => n > 0);

  /**
   * A reply is done when a new reply "Copy" button exists and nothing is
   * streaming. Counts all buttons, visible or not: in a continued chat the
   * older replies' buttons may be hidden until hovered.
   */
  async function waitForReply(page, copyButtonsBefore) {
    const end = Date.now() + REPLY_TIMEOUT_MS;
    let quiet = 0;
    while (Date.now() < end) {
      await sleep(1000);
      const streaming = await visible(page, SEL.stop).count();
      const copies = await page.locator(SEL.copyReply).count();
      quiet = !streaming && copies > copyButtonsBefore ? quiet + 1 : 0;
      if (quiet >= 2) return page.locator(SEL.copyReply).last();
    }
    throw new Error('ChatGPT did not finish replying in time');
  }

  let conversationUrl = null; // chat the last reply came from, for follow-up questions

  /**
   * Go to a chat. ChatGPT can take long to fire "domcontentloaded" (it kept a
   * run waiting 30s while the page was already usable), so only the start of
   * the navigation is awaited; findInput() then waits for the composer.
   * An empty new chat that is already open is reused as is.
   */
  async function openChat(page, url) {
    const here = page.url();
    if (url === NEW_CHAT_URL && /^https:\/\/chatgpt\.com\/?(\?.*)?$/.test(here) && !(await page.locator(SEL.copyReply).count())) return;
    if (url !== NEW_CHAT_URL && here === url) return;
    try {
      await page.goto(url, { waitUntil: 'commit', timeout: 60000 });
    } catch (err) {
      if (!page.url().startsWith('https://chatgpt.com')) throw err; // the page is there; the load event was just slow
    }
  }

  /** Clipboard writes need a focused page; emulate focus so copying works while the app is in the background. */
  async function emulateFocus(page) {
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  }

  /** Fallback when the clipboard copy yields nothing: read the reply from the page. */
  async function readReplyFromPage(page) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const text = await page.evaluate(() => {
        const code = [...document.querySelectorAll('pre code, code')].pop();
        if (code && code.textContent.trim()) return code.textContent;
        const reply = [...document.querySelectorAll('[data-message-author-role="assistant"], [class*="ResponseRoot"]')].pop();
        return reply ? reply.innerText : '';
      });
      if (text.trim()) return text;
      await sleep(500); // code block may still be rendering
    }
    return '';
  }

  return {
    name: 'chatgpt-web',
    keepsConversation: true,
    /** `newChat: false` continues the chat of the previous reply (e.g. questions after the resume). */
    async complete(text, { newChat = true } = {}) {
      const page = await getChatPage();
      const cursor = createCursor(page, { human: settings.humanCursor !== false });
      await openChat(page, newChat || !conversationUrl ? NEW_CHAT_URL : conversationUrl);
      await emulateFocus(page);
      const input = await findInput(page);
      const copyButtonsBefore = await page.locator(SEL.copyReply).count();

      // Insert the request as typed text in one input event. A real paste of a
      // long text is turned into a "Pasted text" file attachment by ChatGPT.
      await cursor.click(input);
      await page.keyboard.insertText(text);
      const expected = Math.min(50, text.trim().length);
      if ((await inputText(input)).trim().length < expected) {
        await cursor.click(input);
        await paste(text); // backup: clipboard + Ctrl+V
      }
      if ((await inputText(input)).trim().length < expected && !(await attachmentAdded(page))) {
        throw new Error('Could not put the request into ChatGPT');
      }

      // Click the Send button with the cursor; Enter only if the button never shows.
      await cursor.pause(300, 700);
      const send = visible(page, SEL.send).first();
      if (await send.waitFor({ timeout: 10000 }).then(() => true, () => false)) await cursor.click(send);
      else await page.keyboard.press('Enter');

      const copyButton = await waitForReply(page, copyButtonsBefore);
      conversationUrl = page.url(); // https://chatgpt.com/c/<id> once the chat exists
      await copyButton.scrollIntoViewIfNeeded().catch(() => {});
      await copyButton.hover().catch(() => {}); // reveals the button if it only shows on hover
      const reply = (await copyText(() => cursor.click(copyButton).catch(() => {}))) || (await readReplyFromPage(page));
      if (!reply.trim()) throw new Error('Could not read the ChatGPT reply');
      return cleanReply(reply);
    },
  };
};

/**
 * Copied replies look like "json\r\n\r\n```json\r\n{...}\r\n```". Return the
 * code block's content when there is one, else the whole text, with \n endings.
 */
function cleanReply(text) {
  const normalized = String(text).replace(/\r\n?/g, '\n').trim();
  const fenced = /```[\w-]*\n([\s\S]*?)\n?```/.exec(normalized);
  return fenced ? fenced[1].trim() : normalized;
}

module.exports.cleanReply = cleanReply;
