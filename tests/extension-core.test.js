const {test} = require('node:test');
const assert = require('node:assert/strict');
const core = import('../chrome-extension/core.mjs');
test('GPT answers are validated against scanned field ids and exact options', async () => {
  const {parseAnswers,optionAnswer} = await core;
  const fields = [{id:'a',options:['Yes, I am','No, I am not']}];
  assert.equal(parseAnswers('```json\n{"answers":[{"id":"a","answer":"Yes"}]}\n```',fields)[0].answer,'Yes');
  assert.throws(() => parseAnswers('{"answers":[{"id":"b","answer":"x"}]}',fields), /unknown/);
  assert.throws(() => parseAnswers('{"answers":[{"id":"a","answer":"x"},{"id":"a","answer":"x"}]}',fields), /duplicate/);
  assert.equal(optionAnswer(fields[0],'No'),'No, I am not');
  assert.equal(optionAnswer({options:['Woman','Man']},'Man'),'Man');
  assert.equal(optionAnswer({options:['Not a protected veteran']},'Protected veteran'),null);
});

test('plain JSON answers preserve checkbox arrays and unanswered values',async()=>{
  const {parseAnswers}=await core;
  const fields=[{id:'0:a'},{id:'0:b'},{id:'0:c'}];
  assert.deepEqual(parseAnswers(JSON.stringify({answers:[{id:'0:a',answer:['Asian']},{id:'0:b',answer:[]},{id:'0:c',answer:null}]}),fields),[
    {id:'0:a',answer:['Asian']},{id:'0:b',answer:[]},{id:'0:c',answer:null}
  ]);
});

test('answers are normalized for text, single-choice and multiple-choice controls',async()=>{
  const {optionAnswer}=await core;
  assert.equal(optionAnswer({type:'text'},['Formatted text']),'Formatted text');
  assert.equal(optionAnswer({type:'text'},['Two','values']),null);
  assert.equal(optionAnswer({label:'Gender',type:'select',options:['Male','Female']},'Man'),'Male');
  assert.equal(optionAnswer({type:'radio',options:['Yes','No']},['No']),'No');
  assert.equal(optionAnswer({type:'select',options:['A','B']},['A','B']),null);
  assert.deepEqual(optionAnswer({label:'Race',type:'checkbox',options:['Asian','White']},'Asian / East Asian'),['Asian']);
  assert.deepEqual(optionAnswer({type:'multiselect',options:['A','B']},['B','A','B']),['B','A']);
  assert.deepEqual(optionAnswer({type:'unsupported',answerFormat:'multiple',options:['A','B']},'A'),['A']);
  assert.equal(optionAnswer({label:'Country',type:'select',options:['United States of America','Canada']},'US'),'United States of America');
  assert.equal(optionAnswer({label:'Race',type:'select',options:['Asian','East Asian']},'Asian / East Asian'),null);
});

test('automatic imports wait for a complete fenced answer block',async()=>{
  const {parseAnswers}=await core;
  const fields=[{id:'name',type:'text'},{id:'race',type:'checkbox'},{id:'file',type:'file'}];
  const response='```json\n{"answers":[{"id":"name","answer":"Test"},{"id":"race","answer":null}]}\n```';
  assert.equal(parseAnswers(response,fields,{requireComplete:true}).length,2);
  assert.throws(()=>parseAnswers('{"answers":[{"id":"name","answer":"Test"}]}',fields,{requireComplete:true}),/incomplete \(1\/2 questions\)/);
});

test('replacement clears missing old values instead of copying saved profile values',async()=>{
  const {mergeGeneratedAnswers}=await core;
  assert.deepEqual(mergeGeneratedAnswers([{id:'name',label:'First Name',type:'text'}],[],{firstName:'Old saved name'}),[{id:'name',answer:null}]);
});

