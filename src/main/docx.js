// Native Office Open XML document generation. No HTML conversion or altChunk.
const AdmZip = require('adm-zip');
const Resume = require('../shared/resume');
const text = value => String(value == null ? '' : value);
// A4 page (210 × 297 mm) and side margins, in twentieths of a point.
const PAGE_WIDTH = 11906;
const PAGE_HEIGHT = 16838;
const MARGIN_X = 864;
const xml = value => text(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function buildDocx(profile, data, appearance = {}) {
  if (!profile || !data || typeof data !== 'object' || Array.isArray(data) || data.error) throw new Error('Invalid resume data');
  appearance = appearance && typeof appearance === 'object' ? appearance : {};
  const color = (value, fallback) => {
    const match = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(value || ''));
    if (!match) return fallback;
    return (match[1].length === 3 ? match[1].split('').map(c => c + c).join('') : match[1]).toUpperCase();
  };
  const colors = {
    body: color(appearance.bodyColor || appearance.textColor, '1A1A1A'),
    name: color(appearance.nameColor, '1A1A1A'),
    title: color(appearance.titleColor, '475066'),
    heading: color(appearance.headingColor || appearance.accentColor, '1F6FEB'),
    entry: color(appearance.entryTitleColor, '1A1A1A'),
    metadata: color(appearance.entryMetaColor || appearance.mutedColor, '525A6E'),
    background: color(appearance.bgColor, 'FFFFFF'),
    skillCategory: color(appearance.skillCategoryColor || appearance.bodyColor, '1A1A1A'),
  };
  // `**keyword**` highlights become runs styled by the Keywords toolbar controls.
  const on = (key, fallback) => (appearance[key] || fallback) === 'on';
  const keywordProps = (on('keywordBold', 'on') ? '<w:b/>' : '') + (on('keywordItalic', 'off') ? '<w:i/>' : '')
    + (on('keywordUnderline', 'off') ? '<w:u w:val="single"/>' : '') + `<w:color w:val="${color(appearance.keywordColor, '1A1A1A')}"/>`
    + (on('keywordHighlight', 'off') ? `<w:shd w:val="clear" w:color="auto" w:fill="${color(appearance.keywordHighlightColor, 'FFF3B0')}"/>` : '');
  const runs = line => text(line).split(/\*\*(.+?)\*\*/).map((part, i) => {
    part = part.replace(/\*\*/g, '');
    if (!part) return '';
    return `<w:r>${i % 2 ? `<w:rPr>${keywordProps}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(part)}</w:t></w:r>`;
  }).join('');
  const paragraphs = [];
  const paragraph = (value, style = 'Normal', bullet = false, boldPrefix = '') => {
    if (!text(value).trim()) return;
    const lines = text(value).split(/\r?\n/);
    const label = boldPrefix ? `<w:r><w:rPr><w:b/><w:color w:val="${colors.skillCategory}"/></w:rPr><w:t xml:space="preserve">${xml(boldPrefix)}</w:t></w:r>` : '';
    paragraphs.push(`<w:p><w:pPr><w:pStyle w:val="${style}"/>${bullet ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : ''}</w:pPr>${label}${lines.map((line,i) => `${i ? '<w:r><w:br/></w:r>' : ''}${runs(line)}`).join('')}</w:p>`);
  };
  paragraph([profile.firstName, profile.lastName].filter(Boolean).join(' '), 'Title');
  paragraph(data.title, 'Subtitle');
  paragraph([profile.location, profile.phone, profile.email, profile.linkedinVisible !== false && profile.linkedin, profile.githubVisible !== false && profile.github].filter(Boolean).join(' | '));
  if (data.summary) { paragraph('Professional Summary', 'Heading1'); paragraph(data.summary); }
  const skills = Array.isArray(data.skills) ? data.skills : [];
  if (skills.length) {
    paragraph('Skills', 'Heading1');
    for (const group of skills) for (const [category, items] of Object.entries(group || {})) {
      if (Array.isArray(items)) paragraph(items.filter(x => typeof x === 'string').join(', '), 'Normal', false, `${category}: `);
    }
  }
  // Title and meta lines follow the toolbar's Entry layout; right-hand parts sit
  // on a right tab stop at the text edge, styled like metadata on the title line.
  const entryLine = (left, right, style, rightProps = '') => {
    if (!left.length && !right.length) return;
    const join = parts => xml(parts.map(p => p.text).join(' | '));
    const tabs = right.length ? `<w:tabs><w:tab w:val="right" w:pos="${PAGE_WIDTH - 2 * MARGIN_X}"/></w:tabs>` : '';
    const leftRun = left.length ? `<w:r><w:t xml:space="preserve">${join(left)}</w:t></w:r>` : '';
    const rightRun = right.length ? `<w:r><w:tab/></w:r><w:r>${rightProps ? `<w:rPr>${rightProps}</w:rPr>` : ''}<w:t xml:space="preserve">${join(right)}</w:t></w:r>` : '';
    paragraphs.push(`<w:p><w:pPr><w:pStyle w:val="${style}"/>${tabs}</w:pPr>${leftRun}${rightRun}</w:p>`);
  };
  const experience = Resume.experience(profile, data);
  if (experience.length) paragraph('Professional Experience', 'Heading1');
  experience.forEach(role => {
    const slots = Resume.entryLayout(role, appearance);
    entryLine(slots.titleLeft, slots.titleRight, 'Heading2', `<w:b w:val="0"/><w:sz w:val="20"/><w:color w:val="${colors.metadata}"/>`);
    entryLine(slots.metaLeft, slots.metaRight, 'Metadata');
    paragraph(role.overview);
    let contributions = Array.isArray(role.sentences) ? role.sentences.filter(x => typeof x === 'string') : [];
    if (contributions.length) paragraph('Key Contributions', 'Heading3');
    contributions.forEach(value => paragraph(value, 'Normal', true));
    if (Array.isArray(role.technologies) && role.technologies.length) paragraph(`Technologies: ${role.technologies.filter(x => typeof x === 'string').join(', ')}`);
  });
  const education = Array.isArray(profile.education) ? profile.education : [];
  if (education.length) paragraph('Education', 'Heading1');
  education.forEach(e => paragraph([e.degree, e.institution, e.period].filter(Boolean).join(' | ')));
  const certs = Array.isArray(profile.certifications) ? profile.certifications : [];
  if (certs.length) paragraph('Certifications', 'Heading1');
  certs.forEach(c => paragraph([c.certification, c.institution, c.date].filter(Boolean).join(' | ')));
  const zip = new AdmZip();
  const add = (name, content) => zip.addFile(name, Buffer.from('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + content, 'utf8'));
  add('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>');
  add('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  add('word/_rels/document.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>');
  add('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:background w:color="${colors.background}"/><w:body>${paragraphs.join('')}<w:sectPr><w:pgSz w:w="${PAGE_WIDTH}" w:h="${PAGE_HEIGHT}"/><w:pgMar w:top="792" w:right="${MARGIN_X}" w:bottom="792" w:left="${MARGIN_X}" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  const style = (id, size, bold, color, keep) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${id}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr>${keep ? '<w:keepNext/>' : ''}<w:spacing w:before="120" w:after="80"/></w:pPr><w:rPr><w:sz w:val="${size}"/>${bold ? '<w:b/>' : ''}<w:color w:val="${color}"/></w:rPr></w:style>`;
  add('word/styles.xml', `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:color w:val="${colors.body}"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:shd w:val="clear" w:fill="${colors.background}"/><w:spacing w:after="100" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${style('Title',40,true,colors.name,true)}${style('Subtitle',26,false,colors.title,true)}${style('Heading1',25,true,colors.heading,true)}${style('Heading2',23,true,colors.entry,true)}${style('Heading3',22,true,colors.body,true)}${style('Metadata',20,false,colors.metadata,true)}</w:styles>`);
  add('word/numbering.xml', '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="360"/></w:tabs><w:ind w:left="360" w:hanging="180"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>');
  return zip.toBuffer();
}
module.exports = { buildDocx };
