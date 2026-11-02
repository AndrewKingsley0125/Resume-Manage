const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Resume = require('../src/shared/resume');

function workspace(saveResult = true) {
  const elements = new Map(), timers = new Map(), writes = [];
  let nextTimer = 0;
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value:'', textContent:'', classList:{add(){},remove(){},toggle(){}}, removeAttribute(){} });
    return elements.get(id);
  };
  const profile = {id:'example',workHistory:[{company:'Employer'}],education:[]};
  const context = {
    window:{App:{Resume,Templates:{get:()=>({render:()=>'<html></html>'})}},api:{
      saveResume:async (id,data)=>{writes.push({id,data});return saveResult;},
      renderPdf:async ()=>({error:'Preview omitted in save test'}),
    }},
    document:{getElementById:element,querySelector:()=>null},
    setTimeout:callback=>{const id=++nextTimer;timers.set(id,callback);return id;},
    clearTimeout:id=>timers.delete(id),console:{error(){}},
  };
  vm.createContext(context);
  const source=fs.readFileSync(path.join(__dirname,'../src/renderer/workspace.js'),'utf8').replace('  function renderHtml() {', '  window.testWorkspace = {parseAndRender, close, setProfile: p => {currentProfile = p;}};\n  function renderHtml() {');
  vm.runInContext(source,context);
  context.window.testWorkspace.setProfile(profile);
  return {api:context.window.testWorkspace,element,profile,timers,writes};
}

test('leaving workspace flushes the latest valid editor text and cancels debounce', async () => {
  const w=workspace();
  const data=Resume.seed(w.profile);data.summary='First edit';
  w.element('resume-json').value=JSON.stringify(data);
  w.api.parseAndRender();
  data.summary='Latest edit before navigation';
  w.element('resume-json').value=JSON.stringify(data);
  w.api.close();
  await Promise.resolve();
  assert.equal(w.writes.length,1);
  assert.equal(w.writes[0].id,'example');
  assert.equal(w.writes[0].data.summary,'Latest edit before navigation');
  assert.equal(w.timers.size,0);
});

test('a false persistence result displays Save failed', async () => {
  const w=workspace(false);
  w.element('resume-json').value=JSON.stringify(Resume.seed(w.profile));
  w.api.parseAndRender();
  const [id,callback]=w.timers.entries().next().value;
  w.timers.delete(id);
  await callback();
  assert.equal(w.element('json-status').textContent,'Save failed');
});
