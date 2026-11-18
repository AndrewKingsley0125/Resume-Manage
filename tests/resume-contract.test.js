const { test } = require('node:test');
const assert = require('node:assert/strict');
const Resume = require('../src/shared/resume');
const { buildPrompt, renderPrompt } = require('../src/main/prompt');
const profile = {title:'Senior Engineer',workHistory:[{company:'Example $& Employer',location:'Chicago',period:'2020 - 2026',workType:'Contract',workArrangement:'Remote'}],education:[{degree:'BS Computer Science',institution:'Example University',period:'2013 - 2017'}]};
const valid = () => ({company:'Hiring Company',title:'Senior Backend Engineer',summary:'A summary.',skills:[{Languages:['JavaScript']}],experience:[{company:'Example $& Employer',title:'Senior Engineer',overview:'Context. Outcome.',sentences:['Built services.'],technologies:['JavaScript']}],education:[{degree:'BS Computer Science'}]});

test('fixed schema accepts plain and fenced JSON', () => {
  const data = valid();
  assert.deepEqual(Resume.parse(JSON.stringify(data),profile),data);
  assert.deepEqual(Resume.parse('```json\n'+JSON.stringify(data)+'\n```',profile),data);
  const scores='Iterate 0: ATS Alignment Score — 82/100\nIterate 3: ATS Alignment Score — 94/100\nTarget not reached: missing required clearance.\n\n';
  assert.deepEqual(Resume.parse(scores+'```json\n'+JSON.stringify(data)+'\n```',profile),data);
});
test('schema rejects missing and extra keys and invalid nested types', () => {
  const cases = [
    d => {delete d.summary;}, d => {d.extra = true;}, d => {d.experience[0].overview = 42;},
    d => {delete d.experience[0].technologies;}, d => {d.experience[0].technologies = ['JS',12];},
    d => {d.skills = [{Languages:['JS'],Other:['SQL']}];}, d => {d.education = [{degree:3}];},
    d => {d.experience[0].company = '  ';}, d => {d.experience.push({...d.experience[0]});}, d => {d.experience = [];},
  ];
  for(const mutate of cases) {const data=valid();mutate(data);assert.throws(()=>Resume.validate(data,profile));}
  // An employer worded differently in the JSON is accepted.
  const renamed=valid();renamed.experience[0].company='Example Employer Inc.';
  assert.doesNotThrow(()=>Resume.validate(renamed,profile));
  assert.throws(()=>Resume.parse('```json\n{"error":"Required onsite work"}\n```'),/Required onsite/);
});
test('legacy migration fills new fields without changing profile facts', () => {
  const migrated=Resume.migrate({title:'JSON title',experience:[{company:'Old generated company',title:'Role',sentences:['Contribution.']}],education:[{degree:'Wrong degree'}]},profile);
  Resume.validate(migrated,profile);
  assert.equal(migrated.experience[0].company,profile.workHistory[0].company);
  assert.equal(migrated.experience[0].overview,'');
  assert.deepEqual(migrated.experience[0].technologies,[]);
  assert.equal(migrated.education[0].degree,'BS Computer Science');
});
test('seed schema matches the selected profile', () => {
  const seed=Resume.seed(profile);Resume.validate(seed,profile);
  assert.equal(seed.experience.length,1);
  assert.equal(seed.experience[0].company,profile.workHistory[0].company);
});
test('full prompt preserves revised instructions and injects profile only', () => {
  const prompt=buildPrompt(profile,new Date(2026,9,28));
  for(const required of ['## 1. TASK AND CANDIDATE PROFILE','based on the candidate profile and complete job description (JD)','## 9. REQUIRED JSON OUTPUT','## 8. MANDATORY THREE-PASS REVIEW','**Professional Experience**','- Example $& Employer — Chicago, Contract, Remote, 2020 - 2026','- BS Computer Science, Example University, 2013 - 2017','[PASTE THE JOB DESCRIPTION HERE]']) assert.ok(prompt.includes(required),required);
  // No sample candidate's facts leak into another profile's prompt.
  for(const forbidden of ['{{CANDIDATE_PROFILE}}','Tony Zhao','Snowflake','TruEra','Ejenta','Berkeley']) assert.ok(!prompt.includes(forbidden),forbidden);
});
test('optional employer roles appear in the candidate info only when supplied', () => {
  const withRole={...profile,workHistory:[{...profile.workHistory[0],role:'Staff Platform Engineer'},{company:'No Role Co',period:'2018 - 2020'}]};
  const prompt=buildPrompt(withRole);
  assert.ok(prompt.includes('- Example $& Employer — Staff Platform Engineer, Chicago, Contract, Remote, 2020 - 2026'));
  assert.ok(prompt.includes('- No Role Co — 2018 - 2020'));
  // An emptied role is not replaced by a legacy title.
  assert.ok(buildPrompt({...profile,workHistory:[{company:'X',title:'Old',role:'',period:'2020'}]}).includes('- X — 2020'));
});
test('custom resume prompt replaces the generated prompt when selected', () => {
  const custom={...profile,resumePromptMode:'custom',customResumePrompt:'  My prompt\n{{CANDIDATE_PROFILE}}\nEnd  '};
  const prompt=buildPrompt(custom);
  assert.ok(prompt.startsWith('My prompt\n**Professional Experience**'));
  assert.ok(prompt.includes('- Example $& Employer — Chicago'));
  assert.ok(prompt.endsWith('End'));
  assert.ok(!prompt.includes('## 1. TASK AND CANDIDATE PROFILE'));
  assert.equal(buildPrompt({...custom,customResumePrompt:'Just this'}),'Just this');
  // Not selected, or left empty: the generated prompt is used.
  for(const p of [{...custom,resumePromptMode:'profile'},{...custom,customResumePrompt:'   '}]) assert.ok(buildPrompt(p).includes('## 1. TASK AND CANDIDATE PROFILE'));
});
test('with the switch on, the resume shows the employer names written in the JSON, keeping each job\'s profile dates', () => {
  const p={useJsonEmployerNames:true,workHistory:[
    {company:'Snowflake',period:'May 2024 - Oct 2026',location:'Menlo Park, CA'},
    {company:'TruEra',period:'Feb 2022 - May 2024'},
    {company:'Amazon',period:'May 2019 - Aug 2020'}]};
  // Reworded names, and the JSON lists the roles in a different order.
  const roles=Resume.experience(p,{experience:[
    {company:'Amazon Web Services',title:'SDE',sentences:['A.']},
    {company:'Snowflake Inc.',title:'Senior SWE',sentences:['S.']},
    {company:'TruEra',title:'Senior ML Infra',sentences:['T.']}]});
  assert.deepEqual(roles.map(r=>r.company),['Snowflake Inc.','TruEra','Amazon Web Services']);
  assert.deepEqual(roles.map(r=>r.title),['Senior SWE','Senior ML Infra','SDE']);
  assert.equal(roles[0].period,'May 2024 - Oct 2026');assert.equal(roles[0].location,'Menlo Park, CA');
  // A name with nothing in common falls back to the same position; a blank name keeps the profile's.
  const byPosition=Resume.experience(p,{experience:[{company:'Data Cloud Co',title:'A'},{company:'',title:'B'},{company:'AWS',title:'C'}]});
  assert.deepEqual(byPosition.map(r=>r.company),['Data Cloud Co','TruEra','AWS']);
  assert.deepEqual(byPosition.map(r=>r.title),['A','B','C']);
  // Switch off (the default): the profile's names, with each JSON role still matched to its job.
  const off=Resume.experience({...p,useJsonEmployerNames:false},{experience:[{company:'Amazon Web Services',title:'SDE'},{company:'Snowflake Inc.',title:'Senior SWE'},{company:'TruEra',title:'Senior ML Infra'}]});
  assert.deepEqual(off.map(r=>r.company),['Snowflake','TruEra','Amazon']);
  assert.deepEqual(off.map(r=>r.title),['Senior SWE','Senior ML Infra','SDE']);
  assert.deepEqual(Resume.experience({workHistory:p.workHistory},{experience:[{company:'Snowflake Inc.'},{company:'TruEra'},{company:'Amazon'}]}).map(r=>r.company),['Snowflake','TruEra','Amazon']);
});
test('repeated employers match distinct roles without reusing content', () => {
  const p={workHistory:[{company:'Same',period:'2024 - 2026'},{company:'Same',period:'2020 - 2022'}]};
  const roles=Resume.experience(p,{experience:[{company:'Same',title:'Recent'},{company:'Same',title:'Earlier'}]});
  assert.equal(roles[0].title,'Recent');assert.equal(roles[1].title,'Earlier');
});

test('Markdown outside candidate details remains unchanged, including line endings', () => {
  const fs = require('node:fs'), path = require('node:path');
  const template=fs.readFileSync(path.join(__dirname,'../src/prompts/resume-new.md'),'utf8');
  const prompt=renderPrompt(template,{...profile,firstName:'Jane',lastName:'Smith',location:'Austin'});
  const [before,after]=template.split('{{CANDIDATE_PROFILE}}');
  assert.ok(prompt.startsWith(before));
  assert.ok(prompt.endsWith(after));
  assert.ok(prompt.includes('**Name:** Jane Smith'));
  assert.ok(prompt.includes('**Location:** Austin'));
  assert.ok(prompt.includes('Example $& Employer'));
  assert.ok(!prompt.includes('{{CANDIDATE_PROFILE}}'));
  const crlf=template.replace(/\r?\n/g,'\r\n');
  assert.ok(!renderPrompt(crlf,profile).replace(/\r\n/g,'').includes('\n'));
  assert.throws(()=>renderPrompt('Missing candidate block',profile),/CANDIDATE_PROFILE/);
});
