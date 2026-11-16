// Runs in the page's own JavaScript world, where React's internal props on DOM
// nodes are visible (the extension's isolated world cannot see them). page-tools.js
// asks about one field by dispatching an event on it; the answer goes back in an
// attribute, since only the DOM is shared between the two worlds.
(() => {
  if (globalThis.ResumeApplyMainWorld === 1) return;
  globalThis.ResumeApplyMainWorld = 1;
  const ATTR = 'data-resume-apply-react';
  document.addEventListener('resume-apply-react-value', event => {
    const el = event.target;
    if (!el || typeof el.setAttribute !== 'function') return;
    // React 17+ stores props as __reactProps$<id>; React 16 as __reactEventHandlers$<id>.
    const key = Object.keys(el).find(name => name.startsWith('__reactProps$') || name.startsWith('__reactEventHandlers$'));
    const props = key && el[key];
    // Only a controlled field has a value prop to compare; anything else is left unanswered.
    if (!props || !Object.prototype.hasOwnProperty.call(props, 'value') || props.value == null || typeof props.value === 'object') return;
    el.setAttribute(ATTR, JSON.stringify({value: String(props.value)}));
  }, true);
})();
