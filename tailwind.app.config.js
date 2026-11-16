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
        line: 'var(--border)',
        'line-strong': 'var(--border-hover)',
        ink: 'var(--text)',
        muted: 'var(--text-muted)',
        accent: {DEFAULT:'var(--accent)', hover:'var(--accent-hover)', ring:'var(--accent-ring)', shadow:'var(--accent-shadow)'},
        danger: {DEFAULT:'var(--danger)', hover:'var(--danger-hover)', bg:'var(--danger-bg)', line:'var(--danger-border)'},
        success: {DEFAULT:'var(--success)', hover:'var(--success-hover)', bg:'var(--success-bg)', line:'var(--success-border)'},
        hover: {DEFAULT:'var(--surface-hover)', strong:'var(--surface-hover-strong)'},
        // Job states, the same in both themes.
        attention: {DEFAULT:'#e8912d', ink:'#c06a0c', bg:'rgba(232, 145, 45, 0.16)'},
        busy: {DEFAULT:'#5b7cfa', ink:'#4a64d8', bg:'rgba(91, 124, 250, 0.16)'},
        ready: {DEFAULT:'#22a06b', ink:'#1a9a63', bg:'rgba(34, 160, 107, 0.16)'},
      },
      borderRadius: {card:'var(--radius-md)', panel:'var(--radius-lg)'},
      boxShadow: {soft:'var(--shadow)', accent:'0 4px 14px var(--accent-shadow)'},
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
