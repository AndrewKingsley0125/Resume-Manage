(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.App = root.App || {}; root.App.ProfileWorkflow = factory(); }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const MAX_EXTENSIONS = 8;
  const normalizeMode = value => value === 'extension' ? 'extension' : 'manual';

  function parseJobLinks(text) {
    const links = [];
    const seen = new Set();
    for (const [index, line] of String(text).split(/\r?\n/).entries()) {
      const value = line.trim();
      if (!value) continue;
      let url;
      try { url = new URL(value); } catch (_) {
        throw new Error(`Line ${index + 1}: enter a complete http:// or https:// job link.`);
      }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) {
        throw new Error(`Line ${index + 1}: use an HTTP or HTTPS job link without login credentials.`);
      }
      if (!seen.has(url.href)) { seen.add(url.href); links.push(url.href); }
    }
    return links;
  }

  function normalizeJobLinks(value) {
    if (!Array.isArray(value)) return [];
    const links = [];
    for (const item of value) {
      if (typeof item !== 'string') continue;
      try { links.push(...parseJobLinks(item)); } catch (_) { /* skip malformed saved links */ }
    }
    return [...new Set(links)];
  }
  return { MAX_EXTENSIONS, normalizeMode, parseJobLinks, normalizeJobLinks };
});
