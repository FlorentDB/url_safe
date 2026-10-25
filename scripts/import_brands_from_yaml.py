#!/usr/bin/env python3
"""
Import brands from brands-priority.yaml into the SQLite database.

Usage:
    python scripts/import_brands_from_yaml.py --database data/url_safe.sqlite3
"""

import argparse
import csv
import sys
import tempfile
from pathlib import Path

import yaml

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from app.database import initialize_database, import_brand_domains, normalize_domain

DEFAULT_DATABASE_PATH = PROJECT_ROOT / "data" / "url_safe.sqlite3"
DEFAULT_YAML_PATH = PROJECT_ROOT / "data" / "brands-priority.yaml"


def parse_yaml(yaml_path: Path) -> list[dict]:
    """Parse YAML file and return list of brand entries."""
    with yaml_path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f)

    if not data or "categories" not in data:
        raise ValueError("YAML must have a 'categories' key")

    entries = []
    for category, brands in data["categories"].items():
        for brand_entry in brands:
            brand_name = brand_entry.get("brand")
            domain = brand_entry.get("domain")
            if not brand_name or not domain:
                print(f"Warning: Skipping invalid entry in {category}: {brand_entry}")
                continue
            try:
                normalized = normalize_domain(domain)
                entries.append({
                    "brand_name": brand_name,
                    "hostname": normalized,
                    "source": f"curated:{category}",
                })
            except ValueError as e:
                print(f"Warning: Invalid domain {domain} for {brand_name}: {e}")

    return entries


def main():
    parser = argparse.ArgumentParser(description="Import brands from YAML to SQLite")
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE_PATH)
    parser.add_argument("--yaml", type=Path, default=DEFAULT_YAML_PATH)
    parser.add_argument("--dry-run", action="store_true", help="Parse only, don't write to database")
    args = parser.parse_args()

    print(f"Reading brands from {args.yaml}")
    entries = parse_yaml(args.yaml)
    print(f"Parsed {len(entries)} brand entries")

    if args.dry_run:
        print("Dry run - not writing to database")
        for e in entries[:10]:
            print(f"  {e['brand_name']} -> {e['hostname']} ({e['source']})")
        if len(entries) > 10:
            print(f"  ... and {len(entries) - 10} more")
        return

    # Write to temporary CSV and import
    with tempfile.NamedTemporaryFile(mode="w", suffix=".csv", delete=False, newline="", encoding="utf-8") as tmp:
        writer = csv.DictWriter(tmp, fieldnames=["brand_name", "hostname", "source"])
        writer.writeheader()
        writer.writerows(entries)
        tmp_path = Path(tmp.name)

    try:
        print(f"Importing into {args.database}")
        imported = import_brand_domains(args.database, tmp_path, ignore_existing=False)
        print(f"Imported {imported} brands")
    finally:
        tmp_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()