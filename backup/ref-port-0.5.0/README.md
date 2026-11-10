# Resume Manager Apply

Standalone Chrome extension with a side-panel workspace and automatic job opening. No build step, npm dependencies, API key, or automatic application submission. Native split view requires Chrome 155 or newer; older versions use grouped tabs.

## Install and connect

1. Restart Resume Manager from the updated source (`npm start`), or rebuild and install the desktop app. Keep it running.
2. Set a profile to **Chrome extension (Auto)**. Set its export folder and save job links.
3. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this `chrome-extension` directory (the directory containing `manifest.json`). Pin the extension if useful.
4. Click the extension icon to open the workspace in Chrome's side panel. In that panel, enter a name and the pairing code displayed by Resume Manager. Click **Connect**.
5. In the app, select the linked extension and click **Send to extension** beside a saved job. The extension receives the assignment and automatically opens the job site beside ChatGPT. Select the job in the side panel to continue.

The app accepts up to eight linked extension installations/Chrome profiles in total. Each extension receives only jobs assigned to it. A Chrome profile normally has one installation of this extension; use different Chrome profiles for separate instances.

## Manual application workflow

1. After **Send to extension** in the app, the extension automatically opens the job site and ChatGPT in native split view within one Chrome window. Its controls stay in the side panel; no separate extension tab is opened. Click **Check pages / grant site access** once to grant Chrome access to a new job-site origin. Before scanning, the extension waits for both tabs to finish loading and settle. Sign into ChatGPT or finish any site verification yourself, then retry if needed.
2. Click **Detect JD**. Review and edit the hiring company, title, and complete description.
3. Click **Send reviewed JD and resume prompt to ChatGPT**. The app inserts the profile into the latest default resume prompt. The extension activates the ChatGPT tab, waits for its visible composer, verifies insertion of the full prompt, clicks Send, and checks that the request was accepted. If ChatGPT's Send button cannot be detected, it asks you to send the already-inserted prompt manually.
4. When ChatGPT finishes, click **Read resume response and export files**. If ChatGPT omitted the request reference, the extension first tries the stable message ID and exact sent prompt. If matching remains uncertain, it shows the completed resume for review; check **This is the correct resume for this job** and click **Use this response and export files**. A changed response must be read and reviewed again. Resume Manager validates the exact JSON schema and employer names, renders the selected profile template and saved styles, and writes `resume.pdf`, `resume.docx`, and `JD.txt` under the profile's export folder and company directory. Existing company folders are not overwritten; choose another output folder or resolve the duplicate in the app before retrying. Scan the application and click **Upload resume.docx** on its resume field. The extension retrieves only the generated DOCX for the assigned job. After the site processes it, scan again to avoid filling stale fields or having resume parsing overwrite your answers. Other attachments stay manual.
5. Open the application form yourself. If it opens in another tab or on another origin, click the extension icon from that application tab, refresh the extension panel, and click **Use application tab**. Grant that site's access. The application tab replaces the job site beside ChatGPT in split view.
   **Fastest path:** click **Auto-fill application** in the Application questions step. It scans the form, uploads the generated resume.docx, asks ChatGPT, fills every answer, repeats if new questions appear, and clicks Next when every required field on the page is done. It has no approval step before filling, so check the form afterwards. It pauses for CAPTCHA, sign-in and emailed-code screens and continues when you finish them. It never clicks Submit and leaves consent and signature fields to you. The steps below do the same thing one at a time.
6. Click **Scan current application page**. Saved profile values are only reference material for ChatGPT, which generates every answer in the form each question needs. The preview starts blank for a new job; later scans of the same job reuse the answers already generated, and **Ask ChatGPT** only asks about new questions. Expand **Saved application facts** to consult the values you entered in the app.
7. Click **Ask ChatGPT** to send every answerable scanned question, including names, addresses, work eligibility, sponsorship, and voluntary disclosures. Before sending, the extension opens selection menus to read their options, including scrolling menus, without choosing answers. Each question gets a short id (`q1`), and each selection option gets an id (`o1`) alongside its exact label, with whether one or multiple choices are allowed. GPT returns the option id, which the extension maps directly to that option; an id that isn't in the list leaves the answer blank for review. Unreadable or incomplete lists are marked explicitly; GPT must use null rather than invent an unavailable choice. The prompt also contains saved personal information and answer-style instructions. GPT must return one entry per question and use null for unknown facts instead of guessing preferences or salary. Answers populate the preview automatically. File uploads, passwords, signatures, and consent controls stay outside the prompt. Professional history is reused from the same conversation rather than repeated. Use **Read answers manually** under Response recovery if automatic collection fails.
8. Review/edit answers in the side-panel preview. Clear any answer you want to skip, then click **Fill form**. The extension fills only answered, supported controls. It never clicks Next or Submit. Each field is filled on its own, checked afterwards, and retried once if it failed or the site cleared it. The form is then rescanned, the preview marks what was filled, and any failures or new questions are named. Click Next yourself, then scan the next page.
9. Submit or end the application yourself. Click **Confirm application ended** to record completion in the app. This records your confirmation; it does not infer submission success from the website.

