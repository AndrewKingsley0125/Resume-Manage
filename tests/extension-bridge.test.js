const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createExtensionBridge} = require('../src/main/extension-bridge');
const {buildPrompt} = require('../src/main/prompt');
const {renderExtensionResume} = require('../src/main/extension-render');
const Resume = require('../src/shared/resume');
const origin = 'chrome-extension://' + 'a'.repeat(32);
const profiles = [{id:'p1',firstName:'Test',applicationMode:'extension',extensionJobLinks:['https://example.com/job'],workHistory:[{company:'Employer'}],education:[],applicationDetails:{gender:'Man',answerPrompt:'Two sentences.'},ssn:'DO NOT SHARE'},
  {id:'p2',firstName:'Other',lastName:'Person',applicationMode:'extension',extensionJobLinks:['https://example.com/job'],workHistory:[{company:'Employer'}],education:[]}];
async function service(t, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'resume-bridge-test-'));
  const bridge = createExtensionBridge({statePath:path.join(dir,'state.json'),getProfiles:() => profiles,buildPrompt,exportResume:async (profile,response) => ({resume:Resume.parse(response,profile),files:{path:'resume.pdf',docxPath:'resume.docx',jdPath:'JD.txt'}}),...extra});
  const address = await bridge.start(0);
  t.after(async () => {await bridge.stop();fs.rmSync(dir,{recursive:true,force:true});});
  const send = async (route, body, token, requestOrigin = origin) => {
    const result = await fetch(`http://127.0.0.1:${address.port}` + route,{method:body === undefined ? 'GET':'POST',headers:{Origin:requestOrigin,'Content-Type':'application/json',...(token ? {Authorization:'Bearer '+token}:{})},body:body === undefined ? undefined:JSON.stringify(body)});
    return {status:result.status,body:await result.json()};
  };
  const pair = async name => (await send('/v1/pair',{code:bridge.dashboard('p1').pairingCode,name})).body;
  return {bridge,send,pair,dir};
}
test('local bridge requires extension origin, pairing code, and bearer authentication', async t => {
  const s = await service(t);
  assert.equal((await s.send('/v1/state')).status,401);
  assert.equal((await s.send('/v1/state',undefined,undefined,'https://evil.example')).status,403);
  assert.equal((await s.send('/v1/pair',{code:'wrong'})).status,403);
  const client = await s.pair('Chrome One');
  assert.ok(client.token);
  const state = await s.send('/v1/state',undefined,client.token);
  assert.equal(state.status,200);assert.equal(state.body.client.name,'Chrome One');
  assert.equal((await s.send('/v1/state',undefined,client.token,'chrome-extension://'+'b'.repeat(32))).status,401);
  assert.equal((await s.send('/v1/state',undefined,client.token,'')).status,200);
  assert.equal((await s.send('/v1/state',undefined,undefined,'')).status,401);
  assert.equal((await s.send('/v1/pair',{code:s.bridge.dashboard('p1').pairingCode},undefined,'')).status,403);
  assert.ok(!JSON.stringify(s.bridge.dashboard()).includes(client.token));
  assert.ok(!fs.readFileSync(path.join(s.dir,'state.json'),'utf8').includes(client.token));
});
test('eight-slot limit is enforced and unlinking revokes access', async t => {
  const s = await service(t);let first;
  for(let i=0;i<8;i++) {const client = await s.pair('Client '+i);if(!first)first=client;assert.ok(client.id);}
  assert.equal((await s.send('/v1/pair',{code:s.bridge.dashboard('p1').pairingCode})).status,409);
  s.bridge.unlink(first.id);
  assert.equal((await s.send('/v1/state',undefined,first.token)).status,401);
  assert.ok((await s.pair('Replacement')).token);
});
test('job ownership, JD transfer, export, and explicit completion work together', async t => {
  const s = await service(t);
  const one = await s.pair('One'), two = await s.pair('Two');
  const job = s.bridge.assign('p1','https://example.com/job',one.id);
  assert.throws(() => s.bridge.assign('p1','https://elsewhere.example/job',one.id), /Save this job/);
  assert.throws(() => s.bridge.assign('p1','https://example.com/job',one.id), /already assigned/);
  assert.equal((await s.send('/v1/state',undefined,two.token)).body.jobs.length,0);
  assert.equal((await s.send('/v1/jobs/'+job.id,undefined,two.token)).status,404);
  const detail = await s.send('/v1/jobs/'+job.id+'/jd',{company:'Acme',title:'Engineer',description:'Build services for caf\u00e9 customers.'},one.token);
  assert.ok(detail.body.resumePrompt.includes('caf\u00e9 customers'));
  assert.ok(!detail.body.resumePrompt.includes('[PASTE THE JOB DESCRIPTION HERE]'));
  assert.ok(!JSON.stringify(detail.body.profile).includes('DO NOT SHARE'));
  const invalid = await s.send('/v1/jobs/'+job.id+'/resume',{response:'invalid'},one.token);
  assert.equal(invalid.status,400);
  const resume = Resume.seed(profiles[0]);resume.company='Acme';resume.summary='Valid summary.';
  const exported = await s.send('/v1/jobs/'+job.id+'/resume',{response:'```json\n'+JSON.stringify(resume)+'\n```'},one.token);
  assert.equal(exported.status,200);assert.equal(exported.body.files.docx,'resume.docx');  assert.equal((await s.send('/v1/jobs/'+job.id+'/resume',{response:JSON.stringify(resume)},one.token)).status,409);
  assert.equal((await s.send('/v1/jobs/'+job.id+'/complete',{},one.token)).status,400);
  assert.equal((await s.send('/v1/jobs/'+job.id+'/complete',{confirmed:true},one.token)).body.status,'completed');
});
test('extension exports render the same template system without a renderer window', () => {
  const profile = {...profiles[0],templateId:'classic'};
  const data = Resume.seed(profile);data.summary='Safe <script> text';
  const html = renderExtensionResume(profile,data);
  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('Employer'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('assignment notifications wake a waiting extension and stay scoped to its connection', async t => {
  const s=await service(t), one=await s.pair('One'), two=await s.pair('Two');
  const waiting=s.send('/v1/events?after=',undefined,one.token);
  const job=s.bridge.assign('p1','https://example.com/job',one.id);
  const event=await waiting;assert.equal(event.status,200);assert.equal(event.body.jobs[0].id,job.id);assert.equal(event.body.cursor,job.id);
  assert.equal((await s.send('/v1/state',undefined,two.token)).body.jobs.length,0);
});

test('DOCX retrieval serves only the assigned job generated file to its linked extension',async t=>{
  let docxPath;
  const s=await service(t,{exportResume:async(profile,response)=>({resume:Resume.parse(response,profile),files:{path:'resume.pdf',docxPath,folder:path.dirname(docxPath)}})});
  const owner=await s.pair('Owner'),other=await s.pair('Other');
  const job=s.bridge.assign('p1','https://example.com/job',owner.id);
  assert.equal((await s.send('/v1/jobs/'+job.id+'/docx',undefined,owner.token)).status,409);
  docxPath=path.join(s.dir,'resume.docx');
  const resume=Resume.seed(profiles[0]);resume.company='Acme';
  const content=require('../src/main/docx').buildDocx(profiles[0],resume,{});fs.writeFileSync(docxPath,content);
  await s.send('/v1/jobs/'+job.id+'/jd',{company:'Acme',description:'Build services'},owner.token);
  await s.send('/v1/jobs/'+job.id+'/resume',{response:JSON.stringify(resume)},owner.token);
  assert.equal((await s.send('/v1/jobs/'+job.id+'/docx',undefined,other.token)).status,404);
  const result=await s.send('/v1/jobs/'+job.id+'/docx',undefined,owner.token);
  assert.equal(result.status,200);assert.equal(result.body.name,'resume.docx');assert.deepEqual(Buffer.from(result.body.base64,'base64'),content);
  assert.equal((await s.send('/v1/jobs/'+job.id+'/docx?path=another-file',undefined,owner.token)).status,404);
});

test('each browser runs one profile: its own pairing code links it, and other profiles cannot send to it', async t => {
  const s = await service(t);
  const pairWith = async (name, profileId) => (await s.send('/v1/pair',{code:s.bridge.dashboard(profileId).pairingCode,name})).body;
  // There is no app-wide code: only a profile's own code links a browser.
  assert.equal(s.bridge.dashboard().pairingCode,'');
  assert.equal((await s.send('/v1/pair',{code:'',name:'No profile'})).status,403);
  assert.notEqual(s.bridge.dashboard('p1').pairingCode, s.bridge.dashboard('p2').pairingCode);
  const tony = await pairWith('Tony Chrome','p1'), other = await pairWith('Other Chrome','p2');
  const byId = id => s.bridge.dashboard().connections.find(c => c.id === id);
  assert.equal(byId(tony.id).profileId,'p1');assert.equal(byId(other.id).profileId,'p2');
  // The extension is told which profile it runs.
  assert.equal((await s.send('/v1/state',undefined,tony.token)).body.client.profileName,'Test');
  // A profile cannot send to another profile's browser.
  assert.throws(() => s.bridge.assign('p2','https://example.com/job',tony.id), /runs Test's jobs/);
  s.bridge.assign('p1','https://example.com/job',tony.id);
  assert.equal((await s.send('/v1/state',undefined,other.token)).body.jobs.length,0);
  // A new code for one profile does not change the other's, and the old code stops working.
  const before = s.bridge.dashboard('p1').pairingCode, otherCode = s.bridge.dashboard('p2').pairingCode;
  s.bridge.rotateCode('p1');
  assert.notEqual(s.bridge.dashboard('p1').pairingCode, before);
  assert.equal(s.bridge.dashboard('p2').pairingCode, otherCode);
  assert.equal((await s.send('/v1/pair',{code:before,name:'Late'})).status,403);
});
test('browsers linked before profiles had their own codes take the profile of their last job, or are removed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'resume-bridge-legacy-'));
  try {
    const statePath = path.join(dir,'state.json');
    fs.writeFileSync(statePath, JSON.stringify({connections:[{id:'used',name:'Used Chrome',tokenHash:'x'},{id:'idle',name:'Idle Chrome',tokenHash:'y'}],
      jobs:[{id:'j1',profileId:'p1',connectionId:'used',url:'https://example.com/a',status:'completed',createdAt:1},{id:'j2',profileId:'p2',connectionId:'used',url:'https://example.com/b',status:'completed',createdAt:2}]}));
    const bridge = createExtensionBridge({statePath,getProfiles:() => profiles,buildPrompt,exportResume:async () => ({})});
    const connections = bridge.dashboard('p1').connections;
    assert.deepEqual(connections.map(c => [c.id,c.profileId]),[['used','p2']]);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('a job reports what it is doing now, and the app keeps it for its status view', async t => {
  const s = await service(t), one = await s.pair('One');
  const job = s.bridge.assign('p1','https://example.com/job',one.id);
  const sent = await s.send('/v1/jobs/'+job.id+'/progress',{text:'Needs you: solve the CAPTCHA on the job page',level:'attention'},one.token);
  assert.equal(sent.status,200);
  const kept = s.bridge.dashboard('p1').jobs.find(j => j.id === job.id).progress;
  assert.equal(kept.text,'Needs you: solve the CAPTCHA on the job page');assert.equal(kept.level,'attention');assert.ok(kept.at);
  // An unknown level is stored as idle; another browser cannot report for this job.
  await s.send('/v1/jobs/'+job.id+'/progress',{text:'Working',level:'panic'},one.token);
  assert.equal(s.bridge.dashboard('p1').jobs.find(j => j.id === job.id).progress.level,'idle');
  const other = await s.pair('Other');
  assert.equal((await s.send('/v1/jobs/'+job.id+'/progress',{text:'x'},other.token)).status,404);
});

test('a company entered when exporting is saved on a job that has none', async t => {
  const s = await service(t), one = await s.pair('One');
  const job = s.bridge.assign('p1','https://example.com/job',one.id);
  await s.send('/v1/jobs/'+job.id+'/jd',{company:'',title:'Engineer',description:'Build services.'},one.token);
  const resume = {...Resume.seed(profiles[0]),company:'',summary:'Valid summary.'};
  const typed = await s.send('/v1/jobs/'+job.id+'/resume',{response:JSON.stringify(resume),company:'Typed Co'},one.token);
  assert.equal(typed.status,200,JSON.stringify(typed.body));assert.equal(typed.body.company,'Typed Co');
});

test('the app sends a job step to its browser, which runs it and reports back', async t => {
  const s = await service(t), one = await s.pair('One'), other = await s.pair('Other');
  const job = s.bridge.assign('p1','https://example.com/job',one.id);
  const before = (await s.send('/v1/state',undefined,one.token)).body.cursor;
  // A waiting browser wakes up for the command.
  const waiting = s.send('/v1/events?after='+encodeURIComponent(before),undefined,one.token);
  s.bridge.command('p1',job.id,'auto');
  const woke = await waiting;
  assert.notEqual(woke.body.cursor,before);
  const queued = woke.body.jobs[0].commands;
  assert.equal(queued.length,1);assert.equal(queued[0].action,'auto');
  // The same step cannot be queued twice; unknown steps and other profiles are refused.
  assert.throws(() => s.bridge.command('p1',job.id,'auto'), /already waiting/);
  assert.throws(() => s.bridge.command('p1',job.id,'submit'), /Unknown command/);
  assert.throws(() => s.bridge.command('p2',job.id,'auto'), /not found/);
  // Confirming a resume can carry the JSON as you edited it in the review; other steps carry nothing.
  s.bridge.command('p1',job.id,'confirmResume',{response:' {"summary":"Edited"} '});
  s.bridge.command('p1',job.id,'scan',{response:'ignored'});
  const withEdit = (await s.send('/v1/state',undefined,one.token)).body.jobs[0].commands;
  assert.equal(withEdit.find(c => c.action === 'confirmResume').response,'{"summary":"Edited"}');
  assert.ok(!('response' in withEdit.find(c => c.action === 'scan')));
  for (const c of withEdit.filter(c => c.action !== 'auto')) await s.send('/v1/jobs/'+job.id+'/command-result',{commandId:c.id,ok:true,message:'Done.'},one.token);
  // Only the job's own browser can report the result.
  assert.equal((await s.send('/v1/jobs/'+job.id+'/command-result',{commandId:queued[0].id,ok:true,message:'Done.'},other.token)).status,404);
  assert.equal((await s.send('/v1/jobs/'+job.id+'/command-result',{commandId:queued[0].id,ok:true,message:'Auto-fill finished.'},one.token)).status,200);
  const after = s.bridge.dashboard('p1').jobs.find(j => j.id === job.id);
  assert.deepEqual(after.commands,[]);
  assert.equal(after.lastCommand.action,'auto');assert.equal(after.lastCommand.ok,true);assert.equal(after.lastCommand.message,'Auto-fill finished.');
  // Marking ended still accepts its own result afterwards.
  s.bridge.command('p1',job.id,'complete');
  const done = s.bridge.dashboard('p1').jobs.find(j => j.id === job.id).commands[0];
  await s.send('/v1/jobs/'+job.id+'/complete',{confirmed:true},one.token);
  assert.equal((await s.send('/v1/jobs/'+job.id+'/command-result',{commandId:done.id,ok:true,message:'Ended.'},one.token)).status,200);
  assert.throws(() => s.bridge.command('p1',job.id,'auto'), /has ended/);
});

test('showing a job window from its card leaves no result line unless it fails', async t => {
  const s = await service(t), one = await s.pair('One');
  const job = s.bridge.assign('p1','https://example.com/job',one.id);
  const run = async ok => {
    s.bridge.command('p1',job.id,'focus');
    const queued = s.bridge.dashboard('p1').jobs.find(j => j.id === job.id).commands[0];
    await s.send('/v1/jobs/'+job.id+'/command-result',{commandId:queued.id,ok,message:ok ? 'Showing this job in Chrome.' : "This job's window was closed. Click Reopen."},one.token);
    return s.bridge.dashboard('p1').jobs.find(j => j.id === job.id).lastCommand;
  };
  assert.equal(await run(true),null);
  assert.deepEqual((({action,ok,message}) => ({action,ok,message}))(await run(false)),{action:'focus',ok:false,message:"This job's window was closed. Click Reopen."});
});

test('the resume waiting for review reaches the app, and is dropped once it no longer waits', async t => {
  const s = await service(t), one = await s.pair('One');
  const job = s.bridge.assign('p1','https://example.com/job',one.id);
  const kept = () => s.bridge.dashboard('p1').jobs.find(j => j.id === job.id).pendingResume;
  await s.send('/v1/jobs/'+job.id+'/progress',{text:'Needs you: review the resume ChatGPT wrote',level:'attention',key:'confirm-resume',pendingResume:'{"title":"Engineer"}'},one.token);
  assert.equal(kept(),'{"title":"Engineer"}');
  await s.send('/v1/jobs/'+job.id+'/progress',{text:'Auto-filling page 1',level:'busy',key:'auto-filling',pendingResume:'{"ignored":true}'},one.token);
  assert.equal(kept(),'');
  // Showing details changes nothing in the job, so a success leaves no result line.
  s.bridge.command('p1',job.id,'details');
  const queued = s.bridge.dashboard('p1').jobs.find(j => j.id === job.id).commands[0];
  await s.send('/v1/jobs/'+job.id+'/command-result',{commandId:queued.id,ok:true,message:'Showing details.'},one.token);
  assert.equal(s.bridge.dashboard('p1').jobs.find(j => j.id === job.id).lastCommand,null);
});

test('each job keeps a short history of what happened, for its card in the app', async t => {
  const s = await service(t), one = await s.pair('Work Chrome');
  const job = s.bridge.assign('p1','https://example.com/job',one.id);
  await s.send('/v1/jobs/'+job.id+'/status',{status:'tabs-opened'},one.token);
  s.bridge.command('p1',job.id,'auto');
  const queued = s.bridge.dashboard('p1').jobs.find(j => j.id === job.id).commands[0];
  await s.send('/v1/jobs/'+job.id+'/progress',{text:'Needs you: solve the CAPTCHA on the job page',level:'attention',key:'waiting-on-page'},one.token);
  await s.send('/v1/jobs/'+job.id+'/progress',{text:'Needs you: solve the CAPTCHA on the job page',level:'attention',key:'waiting-on-page'},one.token);
  await s.send('/v1/jobs/'+job.id+'/command-result',{commandId:queued.id,ok:false,message:'The page could not be read.'},one.token);
  await s.send('/v1/jobs/'+job.id+'/complete',{confirmed:true,outcome:'submitted'},one.token);
  const events = s.bridge.dashboard('p1').jobs.find(j => j.id === job.id).events;
  assert.deepEqual(events.map(e => e.text),['Sent to Work Chrome','Job window opened','You started: Auto-fill','Needs you: solve the CAPTCHA on the job page','Auto-fill: The page could not be read.','Marked ended']);
  assert.deepEqual(events.map(e => e.level),['info','info','info','attention','error','info']);
  assert.ok(events.every(e => typeof e.at === 'number'));
});

test('a job whose resume failed ends as Failed with its reason; one that went through ends as Ended', async t => {
  const s = await service(t), one = await s.pair('Work Chrome');
  const failed = s.bridge.assign('p1','https://example.com/job',one.id);
  await s.send('/v1/jobs/'+failed.id+'/progress',{text:'Needs you: ChatGPT finished, but its reply has no resume JSON (it may have refused).',level:'attention',key:'chatgpt-error'},one.token);
  assert.match(s.bridge.dashboard('p1').jobs.find(j => j.id === failed.id).failure.message,/no resume JSON/);
  await s.send('/v1/jobs/'+failed.id+'/complete',{confirmed:true},one.token);
  const ended = s.bridge.dashboard('p1').jobs.find(j => j.id === failed.id);
  assert.equal(ended.outcome,'failed');assert.match(ended.failure.message,/no resume JSON/);
  // A Full auto stop that only needs you (no company yet) is not a failure.
  const asked = s.bridge.assign('p1','https://example.com/job',one.id);
  await s.send('/v1/jobs/'+asked.id+'/progress',{text:'Needs you: The hiring company is not named in the job description.',level:'attention',key:'full-auto-blocked',stage:'resume'},one.token);
  assert.equal(s.bridge.dashboard('p1').jobs.find(j => j.id === asked.id).failure,null);
  await s.send('/v1/jobs/'+asked.id+'/progress',{text:'Needs you: The resume could not be exported: disk full',level:'attention',key:'full-auto-blocked',stage:'resume',failed:true},one.token);
  assert.match(s.bridge.dashboard('p1').jobs.find(j => j.id === asked.id).failure.message,/disk full/);
  // The company typed in the app is kept when the JD names none, and the resume uses it.
  s.bridge.setCompany('p1',asked.id,'Acme Corp');
  await s.send('/v1/jobs/'+asked.id+'/jd',{description:'Build things. '.repeat(30),company:'',title:'Engineer'},one.token);
  assert.equal(s.bridge.dashboard('p1').jobs.find(j => j.id === asked.id).company,'Acme Corp');
  assert.throws(() => s.bridge.setCompany('p1',asked.id,'  '),/Enter the hiring company/);
  await s.send('/v1/jobs/'+asked.id+'/resume',{response:JSON.stringify({...Resume.seed(profiles[0]),company:'Acme Corp',summary:'Valid summary.'})},one.token);
  const exported = s.bridge.dashboard('p1').jobs.find(j => j.id === asked.id);
  assert.equal(exported.failure,null,'a resume exported later clears the failure: '+JSON.stringify([exported.failure,exported.error,exported.status]));
  await s.send('/v1/jobs/'+asked.id+'/complete',{confirmed:true},one.token);
  assert.equal(s.bridge.dashboard('p1').jobs.find(j => j.id === asked.id).outcome,'submitted');
});

test('Start over removes the job and tells its browser to close its tabs and forget it', async t => {
  const s = await service(t), one = await s.pair('One');
  const job = s.bridge.assign('p1','https://example.com/job',one.id);
  const before = (await s.send('/v1/state',undefined,one.token)).body.cursor;
  const waiting = s.send('/v1/events?after='+encodeURIComponent(before),undefined,one.token);
  assert.deepEqual(s.bridge.reset('p1',job.id),{ok:true,url:'https://example.com/job'});
  // The link is back to Not sent: no job for it any more; the same link can be sent again.
  assert.equal(s.bridge.dashboard('p1').jobs.some(j => j.id === job.id),false);
  const woke = await waiting;
  assert.deepEqual(woke.body.cleanup,[job.id]);assert.notEqual(woke.body.cursor,before);
  assert.equal((await s.send('/v1/cleanup-done',{jobId:job.id},one.token)).status,200);
  assert.deepEqual((await s.send('/v1/state',undefined,one.token)).body.cleanup,[]);
  assert.ok(s.bridge.assign('p1','https://example.com/job',one.id).id);
  assert.throws(() => s.bridge.reset('p2',job.id), /not found/);
});
