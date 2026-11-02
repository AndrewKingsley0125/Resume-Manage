// Accent Rail: colored page-edge stripe with an initials badge.
(function () {
  const {
    esc, colorControl, rangeControl, selectControl, registerSingleColumn, thumbBody, ON_OFF_OPTS, contactRowHtml,
  } = window.App.TemplateKit;

  registerSingleColumn({
    id: 'accentRail',
    name: 'Accent Rail',
    description: 'Classic layout with a colored page-edge stripe and initials badge',
    accent: '#be123c',
    controls: [
      colorControl('railColor', 'Rail color', '#be123c', 'Rail'),
      rangeControl('railWidth', 'Rail width', 6, 2, 20, 1, 'px', 'Rail'),
      selectControl('railSide', 'Rail side', [
        { value: 'left', label: 'Left' },
        { value: 'right', label: 'Right' },
      ], 'left', 'Rail'),
      selectControl('railInitials', 'Initials', ON_OFF_OPTS, 'on', 'Rail'),
      selectControl('railCircle', 'Initials style', [
        { value: 'filled', label: 'Filled' },
        { value: 'outline', label: 'Outline' },
      ], 'filled', 'Rail'),
    ],
    header: (v, t) => `
      <div class="rail"></div>
      <div class="rail-head">
        ${t.railInitials === 'on' ? `<div class="initials">${esc(v.initials)}</div>` : ''}
        <div class="rail-name">
          <h1>${esc(v.fullName)}</h1>
          ${v.tagline ? `<div class="tagline">${esc(v.tagline)}</div>` : ''}
        </div>
      </div>
      ${contactRowHtml(v, t.accentColor)}`,
    css: (t) => {
      const w = Number(t.railWidth) || 6;
      const side = t.railSide === 'right' ? 'right' : 'left';
      const filled = t.railCircle !== 'outline';
      return `
        body { padding-${side}: ${w + 14}px; }
        .rail { position: fixed; top: 0; bottom: 0; ${side}: 0; width: ${w}px; background: ${t.railColor}; }
        .rail-head { display: flex; align-items: center; gap: 14px; margin-bottom: 8px; }
        .rail-name { flex: 1; } .rail-name h1 { margin: 0; } .rail-name .tagline { margin: 2px 0 0; }
        .initials { width: 54px; height: 54px; border-radius: 50%; flex-shrink: 0; display: flex;
          align-items: center; justify-content: center; font-family: var(--rx-head-font); font-weight: 800; font-size: 18pt;
          ${filled ? `background: ${t.railColor}; color: #fff;` : `border: 2px solid ${t.railColor}; color: ${t.railColor};`} }
      `;
    },
    thumbnail: () => `
      <div class="tpl-thumb" style="border-left:4px solid #be123c">
        <div style="display:flex;gap:5px;align-items:center;margin-bottom:8px">
          <span style="width:14px;height:14px;border-radius:50%;background:#be123c;flex-shrink:0"></span>
          <div style="flex:1"><div class="tt-name" style="width:70%"></div><div class="tt-tag" style="width:50%;margin-bottom:0"></div></div>
        </div>
        ${thumbBody()}
      </div>`,
  });
})();
