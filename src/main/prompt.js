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
  // Same layout as the prompt's original sample profile, filled from the selected profile:
  //   - Company — Title, Location, Work type, Arrangement, Period
  //   - Degree, Institution, Period
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
  const work = (profile.workHistory || []).map(w => {
    const details = [w.title, w.location, w.workType, w.workArrangement, w.period].filter(Boolean).join(', ');
    return '- ' + [w.company, details].filter(Boolean).join(' — ');
  });
  const education = (profile.education || []).map(e =>
    '- ' + [e.degree, e.institution, e.period].filter(Boolean).join(', ')
  );
  const header = [
    ...(name ? [`**Name:** ${name}`] : []),
    ...(profile.location ? [`**Location:** ${profile.location}`] : []),
  ];
  const candidate = [
    // Two trailing spaces keep Name and Location on separate lines in Markdown.
    ...(header.length ? [header.join('  ' + newline), ''] : []),
    '**Professional Experience**', ...work,
    '', '**Education**', ...education,
  ].join(newline);
  return template.replace(placeholder, () => candidate);
}

function buildPrompt(profile) {
  return renderPrompt(fs.readFileSync(promptPath(), 'utf8'), profile);
}

module.exports = { buildPrompt, renderPrompt };
