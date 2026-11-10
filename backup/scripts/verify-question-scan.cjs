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
const tools=fs.readFileSync(path.join(__dirname,'../chrome-extension-legacy-0.4.1/page-tools.js'),'utf8');

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

  {name:'custom-styled radios with display:none inputs are found',pending:'hidden choice inputs',
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
  {name:'non-native controls are scanned',pending:'additional control types',
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
function scan(win,{html,setup='',discover=false}) {
  return win.webContents.executeJavaScript(`(async()=>{
    document.body.innerHTML=${JSON.stringify(html)};
    const host=document.getElementById('host');
    if(host)host.attachShadow({mode:'open'}).innerHTML='<label>Inside shadow<input name="s"></label>';
    ${setup}
    const fields=(await ResumeApplyPage.scan()).fields;
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
