import argparse
from pathlib import Path

from app.database import import_brand_domains, import_domains
from app.main import DEFAULT_DATABASE_PATH
from app.main import BRAND_DOMAINS_PATH


def main() -> None:
    parser = argparse.ArgumentParser(description="Importer des domaines depuis un fichier CSV.")
    parser.add_argument("csv_path", type=Path, help="CSV avec les colonnes hostname,status,source")
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE_PATH)
    parser.add_argument(
        "--brands",
        action="store_true",
        help=f"Importer un registre de marques (par défaut : {BRAND_DOMAINS_PATH.name}).",
    )
    arguments = parser.parse_args()

    importer = import_brand_domains if arguments.brands else import_domains
    count = importer(arguments.database, arguments.csv_path)
    label = "marque(s)" if arguments.brands else "domaine(s)"
    print(f"{count} {label} importé(s) ou mis à jour.")


if __name__ == "__main__":
    main()