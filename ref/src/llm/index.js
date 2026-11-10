// LLM access behind one interface so the provider (manual copy/paste,
// OpenAI API, or chatgpt.com automation) can change without touching the
// orchestrator.
//
// Provider shape: { name, keepsConversation?, complete(text, { purpose, newChat }) => Promise<string> }
const { personalInfo } = require('../answers/standard-answers');
const { expectedPay } = require('../answers/salary');
const { fullAddress } = require('../answers/profile-facts');

const providers = {
  'chrome-chat': require('./providers/chrome-chat'),
  manual: require('./providers/manual'),
  'openai-api': require('./providers/openai-api'),
  'chatgpt-web': require('./providers/chatgpt-web'),
};

const JD_PLACEHOLDER = '[PASTE THE JOB DESCRIPTION HERE]';

/** The prompt with the JD in its "## JOB DESCRIPTION" slot (appended if the template has no slot). */
function resumeRequest(prompt, jd) {
  if (prompt.includes(JD_PLACEHOLDER)) return prompt.replace(JD_PLACEHOLDER, () => jd.trim());
  return `${prompt.trimEnd()}\n\n## JOB DESCRIPTION\n\n${jd.trim()}\n`;
}

/**
 * Application questions for ChatGPT. With `inConversation` the request goes
 * into the chat that produced the resume, so the resume and JD are already
 * there and are not repeated.
 */
function questionsRequest({ questions, jd, resume, profile, job = {}, inConversation = false }) {
  const p = personalInfo(profile);
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ');
  const role = [job.title, job.company && `at ${job.company}`].filter(Boolean).join(' ');
  const lines = questions.map((q, i) => {
    const opts = q.options && q.options.length ? ` Options: ${q.options.map(o => JSON.stringify(o)).join(', ')}.` : '';
    return `${i + 1}. [id=${q.id}] ${q.label.replace(/\s*\*\s*$/, '')}${q.required ? ' (required)' : ''}.${opts}`;
  });
  const profileLines = [
    name && `- Name: ${name}`,
    profile.email && `- Email: ${profile.email}`,
    profile.phone && `- Phone: ${profile.phone}`,
    profile.location && `- Location: ${profile.location}`,
    fullAddress(profile) && `- Address: ${fullAddress(profile)}${(profile.application.address || {}).country ? `, ${profile.application.address.country}` : ''}`,
    ...(profile.education || []).filter(e => e && (e.institution || e.degree)).map(e =>
      `- Education: ${[e.degree, e.major && `in ${e.major}`].filter(Boolean).join(' ')}${e.institution ? `, ${e.institution}` : ''}${e.period ? ` (${e.period})` : ''}`),
    profile.linkedin && `- LinkedIn: ${profile.linkedin}`,
    profile.github && `- GitHub: ${profile.github}`,
    `- Country: ${p.country}`,
    `- Citizenship: ${p.citizenship}`,
    `- Gender: ${p.gender}`,
    `- Race/Ethnicity: ${p.race}`,
    `- Hispanic or Latino: ${p.hispanicLatino}`,
    `- Preferred language: ${p.preferredLanguage}`,
    `- Disability: ${p.disability}`,
    `- Veteran status: ${p.veteran}`,
    `- LGBTQ+: ${p.lgbtq}`,
    `- Legally authorized to work in the U.S.: ${p.authorizedToWork}`,
    `- Visa sponsorship required: ${p.sponsorship}`,
    `- Criminal background: ${p.criminalRecord}`,
    `- Availability: ${p.availability}`,
    `- Background check: ${p.backgroundCheck}`,
    `- Relatives, family members, or friends working at this company: ${p.relatedToEmployee === 'No' ? 'None (No)' : p.relatedToEmployee}`,
    `- Bound by a non-compete or non-solicitation agreement: ${p.nonCompete}`,
    `- Previously worked at this company: ${p.workedHereBefore}`,
    `- Salary expectation: ${expectedPay(jd, profile, 'year').text} USD per year (for hourly roles: ${expectedPay(jd, profile, 'hour').text} USD)`,
  ].filter(Boolean);
  const context = inConversation
    ? 'For technical or experience questions, use the resume you wrote above in this chat and the job description I gave you.'
    : `For technical or experience questions, use this resume and job description.\n\nRESUME JSON:\n${JSON.stringify(resume)}\n\nJOB DESCRIPTION:\n${jd.trim()}`;
  return [
    `Now use my personal profile below to answer job application questions${role ? ` for the ${role} role` : ''} and fill out the form.`,
    '',
    ...profileLines,
    '',
    'When a question is about my personal information, select the matching available option or enter the appropriate answer. If a personal question is not covered by my profile, do not guess or invent anything: return an empty string "" for it so I can answer it myself.',
    '',
    context,
    '- If a question asks for a list of skills, tools, or technologies, answer with just the names, spelled correctly, separated by commas.',
    '- If a question asks whether I have experience with a technology, tool, language, or skill, the answer is always Yes, even if the resume does not mention it.',
    '- If a question asks how many years of experience I have (overall or with a specific technology), the answer is about 10 years, even if the resume shows less. For a number field answer 10; with options, pick the one that includes 10 years or the closest to it (for example "10+" or "8-10 years").',
    '- If a question asks me to rate my skill, proficiency, or expertise, rate high: on a 1-10 scale answer 8, 9, or 10 (10 for the core skills of this job); on a 1-5 scale answer 4 or 5; with word options pick "Expert" or "Advanced".',
    '- For "How did you hear about us?" or other source questions, answer LinkedIn. If LinkedIn is not an option, pick the first available of: Built In, Glassdoor, Indeed, Other.',
    '- If a question asks for an explanation, answer in 3-4 clear sentences in first person. Write plainly and naturally, the way I would write it myself: specific, no buzzwords, no lists, no dashes, no opening like "As a ...".',
    '- For questions with options, the answer must be exactly one of the listed options, copied as written.',
    '',
    'Return only JSON inside a ```json code block, nothing else: {"answers":[{"id":"...","answer":"..."}]}',
    '',
    'QUESTIONS:',
    ...lines,
  ].join('\n');
}

