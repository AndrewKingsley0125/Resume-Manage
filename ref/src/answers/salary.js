// Expected pay, from the pay range posted in the JD (user's rule):
//   range        → midpoint, rounded UP to the next $5,000 (hourly: next $5)
//   single value → that value
//   none posted  → $140,000 per year, or $70-$80 per hour
// Currency is always USD.

const DEFAULT_ANNUAL = 140000;
const DEFAULT_HOURLY = { min: 70, max: 80 };
const STEP = { year: 5000, hour: 5 };

const STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA PR RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');

const ceilTo = (value, step) => Math.ceil(value / step) * step;
const money = n => `$${Math.round(n).toLocaleString('en-US')}`;

/** "$195,000", "195,000", "$150K", "150k", "62.50" → number (k applied). */
function amount(text) {
  const m = /([\d][\d,]*(?:\.\d+)?)\s*([kK])?/.exec(text);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  return m[2] ? n * 1000 : n;
}

/**
 * Every pay figure posted in the JD, one per line that has one.
 * @returns {Array<{min:number, max:number, period:'year'|'hour', line:string}>}
 */
function parsePayRanges(jd) {
  const out = [];
  const NUM = '\\$\\s?[\\d][\\d,]*(?:\\.\\d+)?\\s*[kK]?';
  const NUM_OPT$ = '\\$?\\s?[\\d][\\d,]*(?:\\.\\d+)?\\s*[kK]?';
  const range = new RegExp(`(${NUM})\\s*(?:-|–|—|to|and)\\s*(${NUM_OPT$})`, 'i');
  const single = new RegExp(`(${NUM})`, 'i');
  for (const line of String(jd || '').split(/\n/)) {
    if (!/\$/.test(line)) continue;
    const hourly = /hour|hourly|\/\s?hr\b|\bhr\b/i.test(line);
    const r = range.exec(line);
    let min, max;
    if (r) {
      min = amount(r[1]);
      max = amount(r[2]);
      // "$150 - $190K": the k on one side applies to both.
      if (/k/i.test(r[2]) && !/k/i.test(r[1]) && min < 1000) min *= 1000;
      if (/k/i.test(r[1]) && !/k/i.test(r[2]) && max < 1000) max *= 1000;
    } else {
      const s = single.exec(line);
      if (!s) continue;
      min = max = amount(s[1]);
    }
    if (!min || !max || max < min) continue;
    const period = hourly || max < 1000 ? 'hour' : 'year';
    if (period === 'year' && max < 10000) continue; // e.g. "$2,000 stipend" (not a salary)
    out.push({ min, max, period, line: line.trim() });
  }
  return out;
}

const profileState = profile => {
  const app = (profile && profile.application) || {};
  const fromAddress = app.address && app.address.state;
  if (fromAddress) return String(fromAddress).trim().toUpperCase().slice(0, 2);
  const m = /,\s*([A-Z]{2})\b/.exec((profile && profile.location) || '');
  return m ? m[1] : '';
};

/** Range that applies to this candidate: their state's line, else "all other", else the first. */
function pickRange(ranges, state) {
  if (!ranges.length) return null;
  const listsStates = r => STATES.filter(s => new RegExp(`\\b${s}\\b`).test(r.line));
  const own = state && ranges.find(r => listsStates(r).includes(state));
  if (own) return own;
  return ranges.find(r => /all other|other (u\.?s\.? )?(states|locations)|remote/i.test(r.line))
    || ranges.find(r => !listsStates(r).length)
    || ranges[0];
}

/**
 * @param {string} jd
 * @param {object} profile
 * @param {'year'|'hour'} period  what the question asks for
 * @returns {{ amount:number, text:string, period:string, source:'range'|'single'|'default', range?:object }}
 */
function expectedPay(jd, profile, period = 'year') {
  const ranges = parsePayRanges(jd).filter(r => r.period === period);
  const r = pickRange(ranges, profileState(profile));
  const unit = period === 'hour' ? '/hour' : '';
  if (r && r.min !== r.max) {
    const value = ceilTo((r.min + r.max) / 2, STEP[period]);
    return { amount: value, text: `${money(value)}${unit}`, period, source: 'range', range: r };
  }
  if (r) return { amount: r.min, text: `${money(r.min)}${unit}`, period, source: 'single', range: r };
  if (period === 'hour') {
    const mid = ceilTo((DEFAULT_HOURLY.min + DEFAULT_HOURLY.max) / 2, STEP.hour);
    return { amount: mid, text: `${money(DEFAULT_HOURLY.min)}-${money(DEFAULT_HOURLY.max)}/hour`, period, source: 'default' };
  }
  return { amount: DEFAULT_ANNUAL, text: money(DEFAULT_ANNUAL), period, source: 'default' };
}

const SALARY_QUESTION = /salary|compensation (expectation|requirement)|(compensation|pay) range|compensation .{0,30}expect|expected (pay|compensation|salary|rate)|desired (pay|salary|compensation|rate)|pay (expectation|requirement)|(hourly|bill|pay) rate|rate expectation/i;
const HOURLY_QUESTION = /hour|hourly|\/\s?hr\b|bill rate|pay rate/i;

/** Option of a pay-band dropdown that contains `value` (or the closest band). */
function pickBand(options, value) {
  let best = null, bestDistance = Infinity;
  for (const option of options) {
    const nums = (option.match(/\$?\s?[\d][\d,]*(?:\.\d+)?\s*[kK]?/g) || []).map(amount).filter(n => n != null);
    if (!nums.length) continue;
    const lo = Math.min(...nums), hi = /\+|above|more|over/i.test(option) ? Infinity : Math.max(...nums);
    const distance = value < lo ? lo - value : value > hi ? value - hi : 0;
    if (distance < bestDistance) { best = option; bestDistance = distance; }
  }
  return best;
}

module.exports = { expectedPay, parsePayRanges, pickBand, SALARY_QUESTION, HOURLY_QUESTION, ceilTo };
