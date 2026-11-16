const $ = id => document.getElementById(id);
let state = null, selected = null, run = {}, rows = [], working = false, pendingRefresh = false, pendingResponseEvent = null, answersDirty = false;
// The side panel in a job's window works only on that window's job. In a window with no
// job, it only pairs with the app and reopens or attaches jobs' tabs.
const ALL_STEPS=['connection','job','resume','questions','finish'];
let LOCKED_JOB=new URLSearchParams(location.search).get('job') || '';
let workflowSteps=[];
function applyLock(id) {
  LOCKED_JOB=id || '';
  workflowSteps=LOCKED_JOB?ALL_STEPS:['connection','job'];
  document.body.classList.toggle('locked',!!LOCKED_JOB);
  document.querySelectorAll('#workflow-step option').forEach(option=>{option.hidden=option.disabled=!workflowSteps.includes(option.value);});
}
applyLock(LOCKED_JOB);
let activeStep='connection',stepJobId=null;
let pollingAnswers=false,lastAnswerUpdate='';
function updateStepButtons() {
  const index=workflowSteps.indexOf(activeStep);
  $('workflow-back').disabled=working || index===0;
  $('workflow-next').disabled=working || index===workflowSteps.length-1;
}
function setStep(step) {
  if(!LOCKED_JOB && !workflowSteps.includes(step))step=state?.client?'job':'connection';
  if(!workflowSteps.includes(step))return;
  activeStep=step;$('workflow-step').value=step;
  document.querySelectorAll('[data-workflow-section]').forEach(section=>{section.hidden=section.dataset.workflowSection!==step;});
  $('response-tools').hidden=!['resume','questions'].includes(step);$('response-tools').open=false;
  document.querySelectorAll('[data-recovery-for]').forEach(control=>{control.hidden=control.dataset.recoveryFor!==step;});
  updateStepButtons();
}
// Where Full auto handed the application back to you.
const BLOCKED_STEP={pages:'job',resume:'resume',questions:'questions'};
const blockedStep=()=>BLOCKED_STEP[run.fullAutoBlocker?.stage] || null;
function recommendedStep() {
  if(!state?.client)return 'connection';
  if(!selected)return 'job';
  if(selected.status==='completed')return 'finish';
  if(blockedStep())return blockedStep();
  if(run.pendingResumeResponse)return 'resume';
  if(selected.files?.docx || run.fields?.length)return 'questions';
  if(selected.jd || run.responseMonitor?.kind==='resume')return 'resume';
  return 'job';
}
$('workflow-step').addEventListener('change',event=>setStep(event.target.value));
$('workflow-back').addEventListener('click',()=>setStep(workflowSteps[workflowSteps.indexOf(activeStep)-1]));
$('workflow-next').addEventListener('click',()=>setStep(workflowSteps[workflowSteps.indexOf(activeStep)+1]));
$('connection-settings').addEventListener('click',()=>setStep('connection'));
const status = (text,error = false) => { $('status').textContent = text; $('status').classList.toggle('error',error); };
async function call(action, extra = {}) {
  const result = await chrome.runtime.sendMessage({action,id:selected && selected.id,...extra});
  if (!result || result.error) throw new Error(result && result.error || 'Extension worker did not respond. Reload the extension.');
  return result;
}
function busy(value) {
  working=value;
  document.querySelectorAll('button, #jobs, #workflow-step').forEach(el=>{
    if(value){el.dataset.disabledBeforeAction=String(el.disabled);el.disabled=true;}
    else if(el.dataset.disabledBeforeAction!==undefined){el.disabled=el.dataset.disabledBeforeAction==='true';delete el.dataset.disabledBeforeAction;}
  });
  updateStepButtons();
}
async function perform(callback) {
  if (working) return;
  busy(true);
  try {const result = await callback();if (result && result.message) status(result.message);} catch (error) {status(error.message,true);} finally {busy(false);if(pendingResponseEvent){const event=pendingResponseEvent;pendingResponseEvent=null;handleCollectedResponse(event);}else if (pendingRefresh) {pendingRefresh=false;refresh({preserveDraft:true}).catch(error=>status(error.message,true));}}
}
const hasValue=value=>Array.isArray(value)?value.length>0:String(value ?? '').trim()!=='';
const textRows=value=>Math.min(6,Math.max(2,Math.ceil(value.length/48)));
// Compact answer controls in question rows. `!` beats the base input:not([type=checkbox]) rule.
const ANSWER_CONTROL='!mt-1 !rounded-md !px-[9px] !py-1.5 !text-[13px]';
// The smallest control that fits the answer: one line for short facts, a
// dropdown for one choice, toggles for several, a text area only for prose.
function answerControl(field,answer,edited) {
  const options=field.options || [];
  if(options.length && (field.answerFormat==='multiple' || ['checkbox','multiselect'].includes(field.type))) {
    const group=document.createElement('div');group.className='chips mt-[5px] flex max-h-[132px] flex-wrap gap-[5px] overflow-y-auto';group.setAttribute('role','group');group.setAttribute('aria-label',field.label);
    const chosen=new Set([].concat(answer ?? []));
    const chips=options.map(value=>{
      const chip=document.createElement('button');chip.type='button';chip.className='chip m-0 w-auto rounded-full border border-line-strong bg-field px-[9px] py-[3px] text-left text-[12px] font-medium leading-[1.4] text-[#c3cde0] aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-accent-ink';chip.textContent=value;chip.setAttribute('aria-pressed',String(chosen.has(value)));
      chip.addEventListener('click',()=>{chip.setAttribute('aria-pressed',String(chip.getAttribute('aria-pressed')!=='true'));edited();});
      return chip;
    });
    group.append(...chips);
    return {node:group,read:()=>chips.filter(chip=>chip.getAttribute('aria-pressed')==='true').map(chip=>chip.textContent)};
  }
  if(options.length) {
    const select=document.createElement('select');select.className=ANSWER_CONTROL;select.setAttribute('aria-label',field.label);
    const blank=document.createElement('option');blank.value='';blank.textContent='Leave blank';select.append(blank);
    for(const value of options){const option=document.createElement('option');option.value=value;option.textContent=value;option.selected=value===[].concat(answer ?? [])[0];select.append(option);}
    select.addEventListener('input',edited);
    return {node:select,read:()=>select.value};
  }
  const value=Array.isArray(answer)?answer.join(', '):String(answer ?? '');
  if(field.type==='textarea' || value.length>70 || value.includes('\n')) {
    const area=document.createElement('textarea');area.className=ANSWER_CONTROL;area.setAttribute('aria-label',field.label);area.value=value;area.rows=textRows(value);
    area.addEventListener('input',()=>{area.rows=textRows(area.value);edited();});
    return {node:area,read:()=>area.value};
  }
  const input=document.createElement('input');input.type='text';input.className=ANSWER_CONTROL;input.setAttribute('aria-label',field.label);input.value=value;
  input.addEventListener('input',edited);
  return {node:input,read:()=>input.value};
}
const BADGE_COLORS={good:'bg-[#1d4a38] text-[#8fe6c0]',bad:'bg-bad-bg text-[#ffb5c4]',muted:'bg-secondary text-[#c3cde0]'};
function preview() {
  answersDirty=false;rows = []; $('questions').replaceChildren();
  $('answer-review-actions').hidden=!(run.fields || []).some(field=>!field.manualOnly && field.type!=='file');
  if (!run.fields || !run.fields.length) {$('questions').textContent = 'No questions scanned yet.';return;}
  for (const field of run.fields) {
    const answer = (run.answers || []).find(a => a.id === field.id)?.answer;
    const fileField=field.type==='file', resumeUpload=fileField && field.resumeUpload && !field.manualOnly;
    const onSite=!!field.manualOnly || fileField && !resumeUpload;
    const row = document.createElement('div');row.className = 'question border-b border-[#2a3244] py-[9px]';
    const head = document.createElement('div');head.className='question-head flex items-start justify-between gap-2';
    const heading = document.createElement('span');heading.className='question-title text-[13px] leading-[1.35] text-[#d3daea]';heading.textContent = field.label + (field.required ? ' *' : '');head.append(heading);
    const badge=(text,kind)=>{const tag=document.createElement('span');tag.className=`badge ${kind} flex-none whitespace-nowrap rounded-full px-[7px] py-px text-[11px] leading-[1.6] ${BADGE_COLORS[kind]}`;tag.textContent=text;head.append(tag);};
    if(field.fillResult)badge(field.fillResult.filled?'Filled':'Not filled',field.fillResult.filled?'good':'bad');
    else if(onSite)badge('Do on site','muted');
    row.append(head);
    const note=text=>{const line=document.createElement('p');line.className='meta mb-0 mt-[3px] text-[12px] text-[#a6b3ce]';line.textContent=text;row.append(line);};
    if(field.fillResult?.error)note(field.fillResult.error);
    if(resumeUpload){
      if(!selected.files?.docx)note('Generate and export the resume first.');
      const upload=document.createElement('button');upload.type='button';upload.className='secondary compact mx-0 mb-0 mt-[5px] w-auto px-2.5 py-[5px] text-[12px] leading-[normal]';upload.textContent='Upload resume.docx';upload.disabled=!selected.files?.docx;
      upload.addEventListener('click',()=>perform(async()=>{const result=await call('uploadResume',{fieldId:field.id});await loadDetail();return result;}));
      row.append(upload);
    }else if(onSite) {
      if(hasValue(answer))note(`Suggested: ${[].concat(answer).join(', ')}`);
    }else {
      if(field.optionsStatus==='unavailable')note('Choices could not be read.');
      else if(field.optionsStatus==='partial')note('Some choices could not be read.');
      const entry={field,edited:false};
      const control=answerControl(field,answer,()=>{entry.edited=true;answersDirty=true;});
      entry.read=control.read;row.append(control.node);rows.push(entry);
    }
    $('questions').append(row);
  }
}
function showMonitorStatus() {
  const monitor=run.responseMonitor;
  $('response-monitor-status').textContent=!monitor ? '' : monitor.status==='waiting' ? monitor.lastError ? `Collection is retrying: ${monitor.lastError}` : `Watching ChatGPT for completed ${monitor.kind==='resume'?'resume JSON':'answers'}...` : monitor.status==='ready' ? 'Response collected. Review it below.' : monitor.message || '';
}
function handleCollectedResponse(message) {
  if(working){pendingResponseEvent=message;return;}
  perform(async()=>{
    if(!selected || selected.id!==message.id){await refresh({preserveDraft:true});return {message:'A ChatGPT response is ready. Select its job to review it.'};}
    const result=await call('detail');run=result.run;selected={...selected,...result.job};showMonitorStatus();
    if(run.responseMonitor?.status==='error')return {message:run.responseMonitor.message};
    if(message.kind==='resume'){showResumeReview(run.pendingResumeResponse);if(!(answersDirty && activeStep==='questions'))setStep('resume');return {message:'Resume JSON collected automatically. Review and export the files.'};}
    if(run.responseMonitor?.kind!=='answers' || run.responseMonitor.status!=='ready' || message.marker && message.marker!==run.responseMonitor.marker)return;
    const update=run.responseMonitor?.marker;
    if(update && update===lastAnswerUpdate)return;
    lastAnswerUpdate=update || '';
    preview();setStep('questions');return {message:'All answers replaced with the completed ChatGPT response. Review them, then click Fill form.'};
  });
}
function showResumeReview(response) {
  $('resume-response-review').hidden=!response;
  if(response)$('jd-details').open=false;
  $('resume-response-preview').value=response || '';
  $('approve-resume-response').checked=false;
  $('resume-response-target').textContent=selected ? `${selected.company || 'Hiring company'} | ${selected.title || selected.url}` : '';
}
// Answers saved for this profile on the sites of the scanned form.
let siteMemory=[];
function showSiteMemory(list=[]) {
  siteMemory=list;
  $('site-memory').hidden=!list.length;
  $('site-memory-text').textContent=list.map(({site,count})=>`${site}: ${count} saved answer${count===1?'':'s'} for this profile`).join(' | ')+'. Your corrections are saved when you submit, rescan, or click Save.';
  $('clear-site-answers').disabled=!list.some(item=>item.count);
}
$('clear-site-answers').addEventListener('click',()=>perform(async()=>{
  const sites=siteMemory.filter(item=>item.count).map(item=>item.site);
  if(!sites.length || !confirm(`Clear the saved answers for ${sites.join(', ')} for this profile?`))return;
  let result;for(const site of sites)result=await call('clearSiteAnswers',{site});
  await loadDetail();return result;
}));
async function loadDetail() {
  const id = $('jobs').value;
  const changedJob=id!==stepJobId;
  selected = state && state.jobs.find(job => job.id === id) || null;
  run = {};rows = [];showResumeReview(null);showSiteMemory([]);$('questions').replaceChildren();$('files').textContent = '';$('local-facts').textContent = '';
  if (!selected) {$('job-summary').textContent = '';$('company').value = '';$('job-title').value = '';$('jd').value = '';stepJobId=null;setStep(state?.client?'job':'connection');
    if (LOCKED_JOB && state?.client) status('This job is no longer assigned to this browser. You can close this tab.',true);
    return;}
  const result = await call('detail');selected = result.job;run = result.run;showMonitorStatus();showResumeReview(run.pendingResumeResponse);
  // A job's own tab is named after its job, in the panel and on the Chrome tab.
  if (LOCKED_JOB) {const name = jobName(selected);document.title = `${name} · Resume Apply`;$('job-heading').textContent = name;$('job-heading').hidden = false;}
  showSiteMemory(result.siteMemory);
  $('job-summary').textContent = `${selected.url} | ${selected.status}${run.layout === 'split' ? ' | Side by side, ChatGPT hidden' : ''}${run.needsSiteAccess ? ' | Grant site access to scan' : ''}${run.autoOpenError ? ' | '+run.autoOpenError : ''}${run.layoutNotice ? ' | '+run.layoutNotice : ''}`;
  const facts = {...selected.profile.applicationDetails};delete facts.answerPrompt;
  $('local-facts').textContent = Object.entries(facts).filter(([,value]) => value !== '').map(([key,value]) => `${key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, letter => letter.toUpperCase())}: ${value}`).join('\n');
  $('company').value = selected.company || '';$('job-title').value = selected.title || '';$('jd').value = selected.jd || '';
  $('files').textContent = selected.files ? Object.entries(selected.files).map(([kind,path]) => `${kind.toUpperCase()}: ${path || 'Not written'}`).join('\n') : '';
  $('stop-full-auto').hidden=!(run.fullAuto?.active || run.autopilot?.active);
  preview();
  if(changedJob || activeStep==='connection')setStep(recommendedStep());
  stepJobId=id;
}
// ---------- All jobs at a glance ----------
const STATUS_LABELS={'assigned':'Opening in Chrome','tabs-opened':'Tabs open','tabs-ready':'Ready','jd-received':'Job description read','resume-exported':'Resume ready','questions-scanned':'Questions scanned','answers-reviewed':'Answers reviewed','filled':'Form filled','completed':'Ended','unlinked':'Unlinked'};
const NEXT_STEPS={'assigned':'Opening the job window','tabs-opened':'Next: Detect JD, then Send to ChatGPT','tabs-ready':'Next: Detect JD, then Send to ChatGPT','jd-received':'Next: Send the resume prompt to ChatGPT','resume-exported':'Next: Auto-fill','questions-scanned':'Next: Ask ChatGPT or Auto-fill','answers-reviewed':'Next: Fill form or Auto-fill','filled':'Next: check the form and submit it yourself'};
const WAITING={'captcha':'Needs you: solve the CAPTCHA','login':'Needs you: sign in on the job site','verification-code':'Needs you: enter the emailed code'};
function jobName(job) {
  if(job.company || job.title)return [job.company,job.title].filter(Boolean).join(' - ');
  try {const url=new URL(job.url),tail=url.pathname.split('/').filter(Boolean).slice(-2).join('/');return url.hostname.replace(/^www\./,'')+(tail?' /'+tail:'');}catch(_){return job.url;}
}
// What a job is doing now, and whether it needs you: [text, 'attention' | 'busy' | 'done' | 'idle'].
function jobPhase(job,jobRun={}) {
  if(job.status==='completed' || job.status==='unlinked')return [STATUS_LABELS[job.status],'done'];
  if(job.error)return [`Needs you: ${job.error}`,'attention'];
  const auto=jobRun.autopilot,monitor=jobRun.responseMonitor;
  if(auto?.waiting)return [WAITING[auto.waiting] || 'Needs you on the job page','attention'];
  if(monitor?.status==='waiting')return [`Waiting for ChatGPT (${monitor.kind==='resume'?'resume':'answers'})`,'busy'];
  if(monitor?.status==='error')return [`Needs you: ${monitor.message || 'ChatGPT reply could not be read'}`,'attention'];
  if(auto?.active)return ['Auto-filling','busy'];
  if(jobRun.fullAuto?.active)return ['Full auto running','busy'];
  if(jobRun.pendingResumeResponse)return ['Needs you: confirm the resume, then export','attention'];
  if(jobRun.fullAutoBlocker)return [`Needs you: ${jobRun.fullAutoBlocker.message}`,'attention'];
  if(jobRun.needsSiteAccess)return ['Needs you: grant site access (Check pages)','attention'];
  return [NEXT_STEPS[job.status] || STATUS_LABELS[job.status] || job.status,'idle'];
}
// Each window has its own side panel; it starts on the job whose tabs are in that window.
async function windowJob() {
  try {
    const win = await chrome.windows.getCurrent();
    const tabs = new Set((await chrome.tabs.query({windowId:win.id})).map(tab => tab.id));
    const runs = state.runs || {};
    return state.jobs.find(job => {const run = runs[job.id];return run && (tabs.has(run.jobTabId) || tabs.has(run.chatTabId));}) || null;
  } catch (_) {return null;}
}
async function refresh({preserveDraft = false} = {}) {
  state = await call('state');$('connected-name').textContent = `Connected: ${state.client.name}${state.client.profileName ? ' · runs ' + state.client.profileName + '\'s jobs' : ''}`;
  const previous = selected && selected.id;
  $('jobs').replaceChildren();
  const blank = document.createElement('option');blank.value = '';blank.textContent = 'Choose an assigned job';$('jobs').append(blank);
  for (const job of state.jobs) {
    const option = document.createElement('option');option.value = job.id;option.textContent = `${jobName(job)} - ${jobPhase(job,(state.runs || {})[job.id])[0]}`;$('jobs').append(option);
  }
  // Lock to the job whose tabs are in this window (it can change if tabs are moved).
  if (!new URLSearchParams(location.search).get('job')) {
    const here = await windowJob();
    if ((here?.id || '') !== LOCKED_JOB) {applyLock(here?.id);selected = null;}
  }
  if (LOCKED_JOB) $('jobs').value = state.jobs.some(job => job.id === LOCKED_JOB) ? LOCKED_JOB : '';
  else if (previous && state.jobs.some(job => job.id === previous)) $('jobs').value = previous;
  else if (state.jobs.length) $('jobs').value = (await windowJob())?.id || state.jobs.find(job=>job.id===state.activeJobId)?.id || state.jobs.find(job => job.status !== 'completed')?.id || state.jobs.at(-1).id;
  if (!preserveDraft || !selected || selected.id !== $('jobs').value) await loadDetail();
}
async function requestJobAccess(url) {
  if (!url) throw new Error('Select an assigned job.');
  const granted = await chrome.permissions.request({origins:[new URL(url).origin + '/*']});
  if (!granted) throw new Error('Site access was not granted.');
}
$('pair').addEventListener('click', () => perform(async () => {
  const result = await call('pair',{code:$('pair-code').value.trim(),name:$('client-name').value.trim()});$('pair-code').value = '';await refresh();return result;
}));
$('refresh').addEventListener('click', () => perform(async () => {await refresh();return {message:'Connection and assigned jobs refreshed.'};}));
$('forget').addEventListener('click', () => perform(async () => {if (!confirm('Forget this connection? Unlink its slot in Resume Manager as well.')) return;const result = await call('forget');state = null;selected = null;run = {};rows = [];stepJobId=null;setStep('connection');$('jobs').replaceChildren();$('connected-name').textContent = '';$('questions').replaceChildren();return result;}));
$('jobs').addEventListener('change', () => perform(loadDetail));
$('adopt').addEventListener('click', () => {
  // Request site access in this user gesture, before asynchronous worker calls.
  const permission = requestJobAccess(state && state.suggestedTab && state.suggestedTab.url);
  perform(async () => {await permission;const result = await call('adopt');await loadDetail();return result;});
});
for (const button of document.querySelectorAll('[data-step]')) button.addEventListener('click', () => {
  const action = button.dataset.step;
  // Site access can only be asked for inside the click itself, before any worker call.
  const permission = action === 'open' ? requestJobAccess(selected && selected.url)
    : action === 'fullAuto' && selected?.url ? chrome.permissions.request({origins:[new URL(selected.url).origin + '/*']}).catch(() => false) : Promise.resolve();
  perform(async () => {
    await permission;
    if (!selected) throw new Error('Select an assigned job.');
    let extra = {};
    if (action === 'readResume') status('Reading the completed resume from ChatGPT...');
    if (action === 'fullAuto') status('Full auto is running: reading the JD and sending the resume prompt...');
    if (action === 'sendAnswers') status('Reading dropdown choices and sending questions with their exact options to ChatGPT...');
    if (action === 'sendResume') {
      extra.job = {company:$('company').value.trim(),title:$('job-title').value.trim(),description:$('jd').value.trim()};
      status('Sending the reviewed JD and resume prompt. Opening the ChatGPT tab...');
    }
    if (action === 'fill') {
      // Blank answers are skipped, and fields already filled are left alone unless edited.
      extra = {approved:true,answers:rows.filter(row => hasValue(row.read()) && (!row.field.fillResult?.filled || row.edited)).map(row => ({id:row.field.id,answer:row.read()}))};
      if (!extra.answers.length) throw new Error('There are no answers left to fill.');
    }
    const result = await call(action,extra);
    if(result.needsResumeConfirmation){setStep('resume');showResumeReview(result.responsePreview);$('resume-response-review').scrollIntoView({block:'nearest'});return result;}
    if (action === 'extract') {setStep('resume');$('jd-details').open=true;$('company').value = result.job.company;$('job-title').value = result.job.title;$('jd').value = result.job.description;return {message:result.message || 'JD detected. Review company, title, and description before sending.'};}
    if(action==='sendResume' || action==='sendAnswers'){setStep(action==='sendResume'?'resume':'questions');if(action==='sendResume')$('jd-details').open=false;const detail=await call('detail');run=detail.run;showMonitorStatus();}
    else if(action==='fullAuto' || action==='stopFullAuto'){await loadDetail();setStep(blockedStep() || (selected?.files?'questions':'resume'));if(result.blocked){status(result.message,true);return null;}}
    else {await loadDetail();if(action==='open' || action==='readResume')setStep(action==='readResume' && selected?.files?'questions':'resume');if(['scan','readAnswers','fill','auto'].includes(action))setStep('questions');}
    return result;
  });
});
for (const [id,action] of [['paste-resume','readResume'],['paste-answers','readAnswers']]) $(id).addEventListener('click', () => perform(async () => {
  const response = $('response').value.trim();if (!response) throw new Error('Paste a response first.');
  const result = await call(action,{response});$('response').value = '';await loadDetail();setStep('questions');return result;
}));
$('confirm-resume-response').addEventListener('click',()=>perform(async()=>{
  if(!$('approve-resume-response').checked)throw new Error('Confirm that this is the correct resume before exporting.');
  const result=await call('confirmResume',{confirmed:true});await loadDetail();setStep('questions');return result;
}));
$('complete').addEventListener('click', () => perform(async () => {if (!confirm('Confirm that you submitted or ended this application yourself? Its job tab, ChatGPT tab and this window will close.')) return;const result = await call('complete',{confirmed:true});await refresh();setStep('finish');return result;}));
if (chrome.runtime.onMessage) chrome.runtime.onMessage.addListener(message => {
  if(message.event==='response-collection-progress'){
    if(selected?.id===message.id)call('detail').then(result=>{if(selected?.id===message.id){run.responseMonitor=result.run.responseMonitor;showMonitorStatus();}}).catch(()=>{});
    return false;
  }
  if(message.event==='fill-progress'){
    if(selected?.id===message.id)perform(async()=>{await loadDetail();setStep(blockedStep() || 'questions');const blocked=!!run.fullAutoBlocker;if(blocked)status(message.message,true);return blocked?null:{message:message.message};});
    return false;
  }
  if(message.event==='response-ready'){handleCollectedResponse(message);return false;}
  if (message.event !== 'jobs-updated') return false;
  if (working) pendingRefresh = true;
  else perform(async () => {await refresh({preserveDraft:true});return {message:'Assigned job opened automatically. Select it to continue.'};});
  return false;
});
// Poll while waiting as well as listening for page notifications. A missed DOM
// watcher event must not leave a finished JSON code block uncollected.
setInterval(async()=>{
  if(working || pollingAnswers || !selected || run.responseMonitor?.kind!=='answers' || run.responseMonitor.status!=='waiting')return;
  const id=selected.id;pollingAnswers=true;
  try {
    const result=await call('pollAnswers');
    if(selected?.id!==id)return;
    run.responseMonitor=result.run?.responseMonitor || run.responseMonitor;showMonitorStatus();
    if(run.responseMonitor.status==='ready')handleCollectedResponse({id,kind:'answers'});
  }catch(error){if(selected?.id===id)$('response-monitor-status').textContent=error.message;}
  finally{pollingAnswers=false;}
},3000);
setInterval(async()=>{
  if(working || !selected || !run.autopilot?.waiting)return;
  const id=selected.id;
  try {
    const result=await call('autoResume');
    if(selected?.id!==id)return;
    if(result.waiting){status(result.message);return;}
    perform(async()=>{await loadDetail();setStep('questions');return result;});
  }catch(_){}
},3000);
if (chrome.sidePanel && chrome.sidePanel.getLayout) chrome.sidePanel.getLayout().then(layout=>{
  if (layout.side === 'left') {$('panel-placement').hidden=false;}
}).catch(()=>{});
perform(async () => {await refresh();return {message:'Connected. Assigned jobs open automatically. Check site access before scanning.'};});
