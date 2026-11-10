// Detects page states that need a human (CAPTCHA challenge, emailed
// security code) and the outcome of a submit (confirmed / validation errors).
// Invisible reCAPTCHA badges and hidden challenge frames are ignored; only
// something the user actually has to act on counts.

const CAPTCHA_FRAMES = [
  'iframe[src*="recaptcha/api2/bframe"]', // reCAPTCHA image challenge
  'iframe[src*="recaptcha/enterprise/bframe"]',
  'iframe[src*="recaptcha/api2/anchor"]:not([src*="size=invisible"])', // "I'm not a robot" checkbox
  'iframe[src*="recaptcha/enterprise/anchor"]:not([src*="size=invisible"])',
  'iframe[src*="hcaptcha.com"]',
  'iframe[src*="challenges.cloudflare.com"]',
];

const CONFIRMED_TEXT = /thank(s| you) for (applying|your application|your interest)|application (was |has been )?(submitted|received)|we('ve| have) received your application|successfully (submitted|applied)/i;
const CODE_TEXT = /security code|verification code|enter the code|one[- ]time (pass)?code|code (was |has been )?sent|sent (you )?(a|an) (code|email)/i;
const CODE_INPUT = /code|otp|verif|security|pin/i;

/* eslint-disable no-undef -- runs in the browser */
function detectInPage({ captchaSelectors, confirmed, codeText, codeInput }) {
  const re = s => new RegExp(s.source, s.flags);
  const shown = el => {
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 30 && r.height > 30 && r.right > 0 && r.left < innerWidth && r.top > -r.height;
  };
  const text = document.body ? document.body.innerText : '';

  if (re(confirmed).test(text) || /\/confirmation\b/.test(location.pathname)) return { kind: 'confirmed' };

  for (const sel of captchaSelectors) {
    if ([...document.querySelectorAll(sel)].some(shown)) return { kind: 'captcha', detail: sel };
  }

  // A sign-in / create-account page (e.g. Workday step 1): only the user can do this.
  if ([...document.querySelectorAll('input[type="password"]')].some(el => el.getBoundingClientRect().width > 0 && (!el.checkVisibility || el.checkVisibility({ visibilityProperty: true })))) {
    return { kind: 'login' };
  }

  if (re(codeText).test(text)) {
    // OTP inputs are often six narrow single-digit boxes, so any visible size counts.
    const visible = el => el.getBoundingClientRect().width > 0 && (!el.checkVisibility || el.checkVisibility({ visibilityProperty: true }));
    const hint = i => [i.name, i.id, i.placeholder, i.getAttribute('aria-label'), i.autocomplete, i.labels && i.labels[0] && i.labels[0].innerText].join(' ');
    const input = [...document.querySelectorAll('input:not([type=hidden])')].find(i => visible(i) && re(codeInput).test(hint(i)));
    if (input) return { kind: 'verification-code' };
  }

  const invalid = [...document.querySelectorAll('[aria-invalid="true"]')].filter(el => el.getBoundingClientRect().width > 0);
  if (invalid.length) {
    const messages = invalid.map(el => {
      const id = el.getAttribute('aria-errormessage');
      const msg = id && document.getElementById(id);
      const label = (el.labels && el.labels[0] && el.labels[0].innerText) || el.getAttribute('aria-label') || el.id;
      return `${label.trim()}${msg && msg.innerText.trim() ? `: ${msg.innerText.trim()}` : ''}`;
    });
    return { kind: 'errors', messages };
  }
  return { kind: null };
}
/* eslint-enable no-undef */

const CHALLENGE_HOSTS = /challenges\.cloudflare\.com|hcaptcha\.com\/captcha|recaptcha\/(api2|enterprise)\/bframe/;

/**
 * A challenge frame the in-page check cannot see, e.g. Cloudflare Turnstile
 * inside a closed shadow root (Dover). Counts only when shown at a usable size.
 */
async function visibleChallengeFrame(page) {
  if (!page.frames) return null;
  for (const frame of page.frames()) {
    if (!CHALLENGE_HOSTS.test(frame.url())) continue;
    const el = await frame.frameElement().catch(() => null);
    const box = el && (await el.boundingBox().catch(() => null));
    if (box && box.width > 30 && box.height > 30) return { kind: 'captcha', detail: frame.url().slice(0, 80) };
  }
  return null;
}

/** One snapshot of the page state. */
async function detect(page) {
  const state = await page.evaluate(detectInPage, {
    captchaSelectors: CAPTCHA_FRAMES,
    confirmed: { source: CONFIRMED_TEXT.source, flags: CONFIRMED_TEXT.flags },
    codeText: { source: CODE_TEXT.source, flags: CODE_TEXT.flags },
    codeInput: { source: CODE_INPUT.source, flags: CODE_INPUT.flags },
  }).catch(() => ({ kind: null })); // page mid-navigation
  if (state.kind) return state;
  return (await visibleChallengeFrame(page)) || state;
}

/** Poll until the page reaches a recognizable state, or `timeoutMs` passes. */
/** `moreQuestions()` (optional): true when the page now shows new questions instead of a result. */
async function waitForOutcome(page, timeoutMs = 20000, intervalMs = 1000, moreQuestions = null) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const state = await detect(page);
    if (state.kind) return state;
    if (moreQuestions && (await moreQuestions())) return { kind: 'more-questions' };
    if (Date.now() >= end) return state;
    await new Promise(r => setTimeout(r, intervalMs));
  }
}

const HUMAN_STEPS = {
  captcha: 'A CAPTCHA needs solving. Complete it in the job pane, then press Continue.',
  'verification-code': 'The site sent a security code to {email}. Enter it in the job pane (and submit if needed), then press Continue.',
  login: 'This site needs an account. Sign in (or create one with {email}) in the job pane, verify the email if asked, then press Continue.',
};

/** HUMAN_STEPS text with the profile's inbox filled in. */
function humanStepMessage(kind, profile) {
  return HUMAN_STEPS[kind].replace('{email}', (profile && profile.email) || 'your email');
}

module.exports = { detect, waitForOutcome, HUMAN_STEPS, humanStepMessage };
