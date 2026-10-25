#!/usr/bin/env python3
"""Export the datasets that the extension ships.

The extension checks every URL locally, so it needs the domain and brand
registries, the Unicode confusable tables and the public suffix rules as data
rather than as queries. This script reads the checked-in sources under
``extension/data/`` and the installed Python packages, then writes
``extension/src/data/``.

Two artefacts come from the extension's own inputs:

``domains.json``
    The domain registry from ``data/domains.csv`` and the brand registry from
    ``data/brands.csv`` and ``data/brands-priority.yaml``.

The other two describe third-party tables:

``unicode.json``
    The trimmed Unicode confusables and script ranges, from
    ``confusable-homoglyphs``.

``public_suffixes.json``
    The public suffix rules, from the snapshot ``tldextract`` ships.

Run with::

    python3 extension/scripts/export_datasets.py
"""

import argparse
import csv
import json
from pathlib import Path

import idna
import yaml

SCHEMA_VERSION = 1
CLASSIFICATIONS = ["known", "suspicious", "impersonation", "unknown"]
DOMAIN_STATUSES = {"known", "malicious", "expired"}

EXTENSION_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATA_DIR = EXTENSION_ROOT / "data"
DEFAULT_OUTPUT_DIR = EXTENSION_ROOT / "src" / "data"


def normalize_domain(domain: str) -> str:
    """Normalize a hostname with UTS #46 and the STD3 rules."""
    value = domain.strip().rstrip(".").lower()
    if not value or "/" in value or "@" in value:
        raise ValueError(f"Nom de domaine invalide : {domain}")
    return idna.encode(value, uts46=True, std3_rules=True).decode("ascii").lower()


def read_domains(path: Path) -> list[dict[str, str]]:
    """Read the domain registry CSV."""
    entries = []
    with path.open(newline="", encoding="utf-8-sig") as source:
        reader = csv.DictReader(source)
        required = {"hostname", "status", "source"}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError(
                "Le CSV des domaines doit contenir hostname,status,source."
            )
        for row in reader:
            status = row["status"].strip().lower()
            if status not in DOMAIN_STATUSES:
                raise ValueError(
                    f"Statut invalide pour {row['hostname']!r} : {status}"
                )
            source_name = row["source"].strip()
            if not source_name:
                raise ValueError(f"Source manquante pour {row['hostname']}.")
            entries.append(
                {
                    "hostname": normalize_domain(row["hostname"]),
                    "status": status,
                    "source": source_name,
                }
            )
    return entries


def read_brand_csv(path: Path) -> list[dict[str, str]]:
    """Read the brand registry CSV."""
    entries = []
    with path.open(newline="", encoding="utf-8-sig") as source:
        reader = csv.DictReader(source)
        required = {"brand_name", "hostname", "source"}
        if not required.issubset(reader.fieldnames or []):
            raise ValueError(
                "Le CSV des marques doit contenir brand_name,hostname,source."
            )
        for row in reader:
            brand_name = row["brand_name"].strip()
            source_name = row["source"].strip()
            if not brand_name or not source_name:
                raise ValueError(
                    "Chaque domaine de marque doit avoir un nom et une source."
                )
            entries.append(
                {
                    "brand_name": brand_name,
                    "hostname": normalize_domain(row["hostname"]),
                    "source": source_name,
                }
            )
    return entries


def read_brand_yaml(path: Path) -> list[dict[str, str]]:
    """Read the curated priority brands, one category at a time."""
    document = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    categories = document.get("categories") or {}
    entries = []
    for category, brands in categories.items():
        for brand in brands or []:
            brand_name = str(brand.get("brand", "")).strip()
            domain = str(brand.get("domain", "")).strip()
            if not brand_name or not domain:
                continue
            entries.append(
                {
                    "brand_name": brand_name,
                    "hostname": normalize_domain(domain),
                    "source": f"curated:{category}",
                }
            )
    return entries


def export_domains(data_dir: Path, output_path: Path) -> int:
    """Write the domain and brand registries as a single JSON document."""
    domains = sorted(
        read_domains(data_dir / "domains.csv"),
        key=lambda row: row["hostname"],
    )

    # The curated YAML wins over the CSV when both describe the same pair,
    # which is the order the previous importer applied.
    brands: dict[tuple[str, str], dict[str, str]] = {}
    for entry in read_brand_csv(data_dir / "brands.csv"):
        brands.setdefault((entry["brand_name"], entry["hostname"]), entry)
    for entry in read_brand_yaml(data_dir / "brands-priority.yaml"):
        brands[(entry["brand_name"], entry["hostname"])] = entry

    ordered_brands = [brands[key] for key in sorted(brands)]
    document = {
        "schema_version": SCHEMA_VERSION,
        "classifications": CLASSIFICATIONS,
        "domains": domains,
        "brands": ordered_brands,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(document, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return len(domains) + len(ordered_brands)


def export_unicode(output_path: Path) -> int:
    """Write the trimmed Unicode tables used for homoglyph detection.

    Only source characters with at least one Latin homoglyph are kept, because
    the extension only asks whether a character is confusable with Latin.
    """
    from confusable_homoglyphs import categories
    from confusable_homoglyphs import confusables as confusables_module

    raw = confusables_module.confusables_data

    def alias_of(character: str) -> str | None:
        try:
            return categories.alias(character)
        except (TypeError, ValueError):
            return None

    trimmed: dict[str, list[str]] = {}
    for character, entries in raw.items():
        if alias_of(character) == "LATIN":
            continue
        has_latin_homoglyph = any(
            alias_of(glyph) == "LATIN"
            for entry in entries
            for glyph in entry["c"]
        )
        if not has_latin_homoglyph:
            continue
        trimmed[character] = [entry["c"] for entry in entries]

    document = {
        "schema_version": SCHEMA_VERSION,
        "confusables": trimmed,
        "script_ranges": categories.categories_data["code_points_ranges"],
        "script_aliases": categories.categories_data["iso_15924_aliases"],
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(document, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    return len(trimmed)


def export_public_suffix_list(output_path: Path) -> int:
    """Write the public suffix rules used to find registrable domains."""
    import pkgutil

    from tldextract.suffix_list import extract_tlds_from_suffix_list

    snapshot = pkgutil.get_data("tldextract", ".tld_set_snapshot")
    if snapshot is None:  # pragma: no cover - the package always ships it
        raise RuntimeError("L’instantané de la liste de suffixes est introuvable.")
    public_tlds, _ = extract_tlds_from_suffix_list(snapshot.decode("utf-8"))

    document = {
        "schema_version": SCHEMA_VERSION,
        "rules": sorted(public_tlds),
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(document, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    return len(public_tlds)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Exporter les jeux de données embarqués par l’extension."
    )
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument(
        "--skip-unicode",
        action="store_true",
        help="Ne pas réexporter les tables Unicode.",
    )
    arguments = parser.parse_args()

    count = export_domains(
        arguments.data_dir,
        arguments.output_dir / "domains.json",
    )
    print(f"{count} entrée(s) exportée(s) vers domains.json.")

    if not arguments.skip_unicode:
        characters = export_unicode(arguments.output_dir / "unicode.json")
        print(f"{characters} caractère(s) exporté(s) vers unicode.json.")

    rules = export_public_suffix_list(
        arguments.output_dir / "public_suffixes.json"
    )
    print(f"{rules} règle(s) de suffixe exportée(s) vers public_suffixes.json.")


if __name__ == "__main__":
    main()
