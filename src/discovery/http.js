// HTTP for collectors: timeouts, retries with exponential backoff (honouring
// Retry-After on 429/503), at most `perHost` requests in flight per host, and a
// minimum gap between requests to the same host. `fetch` is injectable for tests.
class HttpError extends Error {
  constructor(status, url) {super(`HTTP ${status} for ${url}`);this.status = status;this.url = url;}
}

function createHttp({ fetch = globalThis.fetch, timeoutMs = 60000, retries = 3, perHost = 2, minIntervalMs = 250, userAgent = 'ResumeManager-JobDiscovery/1.0', sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), log = () => {} } = {}) {
  const hosts = new Map();
  const stats = { requests: 0, failures: 0, rateLimited: 0, retries: 0 };
  const slot = host => {
    if (!hosts.has(host)) hosts.set(host, { active: 0, queue: [], last: 0 });
    return hosts.get(host);
  };
  async function acquire(host) {
    const state = slot(host);
    if (state.active >= perHost) await new Promise(resolve => state.queue.push(resolve));
    state.active++;
    const wait = state.last + minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    state.last = Date.now();
  }
  function release(host) {
    const state = slot(host);
    state.active--;
    state.queue.shift()?.();
  }
  async function request(url, { accept = 'application/json', method = 'GET', redirect = 'follow' } = {}) {
    const host = new URL(url).host;
    for (let attempt = 0; ; attempt++) {
      await acquire(host);
      let response;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        stats.requests++;
        response = await fetch(url, { method, redirect, signal: controller.signal, headers: { Accept: accept, 'User-Agent': userAgent } });
      } catch (error) {
        response = { networkError: error };
      } finally {
        clearTimeout(timer);
        release(host);
      }
      const retryable = response.networkError || response.status === 429 || response.status >= 500;
      if (!retryable) return response;
      if (response.status === 429) stats.rateLimited++;
      if (attempt >= retries) {
        stats.failures++;
        if (response.networkError) throw response.networkError;
        throw new HttpError(response.status, url);
      }
      stats.retries++;
      const after = Number(response.headers?.get?.('retry-after'));
      const delay = Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 60000) : Math.min(1000 * 2 ** attempt, 30000);
      log(`retry ${attempt + 1} for ${url} in ${delay}ms`);
      await sleep(delay);
    }
  }
  async function getJson(url) {
    const response = await request(url);
    if (!response.ok) {stats.failures++;throw new HttpError(response.status, url);}
    return response.json();
  }
  async function getText(url) {
    const response = await request(url, { accept: 'text/html,*/*' });
    return { status: response.status, ok: response.ok, url: response.url || url, text: response.ok ? await response.text() : '' };
  }
  return { request, getJson, getText, stats };
}

module.exports = { createHttp, HttpError };
