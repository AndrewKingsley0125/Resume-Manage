(() => {
  const version=17;
  if (globalThis.ResumeApplyPage && globalThis.ResumeApplyPage.version===version) return;
  const text = el => (el ? el.innerText || el.textContent || '' : '').replace(/\s+/g, ' ').trim();
  const visible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const query = selectors => selectors.map(s => document.querySelector(s)).find(Boolean);
  const sites = [
    [/greenhouse\.io$/, 'greenhouse', '.job__description', '.job__title h1', '#application-form'],
    [/ashbyhq\.com$/, 'ashby', '[class*="jobDescription"], .ashby-job-posting-description', 'h1', '.ashby-application-form-container'],
    [/lever\.co$/, 'lever', '.content-wrapper .section-wrapper', '.posting-headline h2', '#application-form'],
    [/myworkdayjobs\.com$|myworkdaysite\.com$/, 'workday', '[data-automation-id="jobPostingDescription"]', '[data-automation-id="jobPostingHeader"]', '[data-automation-id="applyFlowPage"]'],
    [/workable\.com$/, 'workable', '[data-ui="job-description"]', 'h1', 'form[data-ui="application-form"]'],
    [/bamboohr\.com$/, 'bamboohr', '.BambooRichText, .job-description', 'h1', '#job-application-form'],
    [/rippling\.com$/, 'rippling', '[class*="job-description"], [class*="jobDescription"]', 'h1', 'form'],
    [/recruiterflow\.com$/, 'recruiterflow', '.job-description', 'h1', '.basic-info-inputs-container, .additional-info-inputs-container'],
    [/dover\.com$/, 'dover', '[class*="description" i]', 'h1', 'form'],
    [/gem\.com$/, 'gem', '[class*="description" i]', 'h1', 'form'],
    [/comeet\.(com|co)$/, 'comeet', '.position-description, .job-description', 'h1', 'form'],
    [/deel\.com$/, 'deel', '[class*="richTextDisplay"]', 'h1', 'form'],
  ];
  const adapter = sites.find(([pattern]) => pattern.test(location.hostname)) || [null, 'generic', 'article, main', 'h1', 'form'];
  function htmlText(html) {
    const doc = new DOMParser().parseFromString(String(html), 'text/html');
    doc.querySelectorAll('script,style,iframe').forEach(el => el.remove());
    doc.querySelectorAll('p,div,br,li,h1,h2,h3').forEach(el => el.append(doc.createTextNode('\n')));
    return doc.body.textContent.replace(/\n{3,}/g, '\n\n').trim();
  }
  function job() {
    const walk = value => {
      if (!value || typeof value !== 'object') return null;
      if ([].concat(value['@type'] || []).includes('JobPosting')) return value;
      for (const item of (Array.isArray(value) ? value : [].concat(value['@graph'] || []))) {const found = walk(item);if (found) return found;}
      return null;
    };
    let posting;
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {posting = walk(JSON.parse(script.textContent));} catch (_) {continue;}
      if (posting && posting.description) break;
    }
    const siteDescription = adapter[1] === 'generic' ? null : document.querySelector(adapter[2]);
    const candidates = [...document.querySelectorAll('[class*="description" i], [id*="description" i], article, main')].filter(visible).sort((a,b) => text(b).length - text(a).length);
    const description = siteDescription && text(siteDescription) || posting && htmlText(posting.description || '') || (candidates[0] && (candidates[0].innerText || text(candidates[0]))) || '';
    const company = posting && posting.hiringOrganization && posting.hiringOrganization.name || (/ at (.+)$/.exec(document.title) || [])[1] || '';
    return {title:posting && posting.title || text(document.querySelector(adapter[3])) || document.title, company, description:description.slice(0,200000), source:adapter[1], url:location.href};
  }
  // Text fields nobody can see or reach are bot traps, even when they have a
  // layout box. Choice and file inputs are often visually hidden on purpose.
  function trapField(el) {
    if(!el.matches('input,textarea') || ['radio','checkbox','file'].includes(el.type))return false;
    if(/honey.?pot|beecatcher/i.test(`${el.name} ${el.id} ${el.getAttribute('data-automation-id') || ''}`) || el.closest('[aria-hidden="true"]') && el.tabIndex<0)return true;
    if(/robots only|leave (?:this|it) (?:field )?(?:blank|empty)/i.test(label(el)))return true;
    const box=el.getBoundingClientRect();
    if(box.right+scrollX<=0 || box.bottom+scrollY<=0)return true;
    for(let node=el.parentElement,depth=0;node && depth<6 && node!==document.body;node=node.parentElement,depth++) {
      const area=node.getBoundingClientRect();
      if((area.width<=1 || area.height<=1) && getComputedStyle(node).overflow!=='visible')return true;
    }
    return false;
  }
  const scanSelector='input,textarea,select,[role="combobox"],[role="radiogroup"]';
  const questionControls='input:not([type="hidden"]),select,textarea,[role="combobox"],[role="radiogroup"]';
  const ariaName = el => (el.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => text(document.getElementById(id))).filter(Boolean).join(' ') || el.getAttribute('aria-label') || '';
  // A trailing * is the only sign of a required question on many forms.
  let labelStarred=false;
  const cleanLabel = value => {labelStarred=/[*]\s*$/.test(value);return value.replace(/\s*[*]\s*$/, '').slice(0,1000);};
  // A control nested in its <label> must not contribute its option text to the question.
  function ownText(node) {
    const nested='select,textarea,[role="listbox"]';
    if(!node.querySelector(nested))return text(node);
    const copy=node.cloneNode(true);copy.querySelectorAll(nested).forEach(child=>child.remove());
    return text(copy);
  }
  // Nearest text before a control, for questions with no programmatic label.
  // Stops at another control (a previous question) or a page/section heading.
  function precedingText(el) {
    for(let node=el,depth=0;node && depth<4 && !node.matches('form,body');node=node.parentElement,depth++) {
      for(let prev=node.previousSibling;prev;prev=prev.previousSibling) {
        if(prev.nodeType===3){const value=prev.textContent.replace(/\s+/g,' ').trim();if(value)return value;continue;}
        if(prev.nodeType!==1 || prev.matches('script,style,template,button,'+popupSelector) || !visible(prev))continue;
        if(prev.matches('h1,h2,h3,'+questionControls) || prev.querySelector(questionControls))return '';
        const value=text(prev);
        if(value)return value.length<=500?value:'';
      }
    }
    return '';
  }
  function label(el) {
    const direct = ariaName(el) || [...(el.labels || [])].map(ownText).join(' ');
    const block = el.closest('[data-automation-id^="formField-"], .ashby-application-form-field-entry, .application-question, .form-group, fieldset, [role="group"], [role="radiogroup"]');
    return cleanLabel(direct || (block && text(block.querySelector('legend, .ashby-application-form-question-title, .application-label, .question-title, label'))) || precedingText(el) || el.placeholder || el.name || el.id || 'Unlabelled field');
  }
  // The question for a radio/checkbox group. An option's own label is never the
  // question, and a heading shared with other questions only counts as a last resort.
  function groupLabel(members) {
    const belongs=control=>members.some(member=>member===control || member.contains(control) || control.contains(member));
    const isOption=node=>members.some(member=>node.contains(member) || [...(member.labels || [])].includes(node));
    let group=members[0].parentElement;
    while(group && !members.every(member=>group.contains(member)))group=group.parentElement;
    for(let depth=0;group && depth<4 && !group.matches('form,body');group=group.parentElement,depth++) {
      if([...group.querySelectorAll(questionControls)].some(control=>!belongs(control)))break;
      const title=[...group.querySelectorAll('legend,.application-label,.ashby-application-form-question-title,.question-title,label')].find(node=>!isOption(node) && text(node));
      const name=ariaName(group) || (title ? ownText(title) : '');
      if(name)return cleanLabel(name);
    }
    return cleanLabel(precedingText(members[0].closest('label') || members[0]));
  }
  let scanned = new Map(), scanUrl = '', scanId = '';
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const normalized=value=>String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const comboInput=el=>el.matches('input,textarea')?el:el.querySelector('input:not([type="hidden"]),textarea');
  // Oracle Candidate Experience exposes dropdown choices as a grid of cells,
  // not listbox options. Restrict grid support to its selection-menu markup.
  const popupSelector='[role="listbox"],.cx-select__list';
  const optionSelector='[role="option"],[role="gridcell"].cx-select__list-item';
  const observedLists=new WeakMap();
  function comboLists(el) {
    const input=comboInput(el);
    const ids=[el,input].filter(Boolean).flatMap(node=>[node.getAttribute('aria-controls'),node.getAttribute('aria-owns')]).filter(Boolean).join(' ').split(/\s+/);
    return [...new Set([...ids.map(id=>document.getElementById(id)).filter(Boolean),...el.querySelectorAll(popupSelector),...(observedLists.get(el) || []).filter(list=>list.isConnected)])];
  }
  const listOptions=lists=>[...new Set(lists.flatMap(list=>[...list.querySelectorAll(optionSelector)]))].filter(option=>option.getAttribute('aria-disabled')!=='true' && !option.disabled);
  // Libraries such as react-select open on mouse-down or an arrow key, never on
  // click() alone. Unfocused pages ignore the mouse path, so the key is the fallback.
  function pressControl(target) {
    const fire=(Type,name)=>target.dispatchEvent(new Type(name,{bubbles:true,cancelable:true,composed:true,button:0}));
    fire(PointerEvent,'pointerdown');fire(MouseEvent,'mousedown');fire(PointerEvent,'pointerup');fire(MouseEvent,'mouseup');
  }
  const arrowDown=target=>target.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',code:'ArrowDown',keyCode:40,bubbles:true,cancelable:true,composed:true}));
  const multiChoice=(el,lists,question)=>el.getAttribute('aria-multiselectable')==='true' || lists.some(list=>list.getAttribute('aria-multiselectable')==='true') || !!el.closest('[class*="--is-multi"]') || !!comboInput(el)?.closest('[class*="--is-multi"]') || /select all that apply/i.test(question);
  // Selected values often render beside the input rather than inside it.
  const comboControl=el=>el.closest('[class*="__control"],[class*="-control"]') || el.parentElement;
  const singleValue=el=>text(comboControl(el)?.querySelector('[class*="single-value"],[class*="singleValue"]'));
  const multiValues=el=>[...(comboControl(el)?.querySelectorAll('[class*="multi-value__label"],[class*="multiValueLabel"]') || [])].map(text);
  // Pages behind a focused side panel can move activeElement without firing
  // focus events, and many controls only respond once they have seen one.
  function focusControl(target) {
    let focused=false;
    const record=()=>{focused=true;};target.addEventListener('focus',record);
    target.focus();target.removeEventListener('focus',record);
    if(!focused) {
      target.dispatchEvent(new FocusEvent('focus',{composed:true}));
      target.dispatchEvent(new FocusEvent('focusin',{bubbles:true,composed:true}));
    }
  }
  function blurControl(target) {
    let blurred=false;
    const record=()=>{blurred=true;};target.addEventListener('blur',record);
    target.blur();target.removeEventListener('blur',record);
    if(!blurred) {
      target.dispatchEvent(new FocusEvent('blur',{composed:true}));
      target.dispatchEvent(new FocusEvent('focusout',{bubbles:true,composed:true}));
    }
  }
  function dismissCombo(el) {
    const input=comboInput(el),target=input || el;
    // Oracle clears an already-closed selection on Escape. Only dismiss an
    // actual open popup, then blur to commit free-text combobox values.
    if(el.getAttribute('aria-expanded')==='true' || input?.getAttribute('aria-expanded')==='true' || comboLists(el).some(visible))target.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true,cancelable:true}));
    // Oracle commits editable combobox text through its blur handler.
    blurControl(target);
  }
  function optionScroller(list) {
    const scrollable=node=>node.clientHeight>0 && node.scrollHeight>node.clientHeight+1 && /auto|scroll/.test(getComputedStyle(node).overflowY);
    const nested=[list,...list.querySelectorAll('*')].find(scrollable);
    if(nested)return nested;
    for(let parent=list.parentElement,depth=0;parent && depth<2 && !parent.matches('body,html,form');parent=parent.parentElement,depth++)if(scrollable(parent))return parent;
    return null;
  }
  function choiceKey(value,field) {
    const key=normalized(value);
    if(/country/i.test(field.label) && !/code/i.test(field.label)) {
      if(['us','usa','u s','u s a','united states','united states of america'].includes(key))return 'united states';
      if(['uk','u k','gb','gbr','united kingdom'].includes(key))return 'united kingdom';
    }
    if(/gender/i.test(field.label)) {
      if(['male','man'].includes(key))return 'male';
      if(['female','woman'].includes(key))return 'female';
    }
    return key;
  }
  // Long lists are asked as plain text, then narrowed down on the page.
  const LONG_LIST=25;
  function closestOption(labels,answer,field) {
    const key=choiceKey(answer,field),words=key.split(' ').filter(Boolean);
    const named=labels.map(label=>({label,text:normalized(label)}));
    const tiers=[
      item=>item.text===key || choiceKey(item.label,field)===key,
      // "United States" should settle on "United States +1", not its longer neighbours.
      item=>item.text.startsWith(key+' ') && !/[a-z]/.test(item.text.slice(key.length)),
      item=>item.text.startsWith(key+' '),
      item=>words.length>0 && words.every(word=>item.text.split(' ').includes(word)),
    ];
    for(const tier of tiers) {
      const hits=named.filter(tier).map(item=>item.label);
      if(hits.length===1)return {match:hits[0]};
      if(hits.length>1)return {candidates:hits};
    }
    // Nothing fits outright: anything left is only a suggestion for ChatGPT to confirm.
    const overlap=item=>words.filter(word=>item.text.split(' ').includes(word)).length;
    return {candidates:named.filter(item=>overlap(item)>0).sort((a,b)=>overlap(b)-overlap(a)).slice(0,10).map(item=>item.label)};
  }
  // A dropdown is server-backed if opening it or typing in it makes a request.
  const notOptionData=/google-analytics|googletagmanager|segment\.(?:io|com)|sentry|datadog|hotjar|doubleclick|amplitude|mixpanel|newrelic|nr-data/i;
  function watchRequests() {
    const seen=[];let observer;
    try {
      observer=new PerformanceObserver(list=>{
        for(const entry of list.getEntries())if(['fetch','xmlhttprequest'].includes(entry.initiatorType) && !notOptionData.test(entry.name))seen.push(entry.name);
      });
      observer.observe({type:'resource'});
    }catch(_){}
    return {seen,stop:()=>observer?.disconnect()};
  }
  async function searchesServer(input,watch) {
    watch.seen.length=0;
    setValue(input,'qzx');
    const found=await waitFor(()=>watch.seen.length>0 || null,1200);
    setValue(input,'');
    // Let the follow-up request finish so it isn't credited to the next dropdown.
    await pause(found?500:120);
    return !!found;
  }
  function narrowingQueries(value) {
    const first=value.split(',')[0].trim(),queries=[value,first];
    let words=first.split(/\s+/);
    while(words.length>1 && queries.length<5) {
      words=words.slice(0,-1);
      if(words.join(' ').length>=3)queries.push(words.join(' '));
    }
    return [...new Set(queries)].filter(Boolean);
  }
  function choiceError(message,candidates,query) {
    const error=new Error(message);
    error.candidates=[...new Set(candidates)].slice(0,30);error.query=query;
    return error;
  }
  async function waitFor(read,ms=1600) {
    const until=Date.now()+ms;
    do {const result=read();if(result)return result;await pause(80);}while(Date.now()<until);
    return null;
  }
  function scan() {
    scanned = new Map();scanUrl = location.href;scanId = crypto.randomUUID();
    const countable = el => !el.disabled && !['hidden','button','submit','reset','image'].includes(el.type) && (el.type === 'file' || visible(el)) && !el.closest(popupSelector);
    // Search and newsletter boxes are site furniture, not application questions.
    const utilityForms = new Set([...document.querySelectorAll('form')].filter(form => {
      if (form.matches('[role="search"]')) return true;
      const controls = [...form.querySelectorAll(scanSelector)].filter(countable);
      return controls.length <= 2 && /search|newsletter|subscri/i.test([form.id,form.className,form.getAttribute('action'),...controls.map(el => label(el)+' '+(el.name || ''))].join(' '));
    }));
    const siteFurniture = el => !!el.closest('header,footer,nav,[role="banner"],[role="contentinfo"],[role="navigation"]') || utilityForms.has(el.closest('form'));
    const questionCount = node => [...node.querySelectorAll(scanSelector)].filter(el => countable(el) && !siteFurniture(el)).length;
    const roots = [...document.querySelectorAll(adapter[4])];
    // A form is the application only if it holds most of the page's questions;
    // otherwise a stray form would hide a form-less or multi-form application.
    const best = roots.map(node => ({node,size:questionCount(node)})).sort((a,b) => b.size-a.size)[0];
    const singleRoot = roots.length === 1 || adapter[4] === 'form';
    const root = singleRoot && best && best.size*2 > questionCount(document.body) ? best.node : document.body;
    const fields = [], handled = new Set();
    function add(el, type, members, options) {
      const id = crypto.randomUUID();
      const field = {id, scanId, type, name:el.name || '', label:label(el), required:labelStarred || !!el.required || el.getAttribute('aria-required') === 'true', options:options || [], value:type === 'password' ? '' : el.value || ''};
      const input=el.matches('input,textarea')?el:comboInput(el);
      if(input)field.inputHints=Object.fromEntries(Object.entries({placeholder:input.getAttribute('placeholder'),autocomplete:input.getAttribute('autocomplete'),inputMode:input.getAttribute('inputmode'),pattern:input.getAttribute('pattern'),maxLength:input.maxLength>0?input.maxLength:null}).filter(([,value])=>value!=null && value!==''));
      if ((type === 'radio' || type === 'checkbox') && members.length > 1) {field.label = groupLabel(members) || el.name || field.label;if(labelStarred)field.required=true;}
      field.answered=['radio','checkbox'].includes(type)?members.some(member=>member.checked===true || member.getAttribute('aria-checked')==='true' || member.getAttribute('aria-pressed')==='true'):type==='file'?el.files?.length>0:type==='combobox'?!!(comboInput(el)?.value || singleValue(el) || multiValues(el).length):!!String(el.value || '').trim();
      const scannedLabel=field.label;
      if(type==='file') {
        // The label on the input is often just "Attach"; the question is on its group.
        const groupName=el.closest('[role="group"][aria-labelledby]') && ariaName(el.closest('[role="group"][aria-labelledby]'));
        if(groupName){field.label=cleanLabel(groupName);if(labelStarred)field.required=true;}
      }
      if(type==='file'){field.accept=el.accept || '';field.resumeUpload=/resume|r[e\u00e9]sum[e\u00e9]|\bcv\b|curriculum vitae/i.test(field.label+' '+field.name+' '+el.id) && !/cover.?letter|portfolio/i.test(field.label+' '+field.name);}
      const manualOnly = (type==='file' && !field.resumeUpload) || ['password','unsupported'].includes(type) || /\bsignature\b|\bcertif(?:y|ication)\b|\bconsent\b|\bagree\b|\battest\b|\bterms\b|\bprivacy (?:policy|notice)\b|\bcaptcha\b/i.test(field.label);
      field.manualOnly = manualOnly;
      scanned.set(id, {el, members, field, label:type==='file'?scannedLabel:field.label});
      fields.push(field);
      members.forEach(member => handled.add(member));
    }
    for (const el of root.querySelectorAll(scanSelector)) {
      const custom=el.getAttribute('role')==='combobox' || el.hasAttribute('aria-autocomplete');
      if (handled.has(el) || siteFurniture(el) || trapField(el) || el.disabled || el.getAttribute('aria-disabled')==='true' || el.readOnly && !custom || el.closest(popupSelector)) continue;
      let type = el.tagName === 'SELECT' ? 'select' : custom ? 'combobox' : el.tagName === 'TEXTAREA' ? 'textarea' : el.type || 'text';
      if (['hidden','button','submit','reset','image'].includes(type)) continue;
      if (type !== 'file' && !visible(el)) continue;
      if (el.getAttribute('role') === 'radiogroup') {
        const members = [...el.querySelectorAll('[role="radio"]')];
        if (members.length) add(el,'radio',members,members.map(text));
        continue;
      }
      if (['checkbox','radio'].includes(type)) {
        const container = el.closest('fieldset,[role="group"],.application-question,.ashby-application-form-field-entry') || el.form || root;
        const members = [...container.querySelectorAll('input')].filter(m => m.type === type && (el.name ? m.name === el.name : m === el));
        add(el,type,members,members.map(m => [...(m.labels || [])].map(text).join(' ') || m.value));
      } else if (type === 'select') {
        add(el,el.multiple ? 'multiselect' : type,[el],[...el.options].filter(o => o.value && !o.disabled).map(o => text(o)));
        const added=fields.at(-1);
        if(!el.multiple && added.options.length>LONG_LIST){added.options=[];added.answerFormat='text';added.fillMode='local';added.optionsStatus='not-applicable';}
      } else if (type === 'combobox') {
        const input=comboInput(el),lists=comboLists(el);
        const oracleFreeText=!!input && (input.matches('.cx-select-input--auto-suggest') || !!input.closest('.cx-single-select-combo-box,cx-autosuggest-form-element'));
        const gridText=el.getAttribute('aria-haspopup')==='grid' || input?.getAttribute('aria-haspopup')==='grid' || !!input?.matches('.cx-select-input') || lists.some(list=>list.matches('[role="grid"],.cx-select__list'));
        const freeText=gridText || !!input && !input.readOnly && (oracleFreeText || /address|street/i.test(label(el)) && !/country|state|province|city|county|postal|zip/i.test(label(el)));
        const options=freeText?[]:[...new Set(listOptions(lists).map(text).filter(Boolean))];
        add(el,'combobox',[...new Set([el,input].filter(Boolean))],options);
        const field=fields.at(-1);field.allowFreeText=freeText;field.controlKind=gridText?'grid-text':oracleFreeText?'oracle-free-text':'combobox';
        field.answerFormat=gridText?'text':multiChoice(el,lists,field.label)?'multiple':freeText?'text':'single';
        if(gridText){field.fillMode='text';field.optionsStatus='not-applicable';}
      } else add(el,type,[el],[]);
    }
    for (const block of root.querySelectorAll('.ashby-application-form-field-entry, fieldset, [role="group"]')) {
      const members = [...block.querySelectorAll('button[data-option]')].filter(visible);
      if (members.length && !members.some(m => handled.has(m))) {
        add(members[0], 'radio', members, members.map(text));
        const field = fields[fields.length-1];
        field.label = text(block.querySelector('.ashby-application-form-question-title,legend,label')) || field.label;
        scanned.get(field.id).label = field.label;
      }
    }
    // Several boxes under one label (Address: street / city) differ by placeholder.
    const sameLabel=new Map();
    for(const field of fields)if(!['radio','checkbox'].includes(field.type))sameLabel.set(field.label,(sameLabel.get(field.label) || 0)+1);
    for(const field of fields) {
      const hint=(field.inputHints?.placeholder || '').trim();
      if(sameLabel.get(field.label)>1 && hint && hint.toLowerCase()!==field.label.toLowerCase())field.label=`${field.label} - ${hint}`;
    }
    return {scanId,url:scanUrl,adapter:adapter[1],fields};
  }
  function setValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
  }
  async function discoverOptions(ids) {
    if(location.href!==scanUrl || !scanId)throw new Error('The application page changed. Scan questions again before requesting answers.');
    const entries=ids?ids.map(id=>scanned.get(id)):[...scanned.values()];
    if(entries.some(entry=>!entry))throw new Error('The question scan was cleared. Scan questions again.');
    const currentScan=scanId;
    for(const entry of entries) {
      const {el,field,members}=entry;
      const ensure=()=>{if(scanId!==currentScan || location.href!==scanUrl || !el.isConnected || label(el)!==entry.label && !['radio','checkbox'].includes(field.type))throw new Error('An application question changed. Scan questions again.');};
      ensure();
      if(field.manualOnly)continue;
      if(field.fillMode==='local')continue;
      if(field.type==='select' || field.type==='multiselect') {
        field.options=[...el.options].filter(option=>option.value && !option.disabled && !option.closest('optgroup')?.disabled).map(text);
        field.optionsStatus=field.options.length?'complete':'unavailable';continue;
      }
      if(field.type==='radio' || field.type==='checkbox') {
        field.options=members.map(member=>member.matches('input')?[...(member.labels || [])].map(text).join(' ') || member.getAttribute('aria-label') || member.value:text(member));
        field.optionsStatus=field.options.length?'complete':'unavailable';continue;
      }
      if(field.type!=='combobox' || field.answerFormat==='text')continue;
      const input=comboInput(el),trigger=input || el.querySelector('button[aria-haspopup="listbox"],button[aria-expanded]') || el;
      const labels=new Set(),positions=new Map();let complete=true,attemptedSubmit=false;
      const preventSubmit=event=>{attemptedSubmit=true;event.preventDefault();event.stopImmediatePropagation();};
      document.addEventListener('submit',preventSubmit,true);
      const watch=watchRequests();
      try {
        const before=new Set([...document.querySelectorAll(popupSelector)].filter(visible));
        let lists=comboLists(el);
        if(!lists.some(visible)) {
          if(trigger.matches('button,input[type="submit"],input[type="image"]') && ['submit','image'].includes(trigger.type) && trigger.form)throw new Error('This dropdown trigger could submit the form.');
          el.scrollIntoView({block:'center'});focusControl(trigger);
          if(!comboLists(el).some(visible)){pressControl(trigger);trigger.click();}
        }
        const openLists=()=>{
          ensure();if(attemptedSubmit)throw new Error('This dropdown tried to submit the form.');
          const owned=comboLists(el).filter(visible);
          if(owned.length && owned.some(list=>listOptions([list]).length))return owned;
          const created=[...document.querySelectorAll(popupSelector)].filter(list=>visible(list) && !before.has(list));
          return created.length===1 && listOptions(created).length?created:null;
        };
        lists=await waitFor(openLists,500) || (arrowDown(trigger),await waitFor(openLists,2500)) || lists;
        observedLists.set(el,lists);
        await pause(60);
        const loadedOnOpen=watch.seen.length>0;
        let expected=0;
        const collect=()=>{
          ensure();
          for(const option of listOptions(lists)) {
            const label=text(option);if(label)labels.add(label);
            expected=Math.max(expected,Number(option.getAttribute('aria-setsize')) || 0);
          }
          for(const list of lists)expected=Math.max(expected,Number(list.getAttribute('aria-setsize')) || 0);
        };
        collect();
        for(const list of lists.filter(visible)) {
          const scroller=optionScroller(list);
          if(!scroller)continue;
          positions.set(scroller,scroller.scrollTop);scroller.scrollTop=0;scroller.dispatchEvent(new Event('scroll',{bubbles:true}));await pause(80);collect();
          let bottom=false;
          for(let step=0;step<120 && labels.size<2000;step++) {
            ensure();
            const next=Math.min(scroller.scrollTop+Math.max(1,Math.floor(scroller.clientHeight*0.8)),scroller.scrollHeight-scroller.clientHeight);
            if(next<=scroller.scrollTop) {
              const height=scroller.scrollHeight;await pause(160);collect();
              if(height===scroller.scrollHeight){bottom=true;break;}continue;
            }
            scroller.scrollTop=next;scroller.dispatchEvent(new Event('scroll',{bubbles:true}));await pause(80);collect();
          }
          if(!bottom)complete=false;
        }
        if(expected>labels.size || lists.some(list=>list.getAttribute('aria-busy')==='true'))complete=false;
        field.options=[...labels];field.optionsStatus=!labels.size?'unavailable':complete?'complete':'partial';
        field.answerFormat=multiChoice(el,lists,field.label)?'multiple':'single';
        // No choices until something is typed, choices that come from the server,
        // or too many to send: ChatGPT supplies plain text and the fill narrows to it.
        const editable=!!input && !input.readOnly,single=field.answerFormat!=='multiple';
        const tooLong=labels.size>LONG_LIST && single;
        const fromServer=editable && single && !!labels.size && (loadedOnOpen || tooLong || await searchesServer(input,watch));
        if((!labels.size || tooLong || fromServer) && editable){entry.fullOptions=[...labels];field.options=[];field.answerFormat='text';field.fillMode='search';field.optionsStatus='not-applicable';}
        delete field.optionsError;
      }catch(error){
        ensure();field.options=[...labels];field.optionsStatus=labels.size?'partial':'unavailable';field.optionsError=error.message;
      }finally{
        watch.stop();
        for(const [scroller,position] of positions)if(scroller.isConnected){scroller.scrollTop=position;scroller.dispatchEvent(new Event('scroll',{bubbles:true}));}
        if(trigger.isConnected)dismissCombo(el);
        document.removeEventListener('submit',preventSubmit,true);
      }
    }
    return {scanId:currentScan,url:scanUrl,fields:entries.map(entry=>entry.field)};
  }
  async function fillCombo(entry,answer,ensure,item={}) {
    const {el,field}=entry,input=comboInput(el);
    const multiple=field.answerFormat==='multiple',answers=[...new Set([].concat(answer))];
    if(!multiple && answers.length!==1)throw new Error('Choose one dropdown option.');
    let attemptedSubmit=false;
    const preventSubmit=event=>{attemptedSubmit=true;event.preventDefault();event.stopImmediatePropagation();};
    document.addEventListener('submit',preventSubmit,true);
    const check=()=>{ensure();if(attemptedSubmit)throw new Error('The custom control tried to submit the form. Complete it manually.');};
    const click=node=>{
      check();
      const button=node.closest('button,input[type="submit"],input[type="image"]');
      if(button && (button.type==='submit' || button.type==='image') && button.form)throw new Error('This dropdown control may submit the form. Choose it manually.');
      node.click();check();
    };
    let openedLists=[];
    const options=()=>listOptions([...new Set([...comboLists(el),...openedLists.filter(list=>list.isConnected)])]);
    async function open() {
      check();
      const linked=[...comboLists(el),...openedLists.filter(list=>list.isConnected)];
      if(linked.some(list=>visible(list) && listOptions([list]).some(visible)))return;
      const before=new Set([...document.querySelectorAll(popupSelector)].filter(visible));
      const trigger=input || el.querySelector('button[aria-haspopup="listbox"],button[aria-expanded]') || el;
      el.scrollIntoView({block:'center'});focusControl(trigger);if(!comboLists(el).some(visible)){pressControl(trigger);click(trigger);}
      const openLists=()=>{
        check();
        const owned=comboLists(el).filter(visible);
        if(owned.length)return owned;
        const created=[...document.querySelectorAll(popupSelector)].filter(list=>visible(list) && !before.has(list));
        return created.length===1?created:null;
      };
      const lists=await waitFor(openLists,400) || (arrowDown(trigger),await waitFor(openLists,800));
      if(lists){openedLists=lists;observedLists.set(el,lists);}
    }
    function matching(value) {
      const available=options().filter(visible);
      let matches=available.filter(option=>normalized(text(option))===normalized(value));
      if(!matches.length)matches=available.filter(option=>choiceKey(text(option),field)===choiceKey(value,field));
      if(!matches.length && field.allowFreeText) {
        const street=value=>normalized(value).replace(/\bstreet\b/g,'st').replace(/\bavenue\b/g,'ave').replace(/\broad\b/g,'rd');
        matches=available.filter(option=>street(text(option)).startsWith(street(value)+' '));
      }
      if(matches.length>1) {
        if(field.controlKind==='oracle-free-text')return null;
        throw new Error('More than one matching dropdown option. Choose it manually.');
      }
      return matches[0];
    }
    async function seek(value) {
      for(const list of [...new Set([...comboLists(el),...openedLists])].filter(visible)) {
        const scroller=optionScroller(list);if(!scroller)continue;
        scroller.scrollTop=0;scroller.dispatchEvent(new Event('scroll',{bubbles:true}));await pause(80);
        for(let step=0;step<120;step++) {
          check();const found=matching(value);if(found)return found;
          const next=Math.min(scroller.scrollTop+Math.max(1,Math.floor(scroller.clientHeight*0.8)),scroller.scrollHeight-scroller.clientHeight);
          if(next<=scroller.scrollTop)break;
          scroller.scrollTop=next;scroller.dispatchEvent(new Event('scroll',{bubbles:true}));await pause(80);
        }
      }
      return null;
    }
    const selected=option=>option.getAttribute('aria-selected')==='true' || option.getAttribute('aria-checked')==='true';
    const display=()=>{
      if(input?.value)return input.value;
      if(singleValue(el))return singleValue(el);
      if(input)return '';
      if(el.getAttribute('data-value'))return el.getAttribute('data-value');
      const copy=el.cloneNode(true);copy.querySelectorAll(popupSelector+','+optionSelector).forEach(node=>node.remove());return text(copy);
    };
    try {
      if(field.fillMode==='text') {
        if(!input || input.disabled || input.readOnly)throw new Error('This grid control has no editable text input. Complete it manually.');
        check();el.scrollIntoView({block:'center'});focusControl(input);
        const value=String(answer),key=choiceKey(value,field);
        setValue(input,key!==normalized(value)?key:value);
        // Typing may produce a filtered suggestion. Commit only a unique match;
        // never open the complete grid, enumerate it, or scroll through choices.
        const suggestion=await waitFor(()=>{
          check();const matches=options().filter(visible).filter(option=>choiceKey(text(option),field)===key);
          return matches.length===1?matches[0]:null;
        },1200);
        if(suggestion)click(suggestion);
        dismissCombo(el);await pause(160);check();
        if(choiceKey(input.value,field)!==key || input.getAttribute('aria-invalid')==='true')throw new Error('The site rejected the typed value. Review this field manually.');
        return;
      }
      if(field.fillMode==='search') {
        if(!input || input.disabled || input.readOnly)throw new Error('This dropdown has no search box. Choose it manually.');
        check();el.scrollIntoView({block:'center'});
        // These menus only open for a control that was pressed before typing.
        const surface=input.closest('[class*="__control"],[class*="-control"]') || input;
        pressControl(surface);surface.click();focusControl(input);await pause(300);
        const wanted=String(answer),key=choiceKey(wanted,field);
        // Aliases such as USA are typed in the site's own wording.
        const typed=key!==normalized(wanted)?key:wanted;
        // Results arrive from the site: wait until the list stops changing.
        const results=async()=>{
          await pause(300);
          const until=Date.now()+8000;let last=null,since=Date.now();
          while(Date.now()<until) {
            check();
            const shown=options().filter(visible).map(text),signature=shown.join('|');
            if(signature!==last){last=signature;since=Date.now();}
            const busy=[...document.querySelectorAll('[class*="loading-message"],[class*="loadingMessage"],[aria-busy="true"]')].some(visible);
            const empty=[...document.querySelectorAll('[class*="no-options"],[class*="noOptions"]')].some(visible);
            if(!busy && (shown.length || empty) && Date.now()-since>=500)return shown;
            await pause(80);
          }
          return options().filter(visible).map(text);
        };
        // Type the full answer, then shorter forms until the site shows something.
        let suggestion=null,candidates=[],query='';
        for(const value of item.searchText?[item.searchText]:narrowingQueries(typed)) {
          setValue(input,value);
          const shown=await results();
          if(!shown.length)continue;
          query=value;
          const found=closestOption(shown,typed,field);
          if(found.match){suggestion=options().filter(visible).find(option=>text(option)===found.match);break;}
          candidates=found.candidates.length?found.candidates:shown;
          break;
        }
        if(!suggestion) {
          setValue(input,'');dismissCombo(el);
          // The site's search found nothing, but the list read earlier may still hold it.
          if(!candidates.length && entry.fullOptions?.length)candidates=closestOption(entry.fullOptions,typed,field).candidates || [];
          throw choiceError(candidates.length?'Several results could match. Choose it manually.':'The site found no results for this answer. Choose it manually.',candidates,query);
        }
        click(suggestion);
        // Typed text alone proves nothing: the site must also accept the result.
        const committed=await waitFor(()=>{
          check();
          return suggestion.isConnected && selected(suggestion) || !!normalized(display()) && (!suggestion.isConnected || !visible(suggestion) || el.getAttribute('aria-expanded')==='false');
        });
        if(!committed)throw new Error('The site did not confirm the search result. Check manually.');
        return;
      }
      await open();
      if(multiple && multiValues(el).length+options().filter(selected).length===0 && comboControl(el)?.querySelector('[class*="--is-multi"]')) {
        for(const value of answers) {
          await open();const option=matching(value);
          if(!option)throw new Error('No matching dropdown option appeared. Check this field manually.');
          click(option);await pause(120);
        }
        const chosen=multiValues(el).map(value=>choiceKey(value,field));
        if(chosen.length!==answers.length || answers.some(value=>!chosen.includes(choiceKey(value,field))))throw new Error('The multiple-choice selection did not match the approved answers. Check manually.');
        dismissCombo(el);return;
      }
      if(multiple) {
        const initial=options();
        if(!initial.length || initial.some(option=>!option.hasAttribute('aria-selected') && !option.hasAttribute('aria-checked')))throw new Error('This multiple-choice dropdown does not expose its selected options. Complete it manually.');
        for(const option of initial.filter(selected))if(!answers.some(value=>choiceKey(text(option),field)===choiceKey(value,field))) {
          await open();const current=options().find(node=>normalized(text(node))===normalized(text(option)) && visible(node));
          if(!current)throw new Error('A selected dropdown option could not be cleared. Check manually.');
          click(current);await pause(100);
        }
      }
      for(const value of answers) {
        if(multiple)await open();
        let option=matching(value);
        if(!option && input && !input.readOnly && !multiple) {
          setValue(input,String(value));
          option=await waitFor(()=>{check();return matching(value);});
        }
        if(!option && !field.allowFreeText)option=await seek(value);
        if(!option) {
          if(field.allowFreeText && !multiple && input && normalized(input.value)===normalized(value) && (field.controlKind==='oracle-free-text' || !options().some(visible)))continue;
          throw new Error('No matching dropdown option appeared. Check this field manually.');
        }
        const label=text(option),code=option.getAttribute('data-value') || option.getAttribute('value');
        const beforeDisplay=display();
        if(!multiple || !selected(option))click(option);
        const kept=await waitFor(()=>{
          check();
          // Some sites show a short form of the chosen option, such as +1 for "United States +1".
          const shown=normalized(display());
          const valueMatches=choiceKey(display(),field)===choiceKey(label,field) || choiceKey(display(),field)===choiceKey(value,field) || code && display()===code || !!shown && normalized(label).includes(shown);
          const selectionChanged=display()!==beforeDisplay || !option.isConnected || !visible(option) || el.getAttribute('aria-expanded')==='false';
          return option.isConnected && selected(option) || !multiple && valueMatches && selectionChanged;
        });
        if(!kept)throw new Error('The site did not confirm the dropdown selection. Check manually.');
      }
      if(multiple) {
        const chosen=options().filter(selected).map(option=>choiceKey(text(option),field));
        if(chosen.length!==answers.length || answers.some(value=>!chosen.includes(choiceKey(value,field))))throw new Error('The multiple-choice selection did not match the approved answers. Check manually.');
      }
      dismissCombo(el);await pause(160);check();
      if(!multiple && input && !normalized(display()))throw new Error('The site cleared the selected value. Check manually.');
    }finally{document.removeEventListener('submit',preventSubmit,true);}
  }
  // Read the control back after every field is filled: answering one question
  // can re-render or reset another.
  function fieldHolds(entry,item) {
    if(!entry || !entry.el.isConnected)return false;
    const {el,members,field}=entry,answers=[].concat(item.answer);
    if(field.type==='file')return true;
    if(field.type==='combobox') {
      const input=comboInput(el);
      return field.answerFormat==='multiple' || !input || !!normalized(input.value || singleValue(el));
    }
    if(field.type==='select' || field.type==='multiselect') {
      const chosen=[...el.selectedOptions].map(text);
      return chosen.length===answers.length && answers.every(answer=>chosen.includes(answer));
    }
    if(field.type==='radio' || field.type==='checkbox')return members.every((member,index)=>{
      // Button-style choices may show their state only through styling.
      if(!member.matches('input') && !member.hasAttribute('aria-checked') && !member.hasAttribute('aria-pressed'))return true;
      const checked=member.checked===true || member.getAttribute('aria-checked')==='true' || member.getAttribute('aria-pressed')==='true';
      return checked===answers.includes(field.options[index]);
    });
    return !!String(el.value || '').trim();
  }
  async function fillOne(item) {
      const entry = scanned.get(item.id);
      if (!entry || item.scanId !== scanId || !entry.el.isConnected || entry.field.manualOnly) throw new Error('Field changed or requires manual input. Rescan.');
      const {el,members,field} = entry;
      // Earlier answers can come from a previous scan that already read this control.
      for(const name of ['answerFormat','fillMode'])if(item[name]!==undefined)field[name]=item[name];
        if (!['radio','checkbox'].includes(field.type) && label(el) !== entry.label) throw new Error('Question changed. Rescan.');
        if(field.type==='combobox') {
          await fillCombo(entry,item.answer,()=>{if(location.href!==scanUrl || item.scanId!==scanId || !el.isConnected)throw new Error('The application field changed. Rescan before filling.');},item);
        } else if(field.type==='file') {
          if(!field.resumeUpload || !item.file || item.file.name!=='resume.docx')throw new Error('Only the generated resume.docx can be uploaded here.');
          const mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          const accept=(el.accept || '').toLowerCase().split(',').map(value=>value.trim()).filter(Boolean);
          if(accept.length && !accept.some(value=>['.docx',mime,'application/*','*/*'].includes(value)))throw new Error('This upload field does not accept DOCX. Choose a file manually.');
          const bytes=Uint8Array.from(atob(item.file.base64),char=>char.charCodeAt(0));
          entry.uploadArea=el.closest('.file-upload,[role="group"],fieldset,.form-group') || el.parentElement;
          const transfer=new DataTransfer();transfer.items.add(new File([bytes],'resume.docx',{type:mime}));
          el.files=transfer.files;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
          if(el.files[0]?.name!=='resume.docx')throw new Error('The site did not keep the selected file. Upload it manually.');
        } else if (field.type === 'select' || field.type === 'multiselect') {
          if(field.fillMode==='local') {
            const found=closestOption([...el.options].filter(o=>o.value && !o.disabled).map(text),String(item.answer),field);
            if(!found.match)throw choiceError('Several options could match. Choose it manually.',found.candidates,'');
            item.answer=found.match;
          }
          const answers = [].concat(item.answer);const options = [...el.options];
          if (answers.some(answer => !options.some(o => !o.disabled && text(o) === answer))) throw new Error('Option changed or missing.');
          for (const option of options) option.selected = answers.includes(text(option));
          el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
        } else if (field.type === 'radio' || field.type === 'checkbox') {
          const answers = [].concat(item.answer);const labels = field.options;
          if (answers.some(a => !labels.includes(a))) throw new Error('Choose an exact option.');
          for (let i=0;i<members.length;i++) {
            const member = members[i], desired = answers.includes(labels[i]);
            if (member.tagName === 'BUTTON' && (member.type || 'submit') === 'submit') throw new Error('This option may submit the form. Choose it manually.');
            const checked = member.checked === true || member.getAttribute('aria-checked') === 'true' || member.getAttribute('aria-pressed') === 'true';
            if (field.type === 'radio' ? desired && !checked : desired !== checked) member.click();
          }
        } else {
          focusControl(el);setValue(el,String(item.answer));blurControl(el);
          // Input masks restyle values such as phone numbers; losing the content is the failure.
          const compact=value=>String(value).toLowerCase().replace(/[^a-z0-9]/g,'');
          const kept=compact(el.value),wanted=compact(item.answer);
          if(wanted && (!kept || !kept.includes(wanted) && !wanted.includes(kept)))throw new Error('Site reformatted or rejected the value. Check manually.');
        }
  }
  async function fill(items) {
    if (location.href !== scanUrl) throw new Error('The application page changed. Scan and review again.');
    const errors=new Map();
    const attempt=async item=>{try{await fillOne(item);errors.delete(item);}catch(error){errors.set(item,error);}};
    for(const item of items)await attempt(item);
    await pause(400);
    for(const item of items) {
      const failed=errors.get(item);
      // Search results that need a decision go back to ChatGPT rather than being retried.
      if(item.file || location.href!==scanUrl || failed?.candidates || /submit/i.test(failed?.message || ''))continue;
      if(!failed && fieldHolds(scanned.get(item.id),item))continue;
      await attempt(item);
      await pause(200);
      if(!errors.has(item) && !fieldHolds(scanned.get(item.id),item))errors.set(item,new Error('The site cleared this answer. Check it manually.'));
    }
    return items.map(item=>{
      const failed=errors.get(item);
      return failed?{id:item.id,error:failed.message,...(failed.candidates?.length?{candidates:failed.candidates,query:failed.query}:{})}:{id:item.id,filled:true};
    });
  }
  // Attaching a file only starts the upload. Wait for the site to finish it.
  async function uploadFinished(id,ms=45000) {
    const entry=scanned.get(id);
    if(!entry)return {status:'failed',message:'The upload field changed. Check it on the form.'};
    const area=()=>entry.uploadArea?.isConnected?entry.uploadArea:document.body;
    const progress='[role="progressbar"],progress,[class*="progress" i]';
    const busy=()=>[...area().querySelectorAll(progress)].some(visible);
    await pause(300);
    const until=Date.now()+ms;
    while(busy() && Date.now()<until)await pause(200);
    if(busy())return {status:'stuck',message:'The site started uploading resume.docx but did not finish.'};
    await pause(300);
    const nameShown=normalized(text(area())).includes('resume docx');
    if(nameShown || entry.el.isConnected && entry.el.files?.[0]?.name==='resume.docx')return {status:'done'};
    return {status:'failed',message:'The site did not keep resume.docx.'};
  }
  // Screens only the user can get past. Invisible reCAPTCHA badges don't count.
  function blocker() {
    const onScreen=el=>{const box=el.getBoundingClientRect();return visible(el) && box.width>30 && box.height>30 && box.bottom>0 && box.right>0;};
    const captcha='iframe[src*="recaptcha/api2/bframe"],iframe[src*="recaptcha/enterprise/bframe"],iframe[src*="recaptcha/api2/anchor"]:not([src*="size=invisible"]),iframe[src*="recaptcha/enterprise/anchor"]:not([src*="size=invisible"]),iframe[src*="hcaptcha.com"],iframe[src*="challenges.cloudflare.com"]';
    if([...document.querySelectorAll(captcha)].some(onScreen))return {kind:'captcha',message:'Solve the CAPTCHA on the page. Auto-fill will continue by itself.'};
    if([...document.querySelectorAll('input[type="password"]')].some(visible))return {kind:'login',message:'This site needs an account. Sign in or create one on the page. Auto-fill will continue by itself.'};
    if(/security code|verification code|enter the code|one[- ]time (?:pass)?code|code (?:was |has been )?sent/i.test(document.body?.innerText || '')) {
      const hint=input=>[input.name,input.id,input.placeholder,input.getAttribute('aria-label'),input.autocomplete,input.labels?.[0]?.innerText].join(' ');
      if([...document.querySelectorAll('input:not([type="hidden"])')].some(input=>visible(input) && /\bcode\b|otp|verif|one.?time/i.test(hint(input))))return {kind:'verification-code',message:'Enter the code the site sent you. Auto-fill will continue by itself.'};
    }
    return null;
  }
  // Only an exact Next-style button, and never on a page offering a final action.
  function nextButton() {
    const name=button=>text(button) || button.value || button.getAttribute('aria-label') || '';
    const buttons=[...document.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"]')].filter(button=>visible(button) && !button.disabled && button.getAttribute('aria-disabled')!=='true' && !button.closest('header,nav,footer,[id*="cookie" i],[class*="cookie" i]'));
    if(buttons.some(button=>/\b(?:submit|send application|finish|complete application)\b|^apply(?: now)?$/i.test(name(button))))return null;
    return buttons.find(button=>/^(?:next|next step|next page|continue|save (?:and|&) continue|save (?:and|&) next|review)$/i.test(name(button).trim())) || null;
  }
  function clickNext() {
    const button=nextButton();
    if(!button)return null;
    const name=text(button) || button.value || 'Next';
    // After returning, because the click can replace this page.
    setTimeout(()=>button.click(),50);
    return {clicked:name};
  }
  async function settled() {
    if (document.readyState !== 'complete') throw new Error('Page is still loading. Retry after it finishes.');
    return new Promise(resolve => {
      let quiet, observer;
      const finish = () => {clearTimeout(quiet);clearTimeout(limit);observer.disconnect();resolve(true);};
      const schedule = () => {clearTimeout(quiet);quiet = setTimeout(finish,1000);};
      observer = new MutationObserver(schedule);
      observer.observe(document.body,{childList:true,subtree:true,characterData:true});
      const limit = setTimeout(() => {clearTimeout(quiet);observer.disconnect();resolve(false);},12000);
      schedule();
    });
  }
  globalThis.ResumeApplyPage = {version,job, scan, fill, settled,discoverOptions,blocker,clickNext,uploadFinished};
})();
