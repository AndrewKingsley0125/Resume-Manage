/* Profile job links and live local-extension connection dashboard. */
(function () {
  const $ = id => document.getElementById(id);
  // Questions use the app's themed dialog (confirm-dialog.js), or the plain box without it.
  const ask = options => window.App && window.App.Confirm ? window.App.Confirm.ask(options)
    : Promise.resolve(typeof confirm === 'function' ? confirm([options.title, options.subject, options.message].filter(Boolean).join('\n\n')) : true);
  const workflow = window.App.ProfileWorkflow;
  let currentProfile = null;
  let saveLinks = null;
  let editProfile = null;
  let saveSetting = null;
  let initialized = false;
  let token = 0;
  let pollTimer = null;
  let liveState = null;
  let pollBusy = false;

  let lastLinked = null;
  // The job whose card was clicked last (its window was brought forward); highlighted.
  let selectedJobId = null;
  // The card whose menu is open (kept open across refreshes), and the job under review.
  let openMenuJobId = null;
  let reviewJobId = null;
  // The review's resume JSON: as ChatGPT wrote it, and as you edited it (null when unchanged).
  let reviewOriginal = '', reviewEdited = null, reviewEditing = false;
  // The job whose details panel is open (null when none).
  let detailsJobId = null;
  // The six stages of an application, and how far a job has got.
  const STAGES = ['Sent', 'Job description', 'Resume', 'Questions', 'Answers', 'Filled'];
  // Tailwind classes. Scripts toggle the is-* markers; the [&.is-*] variants style them.
  // Steps done are solid blue, the step in hand a lighter blue: progress is In Progress's colour.
  const STAGE_CLASS = 'job-stage h-1 rounded-full bg-jr-neutral-hover [&.is-done]:bg-jr-brand [&.is-current]:bg-[color-mix(in_srgb,var(--jr-brand)_45%,transparent)]';
  const HISTORY_TEXT = {attention:'text-lz-warning', error:'text-lz-danger'};
  // A card is for scanning the board: the site's icon, the role in bold, the company, one
  // status lozenge, a slim progress bar, when it last changed, and the next steps at its foot.
  // Everything else opens in the job's details panel. Raised on Atlassian's soft shadow, it
  // lifts a little when you point at it; an inset ring marks the selected or open card, so a
  // card never changes size. The lane marker (job-attention, ...) is kept for scripts and tests.
  const CARD_BASE = 'job-card group/card relative flex flex-col gap-3 rounded-l-none rounded-r-xl border-l-[3px] border-solid bg-jr-card p-3 pl-3.5 text-[13px] text-jr-text shadow-jr transition-[box-shadow,background-color,transform] duration-150 [&.is-clickable]:cursor-pointer [&.is-clickable:hover]:-translate-y-px [&.is-clickable:hover]:shadow-[0_6px_16px_-4px_rgba(9,30,66,0.25),0_0_1px_rgba(9,30,66,0.31)] [&.is-selected]:shadow-[inset_0_0_0_2px_var(--jr-selected-line)] [&.is-active]:bg-jr-selected [&.is-active]:shadow-[inset_0_0_0_2px_var(--jr-selected-line)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-jr-selected-line';
  const CARD_CLASS = {
    attention: `${CARD_BASE} job-attention`,
    busy: `${CARD_BASE} job-busy`,
    idle: `${CARD_BASE} job-idle`,
    unsent: `${CARD_BASE} job-unsent`,
    done: `${CARD_BASE} job-done`,
  };
  // The board's columns, left to right. Each has its own GitHub Primer colour (see the --st-*
  // settings in tailwind.src.css): neutral, blue, orange, purple, green, red.
  const COLUMNS = [
    ['todo', 'To do'],
    ['progress', 'In Progress'],
    ['waiting', 'Waiting on You'],
    ['done', 'Done'],
    ['failed', 'Failed'],
  ];
  // Status lozenges, as on a Jira card: small, uppercase, bold, on a soft fill (Atlassian's
  // lozenge colours). In Progress tells working by itself from ready for your next step.
  const LOZENGE = 'job-pill inline-flex w-fit items-center rounded-[3px] px-1 text-[11px] font-bold uppercase leading-4 tracking-[0.02em]';
  const PILL = {
    todo: ['To do', `${LOZENGE} is-todo bg-lz-neutral-bg text-lz-neutral`],
    busy: ['Working', `${LOZENGE} is-busy bg-lz-info-bg text-lz-info`],
    idle: ['Ready', `${LOZENGE} is-ready bg-lz-neutral-bg text-lz-neutral`],
    attention: ['Needs you', `${LOZENGE} is-attention bg-lz-warning-bg text-lz-warning`],
    review: ['Review', `${LOZENGE} is-review bg-lz-discovery-bg text-lz-discovery`],
    done: ['Done', `${LOZENGE} is-done bg-lz-success-bg text-lz-success`],
    failed: ['Failed', `${LOZENGE} is-failed bg-lz-danger-bg text-lz-danger`],
  };
  const pill = kind => el('span', PILL[kind][1], PILL[kind][0]);

  const MENU_ITEM_BASE = 'job-menu-item block w-full cursor-pointer rounded-md border-0 bg-transparent px-2.5 py-2 text-left text-[13px] hover:bg-accent-ring focus-visible:bg-accent-ring focus-visible:outline-none disabled:cursor-default disabled:bg-transparent disabled:text-muted';
  const MENU_ITEM_CLASS = {normal:`${MENU_ITEM_BASE} text-ink`, danger:`${MENU_ITEM_BASE} is-danger text-danger`};
  const STAGES_DONE = {'assigned':1, 'tabs-opened':1, 'tabs-ready':1, 'jd-received':2, 'resume-exported':3, 'questions-scanned':4, 'answers-reviewed':5, 'filled':6, 'completed':6};
  // The card's progress: six slim segments and a count.
  function progressBar(job) {
    const done = isOpen(job) ? STAGES_DONE[job.status] || 0 : STAGES.length;
    const now = Math.min(done, STAGES.length - 1);
    const wrap = el('div', 'job-stages flex min-w-0 flex-1 items-center gap-2');
    const track = el('div', 'job-stage-track grid min-w-0 flex-1 grid-cols-6 gap-[3px]');track.setAttribute('role', 'img');
    STAGES.forEach((name, index) => {
      const step = el('span', `${STAGE_CLASS}${index < done ? ' is-done' : ''}${index === now && done < STAGES.length ? ' is-current' : ''}`);
      step.title = name;track.append(step);
    });
    track.setAttribute('aria-label', done >= STAGES.length ? 'All 6 stages done' : `Stage ${now + 1} of 6: ${STAGES[now]}`);
    wrap.append(track, el('span', 'job-stage-count shrink-0 text-[11px] font-medium tabular-nums text-jr-subtlest', `${done}/${STAGES.length}`));
    return wrap;
  }
  // The details panel's progress: the six stages as a list, ticked off.
  function stepList(job) {
    const done = isOpen(job) || failed(job) ? STAGES_DONE[job.status] || 0 : STAGES.length;
    const now = Math.min(done, STAGES.length - 1);
    const list = el('ol', 'job-steps m-0 flex list-none flex-col p-0');
    STAGES.forEach((name, index) => {
      const state = index < done ? 'is-done' : index === now && isOpen(job) ? 'is-current' : 'is-todo';
      const item = el('li', `job-step ${state} relative flex items-center gap-3 py-1.5 text-[13px]`);
      const mark = el('span', state === 'is-done' ? 'grid h-5 w-5 flex-none place-items-center rounded-full bg-jr-brand text-[11px] font-bold text-jr-on-brand'
        : state === 'is-current' ? 'h-5 w-5 flex-none rounded-full border-2 border-jr-brand bg-jr-selected' : 'h-5 w-5 flex-none rounded-full border-2 border-jr-border', state === 'is-done' ? '✓' : '');
      item.append(mark, el('span', state === 'is-todo' ? 'text-muted' : state === 'is-current' ? 'font-semibold text-ink' : 'text-ink', name));
      if (state === 'is-current') item.append(el('span', 'ml-auto text-[11px] font-semibold uppercase tracking-[0.04em] text-jr-brand', 'Now'));
      list.append(item);
    });
    return list;
  }
  const clock = time => new Date(time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  // What happened, newest first, as a timeline.
  function historyList(job) {
    const list = el('ol', 'job-history m-0 flex list-none flex-col p-0');
    for (const event of (job.events || []).slice().reverse()) {
      const item = el('li', `is-${event.level || 'info'} grid grid-cols-[10px_minmax(0,1fr)_auto] items-start gap-2.5 py-1.5 text-[13px]`);
      const dot = el('i', `mt-[7px] block h-2 w-2 rounded-full ${event.level === 'error' ? 'bg-lz-danger' : event.level === 'attention' ? 'bg-lz-warning' : 'bg-jr-neutral-hover'}`);
      const time = el('time', 'whitespace-nowrap pt-px text-xs tabular-nums text-muted', clock(event.at));time.dateTime = new Date(event.at).toISOString();time.title = new Date(event.at).toLocaleString();
      item.append(dot, el('span', `min-w-0 leading-snug [overflow-wrap:anywhere] ${HISTORY_TEXT[event.level] || 'text-ink'}`, event.text), time);
      list.append(item);
    }
    return list;
  }
  const isOpen = job => !['completed', 'unlinked'].includes(job.status);
  const STATUS_LABELS = {'assigned':'Opening in Chrome','tabs-opened':'Tabs open','tabs-ready':'Ready','jd-received':'Job read','resume-exported':'Resume ready','questions-scanned':'Questions scanned','answers-reviewed':'Answers reviewed','filled':'Form filled','completed':'Ended','unlinked':'Unlinked'};
  const statusLabel = status => STATUS_LABELS[status] || String(status || '').replace(/-/g, ' ');
  const NEXT_STEPS = {'assigned':'Opening in Chrome','tabs-opened':'Next: Detect JD, then Send to ChatGPT','tabs-ready':'Next: Detect JD, then Send to ChatGPT','jd-received':'Next: send the resume prompt to ChatGPT','resume-exported':'Next: Auto-fill','questions-scanned':'Next: Ask ChatGPT or Auto-fill','answers-reviewed':'Next: Fill form or Auto-fill','filled':'Next: check the form and submit it yourself'};
  // What a sent job is doing now, as its Resume Apply tab reports it: [text, level].
  // Whether the browser running a job is connected right now.
  const browserOnline = job => !!(liveState && liveState.connections.some(c => c.id === job.connectionId && c.connected));
  // A job that did not go through: ended as Failed, or open with its resume step failed.
  const failed = job => job.status === 'completed' ? job.outcome === 'failed' : !!job.failure;
  function jobState(job) {
    if (job.status === 'completed' && job.outcome === 'failed') return [`Failed: ${(job.failure && job.failure.message) || 'did not go through'}`, 'done'];
    if (['completed','unlinked'].includes(job.status)) return [statusLabel(job.status), 'done'];
    if (job.failure) return [`Failed: ${job.failure.message}`, 'attention'];
    if (job.error) return [`Needs you: ${job.error}`, 'attention'];
    const progress = job.progress || {};
    // Nothing can be running while its browser is offline: don't show old progress as work.
    if (liveState && !browserOnline(job) && (progress.level === 'busy' || (job.commands || []).length)) return ['Paused: Chrome is offline. Open Chrome to continue.', 'attention'];
    if (progress.text) return [progress.text, progress.level || 'idle'];
    return [NEXT_STEPS[job.status] || statusLabel(job.status), 'idle'];
  }
  // What a job is doing, in a few words: its details panel's headline and its card's tooltip.
  const HEADLINES = {'chatgpt-working':'ChatGPT is writing', 'auto-filling':'Filling the application', 'waiting-on-page':'Waiting for you on the job page', 'confirm-resume':'Resume ready for your review', 'answers-ready':'Answers ready to fill', 'full-auto':'Full auto is running', 'full-auto-blocked':'Full auto stopped', 'open-error':'The job could not be opened', 'site-access':'Needs access to the job site'};
  const STATUS_HEADLINES = {'assigned':'Opening in Chrome', 'tabs-opened':'Ready to read the job', 'tabs-ready':'Ready to read the job', 'jd-received':'Ready to write the resume', 'resume-exported':'Resume ready', 'questions-scanned':'Questions read', 'answers-reviewed':'Answers ready', 'filled':'Form filled: check it and submit it'};
  function headline(job) {
    if (!job) return 'Not sent yet';
    if (job.status === 'completed') return failed(job) ? 'Did not go through' : 'Application completed';
    if (job.status === 'unlinked') return 'Its browser was unlinked';
    if (job.failure) return 'A step failed';
    const progress = job.progress || {};
    if (liveState && !browserOnline(job) && (progress.level === 'busy' || (job.commands || []).length)) return 'Paused: Chrome is offline';
    if (job.error) return 'Needs you';
    return HEADLINES[progress.key] || STATUS_HEADLINES[job.status] || statusLabel(job.status);
  }
  function ago(time) {
    const minutes = Math.round((Date.now() - time) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    return hours < 24 ? `${hours} h ago` : new Date(time).toLocaleDateString();
  }
  const el = (tag, className, text) => {const node = document.createElement(tag);if (className) node.className = className;if (text != null) node.textContent = text;return node;};
  const capital = word => word ? word.charAt(0).toUpperCase() + word.slice(1) : '';
  // The hiring company as far as the link tells it, before the job description is read:
  // greenhouse ...?for=babelstreet, jobs.lever.co/liatrio/..., jobs.ashbyhq.com/acme/..., acme.wd5.myworkdayjobs.com.
  function companyFromLink(link) {
    try {
      const url = new URL(link), host = url.hostname.replace(/^www\./, ''), first = url.pathname.split('/').filter(Boolean)[0] || '';
      if (/greenhouse\.io$/.test(host)) return url.searchParams.get('for') || (first !== 'embed' ? first : '');
      if (/(^|\.)(lever\.co|ashbyhq\.com|smartrecruiters\.com|workable\.com|recruitee\.com)$/.test(host)) return first;
      if (/myworkdayjobs\.com$|myworkdaysite\.com$/.test(host)) return host.split('.')[0];
      const parts = host.split('.');return parts.length > 1 ? parts[parts.length - 2] : host;
    } catch (_) {return '';}
  }
  // Title and company from the job page's own title, until the job description is read.
  function fromPageTitle(title) {
    const text = String(title || '').trim();
    let m = /^Job Application for (.+?) at (.+)$/i.exec(text);if (m) return {title:m[1], company:m[2]};
    m = /^(.+?) @ (.+)$/.exec(text);if (m) return {title:m[1], company:m[2]};
    m = /^(.+?) at (.+)$/.exec(text);if (m) return {title:m[1], company:m[2]};
    m = /^(.+?) [-|–] (.+)$/.exec(text);if (m) return {company:m[1], title:m[2]};
    return text ? {title:text} : {};
  }
  function jobIdentity(job, link) {
    const page = fromPageTitle(job && job.page && job.page.title);
    const company = (job && job.company) || page.company || capital(companyFromLink(link));
    const title = (job && job.title) || page.title || '';
    let host = '';try {host = new URL(link).hostname.replace(/^www\./, '');} catch (_) { /* keep blank */ }
    return {company, title, host, icon:job && job.page && job.page.icon || ''};
  }
  function jobName(job) {
    const {company, title, host} = jobIdentity(job, job.url);
    return [company, title].filter(Boolean).join(' - ') || host || job.url;
  }
  // The site's own icon when the browser sent it, otherwise the company's first letter.
  // The site's own icon on a small tile, or the company's first letter.
  function avatar(identity, size = 'md') {
    const big = size === 'lg';
    const box = el('span', `job-avatar grid shrink-0 place-items-center overflow-hidden rounded-lg border border-jr-border bg-jr-card font-bold text-jr-subtle ${big ? 'h-11 w-11 text-base' : 'h-8 w-8 text-[13px]'}`);
    const letter = () => {box.replaceChildren();box.textContent = (identity.company || identity.host || '?').charAt(0).toUpperCase();};
    if (/^data:image\//.test(identity.icon)) {const img = el('img', big ? 'h-6 w-6 object-contain' : 'h-[18px] w-[18px] object-contain');img.alt = '';img.src = identity.icon;img.addEventListener('error', letter);box.append(img);}
    else letter();
    return box;
  }
  // One compact line per linked browser.
  function connectionCard(client, jobs) {
    const card = el('div', client.connected ? 'extension-card is-online flex items-center gap-2.5 rounded-[10px] border border-l-[3px] border-line border-l-ready bg-bg px-2.5 py-1.5'
      : 'extension-card flex items-center gap-2.5 rounded-[10px] border border-l-[3px] border-line border-l-muted bg-bg px-2.5 py-1.5');
    const own = jobs.filter(job => job.connectionId === client.id), open = own.filter(isOpen).length;
    const seen = client.connected ? 'Active now' : client.lastSeen ? `Last seen ${ago(client.lastSeen)}` : 'Not seen since the app started';
    card.append(el('span', client.connected ? 'extension-dot h-2 w-2 flex-none rounded-full bg-ready' : 'extension-dot h-2 w-2 flex-none rounded-full bg-muted'), el('strong', 'text-sm', client.name),
      el('span', client.connected ? 'extension-badge flex-none rounded-full bg-ready-bg px-2.5 py-[3px] text-xs font-semibold text-ready' : 'extension-badge flex-none rounded-full bg-line px-2.5 py-[3px] text-xs font-semibold text-muted', client.connected ? 'Online' : 'Offline'),
      el('span', 'extension-card-meta m-0 flex-none overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-muted', `${seen} · ${open} open · ${own.length - open} ended`));
    card.title = client.pairedAt ? `Paired ${new Date(client.pairedAt).toLocaleDateString()}` : '';
    const remove = el('button', 'btn btn-ghost btn-sm', 'Unlink');remove.type = 'button';
    remove.addEventListener('click', async () => {
      if (!(await ask({title:'Unlink this browser?', subject:client.name, message:'Its open jobs stop syncing with this app. You can pair it again later with the code.', confirmLabel:'Unlink', tone:'danger'}))) return;
      try {await window.api.extensionUnlink(client.id);await refreshConnections();} catch (e) {$('extension-dispatch-status').textContent = e.message;}
    });
    card.append(remove);
    return card;
  }
  // Steps the app can start for a job that is open in Chrome. Its browser runs each one
  // exactly like the same button in the job's Resume Apply window, and reports back here.
  const COMMAND_LABELS = {fail:'Failed', replaceResume:'Use revised resume', open:'Reopen windows', fullAuto:'Full auto', prepare:'Detect JD & write resume', confirmResume:'Confirm resume', scan:'Scan questions', ask:'Ask ChatGPT', auto:'Auto-fill', fill:'Fill form', complete:'Complete', details:'Show details in Chrome', focus:'Show in Chrome', review:'Review resume'};
  const COMMAND_HINTS = {fail:'The application did not go through: move it to Failed and close its Chrome tabs', replaceResume:"Read the revised resume ChatGPT wrote after you asked for changes, review it, then replace the exported one", open:'Reopen or rearrange the job window, ChatGPT and its Resume Apply window', fullAuto:'Do every step by itself: read the JD, write and export the resume, then fill the application. It stops at the first step that needs you and never clicks Submit.', prepare:"Read the job description from the job page and send the resume prompt to this job's ChatGPT", confirmResume:'Export the resume ChatGPT wrote (PDF and DOCX)', scan:'Read the questions on the application page', ask:'Send the unanswered questions to ChatGPT', auto:'Fill the application page by page; it stops before Submit', fill:"Put ChatGPT's answers on this page of the form. Nothing is submitted.", complete:'You submitted the application: move it to Done and close its Chrome tabs'};
  // Only the steps that make sense where the job is now. Nothing while it is working by
  // itself or waiting for you on the job page.
  function availableSteps(job) {
    const key = (job.progress && job.progress.key) || '';
    if (['chatgpt-working','auto-filling','waiting-on-page','full-auto'].includes(key)) return [];
    if (key === 'confirm-resume') return ['review'];
    if (key === 'answers-ready') return ['fill','ask'];
    if (['open-error','site-access'].includes(key)) return ['open'];
    switch (job.status) {
      case 'tabs-opened': case 'tabs-ready': case 'jd-received': return ['fullAuto','prepare'];
      case 'resume-exported': return ['auto','scan'];
      case 'questions-scanned': return ['auto','ask'];
      case 'answers-reviewed': case 'filled': return ['auto'];
      default: return [];
    }
  }
  function commandButton(job, action, primary) {
    const queued = (job.commands || []).some(c => c.action === action);
    const button = el('button', `btn btn-sm ${primary ? 'btn-primary' : 'btn-ghost'}`, queued ? `${COMMAND_LABELS[action]}...` : COMMAND_LABELS[action]);
    button.type = 'button';button.dataset.action = action;
    button.title = queued ? 'Waiting for the browser to run it' : COMMAND_HINTS[action];
    button.disabled = queued;
    button.addEventListener('click', async () => {
      button.disabled = true;
      if (!(await runCommand(job, action))) button.disabled = queued;
    });
    return button;
  }
  // Runs one step on a job, asking first where the step ends or exports something. Resolves
  // true when it was sent, false when you cancelled or it failed. Buttons and drops share it.
  async function runCommand(job, action) {
    {
      if (action === 'complete' && !(await ask(job.exported && !job.failure
        ? {title:'Complete this application?', subject:jobName(job), message:'Do this after you submitted the application. It moves to Done, and its job tab, ChatGPT tab and Resume Apply window close.', confirmLabel:'Complete', tone:'success'}
        : {title:'Complete without a resume?', subject:jobName(job), message:'It has no exported resume, so it moves to Failed, not Done. Its job tab, ChatGPT tab and Resume Apply window close.', confirmLabel:'Move to Failed', tone:'danger'}))) return false;
      if (action === 'fail' && !(await ask({title:'Move this application to Failed?', subject:jobName(job), message:'Use this when the application did not go through. Its job tab, ChatGPT tab and Resume Apply window close.', confirmLabel:'Move to Failed', tone:'danger'}))) return false;
      if (action === 'confirmResume' && !(await ask({title:'Export this resume?', subject:jobName(job), message:'Exports the resume ChatGPT wrote as PDF and DOCX. Review it first if you have not.', confirmLabel:'Export'}))) return false;
      const active = token;
      try {
        await window.api.extensionCommand({profileId:currentProfile.id,jobId:job.id,action});
        if (active === token) {$('extension-dispatch-status').textContent = `${COMMAND_LABELS[action]} sent to ${jobName(job)}.`;await refreshConnections();}
        return true;
      } catch (error) {if (active === token) $('extension-dispatch-status').textContent = error.message;return false;}
    }
  }
  // Start over: back to To do at stage 1, its Chrome tabs closed and its progress cleared.
  async function startOver(job) {
    if (!(await ask({title:'Start this application over?', subject:jobName(job), message:'This stops it, closes its Chrome tabs, clears its progress and history, and puts it back in To do.', confirmLabel:'Start over', tone:'danger'}))) return false;
    const active = token;
    try {
      await window.api.extensionReset({profileId:currentProfile.id, jobId:job.id});
      if (selectedJobId === job.id) selectedJobId = null;
      if (active === token) {$('extension-dispatch-status').textContent = `${jobName(job)} is back in To do.`;await refreshConnections();}
      return true;
    } catch (error) {if (active === token) $('extension-dispatch-status').textContent = error.message;return false;}
  }
  function startOverItem(job, menu, toggle) {
    const item = el('button', MENU_ITEM_CLASS.normal, 'Start over');item.type = 'button';item.setAttribute('role', 'menuitem');item.dataset.action = 'reset';
    item.title = 'Stop this job, close its Chrome tabs, clear its progress, and put it back in To do';
    item.addEventListener('click', event => {
      event.stopPropagation();
      openMenuJobId = null;menu.hidden = true;toggle.setAttribute('aria-expanded', 'false');
      return startOver(job);
    });
    return item;
  }
  // The hiring company, editable when the job description does not name it (or names it
  // wrongly). The resume and its folder use it.
  function companyEditor(job, shown) {
    const button = el('button', 'job-card-company block max-w-full cursor-text truncate rounded-[3px] border border-transparent bg-transparent p-0 text-left text-xs text-jr-subtle hover:border-jr-border', shown || 'Add company');
    button.type = 'button';button.dataset.action = 'company';
    button.title = job.company ? 'Change the hiring company used for the resume and its folder' : 'The job description names no company: enter it for the resume and its folder';
    if (!shown) button.classList.add('!text-attention-ink');
    button.addEventListener('click', event => {
      event.stopPropagation();
      const input = el('input', 'job-company-input w-full rounded border border-line bg-bg px-1.5 py-0.5 text-xs text-ink outline-none focus:border-accent');
      input.value = job.company || shown || '';input.placeholder = 'Hiring company';input.setAttribute('aria-label', `Hiring company for ${jobName(job)}`);
      let done = false;
      const finish = async save => {
        if (done) return;done = true;
        const value = input.value.trim();
        if (save && value && value !== job.company) {
          const active = token;
          try {await window.api.extensionSetCompany({profileId:currentProfile.id, jobId:job.id, company:value});if (active === token) {$('extension-dispatch-status').textContent = `Company set to ${value}.`;await refreshConnections();}return;}
          catch (error) {if (active === token) $('extension-dispatch-status').textContent = error.message;}
        }
        input.replaceWith(button);
      };
      input.addEventListener('keydown', key => {key.stopPropagation();if (key.key === 'Enter') finish(true);if (key.key === 'Escape') finish(false);});
      input.addEventListener('click', inner => inner.stopPropagation());
      input.addEventListener('blur', () => finish(true));
      button.replaceWith(input);input.focus();input.select();
    });
    return button;
  }
  function jobMenu(job) {
    const wrap = el('div', 'job-menu-wrap relative flex-none');
    const toggle = el('button', 'btn btn-ghost btn-sm job-menu-button px-2.5 py-[5px] text-base leading-none tracking-[1px]', '⋯');toggle.type = 'button';
    toggle.title = 'More for this job';toggle.setAttribute('aria-label', `More for ${jobName(job)}`);toggle.setAttribute('aria-haspopup', 'menu');
    const menu = el('div', 'job-menu absolute right-0 top-[calc(100%+4px)] z-[5] [&.is-up]:bottom-[calc(100%+4px)] [&.is-up]:top-auto flex min-w-[200px] flex-col rounded-[10px] border border-line bg-elev p-1.5 shadow-soft');menu.setAttribute('role', 'menu');
    // The job's details panel in the app.
    const view = el('button', MENU_ITEM_CLASS.normal, 'View details');view.type = 'button';view.setAttribute('role', 'menuitem');view.dataset.action = 'view-details';
    view.title = 'What it is doing, its stages, history and every step, here in the app';
    view.addEventListener('click', event => {event.stopPropagation();openMenuJobId = null;menu.hidden = true;toggle.setAttribute('aria-expanded', 'false');openDetails(job.id);});
    menu.append(view);
    for (const action of ['details', 'open', ...(job.exported ? ['replaceResume'] : []), 'reset', 'complete', 'fail']) {
      if (action === 'reset') {menu.append(startOverItem(job, menu, toggle));continue;}
      const item = commandButton(job, action, false);item.className = MENU_ITEM_CLASS[['complete','fail'].includes(action) ? 'danger' : 'normal'];item.setAttribute('role', 'menuitem');
      item.addEventListener('click', () => {openMenuJobId = null;menu.hidden = true;toggle.setAttribute('aria-expanded', 'false');});
      menu.append(item);
    }
    const isOpen = openMenuJobId === job.id;
    menu.hidden = !isOpen;toggle.setAttribute('aria-expanded', String(isOpen));
    toggle.addEventListener('click', event => {
      event.stopPropagation();
      const show = menu.hidden;
      document.querySelectorAll('#extension-job-list .job-menu').forEach(other => {other.hidden = true;});
      document.querySelectorAll('#extension-job-list .job-menu-button').forEach(other => other.setAttribute('aria-expanded', 'false'));
      menu.hidden = !show;toggle.setAttribute('aria-expanded', String(show));openMenuJobId = show ? job.id : null;
      if (show) placeMenu(menu);
      if (show) menu.querySelector('button:not(:disabled)')?.focus();
    });
    wrap.append(toggle, menu);
    return wrap;
  }
  function reviewButton(job) {
    const button = el('button', 'btn btn-sm btn-primary', COMMAND_LABELS.review);button.type = 'button';button.dataset.action = 'review';
    button.title = 'Read the resume ChatGPT wrote, then export it';
    button.addEventListener('click', () => openReview(job));
    return button;
  }
  // ---------- Review the resume ChatGPT wrote, in the app ----------
  // Text with the resume's **bold** markers shown as bold.
  function rich(text) {
    const box = document.createDocumentFragment();
    String(text || '').split(/(\*\*[^*]+\*\*)/).forEach(part => {
      if (/^\*\*[^*]+\*\*$/.test(part)) box.append(el('strong', '', part.slice(2, -2)));
      else if (part) box.append(document.createTextNode(part));
    });
    return box;
  }
  function reviewContent(resume, profile) {
    const body = document.createDocumentFragment();
    const section = (title, ...nodes) => {const box = el('section', 'review-section border-b border-line py-3.5 last:border-b-0');box.append(el('h3', 'mb-2 mt-0 text-xs font-bold uppercase tracking-[0.06em] text-muted', title), ...nodes);body.append(box);};
    const head = el('div', 'review-head mb-1 border-b border-line pb-3');
    head.append(el('p', 'review-headline m-0 text-xl font-bold', resume.title || ''), el('p', 'muted small mb-0 mt-0.5', resume.company ? `For ${resume.company}` : ''));
    body.append(head);
    if (resume.summary) {const p = el('p', 'review-summary m-0');p.append(rich(resume.summary));section('Summary', p);}
    if (resume.skills.length) {
      const list = el('dl', 'review-skills m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm');
      for (const group of resume.skills) {const [name, values] = Object.entries(group)[0];list.append(el('dt', 'font-semibold', name), el('dd', 'm-0', values.join(' · ')));}
      section('Skills', list);
    }
    const roles = window.App.Resume.experience(profile, resume);
    if (roles.length) {
      const list = el('div', 'review-roles flex flex-col gap-[18px]');
      for (const role of roles) {
        const box = el('article', 'review-role');
        const top = el('div', 'review-role-top flex flex-wrap justify-between gap-x-3 gap-y-1');
        top.append(el('strong', '', [role.title, role.company].filter(Boolean).join(' — ')), el('span', 'muted small', [role.period, role.location].filter(Boolean).join(' · ')));
        box.append(top);
        if (role.overview) {const p = el('p', 'review-overview my-1.5');p.append(rich(role.overview));box.append(p);}
        if (role.sentences.length) {const ul = el('ul', 'my-1.5 list-disc pl-5');for (const line of role.sentences) {const li = el('li', 'my-[3px]');li.append(rich(line));ul.append(li);}box.append(ul);}
        if (role.technologies.length) box.append(el('p', 'review-tech mb-0 mt-1.5 text-xs text-muted', role.technologies.join(' · ')));
        list.append(box);
      }
      section('Experience', list);
    }
    if (resume.education.length) {const ul = el('ul', 'my-0 list-disc pl-5');for (const item of resume.education) ul.append(el('li', 'my-[3px]', item.degree));section('Education', ul);}
    return body;
  }
  const prettyJson = text => {try {return JSON.stringify(JSON.parse(text), null, 2);} catch (_) {return text;}};
  const reviewText = () => reviewEdited != null ? reviewEdited : reviewOriginal;
  function openReview(job) {
    reviewJobId = job.id;
    reviewOriginal = prettyJson(job.pendingResume || '');reviewEdited = null;reviewEditing = false;
    $('resume-review-for').textContent = jobName(job);
    renderReview();
    $('resume-review').classList.remove('hidden');
    $('resume-review-confirm').focus();
  }
  // Shows the resume as it will be exported, or the JSON to edit: any part of it, or paste
  // a whole new one.
  function renderReview() {
    const box = $('resume-review-body');box.replaceChildren();
    const edit = $('resume-review-edit');
    if (edit) edit.textContent = reviewEditing ? 'Preview' : 'Edit JSON';
    const undo = $('resume-review-undo');
    if (undo) undo.hidden = reviewEdited == null;
    if (reviewEditing) {
      box.append(el('p', 'muted small mb-2 mt-0', 'Edit any part of the resume JSON, or replace all of it. Click Preview to check it, then Confirm & export.'));
      const area = el('textarea', 'review-json h-[calc(100%-3rem)] min-h-[300px] w-full rounded-lg border border-line bg-bg p-3 font-mono text-xs');
      area.id = 'resume-review-json';area.spellcheck = false;area.value = reviewText();
      area.addEventListener('input', () => {reviewEdited = area.value.trim() === reviewOriginal.trim() ? null : area.value;if (undo) undo.hidden = reviewEdited == null;});
      box.append(area);
      $('resume-review-confirm').disabled = false;
      return;
    }
    let resume = null;
    try {resume = window.App.Resume.parse(reviewText(), currentProfile);}
    catch (error) {
      box.append(el('p', 'json-error m-0 whitespace-pre-wrap border-t border-danger-line bg-danger-bg px-3.5 py-2.5 font-mono text-[12.5px] text-danger-hover', `This resume cannot be exported as it is: ${error.message} Click Edit JSON to fix it, or ask ChatGPT again.`));
      if (reviewText()) box.append(el('pre', 'review-raw whitespace-pre-wrap rounded-lg border border-line bg-bg p-3 text-xs [overflow-wrap:anywhere]', reviewText()));
    }
    if (resume) box.append(reviewContent(resume, currentProfile));
    $('resume-review-confirm').disabled = !resume;
    box.scrollTop = 0;
  }
  // Closing it yourself with edits asks first; closing it for you (the job ended, another
  // profile opened) does not.
  function closeReview(options) {
    if (!(options && options.force) && reviewJobId && reviewEdited != null) {
      ask({title:'Discard your edits?', message:'Your changes to this resume JSON will be lost.', confirmLabel:'Discard', tone:'danger'}).then(ok => {if (ok) closeReview({force:true});});
      return;
    }
    reviewJobId = null;reviewEdited = null;reviewEditing = false;
    const panel = $('resume-review');if (panel && panel.classList) panel.classList.add('hidden');
  }
  // The same "Company name needed" dialog as manual mode. Resolves with the name, or null.
  function askCompany() {
    return new Promise(resolve => {
      const modal = $('company-modal'), input = $('company-input'), confirmBtn = $('company-confirm');
      if (!modal || !input || !confirmBtn) {resolve(null);return;}
      const label = confirmBtn.textContent;
      confirmBtn.textContent = 'Export resume';
      input.value = '';input.style.borderColor = '';
      let settled = false;
      const finish = value => {
        if (settled) return;settled = true;
        modal.classList.add('hidden');confirmBtn.textContent = label;
        confirmBtn.removeEventListener('click', onConfirm);input.removeEventListener('keydown', onKey);document.removeEventListener('keydown', onEscape, true);
        modal.querySelectorAll('[data-company-close]').forEach(node => node.removeEventListener('click', onCancel));
        resolve(value);
      };
      const onConfirm = () => {const value = input.value.trim();if (!value) {input.style.borderColor = 'var(--danger)';input.focus();return;}finish(value);};
      const onCancel = () => finish(null);
      const onKey = event => {input.style.borderColor = '';if (event.key === 'Enter') {event.preventDefault();onConfirm();}};
      // Escape closes this dialog only, not the review behind it.
      const onEscape = event => {if (event.key === 'Escape') {event.stopPropagation();onCancel();}};
      confirmBtn.addEventListener('click', onConfirm);input.addEventListener('keydown', onKey);document.addEventListener('keydown', onEscape, true);
      modal.querySelectorAll('[data-company-close]').forEach(node => node.addEventListener('click', onCancel));
      modal.classList.remove('hidden');
      setTimeout(() => input.focus(), 0);
    });
  }
  async function reviewCommand(action) {
    const job = liveState && liveState.jobs.find(item => item.id === reviewJobId);
    if (!job) {closeReview({force:true});return;}
    const active = token;
    const edited = action === 'confirmResume' && reviewEdited != null ? reviewEdited : null;
    let resume = null;
    if (action === 'confirmResume') {
      // Checked here first, so a mistake is shown while your edits are still open.
      try {resume = window.App.Resume.parse(edited != null ? edited : reviewOriginal, currentProfile);}
      catch (error) {if (edited != null) {reviewEditing = false;renderReview();$('extension-dispatch-status').textContent = `Your edited resume can't be exported: ${error.message}`;return;}}
    }
    // Neither the job nor the resume names the hiring company: ask for it, as manual mode does.
    if (resume && !String(job.company || '').trim() && !String(resume.company || '').trim()) {
      const company = await askCompany();
      if (!company) return;
      try {await window.api.extensionSetCompany({profileId:currentProfile.id, jobId:job.id, company});job.company = company;}
      catch (error) {$('extension-dispatch-status').textContent = error.message;return;}
    }
    try {
      await window.api.extensionCommand({profileId:currentProfile.id,jobId:job.id,action,...(edited != null ? {response:edited} : {})});
      if (action === 'confirmResume') reviewEdited = null;
      closeReview();
      if (active === token) {$('extension-dispatch-status').textContent = action === 'confirmResume' ? `Exporting the resume for ${jobName(job)}.` : `Showing ${jobName(job)} in Chrome.`;await refreshConnections();}
    } catch (error) {if (active === token) $('extension-dispatch-status').textContent = error.message;}
  }
  // The card's left edge: a straight border in its status colour (its left corners are square,
  // so the edge runs the card's full height).
  const STRIPE = {
    todo: 'border-l-lz-neutral-solid', busy: 'border-l-lz-info-solid', idle: 'border-l-lz-info-solid',
    attention: 'border-l-lz-warning-solid', review: 'border-l-lz-discovery-solid',
    done: 'border-l-lz-success-solid', failed: 'border-l-lz-danger-solid',
  };
  // The lozenge for a job: its column's state, with Review for one waiting on your check.
  const lozengeKind = job => !job ? 'todo' : !isOpen(job) ? (failed(job) ? 'failed' : 'done') : reviewing(job) ? 'review' : lane(job);
  const lastChange = job => job && ((job.events || []).at(-1)?.at || (job.progress && job.progress.at));
  // Sends a never-sent (or ended) job to Chrome.
  function sendButton(link, job) {
    const send = el('button', job ? 'btn btn-ghost btn-sm' : 'btn btn-primary btn-sm', job ? 'Send again' : 'Send');send.type = 'button';send.dataset.action = 'send';
    send.title = 'Open this job in Chrome with its own ChatGPT chat';
    send.addEventListener('click', async event => {
      event.stopPropagation();
      send.disabled = true;
      if (!(await sendJob(link))) send.disabled = false;
    });
    return send;
  }
  // Sends a job link to the linked browser. Resolves true when sent. Buttons and drops share it.
  async function sendJob(link) {
    const active = token, profile = currentProfile;
    try {
      const connectionId = $('extension-target').value;
      if (!connectionId) throw new Error('Link a browser first: pair it with the code at the top.');
      let style = {};
      try {style = JSON.parse(localStorage.getItem(`style:${profile.id}:${profile.templateId || 'classic'}`) || '{}');} catch (_) { /* use defaults */ }
      await window.api.extensionAssign({profileId:profile.id,url:link,connectionId,style});
      if (active !== token) return true;
      $('extension-dispatch-status').textContent = `Sent ${jobName({url:link})}. Chrome opens it in its own window.`;
      await refreshConnections();
      return true;
    } catch (error) {if (active === token) $('extension-dispatch-status').textContent = error.message;return false;}
  }
  // Small Atlassian-style buttons: blue for the main step, subtle grey for the rest.
  const BUTTONS = '[&_.btn]:h-7 [&_.btn]:rounded-md [&_.btn]:border-0 [&_.btn]:px-2.5 [&_.btn]:text-xs [&_.btn]:font-semibold [&_.btn-ghost]:bg-jr-neutral [&_.btn-ghost]:text-jr-subtle [&_.btn-ghost:hover]:bg-jr-neutral-hover [&_.btn-primary]:bg-jr-brand [&_.btn-primary]:text-jr-on-brand [&_.btn-primary:hover]:bg-jr-brand-hover';
  // One card per saved job. The board shows only what you need to scan it; the full story is
  // in the job's details panel, which a click on the card opens.
  function jobCard(link, job) {
    const identity = jobIdentity(job, link);
    const open = job && isOpen(job);
    const lanes = lane(job);
    const [stateText] = job ? jobState(job) : ['Not sent yet', 'idle'];
    const row = el('article', `${CARD_CLASS[lanes]} ${STRIPE[lozengeKind(job)]}`);row.dataset.url = link;
    row.dataset.stage = String(job && open ? STAGES_DONE[job.status] || 0 : 0);
    // What it is doing, in full, for scripts; people read it in the details panel.
    row.dataset.state = stateText;
    if (job) row.dataset.job = job.id;
    // Head: the site's icon, the role in bold, the company; the menu shows when you point at it
    const head = el('div', 'job-card-top flex items-start gap-2.5');
    const names = el('div', 'job-card-names flex min-w-0 flex-1 flex-col gap-0.5 pt-px');
    const title = el('strong', 'job-card-title line-clamp-2 text-[14px] font-semibold leading-5 text-jr-text decoration-jr-subtlest decoration-1 underline-offset-[3px] [overflow-wrap:anywhere] group-[.is-clickable:hover]/card:underline', identity.title || 'Untitled job');
    if (!identity.title) title.classList.add('!font-medium', '!text-jr-subtlest');
    const system = siteOf(link).name;
    const who = el('span', 'flex min-w-0 items-center gap-1 text-xs text-jr-subtle');
    who.append(el('span', 'job-card-company min-w-0 truncate', identity.company || identity.host || '—'));
    if (system) who.append(el('span', 'job-card-site shrink-0 text-jr-subtlest', `· ${system}`));
    names.append(title, who);
    const tools = el('div', 'job-row-tools -mr-1 -mt-0.5 flex flex-none justify-end opacity-0 transition-opacity focus-within:opacity-100 group-hover/card:opacity-100 has-[[aria-expanded=true]]:opacity-100 [&_.btn]:h-7 [&_.btn]:min-w-7 [&_.btn]:rounded-md [&_.btn]:border-0 [&_.btn]:bg-transparent [&_.btn]:px-1.5 [&_.btn]:text-jr-subtle [&_.btn:hover]:bg-jr-neutral-hover');
    if (open && window.api && window.api.extensionCommand) tools.append(jobMenu(job));
    else if (saveLinks) {
      const remove = el('button', 'btn btn-ghost btn-sm ext-link-remove text-[15px] leading-none', '×');remove.type = 'button';
      remove.title = 'Remove this link';remove.setAttribute('aria-label', `Remove ${link}`);
      remove.addEventListener('click', event => {event.stopPropagation();return keepOnly(workflow.normalizeJobLinks(currentProfile.extensionJobLinks).filter(other => other !== link), 'Link removed.');});
      tools.append(remove);
    }
    head.append(avatar(identity), names, tools);
    // Status: one lozenge, and how far it got
    const meta = el('div', 'job-card-meta flex min-w-0 items-center gap-2.5');
    meta.append(pill(lozengeKind(job)));
    if (job && (open || !failed(job))) meta.append(progressBar(job));
    // Foot: when it last changed on the left, the next steps on the right
    const foot = el('div', 'job-card-foot flex min-h-7 flex-wrap items-center justify-between gap-x-2 gap-y-1.5');
    const changed = lastChange(job);
    foot.append(el('span', 'job-card-updated shrink-0 whitespace-nowrap text-[11px] text-jr-subtlest', changed ? ago(changed) : ''));
    const actions = el('div', `job-card-actions ml-auto flex flex-wrap justify-end gap-1.5 ${BUTTONS}`);
    let steps = 0;
    if (open && window.api && window.api.extensionCommand) {
      availableSteps(job).forEach((action, index) => {actions.append(action === 'review' ? reviewButton(job) : commandButton(job, action, index === 0));steps++;});
    } else if (window.api && window.api.extensionAssign) {actions.append(sendButton(link, job));steps++;}
    actions.addEventListener('click', event => event.stopPropagation());
    foot.append(actions);
    row.append(head, meta, foot);
    if (!changed && !steps) foot.hidden = true;
    // Drag a card to another column (see moveRule); a plain click opens its details.
    row.addEventListener('pointerdown', event => startCardDrag(event, row, link, job));
    // The card's tooltip says what it is doing in a few words; a click opens its details.
    row.title = job ? clickHint(job) : 'Not sent yet';
    if (job) {
      row.classList.add('is-clickable');row.tabIndex = 0;
      row.setAttribute('aria-label', `${identity.title || 'Job'}${identity.company ? ' at ' + identity.company : ''}: ${headline(job)}. Open details.`);
      if (job.id === selectedJobId) markSelected(row);
      if (job.id === detailsJobId) row.classList.add('is-active');
      row.addEventListener('click', event => {if (!suppressClick && !event.target.closest('button, a, input, select, textarea, details')) activate(job);});
      row.addEventListener('keydown', event => {if ((event.key === 'Enter' || event.key === ' ') && event.target === row) {event.preventDefault();activate(job);}});
    }
    return row;
  }
  // ---------- Drag a card to another column ----------
  // A drop does what the matching button does, with the same questions first. Which moves make
  // sense, and why the others do not:
  const NAMES = Object.fromEntries(COLUMNS);
  function moveRule(from, to, link, job) {
    if (from === to) return {self:true};
    const linked = () => !!($('extension-target') && $('extension-target').value);
    if (to === 'waiting') return {reason:'Jobs move to Waiting on You by themselves, when they need you.'};
    if (from === 'todo') {
      if (to !== 'progress') return {reason:'It was never sent. Drag it to In Progress first.'};
      return linked() ? {action:'send', label:'Send to Chrome'} : {reason:'Link a browser first: pair it with the code at the top.'};
    }
    if (from === 'progress' || from === 'waiting') {
      if (to === 'done') return {action:'complete', label:'Complete'};
      if (to === 'failed') return {action:'fail', label:'Move to Failed'};
      if (to === 'todo') return {action:'reset', label:'Start over'};
      return {reason:'Do what it is waiting for (open its details); it moves on by itself.'};
    }
    // Done or Failed
    if (to === 'progress') return linked() ? {action:'send', label:'Send again'} : {reason:'Link a browser first: pair it with the code at the top.'};
    if (to === 'todo') return {reason:'An ended application stays on record. Drag it to In Progress to send it again.'};
    return {reason:'An ended application keeps its outcome.'};
  }
  async function runMove(rule, link, job) {
    if (rule.action === 'send') return sendJob(link);
    if (rule.action === 'reset') return startOver(job);
    return runCommand(job, rule.action);
  }
  let drag = null, suppressClick = false;
  const DRAG_START = 6;
  const SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)', GLIDE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
  function startCardDrag(event, card, link, job) {
    if (event.button !== 0 || viewMode() !== 'board' || event.target.closest('button, a, input, select, textarea, details')) return;
    const from = card.closest('[data-column]')?.dataset.column;
    if (!from) return;
    drag = {card, link, job, from, startX:event.clientX, startY:event.clientY, started:false, over:null};
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragCancel);
  }
  function beginDrag() {
    const {card} = drag, rect = card.getBoundingClientRect();
    drag.rect = rect;drag.offsetX = drag.startX - rect.left;drag.offsetY = drag.startY - rect.top;
    // The card lifts: an upright copy follows the pointer, and a dashed outline keeps its place.
    const ghost = card.cloneNode(true);
    ghost.classList.add('job-drag-ghost');ghost.classList.remove('is-arrived', 'is-active', 'is-selected');
    Object.assign(ghost.style, {left:`${rect.left}px`, top:`${rect.top}px`, width:`${rect.width}px`, height:`${rect.height}px`});
    document.body.append(ghost);
    // It lifts over a short moment, then follows the pointer exactly.
    drag.dx = 0;drag.dy = 0;drag.lift = 1;
    ghost.style.transition = `transform 180ms ${GLIDE}`;
    setTimeout(() => {if (drag && drag.ghost === ghost) ghost.style.transition = 'none';}, 190);
    const hint = el('div', 'job-drag-hint');document.body.append(hint);
    drag.ghost = ghost;drag.hint = hint;
    placeGhost();
    card.classList.add('is-drag-source');
    document.body.classList.add('is-dragging-card');
    // Every column says whether this card may go there.
    document.querySelectorAll('#extension-job-list .ext-column[data-column]').forEach(column => {
      const rule = moveRule(drag.from, column.dataset.column, drag.link, drag.job);
      column.dataset.drop = rule.self ? 'self' : rule.action ? 'ok' : 'no';
    });
  }
  // Where the lifted copy is: moved with the pointer, upright, a little larger.
  function placeGhost() {
    drag.ghost.style.transform = `translate(${drag.dx}px, ${drag.dy}px) scale(${1 + 0.03 * drag.lift})`;
  }
  function columnAt(x, y) {
    const hit = document.elementFromPoint(x, y);
    return hit && hit.closest ? hit.closest('#extension-job-list .ext-column[data-column]') : null;
  }
  function onDragMove(event) {
    if (!drag) return;
    if (!drag.started) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_START) return;
      drag.started = true;beginDrag();
    }
    event.preventDefault();
    drag.dx = event.clientX - drag.startX;drag.dy = event.clientY - drag.startY;
    placeGhost();
    const column = columnAt(event.clientX, event.clientY);
    if (column !== drag.over) {
      drag.over?.classList.remove('is-drop-hover');
      drag.over = column;column?.classList.add('is-drop-hover');
    }
    const rule = column ? moveRule(drag.from, column.dataset.column, drag.link, drag.job) : null;
    const hint = drag.hint;
    hint.textContent = !rule ? '' : rule.self ? 'Drop to keep it here' : rule.action ? `Drop to ${rule.label}` : rule.reason;
    hint.dataset.tone = !rule || rule.self ? 'quiet' : rule.action ? 'ok' : 'no';
    hint.hidden = !rule;
    Object.assign(hint.style, {left:`${event.clientX + 16}px`, top:`${event.clientY + 18}px`});
  }
  function finishDrag() {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragCancel);
    document.body.classList.remove('is-dragging-card');
    document.querySelectorAll('#extension-job-list .ext-column[data-drop]').forEach(column => {delete column.dataset.drop;column.classList.remove('is-drop-hover');});
    drag?.hint?.remove();
  }
  // Springs the copy back to where the card was, then shows the card again.
  function returnGhost(state, refused) {
    const {ghost, card} = state;
    const go = () => {
      ghost.style.transition = `transform 420ms ${SPRING}, box-shadow 420ms`;
      ghost.style.transform = 'translate(0, 0) scale(1)';
      setTimeout(() => {ghost.remove();card.classList.remove('is-drag-source');}, 430);
    };
    if (refused) {ghost.classList.add('is-refused');setTimeout(go, 300);} else go();
  }
  async function onDragEnd(event) {
    const state = drag;
    if (!state) return;
    finishDrag();
    drag = null;
    if (!state.started) return;
    // The click that ends a drag does not also open the card.
    suppressClick = true;setTimeout(() => {suppressClick = false;}, 0);
    const column = columnAt(event.clientX, event.clientY);
    const rule = column ? moveRule(state.from, column.dataset.column, state.link, state.job) : null;
    if (!rule || rule.self) {returnGhost(state, false);renderJobs(shownLinks);return;}
    if (!rule.action) {
      $('extension-dispatch-status').textContent = rule.reason;
      returnGhost(state, true);renderJobs(shownLinks);return;
    }
    // Allowed: the copy flies into its new column and fades; the card follows once it is done.
    const area = column.querySelector('.ext-column-cards') || column, box = area.getBoundingClientRect();
    const tx = box.left + 8 - state.rect.left, ty = box.top + 8 - state.rect.top;
    state.ghost.style.transition = `transform 320ms ${GLIDE}, opacity 320ms ease-out`;
    state.ghost.style.transform = `translate(${tx}px, ${ty}px) scale(0.96)`;
    state.ghost.style.opacity = '0';
    setTimeout(() => state.ghost.remove(), 330);
    const done = await runMove(rule, state.link, state.job);
    state.card.classList.remove('is-drag-source');
    // Cancelled or failed: the card wiggles where it stayed.
    if (!done) {state.card.classList.add('is-bounced');setTimeout(() => state.card.classList.remove('is-bounced'), 500);}
    renderJobs(shownLinks);
  }
  function onDragCancel() {
    const state = drag;
    finishDrag();drag = null;
    if (state && state.started) {returnGhost(state, false);renderJobs(shownLinks);}
  }
  // A click on a job: one open in Chrome comes to the front there; an ended one (no window)
  // opens its details. Details of an open job are in its menu.
  const activate = job => isOpen(job) && window.api && window.api.extensionCommand ? showInChrome(job) : openDetails(job.id);
  const clickHint = job => isOpen(job) ? `${headline(job)}: click to show it in Chrome` : `${headline(job)}: click for details`;
  // The card whose job you brought to the front in Chrome.
  function markSelected(card) {
    card.classList.add('is-selected');card.setAttribute('aria-current', 'true');
    if (!card.querySelector('.job-card-selected')) card.querySelector('.job-card-names')?.append(el('span', 'job-card-selected hidden', 'In front'));
  }
  async function showInChrome(job) {
    const active = token;
    selectedJobId = job.id;
    document.querySelectorAll('#extension-job-list .is-selected[data-job]').forEach(other => {other.classList.remove('is-selected');other.removeAttribute('aria-current');other.querySelector('.job-card-selected')?.remove();});
    document.querySelectorAll(`#extension-job-list [data-job="${CSS.escape(job.id)}"]`).forEach(markSelected);
    try {await window.api.extensionCommand({profileId:currentProfile.id,jobId:job.id,action:'focus'});if (active === token) $('extension-dispatch-status').textContent = `Showing ${jobName(job)} in Chrome.`;}
    catch (error) {if (active === token && !/already waiting/.test(error.message)) $('extension-dispatch-status').textContent = error.message;}
  }
  // ---------- The job's details panel ----------
  // Slides in from the right over the board: what the job is doing (a headline, then the full
  // message), its six stages, the last step's result, its history, and every step you can take.
  // It follows the job live while open.
  function openDetails(id) {
    const panel = $('job-details');
    if (!panel) return;
    detailsJobId = id;
    document.querySelectorAll('#extension-job-list .is-active[data-job]').forEach(card => card.classList.remove('is-active'));
    document.querySelectorAll(`#extension-job-list [data-job="${CSS.escape(id)}"]`).forEach(card => card.classList.add('is-active'));
    const wasHidden = panel.classList.contains('hidden');
    renderDetails();
    panel.classList.remove('hidden');
    if (wasHidden) {$('job-details-body').scrollTop = 0;$('job-details-close')?.focus?.();}
  }
  function closeDetails() {
    const id = detailsJobId;
    detailsJobId = null;
    $('job-details')?.classList?.add('hidden');
    if (!document.querySelectorAll) return;
    document.querySelectorAll('#extension-job-list .is-active[data-job]').forEach(card => card.classList.remove('is-active'));
    if (id) document.querySelector(`#extension-job-list [data-job="${CSS.escape(id)}"]`)?.focus?.();
  }
  function detailsSection(title, ...nodes) {
    const box = el('section', 'job-details-section mt-6 first:mt-0');
    box.append(el('h3', 'mb-2 mt-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted', title), ...nodes);
    return box;
  }
  function renderDetails() {
    if (!detailsJobId || !$('job-details')) return;
    const job = liveState && liveState.jobs.find(item => item.id === detailsJobId);
    if (!job) {closeDetails();return;}
    const identity = jobIdentity(job, job.url), open = isOpen(job);
    $('job-details-icon').replaceChildren(avatar(identity, 'lg'));
    $('job-details-title').textContent = identity.title || 'Untitled job';
    $('job-details-company').replaceChildren(open && window.api && window.api.extensionSetCompany ? companyEditor(job, identity.company)
      : el('span', 'job-card-company text-sm text-muted', identity.company || '—'));
    const host = $('job-details-host'), system = siteOf(job.url);
    host.textContent = [identity.host || job.url, system.name && `${system.name} · ${system.rank <= 20 ? 'one-page form' : system.rank >= 80 ? 'multi-page form' : 'form'}`].filter(Boolean).join(' · ');host.title = job.url;
    const body = $('job-details-body'), scroll = body.scrollTop;
    // Now: the lozenge, a headline, the full message, and when it changed
    const now = el('div', 'job-details-now rounded-xl border border-line bg-sunken p-4');
    const said = headline(job), [detail] = jobState(job);
    now.append(pill(lozengeKind(job)), el('p', 'job-details-headline m-0 mt-2.5 text-[15px] font-semibold leading-snug text-ink', said));
    if (detail && detail !== said) now.append(el('p', 'job-card-state m-0 mt-1.5 text-[13px] leading-relaxed text-muted [overflow-wrap:anywhere]', detail));
    const changed = lastChange(job);
    if (changed) now.append(el('p', 'm-0 mt-2.5 text-xs text-muted', `Updated ${ago(changed)}`));
    const sections = [detailsSection('Now', now)];
    // The last step you started, and how it went
    if (job.lastCommand) {
      const last = el('p', job.lastCommand.ok ? 'job-last-command m-0 text-[13px] leading-relaxed text-ink [overflow-wrap:anywhere]' : 'job-last-command is-error m-0 text-[13px] leading-relaxed text-lz-danger [overflow-wrap:anywhere]',
        `${COMMAND_LABELS[job.lastCommand.action] || job.lastCommand.action}: ${job.lastCommand.message}`);
      last.title = `Updated ${ago(job.lastCommand.at)}`;
      sections.push(detailsSection('Last step', last));
    }
    sections.push(detailsSection('Progress', stepList(job)));
    if ((job.events || []).length) sections.push(detailsSection(`History · ${job.events.length}`, historyList(job)));
    body.replaceChildren(...sections);
    body.scrollTop = scroll;
    // Every step you can take: ending it on the left, going on with it on the right
    const footer = $('job-details-actions');
    const left = el('div', `flex flex-wrap gap-1.5 ${BUTTONS}`), right = el('div', `ml-auto flex flex-wrap justify-end gap-1.5 ${BUTTONS}`);
    if (open && window.api && window.api.extensionCommand) {
      const reset = el('button', 'btn btn-ghost btn-sm', 'Start over');reset.type = 'button';reset.dataset.action = 'reset';reset.title = 'Stop this job, close its Chrome tabs, clear its progress, and put it back in To do';
      reset.addEventListener('click', () => startOver(job));
      left.append(commandButton(job, 'complete', false), commandButton(job, 'fail', false), reset);
      const show = el('button', 'btn btn-ghost btn-sm', 'Show in Chrome');show.type = 'button';show.dataset.action = 'focus';show.title = "Bring this job's window to the front in Chrome";
      show.addEventListener('click', () => showInChrome(job));
      right.append(show, ...availableSteps(job).map((action, index) => action === 'review' ? reviewButton(job) : commandButton(job, action, index === 0)));
    } else if (window.api && window.api.extensionAssign) right.append(sendButton(job.url, job));
    footer.replaceChildren(left, right);
  }
  // ---------- Site priority ----------
  // Which application system a job link uses, and how easy its form is: one-page forms first
  // (Greenhouse, Ashby, Lever, then the other one-page systems), unknown sites in the middle,
  // multi-page forms last (Workday and ADP at the very end).
  const SITES = [
    [/(^|\.)greenhouse\.io$/, 'Greenhouse', 1], [/(^|\.)ashbyhq\.com$/, 'Ashby', 2], [/(^|\.)lever\.co$/, 'Lever', 3],
    [/(^|\.)workable\.com$/, 'Workable', 4], [/(^|\.)smartrecruiters\.com$/, 'SmartRecruiters', 5], [/(^|\.)bamboohr\.com$/, 'BambooHR', 6],
    [/(^|\.)recruitee\.com$/, 'Recruitee', 7], [/(^|\.)breezy\.hr$/, 'Breezy', 8], [/(^|\.)applytojob\.com$/, 'JazzHR', 9],
    [/(^|\.)teamtailor\.com$/, 'Teamtailor', 10], [/(^|\.)rippling\.com$/, 'Rippling', 11], [/(^|\.)jobvite\.com$/, 'Jobvite', 12],
    [/(^|\.)paylocity\.com$/, 'Paylocity', 40],
    [/(^|\.)icims\.com$/, 'iCIMS', 80], [/(^|\.)(ultipro|ukg)\.com$/, 'UKG', 82], [/(^|\.)taleo\.net$/, 'Taleo', 85],
    [/(^|\.)successfactors\.(com|eu)$|^jobs\.sap\.com$/, 'SuccessFactors', 85], [/(^|\.)oraclecloud\.com$/, 'Oracle', 88],
    [/(^|\.)dayforcehcm\.com$/, 'Dayforce', 88], [/(^|\.)adp\.com$/, 'ADP', 95], [/(^|\.)(myworkdayjobs|myworkdaysite|workday)\.com$/, 'Workday', 100],
  ];
  const UNKNOWN_SITE_RANK = 50;
  function siteOf(link) {
    let url;try {url = new URL(link);} catch (_) {return {name:'', rank:UNKNOWN_SITE_RANK};}
    const host = url.hostname.replace(/^www\./, '');
    const found = SITES.find(([pattern]) => pattern.test(host));
    if (found) return {name:found[1], rank:found[2]};
    // A company careers page with a Greenhouse form embedded in it.
    if (url.searchParams.has('gh_jid')) return {name:'Greenhouse', rank:1};
    return {name:'', rank:UNKNOWN_SITE_RANK};
  }
  // How To do orders its jobs: easiest site first (the default), or the order they were added.
  // The other columns always keep the order added.
  const SORT_KEY = 'boardSort';
  const sortMode = () => {try {return localStorage.getItem(SORT_KEY) === 'added' ? 'added' : 'site';} catch (_) {return 'site';}};
  // Where a saved job belongs.
  function lane(job) {
    if (!job) return 'unsent';
    if (!isOpen(job)) return 'done';
    if ((job.commands || []).length && browserOnline(job)) return 'busy';
    const level = jobState(job)[1];
    return level === 'attention' ? 'attention' : level === 'busy' ? 'busy' : 'idle';
  }
  let shownLinks = [];
  const sentJob = link => liveState && currentProfile ? liveState.jobs.filter(job => job.profileId === currentProfile.id && job.url === link).at(-1) : undefined;
  // ---------- Job links: added or edited in a panel that opens on request ----------
  let editingLinks = false;
  function setLinksMode(edit) {
    editingLinks = edit;
    $('extension-links-editor').hidden = !edit;
    $('extension-links-edit').textContent = edit ? 'Close editor' : '+ Add links';
  }
  async function keepOnly(keep, done) {
    const active = token;
    try {
      await saveLinks(keep);
      if (active !== token) return;
      $('extension-job-links').value = keep.join('\n');
      renderJobs(keep);
      $('extension-links-status').textContent = done;
      if (!keep.length) setLinksMode(true);
    } catch (error) {if (active === token) $('extension-links-status').textContent = error.message || 'Could not save job links.';}
  }
  // Waiting for you to check its work: the resume ChatGPT wrote, or the filled form.
  const reviewing = job => isOpen(job) && !job.failure && (job.progress && job.progress.key === 'confirm-resume' || job.status === 'filled' && lane(job) === 'idle');
  // The board column a saved job sits in.
  function column(job) {
    if (!job) return 'todo';
    // Ended: done when it went through, failed when it did not (or its browser was unlinked).
    if (!isOpen(job)) return failed(job) || job.status === 'unlinked' ? 'failed' : 'done';
    const where = lane(job);
    return reviewing(job) || where === 'attention' ? 'waiting' : 'progress';
  }
  // ---------- Board motion ----------
  // The board is drawn afresh on every refresh. Each card's place is remembered, so a card that
  // moved glides from where it was to where it is now ("FLIP"), and a card that reached a new
  // column or a further stage glows once. Nothing moves on the first drawing or when the system
  // asks for reduced motion.
  let animateNext = false;
  const calm = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function rememberPlaces(list) {
    const places = new Map();
    // A card still gliding is measured where it is going, not where it is mid-way.
    list.querySelectorAll('.job-card[data-url]').forEach(card => card.getAnimations?.().forEach(motion => motion.finish()));
    list.querySelectorAll('.job-card[data-url]').forEach(card => places.set(card.dataset.url, {rect:card.getBoundingClientRect(), column:card.closest('[data-column]')?.dataset.column, stage:Number(card.dataset.stage) || 0}));
    return places;
  }
  function animateBoard(list, before) {
    if (!animateNext || calm() || typeof Element === 'undefined' || !Element.prototype.animate) return;
    list.querySelectorAll('.job-card[data-url]').forEach(card => {
      const was = before.get(card.dataset.url);
      const columnNow = card.closest('[data-column]')?.dataset.column;
      if (!was) {
        // A job just added: it fades in where it belongs.
        card.animate([{opacity:0, transform:'translateY(8px) scale(0.98)'}, {opacity:1, transform:'none'}], {duration:260, easing:'cubic-bezier(0.2, 0.8, 0.2, 1)'});
        return;
      }
      const now = card.getBoundingClientRect();
      const dx = was.rect.left - now.left, dy = was.rect.top - now.top;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        card.animate([{transform:`translate(${dx}px, ${dy}px)`}, {transform:'none'}], {duration:dx ? 480 : 260, easing:'cubic-bezier(0.2, 0.8, 0.2, 1)'});
      }
      if (was.column && columnNow && was.column !== columnNow || (Number(card.dataset.stage) || 0) > was.stage) card.classList.add('is-arrived');
    });
  }
  // A card's menu opens upward when its column has no room for it below the card.
  function placeMenu(menu) {
    menu.classList.remove('is-up');
    const area = menu.closest('.ext-column-cards');
    if (!area || !menu.getBoundingClientRect) return;
    const box = menu.getBoundingClientRect(), room = area.getBoundingClientRect();
    if (box.bottom > room.bottom && box.top - room.top > box.height) menu.classList.add('is-up');
  }
  // The board fills the window's height below it (at least 60% of the window), and each column
  // scrolls its own cards. Re-measured when the window is resized.
  function fitBoard() {
    const list = $('extension-job-list');
    if (!list || !list.style || !list.getBoundingClientRect || typeof window.innerHeight !== 'number') return;
    if (!list.offsetParent) return;
    const top = list.getBoundingClientRect().top + window.scrollY;
    let height = Math.round(Math.min(window.innerHeight - 24, Math.max(window.innerHeight * 0.6, window.innerHeight - top - 24)));
    // On a narrower window the columns wrap onto two or three rows: each row keeps a usable
    // height (the page scrolls to the lower rows) rather than being squeezed into a strip.
    const board = list.querySelector('.ext-board');
    const columns = board && typeof getComputedStyle === 'function' ? getComputedStyle(board).gridTemplateColumns.split(' ').filter(Boolean).length : 6;
    const rows = Math.ceil(COLUMNS.length / Math.max(1, columns));
    if (rows > 1) height = Math.max(height, rows * Math.max(320, Math.round(window.innerHeight * 0.5)) + (rows - 1) * 12);
    list.style.setProperty('--board-h', `${Math.max(320, height)}px`);
  }
  // Each column's colour (the lozenge colours): its heading is tinted with it.
  const COLUMN_TONE = {
    todo: 'bg-lz-neutral-bg text-lz-neutral', progress: 'bg-lz-info-bg text-lz-info', waiting: 'bg-lz-warning-bg text-lz-warning',
    done: 'bg-lz-success-bg text-lz-success', failed: 'bg-lz-danger-bg text-lz-danger',
  };
  const COLUMN_DOT = {todo: 'bg-lz-neutral-solid', progress: 'bg-lz-info-solid', waiting: 'bg-lz-warning-solid', done: 'bg-lz-success-solid', failed: 'bg-lz-danger-solid'};
  // A column as on a Jira board: a flat grey well, its name in small capitals with the count
  // beside it on a band of the column's colour, and the cards stacked in it.
  function boardColumn([key, title], items) {
    // The column's whole top is its heading, in the column's colour, edge to edge.
    const box = el('section', 'ext-column flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl bg-jr-column');box.dataset.column = key;
    box.setAttribute('aria-label', `${title}: ${items.length}`);
    const head = el('header', `ext-column-head flex min-h-[44px] min-w-0 flex-none items-center gap-2 border-b border-black/5 px-3.5 py-2.5 ${COLUMN_TONE[key]}`);
    head.append(el('span', `h-2 w-2 flex-none rounded-full ${COLUMN_DOT[key]}`),
      el('h3', 'm-0 min-w-0 truncate whitespace-nowrap text-xs font-bold uppercase tracking-[0.04em] text-current', title),
      el('span', 'ext-column-count ml-auto min-w-[22px] rounded-full bg-jr-card px-1.5 text-center text-[11px] font-bold tabular-nums text-current', String(items.length)));
    // To do's priority: easiest sites first (one-page forms such as Greenhouse, Ashby, Lever),
    // or the order added. One click switches; the choice is kept.
    if (key === 'todo') {
      const bySite = sortMode() === 'site';
      const sort = el('button', `ext-sort -my-1 -mr-1 flex flex-none cursor-pointer items-center gap-1 rounded-md border-0 px-1.5 py-1 text-[11px] font-semibold text-current hover:bg-jr-card ${bySite ? 'bg-jr-card' : 'bg-transparent'}`);
      sort.type = 'button';sort.dataset.sort = bySite ? 'site' : 'added';
      sort.append(el('span', 'text-[13px] leading-none', '⇅'), el('span', 'ext-sort-label', bySite ? 'Priority' : 'Added'));
      sort.title = bySite ? 'Sorted by site priority: one-page forms (Greenhouse, Ashby, Lever, ...) first, multi-page forms (Workday, ADP, ...) last. Click to sort by the order added.'
        : 'Sorted by the order added. Click to sort by site priority: one-page forms first.';
      sort.setAttribute('aria-pressed', String(bySite));
      sort.addEventListener('click', () => {try {localStorage.setItem(SORT_KEY, bySite ? 'added' : 'site');} catch (_) { /* not kept */ }renderJobs(shownLinks);});
      head.append(sort);
    }
    // Only the cards scroll; the column's heading stays put. A little padding keeps the cards'
    // shadows and a selected card's ring from being clipped.
    const cards = el('div', 'ext-column-cards flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overscroll-contain p-2');
    if (items.length) cards.append(...items.map(([link, job]) => jobCard(link, job)));
    else cards.append(el('p', 'ext-column-empty m-0 px-2 py-4 text-center text-xs text-jr-subtlest', 'No jobs'));
    // Like Jira's "+ Create" at the foot of the first column: add job links.
    if (key === 'todo' && saveLinks) {
      const add = el('button', 'ext-column-add mx-2 mb-2 flex flex-none cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-2 py-1.5 text-left text-[13px] font-medium text-jr-subtle hover:bg-jr-neutral-hover', '+ Add links');add.type = 'button';
      add.addEventListener('click', () => {setLinksMode(true);$('extension-job-links').focus?.();$('extension-links-editor').scrollIntoView?.({block:'nearest', behavior:'smooth'});});
      box.append(head, cards, add);
      return box;
    }
    box.append(head, cards);
    return box;
  }

  // ---------- Board or table ----------
  // The same jobs as cards in columns, or as one table grouped by the same states. Kept per viewer.
  const VIEW_KEY = 'boardView';
  const viewMode = () => {try {return localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'board';} catch (_) {return 'board';}};
  function syncViewSwitch() {
    if (!document.querySelectorAll) return;
    document.querySelectorAll('.ext-view-option').forEach(option => option.setAttribute('aria-checked', String(option.dataset.view === viewMode())));
  }
  const TH = 'border-b border-line bg-elev px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.5px] text-muted';
  function jobRow(link, job) {
    const identity = jobIdentity(job, link), open = job && isOpen(job), lanes = lane(job);
    const row = el('tr', `job-row group/card border-b border-line transition-colors last:border-b-0 hover:bg-jr-card-hover [&.is-active]:bg-jr-selected [&.is-selected]:bg-jr-selected`);
    row.dataset.url = link;row.dataset.state = job ? jobState(job)[0] : 'Not sent yet';
    if (job) row.dataset.job = job.id;
    const cell = (className, ...nodes) => {const td = el('td', `px-3 py-2.5 align-middle ${className}`);td.append(...nodes);return td;};
    // Job: icon, role in bold, company
    const who = el('div', 'flex min-w-0 items-center gap-2.5');
    const names = el('div', 'flex min-w-0 flex-col');
    names.append(el('strong', `job-card-title truncate text-[13px] font-semibold ${identity.title ? 'text-jr-text' : 'font-medium text-jr-subtlest'}`, identity.title || 'Untitled job'),
      el('span', 'job-card-company truncate text-xs text-jr-subtle', identity.company || identity.host || '—'));
    who.append(avatar(identity), names);
    const first = cell(`border-l-[3px] border-solid ${STRIPE[lozengeKind(job)]} max-w-[360px]`, who);
    // Progress, site, when
    const progress = job && (open || !failed(job)) ? progressBar(job) : el('span', 'text-jr-subtlest', '—');
    const system = siteOf(link).name || identity.host || '';
    const changed = lastChange(job);
    // Steps, and the menu (or remove)
    const actions = el('div', `job-card-actions flex flex-nowrap items-center justify-end gap-1.5 ${BUTTONS}`);
    if (open && window.api && window.api.extensionCommand) availableSteps(job).forEach((action, index) => actions.append(action === 'review' ? reviewButton(job) : commandButton(job, action, index === 0)));
    else if (window.api && window.api.extensionAssign) actions.append(sendButton(link, job));
    const tools = el('div', 'job-row-tools flex flex-none [&_.btn]:h-7 [&_.btn]:min-w-7 [&_.btn]:rounded-md [&_.btn]:border-0 [&_.btn]:bg-transparent [&_.btn]:px-1.5 [&_.btn]:text-jr-subtle [&_.btn:hover]:bg-jr-neutral-hover');
    if (open && window.api && window.api.extensionCommand) tools.append(jobMenu(job));
    else if (saveLinks) {
      const remove = el('button', 'btn btn-ghost btn-sm ext-link-remove text-[15px] leading-none', '×');remove.type = 'button';
      remove.title = 'Remove this link';remove.setAttribute('aria-label', `Remove ${link}`);
      remove.addEventListener('click', event => {event.stopPropagation();return keepOnly(workflow.normalizeJobLinks(currentProfile.extensionJobLinks).filter(other => other !== link), 'Link removed.');});
      tools.append(remove);
    }
    const end = el('div', 'flex items-center justify-end gap-1');end.append(actions, tools);
    end.addEventListener('click', event => event.stopPropagation());
    row.append(first, cell('w-[120px]', pill(lozengeKind(job))), cell('w-[190px]', progress),
      cell('w-[130px] truncate text-xs text-jr-subtle', system), cell('w-[90px] whitespace-nowrap text-xs text-jr-subtlest', changed ? ago(changed) : ''), cell('w-[1%] whitespace-nowrap', end));
    if (job) {
      row.classList.add('cursor-pointer');row.tabIndex = 0;row.title = clickHint(job);
      if (job.id === selectedJobId) row.classList.add('is-selected');
      if (job.id === detailsJobId) row.classList.add('is-active');
      row.addEventListener('click', event => {if (!event.target.closest('button, a, input, select, textarea')) activate(job);});
      row.addEventListener('keydown', event => {if ((event.key === 'Enter' || event.key === ' ') && event.target === row) {event.preventDefault();activate(job);}});
    }
    return row;
  }
  function jobsTable(byColumn) {
    const wrap = el('div', 'ext-jobs-table rounded-xl border border-line bg-jr-card shadow-jr');
    const table = el('table', 'w-full border-collapse text-[13px]');
    const head = el('tr');
    for (const [name, extra] of [['Job', 'rounded-tl-xl'], ['Status', ''], ['Progress', ''], ['Site', ''], ['Updated', ''], ['', 'rounded-tr-xl']]) head.append(el('th', `${TH} ${extra}`, name));
    const thead = el('thead');thead.append(head);table.append(thead);
    // One group per state, in the board's order, under the same coloured heading.
    for (const [key, title] of COLUMNS) {
      const items = byColumn[key];
      if (!items.length) continue;
      const body = el('tbody', `ext-group`);body.dataset.column = key;
      const band = el('tr');
      const bandCell = el('td', `ext-column-head px-3 py-2 ${COLUMN_TONE[key]}`);bandCell.colSpan = 6;
      const label = el('div', 'flex items-center gap-2');
      label.append(el('span', `h-2 w-2 flex-none rounded-full ${COLUMN_DOT[key]}`), el('span', 'text-xs font-bold uppercase tracking-[0.04em]', title), el('span', 'ext-column-count min-w-[22px] rounded-full bg-jr-card px-1.5 text-center text-[11px] font-bold tabular-nums', String(items.length)));
      bandCell.append(label);band.append(bandCell);body.append(band);
      body.append(...items.map(([link, job]) => jobRow(link, job)));
      table.append(body);
    }
    wrap.append(table);
    return wrap;
  }
  function renderJobs(links) {
    shownLinks = links;
    // Not while a card is in your hand; the board catches up when you drop it.
    if (drag && drag.started) return;
    $('extension-job-count').textContent = String(links.length);
    $('extension-jobs-empty').hidden = links.length > 0;
    const list = $('extension-job-list');
    if (!links.length) {list.replaceChildren();return;}
    const byColumn = Object.fromEntries(COLUMNS.map(([key]) => [key, []]));
    for (const link of links) {const job = sentJob(link);byColumn[column(job)].push([link, job]);}
    // To do: easiest sites first, so they are sent first; the same site keeps the order added.
    if (sortMode() === 'site') byColumn.todo.sort((a, b) => siteOf(a[0]).rank - siteOf(b[0]).rank);
    syncViewSwitch();
    if (viewMode() === 'table') {
      list.replaceChildren(jobsTable(byColumn));
      renderDetails();
      animateNext = !!liveState;
      return;
    }
    const before = rememberPlaces(list);
    // Each column's scroll position, kept across the refresh.
    const scrolled = new Map();
    list.querySelectorAll('.ext-column[data-column]').forEach(box => {const area = box.querySelector('.ext-column-cards');if (area) scrolled.set(box.dataset.column, area.scrollTop);});
    // Each column keeps its jobs in the order the links were added, so cards never reshuffle.
    // The board fits the window both ways: five columns side by side on a wide window, three
    // over two rows on a medium one, two on a small one. Its height is set by fitBoard.
    // Every column has the same, fixed width: columns never change size as jobs move.
    const board = el('div', 'ext-board grid h-[var(--board-h,640px)] auto-rows-[minmax(0,1fr)] grid-cols-5 gap-2 max-[1180px]:grid-cols-3 max-[720px]:grid-cols-2');
    board.append(...COLUMNS.map(item => boardColumn(item, byColumn[item[0]])));
    list.replaceChildren(board);
    fitBoard();
    list.querySelectorAll('.ext-column[data-column]').forEach(box => {const area = box.querySelector('.ext-column-cards');if (area && scrolled.has(box.dataset.column)) area.scrollTop = scrolled.get(box.dataset.column);});
    list.querySelectorAll('.job-menu:not([hidden])').forEach(placeMenu);
    animateBoard(list, before);
    renderDetails();
    // Until the jobs' states have loaded, every card sits in To do: only moves after that first
    // real drawing are real moves.
    animateNext = !!liveState;
  }

  async function refreshConnections() {
    if (!currentProfile || !window.api || !window.api.extensionState || pollBusy) return;
    const active = token;
    pollBusy = true;
    try {
      const state = await window.api.extensionState(currentProfile.id);
      if (active !== token) return;
      liveState = state;
      // Only this profile's browsers and jobs; other profiles' browsers are not shown here.
      const own = state.connections.filter(c => c.profileId === currentProfile.id);
      const jobs = state.jobs.filter(job => job.profileId === currentProfile.id);
      const linked = own.length, online = own.filter(c => c.connected).length;
      $('extension-connected-count').textContent = String(online);
      $('extension-connected-label').textContent = linked ? `Browsers online (${linked} linked)` : 'Browsers online';
      $('extension-open-count').textContent = String(jobs.filter(isOpen).length);
      $('extension-bridge-notice').textContent = state.error || (!state.running ? 'Local connection service is offline.'
        : !linked ? 'Local connection service running. Pair a browser with this profile\'s code to start sending its jobs.'
        : online ? 'Local connection service running. Send a saved job below; it opens in its own Chrome window.'
        : 'Local connection service running, but this profile\'s browser is offline. Open that Chrome profile with the extension enabled.');
      // The notice only shows when something is wrong with the connection.
      const notice = $('extension-bridge-notice');
      if (notice) notice.hidden = !state.error && state.running && linked > 0 && online > 0;
      $('extension-pairing-code').value = state.pairingCode;
      const previous = $('extension-target').value;
      const options = own.map(client => {
        const option = document.createElement('option');option.value = client.id;option.textContent = `${client.name} (${client.connected ? 'online' : 'offline'})`;return option;
      });
      if (!options.length) {const option = document.createElement('option');option.value = '';option.textContent = 'Link an extension first';options.push(option);}
      $('extension-target').replaceChildren(...options);
      if (own.some(c => c.id === previous)) $('extension-target').value = previous;
      // With one linked browser, jobs simply go to it; the choice appears once there are more.
      $('extension-target-field').hidden = linked <= 1;
      $('extension-slots').replaceChildren(...own.map(client => connectionCard(client, jobs)));
      $('extension-slots-empty').hidden = linked > 0;
      // The counts only say something once a browser is linked.
      const counts = $('extension-browser-counts');if (counts) counts.hidden = linked < 2;
      // Pairing stays open until a browser is linked, then folds away (it opens again if all are unlinked).
      if ((linked > 0) !== (lastLinked > 0) || lastLinked === null) $('extension-pairing').open = linked === 0;
      lastLinked = linked;
      renderJobs(workflow.normalizeJobLinks(currentProfile.extensionJobLinks));
    } catch (error) {if (active === token) $('extension-bridge-notice').textContent = error.message;}
    finally {pollBusy = false;}
  }

  // The note in the corner after an action goes away by itself.
  let noteTimer = null;
  function watchNote() {
    const note = $('extension-dispatch-status');
    if (!note || typeof MutationObserver === 'undefined') return;
    new MutationObserver(() => {
      clearTimeout(noteTimer);
      if (note.textContent) noteTimer = setTimeout(() => {note.textContent = '';}, 6000);
    }).observe(note, {childList:true, characterData:true, subtree:true});
  }
  function initialize() {
    if (initialized) return;
    initialized = true;
    if (typeof window.addEventListener === 'function') window.addEventListener('resize', () => {fitBoard();document.querySelectorAll('#extension-job-list .job-menu:not([hidden])').forEach(placeMenu);});
    // Opening or closing "Pair a browser" moves the board: fit it again.
    $('extension-pairing')?.addEventListener?.('toggle', fitBoard);
    watchNote();
    if (window.api && window.api.extensionState) {
      $('extension-copy-code').addEventListener('click', async () => {
        try {await navigator.clipboard.writeText($('extension-pairing-code').value);$('extension-dispatch-status').textContent = 'Pairing code copied.';} catch (_) {$('extension-pairing-code').select();}
      });
      $('extension-rotate-code').addEventListener('click', async () => {try {await window.api.extensionRotateCode(currentProfile && currentProfile.id);await refreshConnections();} catch (e) {$('extension-dispatch-status').textContent = e.message;}});
    }
    // Board or table: one click switches; the choice is kept.
    if (document.querySelectorAll) document.querySelectorAll('.ext-view-option').forEach(option => option.addEventListener('click', () => {try {localStorage.setItem(VIEW_KEY, option.dataset.view);} catch (_) { /* this session only */ }animateNext = false;renderJobs(shownLinks);}));
    // The job's details panel closes from its × button, a click beside it, or Escape.
    if (document.querySelectorAll) document.querySelectorAll('[data-job-details-close]').forEach(node => node.addEventListener('click', closeDetails));
    if (document.addEventListener) document.addEventListener('keydown', event => {if (event.key === 'Escape' && detailsJobId && $('resume-review')?.classList.contains('hidden') !== false) closeDetails();});
    $('extension-review-resume').addEventListener('change', async event => {
      const on = event.target.checked;
      try {
        await saveSetting({fullAutoReviewResume:on});
        $('extension-dispatch-status').textContent = on ? 'Full auto now stops so you can review each resume, and carries on after you confirm it.' : 'Full auto now exports each resume without stopping for review.';
      } catch (error) {event.target.checked = !on;$('extension-dispatch-status').textContent = error.message;}
    });
    if (document.querySelectorAll && document.addEventListener) {
    document.querySelectorAll('[data-review-close]').forEach(node => node.addEventListener('click', closeReview));
    $('resume-review-confirm').addEventListener('click', () => reviewCommand('confirmResume'));
    $('resume-review-details').addEventListener('click', () => reviewCommand('details'));
    $('resume-review-edit').addEventListener('click', () => {reviewEditing = !reviewEditing;renderReview();});
    $('resume-review-undo').addEventListener('click', () => {reviewEdited = null;renderReview();});
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (!$('resume-review').classList.contains('hidden')) closeReview();
      else if (openMenuJobId) {openMenuJobId = null;document.querySelectorAll('#extension-job-list .job-menu').forEach(menu => {menu.hidden = true;});}
    });
    document.addEventListener('click', event => {
      if (!openMenuJobId || event.target.closest('.job-menu-wrap')) return;
      openMenuJobId = null;
      document.querySelectorAll('#extension-job-list .job-menu').forEach(menu => {menu.hidden = true;});
      document.querySelectorAll('#extension-job-list .job-menu-button').forEach(button => button.setAttribute('aria-expanded', 'false'));
    });
    }
    $('extension-job-links').addEventListener('input', () => {
      $('extension-links-status').textContent = 'Unsaved changes';
    });
    $('extension-links-edit').addEventListener('click', () => {
      setLinksMode(!editingLinks);$('extension-links-status').textContent = '';
      if (editingLinks && $('extension-job-links').focus) $('extension-job-links').focus();
    });
    // Filter tabs: one group at a time, or all of them.
    $('extension-links-cancel').addEventListener('click', () => {
      if (!currentProfile) return;
      const saved = workflow.normalizeJobLinks(currentProfile.extensionJobLinks);
      $('extension-job-links').value = saved.join('\n');$('extension-links-status').textContent = '';
      if (saved.length) setLinksMode(false);
    });
    $('extension-links-clear').addEventListener('click', async () => {
      if (!currentProfile || !saveLinks) return;
      const links = workflow.normalizeJobLinks(currentProfile.extensionJobLinks);
      const keep = links.filter(link => {const job = sentJob(link);return job && isOpen(job);});
      const removing = links.length - keep.length;
      if (!removing) {$('extension-links-status').textContent = keep.length ? 'Every link is a job open in Chrome; nothing to clear.' : 'There are no links to clear.';return;}
      if (!(await ask({title:`Remove ${removing} saved link${removing === 1 ? '' : 's'}?`, message:`Removes the jobs in To do, Done and Failed.${keep.length ? ` ${keep.length} job${keep.length === 1 ? '' : 's'} open in Chrome will stay.` : ''}`, confirmLabel:'Remove', tone:'danger'}))) return;
      return keepOnly(keep, `Removed ${removing} link${removing === 1 ? '' : 's'}.`);
    });
    $('extension-save-links').addEventListener('click', async () => {
      if (!currentProfile || !saveLinks) return;
      const activeToken = token;
      const button = $('extension-save-links');
      const input = $('extension-job-links');
      const draft = input.value;
      try {
        const links = workflow.parseJobLinks(draft);
        button.disabled = true;
        $('extension-links-status').textContent = 'Saving...';
        await saveLinks(links);
        if (activeToken !== token) return;
        renderJobs(links);
        if (input.value === draft) {
          input.value = links.join('\n');
          $('extension-links-status').textContent = 'Saved';
          if (links.length) setLinksMode(false);
        } else {
          $('extension-links-status').textContent = 'Unsaved changes';
        }
      } catch (error) {
        if (activeToken === token) $('extension-links-status').textContent = error.message || 'Could not save job links.';
      } finally {
        if (activeToken === token) button.disabled = false;
      }
    });
  }

  function open(profile, onSave, onEdit, onSetting) {
    initialize();
    token++;
    selectedJobId = null;openMenuJobId = null;animateNext = false;closeReview({force:true});closeDetails();
    currentProfile = profile;
    liveState = null;
    saveLinks = onSave;
    editProfile = onEdit;
    saveSetting = onSetting || null;
    const review = $('extension-review-resume');
    if (review) {review.checked = profile.fullAutoReviewResume === true;review.disabled = !saveSetting;}
    $('extension-job-links').value = workflow.normalizeJobLinks(profile.extensionJobLinks).join('\n');
    $('extension-links-status').textContent = '';
    $('extension-save-links').disabled = false;
    // A table of links to read; the text box only when editing (or when there are none yet).
    setLinksMode(!workflow.normalizeJobLinks(profile.extensionJobLinks).length);
    // No placeholder slots: a card appears for each browser once it is linked.
    $('extension-connected-count').textContent = '0';
    $('extension-open-count').textContent = '0';
    $('extension-slots').replaceChildren();
    $('extension-slots-empty').hidden = false;
    lastLinked = null;
    renderJobs(workflow.normalizeJobLinks(profile.extensionJobLinks));
    if (window.api && window.api.extensionState) {
      $('extension-dispatch-status').textContent = '';
      refreshConnections();
      clearInterval(pollTimer);
      pollTimer = setInterval(refreshConnections, 3000);
    }
  }

  function close() {
    closeDetails();
    if (pollTimer !== null) clearInterval(pollTimer);pollTimer = null;
    token++;
    currentProfile = null;
    saveLinks = null;
    editProfile = null;
  }

  window.App.ExtensionWorkspace = { open, close };
})();
