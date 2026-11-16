const {test} = require('node:test');
const assert = require('node:assert/strict');
const core = import('../chrome-extension/core.mjs');

const tonyProfile={firstName:'Tony',lastName:'Zhao',email:'',phone:'+1 (856) 219-0503',linkedin:'',github:'',location:'Berkeley CA',
  education:[{institution:'University of California, Berkeley',degree:'Master of Science in EECS',period:'2020 - 2021'},{institution:'University of California, Berkeley',degree:'Bachelor of Science in EECS',period:'2016 - 2020'}],
  applicationDetails:{gender:'Man',answerPrompt:'Two sentences.'}};
const greenhouseForm=()=>[
  {id:'f',label:'First Name',type:'text'},{id:'e',label:'Email',type:'text'},{id:'p',label:'Phone',type:'tel'},{id:'l',label:'LinkedIn Profile',type:'text'},
  {id:'s1',label:'School',type:'combobox',answerFormat:'text',fillMode:'search'},{id:'d1',label:'Degree',type:'combobox',answerFormat:'text',fillMode:'search'},
  {id:'y1',label:'Start date year',type:'number'},{id:'z1',label:'End date year',type:'number'},
  {id:'s2',label:'School',type:'combobox',answerFormat:'text',fillMode:'search'},{id:'y2',label:'Start date year',type:'number'},{id:'z2',label:'End date year',type:'number'},
  {id:'g',label:'Gender',type:'select',options:['Male','Female','Decline To Self Identify']},
  {id:'k',label:'Do you know anyone who works at Smartsheet?',type:'text'},
  {id:'w',label:'Why do you want to join?',type:'textarea'},
  {id:'r',label:'Preferred office',type:'select',options:['Bellevue','Boston']},
];
const MASTERS="Master's Degree";

test('contact details come only from the profile, and missing ones stay blank instead of being asked',async()=>{
  const {profileAnswers}=await core;
  const {answers,fixed}=profileAnswers(greenhouseForm(),tonyProfile);
  const byId=Object.fromEntries(answers.map(item=>[item.id,item.answer]));
  assert.deepEqual(fixed,['f','e','p','l']);
  assert.equal(byId.f,'Tony');assert.equal(byId.e,null);assert.equal(byId.l,null);assert.equal(byId.p,'+1 (856) 219-0503');
  // A separate country-code box needs the number without its prefix, which ChatGPT handles.
  assert.ok(!profileAnswers([{id:'p',label:'Phone',type:'tel'},{id:'c',label:'Country code',type:'select',options:['+1']}],tonyProfile).fixed.includes('p'));
  assert.equal(profileAnswers([{id:'x',label:'Phone extension',type:'text'}],tonyProfile).fixed.length,0);
});

test('education blocks are filled from the profile in order; years outside an education block are not',async()=>{
  const {profileAnswers}=await core;
  const byId=Object.fromEntries(profileAnswers(greenhouseForm(),tonyProfile).answers.map(item=>[item.id,item.answer]));
  assert.equal(byId.s1,'University of California, Berkeley');assert.equal(byId.y1,'2020');assert.equal(byId.z1,'2021');
  assert.equal(byId.s2,'University of California, Berkeley');assert.equal(byId.y2,'2016');assert.equal(byId.z2,'2020');
  assert.equal(byId.d1,undefined,'degree must match the site list, so it is not copied from the profile');
  assert.deepEqual(profileAnswers([{id:'j',label:'Start year',type:'number'}],tonyProfile).answers,[]);
  assert.deepEqual(profileAnswers([{id:'s',label:'School',type:'text'},{id:'z',label:'End date year',type:'number'}],{education:[{institution:'NYU',period:'2014 - Present'}]}).answers,[{id:'s',answer:'NYU'}]);
});

