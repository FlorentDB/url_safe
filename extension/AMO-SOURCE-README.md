# url_safe Firefox source for AMO review

The complete build instructions are in `AMO-SOURCE-README.md` at the root of
the source archive. This file stays inside the extension directory so the
add-on tree documents itself.

In short, from the archive root: install `requirements.txt`, then run
`bash scripts/update_extension.sh`. The script regenerates the datasets, runs
both test suites and writes the add-on package with `manifest.json` at its
root. The JavaScript and HTML are not minified or bundled; the build converts
the source manifest to Firefox's event-page format with its Gecko ID and
data-collection declarations.

## Build requirements

- Node.js 20 or newer
- No third-party Node packages; there is no `npm install` step

## Reproduce the Firefox package

From the extracted project root:

```sh
cd extension
npm run build:firefox
```

The command creates `extension/dist/firefox/` and
`extension/dist/url_safe-0.1.1-firefox.zip`. The ZIP is the unsigned package
submitted to AMO. To run the extension's tests first:

```sh
npm test
```

The build script reads `extension/manifest.json`, transforms it using
`extension/scripts/firefox-manifest.mjs`, copies `extension/src/`,
`extension/_locales/`, and `app/static/confidentialite.html`, then writes the
Firefox ZIP. The package contains the exact source JavaScript; no generated
JavaScript or minification step is involved.
