// Label patterns → profile values. Order matters: more specific patterns
// (first name) must come before general ones (name).

/** Never auto-filled, whatever the source. */
const BLOCKED = /social security|\bssn\b|driver'?s? licen[cs]e|passport|password|bank|routing|credit card|date of birth|\bdob\b|birth ?date/i;

const full = p => [p.firstName, p.lastName].filter(Boolean).join(' ');
const addr = p => (p.application && p.application.address) || {};
/** "1 Main St, Apt 2, Austin, TX 78701"; empty when the profile has no street address. */
const fullAddress = p => {
  const a = addr(p);
  if (!a.line1) return '';
  return [a.line1, a.line2, a.city, [a.state, a.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
};

/** First (most recent) education entry: { institution, degree, major, period }. */
const school = p => (p.education || [])[0] || {};
/** "2013 - 2017" → "2017" (the last year in the period). */
const graduationYear = p => ((school(p).period || '').match(/\b(19|20)\d{2}\b/g) || []).pop() || '';

const FACTS = [
  [/preferred (first )?name/i, p => p.firstName],
  [/first\s*name|given name|forename/i, p => p.firstName],
  [/last\s*name|surname|family name/i, p => p.lastName],
  [/full\s*name|^\s*name\s*\*?\s*$|your name|legal name/i, full],
  [/e-?mail/i, p => p.email],
  [/^(?!.*extension).*(phone|mobile|cell)/i, p => p.phone],
  [/linkedin/i, p => p.linkedin],
  [/github/i, p => p.github],
  [/address line 2|apartment|suite|apt/i, p => addr(p).line2],
  [/(your|home|mailing|current|residential|full) address/i, fullAddress],
  // Parts before the bare "Address" pattern, so "Address — City" is the city.
  [/\bcity\b/i, p => addr(p).city || (p.location || '').split(',')[0].trim()],
  [/\bstate\b|province|region/i, p => addr(p).state],
  [/zip|postal/i, p => addr(p).postalCode],
  [/country/i, p => addr(p).country],
  [/street|address line 1|^address\b/i, p => addr(p).line1],
  [/current (working )?location|working location|^location\b|where are you (located|based)/i, p => p.location],
  [/current (job )?title|headline/i, p => p.title],
  [/(current|previous|most recent|present)\b.{0,15}\b(company|employer)/i, p => ((p.workHistory || [])[0] || {}).company],
  [/notice period|start date|when can you start/i, p => p.application && p.application.noticePeriod],
  // Education: short factual questions only, not "Why did you choose your university?".
  [/^(?!.*\b(why|how|describe|tell|explain)\b).*(school|university|college|institution)/i, p => school(p).institution],
  [/^(?!.*\b(why|how|describe|tell|explain)\b).*(major|field of study|area of study|discipline|concentration)/i, p => school(p).major],
  [/^(?!.*\b(why|how|describe|tell|explain)\b).*(graduation (year|date)|year (of )?(completion|graduation)|when did you graduate)/i, graduationYear],
  [/^(?!.*\b(why|how|describe|tell|explain)\b).*(\bdegree\b|level of education|education level|highest.{0,20}education)/i, p => school(p).degree],
];

/** Yes/No questions answered from structured profile flags. */
const FLAGS = [
  [/sponsor/i, p => p.application && p.application.requiresSponsorship],
  [/relocat/i, p => p.application && p.application.willingToRelocate],
  [/^(?!.*expir).*(authori[sz]ed to work|legally (eligible|authorized)|work authori[sz]ation)/i,
    p => {
      const wa = (p.application && p.application.workAuthorization) || '';
      return wa ? !/visa|h-?1b|opt|ead|tn\b/i.test(wa) || /citizen|green card|permanent/i.test(wa) : null;
    }],
];

const US_STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  PR: 'Puerto Rico', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
  UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

// Personal / self-identification questions live in standard-answers.js.
module.exports = { BLOCKED, FACTS, FLAGS, US_STATES, fullAddress };
