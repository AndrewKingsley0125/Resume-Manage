// How well a job fits an applicant profile, and whether they can take it.
//
// Targets come from the profile and its saved resume: job titles, skills,
// years of experience, home state and sponsorship need. Score (0-100):
//   45% title family, 30% skills named in the posting, 15% seniority, 10% location.
// `eligible` is separate from the score: a perfect-looking job outside the US,
// remote only in other states, or refusing sponsorship the applicant needs, is
// not a fit however well it scores.
const { parsePlace, stateCode } = require('./locations');
const { normalizeTitle, seniorityOf } = require('./normalize');

const SENIORITY_WORDS = new Set(['senior', 'junior', 'staff', 'principal', 'lead', 'ii', 'iii', 'iv', 'i', 'sr', 'jr', 'mid', 'level', 'entry', 'associate', 'head']);
const FILLER = new Set(['the', 'and', 'of', 'for', 'to', 'a', 'an', 'in', 'at', 'with', 'on', 'remote', 'hybrid', 'onsite', 'us', 'usa', 'team', 'new', 'grad', 'all', 'levels', 'f', 'm', 'd', 'x', 'w', 'or']);
// Words every role family shares; matching only these says little.
const GENERIC = new Set(['engineer', 'developer', 'manager', 'specialist', 'analyst', 'consultant', 'architect', 'scientist', 'administrator', 'representative', 'coordinator', 'technician']);
const PHRASES = [
  [/\bmachine learning\b/g, 'ml'], [/\bartificial intelligence\b/g, 'ai'], [/\bback ?end\b/g, 'backend'], [/\bfront ?end\b/g, 'frontend'],
  [/\bfull ?stack\b/g, 'fullstack'], [/\bsite reliability\b/g, 'sre'], [/\bdev ?ops\b/g, 'devops'], [/\bdeveloper\b/g, 'engineer'],
  [/\bprogrammer\b/g, 'engineer'], [/\bswe\b/g, 'software engineer'], [/\bsde\b/g, 'software engineer'], [/\bmle\b/g, 'ml engineer'],
  [/\bengineering\b/g, 'engineer'], [/\bplatforms\b/g, 'platform'], [/\bsystems\b/g, 'system'], [/\bapplications\b/g, 'application'],
];

function titleTokens(title) {
  let text = normalizeTitle(String(title || '').replace(/\([^)]*\)/g, ' '));
  for (const [pattern, replacement] of PHRASES) text = text.replace(pattern, replacement);
  return [...new Set(text.split(' ').filter(word => word && !SENIORITY_WORDS.has(word) && !FILLER.has(word) && !/^\d+$/.test(word)))];
}

// How closely the job title matches the best target title, both ways: how
// much of the target the job title contains (60%; "Security Engineer, Cloud"
// is a Security Engineer role) and how much of the job title the target
// explains (40%). Generic words (engineer, manager) count for little.
function titleScore(jobTitle, targets) {
  const job = titleTokens(jobTitle);
  if (!job.length) return 0;
  const weight = word => GENERIC.has(word) ? 0.3 : 1;
  const sum = words => words.reduce((total, word) => total + weight(word), 0);
  let best = 0;
  for (const target of targets) {
    const wanted = titleTokens(target);
    if (!wanted.length) continue;
    const words = new Set(wanted);
    const shared = job.filter(word => words.has(word));
    // Only generic words in common ("Hardware Engineer" vs "Software Engineer") is not the same role.
    if (!shared.some(word => !GENERIC.has(word))) continue;
    best = Math.max(best, 0.6 * sum(shared) / sum(wanted) + 0.4 * sum(shared) / sum(job));
  }
  return Math.min(1, best);
}

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function skillPattern(skill) {
  return new RegExp(`(?<![a-z0-9])${escape(skill.toLowerCase())}(?![a-z0-9])`, 'i');
}

function yearsOfExperience(workHistory, now) {
  const starts = (workHistory || []).map(item => Number((String(item?.period || '').match(/\b(?:19|20)\d{2}\b/) || [])[0])).filter(Boolean);
  return starts.length ? Math.max(0, now.getFullYear() - Math.min(...starts)) : null;
}

