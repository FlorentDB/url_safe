# url_safe — source for AMO review

This archive is the complete source of the Firefox add-on `url_safe`. The
submitted add-on is `url_safe-<version>-firefox.zip`, where `<version>` is the
value in `extension/manifest.json`; this archive lets a reviewer rebuild it.

No JavaScript is transpiled, bundled, minified or generated. Every `.js` file
under `extension/src/` is the exact file that runs in the add-on. The only
generated files are three JSON data files and the PNG icons; both the
generators and their inputs are included (see section 5).

## 1. Build environment

Tested on Fedora Linux (x86_64). Nothing in the build is Linux-specific.

| Tool | Version used | Requirement |
|---|---|---|
| Python | 3.14.8 | 3.11 or newer |
| Node.js | 22.23.1 | 20 or newer (`extension/package.json` declares `>=20`) |
| npm | 10.9.8 | ships with Node.js |
| Compiler | none | no native extension is compiled |

Disk: less than 20 MB after dependencies are installed. Git is not required:
the archive is self-contained. Python and Node.js can come from the system
package manager or from <https://www.python.org/downloads/> and
<https://nodejs.org/en/download/>.

## 2. Install the dependencies

From the extracted archive root:

```sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

`requirements.txt` lists the direct dependencies. For the exact versions used
to build the submitted package, install the lock file instead:

```sh
pip install -r requirements-lock.txt
```

The lock file records the whole tested environment, including test and audit
tooling. The two Python packages that determine the generated data are
`confusable-homoglyphs==3.3.1` and `tldextract==5.4.0`.

## 3. Build the add-on

From the extracted archive root:

```sh
bash scripts/update_extension.sh
```

This single script performs every technical step:

1. imports `data/domains.csv` and `data/brands.csv` into
   `data/url_safe.sqlite3` (`python3 -m app.import_domains`);
2. imports `data/brands-priority.yaml`
   (`python3 scripts/import_brands_from_yaml.py`);
3. exports the datasets with `python3 -m app.export_datasets`, writing
   `extension/src/data/domains.json`, `unicode.json` and
   `public_suffixes.json`;
4. runs the Python suite (`python3 -m pytest -q`, 31 tests);
5. runs the JavaScript suite (`npm test` in `extension/`, 43 tests);
6. builds the Firefox package (`npm run build:firefox`);
7. writes the release folder, including
   `release/<version>/url_safe-<version>-firefox.zip` (add-on,
   `manifest.json` at its root), `release/<version>/firefox-package/` (same
   files extracted) and `release/<version>/url_safe-<version>-source.zip`
   (this archive).

Expected final lines:

```text
manifest.json à la racine : OK
Paquet AMO : .../release/<version>/url_safe-<version>-firefox.zip
```

If `zip` is unavailable the script still works: the re-zip step is pure Python.

## 4. What the build scripts do

- `extension/manifest.json` is the only manifest.
  `extension/scripts/firefox-manifest.mjs` derives the Firefox manifest from
  it: background scripts instead of a service worker, the Gecko ID
  `url-safe@url-safe.fr`, and the data-collection declaration.
- `extension/scripts/build.mjs` copies `extension/src/`, `extension/_locales/`
  and `app/static/confidentialite.html` into the package, checks that every
  manifest reference exists, and writes the ZIP.
- `scripts/update_extension.sh` runs the whole pipeline, then re-zips the built
  tree as a conventional ZIP with `manifest.json` first and at the root.

Each step can also be run by hand, in this order, from the archive root:

```sh
python3 -m app.import_domains data/domains.csv
python3 -m app.import_domains data/brands.csv --brands
python3 scripts/import_brands_from_yaml.py
python3 -m app.export_datasets
python3 -m pytest -q
cd extension
npm test
npm run build:firefox
```

`npm run build:firefox` writes `extension/dist/url_safe-<version>-firefox.zip`
and `extension/dist/firefox/`. That archive already has `manifest.json` at its
root.

## 5. Generated data and assets

These are data files and images, not executable source. The archive includes
the generators and every input, so each one can be reproduced:

| Generated file | Generator | Inputs |
|---|---|---|
| `extension/src/data/domains.json` | `app/export_datasets.py` → `export_domains` | `data/domains.csv`, `data/brands.csv`, `data/brands-priority.yaml`, through `data/url_safe.sqlite3` |
| `extension/src/data/unicode.json` | `app/export_datasets.py` → `export_unicode` | the `confusable-homoglyphs` 3.3.1 tables |
| `extension/src/data/public_suffixes.json` | `app/export_datasets.py` → `export_public_suffix_list` | the `tldextract` 5.4.0 public-suffix snapshot |
| `extension/src/icons/icon-*.png` | `extension/scripts/make-icons.py` | the project colours, drawn as PNG by the script |

Every other file under `extension/` is hand-written and is shipped unmodified.
No build step rewrites JavaScript.

## 6. Verify the result

```sh
unzip -l release/<version>/url_safe-<version>-firefox.zip | head
unzip -p release/<version>/url_safe-<version>-firefox.zip manifest.json | grep '"version"'
```

Expected: `manifest.json` is the first entry, and the version matches
`extension/manifest.json`.

The archives use a fixed timestamp (2026-01-01 unless `SOURCE_DATE_EPOCH` is
set), so rerunning the build with the same Python version produces the same
bytes. If a different zlib produces different compressed bytes, compare the
file list and per-file contents: they are identical.

## 7. Source layout

```text
app/                  Python checker, database and exporters (reference implementation)
data/                 CSV and YAML inputs for the domain and brand registries
extension/            add-on source, manifest, tests and build scripts
  src/core/           checker in JavaScript, counterpart of app/
  src/shared/         dataset loading, rendering, settings
  src/data/           generated data assets (see section 5)
shared/vectors/       shared Python/JavaScript verdict vectors
scripts/              update_extension.sh and the data importers
tests/                Python test suite
requirements.txt      direct dependencies
requirements-lock.txt exact versions used for the submitted package
```

No third-party JavaScript library is bundled: the extension has no runtime
dependency. Its third-party data comes from the Python packages above and is
regenerated by the build.
