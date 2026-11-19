// Tailwind for the desktop app (src/renderer). Colours come from the CSS variables in
// src/renderer/tailwind.src.css, so the same classes work in light and dark themes.
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{html,js}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        elev: 'var(--bg-elev)',
        elev2: 'var(--bg-elev-2)',
        sunken: 'var(--bg-sunken)',
        line: 'var(--border)',
        'line-strong': 'var(--border-hover)',
        ink: 'var(--text)',
        muted: 'var(--text-muted)',
        accent: {DEFAULT:'var(--accent)', hover:'var(--accent-hover)', ring:'var(--accent-ring)', shadow:'var(--accent-shadow)'},
        danger: {DEFAULT:'var(--danger)', hover:'var(--danger-hover)', bg:'var(--danger-bg)', line:'var(--danger-border)'},
        success: {DEFAULT:'var(--success)', hover:'var(--success-hover)', bg:'var(--success-bg)', line:'var(--success-border)'},
        hover: {DEFAULT:'var(--surface-hover)', strong:'var(--surface-hover-strong)'},
        // Job states: GitHub Primer's functional colours, set per theme in tailwind.src.css.
        // st-<state> is the text colour, st-<state>-bg a soft fill, st-<state>-line a border.
        st: Object.fromEntries(['todo', 'progress', 'manual', 'review', 'done', 'failed'].map(key =>
          [key, {DEFAULT:`var(--st-${key}-fg)`, bg:`var(--st-${key}-bg)`, line:`var(--st-${key}-line)`}])),
        // The Jira-style board (Atlassian design tokens, set per theme in tailwind.src.css).
        jr: {column:'var(--jr-column)', card:'var(--jr-card)', 'card-hover':'var(--jr-card-hover)', text:'var(--jr-text)', subtle:'var(--jr-subtle)', subtlest:'var(--jr-subtlest)',
          neutral:'var(--jr-neutral)', 'neutral-hover':'var(--jr-neutral-hover)', border:'var(--jr-border)', selected:'var(--jr-selected)', 'selected-line':'var(--jr-selected-line)',
          brand:'var(--jr-brand)', 'brand-hover':'var(--jr-brand-hover)', 'on-brand':'var(--jr-on-brand)'},
        lz: Object.fromEntries(['neutral', 'info', 'warning', 'discovery', 'success', 'danger'].map(key => [key, {DEFAULT:`var(--lz-${key}-fg)`, bg:`var(--lz-${key}-bg)`, solid:`var(--lz-${key}-solid)`}])),
        // Older names for the same states, used around the app.
        attention: {DEFAULT:'var(--st-manual-fg)', ink:'var(--st-manual-fg)', bg:'var(--st-manual-bg)'},
        busy: {DEFAULT:'var(--st-progress-fg)', ink:'var(--st-progress-fg)', bg:'var(--st-progress-bg)'},
        ready: {DEFAULT:'var(--st-done-fg)', ink:'var(--st-done-fg)', bg:'var(--st-done-bg)'},
      },
      borderRadius: {card:'var(--radius-md)', panel:'var(--radius-lg)'},
      boxShadow: {soft:'var(--shadow)', accent:'0 4px 14px var(--accent-shadow)', jr:'var(--jr-shadow)'},
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
