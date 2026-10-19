import argparse
import re
from datetime import datetime, timezone
from pathlib import Path

import httpx

from app.database import import_tranco_archive


LIST_ID_URL = "https://tranco-list.eu/top-1m-id"
DOWNLOAD_URL_TEMPLATE = "https://tranco-list.eu/download_daily/{list_id}"
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATABASE_PATH = PROJECT_ROOT / "data" / "url_safe.sqlite3"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Télécharger et importer un snapshot de popularité Tranco."
    )
    parser.add_argument("--limit", type=int, default=10_000, help="Nombre maximal de domaines (défaut : 10 000).")
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE_PATH)
    arguments = parser.parse_args()

    with httpx.Client(timeout=30.0, follow_redirects=True) as client:
        list_id_response = client.get(LIST_ID_URL)
        list_id_response.raise_for_status()
        list_id = list_id_response.text.strip()
        if not re.fullmatch(r"[A-Za-z0-9]+", list_id):
            raise ValueError("L’identifiant reçu de Tranco n’a pas le format attendu.")

        source_url = DOWNLOAD_URL_TEMPLATE.format(list_id=list_id)
        archive_response = client.get(source_url)
        archive_response.raise_for_status()

    imported, skipped = import_tranco_archive(
        database_path=arguments.database,
        archive=archive_response.content,
        list_id=list_id,
        source_url=source_url,
        limit=arguments.limit,
        downloaded_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
    )
    print(
        f"Snapshot Tranco {list_id} importé : {imported} domaines, "
        f"{skipped} entrée(s) invalide(s) ignorée(s)."
    )


if __name__ == "__main__":
    main()