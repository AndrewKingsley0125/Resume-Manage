/*
 * Insights for Manage process: how many applications were made per day, week or month, for one
 * profile or every profile, as columns that grow into place.
 *
 *   window.App.ProcessChart.render(container, {series, profileId})
 *     series: [{id, name, slot, rows:[{date}, ...]}, ...]  (slot: the profile's fixed colour slot)
 *
 * Form: change over time per period -> a column chart; one series for one profile, stacked
 * columns (one colour per profile, by its fixed slot, never by rank) for all profiles. Header
 * figures, a hover tooltip on every column, a legend for 2+ series, and a table view of the
 * same numbers. Colours come from the --viz-* settings in tailwind.src.css.
 */
(function () {
  const make = (tag, className, text) => {const node = document.createElement(tag);if (className) node.className = className;if (text != null) node.textContent = text;return node;};
  const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SLOTS = 8;
  const RANGES = {day:14, week:12, month:12};
  const UNIT_LABEL = {day:'day', week:'week', month:'month'};
  // The latest period, and the one before it, in words.
  const NOW_LABEL = {day:'Today', week:'This week', month:'This month'};
  const BEFORE_LABEL = {day:'yesterday', week:'last week', month:'last month'};
  const state = {unit:'week', scope:'profile', view:'chart'};

  // ---------- Periods ----------
  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const startOfWeek = d => {const day = startOfDay(d);const back = (day.getDay() + 6) % 7;day.setDate(day.getDate() - back);return day;};  // weeks start Monday
  const startOfMonth = d => new Date(d.getFullYear(), d.getMonth(), 1);
  const START = {day:startOfDay, week:startOfWeek, month:startOfMonth};
  function step(d, unit, n) {
    const next = new Date(d);
    if (unit === 'day') next.setDate(next.getDate() + n);
    else if (unit === 'week') next.setDate(next.getDate() + 7 * n);
    else next.setMonth(next.getMonth() + n);
    return next;
  }
  function periods(unit) {
    const last = START[unit](new Date());
    const list = [];
    for (let i = RANGES[unit] - 1; i >= 0; i--) list.push(step(last, unit, -i));
    return list;
  }
  const short = {month:'short'};
  function tickLabel(d, unit, index) {
    if (unit === 'month') return d.toLocaleDateString(undefined, d.getMonth() === 0 || index === 0 ? {month:'short', year:'2-digit'} : short);
    return d.toLocaleDateString(undefined, {month:'short', day:'numeric'});
  }
  function longLabel(d, unit) {
    if (unit === 'day') return d.toLocaleDateString(undefined, {weekday:'short', month:'short', day:'numeric', year:'numeric'});
    if (unit === 'week') {const end = step(d, 'day', 6);return `Week of ${d.toLocaleDateString(undefined, {month:'short', day:'numeric'})} – ${end.toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'})}`;}
    return d.toLocaleDateString(undefined, {month:'long', year:'numeric'});
  }

  // Counts per period and series: [{start, label, total, parts:[{series, count}]}]
  function bucket(series, unit) {
    const list = periods(unit);
    const index = new Map(list.map((d, i) => [d.getTime(), i]));
    const counts = list.map(() => series.map(() => 0));
    series.forEach((one, s) => {
      for (const row of one.rows) {
        if (!row.date) continue;
        const i = index.get(START[unit](new Date(row.date)).getTime());
        if (i != null) counts[i][s] += 1;
      }
    });
    return list.map((start, i) => ({start, label:tickLabel(start, unit, i), total:counts[i].reduce((a, b) => a + b, 0),
      parts:series.map((one, s) => ({series:one, count:counts[i][s]}))}));
  }
  // Clean axis ticks: 0 and three or four round steps up to just above the highest column.
  function ticks(max) {
    if (max <= 0) return [0, 1];
    const rough = max / 4, pow = Math.pow(10, Math.floor(Math.log10(rough)));
    const unit = [1, 2, 5, 10].map(m => m * pow).find(m => m >= rough) || pow * 10;
    const top = Math.max(unit, Math.ceil(max / unit) * unit);
    const list = [];for (let v = 0; v <= top + 1e-9; v += unit) list.push(Math.round(v));
    return list;
  }
  const format = n => n.toLocaleString();

  // ---------- Header figures ----------
  function figure(label, value, extra) {
    const tile = make('div', 'viz-tile flex min-w-0 flex-col gap-1 rounded-xl border border-line bg-elev px-4 py-3');
    tile.append(make('span', 'text-xs font-medium text-muted', label));
    const big = make('span', 'viz-figure text-[26px] font-semibold leading-none text-ink', '0');
    big.dataset.value = String(value.number);big.dataset.decimals = String(value.decimals || 0);
    if (value.text) big.textContent = value.text;
    tile.append(big);
    if (extra) tile.append(extra);
    return tile;
  }
  // Numbers count up to their value.
  function countUp(root) {
    root.querySelectorAll('.viz-figure[data-value]').forEach(node => {
      if (node.textContent && node.textContent !== '0' && isNaN(Number(node.textContent.replace(/,/g, '')))) return;
      const target = Number(node.dataset.value), decimals = Number(node.dataset.decimals) || 0;
      const show = v => {node.textContent = decimals ? v.toFixed(decimals) : format(Math.round(v));};
      if (calm() || !target) {show(target);return;}
      const start = performance.now(), ms = 700;
      const tick = now => {const t = Math.min(1, (now - start) / ms);show(target * (1 - Math.pow(1 - t, 3)));if (t < 1) requestAnimationFrame(tick);};
      requestAnimationFrame(tick);
    });
  }
  function figures(data, unit) {
    const row = make('div', 'viz-figures grid grid-cols-4 gap-3 max-[760px]:grid-cols-2');
    const total = data.reduce((a, p) => a + p.total, 0);
    const now = data[data.length - 1], before = data[data.length - 2];
    const delta = now.total - (before ? before.total : 0);
    const change = make('span', `inline-flex items-center gap-1 text-xs font-medium ${delta > 0 ? 'text-lz-success' : delta < 0 ? 'text-lz-danger' : 'text-muted'}`);
    change.append(make('span', 'text-[10px]', delta > 0 ? '▲' : delta < 0 ? '▼' : '•'), document.createTextNode(`${delta > 0 ? '+' : ''}${delta} vs ${BEFORE_LABEL[unit]}`));
    const best = data.reduce((a, p) => p.total > a.total ? p : a, data[0]);
    row.append(
      figure(`Applications, last ${data.length} ${UNIT_LABEL[unit]}s`, {number:total}),
      figure(NOW_LABEL[unit], {number:now.total}, change),
      figure(`Average per ${UNIT_LABEL[unit]}`, {number:total / data.length, decimals:1}),
      figure(`Best ${UNIT_LABEL[unit]}`, {number:best.total}, make('span', 'truncate text-xs text-muted', best.total ? longLabel(best.start, unit) : 'None yet')),
    );
    return row;
  }

  // ---------- The chart ----------
  const swatch = slot => make('span', `viz-swatch inline-block h-2.5 w-2.5 flex-none rounded-[3px] viz-bg-${slot}`);
  function legend(series) {
    const list = make('div', 'viz-legend flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted');
    for (const one of series) {const item = make('span', 'inline-flex items-center gap-1.5');item.append(swatch(one.slot), make('span', 'text-ink', one.name));list.append(item);}
    return list;
  }
  function chart(data, series, unit, stacked) {
    const box = make('div', 'viz-chart relative select-none');
    const values = ticks(Math.max(...data.map(p => p.total)));
    const top = values[values.length - 1];
    const plot = make('div', 'viz-plot relative ml-9 h-[260px] border-b border-line');
    // Hairline gridlines and their round values
    for (const v of values) {
      const y = (v / top) * 100;
      const line = make('div', `absolute inset-x-0 ${v === 0 ? '' : 'border-t border-line'}`);line.style.bottom = `${y}%`;
      const label = make('span', 'absolute -left-9 w-7 -translate-y-1/2 text-right text-[11px] tabular-nums text-muted', format(v));label.style.bottom = `calc(${y}% - 0.5em)`;label.style.transform = 'none';
      plot.append(line, label);
    }
    const columns = make('div', 'viz-columns absolute inset-0 flex items-end');
    const tip = make('div', 'viz-tip pointer-events-none absolute z-10 hidden min-w-[180px] rounded-xl border border-line bg-elev px-3 py-2.5 text-xs shadow-[0_12px_32px_-8px_rgba(0,0,0,0.35)]');
    const reduce = calm();
    data.forEach((period, i) => {
      // Each period's whole slot is its hit target, wider than its column.
      const slot = make('div', 'viz-slot group relative flex h-full flex-1 items-end justify-center');
      slot.tabIndex = 0;slot.setAttribute('role', 'img');
      slot.setAttribute('aria-label', `${longLabel(period.start, unit)}: ${period.total} application${period.total === 1 ? '' : 's'}`);
      const col = make('div', 'viz-col flex w-[min(24px,60%)] flex-col-reverse gap-[2px] transition-opacity duration-150');
      col.style.height = `${(period.total / top) * 100}%`;
      const parts = stacked ? period.parts.filter(p => p.count) : [{series:series[0], count:period.total}];
      parts.forEach((part, k) => {
        const seg = make('div', `viz-seg viz-bg-${part.series.slot} min-h-[2px] w-full${k === parts.length - 1 ? ' rounded-t-[4px]' : ''}`);
        seg.style.flex = `${part.count} 1 0`;
        col.append(seg);
      });
      if (period.total) {
        // Grows from the baseline, one column after another.
        if (!reduce) {col.style.transformOrigin = 'bottom';col.style.transform = 'scaleY(0)';col.style.transition = `transform 700ms cubic-bezier(0.2, 0.8, 0.2, 1) ${i * 40}ms, opacity 150ms`;}
        slot.append(col);
      }
      const show = () => {
        columns.querySelectorAll('.viz-col').forEach(other => {other.style.opacity = other.parentElement === slot ? '1' : '0.45';});
        tip.replaceChildren(make('div', 'mb-1.5 font-semibold text-ink', longLabel(period.start, unit)));
        const total = make('div', 'flex items-baseline justify-between gap-4 text-muted');total.append(make('span', '', 'Applications'), make('span', 'text-[15px] font-semibold tabular-nums text-ink', format(period.total)));
        tip.append(total);
        if (stacked && period.total) for (const part of period.parts.filter(p => p.count)) {
          const line = make('div', 'mt-1 flex items-center justify-between gap-4');
          const who = make('span', 'inline-flex min-w-0 items-center gap-1.5 text-muted');who.append(swatch(part.series.slot), make('span', 'truncate', part.series.name));
          line.append(who, make('span', 'tabular-nums text-ink', format(part.count)));tip.append(line);
        }
        tip.classList.remove('hidden');
        const left = slot.offsetLeft + slot.offsetWidth / 2, width = tip.offsetWidth, room = plot.offsetWidth;
        tip.style.left = `${Math.max(0, Math.min(room - width, left - width / 2))}px`;
        tip.style.bottom = `${Math.min(100, (period.total / top) * 100)}%`;tip.style.marginBottom = '10px';
      };
      const hide = () => {columns.querySelectorAll('.viz-col').forEach(other => {other.style.opacity = '';});tip.classList.add('hidden');};
      slot.addEventListener('mouseenter', show);slot.addEventListener('focus', show);
      slot.addEventListener('mouseleave', hide);slot.addEventListener('blur', hide);
      columns.append(slot);
    });
    plot.append(columns, tip);
    // Period labels, every other one when they would crowd.
    const axis = make('div', 'viz-axis ml-9 mt-2 flex');
    const every = data.length > 12 ? 2 : 1;
    data.forEach((period, i) => axis.append(make('span', 'flex-1 truncate text-center text-[11px] text-muted', (data.length - 1 - i) % every === 0 ? period.label : '')));
    box.append(plot, axis);
    if (!reduce) requestAnimationFrame(() => requestAnimationFrame(() => columns.querySelectorAll('.viz-col').forEach(col => {col.style.transform = 'scaleY(1)';})));
    return box;
  }
  function table(data, series, unit, stacked) {
    const wrap = make('div', 'viz-table max-h-[300px] overflow-auto rounded-xl border border-line');
    const t = make('table', 'w-full border-collapse text-[13px]');
    const head = make('tr');
    const th = (text, right) => make('th', `sticky top-0 border-b border-line bg-elev2 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.5px] text-muted ${right ? 'text-right' : 'text-left'}`, text);
    head.append(th(UNIT_LABEL[unit]));
    if (stacked) for (const one of series) head.append(th(one.name, true));
    head.append(th('Total', true));
    const thead = make('thead');thead.append(head);
    const body = make('tbody');
    data.slice().reverse().forEach(period => {
      const tr = make('tr', 'hover:bg-hover');
      tr.append(make('td', 'border-b border-line px-3 py-2', longLabel(period.start, unit)));
      if (stacked) for (const part of period.parts) tr.append(make('td', 'border-b border-line px-3 py-2 text-right tabular-nums', format(part.count)));
      tr.append(make('td', 'border-b border-line px-3 py-2 text-right font-semibold tabular-nums', format(period.total)));
      body.append(tr);
    });
    t.append(thead, body);wrap.append(t);
    return wrap;
  }

  // ---------- Controls ----------
  function segmented(name, options, value, onPick) {
    const group = make('div', `viz-${name} inline-flex rounded-xl border border-line bg-bg p-1`);group.setAttribute('role', 'radiogroup');
    for (const [key, label] of options) {
      const button = make('button', 'cursor-pointer rounded-lg border-0 bg-transparent px-3 py-1 text-[13px] font-semibold text-muted transition-colors hover:text-ink aria-checked:bg-elev aria-checked:text-ink aria-checked:shadow-[0_1px_3px_rgba(0,0,0,0.15)]', label);
      button.type = 'button';button.setAttribute('role', 'radio');button.dataset.value = key;button.setAttribute('aria-checked', String(key === value));
      button.addEventListener('click', () => onPick(key));
      group.append(button);
    }
    return group;
  }

  function render(container, options) {
    const all = (options.series || []).filter(one => one.rows);
    const draw = () => {
      const stacked = state.scope === 'all';
      // Up to eight profiles keep their own colour; more fold into "Other".
      let series = stacked ? all : all.filter(one => one.id === options.profileId);
      if (!series.length) series = all.slice(0, 1);
      if (stacked && series.length > SLOTS) {
        const kept = series.filter(one => one.slot < SLOTS - 1);
        series = [...kept, {id:'other', name:'Other', slot:SLOTS - 1, rows:series.filter(one => one.slot >= SLOTS - 1).flatMap(one => one.rows)}];
      }
      const data = bucket(series, state.unit);
      const controls = make('div', 'viz-controls flex flex-wrap items-center gap-2');
      controls.append(
        segmented('unit', [['day', 'Day'], ['week', 'Week'], ['month', 'Month']], state.unit, v => {state.unit = v;draw();}),
        segmented('scope', [['profile', 'This profile'], ['all', 'All profiles']], state.scope, v => {state.scope = v;draw();}),
        make('span', 'flex-1'),
        segmented('view', [['chart', 'Chart'], ['table', 'Table']], state.view, v => {state.view = v;draw();}),
      );
      const card = make('div', 'viz-card flex flex-col gap-4 rounded-2xl border border-line bg-elev p-5');
      const title = make('div', 'flex flex-wrap items-baseline justify-between gap-2');
      title.append(make('h3', 'm-0 text-[15px] font-semibold text-ink', `Applications per ${UNIT_LABEL[state.unit]}`),
        make('span', 'text-xs text-muted', stacked ? 'All profiles' : series[0] ? series[0].name : ''));
      card.append(title);
      if (stacked && series.length > 1) card.append(legend(series.filter(one => data.some(p => p.parts.find(part => part.series === one && part.count)))));
      card.append(state.view === 'table' ? table(data, series, state.unit, stacked) : chart(data, series, state.unit, stacked));
      container.replaceChildren(controls, figures(data, state.unit), card);
      countUp(container);
    };
    draw();
  }

  window.App = window.App || {};
  window.App.ProcessChart = {render};
})();
