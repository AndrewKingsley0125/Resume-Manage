/*
 * The profile list's overview: a summary strip across every profile, and each profile card's
 * details (role, mode, template, this week's applications with an 8-week sparkline, live Auto
 * apply status, last applied). Read-only: it reads the Auto apply jobs and each profile's save
 * folder, and changes nothing.
 *
 *   window.App.HomeOverview.tileBody(profile)   -> the card's details (filled in by refresh)
 *   window.App.HomeOverview.refresh(profiles, {onOpen, onProcess})
 */
(function () {
  const make = (tag, className, text) => {const node = document.createElement(tag);if (className) node.className = className;if (text != null) node.textContent = text;return node;};
  const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const WEEKS = 8;
  let token = 0;

  // ---------- Numbers ----------
  const startOfWeek = d => {const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());day.setDate(day.getDate() - (day.getDay() + 6) % 7);return day;};
  const startOfMonth = d => new Date(d.getFullYear(), d.getMonth(), 1);
  function ago(time) {
    const days = Math.floor((startOfDay(new Date()) - startOfDay(new Date(time))) / 864e5);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) return `${Math.round(days / 7)} week${Math.round(days / 7) === 1 ? '' : 's'} ago`;
    return new Date(time).toLocaleDateString(undefined, {month:'short', day:'numeric'});
  }
  function startOfDay(d) {return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();}
  // An open Auto apply job is waiting on you (a blocker, a failed step, a resume or form to
  // check, or work stalled with Chrome offline), or in progress: the board's own split.
  function liveCounts(state, profileId) {
    const counts = {progress:0, waiting:0};
    if (!state) return counts;
    const online = job => state.connections.some(c => c.id === job.connectionId && c.connected);
    for (const job of state.jobs.filter(item => item.profileId === profileId && !['completed', 'unlinked'].includes(item.status))) {
      const progress = job.progress || {}, busy = progress.level === 'busy' || (job.commands || []).length > 0;
      const waiting = !!job.failure || !!job.error || progress.level === 'attention' || progress.key === 'confirm-resume'
        || (job.status === 'filled' && !busy) || (!online(job) && busy);
      counts[waiting ? 'waiting' : 'progress'] += 1;
    }
    return counts;
  }
  function statsFor(profile, rows, state) {
    const now = new Date(), thisWeek = startOfWeek(now), month = startOfMonth(now).getTime();
    const weeks = Array.from({length:WEEKS}, (_, i) => {const d = new Date(thisWeek);d.setDate(d.getDate() - 7 * (WEEKS - 1 - i));return {start:d.getTime(), count:0};});
    let last = 0, thisMonth = 0;
    for (const row of rows) {
      if (!row.date) continue;
      last = Math.max(last, row.date);
      if (row.date >= month) thisMonth += 1;
      const w = startOfWeek(new Date(row.date)).getTime();
      const slot = weeks.find(item => item.start === w);
      if (slot) slot.count += 1;
    }
    return {weeks, thisWeek:weeks[WEEKS - 1].count, lastWeek:weeks[WEEKS - 2].count, thisMonth, last, ...liveCounts(state, profile.id),
      auto:profile.applicationMode === 'extension', hasFolder:!!(profile.saveFolder || '').trim()};
  }

  // ---------- A profile card's details ----------
  function tileBody(profile) {
    const body = make('div', 'tile-body flex w-full min-w-0 flex-col gap-3');
    body.dataset.profile = profile.id;
    const badges = make('div', 'flex min-w-0 flex-wrap items-center gap-1.5');
    const auto = profile.applicationMode === 'extension';
    badges.append(make('span', `tile-mode inline-flex rounded-[3px] px-1 text-[11px] font-bold uppercase leading-4 tracking-[0.02em] ${auto ? 'bg-lz-info-bg text-lz-info' : 'bg-lz-neutral-bg text-lz-neutral'}`, auto ? 'Auto' : 'Manual'));
    const tpl = window.App.Templates && window.App.Templates.get(profile.templateId || 'classic');
    badges.append(make('span', 'truncate text-xs text-muted', `${tpl ? tpl.name : 'Classic'} template`));
    const stats = make('div', 'tile-stats flex min-h-[64px] items-end justify-between gap-3 border-t border-line pt-3');
    stats.append(make('span', 'h-4 w-24 animate-pulse rounded bg-hover', ''));
    const live = make('div', 'tile-live flex min-h-[18px] flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted');
    body.append(badges, stats, live);
    return body;
  }
  function sparkline(weeks) {
    const max = Math.max(1, ...weeks.map(w => w.count));
    const box = make('div', 'tile-spark flex h-8 items-end gap-[3px]');box.setAttribute('aria-hidden', 'true');
    weeks.forEach((week, i) => {
      // This week in the accent, earlier weeks in a quiet grey.
      const bar = make('span', `block w-[6px] rounded-t-[2px] ${i === weeks.length - 1 ? 'bg-lz-info-solid' : 'bg-lz-neutral-solid opacity-45'}`);
      bar.style.height = `${Math.max(week.count ? 12 : 4, (week.count / max) * 100)}%`;
      bar.title = `Week of ${new Date(week.start).toLocaleDateString(undefined, {month:'short', day:'numeric'})}: ${week.count}`;
      if (!calm()) {bar.style.transformOrigin = 'bottom';bar.style.transform = 'scaleY(0)';bar.style.transition = `transform 500ms cubic-bezier(0.2, 0.8, 0.2, 1) ${i * 35}ms`;}
      box.append(bar);
    });
    if (!calm()) requestAnimationFrame(() => requestAnimationFrame(() => box.querySelectorAll('span').forEach(bar => {bar.style.transform = 'scaleY(1)';})));
    return box;
  }
  const delta = (now, before, period) => {
    const d = now - before;
    const node = make('span', `inline-flex items-center gap-1 text-xs font-medium ${d > 0 ? 'text-lz-success' : d < 0 ? 'text-lz-danger' : 'text-muted'}`);
    node.append(make('span', 'text-[9px]', d > 0 ? '▲' : d < 0 ? '▼' : '•'), make('span', '', `${d > 0 ? '+' : ''}${d} vs ${period}`));
    return node;
  };
  const dot = (cls, text) => {const item = make('span', 'inline-flex items-center gap-1.5');item.append(make('span', `h-2 w-2 flex-none rounded-full ${cls}`), make('span', 'text-ink', text));return item;};
  function fillTile(body, stat) {
    const stats = body.querySelector('.tile-stats'), live = body.querySelector('.tile-live');
    const figure = make('div', 'flex min-w-0 flex-col gap-0.5');
    figure.append(make('span', 'text-[11px] font-medium text-muted', 'This week'), make('span', 'text-[22px] font-semibold leading-none text-ink', String(stat.thisWeek)), delta(stat.thisWeek, stat.lastWeek, 'last week'));
    // No applications in 8 weeks: no sparkline, rather than a row of empty stubs.
    stats.replaceChildren(figure, ...(stat.weeks.some(w => w.count) ? [sparkline(stat.weeks)] : []));
    live.replaceChildren();
    if (stat.auto && stat.progress) live.append(dot('bg-lz-info-solid', `${stat.progress} in progress`));
    if (stat.auto && stat.waiting) live.append(dot('bg-lz-warning-solid', `${stat.waiting} waiting on you`));
    if (!live.childNodes.length) live.append(make('span', '', !stat.hasFolder ? 'Set a save folder to start tracking' : stat.last ? `Last applied ${ago(stat.last)}` : 'No applications yet'));
    else if (stat.last) live.append(make('span', 'basis-full text-muted', `Last applied ${ago(stat.last)}`));
  }

  // ---------- The summary strip ----------
  function figureTile(label, value, extra, onClick) {
    const tile = make(onClick ? 'button' : 'div', `home-figure flex min-w-0 flex-col items-start gap-1 rounded-xl border border-line bg-elev px-4 py-3 text-left ${onClick ? 'cursor-pointer transition-colors hover:border-line-strong hover:bg-elev2' : ''}`);
    if (onClick) {tile.type = 'button';tile.addEventListener('click', onClick);}
    const head = make('span', 'flex items-center gap-1.5 text-xs font-medium text-muted');
    head.append(document.createTextNode(label));
    tile.append(head, make('span', 'home-figure-value text-[26px] font-semibold leading-none text-ink', String(value)));
    if (extra) tile.append(extra);
    return {tile, head};
  }
  function strip(container, all, profiles, onOpen) {
    const sum = key => all.reduce((a, s) => a + s[key], 0);
    const thisWeek = sum('thisWeek'), lastWeek = sum('lastWeek');
    const waitingProfiles = profiles.filter((p, i) => all[i].waiting);
    const applied = figureTile('Applied this week', thisWeek, delta(thisWeek, lastWeek, 'last week'));
    const progress = figureTile('In progress', sum('progress'), make('span', 'text-xs text-muted', 'Auto apply jobs working'));
    progress.head.prepend(make('span', 'h-2 w-2 rounded-full bg-lz-info-solid'));
    // Waiting on you opens the first profile that needs you.
    const waiting = figureTile('Waiting on you', sum('waiting'),
      make('span', 'max-w-full truncate text-xs text-muted', waitingProfiles.length ? waitingProfiles.map(p => [p.firstName, p.lastName].filter(Boolean).join(' ')).join(', ') : 'Nothing needs you'),
      waitingProfiles.length ? () => onOpen(waitingProfiles[0]) : null);
    waiting.head.prepend(make('span', 'h-2 w-2 rounded-full bg-lz-warning-solid'));
    const month = figureTile('Applied this month', sum('thisMonth'), make('span', 'text-xs text-muted', new Date().toLocaleDateString(undefined, {month:'long'})));
    const row = make('div', 'home-strip grid grid-cols-4 gap-3 max-[860px]:grid-cols-2');
    row.append(applied.tile, progress.tile, waiting.tile, month.tile);
    container.replaceChildren(row);
  }

  async function refresh(profiles, {onOpen} = {}) {
    const mine = ++token;
    const container = document.getElementById('home-overview');
    if (!profiles.length) {if (container) container.replaceChildren();return;}
    let state = null;
    try {state = window.api.extensionState ? await window.api.extensionState() : null;} catch (_) {state = null;}
    const seen = new Set();
    const rowsList = await Promise.all(profiles.map(async p => {
      const folder = (p.saveFolder || '').trim();
      if (!folder || !window.api.listProcesses) return [];
      try {return (await window.api.listProcesses(p.id, folder)) || [];} catch (_) {return [];}
    }));
    if (mine !== token) return;
    // A save folder shared by two profiles counts once, for the first.
    const all = profiles.map((p, i) => statsFor(p, rowsList[i].filter(row => !row.folderPath || (!seen.has(row.folderPath) && seen.add(row.folderPath))), state));
    profiles.forEach((p, i) => {
      const body = document.querySelector(`.tile-body[data-profile="${CSS.escape(p.id)}"]`);
      if (body) fillTile(body, all[i]);
    });
    if (container) strip(container, all, profiles, onOpen || (() => {}));
  }

  window.App = window.App || {};
  window.App.HomeOverview = {tileBody, refresh};
})();