test('answers about the applicant are saved per site in the site wording; job-specific ones are not',async()=>{
  const {learnSiteAnswers,recallSiteAnswers,profileBasis}=await core;
  const basis=profileBasis(tonyProfile),fields=greenhouseForm();
  const values=[['f','Tony'],['s1','University of California - Berkeley'],['d1',MASTERS],['y1','2020'],['g','Male'],['k','No'],['w','Because...'],['r','Boston']].map(([id,value])=>({id,value}));
  const {book,saved}=learnSiteAnswers(undefined,fields,values,{jobId:'job1',company:'Smartsheet',basis});
  assert.deepEqual(Object.values(book.answers).map(entry=>entry.label).sort(),['Degree','Gender','School','Start date year']);
  assert.equal(saved,4);
  const next=greenhouseForm().map(field=>({...field,id:'n'+field.id,fillMode:undefined,answerFormat:undefined}));
  const recalled=recallSiteAnswers(next,book,basis);
  const byId=Object.fromEntries(recalled.answers.map(item=>[item.id,item.answer]));
  assert.equal(byId.ns1,'University of California - Berkeley');assert.equal(byId.nd1,MASTERS);assert.equal(byId.ng,'Male');
  assert.equal(byId.ns2,undefined,'the second education block has its own answer');
  assert.equal(recalled.fields.find(field=>field.id==='ns1').fillMode,'search');
  // An edited profile makes the old answers stale.
  assert.deepEqual(recallSiteAnswers(next,book,profileBasis({...tonyProfile,education:[]})).answers,[]);
});

test('other questions are saved only after two jobs on the site got the same answer',async()=>{
  const {learnSiteAnswers,recallSiteAnswers}=await core;
  const fields=greenhouseForm(),office=value=>[{id:'r',value}];
  let {book}=learnSiteAnswers(undefined,fields,office('Boston'),{jobId:'a',basis:'b'});
  assert.deepEqual(recallSiteAnswers(fields,book,'b').answers,[]);
  ({book}=learnSiteAnswers(book,fields,office('Boston'),{jobId:'a',basis:'b'}));
  assert.deepEqual(recallSiteAnswers(fields,book,'b').answers,[],'the same job twice is still one job');
  ({book}=learnSiteAnswers(book,fields,office('Boston'),{jobId:'b',basis:'b'}));
  assert.deepEqual(recallSiteAnswers(fields,book,'b').answers,[{id:'r',answer:'Boston'}]);
  ({book}=learnSiteAnswers(book,fields,office('Bellevue'),{jobId:'c',basis:'b'}));
  assert.deepEqual(recallSiteAnswers(fields,book,'b').answers,[],'answers that differ by job are not reused');
});

test('a corrected answer replaces the saved one, and a choice the site no longer offers is not reused',async()=>{
  const {learnSiteAnswers,recallSiteAnswers}=await core;
  const fields=greenhouseForm();
  let {book}=learnSiteAnswers(undefined,fields,[{id:'s1',value:'University of California - Davis'}],{jobId:'a',basis:'b'});
  ({book}=learnSiteAnswers(book,fields,[{id:'s1',value:'University of California - Berkeley'}],{jobId:'a',basis:'b'}));
  assert.equal(recallSiteAnswers(fields,book,'b').answers[0].answer,'University of California - Berkeley');
  ({book}=learnSiteAnswers(book,fields,[{id:'g',value:'Male'}],{jobId:'a',basis:'b'}));
  const renamed=fields.map(field=>field.id==='g'?{...field,options:['Man','Woman']}:field);
  assert.equal(recallSiteAnswers(renamed,book,'b').answers.find(item=>item.id==='g')?.answer,'Man');
  const gone=fields.map(field=>field.id==='g'?{...field,options:['Prefer not to say']}:field);
  assert.equal(recallSiteAnswers(gone,book,'b').answers.find(item=>item.id==='g'),undefined);
});

test('ChatGPT receives profile education only for education questions',async()=>{
  const {answersPrompt}=await core;
  const payload=fields=>{const prompt=answersPrompt({profile:tonyProfile},fields);return {prompt,data:JSON.parse(prompt.slice(prompt.lastIndexOf('\n\n')+2))};};
  const withDegree=payload([{id:'d',label:'Degree',type:'combobox',options:['Bachelor\'s Degree',MASTERS]}]);
  assert.equal(withDegree.data.personalInfo.education.length,2);
  assert.match(withDegree.prompt,/first School, Degree and Discipline/);
  assert.equal(payload([{id:'w',label:'Why us?',type:'textarea'}]).data.personalInfo.education,undefined);
});
