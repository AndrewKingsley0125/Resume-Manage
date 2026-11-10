const {test} = require('node:test');
const assert = require('node:assert/strict');
const layout = import('../chrome-extension/layout.mjs');
function browser(split = true) {
  const calls = [];
  const tabs = [{id:1,index:0,windowId:1,groupId:-1,splitViewId:-1},{id:2,index:1,windowId:1,groupId:-1,splitViewId:-1}];
  const api = {tabs:{get:async id=>({...tabs.find(t=>t.id===id)}),move:async(id,options)=>calls.push(['move',id,options]),group:async()=>{tabs.forEach(t=>t.groupId=5);return 5;}}};
  if(split)api.tabs.createSplit=async ids=>{calls.push(['split',ids]);tabs.forEach(t=>t.splitViewId=7);return 7;};
  return {api,calls,tabs};
}
test('job and ChatGPT use native split view without creating an extension tab',async()=>{
  const b=browser();const {arrangeWorkspace}=await layout;
  const first=await arrangeWorkspace(b.api,1,2);assert.equal(first.layout,'split');assert.equal(first.splitViewId,7);
  const again=await arrangeWorkspace(b.api,1,2);assert.equal(again.splitViewId,7);assert.equal(b.calls.filter(c=>c[0]==='split').length,1);
});
test('older browsers retain a grouped layout with a clear compatibility notice',async()=>{
  const b=browser(false);const {arrangeWorkspace}=await layout;
  const result=await arrangeWorkspace(b.api,1,2);assert.equal(result.layout,'grouped');assert.match(result.layoutNotice,/Chrome 155/);
});
