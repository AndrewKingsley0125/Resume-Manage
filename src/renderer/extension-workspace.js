/* Profile job links and live local-extension connection dashboard. */
(function () {
  const $ = id => document.getElementById(id);
  const workflow = window.App.ProfileWorkflow;
  let currentProfile = null;
  let saveLinks = null;
  let editProfile = null;
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
  // History sections the user opened, kept open across refreshes.
  const openHistories = new Set();
  // The six stages of an application, and how far a job has got.
  const STAGES = ['Sent', 'Job description', 'Resume', 'Questions', 'Answers', 'Filled'];
  // Tailwind classes. Scripts toggle the is-* markers; the [&.is-*] variants style them.
  const STAGE_CLASS = 'job-stage h-1.5 rounded-[3px] bg-line [&.is-done]:bg-ready [&.is-current]:bg-accent [&.is-current]:shadow-[0_0_0_1px_var(--accent)]';
  const STAGE_LABEL_CLASS = 'job-stage-label text-[11px] text-muted';
  const HISTORY_TEXT = {attention:'text-attention-ink', error:'text-danger'};
  const STATE_TEXT = {attention:'text-attention-ink', busy:'text-busy', idle:'', unsent:'!font-normal text-muted', done:''};
  // Each row's state: a coloured left edge (inset shadow, so the row never changes size).
  const ROW_BASE = 'job-card job-tr [&>td]:border-b [&>td]:border-line [&>td]:px-2.5 [&>td]:py-2.5 [&>td]:align-middle [&.is-clickable]:cursor-pointer [&.is-clickable:hover>td]:bg-[color-mix(in_srgb,var(--accent-ring)_50%,transparent)] [&.is-selected>td]:bg-accent-ring [&.is-selected>td]:shadow-[inset_0_2px_0_var(--accent),inset_0_-2px_0_var(--accent)] [&.is-selected>td:first-child]:shadow-[inset_4px_0_0_var(--accent),inset_0_2px_0_var(--accent),inset_0_-2px_0_var(--accent)] [&.is-selected>td:last-child]:shadow-[inset_-2px_0_0_var(--accent),inset_0_2px_0_var(--accent),inset_0_-2px_0_var(--accent)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent';
  const ROW_CLASS = {
    attention: `${ROW_BASE} job-attention [&>td:first-child]:shadow-[inset_4px_0_0_#e8912d]`,
    busy: `${ROW_BASE} job-busy [&>td:first-child]:shadow-[inset_4px_0_0_#5b7cfa]`,
    idle: `${ROW_BASE} job-idle [&>td:first-child]:shadow-[inset_4px_0_0_#22a06b]`,
    unsent: `${ROW_BASE} job-unsent [&>td:first-child]:shadow-[inset_4px_0_0_var(--border)]`,
    done: `${ROW_BASE} job-done opacity-60 [&>td:first-child]:shadow-[inset_4px_0_0_var(--border)]`,
  };
  // Column widths, on both the heading and the cells.
  const COLUMN_CLASS = {
    'col-site': 'col-site w-[1%] whitespace-nowrap',
    'col-company': 'col-company min-w-[90px] max-w-[180px]',
    'col-title': 'col-title min-w-[140px] max-w-[260px]',
    'col-process': 'col-process w-[130px] min-w-[120px]',
    'col-status': 'col-status min-w-[210px]',
    'col-actions': 'col-actions w-[1%] whitespace-nowrap text-right',
    'col-tools': 'col-tools w-[44px] text-right',
  };
  const MENU_ITEM_BASE = 'job-menu-item block w-full cursor-pointer rounded-md border-0 bg-transparent px-2.5 py-2 text-left text-[13px] hover:bg-accent-ring focus-visible:bg-accent-ring focus-visible:outline-none disabled:cursor-default disabled:bg-transparent disabled:text-muted';
  const MENU_ITEM_CLASS = {normal:`${MENU_ITEM_BASE} text-ink`, danger:`${MENU_ITEM_BASE} is-danger text-danger`};
  const STAGES_DONE = {'assigned':1, 'tabs-opened':1, 'tabs-ready':1, 'jd-received':2, 'resume-exported':3, 'questions-scanned':4, 'answers-reviewed':5, 'filled':6, 'completed':6};
  function stageBar(job) {
    const done = STAGES_DONE[job.status] || 0;
    const bar = el('div', 'job-stages flex flex-col gap-1');
    const track = el('div', 'job-stage-track grid grid-cols-6 gap-[3px]');track.setAttribute('role', 'img');
    const now = Math.min(done, STAGES.length - 1);
    STAGES.forEach((name, index) => {
      const step = el('span', `${STAGE_CLASS}${index < done ? ' is-done' : ''}${index === now && done < STAGES.length ? ' is-current' : ''}`);
      step.title = name;track.append(step);
    });
    const label = done >= STAGES.length ? 'All 6 stages done' : `Stage ${now + 1} of 6: ${STAGES[now]}`;
    track.setAttribute('aria-label', label);
    bar.append(track, el('span', STAGE_LABEL_CLASS, label));
    return bar;
  }
  const clock = time => new Date(time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
  function history(job) {
    const events = job.events || [];
    if (!events.length) return null;
    const box = el('details', 'job-history mt-1 text-xs');box.open = openHistories.has(job.id);
    box.addEventListener('toggle', () => {if (box.open) openHistories.add(job.id);else openHistories.delete(job.id);});
    box.append(el('summary', 'cursor-pointer text-muted', `History (${events.length})`));
    const list = el('ol', 'mb-0 ml-0 mt-1.5 flex max-h-[180px] list-none flex-col gap-1 overflow-y-auto border-l-2 border-line py-0 pl-2 pr-0');
    for (const event of events.slice().reverse()) {
      const item = el('li', `is-${event.level || 'info'} grid grid-cols-[64px_1fr] gap-1.5`);
      const time = el('time', 'whitespace-nowrap tabular-nums text-muted', clock(event.at));time.dateTime = new Date(event.at).toISOString();time.title = new Date(event.at).toLocaleString();
      item.append(time, el('span', HISTORY_TEXT[event.level] || '', event.text));list.append(item);
    }
    box.append(list);
    return box;
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
  function avatar(identity) {
    const box = el('span', 'job-avatar grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-lg bg-accent-ring text-[13px] font-bold text-accent');
    const letter = () => {box.replaceChildren();box.textContent = (identity.company || identity.host || '?').charAt(0).toUpperCase();};
    if (/^data:image\//.test(identity.icon)) {const img = el('img', 'h-[18px] w-[18px] object-contain');img.alt = '';img.src = identity.icon;img.addEventListener('error', letter);box.append(img);}
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
      el('span', client.connected ? 'extension-badge flex-none rounded-full bg-ready-bg px-2.5 py-[3px] text-xs font-semibold text-[#1a7f55]' : 'extension-badge flex-none rounded-full bg-line px-2.5 py-[3px] text-xs font-semibold text-muted', client.connected ? 'Online' : 'Offline'),
      el('span', 'extension-card-meta m-0 flex-none overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-muted', `${seen} · ${open} open · ${own.length - open} ended`));
    card.title = client.pairedAt ? `Paired ${new Date(client.pairedAt).toLocaleDateString()}` : '';
    const remove = el('button', 'btn btn-ghost btn-sm', 'Unlink');remove.type = 'button';
    remove.addEventListener('click', async () => {
      if (!confirm(`Unlink ${client.name}? Its open jobs stop syncing with this app.`)) return;
      try {await window.api.extensionUnlink(client.id);await refreshConnections();} catch (e) {$('extension-dispatch-status').textContent = e.message;}
    });
    card.append(remove);
    return card;
  }
  // Steps the app can start for a job that is open in Chrome. Its browser runs each one
  // exactly like the same button in the job's Resume Apply window, and reports back here.
  const COMMAND_LABELS = {fail:'Mark failed', replaceResume:'Use revised resume', open:'Reopen windows', fullAuto:'Full auto', prepare:'Detect JD & write resume', confirmResume:'Confirm resume', scan:'Scan questions', ask:'Ask ChatGPT', auto:'Auto-fill', fill:'Fill form', complete:'Mark ended', details:'Show details in Chrome', focus:'Show in Chrome', review:'Review resume'};
  const COMMAND_HINTS = {fail:'End this application as Failed (it did not go through), and close its Chrome tabs', replaceResume:"Read the revised resume ChatGPT wrote after you asked for changes, review it, then replace the exported one", open:'Reopen or rearrange the job window, ChatGPT and its Resume Apply window', fullAuto:'Do every step by itself: read the JD, write and export the resume, then fill the application. It stops at the first step that needs you and never clicks Submit.', prepare:"Read the job description from the job page and send the resume prompt to this job's ChatGPT", confirmResume:'Export the resume ChatGPT wrote (PDF and DOCX)', scan:'Read the questions on the application page', ask:'Send the unanswered questions to ChatGPT', auto:'Fill the application page by page; it stops before Submit', fill:"Put ChatGPT's answers on this page of the form. Nothing is submitted.", complete:'Mark this application ended (after you submitted or abandoned it)'};
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
      if (action === 'complete' && !confirm(`Mark "${jobName(job)}" as ended? Do this after you submitted or abandoned the application. Its job tab, ChatGPT tab and details window will close.${job.exported && !job.failure ? '' : ' It has no exported resume, so it is recorded as Failed.'}`)) return;
      if (action === 'fail' && !confirm(`Mark "${jobName(job)}" as failed? Use this when the application did not go through. Its job tab, ChatGPT tab and details window will close.`)) return;
      if (action === 'confirmResume' && !confirm(`Export the resume ChatGPT wrote for "${jobName(job)}"? Review it in the job's Resume Apply window first if you have not.`)) return;
      const active = token;button.disabled = true;
      try {
        await window.api.extensionCommand({profileId:currentProfile.id,jobId:job.id,action});
        if (active === token) {$('extension-dispatch-status').textContent = `${COMMAND_LABELS[action]} sent to ${jobName(job)}.`;await refreshConnections();}
      } catch (error) {if (active === token) {$('extension-dispatch-status').textContent = error.message;button.disabled = false;}}
    });
    return button;
  }
  // Start over: back to Not sent at stage 1, its Chrome tabs closed and its progress cleared.
  function startOverItem(job, menu, toggle) {
    const item = el('button', MENU_ITEM_CLASS.normal, 'Start over');item.type = 'button';item.setAttribute('role', 'menuitem');item.dataset.action = 'reset';
    item.title = 'Stop this job, close its Chrome tabs, clear its progress, and put it back to Not sent';
    item.addEventListener('click', async event => {
      event.stopPropagation();
      openMenuJobId = null;menu.hidden = true;toggle.setAttribute('aria-expanded', 'false');
      if (!confirm(`Start "${jobName(job)}" over? This stops it, closes its Chrome tabs, clears its progress and history, and puts it back to Not sent.`)) return;
      const active = token;
      try {
        await window.api.extensionReset({profileId:currentProfile.id, jobId:job.id});
        if (selectedJobId === job.id) selectedJobId = null;
        if (active === token) {$('extension-dispatch-status').textContent = `${jobName(job)} is back to Not sent.`;await refreshConnections();}
      } catch (error) {if (active === token) $('extension-dispatch-status').textContent = error.message;}
    });
    return item;
  }
  // The hiring company, editable when the job description does not name it (or names it
  // wrongly). The resume and its folder use it.
  function companyEditor(job, shown) {
    const button = el('button', 'job-card-company block max-w-full cursor-text rounded border border-transparent bg-transparent p-0 text-left text-xs font-semibold text-muted [overflow-wrap:anywhere] hover:border-line hover:text-ink', shown || 'Add company');
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
    const menu = el('div', 'job-menu absolute right-0 top-[calc(100%+4px)] z-[5] flex min-w-[200px] flex-col rounded-[10px] border border-line bg-elev p-1.5 shadow-soft');menu.setAttribute('role', 'menu');
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
  function openReview(job) {
    reviewJobId = job.id;
    $('resume-review-for').textContent = jobName(job);
    const box = $('resume-review-body');box.replaceChildren();
    let resume = null;
    try {resume = window.App.Resume.parse(job.pendingResume || '', currentProfile);}
    catch (error) {
      box.append(el('p', 'json-error m-0 whitespace-pre-wrap border-t border-danger-line bg-danger-bg px-3.5 py-2.5 font-mono text-[12.5px] text-danger-hover', `This resume cannot be exported as it is: ${error.message} Open it in Chrome to fix it, or ask ChatGPT again.`));
      if (job.pendingResume) box.append(el('pre', 'review-raw whitespace-pre-wrap rounded-lg border border-line bg-bg p-3 text-xs [overflow-wrap:anywhere]', job.pendingResume));
    }
    if (resume) box.append(reviewContent(resume, currentProfile));
    $('resume-review-confirm').disabled = !resume;
    $('resume-review').classList.remove('hidden');
    box.scrollTop = 0;
    $('resume-review-confirm').focus();
  }
  function closeReview() {reviewJobId = null;const panel = $('resume-review');if (panel && panel.classList) panel.classList.add('hidden');}
  async function reviewCommand(action) {
    const job = liveState && liveState.jobs.find(item => item.id === reviewJobId);
    if (!job) {closeReview();return;}
    const active = token;
    try {
      await window.api.extensionCommand({profileId:currentProfile.id,jobId:job.id,action});
      closeReview();
      if (active === token) {$('extension-dispatch-status').textContent = action === 'confirmResume' ? `Exporting the resume for ${jobName(job)}.` : `Showing ${jobName(job)} in Chrome.`;await refreshConnections();}
    } catch (error) {if (active === token) $('extension-dispatch-status').textContent = error.message;}
  }
  // One table row per saved job: site, company, title, how far it got, what it is doing,
  // and the steps that control its browser.
  function jobCard(link, job) {
    const identity = jobIdentity(job, link);
    const open = job && isOpen(job);
    const lanes = lane(job);
    const [stateText] = job ? jobState(job) : ['Not sent yet', 'idle'];
    const row = el('tr', ROW_CLASS[lanes]);row.dataset.url = link;
    const cell = (className, ...nodes) => {const td = el('td', COLUMN_CLASS[className]);if (className === 'col-actions') td.className += ' !pl-1';td.append(...nodes);return td;};
    // Job site
    const site = el('div', 'job-card-head flex items-center gap-2');site.title = link;
    site.append(avatar(identity), el('span', 'job-site-host max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted', identity.host || link));
    // Company and title
    const names = el('div', 'job-card-names flex flex-col');
    const title = el('strong', 'job-card-title line-clamp-2 text-[13px] leading-[1.35]', identity.title || '—');title.title = identity.title || '';
    names.append(title);
    const company = job && open && window.api && window.api.extensionSetCompany ? companyEditor(job, identity.company) : el('span', 'job-card-company block text-xs font-semibold text-muted [overflow-wrap:anywhere]', identity.company || '—');
    // Process
    const stage = el('div', 'job-row-stage min-w-0');
    if (open) stage.append(stageBar(job));
    else stage.append(el('span', job && failed(job) ? `${STAGE_LABEL_CLASS} !text-danger font-semibold` : STAGE_LABEL_CLASS, job ? (failed(job) ? 'Failed' : 'Ended') : 'Not started'));
    // Status: what it is doing (and when that changed), the last step's result, its history
    const status = el('div', 'job-row-state flex min-w-0 flex-col gap-0.5');
    const stateLine = el('p', `job-card-state m-0 text-[13px] font-semibold leading-[1.4] ${job && failed(job) ? 'is-failed text-danger' : STATE_TEXT[lanes]}`, stateText);
    const updated = job && ((job.events || []).at(-1)?.at || (job.progress && job.progress.at));
    if (updated && open) stateLine.append(el('span', 'job-card-updated font-normal text-muted', ` · ${ago(updated)}`));
    status.append(stateLine);
    if (open && job.lastCommand) {
      const last = el('p', job.lastCommand.ok ? 'job-last-command m-0 mt-0.5 text-xs text-muted [overflow-wrap:anywhere]' : 'job-last-command is-error m-0 mt-0.5 text-xs text-danger [overflow-wrap:anywhere]', `${COMMAND_LABELS[job.lastCommand.action] || job.lastCommand.action}: ${job.lastCommand.message}`);
      last.title = `Updated ${ago(job.lastCommand.at)}`;status.append(last);
    }
    const past = job && history(job);
    if (past) status.append(past);
    // Actions: only the steps that fit now
    const actions = el('div', 'job-card-actions flex justify-end gap-1.5');
    if (open && window.api && window.api.extensionCommand) {
      availableSteps(job).forEach((action, index) => actions.append(action === 'review' ? reviewButton(job) : commandButton(job, action, index === 0)));
    } else if (window.api && window.api.extensionAssign) {
      const send = el('button', 'btn btn-primary btn-sm', job ? 'Send again' : 'Send');send.type = 'button';send.dataset.action = 'send';
      send.title = 'Open this job in Chrome with its own ChatGPT chat';
      send.addEventListener('click', async () => {
        const active = token, profile = currentProfile;
        send.disabled = true;
        try {
          const connectionId = $('extension-target').value;
          if (!connectionId) throw new Error('Link a browser first: pair it with the code at the top.');
          let style = {};
          try {style = JSON.parse(localStorage.getItem(`style:${profile.id}:${profile.templateId || 'classic'}`) || '{}');} catch (_) { /* use defaults */ }
          await window.api.extensionAssign({profileId:profile.id,url:link,connectionId,style});
          if (active !== token) return;
          $('extension-dispatch-status').textContent = `Sent ${jobName({url:link})}. Chrome opens it in its own window.`;
          await refreshConnections();
        } catch (error) {if (active === token) {$('extension-dispatch-status').textContent = error.message;send.disabled = false;}}
      });
      actions.append(send);
    }
    // More: the menu for an open job; remove for one that is not open in Chrome
    const tools = el('div', 'job-row-tools flex justify-end');
    if (open && window.api && window.api.extensionCommand) tools.append(jobMenu(job));
    else if (saveLinks) {
      const remove = el('button', 'btn btn-ghost btn-sm ext-link-remove px-[7px] py-0 text-[15px] leading-[1.4]', '×');remove.type = 'button';
      remove.title = 'Remove this link';remove.setAttribute('aria-label', `Remove ${link}`);
      remove.addEventListener('click', event => {event.stopPropagation();return keepOnly(workflow.normalizeJobLinks(currentProfile.extensionJobLinks).filter(other => other !== link), 'Link removed.');});
      tools.append(remove);
    }
    row.append(cell('col-site', site), cell('col-company', company), cell('col-title', names), cell('col-process', stage), cell('col-status', status), cell('col-actions', actions), cell('col-tools', tools));
    // Clicking the row (not one of its buttons) shows that job's window in Chrome.
    if (open && window.api && window.api.extensionCommand) {
      row.classList.add('is-clickable');row.tabIndex = 0;row.title = 'Show this job in Chrome';
      const mark = () => {
        row.classList.add('is-selected');row.setAttribute('aria-current', 'true');
        if (!row.querySelector('.job-card-selected')) names.append(el('span', 'job-card-selected hidden', 'In front'));
      };
      if (job.id === selectedJobId) mark();
      const show = async () => {
        const active = token;
        // Highlight it straight away, without waiting for the next refresh.
        selectedJobId = job.id;
        document.querySelectorAll('#extension-job-list .job-card.is-selected').forEach(other => {other.classList.remove('is-selected');other.removeAttribute('aria-current');other.querySelector('.job-card-selected')?.remove();});
        mark();
        try {await window.api.extensionCommand({profileId:currentProfile.id,jobId:job.id,action:'focus'});if (active === token) $('extension-dispatch-status').textContent = `Showing ${jobName(job)} in Chrome.`;}
        catch (error) {if (active === token && !/already waiting/.test(error.message)) $('extension-dispatch-status').textContent = error.message;}
      };
      row.addEventListener('click', event => {if (!event.target.closest('button, a, input, select, textarea, details')) show();});
      row.addEventListener('keydown', event => {if ((event.key === 'Enter' || event.key === ' ') && event.target === row) {event.preventDefault();show();}});
    }
    return row;
  }
  // Where a saved job belongs.
  function lane(job) {
    if (!job) return 'unsent';
    if (!isOpen(job)) return 'done';
    if ((job.commands || []).length && browserOnline(job)) return 'busy';
    const level = jobState(job)[1];
    return level === 'attention' ? 'attention' : level === 'busy' ? 'busy' : 'idle';
  }
  // Marker classes (ext-group, is-<state>) kept for scripts and tests.
  const GROUP_CLASS = {attention:'ext-group is-attention', busy:'ext-group is-busy', idle:'ext-group is-idle', unsent:'ext-group is-unsent', done:'ext-group is-done'};
  const GROUPS = [['attention', 'Needs you'], ['busy', 'Working'], ['idle', 'Ready for next step'], ['unsent', 'Not sent'], ['done', 'Ended']];
  let filter = 'all';
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
  function renderJobs(links) {
    shownLinks = links;
    $('extension-job-count').textContent = String(links.length);
    $('extension-jobs-empty').hidden = links.length > 0;
    const groups = {attention:[], busy:[], idle:[], unsent:[], done:[]};
    for (const link of links) {const job = sentJob(link);groups[lane(job)].push([link, job]);}
    for (const [key, items] of Object.entries(groups)) {const count = $(`ext-count-${key}`);if (count) count.textContent = String(items.length);}
    const all = $('ext-count-all');if (all) all.textContent = String(links.length);
    if (document.querySelectorAll) document.querySelectorAll('.ext-tab').forEach(tab => {tab.classList.toggle('is-active', tab.dataset.filter === filter);tab.setAttribute('aria-selected', String(tab.dataset.filter === filter));});
    if (!links.length) {$('extension-job-list').replaceChildren();return;}
    // One table; with All selected, a slim heading row starts each state's group.
    const table = el('table', 'ext-table w-full border-separate border-spacing-0 text-[13px] max-[1100px]:min-w-[1000px] [&>tbody:last-child>tr:last-child>td]:border-b-0 [&>tbody:last-child>tr:last-child>td:first-child]:rounded-bl-card [&>tbody:last-child>tr:last-child>td:last-child]:rounded-br-card');
    const head = el('thead');const headRow = el('tr');
    for (const [name, className] of [['Job site','col-site'],['Company','col-company'],['Title','col-title'],['Process','col-process'],['Status','col-status'],['Actions','col-actions'],['','col-tools']]) {
      const th = el('th', `${COLUMN_CLASS[className]} sticky top-0 z-[1] whitespace-nowrap border-b border-line bg-elev px-2.5 py-2.5 text-left text-[11px] font-bold uppercase tracking-[0.05em] text-muted first:rounded-tl-card last:rounded-tr-card`, name);th.scope = 'col';headRow.append(th);
    }
    head.append(headRow);table.append(head);
    let rows = 0;
    // All: every job in a fixed place (the order the links were added), so a row never
    // jumps when its state changes; its coloured edge and status show the state.
    if (filter === 'all') {
      const body = el('tbody', 'ext-all');
      body.append(...links.map(link => jobCard(link, sentJob(link))));
      table.append(body);rows = links.length;
    }
    for (const [key, title] of GROUPS) {
      if (filter === 'all') break;
      if (filter !== key) continue;
      const items = groups[key];
      if (!items.length) continue;
      const body = el('tbody', GROUP_CLASS[key]);
      body.append(...items.map(([link, job]) => jobCard(link, job)));
      table.append(body);rows += items.length;
    }
    const wrap = el('div', 'ext-table-wrap rounded-card border border-line bg-elev max-[1100px]:overflow-x-auto');wrap.append(table);
    if (!rows) {
      const label = (GROUPS.find(([key]) => key === filter) || [])[1] || '';
      $('extension-job-list').replaceChildren(el('p', 'ext-empty my-2 rounded-card border border-dashed border-line-strong p-[18px] text-center text-muted', `No jobs ${label === 'Not sent' ? 'waiting to be sent' : 'here'}.`));
      return;
    }
    $('extension-job-list').replaceChildren(wrap);
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
    watchNote();
    if (window.api && window.api.extensionState) {
      $('extension-copy-code').addEventListener('click', async () => {
        try {await navigator.clipboard.writeText($('extension-pairing-code').value);$('extension-dispatch-status').textContent = 'Pairing code copied.';} catch (_) {$('extension-pairing-code').select();}
      });
      $('extension-rotate-code').addEventListener('click', async () => {try {await window.api.extensionRotateCode(currentProfile && currentProfile.id);await refreshConnections();} catch (e) {$('extension-dispatch-status').textContent = e.message;}});
    }
    $('extension-edit-profile').addEventListener('click', () => editProfile && editProfile());
    if (document.querySelectorAll && document.addEventListener) {
    document.querySelectorAll('[data-review-close]').forEach(node => node.addEventListener('click', closeReview));
    $('resume-review-confirm').addEventListener('click', () => reviewCommand('confirmResume'));
    $('resume-review-details').addEventListener('click', () => reviewCommand('details'));
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
    if (document.querySelectorAll) document.querySelectorAll('.ext-tab').forEach(tab => tab.addEventListener('click', () => {filter = tab.dataset.filter;renderJobs(shownLinks);}));
    $('extension-links-cancel').addEventListener('click', () => {
      if (!currentProfile) return;
      const saved = workflow.normalizeJobLinks(currentProfile.extensionJobLinks);
      $('extension-job-links').value = saved.join('\n');$('extension-links-status').textContent = '';
      if (saved.length) setLinksMode(false);
    });
    $('extension-links-clear').addEventListener('click', () => {
      if (!currentProfile || !saveLinks) return;
      const links = workflow.normalizeJobLinks(currentProfile.extensionJobLinks);
      const keep = links.filter(link => {const job = sentJob(link);return job && isOpen(job);});
      const removing = links.length - keep.length;
      if (!removing) {$('extension-links-status').textContent = keep.length ? 'Every link is a job open in Chrome; nothing to clear.' : 'There are no links to clear.';return;}
      if (!confirm(`Remove ${removing} saved link${removing === 1 ? '' : 's'}?${keep.length ? ` ${keep.length} job${keep.length === 1 ? '' : 's'} open in Chrome will stay.` : ''}`)) return;
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

  function open(profile, onSave, onEdit) {
    initialize();
    token++;
    selectedJobId = null;openMenuJobId = null;filter = 'all';closeReview();
    currentProfile = profile;
    liveState = null;
    saveLinks = onSave;
    editProfile = onEdit;
    const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'Unnamed profile';
    $('extension-profile-name').textContent = name;
    $('subtitle').textContent = `${name} - Chrome extension mode`;
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
    if (pollTimer !== null) clearInterval(pollTimer);pollTimer = null;
    token++;
    currentProfile = null;
    saveLinks = null;
    editProfile = null;
  }

  window.App.ExtensionWorkspace = { open, close };
})();
