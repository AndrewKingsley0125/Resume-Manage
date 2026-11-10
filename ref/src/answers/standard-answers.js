// Standard personal answers used for every profile (set by the user).
// A profile can override any of them with `application.personal.<key>`;
// the older `application.eeo` fields also override when filled in.
//
// Rules map a question to an answer and, for dropdown/radio questions, a list
// of option patterns to prefer (forms word the same answer differently:
// "No" may appear as "I am not a protected veteran").

const PERSONAL = {
  country: 'United States',
  citizenship: 'U.S. Citizen',
  workAuthorizationStatus: 'U.S. citizen',
  gender: 'Male',
  race: 'Asian',
  hispanicLatino: 'No',
  preferredLanguage: 'English',
  disability: 'No',
  veteran: 'No',
  lgbtq: 'No',
  authorizedToWork: 'Yes',
  sponsorship: 'No',
  criminalRecord: 'No',
  availability: 'I can start immediately.',
  backgroundCheck: 'Yes',
  atLeast18: 'Yes',
  relatedToEmployee: 'No', // no relatives, family members or friends at any company
  nonCompete: 'No',
  workedHereBefore: 'No',
};

/** Standard answers merged with the profile's own overrides. */
function personalInfo(profile) {
  const app = (profile && profile.application) || {};
  const eeo = app.eeo || {};
  const fromEeo = Object.fromEntries(
    [['gender', eeo.gender], ['race', eeo.race], ['hispanicLatino', eeo.hispanicLatino], ['veteran', eeo.veteran], ['disability', eeo.disability]]
      .filter(([, v]) => v),
  );
  return { ...PERSONAL, ...fromEeo, ...(app.personal || {}) };
}

const YES = [/^yes\b/i];
const NO = [/^no\b/i];

/**
 * Most specific first. `answer(p)` gets personalInfo(profile).
 * `decline: true` means: pick the form's "prefer not to say" option, else leave for the user.
 */
const RULES = [
  // Acknowledging an equal-opportunity statement (it mentions race, veteran, ...
  // so it must come before those rules): tick it / answer Yes.
  { q: /equal opportunity employer/i, answer: () => 'Yes', prefer: [/^(yes|i acknowledge|i agree|acknowledge)/i, /./] },
  // Consent to processing the application / privacy notice: tick it / answer Yes.
  { q: /i (hereby )?(consent|agree)\b|have read and (understood|consent|agree|accept)|acknowledge that my personal data/i, answer: () => 'Yes', prefer: [/^(yes|i agree|i consent|i acknowledge)/i, /./] },
  { q: /pronoun/i, decline: true },
  { q: /sexual orientation/i, answer: p => (p.lgbtq === 'No' ? 'Heterosexual' : p.lgbtq), prefer: [/heterosexual|straight/i] },
  { q: /lgbt|transgender|queer/i, answer: p => p.lgbtq, prefer: [/^no\b/i, /not (lgbt|a member|transgender)/i] },
  { q: /identify as asian/i, answer: () => 'Yes', prefer: YES },
  // U.S. citizen: work authorization never expires.
  { q: /(authori[sz]ation|visa|permit).*expir|expir.*(authori[sz]ation|visa|permit)/i, answer: () => 'N/A', prefer: [/^n\/?a\b|not applicable/i] },
  { q: /related to.*(employee|work(s|ing)? (at|for))|relationship with.*employee|(relatives?|family members?|friends?|know anyone|anyone you know) (who )?(currently )?(work|is employed|are employed)/i, answer: p => p.relatedToEmployee, prefer: NO },
  { q: /non-?compete|non-?solicit|restrictive covenant/i, answer: p => p.nonCompete, prefer: NO },
  // Only questions about this employer ("worked at X in the past"), not "worked with React".
  { q: /(worked|been employed|employed) (at|for|by) .{0,60}\b(before|previously|in the past|prior)|previously (worked|been employed|employed) (at|for|by)|former employee|ex-employee|rehire/i, answer: p => p.workedHereBefore, prefer: NO },
  { q: /hispanic|latin[oax]/i, answer: p => p.hispanicLatino, prefer: [/^no\b/i, /not hispanic/i] },
  { q: /\brace\b|ethnicit/i, answer: p => p.race, prefer: [/^asian\b/i, /^east asian\b/i, /\basian\b/i] },
  { q: /veteran/i, answer: p => p.veteran, prefer: [/not a (protected )?veteran/i, /^i am not\b/i, /^no\b/i] },
  { q: /disabilit/i, answer: p => p.disability, prefer: [/^no\b/i, /(do not|don.t) (have|identify)/i] },
  { q: /\bgender\b|\bsex\b/i, answer: p => p.gender, prefer: [/^male$/i, /^male\b/i, /^man$/i, /\bmale\b/i] },
  { q: /at least 18|over 18|18 years|age of 18/i, answer: p => p.atLeast18, prefer: YES },
  { q: /(need|require) (a )?(visa|work permit)/i, answer: p => p.sponsorship, prefer: NO },
  { q: /sponsor/i, answer: p => p.sponsorship, prefer: NO },
  { q: /(work )?authori[sz]ation status|citizenship status|immigration status|visa status/i, answer: p => p.workAuthorizationStatus, prefer: [/citizen/i] },
  { q: /authori[sz]ed to work|eligible to work|legally (eligible|authori[sz]ed)|right to work/i, answer: p => p.authorizedToWork, prefer: YES },
  { q: /are you a (u\.?s\.? )?citizen/i, answer: () => 'Yes', prefer: YES },
  { q: /citizenship/i, answer: p => p.citizenship, prefer: [/u\.?s\.? citizen/i, /united states/i] },
  { q: /country.*(live|reside|located|based)|country of residence/i, answer: p => p.country, prefer: [/^united states\b/i] },
  { q: /criminal|convicted|conviction|felony|misdemeanor/i, answer: p => p.criminalRecord, prefer: NO },
  { q: /background check/i, answer: p => p.backgroundCheck, prefer: YES },
  { q: /when can you start|earliest start|start date|availability|notice period/i, answer: p => p.availability, prefer: [/immediate/i, /as soon as|asap/i] },
  {
    q: /how did you (first )?(hear|learn|find out|come across)|where did you (first )?(hear|find|learn|see)|how did you find (us|this|the|our)|(referral|application|candidate|job|lead) source|^\s*source\b/i,
    answer: () => 'LinkedIn',
    prefer: [/linked\s?in/i, /built\s?in/i, /glassdoor/i, /indeed/i, /^other\b/i],
  },
  { q: /country phone code|phone country|dial(ing)? code/i, answer: p => p.country, prefer: [/^united states/i, /^us\b.*\+1|\+1\b/i] },
  { q: /phone (device )?type|type of phone/i, answer: () => 'Mobile', prefer: [/mobile|cell/i] },
  // Self-identification forms (Workday): signature date is today.
  { q: /^\s*(today'?s )?date\s*$|date signed|signature date/i, answer: () => new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) },
  { q: /currency/i, answer: () => 'USD', prefer: [/\busd\b/i, /us dollar|united states dollar/i, /^\$/] },
  { q: /(preferred|primary) language|language preference/i, answer: p => p.preferredLanguage, prefer: [/^english\b/i] },
];

module.exports = { PERSONAL, personalInfo, RULES };
