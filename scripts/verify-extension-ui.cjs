// Runs isolated, invisible Electron windows against local fixtures; no real accounts or job sites.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
if (!process.versions.electron) {
  const {spawnSync} = require('node:child_process');
  const env = {...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [__filename], {env, stdio:'inherit', windowsHide:true});
  process.exit(result.status || (result.error ? 1 : 0));
}
const {app,BrowserWindow,ipcMain,session} = require('electron');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname,'..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(),'resume-extension-ui-'));
app.setPath('userData',temp);
let windows = [];
const chatFixture = `<!doctype html><html><body><div id="messages"></div><textarea id="prompt-textarea"></textarea><button data-testid="send-button">Send</button>
<script>document.querySelector('button').onclick=()=>{const input=document.querySelector('textarea');const user=document.createElement('div');user.dataset.messageAuthorRole='user';user.textContent=input.value;const assistant=document.createElement('div');assistant.dataset.messageAuthorRole='assistant';const code=document.createElement('pre');code.textContent='{"answers":[{"id":"why","answer":"Meaningful example."}]}';assistant.append(code);document.querySelector('#messages').append(user,assistant);input.value='';};</script></body></html>`;
const fixture = `<!doctype html><html><head><title>Engineer at Acme</title></head><body>
<script type="application/ld+json">{"@type":"JobPosting","title":"Engineer","hiringOrganization":{"name":"Acme"},"description":"<p>Build reliable systems.</p>"}</script>
<main><form><label for="name">First name</label><input id="name" name="firstName"><label for="email">Email</label><input id="email" type="email">
<label for="why">Why our company?</label><textarea id="why"></textarea>
<label for="gender">Gender</label><select id="gender"><option value="">Choose</option><option value="woman">Woman</option><option value="man">Man</option></select>
<label for="custom-country">Country</label><input id="custom-country" role="combobox" aria-controls="country-options"><div id="country-options" role="listbox" hidden><div role="option">United States of America</div><div role="option">Canada</div></div>
<label for="custom-skills">Skills</label><input id="custom-skills" role="combobox" aria-controls="skill-options"><div id="skill-options" role="listbox" aria-multiselectable="true" hidden><div role="option">JavaScript</div><div role="option">Python</div></div>
<fieldset><legend>Need sponsorship?</legend><label><input type="radio" name="sponsor" value="yes">Yes</label><label><input type="radio" name="sponsor" value="no">No</label></fieldset>
<fieldset><legend>Are you subject to restrictive covenants or similar agreements?</legend><label><input type="radio" name="covenants" value="yes">Yes</label><label><input type="radio" name="covenants" value="no">No</label></fieldset>
<label><input type="checkbox" id="consent">I agree to the terms</label><label for="resume">Resume</label><input id="resume" type="file">
<button id="submit" type="submit">Submit application</button></form></main>
<script>window.submitted=false;document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();window.submitted=true;});</script>
</body></html>`;
async function windowFor(options = {}) {
  const win = new BrowserWindow({show:false,width:1200,height:900,webPreferences:{sandbox:true,contextIsolation:true,...options}});windows.push(win);return win;
}
async function wait(win, expression) {
  return win.webContents.executeJavaScript(`new Promise((resolve,reject)=>{let count=0;const t=setInterval(()=>{if(${expression}){clearInterval(t);resolve(true);}else if(count++>100){clearInterval(t);reject(new Error('Condition timed out: '+${JSON.stringify(expression)}));}},50);})`);
}
app.whenReady().then(async () => {
  try {
    const panelJob = {id:'fixture',url:'https://jobs.example.test/job',status:'questions-scanned',company:'Acme',title:'Engineer',jd:'Build systems',profile:{applicationDetails:{gender:'Man',answerPrompt:'Two sentences.'}}};
    const panelRun = {fields:[{id:'why',frameId:0,label:'Why our company?',type:'textarea',options:[]}],answers:[{id:'why',answer:'Meaningful impact.'}]};
    const panelStub = `<script>globalThis.fixtureCommands=[];globalThis.fixtureRun=${JSON.stringify(panelRun)};globalThis.fixturePollResult=null;globalThis.panelListeners=[];globalThis.chrome={runtime:{onMessage:{addListener:listener=>panelListeners.push(listener)},sendMessage:async m=>{fixtureCommands.push(m);if(m.action==='state')return {ok:true,client:{name:'Fixture'},jobs:[${JSON.stringify(panelJob)}],runs:{}};if(m.action==='detail')return {ok:true,job:${JSON.stringify(panelJob)},run:fixtureRun};if(m.action==='pollAnswers'){if(fixturePollResult){fixtureRun=fixturePollResult;fixturePollResult=null;}return {ok:true,run:fixtureRun};}return {ok:true,message:'Step done'};}},permissions:{request:async()=>true}};</script>`;
    await session.defaultSession.protocol.handle('https', request => {
      const url = new URL(request.url);
      if(url.hostname==='extension.fixture') {
        const file = url.pathname.slice(1) || 'panel.html';
        if(!['panel.html','panel.js','panel.css'].includes(file))return new Response('',{status:404});
        let content = fs.readFileSync(path.join(root,'chrome-extension',file),'utf8');
        if(file==='panel.html')content=content.replace('<head>','<head>'+panelStub);
        return new Response(content,{headers:{'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'}});
      }
      return new Response(url.hostname==='chatgpt.com'?chatFixture:fixture,{headers:{'Content-Type':'text/html'}});
    });
    const page = await windowFor();await page.loadURL('https://jobs.example.test/job');
    await page.webContents.executeJavaScript(fs.readFileSync(path.join(root,'chrome-extension/page-tools.js'),'utf8'));
    const job = await page.webContents.executeJavaScript('ResumeApplyPage.job()');assert.equal(job.company,'Acme');assert.ok(job.description.includes('Build reliable'));
    const scan = await page.webContents.executeJavaScript('ResumeApplyPage.scan()');
    assert.ok(scan.fields.some(f=>f.label==='First name'));
    assert.ok(scan.fields.some(f=>f.label==='Need sponsorship?' && f.options.length===2));
    assert.equal(scan.fields.find(f=>f.label.includes('restrictive covenants')).manualOnly,false);
    const country=scan.fields.find(f=>f.label==='Country');
    assert.equal(country.manualOnly,false);assert.equal(country.type,'combobox');assert.equal(country.answerFormat,'single');
    assert.deepEqual(country.options,['United States of America','Canada']);
    const skills=scan.fields.find(f=>f.label==='Skills');
    assert.equal(skills.answerFormat,'multiple');assert.deepEqual(skills.options,['JavaScript','Python']);
    assert.ok(!scan.fields.some(f=>f.label==='Submit application'));
    assert.equal(scan.fields.find(f=>f.type==='file').resumeUpload,true);
    const first = scan.fields.find(f=>f.label==='First name');
    const consent = scan.fields.find(f=>f.label.includes('I agree'));
    assert.ok(consent.manualOnly);
    const fill = await page.webContents.executeJavaScript(`ResumeApplyPage.fill(${JSON.stringify([{id:first.id,scanId:scan.scanId,answer:'Jane'},{id:consent.id,scanId:scan.scanId,answer:'Yes'}])})`);
    assert.equal(fill[0].filled,true);assert.ok(fill[1].error);
    assert.equal(await page.webContents.executeJavaScript('document.querySelector("#name").value'),'Jane');
    assert.equal(await page.webContents.executeJavaScript('window.submitted'),false);
    await page.webContents.executeJavaScript('history.pushState({},"","/different");');
    const staleError = await page.webContents.executeJavaScript(`(async()=>{try{await ResumeApplyPage.fill(${JSON.stringify([{id:first.id,scanId:scan.scanId,answer:'Other'}])});return '';}catch(e){return e.message;}})()`);
    assert.match(staleError,/changed/);
    console.log('PASS: real DOM JD extraction, question scan, approved fill, manual-only controls, stale-page rejection, no submit.');

    const chat = await windowFor();await chat.loadURL('https://chatgpt.com/');
    await chat.webContents.executeJavaScript(fs.readFileSync(path.join(root,'chrome-extension/chatgpt-tools.js'),'utf8'));
    const receipt = await chat.webContents.executeJavaScript('ResumeApplyChat.send("Professional prompt")');
    assert.ok(receipt.marker);
    const response = await chat.webContents.executeJavaScript(`ResumeApplyChat.read(${JSON.stringify(receipt)})`);
    assert.ok(response.includes('Meaningful example'));
    await chat.webContents.executeJavaScript(`(()=>{
      const user=document.querySelector('[data-message-author-role="user"]');
      const full=user.textContent, marker=full.match(/RM-[a-f0-9-]+/)[0];
      user.replaceChildren(document.createTextNode('Long prompt preview '));
      const collapsed=document.createElement('span');collapsed.style.display='none';collapsed.textContent=full;user.append(collapsed);
      if(user.innerText.includes(marker))throw new Error('Collapsed fixture must hide its request marker from visible text.');
    })()`);
    const collapsedResponse = await chat.webContents.executeJavaScript(`ResumeApplyChat.read(${JSON.stringify(receipt)})`);
    assert.ok(collapsedResponse.includes('Meaningful example'));
    const remountedResponse = await chat.webContents.executeJavaScript(`ResumeApplyChat.read(${JSON.stringify({...receipt,baseline:99,previous:response})})`);
    assert.ok(remountedResponse.includes('Meaningful example'));
    console.log('PASS: collapsed request markers and remounted message counts do not block reading the matching completed response.');
    await chat.webContents.executeJavaScript(`(()=>{const user=document.querySelector('[data-message-author-role="user"]');user.setAttribute('data-message-id','known-user');user.textContent='Collapsed preview only';})()`);
    const stable = await chat.webContents.executeJavaScript(`ResumeApplyChat.read(${JSON.stringify({...receipt,userMessageId:'known-user'})})`);
    assert.ok(stable.includes('Meaningful example'));
    const review = await chat.webContents.executeJavaScript(`ResumeApplyChat.readForReview(${JSON.stringify(receipt)})`);
    assert.equal(review.matched,false);assert.ok(review.response.includes('Meaningful example'));
    const exactPrompt='Known complete prompt '.repeat(20);
    await chat.webContents.executeJavaScript(`document.querySelector('[data-message-author-role="user"]').textContent=${JSON.stringify(exactPrompt)}`);
    const exact = await chat.webContents.executeJavaScript(`ResumeApplyChat.read(${JSON.stringify(receipt)},${JSON.stringify(exactPrompt)})`);
    assert.ok(exact.includes('Meaningful example'));
    console.log('PASS: stable message IDs and exact prompts match; uncertain responses require explicit review.');


    await chat.webContents.executeJavaScript('const other=document.createElement("div");other.dataset.messageAuthorRole="user";other.textContent="Different request";document.querySelector("#messages").append(other);');
    const wrong = await chat.webContents.executeJavaScript(`ResumeApplyChat.read(${JSON.stringify(receipt)}).catch(e=>e.message)`);
    assert.match(wrong,/could not be matched/);
    console.log('PASS: ChatGPT prompt insertion, Send, completed-response reading, and wrong-exchange rejection against a local fixture.');
    await chat.webContents.executeJavaScript('document.querySelector("textarea").value="Keep my draft"');
    const draftError = await chat.webContents.executeJavaScript('ResumeApplyChat.send("Another prompt").catch(e=>e.message)');
    assert.match(draftError,/unsent draft/);
    assert.equal(await chat.webContents.executeJavaScript('document.querySelector("textarea").value'),'Keep my draft');
    await chat.webContents.executeJavaScript(`(()=>{
      const old=document.querySelector('textarea');old.value='';old.id='hidden-legacy';old.dataset.id='root';old.style.display='none';
      const editor=document.createElement('div');editor.id='prompt-textarea';editor.contentEditable='true';editor.className='ProseMirror';editor.style.whiteSpace='pre-wrap';editor.innerHTML='<p><br></p>';
      document.body.append(editor);
      globalThis.fixtureExecCommand=document.execCommand.bind(document);document.execCommand=()=>false;
      document.querySelector('button').onclick=()=>{const user=document.createElement('div');user.dataset.messageAuthorRole='user';user.textContent=editor.innerText;document.querySelector('#messages').append(user);editor.replaceChildren();};
    })()`);
    const insertionError = await chat.webContents.executeJavaScript('ResumeApplyChat.send("Must be inserted").catch(e=>e.message)');
    assert.match(insertionError,/editor is empty after insertion/);
    await chat.webContents.executeJavaScript(`document.execCommand=fixtureExecCommand;globalThis.fixturePasteCount=0;document.querySelector('#prompt-textarea').addEventListener('paste',()=>{fixturePasteCount++;});`);
    const inserted = await chat.webContents.executeJavaScript('ResumeApplyChat.send("Raw text through editor transaction")');
    assert.ok(inserted.marker);assert.ok(!inserted.manualSend && !inserted.sendUnconfirmed);
    assert.equal(await chat.webContents.executeJavaScript('fixturePasteCount'),0);
    console.log('PASS: existing drafts preserved, hidden legacy composer skipped, failed insertion reported, raw text sent without paste attachments.');


    const jsonWindow=await windowFor();await jsonWindow.loadURL('https://chatgpt.com/');
    await jsonWindow.webContents.executeJavaScript(fs.readFileSync(path.join(root,'chrome-extension/chatgpt-tools.js'),'utf8'));
    const resumeJson=JSON.stringify({company:'Acme',title:'Engineer',summary:'Example.',skills:[],experience:[],education:[]});
    await jsonWindow.webContents.executeJavaScript(`(()=>{
      document.body.replaceChildren();
      const user=document.createElement('div');user.dataset.messageAuthorRole='user';const example=document.createElement('pre');example.textContent='DO NOT READ USER EXAMPLE';user.append(example);
      const wrapper=document.createElement('article');wrapper.textContent='Iterate 0: ATS Alignment Score 89/100';
      const editor=document.createElement('div');editor.className='cm-editor';const content=document.createElement('div');content.className='cm-content';
      for(const text of ${JSON.stringify(resumeJson)}.split(String.fromCharCode(10))){const line=document.createElement('div');line.className='cm-line';line.textContent=text;content.append(line);}
      editor.append(content);wrapper.append(editor);document.body.append(user,wrapper);
    })()`);
    const blocks=await jsonWindow.webContents.executeJavaScript('ResumeApplyChat.collectCodeBlocks()');
    assert.ok(blocks.candidates.some(text=>text===resumeJson));assert.ok(!blocks.candidates.some(text=>text.includes('DO NOT READ USER EXAMPLE')));
    console.log('PASS: JSON editor extraction works without assistant-role wrappers and excludes prompt examples and score lines.');

    const plainAnswers=JSON.stringify({answers:[{id:'why',answer:'Complete plain answer'},{id:'race',answer:['Asian']},{id:'unknown',answer:[]}]});
    for(const surface of ['plain','shadow','iframe']) {
      await jsonWindow.webContents.executeJavaScript(`(async()=>{
        document.body.replaceChildren();
        const user=document.createElement('article');user.innerHTML='<h5>You said:</h5><div class="markdown">{"answers":[{"id":"why","answer":"USER PROMPT EXAMPLE"}]}</div>';document.body.append(user);
        let root=document.body;
        if(${JSON.stringify(surface)}==='shadow'){const host=document.createElement('div');document.body.append(host);root=host.attachShadow({mode:'open'});}
        if(${JSON.stringify(surface)}==='iframe'){const frame=document.createElement('iframe');frame.srcdoc='<html><body></body></html>';document.body.append(frame);await new Promise(resolve=>frame.onload=resolve);root=frame.contentDocument.body;}
        const reply=document.createElement('article');reply.innerHTML='<h6>ChatGPT said:</h6>';
        const markdown=document.createElement('div');markdown.className='markdown';markdown.style.whiteSpace='pre-wrap';markdown.textContent=${JSON.stringify(plainAnswers)};reply.append(markdown);
        const copy=document.createElement('button');copy.setAttribute('aria-label','Copy');copy.dataset.testid='copy-turn-action-button';reply.append(copy);root.append(reply);
        const draft=document.createElement('textarea');draft.id='prompt-textarea';draft.value='{"answers":[{"id":"why","answer":"UNSENT DRAFT"}]}';document.body.append(draft);
      })()`);
      const plain=await jsonWindow.webContents.executeJavaScript('ResumeApplyChat.readCandidate()');
      const start=plain.response.indexOf('{'),end=plain.response.lastIndexOf('}')+1;
      assert.deepEqual(JSON.parse(plain.response.slice(start,end)),JSON.parse(plainAnswers));
      const fallback=await jsonWindow.webContents.executeJavaScript('ResumeApplyChat.collectCodeBlocks()');
      assert.ok(fallback.candidates.some(text=>text.includes('Complete plain answer')));
      assert.equal(fallback.copyTargets.length,1);
      assert.ok(!fallback.candidates.some(text=>/USER PROMPT EXAMPLE|UNSENT DRAFT/.test(text)));
      await jsonWindow.webContents.executeJavaScript(`(()=>{const next=document.createElement('article');next.innerHTML='<h5>You said:</h5><div class="markdown">A newer question, not answered yet</div>';document.body.append(next);})()`);
      assert.match(await jsonWindow.webContents.executeJavaScript('ResumeApplyChat.readCandidate().catch(error=>error.message)'),/No completed response/);
    }
    console.log('PASS: plain JSON without author roles is read from normal DOM, shadow roots, and frames; prompt examples, drafts, and stale replies are excluded.');

    const panel = await windowFor();await panel.loadURL('https://extension.fixture/panel.html');
    await wait(panel,'document.querySelectorAll(".question").length===1');
    await wait(panel,'!document.querySelector("#workflow-step").disabled');
    assert.equal(await panel.webContents.executeJavaScript('document.querySelectorAll("[data-workflow-section]:not([hidden])").length'),1);
    assert.equal(await panel.webContents.executeJavaScript('document.querySelector("#workflow-step").value'),'questions');
    const commandsBeforeNavigation=await panel.webContents.executeJavaScript('fixtureCommands.length');
    await panel.webContents.executeJavaScript(`document.querySelector('#workflow-step').value='resume';document.querySelector('#workflow-step').dispatchEvent(new Event('change'));document.querySelector('#jd').value='Keep this draft JD';document.querySelector('#company').value='Draft company';document.querySelector('#workflow-back').click();document.querySelector('#workflow-next').click();`);
    assert.equal(await panel.webContents.executeJavaScript('document.querySelector("#jd").value'),'Keep this draft JD');
    assert.equal(await panel.webContents.executeJavaScript('document.querySelector("#company").value'),'Draft company');
    assert.equal(await panel.webContents.executeJavaScript('document.querySelector("#response-tools").open'),false);
    await panel.webContents.executeJavaScript(`document.querySelector('#connection-settings').click()`);
    assert.equal(await panel.webContents.executeJavaScript('document.querySelector("#workflow-back").disabled'),true);
    await panel.webContents.executeJavaScript(`document.querySelector('#workflow-step').value='questions';document.querySelector('#workflow-step').dispatchEvent(new Event('change'));`);
    assert.equal(await panel.webContents.executeJavaScript('fixtureCommands.length'),commandsBeforeNavigation);
    assert.equal(await panel.webContents.executeJavaScript('document.querySelectorAll("[data-workflow-section]:not([hidden])").length'),1);
    console.log('PASS: only one workflow section is visible, recovery stays collapsed, and navigation preserves drafts without triggering actions.');
    assert.equal(await panel.webContents.executeJavaScript('fixtureCommands.filter(m=>m.action==="fill").length'),0);
    await panel.webContents.executeJavaScript('document.querySelector("[data-step=fill]").click()');
    await wait(panel,'fixtureCommands.some(m=>m.action==="fill")');
    const approved = await panel.webContents.executeJavaScript('fixtureCommands.find(m=>m.action==="fill")');
    assert.equal(approved.approved,true);assert.equal(approved.answers[0].answer,'Meaningful impact.');
    console.log('PASS: answers are sent to the form only when Fill form is clicked.');
    await panel.webContents.executeJavaScript(`document.querySelector('.question textarea').value='My edited answer';document.querySelector('.question textarea').dispatchEvent(new Event('input',{bubbles:true}));fixtureRun.answers=[{id:'why',answer:'Automatic GPT answer'}];fixtureRun.responseMonitor={kind:'answers',status:'ready',marker:'RM-first'};panelListeners.forEach(listener=>listener({event:'response-ready',id:'fixture',kind:'answers'}));`);
    await wait(panel,'document.querySelector("#status").textContent.includes("All answers replaced")');
    assert.equal(await panel.webContents.executeJavaScript('document.querySelector(".question textarea").value'),'Automatic GPT answer');
    await panel.webContents.executeJavaScript(`document.querySelector('.question textarea').value='My edited answer';document.querySelector('.question textarea').dispatchEvent(new Event('input',{bubbles:true}));`);
    await panel.webContents.executeJavaScript(`fixtureRun.pendingResumeResponse='{"company":"Acme"}';fixtureRun.responseMonitor={kind:'resume',status:'ready'};panelListeners.forEach(listener=>listener({event:'response-ready',id:'fixture',kind:'resume'}));`);
    await wait(panel,'!document.querySelector("#resume-response-review").hidden');
    assert.equal(await panel.webContents.executeJavaScript('fixtureCommands.filter(command=>command.action==="confirmResume").length'),0);
    console.log('PASS: automatic response events update resume review while preserving answer edits and never triggering export.');
    await panel.webContents.executeJavaScript(`fixtureRun.responseMonitor={kind:'answers',status:'waiting',lastError:'Response contains an unknown question id.'};panelListeners.forEach(listener=>listener({event:'response-collection-progress',id:'fixture'}));`);
    await wait(panel,'document.querySelector("#response-monitor-status").textContent.includes("unknown question id")');
    assert.equal(await panel.webContents.executeJavaScript('document.querySelector(".question textarea").value'),'My edited answer');
    console.log('PASS: collection errors appear in the panel without replacing answer edits.');
    await panel.webContents.executeJavaScript(`fixtureRun.fields.push({id:'gender',label:'Gender',type:'select',options:['Male','Female']},{id:'race',label:'Race',type:'multiselect',options:['Asian','White']});fixtureRun.responseMonitor={kind:'answers',status:'waiting',marker:'RM-polled'};fixturePollResult={...fixtureRun,answers:[{id:'why',answer:null},{id:'gender',answer:'Male'},{id:'race',answer:['Asian']}],responseMonitor:{kind:'answers',status:'ready',marker:'RM-polled'}};panelListeners.forEach(listener=>listener({event:'response-collection-progress',id:'fixture'}));`);
    await wait(panel,'document.querySelectorAll(".question").length===3');
    assert.equal(await panel.webContents.executeJavaScript('document.querySelector(".question textarea").value'),'');
    assert.equal(await panel.webContents.executeJavaScript('document.querySelector("select[aria-label=Gender]").value'),'Male');
    assert.deepEqual(await panel.webContents.executeJavaScript('[...document.querySelectorAll("[aria-label=Race] .chip[aria-pressed=true]")].map(chip=>chip.textContent)'),['Asian']);
    assert.equal(await panel.webContents.executeJavaScript('document.querySelectorAll(".question input[type=checkbox]").length'),0);
    assert.equal(await panel.webContents.executeJavaScript('fixtureCommands.filter(command=>command.action==="fill").length'),1);
    console.log('PASS: polling replaces the entire preview, clears null answers, and selects single/multiple options without filling the application.');
    assert.equal(await panel.webContents.executeJavaScript('document.querySelector("#workflow-step").value'),'questions');
    await panel.webContents.executeJavaScript(`document.querySelector('#workflow-step').value='resume';document.querySelector('#workflow-step').dispatchEvent(new Event('change'));`);
    assert.equal(await panel.webContents.executeJavaScript('document.querySelector("#jd-details").open'),false);
    assert.equal(await panel.webContents.executeJavaScript('document.querySelectorAll("[data-workflow-section]:not([hidden])").length'),1);



    const data = [
      {id:'manual',firstName:'Manual',applicationMode:'manual',templateChosen:true,workHistory:[],education:[]},
      {id:'extension',firstName:'Extension',applicationMode:'extension',extensionJobLinks:['https://jobs.example.test/job'],workHistory:[],education:[]},
    ];
    ipcMain.handle('profiles:list',()=>data);ipcMain.handle('profiles:save',(_e,items)=>{data.splice(0,data.length,...items);return true;});
    for (const name of ['resume:get','prompt:get','jd:get']) ipcMain.handle(name,()=>null);
    ipcMain.handle('pdf:render',()=>({error:'Preview omitted in fixture'}));
    ipcMain.handle('extension:state',()=>({running:true,connections:[],jobs:[],maxConnections:8,pairingCode:'fixture-code',error:''}));
    const manager = await windowFor({preload:path.join(root,'src/main/preload.js')});
    const errors=[];manager.webContents.on('console-message',event=>{if((event.level==='error'||event.level===3) && !event.message.includes('Preview omitted in fixture'))errors.push(event.message);});
    await manager.loadFile(path.join(root,'src/renderer/index.html'));
    await wait(manager,'document.querySelectorAll(".tile").length===2');
    await manager.webContents.executeJavaScript('location.hash="#/profile/extension"');
    await wait(manager,'document.querySelector("#extension-pairing-code").value==="fixture-code"');
    assert.equal(await manager.webContents.executeJavaScript('document.querySelector("#manual-workspace").hidden'),true);
    assert.equal(await manager.webContents.executeJavaScript('document.querySelectorAll(".extension-slot").length'),8);
    await manager.webContents.executeJavaScript('document.querySelector("#extension-edit-profile").click()');
    assert.equal(await manager.webContents.executeJavaScript('document.querySelector("#profile-extension-mode").checked'),true);
    await manager.webContents.executeJavaScript('document.querySelector("#profile-manual-mode").click();document.querySelector("#save-profile").click()');
    await wait(manager,'!document.querySelector("#manual-workspace").hidden && document.querySelector("#extension-workspace").hidden');
    assert.equal(data.find(p=>p.id==='extension').applicationMode,'manual');
    const promptFocus = await manager.webContents.executeJavaScript('document.querySelector("#application-answer-prompt").focus();getComputedStyle(document.querySelector("#application-answer-prompt")).borderColor');
    assert.ok(promptFocus);
    assert.deepEqual(errors,[]);
    console.log('PASS: app startup, live dashboard, eight slots, profile mode editing, and manual workspace routing.');
    const {renderExtensionResume} = require('../src/main/extension-render');
    const {buildDocx} = require('../src/main/docx');
    const Resume = require('../src/shared/resume');
    const profile = {id:'export',firstName:'Test',workHistory:[{company:'Employer'}],education:[]};
    const resume = Resume.seed(profile);resume.company='Acme';resume.summary='Built reliable systems.';
    const html = renderExtensionResume(profile,resume);
    const pdfWin = await windowFor();await pdfWin.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html));
    const pdf = await pdfWin.webContents.printToPDF({printBackground:true,pageSize:'A4'});
    const docx = buildDocx(profile,resume,{});
    assert.equal(pdf.subarray(0,4).toString(),'%PDF');assert.equal(docx.subarray(0,2).toString(),'PK');
    console.log('PASS: native Chromium PDF rendering and Word DOCX generation from extension resume data.');
  } finally {
    for(const win of windows) if(!win.isDestroyed())win.destroy();
  }
}).then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});
app.on('will-quit',()=>{
  // Only remove the unique temporary directory created by this test.
  if(path.dirname(temp)===path.resolve(os.tmpdir()) && path.basename(temp).startsWith('resume-extension-ui-')) {
    try{fs.rmSync(temp,{recursive:true,force:true});}catch(_){}
  }
});
