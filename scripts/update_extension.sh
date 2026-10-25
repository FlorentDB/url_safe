#!/usr/bin/env sh
#
# Refresh the local databases and the datasets bundled with the extension,
# run both test suites, and rebuild the Firefox package.
#
# The extension ships its data inside the package, so a data change only
# reaches users through a rebuild. This script performs the whole sequence in
# the order the pipeline expects. Run it from anywhere; the paths are resolved
# from the script location.
#
#     bash scripts/update_extension.sh
#
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

echo "== Import des domaines =="
python3 -m app.import_domains data/domains.csv

echo "== Import des marques =="
python3 -m app.import_domains data/brands.csv --brands

echo "== Import des marques prioritaires (YAML) =="
python3 scripts/import_brands_from_yaml.py

echo "== Export des jeux de données pour l’extension =="
python3 -m app.export_datasets

echo "== Suites Python =="
python3 -m pytest -q

cd extension

echo "== Suites JavaScript =="
npm test

echo "== Paquet Firefox =="
npm run build:firefox

echo
echo "Paquet prêt : extension/dist/url_safe-$(node -p "require('./package.json').version")-firefox.zip"
