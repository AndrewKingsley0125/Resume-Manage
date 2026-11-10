// Regression fixture for Oracle Candidate Experience's public grid-based select
// and cx-single-select-combo-box/free-text markup. No real account or form data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
if(!process.versions.electron) {
  const {spawnSync}=require('node:child_process');
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const result=spawnSync(require('electron'),[__filename],{env,stdio:'inherit',windowsHide:true});
  process.exit(result.status || (result.error?1:0));
}
const {app,BrowserWindow,session}=require('electron');let win;
app.whenReady().then(async()=>{
  try {
    win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true}});
    await session.defaultSession.protocol.handle('https',()=>new Response('<html><body><form id="application"></form></body></html>',{headers:{'Content-Type':'text/html'}}));
    await win.loadURL('https://oracle-controls.fixture/');
    await win.webContents.executeJavaScript(`(()=>{
      globalThis.escapeClears=0;globalThis.submitted=false;globalThis.committed={};
      const form=document.querySelector('form');form.onsubmit=event=>{event.preventDefault();submitted=true;};
      function gridSelect(id,label,choices){
        const row=document.createElement('div');row.className='input-row';row.innerHTML='<label for="'+id+'">'+label+'</label><input id="'+id+'" name="'+id+'" class="cx-select-input" role="combobox" aria-autocomplete="list" aria-haspopup="grid" aria-expanded="false" aria-controls="'+id+'-listbox">';form.append(row);
        const input=row.querySelector('input');input.onclick=()=>{let list=document.getElementById(id+'-listbox');if(!list){list=document.createElement('div');list.id=id+'-listbox';list.className='cx-select__list';list.setAttribute('role','status');list.setAttribute('aria-busy','true');row.append(list);setTimeout(()=>{list.setAttribute('role','grid');list.setAttribute('aria-busy','false');for(const choice of choices){const gridRow=document.createElement('div');gridRow.setAttribute('role','row');const cell=document.createElement('div');cell.className='cx-select__list-item';cell.setAttribute('role','gridcell');cell.setAttribute('aria-selected','false');cell.innerHTML='<div class="cx-select__list-item-container"><span class="cx-select__list-item--content"></span></div>';cell.querySelector('span').textContent=choice;cell.onclick=()=>{input.value=choice;cell.setAttribute('aria-selected','true');input.setAttribute('aria-expanded','false');list.hidden=true;committed[id]=choice;};gridRow.append(cell);list.append(gridRow);}},50);}list.hidden=false;input.setAttribute('aria-expanded','true');};
        input.onkeydown=event=>{if(event.key!=='Escape')return;const list=document.getElementById(id+'-listbox');if(input.getAttribute('aria-expanded')==='true'){input.setAttribute('aria-expanded','false');if(list)list.hidden=true;}else if(input.value){escapeClears++;input.value='';committed[id]='';}};
        input.oninput=input.onclick;
      }
      gridSelect('country','Country',['United States of America','Canada']);
      gridSelect('gender','Gender',['Male','Female','Prefer not to disclose']);
      gridSelect('veteran','Veteran Status',['I am not a protected veteran','I identify as a protected veteran']);
      gridSelect('dial','Country code',['United States (+1)','United Kingdom (+44)']);
      function freeText(id,label,auto){const row=document.createElement('div');row.className=auto?'input-row':'cx-single-select-combo-box';row.innerHTML='<label for="'+id+'">'+label+'</label><input id="'+id+'" name="'+id+'" class="cx-select-input '+(auto?'cx-select-input--auto-suggest':'')+'" role="combobox" aria-autocomplete="list" aria-haspopup="grid" aria-expanded="false">';form.append(row);const input=row.querySelector('input');input.onblur=()=>{committed[id]=input.value;};return input;}
      const postal=freeText('postalCode','ZIP Code',false);postal.maxLength=10;postal.placeholder='ZIP code';postal.setAttribute('autocomplete','postal-code');
      freeText('city','City',false);freeText('addressLine1','Address Line 1',true);
      const phone=document.createElement('input');phone.id='phone';phone.type='tel';phone.setAttribute('aria-label','Phone Number');phone.placeholder='1234567890';phone.maxLength=10;phone.pattern='[0-9]{10}';form.append(phone);
    })()`);
    await win.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname,'../chrome-extension/page-tools.js'),'utf8'));
    const initial=await win.webContents.executeJavaScript('ResumeApplyPage.scan()');
    for(const label of ['Country','Gender','Veteran Status'])assert.deepEqual(initial.fields.find(field=>field.label===label).options,[]);
    const scan=await win.webContents.executeJavaScript('ResumeApplyPage.discoverOptions()');
    const field=label=>{const found=scan.fields.find(item=>item.label===label);assert.ok(found,label);return found;};
    for(const label of ['Country','Gender','Veteran Status']) {
      assert.deepEqual(field(label).options,[]);assert.equal(field(label).optionsStatus,'not-applicable');
      assert.equal(field(label).answerFormat,'text');assert.equal(field(label).fillMode,'text');
    }
    assert.equal(await win.webContents.executeJavaScript('document.querySelectorAll(".cx-select__list").length'),0);
    for(const label of ['ZIP Code','City','Address Line 1']){assert.equal(field(label).answerFormat,'text');assert.equal(field(label).allowFreeText,true);}
    assert.deepEqual(scan.fields.map(field=>field.id),initial.fields.map(field=>field.id));
    console.log('PASS: grid inputs use text answers and option discovery leaves all grid menus unopened.');
    const {answersPrompt}=await import(pathToFileURL(path.join(__dirname,'../chrome-extension/core.mjs')).href);
    const prompt=answersPrompt({profile:{phone:'+1 (555) 123-4567',applicationDetails:{country:'United States',city:'Test City',postalCode:'12345',gender:'Man'}}},scan.fields);
    const payload=JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n')+2));
    assert.equal(payload.formContext.separatePhoneCountryCode,true);
    assert.deepEqual(payload.questions.find(question=>question.label==='Gender').options,undefined);
    assert.equal(payload.questions.find(question=>question.label==='Gender').answerFormat,'text');
    assert.equal(payload.questions.find(question=>question.label==='ZIP Code').optionsStatus,undefined);
    assert.equal(payload.questions.find(question=>question.label==='ZIP Code').allowsCustomValue,true);
    assert.equal(payload.questions.find(question=>question.label==='Phone Number').inputHints.maxLength,10);
    assert.equal(payload.questions.find(question=>question.label==='Phone Number').inputHints.pattern,'[0-9]{10}');
    console.log('PASS: GPT receives grid questions as text fields with formatting constraints and no full choice lists.');
    const fill=async(label,answer)=>(await win.webContents.executeJavaScript('ResumeApplyPage.fill('+JSON.stringify([{id:field(label).id,scanId:scan.scanId,answer}])+')'))[0];
    for(const [label,answer] of [['Country','United States of America'],['Gender','Male'],['Veteran Status','I am not a protected veteran']])assert.equal((await fill(label,answer)).filled,true,label);
    assert.equal(await win.webContents.executeJavaScript('escapeClears'),0);
    assert.equal(await win.webContents.executeJavaScript('committed.country'),'United States of America');
    console.log('PASS: typed grid answers commit matching suggestions and remain selected without scanning or scrolling choices.');
    for(const [label,answer] of [['ZIP Code','12345'],['City','Test City'],['Address Line 1','12 Test Street']])assert.equal((await fill(label,answer)).filled,true,label);
    assert.equal(await win.webContents.executeJavaScript('committed.postalCode'),'12345');
    assert.equal(await win.webContents.executeJavaScript('committed.city'),'Test City');
    assert.equal(await win.webContents.executeJavaScript('submitted'),false);
    console.log('PASS: text values commit on blur without invented dropdown choices or application submission.');
  }finally{win?.destroy();}
}).then(()=>app.quit(),error=>{console.error(error);app.exit(1);});
