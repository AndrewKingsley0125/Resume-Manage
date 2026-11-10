import {captureCodeCopy} from './code-copy.mjs';
import {arrangeWorkspace} from './layout.mjs';
import {APP_URL, answersPrompt, parseAnswers, decodeReply, rememberAnswers, recallAnswers, optionAnswer, answerableQuestions, mergeGeneratedAnswers, resumeResponse} from './core.mjs';
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
    const run=all[id], anchor={};
    for(const key of ['jobTabId','chatTabId','groupId'])if(run[key]!==undefined)anchor[key]=run[key];
    for(const key of ['resumeReceipt','answerReceipt'])if(run[key])anchor[key]=Object.fromEntries(['marker','userMessageId','conversationPath','sentAt','responseBaseline'].filter(k=>run[key][k]!==undefined).map(k=>[k,run[key][k]]));
    if(run.responseMonitor?.status==='waiting')anchor.responseMonitor=run.responseMonitor;
    runAnchors[id]=anchor;await chrome.storage.local.set({runAnchors});return run;});
  runWrites = saved.catch(() => {});return saved;
}
async function recoverRun(id) {
  const {runAnchors={}}=await chrome.storage.local.get('runAnchors');
  if(runAnchors[id]?.chatTabId) {
    try {const tab=await chrome.tabs.get(runAnchors[id].chatTabId);if(tab.url && new URL(tab.url).hostname==='chatgpt.com')return saveRun(id,runAnchors[id]);}catch(_){}
  }
  // Recover older installations from the group belonging to this exact assigned job URL.
  const job=await request(jobPath(id));
  const sites=await chrome.tabs.query({url:job.url});
  const pairs=[];
  for(const site of sites.filter(tab=>tab.groupId>=0)) {
    const members=await chrome.tabs.query({groupId:site.groupId});
    for(const chat of members.filter(tab=>tab.url && new URL(tab.url).hostname==='chatgpt.com'))pairs.push({jobTabId:site.id,chatTabId:chat.id,groupId:site.groupId});
  }
  if(pairs.length===1)return saveRun(id,pairs[0]);
  return null;
}
async function getRun(id) {const run=(await runs())[id] || await recoverRun(id);if(!run)throw new Error('Open the assigned job and its ChatGPT conversation first.');return run;}
const jobPath = id => '/v1/jobs/' + encodeURIComponent(id);
async function page(tabId, method, args = [], frameId = 0) {
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
  const answerBook=rememberAnswers(run.answerBook,run.fields || [],mergeGeneratedAnswers(asked,parseAnswers(response,asked)));
  await saveRun(id,{answerBook,answers:recallAnswers(run.fields || [],answerBook).answers});
  return retry;
}
async function askQuestions(id,run,ids,{retried=false}={}) {
  const wanted=new Set(ids);
  const all=retried?run.fields:await refreshQuestionOptions(id,run,ids);
  const fields=answerableQuestions(all.filter(field=>wanted.has(field.id)));
  const receipt=await chat(run.chatTabId,'send',answersPrompt(await request(jobPath(id)),fields,all),run.answerReceipt);
  await saveRun(id,{answerReceipt:receipt,answerFieldIds:fields.map(field=>field.id),answerRetried:retried});
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
      await saveRun(message.id,{autopilot:null,pickFields:null,responseMonitor:{...monitor,status:'error',message:'Automatic collection timed out. Use Read or paste the completed response.'}});
    }else if(message.kind==='resume') {
      const detail=await request(jobPath(message.id));
      if(!detail.files) {
        const result=await readResumeJson(run,detail.resumePrompt,{quiet:true});
        await saveRun(message.id,{pendingResumeResponse:result.response,pendingResumeUrl:result.url});
      }
      await saveRun(message.id,{responseMonitor:{...monitor,status:'ready'}});
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
  await saveRun(id,{autopilot:{active:true,round:0,filled:0,failed:[],attempted:[],note:'',page:1,pageFailures:0,previousPage:null,waiting:null}});
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
  const recalled=recallAnswers(run.fields,run.answerBook);
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
  await saveRun(id,{autopilot:null});
  const recalled=recallAnswers(run.fields || [],run.answerBook);
  const blank=answerableQuestions(run.fields || []).filter(field=>!field.manualOnly && (recalled.answers.find(item=>item.id===field.id)?.answer ?? '')==='').map(field=>field.label);
  const manual=(run.fields || []).filter(field=>field.manualOnly).map(field=>field.label);
  const parts=[`Auto-fill finished: ${autopilot.filled} field${autopilot.filled===1?'':'s'} filled.`];
  if(autopilot.note)parts.push(autopilot.note);
  if(autopilot.failed.length)parts.push(`Needs attention: ${autopilot.failed.map(item=>`${item.label || 'Unknown field'} (${item.error})`).join('; ')}.`);
  if(blank.length)parts.push(`No answer available: ${blank.join('; ')}.`);
  if(manual.length)parts.push(`Complete yourself: ${manual.join('; ')}.`);
  parts.push(closing);
  return {message:parts.join(' '),done:true};
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
async function openTabs(id, {checkReady = true} = {}) {
  const job = await request(jobPath(id));
  let run = (await runs())[id] || await recoverRun(id) || {};
  let jobTab, chatTab;
  try {jobTab = await chrome.tabs.get(run.jobTabId);} catch (_) { /* not opened yet */ }
  try {chatTab = await chrome.tabs.get(run.chatTabId);} catch (_) { /* not opened yet */ }
  if (!jobTab) jobTab = await chrome.tabs.create({url:job.url,active:false});
  if (!chatTab) chatTab = await chrome.tabs.create({url:'https://chatgpt.com/',windowId:jobTab.windowId,active:false});
  const layout = await arrangeWorkspace(chrome,jobTab.id,chatTab.id);
  await chrome.tabGroups.update(layout.groupId,{title:(job.company || job.title || 'Job application').slice(0,80),color:'blue',collapsed:false});
  const hasAccess = await chrome.permissions.contains({origins:[new URL(job.url).origin+'/*']});
  run = await saveRun(id,{jobTabId:jobTab.id,chatTabId:chatTab.id,...layout,ready:false,autoOpened:true,needsSiteAccess:!hasAccess,autoOpenError:''});
  await chrome.storage.session.set({activeJobId:id});
  await request(jobPath(id)+'/status',{status:'tabs-opened'});
  await chrome.tabs.update(jobTab.id,{active:true});
  await chrome.windows.update(jobTab.windowId,{focused:true});
  if (checkReady) await requireReady(run);
  return {message:layout.layout === 'split' ? 'Job site and ChatGPT are open in split view.' : layout.layoutNotice,layout:layout.layout};
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
function startWatcher() {
  if (watching) return;
  watching = true;
  (async () => {
    let cursor = '';
    try {
      while ((await chrome.storage.local.get('credentials')).credentials) {
        try {
          const state = await request('/v1/events?after='+encodeURIComponent(cursor));
          cursor = state.cursor || '';await openNewAssignments(state);
        } catch (_) {await new Promise(resolve => setTimeout(resolve,10000));}
      }
    } finally {watching = false;}
  })();
}

async function scanQuestions(id,{fillOutcomes=null,auto=false}={}) {
  const run = await getRun(id);await requireReady(run);
  let results, warning = '';
  try {
    await chrome.scripting.executeScript({target:{tabId:run.jobTabId,allFrames:true},files:['page-tools.js']});
    results = await chrome.scripting.executeScript({target:{tabId:run.jobTabId,allFrames:true},func:() => globalThis.ResumeApplyPage.scan()});
  } catch (_) {
    results = [{frameId:0,result:await page(run.jobTabId,'scan')}];
    warning = ' Some embedded frames could not be accessed; complete those fields manually or open the form directly.';
  }
  const fields = results.flatMap(result => (result.result && result.result.fields || []).map(field => ({...field,localId:field.id,id:`${result.frameId}:${field.id}`,frameId:result.frameId,pageUrl:result.result.url})));
  if(run.responseMonitor?.kind==='answers')await chat(run.chatTabId,'stopResponseWatch').catch(()=>{});
  const recalled=recallAnswers(fields,run.answerBook);
  const seen=new Map();for(const field of recalled.fields)seen.set(outcomeKey(field),(seen.get(outcomeKey(field)) || 0)+1);
  const marked=recalled.fields.map(field=>seen.get(outcomeKey(field))===1 && fillOutcomes?.has(outcomeKey(field))?{...field,fillResult:fillOutcomes.get(outcomeKey(field))}:field);
  await saveRun(id,{fields:marked,answers:recalled.answers,answerReceipt:null,answerFieldIds:null,answerRetried:false,pickFields:null,pendingFillResults:null,...(fillOutcomes || auto?{}:{autopilot:null}),...(run.responseMonitor?.kind==='answers'?{responseMonitor:null}:{})});
  if(!fillOutcomes)await request(jobPath(id) + '/status',{status:'questions-scanned'});
  const known=answerableQuestions(fields).length-recalled.unasked.length;
  return {newQuestions:recalled.unasked.length,message:`Scanned ${fields.length} fields.${known?` Reused ${known} earlier answer${known===1?'':'s'}.`:''} ${recalled.unasked.length?'Click Ask ChatGPT to generate answers.':'Review the answers below.'}${warning}`};
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
  if (action === 'detail') return {job:await request(jobPath(id)),run:(await runs())[id] || {}};
  if (action === 'complete') {
    if (message.confirmed !== true) throw new Error('Confirm that the application ended.');
    const previous=(await runs())[id];
    if(previous?.chatTabId)await chat(previous.chatTabId,'stopResponseWatch').catch(()=>{});
    if(previous?.responseMonitor)await saveRun(id,{responseMonitor:{...previous.responseMonitor,status:'cancelled'}});
    await request(jobPath(id) + '/complete',{confirmed:true});return {message:'Application marked ended in Resume Manager.'};
  }
  const run = action === 'readResume' && message.response ? (await runs())[id] || {} : await getRun(id);
  if (action === 'extract') {await requireReady(run);return {job:await page(run.jobTabId,'job')};}
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
    const recalled = recallAnswers(run.fields,run.answerBook);
    // With nothing new to ask, another click retries the questions still blank.
    const blank = answerable.filter(field=>(recalled.answers.find(item=>item.id===field.id)?.answer ?? '')==='').map(field=>field.id);
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
  if (alarm.name === 'heartbeat') {resumeResponseMonitors();startWatcher();request('/v1/state').then(openNewAssignments).catch(() => {});}
});
chrome.runtime.onStartup.addListener(() => {chrome.alarms.create('heartbeat',{periodInMinutes:0.5});startWatcher();});
chrome.runtime.onInstalled.addListener(() => {chrome.alarms.create('heartbeat',{periodInMinutes:0.5});startWatcher();});
startWatcher();

resumeResponseMonitors();