function parseAnswers(text) {
  const source = String(text).trim();
  const fenced = /```(?:json)?\s*\n?([\s\S]*?)\n?```/i.exec(source);
  const parsed = JSON.parse(fenced ? fenced[1] : source);
  if (!parsed || !Array.isArray(parsed.answers)) throw new Error('Answer JSON must contain an "answers" array');
  return parsed.answers.filter(a => a && typeof a.id === 'string').map(a => ({ id: a.id, answer: String(a.answer ?? '') }));
}

/**
 * @param {string} name provider id from settings
 * @param {object} deps  { askUser(request) => Promise<string>, settings }
 */
function createLlm(name, deps) {
  const factory = providers[name];
  if (!factory) throw new Error(`Unknown LLM provider: ${name}`);
  return createLlmWithProvider(factory(deps));
}

function createLlmWithProvider(provider) {
  // Providers that keep a conversation (ChatGPT pane) answer questions in the
  // chat that produced the resume; others need the context in every request.
  let resumeChatReady = false;
  return {
    name: provider.name,
    /** `request` is the full text from resumeRequest(); starts a new conversation. */
    generateResume: async request => {
      const reply = await provider.complete(request, { purpose: 'resume', newChat: true });
      resumeChatReady = !!provider.keepsConversation;
      return reply;
    },
    answerQuestions: async ctx => {
      const text = questionsRequest({ ...ctx, inConversation: resumeChatReady });
      return parseAnswers(await provider.complete(text, { purpose: 'questions', newChat: !resumeChatReady }));
    },
  };
}

module.exports = { createLlm, createLlmWithProvider, resumeRequest, questionsRequest, parseAnswers };
