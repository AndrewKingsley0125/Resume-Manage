// Runs the ref-based site adapters in chrome-extension/page-tools.js against
// small fixtures shaped like each site's markup (see the header comment of each
// ref/src/automation/adapters/*.js). Scans, fills, and checks the page state.
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
if(!process.versions.electron) {
  const {spawnSync}=require('node:child_process');
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const result=spawnSync(require('electron'),[__filename],{env,stdio:'inherit',windowsHide:true});
  process.exit(result.status || (result.error?1:0));
}
const {app,BrowserWindow,session}=require('electron');
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'resume-ref-adapters-')));
const tools=fs.readFileSync(path.join(__dirname,'../chrome-extension/page-tools.js'),'utf8');

// A search-as-you-type list: typing renders matching role=option items.
const searchList=(input,list,choices)=>`(()=>{const input=document.querySelector('${input}'),list=document.querySelector('${list}');
  const render=()=>{list.innerHTML='';const q=input.value.toLowerCase().split(',')[0].trim();if(!q){list.hidden=true;return;}
    for(const c of ${JSON.stringify(choices)}.filter(c=>c.toLowerCase().includes(q))){const o=document.createElement('div');o.setAttribute('role','option');o.textContent=c;o.onclick=()=>{input.value=c;window.picked=c;list.hidden=true;};list.append(o);}
    list.hidden=!list.children.length;};
  input.addEventListener('input',render);})();`;

