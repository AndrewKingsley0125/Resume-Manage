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
    d => {d.experience[0].company = 'Wrong employer';}, d => {d.experience.push({...d.experience[0]});},
  ];
  for(const mutate of cases) {const data=valid();mutate(data);assert.throws(()=>Resume.validate(data,profile));}
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
  for(const required of ['## 1. TASK, INPUTS, AND PRIORITIES','Given the candidate profile and complete job description (JD)','## 9. REQUIRED JSON OUTPUT','## 8. MANDATORY INTERNAL REVIEW AND ALIGNMENT LOOP','- Example $& Employer, Senior Engineer, Chicago, Contract, Remote, 2020 - 2026','Example University 2013 - 2017']) assert.ok(prompt.includes(required),required);
  for(const forbidden of ['{{CANDIDATE_PROFILE}}','DoorDash','Instagram','JPMorgan Chase','New York University']) assert.ok(!prompt.includes(forbidden),forbidden);
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
  assert.ok(prompt.includes('Name: Jane Smith'));
  assert.ok(prompt.includes('Location: Austin'));
  assert.ok(prompt.includes('Example $& Employer'));
  assert.ok(!prompt.includes('{{CANDIDATE_PROFILE}}'));
  const crlf=template.replace(/\r?\n/g,'\r\n');
  assert.ok(!renderPrompt(crlf,profile).replace(/\r\n/g,'').includes('\n'));
  assert.throws(()=>renderPrompt('Missing candidate block',profile),/CANDIDATE_PROFILE/);
});
