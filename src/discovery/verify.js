// Confirms a posting URL is the original, live page for this job.
//   VERIFIED_ORIGINAL  200, still at the job's own URL (job id in the final URL),
//                      and the page title names this job
//   EXPIRED            404/410, or redirected away from the job (Greenhouse sends
//                      a closed job to the board page with ?error=true and 200)
//   BLOCKED            401/403/429 or a CAPTCHA / bot wall
//   UNVERIFIED         reachable, but the page does not show it is this job
// An ATS domain alone never counts.
const { VERIFICATION } = require('./normalize');

const plain = text => String(text || '').toLowerCase().replace(/&amp;/g, '&').replace(/&#39;|&rsquo;/g, "'").replace(/[^a-z0-9]+/g, ' ').trim();
const pageTitle = html => {
  const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1];
  const tag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  return `${tag || ''} ${og || ''}`;
};
const WALL = /captcha|cf-chl|challenge-platform|access denied|are you a robot|unusual traffic/i;

async function verifyJob(job, { http }) {
  const url = job.sourceUrl;
  if (!url) return { status: VERIFICATION.UNRESOLVED, reason: 'No posting URL.' };
  let page;
  try {page = await http.getText(url);}
  catch (error) {return { status: VERIFICATION.UNVERIFIED, reason: `Could not reach the posting: ${error.message}` };}
  if ([404, 410].includes(page.status)) return { status: VERIFICATION.EXPIRED, reason: `The posting answers ${page.status}.` };
  if ([401, 403, 429].includes(page.status)) return { status: VERIFICATION.BLOCKED, reason: `The site refused the check (${page.status}).` };
  if (!page.ok) return { status: VERIFICATION.UNVERIFIED, reason: `The posting answers ${page.status}.` };
  let final;
  try {final = new URL(page.url || url);} catch (_) {final = new URL(url);}
  if (final.searchParams.get('error') === 'true' || !decodeURIComponent(final.href).includes(String(job.externalId))) {
    return { status: VERIFICATION.EXPIRED, reason: 'The site redirected away from this job.', finalUrl: final.href };
  }
  if (WALL.test(page.text.slice(0, 20000)) && !plain(page.text).includes(plain(job.title))) return { status: VERIFICATION.BLOCKED, reason: 'The site showed a bot check.' };
  const title = plain(pageTitle(page.text));
  if (job.title && title.includes(plain(job.title))) return { status: VERIFICATION.VERIFIED_ORIGINAL, reason: 'Live posting page for this job.', finalUrl: final.href };
  return { status: VERIFICATION.UNVERIFIED, reason: 'The page loads but its title does not name this job.', finalUrl: final.href };
}

module.exports = { verifyJob };
