const PROTOCOL_VERSION = 2;
const REQUIRED_COMMANDS = ['open', 'read', 'state', 'scan', 'fill', 'apply', 'next', 'submit',
  'uploadStart', 'uploadChunk', 'uploadEnd', 'chatOpen', 'chatPrompt', 'chatSend', 'chatState'];
const RELOAD_EXTENSION_MESSAGE = 'Chrome is running an outdated Auto Apply extension. Open chrome://extensions (edge://extensions in Edge), find Auto Apply Browser Companion, and click Reload. If its folder is different, load this project’s extension folder. Reconnect, then retry. Required version: 0.2.0 or later.';

async function checkBrowserCompatibility(bridge) {
  if (!bridge.connected()) throw new Error('Connect the Auto Apply Chrome extension first.');
  let capabilities;
  try { capabilities = await bridge.request('capabilities'); }
  catch (error) {
    if (/unsupported browser command/i.test(error.message)) throw new Error(RELOAD_EXTENSION_MESSAGE);
    throw error;
  }
  if (!capabilities || capabilities.protocol !== PROTOCOL_VERSION || !Array.isArray(capabilities.commands)
    || REQUIRED_COMMANDS.some(command => !capabilities.commands.includes(command))) throw new Error(RELOAD_EXTENSION_MESSAGE);
  return capabilities;
}
module.exports = { PROTOCOL_VERSION, REQUIRED_COMMANDS, RELOAD_EXTENSION_MESSAGE, checkBrowserCompatibility };
