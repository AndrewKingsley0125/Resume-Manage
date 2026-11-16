// The one job shape every collector produces. Missing facts are null (or
// 'unknown' for enumerations); nothing is filled in from guesses. Salary and
// dates come only from structured provider fields.
const crypto = require('node:crypto');
const { parseLocations, remoteScope } = require('./locations');

const UNKNOWN = 'unknown';
const VERIFICATION = Object.freeze({
  VERIFIED_ORIGINAL: 'VERIFIED_ORIGINAL', UNVERIFIED: 'UNVERIFIED', UNRESOLVED: 'UNRESOLVED', EXPIRED: 'EXPIRED', BLOCKED: 'BLOCKED',
});

const decodeEntities = text => String(text || '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
// Greenhouse sends description HTML entity-encoded; decode twice to reach the text.
function htmlToText(html) {
  const markup = /&lt;\w/.test(html || '') ? decodeEntities(html) : String(html || '');
  return decodeEntities(markup
    .replace(/<(?:script|style)[\s\S]*?<\/(?:script|style)>/gi, ' ')
    .replace(/<\/(?:p|div|li|h[1-6]|br|tr)>|<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const normalizeTitle = title => String(title || '').toLowerCase().replace(/\bsr\.?(?=\s)/g, 'senior').replace(/\bjr\.?(?=\s)/g, 'junior')
  .replace(/\bswe\b/g, 'software engineer').replace(/[^a-z0-9+#]+/g, ' ').trim();

function seniorityOf(title) {
  const text = normalizeTitle(title);
  const rules = [
    ['intern', /\bintern(?:ship)?\b|\bco op\b/], ['executive', /\b(?:vp|vice president|chief|cto|ceo|cfo|head of)\b/],
    ['director', /\bdirector\b/], ['principal', /\bprincipal\b|\bdistinguished\b/], ['staff', /\bstaff\b/],
    ['manager', /\bmanager\b/], ['lead', /\blead\b/], ['senior', /\bsenior\b|\biii\b|\biv\b|\b(?:engineer|developer|scientist) [34]\b/],
    // Level numbers after the role: "Software Engineer I" or "Engineer-1" is entry level, "II"/"2" mid.
    ['entry', /\bjunior\b|\bentry\b|\bassociate\b|\bnew grad\b|\bgraduate\b|\b(?:engineer|developer|scientist|analyst) (?:i|1)\b/], ['mid', /\bii\b|\bmid\b|\b(?:engineer|developer|scientist|analyst) 2\b/],
  ];
  return rules.find(([, pattern]) => pattern.test(text))?.[0] || UNKNOWN;
}

function employmentType(value) {
  const text = String(value || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!text) return UNKNOWN;
  if (/intern/.test(text)) return 'intern';
  if (/contract|contractor|freelance/.test(text)) return 'contract';
  if (/temp/.test(text)) return 'temporary';
  if (/parttime/.test(text)) return 'part-time';
  if (/fulltime|permanent|regular/.test(text)) return 'full-time';
  return UNKNOWN;
}

function workArrangement(value, places) {
  const text = String(value || '').toLowerCase();
  if (/hybrid/.test(text)) return 'hybrid';
  if (/remote/.test(text)) return 'remote';
  if (/on-?site|in.?office/.test(text)) return 'onsite';
  if (places.some(place => place.remote) && !places.some(place => !place.remote)) return 'remote';
  return UNKNOWN;
}

// Tracking parameters are dropped; the job's own identifiers are kept.
const TRACKING = /^(?:utm_.+|gh_src|source|lever-source|lever-origin|ref|referrer|src|ashby_jid)$/i;
function canonicalUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) if (TRACKING.test(key)) parsed.searchParams.delete(key);
    parsed.hostname = parsed.hostname.toLowerCase();
    return parsed.toString().replace(/\/$/, '');
  } catch (_) { return null; }
}

const isoDate = value => {
  if (value == null || value === '') return null;
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

function salaryPeriod(value) {
  const text = String(value || '').toLowerCase();
  if (/hour/.test(text)) return 'hour';
  if (/year|annual|salary/.test(text)) return 'year';
  if (/month/.test(text)) return 'month';
  if (/week/.test(text)) return 'week';
  return UNKNOWN;
}

// Builds the stored record. `fields` are the provider's facts, already mapped.
function buildJob(fields) {
  const places = parseLocations(fields.locationText);
  // The provider's country field fills in the country, but is marked: only a
  // country the posting text names can make a remote job "US nationwide".
  for (const place of places) if (!place.country && fields.country && places.length === 1) {place.country = fields.country;place.countryFromProvider = true;}
  const states = [...new Set(places.flatMap(place => place.states || []))];
  const countries = [...new Set(places.map(place => place.country).filter(Boolean))];
  const arrangement = workArrangement(fields.workplaceType, places);
  const remote = arrangement === 'remote' || fields.remote === true || places.some(place => place.remote);
  const id = `${fields.provider}:${fields.board}:${fields.externalId}`;
  return {
    id,
    provider: fields.provider,
    board: fields.board,
    externalId: String(fields.externalId),
    companyName: fields.companyName || null,
    title: String(fields.title || '').trim(),
    normalizedTitle: normalizeTitle(fields.title),
    seniority: seniorityOf(fields.title),
    description: fields.description || '',
    department: fields.department || null,
    locationText: fields.locationText || '',
    places,
    countries,
    states,
    city: places.find(place => place.city)?.city || null,
    remote,
    remoteScope: remote ? remoteScope(places, { remoteFlag: true }) : null,
    workArrangement: arrangement,
    employmentType: employmentType(fields.employmentType),
    salaryMin: Number.isFinite(fields.salaryMin) ? fields.salaryMin : null,
    salaryMax: Number.isFinite(fields.salaryMax) ? fields.salaryMax : null,
    salaryCurrency: fields.salaryCurrency || null,
    salaryPeriod: Number.isFinite(fields.salaryMin) || Number.isFinite(fields.salaryMax) ? (fields.salaryPeriod || UNKNOWN) : null,
    publishedAt: isoDate(fields.publishedAt),
    publishedAtSource: fields.publishedAt != null ? fields.publishedAtSource : null,
    updatedAt: isoDate(fields.updatedAt),
    sourceUrl: fields.sourceUrl || null,
    applyUrl: fields.applyUrl || fields.sourceUrl || null,
    canonicalUrl: canonicalUrl(fields.sourceUrl),
    verification: VERIFICATION.UNVERIFIED,
    status: 'active',
    // false: listed without its description and pay; those are loaded later for jobs that matter.
    detailsLoaded: fields.detailsLoaded !== false,
    // What identifies a change in the posting. Providers that list jobs without
    // details pass their own (e.g. Greenhouse's update time), so loading the
    // description later does not count as a change.
    contentHash: crypto.createHash('sha1').update(JSON.stringify(fields.changeKey || [fields.title, fields.locationText, fields.description, fields.salaryMin, fields.salaryMax])).digest('hex'),
  };
}

// Same opening seen through two sources: deterministic keys only. Title and
// company alone never merge two postings.
function dedupeKeys(job) {
  return [`id:${job.id}`, job.canonicalUrl ? `url:${job.canonicalUrl}` : null].filter(Boolean);
}

module.exports = { UNKNOWN, VERIFICATION, htmlToText, normalizeTitle, seniorityOf, employmentType, canonicalUrl, isoDate, salaryPeriod, buildJob, dedupeKeys };
