const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../chrome-extension/chatgpt-tools.js'),'utf8');

function editor({draft='',sendButton=false,ignoreClick=false,renderText=value=>value,storedText=value=>value,withResponse=false}={}) {
  let time=0, pasted='', commands=0, clicks=0, enters=0, user=null,interval;
  const notifications=[];
  const assistant={textContent:'Old answer Copy',innerText:'Old answer Copy',contains:()=>false,querySelector:()=>null,querySelectorAll:()=>[],getRootNode:()=>({nodeType:9}),closest(selector){return selector.startsWith('[data-message-author-role="user"]')?null:this;}};
  const copy={textContent:'Copy',closest:selector=>selector.startsWith('[data-message-author-role="user"]')?null:assistant};
  function submit(){user={textContent:composer.textContent || composer.innerText,getAttribute:()=>null,closest:()=>null,compareDocumentPosition:()=>4};composer.innerText='';composer.textContent='';}
  const button={getClientRects:()=>[{}],getAttribute:()=>null,click(){clicks++;if(!ignoreClick)submit();}};
  const form={querySelectorAll:()=>[]};
  const composer={tagName:'DIV',isContentEditable:true,innerText:renderText(draft),textContent:storedText(draft),
    getClientRects:()=>[{}],scrollIntoView(){},focus(){},closest:()=>form,
    dispatchEvent(event){if(event.type==='keydown' && event.key==='Enter'){enters++;submit();}if(event.type==='paste'){pasted=event.clipboardData.text;throw new Error('Paste would create an attachment');}}};
  const context=vm.createContext({
    location:{hostname:'chatgpt.com',pathname:'/'},crypto:{randomUUID:()=> 'test'},
    Date:{now:()=>time},setTimeout(fn,ms){time+=ms;fn();},
    setInterval(fn){interval=fn;},clearInterval(){},clearTimeout(){},
    MutationObserver:class {observe(){} disconnect(){}},Node:{DOCUMENT_POSITION_FOLLOWING:4},
    chrome:{runtime:{async sendMessage(message){notifications.push(message);return {collected:true};}}},
    Event:class {constructor(type){this.type=type;}},
    KeyboardEvent:class {constructor(type,options){this.type=type;Object.assign(this,options);}},
    ClipboardEvent:class {constructor(type,options){this.type=type;Object.assign(this,options);}},
    DataTransfer:class {setData(type,text){this.text=text;}},
    window:{getSelection:()=>({removeAllRanges(){},addRange(){}})},
    document:{querySelectorAll(selector){
      if(selector.includes('#prompt-textarea,'))return [composer];
      if(selector==='[data-message-author-role="user"],[data-turn="user"]')return user?[user]:[];
      if(withResponse && selector==='[data-message-author-role="assistant"],[data-turn="assistant"]')return [assistant];
      if(withResponse && selector.includes(',pre,'))return selector.includes('button[aria-label*="Copy code"')?[assistant,copy]:[assistant];
      if(selector.includes('#composer-submit-button'))return sendButton?[button]:[];
      return [];
    },
      createRange:()=>({selectNodeContents(){}}),
      execCommand(command,ui,body){commands++;composer.innerText=renderText(body);composer.textContent=storedText(body);return true;}}
  });
  vm.runInContext(source,context);
  return {send:context.ResumeApplyChat.send,watch:context.ResumeApplyChat.watchResponse,state:context.ResumeApplyChat.responseState,composer,assistant,notifications,
    async tick(){time+=2000;await interval();},
    get pasted(){return pasted;},get commands(){return commands;},get clicks(){return clicks;},get enters(){return enters;},get user(){return user;}};
}

test('ChatGPT inserts multiline prompts as raw text without a paste event',async()=>{
  const chat=editor();
  const receipt=await chat.send('First line\n\nSecond line');
  assert.equal(receipt.manualSend,undefined);
  assert.equal(receipt.sendUnconfirmed,undefined);
  assert.equal(chat.pasted,'');
  assert.ok(chat.user.textContent.includes('Request reference: RM-test'));
  assert.equal(chat.enters,1);
  assert.equal(chat.commands,1);
});

test('ChatGPT sends a long raw master prompt using a send control outside the form',async()=>{
  const chat=editor({sendButton:true});
  const prompt='# MASTER PROMPT\n'+ 'Instructions\n'.repeat(5000);
  const receipt=await chat.send(prompt);
  assert.equal(receipt.manualSend,undefined);
  assert.equal(receipt.sendUnconfirmed,undefined);
  assert.equal(chat.commands,1);
  assert.equal(chat.clicks,1);
  assert.equal(chat.enters,0);
  assert.equal(chat.pasted,'');
  assert.equal(chat.user.textContent,prompt+'\n\nRequest reference: RM-test. Do not include this reference in your response.');
  assert.equal(chat.composer.innerText,'');
});

