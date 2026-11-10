// Decides an answer for each scanned form field.
//
// Field (from the form scanner):
//   { id, label, type, required, options?: string[] }
//   type: text | textarea | email | tel | number | date | select | radio | checkbox | file
//
// Answer: { id, value, source }
//   source: profile | flag | salary | personal | bank | file | llm | blocked | unknown
const { BLOCKED, FACTS, FLAGS, US_STATES } = require('./profile-facts');
const { RULES, personalInfo, PERSONAL } = require('./standard-answers');
const { expectedPay, pickBand, SALARY_QUESTION, HOURLY_QUESTION } = require('./salary');

const DECLINE = /decline|prefer not|don'?t wish|do not wish|not to (say|answer|disclose)|choose not/i;

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Other spellings of the same value, e.g. "TX" ⇄ "Texas". */
function aliases(value) {
  const s = String(value).trim();
  const code = s.toUpperCase();
  if (US_STATES[code]) return [US_STATES[code]];
  const entry = Object.entries(US_STATES).find(([, name]) => name.toLowerCase() === s.toLowerCase());
  return entry ? [entry[0]] : [];
}

function matchOne(options, value) {
  const v = norm(value);
  if (!v) return null;
  return (
    options.find(o => norm(o) === v) ||
    options.find(o => norm(o).startsWith(v)) ||
    options.find(o => norm(o).includes(v)) ||
    options.find(o => v.includes(norm(o)) && norm(o).length > 2) ||
    null
  );
}

/** Pick the option that best matches `value`; null when nothing fits. */
function matchOption(options, value) {
  if (!options || !options.length || value == null || value === '') return null;
  if (typeof value === 'boolean') value = value ? 'yes' : 'no';
  // Exact matches on any spelling first, so "TX" never fuzzy-matches "Texas City".
  for (const v of [value, ...aliases(value)]) {
    const exact = options.find(o => norm(o) === norm(v));
    if (exact) return exact;
  }
  for (const v of [value, ...aliases(value)]) {
    const fuzzy = matchOne(options, v);
    if (fuzzy) return fuzzy;
  }
  return null;
}

function similarity(a, b) {
  const A = new Set(norm(a).split(' ')), B = new Set(norm(b).split(' '));
  const inter = [...A].filter(x => B.has(x)).length;
  return inter / (A.size + B.size - inter || 1);
}

function fromBank(profile, label) {
  const bank = (profile.application && profile.application.answerBank) || [];
  let best = null, score = 0;
  for (const item of bank) {
    const s = similarity(item.question, label);
    if (s > score) { best = item; score = s; }
  }
  return score >= 0.8 ? best.answer : null;
}

const hasOptions = f => ['select', 'radio', 'checkbox', 'combobox'].includes(f.type) && f.options && f.options.length;

/**
 * The résumé goes up as DOCX when the upload takes it: its `accept` list
 * allows Word files (or there is no list), and the question does not ask
 * for a PDF ("Please upload a PDF version"). Otherwise the PDF is used.
 */
function acceptsDocx(field) {
  const words = `${field.label || ''} ${field.hint || ''}`;
  if (/\bpdf\b/i.test(words) && !/\bdocx?\b|\bword\b/i.test(words)) return false;
  const accept = String(field.accept || '').trim();
  return !accept || /\.docx\b|wordprocessingml|\.doc\b|msword|application\/\*|\*\/\*/i.test(accept);
}

/** Optional fields without a question (Twitter, Portfolio, …) stay blank instead of being invented. */
const worthAsking = f => f.type !== 'file' && (f.required || /\?/.test(f.label || ''));

/**
 * Answer one field without the LLM.
 * @param {object} field
 * @param {{profile:object, files:{resume?:string, coverLetter?:string}}} ctx
 */
