# url_safe Firefox source for AMO review

This archive contains the source used to build `url_safe` version 0.1.0 for
Firefox. The JavaScript and HTML are not minified or bundled. The build script
copies the extension files, copies the privacy policy into the package, and
converts the source manifest to Firefox's event-page format with its Gecko ID
and data-collection declarations.

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
`extension/dist/url_safe-0.1.0-firefox.zip`. The ZIP is the unsigned package
submitted to AMO. To run the extension's tests first:

```sh
npm test
```

The build script reads `extension/manifest.json`, transforms it using
`extension/scripts/firefox-manifest.mjs`, copies `extension/src/`,
`extension/_locales/`, and `app/static/confidentialite.html`, then writes the
Firefox ZIP. The package contains the exact source JavaScript; no generated
JavaScript or minification step is involved.
