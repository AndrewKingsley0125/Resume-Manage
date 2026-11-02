const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const AdmZip = require('adm-zip');
const { buildDocx } = require('../src/main/docx');
const context = { window: { App: {} } };
vm.createContext(context);
// Load the shared contract and template scripts in the same order as index.html.
const rendererDir = path.join(__dirname, '../src/renderer');
const scripts = [...fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8').matchAll(/<script src="((?:\.\.\/shared|templates)\/[^"]+)"/g)].map(m => m[1]);
for (const src of scripts) vm.runInContext(fs.readFileSync(path.join(rendererDir, src), 'utf8'), context);
const profile = {
  firstName: 'Jane & Example', lastName: 'Smith', title: 'Old profile title',
  roleBasedWork: true, lastCompanyTailor: true,
  workHistory: [
    { company: 'Recent Employer', period: '2022 - 2026', location: 'Chicago', workType: 'Contract', workArrangement: 'Remote', bulletsCount: 1 },
    { company: 'Earlier Employer', period: '2018 - 2022', location: 'Austin', workType: 'Full-time', workArrangement: 'Onsite' },
  ],
  education: [{ degree: 'Verified Degree', institution: 'Verified University', period: '2013 - 2017' }],
};
const data = {
  company: 'Hiring Company', title: 'JSON Target Title', summary: 'A summary.',
  skills: [{ Languages: ['JavaScript'] }],
  // Deliberately reordered; the exact employer names should match the profile.
  experience: [
    { company: 'Earlier Employer', title: 'Earlier JSON Title', overview: 'Earlier overview.', sentences: ['Earlier contribution.'], technologies: ['SQL'] },
    { company: 'Recent Employer', title: 'Recent JSON Title', location: 'Wrong Location', period: 'Wrong Period', workType: 'Wrong Type', overview: 'Recent overview.', sentences: ['First contribution.', 'Truncated contribution.'], technologies: ['JavaScript'] },
  ],
  education: [{ degree: 'Invented Degree' }],
};

for (const template of context.window.App.Templates.list()) {
  test(`${template.id}: profile metadata and JSON content`, () => {
    const html = template.render({ profile, data, style: {} });
    const summary = html.indexOf('<h2>Professional Summary</h2>');
    const skills = html.indexOf('<h2>Skills</h2>');
    const experience = html.indexOf('<h2>Professional Experience</h2>');
    assert.ok(summary >= 0 && summary < skills && skills < experience, 'Summary, skills, experience section order');
    for (const expected of ['JSON Target Title', 'Recent Employer', 'Recent JSON Title', 'Earlier JSON Title', 'Chicago', '2022 - 2026', 'Contract', 'Remote', 'Verified Degree', 'Recent overview.']) assert.ok(html.includes(expected), expected);
    for (const forbidden of ['Wrong Location', 'Wrong Period', 'Wrong Type', 'Invented Degree', 'Old profile title', 'Truncated contribution.']) assert.ok(!html.includes(forbidden), forbidden);
  });
}

test('classic: entry layout controls move company, period, work type and location', () => {
  const classic = context.window.App.Templates.get('classic');
  const lines = (html, cls) => [...html.matchAll(new RegExp(`class="${cls} entry-line">([\\s\\S]*?)</(?:h3|div)>`, 'g'))].map(m => m[1]);
  const defaults = classic.render({ profile, data, style: {} });
  assert.ok(lines(defaults, 'entry-title')[0].includes('Recent Employer'));
  assert.ok(lines(defaults, 'meta')[0].includes('2022 - 2026'));
  const moved = classic.render({ profile, data, style: { companyPosition: 'metaLeft', periodPosition: 'titleRight', workTypePosition: 'metaRight', locationPosition: 'hidden' } });
  const title = lines(moved, 'entry-title')[0], meta = lines(moved, 'meta')[0];
  assert.ok(!title.includes('Recent Employer') && meta.includes('Recent Employer'));
  assert.match(title, /entry-right">2022 - 2026</);
  assert.match(meta, /entry-right">Contract \| Remote</);
  assert.ok(!moved.includes('Chicago'));
});

const highlighted = { ...data, summary: 'Builds **React** apps & **<APIs>**. Stray ** marker.',
  experience: data.experience.map((e, i) => i ? { ...e, sentences: ['Shipped **GraphQL** gateway.'], overview: 'Owned **payments**.' } : e) };

test('classic: **keywords** render as styled spans driven by the Keywords controls', () => {
  const classic = context.window.App.Templates.get('classic');
  const html = classic.render({ profile, data: highlighted, style: {} });
  for (const kw of ['React', '&lt;APIs&gt;', 'GraphQL', 'payments']) assert.ok(html.includes(`<span class="kw">${kw}</span>`), kw);
  assert.ok(!html.includes('**'));
  assert.match(html, /\.kw \{ font-weight: 700;/);
  const styled = classic.render({ profile, data: highlighted, style: { keywordBold: 'off', keywordItalic: 'on', keywordUnderline: 'on', keywordColor: '#c00000' } });
  assert.match(styled, /\.kw \{ font-weight: inherit;\s*font-style: italic;\s*text-decoration: underline;\s*color: #c00000;\s*\}/);
  const highlightedKw = classic.render({ profile, data: highlighted, style: { keywordHighlight: 'on', keywordHighlightColor: '#ffee00' } });
  assert.match(highlightedKw, /\.kw \{[^}]*background: #ffee00;/);
});

test('shared page controls set margins, bullets, heading case and period badges', () => {
  const classic = context.window.App.Templates.get('classic');
  const html = classic.render({ profile, data, style: { pageMargin: 0.8, bulletStyle: 'check', bulletColor: '#ff0000', headingCase: 'title', periodBadge: 'on' } });
  assert.match(html, /@page \{ size: A4; margin: 0\.8in 0\.85in; \}/);
  assert.match(html, /list-style-type: "✓  "/);
  assert.match(html, /li::marker \{ color: #ff0000; \}/);
  assert.match(html, /h2 \{[^}]*text-transform: none;/);
  assert.ok(html.includes('<span class="period-badge">2022 - 2026</span>'));
});

test('single-column variants render their own controls', () => {
  const T = context.window.App.Templates;
  const render = (id, style) => T.get(id).render({ profile, data, style });
  assert.equal(T.list().map(t => t.id).join(), ['classic', 'timeline', 'banner', 'sectionAccent', 'skillChips', 'accentRail', 'compactPro'].join());
  for (const t of T.list()) assert.ok(typeof t.thumbnail === 'function' && t.thumbnail().includes('tpl-thumb'), t.id);

  assert.match(render('timeline', { dotShape: 'diamond', lineStyle: 'dashed', lineWidth: 3, timelineColor: '#123456' }), /border-left: 3px dashed #123456[\s\S]*rotate\(45deg\)/);
  assert.ok(render('timeline', {}).includes('class="period-badge"'), 'timeline defaults to period badges');

  const insideBanner = render('banner', {});
  assert.ok(/<header class="banner">[\s\S]*contact-row[\s\S]*<\/header>/.test(insideBanner));
  assert.ok(/<\/header>\s*<div class="contact-row">/.test(render('banner', { bannerContact: 'below' })));
  assert.match(render('banner', { bannerShape: 'angled' }), /clip-path: polygon/);

  assert.match(render('sectionAccent', { headingStyle: 'rule' }), /h2::after \{ content: ''; flex: 1;/);
  assert.match(render('sectionAccent', {}), /border-radius: 999px;/);

  const chips = render('skillChips', {});
  assert.ok(chips.includes('<span class="chip">JavaScript</span>'));
  assert.ok(chips.includes('class="tech-chips"'));
  assert.ok(!render('skillChips', { techChips: 'off' }).includes('class="tech-chips"'));

  const rail = render('accentRail', { railSide: 'right', railWidth: 10 });
  assert.match(rail, /body \{ padding-right: 24px; \}/);
  assert.ok(rail.includes('class="initials">JS<'));
  assert.ok(!render('accentRail', { railInitials: 'off' }).includes('class="initials"'));

  const compact = render('compactPro', {});
  assert.ok(compact.includes('class="hdr-inline"'));
  assert.ok(compact.includes('<span class="leader"></span><span class="entry-right">2022 - 2026</span>'));
  assert.ok(!render('compactPro', { dotLeader: 'off', headerLayout: 'stacked' }).includes('class="leader"'));
});

test('DOCX styles **keywords** as separate runs', () => {
  const plain = new AdmZip(buildDocx(profile, highlighted)).readAsText('word/document.xml');
  assert.ok(!plain.includes('**'));
  assert.ok(plain.includes('<w:r><w:rPr><w:b/><w:color w:val="1A1A1A"/></w:rPr><w:t xml:space="preserve">React</w:t></w:r>'));
  assert.ok(plain.includes('&lt;APIs&gt;'));
  const styled = new AdmZip(buildDocx(profile, highlighted, { keywordBold: 'off', keywordItalic: 'on', keywordUnderline: 'on', keywordColor: '#c00000' })).readAsText('word/document.xml');
  assert.ok(styled.includes('<w:rPr><w:i/><w:u w:val="single"/><w:color w:val="C00000"/></w:rPr><w:t xml:space="preserve">GraphQL</w:t>'));
  const shaded = new AdmZip(buildDocx(profile, highlighted, { keywordHighlight: 'on', keywordHighlightColor: '#ffee00' })).readAsText('word/document.xml');
  assert.ok(shaded.includes('<w:shd w:val="clear" w:color="auto" w:fill="FFEE00"/></w:rPr><w:t xml:space="preserve">React</w:t>'));
});

test('DOCX follows the entry layout positions', () => {
  const doc = style => new AdmZip(buildDocx(profile, data, style)).readAsText('word/document.xml');
  const para = (xml, needle) => xml.split('<w:p>').find(p => p.includes(needle));

  const defaults = doc({});
  assert.ok(para(defaults, 'Recent JSON Title').includes('Recent JSON Title | Recent Employer'));
  assert.ok(para(defaults, '2022 - 2026').includes('2022 - 2026 | Chicago | Contract | Remote'));
  assert.ok(!para(defaults, 'Recent JSON Title').includes('<w:tab/>'));

  const moved = doc({ companyPosition: 'metaLeft', periodPosition: 'titleRight', workTypePosition: 'metaRight', locationPosition: 'hidden' });
  const title = para(moved, 'Recent JSON Title');
  assert.ok(!title.includes('Recent Employer'));
  assert.match(title, /<w:tab w:val="right" w:pos="10178"\/>[\s\S]*<w:r><w:tab\/><\/w:r><w:r><w:rPr>[^]*<\/w:rPr><w:t xml:space="preserve">2022 - 2026<\/w:t>/);
  const meta = para(moved, 'Recent Employer');
  assert.match(meta, /Recent Employer<\/w:t><\/w:r><w:r><w:tab\/><\/w:r><w:r><w:t xml:space="preserve">Contract \| Remote</);
  assert.ok(!moved.includes('Chicago'));
});

test('DOCX contains native Word parts and profile metadata', () => {
  const bytes = buildDocx(profile, data);
  assert.equal(bytes.subarray(0, 2).toString(), 'PK');
  const zip = new AdmZip(bytes);
  const names = zip.getEntries().map(e => e.entryName);
  assert.ok(zip.readAsText('word/document.xml').includes('<w:pgSz w:w="11906" w:h="16838"/>'), 'A4 page');
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/_rels/document.xml.rels']) assert.ok(names.includes(part));
  assert.ok(!names.some(n => /html/i.test(n)));
  const document = zip.readAsText('word/document.xml');
  assert.ok(document.indexOf('Professional Summary') < document.indexOf('Skills'));
  assert.ok(document.indexOf('Skills') < document.indexOf('Professional Experience'));
  for (const expected of ['Jane &amp; Example', 'Recent Employer', 'Contract', 'Remote', 'Recent JSON Title', 'Recent overview.', 'Technologies: JavaScript', 'Verified Degree', '<w:numPr>']) assert.ok(document.includes(expected), expected);
  assert.ok(document.indexOf('Recent Employer') < document.indexOf('Earlier Employer'));
  for (const forbidden of ['altChunk', '<html', 'Invented Degree', 'Wrong Location', 'Truncated contribution.']) assert.ok(!document.includes(forbidden));
});

test('DOCX refuses eligibility errors and invalid roots', () => {
  for (const invalid of [null, [], { error: 'Ineligible role' }]) assert.throws(() => buildDocx(profile, invalid));
});

test('DOCX preserves selected text colors and background in native Word styles', () => {
  const appearance = {nameColor:'#123456',titleColor:'#234567',headingColor:'#345678',bodyColor:'#456789',entryTitleColor:'#56789a',entryMetaColor:'#6789ab',bgColor:'#abcdef'};
  const zip = new AdmZip(buildDocx(profile, data, appearance));
  const styles = zip.readAsText('word/styles.xml');
  for (const value of Object.values(appearance)) assert.ok(styles.includes(value.slice(1).toUpperCase()),value);
  assert.ok(zip.readAsText('word/document.xml').includes('<w:background w:color="ABCDEF"/>'));
  const invalid = new AdmZip(buildDocx(profile, data, {headingColor:'"><bad/>',bodyColor:'invalid'})).readAsText('word/styles.xml');
  assert.ok(!invalid.includes('<bad/>'));
  assert.ok(invalid.includes('1F6FEB'));
});

test('fenced eligibility errors are shown in the editor', () => {
  let source = fs.readFileSync(path.join(__dirname, '../src/renderer/workspace.js'), 'utf8');
  source = source.replace('  function renderHtml() {', '  window.testParse = parseAndRender;\n  function renderHtml() {');
  const elements = {};
  const get = id => elements[id] ||= { value: '', textContent: '', classList: { add() {}, remove() {} } };
  const ctx = { window: {App: {Resume: require('../src/shared/resume')}}, document: { getElementById: get }, setTimeout: () => 1, clearTimeout() {}, console };
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  get('resume-json').value = '```json\n{"error":"The role requires clearance."}\n```';
  ctx.window.testParse();
  assert.ok(get('json-error').textContent.includes('requires clearance'));
});
