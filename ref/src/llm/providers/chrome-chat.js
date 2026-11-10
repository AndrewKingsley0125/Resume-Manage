const { Cancelled } = require('../../automation/cancelled');
const { cleanReply } = require('./chatgpt-web');

module.exports = function chromeChat({ bridge, runId, askUser, cancelled = () => false, pollMs = 1000, timeoutMs = 600000 }) {
  const check = () => { if (cancelled()) throw new Cancelled(); };
  const request = async (command, payload = {}) => { check(); const result = await bridge.request(command, { runId, ...payload }); check(); return result; };
  const pause = async () => { await new Promise(resolve => setTimeout(resolve, pollMs)); check(); };
  async function handoff(message) {
    if (!(await askUser({ kind: 'notice', blocker: 'chatgpt', message }))) throw new Cancelled();
    check();
  }
  return {
    name: 'chrome-chat', keepsConversation: true,
    async complete(text, { newChat = false } = {}) {
      await request('chatOpen', { newChat });
      let waiting = Date.now();
      for (;;) {
        const state = await request('chatState');
        if (state.ready && !state.streaming) break;
        if (state.blocked || Date.now() - waiting > 20000) {
          await handoff('In the ChatGPT Chrome tab, finish sign-in or verification, or resolve the displayed error. Then Continue; sending and reading the reply are automatic.');
          waiting = Date.now();
        }
        await pause();
      }
      await request('chatPrompt', { text });
      let sent = false;
      const sendDeadline = Date.now() + 15000;
      while (Date.now() < sendDeadline) {
        const result = await request('chatSend');
        if (result.sent) { sent = true; break; }
        await pause();
      }
      if (!sent) throw new Error('ChatGPT Send button is unavailable. Check the ChatGPT tab before retrying.');
      const deadline = Date.now() + timeoutMs;
      let previous = '', quiet = 0;
      while (Date.now() < deadline) {
        await pause();
        const state = await request('chatState');
        if (state.blocked || state.error) {
          await handoff(state.error || 'Finish the verification in the ChatGPT Chrome tab, then Continue.');
          continue;
        }
        if (!state.streaming && state.newReply && state.text?.trim()) {
          quiet = state.text === previous ? quiet + 1 : 0;
          previous = state.text;
          if (quiet >= 2) return cleanReply(state.text);
        } else { quiet = 0; previous = ''; }
      }
      throw new Error('ChatGPT did not finish within 10 minutes. Check its Chrome tab before retrying.');
    },
  };
};
