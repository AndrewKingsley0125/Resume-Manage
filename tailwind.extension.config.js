// Tailwind for the Chrome extension's pages (side panel and Resume Apply window).
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./chrome-extension/**/*.{html,js,mjs}'],
  theme: {
    extend: {
      colors: {
        page: '#10131b',
        card: '#181d29',
        field: '#0e121b',
        line: {DEFAULT:'#343e53', strong:'#536078'},
        ink: '#e7ebf3',
        muted: '#b5bfd1',
        accent: {DEFAULT:'#6c8cff', ink:'#0d142a', soft:'#8da5ff', status:'#222d48'},
        ok: '#86e5bc',
        bad: {DEFAULT:'#ff5c7a', bg:'#542534'},
        secondary: '#303b50',
      },
      fontFamily: {sans:['system-ui', 'sans-serif']},
    },
  },
  plugins: [],
};
