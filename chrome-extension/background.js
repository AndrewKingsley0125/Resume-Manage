import {captureCodeCopy} from './code-copy.mjs';
import {arrangeWorkspace, panelBounds} from './layout.mjs';
import {APP_URL, answersPrompt, parseAnswers, decodeReply, rememberAnswers, recallAnswers, currentAnswers, carryPageState, optionAnswer, answerableQuestions, mergeGeneratedAnswers, resumeResponse, profileAnswers, profileBasis, learnSiteAnswers, recallSiteAnswers, siteAnswerCount, runProgress, jdSources, parseJdSource} from './core.mjs';
const locks = new Set();
let watching = false;
let runWrites = Promise.resolve();
const request = async (path, body, publicRequest = false) => {
  const {credentials} = await chrome.storage.local.get('credentials');
  if (!credentials && !publicRequest) throw new Error('Pair this extension with Resume Manager first.');
  const res = await fetch(APP_URL + path, {method:body === undefined ? 'GET' : 'POST', headers:{'Content-Type':'application/json', ...(!publicRequest ? {Authorization:`Bearer ${credentials.token}`} : {})}, body:body === undefined ? undefined : JSON.stringify(body), signal:AbortSignal.timeout(120000)});
  const data = await res.json();if (!res.ok) throw new Error(data.error || `App returned ${res.status}`);return data;
};
async function runs() {return (await chrome.storage.session.get('runs')).runs || {};}
async function saveRun(id, patch) {
  const saved = runWrites.then(async () => {const all = await runs();all[id] = {...all[id],id,...patch};await chrome.storage.session.set({runs:all});
    const {runAnchors={}}=await chrome.storage.local.get('runAnchors');
    const run=all[id], anchor={session:await browserSession()};
    for(const key of ['jobTabId','chatTabId','groupId'])if(run[key]!==undefined)anchor[key]=run[key];
    for(const key of ['resumeReceipt','answerReceipt'])if(run[key])anchor[key]=Object.fromEntries(['marker','userMessageId','conversationPath','sentAt','responseBaseline'].filter(k=>run[key][k]!==undefined).map(k=>[k,run[key][k]]));
    if(run.responseMonitor?.status==='waiting')anchor.responseMonitor=run.responseMonitor;
    runAnchors[id]=anchor;await chrome.storage.local.set({runAnchors});return run;});
  runWrites = saved.catch(() => {});
  saved.then(run => reportProgress(id, run)).catch(() => {});
  return saved;
}
// Tells the app what this job is doing now ("Waiting for ChatGPT", "Needs you: ..."), so the
// app can show every job's progress in one place. Sent only when it changes.
const reported = new Map(), reportTimers = new Map();
function reportProgress(id, run) {
  clearTimeout(reportTimers.get(id));
  reportTimers.set(id, setTimeout(async () => {
    reportTimers.delete(id);
    const body = {...runProgress(run), ...(await pageInfo(run))};
    // The resume ChatGPT wrote, so it can be reviewed and confirmed in the app.
    if (body.key === 'confirm-resume' && typeof run.pendingResumeResponse === 'string') body.pendingResume = run.pendingResumeResponse.slice(0, 200000);
    const key = JSON.stringify(body);
    if (reported.get(id) === key) return;
    request(jobPath(id) + '/progress', body).then(() => reported.set(id, key)).catch(() => {});
  }, 300));
}
// The job page's title and icon, so the app can show which job it is before its JD is read.
// The icon is sent as a small inline image: the app does not load anything from job sites.
const pageIcons = new Map();
async function pageInfo(run) {
  try {
    const tab = await chrome.tabs.get(run.jobTabId);
    const info = {};
    if (tab.status === 'complete' && tab.title && !/^https?:\/\//.test(tab.title)) info.pageTitle = tab.title;
    if (tab.favIconUrl && /^https?:/.test(tab.favIconUrl)) {
      if (!pageIcons.has(tab.favIconUrl)) pageIcons.set(tab.favIconUrl, await inlineIcon(tab.favIconUrl).catch(() => ''));
      if (pageIcons.get(tab.favIconUrl)) info.icon = pageIcons.get(tab.favIconUrl);
    }
    return info;
  } catch (_) {return {};}
}
async function inlineIcon(url) {
  const res = await fetch(url, {signal:AbortSignal.timeout(5000)});
  const type = (res.headers.get('content-type') || '').split(';')[0].trim();
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (!/^image\/(png|x-icon|vnd\.microsoft\.icon|svg\+xml|jpeg|gif|webp)$/.test(type) || bytes.length > 40000) return '';
  let binary = '';for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return `data:${type};base64,${btoa(binary)}`;
}
// When a job page finishes loading or changes its title or icon, tell the app.
chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  if (!change.title && !change.favIconUrl && change.status !== 'complete') return;
  for (const [id, run] of Object.entries(await runs())) if (run.jobTabId === tabId) reportProgress(id, run);
});
// Tab and window ids are only valid until Chrome quits: after a restart the same numbers
// belong to other tabs, or to none. Every browser session gets its own mark, and ids saved
// in another session are never reused.
let sessionMark = null;
function browserSession() {
  return sessionMark ||= chrome.storage.session.get('browserSession').then(async ({browserSession: mark}) => {
    if (mark) return mark;
    const fresh = crypto.randomUUID();await chrome.storage.session.set({browserSession:fresh});return fresh;
  });
}
// Both of the job's tabs still exist.
async function liveTabs(run) {
  if (!run || !Number.isInteger(run.jobTabId) || !Number.isInteger(run.chatTabId) || run.jobTabId === run.chatTabId) return false;
  try {await Promise.all([chrome.tabs.get(run.jobTabId),chrome.tabs.get(run.chatTabId)]);return true;} catch (_) {return false;}
}
async function recoverRun(id) {
  const {runAnchors={}}=await chrome.storage.local.get('runAnchors');
  const anchor=runAnchors[id];
  if(anchor && anchor.session===await browserSession() && await liveTabs(anchor)) {
    try {const tab=await chrome.tabs.get(anchor.chatTabId);if(tab.url && new URL(tab.url).hostname==='chatgpt.com')return saveRun(id,anchor);}catch(_){}
  }
  // Recover older installations from the group belonging to this exact assigned job URL.
  const job=await request(jobPath(id));
  const sites=await chrome.tabs.query({url:job.url});
  const pairs=[];
  for(const site of sites.filter(tab=>tab.groupId>=0)) {
    const members=await chrome.tabs.query({groupId:site.groupId});
    for(const chat of members.filter(tab=>tab.url && new URL(tab.url).hostname==='chatgpt.com'))pairs.push({jobTabId:site.id,chatTabId:chat.id,groupId:site.groupId,windowId:site.windowId});
  }
  if(pairs.length===1)return saveRun(id,{...pairs[0],ready:false});
  return null;
}
// The job's run, only while its tabs are open: found again if Chrome restored them under new ids.
async function findRun(id) {
  const run=(await runs())[id];
  if(await liveTabs(run))return run;
  return recoverRun(id);
}
async function getRun(id) {const run=await findRun(id);if(!run)throw new Error("This job's window is not open. Choose Reopen windows.");return run;}
// For a step you start: if the job's window is gone (closed, or Chrome was restarted),
// it is opened again first, so the step carries on instead of failing.
async function ensureRun(id) {
  const run=await findRun(id);
  if(run)return run;
  const job=await request(jobPath(id));
  if(['completed','unlinked'].includes(job.status))throw new Error('This application has already ended.');
  await openTabs(id,{checkReady:false});
  return getRun(id);
}
const jobPath = id => '/v1/jobs/' + encodeURIComponent(id);
// Saved answers for each profile and site, kept across jobs. Writes are queued
// so a fill and a submit report arriving together cannot drop each other.
let siteWrites = Promise.resolve();
async function siteBooks() {return (await chrome.storage.local.get('siteAnswers')).siteAnswers || {};}
function rememberSite(job,fields,values) {
  const write=siteWrites.then(async()=>{
    if(!job?.profileId)return 0;
    const all=await siteBooks(),books={...all[job.profileId]},basis=profileBasis(job.profile);
    let saved=0;
    for(const site of new Set(fields.map(field=>field.site).filter(Boolean))) {
      const result=learnSiteAnswers(books[site],fields.filter(field=>field.site===site),values,{jobId:job.id,company:job.company,basis});
      books[site]=result.book;saved+=result.saved;
    }
    all[job.profileId]=books;
    await chrome.storage.local.set({siteAnswers:all});
    return saved;
  });
  siteWrites=write.catch(()=>{});
  return write;
}
// Answers that need no ChatGPT: saved site answers in the site's wording, then
// profile facts. Contact fields are "fixed": they come from the profile or stay blank.
async function knownAnswers(job,fields) {
  const books=(await siteBooks())[job.profileId] || {},basis=profileBasis(job.profile),site=new Map();
  let restored=fields;
  for(const name of new Set(fields.map(field=>field.site).filter(Boolean))) {
    const result=recallSiteAnswers(restored.filter(field=>field.site===name),books[name],basis);
    const byId=new Map(result.fields.map(field=>[field.id,field]));
    restored=restored.map(field=>byId.get(field.id) || field);
    for(const item of result.answers)site.set(item.id,item.answer);
  }
  const profile=profileAnswers(restored,job.profile);
  return {fields:restored,site,profile:new Map(profile.answers.map(item=>[item.id,item.answer])),fixed:new Set(profile.fixed)};
}
// Reads what the form shows now, including the user's own corrections, and saves it.
async function harvestAnswers(id,run) {
  const fields=run.fields || [];
  if(!fields.length || !run.jobTabId)return null;
  const values=[];
  for(const frameId of new Set(fields.map(field=>field.frameId))) {
    const result=await page(run.jobTabId,'values',[],frameId).catch(()=>null);
    if(!result || result.scanId!==fields.find(field=>field.frameId===frameId)?.scanId)continue;
    for(const item of result.values)values.push({id:`${frameId}:${item.id}`,value:item.value});
  }
  if(!values.length)return null;
  return rememberSite(await request(jobPath(id)),fields,values);
}
// The page reports its final values when the user clicks Submit.
async function rememberSubmitted(message,sender) {
  const tabId=sender.tab?.id,frameId=sender.frameId || 0;
  const [id,run]=Object.entries(await runs()).find(([,item])=>item.jobTabId===tabId) || [];
  const fields=run?.fields || [];
  if(!id || !Array.isArray(message.values) || fields.find(field=>field.frameId===frameId)?.scanId!==message.scanId)return;
  await rememberSite(await request(jobPath(id)),fields,message.values.map(item=>({id:`${frameId}:${item.id}`,value:item.value})));
}
async function siteMemory(job,run) {
  const books=(await siteBooks())[job.profileId] || {},basis=profileBasis(job.profile);
  return [...new Set((run.fields || []).map(field=>field.site).filter(Boolean))].map(site=>({site,count:siteAnswerCount(books[site],basis)}));
}
async function page(tabId, method, args = [], frameId = 0) {
  // Lets a fill read React's own value for a field (see page-main.js).
  if(method==='fill')await chrome.scripting.executeScript({target:{tabId,frameIds:[frameId]},world:'MAIN',files:['page-main.js']}).catch(()=>{});
  await chrome.scripting.executeScript({target:{tabId,frameIds:[frameId]},files:['page-tools.js']});
  const result = await chrome.scripting.executeScript({target:{tabId,frameIds:[frameId]},func:async (name,values) => {try{return {value:await globalThis.ResumeApplyPage[name](...values)};}catch(e){return {error:e.message};}},args:[method,args]});
  const output = result[0] && result[0].result;
  if (!output || output.error) throw new Error(output && output.error || 'The page could not run this step. Reload it and retry.');
  return output.value;
}
const chat = (tabId, method, ...args) => runChat(tabId, method, args, true);
// Used while watching for a reply, so the user can keep working in other tabs.
const quietChat = (tabId, method, ...args) => runChat(tabId, method, args, false);
async function runChat(tabId, method, args, takeFocus) {
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url || new URL(tab.url).hostname !== 'chatgpt.com') throw new Error('The assigned ChatGPT tab is no longer on chatgpt.com.');
  if (method === 'send' || method === 'collectCodeBlocks') {
    if(takeFocus) {
      await chrome.tabs.update(tabId,{active:true});
      await chrome.windows.update(tab.windowId,{focused:true});
    }
    await waitComplete(tabId);
  }
  // Native editor commands must run in the page's editing context.
  // Keep response monitoring isolated so it can still use chrome.runtime.
  const world = method === 'send' ? 'MAIN' : 'ISOLATED';
  await chrome.scripting.executeScript({target:{tabId},world,files:['chatgpt-tools.js']});
  const result = await chrome.scripting.executeScript({target:{tabId},world,func:async (name,values) => {try{return {value:await globalThis.ResumeApplyChat[name](...values)};}catch(e){return {error:e.message};}},args:[method,args]});
  const output = result[0] && result[0].result;
  if (!output || output.error) throw new Error(output && output.error || 'The page could not run this step. Reload it and retry.');
  return output.value;
}
async function readChatJson(run, receipt, parse, expectedPrompt, {quiet=false}={}) {
  const read=quiet?quietChat:chat;
  let originalError;
  try {
    const result=await read(run.chatTabId,'readForReview',receipt,expectedPrompt);
    return {...result,response:parse(result.response)};
  }catch(error){
    if(/still generating|still changing/.test(error.message))throw error;
    originalError=error;
  }
  const blocks=await read(run.chatTabId,'collectCodeBlocks');
  function fromCandidates(values) {
    for(const value of values)try{return parse(value);}catch(_){}
    return null;
  }
  let response=fromCandidates(blocks.candidates);
  if(response) {
    await new Promise(resolve=>setTimeout(resolve,750));
    const stable=await read(run.chatTabId,'collectCodeBlocks');
    if(stable.url!==blocks.url || !stable.candidates.some(value=>{try{return JSON.stringify(JSON.parse(parse(value)))===JSON.stringify(JSON.parse(response));}catch(_){return false;}}))throw new Error('The JSON block is still changing. Wait and read again.');
    return {response,url:blocks.url,matched:false};
  }
  for(const token of blocks.copyTargets.slice(0,3)) {
    const result=await chrome.scripting.executeScript({target:{tabId:run.chatTabId},world:'MAIN',func:captureCodeCopy,args:[token]});
    const copied=result[0]?.result;
    response=copied?.text && fromCandidates([copied.text]);
    if(response)return {response,url:blocks.url,matched:false};
  }
  throw new Error(`The completed response could not be read from the assigned ChatGPT tab${blocks.title ? ' ('+blocks.title+')' : ''}. Open the finished conversation in that tab and retry Read. Plain JSON is supported; a code block is optional. `+(originalError?.message || ''));
}
async function readResumeJson(run,expectedPrompt,options) {return readChatJson(run,run.resumeReceipt,resumeResponse,expectedPrompt,options);}
function answerJson(source,fields) {
  const trimmed=String(source).trim(),start=trimmed.indexOf('{'),end=trimmed.lastIndexOf('}');
  return JSON.stringify(decodeReply(start>=0 ? trimmed.slice(start,end+1) : trimmed,fields));
}
// Question ids are positional within the last request, which may cover only some fields.
const askedFields=run=>run.pickFields?run.pickFields:run.answerFieldIds?(run.fields || []).filter(field=>run.answerFieldIds.includes(field.id)):run.fields || [];
async function collectAnswers(id,run,response) {
  const asked=askedFields(run),{retry=[]}=JSON.parse(response);
  // Contact facts come from the profile only, never from ChatGPT.
  const fixed=new Set(run.fixedIds || []);
  const generated=mergeGeneratedAnswers(asked,parseAnswers(response,asked)).filter(item=>!fixed.has(item.id));
  const answerBook=rememberAnswers(run.answerBook,run.fields || [],generated);
  // Answers just generated belong to these exact fields, including repeated labels the book cannot hold.
  const byId=new Map(generated.map(item=>[item.id,item.answer]));
  const answers=currentAnswers({...run,answerBook}).answers.map(item=>byId.has(item.id)?{id:item.id,answer:byId.get(item.id)}:item);
  await saveRun(id,{answerBook,answers,answersAt:Date.now()});
  return retry;
}
async function askQuestions(id,run,ids,{retried=false}={}) {
  let wanted=new Set(ids),all;
  if(retried)all=run.fields;
  else try {all=await refreshQuestionOptions(id,run,ids);}
  catch(error){
    if(!/scan changed|question changed|scan was cleared|page changed/i.test(error.message))throw error;
    // The form re-rendered since the scan: read it again and ask about the same questions.
    const key=field=>outcomeKey(field)+'|'+field.pageUrl;
    const keys=new Set(run.fields.filter(field=>wanted.has(field.id)).map(key));
    await scanQuestions(id,{auto:true});
    run=await getRun(id);
    wanted=new Set(run.fields.filter(field=>keys.has(key(field))).map(field=>field.id));
    if(!wanted.size)throw new Error('The application questions changed. Scan questions again.');
    all=await refreshQuestionOptions(id,run,[...wanted]);
  }
  const fixed=new Set(run.fixedIds || []);
  const fields=answerableQuestions(all.filter(field=>wanted.has(field.id) && !fixed.has(field.id)));
  if(!fields.length)throw new Error('The remaining questions are answered from your profile, or left blank because the profile has no value.');
  const receipt=await chat(run.chatTabId,'send',answersPrompt(await request(jobPath(id)),fields,all),run.answerReceipt);
  // Asked once per page: a rescan must not send these again on its own.
  await saveRun(id,{answerReceipt:receipt,answerFieldIds:fields.map(field=>field.id),answerRetried:retried,askedIds:[...new Set([...(run.askedIds || []),...fields.map(field=>field.id)])]});
  await startResponseMonitor(id,'answers',receipt);
  return {receipt,count:fields.length};
}
async function startResponseMonitor(id,kind,receipt) {
  await saveRun(id,{responseMonitor:{kind,marker:receipt.marker,status:'waiting',startedAt:Date.now()},...(kind==='resume'?{pendingResumeResponse:null,pendingResumeUrl:null}:{})});
  try {await quietChat((await getRun(id)).chatTabId,'watchResponse',{id,kind,receipt});}
  catch(error){await saveRun(id,{responseMonitor:{kind,marker:receipt.marker,status:'waiting',startedAt:Date.now(),lastError:error.message}});}
}
async function collectMonitoredResponse(message,sender) {
  const run=(await runs())[message.id],monitor=run?.responseMonitor;
  if(!run || sender.tab?.id!==run.chatTabId || !sender.url?.startsWith('https://chatgpt.com/') || monitor?.marker!==message.marker || monitor.kind!==message.kind || monitor.status!=='waiting')return {stop:true};
  if(locks.has(message.id))return {retry:true};
  locks.add(message.id);
  try {
    if(message.event==='chat-response-timeout') {
      const timedOut='Automatic collection timed out. Use Read or paste the completed response.';
      await saveRun(message.id,{autopilot:null,pickFields:null,responseMonitor:{...monitor,status:'error',message:timedOut},
        ...(run.fullAuto?.active?{fullAuto:null,fullAutoBlocker:{stage:message.kind==='resume'?'resume':'questions',message:'ChatGPT did not finish in time.',at:Date.now()}}:{})});
    }else if(message.kind==='resume') {
      const detail=await request(jobPath(message.id));
      let matched=false;
      if(!detail.files) {
        const result=await readResumeJson(run,detail.resumePrompt,{quiet:true});
        matched=!!result.matched;
        await saveRun(message.id,{pendingResumeResponse:result.response,pendingResumeUrl:result.url});
      }
      await saveRun(message.id,{responseMonitor:{...monitor,status:'ready'}});
      if(run.fullAuto?.active) {
        let outcome;
        try {outcome=await fullAutoResumeReady(message.id,matched);}catch(error){outcome=await stopFullAuto(message.id,'resume',error.message);}
        chrome.runtime.sendMessage({event:'fill-progress',id:message.id,message:outcome.message}).catch(()=>{});
        return {collected:true};
      }
    }else {
      const result=await readChatJson(run,run.answerReceipt,source=>answerJson(source,askedFields(run)),undefined,{quiet:true});
      let next=null;
      if(run.pickFields)next=()=>completePicks(message.id,run,result.response);
      else {
        const retry=await collectAnswers(message.id,run,result.response);
        if(retry.length && !run.answerRetried) {
          // One automatic follow-up for just the missing or invalid answers.
          try {await askQuestions(message.id,run,retry,{retried:true});return {collected:true};}catch(_){}
        }
        if(run.autopilot?.active)next=()=>autoFillStep(message.id);
      }
      await saveRun(message.id,{responseMonitor:{...monitor,status:'ready'}});
      if(next) {
        // Marked ready first: a failure here must not re-read and re-fill the same reply.
        let outcome;
        try {outcome=await next();}catch(error){await saveRun(message.id,{autopilot:null,pickFields:null});outcome={message:error.message};}
        chrome.runtime.sendMessage({event:'fill-progress',id:message.id,message:outcome.message}).catch(()=>{});
        return {collected:true};
      }
    }
    chrome.runtime.sendMessage({event:'response-ready',id:message.id,kind:message.kind,marker:monitor.marker}).catch(()=>{});
    return {collected:true};
  }catch(error){
    await saveRun(message.id,{responseMonitor:{...monitor,lastError:error.message}});
    if(monitor.lastError!==error.message)chrome.runtime.sendMessage({event:'response-collection-progress',id:message.id}).catch(()=>{});
    return {retry:true};
  }
  finally{locks.delete(message.id);}
}
async function resumeResponseMonitors() {
  const all=await runs(),{runAnchors={}}=await chrome.storage.local.get('runAnchors');
  for(const [id,value] of Object.entries({...runAnchors,...all})) {
    if(value.responseMonitor?.status!=='waiting')continue;
    try {
      const run=all[id] || await recoverRun(id),receipt=run[value.responseMonitor.kind==='resume'?'resumeReceipt':'answerReceipt'];
      if(value.responseMonitor.kind==='answers' && !run.fields?.length){await saveRun(id,{responseMonitor:{...value.responseMonitor,status:'error',message:'The question scan was cleared. Scan the application again before requesting answers.'}});continue;}
      if(receipt)await quietChat(run.chatTabId,'watchResponse',{id,kind:value.responseMonitor.kind,receipt});
    }catch(_){}
  }
}
const outcomeKey=field=>`${field.frameId}|${field.type}|${field.label}`;
const AUTO_ROUNDS=4,AUTO_PAGES=15;
// Each field stands alone: one that cannot be filled never stops the others.
async function fillFields(id,run,requested) {
  await requireReady(run);
  const items=[],results=[];
  for(const item of requested) {
    const field=(run.fields || []).find(f=>f.id===item.id);
    const answer=field && !field.manualOnly && field.type!=='file'?optionAnswer(field,item.answer):null;
    if(answer==null)results.push({id:item.id,field,error:field?'Choose an exact answer or complete it manually.':'Field changed. Rescan.'});
    else items.push({...field,id:field.localId,answer,field,...(item.searchText?{searchText:item.searchText}:{})});
  }
  for(const frameId of [...new Set(items.map(item=>item.frameId))]) {
    const group=items.filter(item=>item.frameId===frameId);
    try {
      const filled=await page(run.jobTabId,'fill',[group.map(({field,...item})=>item)],frameId);
      group.forEach((item,index)=>results.push({...filled[index],field:item.field}));
    }catch(error){group.forEach(item=>results.push({id:item.id,field:item.field,error:error.message}));}
  }
  const answerBook=rememberAnswers(run.answerBook,run.fields || [],items.map(item=>({id:item.field.id,answer:item.answer})));
  // Saved for the site only once the site accepted it, in the wording it shows.
  const confirmed=results.filter(result=>result.filled && result.field).map(result=>({id:result.field.id,value:result.value ?? items.find(item=>item.field.id===result.field.id)?.answer}));
  if(confirmed.length)try {await rememberSite(await request(jobPath(id)),run.fields || [],confirmed);}catch(_){ /* saving must never fail a fill */ }
  const patch={answerBook};
  if(run.autopilot?.active) {
    const keys=items.map(item=>`${item.pageUrl}|${outcomeKey(item.field)}`);
    patch.autopilot={...run.autopilot,attempted:[...new Set([...run.autopilot.attempted,...keys])]};
    patch.autoTried=[...new Set([...(run.autoTried || []),...keys])];
  }
  await saveRun(id,patch);
  return results;
}
const withoutField=results=>results.map(({field,candidates,query,...result})=>({...result,label:field?.label || ''}));
async function finishFill(id,results) {
  const fillResults=withoutField(results);
  await saveRun(id,{fillResults,pickFields:null,pendingFillResults:null});
  // Answers can reveal more questions, so read the form again before reporting.
  const fillOutcomes=new Map(results.filter(r=>r.field).map(({field,filled,error})=>[outcomeKey(field),{filled:!!filled,error}]));
  let newQuestions=0;
  try {await page((await getRun(id)).jobTabId,'settled').catch(()=>{});newQuestions=(await scanQuestions(id,{fillOutcomes})).newQuestions;}catch(_){}
  if(results.length && results.every(r=>r.filled))await request(jobPath(id)+'/status',{status:'filled'});
  const failures=fillResults.filter(r=>r.error),count=fillResults.length-failures.length;
  const summary=[`Filled ${count} of ${fillResults.length} fields.`];
  if(failures.length)summary.push(`Needs attention: ${failures.map(r=>`${r.label || 'Unknown field'} (${r.error})`).join('; ')}`);
  if(newQuestions)summary.push(`${newQuestions} new question${newQuestions===1?'':'s'} appeared. Click Ask ChatGPT.`);
  else if(!failures.length)summary.push('Check the application and submit yourself.');
  return {message:summary.join(' '),results:fillResults,newQuestions,filled:count,failures};
}
// Dropdowns that load results as you type can return several places or schools.
// ChatGPT picks from what the site really offered, by option id.
async function settleFill(id,run,results,{allowPicks=true}={}) {
  const needing=allowPicks?results.filter(r=>r.candidates?.length && r.field):[];
  if(needing.length) {
    try {
      const pickFields=needing.map(({field,candidates,query})=>({id:field.id,label:field.label,type:'combobox',answerFormat:'single',options:candidates,optionsStatus:'complete',searchText:query}));
      const receipt=await chat(run.chatTabId,'send',answersPrompt(await request(jobPath(id)),pickFields,run.fields),run.answerReceipt);
      await saveRun(id,{answerReceipt:receipt,pickFields,pendingFillResults:results.filter(r=>!r.candidates?.length)});
      await startResponseMonitor(id,'answers',receipt);
      return {message:`Asking ChatGPT to choose from the site's results for: ${needing.map(r=>r.field.label).join(', ')}.`,results:withoutField(results)};
    }catch(_){}
  }
  const done=await finishFill(id,results);
  const current=await getRun(id);
  if(!current.autopilot?.active)return done;
  const autopilot={...current.autopilot,filled:current.autopilot.filled+done.filled,failed:[...current.autopilot.failed,...done.failures]};
  await saveRun(id,{autopilot});
  return done.newQuestions && autopilot.round<AUTO_ROUNDS?autoFillStep(id):advanceOrFinish(id);
}
async function completePicks(id,run,response) {
  const picked=new Map(JSON.parse(response).answers.map(item=>[item.id,item.answer]));
  const requested=[],unresolved=[];
  for(const pick of run.pickFields) {
    const field=run.fields.find(item=>item.id===pick.id),answer=picked.get(pick.id);
    if(answer && field)requested.push({id:pick.id,answer,searchText:pick.searchText});
    else unresolved.push({id:pick.id,field,error:"None of the site's results fit. Choose it manually."});
  }
  const results=[...run.pendingFillResults,...unresolved,...await fillFields(id,run,requested)];
  return settleFill(id,await getRun(id),results,{allowPicks:false});
}
async function uploadResumeField(id,run,field) {
  const file=await request(jobPath(id)+'/docx');
  const results=await page(run.jobTabId,'fill',[[{...field,id:field.localId,file}]],field.frameId);
  if(results[0]?.error)throw new Error(results[0].error);
  const upload=await page(run.jobTabId,'uploadFinished',[field.localId],field.frameId);
  if(upload.status!=='done')throw new Error(`${upload.message} Attach it on the form yourself, then continue.`);
  await saveRun(id,{resumeUploadedUrl:field.pageUrl});
  await page(run.jobTabId,'settled').catch(()=>{});
}
// One click: read the form, upload the resume, get answers, fill, and repeat for
// any questions the answers reveal. Next, Submit and consent stay with the user.
async function startAutoFill(id,run) {
  await saveRun(id,{autoSummary:null,autopilot:{active:true,round:0,filled:0,failed:[],attempted:[],note:'',page:1,pageFailures:0,previousPage:null,waiting:null}});
  return autoFillPage(id);
}
const pageSignature=fields=>`${fields[0]?.pageUrl || ''}|${fields.map(field=>field.label).join('|')}`;
async function pageBlocker(run) {
  try {
    await chrome.scripting.executeScript({target:{tabId:run.jobTabId,allFrames:true},files:['page-tools.js']});
    const results=await chrome.scripting.executeScript({target:{tabId:run.jobTabId,allFrames:true},func:()=>globalThis.ResumeApplyPage.blocker()});
    return results.map(item=>item.result).find(Boolean) || null;
  }catch(_){return page(run.jobTabId,'blocker').catch(()=>null);}
}
async function autoFillPage(id) {
  const run=await getRun(id);
  try {
    const blocked=await pageBlocker(run);
    if(blocked) {
      // The panel checks back and carries on once the user has finished.
      await saveRun(id,{autopilot:{...run.autopilot,waiting:blocked.kind}});
      return {message:blocked.message,waiting:true};
    }
    await scanQuestions(id,{auto:true});
    let current=await getRun(id);
    if(current.autopilot.previousPage && current.autopilot.previousPage===pageSignature(current.fields)) {
      await saveRun(id,{autopilot:{...current.autopilot,note:'Clicked Next, but the form did not move on. Check the errors it shows.'}});
      return finishAutoFill(id,{closing:'Fix those, then click Auto-fill again.'});
    }
    await saveRun(id,{autopilot:{...current.autopilot,previousPage:null}});
    current=await getRun(id);
    const resume=current.fields.find(field=>field.type==='file' && field.resumeUpload && !field.manualOnly);
    if(resume && current.resumeUploadedUrl!==resume.pageUrl) {
      const job=await request(jobPath(id));
      let note='Resume not uploaded: generate and export it first.';
      if(job.files?.docx)try {await uploadResumeField(id,current,resume);await scanQuestions(id,{auto:true});note='';}catch(error){note=`Resume not uploaded: ${error.message}`;}
      current=await getRun(id);
      await saveRun(id,{autopilot:{...current.autopilot,note}});
    }
    return await autoFillStep(id);
  }catch(error){await saveRun(id,{autopilot:null});throw error;}
}
async function autoFillStep(id) {
  const run=await getRun(id),autopilot=run.autopilot;
  if(!autopilot?.active)return {message:'Auto-fill stopped.'};
  const recalled=currentAnswers(run);
  if(recalled.unasked.length) {
    if(autopilot.round>=AUTO_ROUNDS)return finishAutoFill(id);
    await saveRun(id,{autopilot:{...autopilot,round:autopilot.round+1}});
    const {count}=await askQuestions(id,run,recalled.unasked);
    return {message:`Asked ChatGPT ${count} question${count===1?'':'s'}. Auto-fill will continue when it replies.`};
  }
  const attempted=new Set(autopilot.attempted),tried=new Set(run.autoTried || []);
  // A field filled on an earlier click and still holding a value may be the user's own fix.
  const due=field=>{const key=`${field.pageUrl}|${outcomeKey(field)}`;return !attempted.has(key) && !(tried.has(key) && field.answered);};
  const requested=answerableQuestions(run.fields).filter(field=>!field.manualOnly && field.type!=='file' && due(field)).map(field=>({id:field.id,answer:recalled.answers.find(item=>item.id===field.id)?.answer})).filter(item=>item.answer!=null && item.answer!=='');
  if(!requested.length)return advanceOrFinish(id);
  await request(jobPath(id)+'/status',{status:'answers-reviewed'});
  const results=await fillFields(id,run,requested);
  return settleFill(id,await getRun(id),results);
}
// Moves on only when this page is complete, so a form is never pushed past a gap.
async function advanceOrFinish(id) {
  const run=await getRun(id),autopilot=run.autopilot;
  if(!autopilot?.active)return finishAutoFill(id);
  const fields=run.fields || [];
  const needsYou=!!autopilot.note || autopilot.failed.length>autopilot.pageFailures || fields.some(field=>field.required && !field.answered && field.type!=='file' || field.required && !field.answered && field.manualOnly);
  if(needsYou)return finishAutoFill(id,{closing:'Stopped before Next. Finish those items, then click Auto-fill again to continue.'});
  const blocked=await pageBlocker(run);
  if(blocked) {
    await saveRun(id,{autopilot:{...autopilot,waiting:blocked.kind}});
    return {message:blocked.message,waiting:true};
  }
  if(!fields.length || autopilot.page>=AUTO_PAGES)return finishAutoFill(id);
  const counts=new Map();for(const field of fields)counts.set(field.frameId,(counts.get(field.frameId) || 0)+1);
  const frameId=[...counts].sort((a,b)=>b[1]-a[1])[0][0];
  const moved=await page(run.jobTabId,'clickNext',[],frameId).catch(()=>null);
  if(!moved)return finishAutoFill(id);
  await saveRun(id,{autopilot:{...autopilot,round:0,attempted:[],page:autopilot.page+1,pageFailures:autopilot.failed.length,previousPage:pageSignature(fields)}});
  await new Promise(resolve=>setTimeout(resolve,800));
  await waitComplete(run.jobTabId);
  await page(run.jobTabId,'settled').catch(()=>{});
  return autoFillPage(id);
}
async function finishAutoFill(id,{closing='This is the last page Auto-fill can reach. Check the form, then click Submit yourself.'}={}) {
  const run=await getRun(id),autopilot=run.autopilot || {filled:0,failed:[],note:''};
  const recalled=currentAnswers(run);
  const blank=answerableQuestions(run.fields || []).filter(field=>!field.manualOnly && (recalled.answers.find(item=>item.id===field.id)?.answer ?? '')==='').map(field=>field.label);
  const manual=(run.fields || []).filter(field=>field.manualOnly).map(field=>field.label);
  const parts=[`Auto-fill finished: ${autopilot.filled} field${autopilot.filled===1?'':'s'} filled.`];
  if(autopilot.note)parts.push(autopilot.note);
  if(autopilot.failed.length)parts.push(`Needs attention: ${autopilot.failed.map(item=>`${item.label || 'Unknown field'} (${item.error})`).join('; ')}.`);
  if(blank.length)parts.push(`No answer available: ${blank.join('; ')}.`);
  if(manual.length)parts.push(`Complete yourself: ${manual.join('; ')}.`);
  parts.push(closing);
  // Kept so the app shows how Auto-fill ended until the next run.
  const needsYou=!!autopilot.note || autopilot.failed.length>0 || blank.length>0 || manual.length>0;
  await saveRun(id,{autopilot:null,autoSummary:{text:needsYou?'Needs you: '+parts.slice(1,-1).join(' '):'Form filled. Check it, then submit it yourself.',needsYou}});
  return {message:parts.join(' '),done:true};
}
// Carries on with Auto-fill once the user is past a CAPTCHA, sign-in or code, even when no
// side panel is open. Runs on the background heartbeat.
async function resumeWaitingAutoFill() {
  for (const [id, run] of Object.entries(await runs())) {
    if (!run.autopilot?.waiting || locks.has(id)) continue;
    locks.add(id);
    try {
      if (await pageBlocker(run)) continue;
      await saveRun(id,{autopilot:{...run.autopilot,waiting:null}});
      const outcome = await autoFillPage(id);
      chrome.runtime.sendMessage({event:'fill-progress',id,message:outcome.message}).catch(() => {});
    } catch (_) { /* reported through the job's progress */ } finally {locks.delete(id);}
  }
}
// ---------- Full auto: the whole application from one click ----------
// Opens the pages, reads the JD, has ChatGPT write the resume, exports it, then Auto-fills the
// application page by page. The first blocker stops it and hands that step back to you, with the
// reason, in the Resume Apply window and the app. It never clicks Submit.
const FULL_AUTO_MIN_JD = 200;
const FULL_AUTO_STEP = {pages:'Job', resume:'Resume', questions:'Questions'};
async function startFullAuto(id) {
  const job = await request(jobPath(id));
  if (['completed','unlinked'].includes(job.status)) throw new Error('This application has already ended.');
  await saveRun(id,{fullAuto:{active:true,stage:'pages',startedAt:Date.now()},fullAutoBlocker:null,autoSummary:null});
  return fullAutoContinue(id);
}
async function stopFullAuto(id,stage,reason) {
  await saveRun(id,{fullAuto:null,fullAutoBlocker:{stage,message:reason,at:Date.now()}});
  return {message:`Full auto stopped at ${FULL_AUTO_STEP[stage]}: ${reason} Finish this step yourself, or fix it and click Full auto again to carry on.`,blocked:stage};
}
async function fullAutoContinue(id) {
  let run = (await runs())[id] || await recoverRun(id);
  if (run && !run.fullAuto?.active) return {message:'Full auto stopped.'};
  let stage = 'pages';
  try {
    // 1. The job and ChatGPT pages: reopened only if they are gone, so the job's status stays.
    let open = !!run;
    if (open) try {await chrome.tabs.get(run.jobTabId);await chrome.tabs.get(run.chatTabId);} catch (_) {open = false;}
    if (!open) {
      if (!run) await saveRun(id,{fullAuto:{active:true,stage:'pages',startedAt:Date.now()}});
      await openTabs(id,{checkReady:false});
    }
    run = await getRun(id);
    await requireReady(run);
    let job = await request(jobPath(id));
    // 2. The resume, unless it is already exported.
    if (!job.files) {
      stage = 'resume';
      await saveRun(id,{fullAuto:{...run.fullAuto,stage}});
      if (run.pendingResumeResponse) return stopFullAuto(id,stage,'The resume ChatGPT wrote needs your review before it is exported.');
      if (run.responseMonitor?.kind === 'resume' && run.responseMonitor.status === 'waiting') return {message:'Waiting for ChatGPT to write the resume. Full auto carries on when it finishes.'};
      // A JD you already reviewed is kept; otherwise it is read from the page.
      let posting = job.jd ? {company:job.company || '', title:job.title || '', description:job.jd} : (await command({action:'extract',id})).job;
      const description = String(posting?.description || '').trim();
      if (description.length < FULL_AUTO_MIN_JD) return stopFullAuto(id,stage,description ? 'The job description read from the page looks incomplete.' : 'No job description was found on the page.');
      await command({action:'sendResume',id,job:{company:String(posting.company || '').trim(),title:String(posting.title || '').trim(),description}});
      const receipt = (await getRun(id)).resumeReceipt || {};
      return {message:receipt.manualSend || receipt.sendUnconfirmed
        ? 'Resume prompt inserted in ChatGPT, but sending was not confirmed. Press Send there if it has not gone; Full auto carries on when the reply finishes.'
        : 'Resume prompt sent. Full auto carries on when ChatGPT finishes.'};
    }
    // 3. The application: Auto-fill takes over from here and reports how it ends.
    stage = 'questions';
    await saveRun(id,{fullAuto:null});
    const outcome = await startAutoFill(id,await getRun(id));
    return {...outcome,message:`Resume ready. ${outcome.message}`};
  } catch (error) {return stopFullAuto(id,stage,error.message || String(error));}
}
// The resume reply was collected while Full auto was running: export it only when it is
// certainly this job's reply, then move on to the application.
async function fullAutoResumeReady(id,matched) {
  const run = await getRun(id);
  if (!run.fullAuto?.active) return {message:'Full auto stopped.'};
  if (!(await request(jobPath(id))).files) {
    if (!run.pendingResumeResponse) return stopFullAuto(id,'resume','The resume reply could not be read.');
    if (!matched) return stopFullAuto(id,'resume',"ChatGPT's reply could not be matched to this job for certain. Review the resume, then export it.");
    try {await request(jobPath(id)+'/resume',{response:run.pendingResumeResponse});}
    catch (error) {return stopFullAuto(id,'resume',`The resume could not be exported: ${error.message}`);}
    await saveRun(id,{pendingResumeResponse:null,pendingResumeUrl:null});
  }
  return fullAutoContinue(id);
}
async function waitComplete(tabId) {
  const until = Date.now() + 60000;
  while (Date.now() < until) {const tab = await chrome.tabs.get(tabId);if (tab.status === 'complete') return tab;await new Promise(resolve => setTimeout(resolve,500));}
  throw new Error('Page load timed out. Finish any sign-in or verification and retry.');
}
async function requireReady(run) {
  await Promise.all([waitComplete(run.jobTabId),waitComplete(run.chatTabId)]);
  const tab = await chrome.tabs.get(run.jobTabId);
  if (!tab.url || !await chrome.permissions.contains({origins:[new URL(tab.url).origin + '/*']})) throw new Error('Grant access to the current job-site origin from Open / check tabs.');
  if (!run.ready) {
    const settled = await Promise.all([page(run.jobTabId,'settled'),page(run.chatTabId,'settled')]);
    if (settled.some(x => !x)) throw new Error('A page is still loading. Wait and check the pages again.');
    if (run.id) {await saveRun(run.id,{ready:true,needsSiteAccess:false});await request(jobPath(run.id)+'/status',{status:'tabs-ready'});}
  }
  return tab;
}
// Job windows are cascaded so part of every one stays on screen. Chrome treats a
// window that is completely covered as hidden and slows its timers, which would
// stall filling and reading ChatGPT in the jobs behind.
const CASCADE_STEP = 32, CASCADE_SLOTS = 8, PANEL_WIDTH = 400;
async function jobWindowArea() {
  const {jobWindowArea: saved} = await chrome.storage.session.get('jobWindowArea');
  if (saved) return saved;
  // The user's own browser window (usually maximized) marks out the screen to use.
  const windows = await chrome.windows.getAll({windowTypes:['normal']});
  const jobWindows = new Set(Object.values(await runs()).map(run => run.windowId).filter(Boolean));
  const base = windows.find(win => win.focused && !jobWindows.has(win.id)) || windows.find(win => !jobWindows.has(win.id)) || windows[0];
  const area = base && base.width ? {left:base.left || 0, top:base.top || 0, width:base.width, height:base.height} : null;
  if (area) await chrome.storage.session.set({jobWindowArea:area});
  return area;
}
async function openJobWindow(url, id) {
  const all = await runs(), used = new Set();
  for (const [otherId, other] of Object.entries(all)) {
    if (otherId === id || other.windowSlot == null || !other.windowId) continue;
    try {await chrome.windows.get(other.windowId);used.add(other.windowSlot);} catch (_) { /* closed */ }
  }
  let slot = 0;while (used.has(slot) && slot < CASCADE_SLOTS - 1) slot++;
  const area = await jobWindowArea().catch(() => null);
  const span = CASCADE_STEP * (CASCADE_SLOTS - 1);
  const bounds = area && area.width > span + 600 && area.height > span + 400
    ? {left:area.left + slot * CASCADE_STEP, top:area.top + slot * CASCADE_STEP, width:area.width - span, height:area.height - span}
    : {};
  const win = await chrome.windows.create({url, type:'normal', focused:true, ...bounds});
  await saveRun(id,{windowId:win.id, windowSlot:slot});
  return win.tabs[0];
}
// The job's own Resume Apply window: a narrow window without tabs or address bar, docked
// to the right of the job window, that only ever works on this job. Opens by itself.
const jobPanelUrl = id => chrome.runtime.getURL('panel.html?job=' + encodeURIComponent(id));
async function openPanelWindow(id, jobWindowId, existingId) {
  const jobWindow = await chrome.windows.get(jobWindowId);
  if (jobWindow.state === 'maximized' || jobWindow.state === 'fullscreen') await chrome.windows.update(jobWindowId,{state:'normal'}).catch(() => {});
  const current = await chrome.windows.get(jobWindowId);
  const area = await jobWindowArea().catch(() => null);
  const {job, panel} = panelBounds(current, area, PANEL_WIDTH);
  let shrink = 0;
  if (current.state === 'normal' && job.width < current.width) {
    await chrome.windows.update(jobWindowId,{width:job.width}).catch(() => {});
    shrink = current.width - job.width;
  }
  const place = current.state === 'normal' ? panel : {};
  if (existingId) {
    let open = false;try {await chrome.windows.get(existingId);open = true;} catch (_) { /* closed: open it again */ }
    if (open) {await chrome.windows.update(existingId,{...place,focused:false}).catch(() => {});return {id:existingId, shrink};}
  }
  // On a screen too small to dock it, Chrome refuses the position; open it where Chrome chooses.
  const win = await chrome.windows.create({url:jobPanelUrl(id),type:'popup',focused:false,...place})
    .catch(() => chrome.windows.create({url:jobPanelUrl(id),type:'popup',focused:false,width:PANEL_WIDTH}));
  return {id:win.id, shrink};
}
// Opens (or brings back) the job's Resume Apply window, docked to the right of its window.
async function showDetails(id) {
  const run = await ensureRun(id);
  let tab;try {tab = await chrome.tabs.get(run.jobTabId);} catch (_) {throw new Error("This job's window was closed. Choose Reopen windows.");}
  const docked = await openPanelWindow(id, tab.windowId, run.panelWindowId);
  await saveRun(id,{panelWindowId:docked.id, panelShrink:(run.panelWindowId === docked.id ? run.panelShrink || 0 : 0) + docked.shrink});
  raising = Date.now();
  await chrome.windows.update(tab.windowId,{focused:true}).catch(() => {});
  raising = Date.now();
  await chrome.windows.update(docked.id,{focused:true}).catch(() => {});
  return {message:"Showing this job's details in Chrome."};
}
// Clicking a job window brings its Resume Apply window up with it; closing the job
// window closes its Resume Apply window.
let raising = 0;
chrome.windows.onFocusChanged.addListener(async windowId => {
  if (windowId === chrome.windows.WINDOW_ID_NONE || Date.now() - raising < 800) return;
  const run = Object.values(await runs()).find(item => item.windowId === windowId && item.panelWindowId);
  if (!run) return;
  raising = Date.now();
  await chrome.windows.update(run.panelWindowId,{focused:true}).catch(() => {});
  await chrome.windows.update(windowId,{focused:true}).catch(() => {});
});
chrome.windows.onRemoved.addListener(async windowId => {
  for (const [id, run] of Object.entries(await runs())) {
    if (run.windowId === windowId && run.panelWindowId) {await chrome.windows.remove(run.panelWindowId).catch(() => {});await saveRun(id,{panelWindowId:null});}
    else if (run.panelWindowId === windowId) {
      if (run.panelShrink > 0) {
        try {const win = await chrome.windows.get(run.windowId);if (win.state === 'normal') await chrome.windows.update(run.windowId,{width:win.width + run.panelShrink});} catch (_) { /* job window gone */ }
      }
      await saveRun(id,{panelWindowId:null, panelShrink:0});
    }
  }
});
// The job description from the posting behind an application-form link, trying each
// known source in turn (the site's public posting data, then the posting page itself).
async function postingDescription(link) {
  for (const source of jdSources(link)) {
    try {
      const res = await fetch(source.url, {headers:{Accept:source.kind === 'page' ? 'text/html' : 'application/json'}, credentials:'omit', signal:AbortSignal.timeout(15000)});
      if (!res.ok) continue;
      const posting = parseJdSource(source, await res.text());
      if (posting) return {...posting, url:source.kind === 'page' ? source.url : link};
    } catch (_) { /* try the next source */ }
  }
  return null;
}
async function openTabs(id, {checkReady = true} = {}) {
  const job = await request(jobPath(id));
  let run = (await runs())[id] || await recoverRun(id) || {};
  let jobTab, chatTab;
  try {jobTab = await chrome.tabs.get(run.jobTabId);} catch (_) { /* not opened yet */ }
  try {chatTab = await chrome.tabs.get(run.chatTabId);} catch (_) { /* not opened yet */ }
  // Each job gets its own window with the job site and its own new ChatGPT conversation
  // side by side, and its own Resume Apply window docked on the right.
  if (!jobTab) jobTab = await openJobWindow(job.url,id);
  if (!chatTab) chatTab = await chrome.tabs.create({url:'https://chatgpt.com/',windowId:jobTab.windowId,active:false});
  // A Resume Apply tab from an earlier layout is replaced by the docked window.
  if (run.panelTabId) {await chrome.tabs.remove(run.panelTabId).catch(() => {});}
  const layout = await arrangeWorkspace(chrome,jobTab.id,chatTab.id);
  let panelWindowId = null;
  if (run.panelWindowId) {try {await chrome.windows.get(run.panelWindowId);panelWindowId = (await openPanelWindow(id,jobTab.windowId,run.panelWindowId)).id;} catch (_) { /* closed */ }}
  await chrome.tabGroups.update(layout.groupId,{title:(job.company || job.title || 'Job application').slice(0,80),color:'blue',collapsed:false});
  const hasAccess = await chrome.permissions.contains({origins:[new URL(job.url).origin+'/*']});
  run = await saveRun(id,{jobTabId:jobTab.id,chatTabId:chatTab.id,panelTabId:null,panelWindowId,windowId:jobTab.windowId,...layout,layoutNotice:layout.layoutNotice || '',ready:false,autoOpened:true,needsSiteAccess:!hasAccess,autoOpenError:''});
  await chrome.storage.session.set({activeJobId:id});
  await request(jobPath(id)+'/status',{status:'tabs-opened'});
  await chrome.tabs.update(jobTab.id,{active:true});
  await chrome.windows.update(jobTab.windowId,{focused:true});
  if (checkReady) await requireReady(run);
  return {message:layout.layout === 'split' ? 'Job site and ChatGPT are side by side.' : layout.layoutNotice,layout:layout.layout};
}
async function openNewAssignments(state) {
  for (const job of state.jobs.filter(job => job.status === 'assigned')) {
    const existing = (await runs())[job.id];
    if (existing && existing.autoOpenAttempted || locks.has(job.id)) continue;
    locks.add(job.id);
    try {
      await saveRun(job.id,{autoOpenAttempted:true});
      await openTabs(job.id,{checkReady:false});
    } catch (error) {await saveRun(job.id,{autoOpenError:error.message});}
    finally {locks.delete(job.id);}
    chrome.runtime.sendMessage({event:'jobs-updated',id:job.id}).catch(() => {});
  }
}
// Steps started from the app: each runs exactly as the same button in the job's Resume
// Apply window would, one at a time per job, and its outcome is reported to the app.
const runningCommands = new Set();
const APP_COMMANDS = {
  open: id => command({action:'open',id}),
  // Detect the job description, then send the resume prompt to this job's ChatGPT.
  prepare: async id => {const {job} = await command({action:'extract',id});return command({action:'sendResume',id,job});},
  confirmResume: id => command({action:'confirmResume',id,confirmed:true}),
  auto: id => command({action:'auto',id}),
  fullAuto: id => command({action:'fullAuto',id}),
  scan: id => command({action:'scan',id}),
  fill: async id => {
    const run = await getRun(id);
    const answers = currentAnswers(run).answers.filter(item=>item.answer!=null && item.answer!=='' && !(Array.isArray(item.answer) && !item.answer.length)).map(item => ({id:item.id, answer:item.answer}));
    if (!answers.length) throw new Error('There are no answers to fill yet. Ask ChatGPT first.');
    return command({action:'fill',id,approved:true,answers});
  },
  ask: id => command({action:'sendAnswers',id}),
  complete: id => command({action:'complete',id,confirmed:true}),
  details: id => showDetails(id),
  // Brings the job's window to the front with its application tab showing; its Resume Apply
  // window comes up with it.
  focus: async id => {
    const run = await ensureRun(id);
    let tab;try {tab = await chrome.tabs.get(run.jobTabId);} catch (_) {throw new Error("This job's window was closed. Click Reopen.");}
    const win = await chrome.windows.get(tab.windowId);
    // Resume Apply first, then the job window on top of it, so typing goes to the job page.
    // The focus handler that brings Resume Apply along is held off meanwhile.
    raising = Date.now();
    if (win.state === 'minimized') await chrome.windows.update(tab.windowId,{state:'normal'});
    await chrome.tabs.update(tab.id,{active:true});
    if (run.panelWindowId) await chrome.windows.update(run.panelWindowId,{focused:true}).catch(() => {});
    raising = Date.now();
    await chrome.windows.update(tab.windowId,{focused:true});
    return {message:'Showing this job in Chrome.'};
  },
};
function runAppCommands(state) {
  for (const job of state.jobs || []) for (const queued of job.commands || []) {
    if (runningCommands.has(queued.id) || !APP_COMMANDS[queued.action]) continue;
    runningCommands.add(queued.id);
    (async () => {
      let outcome;
      // Waits while the same job is busy with a step started from its window. Showing the
      // window changes nothing in the job, so it never waits.
      const quick = queued.action === 'focus' || queued.action === 'details';
      for (let i = 0; !quick && i < 600 && locks.has(job.id); i++) await new Promise(resolve => setTimeout(resolve, 500));
      if (!quick) locks.add(job.id);
      try {const result = await APP_COMMANDS[queued.action](job.id);outcome = {ok:true, message:result?.message || 'Done.'};}
      catch (error) {outcome = {ok:false, message:error.message || String(error)};}
      finally {if (!quick) locks.delete(job.id);}
      await request(jobPath(job.id) + '/command-result', {commandId:queued.id, ...outcome}).catch(() => {});
      // The job's Resume Apply window shows the change too.
      if (!quick) chrome.runtime.sendMessage({event:'fill-progress', id:job.id, message:outcome.message}).catch(() => {});
      runningCommands.delete(queued.id);
    })();
  }
}
// Start over (from the app): close the job's tabs and details window, stop watching its
// ChatGPT, forget its run, and tell the app it is done.
const cleaning = new Set();
function cleanUpJobs(ids) {
  for (const id of ids) {
    if (cleaning.has(id)) continue;
    cleaning.add(id);
    (async () => {
      try {
        const all = await runs(), run = all[id] || ((await chrome.storage.local.get('runAnchors')).runAnchors || {})[id] || {};
        if (run.chatTabId) await chat(run.chatTabId,'stopResponseWatch').catch(() => {});
        if (run.panelWindowId) await chrome.windows.remove(run.panelWindowId).catch(() => {});
        const tabs = [run.jobTabId, run.chatTabId, run.panelTabId].filter(Number.isInteger);
        if (tabs.length) await chrome.tabs.remove(tabs).catch(() => {});
        await (runWrites = runWrites.then(async () => {
          const current = await runs();delete current[id];await chrome.storage.session.set({runs:current});
          const {runAnchors={}} = await chrome.storage.local.get('runAnchors');delete runAnchors[id];await chrome.storage.local.set({runAnchors});
        }).catch(() => {}));
        reported.delete(id);
        await request('/v1/cleanup-done', {jobId:id});
        chrome.runtime.sendMessage({event:'jobs-updated', id}).catch(() => {});
      } catch (_) { /* tried again on the next update */ } finally {cleaning.delete(id);}
    })();
  }
}
function startWatcher() {
  if (watching) return;
  watching = true;
  (async () => {
    let cursor = '', refreshed = false;
    try {
      while ((await chrome.storage.local.get('credentials')).credentials) {
        try {
          const state = await request('/v1/events?after='+encodeURIComponent(cursor));
          cursor = state.cursor || '';await openNewAssignments(state);runAppCommands(state);cleanUpJobs(state.cleanup || []);
          // Once per start: tell the app what each open job is really doing now, replacing
          // anything left over from before Chrome or the extension restarted.
          if (!refreshed) {
            refreshed = true;
            const all = await runs();
            for (const job of state.jobs || []) if (!['completed','unlinked'].includes(job.status)) reportProgress(job.id, all[job.id] || {});
          }
        } catch (_) {await new Promise(resolve => setTimeout(resolve,10000));}
      }
    } finally {watching = false;}
  })();
}

