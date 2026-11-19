/* Job Discovery screen: collect jobs, edit each profile's search, review matches,
   and send a chosen job to the Chrome extension through the existing hand-off. */
(function () {
  // Questions use the app's themed dialog (confirm-dialog.js), or the plain box without it.
  const ask = options => window.App && window.App.Confirm ? window.App.Confirm.ask(options)
    : Promise.resolve(typeof confirm === 'function' ? confirm([options.title, options.subject, options.message].filter(Boolean).join('\n\n')) : true);
  const $ = id => document.getElementById(id);
  let initialized = false, active = false, profileId = null, unsubscribe = null, statusTimer = null, matchToken = 0;
  const VERIFY_TEXT = {VERIFIED_ORIGINAL: 'Verified posting', UNVERIFIED: 'Not verified yet', UNRESOLVED: 'Original not found', EXPIRED: 'Closed', BLOCKED: 'Site blocked the check'};

  const setText = (id, text) => { $(id).textContent = text; };
  const number = value => Number(value || 0).toLocaleString('en-US');
  const day = iso => iso ? new Date(iso).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'}) : '';
  function ago(iso) {
    if (!iso) return '';
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`;
  }
  function money(job) {
    if (job.salaryMin == null && job.salaryMax == null) return '';
    const f = value => value == null ? '' : job.salaryCurrency === 'USD' || !job.salaryCurrency ? `$${Math.round(value).toLocaleString('en-US')}` : `${Math.round(value).toLocaleString('en-US')} ${job.salaryCurrency}`;
    const period = job.salaryPeriod && job.salaryPeriod !== 'unknown' ? ` / ${job.salaryPeriod}` : '';
    return job.salaryMax != null && job.salaryMax !== job.salaryMin ? `${f(job.salaryMin)} – ${f(job.salaryMax)}${period}` : `${f(job.salaryMin ?? job.salaryMax)}${period}`;
  }
  const lines = text => String(text || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
  const commaList = text => String(text || '').split(/[,\n]/).map(item => item.trim()).filter(Boolean);

  // ---------- Sources and progress ----------
  function describeProgress(message) {
    const p = message.progress || {};
    if (message.kind === 'sync' && p.phase === 'details') return `Loading descriptions for jobs that fit your searches: ${number(p.detailsDone)} of ${number(p.details)}. Job lists from ${number(p.ok)} boards are already searchable.`;
    if (message.kind === 'sync') return `Collecting job lists: ${number(p.done)} of ${number(p.boards)} boards checked${p.unchanged ? ` (${number(p.unchanged)} unchanged)` : ''}, ${number(p.inserted)} new jobs${p.gone ? `, ${number(p.gone)} boards no longer exist` : ''}${p.failed ? `, ${number(p.failed)} failed (retried next time)` : ''}.`;
    if (message.kind === 'discover') return `Finding boards: ${number(p.added)} new boards so far${p.crawl ? ` (${p.crawl}, ${p.pattern})` : ''}${p.error ? '. The index is busy; that part will be retried next time.' : '.'}`;
    return '';
  }
  async function refreshStatus() {
    if (!active) return;
    try {
      const status = await window.api.discoveryStatus();
      if (!active) return;
      setText('discovery-boards', number(status.boards));
      setText('discovery-jobs', number(status.activeJobs));
      setText('discovery-new', number(status.newJobs));
      setText('discovery-verified', number(status.verified));
      setText('discovery-last', status.lastSync ? `Last collected ${ago(status.lastSync)} (${day(status.lastSync)}).` : 'No jobs collected yet. Click Collect jobs to start.');
      const running = !!status.task;
      $('discovery-sync').disabled = running;$('discovery-find').disabled = running;$('discovery-stop').hidden = !running;
      if (running) setText('discovery-progress', describeProgress({kind: status.task.kind, progress: status.task.progress}) || 'Working...');
    } catch (error) { setText('discovery-progress', error.message); }
  }
  function onEvent(message) {
    if (!active) return;
    if (message.event === 'progress') setText('discovery-progress', describeProgress(message));
    if (message.event === 'done') {
      const r = message.result || {};
      if (message.error) setText('discovery-progress', `Stopped: ${message.error}`);
      else if (message.kind === 'sync') setText('discovery-progress', `${message.stopped ? 'Stopped' : 'Done'}: ${number(r.ok)} boards collected, ${number(r.inserted)} new jobs, ${number(r.expired)} closed${r.gone ? `, ${number(r.gone)} boards no longer exist` : ''}.`);
      else setText('discovery-progress', `${message.stopped ? 'Stopped' : 'Done'}: ${number(r.added)} new boards found${r.failed ? `; ${number(r.failed)} index pages were busy and will be retried next time` : ''}. Click Collect jobs to read their jobs.`);
      refreshStatus();
      if (message.kind === 'sync') loadMatches();
    }
  }
  async function run(action) {
    try {
      if (action === 'sync') await window.api.discoverySync();
      else if (action === 'find') await window.api.discoveryDiscover({crawls: 4});
      else await window.api.discoveryStop();
      setText('discovery-progress', action === 'stop' ? 'Stopping...' : 'Starting...');
    } catch (error) { setText('discovery-progress', error.message); }
    refreshStatus();
  }

  // ---------- Search profile ----------
  function profiles() { return window.App.Profiles ? window.App.Profiles.list() : []; }
  function fillProfiles() {
    const list = profiles(), select = $('discovery-profile');
    select.replaceChildren(...list.map(profile => {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = `${[profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'Unnamed profile'}${profile.title ? ' — ' + profile.title : ''}`;
      return option;
    }));
    if (!list.length) { setText('discovery-empty', 'Create a profile first.'); return; }
    profileId = list.some(profile => profile.id === profileId) ? profileId : list[0].id;
    select.value = profileId;
  }
  async function loadSearch() {
    if (!profileId) return;
    try {
      const search = await window.api.discoverySearchProfile(profileId);
      $('discovery-titles').value = (search.titles || []).join('\n');
      $('discovery-skills').value = (search.skills || []).join(', ');
      $('discovery-min').value = search.minScore ?? 55;
      $('discovery-days').value = search.days == null ? '' : String(search.days);
      if (!$('discovery-days').value && search.days != null) $('discovery-days').value = '30';
      $('discovery-places').value = search.places || 'any';
      $('discovery-unverified').checked = search.includeUnverified !== false;
      setText('discovery-search-status', search.titles?.length ? '' : 'Add the job titles this person should apply for, then click Save and search.');
    } catch (error) { setText('discovery-search-status', error.message); }
  }
  async function saveSearch() {
    try {
      await window.api.discoverySaveSearchProfile(profileId, {
        titles: lines($('discovery-titles').value), skills: commaList($('discovery-skills').value),
        minScore: Number($('discovery-min').value), days: $('discovery-days').value === '' ? null : Number($('discovery-days').value),
        places: $('discovery-places').value, includeUnverified: $('discovery-unverified').checked,
      });
      setText('discovery-search-status', 'Saved.');
      await loadSearch();
      await loadMatches();
    } catch (error) { setText('discovery-search-status', error.message); }
  }

  // ---------- Matches ----------
  async function loadMatches() {
    if (!active || !profileId) return;
    const token = ++matchToken, forProfile = profileId;
    // A new search replaces the list; nothing from the previous search stays on screen.
    $('discovery-list').replaceChildren();
    setText('discovery-count', '');setText('discovery-funnel', '');
    setText('discovery-empty', 'Searching...');
    try {
      const result = await window.api.discoveryMatches(forProfile, {limit: 100});
      if (token !== matchToken || forProfile !== profileId) return;
      setText('discovery-count', result.total ? `(${number(result.total)}${result.total > result.jobs.length ? `, best ${result.jobs.length} shown` : ''})` : '');
      setText('discovery-funnel', describeFunnel(result.funnel, result.search));
      $('discovery-list').replaceChildren(...result.jobs.map(renderMatch));
      setText('discovery-empty', result.note || (result.jobs.length ? '' : 'No matches yet. Collect jobs, or widen the search (more titles, lower minimum score, longer time).'));
    } catch (error) { setText('discovery-empty', error.message); }
  }
  // "Of 25,967 jobs: 5,215 fit the titles → 69 posted within 24 hours → ..." shows which filter narrows the list.
  const DAYS = {1: '24 hours', 3: '3 days', 7: '7 days', 14: '14 days', 30: '30 days'};
  function describeFunnel(funnel, search) {
    if (!funnel) return '';
    const steps = [`${number(funnel.titles)} fit the titles`];
    if (search.days) steps.push(`${number(funnel.recent)} posted within ${DAYS[search.days] || search.days + ' days'}`);
    steps.push(`${number(funnel.eligible)} open to you in the US`);
    if (search.places === 'remote') steps.push(`${number(funnel.place)} US remote`);
    if (search.places === 'remote-or-local') steps.push(`${number(funnel.place)} US remote or in your state`);
    if (!search.includeUnverified) steps.push(`${number(funnel.verified)} verified`);
    steps.push(`${number(funnel.score)} scored ${search.minScore} or more`);
    return `Of ${number(funnel.jobs)} jobs: ${steps.join(' → ')}.${funnel.hidden ? ` ${number(funnel.hidden)} hidden.` : ''}`;
  }
  // Full class strings (Tailwind reads this file as text). The kind also stays as a marker class.
  const TAG_BASE = 'discovery-tag ml-1.5 inline-block rounded-full border px-2 py-0.5 align-middle text-[11px] font-semibold';
  const TAG_KIND = {'': 'border-line text-muted', ok: 'ok border-success-line bg-success-bg text-success', bad: 'bad border-danger-line bg-danger-bg text-danger'};
  function tag(text, kind) { const span = document.createElement('span');span.className = `${TAG_BASE} ${TAG_KIND[kind || '']}`;span.textContent = text;return span; }
  function button(text, onClick, primary) {
    const element = document.createElement('button');
    element.type = 'button';element.className = `btn ${primary ? 'btn-primary' : 'btn-ghost'} btn-sm`;element.textContent = text;
    element.addEventListener('click', onClick);
    return element;
  }
  function renderMatch({job, fit, mark}) {
    const item = document.createElement('li');item.className = 'discovery-item grid grid-cols-[52px_minmax(0,1fr)] gap-3.5 border-t border-line py-4';
    const score = document.createElement('div');score.className = 'discovery-score flex h-12 w-12 items-center justify-center rounded-[10px] bg-accent-ring text-[17px] font-bold tabular-nums text-accent';score.textContent = String(fit.score);score.title = `Title ${Math.round(fit.parts.title * 100)}%, skills ${Math.round(fit.parts.skills * 100)}%, seniority ${Math.round(fit.parts.seniority * 100)}%, location ${Math.round(fit.parts.location * 100)}%`;
    const body = document.createElement('div');body.className = 'min-w-0';
    const title = document.createElement('h4');title.className = 'mb-1 text-[15px] font-bold [overflow-wrap:anywhere]';title.textContent = job.title;
    title.append(tag(VERIFY_TEXT[job.verification] || job.verification, job.verification === 'VERIFIED_ORIGINAL' ? 'ok' : ['EXPIRED', 'BLOCKED'].includes(job.verification) ? 'bad' : ''));
    if (mark === 'applied') title.append(tag('Sent to extension', 'ok'));
    const meta = document.createElement('p');meta.className = 'discovery-meta mb-1.5 text-[13px] text-muted [overflow-wrap:anywhere]';
    const posted = job.publishedAt ? `Posted ${ago(job.publishedAt)}` : `First seen ${ago(job.firstSeenAt)}`;
    meta.textContent = [job.companyName, job.locationText || 'Location not stated', money(job), posted, job.provider].filter(Boolean).join(' · ');
    const why = document.createElement('p');why.className = 'discovery-why mb-2.5 text-xs text-muted';why.textContent = fit.reasons.join(' · ');
    const actions = document.createElement('div');actions.className = 'discovery-item-actions flex flex-wrap justify-start gap-2';
    const send = button(mark === 'applied' ? 'Sent' : 'Send to extension', () => sendToExtension(job, send, title), true);
    send.disabled = mark === 'applied';
    actions.append(
      send,
      button('Open posting', () => window.api.discoveryOpen(job.sourceUrl).catch(error => setText('discovery-send-status', error.message))),
      button('Hide', async () => { await window.api.discoveryMark(profileId, job.id, 'hidden'); item.remove(); loadMatches(); }),
    );
    const details = document.createElement('details');details.className = 'mt-2.5 text-[13px]';
    const summary = document.createElement('summary');summary.textContent = 'Job description';
    details.append(summary);
    details.addEventListener('toggle', async () => {
      if (!details.open || details.dataset.loaded) return;
      details.dataset.loaded = '1';
      const pre = document.createElement('pre');pre.className = 'my-[1em] max-h-[360px] overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-bg p-3 font-sans text-[13px] leading-[1.55]';pre.textContent = 'Loading...';details.append(pre);
      try { const full = await window.api.discoveryJob(job.id);pre.textContent = full.description || 'The site gave no description.'; }
      catch (error) { pre.textContent = error.message; }
    });
    body.append(title, meta, why, actions, details);
    item.append(score, body);
    return item;
  }

  // ---------- Hand-off to the extension ----------
  async function refreshTargets() {
    try {
      const state = await window.api.extensionState(profileId || undefined);
      const previous = $('discovery-target').value;
      // Only the browsers linked to the chosen profile.
      const usable = state.connections.filter(client => client.profileId === profileId);
      const options = usable.map(client => {const option = document.createElement('option');option.value = client.id;option.textContent = `${client.name} (${client.connected ? 'online' : 'offline'})`;return option;});
      if (!options.length) {const option = document.createElement('option');option.value = '';option.textContent = 'Link a browser to this profile first';options.push(option);}
      $('discovery-target').replaceChildren(...options);
      if (usable.some(client => client.id === previous)) $('discovery-target').value = previous;
    } catch (_) { /* extension service offline: sending reports it */ }
  }
  async function sendToExtension(job, sendButton, titleNode) {
    const status = text => setText('discovery-send-status', text);
    const profile = profiles().find(item => item.id === profileId);
    try {
      if (!profile) throw new Error('Choose a profile.');
      if (profile.applicationMode !== 'extension') throw new Error('This profile is not in Chrome extension mode. Open it, click Edit profile, and switch the application mode to the extension first.');
      const connectionId = $('discovery-target').value;
      if (!connectionId) throw new Error('Link a Chrome extension first (open an extension-mode profile to see the pairing code).');
      sendButton.disabled = true;
      let verification = job.verification;
      if (verification !== 'VERIFIED_ORIGINAL') {
        status('Checking that the posting is live on the company\'s own job page...');
        const result = await window.api.discoveryVerify(job.id);
        verification = result.status;
        if (verification === 'EXPIRED') { status(`Not sent: ${result.reason} The job looks closed.`); sendButton.closest('li').remove(); return; }
        if (verification !== 'VERIFIED_ORIGINAL' && !(await ask({title:'Send it anyway?', subject:`${job.title} at ${job.companyName}`, message:`The posting could not be confirmed: ${result.reason}`, confirmLabel:'Send anyway', tone:'danger'}))) { status('Not sent.'); sendButton.disabled = false; return; }
      }
      const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
      if (!(await ask({title:`Send to the extension for ${name}?`, subject:`${job.title} at ${job.companyName}`, message:'Chrome opens it beside ChatGPT. You still review every answer and submit yourself.', confirmLabel:'Send'}))) { status('Not sent.'); sendButton.disabled = false; return; }
      const link = await window.App.Profiles.addJobLink(profile.id, job.sourceUrl);
      let style = {};
      try { style = JSON.parse(localStorage.getItem(`style:${profile.id}:${profile.templateId || 'classic'}`) || '{}'); } catch (_) { /* defaults */ }
      await window.api.extensionAssign({profileId: profile.id, url: link, connectionId, style});
      await window.api.discoveryMark(profile.id, job.id, 'applied');
      sendButton.textContent = 'Sent';
      titleNode.append(tag('Sent to extension', 'ok'));
      status(`Sent. Chrome opens ${job.companyName} beside ChatGPT; continue in the extension side panel.`);
    } catch (error) {
      status(error.message);
      sendButton.disabled = false;
    }
  }

  // ---------- Lifecycle ----------
  function init() {
    if (initialized) return;
    initialized = true;
    $('discovery-sync').addEventListener('click', () => run('sync'));
    $('discovery-find').addEventListener('click', () => run('find'));
    $('discovery-stop').addEventListener('click', () => run('stop'));
    $('discovery-save-search').addEventListener('click', saveSearch);
    // Filters apply as soon as they change; titles and skills apply on Save and search.
    for (const id of ['discovery-min', 'discovery-days', 'discovery-places', 'discovery-unverified']) $(id).addEventListener('change', saveSearch);
    $('discovery-profile').addEventListener('change', async event => { profileId = event.target.value; await refreshTargets(); await loadSearch(); await loadMatches(); });
    $('discovery-add-board').addEventListener('click', async () => {
      try {
        const board = await window.api.discoveryAddBoard($('discovery-board-url').value.trim());
        setText('discovery-board-status', `Added ${board.provider} board "${board.board}". Click Collect jobs to read its jobs.`);
        $('discovery-board-url').value = '';
        refreshStatus();
      } catch (error) { setText('discovery-board-status', error.message); }
    });
  }
  async function open() {
    if (!window.api || !window.api.discoveryStatus) return;
    init();
    active = true;
    unsubscribe = window.api.onDiscoveryEvent(onEvent);
    fillProfiles();
    await Promise.all([refreshStatus(), refreshTargets()]);
    await loadSearch();
    await loadMatches();
    statusTimer = setInterval(refreshStatus, 5000);
  }
  function close() {
    active = false;
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
  }
  window.App.Discovery = { open, close };
})();
