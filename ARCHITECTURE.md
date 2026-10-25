# Architecture

## Purpose

url_safe is a Firefox extension (Manifest V3) that inspects an address on
request without visiting it. Every check runs on the device: the extension
parses and normalizes the URL, compares the host with the bundled domain and
brand registries, applies URL and Unicode heuristics, and shows a verdict.
Results are informational and never certify that a page is safe.

## Stack

- Plain JavaScript ES modules, HTML and CSS; no framework, bundler or runtime
  dependency.
- Node's test runner (`node --test`) and a hand-written ZIP writer in
  `extension/scripts/build.mjs`.
- Python only at build time, for the data and the icons: `idna`,
  `confusable-homoglyphs`, `tldextract` and `PyYAML`.

## Layout

```text
extension/
  manifest.json           source manifest, Chrome-shaped
  src/core/               checker: urlsplit, idna, unicode, brand, suffix, verdict
  src/shared/             dataset loading, rendering, settings, theme
  src/background/         context menu, optional refresh alarm, message router
  src/popup/              toolbar popup
  src/result/             full-page result opened from the context menu
  src/options/            options and optional dataset refresh
  src/data/               generated datasets (domains, Unicode, suffixes)
  src/confidentialite.html privacy policy shipped with the add-on
  data/                   CSV and YAML inputs for the registries
  scripts/                build, Firefox manifest, icons, dataset export
  test/                   Node suites and the verdict vectors
scripts/update_extension.sh  export, test, build and release
```

## Two user-initiated entry points

- The toolbar popup, where an address is pasted by hand.
- A context-menu entry on links, “Vérifier avec url_safe”, which opens a
  full-page result in a new tab. The checked address travels through
  `chrome.storage.session` behind an opaque identifier, so it never reaches
  the address bar or the browser history.

There is no content script, no hover detection and no page-load inspection.
Every check follows a deliberate gesture, which is what makes the single
purpose defensible in front of a store review.

## Permissions and privacy

The manifest declares `storage`, `contextMenus` and `alarms`. It declares no
`content_scripts`, no `tabs`, no `activeTab`, no `scripting` and no
`host_permissions`. The only host access is an optional permission for one
HTTPS origin, requested when the user asks for a dataset refresh and dropped
when the refreshed data is discarded.

A fresh installation triggers no permission prompt. `test/manifest.test.js`
asserts these rules, so adding a browsing permission fails the suite.

A check never leaves the device. The optional refresh downloads the same bulk
files for every user, so it reveals nothing about which URL was checked.

## The checker

`src/core/` holds the rules, split by concern:

- `urlsplit.js` reproduces Python's `urllib.parse.urlsplit`, because the
  browser's `URL` parser decodes the host and normalizes parts the rules leave
  untouched.
- `idna.js` uses the browser parser for UTS #46 mapping and applies the STD3
  rules on top, because the browser accepts hostnames those rules reject.
- `idna.js` also decodes RFC 3492 punycode, since `TextDecoder` has no
  `punycode` encoding.
- `unicode.js` detects confusable characters and mixed-script labels from the
  trimmed tables in `src/data/unicode.json`.
- `brand.js` compares the registrable domain with the brand registry: exact
  match, one-character difference, supported homoglyph match, or an official
  domain placed under another site.
- `publicsuffix.js` finds the registrable domain from
  `src/data/public_suffixes.json`.
- `verdict.js` turns the findings into `known`, `suspicious`,
  `impersonation` or `unknown`, with the wording shown to the user.

`test/vectors.json` pins inputs and expected verdicts. Changing a rule or a
message means updating the vectors in the same change.

## Datasets

The extension ships its data inside the package, so it works offline and with
no host permission. `extension/scripts/export_datasets.py` writes three files
into `src/data/`:

- `domains.json` from `data/domains.csv`, `data/brands.csv` and
  `data/brands-priority.yaml`;
- `unicode.json` from the `confusable-homoglyphs` tables, trimmed to the
  characters that have a Latin homoglyph;
- `public_suffixes.json` from the snapshot `tldextract` ships.

All three report `schema_version` 1, which the extension refuses to load when
it differs. Only refreshed datasets are cached in `chrome.storage.local`; the
bundled ones are read from the package on every use.

## Rendering

`src/shared/render.js` builds the verdict with `textContent` only. Each reason
shows a plain-language summary first, with the technical wording behind a
toggle. A hostile hostname stays text and never becomes markup; the renderer
test enforces this against a stand-in DOM that throws on `innerHTML`.

## Build and packaging

`extension/scripts/build.mjs` copies `src/` and `_locales/`, derives the
Firefox manifest with `firefox-manifest.mjs` (background scripts instead of a
service worker, the Gecko ID `url-safe@url-safe.fr`, the data-collection
declaration), validates every manifest and page reference, scans the packaged
files for placeholders, and writes the archives.

`scripts/update_extension.sh` runs the whole sequence: export the datasets,
run the suite, build, then publish `release/<version>/` with the add-on ZIP,
the source ZIP, an extracted `firefox-package/`, the source instructions and
`SHA256SUMS.txt`. `--version X.Y.Z` and `--bump patch|minor|major` rewrite
`extension/manifest.json` and `extension/package.json` before the build, so a
new release folder needs no manual edit. The archives use a fixed timestamp,
so a rebuild is byte-identical with the same Python version.

The release folder keeps both archives the store asks for:
`url_safe-<version>-firefox.zip` (with `manifest.json` at its root) and
`url_safe-<version>-source.zip` (build instructions, build script, dependency
list and lock file, every input, and no artefact).

## Tests

- `npm test` (43 tests): the checker against the vectors, IDNA and URL
  splitting, the renderer against a stand-in DOM, the manifest privacy rules,
  the packaged datasets, storage migration and the syntax of every source
  file.
- The build itself rejects a package that references a missing file, points at
  a missing page, or still carries `example.invalid` in a release.

## Limitations

- Unicode checks are heuristics, not a complete UTS #39 skeleton or bidi
  implementation.
- `known` is not a trust guarantee and `unknown` is not a threat verdict.
- The bundled registries are curated seeds, not maintained threat
  intelligence.
