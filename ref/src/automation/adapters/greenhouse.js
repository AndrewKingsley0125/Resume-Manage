// Greenhouse job boards (job-boards.greenhouse.io/<company>/jobs/<id>).
// JD and application form are on the same page. Fields use stable ids:
//   first_name, last_name, email, phone, country, resume, cover_letter,
//   question_<n> (custom questions), gender, hispanic_ethnicity, veteran_status, ...
// Dropdowns are react-select comboboxes. reCAPTCHA is loaded and checked at submit.
// Sample: samples/greenhouse-affirm
const generic = require('./generic');

const FORM = '#application-form';

async function extractJob(page) {
  const job = await page.evaluate(() => {
    const text = sel => ((document.querySelector(sel) || {}).innerText || '').trim();
    const company = / at (.+)$/.exec(document.title.trim()); // "Job Application for <title> at <company>"
    const location = text('.job__location');
    return {
      title: text('.job__title h1'),
      company: company ? company[1].trim() : '',
      location,
      remote: /remote/i.test(location) || null,
      description: text('.job__description'),
      source: 'greenhouse',
    };
  });
  return job.description ? job : generic.extractJob(page);
}

async function openApplication(page, cursor) {
  const form = page.locator(FORM);
  if (!(await form.count())) return generic.openApplication(page, cursor);
  await form.scrollIntoViewIfNeeded();
  return page;
}

module.exports = {
  ...generic,
  id: 'greenhouse',
  matches: url => /(^|\.)greenhouse\.io$/i.test(url.hostname),
  extractJob,
  openApplication,
  scan: page => generic.scan(page, FORM),
  findSubmit: page => generic.helpers.firstVisible(page.locator(`${FORM} button[type="submit"]`)),
};
