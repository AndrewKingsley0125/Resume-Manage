// Runs one application end to end:
//   open → extract JD → prompt from profile → generate resume → export files → open form →
//   [scan → answer → review → fill → next]* → confirm → submit → record
//
// Everything that needs the user goes through `askUser(request)`, which the
// main process forwards to the widget:
//   { kind: 'llm', purpose, text }              → pasted reply (manual provider)
//   { kind: 'review', step, fields, answers }   → edited answers | null (cancel)
//   { kind: 'confirm-submit' }                  → true | false
//   { kind: 'company-name', suggested, jobTitle } → folder name | null (cancel); resume JSON had no company
//   { kind: 'notice', blocker, message }        → true (Continue, after a manual step) | null (cancel)
//     blocker: captcha | verification-code | unknown
//   { kind: 'failed', step, error, message }    → true (Rescan: the user fixed it, carry on) | null (stop)
// A failed step does not end the run: the user can fix things in the job pane
// and press Rescan, which retries the step from the page as it is now.
const { EventEmitter } = require('node:events');
const Resume = require('../core/resume');
const { buildPrompt } = require('../core/prompt');
const { resumeRequest } = require('../llm');
const { exportApplication, safePathSegment } = require('../core/export');
const { resolveAll } = require('../answers/answer-engine');
const { pickAdapter } = require('./adapters');
const generic = require('./adapters/generic');
const { createCursor } = require('./cursor');
const { detect, waitForOutcome, HUMAN_STEPS, humanStepMessage } = require('./blockers');

const STEPS = ['open', 'extract', 'prompt', 'generate', 'export', 'apply', 'fill', 'submit'];
const MAX_FORM_STEPS = 15;
const MAX_FOLLOW_UP_ROUNDS = 4;
const MAX_SUBMIT_ROUNDS = 3;

const { Cancelled } = require('./cancelled');

/** What the user can do before pressing Rescan, per failed step. */
const RESCAN_HINTS = {
  open: 'Open the job posting in the job pane, then press Rescan.',
  extract: 'Open the page that shows the full job description in the job pane, then press Rescan.',
  generate: 'Check the ChatGPT pane (logged in, no error), then press Rescan to ask again.',
  export: 'Check the save folder (exists, files not open in Word), then press Rescan.',
  apply: 'Open the application form in the job pane yourself, then press Rescan to continue from it.',
  fill: 'Fix the page in the job pane (fill the field, close a popup, go to the right step), then press Rescan.',
  submit: 'Fix the form in the job pane (missing answers, wrong page), then press Rescan to check it again.',
};

/** Raw JSON object from an LLM reply (plain or ```json fenced), without schema validation. */
function rawJson(text) {
  const source = String(text).trim();
  const fenced = /^```json\s*\n?([\s\S]*?)\n?```$/i.exec(source);
  try { return JSON.parse(fenced ? fenced[1] : source); } catch (_) { return null; }
}

/** File types each upload takes (its `accept` list), for adapters that don't record it. Picks DOCX vs PDF. */
async function readAccept(page, fields) {
  for (const f of fields) {
    if (f.type !== 'file' || f.accept !== undefined) continue;
    f.accept = (await page.locator(`[data-aa-field="${f.id}"]`).getAttribute('accept').catch(() => '')) || '';
  }
}

class ApplicationRun extends EventEmitter {
  /**
   * @param {object} deps
   * @param {object} deps.profile
   * @param {string} deps.url
   * @param {object} deps.settings   { humanCursor, autoSubmit }
   * @param {object} deps.llm        from createLlm()
   * @param {object} deps.page       Playwright page
   * @param {Function} deps.askUser
   * @param {Function} deps.htmlToPdf
   * @param {object} deps.storage
   */
  constructor(deps) {
    super();
    Object.assign(this, deps);
    this.cancelled = false;
    this.record = { url: deps.url, profileId: deps.profile.id, status: 'running', steps: [] };
  }

  cancel() { this.cancelled = true; }

  log(message) { this.emit('log', message); }

