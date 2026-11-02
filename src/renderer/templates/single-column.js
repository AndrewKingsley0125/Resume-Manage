/**
 * Shared single-column layout. Classic and every variant are built with
 * registerSingleColumn(); a variant supplies its own controls, CSS and,
 * optionally, a header, skills section, technologies line or dotted leaders.
 */
(function () {
  const {
    esc, richText, shell, ICONS, prepareView, flattenSkills, register, resolveStyle,
    fontControl, colorControl, rangeControl, selectControl, typoControls, typoVarsCss,
  } = window.App.TemplateKit;

  // ---------- Shared rendering snippets ----------

  function socialLinks(v, color) {
    const out = [];
    if (v.linkedinVisible && v.linkedin) {
      out.push(`<a class="social-icon" href="${esc(v.linkedin)}" style="color:${color}" title="LinkedIn">${ICONS.linkedin}</a>`);
    }
    if (v.githubVisible && v.github) {
      out.push(`<a class="social-icon" href="${esc(v.github)}" style="color:${color}" title="GitHub">${ICONS.github}</a>`);
    }
    return out.length ? `<div class="social-icons">${out.join('')}</div>` : '';
  }

  /**
   * Render a single contact line with an inline icon prefix. `kind` must match
   * a key in ICONS (`phone`, `email`, `location`). `tag` is the wrapper tag,
   * defaulting to <span> for inline rows; pass 'div' for stacked layouts.
   */
  function contactBit(kind, value, tag) {
    if (!value || !ICONS[kind]) return '';
    const t = tag || 'span';
    return `<${t} class="contact-bit"><span class="contact-icon">${ICONS[kind]}</span>${esc(value)}</${t}>`;
  }

  /**
   * Returns the present contact items in a stable order (phone, email,
   * location). Each item is `{ kind, value }` so callers can render via
   * `contactBit(it.kind, it.value, ...)`.
   */
  function contactItems(v) {
    const out = [];
    if (v.phone) out.push({ kind: 'phone', value: v.phone });
    if (v.email) out.push({ kind: 'email', value: v.email });
    if (v.location) out.push({ kind: 'location', value: v.location });
    return out;
  }

  // Field placement (shared with the DOCX export) lives in shared/resume.js.
  const { entryFields: ENTRY_FIELDS, entrySlotKey, entryLayout } = window.App.Resume;
  const ENTRY_SLOT_OPTS = [
    { value: 'titleLeft', label: 'Title line, left' },
    { value: 'titleRight', label: 'Title line, right' },
    { value: 'metaLeft', label: 'Meta line, left' },
    { value: 'metaRight', label: 'Meta line, right' },
    { value: 'hidden', label: 'Hidden' },
  ];

  function entryLayoutControls(d) {
    d = d || {};
    return ENTRY_FIELDS.map((f) =>
      selectControl(entrySlotKey(f.key), f.label, ENTRY_SLOT_OPTS, d[entrySlotKey(f.key)] || f.default, 'Entry layout'));
  }

  const ON_OFF_OPTS = [
    { value: 'on', label: 'On' },
    { value: 'off', label: 'Off' },
  ];

  /** Styling for `**keyword**` highlights in the summary and experience. */
  function keywordControls() {
    return [
      selectControl('keywordBold', 'Bold', ON_OFF_OPTS, 'on', 'Keywords'),
      selectControl('keywordItalic', 'Italic', ON_OFF_OPTS, 'off', 'Keywords'),
      selectControl('keywordUnderline', 'Underline', ON_OFF_OPTS, 'off', 'Keywords'),
      colorControl('keywordColor', 'Color', '#1a1a1a', 'Keywords'),
      selectControl('keywordHighlight', 'Highlight', ON_OFF_OPTS, 'off', 'Keywords'),
      colorControl('keywordHighlightColor', 'Highlight color', '#fff3b0', 'Keywords'),
    ];
  }

  function keywordCss(s) {
    s = s || {};
    const on = (key, def) => (s[key] || def) === 'on';
    const highlight = on('keywordHighlight', 'off')
      ? `background: ${s.keywordHighlightColor || '#fff3b0'}; padding: 0 2px; border-radius: 2px;` : '';
    return `.kw { font-weight: ${on('keywordBold', 'on') ? 700 : 'inherit'};
      font-style: ${on('keywordItalic', 'off') ? 'italic' : 'inherit'};
      text-decoration: ${on('keywordUnderline', 'off') ? 'underline' : 'none'};
      color: ${s.keywordColor || '#1a1a1a'}; ${highlight} }`;
  }

  const BULLETS = {
    disc: { label: '• Disc', css: 'disc' },
    dash: { label: '– Dash', css: '"–  "' },
    arrow: { label: '▸ Arrow', css: '"▸  "' },
    check: { label: '✓ Check', css: '"✓  "' },
    circle: { label: '○ Circle', css: 'circle' },
    square: { label: '▪ Square', css: 'square' },
  };

  /** Page margins, bullets, heading case and period badges, shared by every template. */
  function pageControls(d) {
    d = d || {};
    return [
      rangeControl('pageMargin', 'Margins', d.pageMargin != null ? d.pageMargin : 0.55, 0.25, 1.2, 0.05, 'in', 'Page'),
      selectControl('bulletStyle', 'Bullet',
        Object.entries(BULLETS).map(([value, b]) => ({ value, label: b.label })), d.bulletStyle || 'disc', 'Page'),
      colorControl('bulletColor', 'Bullet color', d.bulletColor || '#1a1a1a', 'Page'),
      selectControl('headingCase', 'Heading case',
        [{ value: 'upper', label: 'UPPERCASE' }, { value: 'title', label: 'Title Case' }], d.headingCase || 'upper', 'Page'),
      selectControl('periodBadge', 'Period badge', ON_OFF_OPTS, d.periodBadge || 'off', 'Page'),
    ];
  }

  function renderEntryLine(tag, cls, left, right, leader) {
    if (!left.length && !right.length) return '';
    const join = (parts) => parts.join(' | ');
    return `<${tag} class="${cls} entry-line"><span>${join(left)}</span>`
      + (right.length && leader ? '<span class="leader"></span>' : '')
      + (right.length ? `<span class="entry-right">${join(right)}</span>` : '')
      + `</${tag}>`;
  }

  function renderTechnologies(e) {
    return e.technologies.length
      ? `<p><strong>Technologies:</strong> ${e.technologies.map(esc).join(', ')}</p>` : '';
  }

  /**
   * opts.style: resolved style (entry positions, period badge).
   * opts.leader: dotted leader between left and right parts of a line.
   * opts.tech: optional `(entry) => html` replacement for the technologies line.
   */
  function renderExperienceList(v, opts) {
    if (!v.experience.length) return '';
    const style = (opts && opts.style) || {};
    const badge = style.periodBadge === 'on';
    const tech = (opts && opts.tech) || renderTechnologies;
    const items = v.experience.map((e) => {
      const slots = {};
      for (const [slot, parts] of Object.entries(entryLayout(e, style))) {
        slots[slot] = parts.map((p) => (p.key === 'period' && badge
          ? `<span class="period-badge">${esc(p.text)}</span>` : esc(p.text)));
      }
      const ul = e.sentences.length
        ? `<ul>${e.sentences.map((s) => `<li>${richText(s)}</li>`).join('')}</ul>` : '';
      return `<div class="exp-item">
        ${renderEntryLine('h3', 'entry-title', slots.titleLeft, slots.titleRight, opts && opts.leader)}
        ${renderEntryLine('div', 'meta', slots.metaLeft, slots.metaRight, opts && opts.leader)}
        ${e.overview ? `<p>${richText(e.overview)}</p>` : ""}
        ${ul ? '<p><strong>Key Contributions</strong></p>' : ''}${ul}
        ${tech(e)}
      </div>`;
    }).join('');
    return `<section><h2>${esc((opts && opts.heading) || 'Professional Experience')}</h2>${items}</section>`;
  }

  function renderEducationList(v, opts) {
    if (!v.education.length) return '';
    const items = v.education.map((e) => {
      if (!e || typeof e !== 'object') return '';
      const inst = e.institution ? `<div class="institution">${esc(e.institution)}</div>` : '';
      const deg = e.degree ? `<div class="degree">${esc(e.degree)}</div>` : '';
      const per = e.period ? `<div class="period">${esc(e.period)}</div>` : '';
      return (inst || deg || per) ? `<div class="edu-item">${inst}${deg}${per}</div>` : '';
    }).filter(Boolean).join('');
    return items ? `<section><h2>${esc((opts && opts.heading) || 'Education')}</h2>${items}</section>` : '';
  }

  function renderCertificationsList(v, opts) {
    if (!v.certifications.length) return '';
    const items = v.certifications.map((c) => {
      if (!c || typeof c !== 'object') return '';
      const name = c.certification ? `<div class="cert-name">${esc(c.certification)}</div>` : '';
      const inst = c.institution ? `<div class="meta">${esc(c.institution)}</div>` : '';
      const date = c.date ? `<div class="meta">${esc(c.date)}</div>` : '';
      return (name || inst || date) ? `<div class="cert-item">${name}${inst}${date}</div>` : '';
    }).filter(Boolean).join('');
    return items ? `<section><h2>${esc((opts && opts.heading) || 'Certifications')}</h2>${items}</section>` : '';
  }

  function renderSkillsInline(v) {
    const flat = flattenSkills(v.skills);
    if (!flat.length) return '';
    // One line per category: "Category: item, item, item".
    const items = flat.map((s) => `
      <div class="skill-block"><strong class="cat" style="color:var(--rx-skill-category-color)">${esc(s.category)}:</strong>
        ${esc(s.items.join(', '))}</div>`).join('');
    return `<section><h2>Skills</h2>${items}</section>`;
  }

  function contactRowHtml(v, color) {
    const bits = contactItems(v)
      .map((it) => contactBit(it.kind, it.value, 'span'))
      .join('<span class="dot">|</span>');
    return `<div class="contact-row">${bits}${socialLinks(v, color)}</div>`;
  }


  // ---------- Single-column builder ----------

  /**
   * Classic and its variants share one top-to-bottom layout. A variant adds
   * its own `controls`, extra `css(t)`, and may replace the `header`, the
   * skills section, the technologies line, or turn on dotted leaders.
   * `t` is the style resolved against the template's control defaults.
   */
  function registerSingleColumn(cfg) {
    const tpl = {
      id: cfg.id,
      name: cfg.name,
      description: cfg.description,
      controls: [
        colorControl('accentColor', 'Accent', cfg.accent || '#1f6feb'),
        fontControl('headFont', 'Heading font', 'inter'),
        fontControl('contentFont', 'Body font', 'inter'),
        selectControl(
          'extrasPlacement',
          'Education / Certs',
          [
            { value: 'afterExperience', label: 'After experience' },
            { value: 'belowSummary', label: 'Below summary' },
          ],
          'afterExperience',
          'Layout'
        ),
        ...(cfg.controls || []),
        ...pageControls(cfg.page),
        ...entryLayoutControls(cfg.entry),
        ...keywordControls(),
        ...typoControls(Object.assign({
          nameSize: 26,
          nameColor: '#1a1a1a',
          titleColor: '#475066',
          headingSize: 12,
          headingColor: cfg.accent || '#1f6feb',
        }, cfg.typo)),
      ],
      thumbnail: cfg.thumbnail,
      render: (input) => {
        const v = prepareView(input);
        const t = resolveStyle(tpl, (input && input.style) || {});
        const margin = Number(t.pageMargin) || 0.55;
        const bullet = (BULLETS[t.bulletStyle] || BULLETS.disc).css;
        const css = typoVarsCss(t) + keywordCss(t) + `
          @page { size: A4; margin: ${margin}in ${Math.round((margin + 0.05) * 100) / 100}in; }
          body { font-family: var(--rx-body-font); color: var(--rx-body-color);
            font-size: var(--rx-body-size); line-height: var(--rx-line); margin: 0; }
          h1, h2, h3 { font-family: var(--rx-head-font); }
          h1 { margin: 0 0 4px; font-size: var(--rx-name-size); color: var(--rx-name-color); text-align: var(--rx-name-align); font-weight: 800; letter-spacing: -0.4px; }
          .tagline { color: var(--rx-title-color); font-size: var(--rx-title-size); text-align: var(--rx-title-align); margin-bottom: 10px; }
          .contact-row { color: #475066; font-size: 9.7pt; display: flex; flex-wrap: wrap; gap: 8px;
            align-items: center; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid ${t.accentColor}; }
          .contact-row .contact-bit { display: inline-flex; align-items: center; }
          .contact-row .dot { opacity: 0.5; }
          h2 { font-size: var(--rx-head-size); text-transform: ${t.headingCase === 'title' ? 'none' : 'uppercase'}; letter-spacing: 1.4px; margin: 14px 0 6px;
            color: var(--rx-head-color); font-weight: 800; border-bottom: 1px solid ${t.accentColor}33; padding-bottom: 4px; }
          h3 { font-size: var(--rx-etitle-size); color: var(--rx-etitle-color); font-weight: 700; margin: 8px 0 1px; }
          .meta { color: var(--rx-emeta-color); font-size: var(--rx-emeta-size); margin-bottom: 4px; }
          .entry-line { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
          .entry-line .entry-right { text-align: right; white-space: nowrap; }
          .entry-line .leader { flex: 1; border-bottom: 1px dotted currentColor; opacity: 0.45; margin: 0 -6px; transform: translateY(-3px); }
          h3 .entry-right { font-weight: 600; font-size: var(--rx-emeta-size); color: var(--rx-emeta-color); }
          .period-badge { display: inline-block; background: ${t.accentColor}1a; color: ${t.accentColor};
            padding: 0 7px; border-radius: 8px; font-size: 0.92em; font-weight: 600; line-height: 1.5; }
          ul { margin: 4px 0 0 18px; padding: 0; list-style-type: ${bullet}; } li { margin-bottom: 3px; } p { margin: 3px 0; }
          li::marker { color: ${t.bulletColor}; }
          a { color: ${t.accentColor}; text-decoration: none; }
          .institution, .cert-name { font-weight: 700; }
          .edu-item, .cert-item { margin-bottom: var(--rx-item-gap); }
          .exp-item { margin-bottom: var(--rx-item-gap); }
          section { margin-bottom: var(--rx-section-gap); }
          .skill-block { margin: 3px 0; }
          .skill-block .cat { font-weight: 700; }
          .social-icons { display: flex; gap: 8px; margin-left: auto; }
          .social-icon { color: ${t.accentColor}; }
        ` + (cfg.css ? cfg.css(t) : '');
        const summaryHtml = v.summary
          ? `<section><h2>Professional Summary</h2><p>${richText(v.summary)}</p></section>`
          : '';
        const skillsHtml = cfg.skills ? cfg.skills(v, t) : renderSkillsInline(v);
        const experienceHtml = renderExperienceList(v, {
          style: t,
          leader: cfg.leader ? cfg.leader(t) : false,
          tech: cfg.tech ? (e) => cfg.tech(e, t) : null,
        });
        // Education and certifications move as a group: either below the
        // summary (before experience) or after experience (the default).
        const extrasHtml = `${renderEducationList(v)}${renderCertificationsList(v)}`;
        const mainHtml = t.extrasPlacement === 'belowSummary'
          ? `${summaryHtml}${skillsHtml}${extrasHtml}${experienceHtml}`
          : `${summaryHtml}${skillsHtml}${experienceHtml}${extrasHtml}`;
        const header = cfg.header ? cfg.header(v, t) : `
          <h1>${esc(v.fullName)}</h1>
          ${v.tagline ? `<div class="tagline">${esc(v.tagline)}</div>` : ''}
          ${contactRowHtml(v, t.accentColor)}`;
        return shell(v.fullName, css, `${header}${mainHtml}`);
      },
    };
    register(tpl);
  }

  // Thumbnail helper: a classic body under a template-specific header.
  const thumbBody = (blocks) => (blocks || '<div class="tt-block m"></div><div class="tt-block m"></div><div class="tt-block m"></div>');

  Object.assign(window.App.TemplateKit, {
    registerSingleColumn, thumbBody, ON_OFF_OPTS, contactRowHtml, renderTechnologies,
  });
})();
