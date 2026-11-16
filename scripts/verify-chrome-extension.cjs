// Loads only this unpacked extension in an isolated headless Chrome test profile.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const assert = require('node:assert/strict');
const {createExtensionBridge} = require('../src/main/extension-bridge');
const Resume = require('../src/shared/resume');
const root = path.resolve(__dirname,'..');
const chromePath = process.env.RESUME_TEST_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function main() {
  if(!fs.existsSync(chromePath)) throw new Error('Set RESUME_TEST_CHROME to a Chrome executable.');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'resume-chrome-extension-'));
  const profile = {id:'chrome-test',firstName:'Fixture',applicationDetails:{country:'United States'},applicationMode:'extension',extensionJobLinks:['http://127.0.0.1:17373/fixture-job'],workHistory:[],education:[]};
  const bridge = createExtensionBridge({getProfiles:()=>[profile],buildPrompt:require('../src/main/prompt').buildPrompt,exportResume:async (profile,response)=>{const resume=Resume.parse(response,profile),docxPath=path.join(temp,'resume.docx');fs.writeFileSync(docxPath,require('../src/main/docx').buildDocx(profile,resume,{}));return {resume,files:{path:'fixture.pdf',docxPath,jdPath:'JD.txt'}};}});
  let child, socket;
  const jobHtml = `<!doctype html><html><head><title>Engineer at Acme</title><script type="application/ld+json">{"@type":"JobPosting","title":"Engineer","hiringOrganization":{"name":"Acme"},"description":"Build reliable systems. You will design, ship and operate backend services used by millions of customers, work closely with product and design, review code, mentor other engineers, and improve monitoring, testing and deployment across the platform team."}</script></head><body><form><label for="first">First name</label><input id="first"><label for="why">Why our company?</label><textarea id="why"></textarea><label for="resume">Resume / CV</label><input id="resume" name="resume" type="file" accept=".docx"><label for="cover">Cover letter</label><input id="cover" name="cover_letter" type="file"><button type="submit">Submit</button></form><script>globalThis.submitted=false;document.querySelector('form').onsubmit=e=>{e.preventDefault();submitted=true;};</script></body></html>`;
  const baseFixtureJobHtml=jobHtml.replace('<label for="resume">','<label for="country">Country</label><input id="country" class="cx-select-input" role="combobox" aria-haspopup="grid" aria-expanded="false" aria-controls="country-options"><label for="resume">')
    .replace('globalThis.submitted=false;',`globalThis.submitted=false;const country=document.querySelector('#country');country.onclick=()=>{let list=document.querySelector('#country-options');if(!list){list=document.createElement('div');list.id='country-options';list.className='cx-select__list';list.setAttribute('role','grid');for(const label of ['United States of America','Canada']){const row=document.createElement('div');row.setAttribute('role','row');const option=document.createElement('div');option.className='cx-select__list-item';option.setAttribute('role','gridcell');option.setAttribute('aria-selected','false');option.textContent=label;option.onclick=()=>{country.value=label;option.setAttribute('aria-selected','true');country.setAttribute('aria-expanded','false');list.hidden=true;};row.append(option);list.append(row);}document.body.append(list);}list.hidden=false;country.setAttribute('aria-expanded','true');};country.onkeydown=event=>{if(event.key==='Escape'){if(country.getAttribute('aria-expanded')==='false'){country.value='';return;}const list=document.querySelector('#country-options');if(list)list.hidden=true;country.setAttribute('aria-expanded','false');}};`);
  const fixtureJobHtml=baseFixtureJobHtml.replace("country.onkeydown=event=>","country.oninput=country.onclick;country.onkeydown=event=>");
  const resume = JSON.stringify({company:'Acme',title:'Engineer',summary:'Built reliable systems.',skills:[],experience:[],education:[]});
  const chatHtml = String.raw`<!doctype html><html><body><div id="messages"></div><div id="prompt-textarea" class="ProseMirror" contenteditable="true" style="white-space:pre-wrap"><p><br></p></div><button id="composer-submit-button" aria-label="Send" disabled>Send</button><script>globalThis.fixtureClipboardWrites=0;globalThis.fixtureClipboardWrite=()=>{fixtureClipboardWrites++;return Promise.resolve();};navigator.clipboard.writeText=fixtureClipboardWrite;document.querySelector('#prompt-textarea').addEventListener('input',()=>{document.querySelector('button').disabled=!document.querySelector('#prompt-textarea').innerText.trim();});document.querySelector('button').onclick=()=>{const input=document.querySelector('#prompt-textarea');const body=input.innerText;const user=document.createElement('div');user.dataset.messageAuthorRole='user';user.textContent=body;const assistant=document.createElement('article');let response=${JSON.stringify(resume)};if(body.includes('Return ONLY JSON')){assistant.dataset.messageAuthorRole='assistant';const start=body.lastIndexOf('{',body.indexOf('"personalInfo"'));const end=body.lastIndexOf('}',body.indexOf('Request reference:'))+1;const data=JSON.parse(body.slice(start,end).replace(/\u00a0/g,' '));response=JSON.stringify({answers:data.questions.map(q=>({id:q.id,answer:'Built reliable services for customers.'}))});}if(body.includes('Return ONLY JSON')){const pre=document.createElement('pre'),code=document.createElement('code');code.textContent=response;pre.append(code);assistant.append(pre);}else{
const score=document.createElement('p');score.textContent='Iterate 0: ATS Alignment Score 89/100';assistant.append(score);
const old=document.createElement('pre');old.textContent=JSON.stringify({...JSON.parse(response),company:'Wrong older draft'});assistant.append(old);const block=document.createElement('div');block.dataset.testid='code-block';const header=document.createElement('div');header.textContent='JSON';
const copy=document.createElement('button');copy.type='button';copy.setAttribute('aria-label','Copy code');copy.textContent='Copy';copy.onclick=()=>setTimeout(()=>navigator.clipboard.writeText(response),10);header.append(copy);
const editor=document.createElement('div');editor.className='cm-editor';const content=document.createElement('div');content.className='cm-content';content.style.cssText='height:120px;overflow:auto';content.innerHTML='<div class="cm-line">  ]</div><div class="cm-line">}</div>';editor.append(content);block.append(header,editor);assistant.append(block);
}document.querySelector('#messages').append(user,assistant);const stop=document.createElement('button');stop.dataset.testid='stop-button';stop.textContent='Stop';document.body.append(stop);setTimeout(()=>stop.remove(),2500);input.replaceChildren();};</script></body></html>`;
  // Test both a normal fenced-code renderer and a virtualized plain reply that
  // exposes its full JSON only through the whole-response Copy action.
  const codeAnswersChatHtml=chatHtml.replace("answer:'Built reliable services for customers.'","answer:(q.allowsCustomValue||q.options)?(q.answerFormat==='text'?data.personalInfo.applicationDetails.country:q.options.find(option=>/united states/i.test(option.text))?.id || null):/first name/i.test(q.label)?data.personalInfo.firstName:'Built reliable services for customers.'");
  const plainAnswersChatHtml=chatHtml.replace("assistant.dataset.messageAuthorRole='assistant';",'')
    .replace("answer:'Built reliable services for customers.'","answer:(q.allowsCustomValue||q.options)?(q.answerFormat==='text'?data.personalInfo.applicationDetails.country:q.options.find(option=>/united states/i.test(option.text))?.id || null):/first name/i.test(q.label)?data.personalInfo.firstName:'Built reliable services for customers.'")
    .replace("const pre=document.createElement('pre'),code=document.createElement('code');code.textContent=response;pre.append(code);assistant.append(pre);","const text=document.createElement('div');text.className='text-base';text.textContent='Virtualized plain answer preview';assistant.append(text);const copy=document.createElement('button');copy.setAttribute('aria-label','Copy');copy.dataset.testid='copy-turn-action-button';copy.textContent='Copy';copy.onclick=()=>setTimeout(()=>navigator.clipboard.writeText(response),10);assistant.append(copy);");
  const fixtureChatHtml=process.argv.includes('--answer-code-blocks')?codeAnswersChatHtml:plainAnswersChatHtml;
  let onEvent = () => {};
  const pending = new Map();let nextId = 0;
  const send = (method,params={},sessionId) => new Promise((resolve,reject)=>{
    const id=++nextId;const timeout=setTimeout(()=>{pending.delete(id);reject(new Error('CDP timeout: '+method));},15000);
    pending.set(id,{resolve:value=>{clearTimeout(timeout);resolve(value);},reject:error=>{clearTimeout(timeout);reject(error);}});
    socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));
  });
  try {
    const address=await bridge.start(0);
    const fixtureOrigin=`http://127.0.0.1:${address.port}`;
    profile.extensionJobLinks=[fixtureOrigin+'/fixture-job'];
    const testExtension=path.join(temp,'extension');fs.cpSync(path.join(root,'chrome-extension'),testExtension,{recursive:true});
    const corePath=path.join(testExtension,'core.mjs');fs.writeFileSync(corePath,fs.readFileSync(corePath,'utf8').replace('http://127.0.0.1:17373',fixtureOrigin));
    const manifestPath=path.join(testExtension,'manifest.json');fs.writeFileSync(manifestPath,fs.readFileSync(manifestPath,'utf8').replace('http://127.0.0.1:17373/*',fixtureOrigin+'/*'));

    child=spawn(chromePath,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1','--remote-debugging-port=0','--enable-unsafe-extension-debugging','--user-data-dir='+temp,'about:blank'],{windowsHide:true,stdio:'ignore'});
    const activePort=path.join(temp,'DevToolsActivePort');
    for(let i=0;i<100 && !fs.existsSync(activePort);i++)await delay(100);
    if(!fs.existsSync(activePort))throw new Error('Isolated Chrome did not expose its test debugging endpoint.');
    const [port,endpoint]=fs.readFileSync(activePort,'utf8').trim().split(/\r?\n/);
    socket=new WebSocket('ws://127.0.0.1:'+port+endpoint);
    await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
    socket.addEventListener('message',event=>{const message=JSON.parse(event.data);const call=pending.get(message.id);if(call){pending.delete(message.id);if(message.error)call.reject(new Error(message.error.message));else call.resolve(message.result);}else onEvent(message);});
    const loaded=await send('Extensions.loadUnpacked',{path:testExtension});
    assert.ok(loaded.id);console.log('PASS: Chrome loaded the unpacked Manifest V3 extension.');
    const target=await send('Target.createTarget',{url:`chrome-extension://${loaded.id}/panel.html`});
    const attached=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
    const evaluate=async expression=>{
      const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},attached.sessionId);
      if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;
    };
    await delay(500);
    const paired=await evaluate(`chrome.runtime.sendMessage({action:'pair',code:${JSON.stringify(bridge.dashboard(profile.id).pairingCode)},name:'Chrome smoke test'})`);
    assert.equal(paired.ok,true,JSON.stringify(paired));
    const connection=bridge.dashboard().connections[0];assert.ok(connection.connected);
    console.log('PASS: real Chrome service worker paired with the authenticated localhost bridge.');
    const beforeAction=await evaluate('chrome.tabs.query({}).then(tabs=>tabs.length)');
    const browserTabs=await send('Target.getTargets',{filter:[{type:'tab',exclude:false},{exclude:true}]});
    assert.ok(browserTabs.targetInfos.length);
    await send('Extensions.triggerAction',{id:loaded.id,targetId:browserTabs.targetInfos[0].targetId});
    await delay(300);
    const afterAction=await evaluate('chrome.tabs.query({}).then(tabs=>tabs.length)');
    assert.equal(afterAction,beforeAction);
    const panelOptions=await evaluate('chrome.sidePanel.getOptions({})');assert.equal(panelOptions.path,'panel.html');
    console.log('PASS: toolbar action opens the side panel without creating an extension tab.');
    const job=bridge.assign(profile.id,profile.extensionJobLinks[0],connection.id);
    const state=await evaluate(`chrome.runtime.sendMessage({action:'state'})`);
    assert.equal(state.ok,true,JSON.stringify(state));
    assert.equal(state.jobs[0].id,job.id);
    let automatic;
    for(let i=0;i<50;i++) {
      const current=await evaluate(`chrome.runtime.sendMessage({action:'state'})`);
      automatic=current.runs[job.id];
      if(automatic && automatic.autoOpened)break;
      await delay(100);
    }
    assert.ok(automatic && automatic.autoOpened,JSON.stringify(automatic));
    assert.equal(automatic.layout,'split',JSON.stringify(automatic));
    console.log('PASS: assignment automatically opens the job in its own window.');
    const detail=await evaluate(`chrome.runtime.sendMessage({action:'detail',id:${JSON.stringify(job.id)}})`);
    assert.equal(detail.job.profile.firstName,'Fixture');
    onEvent = message => {
      if(message.method==='Fetch.requestPaused') {
        const html=message.params.request.url.startsWith('https://chatgpt.com/')?fixtureChatHtml:fixtureJobHtml;
        send('Fetch.fulfillRequest',{requestId:message.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html'}],body:Buffer.from(html).toString('base64')},message.sessionId).catch(console.error);
      }
    };
    const targets=await send('Target.getTargets');
    for(const url of [profile.extensionJobLinks[0],'https://chatgpt.com/']) {
      const target=targets.targetInfos.find(t=>t.type==='page' && t.url===url);assert.ok(target,JSON.stringify(targets.targetInfos));
      const attached=await send('Target.attachToTarget',{targetId:target.targetId,flatten:true});
      await send('Fetch.enable',{patterns:[{urlPattern:'*'}]},attached.sessionId);
      await send('Page.navigate',{url},attached.sessionId);
    }
    const opened=await evaluate(`chrome.runtime.sendMessage({action:'open',id:${JSON.stringify(job.id)}})`);
    assert.equal(opened.ok,true,JSON.stringify(opened));
    const live=await evaluate(`chrome.runtime.sendMessage({action:'detail',id:${JSON.stringify(job.id)}})`);
    assert.equal(live.run.ready,true);assert.ok(live.run.groupId>=0);assert.equal(live.run.layout,'split');
    const tabs=await evaluate(`chrome.tabs.query({groupId:${live.run.groupId}})`);assert.equal(tabs.length,2);
    // The job site and ChatGPT share the split view; the job's own Resume Apply window, a tabless
    // popup locked to this job, opened by itself to the right of the job window.
    const site=tabs.find(tab=>tab.id===live.run.jobTabId),gpt=tabs.find(tab=>tab.id===live.run.chatTabId);
    assert.ok(site.splitViewId>=0 && site.splitViewId===gpt.splitViewId,JSON.stringify(tabs.map(t=>[t.url,t.splitViewId])));
    // No Resume Apply window opens with the job: the app runs it. Show details opens it on request.
    assert.equal(live.run.panelWindowId ?? null,null);
    assert.equal((await evaluate(`chrome.windows.getAll({windowTypes:['popup']})`)).length,0);
    console.log('PASS: each job window shows the job site and ChatGPT side by side, with no extra window.');
    bridge.command(profile.id,job.id,'details');
    let detailsRun;
    for(let i=0;i<100;i++){detailsRun=(await evaluate(`chrome.runtime.sendMessage({action:'detail',id:${JSON.stringify(job.id)}})`)).run;if(detailsRun.panelWindowId)break;await delay(100);}
    const panelWindow=await evaluate(`chrome.windows.get(${detailsRun.panelWindowId},{populate:true})`);
    assert.equal(panelWindow.type,'popup');
    assert.ok(panelWindow.tabs[0].url.endsWith('/panel.html?job='+encodeURIComponent(job.id)),panelWindow.tabs[0].url);
    assert.equal(bridge.dashboard(profile.id).jobs.find(j=>j.id===job.id).lastCommand,null,'showing details leaves no result line');
    await evaluate(`chrome.windows.remove(${detailsRun.panelWindowId})`);
    for(let i=0;i<50 && (await evaluate(`chrome.runtime.sendMessage({action:'detail',id:${JSON.stringify(job.id)}})`)).run.panelWindowId;i++)await delay(100);
    console.log("PASS: Show details opens the job's Resume Apply window on request, and closing it is noticed.");
    // A step started from the app runs in the job's browser and its outcome comes back.
    bridge.command(profile.id,job.id,'open');
    let lastCommand;
    for(let i=0;i<100 && !(lastCommand=bridge.dashboard(profile.id).jobs.find(j=>j.id===job.id).lastCommand);i++)await delay(100);
    assert.ok(lastCommand && lastCommand.action==='open' && lastCommand.ok,JSON.stringify(lastCommand));
    assert.deepEqual(bridge.dashboard(profile.id).jobs.find(j=>j.id===job.id).commands,[]);
    console.log("PASS: a step started from the app runs in the job's browser and reports back.");
    // The job page's title reaches the app, so the job card can name the job before its JD is read.
    let page;
    for(let i=0;i<100 && !(page=bridge.dashboard(profile.id).jobs.find(j=>j.id===job.id).page)?.title;i++)await delay(100);
    assert.ok(page && page.title,JSON.stringify(page));
    console.log("PASS: the job page's title reaches the app for its job card.");
    // Clicking the job's card in the app asks its browser to bring the job window forward. Headless
    // Chrome never moves window focus, so only the step running cleanly can be checked here.
    bridge.command(profile.id,job.id,'focus');
    for(let i=0;i<100 && bridge.dashboard(profile.id).jobs.find(j=>j.id===job.id).commands.length;i++)await delay(100);
    const shown=bridge.dashboard(profile.id).jobs.find(j=>j.id===job.id);
    assert.deepEqual(shown.commands,[]);
    assert.equal(shown.lastCommand.action,'open','showing the window succeeded and leaves no result line');
    assert.equal((await evaluate(`chrome.tabs.get(${live.run.jobTabId})`)).active,true);
    console.log("PASS: clicking a job's card in the app runs the show-window step in its browser.");
    // Start over on a second job: its tabs close and its browser reports the clean-up.
    profile.extensionJobLinks.push('http://127.0.0.1:17373/fixture-restart');
    const restart=bridge.assign(profile.id,'http://127.0.0.1:17373/fixture-restart',connection.id);
    let restartRun;
    for(let i=0;i<100;i++){restartRun=(await evaluate(`chrome.runtime.sendMessage({action:'state'})`))?.runs?.[restart.id];if(restartRun?.jobTabId)break;await delay(100);}
    assert.ok(restartRun?.jobTabId,JSON.stringify(restartRun));
    bridge.reset(profile.id,restart.id);
    let restartTabs=1;
    for(let i=0;i<100;i++){restartTabs=await evaluate(`chrome.tabs.query({}).then(tabs=>tabs.filter(t=>[${restartRun.jobTabId},${restartRun.chatTabId}].includes(t.id)).length)`);if(!restartTabs && (await evaluate(`chrome.runtime.sendMessage({action:'state'})`))?.runs?.[restart.id]===undefined)break;await delay(100);}
    assert.equal(restartTabs,0,'its tabs are closed');
    assert.equal(bridge.dashboard(profile.id).jobs.some(j=>j.id===restart.id),false);
    let forgotten;for(let i=0;i<30;i++){const st=await evaluate(`chrome.runtime.sendMessage({action:'state'})`);if(st?.runs){forgotten=st.runs[restart.id];break;}await delay(100);}
    assert.equal(forgotten,undefined,'its run is forgotten');
    console.log("PASS: Start over closes the job's tabs and puts it back to Not sent.");
    // Full auto reads the JD and sends the resume prompt by itself.
    const sent=await evaluate(`chrome.runtime.sendMessage({action:'fullAuto',id:${JSON.stringify(job.id)}})`);assert.equal(sent.ok,true,JSON.stringify(sent));assert.match(sent.message,/Resume prompt sent/);
    assert.equal(bridge.dashboard(profile.id).jobs.find(j=>j.id===job.id).company,'Acme');
    // If the long request is omitted entirely, require human confirmation instead of blocking export.
    await evaluate(`chrome.scripting.executeScript({target:{tabId:${live.run.chatTabId}},func:()=>{const user=[...document.querySelectorAll('[data-message-author-role="user"]')].at(-1);user.textContent='Virtualized long request';}})`);
    await delay(1000);
    const early=await evaluate(`chrome.runtime.sendMessage({action:'detail',id:${JSON.stringify(job.id)}})`);
    assert.ok(!early.run.pendingResumeResponse,'Do not collect while generation is active');
    let collected;
    for(let attempt=0;attempt<30;attempt++) {
      collected=await evaluate(`chrome.runtime.sendMessage({action:'detail',id:${JSON.stringify(job.id)}})`);
      if(collected.run.responseMonitor?.status==='ready' && collected.run.pendingResumeResponse && collected.run.fullAutoBlocker)break;
      await delay(500);
    }
    assert.equal(collected.run.responseMonitor?.status,'ready',JSON.stringify(collected.run.responseMonitor));
    // The reply could not be matched to its request, so Full auto hands the resume back for review.
    assert.equal(collected.run.fullAutoBlocker?.stage,'resume',JSON.stringify(collected.run.fullAutoBlocker));assert.ok(!collected.run.fullAuto?.active);
    console.log('PASS: Full auto sends the resume prompt and stops at Resume when the reply needs review.');
    const review={responsePreview:collected.run.pendingResumeResponse};
    assert.ok(review.responsePreview);assert.ok(!bridge.dashboard().jobs[0].exported);
    assert.doesNotMatch(review.responsePreview,/Iterate|Copy code/);assert.equal(JSON.parse(review.responsePreview).company,'Acme');
    const clipboardState=await evaluate(`chrome.scripting.executeScript({target:{tabId:${live.run.chatTabId}},world:'MAIN',func:()=>({writes:fixtureClipboardWrites,restored:navigator.clipboard.writeText===fixtureClipboardWrite})})`);assert.equal(clipboardState[0].result.writes,0);assert.equal(clipboardState[0].result.restored,true);
    const unapproved=await evaluate(`chrome.runtime.sendMessage({action:'confirmResume',id:${JSON.stringify(job.id)},confirmed:false})`);assert.ok(unapproved.error);
    const exported=await evaluate(`chrome.runtime.sendMessage({action:'confirmResume',id:${JSON.stringify(job.id)},confirmed:true})`);
    assert.equal(exported.ok,true,JSON.stringify(exported));assert.equal(exported.job.files.pdf,'fixture.pdf');
    assert.equal((await evaluate(`chrome.runtime.sendMessage({action:'detail',id:${JSON.stringify(job.id)}})`)).run.fullAutoBlocker,null,'confirming it yourself clears the Full auto notice');
    console.log('PASS: streaming resume JSON is collected automatically only after completion, then exported only after manual confirmation.');
    const scanned=await evaluate(`chrome.runtime.sendMessage({action:'scan',id:${JSON.stringify(job.id)}})`);assert.equal(scanned.ok,true,JSON.stringify(scanned));
    const uploadScan=await evaluate(`chrome.runtime.sendMessage({action:'detail',id:${JSON.stringify(job.id)}})`);
    const resumeField=uploadScan.run.fields.find(f=>f.type==='file' && f.resumeUpload);assert.ok(resumeField);
    const uploaded=await evaluate(`chrome.runtime.sendMessage({action:'uploadResume',id:${JSON.stringify(job.id)},fieldId:${JSON.stringify(resumeField.id)}})`);assert.equal(uploaded.ok,true,JSON.stringify(uploaded));
    const filesOnPage=await evaluate(`chrome.scripting.executeScript({target:{tabId:${live.run.jobTabId}},func:async()=>({name:document.querySelector('#resume').files[0]?.name,prefix:Array.from(new Uint8Array(await document.querySelector('#resume').files[0].arrayBuffer())).slice(0,2),other:document.querySelector('#cover').files.length})})`);
    assert.equal(filesOnPage[0].result.name,'resume.docx');assert.deepEqual(filesOnPage[0].result.prefix,[80,75]);assert.equal(filesOnPage[0].result.other,0);
    const afterUpload=await evaluate(`chrome.runtime.sendMessage({action:'detail',id:${JSON.stringify(job.id)}})`);assert.ok(afterUpload.run.fields.length>0);assert.notEqual(afterUpload.run.fields[0].scanId,uploadScan.run.fields[0].scanId);
    console.log('PASS: generated DOCX is uploaded only to the resume field and the form is rescanned automatically.');
    const beforeAsk=await evaluate(`chrome.runtime.sendMessage({action:'detail',id:${JSON.stringify(job.id)}})`);
    const countryBefore=beforeAsk.run.fields.find(field=>field.label==='Country');assert.deepEqual(countryBefore.options,[]);
    // Contact facts come straight from the profile and are never asked.
    const firstBefore=beforeAsk.run.fields.find(field=>field.label==='First name');
    assert.equal(beforeAsk.run.answers.find(answer=>answer.id===firstBefore.id).answer,'Fixture');assert.ok(beforeAsk.run.fixedIds.includes(firstBefore.id));
    const asked=await evaluate(`chrome.runtime.sendMessage({action:'sendAnswers',id:${JSON.stringify(job.id)}})`);assert.equal(asked.ok,true,JSON.stringify(asked));assert.match(asked.message,/Sent 2 application questions/);
    // Simulate a missed content-script notification. The panel's polling action
    // must still collect the complete response after generation stops.
    await evaluate(`chrome.scripting.executeScript({target:{tabId:${live.run.chatTabId}},func:()=>ResumeApplyChat.stopResponseWatch()})`);
    const questionPrompt=await evaluate(`chrome.scripting.executeScript({target:{tabId:${live.run.chatTabId}},func:()=>[...document.querySelectorAll('[data-message-author-role="user"]')].at(-1).textContent})`);
    assert.ok(questionPrompt[0].result.includes('Why our company?'));
    const promptSource=questionPrompt[0].result;
    const promptPayload=JSON.parse(promptSource.slice(promptSource.lastIndexOf('{',promptSource.indexOf('"personalInfo"')),promptSource.lastIndexOf('}',promptSource.indexOf('Request reference:'))+1));
    assert.ok(!promptPayload.questions.some(question=>question.label==='First name'));
    const sentCountry=promptPayload.questions.find(question=>question.label==='Country');
    assert.equal(sentCountry.options,undefined);assert.equal(sentCountry.answerFormat,'text');
    const unopened=await evaluate(`chrome.scripting.executeScript({target:{tabId:${live.run.jobTabId}},func:()=>!document.querySelector('#country-options')})`);assert.equal(unopened[0].result,true);
    assert.ok(!questionPrompt[0].result.includes('"type": "file"'));
    assert.ok(questionPrompt[0].result.includes('ONE fenced code block labeled json'));
    let reviewed;
    for(let attempt=0;attempt<30;attempt++) {
      const polled=await evaluate(`chrome.runtime.sendMessage({action:'pollAnswers',id:${JSON.stringify(job.id)}})`);
      assert.equal(polled.ok,true,JSON.stringify(polled));
      reviewed={run:polled.run};
      if(reviewed.run.responseMonitor?.kind==='answers' && reviewed.run.responseMonitor.status==='ready')break;
      await delay(500);
    }
    assert.equal(reviewed.run.responseMonitor?.status,'ready',JSON.stringify(reviewed.run.responseMonitor));
    const countryAfter=reviewed.run.fields.find(field=>field.label==='Country');
    assert.equal(countryAfter.id,countryBefore.id);
    assert.equal(reviewed.run.answers.find(answer=>answer.id===countryAfter.id).answer,'United States');
    console.log('PASS: grid dropdowns are sent to GPT as text questions without opening or enumerating their choices.');
    const unfilled=await evaluate(`chrome.scripting.executeScript({target:{tabId:${live.run.jobTabId}},func:()=>document.querySelector('#first').value})`);assert.equal(unfilled[0].result,'');
    console.log('PASS: polling collects completed answers after a missed page notification, including the Copy response fallback; application fields remain untouched.');
    // The app is told the answers are ready, and its Fill form puts them on the page.
    let ready;
    for(let i=0;i<100 && (ready=bridge.dashboard(profile.id).jobs.find(j=>j.id===job.id).progress)?.key!=='answers-ready';i++)await delay(100);
    assert.equal(ready.key,'answers-ready',JSON.stringify(ready));
    bridge.command(profile.id,job.id,'fill');
    let fillResult;
    for(let i=0;i<200 && (fillResult=bridge.dashboard(profile.id).jobs.find(j=>j.id===job.id).lastCommand)?.action!=='fill';i++)await delay(100);
    assert.ok(fillResult && fillResult.action==='fill' && fillResult.ok,JSON.stringify(fillResult));
    console.log("PASS: when ChatGPT's answers are ready, the app's Fill form puts them on the page.");
    const application=await evaluate(`chrome.scripting.executeScript({target:{tabId:${live.run.jobTabId}},world:'MAIN',func:()=>({submitted:globalThis.submitted,first:document.querySelector('#first').value,why:document.querySelector('#why').value,country:document.querySelector('#country').value})})`);
    assert.equal(application[0].result.submitted,false);assert.equal(application[0].result.first,'Fixture');assert.ok(application[0].result.why.includes('reliable services'));
    assert.equal(application[0].result.country,'United States of America');
    // Saved for this profile and site in the wording the site showed, not ChatGPT's.
    const memory=await evaluate(`chrome.storage.local.get('siteAnswers').then(data=>data.siteAnswers)`);
    const book=Object.values(memory[profile.id])[0];
    assert.ok(Object.values(book.answers).some(entry=>entry.label==='Country' && entry.answer==='United States of America'),JSON.stringify(book));
    assert.ok(!Object.values(book.answers).some(entry=>entry.label==='First name'),'contact details stay in the profile');
    const memoryDetail=await evaluate(`chrome.runtime.sendMessage({action:'detail',id:${JSON.stringify(job.id)}})`);
    assert.ok(memoryDetail.siteMemory[0].count>=1,JSON.stringify(memoryDetail.siteMemory));
    console.log('PASS: real worker opens and groups both tabs, extracts JD, sends/reads ChatGPT fixtures, exports, scans, and fills approved answers.');
    // One click: a question appears, Auto-fill asks only about it, fills, and stops short of Submit.
    await evaluate(`chrome.scripting.executeScript({target:{tabId:${live.run.jobTabId}},func:()=>{const box=document.createElement('input');box.id='extra';box.setAttribute('aria-label','Newly revealed question');document.querySelector('#first').form.append(box);}})`);
    const auto=await evaluate(`chrome.runtime.sendMessage({action:'auto',id:${JSON.stringify(job.id)}})`);assert.equal(auto.ok,true,JSON.stringify(auto));assert.match(auto.message,/Asked ChatGPT 1 question/);
    let autoRun;
    for(let attempt=0;attempt<40;attempt++) {
      const polled=await evaluate(`chrome.runtime.sendMessage({action:'pollAnswers',id:${JSON.stringify(job.id)}})`);
      autoRun=(await evaluate(`chrome.runtime.sendMessage({action:'detail',id:${JSON.stringify(job.id)}})`)).run;
      if(!autoRun.autopilot)break;
      await delay(500);
    }
    assert.ok(!autoRun.autopilot,'auto-fill did not finish');
    const afterAuto=await evaluate(`chrome.scripting.executeScript({target:{tabId:${live.run.jobTabId}},world:'MAIN',func:()=>({submitted:globalThis.submitted,extra:document.querySelector('#extra').value,first:document.querySelector('#first').value})})`);
    assert.equal(afterAuto[0].result.submitted,false);assert.ok(afterAuto[0].result.extra.length>0);assert.equal(afterAuto[0].result.first,'Fixture');
    const uploads=await evaluate(`chrome.scripting.executeScript({target:{tabId:${live.run.jobTabId}},func:()=>document.querySelector('#resume').files.length})`);assert.equal(uploads[0].result,1);
    // The job reports how Auto-fill went, and the app keeps it for its status view.
    for(let i=0;i<30 && !bridge.dashboard().jobs.find(j=>j.id===job.id)?.progress?.text;i++)await delay(100);
    assert.ok(bridge.dashboard().jobs.find(j=>j.id===job.id)?.progress?.text,JSON.stringify(bridge.dashboard().jobs));
    console.log('PASS: Auto-fill asks ChatGPT only about the new question, fills the form, and never submits.');
    // Run again after your own changes: what you typed stays, and only the empty question is asked.
    await evaluate(`chrome.scripting.executeScript({target:{tabId:${live.run.jobTabId}},func:()=>{const form=document.querySelector('#first').form;document.querySelector('#why').value='My own answer';
      for(const [id,label,value] of [['mine','Question you answered yourself','Typed by me'],['blank2','Another new question','']]){const box=document.createElement('input');box.id=id;box.setAttribute('aria-label',label);box.value=value;form.append(box);}}})`);
    const again=await evaluate(`chrome.runtime.sendMessage({action:'auto',id:${JSON.stringify(job.id)}})`);assert.equal(again.ok,true,JSON.stringify(again));assert.match(again.message,/Asked ChatGPT 1 question/);
    for(let attempt=0;attempt<40;attempt++) {
      await evaluate(`chrome.runtime.sendMessage({action:'pollAnswers',id:${JSON.stringify(job.id)}})`);
      autoRun=(await evaluate(`chrome.runtime.sendMessage({action:'detail',id:${JSON.stringify(job.id)}})`)).run;
      if(!autoRun.autopilot)break;
      await delay(500);
    }
    assert.ok(!autoRun.autopilot,'second auto-fill did not finish');
    const kept=await evaluate(`chrome.scripting.executeScript({target:{tabId:${live.run.jobTabId}},world:'MAIN',func:()=>({submitted:globalThis.submitted,why:document.querySelector('#why').value,mine:document.querySelector('#mine').value,blank2:document.querySelector('#blank2').value,first:document.querySelector('#first').value,resumes:document.querySelector('#resume').files.length})})`);
    assert.deepEqual({...kept[0].result,blank2:!!kept[0].result.blank2},{submitted:false,why:'My own answer',mine:'Typed by me',blank2:true,first:'Fixture',resumes:1});
    console.log('PASS: Auto-fill run again keeps answers you typed yourself and only asks about empty questions.');
    // A dropdown that opens on a real option is the site's default, not an answer: it is asked.
    // One moved off its default is kept.
    await evaluate(`chrome.scripting.executeScript({target:{tabId:${live.run.jobTabId}},func:()=>{const form=document.querySelector('#first').form;
      for(const [id,label,options,value] of [['start','Preferred start date',['Immediately','In a month'],null],['shift','Preferred shift',['Day','Night'],'Night']]){const select=document.createElement('select');select.id=id;select.setAttribute('aria-label',label);for(const option of options)select.append(new Option(option,option));if(value)select.value=value;form.append(select);}}})`);
    const defaults=await evaluate(`chrome.runtime.sendMessage({action:'auto',id:${JSON.stringify(job.id)}})`);assert.equal(defaults.ok,true,JSON.stringify(defaults));assert.match(defaults.message,/Asked ChatGPT 1 question/);
    for(let attempt=0;attempt<40;attempt++) {
      await evaluate(`chrome.runtime.sendMessage({action:'pollAnswers',id:${JSON.stringify(job.id)}})`);
      autoRun=(await evaluate(`chrome.runtime.sendMessage({action:'detail',id:${JSON.stringify(job.id)}})`)).run;
      if(!autoRun.autopilot)break;
      await delay(500);
    }
    assert.ok(!autoRun.autopilot,'dropdown auto-fill did not finish');
    const byLabel=label=>autoRun.fields.find(field=>field.label===label);
    assert.ok(byLabel('Preferred start date').preset && autoRun.askedIds.includes(byLabel('Preferred start date').id),JSON.stringify(byLabel('Preferred start date')));
    assert.ok(!byLabel('Preferred shift').preset && !autoRun.askedIds.includes(byLabel('Preferred shift').id),JSON.stringify(byLabel('Preferred shift')));
    const shift=await evaluate(`chrome.scripting.executeScript({target:{tabId:${live.run.jobTabId}},func:()=>{const value=document.querySelector('#shift').value;document.querySelector('#start').remove();document.querySelector('#shift').remove();return value;}})`);
    assert.equal(shift[0].result,'Night');
    console.log("PASS: a dropdown still on the site's default is answered; one moved off its default is kept.");
    // A multi-page form: Auto-fill clicks Next, then answers the next page by itself.
    await evaluate(`chrome.scripting.executeScript({target:{tabId:${live.run.jobTabId}},func:()=>{const form=document.querySelector('#first').form;form.querySelectorAll('button,input[type=submit]').forEach(control=>control.remove());const next=document.createElement('button');next.type='button';next.id='next-page';next.textContent='Next';next.onclick=()=>{next.remove();const box=document.createElement('input');box.id='second';box.setAttribute('aria-label','Second page question');form.append(box);};form.append(next);}})`);
    const multi=await evaluate(`chrome.runtime.sendMessage({action:'auto',id:${JSON.stringify(job.id)}})`);assert.equal(multi.ok,true,JSON.stringify(multi));
    for(let attempt=0;attempt<40;attempt++) {
      await evaluate(`chrome.runtime.sendMessage({action:'pollAnswers',id:${JSON.stringify(job.id)}})`);
      autoRun=(await evaluate(`chrome.runtime.sendMessage({action:'detail',id:${JSON.stringify(job.id)}})`)).run;
      if(!autoRun.autopilot)break;
      await delay(500);
    }
    assert.ok(!autoRun.autopilot,'multi-page auto-fill did not finish: '+JSON.stringify(multi));
    const secondPage=await evaluate(`chrome.scripting.executeScript({target:{tabId:${live.run.jobTabId}},world:'MAIN',func:()=>({submitted:globalThis.submitted,second:document.querySelector('#second')?.value,next:!!document.querySelector('#next-page')})})`);
    assert.equal(secondPage[0].result.next,false);assert.ok(secondPage[0].result.second?.length>0,JSON.stringify(secondPage[0].result));assert.equal(secondPage[0].result.submitted,false);
    console.log('PASS: Auto-fill clicks Next on a completed page, answers the next page, and never submits.');
    const completed=await evaluate(`chrome.runtime.sendMessage({action:'complete',id:${JSON.stringify(job.id)},confirmed:true})`);
    assert.equal(completed.ok,true);assert.equal(bridge.dashboard().jobs[0].status,'completed');
    // Marking it ended closes the job's tabs.
    let left=[];
    for(let i=0;i<30;i++){left=await evaluate(`chrome.tabs.query({}).then(tabs=>tabs.filter(t=>[${live.run.jobTabId},${live.run.chatTabId}].includes(t.id)).length)`);if(!left)break;await delay(100);}
    assert.equal(left,0,'the job tab and ChatGPT tab are closed');
    console.log('PASS: app job delivery, profile detail retrieval, and manual completion through the real extension worker.');
  } finally {
    if(socket && socket.readyState===WebSocket.OPEN){try{await send('Browser.close');}catch(_){}socket.close();}
    if(child && child.exitCode===null){await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(3000)]);if(child.exitCode===null)child.kill();}
    await bridge.stop();
    if(path.dirname(temp)===path.resolve(os.tmpdir()) && path.basename(temp).startsWith('resume-chrome-extension-')){try{fs.rmSync(temp,{recursive:true,force:true});}catch(_){}}
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
