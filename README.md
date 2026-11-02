# Resume Manager

An Electron desktop app for managing resumes across multiple profiles, with pluggable templates and PDF export.

## Current resume workflow

There is one generation mode. Enter employers in reverse chronological order in the profile, with company, location, period, work type (for example Full-time or Contract), and work arrangement (Remote, Hybrid, or Onsite). Education is also maintained in the profile. The former role-based and last-company-tailor switches have been removed.

JSON supplies the target title, per-employer titles, summary, skills, role overviews, contribution sentences, and technologies. Employer names are used to match entries to profile history, with positional matching for older JSON. Displayed employer metadata and education always come from the profile. Markdown JSON code fences can be pasted into the editor; eligibility error objects cannot be exported.

The complete prompt lives in `src/prompts/resume-new.md`. Generate prompt reads this file each time and replaces the `{{CANDIDATE_PROFILE}}` placeholder with the candidate details (name, location, work metadata, and education from the profile). Keep that placeholder. All other instructions remain unchanged. Packaged apps include an editable `resources/resume-new.md` copy. Existing saved prompts are kept until you regenerate them.

`src/shared/resume.js` owns the fixed JSON contract, parsing, legacy-data migration, starter data, and employer matching. Both preview templates and native DOCX use its experience mapping. New JSON must have the exact schema, valid nested types, and one entry per profile employer. Existing saved resumes are migrated in memory to add missing fields; no bulk rewrite is performed. Run `npm test` for contract, prompt, template, and export checks.

**Export PDF + DOCX** saves both files into the company folder, together with `JD.txt` when provided. PDF uses the selected template. DOCX uses an editable, traditional single-column Word layout with native paragraphs, headings, and numbered bullet definitions. It is a genuine Office Open XML ZIP package, with no HTML conversion, HTML parts, or `altChunk` content. DOCX formatting is independent of PDF template customization.

New experience JSON fields:

```json
{
  "company": "Exact profile employer name",
  "title": "Generated role title",
  "overview": "First contextual sentence. Second contextual sentence.",
  "sentences": ["A contribution."],
  "technologies": ["JavaScript"]
}
```

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
| **Entry layout** | For each experience entry, places Company, Period, Work type (with arrangement) and Location on the title line or meta line, left or right aligned, or hides it. |
| **Keywords** | Bold, italic, underline, color and highlight for the `**keyword**` highlights the prompt puts in the summary, overview and bullets. Applies to both PDF and DOCX. |
| **Page** | Page margins, bullet symbol and color, heading case, and period badges. Shared by every template. |
| **Reset style** | Restores the defaults (light blue sidebar, Inter-ish system sans for both). |

Choices are saved per profile in `localStorage` (key `style:<profileId>`) and reused for both preview and PDF export.

Available fonts are system-installed families bundled in a registry inside `src/renderer/templates/core.js` (Inter / system sans, Helvetica, Arial, Calibri, Verdana, Tahoma, Georgia, Times New Roman, Cambria, Garamond). To add more, append to the `FONTS` array.

## Template

All bundled templates share Classic's single-column, top-to-bottom layout (built by `registerSingleColumn` in `src/renderer/templates/single-column.js`) and add their own toolbar group:

| Template | Visual feature | Extra controls |
|---|---|---|
| **Classic** | Traditional layout with contact icon row | — |
| **Timeline** | Experience on a vertical line with dots, dates in badges | Line color, dot shape, line style, line width |
| **Banner Header** | Colored header band for name, title and contacts | Banner color, contact text color, padding, shape (flat / rounded / angled), contact row inside or below |
| **Section Accent** | Styled section headings | Heading style (pill / left bar / underline / trailing rule / boxed), fill, letter spacing, line thickness |
| **Skill Chips** | Skills and technologies as tags | Chip shape, fill (tint / solid / outline), colors, technologies as chips or text |
| **Accent Rail** | Page-edge stripe and initials badge | Rail color, width, side, initials on/off, initials style |
| **Compact Pro** | Dense layout, single-line header, dotted date leaders | Header layout, dotted leader, paragraph spacing |

To add a new single-column template, create `src/renderer/templates/my-template.js` (copy `timeline.js` as a starting point) and add a `<script>` tag for it in `index.html` after `single-column.js`. Script order is the order shown in the template picker; the tests load the same list.

```js
(function () {
  const { registerSingleColumn, colorControl } = window.App.TemplateKit;
  registerSingleColumn({
    id: 'myTemplate',
    name: 'My Template',
    description: 'Short description',
    controls: [colorControl('stripeColor', 'Stripe', '#1f6feb', 'My group')],
    css: (t) => `h2 { border-bottom: 3px solid ${t.stripeColor}; }`,
  });
})();
```

For a completely different layout, call `register({ id, name, description, controls, thumbnail, render })` from `TemplateKit` instead.

`render({ profile, data, style })` must return a complete standalone HTML document (with embedded `<style>`). The same string is used for both the live preview and the PDF.

## PDF export

`Export PDF` opens the OS save dialog, then renders the chosen template into a real PDF using a hidden `BrowserWindow` with `printToPDF`. CSS `@page` rules in each template control page size and margins; `printBackground: true` is enabled so accent backgrounds are preserved across pages.

## Project layout

```
.
├── src/
│   ├── main/                # Electron main process
│   │   ├── main.js          # Window + IPC + JSON persistence + PDF export
│   │   ├── docx.js          # Native Word (.docx) export
│   │   ├── prompt.js        # Fills the prompt's {{CANDIDATE_PROFILE}} placeholder
│   │   └── preload.js       # contextBridge: window.api
│   ├── prompts/
│   │   └── resume-new.md    # Base resume-generation prompt
│   ├── shared/
│   │   └── resume.js        # JSON contract, employer matching, entry layout (main + renderer)
│   └── renderer/            # Renderer (UI) process
│       ├── index.html       # List view + workspace view
│       ├── styles.css       # Light + dark theme tokens, layouts
│       ├── theme-init.js    # Sets data-theme before first paint (no FOUC)
│       ├── templates/       # Resume templates
│       │   ├── core.js          # Fonts, HTML helpers, view-model, controls, registry
│       │   ├── single-column.js # Shared layout + page/keyword/entry controls
│       │   └── classic.js, timeline.js, banner.js, section-accent.js,
│       │       skill-chips.js, accent-rail.js, compact-pro.js
│       ├── workspace.js     # Workspace view: editor, preview, export
│       ├── process.js       # Application-process tracking view
│       └── renderer.js      # App shell, hash router, profile-list view
├── tests/                   # node --test suites (npm test)
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
