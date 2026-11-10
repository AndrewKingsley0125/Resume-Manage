// Compact Pro: dense layout with a one-line header and dotted date leaders.
(function () {
  const {
    esc, rangeControl, selectControl, registerSingleColumn, thumbBody, ON_OFF_OPTS, contactRowHtml,
  } = window.App.TemplateKit;

  registerSingleColumn({
    id: 'compactPro',
    name: 'Compact Pro',
    description: 'Dense single-column layout for fitting more on each page',
    accent: '#334155',
    page: { pageMargin: 0.4, bulletStyle: 'arrow', bulletColor: '#334155' },
    entry: { periodPosition: 'titleRight' },
    typo: { nameSize: 20, headingSize: 10.5, bodySize: 9.5, lineHeight: 1.3, sectionGap: 2, itemGap: 6, entryTitleSize: 10 },
    controls: [
      selectControl('headerLayout', 'Header', [
        { value: 'inline', label: 'Single line' },
        { value: 'stacked', label: 'Stacked' },
      ], 'inline', 'Density'),
      selectControl('dotLeader', 'Dotted leader', ON_OFF_OPTS, 'on', 'Density'),
      rangeControl('paragraphSpacing', 'Paragraph spacing', 2, 0, 8, 0.5, 'px', 'Density'),
    ],
    leader: (t) => t.dotLeader === 'on',
    header: (v, t) => t.headerLayout === 'stacked' ? `
      <h1>${esc(v.fullName)}</h1>
      ${v.tagline ? `<div class="tagline">${esc(v.tagline)}</div>` : ''}
      ${contactRowHtml(v, t.accentColor)}` : `
      <div class="hdr-inline">
        <h1>${esc(v.fullName)}</h1>
        ${v.tagline ? `<span class="tagline">${esc(v.tagline)}</span>` : ''}
        ${contactRowHtml(v, t.accentColor)}
      </div>`,
    css: (t) => {
      const ps = Number(t.paragraphSpacing);
      const gap = isFinite(ps) ? ps : 2;
      return `
        p { margin: ${gap}px 0; } li { margin-bottom: ${gap}px; }
        h2 { margin: 10px 0 4px; padding-bottom: 2px; }
        h3 { margin-top: 5px; }
        .hdr-inline { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 12px;
          border-bottom: 2px solid ${t.accentColor}; padding-bottom: 6px; margin-bottom: 8px; }
        .hdr-inline h1 { margin: 0; }
        .hdr-inline .tagline { margin: 0; }
        .hdr-inline .contact-row { border: none; margin: 0 0 0 auto; padding: 0; font-size: 9pt; }
      `;
    },
    thumbnail: () => `
      <div class="tpl-thumb">
        <div style="display:flex;gap:4px;align-items:center;border-bottom:2px solid #334155;padding-bottom:4px;margin-bottom:6px">
          <div class="tt-name" style="width:35%;margin:0"></div><div class="tt-tag" style="width:25%;margin:0"></div>
        </div>
        ${thumbBody('<div class="tt-block s"></div><div class="tt-block s"></div><div class="tt-block s"></div><div class="tt-block s"></div>')}
      </div>`,
  });
})();