async function scanQuestions(id,{fillOutcomes=null,auto=false}={}) {
  const run = await getRun(id);await requireReady(run);
  // The form may hold the user's own corrections: keep them before reading it again.
  await harvestAnswers(id,run).catch(()=>{});
  let results, warning = '';
  try {
    await chrome.scripting.executeScript({target:{tabId:run.jobTabId,allFrames:true},files:['page-tools.js']});
    results = await chrome.scripting.executeScript({target:{tabId:run.jobTabId,allFrames:true},func:() => globalThis.ResumeApplyPage.scan()});
  } catch (_) {
    results = [{frameId:0,result:await page(run.jobTabId,'scan')}];
    warning = ' Some embedded frames could not be accessed; complete those fields manually or open the form directly.';
  }
  const fields = results.flatMap(result => (result.result && result.result.fields || []).map(field => ({...field,localId:field.id,id:`${result.frameId}:${field.id}`,frameId:result.frameId,pageUrl:result.result.url,site:result.result.site})));
  if(run.responseMonitor?.kind==='answers')await chat(run.chatTabId,'stopResponseWatch').catch(()=>{});
  // Same page rescanned: keep what was already asked and answered for each question.
  const carried=carryPageState(run,fields);
  const recalled=currentAnswers({fields,answerBook:run.answerBook,askedIds:carried.askedIds,answers:carried.answers});
  const known=await knownAnswers(await request(jobPath(id)),recalled.fields);
  const answers=recalled.answers.map(item=>{
    if(item.answer!=null)return item;
    if(known.fixed.has(item.id))return {id:item.id,answer:known.profile.get(item.id) ?? null};
    const answer=known.site.has(item.id)?known.site.get(item.id):known.profile.get(item.id);
    return answer==null?item:{id:item.id,answer};
  });
  const reusedIds=answers.filter((item,index)=>item.answer!=null && recalled.answers[index].answer==null).map(item=>item.id);
  // Answered without ChatGPT, or contact facts it must never be asked.
  const askedIds=[...new Set([...carried.askedIds,...reusedIds,...known.fixed])];
  const unasked=recalled.unasked.filter(fieldId=>!askedIds.includes(fieldId));
  const seen=new Map();for(const field of known.fields)seen.set(outcomeKey(field),(seen.get(outcomeKey(field)) || 0)+1);
  const marked=known.fields.map(field=>seen.get(outcomeKey(field))===1 && fillOutcomes?.has(outcomeKey(field))?{...field,fillResult:fillOutcomes.get(outcomeKey(field))}:field);
  await saveRun(id,{fields:marked,answers,answersAt:answers.some(item=>item.answer!=null && item.answer!=='' && !(Array.isArray(item.answer) && !item.answer.length))?Date.now():null,askedIds,fixedIds:[...known.fixed],answerReceipt:null,answerFieldIds:null,answerRetried:false,pickFields:null,pendingFillResults:null,...(fillOutcomes || auto?{}:{autopilot:null}),...(run.responseMonitor?.kind==='answers'?{responseMonitor:null}:{})});
  if(!fillOutcomes)await request(jobPath(id) + '/status',{status:'questions-scanned'});
  const earlier=answerableQuestions(fields).length-recalled.unasked.length;
  const notes=[earlier?`Reused ${earlier} earlier answer${earlier===1?'':'s'}.`:'',reusedIds.length?`${reusedIds.length} filled from your profile or saved site answers.`:''].filter(Boolean).join(' ');
  return {newQuestions:unasked.length,message:`Scanned ${fields.length} fields.${notes?' '+notes:''} ${unasked.length?'Click Ask ChatGPT to generate answers.':'Review the answers below.'}${warning}`};
}
async function refreshQuestionOptions(id,run,ids) {
  await requireReady(run);
  const refreshed=new Map(),targets=run.fields.filter(field=>ids.includes(field.id));
  for(const frameId of [...new Set(targets.map(field=>field.frameId))]) {
    const fields=targets.filter(field=>field.frameId===frameId);
    const result=await page(run.jobTabId,'discoverOptions',[fields.map(field=>field.localId)],frameId);
    if(fields.some(field=>field.scanId!==result.scanId || field.pageUrl!==result.url))throw new Error('The application scan changed. Scan questions again before asking GPT.');
    for(const field of result.fields)refreshed.set(`${frameId}:${field.id}`,field);
  }
  const fields=run.fields.map(field=>({...field,...refreshed.get(field.id),id:field.id,localId:field.localId}));
  await saveRun(id,{fields});return fields;
}
async function command(message) {
  const {action,id} = message;
  if (action === 'pair') {
    const credentials = await request('/v1/pair',{code:message.code,name:message.name},true);
    await chrome.storage.local.set({credentials});await chrome.alarms.create('heartbeat',{periodInMinutes:0.5});
    startWatcher();
    return {message:'Connected to Resume Manager.'};
  }
  if (action === 'state') {const state = await request('/v1/state');return {...state,runs:await runs(),...(await chrome.storage.session.get(['suggestedTab','activeJobId']))};}
  if (action === 'forget') {await chrome.storage.local.remove(['credentials','runAnchors']);await chrome.storage.session.clear();return {message:'Local credentials removed. Unlink the slot in the app to free it.'};}
  if (!id) throw new Error('Select an assigned job first.');
  if (action === 'open') return openTabs(id);
  if (action === 'adopt') {
    const {suggestedTab} = await chrome.storage.session.get('suggestedTab');
    if (!suggestedTab || !/^https?:/.test(suggestedTab.url) || new URL(suggestedTab.url).hostname === 'chatgpt.com') throw new Error('Click the extension icon from the application tab first.');
    const current = (await runs())[id] || {};
    await saveRun(id,{...current,jobTabId:suggestedTab.id,ready:false,fields:[],answers:[]});
    return openTabs(id);
  }
  if (action === 'detail') {
    const job=await request(jobPath(id)),run=(await runs())[id] || {};
    return {job,run,siteMemory:await siteMemory(job,run).catch(()=>[])};
  }
  if (action === 'clearSiteAnswers') {
    const job=await request(jobPath(id)),site=String(message.site || '');
    await (siteWrites=siteWrites.then(async()=>{const all=await siteBooks();if(all[job.profileId])delete all[job.profileId][site];await chrome.storage.local.set({siteAnswers:all});}).catch(()=>{}));
    return {message:`Saved answers for ${site} cleared for this profile.`};
  }
  if (action === 'complete') {
    if (message.confirmed !== true) throw new Error('Confirm that the application ended.');
    const previous=(await runs())[id];
    if(previous?.chatTabId)await chat(previous.chatTabId,'stopResponseWatch').catch(()=>{});
    if(previous?.responseMonitor)await saveRun(id,{responseMonitor:{...previous.responseMonitor,status:'cancelled'}});
    await request(jobPath(id) + '/complete',{confirmed:true});
    // Its tabs are done with: close the job's application tab, its ChatGPT tab and its
    // Resume Apply window. Only these, so other tabs sharing the window stay; an empty
    // window closes by itself. Done last, since the request may come from that window.
    if (previous) {
      const tabs = [previous.jobTabId, previous.chatTabId].filter(Number.isInteger);
      setTimeout(() => {
        if (previous.panelWindowId) chrome.windows.remove(previous.panelWindowId).catch(() => {});
        if (tabs.length) chrome.tabs.remove(tabs).catch(() => {});
      }, 300);
    }
    return {message:"Application marked ended in Resume Manager. Its tabs are closed."};
  }
  if (action === 'fullAuto') return startFullAuto(id);
  if (action === 'stopFullAuto') {await saveRun(id,{fullAuto:null,autopilot:null,fullAutoBlocker:null});return {message:'Full auto stopped. Continue with the steps yourself.'};}
  // Background checks never open windows; a step you start does.
  const run = action === 'readResume' && message.response ? (await runs())[id] || {} : ['pollAnswers','autoResume'].includes(action) ? await getRun(id) : await ensureRun(id);
  // A step you take yourself after Full auto stopped clears its "needs you" notice.
  if (run.fullAutoBlocker && !['pollAnswers','autoResume'].includes(action)) await saveRun(id,{fullAutoBlocker:null});
  if (action === 'extract') {
    await requireReady(run);
    const found = await page(run.jobTabId,'job');
    // An application-form link: read the job's description from its posting instead.
    const posting = await postingDescription((await chrome.tabs.get(run.jobTabId)).url || found.url).catch(() => null);
    if (!posting) return {job:found};
    return {job:{...found, title:posting.title || found.title, company:posting.company || found.company, description:posting.description, descriptionSource:posting.url},
      message:'This page is the application form, so the job description was read from the job posting. Check it before sending.'};
  }
  if (action === 'sendResume') {
    const job = await request(jobPath(id) + '/jd', message.job);
    const receipt = await chat(run.chatTabId,'send',job.resumePrompt,run.resumeReceipt);
    await saveRun(id,{resumeReceipt:receipt});await startResponseMonitor(id,'resume',receipt);return {message:receipt.sendUnconfirmed ? 'Prompt inserted, but sending was not confirmed. Check the ChatGPT tab before retrying.' : receipt.manualSend ? 'Prompt inserted. Press Send in ChatGPT, then read the response here.' : 'Resume prompt sent. Monitoring ChatGPT; the completed JSON will appear here for review and export.'};
  }
  if (action === 'readResume' || action === 'confirmResume') {
    const detail = await request(jobPath(id));
    let response;
    if(action==='confirmResume') {
      if(message.confirmed!==true || !run.pendingResumeResponse)throw new Error('Read and review the response first.');
      const current=await readResumeJson(run,detail.resumePrompt);
      if(current.url!==run.pendingResumeUrl || resumeResponse(current.response)!==run.pendingResumeResponse)throw new Error('The ChatGPT response changed. Click Read again and review the new response.');
      response=run.pendingResumeResponse;
    } else if(message.response) response=resumeResponse(message.response);
    else {
      const result=await readResumeJson(run,detail.resumePrompt);
      response=resumeResponse(result.response);
      if(!result.matched) {
        await saveRun(id,{pendingResumeResponse:response,pendingResumeUrl:result.url});
        return {needsResumeConfirmation:true,responsePreview:response,message:'The response is ready, but automatic request matching was unavailable. Review the resume below and confirm it belongs to this job before exporting.'};
      }
    }
    const job=await request(jobPath(id)+'/resume',{response});
    await saveRun(id,{pendingResumeResponse:null,pendingResumeUrl:null,...(run.responseMonitor?.kind==='resume'?{responseMonitor:{...run.responseMonitor,status:'ready'}}:{})});
    return {job,message:'PDF, DOCX, and JD.txt exported by Resume Manager.'};
  }
  if (action === 'scan') return scanQuestions(id);
  if (action === 'saveAnswers') {
    await requireReady(run);
    const saved=await harvestAnswers(id,run);
    if(saved==null)throw new Error('Scan this application page first, then save its answers.');
    return {message:saved?`Saved ${saved} answer${saved===1?'':'s'} for this site. Later applications on it will reuse them.`:'Saved answers for this site are already up to date.'};
  }
  if (action === 'pollAnswers') {
    if(run.responseMonitor?.kind!=='answers' || run.responseMonitor.status!=='waiting')return {run};
    const tab=await chrome.tabs.get(run.chatTabId);
    const event=Date.now()-run.responseMonitor.startedAt>20*60*1000?'chat-response-timeout':'chat-response-ready';
    if(event==='chat-response-ready') {
      const state=await chat(run.chatTabId,'responseState',run.answerReceipt);
      if(state.generating || state.draftPending || !state.requestMatched && state.signature===run.answerReceipt?.responseBaseline)return {run};
    }
    await collectMonitoredResponse({event,id,kind:'answers',marker:run.responseMonitor.marker},{tab,url:tab.url});
    return {run:(await runs())[id]};
  }
  if (action === 'sendAnswers') {
    if (!run.fields || !run.fields.length) throw new Error('Scan questions first.');
    const answerable = answerableQuestions(run.fields);
    if (!answerable.length) throw new Error('No answerable questions were found. Upload files and complete consent or signature controls on the application.');
    const recalled = currentAnswers(run);
    // With nothing new to ask, another click retries the questions still blank.
    const fixed = new Set(run.fixedIds || []);
    const blank = answerable.filter(field=>!fixed.has(field.id) && (recalled.answers.find(item=>item.id===field.id)?.answer ?? '')==='').map(field=>field.id);
    const targets = recalled.unasked.length ? recalled.unasked : blank;
    if (!targets.length) return {message:'Every question already has an answer. Review them and fill.'};
    const {receipt,count:asked} = await askQuestions(id,run,targets);
    return {message:receipt.sendUnconfirmed ? 'Prompt inserted, but sending was not confirmed. Check the ChatGPT tab before retrying.' : receipt.manualSend ? 'Question prompt inserted. Press Send in ChatGPT, then read answers here.' : `Sent ${asked} application questions. Monitoring ChatGPT; completed answers will appear in the preview.`};
  }
  if (action === 'readAnswers') {
    // Question ids are positional, so a reply only applies to the scan it was asked about.
    if(!run.answerReceipt)throw new Error('Click Ask ChatGPT for this scan before reading answers.');
    const response=message.response ? answerJson(message.response,askedFields(run)) : (await readChatJson(run,run.answerReceipt,source=>answerJson(source,askedFields(run)))).response;
    if(run.pickFields) {
      if(run.responseMonitor?.kind==='answers')await saveRun(id,{responseMonitor:{...run.responseMonitor,status:'ready'}});
      return completePicks(id,run,response);
    }
    await collectAnswers(id,run,response);
    if(run.responseMonitor?.kind==='answers')await saveRun(id,{responseMonitor:{...run.responseMonitor,status:'ready'}});
    return {message:'Answers loaded into the preview. Edit and approve before filling.'};
  }
  if(action==='uploadResume') {
    await requireReady(run);
    const field=(run.fields || []).find(field=>field.id===message.fieldId);
    if(!field || field.type!=='file' || !field.resumeUpload || field.manualOnly)throw new Error('Scan the resume upload field first.');
    await uploadResumeField(id,run,field);
    // The upload can change the form, so read it again once the site settles.
    try {
      const rescan=await scanQuestions(id);
      return {message:`Uploaded resume.docx. ${rescan.message}`};
    }catch(_){
      await saveRun(id,{fields:[],answers:[],answerReceipt:null,answerFieldIds:null});
      return {message:'Uploaded resume.docx. After the site finishes processing it, scan again before filling the remaining answers.'};
    }
  }
  if (action === 'fill') {
    if (message.approved !== true || !Array.isArray(message.answers)) throw new Error('Review and approve answers before filling.');
    await request(jobPath(id) + '/status',{status:'answers-reviewed'});
    const results=await fillFields(id,run,message.answers);
    await saveRun(id,{filledAt:Date.now()});
    return settleFill(id,await getRun(id),results);
  }
  if (action === 'auto') return startAutoFill(id,run);
  if (action === 'autoResume') {
    if(!run.autopilot?.waiting)return {run};
    const blocked=await pageBlocker(run);
    if(blocked)return {message:blocked.message,waiting:true};
    await saveRun(id,{autopilot:{...run.autopilot,waiting:null}});
    return autoFillPage(id);
  }
  throw new Error('Unknown command.');
}
chrome.runtime.onMessage.addListener((message,sender,respond) => {
  if(message.event==='page-submitting'){rememberSubmitted(message,sender).catch(()=>{});return false;}
  if(message.event==='chat-response-ready' || message.event==='chat-response-timeout'){collectMonitoredResponse(message,sender).then(respond,error=>respond({error:error.message}));return true;}
  if (!sender.url || !sender.url.startsWith(chrome.runtime.getURL('panel.html'))) return false;
  const key = ['detail','pollAnswers'].includes(message.action) ? message.action+':'+message.id : message.id || message.action;
  if(message.action==='pollAnswers' && locks.has(key)) {
    runs().then(all=>respond({ok:true,run:all[message.id] || {},pending:true}),error=>respond({error:error.message}));return true;
  }
  if (locks.has(key)) {respond({error:'This step is already running. Please wait.'});return false;}
  locks.add(key);
  command(message).then(result => {locks.delete(key);respond({ok:true,...result});},error => {locks.delete(key);respond({error:error.message || String(error)});});
  return true;
});
chrome.action.onClicked.addListener(tab => {
  // open() must run directly in the toolbar gesture, before awaiting storage or network calls.
  chrome.sidePanel.open({windowId:tab.windowId}).catch(error => console.error('Side panel:',error));
  if (tab && /^https?:/.test(tab.url || '') && new URL(tab.url).hostname !== 'chatgpt.com') chrome.storage.session.set({suggestedTab:{id:tab.id,url:tab.url}});
  startWatcher();
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'heartbeat') {resumeResponseMonitors();resumeWaitingAutoFill().catch(() => {});startWatcher();request('/v1/state').then(openNewAssignments).catch(() => {});}
});
chrome.runtime.onStartup.addListener(() => {chrome.alarms.create('heartbeat',{periodInMinutes:0.5});startWatcher();});
chrome.runtime.onInstalled.addListener(() => {chrome.alarms.create('heartbeat',{periodInMinutes:0.5});startWatcher();});
startWatcher();

resumeResponseMonitors();