If response detection fails, use the response-paste fallback. Reloading the extension or restarting Chrome clears in-progress tab/scan state; refresh assigned jobs and reopen/rescan. Pairing credentials, minimal tab/request references, and app-side job history persist across restarts. Completed responses can be recovered from the existing job/ChatGPT tab group after an extension reload.

## Site support and limits

Question scanning and filling use the ref automation logic (`ref/src/automation`), ported to run inside the page: site adapters for Greenhouse, Ashby, Lever, Workday, Workable, BambooHR, Rippling, Recruiterflow, Dover, Gem, Comeet, and Deel, plus the ref generic scanner for other sites. Each adapter tags controls with `data-aa-field`/`data-aa-option`, reads dropdown choices while scanning (comboboxes, Workday listboxes, BambooHR and Gem menus), and fills with the ref steps: text fields in one batch with read-back, `matchOption` fuzzy matching (US state aliases), type-and-pick for search boxes (`pickSuggestion`), and files first where a site parses the résumé (Lever, BambooHR, Rippling, Workable, Deel, Workday). JD extraction follows the same adapters, then schema.org JobPosting and the largest description block. These selectors come from the ref's analyzed samples, not live certification of every site's current form. The previous implementation is kept in `backup/chrome-extension-legacy-0.4.1` (see `backup/README.md`).

Text fields, textareas, native selects, native radio/checkbox groups, and some explicit button-based choices are supported. Custom ARIA comboboxes can be opened and filled by clicking a matching option; multiple-choice dropdowns expose their selected state so existing choices can be replaced. Address autocomplete waits for a unique matching suggestion, or keeps approved free text when the address control accepts it without suggestions. Selection is verified before reporting success. Missing, ambiguous, or unconfirmed options report a field error for manual review. Inaccessible frames, other file uploads, login fields, signatures, consent/attestations, CAPTCHAs, and widgets without readable options still require manual interaction. Resume/CV file inputs can receive the generated resume.docx using their explicit upload button. No CAPTCHA or sign-in bypass is attempted. A changed or replaced field requires a fresh scan and review.

ChatGPT's web interface can change. The extension recognizes the composer, Send control, assistant messages, and generation controls; request references, message IDs, and exact-prompt matching identify the correct exchange; an uncertain match requires your explicit confirmation before resume export. A stable completed response is still validated before use. No OpenAI API calls are made.

Oracle Candidate Experience has no ref adapter. Its grid-backed dropdowns are not opened while scanning, so they are asked as text; filling types the answer and picks the matching grid suggestion, then blurs to commit. Escape is sent only to an open list, because Oracle uses that key to clear a closed selection.

## Local connection and data

The desktop bridge listens only at `127.0.0.1:17373`. Pairing requires the code shown by the app. Connections use individual bearer credentials bound to the extension origin, stored as hashes in the app. The app dashboard can unlink a connection, revoking it and freeing its slot. Keep the pairing code private. Changing the code blocks new pairing with an old code and does not revoke existing connections.

The extension has default access to ChatGPT and the local app. Job-site access is requested per origin from a button click. The resume-generation step sends its existing profile prompt and JD. The question-generation step sends the personal information entered in the profile, the answer-style prompt, and the questions only when you click its button; professional history is reused from the same chat instead of being sent again. Generated DOCX bytes are delivered over the authenticated local bridge and uploaded only when you click Upload resume.docx on the corresponding resume field. Pairing credentials are in Chrome local extension storage; in-progress scans and answers use Chrome session storage. App-side connection/job history is stored in `extension-bridge.json` in Electron's user-data directory, separately from the app's existing backups.

See Chrome's official documentation for [cross-origin extension requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests), [optional permission requests](https://developer.chrome.com/docs/extensions/reference/api/permissions), and [tab groups](https://developer.chrome.com/docs/extensions/reference/api/tabGroups).

## Verification

From the desktop project root:

