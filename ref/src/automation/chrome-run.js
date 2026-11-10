const { ApplicationRun, rawJson } = require('./orchestrator');
const Resume = require('../core/resume');
const { buildPrompt } = require('../core/prompt');
const { resumeRequest } = require('../llm');
const { exportApplication, safePathSegment } = require('../core/export');
const { resolveAll } = require('../answers/answer-engine');
const { Cancelled } = require('./cancelled');
const fs = require('node:fs');
const path = require('node:path');
const { RELOAD_EXTENSION_MESSAGE } = require('../main/browser-protocol');

// Reuse step retry, cancellation, review memory and run records from the existing pipeline.
class ChromeRun extends ApplicationRun {
  async pause() {
    await new Promise(resolve => setTimeout(resolve, this.settings.browserPollMs ?? 500));
    if (this.cancelled) throw new Cancelled();
  }
  async ready(browser) {
    let deadline = Date.now() + 20000;
    for (;;) {
      if (this.cancelled) throw new Cancelled();
      let state;
      try { state = await browser('state'); } catch (error) {
        if (/unsupported browser command/i.test(error.message)) throw new Error(RELOAD_EXTENSION_MESSAGE);
        if (error instanceof Cancelled || Date.now() > deadline) throw error;
      }
      if (state?.blocked) {
        if (!(await this.ask({ kind: 'notice', blocker: 'captcha', message: 'Finish the login, security code or verification in this run’s Chrome tab. Continue here when it is complete.' }))) throw new Cancelled();
        deadline = Date.now() + 20000;
      } else if (state?.ready) return state;
      if (Date.now() > deadline) throw new Error('The job page did not load. Check this run’s Chrome tab.');
      await this.pause();
    }
  }
  async upload(browser, field, filePath) {
    const bytes = fs.readFileSync(filePath);
    if (bytes.length > 20 * 1024 * 1024) throw new Error('Resume exceeds the 20 MB upload limit');
    const type = filePath.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    await browser('uploadStart', { field, name: path.basename(filePath), type, size: bytes.length });
    for (let offset = 0, index = 0; offset < bytes.length; offset += 96 * 1024, index++) {
      await browser('uploadChunk', { field, index, data: bytes.subarray(offset, offset + 96 * 1024).toString('base64') });
    }
    await browser('uploadEnd', { field });
  }
  async autoFill(browser, ctx) {
    for (let page = 1; page <= 15; page++) {
      await this.ready(browser);
      const handled = new Set();
      const key = field => `${field.frameId}:${field.type}:${field.name}:${field.label}`;
      for (let round = 0; round < 6; round++) {
        let fields = (await browser('scan')).filter(field => !field.done && !handled.has(key(field)));
        if (!fields.length) break;
        const fileItems = fields.filter(field => field.type === 'file');
        const fileAnswers = await resolveAll(fileItems, ctx);
        let uploaded = false;
        for (const field of fileItems) {
          const answer = fileAnswers.find(a => a.id === field.id);
          try {
            if (answer?.value && answer.source === 'file') {
              await this.upload(browser, field, answer.value); uploaded = true;
              this.log(`Uploaded ${field.label || 'resume'}`);
            } else if (field.required) throw new Error('Upload this file manually');
          } catch (error) {
            if (error instanceof Cancelled) throw error;
            if (!(await this.ask({ kind: 'notice', message: `${field.label}: ${error.message}. Finish this upload in Chrome, then Continue.` }))) throw new Cancelled();
          }
          handled.add(key(field));
        }
        // Resume parsing can rebuild controls and add questions. Generate answers
        // only after uploads and a fresh scan, so IDs and questions remain current.
        if (uploaded) { await this.pause(); await this.pause(); await this.ready(browser); continue; }
        fields = fields.filter(field => field.type !== 'file');
        if (!fields.length) break;
        const proposed = await resolveAll(fields, ctx, this.llm);
        const needsAnswer = fields.some(field => field.required && proposed.find(a => a.id === field.id)?.source === 'unknown' && field.type !== 'file');
        const answers = this.settings.reviewAnswers || needsAnswer
          ? await this.ask({ kind: 'review', step: page, fields, answers: proposed }) : proposed;
        if (!answers) throw new Cancelled();
        const failures = [];
        const result = await browser('fill', { items: fields.filter(field => field.type !== 'file').map(field => {
          const answer = answers.find(a => a.id === field.id);
          return { field, value: answer?.value, source: answer?.source };
        }) });
        for (const field of fields) {
          const answer = answers.find(a => a.id === field.id);
          if (result.filled.includes(field.id) || (!field.required && !answer?.value)) handled.add(key(field));
          if (field.required && answer?.source === 'blocked') failures.push(`${field.label}: complete this field manually`);
        }
        this.record.answers.push(...fields.map(field => ({ label: field.label, ...answers.find(a => a.id === field.id) })));
        this.rememberEdited(fields, proposed, answers);
        this.log(`Filled ${result.filled.length} field(s) automatically on form page ${page}`);
        failures.push(...result.failed);
        if (failures.length) {
          if (!(await this.ask({ kind: 'notice', message: `Complete these controls in Chrome, then Continue: ${failures.join('; ')}` }))) throw new Cancelled();
          fields.forEach(field => handled.add(key(field)));
        }
        await this.pause();
      }
      const state = await this.ready(browser);
      if (state.submit) return;
      if (state.next) {
        const next = await browser('next');
        if (next.clicked) { await this.pause(); continue; }
      }
      const action = await this.ask({ kind: 'chrome-next', message: 'The form has an unsupported navigation control. Open the next page in Chrome and choose Scan again, or Ready to submit when the form is complete.' });
      if (!action) throw new Cancelled();
      if (action === 'ready') return;
    }
    throw new Error('Form exceeded 15 pages. Check its validation messages in Chrome.');
  }
  async askToRescan(name, error) {
    return !!(await this.ask({ kind: 'failed', step: name, error,
      message: 'Fix the page in this run’s Chrome tab (or the exported files), then choose Rescan and continue. For ChatGPT, check the Chrome tab and use the send/import buttons again.' }));
  }
  async run() {
    const automatic = this.settings.browserAutomation !== false;
    const browser = (command, payload) => {
      if (this.cancelled) throw new Cancelled();
      return this.bridge.request(command, { runId: this.runId, ...payload });
    };
    const notice = async message => {
      if (!(await this.ask({ kind: 'notice', message }))) throw new Cancelled();
    };
    try {
      let opened = false;
      await this.step('open', async () => {
        if (!opened) { await browser('open', { url: this.url }); opened = true; }
        if (automatic) await this.ready(browser);
        else await notice('In Chrome, finish any login or verification and wait for the job description to load. Then press Continue here.');
      });
      const job = await this.step('extract', async () => {
        const result = await browser('read');
        if (result.description.length < 200) throw new Error('Open the full job description in this run’s Chrome tab, then Rescan.');
        return result;
      });
      this.emit('job', job);
      Object.assign(this.record, { jobTitle: job.title, company: job.company, adapter: 'chrome-extension' });
      const request = await this.step('prompt', () => resumeRequest(buildPrompt(this.profile), job.description));
      const resume = await this.step('generate', async () => {
        const reply = await this.llm.generateResume(request);
        if (reply == null) throw new Cancelled();
        const raw = rawJson(reply);
        if (raw && Object.hasOwn(raw, 'error')) return { ineligible: String(raw.error) };
        return Resume.parse(reply, this.profile);
      });
      if (resume.ineligible) return this.finish('skipped', { reason: resume.ineligible });
      const files = await this.step('export', async () => {
        const company = safePathSegment(resume.company) ? undefined : await this.ask({ kind: 'company-name', suggested: job.company, jobTitle: job.title });
        if (!safePathSegment(resume.company) && !safePathSegment(company)) throw new Cancelled();
        return exportApplication({ profile: this.profile, resumeData: resume, jd: job.description, htmlToPdf: this.htmlToPdf, company, style: this.storage.getStyle(this.profile.id, this.profile.templateId) });
      });
      this.record.folder = files.folder;
      this.log(`Resume files: ${files.pdfPath} and ${files.docxPath}`);
      await this.step('apply', async () => {
        if (!automatic) return notice('Open the application form in the SAME Chrome tab and upload your exported resume. Then Continue.');
        const result = await browser('apply');
        if (!result.clicked && !result.hasForm) await notice('Apply could not be located. Open the application form in Chrome, then Continue.');
        await this.pause(); await this.ready(browser);
      });
      this.record.answers = [];
      if (automatic) {
        const ctx = { profile: this.profile, files: { resume: files.pdfPath, resumeDocx: files.docxPath }, jd: job.description, resume, job };
        await this.step('fill', () => this.autoFill(browser, ctx));
        const submitted = await this.step('submit', async () => {
          if (!this.settings.autoSubmit && !(await this.ask({ kind: 'confirm-submit' }))) throw new Cancelled();
          await this.ready(browser);
          if (!(await browser('submit')).clicked) throw new Error('Submit button not found. Submit manually in Chrome and check the site confirmation.');
          // Never retry a submit click automatically: the first click may have succeeded.
          for (let attempt = 0; attempt < 20; attempt++) {
            await this.pause();
            const state = await this.ready(browser);
            if (state.confirmed) return true;
            if (state.errors?.length) throw new Error(`The site rejected the form: ${state.errors.join('; ')}`);
          }
          return false;
        }, { retry: false });
        return this.finish(submitted ? 'submitted' : 'submitted-unconfirmed');
      }
      await this.step('fill', async () => {
        for (;;) {
          const fields = (await browser('scan')).filter(f => !f.done && !['file', 'password'].includes(f.type));
          if (fields.length) {
            const ctx = { profile: this.profile, files: { resume: files.pdfPath, resumeDocx: files.docxPath }, jd: job.description, resume, job };
            const proposed = await resolveAll(fields, ctx, this.llm);
            const answers = await this.ask({ kind: 'review', step: 1, fields, answers: proposed });
            if (!answers) throw new Cancelled();
            const result = await browser('fill', { items: fields.map(field => ({ field, value: answers.find(a => a.id === field.id)?.value })) });
            this.rememberEdited(fields, proposed, answers);
            this.record.answers.push(...answers);
            if (result.failed.length) this.log(`Fill manually in Chrome: ${result.failed.join(', ')}`);
          }
          const action = await this.ask({ kind: 'chrome-next', message: 'Review the form in Chrome. Fill uploads and custom controls manually. If there is another page, press Next in Chrome and choose Scan again here. When the form is complete, choose Ready to submit.' });
          if (!action) throw new Cancelled();
          if (action === 'ready') break;
        }
      });
      await this.step('submit', () => notice('Review and submit the application yourself in Chrome. Press Continue only after the site shows a confirmation. The app records this as your confirmation; it cannot verify submission.'));
      return this.finish('submitted-unconfirmed', { userConfirmed: true });
    } catch (error) {
      return this.finish(error instanceof Cancelled ? 'cancelled' : 'failed', { error: error instanceof Cancelled ? undefined : error.message });
    }
  }
}
module.exports = { ChromeRun };