  /**
   * Run one step. On failure the user is asked to fix it and Rescan, which
   * runs `retry` (default: the step again); Stop ends the run as failed.
   * `retry: false` hands the error to the caller instead.
   */
  async step(name, fn, { retry = fn } = {}) {
    for (;;) {
      if (this.cancelled) throw new Cancelled();
      this.emit('step', { name, status: 'running' });
      try {
        const result = await fn();
        this.emit('step', { name, status: 'done' });
        this.record.steps.push(name);
        return result;
      } catch (err) {
        if (err instanceof Cancelled) {
          this.emit('step', { name, status: 'cancelled' });
          throw err;
        }
        this.emit('step', { name, status: 'failed', error: err.message });
        if (!retry || err.stopped || !(await this.askToRescan(name, err.message))) throw err; // stopped: the user already chose Stop
        fn = retry;
      }
    }
  }

  /** Pause on a failure until the user fixes it (true: Rescan) or stops the run (false). */
  async askToRescan(name, error) {
    const go = await this.ask({ kind: 'failed', step: name, error, message: RESCAN_HINTS[name] || RESCAN_HINTS.fill });
    if (go) this.log('Rescanning the page and continuing');
    return !!go;
  }

  async ask(request) {
    const answer = await this.askUser(request);
    if (this.cancelled) throw new Cancelled();
    return answer;
  }

  async run() {
    const { profile, url } = this;
    try {
      const adapter = pickAdapter(url);
      this.record.adapter = adapter.id;
      let page = this.page;
      const cursor = createCursor(page, { human: this.settings.humanCursor });

      await this.step('open', async () => {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await this.clearBlockers(page); // e.g. Cloudflare check before the page shows
      });

      const job = await this.step('extract', async () => {
        const j = await adapter.extractJob(page);
        if (!j.description || j.description.length < 200) throw new Error('Job description not found on the page');
        this.log(`JD: ${j.title || '?'} at ${j.company || '?'} (${j.description.length} chars, via ${j.source})`);
        return j;
      });
      Object.assign(this.record, { jobTitle: job.title, company: job.company });
      this.emit('job', { title: job.title, company: job.company });

      // Same as Resume Manager's "Generate prompt from profile": resume_prompt.md with this
      // profile's candidate block, then the JD in the template's JOB DESCRIPTION slot.
      const request = await this.step('prompt', async () => {
        const text = resumeRequest(buildPrompt(profile), job.description);
        this.log(`Prompt generated from profile (${text.length} chars)`);
        return text;
      });

      const resume = await this.step('generate', async () => {
        for (let attempt = 1; attempt <= 3; attempt++) {
          const reply = await this.llm.generateResume(request);
          const raw = rawJson(reply);
          if (raw && Object.hasOwn(raw, 'error')) return { ineligible: String(raw.error) };
          try { return Resume.parse(reply, profile); }
          catch (err) { this.log(`Resume JSON rejected (attempt ${attempt}): ${err.message}`); }
        }
        throw new Error('No valid resume JSON after 3 attempts');
      });
      if (resume.ineligible) {
        this.log(`Skipped: ${resume.ineligible}`);
        return this.finish('skipped', { reason: resume.ineligible });
      }

      const files = await this.step('export', async () => {
        // Like Resume Manager: no company in the JSON → ask for the folder name (again on Rescan).
        let company;
        if (!safePathSegment(resume.company)) {
          company = await this.ask({ kind: 'company-name', suggested: job.company || '', jobTitle: job.title || '' });
          if (!safePathSegment(company)) throw new Cancelled();
          this.log(`Company name entered: ${company}`);
        }
        return exportApplication({
          profile, resumeData: resume, jd: job.description, htmlToPdf: this.htmlToPdf, company,
          style: this.storage.getStyle(profile.id, profile.templateId),
        });
      });
      this.record.folder = files.folder;

      // Rescan after a failed Apply: the user opened the form; use the pane as it is.
      page = await this.step('apply', () => adapter.openApplication(page, cursor), { retry: async () => this.page });
      const formCursor = page === this.page ? cursor : createCursor(page, { human: this.settings.humanCursor });

      this.record.answers = [];
      const ctx = { profile, files: { resume: files.pdfPath, resumeDocx: files.docxPath }, jd: job.description, resume, job };
      // Some sites show more questions after Submit (e.g. a second page); fill those and submit again.
      let confirmed;
      for (let more = 0; ;) {
        await this.step('fill', () => this.fillForm(page, adapter, ctx, formCursor));
        try {
          confirmed = await this.step('submit', async () => {
            const button = await adapter.findSubmit(page);
            if (!button) throw new Error('Submit button not found');
            await this.clearBlockers(page); // e.g. a visible "I'm not a robot" checkbox
            if (!this.settings.autoSubmit && !(await this.ask({ kind: 'confirm-submit' }))) throw new Cancelled();
            await formCursor.click(button);
            return this.awaitSubmitOutcome(page, adapter);
          }, { retry: false });
        } catch (err) {
          // Rescan goes back to filling: the fix may have changed the page or its questions.
          if (err instanceof Cancelled || !(await this.askToRescan('submit', err.message))) throw err;
          continue;
        }
        if (confirmed !== 'more-questions') break;
        if (++more >= MAX_SUBMIT_ROUNDS) throw new Error('The form kept asking more questions after Submit');
        this.log('More questions appeared after Submit; filling them');
      }

      return this.finish(confirmed ? 'submitted' : 'submitted-unconfirmed');
    } catch (err) {
      if (err instanceof Cancelled) return this.finish('cancelled');
      this.log(`Failed: ${err.message}`);
      return this.finish('failed', { error: err.message });
    }
  }

