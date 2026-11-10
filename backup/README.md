# Legacy extension backup

`chrome-extension-legacy-0.4.1/` is a complete, unchanged copy of the Chrome
extension (version 0.4.1) as it was before question scanning and filling were
replaced with the ref logic (`ref/src/automation`) in 0.5.0.

Only `chrome-extension/page-tools.js`, the `version` in
`chrome-extension/manifest.json`, and two paragraphs of
`chrome-extension/README.md` changed in 0.5.0. The background worker, side
panel, ChatGPT tools and `core.mjs` are identical in both copies.

## Revert

Restore just the page logic (keeps any later changes to other files):

```sh
cp backup/chrome-extension-legacy-0.4.1/page-tools.js chrome-extension/page-tools.js
cp backup/chrome-extension-legacy-0.4.1/manifest.json chrome-extension/manifest.json
```

Or restore the whole extension:

```sh
rm -rf chrome-extension && cp -r backup/chrome-extension-legacy-0.4.1 chrome-extension
```

Then reload the extension at `chrome://extensions`. The legacy page tools use
script version 17 and the new ones version 18, so open job tabs pick up the
restored code after the reload. Reload or rescan any open application tab.

You can also load `backup/chrome-extension-legacy-0.4.1` directly with
**Load unpacked** to compare both side by side (in separate Chrome profiles).

## Legacy-only verifiers

`scripts/` here holds tests for behaviour that only the legacy logic has
(deferred option discovery, virtualized-list scrolling, Oracle grid text mode,
and its generic-layout heuristics). They run against the legacy copy:

```sh
node backup/scripts/verify-custom-controls.cjs
node backup/scripts/verify-oracle-controls.cjs
node backup/scripts/verify-question-scan.cjs
```

After restoring the legacy extension, move `verify-custom-controls.cjs` and
`verify-oracle-controls.cjs` back to `scripts/` and change their
`../chrome-extension-legacy-0.4.1/` paths to `../chrome-extension/`.
