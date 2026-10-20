"""Export the local databases as static JSON for the browser extension.

The extension performs every check locally, so it needs the domain and brand
registries as data rather than as queries. Exporting them as static files also
means a user downloading the datasets reveals nothing about which URL they
checked, because the request is identical for every user.

Two artefacts are produced:

``domains.json``
    The ``domains`` and ``brand_domains`` tables, as a single document.

``unicode.json``
    The trimmed Unicode confusable tables and script ranges used by the
    extension to detect homoglyphs and mixed-script labels. This one is
    generated from the installed ``confusable-homoglyphs`` package, so the
    extension and the server always agree on the underlying Unicode data.

The public suffix list is not exported: the extension ships its own copy so
that registrable-domain extraction works offline.
"""

import argparse
import json
from pathlib import Path

from app.database import initialize_database, list_brand_domains
from app.main import DEFAULT_DATABASE_PATH
from app.verdict import Classification

SCHEMA_VERSION = 1

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "extension" / "src" / "data"


def export_domains(
    database_path: Path,
    output_path: Path,
) -> int:
    """Write the domain and brand registries as a single JSON document."""
    initialize_database(database_path)

    domains: list[dict[str, str]] = []
    for row in _read_domain_rows(database_path):
        domains.append(
            {
                "hostname": row["hostname"],
                "status": row["status"],
                "source": row["source"],
            }
        )

    brands = [
        {
            "brand_name": brand["brand_name"],
            "hostname": brand["hostname"],
            "source": brand["source"],
        }
        for brand in list_brand_domains(database_path)
    ]

    document = {
        "schema_version": SCHEMA_VERSION,
        "classifications": list(Classification.__args__),
        "domains": domains,
        "brands": brands,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(document, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return len(domains) + len(brands)


def _read_domain_rows(database_path: Path) -> list[dict[str, str]]:
    from app.database import connect

    with connect(database_path) as connection:
        rows = connection.execute(
            "SELECT hostname, status, source FROM domains ORDER BY hostname"
        ).fetchall()
    return [dict(row) for row in rows]


def export_unicode(output_path: Path) -> int:
    """Write the trimmed Unicode tables used for homoglyph detection.

    Only source characters that have at least one Latin homoglyph are kept,
    because the extension only ever asks whether a character is confusable
    with Latin. The remaining characters can never produce a match, so
    dropping them shrinks the artefact by roughly eighty percent without
    changing any result.
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
    """Write the public suffix rules used to find registrable domains.

    The rules come from the same snapshot that ``tldextract`` uses, so the
    extension and the server agree on where a registrable domain starts.
    Only the public section is written, because the server matches against
    public rules alone: ``include_psl_private_domains`` is left at its
    default of ``False``.
    """
    import pkgutil
    from tldextract.suffix_list import extract_tlds_from_suffix_list

    snapshot = pkgutil.get_data("tldextract", ".tld_set_snapshot")
    if snapshot is None:  # pragma: no cover - the package always ships it
        raise RuntimeError("Le instantané de la liste de suffixes est introuvable.")
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
        description=(
            "Exporter les bases locales au format JSON pour l’extension navigateur."
        )
    )
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE_PATH)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument(
        "--skip-unicode",
        action="store_true",
        help="Ne pas exporter les tables Unicode.",
    )
    arguments = parser.parse_args()

    count = export_domains(
        arguments.database,
        arguments.output_dir / "domains.json",
    )
    print(f"{count} entrée(s) exportée(s) vers domains.json.")

    if not arguments.skip_unicode:
        characters = export_unicode(arguments.output_dir / "unicode.json")
        print(f"{characters} caractère(s) exporté(s) vers unicode.json.")

    rules = export_public_suffix_list(arguments.output_dir / "public_suffixes.json")
    print(f"{rules} règle(s) de suffixe exportée(s) vers public_suffixes.json.")


if __name__ == "__main__":
    main()
