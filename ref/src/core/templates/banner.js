// Banner Header: name, title and contacts in a colored band.
(function () {
  const {
    esc, colorControl, rangeControl, selectControl, registerSingleColumn, thumbBody, contactRowHtml,
  } = window.App.TemplateKit;

  registerSingleColumn({
    id: 'banner',
    name: 'Banner Header',
    description: 'Classic body under a full-width colored header band',
    accent: '#1e3a8a',
    typo: { nameColor: '#ffffff', titleColor: '#dbe4ff' },
    controls: [
      colorControl('bannerColor', 'Banner color', '#1e3a8a', 'Banner'),
      colorControl('bannerTextColor', 'Contact text', '#e0e7ff', 'Banner'),
      rangeControl('bannerPadding', 'Padding', 18, 8, 40, 1, 'px', 'Banner'),
      selectControl('bannerShape', 'Shape', [
        { value: 'flat', label: 'Flat' },
        { value: 'rounded', label: 'Rounded' },
        { value: 'angled', label: 'Angled edge' },
      ], 'rounded', 'Banner'),
      selectControl('bannerContact', 'Contact row', [
        { value: 'inside', label: 'Inside banner' },
        { value: 'below', label: 'Below banner' },
      ], 'inside', 'Banner'),
    ],
    header: (v, t) => {
      const inside = t.bannerContact !== 'below';
      return `
        <header class="banner">
          <h1>${esc(v.fullName)}</h1>
          ${v.tagline ? `<div class="tagline">${esc(v.tagline)}</div>` : ''}
          ${inside ? contactRowHtml(v, t.bannerTextColor) : ''}
        </header>
        ${inside ? '' : contactRowHtml(v, t.accentColor)}`;
    },
    css: (t) => {
      const p = Number(t.bannerPadding) || 18;
      const angled = t.bannerShape === 'angled';
      return `
        .banner { background: ${t.bannerColor}; padding: ${p}px ${p + 6}px ${angled ? p + 14 : p}px;
          margin-bottom: 14px; border-radius: ${t.bannerShape === 'rounded' ? '10px' : '0'};
          ${angled ? 'clip-path: polygon(0 0, 100% 0, 100% calc(100% - 14px), 0 100%);' : ''} }
        .banner .tagline { margin-bottom: 0; }
        .banner .contact-row { color: ${t.bannerTextColor}; border-bottom: none; margin: 10px 0 0; padding: 0; }
      `;
    },
    thumbnail: () => `
      <div class="tpl-thumb">
        <div style="background:#1e3a8a;border-radius:3px;padding:6px;margin-bottom:8px">
          <div class="tt-name" style="background:#fff"></div><div class="tt-tag" style="background:#a5b4fc;margin-bottom:0"></div>
        </div>
        ${thumbBody()}
      </div>`,
  });
})();
