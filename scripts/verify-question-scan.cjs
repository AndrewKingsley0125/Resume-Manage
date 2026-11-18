// Runs the real question scanner against common form layouts in an invisible
// Electron window. Cases marked `pending` document gaps that are not fixed yet:
// they never fail the run, and they report when a fix makes them pass.
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
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'resume-question-scan-')));
const tools=fs.readFileSync(path.join(__dirname,'../chrome-extension/page-tools.js'),'utf8');

const radios=name=>`<label><input type="radio" name="${name}" value="y">Yes</label><label><input type="radio" name="${name}" value="n">No</label>`;
const labels=fields=>fields.map(field=>field.label);
const shadow=`<form><x-field id="host"></x-field></form>`;

const cases=[
  {name:'radios under a plain question take the question text',
    html:`<form><div><p>Are you legally authorized to work here?</p>${radios('auth')}</div></form>`,
    check:fields=>assert.deepEqual(labels(fields),['Are you legally authorized to work here?'])},
  {name:'a consent question without a fieldset stays manual',
    html:`<form><div><p>Do you consent to a background check?</p>${radios('consent')}</div></form>`,
    check:fields=>assert.equal(fields[0].manualOnly,true)},
  {name:'questions sharing a section fieldset keep their own text',
    html:`<form><fieldset><legend>Voluntary Self-Identification</legend><div><p>Veteran?</p>${radios('v')}</div><div><p>Disability?</p>${radios('d')}</div></fieldset></form>`,
    check:fields=>assert.deepEqual(labels(fields),['Veteran?','Disability?'])},
  {name:'a fieldset owned by one question uses its legend',
    html:`<form><fieldset><legend>Need sponsorship?</legend>${radios('s')}</fieldset></form>`,
    check:fields=>assert.deepEqual(labels(fields),['Need sponsorship?'])},
  {name:'a question label inside the group is not mistaken for an option',
    html:`<form><div class="application-question"><label class="application-label">Willing to relocate?</label>${radios('r')}</div></form>`,
    check:fields=>assert.deepEqual(labels(fields),['Willing to relocate?'])},
  {name:'an application outside any form is not hidden by a newsletter form',
    html:`<form><label>Newsletter email<input name="n"></label></form><div><label>First name<input name="fn"></label><label>Why us?<textarea name="w"></textarea></label></div>`,
    check:fields=>assert.deepEqual(labels(fields),['First name','Why us?'])},
  {name:'a search form beside the application form is ignored',
    html:`<form><label>Search jobs<input name="q"></label></form><form><label>Email<input name="e"></label><label>Phone<input name="p"></label></form>`,
    check:fields=>assert.deepEqual(labels(fields),['Email','Phone'])},
  {name:'controls in the site header are ignored',
    html:`<header><input aria-label="Find jobs" name="find"></header><form><label>Email<input name="e"></label></form>`,
    check:fields=>assert.deepEqual(labels(fields),['Email'])},
  {name:'the largest form wins when it holds most questions',
    html:`<form><label>Promo code<input name="promo"></label></form><form><label>Email<input name="e"></label><label>Phone<input name="p"></label><label>City<input name="c"></label></form>`,
    check:fields=>assert.deepEqual(labels(fields),['Email','Phone','City'])},
  {name:'site-specific roots split across containers are all scanned',
    host:'acme.recruiterflow.com',
    html:`<div class="basic-info-inputs-container"><label>Email<input name="e"></label><label>Phone<input name="p"></label></div><div class="additional-info-inputs-container"><label>City<input name="c"></label></div>`,
    check:fields=>assert.deepEqual(labels(fields),['Email','Phone','City'])},
  {name:'a label in a sibling element names the field',
    html:`<form><div><div>Years of Python experience</div><input name="q_8842"></div></form>`,
    check:fields=>assert.deepEqual(labels(fields),['Years of Python experience'])},
  {name:'sibling text does not cross into the previous question',
    html:`<form><div>Portfolio URL</div><input name="url"><input name="q_2" placeholder="Other link"></form>`,
    check:fields=>assert.deepEqual(labels(fields),['Portfolio URL','Other link'])},
  {name:'a section heading is not used as a field label',
    html:`<form><h2>Apply now</h2><input name="e" placeholder="Email"></form>`,
    check:fields=>assert.deepEqual(labels(fields),['Email'])},
  {name:'a nested select does not add its options to the label',
    html:`<form><label>Country<select name="c"><option value="u">Uruguay</option><option value="c">Canada</option></select></label></form>`,
    check:fields=>{assert.deepEqual(labels(fields),['Country']);assert.deepEqual(fields[0].options,['Uruguay','Canada']);}},
  {name:'Ashby button choices keep the question and stay manual for consent',
    html:`<form><div class="ashby-application-form-field-entry"><div class="ashby-application-form-question-title">Do you consent to a background check?</div><button type="button" data-option="y">Yes</button><button type="button" data-option="n">No</button></div></form>`,
    check:fields=>{assert.deepEqual(labels(fields),['Do you consent to a background check?']);assert.equal(fields[0].manualOnly,true);}},

  {name:"Ashby's Yes / No buttons (no type attribute, hidden checkbox) are one question and are clicked without submitting",
    html:`<form id="f"><div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title" for="q1">Will you now or in the future require sponsorship?</label><div class="ashby-application-form-input-yesno"><button class="ashby-application-form-input-yesno-option" aria-pressed="false" data-option="yes">Yes</button><button class="ashby-application-form-input-yesno-option" aria-pressed="false" data-option="no">No</button><input type="checkbox" tabindex="-1" name="q1"></div></div><button class="ashby-application-form-submit-button">Submit Application</button></form>`,
    setup:`window.submits=0;document.getElementById('f').addEventListener('submit',e=>{e.preventDefault();submits++;});
      for(const button of document.querySelectorAll('[data-option]'))button.addEventListener('click',()=>{for(const other of document.querySelectorAll('[data-option]'))other.setAttribute('aria-pressed',String(other===button));document.querySelector('[name=q1]').checked=button.dataset.option==='yes';});`,
    fill:`fields=>[{...fields[0],answer:'No'}]`,
    after:`()=>({no:document.querySelector('[data-option=no]').getAttribute('aria-pressed'),yes:document.querySelector('[data-option=yes]').getAttribute('aria-pressed'),submits})`,
    check:({fields,filled,after})=>{
      assert.deepEqual(fields.map(field=>[field.label,field.type,field.options]),[['Will you now or in the future require sponsorship?','radio',['Yes','No']]]);
      assert.ok(!filled[0]?.error,JSON.stringify(filled));
      assert.deepEqual(after,{no:'true',yes:'false',submits:0});
    }},
  {name:'Gem: radios without a name are one question, labelled by the text above their box',
    html:`<form><div><div><span>Will you require sponsorship?<span> *</span></span></div><div><div><div><div><div><input id="r1" type="radio"><label for="r1"><span></span><div>Yes</div></label></div><div><input id="r2" type="radio"><label for="r2"><span></span><div>No</div></label></div></div></div></div></div></div>
      <div><div><span>Willing to work onsite?</span></div><div><div><div><div><div><input id="r3" type="radio"><label for="r3"><div>Yes</div></label></div><div><input id="r4" type="radio"><label for="r4"><div>No</div></label></div></div></div></div></div></div></form>`,
    check:fields=>assert.deepEqual(fields.map(field=>[field.type,field.label,field.options,field.required]),[['radio','Will you require sponsorship?',['Yes','No'],true],['radio','Willing to work onsite?',['Yes','No'],false]])},
  {name:"Gem: a 'Please select' button is a dropdown whose menu items are its choices, and it fills",
    html:`<form><div><div>Gender</div><button type="button" id="g"><div>Please select<i></i></div></button></div></form>`,
    setup:`document.getElementById('g').addEventListener('click',()=>{const portal=document.createElement('div');portal.innerHTML='<menu><li role="menuitem">Male</li><li role="menuitem">Female</li><li role="menuitem">Decline to self-identify</li></menu>';document.body.append(portal);
      for(const item of portal.querySelectorAll('li'))item.addEventListener('click',()=>{document.querySelector('#g div').firstChild.textContent=item.textContent;portal.remove();});});`,
    fill:`fields=>[{...fields[0],answer:'Female'}]`,
    after:`()=>({shown:document.getElementById('g').innerText.trim(),values:ResumeApplyPage.values().values.map(item=>item.value)})`,
    check:({fields,filled,after})=>{
      assert.deepEqual(fields.map(field=>[field.type,field.controlKind,field.label,field.answered]),[['combobox','button-menu','Gender',false]]);
      assert.ok(!filled[0]?.error,JSON.stringify(filled));
      assert.deepEqual(after,{shown:'Female',values:['Female']});
    }},
  {name:'Breezy: the heading right above a field is its question; a section title is not',
    html:`<form><div><h2>Personal Details</h2><h3><span>Full Name</span><span>*</span></h3><input name="cName" type="text"></div><ul><li><div><h3><span>Will you require an H-1B visa sponsorship?</span></h3><ul><li><label><input type="radio" value="No" name="q2"><span>No</span></label></li><li><label><input type="radio" value="Yes" name="q2"><span>Yes</span></label></li></ul></div></li>
      <li><div><h3><span>Please drop your LinkedIn URL</span></h3><textarea name="section_1_question_0"></textarea></div></li></ul></form>`,
    check:fields=>assert.deepEqual(labels(fields),['Full Name','Will you require an H-1B visa sponsorship?','Please drop your LinkedIn URL'])},
  {name:"Rippling: a drop zone takes the field's linked name, so the résumé box is the resume upload",
    html:`<form><div data-testid="field"><div><span id="l8">Résumé</span><span>*</span></div><div><div id="t10" hidden>Total 0 file selected</div><label data-testid="resume" aria-labelledby="t10 l8"><input accept=".doc,.docx,.pdf" data-testid="input-resume" type="file"><button type="button"><span>Drop or select (.doc / .docx / .pdf)</span></button></label></div></div>
      <div data-testid="field"><div><span id="l9">Cover letter</span></div><div><label data-testid="cover_letter" aria-labelledby="l9"><input type="file"><button type="button"><span>Drop or select (.doc / .docx / .pdf)</span></button></label></div></div><label>First name<input name="f"></label></form>`,
    check:fields=>assert.deepEqual(fields.filter(field=>field.type==='file').map(field=>[field.label,!!field.resumeUpload,field.manualOnly]),[['Résumé',true,false],['Cover letter',false,true]])},
  {name:'a question with consent fine print after its question mark is still answered',
    html:`<form><fieldset><legend>Are you, or your close relative, currently employed by Deloitte? By answering Yes, I consent to receive text messages about my job application.</legend>${radios('d')}</fieldset>
      <fieldset><legend>Do you consent to complete identity verification?</legend>${radios('c')}</fieldset><label><input type="checkbox" name="smsConsent">Send me texts</label></form>`,
    check:fields=>assert.deepEqual(fields.map(field=>field.manualOnly),[false,true,true])},
  {name:'a posting with no form opens its application from the Apply button, never from a search form',
    html:`<form role="search"><input name="q"><button>Apply</button></form><main><h1>Engineer</h1><button type="button" data-testid="Apply now" id="apply">Apply now</button></main>`,
    setup:`window.opened=0;document.getElementById('apply').addEventListener('click',()=>{opened++;});`,
    fill:`()=>[]`,
    after:`()=>{const result=ResumeApplyPage.openApplication();return new Promise(resolve=>setTimeout(()=>resolve({result,opened}),150));}`,
    check:({after})=>assert.deepEqual(after,{result:{clicked:'Apply now',url:''},opened:1})},

  {name:"Workday: a 'Select One' button beside its hidden validation box is a dropdown, and it fills",
    html:`<form><div data-automation-id="formField-sponsorship"><label for="input-7">Will you now or in the future require sponsorship?<abbr>*</abbr></label><div><button type="button" id="input-7" aria-haspopup="listbox" aria-controls="list-7" name="sponsorship" value="">Select One</button><input type="text" aria-hidden="true" tabindex="-1" value=""></div></div>
      <div data-automation-id="formField-first"><label for="first">First Name</label><input id="first" type="text"></div></form>`,
    setup:`document.getElementById('input-7').addEventListener('click',()=>{if(document.getElementById('list-7'))return;const list=document.createElement('ul');list.id='list-7';list.setAttribute('role','listbox');list.innerHTML='<li id="o1"><div>Yes</div></li><li id="o2"><div>No</div></li>';document.body.append(list);
      for(const li of list.querySelectorAll('li'))li.addEventListener('click',()=>{document.getElementById('input-7').textContent=li.textContent;list.remove();});});`,
    fill:`fields=>[{...fields.find(field=>field.controlKind==='button-menu'),answer:'No'}]`,
    after:`()=>({shown:document.getElementById('input-7').textContent})`,
    check:({fields,filled,after})=>{
      assert.deepEqual(fields.map(field=>[field.type,field.controlKind || '',field.label]),[['combobox','button-menu','Will you now or in the future require sponsorship?'],['text','','First Name']]);
      assert.ok(!filled[0]?.error,JSON.stringify(filled));
      assert.equal(after.shown,'No');
    }},
  {name:'BambooHR: a menu button over a hidden empty select is the dropdown, and a "file-input" box under "Resume" is the resume upload',
    html:`<form><div class="fab-FormField"><label for="sel-g">Gender</label><div class="fab-Select"><div style="display:inline-block"><div class="fab-SelectToggle__container"><button id="btn-g" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Gender –Select–"><div class="fab-SelectToggle__placeholder">–Select–</div></button></div></div><select id="sel-g" aria-hidden="true" tabindex="-1" style="position:absolute;width:0;height:0;opacity:0;border:none"><option value=""></option></select></div></div>
      <div><p>Resume*</p><div data-fabric-component="FileUpload"><div><div><button type="button">Choose File*</button><div><p>No file selected</p></div></div><input type="file" aria-label="file-input" tabindex="-1" required></div><input name="resumeFileId" type="hidden" value=""></div></div></form>`,
    setup:`const button=document.getElementById('btn-g');button.addEventListener('click',()=>{if(document.getElementById('menu-g'))return;const list=document.createElement('div');list.id='menu-g';list.setAttribute('role','menu');
      list.innerHTML='<div role="menuitem">Decline to answer</div><div role="menuitem">Male</div><div role="menuitem">Female</div>';document.body.append(list);
      for(const item of list.children)item.addEventListener('click',()=>{button.firstElementChild.textContent=item.textContent;button.setAttribute('aria-label','Gender '+item.textContent);document.getElementById('sel-g').innerHTML='<option value="3">'+item.textContent+'</option>';list.remove();});});`,
    fill:`fields=>[{...fields.find(field=>field.controlKind==='button-menu'),answer:'Female'}]`,
    after:`()=>({shown:document.getElementById('btn-g').textContent})`,
    check:({fields,filled,after})=>{
      assert.deepEqual(fields.map(field=>[field.type,field.controlKind || '',field.label,!!field.answered,!!field.resumeUpload]),[['combobox','button-menu','Gender',false,false],['file','','Resume',false,true]]);
      assert.ok(!filled[0]?.error,JSON.stringify(filled));
      assert.equal(after.shown,'Female');
    }},
  {name:'Workday: a searchable prompt is answered by searching and picking the matching result',
    html:`<form><div data-automation-id="formField-source"><label for="src">How Did You Hear About Us?</label><div data-automation-id="multiselectInputContainer"><input id="src" type="text" placeholder="Search" data-uxi-widget-type="selectinput" data-uxi-multiselect-id="m1"></div><div id="chosen"></div></div></form>`,
    setup:`const input=document.getElementById('src');
      input.addEventListener('keydown',event=>{if(event.key!=='Enter')return;document.getElementById('results')?.remove();const box=document.createElement('div');box.id='results';
        const all=['LinkedIn','LinkedIn Learning','Indeed','Company Website'].filter(name=>name.toLowerCase().includes(input.value.toLowerCase()));
        box.innerHTML=all.map(name=>'<div data-uxi-widget-type="multiselectlistitem" data-uxi-multiselect-id="m1"><div data-automation-id="promptOption">'+name+'</div></div>').join('');document.body.append(box);
        for(const option of box.querySelectorAll('[data-automation-id="promptOption"]'))option.addEventListener('click',()=>{document.getElementById('chosen').innerHTML='<div data-automation-id="selectedItem">'+option.textContent+'</div>';input.value='';box.remove();});});`,
    fill:`fields=>[{...fields[0],answer:'LinkedIn'}]`,
    after:`()=>({chosen:document.getElementById('chosen').innerText.trim(),values:ResumeApplyPage.values().values.map(item=>item.value)})`,
    check:({fields,filled,after})=>{
      assert.deepEqual(fields.map(field=>[field.type,field.controlKind,field.label,field.answerFormat,field.fillMode,field.answered]),[['combobox','workday-prompt','How Did You Hear About Us?','text','search',false]]);
      assert.ok(!filled[0]?.error,JSON.stringify(filled));
      assert.deepEqual(after,{chosen:'LinkedIn',values:['LinkedIn']});
    }},

  {name:"Workday: a dropdown is found even when its validation box is not marked hidden",
    html:`<form><div data-automation-id="formField-country"><label for="c1">Country<abbr>*</abbr></label><div><button type="button" id="c1" aria-haspopup="listbox" name="country" value="">Select One</button><input type="text" class="css-77hcv" value=""></div></div></form>`,
    check:fields=>assert.deepEqual(fields.map(field=>[field.type,field.controlKind,field.label,field.required]),[['combobox','button-menu','Country',true]])},
  {name:'Workday: a dropdown is named by its label, not by the choice its button shows',
    html:`<form><div data-automation-id="formField-degree"><label for="d1">Degree<abbr>*</abbr></label><div><button type="button" id="d1" aria-haspopup="listbox" aria-label="Degree Bachelor of Science (B.S) Required">Bachelor of Science (B.S)</button><input type="text" value="x"></div></div>
      <div data-automation-id="formField-country"><label>Country<abbr>*</abbr></label><div><button type="button" aria-haspopup="listbox" aria-label="Country Select One Required">Select One</button></div></div></form>`,
    check:fields=>assert.deepEqual(fields.map(field=>[field.label,field.required,field.answered]),[['Degree',true,true],['Country',true,false]])},
  {name:'Workday: role="checkbox" choices and a date in parts are found under their question',
    html:`<form><div data-automation-id="formField-disability"><fieldset><legend>Please check one of the boxes below</legend><div role="checkbox" aria-checked="false" tabindex="0">Yes, I have a disability</div><div role="checkbox" aria-checked="false" tabindex="0">No, I do not have a disability</div></fieldset></div>
      <div data-automation-id="formField-dateSignedOn"><label>Date<abbr>*</abbr></label><div data-automation-id="dateInputWrapper"><input type="text" role="spinbutton" aria-label="Month"><input type="text" role="spinbutton" aria-label="Day"><input type="text" role="spinbutton" aria-label="Year"></div></div></form>`,
    setup:`for(const box of document.querySelectorAll('[role="checkbox"]'))box.addEventListener('click',()=>box.setAttribute('aria-checked',box.getAttribute('aria-checked')==='true'?'false':'true'));`,
    fill:`fields=>[{...fields[0],answer:['No, I do not have a disability']}]`,
    after:`()=>[...document.querySelectorAll('[role="checkbox"]')].map(box=>box.getAttribute('aria-checked'))`,
    check:({fields,filled,after})=>{
      assert.deepEqual(fields.map(field=>[field.type,field.label]),[['checkbox','Please check one of the boxes below'],['text','Date - Month'],['text','Date - Day'],['text','Date - Year']]);
      assert.equal(fields[1].required,true);
      assert.ok(!filled[0]?.error,JSON.stringify(filled));
      assert.deepEqual(after,['false','true']);
    }},
  {name:'a contenteditable answer box is filled',
    html:`<form><div data-automation-id="formField-why"><label id="w">Why do you want this role?</label><div contenteditable="true" aria-labelledby="w"><p><br></p></div></div></form>`,
    fill:`fields=>[{...fields[0],answer:'I build AI tools.'}]`,
    after:`()=>ResumeApplyPage.values().values.map(item=>item.value)`,
    check:({fields,filled,after})=>{
      assert.deepEqual(fields.map(field=>[field.type,field.label]),[['textarea','Why do you want this role?']]);
      assert.ok(!filled[0]?.error,JSON.stringify(filled));
      assert.deepEqual(after,['I build AI tools.']);
    }},
  {name:'Greenhouse: "select all that apply" boxes with their own names are one question',
    html:`<form><fieldset><legend>How do you identify your sexual orientation? Please select all that apply.</legend><div><input type="checkbox" id="a1" name="a1"><label for="a1">Bisexual</label></div><div><input type="checkbox" id="a2" name="a2"><label for="a2">Gay</label></div><div><input type="checkbox" id="a3" name="a3"><label for="a3">I prefer not to answer</label></div></fieldset>
      <fieldset><legend>Preferences</legend><label><input type="checkbox" name="sms">Text me updates</label><label>Email<input name="email"></label></fieldset></form>`,
    check:fields=>assert.deepEqual(fields.map(field=>[field.type,field.label,field.options.length]),[['checkbox','How do you identify your sexual orientation? Please select all that apply.',3],['checkbox','Text me updates',1],['text','Email',0]])},
  {name:'custom-styled radios with display:none inputs are found',
    html:`<form><fieldset><legend>Need sponsorship?</legend><label><input style="display:none" type="radio" name="s" value="y"><span>Yes</span></label><label><input style="display:none" type="radio" name="s" value="n"><span>No</span></label></fieldset></form>`,
    check:fields=>assert.deepEqual(labels(fields),['Need sponsorship?'])},
  {name:'off-screen honeypot inputs are excluded',
    html:`<form><label>Name<input name="fn"></label><label>Leave blank<input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px"></label></form>`,
    check:fields=>assert.deepEqual(labels(fields),['Name'])},
  {name:'an Oracle-style honeypot in a zero-height row is excluded',
    html:`<form><label>Email<input name="e"></label><div style="position:relative;height:0;overflow:hidden"><div style="position:absolute"><label for="t">Extra</label><input id="t" name="extra" aria-hidden="true" tabindex="-1"></div></div></form>`,
    check:fields=>assert.deepEqual(labels(fields),['Email'])},
  {name:'visually hidden choices and focusable fields are not treated as traps',
    html:`<form><label>Portfolio<input name="p" tabindex="-1"></label><label><input type="checkbox" name="c" style="position:absolute;opacity:0;width:0;height:0">Open to relocation</label></form>`,
    check:fields=>assert.deepEqual(labels(fields),['Portfolio','Open to relocation'])},
  {name:'a required asterisk marks the field required',
    html:`<form><label>Phone *<input name="p"></label></form>`,
    check:fields=>assert.equal(fields[0].required,true)},
  {name:'fields labelled for robots are excluded',
    html:`<form><label>Email<input name="e"></label><label>Please leave this field blank<input name="contact_me"></label></form>`,
    check:fields=>assert.deepEqual(labels(fields),['Email'])},
  {name:'boxes sharing a label are told apart by placeholder',
    html:`<form><fieldset><legend>Address</legend><div class="form-group"><label>Address</label><input name="a1" placeholder="Street"></div><div class="form-group"><label>Address</label><input name="a2" placeholder="City"></div></fieldset></form>`,
    check:fields=>assert.deepEqual(labels(fields),['Address - Street','Address - City'])},
  {name:'non-native controls are scanned',
    html:`<form><button type="button" aria-haspopup="listbox" aria-label="Notice period">Select</button><div role="checkbox" aria-checked="false" aria-label="Open to relocation" tabindex="0"></div><div role="textbox" contenteditable="true" aria-label="Cover note"></div></form>`,
    check:fields=>assert.equal(fields.length,3)},
  {name:'inputs inside shadow DOM are scanned',pending:'shadow DOM',
    html:shadow,
    check:fields=>assert.deepEqual(labels(fields),['Inside shadow'])},
  {name:'repeated blocks can be told apart',pending:'section context',
    html:`<form><section><h3>Job 1</h3><label>Company<input name="c1"></label></section><section><h3>Job 2</h3><label>Company<input name="c2"></label></section></form>`,
    check:fields=>assert.notEqual(fields[0].label+(fields[0].section || ''),fields[1].label+(fields[1].section || ''))},
  {name:'type-to-search dropdowns ask for text to search',discover:true,
    html:`<form><label for="sc">School</label><input id="sc" role="combobox" aria-controls="sl"><div id="sl" role="listbox"></div></form>`,
    check:fields=>{assert.equal(fields[0].answerFormat,'text');assert.equal(fields[0].fillMode,'search');}},
  {name:'dropdowns that open only on mouse-down have their options read',discover:true,
    html:`<form><label for="m">Country</label><input id="m" role="combobox" readonly aria-controls="ml"><div id="ml" role="listbox" hidden><div role="option">Canada</div></div></form>`,
    setup:`document.querySelector('#m').addEventListener('mousedown',()=>{document.querySelector('#ml').hidden=false;});`,
    check:fields=>assert.deepEqual(fields[0].options,['Canada'])},
  {name:'dropdowns that open only on an arrow key have their options read',discover:true,
    html:`<form><label for="k">Country</label><input id="k" role="combobox" readonly aria-controls="kl"><div id="kl" role="listbox" hidden><div role="option">Canada</div></div></form>`,
    setup:`document.querySelector('#k').addEventListener('keydown',e=>{if(e.key==='ArrowDown')document.querySelector('#kl').hidden=false;});`,
    check:fields=>assert.deepEqual(fields[0].options,['Canada'])},
  {name:'"select all that apply" dropdowns allow several answers',
    html:`<form><label for="r">Race (select all that apply):</label><input id="r" role="combobox"></form>`,
    check:fields=>assert.equal(fields[0].answerFormat,'multiple')},
  {name:'a privacy notice dropdown stays manual',
    html:`<form><label for="p">Applicant Privacy Notice</label><input id="p" role="combobox"></form>`,
    check:fields=>assert.equal(fields[0].manualOnly,true)},
];

