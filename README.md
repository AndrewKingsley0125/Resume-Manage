# Resume Manager

An Electron desktop app for managing resumes across multiple profiles, with pluggable templates and PDF export.

## Tech stack

- Electron (latest)
- Vanilla HTML / CSS / JavaScript (no framework)
- Profiles + per-profile resumes persisted as JSON in the OS user data directory
- PDF generation via Electron's `webContents.printToPDF`

## Getting started

```bash
npm install
npm start
```

## Flow

1. **Profile selection screen** — add, edit, delete profiles. Each profile shows a rounded-rectangle avatar with the first letter of the name on a randomly assigned color.
2. **Click a profile** — navigates to that profile's resume workspace.
3. **Workspace** — pick a template, edit the resume data as JSON on the left, watch the live preview on the right, click **Export PDF** to save to disk.
4. The resume JSON is auto-saved as you type. **Reset from profile** rebuilds a fresh starter JSON seeded with the profile's name / location / linkedin.

### Profile fields

First name (required), last name, DOB, location, SSN, driver's license number + issued/expire dates, and LinkedIn URL.

### Resume JSON shape

The header on the rendered resume (name, location, LinkedIn) is taken from the **profile**. The JSON only carries the per-resume content:

```jsonc
{
  "company": "Company name from the job description",
  "summary": "",
  "skills": [
    { "Category1": ["Skill1", "Skill2", "..."] }
  ],
  "experience": [
    {
      "company": "",
      "sentences": [
        "Sentence 1",
        "Sentence 2"
      ]
    }
  ],
  "education": [
    { "degree": "Degree and Major" }
  ]
}
```

Notes:

- `company` is the **target** company (from the job description). It is shown as a "Target" chip in the workspace header so you can keep multiple tailored versions straight, but it is **not** rendered into the PDF.
- `skills` is an array of objects, each with a single category key whose value is the list of items: `{ "Languages": ["Python", "Go"] }`.
- The template ignores unknown fields, so the schema can grow.

## Customization

A customization toolbar above the editor controls the rendered template:

| Control | Effect |
|---|---|
| **Sidebar** | Color picker for the sidebar background. The heading / name accent color is automatically derived from the same hue (saturated + dark). |
| **Head font** | Font family for `<h1>`, `<h2>`, `<h3>` (the candidate name and section headings). |
| **Content font** | Font family for the body text, summary, and bullet lists. |
| **Reset style** | Restores the defaults (light blue sidebar, Inter-ish system sans for both). |

Choices are saved per profile in `localStorage` (key `style:<profileId>`) and reused for both preview and PDF export.

Available fonts are system-installed families bundled in a registry inside `templates.js` (Inter / system sans, Helvetica, Arial, Calibri, Verdana, Tahoma, Georgia, Times New Roman, Cambria, Garamond). To add more, append to the `FONTS` array.

## Template

The bundled template is **Modern** — a two-column layout with an accent sidebar (contact / skills / education) and main content (name / summary / experience).

To add a new template, append a registration call inside `templates.js`:

```js
register({
  id: 'my-template',
  name: 'My Template',
  description: 'Short description',
  render: ({ profile, data, style }) => `<!DOCTYPE html>...`,
});
```

`render({ profile, data, style })` must return a complete standalone HTML document (with embedded `<style>`). The same string is used for both the live preview and the PDF.

## PDF export

`Export PDF` opens the OS save dialog, then renders the chosen template into a real PDF using a hidden `BrowserWindow` with `printToPDF`. CSS `@page` rules in each template control page size and margins; `printBackground: true` is enabled so accent backgrounds (e.g. the Modern sidebar) are preserved across pages.

## Project layout

```
.
├── src/
│   ├── main/                # Electron main process
│   │   ├── main.js          # Window + IPC + JSON persistence + PDF export
│   │   └── preload.js       # contextBridge: window.api
│   └── renderer/            # Renderer (UI) process
│       ├── index.html       # List view + workspace view
│       ├── styles.css       # Light + dark theme tokens, layouts
│       ├── theme-init.js    # Sets data-theme before first paint (no FOUC)
│       ├── templates.js     # Pluggable template registry
│       ├── workspace.js     # Workspace view: editor, preview, export
│       ├── process.js       # Application-process tracking view
│       └── renderer.js      # App shell, hash router, profile-list view
└── package.json
```

## Where data is stored

Inside Electron's `userData` directory:

- `profiles.json` — list of profiles
- `resumes/<profileId>.json` — one file per profile

Locations:

- Windows: `%APPDATA%\resume-manage\`
- macOS: `~/Library/Application Support/resume-manage/`
- Linux: `~/.config/resume-manage/`

## Roadmap

- Form-based resume editor (drag-to-reorder sections) alongside the JSON editor
- Import resume from a `.json` file
- Page-break hints in templates
- Optional encryption (Electron `safeStorage` / OS keychain) for sensitive profile fields
