// Skill Chips: skills and per-role technologies rendered as tags.
(function () {
  const {
    esc, flattenSkills, colorControl, selectControl, registerSingleColumn, thumbBody, renderTechnologies,
  } = window.App.TemplateKit;

  function chipHtml(item) {
    return `<span class="chip">${esc(item)}</span>`;
  }

  registerSingleColumn({
    id: 'skillChips',
    name: 'Skill Chips',
    description: 'Classic layout with skills and technologies as tags',
    accent: '#0369a1',
    controls: [
      selectControl('chipShape', 'Chip shape', [
        { value: 'pill', label: 'Pill' },
        { value: 'rounded', label: 'Rounded' },
        { value: 'square', label: 'Square' },
      ], 'pill', 'Chips'),
      selectControl('chipFill', 'Chip fill', [
        { value: 'tint', label: 'Soft tint' },
        { value: 'solid', label: 'Solid' },
        { value: 'outline', label: 'Outline' },
      ], 'tint', 'Chips'),
      colorControl('chipColor', 'Chip color', '#0369a1', 'Chips'),
      colorControl('chipTextColor', 'Solid chip text', '#ffffff', 'Chips'),
      selectControl('techChips', 'Technologies', [
        { value: 'on', label: 'As chips' },
        { value: 'off', label: 'Plain text' },
      ], 'on', 'Chips'),
    ],
    skills: (v) => {
      const flat = flattenSkills(v.skills);
      if (!flat.length) return '';
      const rows = flat.map((s) => `
        <div class="chip-row">
          <span class="cat">${esc(s.category)}</span>
          <span class="chips">${s.items.map(chipHtml).join('')}</span>
        </div>`).join('');
      return `<section><h2>Skills</h2>${rows}</section>`;
    },
    tech: (e, t) => {
      if (t.techChips === 'off' || !e.technologies.length) return renderTechnologies(e);
      return `<div class="tech-chips"><strong>Technologies:</strong> <span class="chips">${e.technologies.map(chipHtml).join('')}</span></div>`;
    },
    css: (t) => {
      const radius = { pill: '999px', rounded: '4px', square: '0' }[t.chipShape] || '999px';
      const c = t.chipColor;
      const fill = {
        solid: `background: ${c}; color: ${t.chipTextColor}; border: 1px solid ${c};`,
        outline: `background: transparent; color: ${c}; border: 1px solid ${c};`,
        tint: `background: ${c}1f; color: ${c}; border: 1px solid ${c}33;`,
      }[t.chipFill] || '';
      return `
        .chip-row { display: flex; gap: 10px; align-items: baseline; margin: 4px 0; }
        .chip-row .cat { min-width: 120px; font-weight: 700; color: var(--rx-skill-category-color); }
        .chips { display: inline-flex; flex-wrap: wrap; gap: 4px; }
        .chip { padding: 0 8px; font-size: 0.9em; line-height: 1.6; border-radius: ${radius}; ${fill} }
        .tech-chips { display: flex; gap: 6px; align-items: baseline; margin: 4px 0; }
      `;
    },
    thumbnail: () => `
      <div class="tpl-thumb">
        <div class="tt-name"></div><div class="tt-tag"></div>
        <div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:8px">
          ${'<span style="width:18%;height:6px;border-radius:4px;background:#bae6fd"></span>'.repeat(5)}
        </div>
        ${thumbBody('<div class="tt-block m"></div><div class="tt-block m"></div>')}
      </div>`,
  });
})();
