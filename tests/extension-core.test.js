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
