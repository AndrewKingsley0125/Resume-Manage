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
const profiles = [{id:'p1',firstName:'Test',applicationMode:'extension',extensionJobLinks:['https://example.com/job'],workHistory:[{company:'Employer'}],education:[],applicationDetails:{gender:'Man',answerPrompt:'Two sentences.'},ssn:'DO NOT SHARE'}];
async function service(t, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'resume-bridge-test-'));
  const bridge = createExtensionBridge({statePath:path.join(dir,'state.json'),getProfiles:() => profiles,buildPrompt,exportResume:async (profile,response) => ({resume:Resume.parse(response,profile),files:{path:'resume.pdf',docxPath:'resume.docx',jdPath:'JD.txt'}}),...extra});
  const address = await bridge.start(0);
  t.after(async () => {await bridge.stop();fs.rmSync(dir,{recursive:true,force:true});});
  const send = async (route, body, token, requestOrigin = origin) => {
    const result = await fetch(`http://127.0.0.1:${address.port}` + route,{method:body === undefined ? 'GET':'POST',headers:{Origin:requestOrigin,'Content-Type':'application/json',...(token ? {Authorization:'Bearer '+token}:{})},body:body === undefined ? undefined:JSON.stringify(body)});
    return {status:result.status,body:await result.json()};
  };
  const pair = async name => (await send('/v1/pair',{code:bridge.dashboard().pairingCode,name})).body;
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
  assert.equal((await s.send('/v1/pair',{code:s.bridge.dashboard().pairingCode},undefined,'')).status,403);
  assert.ok(!JSON.stringify(s.bridge.dashboard()).includes(client.token));
  assert.ok(!fs.readFileSync(path.join(s.dir,'state.json'),'utf8').includes(client.token));
});
test('eight-slot limit is enforced and unlinking revokes access', async t => {
  const s = await service(t);let first;
  for(let i=0;i<8;i++) {const client = await s.pair('Client '+i);if(!first)first=client;assert.ok(client.id);}
  assert.equal((await s.send('/v1/pair',{code:s.bridge.dashboard().pairingCode})).status,409);
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
  assert.equal(exported.status,200);assert.equal(exported.body.files.docx,'resume.docx');
  assert.equal((await s.send('/v1/jobs/'+job.id+'/resume',{response:JSON.stringify(resume)},one.token)).status,409);
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
