(() => {
  const version=31;
  if (globalThis.ResumeApplyPage && globalThis.ResumeApplyPage.version===version) return;
  // Controls you changed yourself on this page (real clicks and keys; the extension's own
  // fills are not counted). Kept across newer copies of these tools.
  const touched=globalThis.ResumeApplyTouched ||= new WeakSet();
  if(!globalThis.ResumeApplyTouchListening) {
    globalThis.ResumeApplyTouchListening=true;
    for(const name of ['input','change'])document.addEventListener(name,event=>{if(event.isTrusted && event.target instanceof Element)touched.add(event.target);},true);
  }
  // The control still shows what the page started with and you have not changed it: a
  // site default, such as a dropdown that opens on a real option, is not an answer.
  function preset(el,members,type) {
    members=members || [];
    if(touched.has(el) || members.some(member=>touched.has(member)))return false;
    if(type==='select' || type==='multiselect') {
      if(el.tagName!=='SELECT' || !el.selectedOptions.length)return false;
      const chosen=[...el.selectedOptions],defaults=[...el.options].filter(option=>option.defaultSelected);
      // With no option marked as the default, the browser shows the first one.
      return defaults.length?chosen.length===defaults.length && chosen.every(option=>option.defaultSelected):chosen.length===1 && el.selectedIndex===0;
    }
    if(type==='radio' || type==='checkbox') {
      if(!members.length || !members.every(member=>member.matches('input')))return false;
      return members.some(member=>member.checked) && members.every(member=>member.checked===member.defaultChecked);
    }
    return false;
  }
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
  // The user's own last click or key press. Everything the extension does is
  // synthetic (isTrusted false), so this separates the user's Submit from a
  // submit triggered by a dropdown the extension is operating.
  if(!globalThis.ResumeApplyUserInput) {
    const input=globalThis.ResumeApplyUserInput={at:0,target:null,key:''};
    for(const type of ['pointerdown','mousedown','click','keydown'])document.addEventListener(type,event=>{
      if(!event.isTrusted)return;
      Object.assign(input,{at:Date.now(),target:event.target,key:type==='keydown'?event.key:''});
    },true);
  }
  function userSubmit(event) {
    const {at,target,key}=globalThis.ResumeApplyUserInput || {};
    if(!target || Date.now()-at>1500)return false;
    const submitter=event.submitter;
    if(submitter && (submitter===target || submitter.contains(target)))return true;
    // Enter in a field of this form (implicit submission), or Space/Enter on its button.
    return ['Enter',' '].includes(key) && !!event.target?.contains?.(target);
  }
  // Postings often escape their HTML once more (&lt;p&gt;): parsed once, that is HTML again,
  // so it is parsed until no tags are left.
  const htmlTag=/<\/?[a-z][a-z0-9-]*(?:\s[^<>]*)?\/?>/i;
  function htmlText(html) {
    let value = String(html);
    for (let pass = 0; pass < 4; pass++) {
      const doc = new DOMParser().parseFromString(value, 'text/html');
      doc.querySelectorAll('script,style,iframe').forEach(el => el.remove());
      doc.querySelectorAll('p,div,br,li,h1,h2,h3,h4,tr,ul,ol').forEach(el => el.append(doc.createTextNode('\n')));
      value = doc.body.textContent;
      if (!htmlTag.test(value)) break;
    }
    return value.replace(/[ \t ]+\n/g, '\n').replace(/\n[ \t ]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  // Job board containers: iCIMS (.iCIMS_JobContainer), SAP SuccessFactors career sites (.jobDisplay)
  // and Paylocity (.job-preview-details).
  // They also hold Apply and Share buttons, FAQ links, footers and inline styles: those are left out.
  const BOARD_EXTRAS = '.iCIMS_JobOptions, .iCIMS_JobOptionsMobile, .iCIMS_Action_Button, .iCIMS_BroadcastJob, .iCIMS_Faq_Link, .iCIMS_PageFooter, .iCIMS_Navigation, .iCIMS_ErrorMsg, .iCIMS_Message, .iCIMS_Logo, .iCIMS_NoDisplay, .applylink, .btn-social-apply, .social-icons, #unifyJobFooter, .mobile-apply-btn, .preview-bottom-apply-btn, .apply-link-marker, .powered-by-paylo, [class*="aria-"][class*="-hidden"], script, style, button';
  function boardText(container) {
    const copy = container.cloneNode(true);
    copy.querySelectorAll(BOARD_EXTRAS).forEach(el => el.remove());
    return htmlText(copy.innerHTML);
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
    // Job boards whose posting sits in a container of their own, on any employer's domain.
    const boardDescription = [...document.querySelectorAll('.iCIMS_JobContainer, .iCIMS_InfoMsg_Job, .jobDisplay, .job-preview-details')].filter(visible).sort((a,b) => text(b).length - text(a).length)[0];
    const siteDescription = boardDescription || (adapter[1] === 'generic' ? null : document.querySelector(adapter[2]));
    const candidates = [...document.querySelectorAll('[class*="description" i], [id*="description" i], article, main')].filter(visible).sort((a,b) => text(b).length - text(a).length);
    const fromSite = siteDescription && (boardDescription ? boardText(boardDescription) : text(siteDescription));
    const fromPosting = posting && htmlText(posting.description || '');
    let description = fromSite || fromPosting || (candidates[0] && (candidates[0].innerText || text(candidates[0]))) || '';
    // How sure the description is: the site's own container or posting data, or a guess from the page.
    const found = fromSite ? 'site' : fromPosting ? 'posting' : 'page';
    // Tags shown as text on the page itself (a site that escaped its own HTML).
    if (htmlTag.test(description)) description = htmlText(description);
    const company = posting && posting.hiringOrganization && posting.hiringOrganization.name || (/ at (.+)$/.exec(document.title) || [])[1] || '';
    return {title:posting && posting.title || text(document.querySelector(adapter[3])) || document.title, company, description:description.slice(0,200000), source:adapter[1], found, url:location.href};
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
  // Choices and text boxes drawn without native inputs (a div with role="checkbox", a
  // contenteditable box) are questions too.
  const ariaChoices='[role="checkbox"],[role="radio"],[role="switch"]';
  const editableSelector='[contenteditable]:not([contenteditable="false"])';
  const scanSelector=`input,textarea,select,[role="combobox"],[role="radiogroup"],${ariaChoices},${editableSelector}`;
  const questionControls=`input:not([type="hidden"]),select,textarea,[role="combobox"],[role="radiogroup"],${ariaChoices},${editableSelector}`;
  const editableBox=el=>!!el && !el.matches('input,textarea,select') && el.isContentEditable;
  const fieldText=el=>editableBox(el)?text(el):el.value;
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
      let nearest=true;
      for(let prev=node.previousSibling;prev;prev=prev.previousSibling) {
        if(prev.nodeType===3){const value=prev.textContent.replace(/\s+/g,' ').trim();if(value)return value;continue;}
        if(prev.nodeType!==1 || prev.matches('script,style,template,button,'+popupSelector) || !visible(prev))continue;
        // A small heading right above the field is its question (Breezy); a section title is not.
        if(nearest && prev.matches('h3,h4,h5,h6') && !prev.querySelector(questionControls)){const value=text(prev);if(value)return value.length<=500?value:'';}
        nearest=false;
        if(prev.matches('h1,h2,h3,'+questionControls) || prev.querySelector(questionControls))return '';
        const value=text(prev);
        if(value)return value.length<=500?value:'';
      }
    }
    return '';
  }
  // The text above a file box, past its own "Choose File / No file selected" widget.
  const fileWidgetText=/^(?:choose|select|browse|upload|attach|drop|drag)\b.*|^no file(?:s)? (?:selected|chosen)$/i;
  function fileQuestion(el) {
    for(let node=el,depth=0;node && depth<4 && !node.matches('form,body');node=node.parentElement,depth++) {
      for(let prev=node.previousElementSibling;prev;prev=prev.previousElementSibling) {
        if(!visible(prev) || prev.matches('script,style,template'))continue;
        if(prev.querySelector('input:not([type="hidden"]),select,textarea'))return '';
        const value=text(prev);
        if(!value || fileWidgetText.test(value) || prev.querySelector('button') && /choose file|no file/i.test(value))continue;
        return value.length<=200?value:'';
      }
    }
    return '';
  }
  function label(el) {
    const block = el.closest('[data-automation-id^="formField-"], .ashby-application-form-field-entry, .application-question, .form-group, fieldset, [role="group"], [role="radiogroup"]');
    const blockLabel = block && text(block.querySelector('legend, .ashby-application-form-question-title, .application-label, .question-title, label'));
    const labelled = [...(el.labels || [])].map(ownText).join(' ');
    // A dropdown button's own name repeats its current choice (Workday: "Country United States
    // of America Required"), so the question is its <label>: the same text before and after a choice.
    const shadow = el.matches('button[aria-haspopup],[role="button"][aria-haspopup]') && shadowSelectOf(el);
    const menu = el.matches('button[aria-haspopup],[role="button"][aria-haspopup]') && (labelled || shadow && [...(shadow.labels || [])].map(ownText).join(' ') || blockLabel);
    const direct = menu || ariaName(el) || labelled;
    // A date split into parts (Workday: Month / Day / Year) names only the part; the question is on its block.
    if(direct && blockLabel && el.getAttribute('role')==='spinbutton' && !normalized(direct).includes(normalized(cleanLabel(blockLabel)))) {
      const head=cleanLabel(blockLabel),starred=labelStarred,result=cleanLabel(`${head} - ${direct}`);
      labelStarred=starred || labelStarred;return result;
    }
    return cleanLabel(direct || blockLabel || precedingText(el) || el.placeholder || el.name || el.id || 'Unlabelled field');
  }
  // The question for a radio/checkbox group. An option's own label is never the
  // question, and a heading shared with other questions only counts as a last resort.
  function groupLabel(members) {
    const belongs=control=>members.some(member=>member===control || member.contains(control) || control.contains(member));
    const isOption=node=>members.some(member=>node.contains(member) || [...(member.labels || [])].includes(node));
    let group=members[0].parentElement;
    while(group && !members.every(member=>group.contains(member)))group=group.parentElement;
    const common=members.length>1?group:null;
    for(let depth=0;group && depth<4 && !group.matches('form,body');group=group.parentElement,depth++) {
      if([...group.querySelectorAll(questionControls)].some(control=>!belongs(control)))break;
      const title=[...group.querySelectorAll('legend,.application-label,.ashby-application-form-question-title,.question-title,label')].find(node=>!isOption(node) && text(node));
      const name=ariaName(group) || (title ? ownText(title) : '');
      if(name)return cleanLabel(name);
    }
    // Text beside the first choice, else above the box holding every choice (Gem).
    return cleanLabel(precedingText(members[0].closest('label') || members[0]) || (common && precedingText(common)) || '');
  }
  let scanned = new Map(), scanUrl = '', scanId = '';
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const normalized=value=>String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  // Sites change the #hash or query while you work (tabs, "#" links, step state).
  // That is the same document; a real navigation clears this script's scan anyway,
  // and replaced controls are caught by isConnected.
  const pageKey=url=>{try{const u=new URL(url);return u.origin+u.pathname;}catch(_){return String(url);}};
  const samePage=()=>pageKey(location.href)===pageKey(scanUrl);
  // Validation text ("This field is required") or a counter can be added to a
  // label after interaction. A different question shares neither start nor text.
  const sameQuestion=(now,before)=>{const a=normalized(now),b=normalized(before);return a===b || !!b && (a.startsWith(b) || a.endsWith(b));};
  const comboInput=el=>el.matches('input,textarea')?el:el.querySelector('input:not([type="hidden"]),textarea');
  // Oracle Candidate Experience exposes dropdown choices as a grid of cells,
  // not listbox options. Restrict grid support to its selection-menu markup.
  // Menus opened from a plain button (Gem's "Please select") list menu items instead.
  const popupSelector='[role="listbox"],[role="menu"],menu,.cx-select__list';
  // Workday's searchable prompts list their choices as multiselectlistitem rows.
  const optionSelector='[role="option"],[role="menuitem"],[role="menuitemradio"],[role="gridcell"].cx-select__list-item,[data-uxi-widget-type="multiselectlistitem"]';
  // Workday: a searchable prompt ("How did you hear about us?", school) is a text box whose
  // choices appear after typing and Enter; the choice is shown as a "selected item" beside it.
  const workdayPrompt=el=>!!el && el.getAttribute('data-uxi-widget-type')==='selectinput';
  const workdayChosen=el=>{
    const box=el.closest('[data-automation-id^="formField-"]') || el.closest('[data-automation-id="multiselectInputContainer"]')?.parentElement;
    return [...(box?.querySelectorAll('[data-automation-id="selectedItem"]') || [])].map(text).filter(Boolean);
  };
  // Workday keeps a hidden text box beside its "Select One" button, for validation only.
  // It is not always marked hidden; with no name of its own it is still only the button's shadow.
  const validationOnly=input=>input.getAttribute('aria-hidden')==='true' || input.tabIndex<0 || !input.labels?.length && !ariaName(input) && !input.placeholder;
  const listboxButton=':scope > button[aria-haspopup="listbox"],:scope > [role="button"][aria-haspopup="listbox"]';
  // A button that only says "Please select" is a dropdown waiting for a choice.
  const placeholderText=/^[\s\-–—]*(?:please )?(?:select|choose)(?: (?:one|an? option|an? answer|from list))?(?:\.\.\.|…)?[\s\-–—]*$/i;
  const menuButton=el=>(el.tagName==='BUTTON' || el.getAttribute('role')==='button') && !comboInput(el);
  const menuButtonValue=el=>placeholderText.test(text(el))?'':text(el);
  // BambooHR draws a dropdown as a button (aria-haspopup="true") over a hidden, empty <select>
  // that only carries the label and the form value. The button is the question.
  const menuOpener='button[aria-haspopup],[role="button"][aria-haspopup]';
  const hiddenSelect=el=>el.tagName==='SELECT' && (el.getAttribute('aria-hidden')==='true' || el.tabIndex<0);
  function shadowSelectOf(button) {
    for(let node=button.parentElement,depth=0;node && depth<4 && !node.matches('form,body');node=node.parentElement,depth++) {
      const found=[...node.querySelectorAll('select')].filter(hiddenSelect);
      if(found.length===1 && node.querySelectorAll(menuOpener).length<=2)return found[0];
      if(found.length>1 || node.querySelectorAll(questionControls).length>2)return null;
    }
    return null;
  }
  const selectShadow=el=>{
    if(!hiddenSelect(el))return false;
    for(let node=el.parentElement,depth=0;node && depth<3 && !node.matches('form,body');node=node.parentElement,depth++) {
      const opener=node.querySelector(menuOpener);
      if(opener)return shadowSelectOf(opener)===el;
    }
    return false;
  };
  const observedLists=new WeakMap();
  function comboLists(el) {
    const input=comboInput(el);
    const ids=[el,input].filter(Boolean).flatMap(node=>[node.getAttribute('aria-controls'),node.getAttribute('aria-owns')]).filter(Boolean).join(' ').split(/\s+/);
    const prompt=workdayPrompt(input) && input.getAttribute('data-uxi-multiselect-id');
    const promptLists=prompt?[...document.querySelectorAll(`[data-uxi-widget-type="multiselectlistitem"][data-uxi-multiselect-id="${CSS.escape(prompt)}"]`)].map(item=>item.parentElement).filter(Boolean):[];
    return [...new Set([...ids.map(id=>document.getElementById(id)).filter(Boolean),...el.querySelectorAll(popupSelector),...promptLists,...(observedLists.get(el) || []).filter(list=>list.isConnected)])];
  }
  // A listbox whose rows carry no role (Workday's "Select One" menus) lists its <li> rows.
  const listOptions=lists=>[...new Set(lists.flatMap(list=>{
    const found=[...list.querySelectorAll(optionSelector)];
    return found.length || !list.matches('[role="listbox"]')?found:[...list.querySelectorAll('li')];
  }))].filter(option=>option.getAttribute('aria-disabled')!=='true' && !option.disabled);
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
  const singleValue=el=>text(comboControl(el)?.querySelector('[class*="single-value"],[class*="singleValue"]')) || (workdayPrompt(comboInput(el))?workdayChosen(el).join(', '):'');
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
      // Several options all fit the answer: a real choice, not a weak guess.
      if(hits.length>1)return {candidates:hits,close:true};
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
    const found=await waitFor(()=>watch.seen.length>0 || null,800);
    setValue(input,'');
    // Let the follow-up request finish so it isn't credited to the next dropdown.
    await pause(found?300:60);
    return !!found;
  }
  // Site searches match the typed text literally: "University of California,
  // Berkeley" finds nothing where the option reads "University of California -
  // Berkeley". So also try the site's other separator and the distinctive part
  // after a comma ("Berkeley") before dropping words from the start.
  function narrowingQueries(value) {
    const plain=String(value).replace(/\s*\([^)]*\)/g,'').replace(/\s+/g,' ').trim() || String(value);
    const parts=plain.split(/\s*,\s*/).filter(Boolean),first=parts[0] || plain;
    const queries=[value,plain];
    if(parts.length>1) {
      queries.push(parts.join(' - '));
      // A short tail is a state or country code ("San Francisco, CA"), which finds unrelated places.
      for(const part of parts.slice(1))if(part.replace(/[^\p{L}]/gu,'').length>=4)queries.push(part);
    }
    queries.push(first);
    let words=first.split(/\s+/);
    for(let added=0;words.length>1 && added<3;) {
      words=words.slice(0,-1);
      if(words.join(' ').length>=3){queries.push(words.join(' '));added++;}
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
      const field = {id, scanId, type, name:el.name || '', label:label(el), required:labelStarred || !!el.required || el.getAttribute('aria-required') === 'true', options:options || [], value:type === 'password' ? '' : fieldText(el) || ''};
      const input=el.matches('input,textarea')?el:comboInput(el);
      if(input)field.inputHints=Object.fromEntries(Object.entries({placeholder:input.getAttribute('placeholder'),autocomplete:input.getAttribute('autocomplete'),inputMode:input.getAttribute('inputmode'),pattern:input.getAttribute('pattern'),maxLength:input.maxLength>0?input.maxLength:null}).filter(([,value])=>value!=null && value!==''));
      if ((type === 'radio' || type === 'checkbox') && members.length > 1) {field.label = groupLabel(members) || el.name || field.label;if(labelStarred)field.required=true;}
      field.answered=['radio','checkbox'].includes(type)?members.some(member=>member.checked===true || member.getAttribute('aria-checked')==='true' || member.getAttribute('aria-pressed')==='true'):type==='file'?el.files?.length>0:type==='combobox'?!!(comboInput(el)?.value || singleValue(el) || multiValues(el).length):!!String(fieldText(el) || '').trim();
      field.preset=field.answered && preset(el,members,type);
      const scannedLabel=field.label;
      if(type==='file') {
        // The label on the input is often just "Attach"; the question is on its group.
        const groupName=el.closest('[role="group"][aria-labelledby]') && ariaName(el.closest('[role="group"][aria-labelledby]'));
        if(groupName){field.label=cleanLabel(groupName);if(labelStarred)field.required=true;}
        // A drop zone's own text is an instruction ("Drop or select (.pdf)"); the field's name is
        // linked to it for screen readers instead (Rippling: "R\u00e9sum\u00e9").
        const owner=!groupName && /^(?:drop|drag|select|choose|upload|browse|attach|click)\b/i.test(field.label) && el.closest('[aria-labelledby]');
        const ownerName=owner && ariaName(owner).replace(/\btotal \d+ files? selected\b/ig,'').trim();
        if(ownerName){field.label=cleanLabel(ownerName);if(labelStarred)field.required=true;}
        // A name like "file-input" is the widget's, not the question's (BambooHR): use the text above it.
        if(/^(?:file[\s_-]*(?:input|upload)?|upload|attachment|unlabelled field)$/i.test(field.label)) {
          const above=fileQuestion(el);
          if(above){field.label=cleanLabel(above);if(labelStarred)field.required=true;}
        }
      }
      // Test ids name the upload when its text does not ("input-resume", "cover_letter").
      const testIds=type==='file'?[el,el.closest('label')].map(node=>node?.getAttribute('data-testid') || '').concat([...(el.parentElement?.parentElement?.querySelectorAll('input[type="hidden"]') || [])].map(node=>node.name)).join(' '):'';
      if(type==='file'){field.accept=el.accept || '';field.resumeUpload=/resume|r[e\u00e9]sum[e\u00e9]|\bcv\b|curriculum vitae/i.test(field.label+' '+field.name+' '+el.id+' '+testIds) && !/cover.?letter|portfolio/i.test(field.label+' '+field.name+' '+testIds);}
      // Upload widgets often clear the input once the file is sent and show its name instead,
      // so a resume you (or the site) already attached is seen by its file name next to the field.
      if(field.resumeUpload && !field.answered) {
        const area=el.closest('.file-upload,[role="group"],fieldset,.form-group') || el.parentElement;
        field.answered=/(?:^|[\s"'(])\w[\w\-()]*\.(?:pdf|docx?|rtf|odt)\b/i.test(area?.innerText || '');
      }
      // Only the question itself counts: "Are you employed by X? By answering Yes, I consent to
      // texts..." asks about employment, while "Do you consent to ...?" is yours to answer.
      const question = /^[^?]{8,}\?/.exec(field.label)?.[0] || field.label;
      const manualOnly = (type==='file' && !field.resumeUpload) || ['password','unsupported'].includes(type) || /\bsignature\b|\bcertif(?:y|ication)\b|\bconsent\b|\bagree\b|\battest\b|\bterms\b|\bprivacy (?:policy|notice)\b|\bcaptcha\b/i.test(question) || /consent|signature|agree|terms/i.test(field.name);
      field.manualOnly = manualOnly;
      scanned.set(id, {el, members, field, label:type==='file'?scannedLabel:field.label});
      fields.push(field);
      members.forEach(member => handled.add(member));
    }
    // Choices without a name (Gem) belong together when they share a small container.
    function namelessGroup(el, type) {
      for (let node=el.parentElement, depth=0; node && depth<3 && node!==root; node=node.parentElement, depth++) {
        const group=[...node.querySelectorAll(`input[type="${type}"]`)].filter(m => !m.name && !handled.has(m));
        if (group.length>1) return group;
      }
      return [el];
    }
    for (const el of root.querySelectorAll(scanSelector)) {
      const custom=el.getAttribute('role')==='combobox' || el.hasAttribute('aria-autocomplete') || workdayPrompt(el);
      if (el.matches('input') && validationOnly(el) && el.parentElement?.querySelector(listboxButton)) continue;
      if (selectShadow(el)) continue;
      if (handled.has(el) || siteFurniture(el) || trapField(el) || el.disabled || el.getAttribute('aria-disabled')==='true' || el.readOnly && !custom || el.closest(popupSelector)) continue;
      const role=el.getAttribute('role') || '',native=el.matches('input,select,textarea');
      // Only the outermost editable box is the field; its paragraphs are editable too.
      if (!native && el.matches(editableSelector) && (!el.isContentEditable || el.parentElement?.isContentEditable)) continue;
      let type = el.tagName === 'SELECT' ? 'select' : custom ? 'combobox' : el.tagName === 'TEXTAREA' || editableBox(el) ? 'textarea' : !native && role==='radio' ? 'radio' : !native && ['checkbox','switch'].includes(role) ? 'checkbox' : el.type || 'text';
      if (['hidden','button','submit','reset','image'].includes(type)) continue;
      // A styled choice often hides its input and shows only its label.
      const shownByLabel=['radio','checkbox'].includes(el.type) && [...(el.labels || [])].some(visible);
      if (type !== 'file' && !visible(el) && !shownByLabel) continue;
      // Choices drawn as role="checkbox" / role="radio" elements outside a radiogroup.
      if (!native && ['radio','checkbox'].includes(type) && role!=='radiogroup') {
        if (type==='radio' && el.closest('[role="radiogroup"]')) continue;
        const same=m=>!m.matches('input') && (type==='radio'?m.getAttribute('role')==='radio':['checkbox','switch'].includes(m.getAttribute('role'))) && !handled.has(m) && visible(m) && !m.closest(popupSelector);
        const box=el.closest('fieldset,[role="group"],[data-automation-id^="formField-"],.application-question');
        let members=box?[...box.querySelectorAll(ariaChoices)].filter(same):[];
        for (let node=el.parentElement,depth=0;members.length<2 && node && depth<3 && node!==root;node=node.parentElement,depth++)members=[...node.querySelectorAll(ariaChoices)].filter(same);
        if (!members.includes(el)) members=[el];
        add(el,type,members,members.map(m=>ariaName(m) || text(m)));
        continue;
      }
      if (el.getAttribute('role') === 'radiogroup') {
        const members = [...el.querySelectorAll('[role="radio"]')];
        if (members.length) add(el,'radio',members,members.map(text));
        continue;
      }
      // The hidden checkbox behind button choices (Ashby's Yes / No) is read through its buttons.
      if (type === 'checkbox' && el.parentElement?.querySelector(':scope > button[data-option]')) continue;
      if (['checkbox','radio'].includes(type)) {
        const container = el.closest('fieldset,[role="group"],.application-question,.ashby-application-form-field-entry') || el.form || root;
        let members = el.name ? [...container.querySelectorAll('input')].filter(m => m.type === type && m.name === el.name) : namelessGroup(el, type);
        // "Select all that apply" whose every box has its own name (Greenhouse): the fieldset holding
        // only these boxes is the question, and each box is one of its options.
        if (type === 'checkbox' && members.length === 1 && container.matches('fieldset,[role="group"]')) {
          const boxes = [...container.querySelectorAll('input[type="checkbox"]')].filter(m => !handled.has(m) && m.closest('fieldset,[role="group"]') === container);
          const onlyBoxes = [...container.querySelectorAll(questionControls)].every(control => control.matches('input[type="checkbox"]'));
          if (boxes.length > 1 && onlyBoxes && new Set(boxes.map(m => m.name)).size === boxes.length) members = boxes;
        }
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
        // Its choices load only from a search, often in nested categories: answered as text,
        // then searched for on the page.
        field.answerFormat=gridText?'text':multiChoice(el,lists,field.label)?'multiple':freeText?'text':'single';
        if(gridText){field.fillMode='text';field.optionsStatus='not-applicable';}
        if(workdayPrompt(input)){field.controlKind='workday-prompt';field.options=[];field.answerFormat='text';field.fillMode='search';field.optionsStatus='not-applicable';field.answered=!!workdayChosen(el).length;}
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
    // Dropdowns drawn as a plain button that opens a floating menu (Gem's "Please select").
    // A button found once is remembered, so it is still read after a choice replaces its text.
    for (const button of root.querySelectorAll('button,[role="button"][aria-haspopup]')) {
      if (handled.has(button) || !visible(button) || button.disabled || siteFurniture(button) || button.closest(popupSelector)) continue;
      const popup=button.getAttribute('aria-haspopup');
      if (!button.hasAttribute('data-resume-apply-menu') && !placeholderText.test(text(button)) && !['listbox','menu'].includes(popup) && !(popup==='true' && shadowSelectOf(button))) continue;
      const beside=button.parentElement?.querySelector('input:not([type="hidden"]),select,textarea');
      if (button.closest('[role="combobox"]') || button.querySelector('input,select,textarea') || beside && !(beside.matches('input') && validationOnly(beside))) continue;
      if (button.type==='submit' && button.form && !popup) continue;
      button.setAttribute('data-resume-apply-menu','');
      add(button,'combobox',[button],[]);
      const field=fields[fields.length-1];
      field.controlKind='button-menu';field.answerFormat='single';field.allowFreeText=false;field.answered=!!menuButtonValue(button);
    }
    // Workday puts every question in a formField block. One that yielded nothing holds a control
    // this scanner does not know yet: its markup is logged to the page console so it can be added.
    const found=fields.map(field=>scanned.get(field.id)?.el).filter(Boolean);
    const missed=[...root.querySelectorAll('[data-automation-id^="formField-"]')].filter(block=>visible(block) && !found.some(el=>block.contains(el)));
    if(missed.length)console.warn('[Resume Apply] questions with no recognised control:',missed.map(block=>({question:text(block.querySelector('label,legend')) || text(block).slice(0,120),html:block.outerHTML.slice(0,2000)})));
    // Questions in the order the page shows them, including dropdown buttons found last.
    const position=new Map(fields.map(field=>[field,scanned.get(field.id)?.el]));
    fields.sort((x,y)=>{const a=position.get(x),b=position.get(y);if(!a || !b || a===b)return 0;return a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1;});
    // Several boxes under one label (Address: street / city) differ by placeholder.
    const sameLabel=new Map();
    for(const field of fields)if(!['radio','checkbox'].includes(field.type))sameLabel.set(field.label,(sameLabel.get(field.label) || 0)+1);
    for(const field of fields) {
      const hint=(field.inputHints?.placeholder || '').trim();
      if(sameLabel.get(field.label)>1 && hint && hint.toLowerCase()!==field.label.toLowerCase())field.label=`${field.label} - ${hint}`;
    }
    return {scanId,url:scanUrl,adapter:adapter[1],site:adapter[1]!=='generic'?adapter[1]:location.hostname.replace(/^www\./,''),fields};
  }
  // A choice drawn as a button, such as Ashby's Yes / No, is often a <button> without a type,
  // which HTML treats as a submit button. One that carries a choice's state is clicked, and
  // any form submission that click would start is stopped. A plain submit button is never clicked.
  const choiceButton=member=>member.hasAttribute('aria-pressed') || member.hasAttribute('data-option') || member.matches('[role="radio"],[role="checkbox"],[role="option"],[role="switch"]');
  function clickChoice(member) {
    const stop=event=>{if(userSubmit(event))return;event.preventDefault();event.stopImmediatePropagation();};
    window.addEventListener('submit',stop,true);
    try {member.click();} finally {window.removeEventListener('submit',stop,true);}
  }
  function setValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
  }
  // The value React holds for a controlled field, read by page-main.js in the
  // page's own world. undefined when the field is not React-controlled (or the
  // helper is absent): then only what the page shows can be checked.
  function reactValue(el) {
    const attr='data-resume-apply-react';
    el.removeAttribute(attr);
    el.dispatchEvent(new CustomEvent('resume-apply-react-value'));
    const raw=el.getAttribute(attr);el.removeAttribute(attr);
    try {return raw?JSON.parse(raw).value:undefined;}catch(_){return undefined;}
  }
  // Types the way the browser does: execCommand fires trusted beforeinput and
  // input events, which components that ignore synthetic input still handle.
  // Only into the field itself; if focus went elsewhere, nothing is typed.
  function typeInto(el,value) {
    focusControl(el);
    if(document.activeElement!==el)return false;
    try{el.select();}catch(_){ /* not selectable */ }
    const typed=value?document.execCommand('insertText',false,value):document.execCommand('delete');
    blurControl(el);
    return typed;
  }
  async function discoverOptions(ids) {
    if(!samePage() || !scanId)throw new Error('The application page changed. Scan questions again before requesting answers.');
    const entries=ids?ids.map(id=>scanned.get(id)):[...scanned.values()];
    if(entries.some(entry=>!entry))throw new Error('The question scan was cleared. Scan questions again.');
    const currentScan=scanId;
    for(const entry of entries) {
      const {el,field,members}=entry;
      const ensure=()=>{if(scanId!==currentScan || !samePage() || !el.isConnected || !sameQuestion(label(el),entry.label) && !['radio','checkbox'].includes(field.type))throw new Error('An application question changed. Scan questions again.');};
      ensure();
      if(field.manualOnly)continue;
      if(field.fillMode==='local')continue;
      // Already read during this scan (an earlier Ask or the automatic retry).
      if(entry.discovered)continue;
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
      const preventSubmit=event=>{if(userSubmit(event))return;attemptedSubmit=true;event.preventDefault();event.stopImmediatePropagation();};
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
        delete field.optionsError;entry.discovered=true;
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
    const preventSubmit=event=>{if(userSubmit(event))return;attemptedSubmit=true;event.preventDefault();event.stopImmediatePropagation();};
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
          const until=Date.now()+5000;let last=null,since=Date.now();
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
        // Type the full answer, then other forms until the site shows the answer.
        // Results that only share a word with it ("Master of" shows only the
        // M.B.A.) may be hiding the right one, so keep searching; several
        // options that all fit are a real choice and go to ChatGPT as they are.
        let suggestion=null,candidates=[],query='',close=false;
        const queries=[...new Set([...(item.searchText?[item.searchText]:[]),...narrowingQueries(typed)])];
        const enter=()=>{for(const type of ['keydown','keypress','keyup'])input.dispatchEvent(new KeyboardEvent(type,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true,composed:true}));};
        for(const value of queries) {
          setValue(input,value);
          if(field.controlKind==='workday-prompt')enter();
          const shown=await results();
          if(!shown.length)continue;
          const found=closestOption(shown,typed,field);
          if(found.match){query=value;suggestion=options().filter(visible).find(option=>text(option)===found.match);break;}
          if(!query)query=value;
          candidates=[...new Set([...candidates,...(found.candidates.length?found.candidates:shown)])];
          if(found.close){close=true;break;}
        }
        if(!suggestion) {
          setValue(input,'');dismissCombo(el);
          // The list read when the dropdown opened may hold choices the site's search never showed.
          const listed=entry.fullOptions?.length?closestOption(entry.fullOptions,typed,field):null;
          if(listed?.match)candidates=[...new Set([listed.match,...candidates])];
          else if(listed && !close)candidates=[...new Set([...candidates,...listed.candidates])];
          throw choiceError(candidates.length?'Several results could match. Choose it manually.':'The site found no results for this answer. Choose it manually.',candidates,query);
        }
        click(suggestion.querySelector('[data-automation-id="promptOption"]') || suggestion);
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
      if(menuButton(el))return !!menuButtonValue(el);
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
    return !!String(fieldText(el) || '').trim();
  }
  // What the control shows now, in the site's own wording: the chosen option's
  // text rather than the answer that was typed to find it. Null when empty.
  function currentValue(entry) {
    if(!entry || !entry.el.isConnected)return null;
    const {el,members,field}=entry;
    let value;
    if(field.type==='file' || field.type==='password')return null;
    if(field.type==='radio' || field.type==='checkbox') {
      const chosen=members.map((member,index)=>(member.checked===true || member.getAttribute('aria-checked')==='true' || member.getAttribute('aria-pressed')==='true')?field.options[index]:null).filter(Boolean);
      value=field.type==='checkbox' && members.length===1?(chosen.length?chosen:null):field.type==='radio'?chosen[0]:chosen;
    } else if(field.type==='select' || field.type==='multiselect') {
      const chosen=[...el.selectedOptions].filter(option=>option.value && !option.disabled).map(text);
      value=field.type==='multiselect'?chosen:chosen[0];
    } else if(field.type==='combobox') {
      const input=comboInput(el);
      if(field.answerFormat==='multiple') {
        const labels=multiValues(el);
        value=labels.length?labels:listOptions(observedLists.get(el) || []).filter(option=>option.getAttribute('aria-selected')==='true').map(text);
      } else value=singleValue(el) || input?.value || (!input && el.getAttribute('data-value')) || (menuButton(el)?menuButtonValue(el):'');
    } else value=fieldText(el);
    if(Array.isArray(value))return value.length?value:null;
    return String(value ?? '').trim() || null;
  }
  function values() {
    if(!samePage())throw new Error('The application page changed.');
    return {scanId,values:[...scanned].map(([id,entry])=>({id,value:currentValue(entry),preset:entry.el.isConnected && preset(entry.el,entry.members || [],entry.field.type)}))};
  }
  async function fillOne(item) {
      const entry = scanned.get(item.id);
      if (!entry || item.scanId !== scanId || !entry.el.isConnected || entry.field.manualOnly) throw new Error('Field changed or requires manual input. Rescan.');
      const {el,members,field} = entry;
      // Earlier answers can come from a previous scan that already read this control.
      for(const name of ['answerFormat','fillMode'])if(item[name]!==undefined)field[name]=item[name];
        if (!['radio','checkbox'].includes(field.type) && !sameQuestion(label(el),entry.label)) throw new Error('Question changed. Rescan.');
        if(field.type==='combobox') {
          await fillCombo(entry,item.answer,()=>{if(!samePage() || item.scanId!==scanId || !el.isConnected)throw new Error('The application field changed. Rescan before filling.');},item);
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
          if (members.some(member => member.tagName === 'BUTTON' && member.type === 'submit' && !choiceButton(member))) throw new Error('This option may submit the form. Choose it manually.');
          for (let i=0;i<members.length;i++) {
            const member = members[i], desired = answers.includes(labels[i]);
            const checked = member.checked === true || member.getAttribute('aria-checked') === 'true' || member.getAttribute('aria-pressed') === 'true';
            if (field.type === 'radio' ? desired && !checked : desired !== checked) clickChoice(member);
          }
        } else if (editableBox(el)) {
          // A contenteditable box takes text as typed input, so the site's editor sees it.
          focusControl(el);el.focus();
          const range=document.createRange();range.selectNodeContents(el);
          const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
          if(!document.execCommand('insertText',false,String(item.answer)) || normalized(text(el))!==normalized(item.answer)) {
            el.textContent=String(item.answer);el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:String(item.answer)}));
          }
          blurControl(el);
          if(normalized(text(el))!==normalized(item.answer))throw new Error('Site reformatted or rejected the value. Check manually.');
        } else {
          focusControl(el);setValue(el,String(item.answer));blurControl(el);
          // Input masks restyle values such as phone numbers; losing the content is the failure.
          const compact=value=>String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g,'');
          const wanted=compact(item.answer);
          const holds=value=>{const kept=compact(value);return !wanted || !!kept && (kept.includes(wanted) || wanted.includes(kept));};
          if(!holds(el.value))throw new Error('Site reformatted or rejected the value. Check manually.');
          // A React field can show the text while its state never changed (it ignored
          // the synthetic events). Compare React's own value once it has re-rendered;
          // if it missed the answer, type it again as real keystrokes would.
          if(wanted && reactValue(el)!==undefined) {
            const registered=async()=>{await pause(50);const held=reactValue(el);return held===undefined || holds(held);};
            if(!await registered()) {
              const notTaken=new Error('The page shows this answer but the site did not register it. Retype it manually.');
              if(!typeInto(el,String(item.answer)))throw notTaken;
              if(!holds(el.value) || !await registered())throw notTaken;
            }
          }
        }
  }
  async function fill(items) {
    if (!samePage()) throw new Error('The application page changed. Scan and review again.');
    const errors=new Map();
    const attempt=async item=>{try{await fillOne(item);errors.delete(item);}catch(error){errors.set(item,error);}};
    for(const item of items)await attempt(item);
    await pause(400);
    for(const item of items) {
      const failed=errors.get(item);
      // Search results that need a decision go back to ChatGPT rather than being retried.
      if(item.file || !samePage() || failed?.candidates || /submit/i.test(failed?.message || ''))continue;
      // Dropdowns already confirm their own selection; refilling one only repeats the slow path.
      if(!failed && (scanned.get(item.id)?.field.type==='combobox' || fieldHolds(scanned.get(item.id),item)))continue;
      await attempt(item);
      await pause(200);
      if(!errors.has(item) && !fieldHolds(scanned.get(item.id),item))errors.set(item,new Error('The site cleared this answer. Check it manually.'));
    }
    return items.map(item=>{
      const failed=errors.get(item);
      if(failed)return {id:item.id,error:failed.message,...(failed.candidates?.length?{candidates:failed.candidates,query:failed.query}:{})};
      const shown=item.file?null:currentValue(scanned.get(item.id));
      return {id:item.id,filled:true,...(shown!=null?{value:shown}:{})};
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
    // A sign-in screen: a password box with little else to fill. A long form that also asks for
    // a password (account creation inside the application, iCIMS after you signed in) is not one.
    if([...document.querySelectorAll('input[type="password"]')].some(visible)) {
      const others=[...document.querySelectorAll('input:not([type="hidden"]):not([type="password"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="image"]):not([type="search"]),select,textarea')].filter(el=>visible(el) && !el.closest('header,nav,footer'));
      if(others.length<=3)return {kind:'login',message:'This site needs an account. Sign in or create one on the page. Auto-fill will continue by itself.'};
    }
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
  // A posting whose form sits behind a button or tab: "Apply now" (Rippling), the Application
  // tab (Ashby). Asked for only when the page shows no application form yet. Never a button
  // that could submit a form, and never "Apply with LinkedIn / Indeed".
  function openApplication() {
    if(/(^|\.)ashbyhq\.com$/.test(location.hostname)) {
      const parts=location.pathname.split('/').filter(Boolean);
      if(parts.length===2) {
        const target=`${location.origin}/${parts.map(encodeURIComponent).join('/')}/application${location.search}`;
        setTimeout(()=>location.assign(target),50);
        return {clicked:'Application',url:target};
      }
    }
    const name=el=>(text(el) || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g,' ').trim();
    const usable=el=>visible(el) && !el.disabled && el.getAttribute('aria-disabled')!=='true' && el.getAttribute('data-disabled')!=='true' && !el.closest('footer,[id*="cookie" i],[class*="cookie" i]')
      && !(el.closest('form')?.querySelector('input:not([type="hidden"]),textarea,select'));
    const controls=[...document.querySelectorAll('a[href],button,[role="button"],[role="tab"],input[type="button"]')].filter(usable);
    const wanted=[/^apply(?: now| for this (?:job|position|role)| to (?:this )?(?:job|position|role))?!?$/i,/^(?:start|begin|continue) (?:your |my |the )?application$/i,/^(?:application|apply here)$/i,/^i'?m interested$/i];
    for(const pattern of wanted) {
      const control=controls.find(el=>pattern.test(name(el)));
      if(!control)continue;
      if(control.matches('a[href]') && /^(?:javascript:|#$)/i.test(control.getAttribute('href') || '') && !control.onclick)continue;
      const clicked=name(control),url=control.matches('a[href]')?control.href:'';
      // After returning, because the click can replace this page.
      setTimeout(()=>clickChoice(control),50);
      return {clicked,url};
    }
    return null;
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
      const schedule = () => {clearTimeout(quiet);quiet = setTimeout(finish,700);};
      observer = new MutationObserver(schedule);
      // Text-only changes (clocks, counters, animations) never settle and do not change the form.
      observer.observe(document.body,{childList:true,subtree:true});
      const limit = setTimeout(() => {clearTimeout(quiet);observer.disconnect();resolve(false);},8000);
      schedule();
    });
  }
  // When the user submits, report the form's final values, their own
  // corrections included, so they are saved for this site. Only real clicks
  // count; the extension itself never submits.
  let lastReport=0;
  function reportValues() {
    if(!scanId || !samePage() || Date.now()-lastReport<2000)return;
    lastReport=Date.now();
    try {chrome.runtime.sendMessage({event:'page-submitting',scanId,values:[...scanned].map(([id,entry])=>({id,value:currentValue(entry)}))}).catch(()=>{});}catch(_){ /* extension reloaded */ }
  }
  globalThis.ResumeApplyReport=reportValues;
  if(!globalThis.ResumeApplySubmitWatch) {
    globalThis.ResumeApplySubmitWatch=true;
    document.addEventListener('submit',event=>{if(event.isTrusted)globalThis.ResumeApplyReport?.();},true);
    document.addEventListener('click',event=>{
      const button=event.isTrusted && event.target?.closest?.('button,input[type="submit"],[role="button"]');
      if(button && /\b(?:submit|send application|apply|finish)\b/i.test(text(button) || button.value || ''))globalThis.ResumeApplyReport?.();
    },true);
  }
  globalThis.ResumeApplyPage = {version,job, scan, fill, values, settled,discoverOptions,blocker,clickNext,openApplication,uploadFinished};
})();
