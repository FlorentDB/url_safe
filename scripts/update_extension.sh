#!/usr/bin/env sh
#
# Refresh the local databases and the datasets bundled with the extension,
# run both test suites, rebuild the Firefox package, and publish the release
# folder for AMO.
#
# The extension ships its data inside the package, so a data change only
# reaches users through a rebuild. This script performs the whole sequence in
# the order the pipeline expects, then writes exactly one ZIP whose root
# contains manifest.json. Run it from anywhere; the paths are resolved from
# the script location.
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

VERSION=$(node -p "require('./package.json').version")
BUILD_DIR="$ROOT/extension/dist/firefox"
RELEASE_DIR="$ROOT/release/$VERSION"
RELEASE_ZIP="$RELEASE_DIR/url_safe-$VERSION-firefox.zip"

mkdir -p "$RELEASE_DIR"
rm -f "$RELEASE_DIR"/url_safe-*-firefox.zip

# Re-zip from the built tree so the archive is an ordinary ZIP: every built
# entry is included, manifest.json comes first, directory entries exist, and
# the timestamps are real. The hand-written archive produced by build.mjs
# stays as the build artefact.
python3 - "$BUILD_DIR" "$RELEASE_ZIP" <<'PY'
import os
import sys
import time
import zipfile
from pathlib import Path

build_dir = Path(sys.argv[1])
out = Path(sys.argv[2])

# Fixed timestamps keep the archive reproducible; SOURCE_DATE_EPOCH can
# override them.
epoch = os.environ.get("SOURCE_DATE_EPOCH")
now = time.gmtime(int(epoch))[:6] if epoch else (2026, 1, 1, 0, 0, 0)

entries = []
for path in build_dir.rglob("*"):
    relative = path.relative_to(build_dir).as_posix()
    entries.append((f"{relative}/" if path.is_dir() else relative, path))
entries.sort(key=lambda item: (item[0] != "manifest.json", item[0]))

with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name, path in entries:
        info = zipfile.ZipInfo(name, date_time=now)
        if path.is_dir():
            info.external_attr = (0o040755 << 16) | 0x10
            archive.writestr(info, b"", compress_type=zipfile.ZIP_STORED)
        else:
            info.external_attr = 0o100644 << 16
            archive.writestr(
                info,
                path.read_bytes(),
                compress_type=zipfile.ZIP_DEFLATED,
                compresslevel=9,
            )
PY

# AMO refuses a package without a root manifest, so fail loudly here rather
# than during the upload.
python3 - "$RELEASE_ZIP" <<'PY'
import sys
import zipfile

archive = zipfile.ZipFile(sys.argv[1])
names = archive.namelist()
if "manifest.json" not in names:
    raise SystemExit(
        f"ERREUR : manifest.json absent de la racine de {sys.argv[1]}"
    )
print(f"manifest.json à la racine : OK ({len(names)} entrées)")
PY

# A plain extracted copy, so the folder can be inspected or loaded as a
# temporary add-on from about:debugging without unzipping anything.
rm -rf "$RELEASE_DIR/firefox-package"
mkdir -p "$RELEASE_DIR/firefox-package"
python3 - "$RELEASE_ZIP" "$RELEASE_DIR/firefox-package" <<'PY'
import sys
import zipfile

zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])
PY

SOURCE_ZIP="$RELEASE_DIR/url_safe-$VERSION-source.zip"
rm -f "$RELEASE_DIR"/url_safe-*-source.zip

# The source archive AMO asks for when generated files are part of the package.
# It carries the build instructions, every input and the build scripts, and
# excludes the artefacts (dist/, release/, virtualenv, database, caches).
python3 - "$ROOT" "$SOURCE_ZIP" <<'PY'
import os
import sys
import time
import zipfile
from pathlib import Path

root = Path(sys.argv[1])
out = Path(sys.argv[2])

epoch = os.environ.get("SOURCE_DATE_EPOCH")
now = time.gmtime(int(epoch))[:6] if epoch else (2026, 1, 1, 0, 0, 0)

skip_dirs = {
    ".git",
    ".venv",
    "__pycache__",
    ".pytest_cache",
    "node_modules",
    "dist",
    "release",
}
skip_suffixes = {".pyc", ".pyo", ".sqlite3", ".xpi", ".zip"}
skip_names = {".DS_Store"}

trees = ["extension", "app", "data", "scripts", "shared", "tests"]
files = [
    "AMO-SOURCE-README.md",
    "AMO-SOURCE-REVIEW-NOTES.txt",
    "requirements.txt",
    "requirements-lock.txt",
    "README.md",
    "ARCHITECTURE.md",
    "CHANGELOG.md",
    "FIREFOX-BETA.md",
]

entries = []
for tree in trees:
    for path in (root / tree).rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(root)
        if skip_dirs & set(relative.parts):
            continue
        if path.suffix in skip_suffixes or path.name in skip_names:
            continue
        entries.append((relative.as_posix(), path))
for name in files:
    path = root / name
    if path.is_file():
        entries.append((name, path))
entries.sort(key=lambda item: item[0])

with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for name, path in entries:
        info = zipfile.ZipInfo(name, date_time=now)
        info.external_attr = 0o100644 << 16
        archive.writestr(
            info,
            path.read_bytes(),
            compress_type=zipfile.ZIP_DEFLATED,
            compresslevel=9,
        )

size = out.stat().st_size
if size > 200 * 1024 * 1024:
    raise SystemExit(f"ERREUR : archive source trop volumineuse ({size} octets)")
packed = {name for name, _ in entries}
if "extension/manifest.json" not in packed:
    raise SystemExit("ERREUR : extension/manifest.json absent de l’archive source")
if "scripts/update_extension.sh" not in packed:
    raise SystemExit("ERREUR : le script de build est absent de l’archive source")
print(f"archive source : {out.name} ({len(entries)} fichiers, {size} octets)")
PY

cp "$ROOT/AMO-SOURCE-README.md" "$RELEASE_DIR/AMO-SOURCE-README.md"
cp "$ROOT/AMO-SOURCE-REVIEW-NOTES.txt" "$RELEASE_DIR/AMO-SOURCE-REVIEW-NOTES.txt"
cp "$ROOT/CHANGELOG.md" "$RELEASE_DIR/CHANGELOG.md"
cp "$ROOT/FIREFOX-BETA.md" "$RELEASE_DIR/LISTING-FR.md"

python3 - "$RELEASE_DIR" <<'PY'
import hashlib
import pathlib
import sys

base = pathlib.Path(sys.argv[1])
lines = []
for path in sorted(base.iterdir()):
    if path.is_file() and path.name != "SHA256SUMS.txt":
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        lines.append(f"{digest}  {path.name}")
(base / "SHA256SUMS.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
PY

echo
echo "Paquet AMO : $RELEASE_ZIP"
echo "Archive source : $SOURCE_ZIP"
echo "Le paquet a manifest.json à sa racine ; l’archive source contient le script de build."
echo "Vérification : (cd \"$RELEASE_DIR\" && sha256sum -c SHA256SUMS.txt)"
