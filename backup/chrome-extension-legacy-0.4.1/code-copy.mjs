// Runs only in the assigned ChatGPT tab's main world for a response-copy action.
// Captures this button's outgoing copy text; never reads or replaces the user's existing OS clipboard.
export async function captureCodeCopy(token) {
  const roots=[document];
  const seen=new Set(roots);
  for(let index=0;index<roots.length && index<100;index++)for(const el of roots[index].querySelectorAll('*')){
    let nested=el.shadowRoot;
    if(!nested && el.tagName==='IFRAME')try{nested=el.contentDocument;}catch(_){}
    if(nested && !seen.has(nested)){seen.add(nested);roots.push(nested);}
  }
  const button=roots.map(root=>root.querySelector(`[data-rm-copy-token="${CSS.escape(token)}"]`)).find(Boolean);
  if(!button) return {error:'The code block changed. Click Read again.'};
  const copyWindow=button.ownerDocument.defaultView;
  const clipboard=copyWindow.navigator.clipboard;
  if(!clipboard)return {error:'ChatGPT copy support is unavailable. Use the response-paste fallback.'};
  const descriptor=Object.getOwnPropertyDescriptor(clipboard,'writeText');
  let resolveCopy;
  const copied=new Promise(resolve=>{resolveCopy=resolve;});
  let timer;
  const onCopy=event=>{
    const active=button.ownerDocument.activeElement;
    const value=event.clipboardData?.getData('text/plain') || (active?.tagName==='TEXTAREA' ? active.value : copyWindow.getSelection()?.toString());
    if(value){event.preventDefault();resolveCopy(String(value));}
  };
  try {
    Object.defineProperty(clipboard,'writeText',{configurable:true,writable:true,value:value=>{resolveCopy(String(value));return Promise.resolve();}});
    copyWindow.addEventListener('copy',onCopy);
    button.click();
    const text=await Promise.race([copied,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),1800);})]);
    return text===null ? {error:'The code-copy button did not return text. Use the response-paste fallback.'} : {text};
  }catch(error){return {error:error.message};}
  finally {
    clearTimeout(timer);copyWindow.removeEventListener('copy',onCopy);
    if(descriptor)Object.defineProperty(clipboard,'writeText',descriptor);else delete clipboard.writeText;
  }
}
