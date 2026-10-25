# url_safe Firefox source for AMO review

The complete build instructions are in `AMO-SOURCE-README.md` at the root of
the source archive. This file stays inside the extension directory so the
add-on tree documents itself.

From the archive root:

```sh
pip install -r requirements.txt
bash scripts/update_extension.sh
```

The script regenerates the datasets, runs the JavaScript suite and writes the
add-on package with `manifest.json` at its root. The JavaScript and HTML are
not minified or bundled; the build converts the source manifest to Firefox's
event-page format with its Gecko ID and data-collection declarations.

To build only the package, without regenerating the datasets:

```sh
cd extension
npm test
npm run build:firefox
```

The build reads `extension/manifest.json`, converts it with
`extension/scripts/firefox-manifest.mjs`, copies `extension/src/` and
`extension/_locales/`, and writes
`extension/dist/url_safe-<version>-firefox.zip`.
`extension/src/confidentialite.html` is part of the source tree and ships as
is. No build step rewrites JavaScript.
