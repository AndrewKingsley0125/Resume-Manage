// Applies the persisted (or system-preferred) theme before first paint
// to avoid a flash of incorrect theme. Loaded synchronously from <head>.
(function () {
  try {
    var saved = localStorage.getItem('theme');
    var prefersLight =
      window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: light)').matches;
    var theme = saved === 'light' || saved === 'dark'
      ? saved
      : prefersLight
        ? 'light'
        : 'dark';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (_) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
