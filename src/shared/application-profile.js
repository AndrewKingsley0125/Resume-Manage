(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.App = root.App || {}; root.App.ApplicationProfile = factory(); }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const defaultAnswerPrompt = 'Give me answer for this question at senior level, do not set normal case as example, set example as sth really impactful, meaningful, uncommon, seniority, professional example. Answer style must be humanized, natural, not like AI style.\nTwo or Three sentences answer would be great.';
  const yesNo = ['Yes', 'No', 'Prefer not to disclose'];
  const fields = [
    ['address1', 'Address line 1', 'Address'],
    ['address2', 'Address line 2', 'Address'],
    ['city', 'City', 'Address'],
    ['state', 'State / province', 'Address'],
    ['postalCode', 'ZIP / postal code', 'Address'],
    ['country', 'Country', 'Address'],
    ['workAuthorization', 'Work authorization details (include country)', 'Work eligibility'],
    ['authorizedToWork', 'Authorized to work in the application country?', 'Work eligibility', yesNo],
    ['sponsorshipNow', 'Need sponsorship now?', 'Work eligibility', yesNo],
    ['sponsorshipFuture', 'Need sponsorship in the future?', 'Work eligibility', yesNo],
    ['gender', 'Gender', 'Voluntary disclosures', ['Woman', 'Man', 'Nonbinary', 'Self-describe', 'Prefer not to disclose']],
    ['genderDescription', 'Gender self-description (optional)', 'Voluntary disclosures'],
    ['hispanicLatino', 'Hispanic / Latino ethnicity', 'Voluntary disclosures', ['Hispanic or Latino', 'Not Hispanic or Latino', 'Prefer not to disclose']],
    ['race', 'Race / ethnicity (self-description)', 'Voluntary disclosures'],
    ['veteranStatus', 'Veteran status', 'Voluntary disclosures', ['Protected veteran', 'Veteran, not a protected veteran', 'Not a veteran', 'Prefer not to disclose']],
    ['disabilityStatus', 'Disability status', 'Voluntary disclosures', ['Yes', 'No', 'Prefer not to disclose']],
    ['hasCompanyConnections', 'Relatives, friends, or other connections at the company?', 'Company connections', ['Yes', 'No']],
    ['criminalHistory', 'Criminal-history response', 'Background', yesNo],
    ['criminalHistoryDetails', 'Exact question / explanation for criminal-history response', 'Background'],
  ];
  const string = value => typeof value === 'string' ? value.trim() : '';
  function normalize(value) {
    const source = value && typeof value === 'object' ? value : {};
    const result = Object.fromEntries(fields.map(([key]) => [key, string(source[key])]));
    result.hasCompanyConnections = source.hasCompanyConnections === 'Yes' ? 'Yes' : 'No';
    result.answerPrompt = typeof source.answerPrompt === 'string' ? source.answerPrompt : defaultAnswerPrompt;
    return result;
  }
  return { fields, normalize, defaultAnswerPrompt };
});
