// Free board discovery from the Common Crawl URL index (https://index.commoncrawl.org),
// a public index of crawled pages that needs no key. Every ATS job-board URL in
// a crawl names its board, e.g. boards.greenhouse.io/<token>/jobs/123.
//
// The index server is shared and often slow (504s), so requests go one at a
// time with long backoff, and each finished crawl/pattern/page is recorded:
// an interrupted run picks up where it stopped. Lever blocks Common Crawl's
// crawler, so few Lever boards appear here.
const { detectSource } = require('../providers');

const INDEX = 'https://index.commoncrawl.org';
const PATTERNS = [
  'boards.greenhouse.io/*', 'job-boards.greenhouse.io/*', 'boards.eu.greenhouse.io/*', 'job-boards.eu.greenhouse.io/*',
  'jobs.ashbyhq.com/*', 'jobs.lever.co/*', 'jobs.eu.lever.co/*',
];
// Board tokens are short slugs; anything else in a URL path is noise.
const TOKEN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const NOT_BOARDS = new Set(['embed', 'v1', 'api', 'jobs', 'robots.txt', 'favicon.ico', 'sitemap.xml', 'assets', 'static', 'search']);

// NDJSON lines from the index -> unique boards.
function boardsFromIndex(text) {
  const boards = new Map();
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    let url;
    try {url = JSON.parse(line).url;} catch (_) {continue;}
    const found = url && detectSource(url);
    if (!found || !TOKEN.test(found.board) || NOT_BOARDS.has(found.board)) continue;
    boards.set(`${found.provider}:${found.board}`, found);
  }
  return [...boards.values()];
}

async function recentCrawls(http, count) {
  const list = await http.getJson(`${INDEX}/collinfo.json`);
  return list.slice(0, count).map(crawl => crawl.id);
}

// Yields progress; registers boards as it goes. Stops early on `signal`.
async function discoverBoards({ http, store, crawls = 4, patterns = PATTERNS, signal, onProgress = () => {} }) {
  const ids = Array.isArray(crawls) ? crawls : await recentCrawls(http, crawls);
  const summary = { crawls: ids.length, requests: 0, found: 0, added: 0, failed: 0, skipped: 0 };
  for (const crawl of ids) {
    for (const pattern of patterns) {
      if (signal?.aborted) return summary;
      const base = `${INDEX}/${crawl}-index?url=${encodeURIComponent(pattern)}&output=json&fl=url`;
      let pages;
      try {
        const info = await http.getText(`${base}&showNumPages=true`);summary.requests++;
        // No captures at all for this pattern in this crawl.
        if (info.status === 404) {store.markTask(`cc:${crawl}:${pattern}:all`, 0);continue;}
        pages = info.ok ? Number(JSON.parse(info.text).pages) || 0 : null;
      } catch (_) {pages = null;}
      if (pages == null) {summary.failed++;onProgress({ crawl, pattern, error: 'index unavailable' });continue;}
      for (let page = 0; page < pages; page++) {
        if (signal?.aborted) return summary;
        const key = `cc:${crawl}:${pattern}:${page}`;
        if (store.taskDone(key)) {summary.skipped++;continue;}
        try {
          const result = await http.getText(`${base}&page=${page}`);summary.requests++;
          if (!result.ok && result.status !== 404) throw new Error(`HTTP ${result.status}`);
          const boards = result.ok ? boardsFromIndex(result.text) : [];
          const added = store.addBoards(boards, 'commoncrawl');
          store.markTask(key, boards.length);
          summary.found += boards.length;summary.added += added;
          onProgress({ crawl, pattern, page, pages, found: boards.length, added });
        } catch (error) {
          // Left undone: the next run asks for this page again.
          summary.failed++;onProgress({ crawl, pattern, page, pages, error: error.message });
        }
      }
    }
  }
  return summary;
}

module.exports = { PATTERNS, boardsFromIndex, discoverBoards, recentCrawls };