test('GPT receives all answerable questions including saved facts and manual dropdowns',async()=>{
  const {answerableQuestions,answersPrompt}=await core;
  const fields=[
    {id:'name',label:'First Name',type:'text'},
    {id:'country',label:'Country',type:'unsupported',manualOnly:true},
    {id:'sponsor',label:'Need sponsorship?',type:'radio',options:['Yes','No']},
    {id:'race',label:'Asian',type:'checkbox',options:['Asian']},
    {id:'why',label:'Why our company?',type:'textarea'},
    {id:'file',label:'Import your profile from resume',type:'file',manualOnly:false},
    {id:'password',label:'Password',type:'password'},
    {id:'consent',label:'I agree to receive updates',type:'checkbox',manualOnly:true},
    {id:'customConsent',label:'I agree to terms',type:'unsupported',manualOnly:true}
  ];
  assert.deepEqual(answerableQuestions(fields).map(field=>field.id),['name','country','sponsor','race','why']);
  const prompt=answersPrompt({profile:{firstName:'Test',applicationDetails:{country:'United States',sponsorshipNow:'No'}}},fields);
  const data=JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n')+2));
  const question=label=>data.questions.find(field=>field.label===label);
  assert.deepEqual(data.questions.map(field=>field.id),['q1','q2','q3','q4','q5']);
  assert.equal(question('Country').manualEntry,true);
  assert.equal(question('Asian').answerFormat,'multiple');
  assert.equal(question('Need sponsorship?').answerFormat,'single');
  assert.equal(question('First Name').answerFormat,'text');
  assert.equal(data.personalInfo.firstName,'Test');
  assert.match(prompt,/exactly one entry for EVERY supplied question id/);
  assert.match(prompt,/Do not guess an honorific/);
  assert.match(prompt,/ONE fenced code block labeled json/);
  assert.match(prompt,/Do not copy a profile value verbatim/);
});