function homeState(location) {
  const text = String(location || '').replace(/\b\d{5}(?:-\d{4})?\b/g, '').trim();
  const place = parsePlace(text);
  if (place.state) return place.state;
  // "Berkeley CA": the state code with no comma before it.
  return stateCode(text.split(/\s+/).at(-1) || '') || null;
}

function flattenSkills(skills) {
  const out = [];
  for (const item of [].concat(skills || [])) {
    if (typeof item === 'string') out.push(item);
    else if (item && typeof item === 'object') for (const value of Object.values(item)) out.push(...[].concat(value).filter(entry => typeof entry === 'string'));
  }
  return out;
}

// Search targets for one applicant, from the profile and its saved resume.
function profileTargets(profile = {}, resume = null, { now = new Date() } = {}) {
  const titles = [profile.title, ...(profile.workHistory || []).map(item => item?.title), ...((resume?.experience) || []).map(item => item?.title)]
    .map(title => String(title || '').trim()).filter(Boolean);
  const skills = [...flattenSkills(resume?.skills), ...((resume?.experience) || []).flatMap(item => flattenSkills(item?.technologies))]
    .map(skill => String(skill).trim()).filter(skill => skill.length >= 1 && skill.length <= 40);
  const details = profile.applicationDetails || {};
  return {
    profileId: profile.id,
    name: [profile.firstName, profile.lastName].filter(Boolean).join(' '),
    titles: [...new Set(titles)],
    skills: [...new Map(skills.map(skill => [skill.toLowerCase(), skill])).values()],
    years: yearsOfExperience(profile.workHistory, now),
    homeState: homeState(profile.location),
    needsSponsorship: /^yes$/i.test(details.sponsorshipNow || '') || /^yes$/i.test(details.sponsorshipFuture || ''),
    authorizedUS: !/^no$/i.test(details.authorizedToWork || ''),
  };
}

const LEVEL = { intern: 0, entry: 1, mid: 2, senior: 3, lead: 3, staff: 4, principal: 5 };
function seniorityScore(level, years, titles) {
  const manages = titles.some(title => /\b(?:manager|director|head|vp)\b/i.test(title));
  if (['manager', 'director', 'executive'].includes(level)) return manages ? 1 : 0.2;
  if (level === 'unknown' || years == null) return 0.7;
  const expected = years >= 12 ? 4 : years >= 6 ? 3 : years >= 3 ? 2 : 1;
  const gap = LEVEL[level] - expected;
  if (level === 'intern' && years > 1) return 0;
  if (gap === 0 || gap === 1 && expected >= 3) return 1;
  if (gap === -1) return 0.6;
  if (gap === 1) return 0.5;
  return 0.1;
}

