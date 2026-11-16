const {test} = require('node:test');
const assert = require('node:assert/strict');
const layout = import('../chrome-extension/layout.mjs');
// Tabs: 1 = job site, 2 = ChatGPT, 9 = an unrelated tab between them.
function browser(split = true) {
  const calls = [];
  const tabs = [{id:1,index:0,windowId:1,groupId:-1,splitViewId:-1},{id:9,index:1,windowId:1,groupId:-1,splitViewId:-1},{id:2,index:2,windowId:1,groupId:-1,splitViewId:-1}];
  const api = {tabs:{
    get:async id=>({...tabs.find(t=>t.id===id)}),
    move:async(id,options)=>{calls.push(['move',id,options]);const tab=tabs.find(t=>t.id===id);tabs.splice(tabs.indexOf(tab),1);tabs.splice(options.index,0,tab);tabs.forEach((t,i)=>t.index=i);},
    group:async({tabIds})=>{calls.push(['group',tabIds]);tabs.filter(t=>tabIds.includes(t.id)).forEach(t=>t.groupId=5);return 5;},
    unsplit:async id=>{calls.push(['unsplit',id]);tabs.forEach(t=>{if(t.splitViewId===id)t.splitViewId=-1;});},
  }};
  if(split)api.tabs.createSplit=async ids=>{calls.push(['split',ids]);tabs.filter(t=>ids.includes(t.id)).forEach(t=>t.splitViewId=7);return 7;};
  return {api,calls,tabs};
}
test('each job groups its site and ChatGPT side by side in split view', async () => {
  const b = browser();const {arrangeWorkspace} = await layout;
  const first = await arrangeWorkspace(b.api,1,2);
  assert.deepEqual(first,{layout:'split',groupId:5,splitViewId:7});
  assert.deepEqual(b.calls.find(c=>c[0]==='group')[1],[1,2]);
  assert.deepEqual(b.calls.find(c=>c[0]==='split')[1],[1,2]);
  const again = await arrangeWorkspace(b.api,1,2);
  assert.equal(again.splitViewId,7);assert.equal(b.calls.filter(c=>c[0]==='split').length,1);
});
test('a split with another tab is replaced by the job site and ChatGPT', async () => {
  const b = browser();const {arrangeWorkspace} = await layout;
  b.tabs.find(t=>t.id===1).splitViewId=4;b.tabs.find(t=>t.id===9).splitViewId=4;
  await arrangeWorkspace(b.api,1,2);
  assert.ok(b.calls.some(c=>c[0]==='unsplit' && c[1]===4));
  assert.deepEqual(b.calls.find(c=>c[0]==='split')[1],[1,2]);
});
test('older browsers retain a grouped layout with a clear compatibility notice', async () => {
  const b = browser(false);const {arrangeWorkspace} = await layout;
  const result = await arrangeWorkspace(b.api,1,2);assert.equal(result.layout,'grouped');assert.match(result.layoutNotice,/Chrome 155/);
});
test('the extension window docks to the right of the job window, inside the screen', async () => {
  const {panelBounds} = await layout;
  // Room to spare: the job window keeps its size.
  assert.deepEqual(panelBounds({left:0,top:0,width:1400,height:900},{left:0,top:0,width:1920,height:1040},400),{job:{width:1400},panel:{left:1400,top:0,width:400,height:900}});
  // Not enough room: the job window narrows so the extension window stays on screen.
  assert.deepEqual(panelBounds({left:100,top:40,width:1800,height:900},{left:0,top:0,width:1920,height:1040},400),{job:{width:1420},panel:{left:1520,top:40,width:400,height:900}});
});
