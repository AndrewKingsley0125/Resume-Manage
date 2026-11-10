// Loads the browser-style template registry (resume.js + templates/) into a
// Node vm context so the main process can render resume HTML without a
// renderer window. Same output Resume Manager uses for preview and PDF.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Same load order as Resume Manager's index.html: core, the shared
// single-column base, then one file per template (list order).
const FILES = [
  'resume.js',
  'templates/core.js', 'templates/single-column.js',
  'templates/classic.js', 'templates/timeline.js', 'templates/banner.js', 'templates/section-accent.js',
  'templates/skill-chips.js', 'templates/accent-rail.js', 'templates/compact-pro.js',
];
const DEFAULT_TEMPLATE = 'classic';

let registry = null;

function load() {
  if (registry) return registry;
  const context = { window: { App: {} } };
  vm.createContext(context);
  for (const file of FILES) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context, { filename: file });
  }
  registry = context.window.App.Templates;
  return registry;
}

function listTemplates() {
  return load().list().map(t => ({ id: t.id, name: t.name, description: t.description }));
}

/** Profiles saved with a since-removed template (e.g. "modern") fall back to Classic, as in Resume Manager. */
function resolveTemplateId(id) {
  return load().list().some(t => t.id === id) ? id : DEFAULT_TEMPLATE;
}

/** Saved toolbar values over the template defaults, as Resume Manager's workspace holds them for preview, PDF and DOCX. */
function styleFor(templateId, style) {
  return { ...load().defaultStyleFor(resolveTemplateId(templateId)), ...(style || {}) };
}

function renderHtml(profile, data, templateId, style) {
  const id = resolveTemplateId(templateId);
  return load().get(id).render({ profile, data, style: styleFor(id, style) });
}

module.exports = { registry: load, listTemplates, renderHtml, styleFor, resolveTemplateId, DEFAULT_TEMPLATE };