const NO_SPONSORSHIP = /\b(?:not|unable to|cannot|can ?not|won'?t|will not|do not|does not|are not able to)\s+(?:currently\s+)?(?:provide|offer|support|sponsor)\b[^.]{0,60}\b(?:sponsor|visa)|\bno (?:visa |immigration )?sponsorship\b|\bsponsorship (?:is )?not (?:available|offered|provided)\b|\bwithout (?:the )?(?:need for )?(?:current or future )?(?:visa )?sponsorship\b/i;
const CLEARANCE = /\b(?:active|current|existing)\s+(?:ts\/sci|top secret|secret|security)\b[^.]{0,30}\bclearance\b|\bclearance (?:is )?required\b|\bmust (?:hold|have|possess|obtain|maintain)\b[^.]{0,40}\bclearance\b|\bts\/sci\b/i;
const US_SCOPES = new Set(['US_NATIONWIDE', 'US_STATES']);

// US jobs only. `usRemote` marks remote work the posting itself opens to the
// US (nationwide, or a list of states that includes the applicant's).
function locationFit(job, targets) {
  const inUS = (job.countries || []).includes('US');
  const states = job.states || [];
  if (job.remote) {
    if (job.remoteScope === 'US_NATIONWIDE') return { score: 1, eligible: true, usRemote: true, note: 'Remote (US)' };
    if (job.remoteScope === 'US_STATES') {
      const ok = !targets.homeState || states.includes(targets.homeState);
      return { score: ok ? 1 : 0, eligible: ok, usRemote: ok, note: ok ? 'Remote in your state' : `Remote only in ${states.join(', ')}` };
    }
    if (job.remoteScope === 'NON_US' && !inUS) return { score: 0, eligible: false, note: 'Remote outside the US' };
    // Remote elsewhere, but the job also lists a US office: a US job, though not US-remote.
    if (inUS) return { score: 0.6, eligible: true, note: 'US office listed; remote area not stated' };
    // "Remote" with no country could be anywhere: not counted as a US job.
    return { score: 0, eligible: false, note: 'Remote; country not stated' };
  }
  if (!inUS) return { score: 0, eligible: false, note: (job.countries || []).length ? 'Outside the US' : 'Location not stated' };
  if (targets.homeState && states.includes(targets.homeState)) return { score: 0.9, eligible: true, note: `In ${targets.homeState}` };
  return { score: 0.3, eligible: true, relocation: true, note: `On-site in ${job.city || states.join(', ') || 'the US'}` };
}

function scoreJob(job, targets) {
  const text = `${job.title}\n${job.description || ''}`;
  const blockers = [], reasons = [];
  const place = locationFit(job, targets);
  if (!place.eligible) blockers.push(place.note);
  if (!targets.authorizedUS) blockers.push('Profile is not authorized to work in the US');
  if (targets.needsSponsorship && NO_SPONSORSHIP.test(text)) blockers.push('Posting says no visa sponsorship');
  const clearance = CLEARANCE.test(text);
  const title = titleScore(job.title, targets.titles);
  const matched = targets.skills.filter(skill => skillPattern(skill).test(text));
  const skills = targets.skills.length ? Math.min(1, matched.length / Math.min(10, targets.skills.length)) : 0;
  // Worked out from the title now, so improved rules also apply to jobs stored earlier.
  const seniority = seniorityScore(seniorityOf(job.title), targets.years, targets.titles);
  // Listed without its description yet: skills cannot be checked, so the score
  // rests on title, seniority and location until the description is loaded.
  const pending = job.detailsLoaded === false && !String(job.description || '').trim();
  let score = pending
    ? 100 * (0.45 * title + 0.15 * seniority + 0.10 * place.score) / 0.70
    : 100 * (0.45 * title + 0.30 * skills + 0.15 * seniority + 0.10 * place.score);
  if (pending) reasons.push('Description not loaded yet');
  if (clearance) {score *= 0.5;reasons.push('Needs a security clearance');}
  // A clearly wrong level (an entry-level role for a senior engineer) is not a fit, however good the rest looks.
  if (seniority <= 0.1) {score *= 0.6;reasons.push('Level does not match experience');}
  if (title === 0) score = Math.min(score, 25);
  if (matched.length) reasons.push(`Skills: ${matched.slice(0, 8).join(', ')}`);
  reasons.push(place.note);
  return {
    score: Math.round(score),
    eligible: !blockers.length,
    blockers,
    reasons,
    parts: { title: +title.toFixed(2), skills: +skills.toFixed(2), seniority, location: place.score },
    matchedSkills: matched,
    usRemote: !!place.usRemote,
    local: !place.relocation && !place.usRemote && place.eligible && place.score >= 0.9,
    relocation: !!place.relocation,
  };
}

// Best matches for one applicant: eligible jobs above `minScore`, newest
// postings first among equals. `days` uses the posting date when the provider
// gives one, otherwise the date this app first saw the job.
function rankJobs(jobs, targets, { minScore = 55, days = null, now = new Date(), limit = 50 } = {}) {
  const since = days ? now.getTime() - days * 86400000 : null;
  return jobs
    .filter(job => !since || new Date(job.publishedAt || job.firstSeenAt || 0).getTime() >= since)
    .map(job => ({ job, fit: scoreJob(job, targets) }))
    .filter(item => item.fit.eligible && item.fit.score >= minScore)
    .sort((a, b) => b.fit.score - a.fit.score || String(b.job.publishedAt || '').localeCompare(String(a.job.publishedAt || '')))
    .slice(0, limit);
}

module.exports = { titleTokens, titleScore, profileTargets, scoreJob, rankJobs, homeState, NO_SPONSORSHIP, US_SCOPES };
