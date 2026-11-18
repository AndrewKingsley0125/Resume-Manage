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

test('a site default question is saved once two jobs on the site asked it, in the site wording',async()=>{
  const {learnSiteAnswers,recallSiteAnswers,profileBasis}=await core;
  const basis=profileBasis(tonyProfile),fields=greenhouseForm();
  const values=[['f','Tony'],['s1','University of California - Berkeley'],['d1',MASTERS],['y1','2020'],['g','Male'],['k','No'],['w','Because...'],['r','Boston']].map(([id,value])=>({id,value}));
  let {book,saved}=learnSiteAnswers(undefined,fields,values,{jobId:'job1',company:'Smartsheet',basis});
  assert.equal(saved,0,'a question seen on one job is not a site default yet');
  const next=greenhouseForm().map(field=>({...field,id:'n'+field.id,fillMode:undefined,answerFormat:undefined}));
  assert.deepEqual(recallSiteAnswers(next,book,basis).answers,[]);
  ({book,saved}=learnSiteAnswers(book,fields,values,{jobId:'job2',company:'Smartsheet',basis}));
  // Contact fields, free text and questions naming the company are never saved.
  assert.deepEqual(Object.values(book.answers).map(entry=>entry.label).sort(),['Degree','Gender','Preferred office','School','Start date year']);
  assert.equal(saved,5);
  const recalled=recallSiteAnswers(next,book,basis);
  const byId=Object.fromEntries(recalled.answers.map(item=>[item.id,item.answer]));
  assert.equal(byId.ns1,'University of California - Berkeley');assert.equal(byId.nd1,MASTERS);assert.equal(byId.ng,'Male');
  assert.equal(byId.ns2,undefined,'the second education block has its own answer');
  assert.equal(recalled.fields.find(field=>field.id==='ns1').fillMode,'search');
  // Editing one part of the profile forgets only the answers that rest on it.
  assert.deepEqual(recallSiteAnswers(next,book,profileBasis({...tonyProfile,education:[]})).answers.map(item=>item.id).sort(),['ng','nr']);
  assert.deepEqual(recallSiteAnswers(next,book,profileBasis({...tonyProfile,applicationDetails:{gender:'Woman'}})).answers.map(item=>item.id).sort(),['nd1','nr','ns1','ny1']);
  // Adding an unrelated detail (travel) forgets nothing.
  assert.equal(recallSiteAnswers(next,book,profileBasis({...tonyProfile,applicationDetails:{...tonyProfile.applicationDetails,travelDetails:'Up to 25%'}})).answers.length,5);
});

test('answers saved under the older rules are reused only when the site record shows two jobs asked them',async()=>{
  const {recallSiteAnswers,siteAnswerCount,profileBasis}=await core;
  // The whole-profile fingerprint the book had, from before the three common answers existed.
  const source=JSON.stringify([tonyProfile.firstName,tonyProfile.lastName,tonyProfile.location,tonyProfile.education,{gender:'Man'}]);
  let hash=5381;for(let i=0;i<source.length;i++)hash=(hash*33^source.charCodeAt(i))>>>0;
  const withDefaults={...tonyProfile,applicationDetails:{gender:'Man',answerPrompt:'x',availableToStart:'Immediately',howDidYouHear:'LinkedIn',appliedBefore:'No'}};
  const fields=[{id:'g',label:'Gender',type:'select',options:['Male','Female']}];
  const once={basis:hash.toString(36),answers:{'select|gender#0':{answer:'Male',label:'Gender'}},seen:{}};
  assert.deepEqual(recallSiteAnswers(fields,once,profileBasis(withDefaults)).answers,[],'saved after a single job');
  assert.equal(siteAnswerCount(once,profileBasis(withDefaults)),0);
  const twice={...once,seen:{'select|gender#0':{a:'Male',b:'Male'}}};
  assert.deepEqual(recallSiteAnswers(fields,twice,profileBasis(withDefaults)).answers,[{id:'g',answer:'Male'}]);
  assert.equal(siteAnswerCount(twice,profileBasis(withDefaults)),1);
  assert.deepEqual(recallSiteAnswers(fields,twice,profileBasis({...withDefaults,location:'Boston'})).answers,[]);
});

test('the newest answer to a site default question is the one reused',async()=>{
  const {learnSiteAnswers,recallSiteAnswers}=await core;
  const fields=greenhouseForm(),office=value=>[{id:'r',value}];
  let {book}=learnSiteAnswers(undefined,fields,office('Boston'),{jobId:'a',basis:'b'});
  ({book}=learnSiteAnswers(book,fields,office('Boston'),{jobId:'a',basis:'b'}));
  assert.deepEqual(recallSiteAnswers(fields,book,'b').answers,[],'the same job twice is still one job');
  ({book}=learnSiteAnswers(book,fields,office('Boston'),{jobId:'b',basis:'b'}));
  assert.deepEqual(recallSiteAnswers(fields,book,'b').answers,[{id:'r',answer:'Boston'}]);
  ({book}=learnSiteAnswers(book,fields,office('Bellevue'),{jobId:'c',basis:'b'}));
  assert.deepEqual(recallSiteAnswers(fields,book,'b').answers,[{id:'r',answer:'Bellevue'}]);
  // Your correction on an earlier job, made later, is now the newest answer.
  ({book}=learnSiteAnswers(book,fields,office('Boston'),{jobId:'a',basis:'b'}));
  assert.deepEqual(recallSiteAnswers(fields,book,'b').answers,[{id:'r',answer:'Boston'}]);
});

test('a corrected answer replaces the saved one, and a choice the site no longer offers is not reused',async()=>{
  const {learnSiteAnswers,recallSiteAnswers}=await core;
  const fields=greenhouseForm();
  let {book}=learnSiteAnswers(undefined,fields,[{id:'s1',value:'University of California - Davis'},{id:'g',value:'Male'}],{jobId:'a',basis:'b'});
  ({book}=learnSiteAnswers(book,fields,[{id:'s1',value:'University of California - Davis'},{id:'g',value:'Male'}],{jobId:'b',basis:'b'}));
  ({book}=learnSiteAnswers(book,fields,[{id:'s1',value:'University of California - Berkeley'}],{jobId:'b',basis:'b'}));
  assert.equal(recallSiteAnswers(fields,book,'b').answers.find(item=>item.id==='s1').answer,'University of California - Berkeley');
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