const cases=[
  {name:'Ashby: question titles, yes/no buttons and location search',host:'jobs.ashbyhq.com',
    html:`<form class="ashby-application-form-container">
      <div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title _required_1">Name</label><input name="name"></div>
      <div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title">Are you authorized to work in the US?</label>
        <div class="ashby-application-form-input-yesno"><button data-option="yes">Yes</button><button data-option="no">No</button></div></div>
      <div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title">Location</label><input role="combobox" id="loc" aria-controls="locs"><div id="locs" role="listbox" hidden></div></div>
    </form>`,
    setup:`window.submitted=false;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submitted=true;};
      document.querySelectorAll('[data-option]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-option]').forEach(o=>o.setAttribute('aria-pressed',String(o===b)));}));
      ${searchList('#loc','#locs',['Austin, Texas, United States','Boston, Massachusetts, United States'])}`,
    check:fields=>{
      assert.deepEqual(fields.map(f=>[f.label,f.type,f.required]),[['Name','text',true],['Are you authorized to work in the US?','radio',false],['Location','combobox',false]]);
      assert.deepEqual(fields[1].options,['Yes','No']);assert.equal(fields[2].answerFormat,'text');
    },
    answers:['Jane Doe','Yes','Austin, TX'],
    after:`({name:document.querySelector('[name=name]').value,yes:document.querySelector('[data-option=yes]').getAttribute('aria-pressed'),loc:document.querySelector('#loc').value,submitted:window.submitted})`,
    expect:{name:'Jane Doe',yes:'true',loc:'Austin, Texas, United States',submitted:false}},
  {name:'Lever: application-question cards, ✱ required, radios and location suggestions',host:'jobs.lever.co',
    html:`<form id="application-form">
      <div class="application-question"><div class="application-label"><div class="text">Full name<span class="required">✱</span></div></div><input name="name"></div>
      <div class="application-question"><div class="application-label"><div class="text">Current location</div></div><input name="location"><div class="dropdown-results"></div></div>
      <div class="application-question"><div class="application-label"><div class="text">Will you need sponsorship?</div></div>
        <label><input type="radio" name="cards[x][field0]" value="a"><span class="application-answer-alternative">Yes</span></label>
        <label><input type="radio" name="cards[x][field0]" value="b"><span class="application-answer-alternative">No</span></label></div>
    </form>`,
    setup:`const loc=document.querySelector('[name=location]'),res=document.querySelector('.dropdown-results');
      loc.addEventListener('input',()=>{res.innerHTML='';if(loc.value.toLowerCase().startsWith('austin'))for(const c of ['Austin, TX, USA','Austin, MN, USA']){const d=document.createElement('div');d.className='dropdown-location';d.textContent=c;d.onclick=()=>{loc.value=c;res.innerHTML='';};res.append(d);}});`,
    check:fields=>{
      assert.deepEqual(fields.map(f=>[f.label,f.type,f.required]),[['Full name','text',true],['Current location','combobox',false],['Will you need sponsorship?','radio',false]]);
      assert.deepEqual(fields[2].options,['Yes','No']);
    },
    answers:['Jane Doe','Austin, TX','No'],
    after:`({name:document.querySelector('[name=name]').value,loc:document.querySelector('[name=location]').value,no:document.querySelectorAll('input[type=radio]')[1].checked})`,
    expect:{name:'Jane Doe',loc:'Austin, TX, USA',no:true}},
  {name:'Workable: aria-labelledby questions and div[role=radio] groups',host:'apply.workable.com',
    html:`<form data-ui="application-form">
      <span id="q1_label">First name</span><input aria-labelledby="q1_label" name="firstname" aria-required="true">
      <fieldset role="radiogroup" aria-labelledby="q2_label"><span id="q2_label">Do you have a driving licence? (optional)</span>
        <div role="radio" data-ui="option" aria-checked="false">Yes</div><div role="radio" data-ui="option" aria-checked="false">No</div></fieldset>
    </form>`,
    setup:`document.querySelectorAll('[role=radio]').forEach(r=>r.addEventListener('click',()=>document.querySelectorAll('[role=radio]').forEach(o=>o.setAttribute('aria-checked',String(o===r)))));`,
    check:fields=>{
      assert.deepEqual(fields.map(f=>[f.label,f.type,f.required]),[['First name','text',true],['Do you have a driving licence?','radio',false]]);
      assert.deepEqual(fields[1].options,['Yes','No']);
    },
    answers:['Jane','Yes'],
    after:`({name:document.querySelector('[name=firstname]').value,yes:document.querySelector('[role=radio]').getAttribute('aria-checked')})`,
    expect:{name:'Jane',yes:'true'}},
  {name:'Workday: formField blocks, listbox dropdown read on scan, radios',host:'acme.wd5.myworkdayjobs.com',
    html:`<div data-automation-id="applyFlowPage">
      <div data-automation-id="formField-legalName"><label for="fn">First Name*</label><input id="fn"></div>
      <div data-automation-id="formField-source"><label>How Did You Hear About Us?*</label><button id="dd" aria-haspopup="listbox">Select One</button></div>
      <div data-automation-id="formField-veteran"><fieldset><legend>Are you a veteran?</legend><input type="radio" id="v1" name="v"><label for="v1">Yes</label><input type="radio" id="v2" name="v"><label for="v2">No</label></fieldset></div>
      <button data-automation-id="pageFooterNextButton">Save and Continue</button>
    </div>`,
    setup:`const dd=document.querySelector('#dd');dd.onclick=()=>{let l=document.querySelector('#ddl');if(!l){l=document.createElement('ul');l.id='ddl';l.setAttribute('role','listbox');for(const c of ['Select One','LinkedIn','Indeed']){const o=document.createElement('li');o.setAttribute('role','option');o.textContent=c;o.onclick=()=>{dd.textContent=c;l.remove();};l.append(o);}document.body.append(l);}};
      document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelector('#ddl')?.remove();});`,
    check:fields=>{
      assert.deepEqual(fields.map(f=>[f.label,f.type,f.required]),[['First Name','text',true],['How Did You Hear About Us?','combobox',true],['Are you a veteran?','radio',false]]);
      assert.deepEqual(fields[1].options,['LinkedIn','Indeed']);assert.equal(fields[1].answerFormat,'single');
    },
    answers:['Jane','LinkedIn','No'],
    after:`({name:document.querySelector('#fn').value,source:document.querySelector('#dd').textContent,no:document.querySelector('#v2').checked})`,
    expect:{name:'Jane',source:'LinkedIn',no:true}},
  {name:'Greenhouse: #application-form root and react-select style combobox',host:'job-boards.greenhouse.io',
    html:`<header><input aria-label="Search" name="q" type="search"></header><form id="application-form">
      <label for="first_name">First Name*</label><input id="first_name" name="first_name" aria-required="true">
      <label for="country">Country</label><div class="select__control"><input id="country" role="combobox" aria-autocomplete="list" aria-controls="country-list"><div class="select__single-value"></div></div><div id="country-list" role="listbox" hidden></div>
    </form>`,
    setup:`const input=document.querySelector('#country'),list=document.querySelector('#country-list'),single=document.querySelector('.select__single-value');
      const render=()=>{list.innerHTML='';const q=input.value.toLowerCase();for(const c of ['United States','Canada'].filter(c=>c.toLowerCase().includes(q))){const o=document.createElement('div');o.setAttribute('role','option');o.textContent=c;o.onclick=()=>{single.textContent=c;input.value='';list.hidden=true;};list.append(o);}list.hidden=false;};
      input.addEventListener('mousedown',render);input.addEventListener('input',render);input.addEventListener('keydown',e=>{if(e.key==='Escape')list.hidden=true;});`,
    check:fields=>{
      assert.deepEqual(fields.map(f=>[f.label,f.type,f.required]),[['First Name','text',true],['Country','combobox',false]]);
      assert.deepEqual(fields[1].options,['United States','Canada']);
    },
    answers:['Jane','Canada'],
    after:`({name:document.querySelector('#first_name').value,country:document.querySelector('.select__single-value').textContent})`,
    expect:{name:'Jane',country:'Canada'}},
  {name:'BambooHR: fabric select menus, Country first',host:'acme.bamboohr.com',
    html:`<form id="job-application-form">
      <label for="fn">First Name*</label><input id="fn" type="text">
      <div data-fabric-component="SelectField InputWrapper"><label>State</label><button type="button" data-menu-id="m-state" aria-label="State –Select–">–Select–</button></div>
      <div data-fabric-component="SelectField InputWrapper"><label>Country*</label><button type="button" data-menu-id="m-country" aria-label="Country –Select–">–Select–</button></div>
    </form>`,
    setup:`const menu=(button,items)=>{button.onclick=()=>{let m=document.getElementById(button.dataset.menuId);if(!m){m=document.createElement('div');m.id=button.dataset.menuId;m.setAttribute('role','menu');for(const c of items){const i=document.createElement('div');i.setAttribute('role','menuitem');i.textContent=c;i.onclick=()=>{button.textContent=c;button.setAttribute('aria-label',button.previousElementSibling.textContent.replace('*','')+' '+c);m.remove();};m.append(i);}document.body.append(m);}};};
      const [state,country]=document.querySelectorAll('[data-menu-id]');menu(state,['California','Texas']);menu(country,['Canada','United States']);
      document.addEventListener('keydown',e=>{if(e.key==='Escape')document.querySelectorAll('[role=menu]').forEach(m=>m.remove());});`,
    check:fields=>{
      assert.deepEqual(fields.map(f=>[f.label,f.type]),[['First Name','text'],['Country','combobox'],['State','combobox']]);
      assert.deepEqual(fields[1].options,['Canada','United States']);assert.equal(fields[1].required,true);
    },
    answers:['Jane','United States','TX'],
    after:`({name:document.querySelector('#fn').value,country:document.querySelector('[data-menu-id=m-country]').textContent,state:document.querySelector('[data-menu-id=m-state]').textContent})`,
    expect:{name:'Jane',country:'United States',state:'Texas'}},
];

