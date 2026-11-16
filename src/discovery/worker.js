// Discovery worker thread: owns discovery.db and all collection network work.
// Messages in:  {id, method, args}
// Messages out: {id, result} | {id, error}   and   {event, ...} for progress
process.removeAllListeners('warning');
process.on('warning', warning => {if (!/SQLite/i.test(warning.message)) console.warn(warning.message);});
const { parentPort, workerData } = require('node:worker_threads');
const { createService } = require('./service');

const service = createService({ dbPath: workerData.dbPath, emit: message => parentPort.postMessage(message) });
const METHODS = new Set(['status', 'discover', 'sync', 'stop', 'addBoard', 'searchProfile', 'saveSearchProfile', 'matches', 'job', 'verify', 'mark']);

parentPort.on('message', async ({ id, method, args }) => {
  try {
    if (!METHODS.has(method)) throw new Error(`Unknown discovery request: ${method}`);
    parentPort.postMessage({ id, result: await service[method](args || {}) });
  } catch (error) {
    parentPort.postMessage({ id, error: error.message || String(error) });
  }
});
