/*
 * The app's own confirmation dialog, in place of the browser's plain confirm() box, so every
 * question matches the app's theme (light or dark).
 *
 *   const ok = await window.App.Confirm.ask({
 *     title: 'Complete this application?',
 *     subject: 'Acme - Staff Engineer',      // optional: what it is about, shown highlighted
 *     message: 'Do this after you submitted it.\n\nIts tabs close.',  // blank lines split paragraphs
 *     confirmLabel: 'Complete', cancelLabel: 'Cancel',
 *     tone: 'primary' | 'success' | 'danger',
 *   });
 *
 * Enter confirms, Escape or a click beside it cancels. Resolves true or false.
 */
(function () {
  const TONES = {
    primary: {mark:'?', markClass:'bg-lz-info-bg text-lz-info', button:'btn-primary'},
    success: {mark:'✓', markClass:'bg-lz-success-bg text-lz-success', button:'btn-primary'},
    danger: {mark:'!', markClass:'bg-lz-danger-bg text-lz-danger', button:'btn-danger'},
  };
  let pending = null;
  const make = (tag, className, text) => {const node = document.createElement(tag);if (className) node.className = className;if (text != null) node.textContent = text;return node;};

  function ask(options = {}) {
    // One question at a time: a second one answers the first with Cancel.
    if (pending) pending(false);
    const tone = TONES[options.tone] || TONES.primary;
    const previous = document.activeElement;
    return new Promise(resolve => {
      const box = make('div', 'app-confirm modal z-[70]');
      box.setAttribute('role', 'alertdialog');box.setAttribute('aria-modal', 'true');
      const backdrop = make('div', 'modal-backdrop');
      const card = make('div', 'app-confirm-card relative z-10 flex w-[min(440px,92vw)] flex-col rounded-2xl border border-line bg-elev p-6 shadow-[0_24px_60px_-12px_rgba(0,0,0,0.45)]');
      const head = make('div', 'flex items-start gap-3.5');
      const mark = make('span', `grid h-9 w-9 flex-none place-items-center rounded-full text-base font-bold ${tone.markClass}`, tone.mark);
      mark.setAttribute('aria-hidden', 'true');
      const text = make('div', 'min-w-0 flex-1');
      const title = make('h2', 'app-confirm-title m-0 text-[17px] font-semibold leading-snug text-ink', options.title || 'Are you sure?');
      title.id = 'app-confirm-title';box.setAttribute('aria-labelledby', title.id);
      text.append(title);
      if (options.subject) text.append(make('p', 'app-confirm-subject m-0 mt-2 rounded-lg bg-sunken px-3 py-2 text-[13px] font-semibold text-ink [overflow-wrap:anywhere]', options.subject));
      const body = make('div', 'app-confirm-message mt-2.5 flex flex-col gap-2 text-sm leading-relaxed text-muted');
      String(options.message || '').split(/\n\s*\n/).map(part => part.trim()).filter(Boolean).forEach(part => body.append(make('p', 'm-0 [overflow-wrap:anywhere]', part)));
      if (body.childNodes.length) {body.id = 'app-confirm-message';box.setAttribute('aria-describedby', body.id);text.append(body);}
      head.append(mark, text);
      const actions = make('div', 'mt-6 flex justify-end gap-2.5');
      const cancel = make('button', 'btn btn-ghost app-confirm-cancel', options.cancelLabel || 'Cancel');cancel.type = 'button';
      const confirm = make('button', `btn ${tone.button} app-confirm-ok`, options.confirmLabel || 'OK');confirm.type = 'button';
      actions.append(cancel, confirm);
      card.append(head, actions);
      box.append(backdrop, card);

      const finish = answer => {
        if (pending !== finish) return;
        pending = null;
        document.removeEventListener('keydown', onKey, true);
        box.remove();
        if (previous && typeof previous.focus === 'function' && document.contains(previous)) previous.focus();
        resolve(answer);
      };
      // Keys go to this dialog only, not to the screen or panel behind it.
      const onKey = event => {
        if (event.key === 'Escape') {event.preventDefault();event.stopPropagation();finish(false);}
        else if (event.key === 'Enter' && document.activeElement !== cancel) {event.preventDefault();event.stopPropagation();finish(true);}
        else if (event.key === 'Tab') {event.preventDefault();(document.activeElement === confirm ? cancel : confirm).focus();}
      };
      pending = finish;
      cancel.addEventListener('click', () => finish(false));
      backdrop.addEventListener('click', () => finish(false));
      confirm.addEventListener('click', () => finish(true));
      document.addEventListener('keydown', onKey, true);
      document.body.append(box);
      confirm.focus();
    });
  }

  window.App = window.App || {};
  window.App.Confirm = {ask};
})();