test('ChatGPT automatically submits through Enter if its send button ignores the click',async()=>{
  const chat=editor({sendButton:true,ignoreClick:true});
  const receipt=await chat.send('Run this prompt');
  assert.equal(receipt.sendUnconfirmed,undefined);
  assert.equal(chat.clicks,1);
  assert.equal(chat.enters,1);
  assert.equal(chat.composer.innerText,'');
});

test('ChatGPT preserves unrelated unsent drafts',async()=>{
  const chat=editor({draft:'My unfinished message'});
  await assert.rejects(chat.send('Question prompt'),/unsent draft/);
  assert.equal(chat.composer.innerText,'My unfinished message');
  assert.equal(chat.pasted,'');
});

test('ChatGPT verifies the complete DOM text when displayed text is truncated',async()=>{
  const chat=editor({sendButton:true,renderText:value=>value.slice(0,30)});
  const prompt='Full prompt\n'+ 'Additional instructions\n'.repeat(1000);
  const receipt=await chat.send(prompt);
  assert.equal(receipt.sendUnconfirmed,undefined);
  assert.equal(chat.clicks,1);
  assert.ok(chat.user.textContent.startsWith(prompt));
});

test('ChatGPT tolerates editor spacing and zero-width placeholders',async()=>{
  const chat=editor({sendButton:true,renderText:value=>value.replace(/\s/g,'')+'\u200b',storedText:value=>value.replace(/\s/g,'')+'\u200b'});
  // Confirmation uses the unchanged marker, even when editor spacing differs.
  assert.equal((await chat.send('Full prompt\n\nwith paragraphs')).sendUnconfirmed,undefined);
  assert.equal(chat.clicks,1);
});

test('ChatGPT recovers its exact draft after an earlier failed insertion check',async()=>{
  const draft='My prompt\n\nRequest reference: RM-recovered. Do not include this reference in your response.';
  const chat=editor({draft,sendButton:true,renderText:value=>value.slice(0,20)});
  const receipt=await chat.send('My prompt');
  assert.equal(receipt.marker,'RM-recovered');
  assert.equal(receipt.sendUnconfirmed,undefined);
  assert.equal(chat.commands,0);
  assert.equal(chat.clicks,1);
});

test('ChatGPT never sends partial prompt content even if its marker is present',async()=>{
  const chat=editor({sendButton:true,renderText:value=>value.replace('REQUIRED MIDDLE',''),storedText:value=>value.replace('REQUIRED MIDDLE','')});
  await assert.rejects(chat.send('Start REQUIRED MIDDLE end'),/full text could not be verified/);
  assert.equal(chat.clicks,0);
  assert.equal(chat.enters,0);
});

test('completion monitoring detects changed text in reused turns despite an unchanged Copy label',async()=>{
  const chat=editor({sendButton:true,withResponse:true});
  const receipt=await chat.send('New question');
  chat.user.textContent='Collapsed request preview';
  chat.assistant.textContent='New answer Copy';
  chat.assistant.innerText='New answer Copy';
  chat.watch({id:'job',kind:'answers',receipt});
  await chat.tick();
  assert.equal(chat.notifications.length,1);
  assert.equal(chat.notifications[0].event,'chat-response-ready');
  assert.equal(chat.notifications[0].marker,receipt.marker);
});

test('completion monitoring leaves an unchanged old response uncollected',async()=>{
  const chat=editor({sendButton:true,withResponse:true});
  const receipt=await chat.send('New question');
  chat.user.textContent='Collapsed request preview';
  chat.watch({id:'job',kind:'answers',receipt});
  await chat.tick();
  assert.equal(chat.notifications.length,0);
});

test('polling can distinguish an unsent request from a submitted request',async()=>{
  const draft='Question prompt\n\nRequest reference: RM-pending. Do not include this reference in your response.';
  const chat=editor({draft,sendButton:true});
  assert.equal(chat.state({marker:'RM-pending'}).draftPending,true);
  assert.equal(chat.state({marker:'RM-pending'}).requestMatched,false);
  const receipt=await chat.send('Question prompt');
  assert.equal(chat.state(receipt).draftPending,false);
  assert.equal(chat.state(receipt).requestMatched,true);
});