const navigation=[
  {name:'generic: Next is clicked on a multi-step page',host:'careers.example.test',html:`<form><label>Email<input name="e"></label><button type="button" id="next">Continue</button></form>`,
    setup:`window.nexted=false;document.querySelector('#next').onclick=()=>{window.nexted=true;};`,expectClicked:true},
  {name:'single-page adapter (Ashby): Next is never looked for',host:'jobs.ashbyhq.com',html:`<form class="ashby-application-form-container"><button type="button" id="next">Continue</button><button class="ashby-application-form-submit-button">Submit Application</button></form>`,
    setup:`window.nexted=false;document.querySelector('#next').onclick=()=>{window.nexted=true;};`,expectClicked:false},
];

app.whenReady().then(async()=>{
  let failed=0;
  const win=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{sandbox:true,contextIsolation:true}});
  await session.defaultSession.protocol.handle('https',()=>new Response('<!doctype html><html><body></body></html>',{headers:{'Content-Type':'text/html'}}));
  const prepare=async item=>{
    await win.loadURL(`https://${item.host}/apply`);
    await win.webContents.executeJavaScript(`document.body.innerHTML=${JSON.stringify(item.html)};${item.setup || ''};0`);
    await win.webContents.executeJavaScript(tools);
  };
  for(const item of cases) {
    try {
      await prepare(item);
      const scan=await win.webContents.executeJavaScript('ResumeApplyPage.scan()');
      assert.equal(scan.adapter,item.host==='careers.example.test'?'generic':scan.adapter);
      item.check(scan.fields);
      const items=scan.fields.map((field,index)=>({id:field.id,scanId:scan.scanId,answer:item.answers[index]}));
      const results=await win.webContents.executeJavaScript(`ResumeApplyPage.fill(${JSON.stringify(items)})`);
      assert.deepEqual(results.filter(r=>r.error),[]);
      assert.deepEqual(await win.webContents.executeJavaScript(item.after),item.expect);
      console.log(`PASS: ${item.name} [${scan.adapter}]`);
    }catch(error){failed++;console.error(`FAIL: ${item.name}\n  ${String(error.message).replace(/\n/g,'\n  ')}`);}
  }
  for(const item of navigation) {
    try {
      await prepare(item);
      const moved=await win.webContents.executeJavaScript('ResumeApplyPage.clickNext()');
      await new Promise(resolve=>setTimeout(resolve,300));
      assert.equal(!!moved,item.expectClicked);
      assert.equal(await win.webContents.executeJavaScript('window.nexted'),item.expectClicked);
      console.log(`PASS: ${item.name}`);
    }catch(error){failed++;console.error(`FAIL: ${item.name}\n  ${String(error.message).replace(/\n/g,'\n  ')}`);}
  }
  app.exit(failed?1:0);
});
