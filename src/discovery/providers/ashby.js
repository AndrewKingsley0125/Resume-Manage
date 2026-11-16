// Ashby public Job Postings API (no key): https://developers.ashbyhq.com/docs/public-job-posting-api
//   GET https://api.ashbyhq.com/posting-api/job-board/{name}?includeCompensation=true
// Returns every listed job in one response.
const { buildJob, salaryPeriod, htmlToText } = require('../normalize');

const id = 'ashby';

function detectSource(url) {
  let parsed;try {parsed = new URL(url);} catch (_) {return null;}
  const host = parsed.hostname.toLowerCase(), parts = parsed.pathname.split('/').filter(Boolean);
  if (host === 'jobs.ashbyhq.com' && parts[0]) return { provider: id, board: decodeURIComponent(parts[0]).toLowerCase() };
  if (host === 'api.ashbyhq.com' && parts[0] === 'posting-api' && parts[1] === 'job-board' && parts[2]) return { provider: id, board: decodeURIComponent(parts[2]).toLowerCase() };
  return null;
}

const boardUrl = board => `https://jobs.ashbyhq.com/${encodeURIComponent(board.board || board)}`;

async function fetchJobs(board, { http }) {
  const data = await http.getJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board.board)}?includeCompensation=true`);
  if (!data || !Array.isArray(data.jobs)) throw new Error('Ashby returned no jobs list.');
  // Unlisted jobs are reachable by link only; they are not public openings.
  return { jobs: data.jobs.filter(job => job.isListed !== false), complete: true };
}

function country(address) {
  const value = String(address?.postalAddress?.addressCountry || '').trim();
  return /^(?:usa|us|united states(?: of america)?)$/i.test(value) ? 'US' : value || null;
}

function normalizeJob(raw, board) {
  const components = raw.compensation?.summaryComponents || [];
  const salary = components.find(item => item.compensationType === 'Salary');
  const locations = [raw.location, ...(raw.secondaryLocations || []).map(item => item.location)].filter(Boolean);
  return buildJob({
    provider: id,
    board: board.board,
    externalId: raw.id,
    companyName: board.companyName,
    title: raw.title,
    description: raw.descriptionPlain || htmlToText(raw.descriptionHtml),
    department: raw.department,
    locationText: locations.join('; '),
    country: locations.length === 1 ? country(raw.address) : null,
    remote: raw.isRemote === true && raw.workplaceType === 'Remote',
    workplaceType: raw.workplaceType || (raw.isRemote ? 'Remote' : ''),
    employmentType: raw.employmentType,
    salaryMin: salary && salary.minValue != null ? Number(salary.minValue) : undefined,
    salaryMax: salary && salary.maxValue != null ? Number(salary.maxValue) : undefined,
    salaryCurrency: salary?.currencyCode,
    salaryPeriod: salary ? salaryPeriod(salary.interval) : undefined,
    publishedAt: raw.publishedAt,
    publishedAtSource: 'ashby.publishedAt',
    sourceUrl: raw.jobUrl,
    applyUrl: raw.applyUrl || raw.jobUrl,
  });
}

module.exports = { id, detectSource, boardUrl, fetchJobs, normalizeJob };
