/**
 * Template registry. Each template renders a resume into a standalone HTML
 * document (full <!DOCTYPE>...) used both for the live preview iframe and
 * the PDF export pipeline.
 *
 * Resume JSON shape (provided by the user):
 *
 * {
 *   company: "Company name from the job description",
 *   summary: "",
 *   skills: [
 *     { "Category1": ["Skill1", "Skill2", "..."] }
 *   ],
 *   experience: [
 *     { company: "", sentences: ["Sentence 1", "Sentence 2"] }
 *   ],
 *   education: [
 *     { degree: "Degree and Major" }
 *   ]
 * }
 *
 * The header (name, location, linkedin) is taken from the profile, not the
 * JSON, so the same JSON can be reused with different profiles.
 *
 * render({ profile, data, style }) -> HTML string
 *   - profile: { firstName, lastName, location, linkedin, ... }
 *   - data:    the JSON described above
 *   - style:   { sidebarColor, headFont, contentFont } (font ids, see App.Fonts)
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

  // ---------- Color helpers ----------

  function hexToRgb(hex) {
    const m = String(hex || '')
      .replace('#', '')
      .match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    if (!m) return [0, 0, 0];
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  }
  function rgbToHex(r, g, b) {
    const c = (n) =>
      Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`;
  }
  function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        default:
          h = (r - g) / d + 4;
      }
      h *= 60;
    }
    return [h, s * 100, l * 100];
  }
  function hslToRgb(h, s, l) {
    s /= 100;
    l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) =>
      l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [255 * f(0), 255 * f(8), 255 * f(4)];
  }

  /**
   * Derive a saturated dark accent color from a (typically light) sidebar
   * color. Used for headings and the candidate name.
   */
  function deriveAccent(sidebarHex) {
    const [r, g, b] = hexToRgb(sidebarHex);
    const [h, s] = rgbToHsl(r, g, b);
    const targetS = Math.min(85, Math.max(45, s * 1.4 || 60));
    const targetL = 28;
    const [r2, g2, b2] = hslToRgb(h, targetS, targetL);
    return rgbToHex(r2, g2, b2);
  }

  // ---------- HTML helpers ----------

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
   * Normalize the (profile, data) inputs into a single view-model that every
   * template can consume without re-implementing the role-based / bullets-count
   * blending logic.
   */
  function prepareView(input) {
    const profile = (input && input.profile) || {};
    const data = (input && input.data) || {};
    const fullName = `${profile.firstName || ''} ${profile.lastName || ''}`.trim();
    const initials = (
      ((profile.firstName || '').charAt(0) || '') +
      ((profile.lastName || '').charAt(0) || '')
    ).toUpperCase() || (fullName.charAt(0) || '?').toUpperCase();
    const roleBased = profile.roleBasedWork === true;
    const profileTitle = (profile.title || '').trim();
    const tagline = roleBased
      ? profileTitle
      : (data.title ? String(data.title).trim() : profileTitle);
    const workHistory = Array.isArray(profile.workHistory) ? profile.workHistory : [];
    const profileEducation = Array.isArray(profile.education) ? profile.education : [];
    const jsonEducation = Array.isArray(data.education) ? data.education : [];
    // University/institution (and period) always come from the profile.
    // Degree/major: profile when role-based, JSON when not role-based.
    const education = mergeEducation(profileEducation, jsonEducation, roleBased);
    const profileCertifications = Array.isArray(profile.certifications)
      ? profile.certifications : [];
    const expFromJson = Array.isArray(data.experience) ? data.experience : [];
    const skills = Array.isArray(data.skills) ? data.skills : [];

    // Build experience items by zipping profile workHistory with JSON sentences.
    const experience = (workHistory.length ? workHistory : expFromJson).map((it, i) => {
      const fromProfile = workHistory.length;
      const wh = fromProfile ? it : {};
      const json = fromProfile ? (expFromJson[i] || {}) : it;
      const title = roleBased
        ? (wh.title || '')
        : ((json && json.title) || '').trim();
      // Company always comes from the JSON input data (regardless of
      // role-based mode); fall back to the profile work-history company
      // only when the JSON entry doesn't supply one.
      const company = ((json && json.company) || '').trim()
        || (fromProfile ? (wh.company || '') : '');
      const period = fromProfile ? (wh.period || '') : (json.period || '');
      const loc = fromProfile ? (wh.location || '') : (json.location || '');
      const all = Array.isArray(json.sentences) ? json.sentences : [];
      const cnt = (typeof wh.bulletsCount === 'number' && wh.bulletsCount >= 0)
        ? wh.bulletsCount : null;
      const sentences = cnt === null ? all : all.slice(0, cnt);
      return { title, company, period, location: loc, sentences };
    }).filter((it) =>
      it.title || it.company || it.period || it.location || (it.sentences && it.sentences.length)
    );

    return {
      profile, data,
      fullName: fullName || 'Your Name',
      initials,
      tagline,
      location: profile.location || '',
      phone: profile.phone || '',
      email: profile.email || '',
      linkedin: profile.linkedin || '',
      github: profile.github || '',
      linkedinVisible: profile.linkedinVisible !== false,
      githubVisible: profile.githubVisible !== false,
      summary: data.summary || '',
      skills,
      experience,
      education,
      certifications: profileCertifications,
    };
  }

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

  /**
   * Merge education for rendering.
   * - University/institution and period ALWAYS come from the profile.
   * - Degree/major comes from the profile when role-based, and from the JSON
   *   output (zipped by index) when not role-based.
   * The profile entries are the base list, so the candidate's real schools and
   * dates are preserved; only the degree text is swapped in non-role-based mode.
   * Falls back to JSON-only entries if the profile has no education on file.
   */
  function mergeEducation(profileEducation, jsonEducation, roleBased) {
    const profileEdu = Array.isArray(profileEducation) ? profileEducation : [];
    const jsonEdu = Array.isArray(jsonEducation) ? jsonEducation : [];

    if (profileEdu.length) {
      return profileEdu.map((pe, i) => {
        const base = pe && typeof pe === 'object' ? pe : {};
        if (roleBased) return base;
        const jsonDegree = ((jsonEdu[i] && jsonEdu[i].degree) || '').trim();
        return {
          institution: base.institution || '',
          period: base.period || '',
          degree: jsonDegree || base.degree || '',
        };
      });
    }

    // No profile education: only honor JSON degrees for not-role-based resumes.
    if (!roleBased) return jsonEdu;
    return [];
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

  // ---------- Templates ----------

  const templates = [];
  function register(t) {
    templates.push(t);
  }

  register({
    id: 'modern',
    name: 'Modern',
    description: 'Two-column layout with accent sidebar',
    controls: [
      colorControl('sidebarColor', 'Sidebar', '#eef2f8'),
      colorControl('sidebarTextColor', 'Sidebar text', '#1a1a1a'),
      fontControl('headFont', 'Heading font', 'inter'),
      fontControl('contentFont', 'Body font', 'inter'),
      rangeControl('sidebarPadX', 'Sidebar margin', 0.3, 0.1, 0.7, 0.05, 'in'),
      ...typoControls({
        nameColor: '#1d4e7a',
        headingColor: '#1d4e7a',
        titleColor: '#4b5566',
        entryMetaColor: '#555555',
      }),
    ],
    thumbnail: () => `
      <div class="tpl-thumb tpl-thumb-modern">
        <div class="tt-side"><div class="tt-block s"></div><div class="tt-block s"></div><div class="tt-block s"></div></div>
        <div class="tt-main">
          <div class="tt-name"></div><div class="tt-tag"></div>
          <div class="tt-block m"></div><div class="tt-block m"></div>
        </div>
      </div>`,
    render: (input) => {
      const profile = (input && input.profile) || {};
      const data = (input && input.data) || {};
      const style = (input && input.style) || {};

      const sidebarBg = style.sidebarColor || '#eef2f8';
      const sidebarText = style.sidebarTextColor || '#1a1a1a';
      const accent = deriveAccent(sidebarBg);
      let padX = Number(style.sidebarPadX);
      if (!isFinite(padX)) padX = 0.3;
      // Clamp to a reasonable range so the layout never breaks.
      padX = Math.max(0.05, Math.min(1, padX));

      const fullName = `${profile.firstName || ''} ${profile.lastName || ''}`
        .trim();
      const location = profile.location || '';
      const phone = profile.phone || '';
      const email = profile.email || '';
      const linkedin = profile.linkedin || '';
      const github = profile.github || '';
      const linkedinVisible = profile.linkedinVisible !== false;
      const githubVisible = profile.githubVisible !== false;
      const roleBasedWork = profile.roleBasedWork === true;
      const profileTitle = (profile.title || '').trim();
      const workHistory = Array.isArray(profile.workHistory)
        ? profile.workHistory
        : [];
      const profileEducation = Array.isArray(profile.education)
        ? profile.education
        : [];
      const jsonEducation = Array.isArray(data.education) ? data.education : [];
      // University/institution (and period) always come from the profile;
      // degree/major comes from the profile when role-based, from the JSON when
      // not role-based.
      const educationList = mergeEducation(
        profileEducation,
        jsonEducation,
        roleBasedWork
      );
      const profileCertifications = Array.isArray(profile.certifications)
        ? profile.certifications
        : [];

      // We want padding (not @page margin) to give every page its
      // top/bottom breathing room. Normally element padding only
      // applies once at the start/end of the box, so a body padding-top
      // would only show on page 1. The fix is `box-decoration-break:
      // clone`, which tells the browser to repeat the box's padding,
      // border, and background at every fragmentation break (i.e. on
      // every page). Combined with @page margin: 0, the body's
      // gradient background also bleeds edge-to-edge on every page.
      const css = typoVarsCss(style) + `
        @page { size: Letter; margin: 0; }
        body {
          font-family: var(--rx-body-font);
          color: var(--rx-body-color);
          font-size: var(--rx-body-size);
          line-height: var(--rx-line);
          margin: 0;
          min-height: 100vh;
          padding: 0.6in 0;
          -webkit-box-decoration-break: clone;
          box-decoration-break: clone;
          background: linear-gradient(to right,
            ${sidebarBg} 0%, ${sidebarBg} 32%,
            #ffffff 32%, #ffffff 100%);
        }
        h1, h2, h3 { font-family: var(--rx-head-font); }
        .page { display: grid; grid-template-columns: 32% 68%; }
        .sidebar { padding: 0 ${padX}in; color: ${sidebarText}; }
        .main { padding: 0 0.6in 0 0.45in; }

        h1 { margin: 0 0 4px; font-size: var(--rx-name-size); font-weight: 700; line-height: 1.1; color: var(--rx-name-color); text-align: var(--rx-name-align); letter-spacing: 0.2px; }
        .tagline { color: var(--rx-title-color); font-weight: 500; margin-bottom: 14px; font-size: var(--rx-title-size); text-align: var(--rx-title-align); }

        .social-icons {
          display: flex;
          gap: 10px;
          margin: 0 0 14px;
        }
        .social-icon {
          display: inline-flex;
          color: ${sidebarText};
          text-decoration: none;
          line-height: 0;
        }

        /* Sidebar typography hierarchy (4 levels):
           L1 section title (h2)    : 11.5pt uppercase bold + underline
           L2 item heading          : 10pt bold (institution, cert name, skill category)
           L3 item subtitle         : 9.3pt normal (degree, skill items, contact lines)
           L4 item meta             : 8.6pt regular, lower opacity (period, date) */
        .sidebar h2 {
          font-size: var(--rx-head-size);
          text-transform: uppercase;
          letter-spacing: 1.8px;
          margin: 22px 0 8px;
          color: ${sidebarText};
          font-weight: 700;
          border-bottom: 1px solid ${sidebarText};
          padding-bottom: 4px;
        }
        .sidebar h2:first-of-type { margin-top: 2px; }

        .main h2 {
          font-size: var(--rx-head-size);
          text-transform: uppercase;
          letter-spacing: 1.6px;
          margin: 18px 0 6px;
          color: var(--rx-head-color);
          font-weight: 700;
        }

        .sidebar .contact { font-size: 9.3pt; line-height: 1.55; }
        .sidebar .contact div { margin-bottom: 3px; word-break: break-word; }

        .skill-block { margin: 8px 0 10px; }
        .skill-block .cat {
          font-weight: 700;
          font-size: 10pt;
          color: ${sidebarText};
          margin-bottom: 1px;
        }
        .skill-block .items {
          font-size: 9.3pt;
          color: ${sidebarText};
          opacity: 0.92;
        }

        .edu-item, .cert-item {
          margin-bottom: 10px;
          color: ${sidebarText};
        }
        .edu-item .institution, .cert-item .cert-name {
          font-weight: 700;
          font-size: 10pt;
          line-height: 1.3;
        }
        .edu-item .degree {
          font-size: 9.3pt;
          margin-top: 1px;
        }
        .edu-item .period,
        .cert-item .meta {
          font-size: 8.6pt;
          opacity: 0.72;
          margin-top: 1px;
        }

        .exp-item { margin-bottom: var(--rx-item-gap); }
        .exp-item .meta { color: var(--rx-emeta-color); font-size: var(--rx-emeta-size); margin: 0 0 4px; }

        .main h3 {
          margin: 10px 0 2px;
          font-size: var(--rx-etitle-size);
          color: var(--rx-etitle-color);
          font-weight: 600;
        }

        ul { margin: 4px 0 0 16px; padding: 0; }
        li { margin-bottom: 3px; }
        p { margin: 3px 0; }
        a { color: ${accent}; text-decoration: none; }
        section { margin-bottom: var(--rx-section-gap); }
      `;

      // ----- SIDEBAR -----
      const sidebarParts = [];

      // Social icons at the top-left of the sidebar (instead of URL text).
      const socials = [];
      if (linkedinVisible && linkedin) {
        socials.push(
          `<a class="social-icon" href="${esc(linkedin)}" title="LinkedIn">${ICONS.linkedin}</a>`
        );
      }
      if (githubVisible && github) {
        socials.push(
          `<a class="social-icon" href="${esc(github)}" title="GitHub">${ICONS.github}</a>`
        );
      }
      if (socials.length) {
        sidebarParts.push(`<div class="social-icons">${socials.join('')}</div>`);
      }

      if (location || phone || email) {
        sidebarParts.push('<h2>Contact</h2><div class="contact">');
        if (location) sidebarParts.push(contactBit('location', location, 'div'));
        if (phone) sidebarParts.push(contactBit('phone', phone, 'div'));
        if (email) sidebarParts.push(contactBit('email', email, 'div'));
        sidebarParts.push('</div>');
      }

      if (Array.isArray(data.skills) && data.skills.length) {
        sidebarParts.push('<h2>Skills</h2>');
        for (const entry of data.skills) {
          if (!entry || typeof entry !== 'object') continue;
          for (const [category, items] of Object.entries(entry)) {
            const list = Array.isArray(items) ? items.filter(Boolean).join(', ') : '';
            sidebarParts.push(`
              <div class="skill-block">
                <div class="cat">${esc(category)}</div>
                ${list ? `<div class="items">${esc(list)}</div>` : ''}
              </div>
            `);
          }
        }
      }

      if (educationList.length) {
        const eduItems = educationList
          .map((it) => {
            if (!it || typeof it !== 'object') return '';
            const lines = [];
            if (it.institution) lines.push(`<div class="institution">${esc(it.institution)}</div>`);
            if (it.degree) lines.push(`<div class="degree">${esc(it.degree)}</div>`);
            if (it.period) lines.push(`<div class="period">${esc(it.period)}</div>`);
            if (!lines.length) return '';
            return `<div class="edu-item">${lines.join('')}</div>`;
          })
          .filter(Boolean)
          .join('');
        if (eduItems) sidebarParts.push(`<h2>Education</h2>${eduItems}`);
      }

      if (profileCertifications.length) {
        const certItems = profileCertifications
          .map((it) => {
            if (!it || typeof it !== 'object') return '';
            const lines = [];
            if (it.certification) lines.push(`<div class="cert-name">${esc(it.certification)}</div>`);
            if (it.institution) lines.push(`<div class="meta">${esc(it.institution)}</div>`);
            if (it.date) lines.push(`<div class="meta">${esc(it.date)}</div>`);
            if (!lines.length) return '';
            return `<div class="cert-item">${lines.join('')}</div>`;
          })
          .filter(Boolean)
          .join('');
        if (certItems) sidebarParts.push(`<h2>Certifications</h2>${certItems}`);
      }

      // ----- MAIN -----
      const mainParts = [];
      mainParts.push(`<h1>${esc(fullName || 'Your Name')}</h1>`);
      // Tagline source mirrors the role-based contract:
      // - Role-based     → profile.title (the user controls it).
      // - Not role-based → data.title from the JSON (the LLM controls it).
      const tagline = roleBasedWork
        ? profileTitle
        : (data.title ? String(data.title).trim() : '');
      if (tagline) {
        mainParts.push(`<div class="tagline">${esc(tagline)}</div>`);
      }

      if (data.summary) {
        mainParts.push(`
          <section>
            <h2>Summary</h2>
            <p>${esc(data.summary)}</p>
          </section>
        `);
      }

      const expFromJson = Array.isArray(data.experience) ? data.experience : [];

      function renderExpItem(opts) {
        const title = (opts.title || '').trim();
        const company = (opts.company || '').trim();
        const period = (opts.period || '').trim();
        const loc = (opts.location || '').trim();
        const sentences = Array.isArray(opts.sentences) ? opts.sentences : [];
        if (!title && !company && !period && !loc && !sentences.length) return '';
        const heading = [title, company].filter(Boolean).map(esc).join(' &middot; ');
        const meta = [period, loc].filter(Boolean).map(esc).join(' &middot; ');
        const ul = sentences.length
          ? `<ul>${sentences.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`
          : '';
        return `
          <div class="exp-item">
            ${heading ? `<h3>${heading}</h3>` : ''}
            ${meta ? `<div class="meta">${meta}</div>` : ''}
            ${ul}
          </div>
        `;
      }

      let expItemsHtml = '';
      if (workHistory.length) {
        // Profile work history is the source of truth for company/period/location.
        // Title comes from the profile when role-based; otherwise from the JSON.
        // Sentences always come from the JSON, paired by index.
        expItemsHtml = workHistory
          .map((wh, i) => {
            const json = expFromJson[i] || {};
            // Role-based: title comes from the profile's own per-entry title.
            // Not role-based: title comes from the JSON's experience[i].title.
            // No profile-wide prefix is applied — each company shows only
            // its own title.
            const title = roleBasedWork
              ? (wh.title || '')
              : ((json.title || '').trim());
            // Bullets always come from the JSON's sentences. The optional
            // per-entry `bulletsCount` truncates the list (empty/null = all).
            const allSentences = Array.isArray(json.sentences)
              ? json.sentences
              : [];
            const count = (typeof wh.bulletsCount === 'number' && wh.bulletsCount >= 0)
              ? wh.bulletsCount
              : null;
            const sentences = count === null ? allSentences : allSentences.slice(0, count);
            // Company always comes from the JSON input data; fall back to the
            // profile work-history company only when JSON omits it.
            const company = ((json.company || '').trim()) || wh.company;
            return renderExpItem({
              title,
              company,
              period: wh.period,
              location: wh.location,
              sentences,
            });
          })
          .filter(Boolean)
          .join('');
      } else if (expFromJson.length) {
        // Fallback when no profile work history is set. Titles still obey
        // the role-based contract: role-based mode never shows JSON titles.
        expItemsHtml = expFromJson
          .map((it) =>
            renderExpItem({
              title: roleBasedWork ? '' : (it && it.title),
              company: it && it.company,
              sentences: it && it.sentences,
            })
          )
          .filter(Boolean)
          .join('');
      }

      if (expItemsHtml) {
        mainParts.push(`<section><h2>Experience</h2>${expItemsHtml}</section>`);
      }

      const body = `
        <div class="page">
          <aside class="sidebar">${sidebarParts.join('')}</aside>
          <main class="main">${mainParts.join('')}</main>
        </div>`;

      return shell(fullName || 'Resume', css, body);
    },
  });

  // ---------- Shared rendering snippets used by the new templates ----------

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

  function contactBits(v) {
    return [v.phone, v.email, v.location].filter(Boolean);
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

  function renderExperienceList(v, opts) {
    if (!v.experience.length) return '';
    const items = v.experience.map((e) => {
      const heading = [e.title, e.company].filter(Boolean).map(esc).join(' &middot; ');
      const meta = [e.period, e.location].filter(Boolean).map(esc).join(' &middot; ');
      const ul = e.sentences.length
        ? `<ul>${e.sentences.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : '';
      return `<div class="exp-item">
        ${heading ? `<h3>${heading}</h3>` : ''}
        ${meta ? `<div class="meta">${meta}</div>` : ''}
        ${ul}
      </div>`;
    }).join('');
    return `<section><h2>${esc((opts && opts.heading) || 'Experience')}</h2>${items}</section>`;
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
    const items = flat.map((s) => `
      <div class="skill-block">
        <div class="cat">${esc(s.category)}</div>
        ${s.items.length ? `<div class="items">${esc(s.items.join(', '))}</div>` : ''}
      </div>`).join('');
    return `<section><h2>Skills</h2>${items}</section>`;
  }

  function renderSkillsChips(v, accent) {
    const flat = flattenSkills(v.skills);
    if (!flat.length) return '';
    const chips = [];
    for (const s of flat) {
      for (const it of s.items) {
        chips.push(`<span class="chip" style="background:${accent}1a;color:${accent};border-color:${accent}55">${esc(it)}</span>`);
      }
    }
    return chips.length ? `<section><h2>Skills</h2><div class="chips">${chips.join('')}</div></section>` : '';
  }

  function renderSkillsTwoCol(v) {
    const flat = flattenSkills(v.skills);
    if (!flat.length) return '';
    const cells = [];
    for (const s of flat) {
      for (const it of s.items) {
        cells.push(`<div class="skill-cell"><span class="skill-name">${esc(it)}</span><span class="skill-cat">${esc(s.category)}</span></div>`);
      }
    }
    return `<section><h2>Skills</h2><div class="skill-grid">${cells.join('')}</div></section>`;
  }

  /**
   * Skills grouped by category, laid out in a 2-column grid where each cell is
   * a "category block" (category heading + comma-separated items).
   */
  function renderSkillsGroupedGrid(v) {
    const flat = flattenSkills(v.skills);
    if (!flat.length) return '';
    const blocks = flat
      .map((s) => {
        const items = (s.items || []).filter(Boolean).join(', ');
        if (!s.category && !items) return '';
        return `
          <div class="skill-group">
            ${s.category ? `<div class="cat">${esc(s.category)}</div>` : ''}
            ${items ? `<div class="items">${esc(items)}</div>` : ''}
          </div>`;
      })
      .filter(Boolean)
      .join('');
    return blocks
      ? `<section><h2>Skills</h2><div class="skill-groups">${blocks}</div></section>`
      : '';
  }

  // -------------------- 1) CLASSIC --------------------

  register({
    id: 'classic',
    name: 'Classic',
    description: 'Single-column traditional layout with contact icon row',
    controls: [
      colorControl('accentColor', 'Accent', '#1f6feb'),
      fontControl('headFont', 'Heading font', 'inter'),
      fontControl('contentFont', 'Body font', 'inter'),
      selectControl(
        'extrasPlacement',
        'Education / Skills / Certs',
        [
          { value: 'afterExperience', label: 'After experience' },
          { value: 'belowSummary', label: 'Below summary' },
        ],
        'afterExperience',
        'Layout'
      ),
      ...typoControls({
        nameSize: 26,
        nameColor: '#1a1a1a',
        titleColor: '#475066',
        headingSize: 12,
        headingColor: '#1f6feb',
      }),
    ],
    thumbnail: () => `
      <div class="tpl-thumb tpl-thumb-classic">
        <div class="tt-name center"></div><div class="tt-tag center"></div>
        <div class="tt-row center"><span></span><span></span><span></span></div>
        <div class="tt-block m"></div><div class="tt-block m"></div><div class="tt-block m"></div>
      </div>`,
    render: (input) => {
      const v = prepareView(input);
      const t = resolveStyle({ controls: [
        colorControl('accentColor', 'Accent', '#1f6feb'),
        colorControl('textColor', 'Text', '#1a1a1a'),
        fontControl('headFont', '', 'inter'),
        fontControl('contentFont', '', 'inter'),
      ] }, (input && input.style) || {});
      const extrasPlacement =
        ((input && input.style) || {}).extrasPlacement || 'afterExperience';
      const contactRow = contactItems(v)
        .map((it) => contactBit(it.kind, it.value, 'span'))
        .join('<span class="dot">&middot;</span>');
      const css = typoVarsCss((input && input.style) || {}) + `
        @page { size: Letter; margin: 0.55in 0.6in; }
        body { font-family: var(--rx-body-font); color: var(--rx-body-color);
          font-size: var(--rx-body-size); line-height: var(--rx-line); margin: 0; }
        h1, h2, h3 { font-family: var(--rx-head-font); }
        h1 { margin: 0 0 4px; font-size: var(--rx-name-size); color: var(--rx-name-color); text-align: var(--rx-name-align); font-weight: 800; letter-spacing: -0.4px; }
        .tagline { color: var(--rx-title-color); font-size: var(--rx-title-size); text-align: var(--rx-title-align); margin-bottom: 10px; }
        .contact-row { color: #475066; font-size: 9.7pt; display: flex; flex-wrap: wrap; gap: 8px;
          align-items: center; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid ${t.accentColor}; }
        .contact-row .contact-bit { display: inline-flex; align-items: center; }
        .contact-row .dot { opacity: 0.5; }
        h2 { font-size: var(--rx-head-size); text-transform: uppercase; letter-spacing: 1.4px; margin: 14px 0 6px;
          color: var(--rx-head-color); font-weight: 800; border-bottom: 1px solid ${t.accentColor}33; padding-bottom: 4px; }
        h3 { font-size: var(--rx-etitle-size); color: var(--rx-etitle-color); font-weight: 700; margin: 8px 0 1px; }
        .meta { color: var(--rx-emeta-color); font-size: var(--rx-emeta-size); margin-bottom: 4px; }
        ul { margin: 4px 0 0 18px; padding: 0; } li { margin-bottom: 3px; } p { margin: 3px 0; }
        a { color: ${t.accentColor}; text-decoration: none; }
        .institution, .cert-name { font-weight: 700; }
        .edu-item, .cert-item { margin-bottom: var(--rx-item-gap); }
        .exp-item { margin-bottom: var(--rx-item-gap); }
        section { margin-bottom: var(--rx-section-gap); }
        .skill-block { margin: 4px 0 8px; }
        .skill-block .cat { font-weight: 700; }
        .social-icons { display: flex; gap: 8px; margin-left: auto; }
        .social-icon { color: ${t.accentColor}; }
      `;
      const summaryHtml = v.summary
        ? `<section><h2>Summary</h2><p>${esc(v.summary)}</p></section>`
        : '';
      const experienceHtml = renderExperienceList(v);
      // Education + Certifications + Skills move as a group: either below the
      // summary (before experience) or after experience (the default).
      const extrasHtml = `${renderEducationList(v)}${renderCertificationsList(v)}${renderSkillsInline(v)}`;
      const mainHtml = extrasPlacement === 'belowSummary'
        ? `${summaryHtml}${extrasHtml}${experienceHtml}`
        : `${summaryHtml}${experienceHtml}${extrasHtml}`;
      const body = `
        <h1>${esc(v.fullName)}</h1>
        ${v.tagline ? `<div class="tagline">${esc(v.tagline)}</div>` : ''}
        <div class="contact-row">${contactRow}${socialLinks(v, t.accentColor)}</div>
        ${mainHtml}
      `;
      return shell(v.fullName, css, body);
    },
  });

  // -------------------- 2) DECORATIVE --------------------

  register({
    id: 'decorative',
    name: 'Decorative',
    description: 'Centered single-column with subtle floral motif on the margins',
    controls: [
      colorControl('accentColor', 'Accent', '#3b6f3a'),
      colorControl('motifColor', 'Motif', '#7da77a'),
      fontControl('headFont', 'Heading font', 'georgia'),
      fontControl('contentFont', 'Body font', 'georgia'),
      ...typoControls({
        nameSize: 28,
        nameAlign: 'center',
        titleSize: 11.5,
        titleColor: '#475066',
        titleAlign: 'center',
        headingSize: 13,
        headingColor: '#3b6f3a',
        lineHeight: 1.55,
      }),
    ],
    thumbnail: () => `
      <div class="tpl-thumb tpl-thumb-decorative">
        <div class="tt-leaf l"></div><div class="tt-leaf r"></div>
        <div class="tt-name center"></div><div class="tt-tag center"></div>
        <div class="tt-row center"><span></span><span></span><span></span></div>
        <div class="tt-block m"></div><div class="tt-block m"></div>
      </div>`,
    render: (input) => {
      const v = prepareView(input);
      const t = resolveStyle({ controls: [
        colorControl('accentColor', '', '#3b6f3a'),
        colorControl('motifColor', '', '#7da77a'),
        fontControl('headFont', '', 'georgia'),
        fontControl('contentFont', '', 'georgia'),
      ] }, (input && input.style) || {});
      const motif = encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 240' fill='none' stroke='${t.motifColor}' stroke-width='1.2' opacity='0.55'><path d='M40 20 C 30 60, 50 80, 40 120 S 30 200, 40 230'/><path d='M40 50 q -22 8 -22 28' /><path d='M40 80 q 22 6 22 26' /><path d='M40 120 q -22 6 -22 26' /><path d='M40 160 q 22 6 22 26' /><circle cx='40' cy='20' r='3'/></svg>`);
      const motifBg = `url("data:image/svg+xml;utf8,${motif}")`;
      const contactRow = contactItems(v)
        .map((it) => contactBit(it.kind, it.value, 'span'))
        .join('<span class="dot">&middot;</span>');
      const css = typoVarsCss((input && input.style) || {}) + `
        @page { size: Letter; margin: 0.6in 0; }
        body { font-family: var(--rx-body-font); color: var(--rx-body-color);
          font-size: var(--rx-body-size); line-height: var(--rx-line); margin: 0;
          background: ${motifBg} repeat-y left top, ${motifBg} repeat-y right top;
          background-size: 70px auto, 70px auto;
          -webkit-box-decoration-break: clone; box-decoration-break: clone;
          padding: 0 0.85in; }
        h1, h2, h3 { font-family: var(--rx-head-font); }
        .header { text-align: center; margin-bottom: 14px; }
        h1 { margin: 0 0 6px; font-size: var(--rx-name-size); color: var(--rx-name-color); text-align: var(--rx-name-align); font-weight: 700; letter-spacing: 0.3px; }
        .tagline { color: var(--rx-title-color); font-size: var(--rx-title-size); text-align: var(--rx-title-align); font-style: italic; margin-bottom: 8px; }
        .contact-row { display: inline-flex; gap: 10px; color: #475066; font-size: 10pt; }
        .contact-row .contact-bit { display: inline-flex; align-items: center; }
        .contact-row .dot { opacity: 0.5; }
        h2 { font-size: var(--rx-head-size); text-align: center; text-transform: uppercase; letter-spacing: 2px;
          margin: 18px 0 8px; color: var(--rx-head-color); position: relative; }
        h2::before, h2::after { content:''; display: inline-block; width: 36px; height: 1px;
          background: ${t.accentColor}; vertical-align: middle; margin: 0 10px; opacity: 0.7; }
        h3 { font-size: var(--rx-etitle-size); color: var(--rx-etitle-color); font-weight: 700; margin: 8px 0 1px; }
        .meta { color: var(--rx-emeta-color); font-size: var(--rx-emeta-size); margin-bottom: 4px; }
        ul { margin: 4px 0 0 18px; padding: 0; } li { margin-bottom: 3px; }
        a { color: ${t.accentColor}; text-decoration: none; }
        section { margin-bottom: var(--rx-section-gap); }
        .skill-block { margin: 4px 0; } .skill-block .cat { font-weight: 700; color: ${t.accentColor}; }
        .institution, .cert-name { font-weight: 700; }
        .edu-item, .cert-item { margin-bottom: var(--rx-item-gap); text-align: center; }
        .exp-item { margin-bottom: var(--rx-item-gap); }
      `;
      const body = `
        <div class="header">
          <h1>${esc(v.fullName)}</h1>
          ${v.tagline ? `<div class="tagline">${esc(v.tagline)}</div>` : ''}
          <div class="contact-row">${contactRow}</div>
        </div>
        ${v.summary ? `<section><h2>Summary</h2><p style="text-align:center;">${esc(v.summary)}</p></section>` : ''}
        ${renderExperienceList(v)}
        ${renderEducationList(v)}
        ${renderSkillsInline(v)}
        ${renderCertificationsList(v)}
      `;
      return shell(v.fullName, css, body);
    },
  });

  // -------------------- 3) HEADER BAR (with initials circle) --------------------

  register({
    id: 'headerBar',
    name: 'Header Bar',
    description: 'Colored header band with an initials circle and two-column body',
    controls: [
      colorControl('headerColor', 'Header', '#13354c'),
      colorControl('headerTextColor', 'Header text', '#ffffff'),
      colorControl('accentColor', 'Accent', '#13354c'),
      fontControl('headFont', 'Heading font', 'inter'),
      fontControl('contentFont', 'Body font', 'inter'),
      ...typoControls({
        nameColor: '#ffffff',
        titleColor: '#ffffff',
        titleSize: 11.5,
        headingSize: 11.5,
        headingColor: '#13354c',
      }),
    ],
    thumbnail: () => `
      <div class="tpl-thumb tpl-thumb-headerbar">
        <div class="tt-header"><div class="tt-circle"></div></div>
        <div class="tt-cols">
          <div class="tt-col-l"><div class="tt-block s"></div><div class="tt-block s"></div></div>
          <div class="tt-col-r"><div class="tt-block m"></div><div class="tt-block m"></div></div>
        </div>
      </div>`,
    render: (input) => {
      const v = prepareView(input);
      const t = resolveStyle({ controls: [
        colorControl('headerColor', '', '#13354c'),
        colorControl('headerTextColor', '', '#ffffff'),
        colorControl('accentColor', '', '#13354c'),
        fontControl('headFont', '', 'inter'),
        fontControl('contentFont', '', 'inter'),
      ] }, (input && input.style) || {});
      const contact = contactItems(v)
        .map((it) => contactBit(it.kind, it.value, 'div'))
        .join('');
      const social = socialLinks(v, t.headerTextColor);
      const css = typoVarsCss((input && input.style) || {}) + `
        @page { size: Letter; margin: 0; }
        body { font-family: var(--rx-body-font); color: var(--rx-body-color);
          font-size: var(--rx-body-size); line-height: var(--rx-line); margin: 0;
          padding: 0.4in 0;
          -webkit-box-decoration-break: clone; box-decoration-break: clone; }
        h1, h2, h3 { font-family: var(--rx-head-font); }
        /* Header bleeds edge-to-edge on page 1 by cancelling body's top padding. */
        .header { background: ${t.headerColor}; color: ${t.headerTextColor};
          padding: 0.45in 0.55in; display: grid; grid-template-columns: 1fr auto;
          gap: 20px; align-items: center;
          margin: -0.4in 0 0; }
        .header h1 { margin: 0 0 4px; font-size: var(--rx-name-size); color: var(--rx-name-color); text-align: var(--rx-name-align); font-weight: 800; }
        .header .tagline { font-size: var(--rx-title-size); color: var(--rx-title-color); text-align: var(--rx-title-align); opacity: 0.9; margin-bottom: 8px; }
        .header .contacts { font-size: 9.7pt; display: flex; gap: 14px; flex-wrap: wrap; opacity: 0.95; }
        .header .contacts .contact-bit { display: inline-flex; align-items: center; }
        .header .social-icons { margin-top: 8px; }
        .initials-circle { width: 72px; height: 72px; border-radius: 50%;
          background: ${t.headerTextColor}; color: ${t.headerColor};
          display: flex; align-items: center; justify-content: center;
          font-size: 26pt; font-weight: 800; font-family: var(--rx-head-font); letter-spacing: -0.5px; }
        /* Inner padding only handles horizontal + first-page top space below the header.
           Vertical breathing room on every page comes from body's cloned padding. */
        .body { display: grid; grid-template-columns: 38% 62%; padding: 0.4in 0.55in 0; gap: 20px; }
        h2 { font-size: var(--rx-head-size); text-transform: uppercase; letter-spacing: 1.4px;
          color: var(--rx-head-color); margin: 12px 0 6px; font-weight: 800;
          border-bottom: 1px solid ${t.accentColor}33; padding-bottom: 4px; }
        h2:first-child, section:first-child h2 { margin-top: 0; }
        h3 { font-size: var(--rx-etitle-size); color: var(--rx-etitle-color); font-weight: 700; margin: 8px 0 1px; }
        .meta { color: var(--rx-emeta-color); font-size: var(--rx-emeta-size); margin-bottom: 4px; }
        ul { margin: 4px 0 0 18px; padding: 0; } li { margin-bottom: 3px; }
        a { color: ${t.accentColor}; text-decoration: none; }
        .chips { display: flex; flex-wrap: wrap; gap: 6px; }
        .chip { display: inline-block; font-size: 9.3pt; padding: 3px 9px; border: 1px solid;
          border-radius: 999px; }
        .institution, .cert-name { font-weight: 700; }
        section { margin-bottom: var(--rx-section-gap); }
        .edu-item, .cert-item, .exp-item { margin-bottom: var(--rx-item-gap); }
        .skill-block { margin: 4px 0 8px; }
        .skill-block .cat { font-weight: 700; }
      `;
      const body = `
        <div class="header">
          <div>
            <h1>${esc(v.fullName)}</h1>
            ${v.tagline ? `<div class="tagline">${esc(v.tagline)}</div>` : ''}
            <div class="contacts">${contact}</div>
            ${social}
          </div>
          <div class="initials-circle">${esc(v.initials)}</div>
        </div>
        <div class="body">
          <div class="left">
            ${v.summary ? `<section><h2>Summary</h2><p>${esc(v.summary)}</p></section>` : ''}
            ${renderSkillsChips(v, t.accentColor)}
          </div>
          <div class="right">
            ${renderExperienceList(v)}
            ${renderEducationList(v)}
            ${renderCertificationsList(v)}
          </div>
        </div>
      `;
      return shell(v.fullName, css, body);
    },
  });

  // -------------------- 4) ACCENT BANNER --------------------

  register({
    id: 'accentBanner',
    name: 'Accent Banner',
    description: 'Solid accent banner across the top, two-column body below',
    controls: [
      colorControl('bannerColor', 'Banner', '#f1c64a'),
      colorControl('bannerTextColor', 'Banner text', '#1a1a1a'),
      colorControl('accentColor', 'Accent', '#1a1a1a'),
      fontControl('headFont', 'Heading font', 'inter'),
      fontControl('contentFont', 'Body font', 'inter'),
      ...typoControls({
        nameSize: 26,
        nameColor: '#1a1a1a',
        titleColor: '#1a1a1a',
        titleSize: 11.5,
        headingColor: '#1a1a1a',
      }),
    ],
    thumbnail: () => `
      <div class="tpl-thumb tpl-thumb-accent">
        <div class="tt-banner"></div>
        <div class="tt-row center"><span></span><span></span><span></span></div>
        <div class="tt-cols">
          <div class="tt-col-l"><div class="tt-block m"></div><div class="tt-block m"></div></div>
          <div class="tt-col-r"><div class="tt-block s"></div><div class="tt-block s"></div></div>
        </div>
      </div>`,
    render: (input) => {
      const v = prepareView(input);
      const t = resolveStyle({ controls: [
        colorControl('bannerColor', '', '#f1c64a'),
        colorControl('bannerTextColor', '', '#1a1a1a'),
        colorControl('accentColor', '', '#1a1a1a'),
        fontControl('headFont', '', 'inter'),
        fontControl('contentFont', '', 'inter'),
      ] }, (input && input.style) || {});
      const contactRow = contactItems(v)
        .map((it) => contactBit(it.kind, it.value, 'span'))
        .join('<span class="dot">&middot;</span>');
      const css = typoVarsCss((input && input.style) || {}) + `
        @page { size: Letter; margin: 0; }
        body { font-family: var(--rx-body-font); color: var(--rx-body-color);
          font-size: var(--rx-body-size); line-height: var(--rx-line); margin: 0;
          padding: 0.4in 0;
          -webkit-box-decoration-break: clone; box-decoration-break: clone; }
        h1, h2, h3 { font-family: var(--rx-head-font); }
        /* Banner bleeds edge-to-edge on page 1 by cancelling body's top padding. */
        .banner { background: ${t.bannerColor}; color: ${t.bannerTextColor};
          padding: 0.4in 0.55in; margin: -0.4in 0 0; }
        .banner h1 { margin: 0 0 4px; font-size: var(--rx-name-size); color: var(--rx-name-color); text-align: var(--rx-name-align); font-weight: 800; letter-spacing: -0.3px; }
        .banner .tagline { font-size: var(--rx-title-size); color: var(--rx-title-color); text-align: var(--rx-title-align); opacity: 0.9; }
        .contacts-row { padding: 10px 0.55in; border-bottom: 1px solid #e5e7ea;
          color: #475066; font-size: 9.8pt; display: flex; flex-wrap: wrap; gap: 6px;
          align-items: center; }
        .contacts-row .contact-bit { display: inline-flex; align-items: center; }
        .contacts-row .dot { opacity: 0.5; }
        /* Horizontal padding only; vertical comes from body. */
        .body { display: grid; grid-template-columns: 60% 40%; gap: 22px;
          padding: 0.4in 0.55in 0; }
        h2 { font-size: var(--rx-head-size); text-transform: uppercase; letter-spacing: 1.4px;
          color: var(--rx-head-color); margin: 12px 0 6px; font-weight: 800; }
        h2:first-child, section:first-child h2 { margin-top: 0; }
        h3 { font-size: var(--rx-etitle-size); color: var(--rx-etitle-color); font-weight: 700; margin: 8px 0 1px; }
        .meta { color: var(--rx-emeta-color); font-size: var(--rx-emeta-size); margin-bottom: 4px; }
        ul { margin: 4px 0 0 18px; padding: 0; } li { margin-bottom: 3px; }
        a { color: ${t.accentColor}; text-decoration: none; }
        .institution, .cert-name { font-weight: 700; }
        section { margin-bottom: var(--rx-section-gap); }
        .edu-item, .cert-item, .exp-item { margin-bottom: var(--rx-item-gap); }
        .skill-block { margin: 4px 0 6px; } .skill-block .cat { font-weight: 700; }
      `;
      const body = `
        <div class="banner">
          <h1>${esc(v.fullName)}</h1>
          ${v.tagline ? `<div class="tagline">${esc(v.tagline)}</div>` : ''}
        </div>
        <div class="contacts-row">${contactRow}${socialLinks(v, t.accentColor)}</div>
        <div class="body">
          <div class="left">
            ${renderExperienceList(v)}
            ${renderEducationList(v)}
            ${renderCertificationsList(v)}
          </div>
          <div class="right">
            ${v.summary ? `<section><h2>Summary</h2><p>${esc(v.summary)}</p></section>` : ''}
            ${renderSkillsInline(v)}
          </div>
        </div>
      `;
      return shell(v.fullName, css, body);
    },
  });

  // -------------------- 5) TWO COLUMN --------------------

  register({
    id: 'twoColumn',
    name: 'Two Column',
    description: 'Equal-width columns; experience on the left, summary and skills on the right',
    controls: [
      colorControl('accentColor', 'Accent', '#374151'),
      fontControl('headFont', 'Heading font', 'inter'),
      fontControl('contentFont', 'Body font', 'inter'),
      ...typoControls({
        nameSize: 26,
        nameAlign: 'center',
        titleColor: '#475066',
        titleSize: 11.5,
        titleAlign: 'center',
        headingSize: 11.5,
        headingColor: '#374151',
      }),
    ],
    thumbnail: () => `
      <div class="tpl-thumb tpl-thumb-twocol">
        <div class="tt-name center"></div><div class="tt-tag center"></div>
        <div class="tt-cols equal">
          <div class="tt-col-l"><div class="tt-block m"></div><div class="tt-block m"></div></div>
          <div class="tt-col-r"><div class="tt-block s"></div><div class="tt-block s"></div></div>
        </div>
      </div>`,
    render: (input) => {
      const v = prepareView(input);
      const t = resolveStyle({ controls: [
        colorControl('accentColor', '', '#374151'),
        fontControl('headFont', '', 'inter'),
        fontControl('contentFont', '', 'inter'),
      ] }, (input && input.style) || {});
      const css = typoVarsCss((input && input.style) || {}) + `
        /* @page margins are overridden to 0 by the printToPDF call, so we keep
           consistent per-page top/bottom spacing via body padding + clone. */
        @page { size: Letter; margin: 0; }
        body { font-family: var(--rx-body-font); color: var(--rx-body-color);
          font-size: var(--rx-body-size); line-height: var(--rx-line); margin: 0;
          padding: 0.55in 0.55in;
          -webkit-box-decoration-break: clone; box-decoration-break: clone; }
        h1, h2, h3 { font-family: var(--rx-head-font); }
        .header { text-align: center; margin-bottom: 14px; padding-bottom: 10px;
          border-bottom: 1px solid ${t.accentColor}; }
        .header h1 { margin: 0; font-size: var(--rx-name-size); color: var(--rx-name-color); text-align: var(--rx-name-align); font-weight: 800; letter-spacing: -0.3px; }
        .tagline { color: var(--rx-title-color); font-size: var(--rx-title-size); text-align: var(--rx-title-align); margin-top: 2px; }
        .body { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
        h2 { font-size: var(--rx-head-size); text-transform: uppercase; letter-spacing: 1.4px;
          color: var(--rx-head-color); margin: 12px 0 6px; font-weight: 800; }
        h2:first-child, section:first-child h2 { margin-top: 0; }
        h3 { font-size: var(--rx-etitle-size); color: var(--rx-etitle-color); font-weight: 700; margin: 8px 0 1px; }
        .meta { color: var(--rx-emeta-color); font-size: var(--rx-emeta-size); margin-bottom: 4px; }
        ul { margin: 4px 0 0 18px; padding: 0; } li { margin-bottom: 3px; }
        a { color: ${t.accentColor}; text-decoration: none; }
        section { margin-bottom: var(--rx-section-gap); }
        /* Skills grouped by category, two columns wide. Each cell is a group. */
        .skill-groups { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
        .skill-group { break-inside: avoid; }
        .skill-group .cat { font-weight: 700; font-size: 10pt; color: ${t.accentColor};
          margin-bottom: 2px; line-height: 1.25; }
        .skill-group .items { font-size: 9.6pt; color: #2b3344; line-height: 1.4; }
        .contacts-block { font-size: 9.8pt; line-height: 1.6; }
        .institution, .cert-name { font-weight: 700; }
        .edu-item, .cert-item, .exp-item { margin-bottom: var(--rx-item-gap); }
      `;
      const body = `
        <div class="header">
          <h1>${esc(v.fullName)}</h1>
          ${v.tagline ? `<div class="tagline">${esc(v.tagline)}</div>` : ''}
        </div>
        <div class="body">
          <div class="left">
            ${renderExperienceList(v)}
            ${renderEducationList(v)}
            ${renderCertificationsList(v)}
          </div>
          <div class="right">
            ${v.summary ? `<section><h2>Summary</h2><p>${esc(v.summary)}</p></section>` : ''}
            ${(v.phone || v.email || v.location || v.linkedin || v.github) ? `<section><h2>Contact</h2>
              <div class="contacts-block">
                ${contactBit('phone', v.phone, 'div')}
                ${contactBit('email', v.email, 'div')}
                ${contactBit('location', v.location, 'div')}
                ${socialLinks(v, t.accentColor)}
              </div>
            </section>` : ''}
            ${renderSkillsGroupedGrid(v)}
          </div>
        </div>
      `;
      return shell(v.fullName, css, body);
    },
  });

  // -------------------- 6) DARK SIDEBAR --------------------

  register({
    id: 'darkSidebar',
    name: 'Dark Sidebar',
    description: 'Wide dark sidebar that hosts your name, summary and skills',
    controls: [
      colorControl('sidebarColor', 'Sidebar', '#1f3a4a'),
      colorControl('sidebarTextColor', 'Sidebar text', '#ffffff'),
      colorControl('accentColor', 'Accent', '#1f3a4a'),
      fontControl('headFont', 'Heading font', 'inter'),
      fontControl('contentFont', 'Body font', 'inter'),
      rangeControl('sidebarWidth', 'Sidebar width', 36, 28, 45, 1, '%'),
      ...typoControls({
        nameSize: 22,
        nameColor: '#ffffff',
        titleSize: 10.5,
        titleColor: '#ffffff',
        headingSize: 12,
        headingColor: '#1f3a4a',
      }),
    ],
    thumbnail: () => `
      <div class="tpl-thumb tpl-thumb-darkside">
        <div class="tt-side dark"><div class="tt-name"></div><div class="tt-block s"></div><div class="tt-block s"></div><div class="tt-block s"></div></div>
        <div class="tt-main"><div class="tt-block m"></div><div class="tt-block m"></div></div>
      </div>`,
    render: (input) => {
      const v = prepareView(input);
      const t = resolveStyle({ controls: [
        colorControl('sidebarColor', '', '#1f3a4a'),
        colorControl('sidebarTextColor', '', '#ffffff'),
        colorControl('accentColor', '', '#1f3a4a'),
        fontControl('headFont', '', 'inter'),
        fontControl('contentFont', '', 'inter'),
        rangeControl('sidebarWidth', '', 36, 28, 45, 1, '%'),
      ], }, (input && input.style) || {});
      const sw = Math.max(28, Math.min(45, Number(t.sidebarWidth) || 36));
      const css = typoVarsCss((input && input.style) || {}) + `
        @page { size: Letter; margin: 0; }
        /* Vertical padding on body (with clone) so the gradient bleeds full-page
           AND every page gets the same top/bottom space. Inner sidebar/main only
           handle horizontal padding so they don't lose top space on page 2. */
        body { font-family: var(--rx-body-font); color: var(--rx-body-color);
          font-size: var(--rx-body-size); line-height: var(--rx-line); margin: 0; min-height: 100vh;
          padding: 0.55in 0;
          -webkit-box-decoration-break: clone; box-decoration-break: clone;
          background: linear-gradient(to right,
            ${t.sidebarColor} 0%, ${t.sidebarColor} ${sw}%,
            #ffffff ${sw}%, #ffffff 100%); }
        h1, h2, h3 { font-family: var(--rx-head-font); }
        .page { display: grid; grid-template-columns: ${sw}% ${100 - sw}%; }
        .sidebar { color: ${t.sidebarTextColor}; padding: 0 0.4in; }
        .main { padding: 0 0.55in 0 0.45in; }
        .sidebar h1 { margin: 0 0 4px; font-size: var(--rx-name-size); color: var(--rx-name-color); text-align: var(--rx-name-align); font-weight: 800; line-height: 1.1; }
        .sidebar .tagline { color: var(--rx-title-color); font-size: var(--rx-title-size); text-align: var(--rx-title-align); opacity: 0.85; margin-bottom: 12px; }
        .sidebar h2 { font-size: var(--rx-head-size); text-transform: uppercase; letter-spacing: 1.6px;
          color: ${t.sidebarTextColor}; margin: 16px 0 6px; font-weight: 700;
          border-bottom: 1px solid ${t.sidebarTextColor}55; padding-bottom: 4px; }
        .sidebar .contact div { margin-bottom: 3px; font-size: 9.3pt; word-break: break-word; }
        .sidebar p { font-size: 9.7pt; }
        /* Skills grouped by category, one column wide inside the sidebar. */
        .sidebar .skill-groups { display: flex; flex-direction: column; gap: 8px; }
        .sidebar .skill-group { break-inside: avoid;
          padding-bottom: 6px; border-bottom: 1px solid ${t.sidebarTextColor}22; }
        .sidebar .skill-group:last-child { border-bottom: 0; padding-bottom: 0; }
        .sidebar .skill-group .cat { font-weight: 700; font-size: 10pt;
          color: ${t.sidebarTextColor}; margin-bottom: 2px; line-height: 1.25; }
        .sidebar .skill-group .items { font-size: 9.4pt;
          color: ${t.sidebarTextColor}; opacity: 0.92; line-height: 1.45; }
        /* Education + certifications now live in the sidebar, so their text
           must follow the (light) sidebar color rather than the dark .meta gray. */
        .sidebar .edu-item, .sidebar .cert-item { color: ${t.sidebarTextColor}; }
        .sidebar .institution, .sidebar .cert-name { font-size: 10pt; line-height: 1.3; }
        .sidebar .degree { font-size: 9.4pt; margin-top: 1px; }
        .sidebar .period, .sidebar .meta { color: ${t.sidebarTextColor};
          opacity: 0.78; font-size: 9pt; margin: 1px 0 0; }
        .main h2 { font-size: var(--rx-head-size); text-transform: uppercase; letter-spacing: 1.4px;
          color: var(--rx-head-color); margin: 12px 0 6px; font-weight: 800;
          border-bottom: 1px solid ${t.accentColor}33; padding-bottom: 4px; }
        .main h2:first-child, section:first-child h2 { margin-top: 0; }
        .main h3 { font-size: var(--rx-etitle-size); color: var(--rx-etitle-color); font-weight: 700; margin: 8px 0 1px; }
        .main .meta { color: var(--rx-emeta-color); font-size: var(--rx-emeta-size); margin-bottom: 4px; }
        h3 { font-size: 11pt; font-weight: 700; margin: 8px 0 1px; }
        .meta { color: #525a6e; font-size: 9.5pt; margin-bottom: 4px; }
        ul { margin: 4px 0 0 18px; padding: 0; } li { margin-bottom: 3px; }
        a { color: ${t.sidebarTextColor}; text-decoration: none; }
        .institution, .cert-name { font-weight: 700; }
        section { margin-bottom: var(--rx-section-gap); }
        .edu-item, .cert-item, .exp-item { margin-bottom: var(--rx-item-gap); }
        .social-icons { margin: 8px 0 12px; }
      `;
      const body = `
        <div class="page">
          <aside class="sidebar">
            <h1>${esc(v.fullName)}</h1>
            ${v.tagline ? `<div class="tagline">${esc(v.tagline)}</div>` : ''}
            ${(v.phone || v.email || v.location) ? `<section><h2>Contact</h2><div class="contact">
              ${contactBit('location', v.location, 'div')}
              ${contactBit('phone', v.phone, 'div')}
              ${contactBit('email', v.email, 'div')}
            </div></section>` : ''}
            ${socialLinks(v, t.sidebarTextColor)}
            ${v.summary ? `<section><h2>Summary</h2><p>${esc(v.summary)}</p></section>` : ''}
            ${renderSkillsGroupedGrid(v)}
            ${renderEducationList(v)}
            ${renderCertificationsList(v)}
          </aside>
          <main class="main">
            ${renderExperienceList(v)}
          </main>
        </div>
      `;
      return shell(v.fullName, css, body);
    },
  });

  // -------------------- 7) COVER BANNER --------------------

  register({
    id: 'coverBanner',
    name: 'Cover Banner',
    description: 'Tall colored banner with name overlay and a single-column body',
    controls: [
      colorControl('bannerColor', 'Banner', '#1c2540'),
      colorControl('bannerTextColor', 'Banner text', '#ffffff'),
      colorControl('accentColor', 'Accent', '#1c2540'),
      rangeControl('bannerHeight', 'Banner height', 1.6, 1.0, 2.6, 0.1, 'in'),
      fontControl('headFont', 'Heading font', 'inter'),
      fontControl('contentFont', 'Body font', 'inter'),
      ...typoControls({
        nameSize: 32,
        nameColor: '#ffffff',
        nameAlign: 'center',
        titleSize: 12,
        titleColor: '#ffffff',
        titleAlign: 'center',
        headingColor: '#1c2540',
      }),
    ],
    thumbnail: () => `
      <div class="tpl-thumb tpl-thumb-cover">
        <div class="tt-cover"><span></span></div>
        <div class="tt-row center"><span></span><span></span><span></span></div>
        <div class="tt-block m"></div><div class="tt-block m"></div>
      </div>`,
    render: (input) => {
      const v = prepareView(input);
      const t = resolveStyle({ controls: [
        colorControl('bannerColor', '', '#1c2540'),
        colorControl('bannerTextColor', '', '#ffffff'),
        colorControl('accentColor', '', '#1c2540'),
        rangeControl('bannerHeight', '', 1.6, 1.0, 2.6, 0.1, 'in'),
        fontControl('headFont', '', 'inter'),
        fontControl('contentFont', '', 'inter'),
      ], }, (input && input.style) || {});
      const bh = Math.max(1.0, Math.min(2.6, Number(t.bannerHeight) || 1.6));
      const contactRow = contactItems(v)
        .map((it) => contactBit(it.kind, it.value, 'span'))
        .join('<span class="dot">&middot;</span>');
      const css = typoVarsCss((input && input.style) || {}) + `
        @page { size: Letter; margin: 0; }
        body { font-family: var(--rx-body-font); color: var(--rx-body-color);
          font-size: var(--rx-body-size); line-height: var(--rx-line); margin: 0;
          padding: 0.4in 0;
          -webkit-box-decoration-break: clone; box-decoration-break: clone; }
        h1, h2, h3 { font-family: var(--rx-head-font); }
        /* Cover bleeds edge-to-edge on page 1 by cancelling body's top padding. */
        .cover { height: ${bh}in; background: linear-gradient(135deg, ${t.bannerColor}, ${t.bannerColor}cc),
          radial-gradient(circle at 80% 30%, ${t.bannerTextColor}22 0%, transparent 50%);
          color: ${t.bannerTextColor}; display: flex; flex-direction: column;
          justify-content: center; align-items: center; text-align: center;
          padding: 0 0.6in; margin: -0.4in 0 0; }
        .cover h1 { margin: 0 0 6px; font-size: var(--rx-name-size); color: var(--rx-name-color); text-align: var(--rx-name-align); font-weight: 800; letter-spacing: 0.5px; }
        .cover .tagline { font-size: var(--rx-title-size); color: var(--rx-title-color); text-align: var(--rx-title-align); opacity: 0.92; }
        .contacts-row { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px;
          padding: 12px 0.55in; border-bottom: 1px solid #e5e7ea; color: #475066; font-size: 10pt; }
        .contacts-row .contact-bit { display: inline-flex; align-items: center; }
        .contacts-row .dot { opacity: 0.5; }
        /* Horizontal padding only; vertical comes from body. */
        .content { padding: 0.4in 0.6in 0; }
        h2 { font-size: var(--rx-head-size); text-transform: uppercase; letter-spacing: 1.4px;
          color: var(--rx-head-color); margin: 14px 0 6px; font-weight: 800;
          border-bottom: 1px solid ${t.accentColor}33; padding-bottom: 4px; }
        h2:first-child, section:first-child h2 { margin-top: 0; }
        h3 { font-size: var(--rx-etitle-size); color: var(--rx-etitle-color); font-weight: 700; margin: 8px 0 1px; }
        .meta { color: var(--rx-emeta-color); font-size: var(--rx-emeta-size); margin-bottom: 4px; }
        ul { margin: 4px 0 0 18px; padding: 0; } li { margin-bottom: 3px; }
        a { color: ${t.accentColor}; text-decoration: none; }
        .institution, .cert-name { font-weight: 700; }
        section { margin-bottom: var(--rx-section-gap); }
        .edu-item, .cert-item, .exp-item { margin-bottom: var(--rx-item-gap); }
        .skill-block { margin: 4px 0 6px; } .skill-block .cat { font-weight: 700; }
      `;
      const body = `
        <div class="cover">
          <h1>${esc(v.fullName)}</h1>
          ${v.tagline ? `<div class="tagline">${esc(v.tagline)}</div>` : ''}
        </div>
        <div class="contacts-row">${contactRow}${socialLinks(v, t.accentColor)}</div>
        <div class="content">
          ${v.summary ? `<section><h2>Summary</h2><p>${esc(v.summary)}</p></section>` : ''}
          ${renderExperienceList(v)}
          ${renderEducationList(v)}
          ${renderSkillsInline(v)}
          ${renderCertificationsList(v)}
        </div>
      `;
      return shell(v.fullName, css, body);
    },
  });

  // ---------- Public API ----------

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
    register,
  };
  window.App.Fonts = Fonts;
})();
