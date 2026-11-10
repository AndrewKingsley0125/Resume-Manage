const $ = id => document.getElementById(id);
let state = null, selected = null, run = {}, rows = [], working = false, pendingRefresh = false, pendingResponseEvent = null, answersDirty = false;
const workflowSteps=['connection','job','resume','questions','finish'];
let activeStep='connection',stepJobId=null;
let pollingAnswers=false,lastAnswerUpdate='';
function updateStepButtons() {
  const index=workflowSteps.indexOf(activeStep);
  $('workflow-back').disabled=working || index===0;
  $('workflow-next').disabled=working || index===workflowSteps.length-1;
}
function setStep(step) {
  if(!workflowSteps.includes(step))return;
  activeStep=step;$('workflow-step').value=step;
  document.querySelectorAll('[data-workflow-section]').forEach(section=>{section.hidden=section.dataset.workflowSection!==step;});
  $('response-tools').hidden=!['resume','questions'].includes(step);$('response-tools').open=false;
  document.querySelectorAll('[data-recovery-for]').forEach(control=>{control.hidden=control.dataset.recoveryFor!==step;});
  updateStepButtons();
}
function recommendedStep() {
  if(!state?.client)return 'connection';
  if(!selected)return 'job';
  if(selected.status==='completed')return 'finish';
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
// The smallest control that fits the answer: one line for short facts, a
// dropdown for one choice, toggles for several, a text area only for prose.
function answerControl(field,answer,edited) {
  const options=field.options || [];
  if(options.length && (field.answerFormat==='multiple' || ['checkbox','multiselect'].includes(field.type))) {
    const group=document.createElement('div');group.className='chips';group.setAttribute('role','group');group.setAttribute('aria-label',field.label);
    const chosen=new Set([].concat(answer ?? []));
    const chips=options.map(value=>{
      const chip=document.createElement('button');chip.type='button';chip.className='chip';chip.textContent=value;chip.setAttribute('aria-pressed',String(chosen.has(value)));
      chip.addEventListener('click',()=>{chip.setAttribute('aria-pressed',String(chip.getAttribute('aria-pressed')!=='true'));edited();});
      return chip;
    });
    group.append(...chips);
    return {node:group,read:()=>chips.filter(chip=>chip.getAttribute('aria-pressed')==='true').map(chip=>chip.textContent)};
  }
  if(options.length) {
    const select=document.createElement('select');select.setAttribute('aria-label',field.label);
    const blank=document.createElement('option');blank.value='';blank.textContent='Leave blank';select.append(blank);
    for(const value of options){const option=document.createElement('option');option.value=value;option.textContent=value;option.selected=value===[].concat(answer ?? [])[0];select.append(option);}
    select.addEventListener('input',edited);
    return {node:select,read:()=>select.value};
  }
  const value=Array.isArray(answer)?answer.join(', '):String(answer ?? '');
  if(field.type==='textarea' || value.length>70 || value.includes('\n')) {
    const area=document.createElement('textarea');area.setAttribute('aria-label',field.label);area.value=value;area.rows=textRows(value);
    area.addEventListener('input',()=>{area.rows=textRows(area.value);edited();});
    return {node:area,read:()=>area.value};
  }
  const input=document.createElement('input');input.type='text';input.setAttribute('aria-label',field.label);input.value=value;
  input.addEventListener('input',edited);
  return {node:input,read:()=>input.value};
}
function preview() {
  answersDirty=false;rows = []; $('questions').replaceChildren();
  $('answer-review-actions').hidden=!(run.fields || []).some(field=>!field.manualOnly && field.type!=='file');
  if (!run.fields || !run.fields.length) {$('questions').textContent = 'No questions scanned yet.';return;}
  for (const field of run.fields) {
    const answer = (run.answers || []).find(a => a.id === field.id)?.answer;
    const fileField=field.type==='file', resumeUpload=fileField && field.resumeUpload && !field.manualOnly;
    const onSite=!!field.manualOnly || fileField && !resumeUpload;
    const row = document.createElement('div');row.className = 'question';
    const head = document.createElement('div');head.className='question-head';
    const heading = document.createElement('span');heading.className='question-title';heading.textContent = field.label + (field.required ? ' *' : '');head.append(heading);
    const badge=(text,kind)=>{const tag=document.createElement('span');tag.className='badge '+kind;tag.textContent=text;head.append(tag);};
    if(field.fillResult)badge(field.fillResult.filled?'Filled':'Not filled',field.fillResult.filled?'good':'bad');
    else if(onSite)badge('Do on site','muted');
    row.append(head);
    const note=text=>{const line=document.createElement('p');line.className='meta';line.textContent=text;row.append(line);};
    if(field.fillResult?.error)note(field.fillResult.error);
    if(resumeUpload){
      if(!selected.files?.docx)note('Generate and export the resume first.');
      const upload=document.createElement('button');upload.type='button';upload.className='secondary compact';upload.textContent='Upload resume.docx';upload.disabled=!selected.files?.docx;
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
async function loadDetail() {
  const id = $('jobs').value;
  const changedJob=id!==stepJobId;
  selected = state && state.jobs.find(job => job.id === id) || null;
  run = {};rows = [];showResumeReview(null);$('questions').replaceChildren();$('files').textContent = '';$('local-facts').textContent = '';
  if (!selected) {$('job-summary').textContent = '';$('company').value = '';$('job-title').value = '';$('jd').value = '';stepJobId=null;setStep(state?.client?'job':'connection');return;}
  const result = await call('detail');selected = result.job;run = result.run;showMonitorStatus();showResumeReview(run.pendingResumeResponse);
  $('job-summary').textContent = `${selected.url} | ${selected.status}${run.layout === 'split' ? ' | Split view' : ''}${run.needsSiteAccess ? ' | Grant site access to scan' : ''}${run.autoOpenError ? ' | '+run.autoOpenError : ''}${run.layoutNotice ? ' | '+run.layoutNotice : ''}`;
  const facts = {...selected.profile.applicationDetails};delete facts.answerPrompt;
  $('local-facts').textContent = Object.entries(facts).filter(([,value]) => value !== '').map(([key,value]) => `${key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, letter => letter.toUpperCase())}: ${value}`).join('\n');
  $('company').value = selected.company || '';$('job-title').value = selected.title || '';$('jd').value = selected.jd || '';
  $('files').textContent = selected.files ? Object.entries(selected.files).map(([kind,path]) => `${kind.toUpperCase()}: ${path || 'Not written'}`).join('\n') : '';
  preview();
  if(changedJob || activeStep==='connection')setStep(recommendedStep());
  stepJobId=id;
}
async function refresh({preserveDraft = false} = {}) {
  state = await call('state');$('connected-name').textContent = `Connected: ${state.client.name}`;
  const previous = selected && selected.id;
  $('jobs').replaceChildren();
  const blank = document.createElement('option');blank.value = '';blank.textContent = 'Choose an assigned job';$('jobs').append(blank);
  for (const job of state.jobs) {
    const option = document.createElement('option');option.value = job.id;option.textContent = `${job.company || job.title || new URL(job.url).hostname} - ${job.status}`;$('jobs').append(option);
  }
  if (previous && state.jobs.some(job => job.id === previous)) $('jobs').value = previous;
  else if (state.jobs.length) $('jobs').value = state.jobs.find(job=>job.id===state.activeJobId)?.id || state.jobs.find(job => job.status !== 'completed')?.id || state.jobs.at(-1).id;
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
  const permission = action === 'open' ? requestJobAccess(selected && selected.url) : Promise.resolve();
  perform(async () => {
    await permission;
    if (!selected) throw new Error('Select an assigned job.');
    let extra = {};
    if (action === 'readResume') status('Reading the completed resume from ChatGPT...');
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
    if (action === 'extract') {setStep('resume');$('jd-details').open=true;$('company').value = result.job.company;$('job-title').value = result.job.title;$('jd').value = result.job.description;return {message:'JD detected. Review company, title, and description before sending.'};}
    if(action==='sendResume' || action==='sendAnswers'){setStep(action==='sendResume'?'resume':'questions');if(action==='sendResume')$('jd-details').open=false;const detail=await call('detail');run=detail.run;showMonitorStatus();}
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
$('complete').addEventListener('click', () => perform(async () => {if (!confirm('Confirm that you submitted or ended this application yourself?')) return;const result = await call('complete',{confirmed:true});await refresh();setStep('finish');return result;}));
if (chrome.runtime.onMessage) chrome.runtime.onMessage.addListener(message => {
  if(message.event==='response-collection-progress'){
    if(selected?.id===message.id)call('detail').then(result=>{if(selected?.id===message.id){run.responseMonitor=result.run.responseMonitor;showMonitorStatus();}}).catch(()=>{});
    return false;
  }
  if(message.event==='fill-progress'){
    if(selected?.id===message.id)perform(async()=>{await loadDetail();setStep('questions');return {message:message.message};});
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