function resolveField(field, { profile, files = {}, jd = '' }) {
  const label = `${field.label || ''} ${field.name || ''}`;
  const out = (value, source) => ({ id: field.id, value, source });
  const pick = (value, source) => {
    if (!hasOptions(field)) return value == null || value === '' ? null : out(typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value, source);
    const option = matchOption(field.options, value);
    return option ? out(option, source) : null;
  };

  if (BLOCKED.test(label)) return out(null, 'blocked');

  if (field.type === 'file') {
    if (/cover/i.test(label)) return out(files.coverLetter || null, files.coverLetter ? 'file' : 'unknown');
    // Other uploads (portfolio, work sample, transcript) are not the résumé.
    if (/portfolio|work sample|writing sample|transcript|additional|other/i.test(label) && !/r[ée]sum[ée]|\bcv\b/i.test(label)) return out(null, 'unknown');
    const resume = files.resumeDocx && acceptsDocx(field) ? files.resumeDocx : files.resume;
    return out(resume || null, resume ? 'file' : 'unknown');
  }

  for (const [re, get] of FLAGS) {
    if (!re.test(label)) continue;
    const answer = pick(get(profile), 'flag');
    if (answer) return answer;
  }

  // Salary: from the JD's posted pay (see salary.js), or the profile's own figure if set.
  if (SALARY_QUESTION.test(label)) {
    const saved = profile.application && profile.application.salaryExpectation;
    const pay = expectedPay(jd, profile, HOURLY_QUESTION.test(label) ? 'hour' : 'year');
    if (hasOptions(field)) {
      const band = pickBand(field.options, pay.amount);
      if (band) return out(band, 'salary');
    } else if (field.part === 'min' || field.part === 'max') {
      // Min/max boxes: from the expected amount up to the posted maximum.
      const max = Math.max(pay.amount, (pay.range && pay.range.max) || 0);
      return out(String(field.part === 'min' ? pay.amount : max), 'salary');
    } else if (field.type === 'number') {
      return out(String(pay.amount), 'salary');
    } else {
      return out(saved || pay.text, 'salary');
    }
  }

  // An answer you corrected in an earlier review wins over the standard defaults.
  const banked = fromBank(profile, field.label);
  if (banked != null) {
    const answer = pick(banked, 'bank');
    if (answer) return answer;
  }

  // Standard personal answers. Not for long free-text questions, where words
  // like "race" or "veteran" can appear in an unrelated sense.
  if (field.type !== 'textarea') {
    const rule = RULES.find(r => r.q.test(label));
    if (rule) {
      const decline = hasOptions(field) && field.options.find(o => DECLINE.test(o));
      if (rule.decline) return out(decline || null, 'personal'); // never guessed; empty → you fill it in review
      const value = rule.answer(personalInfo(profile));
      if (!hasOptions(field)) return out(value, 'personal');
      // The preferred-option patterns describe the standard answer; a profile override uses plain matching.
      const exact = field.options.find(o => norm(o) === norm(value));
      const isStandard = value === rule.answer(PERSONAL);
      const preferred = isStandard && (rule.prefer || []).map(re => field.options.find(o => re.test(o.trim()))).find(Boolean);
      const option = exact || preferred || matchOption(field.options, value);
      if (option) return out(option, 'personal');
    }
  }

  for (const [re, get] of FACTS) {
    // Match the visible label separately: "Name name" defeated the anchored
    // generic Name rule when a control also had name="name".
    if (![field.label || '', (field.name || '').replace(/[_-]+/g, ' '), label].some(text => re.test(text))) continue;
    const answer = pick(get(profile), 'profile');
    if (answer) return answer;
    break;
  }

  return out(null, 'unknown');
}

/**
 * Answer every field: deterministic sources first, then one LLM batch for
 * whatever is left (skipped when `llm` is not given).
 */
async function resolveAll(fields, ctx, llm) {
  const answers = fields.map(f => resolveField(f, ctx));
  const pending = fields.filter((f, i) => answers[i].source === 'unknown' && worthAsking(f));
  if (llm && pending.length) {
    const replies = await llm.answerQuestions({ questions: pending, jd: ctx.jd || '', resume: ctx.resume || {}, profile: ctx.profile, job: ctx.job || {} });
    for (const reply of replies) {
      const i = fields.findIndex(f => f.id === reply.id);
      if (i < 0 || answers[i].source !== 'unknown') continue;
      const value = hasOptions(fields[i]) ? matchOption(fields[i].options, reply.answer) : reply.answer;
      if (value) answers[i] = { id: fields[i].id, value, source: 'llm' };
    }
  }
  return answers;
}

module.exports = { resolveField, resolveAll, matchOption };