  /**
   * Fill every page of the form, pressing Next / Continue between pages,
   * until the page with the Submit button (which is left unclicked).
   */
  async fillForm(page, adapter, ctx, formCursor) {
    for (let formStep = 1; formStep <= MAX_FORM_STEPS; formStep++) {
      // Sign-in (Workday), CAPTCHA or an emailed code before this step's questions.
      // ready() can land on another such screen (Workday: Apply again after signing in).
      for (let i = 0; i < 3; i++) {
        await this.clearBlockers(page);
        if (!adapter.ready) break;
        await adapter.ready(page, formCursor);
        if (!HUMAN_STEPS[(await detect(page)).kind]) break;
      }
      // Answers can reveal follow-up questions (e.g. Race after "Hispanic/Latino: No").
      // After each fill, rescan and handle only the fields that are new. Some sites
      // re-render a filled control (e.g. the upload box), so a question already
      // handled on this step is never asked again.
      const handled = new Set();
      const key = f => `${f.type}:${f.label}`;
      for (let round = 0; round < MAX_FOLLOW_UP_ROUNDS; round++) {
        const fields = (await adapter.scan(page)).filter(f => !f.done && !handled.has(key(f)));
        if (!fields.length) break;
        await readAccept(page, fields);
        fields.forEach(f => handled.add(key(f)));
        if (round > 0) this.log(`${fields.length} follow-up question(s) appeared after filling`);
        const proposed = await resolveAll(fields, ctx, this.llm);
        const answers = await this.ask({ kind: 'review', step: formStep, followUp: round > 0, fields, answers: proposed });
        if (!answers) throw new Cancelled();
        const failed = await this.fillApproved(page, adapter, fields, answers, formCursor);
        this.record.answers.push(...fields.map(f => ({ label: f.label, type: f.type, ...answers.find(a => a.id === f.id) })));
        this.rememberEdited(fields, proposed, answers);
        await adapter.markFilled(page);
        if (failed.length) {
          const error = `Could not fill ${failed.length} field(s): ${failed.join('; ')}`;
          this.log(error);
          if (!(await this.askToRescan('fill', `${error}. Fill them in the job pane.`))) throw Object.assign(new Error(error), { stopped: true });
        }
      }
      if (await adapter.nextStep(page, formCursor)) continue;
      if (await adapter.findSubmit(page)) return;
      // The site adapter knows no Next button here, but there is no Submit
      // either: try any visible Next / Continue button before giving up.
      if (!(await generic.nextStep(page, formCursor))) return;
      this.log(`Pressed Next / Continue (page ${formStep + 1})`);
    }
    throw new Error(`Form has more than ${MAX_FORM_STEPS} steps`);
  }

