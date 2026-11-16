// Greenhouse public Job Board API (no key): https://developers.greenhouse.io/job-board.html
//   GET .../v1/boards/{token}/jobs                         every open job, without descriptions (fast, small)
//   GET .../v1/boards/{token}/jobs/{id}?pay_transparency=true   one job with description and pay
// Asking for every description at once (?content=true) takes Greenhouse
// seconds to minutes per board, so boards are listed first and descriptions
// are loaded afterwards, one job at a time, only for jobs that fit a profile.
const crypto = require('node:crypto');
const { htmlToText, buildJob, salaryPeriod } = require('../normalize');

const id = 'greenhouse';
const HOSTS = /(^|\.)greenhouse\.io$/i;
const API = 'https://boards-api.greenhouse.io/v1/boards';

// Board token from any Greenhouse URL: boards./job-boards. pages, embeds, the API.
function detectSource(url) {
  let parsed;try {parsed = new URL(url);} catch (_) {return null;}
  if (!HOSTS.test(parsed.hostname)) return null;
  const embedded = parsed.searchParams.get('for');
  if (embedded) return { provider: id, board: embedded.toLowerCase() };
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parsed.hostname.startsWith('boards-api.')) {
    const index = parts.indexOf('boards');
    return index >= 0 && parts[index + 1] ? { provider: id, board: parts[index + 1].toLowerCase() } : null;
  }
  if (!parts.length || ['embed', 'v1'].includes(parts[0])) return null;
  return { provider: id, board: parts[0].toLowerCase() };
}

const boardUrl = board => `https://job-boards.greenhouse.io/${encodeURIComponent(board)}`;

// Fingerprint of a listing: which jobs are open and when each last changed.
const listingHash = jobs => crypto.createHash('sha1').update(jobs.map(job => `${job.id}@${job.updated_at}`).sort().join('|')).digest('hex');

async function fetchJobs(board, { http }) {
  const data = await http.getJson(`${API}/${encodeURIComponent(board.board)}/jobs`);
  if (!data || !Array.isArray(data.jobs)) throw new Error('Greenhouse returned no jobs list.');
  const hash = listingHash(data.jobs);
  if (board.listing_hash && hash === board.listing_hash) return { unchanged: true, listingHash: hash };
  return { jobs: data.jobs, complete: true, listingHash: hash };
}

// Description and pay for one listed job.
async function fetchDetails(job, { http }) {
  const raw = await http.getJson(`${API}/${encodeURIComponent(job.board)}/jobs/${encodeURIComponent(job.externalId)}?pay_transparency=true`);
  if (!raw || raw.id == null) throw new Error('Greenhouse returned no job.');
  return normalizeJob(raw, { board: job.board, companyName: job.companyName });
}

function normalizeJob(raw, board) {
  // US ranges are preferred when a posting lists several regions.
  const ranges = Array.isArray(raw.pay_input_ranges) ? raw.pay_input_ranges : [];
  const range = ranges.find(item => item.currency_type === 'USD') || ranges[0];
  const metadata = Array.isArray(raw.metadata) ? raw.metadata : [];
  const meta = pattern => metadata.find(item => pattern.test(item.name || '') && item.value)?.value;
  return buildJob({
    provider: id,
    board: board.board,
    externalId: raw.id,
    companyName: raw.company_name || board.companyName,
    title: raw.title,
    description: htmlToText(raw.content),
    detailsLoaded: raw.content !== undefined,
    // Greenhouse's update time marks real changes; loading the description later is not one.
    changeKey: [raw.title, raw.location?.name, raw.updated_at],
    department: raw.departments?.[0]?.name,
    locationText: raw.location?.name || '',
    workplaceType: [].concat(meta(/workplace|working location|remote/i) || []).join(' '),
    employmentType: [].concat(meta(/employment type|job type|time type/i) || []).join(' '),
    salaryMin: range ? range.min_cents / 100 : undefined,
    salaryMax: range ? range.max_cents / 100 : undefined,
    salaryCurrency: range?.currency_type,
    // Greenhouse ranges carry no period field; only their title can say so.
    salaryPeriod: range ? salaryPeriod(range.title) : undefined,
    publishedAt: raw.first_published,
    publishedAtSource: 'greenhouse.first_published',
    updatedAt: raw.updated_at,
    sourceUrl: raw.absolute_url,
    applyUrl: raw.absolute_url,
  });
}

module.exports = { id, detectSource, boardUrl, fetchJobs, fetchDetails, normalizeJob };