test('every choice question carries its exact options, control format and availability into the prompt',async()=>{
  const {answersPrompt,optionAnswer}=await core;
  const fields=[
    {id:'sponsor',label:'Need sponsorship?',type:'radio',options:['Yes, I currently require sponsorship.','No, I do not currently require sponsorship.']},
    {id:'race',label:'Race',type:'checkbox',options:['Asian','Black or African American']},
    {id:'country',label:'Country',type:'combobox',answerFormat:'single',options:['United States of America','Canada'],optionsStatus:'complete'},
    {id:'missing',label:'Unreadable dropdown',type:'combobox',answerFormat:'single',options:[],optionsStatus:'unavailable'}
  ];
  const prompt=answersPrompt({profile:{applicationDetails:{country:'United States'}}},fields);
  const payload=JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n')+2));
  for(const field of fields.filter(field=>field.options.length))assert.deepEqual(payload.questions.find(question=>question.label===field.label).options,field.options.map((text,index)=>({id:`o${index+1}`,text})));
  assert.equal(payload.questions.find(question=>question.label==='Race').answerFormat,'multiple');
  assert.equal(payload.questions.find(question=>question.label==='Unreadable dropdown').optionsStatus,'unavailable');
  assert.match(prompt,/choose ONLY from that question's options array/);
  assert.equal(optionAnswer(fields[3],'A guessed option'),null);
  assert.equal(optionAnswer(fields[0],'No'),'No, I do not currently require sponsorship.');
});

test('prompt questions carry only values that change the answer',async()=>{
  const {answersPrompt,optionAnswer}=await core;
  const prompt=answersPrompt({profile:{applicationDetails:{}}},[
    {id:'a',label:'First Name',name:'',type:'text',required:true,options:[],inputHints:{autocomplete:'given-name',maxLength:255}},
    {id:'b',label:'Country',type:'combobox',answerFormat:'single',required:true,options:['Canada'],optionsStatus:'complete',inputHints:{autocomplete:'off'}},
    {id:'c',label:'Why us?',type:'textarea',options:[],inputHints:{}},
    {id:'d',label:'School',type:'combobox',answerFormat:'text',fillMode:'search',optionsStatus:'not-applicable',options:[]}
  ]);
  const payload=JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n')+2));
  assert.deepEqual(payload.questions,[
    {id:'q1',label:'First Name',answerFormat:'text',inputHints:{maxLength:255}},
    {id:'q2',label:'Country',answerFormat:'single',options:[{id:'o1',text:'Canada'}]},
    {id:'q3',label:'Why us?',answerFormat:'text',type:'textarea'},
    {id:'q4',label:'School',answerFormat:'text',allowsCustomValue:true}
  ]);
  assert.equal(optionAnswer({label:'School',type:'combobox',answerFormat:'text',fillMode:'search',optionsStatus:'not-applicable',options:[]},'MIT'),'MIT');
});

test('option ids from GPT select the exact option',async()=>{
  const {decodeReply,mergeGeneratedAnswers}=await core;
  const fields=[
    {id:'0:sponsor',label:'Sponsorship?',type:'radio',options:['Yes, I will require sponsorship','Yes, but only for an OPT extension','No']},
    {id:'0:skills',label:'Skills',type:'checkbox',options:['Go','Python','Rust']},
    {id:'0:resume',label:'Resume',type:'file'},
    {id:'0:why',label:'Why us?',type:'textarea'},
    {id:'0:state',label:'State',type:'select',options:['CA','NY']}
  ];
  const decode=answers=>decodeReply(JSON.stringify({answers}),fields).answers;
  const decoded=decode([{id:'q1',answer:'o2'},{id:'q2',answer:['o3','o1']},{id:'q3',answer:'Because of the team.'},{id:'q4',answer:null}]);
  assert.deepEqual(decoded,[{id:'0:sponsor',answer:'Yes, but only for an OPT extension'},{id:'0:skills',answer:['Rust','Go']},{id:'0:why',answer:'Because of the team.'},{id:'0:state',answer:null}]);
  assert.deepEqual(mergeGeneratedAnswers(fields,decoded).map(item=>item.answer),['Yes, but only for an OPT extension',['Rust','Go'],null,'Because of the team.',null]);
  // Option text, ids from outside the list, and partially valid arrays stay blank for review.
  assert.equal(decode([{id:'q1',answer:'Yes'},{id:'q2',answer:[]},{id:'q3',answer:null},{id:'q4',answer:null}])[0].answer,null);
  assert.equal(decode([{id:'q1',answer:'o4'},{id:'q2',answer:[]},{id:'q3',answer:null},{id:'q4',answer:null}])[0].answer,null);
  assert.equal(decode([{id:'q1',answer:null},{id:'q2',answer:['o1','o9']},{id:'q3',answer:null},{id:'q4',answer:null}])[1].answer,null);
  assert.deepEqual(decode([{id:'q1',answer:null},{id:'q2',answer:[]},{id:'q3',answer:null},{id:'q4',answer:null}])[1].answer,[]);
});

test('one bad item does not lose the rest of the reply, and only bad items are retried',async()=>{
  const {decodeReply}=await core;
  const fields=[
    {id:'a',label:'Sponsorship?',type:'radio',options:['Yes','No']},
    {id:'b',label:'Years',type:'text'},
    {id:'c',label:'Why us?',type:'textarea'},
    {id:'d',label:'State',type:'select',options:['CA','NY']}
  ];
  const decode=answers=>decodeReply(JSON.stringify({answers}),fields);
  const reply=decode([{id:'q1',answer:'o9'},{id:'q2',answer:5},{id:'q9',answer:'stray'},{id:'q3',answer:{bad:true}},{id:'q2',answer:'second copy'}]);
  assert.deepEqual(reply.answers,[{id:'a',answer:null},{id:'b',answer:'5'},{id:'c',answer:null}]);
  assert.deepEqual(reply.retry.sort(),['a','c','d']);
  // ChatGPT saying "unknown" is an answer, not a failure.
  assert.deepEqual(decode([{id:'q1',answer:null},{id:'q2',answer:null},{id:'q3',answer:null},{id:'q4',answer:null}]).retry,[]);
  assert.deepEqual(decode([{id:'q4',answer:['o1','o2']}]).retry.sort(),['a','b','c','d']);
  assert.throws(()=>decode([{id:'q9',answer:null}]),/does not answer/);
  assert.throws(()=>decode([]),/does not answer/);
});

test('a rescan reuses answers for known questions and only asks about new ones',async()=>{
  const {rememberAnswers,recallAnswers}=await core;
  const first=[
    {id:'old:name',label:'First Name',type:'text',options:[]},
    {id:'old:city',label:'Location',type:'combobox',options:[],answerFormat:'text',fillMode:'search',optionsStatus:'not-applicable'},
    {id:'old:hear',label:'How did you hear?',type:'combobox',answerFormat:'single',options:['Referral','LinkedIn'],optionsStatus:'complete'},
    {id:'old:salary',label:'Salary',type:'text',options:[]}
  ];
  const book=rememberAnswers({},first,[{id:'old:name',answer:'Sam'},{id:'old:city',answer:'Boston'},{id:'old:hear',answer:'LinkedIn'},{id:'old:salary',answer:null}]);
  const second=[
    {id:'new:hear',label:'How did you hear?',type:'combobox',answerFormat:'single',options:[]},
    {id:'new:name',label:'First  name',type:'text',options:[]},
    {id:'new:city',label:'Location',type:'combobox',answerFormat:'single',options:[]},
    {id:'new:salary',label:'Salary',type:'text',options:[]},
    {id:'new:why',label:'Why us?',type:'textarea',options:[]}
  ];
  const recalled=recallAnswers(second,book);
  assert.deepEqual(recalled.answers.map(item=>item.answer),['LinkedIn','Sam','Boston',null,null]);
  assert.deepEqual(recalled.unasked,['new:why']);
  assert.deepEqual(recalled.fields[0].options,['Referral','LinkedIn']);
  assert.equal(recalled.fields[2].fillMode,'search');
  assert.equal(recalled.fields[2].answerFormat,'text');
});

test('remembered answers are not reused when they could be wrong',async()=>{
  const {rememberAnswers,recallAnswers}=await core;
  const field=(id,label,options=[],type='text')=>({id,label,type,options});
  const repeated=[field('1','Company'),field('2','Company')];
  assert.deepEqual(rememberAnswers({},repeated,[{id:'1',answer:'A'},{id:'2',answer:'B'}]),{});
  const book=rememberAnswers({},[field('1','Company'),field('s','State',['CA','NY'],'select')],[{id:'1',answer:'A'},{id:'s',answer:'CA'}]);
  assert.deepEqual(recallAnswers(repeated,book).unasked,['1','2']);
  const changed=recallAnswers([field('s','State',['TX'],'select')],book);
  assert.equal(changed.answers[0].answer,null);
  assert.deepEqual(changed.unasked,['s']);
  const consent=field('c','I agree to the terms',[],'text');
  assert.deepEqual(rememberAnswers({},[consent],[{id:'c',answer:'Yes'}]),{});
});

test('long dropdowns reach ChatGPT as plain text without their options',async()=>{
  const {answersPrompt,decodeReply}=await core;
  const fields=[{id:'n',label:'Citizenship',type:'select',options:[],answerFormat:'text',fillMode:'local',optionsStatus:'not-applicable'}];
  const prompt=answersPrompt({profile:{applicationDetails:{}}},fields);
  const payload=JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n')+2));
  assert.deepEqual(payload.questions,[{id:'q1',label:'Citizenship',answerFormat:'text',allowsCustomValue:true}]);
  assert.deepEqual(decodeReply('{"answers":[{"id":"q1","answer":"Canada"}]}',fields).answers,[{id:'n',answer:'Canada'}]);
});

test('salary rule uses the posted pay, then the defaults',async()=>{
  const {expectedPay,parsePayRanges}=await core;
  const pay=(jd,period,profile={})=>expectedPay(jd,profile,period);
  assert.equal(pay('The base salary range is $150,000 - $190,000.').text,'$170,000');
  assert.equal(pay('The base salary range is $151,000 - $192,000.').text,'$175,000');
  assert.equal(pay('Pay: $150K to $190K').amount,170000);
  assert.equal(pay('Pay: $150 - $190K').amount,170000);
  assert.equal(pay('Salary: $165,000').text,'$165,000');
  // iCIMS writes the currency before each figure.
  assert.equal(pay('USD $151,047.00 - USD $241,653.00 /Yr.').text,'$200,000');
  assert.equal(pay('$60 USD - $80 USD per hour','hour').text,'$70/hour');
  assert.equal(pay('Hourly rate: $62 - $81 per hour','hour').text,'$75/hour');
  assert.equal(pay('Great team and benefits.').text,'$140,000');
  assert.equal(pay('Great team and benefits.','hour').text,'$70-$80/hour');
  assert.equal(pay('Hourly rate: $62 - $81 per hour').text,'$140,000');
  assert.equal(pay('The range is $100,000 - $120,000.').postedMaximum,120000);
  for(const noise of ['We raised $100M in funding.','$20,000 sign-on bonus','$2,000 learning stipend','$500 home office allowance'])assert.deepEqual(parsePayRanges(noise),[],noise);
});

test('salary rule picks the range for the candidate state',async()=>{
  const {expectedPay}=await core;
  const jd='CA, NY: $180,000 - $220,000\nTX: $140,000 - $160,000\nAll other states: $120,000 - $130,000';
  assert.equal(expectedPay(jd,{applicationDetails:{state:'Texas'}}).amount,150000);
  assert.equal(expectedPay(jd,{applicationDetails:{state:'CA'}}).amount,200000);
  assert.equal(expectedPay(jd,{location:'Austin, TX'}).amount,150000);
  assert.equal(expectedPay(jd,{applicationDetails:{state:'Ohio'}}).amount,125000);
});

test('the salary figure is sent only when the form asks about pay',async()=>{
  const {answersPrompt}=await core;
  const payload=(fields,jd)=>{const prompt=answersPrompt({jd,profile:{applicationDetails:{}}},fields);return JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n')+2));};
  const asked=payload([{id:'s',label:'What are your salary expectations?',type:'text'}],'Salary range: $150,000 - $190,000');
  assert.equal(asked.formContext.salaryExpectation.annual,'$170,000');
  assert.equal(asked.formContext.salaryExpectation.annualPostedMaximum,190000);
  assert.equal(asked.formContext.salaryExpectation.hourly,'$70-$80/hour');
  assert.equal(payload([{id:'n',label:'First Name',type:'text'}],'Salary range: $150,000 - $190,000').formContext.salaryExpectation,undefined);
  const prompt=answersPrompt({jd:'',profile:{applicationDetails:{}}},[{id:'s',label:'Desired salary',type:'number'}]);
  assert.match(prompt,/formContext\.salaryExpectation/);
  assert.doesNotMatch(prompt,/preferred name, salary expectation/);
});

test('rules for situations the form does not have are left out of the prompt',async()=>{
  const {answersPrompt}=await core;
  const build=fields=>answersPrompt({jd:'',profile:{applicationDetails:{}}},fields);
  const plain=build([{id:'n',label:'First Name',type:'text'}]);
  for(const rule of [/salaryExpectation is my/,/separatePhoneCountryCode is true/,/long dropdown/,/relatives question/,/tax-credit question/,/options array/])assert.doesNotMatch(plain,rule);
  assert.ok(plain.slice(0,plain.lastIndexOf('\n\n')).length<1600,'instructions stay short');
  assert.match(build([{id:'s',label:'Desired salary',type:'text'}]),/salaryExpectation is my/);
  assert.match(build([{id:'r',label:'Do you have relatives at this company?',type:'text'}]),/relatives question/);
  assert.match(build([{id:'t',label:'WOTC tax credit eligibility',type:'text'}]),/tax-credit question/);
  assert.match(build([{id:'c',label:'Country',type:'select',options:['Canada']}]),/options array/);
  assert.match(build([{id:'l',label:'School',type:'combobox',answerFormat:'text',fillMode:'search'}]),/long dropdown/);
});

test('asking about a subset still reports the separate phone country code',async()=>{
  const {answersPrompt}=await core;
  const phone={id:'p',label:'Phone Number',type:'tel'};
  const prompt=answersPrompt({profile:{applicationDetails:{}}},[phone],[phone,{id:'c',label:'Country code',type:'select',options:['+1']}]);
  const payload=JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n')+2));
  assert.equal(payload.formContext.separatePhoneCountryCode,true);
  assert.deepEqual(payload.questions.map(question=>question.id),['q1']);
});

test('grid-backed fields request text without requiring a full choice list',async()=>{
  const {answersPrompt,optionAnswer}=await core;
  const grid={id:'country',label:'Country',type:'combobox',fillMode:'text',answerFormat:'text',allowFreeText:true,options:[],optionsStatus:'not-applicable'};
  const prompt=answersPrompt({profile:{applicationDetails:{country:'United States'}}},[grid]);
  const payload=JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n')+2));
  assert.deepEqual(payload.questions[0],{id:'q1',label:'Country',answerFormat:'text',allowsCustomValue:true});
  assert.equal(optionAnswer(grid,'United States'),'United States');
});

test('generated personal, demographic, null and manual-entry answers reach the preview',async()=>{
  const {mergeGeneratedAnswers}=await core;
  const fields=[
    {id:'name',label:'First Name',type:'text'},
    {id:'country',label:'Country',type:'unsupported',manualOnly:true},
    {id:'sponsor',label:'Need sponsorship?',type:'radio',options:['Yes','No']},
    {id:'race',label:'Asian',type:'checkbox',options:['Asian']},
    {id:'otherRace',label:'White',type:'checkbox',options:['White']},
    {id:'file',label:'Resume',type:'file'},
    {id:'consent',label:'I agree to terms',type:'checkbox',manualOnly:true}
  ];
  const generated=[{id:'name',answer:null},{id:'country',answer:'United States'},{id:'sponsor',answer:'No'},{id:'race',answer:['Asian']},{id:'otherRace',answer:[]},{id:'file',answer:'resume.docx'},{id:'consent',answer:['Agree']}];
  assert.deepEqual(mergeGeneratedAnswers(fields,generated,{firstName:'Saved name',applicationDetails:{}}),[
    {id:'name',answer:null},{id:'country',answer:'United States'},{id:'sponsor',answer:'No'},
    {id:'race',answer:['Asian']},{id:'otherRace',answer:[]},{id:'file',answer:null},{id:'consent',answer:null}
  ]);
});
test('question prompts include saved personal info and writing preferences without repeating JD or resume', async () => {
  const {answersPrompt} = await core;
  const job={company:'Acme',jd:'Build products',resume:{summary:'Built services.'},profile:{firstName:'PRIVATE NAME',email:'PRIVATE EMAIL',phone:'PRIVATE PHONE',workHistory:[{company:'Employer'}],applicationDetails:{gender:'Man',address1:'PRIVATE ADDRESS',criminalHistoryDetails:'PRIVATE BACKGROUND',answerPrompt:'Two sentences.'}}};
  const fields=[{id:'g',label:'Gender',options:['Woman','Man']},{id:'e',label:'Why our company?'}];
  const prompt = answersPrompt(job,[fields[1]]);
  for(const value of ['PRIVATE NAME','PRIVATE EMAIL','PRIVATE PHONE','PRIVATE ADDRESS','PRIVATE BACKGROUND','Two sentences.','Why our company?'])assert.ok(prompt.includes(value),value);
  for(const value of ['Employer','Build products','Built services.','"workHistory"','"education"','"resume"','"jobDescription"'])assert.ok(!prompt.includes(value),value);

});

test('resume response extraction handles UI headers and never accepts question answers as a resume',async()=>{
  const {resumeResponse}=await core;
  const resume={company:'Acme',title:'Engineer',summary:'Text with {braces} and "quotes".',skills:[],experience:[],education:[]};
  assert.deepEqual(JSON.parse(resumeResponse('json\nCopy code\n'+JSON.stringify(resume)+'\nDownload')),resume);
  assert.throws(()=>resumeResponse('{"answers":[{"id":"a","answer":"x"}]}'),/No complete resume/);
  assert.throws(()=>resumeResponse('{"error":"Clearance required"}'),/Clearance required/);
  assert.throws(()=>resumeResponse('{"company":"Incomplete"'),/No complete resume/);
});

test('an exact option name from GPT counts like its id, so it is not asked again',async()=>{
  const {decodeReply}=await core;
  const fields=[{id:'a',label:'Sponsorship?',type:'radio',options:['Yes','No']},{id:'b',label:'Skills',type:'checkbox',options:['Go','Python']}];
  const reply=decodeReply(JSON.stringify({answers:[{id:'q1',answer:'no'},{id:'q2',answer:['Python','o1']}]}),fields);
  assert.deepEqual(reply.answers,[{id:'a',answer:'No'},{id:'b',answer:['Python','Go']}]);
  assert.deepEqual(reply.retry,[]);
});

test('questions already asked on a page are not asked again after a rescan',async()=>{
  const {carryPageState,currentAnswers}=await core;
  const field=(id,label,extra={})=>({id,label,type:'text',options:[],frameId:0,pageUrl:'https://jobs.example/apply#step',...extra});
  // Repeated labels cannot be remembered by label, so they used to be asked every round.
  const before={fields:[field('a1','Company'),field('a2','Company'),field('a3','Nickname')],askedIds:['a1','a2','a3'],answers:[{id:'a1',answer:'Acme'},{id:'a2',answer:'Globex'},{id:'a3',answer:null}]};
  const after=[field('b1','Company',{pageUrl:'https://jobs.example/apply?x=1'}),field('b2','Company'),field('b3','Nickname'),field('b4','Why us?')];
  const carried=carryPageState(before,after);
  assert.deepEqual(carried.askedIds,['b1','b2','b3']);
  const state=currentAnswers({fields:after,answerBook:{},...carried});
  assert.deepEqual(state.answers.map(item=>item.answer),['Acme','Globex',null,null]);
  assert.deepEqual(state.unasked,['b4']);
  // A block added or removed shifts positions: nothing is carried for that label.
  const grown=[field('c1','Company'),field('c2','Company'),field('c3','Company')];
  assert.deepEqual(carryPageState(before,grown).askedIds,[]);
  // Another page is never matched.
  assert.deepEqual(carryPageState(before,[field('d1','Nickname',{pageUrl:'https://jobs.example/step-2'})]).askedIds,[]);
});

test('each job summarizes what it is doing now for the app', async () => {
  const {runProgress} = await core;
  assert.deepEqual(runProgress({}),{text:'',level:'idle',key:''});
  assert.deepEqual(runProgress({autopilot:{active:true,waiting:'captcha'}}),{text:'Needs you: solve the CAPTCHA on the job page',level:'attention',key:'waiting-on-page'});
  assert.equal(runProgress({responseMonitor:{kind:'resume',status:'waiting'}}).level,'busy');
  assert.equal(runProgress({responseMonitor:{kind:'answers',status:'error',message:'Timed out'}}).text,'Needs you: Timed out');
  assert.deepEqual(runProgress({autopilot:{active:true,page:2}}),{text:'Auto-filling page 2',level:'busy',key:'auto-filling'});
  assert.equal(runProgress({pendingResumeResponse:'{}'}).key,'confirm-resume');
  assert.deepEqual(runProgress({fullAuto:{active:true,stage:'resume'}}),{text:'Full auto: preparing the resume',level:'busy',key:'full-auto'});
  assert.equal(runProgress({fullAuto:{active:true,stage:'resume'},responseMonitor:{kind:'resume',status:'waiting'}}).key,'chatgpt-working');
  assert.equal(runProgress({fullAutoBlocker:{stage:'resume',message:'Review it.'},pendingResumeResponse:'{}'}).key,'confirm-resume');
  assert.deepEqual(runProgress({fullAutoBlocker:{stage:'resume',message:'No job description was found on the page.'}}),{text:'Needs you: No job description was found on the page.',level:'attention',key:'full-auto-blocked',stage:'resume'});
  assert.deepEqual(runProgress({autoSummary:{text:'Form filled. Check it, then submit it yourself.',needsYou:false}}),{text:'Form filled. Check it, then submit it yourself.',level:'idle',key:'auto-finished'});
  // Waiting on the user outranks everything else.
  assert.equal(runProgress({autopilot:{active:true,waiting:'login'},responseMonitor:{kind:'answers',status:'waiting'}}).level,'attention');
});

test('an application-form link points to where the same job description can be read', async () => {
  const {jdSources} = await core;
  const kinds = link => jdSources(link).map(source => `${source.kind} ${source.url}`);
  assert.deepEqual(kinds('https://jobs.lever.co/liatrio/dabbe592-d22e-49ef-91a9-b775a3296fdd/apply?jr_id=6a603494129b652e9cd28103'),[
    'lever https://api.lever.co/v0/postings/liatrio/dabbe592-d22e-49ef-91a9-b775a3296fdd',
    'page https://jobs.lever.co/liatrio/dabbe592-d22e-49ef-91a9-b775a3296fdd']);
  assert.deepEqual(kinds('https://job-boards.greenhouse.io/embed/job_app?for=babelstreet&token=8384370&jr_id=6af7'),['greenhouse https://boards-api.greenhouse.io/v1/boards/babelstreet/jobs/8384370']);
  assert.deepEqual(kinds('https://jobs.ashbyhq.com/acme/8f2c1a0e-1111-2222-3333-444455556666/application'),[
    'ashby https://api.ashbyhq.com/posting-api/job-board/acme','page https://jobs.ashbyhq.com/acme/8f2c1a0e-1111-2222-3333-444455556666']);
  assert.deepEqual(kinds('https://acme.wd5.myworkdayjobs.com/en-US/External/job/Remote-USA/Senior-Engineer_R123/apply/applyManually'),[
    'workday https://acme.wd5.myworkdayjobs.com/wday/cxs/acme/External/job/Remote-USA/Senior-Engineer_R123',
    'page https://acme.wd5.myworkdayjobs.com/en-US/External/job/Remote-USA/Senior-Engineer_R123']);
  assert.deepEqual(kinds('https://fa-exew-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/10681/apply/email?jr_id=6a5a'),[
    'oracle https://fa-exew-saasfaprod1.fa.ocs.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById%3BId%3D%2210681%22%2CsiteNumber%3DCX_1',
    'page https://fa-exew-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/10681']);
  assert.deepEqual(kinds('https://careers.example.com/jobs/123/apply?src=x'),['page https://careers.example.com/jobs/123']);
  // Links that already show the posting are left alone.
  for (const link of ['https://jobs.lever.co/liatrio/dabbe592-d22e-49ef-91a9-b775a3296fdd','https://job-boards.greenhouse.io/babelstreet/jobs/8384370','https://careers.example.com/jobs/123','not a link']) assert.deepEqual(jdSources(link),[],link);
});

test('each source is read into a title, company and plain-text description', async () => {
  const {parseJdSource, htmlToText} = await core;
  const long = 'Build reliable distributed systems for enterprise customers. '.repeat(5);
  assert.equal(htmlToText('<p>Hello&nbsp;<b>world</b></p><ul><li>One</li><li>Two &amp; three</li></ul><script>x()</script>'),'Hello world\n\n- One\n- Two & three');
  const lever = parseJdSource({kind:'lever'},JSON.stringify({text:'Senior Forward Deployed Engineer',descriptionPlain:long,lists:[{text:'What You Will Do',content:'<li>Ship AI systems</li><li>Lead clients</li>'}],additionalPlain:'Remote in the US.'}));
  assert.equal(lever.title,'Senior Forward Deployed Engineer');assert.match(lever.description,/What You Will Do\n- Ship AI systems\n- Lead clients/);assert.match(lever.description,/Remote in the US\.$/);
  const greenhouse = parseJdSource({kind:'greenhouse'},JSON.stringify({title:'Senior Software Engineer',company_name:'Babel Street',content:'&lt;p&gt;'+long+'&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Python&lt;/li&gt;&lt;/ul&gt;'}));
  assert.deepEqual([greenhouse.title,greenhouse.company],['Senior Software Engineer','Babel Street']);assert.match(greenhouse.description,/\n- Python$/);assert.ok(!greenhouse.description.includes('<'));
  const ashby = parseJdSource({kind:'ashby',id:'j2'},JSON.stringify({jobs:[{id:'j1',title:'Other',descriptionPlain:long},{id:'j2',title:'Staff Engineer',descriptionPlain:long}]}));
  assert.equal(ashby.title,'Staff Engineer');
  assert.equal(parseJdSource({kind:'workday'},JSON.stringify({jobPostingInfo:{title:'Senior Engineer',jobDescription:'<p>'+long+'</p>'}})).title,'Senior Engineer');
  const page = parseJdSource({kind:'page'},'<html><head><title>x</title><script type="application/ld+json">{"@type":"JobPosting","title":"Data Engineer","hiringOrganization":{"name":"Acme"},"description":"&lt;p&gt;'+long+'&lt;/p&gt;"}</script></head><body>menu</body></html>');
  assert.deepEqual([page.title,page.company],['Data Engineer','Acme']);assert.ok(!page.description.includes('<'));
  // HTML escaped twice (&amp;lt;p&amp;gt;) still comes out as plain text.
  const twice = parseJdSource({kind:'greenhouse'},JSON.stringify({title:'T',company_name:'C',content:'&amp;lt;p&amp;gt;'+long+'&amp;lt;/p&amp;gt;&amp;lt;ul&amp;gt;&amp;lt;li&amp;gt;Go&amp;lt;/li&amp;gt;&amp;lt;/ul&amp;gt;'}));
  assert.ok(!/<\/?[a-z]/i.test(twice.description),twice.description);assert.match(twice.description,/\n- Go$/);
  const {plainJd} = await core;
  assert.equal(plainJd('<div><p>About the role</p><p>Requires 5+ years &amp; Go.</p></div>'),'About the role\nRequires 5+ years & Go.');
  assert.equal(plainJd('Salary 3 < 5 > 2, plain text stays as is.'),'Salary 3 < 5 > 2, plain text stays as is.');
  assert.match(parseJdSource({kind:'page'},'<html><head><title>Role</title></head><body><nav>x</nav><main><h1>Role</h1><p>'+long+'</p></main></body></html>').description,/^Role\nBuild reliable/);
  // Too little text, or something that is not the expected data, gives nothing.
  assert.equal(parseJdSource({kind:'lever'},JSON.stringify({text:'T',descriptionPlain:'Short.'})),null);
  assert.equal(parseJdSource({kind:'greenhouse'},'<html>Not found</html>'),null);
});

test('answers that are ready but not yet on the form offer Fill form in the app', async () => {
  const {runProgress} = await core;
  const run = {answers:[{id:'a',answer:'Yes'},{id:'b',answer:null},{id:'c',answer:['Go']},{id:'d',answer:[]}],answersAt:2};
  assert.deepEqual(runProgress(run),{text:'2 answers ready. Fill the form, or check them first with Show details.',level:'idle',key:'answers-ready'});
  // Once filled, they are no longer waiting; new answers after that wait again.
  assert.equal(runProgress({...run,filledAt:3}).key,'');
  assert.equal(runProgress({...run,filledAt:3,answersAt:4}).key,'answers-ready');
  // ChatGPT still working, or Auto-fill running, comes first.
  assert.equal(runProgress({...run,responseMonitor:{kind:'answers',status:'waiting'}}).key,'chatgpt-working');
  assert.equal(runProgress({...run,autopilot:{active:true,page:1}}).key,'auto-filling');
  assert.equal(runProgress({answers:[{id:'a',answer:null}],answersAt:2}).key,'');
});
