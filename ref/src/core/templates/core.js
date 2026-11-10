/**
 * Template core: font registry, HTML helpers, the view-model built from
 * (profile, resume JSON), toolbar control builders, and the template registry.
 *
 * Every template renders a standalone HTML document used for both the live
 * preview iframe and the PDF export:
 *
 *   render({ profile, data, style }) -> HTML string
 *     - profile: saved profile (name, contact details, work history, education)
 *     - data:    generated resume JSON (see shared/resume.js for the schema)
 *     - style:   toolbar values keyed by each control's `key`
 *
 * Helpers are shared with the other template files via window.App.TemplateKit.
 * Load order (index.html): core.js, single-column.js, then one file per template.
 */
(function () {
  // ---------- Font registry ----------

  const FONTS = [
    {
      id: 'inter',
      name: 'Inter / System Sans',
      stack: "'Inter','Segoe UI',system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif",
    },
    {
      id: 'helvetica',
      name: 'Helvetica',
      stack: "'Helvetica Neue',Helvetica,Arial,sans-serif",
    },
    { id: 'arial', name: 'Arial', stack: 'Arial,Helvetica,sans-serif' },
    { id: 'calibri', name: 'Calibri', stack: 'Calibri,Candara,Segoe,Optima,sans-serif' },
    { id: 'verdana', name: 'Verdana', stack: 'Verdana,Geneva,sans-serif' },
    { id: 'tahoma', name: 'Tahoma', stack: 'Tahoma,Geneva,sans-serif' },
    {
      id: 'georgia',
      name: 'Georgia',
      stack: "Georgia,'Times New Roman',Times,serif",
    },
    {
      id: 'times',
      name: 'Times New Roman',
      stack: "'Times New Roman',Times,Georgia,serif",
    },
    { id: 'cambria', name: 'Cambria', stack: 'Cambria,Georgia,serif' },
    { id: 'garamond', name: 'Garamond', stack: 'Garamond,Georgia,serif' },
  ];

  const Fonts = {
    list: () => FONTS.slice(),
    get: (id) => FONTS.find((f) => f.id === id) || FONTS[0],
    stackOf: (id) => (FONTS.find((f) => f.id === id) || FONTS[0]).stack,
  };

  // ---------- HTML helpers ----------

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Escape generated prose and turn `**keyword**` highlights into
   * <span class="kw"> so the Keywords toolbar controls can style them.
   * Unpaired markers are dropped rather than shown literally.
   */
  function richText(s) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<span class="kw">$1</span>')
      .replace(/\*\*/g, '');
  }

  function shell(title, css, body) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(title || 'Resume')}</title>
<style>
  html, body { margin: 0; padding: 0; }
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  /* Shared inline icon for contact bits (phone / email / location).
     Templates can override .contact-icon if they need bigger icons. */
  .contact-icon {
    display: inline-block;
    width: 11px;
    height: 11px;
    margin-right: 5px;
    vertical-align: -1px;
    line-height: 0;
    opacity: 0.85;
    flex-shrink: 0;
  }
  .contact-icon svg { display: block; width: 100%; height: 100%; }
