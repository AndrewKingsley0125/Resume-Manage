const fs = require('node:fs');
const path = require('node:path');

function promptPath() {
  const bundled = process.resourcesPath && path.join(process.resourcesPath, 'resume-new.md');
  return bundled && fs.existsSync(bundled) ? bundled : path.join(__dirname, '../prompts/resume-new.md');
}

function renderPrompt(template, profile) {
  const newline = template.includes('\r\n') ? '\r\n' : '\n';
  const placeholder = '{{CANDIDATE_PROFILE}}';
  if (!template.includes(placeholder)) {
    throw new Error(`resume-new.md must contain a ${placeholder} placeholder`);
  }
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
  const work = (profile.workHistory || []).map(w =>
    '- ' + [w.company, w.title || profile.title, w.location, w.workType, w.workArrangement, w.period].filter(Boolean).join(', ')
  );
  const education = (profile.education || []).map(e =>
    '- ' + [e.degree, [e.institution, e.period].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  );
  const candidate = [
    ...(name ? [`Name: ${name}`, ''] : []),
    ...(profile.location ? [`Location: ${profile.location}`, ''] : []),
    `Default target level: ${profile.title || ''}`,
    '', 'Work Experience:', ...work,
    '', 'Education:', ...education,
  ].join(newline);
  return template.replace(placeholder, () => candidate);
}

function buildPrompt(profile) {
  return renderPrompt(fs.readFileSync(promptPath(), 'utf8'), profile);
}

module.exports = { buildPrompt, renderPrompt };
