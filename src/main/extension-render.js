const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Resume = require('../shared/resume');
let registry;
function templates() {
  if (registry) return registry;
  const context = {window:{App:{Resume}}};
  vm.createContext(context);
  for (const name of ['core','single-column','classic','timeline','banner','section-accent','skill-chips','accent-rail','compact-pro']) {
    const filename = path.join(__dirname, '../renderer/templates', name + '.js');
    vm.runInContext(fs.readFileSync(filename, 'utf8'), context, {filename});
  }
  registry = context.window.App.Templates;
  return registry;
}
function renderExtensionResume(profile, data, style = {}) {
  const all = templates();
  const template = all.get(profile.templateId || 'classic') || all.get('classic');
  return template.render({profile, data, style:{...all.defaultStyleFor(template.id), ...style}});
}
module.exports = { renderExtensionResume };
