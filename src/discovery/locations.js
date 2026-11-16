// Location text from job postings -> structured places.
//
// Nothing is guessed: a place is US only when the text names the US or a US
// state, and "Remote" alone says nothing about which country may apply.
// remoteScope:
//   US_NATIONWIDE  remote, and the text names only the US (no state limits)
//   US_STATES      remote, limited to the named US states
//   NON_US         remote somewhere outside the US
//   UNKNOWN        remote, but the posting does not say where
const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  PR: 'Puerto Rico', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
  UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};
const STATE_BY_NAME = Object.fromEntries(Object.entries(STATES).map(([code, name]) => [name.toLowerCase(), code]));
const US_NAMES = new Set(['us', 'u s', 'usa', 'u s a', 'united states', 'united states of america', 'america', 'us remote', 'remote us', 'remote usa']);
// Common non-US names and ISO codes seen in ATS location strings.
const OTHER_COUNTRIES = {
  canada: 'CA', can: 'CA', 'united kingdom': 'GB', uk: 'GB', gbr: 'GB', england: 'GB', scotland: 'GB', ireland: 'IE', irl: 'IE',
  india: 'IN', ind: 'IN', singapore: 'SG', sgp: 'SG', germany: 'DE', deu: 'DE', france: 'FR', fra: 'FR', netherlands: 'NL',
  nld: 'NL', spain: 'ES', esp: 'ES', poland: 'PL', pol: 'PL', israel: 'IL', isr: 'IL', japan: 'JP', jpn: 'JP', australia: 'AU',
  aus: 'AU', mexico: 'MX', mex: 'MX', brazil: 'BR', bra: 'BR', philippines: 'PH', phl: 'PH', sweden: 'SE', swe: 'SE',
  switzerland: 'CH', che: 'CH', denmark: 'DK', dnk: 'DK', portugal: 'PT', prt: 'PT', italy: 'IT', ita: 'IT', korea: 'KR',
  'south korea': 'KR', kor: 'KR', china: 'CN', chn: 'CN', taiwan: 'TW', twn: 'TW', argentina: 'AR', arg: 'AR', colombia: 'CO',
  col: 'CO', 'costa rica': 'CR', emea: 'EMEA', apac: 'APAC', latam: 'LATAM', europe: 'EU',
};
const clean = value => String(value || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

function stateCode(token) {
  const text = clean(token);
  if (text === 'd c') return 'DC';
  if (/^[a-z]{2}$/.test(text) && STATES[text.toUpperCase()]) return text.toUpperCase();
  return STATE_BY_NAME[text] || null;
}
function countryOf(token) {
  const text = clean(token).replace(/^remote /, '').replace(/ remote$/, '');
  if (US_NAMES.has(text)) return 'US';
  return OTHER_COUNTRIES[text] || null;
}

// One place, such as "Bellevue, WA, USA", "Remote - US", "Bangalore, INDIA".
function parsePlace(text) {
  const raw = String(text || '').trim();
  const remote = /\bremote\b|\banywhere\b|work from home|\bwfh\b/i.test(raw);
  // Commas, spaced dashes ("Remote - US"), slashes and pipes separate parts;
  // a hyphen inside a name ("Winston-Salem") does not.
  // Brackets can hold the country ("Remote (Canada)"), so they are parts too.
  const tokens = raw.replace(/[()]/g, ',').split(/\s*[,:]\s*|\s+[-–—]\s+|\s*[/|]\s*/).map(token => token.trim()).filter(Boolean)
    .map(token => token.replace(/^remote\s+|\s+remote$/i, '').trim())
    .filter(token => token && !/^(?:remote|hybrid|on-?site|anywhere|hq|headquarters|office)$/i.test(token));
  let country = null, city = null;
  const states = [];
  // With a state code present ("New York, NY", "Washington, D.C."), a state
  // name before it is the city.
  const coded = tokens.find(token => /^(?:[a-z]{2}|d c)$/.test(clean(token)) && stateCode(token));
  for (const token of tokens) {
    const found = countryOf(token);
    if (found) { country = country || found; continue; }
    const code = stateCode(token);
    if (code && (!coded || /^(?:[a-z]{2}|d c)$/.test(clean(token)))) { if (!states.includes(code)) states.push(code); continue; }
    // "North America" or "Global" do not name a country, and are not a city.
    if (/^(?:north america|americas|global|worldwide)$/i.test(token)) continue;
    if (!city && /[a-z]/i.test(token)) city = token;
  }
  if (states.length && !country) country = 'US';
  return { raw, city, state: states[0] || null, states, country, remote };
}

// Several places in one string: "Bellevue, WA; Boston, MA" or "NYC | Remote".
function parseLocations(text) {
  return String(text || '').split(/\s*(?:;|\||\bor\b|\n)\s*/i).map(part => part.trim()).filter(Boolean).map(parsePlace);
}

function remoteScope(places, { remoteFlag = false } = {}) {
  const remote = places.filter(place => place.remote);
  if (!remote.length && !remoteFlag) return null;
  const pool = remote.length ? remote : places;
  const named = place => place.country && !place.countryFromProvider;
  if (!pool.length || pool.every(place => !named(place))) return 'UNKNOWN';
  if (pool.every(place => named(place) && place.country !== 'US')) return 'NON_US';
  const us = pool.filter(place => named(place) && place.country === 'US');
  if (us.some(place => place.state)) return 'US_STATES';
  return us.length ? 'US_NATIONWIDE' : 'UNKNOWN';
}

module.exports = { STATES, parsePlace, parseLocations, remoteScope, stateCode };