  /**
   * Fill the approved answers. Fast mode (default): all plain text fields in
   * one batch, then the rest with instant clicks. Human mode
   * (settings.fillMode = 'human'): field by field with the moving cursor.
   */
  async fillApproved(page, adapter, fields, answers, humanCursor) {
    const items = fields
      .map(field => ({ field, value: (answers.find(a => a.id === field.id) || {}).value }))
      .filter(({ value }) => value != null && value !== '');
    const fast = this.settings.fillMode !== 'human';
    const cursor = fast ? createCursor(page, { human: false }) : humanCursor;
    const t0 = Date.now();
    let done = new Set();
    if (fast && adapter.fillTextBatch) done = new Set(await adapter.fillTextBatch(page, items));
    const failed = [];
    for (const { field, value } of items) {
      if (done.has(field.id)) continue;
      try {
        await adapter.fill(page, field, value, cursor);
      } catch (err) {
        if (err instanceof Cancelled) throw err;
        failed.push(`${field.label || field.type}: ${err.message.split('\n')[0]}`); // one bad field doesn't stop the rest
      }
      if (!fast) await cursor.pause(150, 500);
    }
    this.log(`Filled ${items.length - failed.length} field(s) in ${((Date.now() - t0) / 1000).toFixed(1)}s (${done.size} at once)`);
    return failed;
  }

  /** Pause until the user finishes a manual step in the browser and presses Continue. */
  async handOff(page, kind, message) {
    this.log(`Waiting for you: ${message}`);
    await page.bringToFront().catch(() => {});
    if (!(await this.ask({ kind: 'notice', blocker: kind, message }))) throw new Cancelled();
  }

  /** Hand CAPTCHA / security-code screens to the user until none is showing. */
  async clearBlockers(page) {
    for (let round = 0; round < 5; round++) {
      const state = await detect(page);
      if (!HUMAN_STEPS[state.kind]) return;
      await this.handOff(page, state.kind, humanStepMessage(state.kind, this.profile));
    }
  }

  /**
   * After clicking submit: true when the site confirms, false if it never clearly
   * does, 'more-questions' when the page now shows questions not yet answered.
   */
  async awaitSubmitOutcome(page, adapter) {
    const moreQuestions = () => adapter.scan(page).then(fields => fields.some(f => !f.done), () => false);
    let checkedUnknown = false;
    for (let round = 0; round < 6; round++) {
      const state = await waitForOutcome(page, this.settings.submitTimeoutMs || 20000, 1000, moreQuestions);
      if (state.kind === 'more-questions') return 'more-questions';
      if (state.kind === 'confirmed') {
        this.log('Application confirmed by the site');
        return true;
      }
      if (HUMAN_STEPS[state.kind]) {
        await this.handOff(page, state.kind, humanStepMessage(state.kind, this.profile));
        continue;
      }
      if (state.kind === 'errors' && (await moreQuestions())) return 'more-questions'; // required fields left empty
      if (state.kind === 'errors') throw new Error(`The site rejected the form: ${state.messages.join('; ')}`);
      if (checkedUnknown) return false;
      checkedUnknown = true;
      await this.handOff(page, 'unknown', 'Could not confirm the application went through. Check the job pane, finish any remaining step, then press Continue.');
    }
    return false;
  }

  /** Answers the user typed or changed in review go into the answer bank. */
  rememberEdited(fields, proposed, final) {
    const pairs = [];
    for (const f of fields) {
      if (f.type === 'file' || !f.label) continue;
      const before = proposed.find(a => a.id === f.id), after = final.find(a => a.id === f.id);
      if (after && after.value && (after.source === 'user' || (before && before.value !== after.value))) {
        pairs.push({ question: f.label, answer: after.value });
      }
    }
    if (pairs.length) this.storage.rememberAnswers(this.profile.id, pairs);
  }

  finish(status, extra = {}) {
    Object.assign(this.record, { status, finishedAt: new Date().toISOString() }, extra);
    this.storage.appendRunLog(this.record);
    this.emit('done', this.record);
    return this.record;
  }
}

module.exports = { ApplicationRun, STEPS, rawJson };
