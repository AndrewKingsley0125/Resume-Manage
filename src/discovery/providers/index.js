// Collector registry. A provider module exports:
//   id                             string
//   detectSource(url)              { provider, board, ... } | null
//   boardUrl(board)                public board page
//   fetchJobs(board, {http})       { jobs: raw[], complete: boolean }
//   normalizeJob(raw, board)       job record (see ../normalize.js)
// Only providers with a working, tested collector are listed here.
const providers = [require('./greenhouse'), require('./lever'), require('./ashby')];

const byId = Object.fromEntries(providers.map(provider => [provider.id, provider]));

function detectSource(url) {
  for (const provider of providers) {
    const found = provider.detectSource(url);
    if (found) return found;
  }
  return null;
}

module.exports = { providers, byId, detectSource };
