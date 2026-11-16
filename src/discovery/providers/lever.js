// Lever public Postings API (no key): https://github.com/lever/postings-api
//   GET https://api.lever.co/v0/postings/{site}?mode=json&limit=500&skip=N
// EU-hosted sites use api.eu.lever.co.
const { htmlToText, buildJob, salaryPeriod } = require('../normalize');

const id = 'lever';
// Large pages: Lever answers slowly per request, not per posting.
const PAGE = 500;

function detectSource(url) {
  let parsed;try {parsed = new URL(url);} catch (_) {return null;}
  const host = parsed.hostname.toLowerCase();
  const parts = parsed.pathname.split('/').filter(Boolean);
  const eu = /\.eu\.lever\.co$/.test(host);
  if (/^jobs\.(?:eu\.)?lever\.co$/.test(host) && parts[0]) return { provider: id, board: parts[0].toLowerCase(), region: eu ? 'eu' : 'us' };
  if (/^api\.(?:eu\.)?lever\.co$/.test(host) && parts[0] === 'v0' && parts[1] === 'postings' && parts[2]) return { provider: id, board: parts[2].toLowerCase(), region: eu ? 'eu' : 'us' };
  return null;
}

const apiHost = board => board.region === 'eu' ? 'https://api.eu.lever.co' : 'https://api.lever.co';
const boardUrl = board => `https://jobs.${board.region === 'eu' ? 'eu.' : ''}lever.co/${encodeURIComponent(board.board || board)}`;

async function fetchJobs(board, { http, maxPages = 50 }) {
  const jobs = [];
  for (let page = 0; page < maxPages; page++) {
    const batch = await http.getJson(`${apiHost(board)}/v0/postings/${encodeURIComponent(board.board)}?mode=json&limit=${PAGE}&skip=${page * PAGE}`);
    if (!Array.isArray(batch)) throw new Error('Lever returned no postings list.');
    jobs.push(...batch);
    if (batch.length < PAGE) return { jobs, complete: true };
  }
  return { jobs, complete: false };
}

function normalizeJob(raw, board) {
  const categories = raw.categories || {};
  const salary = raw.salaryRange || null;
  const sections = (raw.lists || []).map(list => `${list.text}\n${htmlToText(list.content)}`).join('\n\n');
  return buildJob({
    provider: id,
    board: board.board,
    externalId: raw.id,
    companyName: board.companyName,
    title: raw.text,
    description: [raw.descriptionPlain || htmlToText(raw.description), sections, raw.additionalPlain || htmlToText(raw.additional)].filter(Boolean).join('\n\n'),
    department: categories.department || categories.team,
    locationText: (categories.allLocations && categories.allLocations.length ? categories.allLocations : [categories.location]).filter(Boolean).join('; '),
    country: raw.country || null,
    workplaceType: raw.workplaceType,
    employmentType: categories.commitment,
    salaryMin: salary ? Number(salary.min) : undefined,
    salaryMax: salary ? Number(salary.max) : undefined,
    salaryCurrency: salary?.currency,
    salaryPeriod: salary ? salaryPeriod(salary.interval) : undefined,
    // Lever exposes when the posting was created, not a separate publish date.
    publishedAt: raw.createdAt,
    publishedAtSource: 'lever.createdAt',
    sourceUrl: raw.hostedUrl,
    applyUrl: raw.applyUrl || raw.hostedUrl,
  });
}

module.exports = { id, detectSource, boardUrl, fetchJobs, normalizeJob };
