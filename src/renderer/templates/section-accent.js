// Section Accent: section headings styled as pills, bars, rules or boxes.
(function () {
  const {
    colorControl, rangeControl, selectControl, registerSingleColumn,
  } = window.App.TemplateKit;

  registerSingleColumn({
    id: 'sectionAccent',
    name: 'Section Accent',
    description: 'Classic layout with bold styled section headings',
    accent: '#7c3aed',
    typo: { headingColor: '#ffffff' },
    controls: [
      selectControl('headingStyle', 'Heading style', [
        { value: 'pill', label: 'Filled pill' },
        { value: 'leftBar', label: 'Left bar' },
        { value: 'underline', label: 'Underline' },
        { value: 'rule', label: 'Trailing rule' },
        { value: 'boxed', label: 'Boxed' },
      ], 'pill', 'Section headings'),
      colorControl('headingFill', 'Accent fill', '#7c3aed', 'Section headings'),
      rangeControl('headingLetterSpacing', 'Letter spacing', 1.4, 0, 4, 0.1, 'px', 'Section headings'),
      rangeControl('dividerWidth', 'Line thickness', 2, 1, 6, 0.5, 'px', 'Section headings'),
    ],
    css: (t) => {
      const d = Number(t.dividerWidth) || 2;
      const fill = t.headingFill;
      const styles = {
        pill: `display: inline-block; background: ${fill}; padding: 3px 12px; border-radius: 999px;`,
        leftBar: `border-left: ${d + 2}px solid ${fill}; background: ${fill}14; padding: 3px 0 3px 8px;`,
        underline: `border-bottom: ${d}px solid ${fill}; padding-bottom: 4px;`,
        rule: 'display: flex; align-items: center; gap: 10px;',
        boxed: `border: ${d}px solid ${fill}; padding: 3px 8px;`,
      };
      return `
        h2 { border: none; padding: 0; letter-spacing: ${Number(t.headingLetterSpacing) || 0}px;
          ${styles[t.headingStyle] || styles.pill} }
        ${t.headingStyle === 'rule' ? `h2::after { content: ''; flex: 1; border-bottom: ${d}px solid ${fill}; }` : ''}
      `;
    },
    thumbnail: () => `
      <div class="tpl-thumb">
        <div class="tt-name"></div><div class="tt-tag"></div>
        <div style="width:40%;height:7px;border-radius:4px;background:#7c3aed;margin-bottom:5px"></div>
        <div class="tt-block s"></div>
        <div style="width:40%;height:7px;border-radius:4px;background:#7c3aed;margin-bottom:5px"></div>
        <div class="tt-block m"></div>
      </div>`,
  });
})();