- `npm test`: bridge authentication, eight-slot cap, job isolation, JSON validation, professional-context filtering, and existing app checks.
- `node scripts/verify-extension-ui.cjs`: invisible Electron windows with local fixtures, exercising DOM extraction/scanning/filling, ChatGPT prompt/response detection, the preview approval gate, app routing, and native PDF/DOCX generation. This does not contact live job sites or ChatGPT.

- `node scripts/verify-chrome-extension.cjs`: loads this unpacked extension in a separate headless Chrome profile and tests real service-worker pairing, job delivery, tab grouping, JD and ChatGPT steps, scanning, approved filling, and completion. Job/ChatGPT pages are intercepted fixtures; external DNS is blocked. The test uses a random local port and a temporary extension copy, so it can run while Resume Manager is open. Set `RESUME_TEST_CHROME` if Chrome is installed elsewhere.

- `node scripts/verify-question-scan.cjs`: runs the question scanner against common form layouts in an invisible Electron window. Layouts marked `PENDING` are known gaps that do not fail the run.
- `node scripts/verify-ref-adapters.cjs`: runs the ref site adapters against fixtures shaped like each site's markup, then fills and checks the page.

Load the unpacked extension and run an application manually to verify behavior against the actual sites and signed-in ChatGPT interface you use.

## Side-panel placement and automatic opening

Click the extension icon once to open its side panel. Chrome requires a browser user gesture for opening a panel, so an assignment sent from the desktop app cannot force a closed panel open. An already-open global panel stays beside the job site and ChatGPT. Chrome controls whether panels appear on the left or right; if yours is on the left, move it with Chrome's side-panel controls. The extension does not change your global browser settings.

Assignments arrive through authenticated local long polling, with an alarm-based reconnect fallback. They open automatically even if a site's optional permissions have not yet been granted. Reading the JD or scanning/filling the application still waits for your per-site permission grant. Automatic opening does not send prompts to ChatGPT, fill answers, or submit an application. Failed opening attempts remain visible in the job summary and can be retried with Check pages.

After updating from 0.1.x, reload the extension at `chrome://extensions` and restart Resume Manager to enable the new assignment-notification endpoint. You can close the old extension tab; the toolbar now opens the side panel.

Native layout uses Chrome's [Tabs Split View API](https://developer.chrome.com/blog/split-view-api-extensions); panel opening follows the [Side Panel API user-gesture rules](https://developer.chrome.com/docs/extensions/reference/api/sidePanel).


### JSON-only response capture

Button 4 reads only the resume JSON, excluding iteration scores and code-block toolbar labels. It supports native code blocks and JSON/CodeMirror editors even when the response has no assistant-role wrapper. For virtualized editors that expose only visible lines, it invokes the newest JSON block's Copy control and captures that control's outgoing text inside the assigned ChatGPT tab. It never reads or replaces the existing OS clipboard and restores the page's copy function immediately afterward. It does not silently use an older JSON draft when the newest block cannot be read. Uncertain request matches still require review before export.


After updating to 0.3.0, restart Resume Manager for the generated-DOCX endpoint and reload the extension. The resume upload control becomes available after the DOCX has been exported for that assigned job.


## Automatic response monitoring (0.4.0)

After you click Send for a resume or application questions, the extension watches the assigned ChatGPT tab for generation to finish and the response to stabilize. It collects the completed JSON automatically, including scrollable code blocks. Resume JSON appears in the review section; confirm and export files yourself. Application question prompts require one fenced JSON code block and an entry for every question. Saved profile values are evidence for matching the form's option wording, not text to copy into every control. Text fields receive one string, single-choice fields one option id, and checkbox groups and multiple selects an array of option ids.

The side panel displays monitoring status and also checks for completed answers every three seconds while it is open, so a missed page notification does not block collection. The complete response replaces all preview answers, including edits made while GPT was responding. Null answers clear previous values, and approval resets. Filling the application still requires your review and approval. The manual Read buttons and paste fallback remain available. Monitoring stops after 20 minutes if no usable response is collected. After an extension reload, monitoring of a resume can resume from saved request metadata; a cleared question scan must be scanned again.

Reload the extension after updating to 0.4.0. The desktop app does not need changes for response monitoring.


## Compact side-panel steps (0.4.1)

The side panel shows one section at a time: Connect, Job, Resume, Questions, or Finish. Use Back/Next or the section selector to move between them without clearing drafts. Successful actions and collected responses open the relevant section; answer edits remain protected. The JD folds away after sending or when the resume is collected, and response-recovery tools stay collapsed until needed. Connection settings remain accessible from the compact connection button at the top.
