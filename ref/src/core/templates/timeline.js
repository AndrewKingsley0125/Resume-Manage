// Timeline: experience entries hang off a vertical line with a dot per role.
(function () {
  const {
    colorControl, rangeControl, selectControl, registerSingleColumn,
  } = window.App.TemplateKit;

  const DOT_SHAPES = {
    circle: 'border-radius: 50%;',
    square: 'border-radius: 2px;',
    diamond: 'border-radius: 1px; transform: rotate(45deg) scale(0.85);',
    hollow: 'border-radius: 50%; background: #fff !important; border: 2px solid currentColor;',
  };

  registerSingleColumn({
    id: 'timeline',
    name: 'Timeline',
    description: 'Classic layout with experience on a vertical timeline',
    accent: '#0f766e',
    entry: { periodPosition: 'titleRight' },
    page: { periodBadge: 'on', bulletColor: '#0f766e' },
    controls: [
      colorControl('timelineColor', 'Line color', '#0f766e', 'Timeline'),
      selectControl('dotShape', 'Dot shape', [
        { value: 'circle', label: 'Circle' },
        { value: 'square', label: 'Square' },
        { value: 'diamond', label: 'Diamond' },
        { value: 'hollow', label: 'Hollow' },
      ], 'circle', 'Timeline'),
      selectControl('lineStyle', 'Line style', [
        { value: 'solid', label: 'Solid' },
        { value: 'dashed', label: 'Dashed' },
        { value: 'dotted', label: 'Dotted' },
      ], 'solid', 'Timeline'),
      rangeControl('lineWidth', 'Line width', 2, 1, 5, 0.5, 'px', 'Timeline'),
    ],
    css: (t) => {
      const w = Number(t.lineWidth) || 2;
      const dot = 10;
      return `
        .exp-item { position: relative; margin: 0 0 0 ${dot / 2}px; padding: 0 0 var(--rx-item-gap) 18px;
          border-left: ${w}px ${t.lineStyle} ${t.timelineColor}; }
        .exp-item:last-child { border-left-color: transparent; }
        .exp-item h3 { margin-top: 0; }
        .exp-item::before { content: ''; position: absolute; top: 4px; left: ${-(dot + w) / 2}px;
          width: ${dot}px; height: ${dot}px; box-sizing: border-box;
          background: ${t.timelineColor}; color: ${t.timelineColor}; ${DOT_SHAPES[t.dotShape] || DOT_SHAPES.circle} }
      `;
    },
    thumbnail: () => `
      <div class="tpl-thumb">
        <div class="tt-name"></div><div class="tt-tag"></div>
        <div style="border-left:2px solid #0f766e;margin-left:3px;padding-left:8px">
          <div class="tt-block s" style="position:relative"><i style="position:absolute;left:-13px;top:2px;width:8px;height:8px;border-radius:50%;background:#0f766e"></i></div>
          <div class="tt-block s" style="position:relative"><i style="position:absolute;left:-13px;top:2px;width:8px;height:8px;border-radius:50%;background:#0f766e"></i></div>
          <div class="tt-block s" style="position:relative"><i style="position:absolute;left:-13px;top:2px;width:8px;height:8px;border-radius:50%;background:#0f766e"></i></div>
        </div>
      </div>`,
  });
})();
