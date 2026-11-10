// Writes one application folder: {saveFolder}/{company}/{name}_resume.pdf,
// .docx and JD.txt. Adapted from Resume Manager's exportPdf, but PDF
// rendering is injected so this module has no Electron dependency.
const fs = require('node:fs');
const path = require('node:path');
const Resume = require('./resume');
const { buildDocx } = require('./docx');
const { renderHtml, styleFor } = require('./render');

/** Strip characters that are invalid in Windows / macOS / Linux file names. */
function safePathSegment(name) {
  return String(name == null ? '' : name)
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/^\.+|\.+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function resumeFileStem(profile) {
  const parts = [profile.firstName, profile.lastName].map(s => safePathSegment(s)).filter(Boolean);
  return `${parts.length ? parts.join('_') : 'profile'}_resume`;
}

/**
 * @param {object} args
 * @param {object} args.profile
 * @param {object} args.resumeData  validated resume JSON
 * @param {string} args.jd
 * @param {(html: string) => Promise<Buffer>} args.htmlToPdf
 * @param {object} [args.style]  template customization from Resume Manager (colors, fonts, sizes)
 * @param {string} [args.company]  folder name when the resume JSON has no company (asked from the user)
 * @returns {Promise<{folder:string, pdfPath:string, docxPath:string, jdPath:string|null}>}
 */
async function exportApplication({ profile, resumeData, jd, htmlToPdf, style, company: companyName }) {
  Resume.validate(resumeData, profile);
  const saveFolder = (profile.saveFolder || '').trim();
  if (!saveFolder || !fs.existsSync(saveFolder)) throw new Error(`Save folder is not set or missing: ${saveFolder}`);
  const company = safePathSegment(companyName || resumeData.company);
  if (!company) throw new Error('Resume JSON has no company name.');

  const folder = path.join(saveFolder, company);
  if (fs.existsSync(folder)) throw new Error(`A folder named "${company}" already exists in the save folder.`);

  const appearance = styleFor(profile.templateId, style);
  const html = renderHtml(profile, resumeData, profile.templateId, appearance);
  const pdf = await htmlToPdf(html);
  const docx = buildDocx(profile, resumeData, appearance);

  fs.mkdirSync(folder);
  const stem = resumeFileStem(profile);
  const pdfPath = path.join(folder, `${stem}.pdf`);
  const docxPath = path.join(folder, `${stem}.docx`);
  fs.writeFileSync(pdfPath, pdf);
  fs.writeFileSync(docxPath, docx);
  let jdPath = null;
  if (jd && jd.trim()) {
    jdPath = path.join(folder, 'JD.txt');
    fs.writeFileSync(jdPath, jd, 'utf8');
  }
  return { folder, pdfPath, docxPath, jdPath };
}

module.exports = { exportApplication, safePathSegment };
