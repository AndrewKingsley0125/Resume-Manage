const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalize, defaultAnswerPrompt } = require('../src/shared/application-profile');
const { buildPrompt } = require('../src/main/prompt');

test('older profiles start unanswered without implying no or nondisclosure', () => {
  const result = normalize();
  assert.equal(result.gender, '');
  assert.equal(result.criminalHistory, '');
  assert.equal(result.sponsorshipNow, '');
  assert.equal(result.hasCompanyConnections, 'No');
});

test('application details preserve selections and default company connections to No', () => {
  const result = normalize({postalCode:' 00123 ', gender:'Prefer not to disclose', sponsorshipNow:'No', hasCompanyConnections:'Yes'});
  assert.deepEqual(normalize(JSON.parse(JSON.stringify(result))), result);
  assert.equal(result.postalCode, '00123');
  assert.equal(result.gender, 'Prefer not to disclose');
  assert.equal(result.sponsorshipNow, 'No');
  assert.equal(result.hasCompanyConnections, 'Yes');
  assert.equal(normalize({hasCompanyConnections:'No'}).hasCompanyConnections, 'No');
  const legacy = normalize({companyConnections:[{company:'Example',friends:'No'}],customAnswers:[]});
  assert.equal(legacy.hasCompanyConnections, 'No');
  assert.ok(!('companyConnections' in legacy));
  assert.ok(!('customAnswers' in legacy));
});

test('application disclosures stay out of the resume generation prompt', () => {
  const prompt = buildPrompt({applicationDetails:normalize({address1:'PRIVATE ADDRESS',criminalHistoryDetails:'PRIVATE BACKGROUND'})});
  assert.ok(!prompt.includes('PRIVATE ADDRESS'));
  assert.ok(!prompt.includes('PRIVATE BACKGROUND'));
});

test('answer prompt defaults for older profiles and preserves custom or intentionally empty text', () => {
  assert.equal(normalize().answerPrompt, defaultAnswerPrompt);
  assert.equal(normalize({gender:'Man'}).answerPrompt, defaultAnswerPrompt);
  for (const answerPrompt of ['Custom instructions.\nKeep my wording.', '']) {
    const saved = JSON.parse(JSON.stringify(normalize({answerPrompt})));
    assert.equal(normalize(saved).answerPrompt, answerPrompt);
  }
  const prompt = buildPrompt({applicationDetails:normalize({answerPrompt:'APPLICATION ONLY INSTRUCTIONS'})});
  assert.ok(!prompt.includes('APPLICATION ONLY INSTRUCTIONS'));
});
