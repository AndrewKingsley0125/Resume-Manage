// Collects one board, or many with bounded concurrency. A failing board is
// recorded and never stops the others.
const { byId } = require('./providers');

async function syncBoard(store, http, board, { signal } = {}) {
  const provider = byId[board.provider];
  if (!provider) throw new Error(`No collector for provider ${board.provider}.`);
  const runId = store.startRun(board.id);
  try {
    if (signal?.aborted) throw new Error('Cancelled.');
    const fetched = await provider.fetchJobs(board, { http });
    if (fetched.unchanged) {
      const counts = store.markBoardUnchanged(board.id);
      store.finishRun(runId, { status: 'unchanged', ...counts });
      return { board: board.id, ok: true, listingUnchanged: true, ...counts };
    }
    const { jobs: raw, complete } = fetched;
    const jobs = [], errors = [];
    for (const item of raw) {
      try {jobs.push(provider.normalizeJob(item, board));}
      catch (error) {errors.push(error.message);}
    }
    // An empty answer from a board that had jobs is more likely a glitch than a mass closure.
    const counts = store.saveBoardJobs(board.id, jobs, { complete: complete && !(jobs.length === 0 && board.job_count > 0) });
    // Remembered only after a clean save, so a failed or partial read is checked fully next time.
    if (fetched.listingHash) store.setListingHash(board.id, errors.length ? null : fetched.listingHash);
    store.finishRun(runId, { status: errors.length ? 'partial' : 'ok', error: errors.length ? `${errors.length} postings could not be read: ${errors[0]}` : null, ...counts });
    return { board: board.id, ok: true, ...counts, normalizeErrors: errors.length };
  } catch (error) {
    store.recordFailure(board.id, error.message, { gone: error.status === 404 });
    store.finishRun(runId, { status: 'failed', error: error.message });
    return { board: board.id, ok: false, error: error.message, status: error.status };
  }
}

async function syncBoards(store, http, boards, { concurrency = 4, signal, onProgress = () => {} } = {}) {
  const queue = [...boards], results = [];
  let done = 0;
  async function worker() {
    while (queue.length && !signal?.aborted) {
      const board = queue.shift();
      const result = await syncBoard(store, http, board, { signal });
      results.push(result);
      onProgress({ done: ++done, total: boards.length, result });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, boards.length) }, worker));
  return results;
}

// Second stage: description and pay for listed jobs, one job at a time. A job
// the provider no longer has (404) is closed; other failures stay pending.
async function loadDetails(store, http, jobIds, { concurrency = 6, signal, onProgress = () => {} } = {}) {
  const queue = [...jobIds], totals = { total: jobIds.length, done: 0, loaded: 0, closed: 0, failed: 0 };
  async function worker() {
    while (queue.length && !signal?.aborted) {
      const id = queue.shift();
      const job = store.getJob(id);
      const provider = job && byId[job.provider];
      try {
        if (!provider?.fetchDetails) throw new Error('No details to load.');
        if (store.saveJobDetails(await provider.fetchDetails(job, { http }))) totals.loaded++;
      } catch (error) {
        if (error.status === 404) {store.expireJob(id);totals.closed++;} else totals.failed++;
      }
      totals.done++;
      onProgress({ ...totals });
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobIds.length) }, worker));
  return totals;
}

module.exports = { syncBoard, syncBoards, loadDetails };
