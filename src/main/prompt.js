const fs = require('node:fs');
const path = require('node:path');

function promptPath() {
  const bundled = process.resourcesPath && path.join(process.resourcesPath, 'resume-new.md');
  return bundled && fs.existsSync(bundled) ? bundled : path.join(__dirname, '../prompts/resume-new.md');
}

const PLACEHOLDER = '{{CANDIDATE_PROFILE}}';

// Optional per-employer role. Profiles saved before the Role field existed may carry a legacy `title`.
function workRole(w) {
  return String((typeof w.role === 'string' ? w.role : w.title) || '').trim();
}

function candidateProfile(profile, newline) {
  // Same layout as the prompt's original sample profile, filled from the selected profile:
  //   - Company — Role, Location, Work type, Arrangement, Period
  //   - Degree, Institution, Period
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
  const work = (profile.workHistory || []).map(w => {
    const details = [workRole(w), w.location, w.workType, w.workArrangement, w.period].filter(Boolean).join(', ');
    return '- ' + [w.company, details].filter(Boolean).join(' — ');
  });
  const education = (profile.education || []).map(e =>
    '- ' + [e.degree, e.institution, e.period].filter(Boolean).join(', ')
  );
  const header = [
    ...(name ? [`**Name:** ${name}`] : []),
    ...(profile.location ? [`**Location:** ${profile.location}`] : []),
  ];
  return [
    // Two trailing spaces keep Name and Location on separate lines in Markdown.
    ...(header.length ? [header.join('  ' + newline), ''] : []),
    '**Professional Experience**', ...work,
    '', '**Education**', ...education,
  ].join(newline);
}

function renderPrompt(template, profile) {
  const newline = template.includes('\r\n') ? '\r\n' : '\n';
  if (!template.includes(PLACEHOLDER)) {
    throw new Error(`resume-new.md must contain a ${PLACEHOLDER} placeholder`);
  }
  return template.replace(PLACEHOLDER, () => candidateProfile(profile, newline));
}

// A profile set to "Custom prompt" uses its own prompt as written; {{CANDIDATE_PROFILE}} is optional there.
function customPrompt(profile) {
  if (profile.resumePromptMode !== 'custom') return '';
  return typeof profile.customResumePrompt === 'string' ? profile.customResumePrompt.trim() : '';
}

function buildPrompt(profile) {
  const custom = customPrompt(profile);
  if (custom) {
    const newline = custom.includes('\r\n') ? '\r\n' : '\n';
    return custom.split(PLACEHOLDER).join(candidateProfile(profile, newline));
  }
  return renderPrompt(fs.readFileSync(promptPath(), 'utf8'), profile);
}

module.exports = { buildPrompt, renderPrompt };