${css}
</style>
</head>
<body>${body}</body>
</html>`;
  }

  // ---------- Brand icons (inline SVG, currentColor) ----------

  const ICONS = {
    linkedin:
      '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">' +
      '<path fill="currentColor" d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>' +
      '</svg>',
    github:
      '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">' +
      '<path fill="currentColor" d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>' +
      '</svg>',
    // Small inline icons used as prefixes for contact lines. They inherit
    // currentColor so each template can color them via the surrounding text
    // color (sidebar text, banner text, etc.).
    phone:
      '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">' +
      '<path fill="currentColor" d="M19.23 15.26l-2.54-.29a1 1 0 0 0-.85.29l-1.84 1.84a14.4 14.4 0 0 1-6.3-6.3l1.85-1.85a1 1 0 0 0 .29-.85l-.29-2.51a1 1 0 0 0-1-.89H4.86A1 1 0 0 0 3.83 6 17 17 0 0 0 18.13 20.31a1 1 0 0 0 1-1v-3.04a1 1 0 0 0-.9-1.01z"/>' +
      '</svg>',
    email:
      '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">' +
      '<path fill="currentColor" d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/>' +
      '</svg>',
    location:
      '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true">' +
      '<path fill="currentColor" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"/>' +
      '</svg>',
  };

  // ---------- Shared data prep ----------

  /**
   * Normalize the (profile, data) inputs into the view-model every template
   * renders from.
   */
  function prepareView(input) {
    const profile = (input && input.profile) || {};
    const data = (input && input.data) || {};
    const fullName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
    const initials = (
      ((profile.firstName || '').charAt(0) || '') +
      ((profile.lastName || '').charAt(0) || '')
    ).toUpperCase() || (fullName.charAt(0) || '?').toUpperCase();
    return {
      fullName: fullName || 'Your Name',
      initials,
      tagline: typeof data.title === 'string' ? data.title.trim() : '',
      location: profile.location || '',
      phone: profile.phone || '',
      email: profile.email || '',
      linkedin: profile.linkedin || '',
      github: profile.github || '',
      linkedinVisible: profile.linkedinVisible !== false,
      githubVisible: profile.githubVisible !== false,
      summary: data.summary || '',
      skills: Array.isArray(data.skills) ? data.skills : [],
      // Employers, dates and metadata come from the profile; prose from the JSON.
      experience: window.App.Resume.experience(profile, data),
      // Education and certifications are always profile-controlled.
      education: Array.isArray(profile.education) ? profile.education : [],
      certifications: Array.isArray(profile.certifications) ? profile.certifications : [],
    };
  }


  // ---------- Toolbar controls ----------

  /**
   * Standard control specs used by multiple templates so we don't repeat
   * `{ key, type, label, default }` literals all over the file.
   */
  function fontControl(key, label, def, group) {
    return { key, type: 'font', label: label || 'Font', default: def || 'inter', group };
  }
  function colorControl(key, label, def, group) {
    return { key, type: 'color', label: label || 'Color', default: def, group };
  }
  function rangeControl(key, label, def, min, max, step, unit, group) {
    return {
      key, type: 'range', label, default: def,
      min, max, step: step || 0.05, unit: unit || '', group,
    };
  }
  function selectControl(key, label, options, def, group) {
    return { key, type: 'select', label, options: options || [], default: def, group };
  }

  const ALIGN_OPTS = [
    { value: 'left', label: 'Left' },
    { value: 'center', label: 'Center' },
    { value: 'right', label: 'Right' },
  ];

  /**
   * A shared set of typography & layout controls every template exposes, so
   * users can tune position (alignment), spacing, font, size and color for the
   * Name, Title (tagline), section Headings, Body text and Experience entries.
   * `d` overrides the per-template defaults so each layout keeps its current
   * look until the user changes something.
   *
   * The fonts themselves come from each template's existing headFont /
   * contentFont controls (Heading font / Body font); these controls only add
   * the size / color / alignment / spacing knobs on top.
   */
  function typoControls(d) {
    d = d || {};
    const n = (v, fb) => (v == null ? fb : v);
    return [
      rangeControl('nameSize', 'Name size', n(d.nameSize, 24), 12, 44, 0.5, 'pt', 'Name'),
      colorControl('nameColor', 'Name color', d.nameColor || '#1a1a1a', 'Name'),
      selectControl('nameAlign', 'Name align', ALIGN_OPTS, d.nameAlign || 'left', 'Name'),

      rangeControl('titleSize', 'Title size', n(d.titleSize, 11.5), 7, 22, 0.5, 'pt', 'Title'),
      colorControl('titleColor', 'Title color', d.titleColor || '#475066', 'Title'),
      selectControl('titleAlign', 'Title align', ALIGN_OPTS, d.titleAlign || 'left', 'Title'),

      rangeControl('headingSize', 'Heading size', n(d.headingSize, 12), 8, 22, 0.5, 'pt', 'Headings'),
      colorControl('headingColor', 'Heading color', d.headingColor || '#1a1a1a', 'Headings'),
      colorControl('skillCategoryColor', 'Category color', d.skillCategoryColor || '#1a1a1a', 'Skills'),

      rangeControl('bodySize', 'Body size', n(d.bodySize, 10.5), 8, 14, 0.25, 'pt', 'Body'),
      colorControl('bodyColor', 'Body color', d.bodyColor || '#1a1a1a', 'Body'),
      rangeControl('lineHeight', 'Line spacing', n(d.lineHeight, 1.45), 1, 2.2, 0.05, '', 'Body'),

      rangeControl('entryTitleSize', 'Entry title size', n(d.entryTitleSize, 11), 8, 16, 0.5, 'pt', 'Experience'),
      colorControl('entryTitleColor', 'Entry title color', d.entryTitleColor || '#1a1a1a', 'Experience'),
      rangeControl('entryMetaSize', 'Entry meta size', n(d.entryMetaSize, 9.5), 7, 13, 0.25, 'pt', 'Experience'),
      colorControl('entryMetaColor', 'Entry meta color', d.entryMetaColor || '#525a6e', 'Experience'),

      rangeControl('sectionGap', 'Section spacing', n(d.sectionGap, 6), 0, 32, 1, 'px', 'Spacing'),
      rangeControl('itemGap', 'Item spacing', n(d.itemGap, 10), 0, 32, 1, 'px', 'Spacing'),
    ];
  }

  /**
   * Emit a :root block of CSS custom properties from the resolved style. Each
   * template references these variables (e.g. `font-size: var(--rx-name-size)`)
   * in the appropriate selectors, so the controls drive the output without any
   * specificity / !important games. Fonts reuse the template's headFont /
   * contentFont keys.
   */
  function typoVarsCss(s) {
    s = s || {};
    const num = (v, fb) => {
      const x = Number(v);
      return isFinite(x) ? x : fb;
    };
    return `:root{
      --rx-head-font:${Fonts.stackOf(s.headFont)};
      --rx-body-font:${Fonts.stackOf(s.contentFont)};
      --rx-name-size:${num(s.nameSize, 24)}pt;
      --rx-name-color:${s.nameColor || '#1a1a1a'};
      --rx-name-align:${s.nameAlign || 'left'};
      --rx-title-size:${num(s.titleSize, 11.5)}pt;
      --rx-title-color:${s.titleColor || '#475066'};
      --rx-title-align:${s.titleAlign || 'left'};
      --rx-head-size:${num(s.headingSize, 12)}pt;
      --rx-head-color:${s.headingColor || '#1a1a1a'};
      --rx-skill-category-color:${s.skillCategoryColor || s.bodyColor || '#1a1a1a'};
      --rx-body-size:${num(s.bodySize, 10.5)}pt;
      --rx-body-color:${s.bodyColor || '#1a1a1a'};
      --rx-line:${num(s.lineHeight, 1.45)};
      --rx-etitle-size:${num(s.entryTitleSize, 11)}pt;
      --rx-etitle-color:${s.entryTitleColor || '#1a1a1a'};
      --rx-emeta-size:${num(s.entryMetaSize, 9.5)}pt;
      --rx-emeta-color:${s.entryMetaColor || '#525a6e'};
      --rx-section-gap:${num(s.sectionGap, 6)}px;
      --rx-item-gap:${num(s.itemGap, 10)}px;
    }`;
  }

  /** Resolve a style object against a template's defaults. */
  function resolveStyle(template, style) {
    const out = {};
    for (const c of (template.controls || [])) {
      out[c.key] = (style && style[c.key] !== undefined) ? style[c.key] : c.default;
    }
    return out;
  }

  // Common skill flattener: accepts JSON shape `[{Cat: ["a","b"]}]` and
  // returns a flat list of [{ category, items[] }] entries.
  function flattenSkills(skills) {
    const out = [];
    for (const entry of (skills || [])) {
      if (!entry || typeof entry !== 'object') continue;
      for (const [cat, items] of Object.entries(entry)) {
        out.push({
          category: cat,
          items: Array.isArray(items) ? items.filter(Boolean) : [],
        });
      }
    }
    return out;
  }

  // ---------- Registry & public API ----------

  const templates = [];
  function register(t) {
    templates.push(t);
  }

  function defaultStyleFor(id) {
    const t = templates.find((x) => x.id === id) || templates[0];
    const out = {};
    for (const c of (t.controls || [])) out[c.key] = c.default;
    return out;
  }

  window.App = window.App || {};
  window.App.Templates = {
    list: () => templates.slice(),
    get: (id) => templates.find((t) => t.id === id) || templates[0],
    defaultStyleFor,
    prepareView,
    register,
  };
  window.App.Fonts = Fonts;
  window.App.TemplateKit = {
    esc, richText, shell, ICONS, Fonts, prepareView, flattenSkills, fontControl, colorControl, rangeControl, selectControl, typoControls, typoVarsCss, resolveStyle, register,
  };
})();
