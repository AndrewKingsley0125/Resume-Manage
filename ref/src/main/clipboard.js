// The system clipboard, used to paste requests into ChatGPT (backup path)
// and to read its "Copy response" output. It is shared by all tabs, so only
// one paste or copy runs at a time: a reply copied in one ChatGPT tab is never
// read by another run. The user's own clipboard content is put back afterwards.
const { clipboard } = require('electron');

let queue = Promise.resolve();
function withClipboard(fn) {
  const turn = queue.then(fn, fn);
  queue = turn.catch(() => {});
  return turn;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Paste `text` into the focused element of a ChatGPT view: clipboard + Ctrl+V. */
const pasteIntoChat = (chat, chatView, text) => withClipboard(async () => {
  const previous = clipboard.readText();
  clipboard.writeText(text);
  try {
    const focusedLength = () => chat.evaluate(() => ((document.activeElement || {}).innerText || (document.activeElement || {}).value || '').length);
    await chat.keyboard.press('Control+V');
    await sleep(500);
    if ((await focusedLength()) === 0) {
      chatView.webContents.paste(); // native paste command if the key event was not handled
      await sleep(500);
    }
  } finally {
    clipboard.writeText(previous);
  }
});

/** Run a click that copies something (e.g. "Copy response") and return the copied text. */
const copyFromChat = action => withClipboard(async () => {
  const previous = clipboard.readText();
  clipboard.writeText('');
  try {
    await action();
    for (let i = 0; i < 30; i++) {
      const text = clipboard.readText();
      if (text) return text;
      await sleep(100);
    }
    return '';
  } finally {
    clipboard.writeText(previous);
  }
});

module.exports = { pasteIntoChat, copyFromChat };
