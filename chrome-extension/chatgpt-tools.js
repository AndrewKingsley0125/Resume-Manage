(() => {
  const version = 13;
  if (globalThis.ResumeApplyChat && globalThis.ResumeApplyChat.version === version) return;
  globalThis.ResumeApplyChat?.stopResponseWatch?.();
  const visible = el => !!el && el.getClientRects().length > 0;
  // Collapsed long prompts can omit their marker from innerText while retaining it in textContent.
  const requestText = el => el ? el.textContent || el.innerText || '' : '';
  function pageRoots() {
    const roots=[document],seen=new Set(roots);
    for(let index=0;index<roots.length && index<100;index++)for(const node of roots[index].querySelectorAll('*')) {
      let nested=node.shadowRoot;
      if(!nested && node.tagName==='IFRAME')try{nested=node.contentDocument;}catch(_){}
      if(nested && !seen.has(nested)){seen.add(nested);roots.push(nested);}
    }
    return roots;
  }
  const queryAll = selector => [...new Set(pageRoots().flatMap(root=>[...root.querySelectorAll(selector)]))];
  function follows(first,last) {
    if(!first)return true;
    const order=first.compareDocumentPosition(last);
    if(!(order&Node.DOCUMENT_POSITION_DISCONNECTED))return !!(order&Node.DOCUMENT_POSITION_FOLLOWING);
    // DOM positions across a shadow root or iframe are disconnected. Compare
    // their hosts at the nearest shared root instead of trusting arbitrary bits.
    const anchors=new Map();
    const parentRoot=node=>{
      const root=node.getRootNode();
      if(root.host)return root.host;
      try{return root.defaultView?.frameElement || null;}catch(_){return null;}
    };
    for(let node=first;node;node=parentRoot(node))anchors.set(node.getRootNode(),node);
    for(let node=last;node;node=parentRoot(node)) {
      const anchor=anchors.get(node.getRootNode());
      if(anchor)return anchor!==node && !!(anchor.compareDocumentPosition(node)&Node.DOCUMENT_POSITION_FOLLOWING);
    }
    return false;
  }
  const turnSelector = 'article,[role="article"],[data-testid^="conversation-turn"],[data-message-id]';
  function userContent(node) {
    for(let current=node;current;) {
      if(current.closest('[data-message-author-role="user"],[data-turn="user"],#prompt-textarea,[contenteditable="true"],textarea,form'))return true;
      const turn=current.closest(turnSelector);
      const heading=turn?.querySelector('h5,h6,[data-message-author]')?.textContent || '';
      if(/^\s*(you said|you wrote|user)\s*:/i.test(heading))return true;
      const root=current.getRootNode();
      current=root.host || null;
      if(!current && root.nodeType===9 && root!==document)try{current=root.defaultView?.frameElement;}catch(_){}
    }
    return false;
  }
  const messageNodes = role => {
    let nodes = queryAll(`[data-message-author-role="${role}"],[data-turn="${role}"]`);
    // Prefer the inner author message when both it and its turn have a role.
    nodes=nodes.filter(node=>!nodes.some(other=>other!==node && node.contains(other)));
    if(role==='user') {
      const fallback=queryAll(turnSelector).filter(node=>{
        if(nodes.some(message=>message===node || message.contains(node) || node.contains(message)))return false;
        return /^\s*(you said|you wrote|user)\s*:/i.test(node.querySelector('h5,h6')?.textContent || '');
      });
      nodes=[...nodes,...fallback.filter(node=>!fallback.some(other=>other!==node && other.contains(node)))];
    }
    if(role==='assistant') {
      // Plain replies do not always carry author attributes. Restrict fallback
      // text to response markdown or turns with assistant headings/actions;
      // never scrape the entire page, which also contains the user's prompt.
      const fallback=queryAll('.markdown,.prose,[class*="markdown"],article,[role="article"],[data-testid^="conversation-turn"]')
        .filter(node=>{
          if(nodes.some(message=>message===node || message.contains(node) || node.contains(message)))return false;
          if(userContent(node) || node.querySelector('[data-message-author-role="user"],[data-turn="user"]'))return false;
          if(node.matches('.markdown,.prose,[class*="markdown"]'))return true;
          const heading=node.querySelector('h5,h6')?.textContent || '';
          return /^\s*(chatgpt|assistant)\s*(said|wrote)?\s*:/i.test(heading) || !!node.querySelector('.markdown,.prose,[class*="markdown"],[data-testid="copy-turn-action-button"],button[aria-label="Copy" i],button[aria-label*="Copy response" i],button[aria-label="Good response" i],button[aria-label="Bad response" i]');
        });
      // Keep a complete fallback turn rather than just its final markdown child.
      nodes=[...nodes,...fallback.filter(node=>!fallback.some(other=>other!==node && other.contains(node)))].filter(node=>!userContent(node));
    }
    nodes.sort((a,b)=>follows(a,b)?-1:follows(b,a)?1:0);
    return nodes;
  };
  const assistantMessages = () => messageNodes('assistant');
  const userMessages = () => messageNodes('user');
  const generating = () => [...document.querySelectorAll('[data-testid="stop-button"],button[aria-label*="Stop generating" i],button[aria-label*="Stop streaming" i]')].some(visible);
  const messageText = el => {
    if (!el) return '';
    const code = [...el.querySelectorAll('pre code')].map(x => x.textContent || x.innerText).filter(Boolean);
    return code.length === 1 ? code[0] : el.innerText || el.textContent || '';
  };
  function responseSnapshot() {
    const replies=assistantMessages();
    const nodes=replies.length ? replies : queryAll('pre,.cm-editor,[data-testid*="code-block"],[class*="code-block"]').filter(node=>!userContent(node));
    const last=nodes.at(-1);
    // Hash response content, never the trailing Copy button's static label.
    // Reused/virtualized turns can keep the same node count between replies.
    const text=last && (last.textContent || last.innerText) || '';
    let hash=2166136261;
    for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);
    const user=userMessages().at(-1);
    return {signature:`${nodes.length}:${text.length}:${hash>>>0}`,present:!!last && !!text.trim(),afterUser:!!user && !!last && follows(user,last)};
  }
  const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
  const normalizeText = value => String(value || '').replace(/\s+/g,' ').trim();
  const composerValues = el => el.tagName === 'TEXTAREA' ? [el.value] : [el.innerText,el.textContent];
  const composerText = el => composerValues(el).find(value => editorCharacters(value)) || '';
  // Layout text can omit offscreen content or add line breaks. Compare the full
  // character sequence from both DOM representations, ignoring editor spacing
  // and zero-width placeholders, never just a prefix or the request marker.
  const editorCharacters = value => String(value || '').replace(/[\s\u200b\ufeff]+/g,'');
  const composerMatches = (el,body) => composerValues(el).some(value => editorCharacters(value) === editorCharacters(body));
  function findComposer(body) {
    const candidates = [...document.querySelectorAll('#prompt-textarea,textarea[data-id="root"],textarea[placeholder*="Message" i],[contenteditable="true"][role="textbox"],.ProseMirror[contenteditable="true"]')];
    const editors = candidates.map(el => el.tagName === 'TEXTAREA' || el.isContentEditable ? el : el.querySelector('[contenteditable="true"],textarea')).filter(el => visible(el) && !el.disabled && !el.readOnly);
    return (body && editors.find(el => composerMatches(el,body))) || editors[0];
  }
  function findSend(composer) {
    const root = composer.closest('form') || document;
    const selector = '#composer-submit-button,[data-testid="send-button"],[data-testid="composer-send-button"],button[aria-label="Send prompt" i],button[aria-label="Send message" i],button[aria-label="Send" i]';
    // The send control can sit outside the editor's form in the expanded composer.
    const candidates = [...root.querySelectorAll(selector),...(root === document ? [] : document.querySelectorAll(selector)),...root.querySelectorAll('button[type="submit"]')];
    return candidates.find(button => visible(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true');
  }
  const conversationPath = () => /^\/c\//.test(location.pathname) ? location.pathname : '';
  const nodeId = el => el && (el.getAttribute('data-message-id') || el.closest('[data-message-id]')?.getAttribute('data-message-id')) || '';
  function rememberRequest(receipt, user) {
    return {...receipt,userMessageId:nodeId(user),conversationPath:conversationPath()};
  }
  async function send(prompt, previousReceipt) {
    if (location.hostname !== 'chatgpt.com') throw new Error('Open and sign into ChatGPT first.');
    if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('The app returned an empty prompt. Check the collected JD and try again.');
    if (generating()) throw new Error('ChatGPT is still responding. Wait before sending another prompt.');
    let composer;
    const readyUntil = Date.now() + 10000;
    do {composer = findComposer();if (composer) break;await pause(100);} while (Date.now() < readyUntil);
    if (!composer) throw new Error('ChatGPT composer not found. Sign in or finish any verification, then retry.');
    const existing = editorCharacters(composerText(composer));
    const requestBody = marker => prompt + '\n\nRequest reference: ' + marker + '. Do not include this reference in your response.';
    // A failed insertion check used to lose the receipt. Recover only our exact
    // complete prompt so retrying can submit it without replacing another draft.
    const recoveredMarker = composerValues(composer).map(value => String(value || '').match(/Request reference: (RM-[\w-]+)\. Do not include this reference in your response\.\s*$/)?.[1]).find(Boolean);
    const marker = previousReceipt && composerMatches(composer,requestBody(previousReceipt.marker)) ? previousReceipt.marker : recoveredMarker;
    if (existing && (!marker || !composerMatches(composer,requestBody(marker)))) throw new Error('ChatGPT has an unsent draft. Send or clear it before continuing.');
    const receipt = existing && previousReceipt?.marker === marker ? previousReceipt : {baseline:assistantMessages().length, previous:messageText(assistantMessages().at(-1)), marker:existing ? marker : 'RM-' + crypto.randomUUID(),sentAt:Date.now(),responseBaseline:responseSnapshot().signature};
    const body = prompt + '\n\nRequest reference: ' + receipt.marker + '. Do not include this reference in your response.';
    if (!existing) {
      composer.scrollIntoView({block:'center'});
      composer.focus();
      if (composer.tagName === 'TEXTAREA') {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(composer,body);
        composer.dispatchEvent(new Event('input',{bubbles:true}));
      } else {
        const selection = window.getSelection(), range = document.createRange();
        range.selectNodeContents(composer);selection.removeAllRanges();selection.addRange(range);
        // Use a native editing command, never paste: ChatGPT turns long paste
        // events into file attachments. insertText keeps the whole prompt inline
        // and emits the editor's normal input transaction.
        document.execCommand('insertText',false,body);
      }
      const insertedUntil = Date.now() + 3000;
      do {
        await pause(100);
        composer = findComposer(body) || composer;
        if (composerMatches(composer,body)) break;
      } while (Date.now() < insertedUntil);
      if (!composerMatches(composer,body)) {
        if (normalizeText(composerText(composer))) throw new Error('ChatGPT contains a draft, but its full text could not be verified. Nothing was sent. Review the draft before retrying.');
        throw new Error('ChatGPT editor is empty after insertion. Finish any sign-in or verification, then retry.');
      }
    }
    let button;
    const sendUntil = Date.now() + 10000;
    do {button = findSend(composer);if (button) break;await pause(100);} while (Date.now() < sendUntil);
    if (button) button.click();
    else {
      composer.focus();
      composer.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));
    }
    let fallbackAttempted = !button;
    const confirmUntil = Date.now() + 15000;
    const fallbackAt = Date.now() + 3000;
    do {
      const user = userMessages().at(-1);
      if (requestText(user).includes(receipt.marker)) return rememberRequest(receipt,user);
      const current = findComposer(body);
      if (generating() && current && !normalizeText(composerText(current))) return rememberRequest(receipt,user);
      // Some composer versions ignore a programmatic button click while their
      // editor state settles. Submit through the editor's Enter handler once,
      // only while our complete draft is still present and generation is idle.
      if (!fallbackAttempted && Date.now() >= fallbackAt && !generating() && current && composerMatches(current,body)) {
        fallbackAttempted = true;
        current.focus();
        current.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true}));
      }
      await pause(100);
    } while (Date.now() < confirmUntil);
    return {...receipt,sendUnconfirmed:true};
  }
  function matchingRequest(receipt, expectedPrompt) {
    if (!receipt) return null;
    if (receipt.conversationPath && conversationPath() && receipt.conversationPath !== conversationPath()) return null;
    const user = userMessages().at(-1);
    if (!user) return null;
    if (receipt.userMessageId && nodeId(user) === receipt.userMessageId) return user;
    const raw = requestText(user);
    if (receipt.marker && raw.includes(receipt.marker)) return user;
    // Some ChatGPT renderers omit the appended reference. Match the complete known prompt, never a generic prefix.
    if (typeof expectedPrompt === 'string' && expectedPrompt.length >= 200) {
      const end = receipt.marker ? '\n\nRequest reference: '+receipt.marker+'. Do not include this reference in your response.' : '';
      const full = normalizeText(raw);
      if (full === normalizeText(expectedPrompt) || end && full === normalizeText(expectedPrompt+end)) return user;
    }
    return null;
  }
  function candidateResponse() {
    const user = userMessages().at(-1);
    const assistant = assistantMessages().filter(el => follows(user,el)).at(-1);
    const response = messageText(assistant);
    if (!assistant || !response.trim()) throw new Error('No completed response found in the assigned ChatGPT tab. Open its finished conversation and retry.');
    return response;
  }
  function responseState(receipt) {
    const composer=findComposer();
    return {...responseSnapshot(),generating:generating(),requestMatched:!!matchingRequest(receipt),
      draftPending:!!receipt?.marker && !!composer && composerValues(composer).some(value=>String(value || '').includes(receipt.marker))};
  }
  async function readCandidate() {
    if (generating()) throw new Error('ChatGPT is still generating. Wait, then read again.');
    const response = candidateResponse();
    await pause(750);
    if (generating() || candidateResponse() !== response) throw new Error('Response is still changing. Wait and read again.');
    return {response,url:location.href};
  }
  async function read(receipt, expectedPrompt) {
    if (!matchingRequest(receipt,expectedPrompt)) throw new Error('The response could not be matched automatically. Review it in the extension before exporting.');
    return (await readCandidate()).response;
  }
  async function readForReview(receipt, expectedPrompt) {
    const result = await readCandidate();
    return {...result,matched:!!matchingRequest(receipt,expectedPrompt)};
  }
  function collectCodeBlocks() {
    if (generating()) throw new Error('ChatGPT is still generating. Wait, then read again.');
    const roots=pageRoots();
    const candidates=[],copyTargets=[],seen=new Set(),seenButtons=new Set();
    const selector='pre code,pre,.cm-editor,.cm-content,[data-language="json"],[data-lang="json"],[class*="language-json"],[data-testid*="code-block"],[class*="code-block"]';
    const user=userMessages().at(-1);
    const latestReply=assistantMessages().filter(node=>follows(user,node)).at(-1);
    if(latestReply) {
      for(const raw of [messageText(latestReply),latestReply.innerText,latestReply.textContent]) {
        const value=(raw || '').trim();
        if(value && value.length<=500000 && !seen.has(value)){seen.add(value);candidates.push(value);}
      }
      // The whole-message Copy action works for plain JSON too, without a code
      // fence or a "JSON" header. Keep it scoped to the latest reply's turn.
      const turn=latestReply.closest(turnSelector) || latestReply.closest('[data-message-author-role="assistant"],[data-turn="assistant"]') || latestReply;
      for(const button of turn.querySelectorAll('[data-testid="copy-turn-action-button"],button[aria-label="Copy" i],button[aria-label*="Copy response" i]'))if(!button.disabled && !userContent(button)) {
        seenButtons.add(button);const token=crypto.randomUUID();button.setAttribute('data-rm-copy-token',token);copyTargets.push(token);
      }
    }
    const blocks=roots.flatMap(root=>[...root.querySelectorAll(selector)]).filter(block=>!userContent(block) && follows(user,block));
    const codeRoot=block=>block.closest('[data-testid*="code-block"],[class*="code-block"]') || block.closest('.cm-editor') || block.closest('pre') || block;
    const newestRoot=blocks.length ? codeRoot(blocks.at(-1)) : null;
    // Do not silently fall back to an older resume when the newest editor is virtualized.
    for(const block of blocks.filter(block=>codeRoot(block)===newestRoot)) {
      const lines=[...block.querySelectorAll('.cm-line')];
      for(const raw of [lines.length ? lines.map(line=>line.textContent).join('\n') : '',block.innerText,block.textContent]) {
        const value=(raw || '').trim();
        if(value && value.length<=500000 && !seen.has(value)){seen.add(value);candidates.push(value);}
      }
      let container=block;
      for(let depth=0;container && depth<7;depth++,container=container.parentElement) {
        if(container===document.body || container===document.documentElement)break;
        const buttons=[...container.querySelectorAll('button,[role="button"]')].filter(button=>{
          const name=[button.getAttribute('aria-label'),button.getAttribute('title'),button.getAttribute('data-testid'),button.textContent].filter(Boolean).join(' ');
          return /copy|clipboard/i.test(name) || button.querySelector('svg.lucide-copy,svg.icon-copy,[data-icon="copy"]');
        });
        if(!buttons.length)continue;
        for(const button of buttons)if(!seenButtons.has(button) && !button.disabled){
          seenButtons.add(button);const token=crypto.randomUUID();button.setAttribute('data-rm-copy-token',token);copyTargets.push(token);
        }
        break;
      }
    }
    // Some editors live in an iframe; their parent JSON header and Copy control remain accessible.
    for(const root of roots)for(const button of root.querySelectorAll('button,[role="button"]')) {
      if(userContent(button) || !follows(user,button) || seenButtons.has(button) || button.disabled)continue;
      const name=[button.getAttribute('aria-label'),button.getAttribute('title'),button.getAttribute('data-testid'),button.textContent].filter(Boolean).join(' ');
      if(!/copy|clipboard/i.test(name))continue;
      let container=button.parentElement, isJson=/copy.*code/i.test(name);
      for(let depth=0;container && depth<3;depth++,container=container.parentElement)if(/\bjson\b/i.test(container.textContent || ''))isJson=true;
      if(isJson && (!newestRoot || button.closest('[data-testid*="code-block"],[class*="code-block"]')?.contains(newestRoot) || newestRoot.contains(button))){seenButtons.add(button);const token=crypto.randomUUID();button.setAttribute('data-rm-copy-token',token);copyTargets.push(token);}
    }
    return {candidates:candidates.slice(-20).reverse(),copyTargets:copyTargets.reverse().slice(0,5),url:location.href,title:document.title,replyCount:assistantMessages().length};
  }
  let responseWatch=null;
  function stopResponseWatch() {
    if(!responseWatch)return;
    responseWatch.observer.disconnect();clearInterval(responseWatch.interval);clearTimeout(responseWatch.timeout);responseWatch=null;
  }
  function watchResponse({id,kind,receipt}) {
    if(responseWatch?.receipt.marker===receipt.marker)return {watching:true};
    stopResponseWatch();
    const initial=responseSnapshot();
    const watch={id,kind,receipt,signature:initial.signature,changedAt:Date.now(),notifying:false};
    async function check() {
      if(responseWatch!==watch || watch.notifying)return;
      const snapshot=responseSnapshot();
      if(snapshot.signature!==watch.signature){watch.signature=snapshot.signature;watch.changedAt=Date.now();}
      if(generating() || !snapshot.present || Date.now()-watch.changedAt<1800)return;
      if(!snapshot.afterUser && (!receipt.responseBaseline || snapshot.signature===receipt.responseBaseline))return;
      if(!matchingRequest(receipt) && (!receipt.responseBaseline || snapshot.signature===receipt.responseBaseline))return;
      watch.notifying=true;
      try {
        const result=await chrome.runtime.sendMessage({event:'chat-response-ready',id,kind,marker:receipt.marker});
        if(responseWatch===watch && (result?.collected || result?.stop))stopResponseWatch();
      }catch(_){}finally{if(responseWatch===watch)watch.notifying=false;}
    }
    watch.observer=new MutationObserver(()=>{check();});watch.observer.observe(document.body,{childList:true,subtree:true,characterData:true});
    watch.interval=setInterval(check,1500);
    watch.timeout=setTimeout(()=>{if(responseWatch===watch){chrome.runtime.sendMessage({event:'chat-response-timeout',id,kind,marker:receipt.marker}).catch(()=>{});stopResponseWatch();}},20*60*1000);
    responseWatch=watch;return {watching:true};
  }
  globalThis.ResumeApplyChat = {version,send,read,readForReview,readCandidate,collectCodeBlocks,watchResponse,stopResponseWatch,responseState};
})();