async function load(win,host) {
  await win.loadURL(`https://${host}/`);
  await win.webContents.executeJavaScript(tools);
}
function scan(win,{html,setup='',discover=false,fill='',after=''}) {
  return win.webContents.executeJavaScript(`(async()=>{
    document.body.innerHTML=${JSON.stringify(html)};
    const host=document.getElementById('host');
    if(host)host.attachShadow({mode:'open'}).innerHTML='<label>Inside shadow<input name="s"></label>';
    ${setup}
    const fields=ResumeApplyPage.scan().fields;
    if(${!!fill}){const filled=await ResumeApplyPage.fill((${fill || 'null'})(fields));return {fields,filled,after:await (${after || 'null'})()};}
    return ${discover}?(await ResumeApplyPage.discoverOptions()).fields:fields;
  })()`);
}

app.whenReady().then(async()=>{
  let failed=0;
  try {
    const win=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{sandbox:true,contextIsolation:true}});
    await session.defaultSession.protocol.handle('https',()=>new Response('<!doctype html><html><body></body></html>',{headers:{'Content-Type':'text/html'}}));
    let host='';
    for(const item of cases) {
      const wanted=item.host || 'question-scan.fixture';
      if(wanted!==host){await load(win,wanted);host=wanted;}
      let error=null;
      try {item.check(await scan(win,item));}catch(caught){error=caught;}
      if(item.pending) console.log(error?`PENDING (${item.pending}): ${item.name}`:`NOW PASSING, remove pending: ${item.name}`);
      else if(error){failed++;console.error(`FAIL: ${item.name}\n  ${error.message.replace(/\n/g,'\n  ')}`);}
      else console.log(`PASS: ${item.name}`);
    }
  }catch(error){failed++;console.error(error);}
  app.exit(failed?1:0);
});
