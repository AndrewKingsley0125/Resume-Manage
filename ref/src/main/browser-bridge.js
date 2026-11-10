const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');

async function createBrowserBridge(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const token = randomBytes(32).toString('hex');
  const pending = new Map();
  let client, sequence = 0;
  const rejectPending = () => {
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Chrome extension disconnected')); }
    pending.clear();
  };
  const server = net.createServer(socket => {
    let buffer = '', authenticated = false;
    socket.setEncoding('utf8');
    socket.setTimeout(10000, () => { if (!authenticated) socket.destroy(); });
    socket.on('error', () => {});
    socket.on('data', chunk => {
      buffer += chunk;
      if (Buffer.byteLength(buffer) > 2 * 1024 * 1024) return socket.destroy();
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
        let message;
        try { message = JSON.parse(line); } catch { socket.destroy(); return; }
        if (!authenticated) {
          if (message.token !== token || client) return socket.destroy();
          authenticated = true; client = socket; socket.setTimeout(0);
          socket.write(JSON.stringify({ ready: true }) + '\n'); continue;
        }
        const item = pending.get(message.id);
        if (!item) continue;
        pending.delete(message.id); clearTimeout(item.timer);
        if (message.error) item.reject(new Error(message.error)); else item.resolve(message.result);
      }
    });
    socket.on('close', () => { if (client === socket) { client = null; rejectPending(); } });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const configFile = path.join(directory, 'connection.json');
  fs.writeFileSync(configFile, JSON.stringify({ port: server.address().port, token }));
  return {
    connected: () => !!client,
    request(command, payload = {}) {
      if (!client) return Promise.reject(new Error('Connect the Auto Apply extension in Chrome first. See extension/README.md.'));
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Chrome timed out: ${command}`)); }, command === 'fill' ? 120000 : 30000);
        pending.set(id, { resolve, reject, timer });
        client.write(JSON.stringify({ id, command, ...payload }) + '\n');
      });
    },
    close() { client?.destroy(); rejectPending(); server.close(); fs.rmSync(configFile, { force: true }); },
  };
}
module.exports = { createBrowserBridge };
